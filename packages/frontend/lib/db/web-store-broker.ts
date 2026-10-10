import type { Row, Statement } from './client-engine';
import { writtenTables } from './sql-tables';

export const DATABASE_CHANNEL = 'noted:database:v1';
export const DATABASE_LEADER_LOCK = 'noted:expo-sqlite:opfs';
const PROTOCOL = 'noted-db-v1';
const DEFAULT_TIMEOUT_MS = 20_000;

export type DatabaseOperation =
  | { type: 'execute'; sql: string; params?: readonly unknown[] }
  | { type: 'transaction'; statements: readonly Statement[] };
export type DatabaseResult = Row[] | number[];
export interface BrokerChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}
export interface BrokerLocks {
  request(name: string, callback: (lock: unknown) => Promise<void>): Promise<void>;
}
interface Term { id: string; epoch: string; startedAt: number }
interface Session { viewer: string | null; generation: number }
interface Request extends Session {
  kind: 'request'; client: string; request: string; epoch: string;
  viewer: string; operation: DatabaseOperation; deadline: number;
}
type Message =
  | { kind: 'hello'; client: string; discovery: string }
  | { kind: 'leader'; term: Term; client?: string; discovery?: string }
  | { kind: 'session'; client: string; session: Session }
  | Request
  | { kind: 'response'; client: string; request: string; viewer: string; generation: number; epoch: string; result?: DatabaseResult; error?: string }
  | { kind: 'invalidate'; viewer: string; tables: string[]; epoch: string };
