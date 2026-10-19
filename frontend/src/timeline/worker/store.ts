// SPDX-License-Identifier: Apache-2.0
/**
 * The data worker's read of the tick cache (storage/tickCache.ts): a cached live tick by its key, through a
 * connection shared with its snapshot reader (storage/workerDatabase.ts, never the page's), opened on first use
 * and again after it was closed under the worker (another tab's schema upgrade). Without IndexedDB nothing is cached.
 */
import type { StoredTick } from '../../storage/db';
import { recoverWorkerDatabase, workerDatabase } from '../../storage/workerDatabase';

/**
 * The cached tick under `key`, or undefined when absent or IndexedDB is unavailable. Opening errors propagate;
 * a failed read retries once, and a second failure propagates.
 */
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
