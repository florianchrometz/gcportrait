// @vitest-environment node
// SPDX-License-Identifier: MIT
import { generateOrganization, historyFor } from '@gcportrait/demo-data';
import { migrateSnapshot, type Snapshot } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { loadDemoSnapshot } from '../../diagram/pipeline/dataHandler';
import { preparedDemo } from '../../diagram/testing/demoData';
import { demoExportNdjson } from '../../import/fixtures';
import { bundleParts } from '../bundle';
import { decodeJson, plainBlob } from '../codec';
import { formatUtc } from '../labels';
import type { JobResult } from './client';
import { createSnapshotHandler, LISTED_PROBLEMS } from './handler';
import { createInProcessSnapshotWorker } from './inProcess';
import { DAMAGED_RECORD, type JobProgress, type SnapshotResponse } from './protocol';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function only(result: JobResult) {
  expect(result.snapshots).toHaveLength(1);
  const [prepared] = result.snapshots;
  if (prepared === undefined) throw new Error('one snapshot expected');
  return prepared;
}

async function snapshotOf(blob: Blob): Promise<Snapshot> {
  return migrateSnapshot(await decodeJson(blob));
}

const S_EXPORT = demoExportNdjson('S');

describe('the import job', () => {
  it('reads a Cloud Asset Inventory export, infers its scope and says the read time is estimated', async () => {
    const { client } = createInProcessSnapshotWorker();
    const stages: JobProgress[] = [];
    const result = await client.importFiles([new File([S_EXPORT], 'export.json')], (progress) =>
      stages.push(progress),
    );
    const prepared = only(result);
    const snapshot = await snapshotOf(prepared.blob);
    expect(prepared.id).toMatch(ULID);
    expect(prepared.id).toBe(snapshot.id);
    expect(snapshot.scope).toEqual({ kind: 'organization', id: '30000000001', displayName: 'example.com' });
    expect(snapshot.source).toEqual({ kind: 'export', detail: 'export.json' });
    expect(snapshot.readTimeSource).toBe('estimated-max-update-time');
    expect(snapshot.assets).toHaveLength(generateOrganization({ size: 'S' }).assets.length);
    expect(prepared.meta).toMatchObject({ source: 'export', detail: 'export.json', estimatedReadTime: true });
    expect(prepared.history).toBeUndefined();
    expect(result.warnings).toEqual([
      `The export does not say when it was taken, so its read time is the latest asset change, ${formatUtc(snapshot.readTime)}.`,
    ]);
    expect(result.warnings[0]).toMatch(/change, \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\.$/);
    expect(stages.at(0)).toEqual({ stage: 'read', done: 0, total: S_EXPORT.length });
    expect(stages.map((progress) => progress.stage)).toContain('check');
  });

  it('reads the files of one export together as one snapshot', async () => {
    const lines = S_EXPORT.trimEnd().split('\n');
    const half = Math.floor(lines.length / 2);
    const { client } = createInProcessSnapshotWorker();
    const prepared = only(
      await client.importFiles([
        new File([lines.slice(0, half).join('\n')], 'Instance.json'),
        new File([lines.slice(half).join('\n')], 'Rest.json'),
      ]),
    );
    const snapshot = await snapshotOf(prepared.blob);
    expect(snapshot.assets).toHaveLength(lines.length);
    expect(prepared.meta.detail).toBe('Instance.json, Rest.json');
  });

  it('leaves malformed lines out and lists the first ones', async () => {
    const bad = Array.from({ length: LISTED_PROBLEMS + 2 }, (_, index) => `not json ${String(index)}`);
    const { client } = createInProcessSnapshotWorker();
    const result = await client.importFiles([new File([`${bad.join('\n')}\n${S_EXPORT}`], 'export.ndjson')]);
    expect(result.warnings[0]).toBe(`${String(bad.length)} lines could not be read and were left out.`);
    // The count, the first problems, and the estimated read time.
    expect(result.warnings).toHaveLength(1 + LISTED_PROBLEMS + 1);
    const listed = result.warnings.slice(1, 1 + LISTED_PROBLEMS);
    listed.forEach((warning, index) => {
      expect(warning.startsWith(`export.ndjson, line ${String(index + 1)}: `)).toBe(true);
    });
  });

  it('fails without assets, with the problems it found', async () => {
    const { client } = createInProcessSnapshotWorker();
    await expect(
      client.importFiles([new File(['{"oops": true}\n[1]\n'], 'empty.json')]),
    ).rejects.toMatchObject({
      message: 'No assets were found in empty.json.',
      problems: [
        'empty.json, line 1: name: Invalid input: expected string, received undefined',
        'empty.json, line 2: Expected a JSON object, found an array.',
      ],
    });
  });

  it('imports a bundle under a new id, history included, next to an export', async () => {
    const { client } = createInProcessSnapshotWorker();
    const demo = await preparedDemo('S');
    if (demo.history === undefined) throw new Error('a demo carries its history');
    const bundle = new Blob(
      bundleParts('2026-10-10T00:00:00.000Z', await plainBlob(demo.blob), await plainBlob(demo.history)),
    );
    const result = await client.importFiles([
      new File([bundle], 'copy.json'),
      new File([S_EXPORT], 'export.json'),
    ]);
    expect(result.snapshots).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^The export does not say when it was taken/);
    const [fromBundle, fromExport] = result.snapshots;
    const original = await snapshotOf(demo.blob);
    expect(fromBundle?.id).toMatch(ULID);
    expect(fromBundle?.id).not.toBe(original.id);
    expect(fromBundle?.meta).toMatchObject({ source: 'demo', detail: 'copy.json', historyTicks: 35 });
    // The same snapshot, its document's id rewritten to the id it is stored under.
    expect(await snapshotOf(fromBundle?.blob ?? new Blob())).toEqual({ ...original, id: fromBundle?.id });
    expect(await decodeJson(fromBundle?.history ?? new Blob())).toEqual(historyFor('S'));
    expect(fromExport?.meta.source).toBe('export');
    expect(fromExport?.id).toMatch(ULID);
    expect(fromExport?.id).not.toBe(fromBundle?.id);
  });

  it('never stores a snapshot under an id it has had before, and notes the copies', async () => {
    const { client } = createInProcessSnapshotWorker();
    const bundleOf = async (size: 'S' | 'M', name: string): Promise<File> => {
      const demo = await preparedDemo(size);
      return new File([new Blob(bundleParts('2026-10-10T00:00:00.000Z', await plainBlob(demo.blob)))], name);
    };
    const small = await bundleOf('S', 'small.gcportrait.json');
    const medium = await bundleOf('M', 'medium.gcportrait.json');
    // Every demo organisation has the same deterministic id, so the two files carry the same one.
    const shared = (await loadDemoSnapshot('demo:S', () => undefined)).id;
    expect((await loadDemoSnapshot('demo:M', () => undefined)).id).toBe(shared);

    // Both in one import: each under a new id, and the note says the second file repeats the first one's id.
    const together = await client.importFiles([small, medium]);
    const [first, second] = together.snapshots;
    expect(first?.id).toMatch(ULID);
    expect(second?.id).toMatch(ULID);
    expect(new Set([shared, first?.id, second?.id]).size).toBe(3);
    expect(first?.meta.assetCount).not.toBe(second?.meta.assetCount);
    // The stored document carries the id it is stored under.
    expect((await snapshotOf(first?.blob ?? new Blob())).id).toBe(first?.id);
    expect((await snapshotOf(second?.blob ?? new Blob())).id).toBe(second?.id);
    expect(together.warnings).toEqual([
      'The snapshot in medium.gcportrait.json is also in another file of this import, so it was stored again as a separate copy.',
    ]);

    // The S file again, after its first copy was deleted (its id is free again): still a new id, so the ref of the
    // deleted copy never names another snapshot.
    const again = only(await client.importFiles([small], undefined, [second?.id ?? '']));
    expect(again.id).toMatch(ULID);
    expect([shared, first?.id, second?.id]).not.toContain(again.id);

    // A file exported from a stored copy carries that copy's id: the note says it is stored already.
    const copied = new File(
      [new Blob(bundleParts('2026-10-10T00:00:00.000Z', await plainBlob(second?.blob ?? new Blob())))],
      'medium-copy.gcportrait.json',
    );
    const copy = await client.importFiles([copied], undefined, [second?.id ?? '']);
    expect(only(copy).id).not.toBe(second?.id);
    expect((await snapshotOf(only(copy).blob)).assets).toHaveLength(second?.meta.assetCount ?? -1);
    expect(copy.warnings).toEqual([
      'The snapshot in medium-copy.gcportrait.json is already stored in this browser, so it was stored again as a ' +
        'separate copy.',
    ]);
  });

  it('says when the files of an import belong to different organisations', async () => {
    const other = JSON.stringify({
      name: '//storage.googleapis.com/projects/_/buckets/demo-other-bucket',
      assetType: 'storage.googleapis.com/Bucket',
      resource: { data: { name: 'demo-other-bucket' } },
      ancestors: ['projects/10000000099', 'organizations/30000000002'],
      updateTime: '2026-10-01T00:00:00Z',
    });
    const { client } = createInProcessSnapshotWorker();
    const result = await client.importFiles([
      new File([S_EXPORT], 'export.json'),
      new File([other], 'other.json'),
    ]);
    const snapshot = await snapshotOf(only(result).blob);
    expect(snapshot.scope.id).toBe('30000000001');
    expect(result.warnings[0]).toBe(
      'The files hold the assets of 2 different organisations or projects, so they are not one export. The snapshot ' +
        'takes the scope most of them share, example.com; import the files of each export on their own to keep ' +
        'them apart.',
    );
  });

  it('names the file whose bundle is broken', async () => {
    const { client } = createInProcessSnapshotWorker();
    await expect(
      client.importFiles([new File(['{"format":"gcportrait.snapshot","version":9}'], 'new.gcportrait.json')]),
    ).rejects.toThrow(/^new\.gcportrait\.json: The snapshot file uses version 9/);
  });
});

