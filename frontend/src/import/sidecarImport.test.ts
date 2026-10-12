// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * Dropped export files with their operation.json go through the Snapshots page's import, which reads the
 * sidecar (sidecar.ts) for the read time and the scope. Without it, a read time the person typed is the
 * snapshot's (`readTimeSource: user`, no estimate); with both, the sidecar's wins and a note says so; a read time
 * later than the import's clock is noted (the timeline shows such a snapshot at the present).
 */
import { migrateSnapshot } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { preparedDemo } from '../diagram/testing/demoData';
import { bundleParts } from '../snapshots/bundle';
import { decodeJson, plainBlob } from '../snapshots/codec';
import { SnapshotJobError } from '../snapshots/worker/client';
import { createInProcessSnapshotWorker } from '../snapshots/worker/inProcess';
import { demoExportNdjson, operationJson } from './fixtures';

const EXPORT = demoExportNdjson('S');
const READ_TIME = '2026-10-08T06:00:01.5Z';
/**
 * The operation.json of an export of a folder, read at `readTime`, with only the fields the sidecar reads (no content
 * type, no output config): the import needs nothing more.
 */
const folderOperation = (readTime = READ_TIME): string =>
  operationJson({
    name: 'folders/20000000001/operations/ExportAssets/RESOURCE/42',
    metadata: { parent: 'folders/20000000001', contentType: undefined, outputConfig: undefined },
    response: { readTime, outputConfig: undefined },
  });
const OPERATION = folderOperation();

describe('the operation.json sidecar among dropped files', () => {
  it('gives the imported export its read time and scope', async () => {
    const { client } = createInProcessSnapshotWorker();
    const result = await client.importFiles([
      new File([EXPORT], 'export.json'),
      new File([OPERATION], 'operation.json'),
    ]);
    expect(result.snapshots).toHaveLength(1);
    const prepared = result.snapshots[0];
    if (prepared === undefined) throw new Error('no snapshot');
    const snapshot = migrateSnapshot(await decodeJson(prepared.blob));
    expect(snapshot.readTime).toBe(READ_TIME);
    expect(snapshot.readTimeSource).toBe('export-sidecar');
    expect(snapshot.scope).toEqual({ kind: 'folder', id: '20000000001' });
    expect(snapshot.source).toEqual({ kind: 'export', detail: 'export.json' });
    expect(prepared.meta.estimatedReadTime).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('reads a file named like the sidecar that is not one as part of the export', async () => {
    const { client } = createInProcessSnapshotWorker();
    const lines = EXPORT.trimEnd().split('\n');
    const result = await client.importFiles([
      new File([lines.slice(0, 10).join('\n')], 'operation-part.json'),
      new File([lines.slice(10).join('\n')], 'rest.json'),
    ]);
    const prepared = result.snapshots[0];
    if (prepared === undefined) throw new Error('no snapshot');
    expect(prepared.meta.assetCount).toBe(lines.length);
    expect(prepared.meta.estimatedReadTime).toBe(true);
  });

  it('refuses the sidecar on its own', async () => {
    const { client } = createInProcessSnapshotWorker();
    const failure = await client
      .importFiles([new File([OPERATION], 'operation.json')])
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SnapshotJobError);
    expect((failure as Error).message).toBe(
      'operation.json only says when an export was taken: choose it together with the files of the export.',
    );
  });
});

describe('a read time typed for the export', () => {
  it('is the snapshot’s read time when no operation.json came along, and not an estimate', async () => {
    const { client } = createInProcessSnapshotWorker();
    const result = await client.importFiles(
      [new File([EXPORT], 'export.json')],
      undefined,
      [],
      '2026-10-05T14:30:00Z',
    );
    const prepared = result.snapshots[0];
    if (prepared === undefined) throw new Error('no snapshot');
    const snapshot = migrateSnapshot(await decodeJson(prepared.blob));
    expect(snapshot.readTime).toBe('2026-10-05T14:30:00Z');
    expect(snapshot.readTimeSource).toBe('user');
    expect(prepared.meta).toMatchObject({ readTime: '2026-10-05T14:30:00Z', readTimeSource: 'user' });
    expect(prepared.meta.estimatedReadTime).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('gives way to the operation.json’s, and a note says so', async () => {
    const { client } = createInProcessSnapshotWorker();
    const result = await client.importFiles(
      [new File([EXPORT], 'export.json'), new File([OPERATION], 'operation.json')],
      undefined,
      [],
      '2026-10-05T14:30:00Z',
    );
    const prepared = result.snapshots[0];
    if (prepared === undefined) throw new Error('no snapshot');
    expect(prepared.meta).toMatchObject({ readTime: READ_TIME, readTimeSource: 'export-sidecar' });
    expect(result.warnings).toEqual([
      "The export's operation.json names its read time, 2026-10-08 06:00 UTC, so the time typed, " +
        '2026-10-05 14:30 UTC, was not used.',
    ]);
  });

  it('leaves snapshot files their own read times, and says so', async () => {
    const demo = await preparedDemo('S');
    const bundle = new File(
      [new Blob(bundleParts('2026-10-10T00:00:00.000Z', await plainBlob(demo.blob)))],
      's.gcportrait.json',
    );
    const { client } = createInProcessSnapshotWorker();
    const result = await client.importFiles([bundle], undefined, [], '2026-10-05T14:30:00Z');
    expect(result.snapshots[0]?.meta.readTime).toBe('2026-10-08T00:00:00Z');
    expect(result.warnings).toEqual([
      'The read time typed applies to the files of an export; the snapshot files keep their own read times.',
    ]);
  }, 30_000);

  it('notes a read time later than the import’s clock', async () => {
    const future = folderOperation('2999-01-01T00:00:00Z');
    const { client } = createInProcessSnapshotWorker();
    const result = await client.importFiles([
      new File([EXPORT], 'export.json'),
      new File([future], 'operation.json'),
    ]);
    expect(result.warnings).toEqual([
      "Its read time, 2999-01-01 00:00 UTC, is later than this computer's clock; its scope's timeline shows it at " +
        'the present until then.',
    ]);
  });
});
