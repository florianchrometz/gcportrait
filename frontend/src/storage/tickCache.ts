// SPDX-License-Identifier: Apache-2.0
/**
 * The timeline's tick cache (skill cai-ingestion §5): the ticks of live scopes read from Cloud Asset Inventory, in
 * IndexedDB's `tickCache` store (storage/db.ts), keyed by the tick's cache key (timeline/cacheKey.ts) so an entry
 * is never reused for another scope, read time, content type or type filter. The page writes them (the timeline
 * controller, after a read); the data worker reads one when the view names its tick (timeline/worker/source.ts).
 *
 * Ticks older than the timeline's 35 days cannot be shown and are dropped when a newer tick of the same scope is
 * stored (`staleTicks`). A write takes the read's signal, so a read the timeline cancels keeps nothing: aborted
 * before the write, nothing is written; aborted while it is written, the tick is taken back and the entry it
 * replaced, if any, put back; either way it rejects with `TickWriteCancelled`. Without IndexedDB nothing is kept:
 * the data worker could not read it, and a live snapshot cannot exist without IndexedDB anyway (imports and pulls
 * are refused then). The Snapshots page lists every cached tick by scope and deletes one, or a whole scope's, to
 * free storage (`list`, `remove`, `removeScope`).
 *
 * Every change is told to the other tabs of this browser (storage/tickCacheChanges.ts), by the entry's key alone:
 * a tick once its write stands (a write taken back tells nothing), and each entry deleted, the days dropped as past
 * the window included, so their timelines mark the day read or not read at once.
 */
import { addDays, TIMELINE_DAYS } from '../timeline/ticks';
import { databaseOf, type DatabaseSource } from './connection';
import type { StoredTick } from './db';
import { tickCacheChange, tickCacheChanges, type TickCacheChanges } from './tickCacheChanges';

export type { StoredTick } from './db';

/** A tick's write was cancelled (its read's signal aborted): nothing of it is kept. */
export class TickWriteCancelled extends Error {
  override readonly name = 'TickWriteCancelled';
  constructor() {
    super('The day was not stored: its read was cancelled.');
  }
}

export interface TickWriteOptions {
  /**
   * The read's signal: aborted before the write, nothing is written; aborted while it is written, the tick is taken
   * back and the entry it replaced put back. Either way the write rejects with {@link TickWriteCancelled}.
   */
  readonly signal?: AbortSignal;
}

export interface TickCacheStore {
  get(key: string): Promise<StoredTick | undefined>;
  /**
   * Stores a tick, replacing one under the same key, and drops the scope's ticks that lie before the 35-day window
   * ending `today` (the app's day); tells the other tabs of both. An aborted `options.signal` keeps nothing of the
   * tick, tells nothing of it and rejects with {@link TickWriteCancelled}.
   */
  put(tick: StoredTick, today: string, options?: TickWriteOptions): Promise<void>;
  /** The cached ticks of a scope (every key it has; a Blob is a handle, read only when asked). */
  listScope(scope: string): Promise<readonly StoredTick[]>;
}

/** What the Snapshots page does with the cache besides: list every scope's ticks, delete them. */
export interface TickCacheManager {
  /** Every cached tick, of every scope. */
  list(): Promise<readonly StoredTick[]>;
  /** Deletes the tick under `key` (and tells the other tabs, when there was one). */
  remove(key: string): Promise<void>;
  /** Deletes every cached tick of a scope (`organizations/123`); resolves to how many there were. */
  removeScope(scope: string): Promise<number>;
}

/** Throws {@link TickWriteCancelled} once `signal` is aborted: a cancelled read writes nothing. */
function stopIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new TickWriteCancelled();
}

/** The ticks of `entries` whose day lies before the 35-day window that ends `today`. */
export function staleTicks<T extends Pick<StoredTick, 'key' | 'day'>>(
  entries: readonly T[],
  today: string,
): T[] {
  const oldest = addDays(today, -(TIMELINE_DAYS - 1));
  return entries.filter((entry) => entry.day < oldest);
}

export interface TickCacheStoreOptions {
  /** Where the store tells the other tabs what it changed (default: the page's, `tickCacheChanges()`). */
  readonly changes?: TickCacheChanges;
}

export function createTickCacheStore(
  source: DatabaseSource,
  options: TickCacheStoreOptions = {},
): TickCacheStore & TickCacheManager {
  const database = databaseOf(source);
  const changes = options.changes ?? tickCacheChanges();
  const deleted = (entries: readonly StoredTick[]): void => {
    for (const entry of entries) changes.post(tickCacheChange('delete', entry));
  };
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
    async put(tick, today, options) {
      const signal = options?.signal;
      stopIfCancelled(signal);
      const db = await database();
      if (db === null) throw new Error('This browser does not let gcportrait store the days it reads.');
      stopIfCancelled(signal);
      const transaction = db.transaction('tickCache', 'readwrite');
      const store = transaction.store;
      const kept = await store.index('byScope').getAll(tick.scope);
      const stale = staleTicks(kept, today);
      for (const entry of stale) await store.delete(entry.key);
      await store.put(tick);
      await transaction.done;
      // The days dropped as past the window stay dropped, whatever becomes of the tick.
      deleted(stale);
      if (signal?.aborted === true) {
        // Cancelled while it was written: the tick is taken back, and what it replaced put back (the days dropped
        // as past the window stay dropped: they cannot be shown).
        const replaced = kept.find((entry) => entry.key === tick.key);
        if (replaced === undefined) await db.delete('tickCache', tick.key);
        else await db.put('tickCache', replaced);
        throw new TickWriteCancelled();
      }
      changes.post(tickCacheChange('put', tick));
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
      if (db === null) return;
      const transaction = db.transaction('tickCache', 'readwrite');
      const entry = await transaction.store.get(key);
      if (entry !== undefined) await transaction.store.delete(key);
      await transaction.done;
      if (entry !== undefined) deleted([entry]);
    },
    async removeScope(scope) {
      const db = await database();
      if (db === null) return 0;
      const transaction = db.transaction('tickCache', 'readwrite');
      const entries = await transaction.store.index('byScope').getAll(scope);
      for (const entry of entries) await transaction.store.delete(entry.key);
      await transaction.done;
      deleted(entries);
      return entries.length;
    },
  };
}