interface Pending {
  request: Request;
  sent: boolean;
  resolve: (result: DatabaseResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
interface BrokerOptions {
  id: string;
  channel: BrokerChannel;
  locks: BrokerLocks;
  dispatch: (viewer: string, operation: DatabaseOperation) => Promise<DatabaseResult>;
  onInvalidate: (viewer: string, tables: ReadonlySet<string> | null) => void;
  now?: () => number;
  timeoutMs?: number;
}

const accountChanged = () => new Error('The active account changed before this write could be saved');
const ownerChanged = () => new Error('The local notes connection changed before the operation was confirmed. Reopen the note to check it before retrying.');

/** All tabs, including the owner, enter the same viewer-scoped dispatcher. */
export function createDatabaseBroker({ id, channel, locks, dispatch, onInvalidate,
  now = Date.now, timeoutMs = DEFAULT_TIMEOUT_MS }: BrokerOptions) {
  let ownTerm: Term | null = null;
  let leader: Term | null = null;
  let current: Session = { viewer: null, generation: 0 };
  let sequence = 0;
  let discovery = '';
  let serial: Promise<unknown> = Promise.resolve();
  let stopped = false;
  const pending = new Map<string, Pending>();
  const sessions = new Map<string, Session>();
  const completed = new Map<string, Extract<Message, { kind: 'response' }>>();

  function emit(message: Message) {
    if (stopped) return;
    channel.postMessage({ protocol: PROTOCOL, ...message });
    receive(message);
  }
  function rejectPending(key: string, error: Error) {
    const item = pending.get(key);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(key);
    item.reject(error);
  }
  function sendPending() {
    if (!leader) return;
    for (const item of pending.values()) {
      if (item.sent) continue;
      item.request.epoch = leader.epoch;
      item.sent = true;
      emit(item.request);
    }
  }
  function discover() {
    discovery = `${id}:discovery:${++sequence}`;
    emit({ kind: 'hello', client: id, discovery });
  }
  function acceptLeader(term: Term) {
    const changed = leader?.epoch !== term.epoch;
    if (changed && leader) {
      for (const [key, item] of pending) if (item.sent) rejectPending(key, ownerChanged());
    }
    leader = term;
    if (changed && current.viewer) onInvalidate(current.viewer, null);
    sendPending();
  }
  function rememberSession(client: string, session: Session) {
    const previous = sessions.get(client);
    if (!previous || session.generation > previous.generation) sessions.set(client, session);
  }
  function assertSession(request: Request) {
    const known = sessions.get(request.client);
    if (!request.viewer || !known || known.generation !== request.generation || known.viewer !== request.viewer) {
      throw accountChanged();
    }
    if (now() > request.deadline) throw new Error('NOTED_BROKER_TIMEOUT: The local notes request expired before it could start.');
  }
  function respond(message: Extract<Message, { kind: 'response' }>) {
    completed.set(`${message.client}:${message.request}`, message);
    // Only duplicate delivery within one owner's lifetime is deduplicated.
    // An unanswered write is never replayed across an owner change.
    if (completed.size > 512) completed.delete(completed.keys().next().value!);
    emit(message);
  }
  function enqueueRequest(request: Request) {
    const term = ownTerm;
    if (!term) return;
    if (request.epoch !== term.epoch) { emit({ kind: 'leader', term }); return; }
    rememberSession(request.client, request);
    const execute = async () => {
      if (stopped) return;
      const cached = completed.get(`${request.client}:${request.request}`);
      if (cached) { emit(cached); return; }
      const response = {
        kind: 'response' as const, client: request.client, request: request.request,
        viewer: request.viewer, generation: request.generation, epoch: term.epoch,
      };
      try {
        assertSession(request);
        const result = await dispatch(request.viewer, request.operation);
        // Failed/rolled-back operations do not publish committed invalidations.
        const statements = request.operation.type === 'transaction'
          ? request.operation.statements.map(({ sql }) => sql) : [request.operation.sql];
        const changed = new Set(statements.flatMap((sql) => [...writtenTables(sql)]));
        if (changed.size) emit({ kind: 'invalidate', viewer: request.viewer, tables: [...changed], epoch: term.epoch });
        respond({ ...response, result });
      } catch (error) {
        respond({ ...response, error: error instanceof Error ? error.message : String(error) });
      }
    };
    serial = serial.then(execute, execute);
  }
  function receive(message: Message) {
    switch (message.kind) {
      case 'hello':
        if (ownTerm) emit({ kind: 'leader', term: ownTerm, client: message.client, discovery: message.discovery });
        break;
      case 'session':
        rememberSession(message.client, message.session);
        break;
      case 'leader': {
        // Announcements are hints. Only the live WebLock owner can answer the
        // latest discovery nonce, so delayed old announcements and wall-clock
        // changes never decide which document owns the database.
        if (!message.client) {
          if (message.term.epoch !== leader?.epoch) discover();
        } else if (message.client === id && message.discovery === discovery) {
          acceptLeader(message.term);
        }
        break;
      }
      case 'request':
        enqueueRequest(message);
        break;
      case 'response': {
        if (message.client !== id || message.epoch !== leader?.epoch) return;
        const item = pending.get(message.request);
        if (!item || item.request.epoch !== message.epoch) return;
        if (message.generation !== current.generation || message.viewer !== current.viewer) {
          rejectPending(message.request, accountChanged());
          return;
        }
        clearTimeout(item.timer);
        pending.delete(message.request);
        if (message.error !== undefined) item.reject(new Error(message.error));
        else item.resolve(message.result ?? []);
        break;
      }
      case 'invalidate':
        if (message.epoch === leader?.epoch) onInvalidate(message.viewer, new Set(message.tables));
        break;
    }
  }
  const listener = ({ data }: { data: unknown }) => {
    if (isMessage(data)) receive(data);
  };
  channel.addEventListener('message', listener);
  // No timeout ever steals this lock: a paused page still owns live OPFS
  // handles. Only document destruction permits another tab to acquire leadership.
  void locks.request(DATABASE_LEADER_LOCK, async () => {
    if (stopped) return;
    ownTerm = { id, epoch: `${id}:${now()}:${++sequence}`, startedAt: now() };
    acceptLeader(ownTerm);
    emit({ kind: 'leader', term: ownTerm });
    await new Promise<void>(() => undefined);
  }).catch((error: unknown) => {
    for (const key of pending.keys()) rejectPending(key, error instanceof Error ? error : new Error(String(error)));
  });
  discover();

  return {
    setSession(viewer: string | null, generation: number) {
      current = { viewer, generation };
      for (const [key, item] of pending) {
        if (item.request.viewer !== viewer || item.request.generation !== generation) rejectPending(key, accountChanged());
      }
      emit({ kind: 'session', client: id, session: current });
    },
    call(viewer: string, generation: number, operation: DatabaseOperation): Promise<DatabaseResult> {
      if (viewer !== current.viewer || generation !== current.generation) return Promise.reject(accountChanged());
      const request = `${id}:${++sequence}`;
      const promise = new Promise<DatabaseResult>((resolve, reject) => {
        const timer = setTimeout(() => rejectPending(request, new Error(
          'NOTED_BROKER_TIMEOUT: Another Noted tab is paused or the local notes connection is not responding. Bring that tab to the foreground or close it, then check the note before retrying.'
        )), timeoutMs);
        pending.set(request, { request: {
          kind: 'request', client: id, request, viewer, generation, operation,
          deadline: now() + timeoutMs, epoch: '',
        }, sent: false, resolve, reject, timer });
      });
      discover();
      sendPending();
      return promise;
    },
    refresh() {
      discover();
      if (current.viewer) onInvalidate(current.viewer, null);
    },
    /** Only for a destroyed transport/test. Does not release a live VFS lease. */
    disconnect() {
      stopped = true;
      channel.removeEventListener('message', listener);
      for (const key of pending.keys()) rejectPending(key, ownerChanged());
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}
function isSession(value: unknown): value is Session {
  return isRecord(value) && (value.viewer === null || typeof value.viewer === 'string') &&
    typeof value.generation === 'number' && Number.isInteger(value.generation) && value.generation >= 0;
}
function isMessage(value: unknown): value is Message {
  if (!isRecord(value) || value.protocol !== PROTOCOL) return false;
  const { kind } = value;
  if (kind === 'hello') return typeof value.client === 'string' && typeof value.discovery === 'string';
  if (kind === 'leader') return isRecord(value.term) && typeof value.term.id === 'string' &&
    typeof value.term.epoch === 'string' && typeof value.term.startedAt === 'number';
  if (kind === 'session') return typeof value.client === 'string' && isSession(value.session);
  if (kind === 'invalidate') return typeof value.viewer === 'string' && typeof value.epoch === 'string' &&
    Array.isArray(value.tables) && value.tables.every((table) => typeof table === 'string');
  if (kind !== 'request' && kind !== 'response') return false;
  if (typeof value.client !== 'string' || typeof value.request !== 'string' || typeof value.epoch !== 'string' ||
    !isSession(value) || typeof value.viewer !== 'string') return false;
  if (kind === 'response') return value.error === undefined || typeof value.error === 'string';
  if (typeof value.deadline !== 'number' || !isRecord(value.operation)) return false;
  const operation = value.operation;
  if (operation.type === 'execute') return typeof operation.sql === 'string' &&
    (operation.params === undefined || Array.isArray(operation.params));
  return operation.type === 'transaction' && Array.isArray(operation.statements) &&
    operation.statements.every((statement) => isRecord(statement) && typeof statement.sql === 'string');
}
