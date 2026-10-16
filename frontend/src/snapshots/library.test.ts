// @vitest-environment node
// SPDX-License-Identifier: MIT
import 'fake-indexeddb/auto';

import { generateOrganization, historyFor, toCaiNdjson } from '@gcportrait/demo-data';
import { migrateSnapshot, normalizeViewSpec } from '@gcportrait/model';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataError, loadDemoSnapshot } from '../diagram/pipeline/dataHandler';
import { prepareDemo } from '../diagram/pipeline/demo';
import type { DataResponse } from '../diagram/pipeline/protocol';
import { dataHarness, TEST_VIEWPORT } from '../diagram/testing/dataHarness';
import { preparedDemo } from '../diagram/testing/demoData';
import { demoExportNdjson } from '../import/fixtures';
import type { GcportraitDB } from '../storage/db';
import { useFreshIndexedDb } from '../test/indexedDb';
import { GZIP_TYPE, decodeJson } from './codec';
import {
  createSnapshotLibrary,
  type DemoPreparer,
  type ImportCandidate,
  type SnapshotLibrary,
} from './library';
import {
  loadAnySnapshot,
  loadStoredHistory,
  resetStoredSnapshotDatabase,
  storedSnapshotVersion,
} from './load';
import { createSnapshotRepository } from './repository';
import { storedRecord } from './testing';
import { SnapshotJobCancelled } from './worker/client';
import { createInProcessSnapshotWorker } from './worker/inProcess';
import { DAMAGED_RECORD, type JobProgress } from './worker/protocol';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const IMPORTED = '01J9Z3K5Q8XW2V4N6P7R8S9T0A';
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const { database, closeAfter } = useFreshIndexedDb({ resetSnapshots: true });

// Spies on a database or on IndexedDB's prototypes end with their test, even one that fails before its end.
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A library over `db` with the in-process snapshot worker. "Try the demo" takes the demo's record as the data worker
 * prepares it (demo.test.ts covers the job itself), prepared once for the file unless `demo` says otherwise.
 */
function library(
  db: Promise<GcportraitDB | null>,
  options: { readonly storage?: Pick<StorageManager, 'estimate'>; readonly demo?: DemoPreparer } = {},
): SnapshotLibrary {
  const created = createSnapshotLibrary({
    database: db,
    worker: createInProcessSnapshotWorker,
    demo: options.demo ?? ((size) => preparedDemo(size)),
    now: () => NOW,
    storage: options.storage,
  });
  closeAfter(() => {
    created.dispose();
  });
  return created;
}

/** A stored export record saved at `savedAt`. */
const record = (id: string, savedAt: string) => storedRecord(id, { source: 'export', savedAt });

