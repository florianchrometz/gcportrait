// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Extra ticks in the data worker, over IndexedDB through fake-indexeddb: `findStoredExtra`
 * (snapshots/load.ts) finds the stored snapshot an extra tick shows, the copy the bar lists (an export or a pull of
 * the timeline's scope read in that second, the one stored last), never another scope's, a demo's or the snapshot
 * itself; the tick source (timeline/worker/source.ts) resolves a view's extra tick to it on a history and on a live
 * scope alike; and through the data handler a view whose tick names it draws it (its read time, its assets,
 * `source.tick`), the details that follow read it, and once it is deleted the snapshot itself is drawn again.
 */
import 'fake-indexeddb/auto';

import { DEMO_TODAY, snapshotAt } from '@gcportrait/demo-data';
import type { Snapshot } from '@gcportrait/model';
import { IDBFactory } from 'fake-indexeddb';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadDemoSnapshot } from '../diagram/pipeline/dataHandler';
import { dataHarness } from '../diagram/testing/dataHarness';
import { demoSHistory, ingestDemoDay } from '../diagram/testing/demoData';
import { encodeJson } from '../snapshots/codec';
import { findStoredExtra, resetStoredSnapshotDatabase } from '../snapshots/load';
import { metaOf } from '../snapshots/worker/prepare';
import type { StoredSnapshot } from '../storage/db';
import { useFreshIndexedDb } from '../test/indexedDb';
import type { TimelineOwner } from './extraTicks';
import { createTickSource } from './worker/source';

const HISTORY = demoSHistory();
const OWNER: TimelineOwner = {
  ref: 'demo:S',
  scopePath: 'organizations/30000000001',
  readTime: `${DEMO_TODAY}T00:00:00Z`,
};
const EXTRA = '2026-10-01T14:30:00Z';

beforeAll(async () => {
  await import('../diagram/pipeline/demo');
  await import('./worker/replay');
});

const { database } = useFreshIndexedDb({ resetSnapshots: true });

/** Demo S's assets on `day`, read as an export of `scope` (by default its own) taken at `readTime`. */
function exported(day: string, readTime: string, scope?: Snapshot['scope']): Promise<Snapshot> {
  return ingestDemoDay(day, {
    readTime,
    source: { kind: 'export', detail: 'export.json' },
    origin: 'export-sidecar',
    now: '2026-10-10T12:00:00Z',
    ...(scope === undefined ? {} : { scope }),
  });
}

/** Stores `snapshot` as the record `id`, as the library does after an import. */
async function store(id: string, snapshot: Snapshot, savedAt: string): Promise<StoredSnapshot> {
  const blob = await encodeJson({ ...snapshot, id });
  const record: StoredSnapshot = {
    id,
    meta: { ...metaOf(snapshot, blob.size, 'export.json'), savedAt },
    blob,
  };
  await (await database()).put('snapshots', record);
  return record;
}

describe('the stored snapshot an extra tick shows', () => {
  it('is the copy stored last of the exports of the scope read in that second', async () => {
    const snapshot = await exported('2026-10-01', EXTRA);
    await store('01J0000000000000000000000E', snapshot, '2026-10-10T10:00:00.000Z');
    await store('01J0000000000000000000000F', snapshot, '2026-10-10T11:00:00.000Z');
    const found = await findStoredExtra(OWNER, EXTRA);
    if (found === null) throw new Error('no extra tick found');
    expect(found.version).toBe('01J0000000000000000000000F 2026-10-10T11:00:00.000Z');
    const loaded = await found.load();
    expect(loaded.id).toBe('01J0000000000000000000000F');
    expect(loaded.readTime).toBe(EXTRA);
    expect(loaded.assets).toHaveLength(snapshot.assets.length);
  });

  it('is none for a second nothing was read in, another scope’s export, a demo, or the snapshot itself', async () => {
    await store(
      '01J0000000000000000000000G',
      await exported('2026-10-01', EXTRA, { kind: 'organization', id: '30000000002' }),
      '2026-10-10T10:00:00.000Z',
    );
    expect(await findStoredExtra(OWNER, EXTRA)).toBeNull();
    expect(await findStoredExtra(OWNER, '2026-10-01T14:30:01Z')).toBeNull();
    const own = await exported('2026-10-01', EXTRA);
    await store('01J0000000000000000000000H', own, '2026-10-10T10:00:00.000Z');
    expect(
      await findStoredExtra({ ...OWNER, ref: '01J0000000000000000000000H', readTime: EXTRA }, EXTRA),
    ).toBeNull();
    // Without IndexedDB nothing is stored, so there is no extra tick.
    globalThis.indexedDB = undefined as unknown as IDBFactory;
    resetStoredSnapshotDatabase();
    expect(await findStoredExtra(OWNER, EXTRA)).toBeNull();
  });
});

