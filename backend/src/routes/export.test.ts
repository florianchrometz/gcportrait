// SPDX-License-Identifier: MIT
/**
 * `POST /api/export/read` over HTTP against a pretend Cloud Storage, and the export read's caps
 * (docs/security.md §5). The URI's syntax is stream/export-read.test.ts's.
 */
import { ingest } from '@gcportrait/ingest';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { startTestServer } from '../server.testing.js';
import { exportLines, planExportRead, type ExportReadStats } from '../stream/export-read.js';
import { linesOf, mockGcs, syntheticAsset } from '../stream/google.testing.js';
import { googleError, jsonResponse, recordingSleep } from '../upstream/google.testing.js';
import { createUpstreamClient, type UpstreamFetch } from '../upstream/request.js';

const TOKEN = 'ya29.synthetic-test-token';
const BUCKET = 'demo-exports';

/** An export line as `exportAssets` writes it: snake_case envelope keys. */
function exportLine(index: number): string {
  const asset = syntheticAsset(index) as {
    assetType: string;
    updateTime: string;
    resource: Record<string, unknown>;
  } & Record<string, unknown>;
  const { assetType, updateTime, resource, ...rest } = asset;
  const { discoveryDocumentUri, discoveryName, ...resourceRest } = resource;
  return JSON.stringify({
    ...rest,
    asset_type: assetType,
    update_time: updateTime,
    resource: {
      ...resourceRest,
      discovery_document_uri: discoveryDocumentUri,
      discovery_name: discoveryName,
    },
  });
}

function exportFile(from: number, count: number, finalNewline = true): string {
  const lines = Array.from({ length: count }, (_, offset) => exportLine(from + offset));
  return lines.join('\n') + (finalNewline ? '\n' : '');
}

async function start(
  fetch: UpstreamFetch,
): Promise<{ readonly app: FastifyInstance; readonly delays: number[] }> {
  const { sleep, delays } = recordingSleep();
  const { app } = await startTestServer({ fetch, upstream: { sleep } });
  return { app, delays };
}

function read(app: FastifyInstance, gcsUriValue: unknown) {
  return app.inject({
    method: 'POST',
    url: '/api/export/read',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    payload: JSON.stringify({ gcsUri: gcsUriValue }),
  });
}

async function assetsOf(body: string): Promise<number> {
  const { snapshot, report } = await ingest(body, {
    scope: { kind: 'organization', id: '30000000001' },
    source: { kind: 'export', detail: 'gs://demo-exports/' },
    clock: () => 0,
    entropy: () => 0.5,
  });
  expect(report.malformed).toBe(0);
  return snapshot.assets.length;
}

