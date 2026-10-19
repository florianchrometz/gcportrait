// SPDX-License-Identifier: Apache-2.0
/**
 * Table-driven tests over the recorded-shape fixtures in fixtures/ (synthetic data), then the same fixtures
 * transformed (BOM, CRLF, chunking, gluing files together) and read through real Node and web sources.
 *
 * Export files (`cai-export`, `export-part-*`, `duplicates`) use the snake_case envelope keys that
 * `exportAssets` writes to Cloud Storage (`asset_type`, `update_time`, `resource.discovery_document_uri`);
 * `cai-list` holds the same organisation in the camelCase `assets.list` shape, as do the backend frames.
 */
import { ProjectIndexSchema, SnapshotSchema, type Asset, type ProjectIndex } from '@gcportrait/model';
import { createReadStream, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  ingest,
  IngestError,
  type IngestEvent,
  type IngestReport,
  type IngestSource,
  type UnresolvedProjects,
} from '../src/index.js';
import { chunked, chunkText, iterate, joinBytes, testOptions as options } from '../src/testing/helpers.js';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const read = (file: string): Uint8Array => new Uint8Array(readFileSync(new URL(file, FIXTURES)));
const encoder = new TextEncoder();
const chunks = (bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> => iterate(chunked(bytes, size));

interface Case {
  readonly name: string;
  readonly files: readonly string[];
  readonly count: number;
  readonly byType?: Record<string, number>;
  readonly report: Partial<IngestReport>;
  readonly problems?: readonly (readonly [code: string, part: number, line: number, item?: number])[];
  readonly projects?: ProjectIndex;
  readonly unresolvedProjects?: UnresolvedProjects;
  readonly readTime: string;
  readonly events?: readonly IngestEvent['type'][];
}

const ORGANISATION_PROJECTS: ProjectIndex = {
  numberById: { 'demo-app-1': '10000000002', 'demo-data-1': '10000000003', 'demo-net-1': '10000000001' },
  idByNumber: { '10000000001': 'demo-net-1', '10000000002': 'demo-app-1', '10000000003': 'demo-data-1' },
};

const ORGANISATION_UNRESOLVED: UnresolvedProjects = {
  numbers: [],
  ids: [],
  // Licences and boot images live in a public image project outside the organisation.
  referencedIds: ['demo-images-1'],
  inferred: {},
};

/** The same 21-asset organisation, as an export file and as assets.list results. */
const ORGANISATION = {
  count: 21,
  byType: {
    'appengine.googleapis.com/Application': 1,
    'bigquery.googleapis.com/Dataset': 1,
    'cloudkms.googleapis.com/CryptoKey': 1,
    'cloudresourcemanager.googleapis.com/Folder': 2,
    'cloudresourcemanager.googleapis.com/Organization': 1,
    'cloudresourcemanager.googleapis.com/Project': 3,
    'compute.googleapis.com/Disk': 1,
    'compute.googleapis.com/Firewall': 1,
    'compute.googleapis.com/Instance': 1,
    'compute.googleapis.com/Network': 1,
    'compute.googleapis.com/Subnetwork': 1,
    'container.googleapis.com/Cluster': 1,
    'iam.googleapis.com/ServiceAccount': 1,
    'k8s.io/Namespace': 1,
    'pubsub.googleapis.com/Topic': 1,
    'run.googleapis.com/Service': 1,
    'sqladmin.googleapis.com/Instance': 1,
    'storage.googleapis.com/Bucket': 1,
  },
  report: {
    parts: 1,
    lines: 21,
    blankLines: 0,
    assetLines: 21,
    frameLines: 0,
    malformed: 0,
    duplicates: 0,
    readTimeSource: 'max-update-time',
  },
  projects: ORGANISATION_PROJECTS,
  unresolvedProjects: ORGANISATION_UNRESOLVED,
  readTime: '2026-10-07T18:22:41.123456Z',
} satisfies Omit<Case, 'name' | 'files'>;

const CASES: readonly Case[] = [
  {
    name: 'an organisation export (exportAssets file, snake_case keys)',
    files: ['cai-export.ndjson'],
    ...ORGANISATION,
  },
  {
    name: 'the same organisation as assets.list results (camelCase keys)',
    files: ['cai-list.ndjson'],
    ...ORGANISATION,
  },
  {
    name: 'a backend frame stream (project-scope API pull)',
    files: ['api-stream.ndjson'],
    count: 5,
    report: {
      lines: 6,
      assetLines: 0,
      frameLines: 6,
      malformed: 0,
      readTimeSource: 'upstream',
      upstream: { pages: 2, complete: true, reportedAssets: 5, readTime: '2026-10-08T00:00:00Z' },
    },
    readTime: '2026-10-08T00:00:00Z',
    events: ['upstream-progress', 'upstream-progress', 'upstream-progress', 'upstream-done'],
  },
  {
    name: 'a frame stream that was cut short',
    files: ['api-stream-truncated.ndjson'],
    count: 2,
    report: { readTimeSource: 'max-update-time', upstream: { pages: 1, complete: false } },
    readTime: '2026-10-07T18:22:41.123456Z',
    events: ['upstream-progress', 'upstream-progress'],
  },
  {
    name: 'a uriPrefix export in two files, the first without a final newline',
    files: ['export-part-projects.ndjson', 'export-part-networks.ndjson'],
    count: 5,
    report: { parts: 2, lines: 5, malformed: 0 },
    readTime: '2026-10-02T11:12:14Z',
  },
  {
    name: 'a Shared VPC service project and projects without Project assets',
    files: ['shared-vpc.ndjson'],
    count: 6,
    report: { malformed: 0 },
    // Only demo-app-2 has a Project asset. demo-batch-1's Compute disk suggests its number; the Pub/Sub topic's
    // project and a legacy route's numeric self-link stay unnamed; the Shared VPC host and the image project
    // are only referred to.
    projects: {
      numberById: { 'demo-app-2': '10000000004' },
      idByNumber: { '10000000004': 'demo-app-2' },
    },
    unresolvedProjects: {
      numbers: ['10000000005', '10000000006', '10000000007'],
      ids: ['demo-batch-1'],
      referencedIds: ['demo-host-9', 'demo-images-1'],
      inferred: { '10000000005': 'demo-batch-1' },
    },
    readTime: '2026-10-07T09:00:00Z',
  },
  {
    name: 'one instance three times (glued exports)',
    files: ['duplicates.ndjson'],
    count: 2,
    report: { duplicates: 2 },
    readTime: '2026-10-07T18:20:00Z',
  },
  {
    name: 'malformed lines between good ones, in both key styles',
    files: ['malformed.ndjson'],
    count: 4,
    report: { lines: 14, blankLines: 2, malformed: 9 },
    problems: [
      ['invalid-json', 0, 2],
      ['not-an-object', 0, 3],
      ['invalid-asset', 0, 6],
      ['invalid-asset', 0, 7],
      ['unknown-frame', 0, 8],
      ['invalid-asset', 0, 9, 1],
      ['invalid-frame', 0, 10],
      ['invalid-asset', 0, 12],
      ['invalid-asset', 0, 13],
    ],
    readTime: '2026-10-02T11:12:13.141516Z',
  },
];

describe.each(CASES)('$name', (fixture) => {
  const parts = fixture.files.map(read);

  it('ingests into a valid snapshot with the expected stats and report', async () => {
    const events: IngestEvent[] = [];
    const { snapshot, report } = await ingest(
      parts,
      options({ onEvent: (event) => events.push(event), progressEveryBytes: 1 << 30 }),
    );
    expect(SnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.stats.count).toBe(fixture.count);
    expect(snapshot.stats.bytes).toBe(parts.reduce((size, part) => size + part.length, 0));
    if (fixture.byType !== undefined) expect(snapshot.stats.byType).toEqual(fixture.byType);
    expect(report).toMatchObject(fixture.report);
    expect(snapshot.readTime).toBe(fixture.readTime);
    if (fixture.problems !== undefined) {
      expect(
        report.problems.map(({ code, part, line, item }) =>
          item === undefined ? [code, part, line] : [code, part, line, item],
        ),
      ).toEqual(fixture.problems);
    }
    if (fixture.projects !== undefined) expect(report.projects).toEqual(fixture.projects);
    if (fixture.unresolvedProjects !== undefined) {
      expect(report.unresolvedProjects).toEqual(fixture.unresolvedProjects);
    }
    // Exactly the model's ProjectIndex: no extra keys, inverse records.
    expect(ProjectIndexSchema.parse(report.projects)).toEqual(report.projects);
    expect(events.map((event) => event.type)).toEqual(fixture.events ?? []);
  });

  it.each<[string, (bytes: Uint8Array) => Uint8Array]>([
    ['with a byte-order mark', (bytes) => joinBytes([encoder.encode('\uFEFF'), bytes])],
    [
      'with CRLF line endings',
      (bytes) => encoder.encode(new TextDecoder().decode(bytes).replaceAll('\n', '\r\n')),
    ],
    [
      'with blank lines between records',
      (bytes) => encoder.encode(new TextDecoder().decode(bytes).replaceAll('\n', '\n\n \n')),
    ],
  ])('gives the same assets %s', async (_name, transform) => {
    const baseline = await ingest(parts, options());
    const { snapshot } = await ingest(parts.map(transform), options());
    expect(snapshot.assets).toEqual(baseline.snapshot.assets);
  });

  // Chunk boundaries anywhere are the property tests' job (src/ingest.property.test.ts); this is a smoke test.
  it.each([1, 4096])('gives the same snapshot in %s-byte chunks', async (size) => {
    const baseline = await ingest(parts, options());
    expect(
      await ingest(
        parts.map((part) => chunks(part, size)),
        options(),
      ),
    ).toEqual(baseline);
  });
});

describe('export files and assets.list results', () => {
  it('give the same snapshot and report for the same organisation', async () => {
    const fromExport = await ingest(read('cai-export.ndjson'), options());
    const fromList = await ingest(read('cai-list.ndjson'), options());
    expect(fromExport.snapshot).toEqual({
      ...fromList.snapshot,
      stats: { ...fromList.snapshot.stats, bytes: fromExport.snapshot.stats.bytes },
    });
    expect(fromExport.report).toEqual(fromList.report);
  });

  it('name the line style in the messages of the malformed fixture', async () => {
    const { report } = await ingest(read('malformed.ndjson'), options());
    expect(report.problems.slice(-2).map((problem) => problem.message)).toEqual([
      'assetType, asset_type: the two spellings disagree.',
      expect.stringMatching(/^update_time: /) as unknown,
    ]);
  });
});

describe('fixtures that stop the ingest', () => {
  it('rejects with the upstream message of an error frame', async () => {
    const error = await ingest(read('api-stream-error.ndjson'), options()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IngestError);
    expect(error).toMatchObject({
      code: 'upstream',
      message: "The caller does not have permission to list assets under 'organizations/30000000001'.",
      upstream: { status: 403, code: 'PERMISSION_DENIED' },
    });
  });

  it('rejects malformed input in strict mode at the first bad line', async () => {
    await expect(ingest(read('malformed.ndjson'), options({ strict: true }))).rejects.toMatchObject({
      code: 'malformed',
      problem: { code: 'invalid-json', part: 0, line: 2 },
    });
  });
});

describe('several files', () => {
  it('reads all fixtures as one list of parts', async () => {
    const files = [
      'cai-export.ndjson',
      'export-part-projects.ndjson',
      'shared-vpc.ndjson',
      'malformed.ndjson',
    ];
    const { snapshot, report } = await ingest(files.map(read), options());
    expect(report.parts).toBe(4);
    // The projects file repeats three assets of the export.
    expect(snapshot.stats.count).toBe(21 + 6 + 4);
    expect(report.duplicates).toBe(3);
    expect(report.problems.every((problem) => problem.part === 3)).toBe(true);
    expect(SnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('reads files glued into one stream with cat, each starting with a byte-order mark', async () => {
    const bom = encoder.encode('\uFEFF');
    const glued = joinBytes([bom, read('cai-export.ndjson'), bom, read('api-stream.ndjson')]);
    const { snapshot, report } = await ingest(glued, options());
    expect(report.parts).toBe(1);
    expect(report.malformed).toBe(0);
    expect(snapshot.stats.count).toBe(21);
    expect(report.duplicates).toBe(5);
    expect(report.readTimeSource).toBe('upstream');
  });
});

describe('real Node and web sources', () => {
  const bytes = read('cai-export.ndjson');
  const path = new URL('cai-export.ndjson', FIXTURES);

  it.each<[string, () => IngestSource]>([
    ['a Blob', () => new Blob([bytes])],
    ['a Blob stream', () => new Blob([bytes]).stream()],
    ['a fetch Response body', () => responseBody(bytes)],
    ['a Node file stream in 1000-byte chunks', () => createReadStream(path, { highWaterMark: 1000 })],
    ['a Node text stream', () => Readable.from(chunkText(new TextDecoder().decode(bytes), 333))],
    ['a Node Buffer', () => readFileSync(path)],
  ])('reads %s', async (_name, source) => {
    const baseline = await ingest(bytes, options());
    expect(await ingest(source(), options())).toEqual(baseline);
  });
});

describe('huge lines', () => {
  const MiB = 1024 * 1024;
  const pattern = 'ü東🙂x'; // 2 + 3 + 4 + 1 bytes
  const big = (bytes: number) => pattern.repeat(Math.ceil(bytes / 10));

  function assetWith(blob: string, n: number): Record<string, unknown> {
    return {
      name: `//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/apps/k8s/namespaces/shop/configmaps/c${String(n)}`,
      assetType: 'k8s.io/ConfigMap',
      resource: {
        version: 'v1',
        parent: '//container.googleapis.com/projects/demo-app-1/locations/europe-west3/clusters/apps',
        data: { data: { blob } },
      },
      ancestors: [
        'projects/10000000002',
        'folders/20000000002',
        'folders/20000000001',
        'organizations/30000000001',
      ],
      updateTime: '2026-10-07T00:00:00Z',
    };
  }

  it('reads a 10 MiB line streamed in 64 KiB chunks, multi-byte characters cut anywhere', async () => {
    const blob = big(10 * MiB);
    const line = JSON.stringify(assetWith(blob, 1));
    const bytes = encoder.encode(
      `${JSON.stringify(assetWith('small', 0))}\n${line}\r\n${JSON.stringify(assetWith('small', 2))}`,
    );
    expect(encoder.encode(line).length).toBeGreaterThan(10 * MiB);
    const { snapshot, report } = await ingest(new Blob([bytes]).stream(), options());
    expect(report.malformed).toBe(0);
    expect(snapshot.stats.count).toBe(3);
    expect(snapshot.stats.bytes).toBe(bytes.length);
    expect((snapshot.assets[1]?.data as { data: { blob: string } }).data.blob).toBe(blob);
  });

  it('reads a 12 MiB page frame', async () => {
    const assets = Array.from({ length: 24 }, (_, n) => assetWith(big(MiB / 2), n));
    const frame = encoder.encode(`${JSON.stringify({ t: 'page', assets })}\n`);
    expect(frame.length).toBeGreaterThan(12 * MiB);
    const { snapshot } = await ingest(chunks(frame, 65536), options());
    expect(snapshot.stats.count).toBe(24);
  });

  it('skips a line above maxLineBytes without buffering it and reads on', async () => {
    const tooLong = JSON.stringify(assetWith(big(11 * MiB), 1));
    const text = `${tooLong}\n${JSON.stringify(assetWith('small', 2))}\n`;
    const { snapshot, report } = await ingest(
      chunks(encoder.encode(text), 65536),
      options({ maxLineBytes: 10 * MiB }),
    );
    expect(snapshot.assets.map((asset: Asset) => asset.name.split('/').pop())).toEqual(['c2']);
    expect(report.problems).toEqual([
      {
        code: 'line-too-long',
        part: 0,
        line: 1,
        message: `The line is longer than ${String(10 * MiB)} bytes; it was skipped.`,
      },
    ]);
  });
});

function responseBody(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const body = new Response(bytes).body;
  if (body === null) throw new Error('no body');
  return body;
}