describe('the tick source', () => {
  it('resolves a view’s extra tick to the stored snapshot, on a history and on a live scope alike', async () => {
    const snapshot = await exported('2026-10-01', EXTRA);
    await store('01J0000000000000000000000E', snapshot, '2026-10-10T10:00:00.000Z');
    const source = createTickSource({
      demoHistory: () => Promise.resolve(HISTORY),
      storedExtra: findStoredExtra,
    });
    const base = await loadDemoSnapshot('demo:S', () => undefined);
    const resolved = await source.resolve('demo:S', base, EXTRA);
    expect(resolved?.day).toBe(EXTRA);
    expect((await resolved?.load())?.readTime).toBe(EXTRA);
    expect(await source.resolve('demo:S', base, '2026-10-01T14:31:00Z')).toBeNull();
    // A live pull of the same scope: the export is one of its extra ticks too.
    const live = await exported(DEMO_TODAY, `${DEMO_TODAY}T09:00:00Z`);
    expect((await source.resolve('01J0000000000000000000000A', live, EXTRA))?.day).toBe(EXTRA);
    // Without a way to look them up, there are none.
    expect(await createTickSource().resolve('demo:S', base, EXTRA)).toBeNull();
  }, 30_000);
});

describe('a view on an extra tick in the data handler', () => {
  it('draws the stored export, the details follow it, and once it is deleted the snapshot itself', async () => {
    const snapshot = await exported('2026-10-01', EXTRA);
    await store('01J0000000000000000000000E', snapshot, '2026-10-10T10:00:00.000Z');
    const { scene, details } = dataHarness({
      ticks: createTickSource({ demoHistory: () => Promise.resolve(HISTORY), storedExtra: findStoredExtra }),
    });
    const drawn = await scene({ snapshot: 'demo:S', tick: EXTRA });
    expect(drawn.source).toMatchObject({
      ref: 'demo:S',
      tick: EXTRA,
      readTime: EXTRA,
      assets: snapshot.assets.length,
    });
    expect(drawn.scene.metadata.readTime).toBe(EXTRA);
    expect(drawn.source.timeline).toMatchObject({ kind: 'history', scopePath: 'organizations/30000000001' });

    // The details that name the extra tick read the export: a node that only it has is found.
    const own = new Set(snapshotAt(HISTORY, DEMO_TODAY).assets.map((asset) => asset.name));
    const onlyThen = snapshot.assets.find((asset) => !own.has(asset.name))?.name;
    if (onlyThen === undefined) throw new Error('demo S lost nothing between 1 and 8 October');
    expect(await details(onlyThen, EXTRA)).not.toBeNull();

    await (await database()).delete('snapshots', '01J0000000000000000000000E');
    const gone = await scene({ snapshot: 'demo:S', tick: EXTRA, lens: 'networking' });
    expect(gone.source.tick).toBeUndefined();
    expect(gone.source.readTime).toBe(`${DEMO_TODAY}T00:00:00Z`);
  }, 60_000);
});
