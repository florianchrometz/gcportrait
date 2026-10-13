// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The tick cache in IndexedDB (fake-indexeddb): one entry per cache key, never shared across scopes; days before
 * the 35-day window dropped when a tick of the scope is stored; every scope's ticks listed and deleted one by one or
 * by scope (the Snapshots page); nothing kept without IndexedDB; and the version-1 store, keyed by
 * `[scope, readTime]`, which holds no data, replaced by version 2's.
 */
import 'fake-indexeddb/auto';

import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TICK_CONTENT_TYPE, tickCacheKey } from '../timeline/cacheKey';
import { DB_NAME, DB_VERSION, openDatabase, type GcportraitDB, type StoredTick } from './db';
import { createTickCacheStore, staleTicks } from './tickCache';

const realFactory = globalThis.indexedDB;
const open: GcportraitDB[] = [];

async function database(): Promise<GcportraitDB> {
  const db = await openDatabase();
  if (db === null) throw new Error('expected IndexedDB to open');
  open.push(db);
  return db;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  for (const db of open.splice(0)) db.close();
  globalThis.indexedDB = realFactory;
});

function tick(scope: string, day: string, extra: Partial<StoredTick> = {}): StoredTick {
  const readTime = `${day}T00:00:00Z`;
  return {
    key: tickCacheKey({ scope, readTime, contentType: TICK_CONTENT_TYPE }),
    scope,
    readTime,
    day,
    contentType: TICK_CONTENT_TYPE,
    now: false,
    actualReadTime: readTime,
    fetchedAt: '2026-10-10T12:00:00.000Z',
    assetCount: 3,
    bytes: 2,
    blob: new Blob(['{}'], { type: 'application/json' }),
    ...extra,
  };
}

const ORG = 'organizations/30000000001';
const FOLDER = 'folders/20000000001';

describe('the tick cache', () => {
  it('stores a tick under its cache key and lists a scope’s ticks only', async () => {
    const cache = createTickCacheStore(database());
    await cache.put(tick(ORG, '2026-10-01'), '2026-10-10');
    await cache.put(tick(FOLDER, '2026-10-01'), '2026-10-10');
    await cache.put(tick(ORG, '2026-10-02', { assetCount: 5 }), '2026-10-10');
    const key = tickCacheKey({
      scope: ORG,
      readTime: '2026-10-01T00:00:00Z',
      contentType: TICK_CONTENT_TYPE,
    });
    expect((await cache.get(key))?.day).toBe('2026-10-01');
    expect((await cache.listScope(ORG)).map((entry) => entry.day).sort()).toEqual([
      '2026-10-01',
      '2026-10-02',
    ]);
    expect((await cache.listScope(FOLDER)).map((entry) => entry.scope)).toEqual([FOLDER]);
    expect(
      await cache.get(
        tickCacheKey({ scope: ORG, readTime: '2026-10-03T00:00:00Z', contentType: 'RESOURCE' }),
      ),
    ).toBe(undefined);
    // The same key again replaces the entry.
    await cache.put(tick(ORG, '2026-10-01', { assetCount: 9 }), '2026-10-10');
    expect((await cache.get(key))?.assetCount).toBe(9);
    expect(await cache.persistent()).toBe(true);
  });

  it('drops the scope’s days before the 35-day window when a tick is stored', async () => {
    const cache = createTickCacheStore(database());
    await cache.put(tick(ORG, '2026-09-05'), '2026-10-08');
    await cache.put(tick(FOLDER, '2026-09-05'), '2026-10-08');
    await cache.put(tick(ORG, '2026-10-09'), '2026-10-10');
    expect((await cache.listScope(ORG)).map((entry) => entry.day)).toEqual(['2026-10-09']);
    // Another scope is not touched by this scope's store.
    expect((await cache.listScope(FOLDER)).map((entry) => entry.day)).toEqual(['2026-09-05']);
    expect(
      staleTicks([tick(ORG, '2026-09-06'), tick(ORG, '2026-09-05')], '2026-10-10').map((entry) => entry.day),
    ).toEqual(['2026-09-05']);
  });

  it('lists every scope’s ticks, and deletes one tick or a whole scope’s (the Snapshots page)', async () => {
    const cache = createTickCacheStore(database());
    await cache.put(tick(ORG, '2026-10-01'), '2026-10-10');
    await cache.put(tick(ORG, '2026-10-02'), '2026-10-10');
    await cache.put(tick(FOLDER, '2026-10-01'), '2026-10-10');
    expect((await cache.list()).map((entry) => `${entry.scope} ${entry.day}`).sort()).toEqual([
      `${FOLDER} 2026-10-01`,
      `${ORG} 2026-10-01`,
      `${ORG} 2026-10-02`,
    ]);
    await cache.remove(tick(ORG, '2026-10-01').key);
    expect((await cache.listScope(ORG)).map((entry) => entry.day)).toEqual(['2026-10-02']);
    expect(await cache.removeScope(FOLDER)).toBe(1);
    expect(await cache.removeScope(FOLDER)).toBe(0);
    expect((await cache.list()).map((entry) => entry.key)).toEqual([tick(ORG, '2026-10-02').key]);
  });

  it('keeps nothing without IndexedDB', async () => {
    const cache = createTickCacheStore(Promise.resolve(null));
    await expect(cache.put(tick(ORG, '2026-10-01'), '2026-10-10')).rejects.toThrow(/does not let gcportrait/);
    expect(await cache.listScope(ORG)).toEqual([]);
    expect(await cache.get('x')).toBeUndefined();
    expect(await cache.persistent()).toBe(false);
    expect(await cache.list()).toEqual([]);
    await cache.remove('x');
    expect(await cache.removeScope(ORG)).toBe(0);
  });

  it('replaces the version-1 store keyed by [scope, readTime], which holds no data, on upgrade', async () => {
    expect(DB_VERSION).toBe(2);
    const old = await openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('preferences');
        const snapshots = db.createObjectStore('snapshots', { keyPath: 'id' });
        snapshots.createIndex('byReadTime', 'meta.readTime');
        snapshots.createIndex('bySavedAt', 'meta.savedAt');
        db.createObjectStore('savedViews', { keyPath: 'id' }).createIndex('byUpdatedAt', 'updatedAt');
        db.createObjectStore('tickCache', { keyPath: ['scope', 'readTime'] }).createIndex('byScope', 'scope');
      },
    });
    await old.put('preferences', 'dark', 'theme');
    old.close();
    const db = await database();
    expect(db.version).toBe(2);
    const transaction = db.transaction(['tickCache', 'preferences']);
    expect(transaction.objectStore('tickCache').keyPath).toBe('key');
    expect([...transaction.objectStore('tickCache').indexNames]).toEqual(['byScope']);
    expect(await transaction.objectStore('preferences').get('theme')).toBe('dark');
    await transaction.done;
  });
});
