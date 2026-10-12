// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The data worker's tick source (source.ts): a demo organisation's timeline is its history (the last day the
 * snapshot itself, every other day replayed and read as any export is, the same snapshot every time); a stored
 * snapshot's history comes from storage; any other snapshot is live: its own day is the snapshot, another day is
 * read from the tick cache under its key, absent until the page read it, and a damaged copy is said in a sentence.
 */
import { DEMO_TODAY, snapshotAt } from '@gcportrait/demo-data';
import type { Snapshot } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { loadDemoSnapshot } from '../../diagram/pipeline/dataHandler';
import { demoSHistory, ingestDemoDay } from '../../diagram/testing/demoData';
import { encodeJson } from '../../snapshots/codec';
import type { StoredTick } from '../../storage/db';
import { tickCacheKey } from '../cacheKey';
import { storedTick } from '../testing/fixtures';
import { createTickSource } from './source';

const HISTORY = demoSHistory();

async function demoBase(): Promise<Snapshot> {
  return loadDemoSnapshot('demo:S', () => undefined);
}

/** Demo S's assets on `day`, read as a live pull of the organisation at `readTime`. */
function liveSnapshot(day: string, readTime: string): Promise<Snapshot> {
  return ingestDemoDay(day, { readTime, source: { kind: 'api', detail: 'live pull' } });
}

describe('a demo organisation’s timeline', () => {
  it('is its history: 35 days ending on the demo’s day', async () => {
    const source = createTickSource({ demoHistory: () => Promise.resolve(HISTORY) });
    const info = await source.info('demo:S', await demoBase());
    expect(info).toEqual({
      kind: 'history',
      today: DEMO_TODAY,
      days: HISTORY.ticks.map((tick) => tick.tick),
      // The scope and read time its extra ticks are matched against.
      scopePath: 'organizations/30000000001',
      readTime: `${DEMO_TODAY}T00:00:00Z`,
    });
    expect(info.kind === 'history' ? info.days : []).toHaveLength(35);
  });

  it('draws the last day as the snapshot itself, and no day the history lacks', async () => {
    const source = createTickSource({ demoHistory: () => Promise.resolve(HISTORY) });
    const base = await demoBase();
    expect(await source.resolve('demo:S', base, DEMO_TODAY)).toBeNull();
    expect(await source.resolve('demo:S', base, '2026-01-01')).toBeNull();
  });

  it('replays another day as an export is read: that day’s assets, scope and read time, the same every time', async () => {
    const source = createTickSource({ demoHistory: () => Promise.resolve(HISTORY) });
    const base = await demoBase();
    const resolved = await source.resolve('demo:S', base, '2026-09-17');
    if (resolved === null) throw new Error('no day');
    const day = await resolved.load();
    expect(day.readTime).toBe('2026-09-17T00:00:00Z');
    expect(day.scope).toEqual(base.scope);
    expect(day.source).toEqual(base.source);
    expect(day.assets.map((asset) => asset.name)).toEqual(
      snapshotAt(HISTORY, '2026-09-17').assets.map((asset) => asset.name),
    );
    expect(await resolved.load()).toEqual(day);
    // The last day replayed is the snapshot the data worker draws for demo:S.
    const { historySnapshot } = await import('./replay');
    expect(await historySnapshot(HISTORY, DEMO_TODAY, base)).toEqual(base);
  }, 30_000);

  it('generates the history once per snapshot loaded', async () => {
    let generated = 0;
    const source = createTickSource({
      demoHistory: () => {
        generated += 1;
        return Promise.resolve(HISTORY);
      },
    });
    const base = await demoBase();
    await source.info('demo:S', base);
    await source.resolve('demo:S', base, '2026-09-20');
    await source.resolve('demo:S', base, '2026-09-21');
    expect(generated).toBe(1);
  });
});

describe('a stored snapshot with a history', () => {
  it('reads its history from storage', async () => {
    const asked: string[] = [];
    const source = createTickSource({
      storedHistory: (ref) => {
        asked.push(ref);
        return Promise.resolve(HISTORY);
      },
    });
    const base = await demoBase();
    const info = await source.info('01J0000000000000000000000A', base);
    expect(info.kind).toBe('history');
    expect(asked).toEqual(['01J0000000000000000000000A']);
  });
});

describe('a live snapshot’s timeline', () => {
  const READ = '2026-10-07T09:12:00Z';
  const SCOPE = 'organizations/30000000001';

  /** Day `day` of the organisation as the page read it into the tick cache. */
  async function cached(day: string): Promise<StoredTick> {
    const snapshot = await liveSnapshot(day, `${day}T00:00:00Z`);
    return storedTick(SCOPE, day, { assetCount: snapshot.assets.length, blob: await encodeJson(snapshot) });
  }

  it('is live: the scope, its name and the snapshot’s read time', async () => {
    const base = await liveSnapshot('2026-10-07', READ);
    const source = createTickSource({ storedHistory: () => Promise.resolve(null) });
    expect(await source.info('01J0000000000000000000000A', base)).toEqual({
      kind: 'live',
      scope: base.scope,
      scopePath: SCOPE,
      readTime: READ,
    });
  });

  it('draws its own day as the snapshot, a cached day from the cache under its key, and nothing else', async () => {
    const base = await liveSnapshot('2026-10-07', READ);
    const record = await cached('2026-10-01');
    const asked: string[] = [];
    const source = createTickSource({
      readTick: (key) => {
        asked.push(key);
        return Promise.resolve(key === record.key ? record : undefined);
      },
    });
    const ref = '01J0000000000000000000000A';
    expect(await source.resolve(ref, base, '2026-10-07')).toBeNull();
    expect(await source.resolve(ref, base, '2026-10-02')).toBeNull();
    const resolved = await source.resolve(ref, base, '2026-10-01');
    expect(asked).toEqual([
      tickCacheKey({ scope: SCOPE, readTime: '2026-10-02T00:00:00Z', contentType: 'RESOURCE' }),
      record.key,
    ]);
    expect(resolved?.version).toContain(record.fetchedAt);
    const day = await resolved?.load();
    expect(day?.readTime).toBe('2026-10-01T00:00:00Z');
    expect(day?.assets).toHaveLength(record.assetCount);
  }, 30_000);

  it('says so in a sentence when the cached copy cannot be read', async () => {
    const base = await liveSnapshot('2026-10-07', READ);
    const record = {
      ...(await cached('2026-10-01')),
      blob: new Blob(['not json'], { type: 'application/json' }),
    };
    const source = createTickSource({ readTick: () => Promise.resolve(record) });
    const resolved = await source.resolve('01J0000000000000000000000A', base, '2026-10-01');
    await expect(resolved?.load()).rejects.toThrow(/copy of 2026-10-01 kept in this browser cannot be read/);
  }, 30_000);
});
