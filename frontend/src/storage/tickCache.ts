// SPDX-License-Identifier: MIT
/**
 * The timeline's tick cache (skill cai-ingestion §5): the ticks of live scopes read from Cloud Asset Inventory, in
 * IndexedDB's `tickCache` store (storage/db.ts), keyed by the tick's cache key (timeline/cacheKey.ts) so an entry
 * is never reused for another scope, read time, content type or type filter. The page writes them (the timeline
 * controller, after a read); the data worker reads one when the view names its tick (timeline/worker/source.ts).
 *
 * Ticks older than the timeline's 35 days cannot be shown and are dropped when a newer tick of the same scope is
 * stored (`staleTicks`). Without IndexedDB nothing is kept: the data worker could not read it, and a live snapshot
 * cannot exist without IndexedDB anyway (imports and pulls are refused then). The Snapshots page lists every cached
 * tick by scope and deletes one, or a whole scope's, to free storage (`list`, `remove`, `removeScope`).
 */
import { addDays, TIMELINE_DAYS } from '../timeline/ticks';
import { databaseOf, type DatabaseSource } from './connection';
import type { StoredTick } from './db';

export type { StoredTick } from './db';

export interface TickCacheStore {
  get(key: string): Promise<StoredTick | undefined>;
  /**
   * Stores a tick, replacing one under the same key, and drops the scope's ticks that lie before the 35-day window
   * ending `today` (the app's day).
   */
  put(tick: StoredTick, today: string): Promise<void>;
  /** The cached ticks of a scope (every key it has; a Blob is a handle, read only when asked). */
  listScope(scope: string): Promise<readonly StoredTick[]>;
  /** Whether ticks can be stored here (false without IndexedDB). */
  persistent(): Promise<boolean>;
}

/** What the Snapshots page does with the cache besides: list every scope's ticks, delete them. */
export interface TickCacheManager {
  /** Every cached tick, of every scope. */
  list(): Promise<readonly StoredTick[]>;
  /** Deletes the tick under `key`. */
  remove(key: string): Promise<void>;
  /** Deletes every cached tick of a scope (`organizations/123`); resolves to how many there were. */
  removeScope(scope: string): Promise<number>;
}

/** The ticks of `entries` whose day lies before the 35-day window that ends `today`. */
export function staleTicks<T extends Pick<StoredTick, 'key' | 'day'>>(
  entries: readonly T[],
  today: string,
): T[] {
  const oldest = addDays(today, -(TIMELINE_DAYS - 1));
  return entries.filter((entry) => entry.day < oldest);
}

export function createTickCacheStore(source: DatabaseSource): TickCacheStore & TickCacheManager {
  const database = databaseOf(source);
  return {
    async get(key) {
      const db = await database();
      if (db === null) return undefined;
      try {
        return await db.get('tickCache', key);
      } catch {
        return undefined;
      }
    },
    async put(tick, today) {
      const db = await database();
      if (db === null) throw new Error('This browser does not let gcportrait store the days it reads.');
      const transaction = db.transaction('tickCache', 'readwrite');
      const store = transaction.store;
      const kept = await store.index('byScope').getAll(tick.scope);
      for (const stale of staleTicks(kept, today)) await store.delete(stale.key);
      await store.put(tick);
      await transaction.done;
    },
    async listScope(scope) {
      const db = await database();
      if (db === null) return [];
      try {
        return await db.getAllFromIndex('tickCache', 'byScope', scope);
      } catch {
        return [];
      }
    },
    async persistent() {
      return (await database()) !== null;
    },
    async list() {
      const db = await database();
      if (db === null) return [];
      try {
        return await db.getAll('tickCache');
      } catch {
        return [];
      }
    },
    async remove(key) {
      const db = await database();
      if (db !== null) await db.delete('tickCache', key);
    },
    async removeScope(scope) {
      const db = await database();
      if (db === null) return 0;
      const transaction = db.transaction('tickCache', 'readwrite');
      const keys = await transaction.store.index('byScope').getAllKeys(scope);
      for (const key of keys) await transaction.store.delete(key);
      await transaction.done;
      return keys.length;
    },
  };
}
