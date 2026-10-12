// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * Saved views in IndexedDB: saved under a name with the view's hash, listed newest first, renamed,
 * deleted, kept across a new connection (a reload), a taken name updated rather than doubled, and kept in memory
 * when IndexedDB is unavailable.
 */
import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { useFreshIndexedDb } from '../test/indexedDb';
import { cleanViewName, createSavedViewStore, MAX_VIEW_NAME } from './savedViewStore';

const { database } = useFreshIndexedDb();

/** A clock that moves a second per call, from a fixed day. */
function clock(): () => Date {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 9, 8, 12, 0, tick));
  };
}

function ids(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `view-${String(next)}`;
  };
}

describe('the saved-view store', () => {
  it('saves, lists newest first, renames and deletes, in IndexedDB', async () => {
    const store = createSavedViewStore(database(), { now: clock(), newId: ids() });
    const first = await store.save('  Networking   prod ', 'snapshot=demo:M&lens=networking');
    expect(first).toMatchObject({ replaced: false, persisted: true });
    expect(first.view).toEqual({
      id: 'view-1',
      name: 'Networking prod',
      viewSpecHash: 'snapshot=demo:M&lens=networking',
      createdAt: '2026-10-08T12:00:01.000Z',
      updatedAt: '2026-10-08T12:00:01.000Z',
    });
    await store.save('Web project', 'snapshot=demo:M&focus=project&focus.project=demo-web-1');
    expect((await store.list()).map((view) => view.name)).toEqual(['Web project', 'Networking prod']);

    const renamed = await store.rename('view-1', 'Prod networks');
    expect(renamed).toMatchObject({
      id: 'view-1',
      name: 'Prod networks',
      createdAt: '2026-10-08T12:00:01.000Z',
    });
    expect((await store.list()).map((view) => view.name)).toEqual(['Prod networks', 'Web project']);
    expect(await store.rename('nothing', 'x')).toBeNull();

    await store.remove('view-2');
    expect((await store.list()).map((view) => view.id)).toEqual(['view-1']);
  });

  it('keeps the views for the next visit (a new connection reads them back)', async () => {
    const store = createSavedViewStore(database(), { now: clock(), newId: ids() });
    await store.save('Kept', 'snapshot=demo:S&detail=all');
    const later = createSavedViewStore(database());
    expect(await later.list()).toEqual([
      expect.objectContaining({ name: 'Kept', viewSpecHash: 'snapshot=demo:S&detail=all' }),
    ]);
  });

  it('updates a view saved under the same name (ignoring case and spaces) instead of adding one', async () => {
    const store = createSavedViewStore(database(), { now: clock(), newId: ids() });
    await store.save('My view', 'snapshot=demo:S');
    const again = await store.save(' my VIEW ', 'snapshot=demo:M&lens=data');
    expect(again).toMatchObject({ replaced: true, view: { id: 'view-1', name: 'my VIEW' } });
    expect(await store.list()).toEqual([
      expect.objectContaining({ id: 'view-1', viewSpecHash: 'snapshot=demo:M&lens=data' }),
    ]);
  });

  it('refuses an empty name', async () => {
    const store = createSavedViewStore(database());
    await expect(store.save('   ', 'snapshot=demo:S')).rejects.toThrow('needs a name');
  });

  it('tells its listeners about every change', async () => {
    const store = createSavedViewStore(database(), { newId: ids() });
    let calls = 0;
    const stop = store.subscribe(() => {
      calls += 1;
    });
    await store.save('a', '');
    await store.rename('view-1', 'b');
    await store.remove('view-1');
    stop();
    await store.save('c', '');
    expect(calls).toBe(3);
  });

  it('keeps the views in memory for the session when IndexedDB is unavailable', async () => {
    const store = createSavedViewStore(Promise.resolve(null), { now: clock(), newId: ids() });
    const saved = await store.save('Session only', 'snapshot=demo:S');
    expect(saved.persisted).toBe(false);
    expect((await store.list()).map((view) => view.name)).toEqual(['Session only']);
    await store.remove('view-1');
    expect(await store.list()).toEqual([]);
  });

  it('cleans names: trimmed, single spaces, at most MAX_VIEW_NAME characters (never half a character)', () => {
    expect(cleanViewName('  a \n\t b  ')).toBe('a b');
    expect(cleanViewName('x'.repeat(200))).toHaveLength(MAX_VIEW_NAME);
    expect(cleanViewName(`${'x'.repeat(MAX_VIEW_NAME - 1)}👩‍💻 tail`)).toBe(
      `${'x'.repeat(MAX_VIEW_NAME - 1)}👩‍💻`,
    );
  });
});
