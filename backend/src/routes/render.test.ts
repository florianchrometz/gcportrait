// SPDX-License-Identifier: MIT
/**
 * `POST /api/render` over HTTP (Fastify `inject`, a pretend Google behind the allowlisted client, the render
 * job in process): every source and both formats with the bytes the command line and the library write, the
 * title block without the affiliation line, the checks in their order (token, schema, the source's authority,
 * the lock, the slots), every error code with `Retry-After` on the retryable ones, the limits, the gate
 * before every page of a pull, the page budget, slot and lock given back, uploads that time out or cannot be
 * read, a page that arrives after the client left, and one log line of counts without secrets. Everything is
 * synthetic (AGENTS.md, Security and privacy, principle 6).
 */
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import path from 'node:path';

import { RenderOptionsSchema } from '@gcportrait/model';
import {
  createSnapshotReader,
  initRasteriser,
  readDrawioFile,
  renderView,
  snapshotFromDemo,
  TAGLINE,
} from '@gcportrait/render';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ServiceAccountIdentity } from '../auth/identity.js';
import type { ServerConfig } from '../config.js';
import { answers, fakeGoogle, type FakeGoogleOptions, type Handler } from '../preflight/google.testing.js';
import { inProcessRunner } from '../render/in-process.js';
import { RenderLock } from '../render/lock.js';
import { createRun, RenderJobError, type RenderRunner } from '../render/runner.js';
import type { BuildServerOptions } from '../server.js';
import { listenOnLoopback, startTestServer } from '../server.testing.js';
import { tokenKeyOf } from '../stream/caller.js';
import { syntheticAsset } from '../stream/google.testing.js';
import { PageBudget } from '../stream/page-budget.js';
import { MAX_STREAMS_PER_TOKEN, STREAMS_BUSY_RETRY_SECONDS, StreamSlots } from '../stream/slots.js';
import {
  ACCOUNT_TOKEN,
  CALLER_EMAIL,
  CALLER_TOKEN,
  caiPager,
  fakeAccount,
  type RecordedCall,
} from '../upstream/google.testing.js';

vi.setConfig({ testTimeout: 120_000 });

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const GOLDEN = path.join(REPO_ROOT, 'e2e/baselines/render/S-overview-auto-light.png');
const baseline = (name: string): string =>
  readFileSync(path.join(REPO_ROOT, 'e2e/baselines/diagram', `${name}.svg`), 'utf8');
const READ_TIME = '2026-10-08T00:00:00Z';
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const OWN = { 'x-gcportrait-token': CALLER_TOKEN };
const PULL = {
  kind: 'scope',
  scope: 'folders/20000000001',
  mode: 'user',
  quotaProject: 'demo-quota-1',
} as const;

beforeAll(async () => {
  await initRasteriser();
});

/** A job that never answers: the timeout and the lock tests. */
const hangingRunner: RenderRunner = () =>
  createRun(
    () => undefined,
    () => undefined,
  ).run;

const testRunner = (): RenderRunner =>
  inProcessRunner({ clock: () => Date.parse(READ_TIME), entropy: () => 0.5 });

interface Started {
  readonly server: FastifyInstance;
  readonly logs: () => string[];
  readonly calls: () => RecordedCall[];
  readonly budget: PageBudget;
  readonly lock: RenderLock;
}

async function start(
  options: {
    readonly env?: Record<string, string>;
    readonly google?: FakeGoogleOptions;
    readonly runner?: RenderRunner;
    readonly lock?: RenderLock;
    readonly serviceAccount?: ServiceAccountIdentity;
    readonly limits?: Partial<NonNullable<ServerConfig['render']>>;
    readonly server?: Omit<BuildServerOptions, 'upstream'>;
  } = {},
): Promise<Started> {
  const google = fakeGoogle(options.google);
  const { limits } = options;
  const budget = new PageBudget(8 * 1024 * 1024);
  const lock = options.lock ?? new RenderLock();
  const { app, logs } = await startTestServer({
    env: options.env ?? {},
    logLevel: 'info',
    fetch: google.fetch,
    configure: (config) =>
      config.render === null || limits === undefined
        ? config
        : { ...config, render: { ...config.render, ...limits } },
    renderRunner: options.runner ?? testRunner(),
    renderLock: lock,
    renderRateLimitPerMinute: 1000,
    pageBudget: budget,
    ...(options.serviceAccount === undefined ? {} : { serviceAccount: options.serviceAccount }),
    ...options.server,
  });
  return { server: app, logs: logs.lines, calls: () => google.calls, budget, lock };
}

function post(app: FastifyInstance, body: unknown, headers: Record<string, string> = OWN) {
  return app.inject({
    method: 'POST',
    url: '/api/render',
    headers: { 'content-type': 'application/json', ...headers },
    payload: JSON.stringify(body),
  });
}

interface Part {
  readonly name: string;
  readonly value: string | Buffer;
  readonly filename?: string;
}

