// SPDX-License-Identifier: MIT
/**
 * A fresh, empty IndexedDB (fake-indexeddb) for every test of a file, and the app's database opened in it, closed
 * again after the test. The test file itself imports `fake-indexeddb/auto` first, so the IndexedDB globals exist
 * before any module of the app is loaded. Imported by tests only.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach } from 'vitest';

import { openDatabase, type GcportraitDB } from '../storage/db';

/**
 * How long a test's database may take to open: the app gives up after OPEN_TIMEOUT_MS (storage/db.ts) and keeps its
 * state in memory, and a process held back that long on a loaded machine (or by a long render of the whole app) runs
 * the expired timer before the open's own steps, which fake-indexeddb schedules with setImmediate.
 */
export const TEST_OPEN_TIMEOUT_MS = 10_000;

export interface FreshIndexedDb {
  /** The app's database in this test's IndexedDB (`TEST_OPEN_TIMEOUT_MS` to open), closed after the test. */
  readonly database: () => Promise<GcportraitDB>;
  /** Runs `close` after the test, before the IndexedDB is dropped (a connection the test made itself). */
  readonly closeAfter: (close: () => unknown) => void;
}

/**
 * Forgets the snapshot loader's kept connection. The loader is imported only here, for the files that ask for it: it
 * brings in the diagram's data handler, the graph and the catalog, which the other files' tests never load.
 */
async function resetSnapshotLoader(): Promise<void> {
  const { resetStoredSnapshotDatabase } = await import('../snapshots/load');
  resetStoredSnapshotDatabase();
}

/**
 * Registers the hooks: before each test a new IndexedDB, after it every database opened here closed and the
 * file's IndexedDB back. `resetSnapshots` also forgets the snapshot loader's kept connection (snapshots/load.ts)
 * on both sides of each test.
 */
export function useFreshIndexedDb(options: { readonly resetSnapshots?: boolean } = {}): FreshIndexedDb {
  const realFactory = globalThis.indexedDB;
  const closing: (() => unknown)[] = [];
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    if (options.resetSnapshots === true) await resetSnapshotLoader();
  });
  afterEach(async () => {
    for (const close of closing.splice(0)) await close();
    globalThis.indexedDB = realFactory;
    if (options.resetSnapshots === true) await resetSnapshotLoader();
  });
  return {
    async database() {
      const db = await openDatabase(TEST_OPEN_TIMEOUT_MS);
      if (db === null) throw new Error('expected IndexedDB to open');
      closing.push(() => {
        db.close();
      });
      return db;
    },
    closeAfter(close) {
      closing.push(close);
    },
  };
}