describe('the repository', () => {
  it('lists, reads, replaces and deletes records in IndexedDB, the newest first', async () => {
    const repository = createSnapshotRepository(database());
    expect(await repository.persistent()).toBe(true);
    expect(await repository.put(record('demo:S', '2026-10-10T10:00:00Z'))).toBe(true);
    expect(await repository.put(record('demo:M', '2026-10-10T11:00:00Z'))).toBe(true);
    expect((await repository.list()).map(({ record: stored, persisted }) => [stored.id, persisted])).toEqual([
      ['demo:M', true],
      ['demo:S', true],
    ]);
    await repository.put(record('demo:S', '2026-10-10T12:00:00Z'));
    expect((await repository.list()).map(({ record: stored }) => stored.id)).toEqual(['demo:S', 'demo:M']);
    expect((await repository.get('demo:M'))?.meta.savedAt).toBe('2026-10-10T11:00:00Z');
    await repository.delete('demo:M');
    expect(await repository.get('demo:M')).toBeUndefined();
    await repository.clear();
    expect(await repository.list()).toEqual([]);
  });

  it('keeps records in memory for the session without IndexedDB', async () => {
    const repository = createSnapshotRepository(Promise.resolve(null));
    expect(await repository.persistent()).toBe(false);
    expect(await repository.put(record('demo:S', '2026-10-10T10:00:00Z'))).toBe(false);
    expect(await repository.list()).toEqual([
      { record: record('demo:S', '2026-10-10T10:00:00Z'), persisted: false },
    ]);
    await repository.clear();
    expect(await repository.list()).toEqual([]);
  });

  it('keeps a record in memory when IndexedDB refuses it (the quota), unless told not to', async () => {
    const db = await database();
    vi.spyOn(db, 'put').mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
    const repository = createSnapshotRepository(Promise.resolve(db));
    expect(await repository.put(record('demo:XL', '2026-10-10T10:00:00Z'))).toBe(false);
    expect((await repository.list()).map(({ persisted }) => persisted)).toEqual([false]);
    expect(await repository.get('demo:XL')).toBeDefined();
    expect(await repository.put(record(IMPORTED, '2026-10-10T10:00:00Z'), { inMemory: false })).toBe(false);
    expect(await repository.get(IMPORTED)).toBeUndefined();
    expect(await repository.ids()).toEqual(['demo:XL']);
  });

  it('lists the ids in IndexedDB and in memory', async () => {
    const db = await database();
    const repository = createSnapshotRepository(Promise.resolve(db));
    await repository.put(record(IMPORTED, '2026-10-10T10:00:00Z'));
    vi.spyOn(db, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await repository.put(record('demo:L', '2026-10-10T11:00:00Z'));
    expect((await repository.ids()).sort()).toEqual([IMPORTED, 'demo:L'].sort());
  });
});

describe('the library', () => {
  it('generates and stores a demo organisation, and tells its subscribers', async () => {
    const snapshots = library(database(), { demo: prepareDemo });
    const changes = vi.fn();
    snapshots.subscribe(changes);
    const stages: string[] = [];
    expect(await snapshots.tryDemo('S', (progress) => stages.push(progress.stage))).toEqual({
      ref: 'demo:S',
      persisted: true,
    });
    expect(stages.at(-1)).toBe('store');
    expect(changes).toHaveBeenCalledTimes(1);
    const [listed] = await snapshots.list();
    expect(listed?.record.id).toBe('demo:S');
    expect(listed?.record.meta.savedAt).toBe(NOW.toISOString());
    expect(migrateSnapshot(await decodeJson(listed?.record.blob ?? new Blob()))).toEqual(
      await loadDemoSnapshot('demo:S', () => undefined),
    );
  });

  it('exports a stored snapshot as a bundle that imports back to the same snapshot and history', async () => {
    const snapshots = library(database());
    await snapshots.tryDemo('S');
    const { blob, fileName } = await snapshots.exportFile('demo:S');
    expect(fileName).toBe('gcportrait_example.com_20261008T000000Z.gcportrait.json');
    expect(blob.type).toBe('application/json');
    const imported = await snapshots.importFiles([new File([blob], fileName)]);
    const original = await loadDemoSnapshot('demo:S', () => undefined);
    const [ref] = imported.refs;
    if (ref === undefined) throw new Error('one snapshot imported');
    expect(ref).toMatch(ULID);
    expect(ref).not.toBe(original.id);
    expect(imported.warnings).toEqual([]);
    const stored = (await snapshots.list()).map(({ record: item }) => item.id).sort();
    expect(stored).toEqual([ref, 'demo:S'].sort());
    // The same snapshot and history, stored under a new id (its document's id rewritten to match).
    expect(await loadAnySnapshot(ref, () => undefined)).toEqual({ ...original, id: ref });
    expect(await loadStoredHistory(ref)).toEqual(historyFor('S'));
  });

  it('stores every snapshot of an import under a new ref, and a re-import of a stored copy as one more copy', async () => {
    // The id policy itself (fresh ids, the notes for each kind of copy) is the snapshot worker's: handler.test.ts.
    // Here, that the library stores each snapshot the worker prepares under its own ref, lists each one, and never
    // replaces a copy stored before.
    const snapshots = library(database());
    await snapshots.tryDemo('S');
    await snapshots.tryDemo('M');
    const assets = async (ref: string): Promise<number> =>
      (await loadAnySnapshot(ref, () => undefined)).assets.length;
    const sizes = {
      S: (await loadDemoSnapshot('demo:S', () => undefined)).assets.length,
      M: (await loadDemoSnapshot('demo:M', () => undefined)).assets.length,
    };
    const together = await snapshots.importFiles([
      new File([(await snapshots.exportFile('demo:S')).blob], 'small.gcportrait.json'),
      new File([(await snapshots.exportFile('demo:M')).blob], 'medium.gcportrait.json'),
    ]);
    expect(together.refs).toHaveLength(2);
    expect(new Set(together.refs).size).toBe(2);
    for (const ref of together.refs) expect(ref).toMatch(ULID);
    expect(await Promise.all(together.refs.map(assets))).toEqual([sizes.S, sizes.M]);
    expect(await snapshots.list()).toHaveLength(4);
    const [copy] = together.refs;
    if (copy === undefined) throw new Error('two snapshots imported');
    // A file exported from a stored copy carries that copy's id: imported again, it is noted as a copy of it.
    const exported = await snapshots.exportFile(copy);
    const repeated = await snapshots.importFiles([new File([exported.blob], 'small-copy.gcportrait.json')]);
    expect(repeated.refs).toHaveLength(1);
    expect(together.refs).not.toContain(repeated.refs[0]);
    expect(repeated.warnings).toEqual([
      'The snapshot in small-copy.gcportrait.json is already stored in this browser, so it was stored again as a ' +
        'separate copy.',
    ]);
    expect(await snapshots.list()).toHaveLength(5);
    // The new copy holds its own snapshot, and the copies stored before it are unchanged.
    expect(await Promise.all([...together.refs, ...repeated.refs].map(assets))).toEqual([
      sizes.S,
      sizes.M,
      sizes.S,
    ]);
  });

  it('asks before it stores an import: no stores nothing, yes stores it once, under the ref it was asked about', async () => {
    const snapshots = library(database());
    const changes = vi.fn();
    snapshots.subscribe(changes);
    const file = (): File => new File([demoExportNdjson('S')], 'export.json');
    const steps: string[] = [];
    const asked: (readonly ImportCandidate[])[] = [];
    const answering =
      (yes: boolean) =>
      async (candidates: readonly ImportCandidate[]): Promise<boolean> => {
        asked.push(candidates);
        steps.push(`asked with ${String((await snapshots.list()).length)} stored`);
        return yes;
      };
    const onProgress = (progress: JobProgress): void => {
      if (progress.stage === 'store') steps.push('store');
    };
    expect(await snapshots.importFiles([file()], onProgress, { confirm: answering(false) })).toEqual({
      refs: [],
      records: [],
      warnings: [],
      declined: true,
    });
    expect(await snapshots.list()).toEqual([]);
    expect(changes).not.toHaveBeenCalled();
    // The same file again, and yes: stored once.
    const imported = await snapshots.importFiles([file()], onProgress, { confirm: answering(true) });
    expect(steps).toEqual(['asked with 0 stored', 'asked with 0 stored', 'store']);
    const [record] = imported.records;
    if (record === undefined) throw new Error('one snapshot imported');
    expect(imported.declined).toBeUndefined();
    expect(asked[1]).toEqual([{ ref: record.id, assets: record.meta.assetCount }]);
    expect(asked[0]?.map(({ assets }) => assets)).toEqual([record.meta.assetCount]);
    expect(imported.refs).toEqual([record.id]);
    expect((await snapshots.list()).map((listed) => listed.record.id)).toEqual([record.id]);
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('stores nothing of an import cancelled while it is read, asked about or stored', async () => {
    const db = await database();
    const snapshots = library(Promise.resolve(db));
    const changes = vi.fn();
    snapshots.subscribe(changes);
    const file = (): File => new File([demoExportNdjson('S')], 'export.json');
    const cancelled = async (
      abortAt: (controller: AbortController) => Parameters<SnapshotLibrary['importFiles']>[2],
      onProgress?: (progress: JobProgress, controller: AbortController) => void,
    ): Promise<void> => {
      const controller = new AbortController();
      const options = abortAt(controller);
      await expect(
        snapshots.importFiles([file()], (progress) => onProgress?.(progress, controller), {
          ...options,
          signal: controller.signal,
        }),
      ).rejects.toBeInstanceOf(SnapshotJobCancelled);
    };
    // While the worker reads the files.
    await cancelled(
      () => ({}),
      (progress, controller) => {
        if (progress.stage === 'read') controller.abort();
      },
    );
    // While the person is asked: their answer comes too late to store anything.
    await cancelled((controller) => ({
      confirm: () => {
        controller.abort();
        return Promise.resolve(true);
      },
    }));
    // While the snapshot is written: the record written is deleted again.
    const put = db.put.bind(db);
    const written: string[] = [];
    let abortOnPut: AbortController | null = null;
    vi.spyOn(db, 'put').mockImplementation(async (...args: Parameters<typeof db.put>) => {
      const key = await put(...args);
      written.push(key);
      abortOnPut?.abort();
      return key;
    });
    await cancelled((controller) => {
      abortOnPut = controller;
      return {};
    });
    expect(written).toHaveLength(1);
    // A signal aborted before the import starts reads nothing.
    const before = new AbortController();
    before.abort();
    await expect(
      snapshots.importFiles([file()], undefined, { signal: before.signal }),
    ).rejects.toBeInstanceOf(SnapshotJobCancelled);
    expect(await snapshots.list()).toEqual([]);
    expect(changes).not.toHaveBeenCalled();
    // The same file without a cancel is stored.
    abortOnPut = null;
    const { refs } = await snapshots.importFiles([file()], undefined, {
      signal: new AbortController().signal,
    });
    expect((await snapshots.list()).map((listed) => listed.record.id)).toEqual(refs);
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('does not store an import IndexedDB refuses, and says so', async () => {
    const db = await database();
    const snapshots = library(Promise.resolve(db));
    const changes = vi.fn();
    snapshots.subscribe(changes);
    vi.spyOn(db, 'put').mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
    const ndjson = toCaiNdjson(generateOrganization({ size: 'S' }).assets);
    await expect(snapshots.importFiles([new File([ndjson], 'list.json')])).rejects.toMatchObject({
      message:
        'This browser refused to store the snapshot: the space it allows this site may be full. Delete ' +
        'snapshots you no longer need, then import again.',
      problems: [expect.stringMatching(/^example\.com, read .* UTC, list\.json$/)],
    });
    expect(await snapshots.list()).toEqual([]);
    expect(changes).not.toHaveBeenCalled();
  });

  it('refuses to export a damaged record, with the reason, and the diagram says it is damaged', async () => {
    const db = await database();
    const snapshots = library(Promise.resolve(db));
    const damaged = async (blob: Blob, problem: string): Promise<void> => {
      await db.put('snapshots', { ...record(IMPORTED, '2026-10-10T10:00:00Z'), blob });
      await expect(snapshots.exportFile(IMPORTED)).rejects.toMatchObject({
        name: 'SnapshotJobError',
        message: DAMAGED_RECORD,
        problems: [problem],
      });
    };
    // Neither record has a history. A compressed blob that does not decompress fails the library's own read; a plain
    // blob that is not valid JSON passes it and is refused by the snapshot worker's check job (its other damage
    // cases are worker/handler.test.ts's).
    await damaged(new Blob(['not gzip'], { type: GZIP_TYPE }), 'The snapshot does not decompress.');
    await damaged(new Blob(['{"id":"x", "assets": [}']), 'The snapshot is not valid JSON.');
    await db.put('snapshots', { ...record(IMPORTED, '2026-10-10T10:00:00Z'), blob: new Blob(['{not json']) });
    await expect(loadAnySnapshot(IMPORTED, () => undefined)).rejects.toThrow(
      new DataError(
        'unknown-snapshot',
        `The snapshot "${IMPORTED}" stored in this browser is damaged and cannot be read. Delete it on the ` +
          'Snapshots page, then import or generate it again.',
      ),
    );
    await db.put('snapshots', { ...record(IMPORTED, '2026-10-10T10:00:00Z'), blob: new Blob(['{"id":1}']) });
    await expect(loadAnySnapshot(IMPORTED, () => undefined)).rejects.toThrow(
      new RegExp(`^The snapshot "${IMPORTED}" stored in this browser cannot be read: `),
    );
  });

  it('imports an export, which the data worker then loads from IndexedDB', async () => {
    const snapshots = library(database());
    const { refs, records } = await snapshots.importFiles([new File([demoExportNdjson('S')], 'export.json')]);
    const [ref] = refs;
    if (ref === undefined) throw new Error('one snapshot imported');
    expect(records[0]?.meta).toMatchObject({ source: 'export', estimatedReadTime: true });
    const stages: string[] = [];
    const loaded = await loadAnySnapshot(ref, (stage) => stages.push(stage));
    expect(loaded.id).toBe(ref);
    expect(stages).toEqual(['ingest']);
    expect(await loadStoredHistory(ref)).toBeNull();
  });

  it('removes one snapshot, or all', async () => {
    const snapshots = library(database());
    await snapshots.tryDemo('S');
    await snapshots.importFiles([
      new File([toCaiNdjson(generateOrganization({ size: 'S' }).assets)], 'list.json'),
    ]);
    expect(await snapshots.list()).toHaveLength(2);
    await snapshots.remove('demo:S');
    expect(await snapshots.list()).toHaveLength(1);
    await snapshots.clear();
    expect(await snapshots.list()).toEqual([]);
  });

  it('keeps the demo in memory without IndexedDB, and refuses imports there', async () => {
    const snapshots = library(Promise.resolve(null));
    expect(await snapshots.persistent()).toBe(false);
    expect(await snapshots.tryDemo('S')).toEqual({ ref: 'demo:S', persisted: false });
    expect((await snapshots.list()).map(({ persisted }) => persisted)).toEqual([false]);
    await expect(snapshots.importFiles([new File(['{}'], 'a.json')])).rejects.toThrow(
      /needs browser storage/,
    );
  });

  it('cannot generate without a worker', async () => {
    const idle = createSnapshotLibrary({ database: Promise.resolve(null), worker: null });
    expect(idle.canWork).toBe(false);
    await expect(idle.tryDemo('S')).rejects.toThrow(/no worker/);
  });

  it('reports the browser storage estimate when there is one', async () => {
    const estimate = vi.fn(() => Promise.resolve({ usage: 2_000_000, quota: 9_000_000_000 }));
    expect(await library(database(), { storage: { estimate } }).estimate()).toEqual({
      usage: 2_000_000,
      quota: 9_000_000_000,
    });
    expect(
      await library(database(), { storage: { estimate: () => Promise.reject(new Error('no')) } }).estimate(),
    ).toBeNull();
    expect(
      await createSnapshotLibrary({
        database: Promise.resolve(null),
        worker: null,
        storage: undefined,
      }).estimate(),
    ).toBeNull();
  });
});

describe('the data worker over stored snapshots', () => {
  /** The data worker reading stored snapshots: what it answers for a view of `ref` (a Scene or an error). */
  function dataWorker(): (ref: string) => Promise<DataResponse> {
    const { ask } = dataHarness({ loadSnapshot: loadAnySnapshot, snapshotVersion: storedSnapshotVersion });
    return (ref) =>
      ask({ type: 'scene', spec: normalizeViewSpec({ snapshot: ref }), viewport: TEST_VIEWPORT });
  }

  const assetsDrawn = (response: DataResponse): number | string =>
    response.type === 'scene' ? response.answer.source.assets : JSON.stringify(response);

  it('never draws a deleted snapshot from memory, nor another snapshot under its ref', async () => {
    const snapshots = library(database());
    await snapshots.tryDemo('S');
    await snapshots.tryDemo('M');
    const small = await snapshots.exportFile('demo:S');
    const medium = await snapshots.exportFile('demo:M');
    const draw = dataWorker();

    // Import M and draw it: the data worker keeps its Graph.
    const [mediumRef] = (await snapshots.importFiles([new File([medium.blob], 'medium.gcportrait.json')]))
      .refs;
    if (mediumRef === undefined) throw new Error('one snapshot imported');
    expect(assetsDrawn(await draw(mediumRef))).toBe(952);
    expect(assetsDrawn(await draw(mediumRef))).toBe(952);

    // Delete it: its ref draws nothing any more, as after a reload.
    await snapshots.remove(mediumRef);
    expect(await draw(mediumRef)).toMatchObject({
      type: 'error',
      error: { code: 'unknown-snapshot', message: `No snapshot "${mediumRef}" is stored in this browser.` },
    });

    // Import S (its file carries the same id as M's): a new ref, which draws S.
    const [smallRef] = (await snapshots.importFiles([new File([small.blob], 'small.gcportrait.json')])).refs;
    if (smallRef === undefined) throw new Error('one snapshot imported');
    expect(smallRef).not.toBe(mediumRef);
    expect(assetsDrawn(await draw(smallRef))).toBe(96);
    expect(await draw(mediumRef)).toMatchObject({ type: 'error' });
  });

  it("versions a stored record by when it was saved, and keeps the demo organisations' Graphs", async () => {
    const db = await database();
    expect(await storedSnapshotVersion('demo:M')).toBeNull();
    expect(await storedSnapshotVersion(IMPORTED)).toBe('missing');
    await db.put('snapshots', record(IMPORTED, '2026-10-10T10:00:00Z'));
    expect(await storedSnapshotVersion(IMPORTED)).toBe('2026-10-10T10:00:00Z');
  });
});

describe('the data worker loader', () => {
  /** A browser without IndexedDB (the next test gets its own again). */
  const withoutIndexedDb = (): void => {
    Reflect.deleteProperty(globalThis, 'indexedDB');
    resetStoredSnapshotDatabase();
  };

  it('generates the demo organisations without any storage', async () => {
    withoutIndexedDb();
    const stages: string[] = [];
    const snapshot = await loadAnySnapshot('demo:S', (stage) => stages.push(stage));
    expect(snapshot.source.detail).toBe('demo:S');
    expect(stages).toEqual(['generate', 'ingest']);
  });

  it('opens a new connection once when the one it kept was closed', async () => {
    const snapshots = library(database());
    const ndjson = toCaiNdjson(generateOrganization({ size: 'S' }).assets);
    const [ref] = (await snapshots.importFiles([new File([ndjson], 'list.json')])).refs;
    if (ref === undefined) throw new Error('one snapshot imported');
    await loadAnySnapshot(ref, () => undefined);
    const get = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(() => {
      throw new DOMException('The database connection is closing.', 'InvalidStateError');
    });
    expect((await loadAnySnapshot(ref, () => undefined)).id).toBe(ref);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('says when a snapshot is not stored, or cannot be', async () => {
    await database();
    await expect(loadAnySnapshot('01J9Z3K5Q8XW2V4N6P7R8S9T0A', () => undefined)).rejects.toThrow(
      new DataError(
        'unknown-snapshot',
        'No snapshot "01J9Z3K5Q8XW2V4N6P7R8S9T0A" is stored in this browser.',
      ),
    );
    withoutIndexedDb();
    await expect(loadAnySnapshot('01J9Z3K5Q8XW2V4N6P7R8S9T0A', () => undefined)).rejects.toThrow(
      /only the demo organisations can be opened/,
    );
  });
});
