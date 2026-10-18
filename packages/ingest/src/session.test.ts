// SPDX-License-Identifier: Apache-2.0
import { ProjectIndexSchema, SnapshotSchema, UlidSchema } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import {
  createIngestSession,
  MAX_REPORTED_PROBLEMS,
  type IngestEvent,
  type IngestOptions,
} from './session.js';
import {
  caught,
  exportShape,
  FIXED_TIME,
  ndjson,
  numberedAsset,
  rawAsset,
  testOptions,
  utf8,
} from './testing/helpers.js';

/** Runs a session over text parts and returns the result. */
function run(parts: readonly string[], options: Partial<IngestOptions> = {}) {
  const session = createIngestSession(testOptions(options));
  for (const part of parts) {
    session.push(part);
    session.endPart();
  }
  return session.finish();
}

describe('snapshot assembly', () => {
  it('builds a valid snapshot with stats from raw CAI NDJSON', () => {
    const project = rawAsset({
      name: '//cloudresourcemanager.googleapis.com/projects/10000000001',
      assetType: 'cloudresourcemanager.googleapis.com/Project',
      resource: { data: { projectId: 'demo-net-1', projectNumber: '10000000001' } },
      updateTime: '2026-10-01T08:00:00Z',
    });
    const input = ndjson([project, numberedAsset(1), numberedAsset(2)]);
    const { snapshot, report } = run([input], { source: { kind: 'export', detail: 'export.ndjson' } });
    expect(SnapshotSchema.parse(snapshot)).toEqual(snapshot);
    // FIXED_TIME (2026-10-08T12:00Z) is 01M4DP4XG0; the rest comes from the seeded entropy.
    expect(snapshot.id).toBe('01M4DP4XG0AWF0WZQZNP3ZD818');
    expect(UlidSchema.safeParse(snapshot.id).success).toBe(true);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.contentType).toBe('RESOURCE');
    expect(snapshot.scope).toEqual({ kind: 'organization', id: '30000000001', displayName: 'example.com' });
    expect(snapshot.source).toEqual({ kind: 'export', detail: 'export.ndjson' });
    expect(snapshot.assets.map((asset) => asset.name)).toEqual([
      '//cloudresourcemanager.googleapis.com/projects/10000000001',
      '//compute.googleapis.com/projects/demo-net-1/global/networks/net-1',
      '//compute.googleapis.com/projects/demo-net-1/global/networks/net-2',
    ]);
    expect(snapshot.stats).toEqual({
      count: 3,
      byType: { 'cloudresourcemanager.googleapis.com/Project': 1, 'compute.googleapis.com/Network': 2 },
      bytes: utf8(input).length,
    });
    expect(report).toMatchObject({
      parts: 1,
      lines: 3,
      blankLines: 0,
      assetLines: 3,
      frameLines: 0,
      malformed: 0,
    });
    expect(report.projects).toEqual({
      numberById: { 'demo-net-1': '10000000001' },
      idByNumber: { '10000000001': 'demo-net-1' },
    });
    // The model's ProjectIndex, exactly: no extra keys, inverse records.
    expect(ProjectIndexSchema.parse(report.projects)).toEqual(report.projects);
    expect(report.unresolvedProjects).toEqual({ numbers: [], ids: [], referencedIds: [], inferred: {} });
    expect('upstream' in report).toBe(false);
  });

  it('sorts stats.byType by asset type', () => {
    const input = ndjson([
      rawAsset({ name: '//storage.googleapis.com/demo-b', assetType: 'storage.googleapis.com/Bucket' }),
      numberedAsset(1),
      rawAsset({
        name: '//pubsub.googleapis.com/projects/demo-net-1/topics/t',
        assetType: 'pubsub.googleapis.com/Topic',
      }),
    ]);
    expect(Object.keys(run([input]).snapshot.stats.byType)).toEqual([
      'compute.googleapis.com/Network',
      'pubsub.googleapis.com/Topic',
      'storage.googleapis.com/Bucket',
    ]);
  });

  it('returns an empty snapshot for empty input', () => {
    const { snapshot, report } = run([]);
    expect(SnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.stats).toEqual({ count: 0, byType: {}, bytes: 0 });
    expect(report).toMatchObject({ parts: 0, lines: 0, readTimeSource: 'clock' });
    expect(snapshot.readTime).toBe(new Date(FIXED_TIME).toISOString());
    // The clock is no source of a read time: the snapshot leaves readTimeSource out.
    expect(snapshot).not.toHaveProperty('readTimeSource');
  });

  it('ends an open part in finish() and counts every part', () => {
    const session = createIngestSession(testOptions());
    session.push(ndjson([numberedAsset(1)]));
    session.endPart();
    session.endPart(); // an empty file
    session.push(JSON.stringify(numberedAsset(2))); // no final newline, no endPart
    const { snapshot, report } = session.finish();
    expect(snapshot.stats.count).toBe(2);
    expect(report.parts).toBe(3);
  });
});

