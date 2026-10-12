// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The page's one IndexedDB connection: opened once for every store, and opened again after another tab's
 * schema upgrade closed it, so the preferences, the saved views and the snapshot library never stay on a closed
 * connection.
 */
import 'fake-indexeddb/auto';

import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { describe, expect, it, vi } from 'vitest';

import { useFreshIndexedDb } from '../test/indexedDb';
import { createSavedViewStore } from '../views/savedViewStore';
import { createDatabaseConnection, databaseOf } from './connection';
import { DB_NAME, DB_VERSION, openDatabase, type GcportraitDB } from './db';
import { createPreferenceStore } from './preferences';

useFreshIndexedDb();

describe('the page’s IndexedDB connection', () => {
  it('opens once for every caller', async () => {
    const open = vi.fn((onClose: () => void) => openDatabase(undefined, onClose));
    const connection = createDatabaseConnection(open);
    const [a, b] = await Promise.all([connection.database(), connection.database()]);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(open).toHaveBeenCalledTimes(1);
    a?.close();
  });

  it('opens again after another tab’s upgrade closed it, and every store reads through the new one', async () => {
    const connection = createDatabaseConnection();
    const preferences = createPreferenceStore(connection.database);
    const views = createSavedViewStore(connection.database);
    await preferences.set('theme', 'dark');
    const first = await connection.database();
    // Another tab asks for a newer schema: this tab's connection is closed under it (`blocking`)…
    const newer = await openDB(DB_NAME, DB_VERSION + 1);
    newer.close();
    // …and the next read opens again: the newer version refuses this tab's older schema, so the stores fall back
    // to memory instead of failing on a closed connection.
    const second = await connection.database();
    expect(second).not.toBe(first);
    expect(await preferences.get('theme')).toBe('dark');
    expect((await views.save('After the upgrade', 'snapshot=demo:S')).view.name).toBe('After the upgrade');
    expect((await views.list()).map((view) => view.name)).toEqual(['After the upgrade']);
  });

  it('treats a fixed promise as a source too (tests)', async () => {
    const db: GcportraitDB | null = null;
    const fixed = Promise.resolve(db);
    expect(await databaseOf(fixed)()).toBeNull();
    expect(databaseOf(() => fixed)()).toBe(fixed);
  });

  it('opens nothing when the IndexedDB getter itself throws', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      expect(await openDatabase()).toBeNull();
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        writable: true,
        value: new IDBFactory(),
      });
    }
  });
});
