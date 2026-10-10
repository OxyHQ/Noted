/**
 * React binding for `lib/db/client.ts`: a query that re-runs whenever a table it
 * reads is written.
 *
 * It is built on `useSyncExternalStore` deliberately. SQLite is external mutable
 * state, and with the React Compiler enabled any read of it from a memoised
 * position is frozen at its first value forever — the store contract is what
 * makes the subscription the source of updates rather than the render pass.
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

import { type Row, subscribe, type Unsubscribe } from '@/lib/db/client';

import { useLocalStoreState } from '@/lib/db/local-store-context';

interface Snapshot<TRow> {
  rows: readonly TRow[];
  isLoading: boolean;
  error: string | null;
}

const EMPTY_ROWS: readonly never[] = [];

/**
 * One query's subscription and latest rows.
 *
 * The database subscription is opened by the first listener and closed by the
 * last, so a store for a query nobody renders never touches SQLite. React drives
 * both ends: when the SQL or its parameters change, the `subscribe` identity
 * changes, React unsubscribes from the old store and subscribes to the new one.
 */
class LiveQueryStore<TRow extends Row> {
  private readonly listeners = new Set<() => void>();
  private unsubscribeDb: Unsubscribe | null = null;
  private pendingUnsubscribe: Promise<Unsubscribe> | null = null;
  private snapshot: Snapshot<TRow> = {
    rows: EMPTY_ROWS,
    isLoading: true,
    error: null,
  };

  constructor(
    private readonly sql: string,
    private readonly params: readonly unknown[],
    private readonly enabled: boolean,
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1 && this.enabled) this.open();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.close();
    };
  };

  readonly getSnapshot = (): Snapshot<TRow> => this.snapshot;

  private open(): void {
    const pending = subscribe<TRow>(this.sql, this.params, {
      onData: (rows) => this.publish({ rows, isLoading: false, error: null }),
      onError: (error) => this.publish({ rows: EMPTY_ROWS, isLoading: false, error }),
    });
    this.pendingUnsubscribe = pending;
    void pending.then((unsubscribe) => {
      // The last listener may have left while the subscription was opening;
      // without this the query would keep refreshing for nobody.
      if (this.pendingUnsubscribe !== pending) {
        unsubscribe();
        return;
      }
      this.unsubscribeDb = unsubscribe;
    });
  }

  private close(): void {
    this.pendingUnsubscribe = null;
    this.unsubscribeDb?.();
    this.unsubscribeDb = null;
  }

  private publish(snapshot: Snapshot<TRow>): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

export interface LiveQueryResult<TData> {
  data: TData;
  isLoading: boolean;
  error: string | null;
}

/**
 * Subscribe to a SQL query.
 *
 * `mapRows` must be a stable function (module scope, or wrapped by the caller);
 * it re-runs only when the rows change, so it is the right place to parse JSON
 * columns and build the shape a screen renders.
 */
export function useLiveQuery<TRow extends Row, TData>(options: {
  sql: string;
  params?: readonly unknown[];
  mapRows: (rows: readonly TRow[]) => TData;
}): LiveQueryResult<TData> {
  const { sql, mapRows } = options;
  const { isReady, viewerId, error: storeError } = useLocalStoreState();
  const params = options.params ?? EMPTY_ROWS;

  // Parameters are values, not identities: a caller passing a fresh array of the
  // same ids each render must not resubscribe.
  const key = `${viewerId}:${isReady}\0${sql}\0${JSON.stringify(params)}`;
  const storeRef = useRef<{ key: string; store: LiveQueryStore<TRow> } | null>(null);
  if (storeRef.current?.key !== key) {
    storeRef.current = { key, store: new LiveQueryStore<TRow>(sql, params, isReady) };
  }
  const store = storeRef.current.store;

  const subscribeToStore = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store],
  );
  const snapshot = useSyncExternalStore(subscribeToStore, store.getSnapshot, store.getSnapshot);

  const data = useMemo(() => mapRows(snapshot.rows), [mapRows, snapshot.rows]);
  return { data, isLoading: isReady && snapshot.isLoading, error: storeError ?? snapshot.error };
}
