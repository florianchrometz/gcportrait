// SPDX-License-Identifier: MIT
/**
 * The data worker's read of the tick cache (storage/tickCache.ts): a cached live tick by its key, through a
 * connection of the worker's own (a worker cannot share the page's), opened on first use and again after it was
 * closed under the worker (another tab's schema upgrade). Without IndexedDB nothing is cached.
 */
import { openDatabase, type GcportraitDB, type StoredTick } from '../../storage/db';

let opening: Promise<GcportraitDB | null> | null = null;

function database(): Promise<GcportraitDB | null> {
  if (opening !== null) return opening;
  const next = openDatabase(undefined, () => {
    if (opening === next) opening = null;
  });
  opening = next;
  return next;
}

/** Forgets the open connection (tests replace IndexedDB between cases). */
export function resetTickStoreDatabase(): void {
  opening = null;
}

/** The cached tick under `key`, or undefined (none, or no IndexedDB, or a read that failed). */
export async function readCachedTick(key: string): Promise<StoredTick | undefined> {
  const db = await database();
  if (db === null) return undefined;
  try {
    return await db.get('tickCache', key);
  } catch {
    // The connection was closed under the worker: open a new one, once.
    opening = null;
    const again = await database();
    return again === null ? undefined : again.get('tickCache', key);
  }
}
