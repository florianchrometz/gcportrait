// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { demoExportNdjson } from '../fixtures';
import { streamBody } from '../testing';
import { inProcessImportWorker } from './inProcess';
import type { StreamSettings } from './protocol';

const S_EXPORT = demoExportNdjson('S');

const SETTINGS: StreamSettings = {
  scope: null,
  source: { kind: 'export', detail: 'export.ndjson' },
  requireComplete: false,
};

describe('the import worker handler', () => {
  it('notes estimated read time when the export does not specify one', async () => {
    const worker = inProcessImportWorker()();
    const { stream } = streamBody(S_EXPORT);
    const result = await worker.client.run(SETTINGS, stream, { signal: new AbortController().signal });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(
      /^The export does not say when it was taken, so its read time is the latest asset change, \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\.$/,
    );
  });

  it('notes malformed lines and duplicate assets with unified wording', async () => {
    const worker = inProcessImportWorker()();
    const lines = S_EXPORT.trimEnd().split('\n');
    const firstLine = lines[0] ?? '';
    const badNdjson = `not a valid json line\n${firstLine}\n${lines.join('\n')}\n`;
    const { stream } = streamBody(badNdjson);
    const result = await worker.client.run(SETTINGS, stream, { signal: new AbortController().signal });
    expect(result.warnings).toHaveLength(4);
    expect(result.warnings[0]).toBe('1 line could not be read and were left out.');
    expect(result.warnings[1]).toMatch(/^Line 1: /);
    expect(result.warnings[2]).toBe('1 asset was listed twice; the newest copy was kept.');
    expect(result.warnings[3]).toMatch(/^The export does not say when it was taken/);
  });

  it('notes when the read time is later than the clock', async () => {
    const past = Date.parse('2020-01-01T00:00:00Z');
    const worker = inProcessImportWorker({ clock: () => past })();
    const { stream } = streamBody(S_EXPORT);
    const result = await worker.client.run(SETTINGS, stream, { signal: new AbortController().signal });
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatch(/^The export does not say when it was taken/);
    expect(result.warnings[1]).toMatch(
      /is later than this computer's clock; its scope's timeline shows it at the present until then\.$/,
    );
  });

  it('notes when the export holds assets from several roots with unified wording', async () => {
    const worker = inProcessImportWorker()();
    const otherAsset = JSON.stringify({
      name: '//storage.googleapis.com/projects/_/buckets/demo-other-bucket',
      asset_type: 'storage.googleapis.com/Bucket',
      resource: { data: { name: 'demo-other-bucket' } },
      ancestors: ['projects/10000000099', 'organizations/30000000002'],
      update_time: '2026-10-01T00:00:00Z',
    });
    const multiRootNdjson = `${S_EXPORT.trimEnd()}\n${otherAsset}\n`;
    const { stream } = streamBody(multiRootNdjson);
    const result = await worker.client.run(SETTINGS, stream, { signal: new AbortController().signal });
    expect(result.warnings[0]).toBe(
      'The export holds the assets of 2 organisations or projects; the snapshot takes the scope most of them share, example.com.',
    );
  });
});
