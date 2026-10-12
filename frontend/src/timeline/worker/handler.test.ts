// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * A view's timeline tick through the data worker's handler (diagram/pipeline/dataHandler.ts): the day is
 * drawn (its read time and assets, `source.tick`), the snapshot's timeline comes with every Scene, the last day is
 * the snapshot itself, a day's Graph is built once and kept, and the requests after a Scene (details, search) read
 * the day they name, the day on screen, whatever Scene was built last. A live day not cached yet is drawn as
 * the snapshot itself until it is.
 */
import { diffSnapshots } from '@gcportrait/graph';
import { DEMO_TODAY, snapshotAt, toSnapshot } from '@gcportrait/demo-data';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadDemoSnapshot } from '../../diagram/pipeline/dataHandler';
import { dataHarness } from '../../diagram/testing/dataHarness';
import { demoSHistory, ingestDemoDay } from '../../diagram/testing/demoData';
import { encodeJson } from '../../snapshots/codec';
import type { StoredTick } from '../../storage/db';
import { storedTick } from '../testing/fixtures';
import { createTickSource } from './source';

beforeAll(async () => {
  await import('../../diagram/pipeline/demo');
  await import('./replay');
});

const HISTORY = demoSHistory();

describe('a demo organisation’s day', () => {
  it('is drawn with its read time and assets, and carries the timeline', async () => {
    const { scene } = dataHarness();
    const answer = await scene({ snapshot: 'demo:S', tick: '2026-09-17' });
    expect(answer.source).toMatchObject({
      ref: 'demo:S',
      tick: '2026-09-17',
      readTime: '2026-09-17T00:00:00Z',
      assets: snapshotAt(HISTORY, '2026-09-17').assets.length,
    });
    expect(answer.scene.metadata.readTime).toBe('2026-09-17T00:00:00Z');
    // The handler passes the tick source's timeline on; its exact shape is source.test.ts's. Its read time is the
    // snapshot's own, not the drawn day's: the handler builds it from the base snapshot.
    expect(answer.source.timeline).toMatchObject({
      kind: 'history',
      scopePath: 'organizations/30000000001',
      readTime: `${DEMO_TODAY}T00:00:00Z`,
    });
  }, 30_000);

  it('is the snapshot itself on the last day, and without a tick', async () => {
    const { scene } = dataHarness();
    const last = await scene({ snapshot: 'demo:S', tick: DEMO_TODAY });
    const none = await scene({ snapshot: 'demo:S' });
    expect(last.source.tick).toBeUndefined();
    expect(last.source.readTime).toBe(`${DEMO_TODAY}T00:00:00Z`);
    expect(last.scene).toEqual(none.scene);
  }, 30_000);

  it('is built once: a day drawn again is taken from the kept Graphs', async () => {
    const { scene, stages, lastId } = dataHarness();
    await scene({ snapshot: 'demo:S' });
    await scene({ snapshot: 'demo:S', tick: '2026-09-20' });
    expect(stages(lastId())).toEqual(['ingest', 'graph', 'scene']);
    await scene({ snapshot: 'demo:S', tick: '2026-09-21' });
    await scene({ snapshot: 'demo:S', tick: '2026-09-20', lens: 'networking' });
    expect(stages(lastId())).toEqual(['scene']);
  }, 30_000);

  it('is what the details that name it read, whatever Scene the worker built last', async () => {
    const { scene, details } = dataHarness();
    const before = toSnapshot(snapshotAt(HISTORY, '2026-09-10'));
    const after = toSnapshot(snapshotAt(HISTORY, DEMO_TODAY));
    const gone = diffSnapshots(before, after).removed[0];
    if (gone === undefined) throw new Error('nothing was removed in the history');
    await scene({ snapshot: 'demo:S', tick: '2026-09-10' });
    expect(await details(gone, '2026-09-10')).not.toBeNull();
    expect(await details(gone, null)).toBeNull();
    // The next day's Scene is built meanwhile (a step, playback): the day on screen is still what the details read.
    await scene({ snapshot: 'demo:S' });
    expect(await details(gone, '2026-09-10')).not.toBeNull();
    expect(await details(gone, null)).toBeNull();
  }, 30_000);
});

describe('a live snapshot’s day', () => {
  const REF = '01J0000000000000000000000A';
  const SCOPE = 'organizations/30000000001';
  const live = (day: string, readTime: string) =>
    ingestDemoDay(day, { readTime, source: { kind: 'api', detail: 'live pull' } });

  it('is the snapshot itself until the page has read it into the cache, then the day', async () => {
    const base = await live(DEMO_TODAY, `${DEMO_TODAY}T09:12:00Z`);
    const day = await live('2026-09-17', '2026-09-17T00:00:00Z');
    const cache = new Map<string, StoredTick>();
    const { scene } = dataHarness({
      loadSnapshot: (ref, onStage) => (ref === REF ? Promise.resolve(base) : loadDemoSnapshot(ref, onStage)),
      ticks: createTickSource({ readTick: (key) => Promise.resolve(cache.get(key)) }),
    });
    const waiting = await scene({ snapshot: REF, tick: '2026-09-17' });
    expect(waiting.source.tick).toBeUndefined();
    expect(waiting.source.readTime).toBe(base.readTime);
    expect(waiting.source.timeline).toEqual({
      kind: 'live',
      scope: base.scope,
      scopePath: SCOPE,
      readTime: base.readTime,
    });
    const cached = storedTick(SCOPE, '2026-09-17', {
      assetCount: day.assets.length,
      blob: await encodeJson(day),
    });
    cache.set(cached.key, cached);
    const drawn = await scene({ snapshot: REF, tick: '2026-09-17' });
    expect(drawn.source).toMatchObject({
      tick: '2026-09-17',
      readTime: cached.readTime,
      assets: day.assets.length,
    });
  }, 30_000);
});
