// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * A pulled snapshot stored through the snapshot library (`storePrepared`) lands in IndexedDB as any import
 * does, and the diagram's data worker reads it back.
 */
import 'fake-indexeddb/auto';

import { generateOrganization, toCaiAsset } from '@gcportrait/demo-data';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testAuth } from '../auth/testing';
import { createSnapshotLibrary, type SnapshotLibrary } from '../snapshots/library';
import { loadAnySnapshot } from '../snapshots/load';
import { SnapshotJobError } from '../snapshots/worker/client';
import type { GcportraitDB } from '../storage/db';
import { stubBackend } from '../test/backend';
import { useFreshIndexedDb } from '../test/indexedDb';
import type { ImportAction } from './progress';
import { runLivePull } from './run';
import { frames } from './testing';
import { inProcessImportWorker } from './worker/inProcess';

const { database, closeAfter } = useFreshIndexedDb({ resetSnapshots: true });
const ASSETS = generateOrganization({ size: 'S' }).assets.map(toCaiAsset);
const READ_TIME = '2026-10-10T11:59:58Z';

function library(db: Promise<GcportraitDB | null>): SnapshotLibrary {
  const created = createSnapshotLibrary({
    database: db,
    worker: null,
    now: () => new Date('2026-10-10T12:00:00Z'),
  });
  closeAfter(() => {
    created.dispose();
  });
  return created;
}

async function pull(target: SnapshotLibrary): Promise<{ ref: string | null; actions: ImportAction[] }> {
  const worker = inProcessImportWorker()();
  const actions: ImportAction[] = [];
  stubBackend({ otherwise: () => new Response(frames(ASSETS, { readTime: READ_TIME })) });
  const imported = await runLivePull(
    { auth: testAuth(), library: target, worker: () => Promise.resolve(worker.client) },
    { scope: { kind: 'organization', id: '30000000001' }, mode: 'user', quotaProject: 'demo-quota-1' },
    (action) => actions.push(action),
    new AbortController().signal,
  );
  return { ref: imported?.ref ?? null, actions };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a pulled snapshot in the library', () => {
  it('is stored in IndexedDB, listed, and read back by the diagram’s loader', async () => {
    const snapshots = library(database());
    const { ref } = await pull(snapshots);
    if (ref === null) throw new Error('the pull failed');
    const listed = await snapshots.list();
    expect(listed.map(({ record, persisted }) => [record.id, record.meta.source, persisted])).toEqual([
      [ref, 'api', true],
    ]);
    const loaded = await loadAnySnapshot(ref, () => undefined);
    expect(loaded.assets).toHaveLength(ASSETS.length);
    expect(loaded.readTimeSource).toBe('api');
    expect(loaded.readTime).toBe(READ_TIME);
  });

  it('is refused without browser storage, and the pull says so', async () => {
    const { ref, actions } = await pull(library(Promise.resolve(null)));
    expect(ref).toBeNull();
    const failed = actions.at(-1);
    expect(failed).toMatchObject({
      type: 'failed',
      failure: { title: 'This browser refused to store the snapshot.' },
    });
  });

  it('never replaces a stored snapshot with the same id', async () => {
    const snapshots = library(database());
    const { ref } = await pull(snapshots);
    const record = (await snapshots.list())[0]?.record;
    if (ref === null || record === undefined) throw new Error('the pull failed');
    await expect(
      snapshots.storePrepared({ id: record.id, meta: record.meta, blob: record.blob }),
    ).rejects.toBeInstanceOf(SnapshotJobError);
  });
});