describe('the check job', () => {
  const plainDemo = async (size: 'S' | 'M') => {
    const { client } = createInProcessSnapshotWorker();
    const demo = await preparedDemo(size);
    if (demo.history === undefined) throw new Error('a demo carries its history');
    return { client, snapshot: await plainBlob(demo.blob), history: await plainBlob(demo.history) };
  };

  it('reads a whole record, snapshot and history, and stores nothing', async () => {
    const { client, snapshot, history } = await plainDemo('S');
    const stages: JobProgress['stage'][] = [];
    await expect(client.check(snapshot, history, (progress) => stages.push(progress.stage))).resolves.toBe(
      undefined,
    );
    expect(stages).toEqual(['check']);
    await expect(client.check(snapshot)).resolves.toBe(undefined);
  });

  it('refuses a damaged record, with the reason', async () => {
    const { client, snapshot, history } = await plainDemo('S');
    // Cut in the middle, yet starting and ending like a JSON object.
    const text = await snapshot.text();
    const cut = new Blob([`${text.slice(0, Math.floor(text.length / 2))}}`]);
    for (const broken of [cut, new Blob(['{"id":"x", "assets": [}'])])
      await expect(client.check(broken)).rejects.toMatchObject({
        message: DAMAGED_RECORD,
        problems: ['The snapshot is not valid JSON.'],
      });
    await expect(client.check(new Blob(['{"id":"x","assets":[]}']))).rejects.toMatchObject({
      message: DAMAGED_RECORD,
      problems: [expect.stringMatching(/./)],
    });
    await expect(client.check(snapshot, new Blob(['{"size":"S"}']))).rejects.toMatchObject({
      message: DAMAGED_RECORD,
      problems: ['The history has no valid size, seed or day.'],
    });
    // Demo S's history kept with demo M's snapshot.
    const medium = await plainDemo('M');
    await expect(medium.client.check(medium.snapshot, history)).rejects.toMatchObject({
      message: DAMAGED_RECORD,
      problems: [
        expect.stringMatching(/^The history does not belong to the snapshot: its last day holds 96 assets/),
      ],
    });
  });
});