describe('POST /api/export/read', () => {
  it('streams one object’s lines, with its size announced', async () => {
    const content = exportFile(0, 30);
    const gcs = mockGcs(BUCKET, { 'exports/org.json': content }, { chunkSize: 1000 });
    const { app } = await start(gcs.fetch);
    const response = await read(app, 'gs://demo-exports/exports/org.json');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
    expect(response.headers['x-gcportrait-export-objects']).toBe('1');
    expect(response.headers['x-gcportrait-export-bytes']).toBe(
      String(new TextEncoder().encode(content).byteLength),
    );
    expect(response.body).toBe(content);
    expect(await assetsOf(response.body)).toBe(30);
    expect(gcs.calls.map((call) => `${call.method} ${call.url.pathname}${call.url.search}`)).toEqual([
      'GET /storage/v1/b/demo-exports/o/exports%2Forg.json?fields=name,size',
      'GET /storage/v1/b/demo-exports/o/exports%2Forg.json?alt=media',
    ]);
    expect(gcs.calls.every((call) => call.headers.get('authorization') === `Bearer ${TOKEN}`)).toBe(true);
  });

  it('reads every object under a prefix in name order, with a line break where an object lacks one', async () => {
    const objects = {
      'org/compute.googleapis.com/Instance/0': exportFile(0, 10, false),
      'org/compute.googleapis.com/Instance/1': exportFile(10, 5),
      'org/cloudresourcemanager.googleapis.com/Project/0': exportFile(100, 3, false),
      'org/': '',
      'other/ignored.json': exportFile(200, 2),
    };
    const gcs = mockGcs(BUCKET, objects, { listPageSize: 2 });
    const { app } = await start(gcs.fetch);
    const response = await read(app, 'gs://demo-exports/org/');
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-gcportrait-export-objects']).toBe('3');
    expect(response.body).toBe(
      `${objects['org/cloudresourcemanager.googleapis.com/Project/0']}\n` +
        `${objects['org/compute.googleapis.com/Instance/0']}\n` +
        objects['org/compute.googleapis.com/Instance/1'],
    );
    expect(await assetsOf(response.body)).toBe(18);
    // Two listing pages of two items each (the folder placeholder among them).
    expect(gcs.calls.filter((call) => call.url.searchParams.has('prefix'))).toHaveLength(2);
  });

  it('reads a URI that names no object as the prefix it is (--output-path-prefix)', async () => {
    const gcs = mockGcs(BUCKET, {
      'exports/2026-10-08/compute.googleapis.com/Instance/0': exportFile(0, 4),
      'exports/2026-10-08/compute.googleapis.com/Disk/0': exportFile(4, 2),
    });
    const { app } = await start(gcs.fetch);
    const response = await read(app, 'gs://demo-exports/exports/2026-10-08');
    expect(response.headers['x-gcportrait-export-objects']).toBe('2');
    expect(await assetsOf(response.body)).toBe(6);
    expect(gcs.calls[1]?.url.searchParams.get('prefix')).toBe('exports/2026-10-08/');
  });

  it('says so when there is nothing to read', async () => {
    const { app } = await start(mockGcs(BUCKET, {}).fetch);
    const response = await read(app, 'gs://demo-exports/missing.json');
    expect(response.statusCode).toBe(200);
    expect(linesOf(response.body)).toEqual([
      {
        t: 'error',
        message:
          'There is no export at gs://demo-exports/missing.json: no object of that name and no objects under gs://demo-exports/missing.json/.',
        status: 404,
        code: 'NOT_FOUND',
      },
    ]);
  });

  it('passes Cloud Storage’s refusal on verbatim', async () => {
    const message =
      'person@example.com does not have storage.objects.get access to the Google Cloud Storage object.';
    const gcs = mockGcs(
      BUCKET,
      { 'x.json': exportFile(0, 1) },
      {
        override: () =>
          jsonResponse(403, { error: { code: 403, message, errors: [{ reason: 'forbidden' }] } }),
      },
    );
    const { app } = await start(gcs.fetch);
    const response = await read(app, 'gs://demo-exports/x.json');
    expect(linesOf(response.body)).toEqual([{ t: 'error', message, status: 403, code: 'PERMISSION_DENIED' }]);
    expect(gcs.calls).toHaveLength(1);
  });

  describe.each([
    { stage: 'metadata', uri: 'gs://demo-exports/org/first.json', successfulCalls: 0 },
    { stage: 'listing', uri: 'gs://demo-exports/org/', successfulCalls: 0 },
    { stage: 'later listing page', uri: 'gs://demo-exports/org/', successfulCalls: 1 },
    { stage: 'download', uri: 'gs://demo-exports/org/first.json', successfulCalls: 1 },
  ])('$stage failures', ({ stage, uri, successfulCalls }) => {
    it.each([
      { status: 400, code: 'INVALID_ARGUMENT', reason: 'INVALID_ARGUMENT', retryable: false },
      { status: 401, code: 'UNAUTHENTICATED', reason: 'ACCESS_TOKEN_EXPIRED', retryable: false },
      {
        status: 403,
        code: 'PERMISSION_DENIED',
        reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
        retryable: false,
      },
      { status: 429, code: 'RESOURCE_EXHAUSTED', reason: 'RATE_LIMIT_EXCEEDED', retryable: true },
      { status: 500, code: 'INTERNAL', reason: 'BACKEND_ERROR', retryable: true },
      { status: 503, code: 'UNAVAILABLE', reason: 'BACKEND_ERROR', retryable: true },
      { status: 599, code: 'UNKNOWN', reason: 'BACKEND_ERROR', retryable: true },
    ])('reports $status with retryable=$retryable', async ({ status, code, reason, retryable }) => {
      const message = 'Cloud Storage could not complete this request.';
      const gcs = mockGcs(
        BUCKET,
        { 'org/first.json': exportFile(0, 1), 'org/second.json': exportFile(1, 1) },
        {
          listPageSize: 1,
          override: (_call, index) =>
            index >= successfulCalls
              ? googleError(status, code, message, [{ reason, domain: 'storage.googleapis.com' }])
              : undefined,
        },
      );
      const { app, delays } = await start(gcs.fetch);
      const response = await read(app, uri);
      expect(response.statusCode).toBe(200);
      expect(linesOf(response.body)).toEqual([
        { t: 'error', message, status, code, reason, ...(retryable ? { retryable: true } : {}) },
      ]);
      expect(delays).toEqual(retryable ? [250, 500, 1000, 2000] : []);
      expect(gcs.calls).toHaveLength(successfulCalls + (retryable ? 5 : 1));
      if (stage === 'later listing page')
        expect(gcs.calls.slice(1).every((call) => call.url.searchParams.get('pageToken') === '1')).toBe(true);
      expect(gcs.calls.every((call) => call.headers.get('authorization') === `Bearer ${TOKEN}`)).toBe(true);
    });
  });

  it('does not retry a missing prefix or offer a retry', async () => {
    const gcs = mockGcs(BUCKET, {}, { override: () => googleError(404, 'NOT_FOUND', 'No such bucket.') });
    const { app, delays } = await start(gcs.fetch);
    const response = await read(app, 'gs://demo-exports/org/');
    expect(linesOf(response.body)).toEqual([
      { t: 'error', message: 'No such bucket.', status: 404, code: 'NOT_FOUND' },
    ]);
    expect(gcs.calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it('retries a transient answer before the download starts', async () => {
    const content = exportFile(0, 3);
    const gcs = mockGcs(
      BUCKET,
      { 'x.json': content },
      {
        override: (call, index) =>
          index === 1 && call.url.searchParams.get('alt') === 'media'
            ? googleError(503, 'UNAVAILABLE', 'Backend Error')
            : undefined,
      },
    );
    const { app, delays } = await start(gcs.fetch);
    const response = await read(app, 'gs://demo-exports/x.json');
    expect(response.body).toBe(content);
    expect(delays).toEqual([250]);
  });

  it('ends with an error frame on a line of its own when a download breaks', async () => {
    const encoder = new TextEncoder();
    const gcs = mockGcs(
      BUCKET,
      { 'x.json': exportFile(0, 3) },
      {
        override: (call) => {
          if (call.url.searchParams.get('alt') !== 'media') return undefined;
          let pulls = 0;
          const body = new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls += 1;
              if (pulls === 1)
                controller.enqueue(
                  encoder.encode(`${exportLine(0)}\n{"name":"//compute.googleapis.com/projects/demo`),
                );
              else controller.error(new TypeError('terminated'));
            },
          });
          return new Response(body, { status: 200 });
        },
      },
    );
    const { app } = await start(gcs.fetch);
    const response = await read(app, 'gs://demo-exports/x.json');
    const lines = response.body.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2] ?? '')).toEqual({
      t: 'error',
      message: 'Google could not be reached for the export in Cloud Storage. Try again later.',
      status: 502,
      code: 'UPSTREAM_UNREACHABLE',
      retryable: true,
    });
  });

  it('refuses what is not a gs:// URI, and calls nothing', async () => {
    const gcs = mockGcs(BUCKET, {});
    const { app } = await start(gcs.fetch);
    for (const uri of [
      'https://storage.googleapis.com/demo-exports/x',
      'gs://',
      42,
      null,
      'gs://UPPER/x',
      // A lone surrogate (JSON can carry one as \ud800) has no UTF-8 form: 400, not a 500 from encoding it.
      'gs://demo-exports/a\uD800b',
    ]) {
      const response = await read(app, uri);
      expect(response.statusCode, String(uri)).toBe(400);
    }
    const extra = await app.inject({
      method: 'POST',
      url: '/api/export/read',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      payload: JSON.stringify({ gcsUri: 'gs://demo-exports/x', url: 'https://example.com' }),
    });
    expect(extra.statusCode).toBe(400);
    expect(gcs.calls).toHaveLength(0);
  });
});

