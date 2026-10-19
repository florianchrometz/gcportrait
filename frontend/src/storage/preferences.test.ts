// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';

import { useFreshIndexedDb } from '../test/indexedDb';
import { createMemoryPreferenceStore, createPreferenceStore, DRAWER_WIDTH } from './preferences';

const { database: openTracked } = useFreshIndexedDb();

describe('preferences', () => {
  it('reads and writes preferences in IndexedDB', async () => {
    const store = createPreferenceStore(openTracked());
    expect(await store.get('theme')).toBeUndefined();
    expect(await store.set('theme', 'dark')).toBe(true);
    expect(await store.get('theme')).toBe('dark');
  });

  it('keeps preferences in memory when database is unavailable', async () => {
    const store = createMemoryPreferenceStore();
    expect(await store.get('diagramOverlays')).toBeUndefined();
    expect(await store.set('diagramOverlays', false)).toBe(false);
    expect(await store.get('diagramOverlays')).toBe(false);
  });

  it('preserves in-memory fallback when db.put fails instead of shadowing with stale db value', async () => {
    const db = await openTracked();
    const store = createPreferenceStore(Promise.resolve(db));

    // First persist a theme in IndexedDB
    expect(await store.set('theme', 'light')).toBe(true);
    expect(await store.get('theme')).toBe('light');

    // Now simulate quota exceeded when setting to 'dark'
    const spy = vi.spyOn(db, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    expect(await store.set('theme', 'dark')).toBe(false);

    // get('theme') should return 'dark' (from memory fallback) even though db still has 'light'
    expect(await store.get('theme')).toBe('dark');

    // When db.put subsequently succeeds, preference is persisted and db is updated
    spy.mockRestore();
    expect(await store.set('theme', 'system')).toBe(true);
    expect(await store.get('theme')).toBe('system');
    expect(await db.get('preferences', 'theme')).toBe('system');
  });

  it('validates and clamps values through parsers', async () => {
    const db = await openTracked();
    const store = createPreferenceStore(Promise.resolve(db));
    await store.set('drawerWidth', 1000);
    expect(await store.get('drawerWidth')).toBe(DRAWER_WIDTH.max);

    // Corrupted entry in IndexedDB is ignored
    await db.put('preferences', 'invalid-theme', 'theme');
    expect(await store.get('theme')).toBeUndefined();
  });
});
