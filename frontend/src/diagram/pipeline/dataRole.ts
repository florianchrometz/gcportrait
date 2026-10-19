// SPDX-License-Identifier: Apache-2.0
/**
 * The data role of the diagram worker (diagram.worker.ts): the data handler of protocol.ts, loading demo
 * organisations and the snapshots stored in IndexedDB (snapshots/load.ts), whose kept Graph it reuses only
 * while the record is still stored as it was (`storedSnapshotVersion`), and their timeline days: a stored
 * history's, and a live scope's read into the tick cache (timeline/worker/), and their extra ticks: the
 * exports and pulls of the same scope stored in IndexedDB.
 */
import {
  findStoredExtra,
  loadAnySnapshot,
  loadStoredHistory,
  storedSnapshotVersion,
} from '../../snapshots/load';
import { createTickSource } from '../../timeline/worker/source';
import { readCachedTick } from '../../timeline/worker/store';
import { createDataHandler } from './dataHandler';
import type { DataResponse } from './protocol';

export function startRole(post: (message: DataResponse) => void): (message: unknown) => void {
  return createDataHandler(post, {
    loadSnapshot: loadAnySnapshot,
    snapshotVersion: storedSnapshotVersion,
    ticks: createTickSource({
      storedHistory: loadStoredHistory,
      readTick: readCachedTick,
      storedExtra: findStoredExtra,
    }),
  });
}
