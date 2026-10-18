// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import 'fake-indexeddb/auto';

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { useFreshIndexedDb } from '../test/indexedDb';
import { DB_NAME, DB_VERSION, openDatabase } from './db';
import { createMemoryPreferenceStore, createPreferenceStore } from './preferences';

// A fresh, empty IndexedDB for every test.
const { database: openTracked } = useFreshIndexedDb();

describe('openDatabase', () => {
  it('creates the versioned schema with all four stores', async () => {
    const db = await openTracked();
    expect(db.name).toBe(DB_NAME);
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(['preferences', 'savedViews', 'snapshots', 'tickCache']);
  });

  it('keys each store as documented', async () => {
    const db = await openTracked();
    const tx = db.transaction(['preferences', 'snapshots', 'savedViews', 'tickCache']);
    expect(tx.objectStore('preferences').keyPath).toBeNull();
    expect(tx.objectStore('snapshots').keyPath).toBe('id');
    expect([...tx.objectStore('snapshots').indexNames].sort()).toEqual(['byReadTime', 'bySavedAt']);
    expect(tx.objectStore('savedViews').keyPath).toBe('id');
    expect(tx.objectStore('tickCache').keyPath).toBe('key');
    expect([...tx.objectStore('tickCache').indexNames]).toEqual(['byScope']);
    await tx.done;
  });

  it('stores saved views by id', async () => {
    const db = await openTracked();
    const view = {
      id: 'v1',
      name: 'Networking overview',
      viewSpecHash: '#lens=networking',
      createdAt: '2026-10-08T00:00:00Z',
      updatedAt: '2026-10-08T00:00:00Z',
    };
    await db.put('savedViews', view);
    expect(await db.get('savedViews', 'v1')).toEqual(view);
  });

  it('reopens an existing database without running the migrations again', async () => {
    const first = await openTracked();
    await first.put('preferences', 'dark', 'theme');
    first.close();
    const second = await openTracked();
    expect(second.version).toBe(DB_VERSION);
    expect(await second.get('preferences', 'theme')).toBe('dark');
  });

  it('resolves to null when IndexedDB is missing', async () => {
    Reflect.deleteProperty(globalThis, 'indexedDB');
    expect(await openDatabase()).toBeNull();
  });

  it('resolves to null when opening throws (private windows)', async () => {
    const factory = new IDBFactory();
    factory.open = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    globalThis.indexedDB = factory;
    expect(await openDatabase()).toBeNull();
  });

  it('resolves to null when IndexedDB never answers', async () => {
    const factory = new IDBFactory();
    // A request whose events never fire.
    factory.open = () => ({}) as unknown as ReturnType<IDBFactory['open']>;
    globalThis.indexedDB = factory;
    expect(await openDatabase(20)).toBeNull();
  });
});

describe('preference store', () => {
  it('round-trips a preference through IndexedDB', async () => {
    const store = createPreferenceStore(openTracked());
    expect(await store.get('theme')).toBeUndefined();
    expect(await store.set('theme', 'dark')).toBe(true);
    expect(await store.get('theme')).toBe('dark');
  });

  it('persists across store instances (a reload)', async () => {
    await createPreferenceStore(openTracked()).set('theme', 'light');
    expect(await createPreferenceStore(openTracked()).get('theme')).toBe('light');
  });

  it('ignores a stored value that fails validation', async () => {
    const db = await openTracked();
    await db.put('preferences', 'purple', 'theme');
    expect(await createPreferenceStore(Promise.resolve(db)).get('theme')).toBeUndefined();
  });

  it('keeps values in memory when IndexedDB is unavailable', async () => {
    const store = createPreferenceStore(Promise.resolve(null));
    expect(await store.set('theme', 'dark')).toBe(false);
    expect(await store.get('theme')).toBe('dark');
  });

  it('falls back to memory when a write fails', async () => {
    const db = await openTracked();
    db.close();
    const store = createPreferenceStore(Promise.resolve(db));
    expect(await store.set('theme', 'light')).toBe(false);
    expect(await store.get('theme')).toBe('light');
  });

  it('starts empty as a memory-only store', async () => {
    expect(await createMemoryPreferenceStore().get('theme')).toBeUndefined();
  });
});