/** A multipart/form-data body, as curl -F writes one. */
function multipart(parts: readonly Part[]): { payload: Buffer; contentType: string } {
  const boundary = '----gcportrait-test-boundary';
  const pieces: Buffer[] = [];
  for (const part of parts) {
    const disposition =
      `Content-Disposition: form-data; name="${part.name}"` +
      (part.filename === undefined ? '' : `; filename="${part.filename}"`);
    const type = part.filename === undefined ? '' : '\r\nContent-Type: application/octet-stream';
    pieces.push(
      Buffer.from(`--${boundary}\r\n${disposition}${type}\r\n\r\n`),
      Buffer.from(part.value),
      Buffer.from('\r\n'),
    );
  }
  pieces.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(pieces), contentType: `multipart/form-data; boundary=${boundary}` };
}

function upload(
  app: FastifyInstance,
  request: unknown,
  file: string | Buffer | null,
  extra: readonly Part[] = [],
) {
  const body = multipart([
    { name: 'request', value: JSON.stringify(request) },
    ...(file === null ? [] : [{ name: 'file', value: file, filename: 'export.json' }]),
    ...extra,
  ]);
  const options: InjectOptions = {
    method: 'POST',
    url: '/api/render',
    headers: { ...OWN, 'content-type': body.contentType },
    payload: body.payload,
  };
  return app.inject(options);
}

/** `count` synthetic Compute Engine instances as Cloud Asset Inventory NDJSON. */
function syntheticNdjson(count: number): string {
  return Array.from({ length: count }, (_, index) => `${JSON.stringify(syntheticAsset(index))}\n`).join('');
}

/** What the library draws for the same NDJSON, as the export source reads it. */
async function libraryRenderOf(ndjson: string, format: 'svg' | 'png'): Promise<Buffer> {
  const reader = createSnapshotReader({
    kind: 'export',
    scope: null,
    readTime: READ_TIME,
    detail: 'render API upload',
    maxAssets: 60_000,
    clock: () => Date.parse(READ_TIME),
    entropy: () => 0.5,
  });
  reader.push(new TextEncoder().encode(ndjson));
  const snapshot = await reader.end();
  return Buffer.from(renderView(snapshot, RenderOptionsSchema.parse({ format })).bytes);
}

/** Cloud Asset Inventory's `assets.list` over `pages`. */
const caiPages = (pages: readonly (readonly unknown[])[]): ((call: RecordedCall) => Response) =>
  caiPager(pages, '2026-10-08T00:00:00.000000Z');

const errorOf = (body: string) =>
  JSON.parse(body) as {
    statusCode: number;
    code: string;
    message: string;
    requestId: string;
    reason?: string;
    retryable?: boolean;
    upstream?: { status: number; code?: string };
  };

/** Starts listening on a free loopback port; returns the route's URL. */
async function listening(app: FastifyInstance): Promise<URL> {
  return new URL(`http://127.0.0.1:${String(await listenOnLoopback(app))}/api/render`);
}

/** Sends `bytes` on a raw connection and resolves with the answer's status line and body once it closes. */
function rawExchange(url: URL, bytes: Buffer, waitMs = 10_000): Promise<{ status: string; body: string }> {
  return new Promise((resolve) => {
    let answer = '';
    const socket = connect(Number(url.port), url.hostname, () => {
      socket.write(bytes);
    });
    const timer = setTimeout(() => {
      socket.destroy();
    }, waitMs);
    socket.on('data', (chunk: Buffer) => {
      answer += chunk.toString('utf8');
    });
    socket.on('close', () => {
      clearTimeout(timer);
      const split = answer.indexOf('\r\n\r\n');
      resolve({
        status: answer.split('\r\n')[0] ?? '',
        body: split < 0 ? '' : answer.slice(split + 4),
      });
    });
    socket.on('error', () => undefined);
  });
}

/** The `outcome` of each `render ended` log line, in order. */
const outcomesOf = (lines: readonly string[]): unknown[] =>
  lines
    .filter((line) => line.includes('"message":"render ended"'))
    .map((line) => (JSON.parse(line) as { render: { outcome: unknown } }).render.outcome);

