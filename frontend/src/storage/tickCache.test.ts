// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The tick cache in IndexedDB (fake-indexeddb): one entry per cache key, never shared across scopes; days before
 * the 35-day window dropped when a tick of the scope is stored; every scope's ticks listed and deleted one by one or
 * by scope (the Snapshots page); nothing kept of a tick whose read is cancelled before or while it is written;
 * nothing kept without IndexedDB; every change told to the other tabs by the entry's key alone (a stand-in for the
 * page's change signal), a write taken back told nothing; and the version-1 store, keyed by `[scope, readTime]`,
 * which holds no data, replaced by version 2's.
 */
import 'fake-indexeddb/auto';

import { openDB } from 'idb';
import { describe, expect, it, vi } from 'vitest';

import { useFreshIndexedDb } from '../test/indexedDb';
import { TICK_CONTENT_TYPE, tickCacheKey } from '../timeline/cacheKey';
import { DB_NAME, DB_VERSION, type StoredTick } from './db';
import { createTickCacheStore, staleTicks, TickWriteCancelled } from './tickCache';
import type { TickCacheChange, TickCacheChanges } from './tickCacheChanges';

const { database } = useFreshIndexedDb();

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

/** A stand-in for the page's change signal that keeps what the store tells the other tabs. */
function told(): { readonly changes: TickCacheChanges; readonly posted: TickCacheChange[] } {
  const posted: TickCacheChange[] = [];
  return {
    posted,
    changes: {
      post: (change) => {
        posted.push(change);
      },
      subscribe: () => () => undefined,
    },
  };
}

