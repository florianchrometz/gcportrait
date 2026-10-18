// SPDX-License-Identifier: MIT
/**
 * The data worker's read of the tick cache (storage/tickCache.ts): a cached live tick by its key, through a
 * connection shared with its snapshot reader (storage/workerDatabase.ts, never the page's), opened on first use
 * and again after it was closed under the worker (another tab's schema upgrade). Without IndexedDB nothing is cached.
 */
import { OPEN_TIMEOUT_MS, type StoredTick } from '../../storage/db';
import { recoverWorkerDatabase, resetWorkerDatabase, workerDatabase } from '../../storage/workerDatabase';

/** Forgets the worker's shared connection and sets its next opens' timeout (tests replace IndexedDB). */
export function resetTickStoreDatabase(timeoutMs = OPEN_TIMEOUT_MS): void {
  resetWorkerDatabase(timeoutMs);
}

/** The cached tick under `key`, or undefined (none, or no IndexedDB, or a read that failed). */
export async function readCachedTick(key: string): Promise<StoredTick | undefined> {
  const opening = workerDatabase();
  const db = await opening;
  if (db === null) return undefined;
  try {
    return await db.get('tickCache', key);
  } catch {
    // The connection was closed under the worker: open a new one, once.
    const again = await recoverWorkerDatabase(opening);
    return again === null ? undefined : again.get('tickCache', key);
  }
}