describe('POST /api/render: the bytes `pnpm render` writes', () => {
  // `pnpm render` and this route draw with the same render library (@gcportrait/render): the next test ties the
  // route's light PNG to the golden that packages/render-cli's golden.test.ts ties the command to, and both SVGs are
  // compared with the renderer's baselines here; every format and theme must also be the library's own bytes.
  it.each([
    ['light', 'png'],
    ['light', 'svg'],
    ['dark', 'png'],
    ['dark', 'svg'],
  ] as const)('draws demo S overview as the render library does: %s %s', async (theme, format) => {
    const { server: app } = await start();
    const response = await post(app, { source: { kind: 'demo', size: 'S' }, theme, format });
    expect(response.statusCode, response.body).toBe(200);
    const library = renderView(await snapshotFromDemo('S'), RenderOptionsSchema.parse({ theme, format }), {
      snapshotRef: 'demo:S',
    });
    expect(response.rawPayload.equals(Buffer.from(library.bytes))).toBe(true);
    if (format === 'svg') expect(response.body).toBe(baseline(`S-overview-auto-${theme}`));
  });

  it('answers a PNG with its headers: the golden’s bytes, the export name, the view, no notice', async () => {
    const { server: app, lock, logs } = await start();
    const response = await post(app, { source: { kind: 'demo', size: 'S' } });
    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      'content-type': 'image/png',
      'content-disposition': 'attachment; filename="gcportrait_example.com_overview_20261008T000000Z.png"',
      'content-length': String(response.rawPayload.byteLength),
      'cache-control': 'no-store',
      'x-gcportrait-view': 'snapshot=demo:S',
      'x-gcportrait-detail': 'all',
      'x-gcportrait-scale': '2',
    });
    // No non-affiliation header: the statement goes in footers and long-form texts, never with an export
    // (AGENTS.md, Non-affiliation, brand and legal).
    expect(response.headers['x-gcportrait-notice']).toBeUndefined();
    expect([...response.rawPayload.subarray(0, 8)]).toEqual(PNG_MAGIC);
    expect(response.rawPayload.equals(readFileSync(GOLDEN))).toBe(true);
    expect(lock.held).toBe(false);
    const line = logs().find((entry) => entry.includes('"message":"render ended"')) ?? '';
    expect(JSON.parse(line)).toMatchObject({
      render: { source: 'demo', format: 'png', theme: 'light', assets: 96, outcome: 'finished' },
    });
    expect(line).not.toContain(CALLER_TOKEN);
  });

  it('answers an SVG whose title block has its three lines and no affiliation line', async () => {
    const { server: app } = await start();
    const response = await post(app, {
      source: { kind: 'demo', size: 'M' },
      format: 'svg',
      theme: 'dark',
      view: { hash: 'snapshot=demo%3AXL&lens=networking&detail=networks' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
    expect(response.headers['x-gcportrait-view']).toBe('snapshot=demo:M&lens=networking&detail=networks');
    expect(response.headers['x-gcportrait-scale']).toBeUndefined();
    const svg = response.body;
    // The title block: scope, lens with read time, tagline; nothing else.
    const block = /<g class="dg-title-block"[^>]*>([\s\S]*?)<\/g>/.exec(svg)?.[1] ?? '';
    const lines = [...block.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);
    expect(lines).toEqual(['example.com', 'Networking lens · read 2026-10-08T00:00:00+00:00', TAGLINE]);
    expect(svg).not.toMatch(/affiliated/i);
    const library = renderView(
      await snapshotFromDemo('M'),
      RenderOptionsSchema.parse({
        format: 'svg',
        theme: 'dark',
        view: { lens: 'networking', detail: 'networks' },
      }),
      { snapshotRef: 'demo:M' },
    );
    expect(response.rawPayload.equals(Buffer.from(library.bytes))).toBe(true);
  });

  it('answers a `.drawio` file: the library’s bytes with the instance’s version, plain on request, no pixel limit', async () => {
    // The smallest pixel limit an instance takes: far below demo S's PNG at 2×, no limit for a `.drawio` file.
    const { server: app } = await start({ env: { RENDER_MAX_PIXELS: '1000000' } });
    const response = await post(app, { source: { kind: 'demo', size: 'S' }, format: 'drawio' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers).toMatchObject({
      'content-type': 'application/vnd.jgraph.mxfile',
      'content-disposition': 'attachment; filename="gcportrait_example.com_overview_20261008T000000Z.drawio"',
      'content-length': String(response.rawPayload.byteLength),
      'x-gcportrait-view': 'snapshot=demo:S',
      'x-gcportrait-detail': 'all',
    });
    expect(response.headers['x-gcportrait-scale']).toBeUndefined();
    const library = renderView(await snapshotFromDemo('S'), RenderOptionsSchema.parse({ format: 'drawio' }), {
      snapshotRef: 'demo:S',
      version: '9.9.9-test',
    });
    expect(response.rawPayload.equals(Buffer.from(library.bytes))).toBe(true);
    const read = readDrawioFile(response.body);
    expect(read.compressed).toBe(true);
    expect(read.attributes.get('agent')).toBe('gcportrait 9.9.9-test');
    expect(read.model).not.toMatch(/affiliated/i);
    const plain = await post(app, {
      source: { kind: 'demo', size: 'S' },
      format: 'drawio',
      compressed: false,
      fontSource: false,
    });
    expect(plain.statusCode).toBe(200);
    expect(plain.body).toContain('<mxGraphModel ');
    expect(plain.body).not.toContain('fontSource=');
  });

  it('lowers the scale to RENDER_MAX_PIXELS and says which; that scale gives the same bytes uncapped', async () => {
    const { server: app } = await start({ env: { RENDER_MAX_PIXELS: '1000000' } });
    const capped = await post(app, { source: { kind: 'demo', size: 'S' }, scale: 3 });
    expect(capped.statusCode).toBe(200);
    const scale = Number(capped.headers['x-gcportrait-scale']);
    expect(scale).toBeLessThan(3);
    const { server: roomy } = await start();
    const again = await post(roomy, { source: { kind: 'demo', size: 'S' }, scale });
    expect(again.headers['x-gcportrait-scale']).toBe(String(scale));
    expect(again.rawPayload.equals(capped.rawPayload)).toBe(true);
  });

  it('draws an uploaded export and bundle as the library reads them', async () => {
    const { server: app } = await start();
    const ndjson = syntheticNdjson(60);
    const response = await upload(
      app,
      { source: { kind: 'ndjson', readTime: READ_TIME }, format: 'svg' },
      ndjson,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.rawPayload.equals(await libraryRenderOf(ndjson, 'svg'))).toBe(true);
    expect(response.headers['x-gcportrait-view']).toBe('');

    const bundle = JSON.stringify({
      format: 'gcportrait.snapshot',
      version: 1,
      exportedAt: READ_TIME,
      generator: 'gcportrait',
      snapshot: await snapshotFromDemo('S'),
    });
    const drawn = await upload(app, { source: { kind: 'bundle' }, format: 'svg' }, bundle);
    expect(drawn.statusCode, drawn.body).toBe(200);
    expect(drawn.body).toBe(baseline('S-overview-auto-light'));
    const png = await upload(app, { source: { kind: 'bundle' } }, bundle);
    expect(png.rawPayload.equals(readFileSync(GOLDEN))).toBe(true);
  });
});

describe('POST /api/render: a live pull', () => {
  const pages = [
    Array.from({ length: 30 }, (_, index) => syntheticAsset(index)),
    Array.from({ length: 30 }, (_, index) => syntheticAsset(30 + index)),
  ];

  it('pulls page by page with the caller’s token and quota project, and gives the budget, slot and lock back', async () => {
    const { server: app, calls, budget, lock } = await start({ google: { list: caiPages(pages) } });
    const response = await post(app, { source: PULL, format: 'svg' });
    expect(response.statusCode, response.body).toBe(200);
    const list = calls().filter((call) => call.url.host === 'cloudasset.googleapis.com');
    expect(list).toHaveLength(2);
    for (const call of list) {
      expect(call.token).toBe(CALLER_TOKEN);
      expect(call.headers.get('x-goog-user-project')).toBe('demo-quota-1');
    }
    // Neither tokeninfo nor anything else: the pull proves the token itself.
    expect(calls().filter((call) => call.url.host !== 'cloudasset.googleapis.com')).toEqual([]);
    expect(budget.used).toBe(0);
    expect(lock.held).toBe(false);
    expect(response.body).toContain('<svg');
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="gcportrait_.+\.svg"$/);
    // The same frames read the same snapshot whichever way they arrive (pull or saved stream).
    const frames = pages
      .map(
        (page, index) =>
          `${JSON.stringify({ t: 'page', assets: page })}\n{"t":"progress","pages":${String(index + 1)},"assets":${String((index + 1) * 30)}}\n`,
      )
      .join('');
    const saved = await upload(
      app,
      { source: { kind: 'ndjson', scope: 'folders/20000000001' }, format: 'svg' },
      `${frames}{"t":"done","assets":60,"readTime":"2026-10-08T00:00:00.000000Z"}\n`,
    );
    expect(saved.statusCode, saved.body).toBe(200);
  });

  it('answers Google’s refusal with its status, code and reason, and a server error of Google’s as 502', async () => {
    const denied = await start({
      google: {
        list: () => answers.serviceDisabled('demo-quota-1'),
      },
    });
    const refused = await post(denied.server, { source: PULL });
    expect(refused.statusCode).toBe(403);
    expect(errorOf(refused.body)).toMatchObject({
      code: 'PERMISSION_DENIED',
      reason: 'SERVICE_DISABLED',
      requestId: refused.headers['x-request-id'],
    });
    expect(denied.lock.held).toBe(false);
    const broken = await start({ google: { list: () => answers.internal() } });
    const failed = await post(broken.server, { source: PULL });
    expect(failed.statusCode).toBe(502);
    expect(errorOf(failed.body)).toMatchObject({
      code: 'INTERNAL',
      retryable: true,
      upstream: { status: 500, code: 'INTERNAL' },
    });
    const expired = await start({ google: { list: () => answers.unauthenticated() } });
    const signIn = await post(expired.server, { source: PULL });
    expect(signIn.statusCode).toBe(401);
    expect(signIn.headers['www-authenticate']).toBe('Bearer');
    expect(errorOf(signIn.body).code).toBe('UNAUTHENTICATED');
    const missing = await start({ google: { list: () => answers.notFound() } });
    expect((await post(missing.server, { source: PULL })).statusCode).toBe(404);
  });

  it('stops the pull once it passes RENDER_MAX_ASSETS', async () => {
    const {
      server: app,
      calls,
      budget,
    } = await start({
      env: { RENDER_MAX_ASSETS: '40' },
      google: { list: caiPages([...pages, pages[0] ?? []]) },
    });
    const response = await post(app, { source: PULL });
    expect(response.statusCode).toBe(422);
    expect(errorOf(response.body)).toMatchObject({ code: 'TOO_MANY_ASSETS' });
    expect(errorOf(response.body).message).toContain('more than 40 assets');
    expect(calls().filter((call) => call.url.host === 'cloudasset.googleapis.com')).toHaveLength(2);
    expect(budget.used).toBe(0);
  });

  it('in service-account mode, runs the gate before every page with the account’s token', async () => {
    const identity = fakeAccount();
    const {
      server: app,
      calls,
      logs,
    } = await start({
      env: { SA_MODE_ENABLED: 'true' },
      serviceAccount: identity,
      google: { list: caiPages(pages) },
    });
    const response = await post(app, {
      source: { kind: 'scope', scope: 'folders/20000000001', mode: 'sa' },
      format: 'svg',
    });
    expect(response.statusCode, response.body).toBe(200);
    const list = calls().filter((call) => call.url.host === 'cloudasset.googleapis.com');
    expect(list.map((call) => call.token)).toEqual([ACCOUNT_TOKEN, ACCOUNT_TOKEN]);
    expect(list.every((call) => call.headers.get('x-goog-user-project') === null)).toBe(true);
    const audits = logs().filter((line) => line.includes('"event":"sa-gate"'));
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits.every((line) => line.includes('"route":"render"'))).toBe(true);
    for (const line of logs()) {
      for (const secret of [CALLER_TOKEN, ACCOUNT_TOKEN, CALLER_EMAIL]) expect(line).not.toContain(secret);
      expect(line.includes('"message":"render ended"') ? line : '').not.toContain('folders/20000000001');
    }

    // A refusal before the first page is the gate's own answer; the mode off is 403, no identity 501.
    const refused = await start({
      env: { SA_MODE_ENABLED: 'true' },
      serviceAccount: identity,
      google: { testIam: () => answers.permissions([]) },
    });
    const gate = await post(refused.server, {
      source: { kind: 'scope', scope: 'folders/20000000001', mode: 'sa' },
    });
    expect(gate.statusCode).toBe(403);
    expect(errorOf(gate.body).code).toBe('SA_GATE_CALLER_DENIED');
    expect(refused.lock.held).toBe(false);
    const off = await start();
    const offAnswer = await post(off.server, {
      source: { kind: 'scope', scope: 'folders/20000000001', mode: 'sa' },
    });
    expect(offAnswer.statusCode).toBe(403);
    expect(errorOf(offAnswer.body).code).toBe('SA_MODE_OFF');
    const noIdentity = await start({ env: { SA_MODE_ENABLED: 'true' } });
    const unavailable = await post(noIdentity.server, {
      source: { kind: 'scope', scope: 'folders/20000000001', mode: 'sa' },
    });
    expect(unavailable.statusCode).toBe(501);
    expect(errorOf(unavailable.body).code).toBe('SA_MODE_UNAVAILABLE');
  });

  it('503 SA_CREDENTIALS_UNAVAILABLE with Retry-After, before the first page and in the middle of the pull', async () => {
    // The account's token fails from its `fromRun`th request on: the gate's first run, or its run before page 2.
    const failingFrom = (fromRun: number): ServiceAccountIdentity => {
      let runs = 0;
      return fakeAccount(() => {
        runs += 1;
        return runs < fromRun
          ? Promise.resolve(ACCOUNT_TOKEN)
          : Promise.reject(new Error('metadata server gone'));
      });
    };
    for (const fromRun of [1, 2]) {
      const {
        server: app,
        calls,
        lock,
        budget,
      } = await start({
        env: { SA_MODE_ENABLED: 'true' },
        serviceAccount: failingFrom(fromRun),
        google: { list: caiPages(pages) },
      });
      const response = await post(app, {
        source: { kind: 'scope', scope: 'folders/20000000001', mode: 'sa' },
      });
      expect(response.statusCode, response.body).toBe(503);
      expect(errorOf(response.body)).toMatchObject({ code: 'SA_CREDENTIALS_UNAVAILABLE', retryable: true });
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
      expect(calls().filter((call) => call.url.host === 'cloudasset.googleapis.com')).toHaveLength(
        fromRun - 1,
      );
      expect(lock.held).toBe(false);
      expect(budget.used).toBe(0);
    }
  });

  it('a page that arrives after the client left crashes nothing: the process lives, the lock is given back', async () => {
    // Google answers a page after the client went away (the stub ignores the abort), the pull hands the frame
    // to the route, and the stopped job refuses it. That refusal must be handled, or Node exits.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      let asked = (): void => undefined;
      const pageAsked = new Promise<void>((resolve) => {
        asked = resolve;
      });
      let leave = (): void => undefined;
      const clientLeft = new Promise<void>((resolve) => {
        leave = resolve;
      });
      let answered = false;
      const late: Handler = async (call) => {
        asked();
        await clientLeft;
        answered = true;
        return caiPages(pages)(call);
      };
      const { server: app, lock, budget, logs } = await start({ google: { list: late } });
      const url = await listening(app);
      // node:http rather than fetch: a browser or script leaving is just the closed socket.
      const client = httpRequest(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...OWN },
      });
      client.on('error', () => undefined);
      client.end(JSON.stringify({ source: PULL }));
      await pageAsked;
      client.destroy();
      await expect.poll(() => outcomesOf(logs())).toEqual(['client-gone']);
      expect(lock.held).toBe(false);
      leave();
      await expect.poll(() => answered).toBe(true);
      // Time for the page to be read, framed and handed to the route.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(unhandled).toEqual([]);
      expect(lock.held).toBe(false);
      expect(budget.used).toBe(0);
      // The instance still answers.
      expect((await post(app, { source: { kind: 'demo', size: 'S' }, format: 'svg' })).statusCode).toBe(200);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('POST /api/render: refusals', () => {
  it('401 without a token, or one tokeninfo calls invalid; 503 when tokeninfo cannot tell', async () => {
    const { server: app, calls } = await start();
    const none = await post(app, { source: { kind: 'demo', size: 'S' } }, {});
    expect(none.statusCode).toBe(401);
    expect(none.headers['www-authenticate']).toBe('Bearer');
    expect(errorOf(none.body)).toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED' });
    expect(calls()).toEqual([]);
    // Authorization: Bearer is taken when X-Gcportrait-Token is absent (AGENTS.md, Security and privacy,
    // Tokens).
    const bearer = await post(
      app,
      { source: { kind: 'demo', size: 'S' }, format: 'svg' },
      {
        authorization: `Bearer ${CALLER_TOKEN}`,
      },
    );
    expect(bearer.statusCode).toBe(200);
    expect(calls().map((call) => call.url.host)).toEqual(['oauth2.googleapis.com']);

    const invalid = await start({ google: { tokeninfo: () => answers.invalidToken() } });
    const refused = await post(invalid.server, { source: { kind: 'demo', size: 'S' } });
    expect(refused.statusCode).toBe(401);
    expect(errorOf(refused.body).code).toBe('UNAUTHENTICATED');
    expect(invalid.lock.held).toBe(false);
    const silent = await start({ google: { tokeninfo: () => answers.unavailable() } });
    const unknown = await post(silent.server, { source: { kind: 'demo', size: 'S' } });
    expect(unknown.statusCode).toBe(503);
    expect(errorOf(unknown.body)).toMatchObject({ code: 'TOKEN_CHECK_UNAVAILABLE', retryable: true });
    expect(unknown.headers['retry-after']).toBe('10');
  });

  it('429 RATE_LIMITED past ten renders a minute per token', async () => {
    const { server: app } = await start({ server: { renderRateLimitPerMinute: 1 } });
    expect((await post(app, { source: { kind: 'demo', size: 'S' }, format: 'svg' })).statusCode).toBe(200);
    const limited = await post(app, { source: { kind: 'demo', size: 'S' }, format: 'svg' });
    expect(limited.statusCode).toBe(429);
    expect(errorOf(limited.body).code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it.each([
    [{ source: { kind: 'demo', size: 'XXL' } }, 'source'],
    [{ source: { kind: 'demo', size: 'S' }, scale: 4 }, 'scale'],
    [{ source: { kind: 'demo', size: 'S' }, scale: 2, width: 800 }, 'width: give scale or width, not both'],
    [{ source: { kind: 'demo', size: 'S' }, format: 'svg', scale: 2 }, 'scale: applies to a PNG only'],
    [{ source: { kind: 'demo', size: 'S' }, format: 'drawio', width: 800 }, 'width: applies to a PNG only'],
    [
      { source: { kind: 'demo', size: 'S' }, format: 'svg', compressed: false },
      'compressed: applies to a draw.io file only',
    ],
    [
      { source: { kind: 'demo', size: 'S' }, view: { hash: 'tick=2026-10-01' } },
      'view.hash: names a timeline day',
    ],
    [
      { source: { kind: 'demo', size: 'S' }, view: { hash: 'lens=networking', lens: 'overview' } },
      'view.lens',
    ],
    [{ source: { kind: 'demo', size: 'S' }, view: { lens: 'nope' } }, 'view.lens'],
    [{ source: { kind: 'demo', size: 'S' }, token: CALLER_TOKEN }, 'Unrecognized key'],
    [
      { source: { kind: 'scope', scope: 'folders/20000000001', mode: 'user' } },
      'source.quotaProject: is required',
    ],
    [{ source: { kind: 'scope', scope: 'evil-scope', mode: 'sa' } }, 'source.scope'],
  ])('400 INVALID_REQUEST for %j', async (body, message) => {
    const { server: app, calls } = await start();
    const response = await post(app, body);
    expect(response.statusCode).toBe(400);
    const error = errorOf(response.body);
    expect(error.code).toBe('INVALID_REQUEST');
    expect(error.message).toContain(message);
    expect(error.message).not.toContain(CALLER_TOKEN);
    expect(error.message).not.toContain('evil-scope');
    expect(calls()).toEqual([]);
  });

  it('415 for a source in the wrong body, or an upload without its file; 413 past the limits', async () => {
    const { server: app } = await start();
    const json415 = await post(app, { source: { kind: 'bundle' } });
    expect(json415.statusCode).toBe(415);
    expect(errorOf(json415.body).code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const multipart415 = await upload(app, { source: { kind: 'demo', size: 'S' } }, 'x');
    expect(multipart415.statusCode).toBe(415);
    const noFile = await upload(app, { source: { kind: 'bundle' } }, null);
    expect(noFile.statusCode).toBe(415);
    expect(errorOf(noFile.body).message).toContain('file part is missing');
    const fileFirst = multipart([
      { name: 'file', value: 'x', filename: 'a.json' },
      { name: 'request', value: '{"source":{"kind":"bundle"}}' },
    ]);
    const wrongOrder = await app.inject({
      method: 'POST',
      url: '/api/render',
      headers: { ...OWN, 'content-type': fileFirst.contentType },
      payload: fileFirst.payload,
    });
    expect(wrongOrder.statusCode).toBe(400);
    expect(errorOf(wrongOrder.body).code).toBe('INVALID_REQUEST');
    const text = await app.inject({
      method: 'POST',
      url: '/api/render',
      headers: { ...OWN, 'content-type': 'application/xml' },
      payload: '<draw/>',
    });
    expect(text.statusCode).toBe(415);
    expect(errorOf(text.body).code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const big = await post(app, { source: { kind: 'demo', size: 'S' }, view: { hash: 'x'.repeat(70_000) } });
    expect(big.statusCode).toBe(413);
    expect(errorOf(big.body).code).toBe('BODY_TOO_LARGE');
    const small = await start({ env: { RENDER_MAX_BODY_BYTES: '1048576' } });
    const tooLarge = await upload(small.server, { source: { kind: 'ndjson' } }, syntheticNdjson(1200));
    expect(tooLarge.statusCode).toBe(413);
    expect(errorOf(tooLarge.body).code).toBe('BODY_TOO_LARGE');
    expect(small.lock.held).toBe(false);
  });

  it('422 for an unreadable file, no assets, too many assets, and a refused view', async () => {
    const { server: app } = await start({ env: { RENDER_MAX_ASSETS: '50' } });
    const bundleAsNdjson = await upload(
      app,
      { source: { kind: 'ndjson' } },
      '{"format":"gcportrait.snapshot","version":1}',
    );
    expect(bundleAsNdjson.statusCode).toBe(422);
    expect(errorOf(bundleAsNdjson.body)).toMatchObject({ code: 'INVALID_FILE' });
    const ndjsonAsBundle = await upload(app, { source: { kind: 'bundle' } }, syntheticNdjson(2));
    expect(errorOf(ndjsonAsBundle.body)).toMatchObject({ code: 'INVALID_FILE' });
    expect(ndjsonAsBundle.statusCode).toBe(422);
    const empty = await upload(app, { source: { kind: 'ndjson' } }, '\n');
    expect(errorOf(empty.body)).toMatchObject({ code: 'EMPTY_SNAPSHOT' });
    const many = await upload(app, { source: { kind: 'ndjson' } }, syntheticNdjson(60));
    expect(errorOf(many.body)).toMatchObject({ code: 'TOO_MANY_ASSETS' });
    const demo = await post(app, { source: { kind: 'demo', size: 'S' } });
    expect(demo.statusCode).toBe(422);
    expect(errorOf(demo.body).message).toContain('more than 50 assets');

    const { server: roomy } = await start();
    const root = await post(roomy, { source: { kind: 'demo', size: 'S' }, view: { root: 'no-such-node' } });
    expect(root.statusCode).toBe(422);
    expect(errorOf(root.body)).toMatchObject({ code: 'VIEW_REFUSED' });
    expect(errorOf(root.body).message).toMatch(/^root: /);
  });

  it('429 RENDER_BUSY while another render runs, and STREAMS_BUSY with four streams for the token, each with Retry-After', async () => {
    const lock = new RenderLock();
    const slots = new StreamSlots();
    const { server: app, calls } = await start({
      lock,
      server: { streamSlots: slots },
      google: { list: caiPages([Array.from({ length: 3 }, (_, index) => syntheticAsset(index))]) },
    });
    const release = lock.acquire();
    const busy = await post(app, { source: { kind: 'demo', size: 'S' } });
    expect(busy.statusCode).toBe(429);
    expect(errorOf(busy.body)).toMatchObject({ code: 'RENDER_BUSY', retryable: true });
    expect(busy.headers['retry-after']).toBe('10');
    release?.();
    expect((await post(app, { source: { kind: 'demo', size: 'S' }, format: 'svg' })).statusCode).toBe(200);

    // Four streams of the caller's token already run (pulls of the app or of other renders): a pull is refused
    // before anything is asked of Google, and the render lock it took is given back.
    const running = Array.from({ length: MAX_STREAMS_PER_TOKEN }, () =>
      slots.acquire(tokenKeyOf(CALLER_TOKEN)),
    );
    expect(running.every((slot) => slot !== null)).toBe(true);
    const streams = await post(app, { source: PULL, format: 'svg' });
    expect(streams.statusCode).toBe(429);
    expect(errorOf(streams.body)).toMatchObject({ code: 'STREAMS_BUSY', retryable: true });
    expect(streams.headers['retry-after']).toBe(String(STREAMS_BUSY_RETRY_SECONDS));
    expect(calls().filter((call) => call.url.host === 'cloudasset.googleapis.com')).toEqual([]);
    expect(lock.held).toBe(false);
    expect(slots.inUse(tokenKeyOf(CALLER_TOKEN))).toBe(MAX_STREAMS_PER_TOKEN);
    // A source that pulls nothing takes no slot; once a slot is free the pull runs and gives it back.
    expect((await post(app, { source: { kind: 'demo', size: 'S' }, format: 'svg' })).statusCode).toBe(200);
    running[0]?.();
    const pulled = await post(app, { source: PULL, format: 'svg' });
    expect(pulled.statusCode, pulled.body).toBe(200);
    expect(slots.inUse(tokenKeyOf(CALLER_TOKEN))).toBe(MAX_STREAMS_PER_TOKEN - 1);
    for (const slot of running) slot?.();
    expect(slots.size).toBe(0);
  });

  it('503 RENDER_TIMEOUT when the render takes longer than RENDER_TIMEOUT_MS, the lock given back', async () => {
    const { server: app, lock } = await start({ runner: hangingRunner, limits: { timeoutMs: 50 } });
    const response = await post(app, { source: { kind: 'demo', size: 'S' } });
    expect(response.statusCode).toBe(503);
    expect(errorOf(response.body)).toMatchObject({ code: 'RENDER_TIMEOUT' });
    expect(lock.held).toBe(false);
  });

  it('503 RENDER_TOO_LARGE when the worker runs out of heap; 500 INTERNAL for a bug, without its text', async () => {
    const failing =
      (error: RenderJobError): RenderRunner =>
      () => {
        const channel = createRun(
          () => undefined,
          () => undefined,
        );
        queueMicrotask(() => {
          channel.fail(error);
        });
        return channel.run;
      };
    const { server: app } = await start({
      runner: failing(new RenderJobError('RENDER_TOO_LARGE', 'The render needed more memory.')),
    });
    const large = await post(app, { source: { kind: 'demo', size: 'S' } });
    expect(large.statusCode).toBe(503);
    expect(errorOf(large.body)).toMatchObject({ code: 'RENDER_TOO_LARGE' });
    const { server: buggy } = await start({
      runner: failing(new RenderJobError('INTERNAL', 'TypeError: secret detail')),
    });
    const internal = await post(buggy, { source: { kind: 'demo', size: 'S' } });
    expect(internal.statusCode).toBe(500);
    expect(errorOf(internal.body)).toMatchObject({ code: 'INTERNAL', message: 'Internal error.' });
    expect(internal.body).not.toContain('secret');
  });
});

describe('POST /api/render: uploads that time out or cannot be read', () => {
  const request = JSON.stringify({ source: { kind: 'ndjson', readTime: READ_TIME }, format: 'svg' });
  const whole = multipart([
    { name: 'request', value: request },
    { name: 'file', value: syntheticNdjson(40), filename: 'export.ndjson' },
  ]);

  it('400 INVALID_REQUEST for a multipart body without a boundary, or one cut short; never 500', async () => {
    const { server: app, lock, logs } = await start();
    const send = (contentType: string, payload: Buffer) =>
      app.inject({
        method: 'POST',
        url: '/api/render',
        headers: { ...OWN, 'content-type': contentType },
        payload,
      });
    const noBoundary = await send('multipart/form-data', whole.payload);
    expect(noBoundary.statusCode, noBoundary.body).toBe(400);
    expect(errorOf(noBoundary.body)).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(errorOf(noBoundary.body).message).toContain('multipart body could not be read');
    // Cut inside the request field, and inside the file part (its data and closing boundary never come).
    const insideRequest = whole.payload.indexOf('"kind"');
    for (const end of [insideRequest, whole.payload.length - 200]) {
      const cut = await send(whole.contentType, whole.payload.subarray(0, end));
      expect(cut.statusCode, cut.body).toBe(400);
      expect(errorOf(cut.body)).toMatchObject({ code: 'INVALID_REQUEST' });
      expect(cut.headers.connection).toBe('close');
      expect(lock.held).toBe(false);
    }
    // Only the cut file had started a render: its log line says how it ended.
    expect(outcomesOf(logs())).toEqual(['INVALID_REQUEST']);
    // The whole body still draws.
    expect((await send(whole.contentType, whole.payload)).statusCode).toBe(200);
  });

  it('408 REQUEST_TIMEOUT for an upload still arriving at the body deadline, logged so, the lock given back', async () => {
    const { server: app, lock, logs } = await start({ server: { requestTimeoutMs: 300 } });
    const url = await listening(app);
    const head = Buffer.from(
      `POST /api/render HTTP/1.1\r\nHost: localhost\r\nX-Gcportrait-Token: ${CALLER_TOKEN}\r\n` +
        `Content-Type: ${whole.contentType}\r\nContent-Length: ${String(whole.payload.length)}\r\n\r\n`,
    );
    // All but the file's last 200 bytes, then nothing: the render has started and waits for the rest.
    const started = Date.now();
    const answer = await rawExchange(url, Buffer.concat([head, whole.payload.subarray(0, -200)]));
    expect(answer.status).toBe('HTTP/1.1 408 Request Timeout');
    expect(errorOf(answer.body)).toMatchObject({ statusCode: 408, code: 'REQUEST_TIMEOUT' });
    expect(errorOf(answer.body).message).toContain('did not arrive');
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(lock.held).toBe(false);
    await expect.poll(() => outcomesOf(logs())).toEqual(['REQUEST_TIMEOUT']);
    // Stalled inside the request field, before any render started: the same answer, and no render log line.
    const early = await rawExchange(
      url,
      Buffer.concat([head, whole.payload.subarray(0, whole.payload.indexOf('"kind"'))]),
    );
    expect(early.status).toBe('HTTP/1.1 408 Request Timeout');
    expect(errorOf(early.body).code).toBe('REQUEST_TIMEOUT');
    expect(outcomesOf(logs())).toEqual(['REQUEST_TIMEOUT']);
    expect(lock.held).toBe(false);
  });
});

describe('POST /api/render: where it exists', () => {
  it('is absent with RENDER_API=false and on a demo-only instance: the JSON 404 of an unknown route', async () => {
    for (const env of [{ RENDER_API: 'false' }, { DEMO_ONLY: 'true' }]) {
      const { server: app, calls } = await start({ env });
      const response = await post(app, { source: { kind: 'demo', size: 'S' } });
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(calls()).toEqual([]);
    }
  });
});