describe('the export read caps', () => {
  const client = (fetch: UpstreamFetch) => createUpstreamClient({ fetch, sleep: recordingSleep().sleep });
  const stats = (): ExportReadStats => ({ objects: 0, bytes: 0, retries: 0 });
  const signal = new AbortController().signal;

  it('refuses an export larger than the cap before reading it', async () => {
    const gcs = mockGcs(BUCKET, { 'big.json': exportFile(0, 20) });
    const plan = await planExportRead(
      { bucket: BUCKET, object: 'big.json' },
      { client: client(gcs.fetch), token: TOKEN, stats: stats(), maxBytes: 1000 },
      signal,
    );
    expect(plan).toMatchObject({ ok: false, frame: { t: 'error', code: 'RESPONSE_TOO_LARGE', status: 400 } });
  });

  it('stops a download that passes the cap', async () => {
    const gcs = mockGcs(BUCKET, { 'big.json': exportFile(0, 20) }, { chunkSize: 500 });
    const location = { bucket: BUCKET, object: 'big.json' };
    const counts = stats();
    const chunks: string[] = [];
    for await (const chunk of exportLines(
      location,
      [{ name: 'big.json', size: 10 }],
      { client: client(gcs.fetch), token: TOKEN, stats: counts, maxBytes: 2000 },
      signal,
    ))
      chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    const last = chunks.join('').split('\n').filter(Boolean).at(-1) ?? '';
    expect(JSON.parse(last)).toMatchObject({ t: 'error', code: 'RESPONSE_TOO_LARGE' });
    expect(counts.end).toBe('RESPONSE_TOO_LARGE');
    expect(counts.bytes).toBeLessThanOrEqual(2500);
  });

  it.each([
    ['objects', ''],
    ['folder placeholders too, so a prefix of placeholders alone cannot list on and on', '/'],
  ])('counts %s: 10 001 under a prefix are refused on the eleventh listing page', async (_what, suffix) => {
    const objects: Record<string, string> = {};
    for (let index = 0; index <= 10_000; index += 1)
      objects[`p/${String(index).padStart(5, '0')}${suffix}`] = '';
    const gcs = mockGcs(BUCKET, objects);
    const plan = await planExportRead(
      { bucket: BUCKET, object: 'p/' },
      { client: client(gcs.fetch), token: TOKEN, stats: stats() },
      signal,
    );
    expect(plan).toMatchObject({ ok: false, frame: { code: 'TOO_MANY_OBJECTS' } });
    // 1 000 per listing page: it stops on the eleventh, never later.
    expect(gcs.calls).toHaveLength(11);
  });
});
