/** Browser tabs share one SQLite worker through the origin-wide database broker. */
import * as engine from './client-engine';
import { createDatabaseBroker, DATABASE_CHANNEL, type DatabaseOperation } from './web-store-broker';
import { readTables } from './sql-tables';
import type { Row, Statement, Unsubscribe } from './client-engine';
export type { Row, Statement, Unsubscribe } from './client-engine';

let activeViewerId: string | null = null;
let generation = 0;
let available = true;
let broker: ReturnType<typeof createDatabaseBroker> | null = null;
let viewerGate = deferred();
function deferred() {
  let resolve!: () => void;
  const gate = { settled: false, promise: new Promise<void>((done) => { resolve = done; }), resolve: () => { gate.settled = true; resolve(); } };
  return gate;
}
interface Subscription {
  sql: string; params: readonly unknown[]; viewer: string; generation: number;
  tables: Set<string>; active: boolean; version: number;
  onData: (rows: Row[]) => void; onError?: (message: string) => void;
}
const subscriptions = new Set<Subscription>();
const invalidated = new Set<Subscription>();
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function invalidate(viewer: string, tables: ReadonlySet<string> | null) {
  for (const subscription of subscriptions) {
    if (subscription.viewer !== viewer || subscription.generation !== generation || !subscription.active) continue;
    if (!tables || [...subscription.tables].some((table) => tables.has(table))) invalidated.add(subscription);
  }
  if (!refreshTimer && invalidated.size) refreshTimer = setTimeout(() => {
    refreshTimer = null;
    const refreshes = [...invalidated];
    invalidated.clear();
    for (const subscription of refreshes) void refresh(subscription);
  }, 10);
}

function getBroker() {
  if (broker) return broker;
  if (typeof BroadcastChannel === 'undefined' || typeof navigator === 'undefined' || !navigator.locks) {
    throw new Error('This browser does not support the local notes connection. Open Noted in a browser with Web Locks and BroadcastChannel support.');
  }
  broker = createDatabaseBroker({
    id: globalThis.crypto.randomUUID(),
    channel: new BroadcastChannel(DATABASE_CHANNEL),
    locks: navigator.locks,
    dispatch: async (viewer, operation) => {
      // This runs inside the broker's one queue for owner AND follower calls.
      // The owner tab's own account never determines another tab's database.
      await engine.setActiveViewer(viewer);
      return operation.type === 'transaction'
        ? engine.executeTransaction(operation.statements, viewer)
        : engine.execute(operation.sql, operation.params, viewer);
    },
    onInvalidate: invalidate,
  });
  broker.setSession(activeViewerId, generation);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') broker?.refresh();
  });
  if (typeof window !== 'undefined') window.addEventListener('pageshow', () => broker?.refresh());
  return broker;
}

function assertCurrent(viewer: string | null, expectedGeneration = generation): asserts viewer is string {
  if (!viewer || viewer !== activeViewerId || expectedGeneration !== generation) {
    throw new Error('The active account changed before this write could be saved');
  }
}
async function context(expected?: string | null) {
  if (expected !== undefined) {
    assertCurrent(expected);
    return { viewer: expected, generation };
  }
  while (!activeViewerId) await viewerGate.promise;
  return { viewer: activeViewerId, generation };
}
async function request(operation: DatabaseOperation, expected?: string | null): Promise<Row[] | number[]> {
  const owner = await context(expected);
  assertCurrent(owner.viewer, owner.generation);
  try {
    const result = await getBroker().call(owner.viewer, owner.generation, operation);
    assertCurrent(owner.viewer, owner.generation);
    available = true;
    return result;
  } catch (error) {
    // A SQL/CAS error belongs to that operation, not the whole local store.
    if (/NoModificationAllowedError|Invalid VFS state/.test(String(error))) available = false;
    throw error;
  }
}

export const isDbAvailable = (): boolean => available;
export const getActiveViewerId = (): string | null => activeViewerId;
export async function setActiveViewer(viewer: string): Promise<void> {
  if (activeViewerId !== viewer) {
    activeViewerId = viewer;
    generation++;
    available = true;
  }
  getBroker().setSession(viewer, generation);
  viewerGate.resolve();
}
export async function clearActiveViewer(): Promise<void> {
  activeViewerId = null;
  generation++;
  broker?.setSession(null, generation);
  if (viewerGate.settled) viewerGate = deferred();
}
/** Other tabs still use the worker; only document destruction closes its pool. */
export async function closeDb(): Promise<void> { broker?.refresh(); }

export async function execute<T extends Row = Row>(sql: string, params?: readonly unknown[], expectedViewerId?: string | null): Promise<T[]> {
  return await request({ type: 'execute', sql, params }, expectedViewerId) as T[];
}
export async function executeTransaction(statements: readonly Statement[], expectedViewerId?: string | null): Promise<number[]> {
  return await request({ type: 'transaction', statements }, expectedViewerId) as number[];
}
async function refresh(subscription: Subscription): Promise<void> {
  if (!subscription.active || subscription.viewer !== activeViewerId || subscription.generation !== generation) return;
  const version = ++subscription.version;
  try {
    const rows = await execute(subscription.sql, subscription.params, subscription.viewer);
    if (subscription.active && subscription.version === version && subscription.generation === generation) subscription.onData(rows);
  } catch (error) {
    if (subscription.active && subscription.version === version && subscription.generation === generation) {
      subscription.onError?.(error instanceof Error ? error.message : String(error));
    }
  }
}
export async function subscribe<T extends Row = Row>(sql: string, params: readonly unknown[], handlers: {
  onData: (rows: T[]) => void; onError?: (message: string) => void;
}): Promise<Unsubscribe> {
  const owner = await context();
  const subscription: Subscription = {
    sql, params, viewer: owner.viewer, generation: owner.generation,
    tables: readTables(sql), active: true, version: 0,
    onData: handlers.onData as (rows: Row[]) => void, onError: handlers.onError,
  };
  subscriptions.add(subscription);
  await refresh(subscription);
  return () => { subscription.active = false; subscriptions.delete(subscription); invalidated.delete(subscription); };
}