describe('the handler', () => {
  it('answers a malformed request with an error', () => {
    const answers: SnapshotResponse[] = [];
    const handle = createSnapshotHandler((response) => answers.push(response));
    // The demo organisations are the data worker's (ADR 0029): this worker knows no `demo` request.
    handle({ type: 'demo', job: 4, size: 'S' });
    handle('nonsense');
    handle({ type: 'import', job: 5, files: [new Blob(['{}'])], now: 0, taken: [] });
    handle({ type: 'import', job: 6, files: [new File(['{}'], 'a.json')], now: 0, taken: [7] });
    handle({ type: 'check', job: 7, snapshot: '{}' });
    handle({ type: 'check', job: 8, snapshot: new Blob(['{}']), history: 'none' });
    // A typed read time must be a time.
    handle({
      type: 'import',
      job: 9,
      files: [new File(['{}'], 'a.json')],
      now: 0,
      taken: [],
      readTime: 'soon',
    });
    expect(answers).toEqual([
      { type: 'error', job: 4, message: 'unknown request "demo"', problems: [] },
      { type: 'error', job: -1, message: 'a request must be an object', problems: [] },
      { type: 'error', job: 5, message: 'unknown request "import"', problems: [] },
      { type: 'error', job: 6, message: 'unknown request "import"', problems: [] },
      { type: 'error', job: 7, message: 'a check names no stored documents', problems: [] },
      { type: 'error', job: 8, message: 'a check names no stored documents', problems: [] },
      { type: 'error', job: 9, message: 'unknown request "import"', problems: [] },
    ]);
  });
});