/** The change `change` of `entry` as the other tabs are told of it: the entry's key fields and nothing else. */
function change(kind: TickCacheChange['change'], entry: StoredTick): TickCacheChange {
  return {
    change: kind,
    key: entry.key,
    scope: entry.scope,
    readTime: entry.readTime,
    contentType: entry.contentType,
  };
}

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

  it('keeps nothing of a tick whose read is cancelled before or while it is written', async () => {
    const db = await database();
    const cache = createTickCacheStore(Promise.resolve(db));
    const transaction = db.transaction.bind(db);
    let abortOnWrite: AbortController | null = null;
    vi.spyOn(db, 'transaction').mockImplementation((...args: Parameters<typeof db.transaction>) => {
      const opened = transaction(...args);
      // The abort lands once the write's transaction is open.
      abortOnWrite?.abort();
      return opened;
    });
    const read = (entry: StoredTick): string => `${entry.day} ${entry.actualReadTime}`;
    const listed = async (): Promise<string[]> => (await cache.listScope(ORG)).map(read).sort();
    // The scope keeps a day about to leave the window and the latest day read at "now".
    await cache.put(tick(ORG, '2026-09-05'), '2026-10-08');
    const latest = tick(ORG, '2026-10-09', { now: true, actualReadTime: '2026-10-09T18:00:00Z' });
    await cache.put(latest, '2026-10-09');
    const kept = ['2026-09-05 2026-09-05T00:00:00Z', '2026-10-09 2026-10-09T18:00:00Z'];
    expect(await listed()).toEqual(kept);
    // A signal aborted before the write: nothing is written, and nothing dropped.
    const before = new AbortController();
    before.abort();
    for (const day of ['2026-10-01', '2026-10-09'])
      await expect(cache.put(tick(ORG, day), '2026-10-10', { signal: before.signal })).rejects.toBeInstanceOf(
        TickWriteCancelled,
      );
    expect(await listed()).toEqual(kept);
    // An abort that lands while a day is written: the day is taken back.
    abortOnWrite = new AbortController();
    await expect(
      cache.put(tick(ORG, '2026-10-01'), '2026-10-10', { signal: abortOnWrite.signal }),
    ).rejects.toBeInstanceOf(TickWriteCancelled);
    expect(await cache.get(tick(ORG, '2026-10-01').key)).toBeUndefined();
    // ... and while the day read at 00:00 replaces its "now" read: the "now" read is put back as it was. The day
    // that left the window stays dropped (it cannot be shown).
    abortOnWrite = new AbortController();
    await expect(
      cache.put(tick(ORG, '2026-10-09'), '2026-10-10', { signal: abortOnWrite.signal }),
    ).rejects.toBeInstanceOf(TickWriteCancelled);
    expect(await cache.get(latest.key)).toMatchObject({ now: true, actualReadTime: '2026-10-09T18:00:00Z' });
    expect(await listed()).toEqual(['2026-10-09 2026-10-09T18:00:00Z']);
    // Without a cancel the same days store: the cancelled writes left nothing in their way.
    abortOnWrite = null;
    await cache.put(tick(ORG, '2026-10-01'), '2026-10-10', { signal: new AbortController().signal });
    await cache.put(tick(ORG, '2026-10-09'), '2026-10-10', { signal: new AbortController().signal });
    expect(await listed()).toEqual(['2026-10-01 2026-10-01T00:00:00Z', '2026-10-09 2026-10-09T00:00:00Z']);
  });

  it('tells the other tabs of every tick it stores and every one it deletes, by the entry’s key alone', async () => {
    const { changes, posted } = told();
    const cache = createTickCacheStore(database(), { changes });
    const first = tick(ORG, '2026-10-01', { assetCount: 7 });
    await cache.put(first, '2026-10-10');
    expect(posted).toStrictEqual([change('put', first)]);
    for (const message of posted)
      expect(Object.keys(message).sort()).toEqual(['change', 'contentType', 'key', 'readTime', 'scope']);
    // A day dropped as past the window is told as deleted, before the tick that dropped it.
    const old = tick(ORG, '2026-09-05');
    await cache.put(old, '2026-10-08');
    const latest = tick(ORG, '2026-10-09', { now: true });
    posted.length = 0;
    await cache.put(latest, '2026-10-10');
    expect(posted).toStrictEqual([change('delete', old), change('put', latest)]);
    // The Snapshots page's deletes: one day (nothing told of a key that holds none), then a whole scope.
    posted.length = 0;
    await cache.remove(first.key);
    await cache.remove(first.key);
    expect(posted).toStrictEqual([change('delete', first)]);
    const folder = tick(FOLDER, '2026-10-02');
    await cache.put(folder, '2026-10-10');
    const second = tick(ORG, '2026-10-02');
    await cache.put(second, '2026-10-10');
    posted.length = 0;
    expect(await cache.removeScope(ORG)).toBe(2);
    expect(posted.map((message) => message.key).sort()).toEqual([latest.key, second.key].sort());
    expect(posted.every((message) => message.change === 'delete' && message.scope === ORG)).toBe(true);
  });

  it('tells nothing of a tick whose write is cancelled before or while it is made', async () => {
    const db = await database();
    const { changes, posted } = told();
    const cache = createTickCacheStore(Promise.resolve(db), { changes });
    const transaction = db.transaction.bind(db);
    let abortOnWrite: AbortController | null = null;
    vi.spyOn(db, 'transaction').mockImplementation((...args: Parameters<typeof db.transaction>) => {
      const opened = transaction(...args);
      abortOnWrite?.abort();
      return opened;
    });
    const latest = tick(ORG, '2026-10-09', { now: true, actualReadTime: '2026-10-09T18:00:00Z' });
    await cache.put(latest, '2026-10-09');
    posted.length = 0;
    const before = new AbortController();
    before.abort();
    await expect(
      cache.put(tick(ORG, '2026-10-01'), '2026-10-10', { signal: before.signal }),
    ).rejects.toBeInstanceOf(TickWriteCancelled);
    // Taken back: a new day, and a day that replaced its "now" read, which is put back as it was.
    for (const day of ['2026-10-01', '2026-10-09']) {
      abortOnWrite = new AbortController();
      await expect(
        cache.put(tick(ORG, day), '2026-10-10', { signal: abortOnWrite.signal }),
      ).rejects.toBeInstanceOf(TickWriteCancelled);
    }
    expect(posted).toStrictEqual([]);
    // A day the cancelled write dropped as past the window stays dropped, and that is told.
    abortOnWrite = null;
    const old = tick(ORG, '2026-09-05');
    await cache.put(old, '2026-10-08');
    posted.length = 0;
    abortOnWrite = new AbortController();
    await expect(
      cache.put(tick(ORG, '2026-10-01'), '2026-10-10', { signal: abortOnWrite.signal }),
    ).rejects.toBeInstanceOf(TickWriteCancelled);
    expect(posted).toStrictEqual([change('delete', old)]);
    expect(await cache.get(old.key)).toBeUndefined();
  });

  it('keeps nothing without IndexedDB', async () => {
    const { changes, posted } = told();
    const cache = createTickCacheStore(Promise.resolve(null), { changes });
    await expect(cache.put(tick(ORG, '2026-10-01'), '2026-10-10')).rejects.toThrow(/does not let gcportrait/);
    expect(await cache.listScope(ORG)).toEqual([]);
    expect(await cache.get('x')).toBeUndefined();
    expect(await cache.persistent()).toBe(false);
    expect(await cache.list()).toEqual([]);
    await cache.remove('x');
    expect(await cache.removeScope(ORG)).toBe(0);
    expect(posted).toStrictEqual([]);
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
