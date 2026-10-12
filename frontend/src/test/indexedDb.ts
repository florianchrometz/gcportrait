// SPDX-License-Identifier: MIT
/**
 * A fresh, empty IndexedDB (fake-indexeddb) for every test of a file, and the app's database opened in it, closed
 * again after the test. The test file itself imports `fake-indexeddb/auto` first, so the IndexedDB globals exist
 * before any module of the app is loaded. Imported by tests only.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach } from 'vitest';

import { resetStoredSnapshotDatabase } from '../snapshots/load';
import { openDatabase, type GcportraitDB } from '../storage/db';

export interface FreshIndexedDb {
  /** The app's database in this test's IndexedDB, closed after the test. */
  readonly database: () => Promise<GcportraitDB>;
  /** Runs `close` after the test, before the IndexedDB is dropped (a connection the test made itself). */
  readonly closeAfter: (close: () => unknown) => void;
}

/**
 * Registers the hooks: before each test a new IndexedDB, after it every database opened here closed and the
 * file's IndexedDB back. `resetSnapshots` also forgets the snapshot loader's kept connection (snapshots/load.ts)
 * on both sides of each test.
 */
export function useFreshIndexedDb(options: { readonly resetSnapshots?: boolean } = {}): FreshIndexedDb {
  const realFactory = globalThis.indexedDB;
  const closing: (() => unknown)[] = [];
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    if (options.resetSnapshots === true) resetStoredSnapshotDatabase();
  });
  afterEach(async () => {
    for (const close of closing.splice(0)) await close();
    globalThis.indexedDB = realFactory;
    if (options.resetSnapshots === true) resetStoredSnapshotDatabase();
  });
  return {
    async database() {
      const db = await openDatabase();
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