describe('readTime', () => {
  const assets = [
    numberedAsset(1, '2026-10-05T10:00:00Z'),
    numberedAsset(2, '2026-10-07T09:00:00.5+02:00'),
    numberedAsset(3, '2026-10-06T00:00:00Z'),
  ];

  it('uses the option when given', () => {
    const { snapshot, report } = run([ndjson(assets)], { readTime: '2026-10-08T00:00:00Z' });
    expect(snapshot.readTime).toBe('2026-10-08T00:00:00Z');
    expect(report.readTimeSource).toBe('option');
    // An export source's read time comes from the export's operation metadata.
    expect(snapshot.readTimeSource).toBe('export-sidecar');
    expect(SnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it.each([
    ['api', undefined, 'api'],
    ['export', undefined, 'export-sidecar'],
    ['demo', undefined, 'user'],
    ['export', 'user', 'user'],
    ['api', 'export-sidecar', 'export-sidecar'],
  ] as const)(
    'records where the option came from (%s source, origin %s)',
    (kind, readTimeOrigin, expected) => {
      const { snapshot } = run([ndjson(assets)], {
        source: { kind },
        readTime: '2026-10-08T00:00:00Z',
        ...(readTimeOrigin === undefined ? {} : { readTimeOrigin }),
      });
      expect(snapshot.readTimeSource).toBe(expected);
    },
  );

  it('defaults to the latest updateTime, kept verbatim, and says it is an estimate', () => {
    const { snapshot, report } = run([ndjson(assets)]);
    expect(snapshot.readTime).toBe('2026-10-07T09:00:00.5+02:00');
    expect(report.readTimeSource).toBe('max-update-time');
    expect(snapshot.readTimeSource).toBe('estimated-max-update-time');
  });

  it('compares sub-millisecond digits', () => {
    const { snapshot } = run([
      ndjson([
        numberedAsset(1, '2026-10-07T18:22:41.123456Z'),
        numberedAsset(2, '2026-10-07T18:22:41.1234Z'),
        numberedAsset(3, '2026-10-07T18:22:41.123Z'),
      ]),
    ]);
    expect(snapshot.readTime).toBe('2026-10-07T18:22:41.123456Z');
  });

  it('prefers the latest done frame over update times', () => {
    const input = ndjson([
      { t: 'page', assets },
      { t: 'done', assets: 3, readTime: '2026-10-08T00:00:00Z' },
      { t: 'done', assets: 3, readTime: '2026-10-07T00:00:00Z' },
    ]);
    const { snapshot, report } = run([input]);
    expect(snapshot.readTime).toBe('2026-10-08T00:00:00Z');
    expect(report.readTimeSource).toBe('upstream');
    expect(snapshot.readTimeSource).toBe('api');
    expect(report.upstream).toEqual({
      pages: 1,
      complete: true,
      reportedAssets: 3,
      readTime: '2026-10-08T00:00:00Z',
    });
  });

  it('falls back to update times when the done frame has no readTime', () => {
    const { report } = run([
      ndjson([
        { t: 'page', assets },
        { t: 'done', assets: 3 },
      ]),
    ]);
    expect(report.readTimeSource).toBe('max-update-time');
    expect(report.upstream).toEqual({ pages: 1, complete: true, reportedAssets: 3 });
  });
});

describe('key styles', () => {
  const listed = [numberedAsset(1), numberedAsset(2, '2026-10-08T01:00:00Z')];
  const exported = listed.map(exportShape);

  it('reads exportAssets lines (snake_case envelope) like assets.list lines', () => {
    const fromExport = run([ndjson(exported)]);
    const fromList = run([ndjson(listed)]);
    expect(fromExport.report.malformed).toBe(0);
    expect(fromExport.snapshot.assets).toEqual(fromList.snapshot.assets);
    expect(fromExport.snapshot.readTime).toBe('2026-10-08T01:00:00Z');
    expect(fromExport.report).toEqual({ ...fromList.report, assetLines: 2 });
  });

  it('reads snake_case assets inside page frames too', () => {
    const { snapshot, report } = run([
      ndjson([
        { t: 'page', assets: exported },
        { t: 'done', assets: 2 },
      ]),
    ]);
    expect(report.malformed).toBe(0);
    expect(snapshot.assets).toEqual(run([ndjson(listed)]).snapshot.assets);
  });

  it('mixes both styles line by line, and dedupes across them', () => {
    const { snapshot, report } = run([ndjson([listed[0], exported[1], exported[0]])]);
    expect(snapshot.stats.count).toBe(2);
    expect(report.duplicates).toBe(1);
  });
});

describe('backend frames', () => {
  it('reads assets from page frames and surfaces progress and done as events', () => {
    const events: IngestEvent[] = [];
    const input = ndjson([
      { t: 'progress', pages: 0, assets: 0 },
      { t: 'page', assets: [numberedAsset(1), numberedAsset(2)] },
      { t: 'progress', pages: 1, assets: 2 },
      { t: 'page', assets: [] },
      { t: 'done', assets: 2, readTime: '2026-10-08T00:00:00Z' },
    ]);
    const { snapshot, report } = run([input], {
      onEvent: (event) => events.push(event),
      progressEveryBytes: 1 << 30,
    });
    expect(snapshot.stats.count).toBe(2);
    expect(events).toEqual([
      { type: 'upstream-progress', pages: 0, assets: 0 },
      { type: 'upstream-progress', pages: 1, assets: 2 },
      { type: 'upstream-done', assets: 2, readTime: '2026-10-08T00:00:00Z' },
    ]);
    expect(report).toMatchObject({ frameLines: 5, assetLines: 0, upstream: { pages: 2, complete: true } });
  });

  it('marks a frame stream without a done frame as incomplete', () => {
    const { report } = run([ndjson([{ t: 'page', assets: [numberedAsset(1)] }])]);
    expect(report.upstream).toEqual({ pages: 1, complete: false });
  });

  it('reads an object with a name as an asset even when it has a "t" field', () => {
    const { snapshot, report } = run([ndjson([{ ...numberedAsset(1), t: 'unexpected' }])]);
    expect(snapshot.stats.count).toBe(1);
    expect(report).toMatchObject({ assetLines: 1, frameLines: 0, malformed: 0 });
    expect('upstream' in report).toBe(false);
  });

  it('mixes both dialects line by line', () => {
    const { snapshot, report } = run([
      ndjson([numberedAsset(1), { t: 'page', assets: [numberedAsset(2)] }, numberedAsset(3)]),
    ]);
    expect(snapshot.stats.count).toBe(3);
    expect(report).toMatchObject({ assetLines: 2, frameLines: 1 });
  });

  it('stops with the upstream message, status and code on an error frame', () => {
    const session = createIngestSession(testOptions());
    const error = caught(() => {
      session.push(
        ndjson([
          { t: 'page', assets: [numberedAsset(1)] },
          {
            t: 'error',
            status: 403,
            code: 'PERMISSION_DENIED',
            message: 'The caller does not have permission',
          },
        ]),
      );
    });
    expect(error.code).toBe('upstream');
    expect(error.message).toBe('The caller does not have permission');
    expect(error.upstream).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    // The session is dead from now on, and says why.
    expect(() => {
      session.finish();
    }).toThrow(error);
  });

  it('stops on an error frame even without a message', () => {
    const error = caught(() => run([ndjson([{ t: 'error', status: 'x', code: 7 }])]));
    expect(error.message).toBe('The asset stream reported an error without a message.');
    expect(error.upstream).toEqual({});
  });
});

describe('malformed input', () => {
  const lines = [
    JSON.stringify(numberedAsset(1)),
    '{"name": broken',
    '[1, 2, 3]',
    '42',
    'null',
    '',
    '   \t',
    JSON.stringify({ t: 'banner', text: 'hello' }),
    JSON.stringify({ t: 7 }),
    JSON.stringify({ t: 'page', assets: { not: 'a list' } }),
    JSON.stringify({ t: 'page', assets: [numberedAsset(2), { name: 42 }] }),
    JSON.stringify({ t: 'progress', pages: 'x', assets: 1 }),
    JSON.stringify({ t: 'done' }),
    JSON.stringify({ t: 'done', assets: 1, readTime: 'yesterday' }),
    JSON.stringify(rawAsset({ updateTime: undefined })),
    JSON.stringify(numberedAsset(3)),
  ];
  const input = lines.join('\n');

  it('counts and reports bad lines with their line numbers and keeps going', () => {
    const { snapshot, report } = run([input]);
    expect(snapshot.assets.map((asset) => asset.name.split('/').pop())).toEqual(['net-1', 'net-2', 'net-3']);
    expect(report.malformed).toBe(12);
    expect(report.blankLines).toBe(2);
    expect(report.lines).toBe(16);
    expect(report.problems.map(({ code, line, item }) => [code, line, item])).toEqual([
      ['invalid-json', 2, undefined],
      ['not-an-object', 3, undefined],
      ['not-an-object', 4, undefined],
      ['not-an-object', 5, undefined],
      ['unknown-frame', 8, undefined],
      ['unknown-frame', 9, undefined],
      ['invalid-frame', 10, undefined],
      ['invalid-asset', 11, 1],
      ['invalid-frame', 12, undefined],
      ['invalid-frame', 13, undefined],
      ['invalid-frame', 14, undefined],
      ['invalid-asset', 15, undefined],
    ]);
    expect(report.problems[0]?.message).toMatch(/^Not valid JSON: /);
    expect(report.problems[1]?.message).toBe('Expected a JSON object, found an array.');
    expect(report.problems[2]?.message).toBe('Expected a JSON object, found a number.');
    expect(report.problems[3]?.message).toBe('Expected a JSON object, found null.');
    expect(report.problems[4]?.message).toBe('Unknown frame type "banner".');
    expect(report.problems[5]?.message).toBe('A frame\'s "t" must be a string, found a number.');
    expect(report.problems[7]?.message).toMatch(/^name: /);
    expect(report.problems[11]?.message).toMatch(/^updateTime: /);
    expect(SnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('keeps only the first problems but counts all of them', () => {
    const { report } = run([Array.from({ length: 50 }, (_, index) => `bad ${String(index)}`).join('\n')]);
    expect(report.malformed).toBe(50);
    expect(report.problems).toHaveLength(MAX_REPORTED_PROBLEMS);
    expect(report.problems.at(-1)?.line).toBe(MAX_REPORTED_PROBLEMS);
  });

  it('throws on the first bad line in strict mode, with the problem attached', () => {
    const error = caught(() => run([input], { strict: true }));
    expect(error.code).toBe('malformed');
    expect(error.problem).toMatchObject({ code: 'invalid-json', part: 0, line: 2 });
    expect(error.message).toMatch(/^Malformed input at part 0, line 2: Not valid JSON/);
  });

  it('names the frame item in strict mode', () => {
    const error = caught(() =>
      run([ndjson([{ t: 'page', assets: [numberedAsset(1), 'nope'] }])], { strict: true }),
    );
    expect(error.message).toMatch(/^Malformed input at part 0, line 1, item 1: /);
  });

  it('reports a line that is too long and reads the next one', () => {
    const { snapshot, report } = run(
      [`${JSON.stringify(numberedAsset(1))}\n${'x'.repeat(2000)}\n${JSON.stringify(numberedAsset(2))}\n`],
      {
        maxLineBytes: 1000,
      },
    );
    expect(snapshot.stats.count).toBe(2);
    expect(report.problems).toEqual([
      {
        code: 'line-too-long',
        part: 0,
        line: 2,
        message: 'The line is longer than 1000 bytes; it was skipped.',
      },
    ]);
  });
});

describe('duplicates', () => {
  it('keeps one asset per name: the latest updateTime, at its first position', () => {
    const first = numberedAsset(1, '2026-10-01T00:00:00Z');
    const newest = { ...numberedAsset(1, '2026-10-03T00:00:00Z'), resource: { data: { version: 'newest' } } };
    const middle = numberedAsset(1, '2026-10-02T00:00:00Z');
    const { snapshot, report } = run([ndjson([first, numberedAsset(2), newest, middle])]);
    expect(snapshot.assets.map((asset) => asset.name.split('/').pop())).toEqual(['net-1', 'net-2']);
    expect(snapshot.assets[0]?.data).toEqual({ version: 'newest' });
    expect(snapshot.stats.count).toBe(2);
    expect(report.duplicates).toBe(2);
    expect(SnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('builds the project index from the kept copies only', () => {
    const projectCopy = (projectId: string, updateTime: string) =>
      rawAsset({
        name: '//cloudresourcemanager.googleapis.com/projects/10000000001',
        assetType: 'cloudresourcemanager.googleapis.com/Project',
        resource: { data: { projectId, projectNumber: '10000000001' } },
        updateTime,
      });
    const { snapshot, report } = run([
      ndjson([
        projectCopy('demo-old-1', '2026-10-01T00:00:00Z'),
        projectCopy('demo-net-1', '2026-10-02T00:00:00Z'),
      ]),
    ]);
    expect(snapshot.stats.count).toBe(1);
    expect(report.projects.idByNumber).toEqual({ '10000000001': 'demo-net-1' });
    expect(JSON.stringify(report)).not.toContain('demo-old-1');
  });

  it('keeps the first of two assets with the same updateTime', () => {
    const first = { ...numberedAsset(1), resource: { data: { copy: 1 } } };
    const second = { ...numberedAsset(1), resource: { data: { copy: 2 } } };
    expect(run([ndjson([first, second])]).snapshot.assets[0]?.data).toEqual({ copy: 1 });
  });
});

describe('read events', () => {
  it('fires each time another progressEveryBytes bytes were read', () => {
    const events: IngestEvent[] = [];
    const session = createIngestSession(
      testOptions({ progressEveryBytes: 100, onEvent: (event) => events.push(event) }),
    );
    const line = `${JSON.stringify(numberedAsset(1))}\n`;
    session.push(line.slice(0, 50));
    session.push(line.slice(50));
    session.push('\n'.repeat(250));
    session.finish();
    const reads = events.filter((event) => event.type === 'read');
    expect(reads.map((event) => event.bytes)).toEqual([line.length, line.length + 250]);
    expect(reads[0]).toEqual({ type: 'read', bytes: line.length, lines: 1, assets: 1, malformed: 0 });
  });
});

describe('options', () => {
  it.each([
    ['a non-object', null, /^The options must be an object/],
    ['a bad scope', { scope: { kind: 'billing', id: '1' } }, /^scope: kind: /],
    ['a missing source', { source: undefined }, /^source: /],
    ['a bad readTime', { readTime: 'today' }, /^readTime: /],
    [
      'an unknown readTimeOrigin',
      { readTime: '2026-10-08T00:00:00Z', readTimeOrigin: 'guess' },
      /^readTimeOrigin: must/,
    ],
    ['a readTimeOrigin without readTime', { readTimeOrigin: 'user' }, /^readTimeOrigin: says/],
    ['a non-boolean strict', { strict: 'yes' }, /^strict: /],
    ['a zero line limit', { maxLineBytes: 0 }, /^maxLineBytes: /],
    ['a fractional progress step', { progressEveryBytes: 1.5 }, /^progressEveryBytes: /],
    ['a missing clock', { clock: undefined }, /^clock: /],
    ['a missing entropy source', { entropy: undefined }, /^entropy: /],
    ['an onEvent that is not a function', { onEvent: 'log' }, /^onEvent: /],
  ])('rejects %s', (_name, overrides, message) => {
    const options = overrides === null ? null : { ...testOptions(), ...overrides };
    const error = caught(() => createIngestSession(options as unknown as IngestOptions));
    expect(error.code).toBe('invalid-options');
    expect(error.message).toMatch(message);
  });

  it('strips unknown keys from scope and source', () => {
    const { snapshot } = run([], {
      scope: { kind: 'project', id: 'demo-net-1', extra: true } as unknown as IngestOptions['scope'],
    });
    expect(snapshot.scope).toEqual({ kind: 'project', id: 'demo-net-1' });
  });

  it.each([-1, 1.5, 253_402_300_800_000, Number.NaN])('rejects the clock reading %s at finish', (time) => {
    const session = createIngestSession(testOptions({ clock: () => time }));
    expect(caught(() => session.finish()).message).toMatch(/^clock: returned/);
  });

  it('rejects a chunk that is neither bytes nor text', () => {
    const session = createIngestSession(testOptions());
    const error = caught(() => {
      session.push(42 as unknown as string);
    });
    expect(error.code).toBe('invalid-source');
  });

  it('refuses any call after finish()', () => {
    const session = createIngestSession(testOptions());
    session.finish();
    expect(caught(() => session.finish()).code).toBe('closed');
    expect(
      caught(() => {
        session.push('x');
      }).code,
    ).toBe('closed');
    expect(
      caught(() => {
        session.endPart();
      }).code,
    ).toBe('closed');
  });
});
