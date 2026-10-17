// SPDX-License-Identifier: MIT
import { request } from 'node:http';

import { IngestError, ingest } from '@gcportrait/ingest';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { listenOnLoopback, startTestServer, type TestServerOptions } from '../server.testing.js';
import { READ_TIME, linesOf, mockCai, syntheticPages, type Override } from '../stream/google.testing.js';
import {
  ACCOUNT_TOKEN,
  bodyOf,
  chunkedBody,
  fakeAccount,
  googleError,
  htmlResponse,
  jsonResponse,
  recordingSleep,
  untilAborted,
  type RecordedCall,
} from '../upstream/google.testing.js';
import type { UpstreamFetch } from '../upstream/request.js';

const TOKEN = 'ya29.synthetic-test-token';
const OTHER_TOKEN = 'ya29.another-synthetic-token';
const BODY = {
  scope: 'projects/demo-app-1',
  contentType: 'RESOURCE',
  mode: 'user',
  quotaProject: 'demo-quota-1',
} as const;

/**
 * A server whose Google is `fetch`, with the backoff's delays recorded (jitter at the middle of its range) and
 * its log lines captured, so tests can prove what is and is not logged.
 */
async function start(
  fetch: UpstreamFetch,
  options: Omit<TestServerOptions, 'fetch'> = {},
): Promise<{ readonly app: FastifyInstance; readonly delays: number[]; readonly logs: () => string[] }> {
  const { sleep, delays } = recordingSleep();
  const { app, logs } = await startTestServer({
    logLevel: 'info',
    ...options,
    fetch,
    upstream: { sleep, random: () => 0.5, ...options.upstream },
  });
  return { app, delays, logs: logs.lines };
}

function post(app: FastifyInstance, body: unknown, token = TOKEN) {
  return app.inject({
    method: 'POST',
    url: '/api/assets/stream',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    payload: JSON.stringify(body),
  });
}

type Frame = Record<string, unknown> & { readonly t: string };
const framesOf = (body: string): Frame[] => linesOf(body) as Frame[];

describe('POST /api/assets/stream: pagination and frames', () => {
  it('lists page by page and streams the frames @gcportrait/ingest reads', async () => {
    const pages = syntheticPages(1120);
    const cai = mockCai(pages);
    const { app } = await start(cai.fetch);
    const response = await post(app, BODY);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    const frames = framesOf(response.body);
    expect(frames.map((frame) => frame.t)).toEqual([
      'progress',
      'page',
      'progress',
      'page',
      'progress',
      'page',
      'progress',
      'done',
    ]);
    expect(frames.filter((frame) => frame.t === 'progress')).toEqual([
      { t: 'progress', pages: 0, assets: 0 },
      { t: 'progress', pages: 1, assets: 500 },
      { t: 'progress', pages: 2, assets: 1000 },
      { t: 'progress', pages: 3, assets: 1120 },
    ]);
    expect(frames.at(-1)).toEqual({ t: 'done', assets: 1120, readTime: READ_TIME });
    expect(frames[1]).toEqual({ t: 'page', assets: pages[0] });

    // What Google was asked: POST with the method override, the body, the token and the quota project.
    expect(cai.calls).toHaveLength(3);
    cai.calls.forEach((call, index) => {
      expect(call.url.href).toBe('https://cloudasset.googleapis.com/v1/projects/demo-app-1/assets');
      expect(call.method).toBe('POST');
      expect(call.headers.get('x-http-method-override')).toBe('GET');
      expect(call.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
      expect(call.headers.get('x-goog-user-project')).toBe('demo-quota-1');
      expect(bodyOf(call)).toEqual({
        contentType: 'RESOURCE',
        pageSize: 500,
        ...(index === 0 ? {} : { pageToken: `page-${String(index)}` }),
      });
    });

    const { snapshot, report } = await ingest(response.body, {
      scope: { kind: 'project', id: 'demo-app-1' },
      source: { kind: 'api', detail: 'live pull' },
      clock: () => Date.parse('2026-10-10T00:00:00Z'),
      entropy: () => 0.5,
    });
    expect(snapshot.assets).toHaveLength(1120);
    expect(snapshot.readTime).toBe(READ_TIME);
    expect(snapshot.readTimeSource).toBe('api');
    expect(report.malformed).toBe(0);
    expect(report.upstream).toEqual({ pages: 3, complete: true, reportedAssets: 1120, readTime: READ_TIME });
  });

  it('passes readTime and assetTypes on, verbatim', async () => {
    const cai = mockCai([[]]);
    const { app } = await start(cai.fetch);
    const readTime = '2026-10-01T00:00:00Z';
    const assetTypes = ['compute.googleapis.com/.*', 'cloudresourcemanager.googleapis.com/Project'];
    const response = await post(app, { ...BODY, readTime, assetTypes });
    expect(response.statusCode).toBe(200);
    expect(cai.calls.map(bodyOf)).toEqual([{ contentType: 'RESOURCE', pageSize: 500, readTime, assetTypes }]);
  });

  it('streams an empty scope (a page without "assets") as an empty page', async () => {
    const { app } = await start(mockCai([[]]).fetch);
    const frames = framesOf((await post(app, BODY)).body);
    expect(frames).toEqual([
      { t: 'progress', pages: 0, assets: 0 },
      { t: 'page', assets: [] },
      { t: 'progress', pages: 1, assets: 0 },
      { t: 'done', assets: 0, readTime: READ_TIME },
    ]);
  });

  it('percent-encodes a domain-scoped project id in the URL', async () => {
    const cai = mockCai([[]]);
    const { app } = await start(cai.fetch);
    await post(app, { ...BODY, scope: 'projects/example.com:demo-app' });
    expect(cai.calls[0]?.url.pathname).toBe('/v1/projects/example.com%3Ademo-app/assets');
  });
});

describe('POST /api/assets/stream: retries (500 ms, ×2, ≤ 8 s, jitter, 5 attempts)', () => {
  it('retries 503 and 429 with backoff, then goes on', async () => {
    const cai = mockCai(syntheticPages(700), {
      override: (_call, index) =>
        index === 1
          ? googleError(503, 'UNAVAILABLE', 'The service is currently unavailable.')
          : index === 2
            ? googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded for quota metric.')
            : undefined,
    });
    const { app, delays, logs } = await start(cai.fetch);
    const frames = framesOf((await post(app, BODY)).body);
    expect(frames.at(-1)).toEqual({ t: 'done', assets: 700, readTime: READ_TIME });
    expect(cai.calls).toHaveLength(4);
    // Page 2 was asked three times, each time with the same page token.
    expect(cai.calls.slice(1).map((call) => (bodyOf(call) as { pageToken?: string }).pageToken)).toEqual([
      'page-1',
      'page-1',
      'page-1',
    ]);
    // random() = 0.5: three quarters of 500 ms, then of 1 s.
    expect(delays).toEqual([375, 750]);
    const retries = logs().filter((line) => line.includes('retrying upstream'));
    expect(retries).toHaveLength(2);
    const ended = logs().find((line) => line.includes('asset stream ended'));
    expect(ended).toBeDefined();
    expect(JSON.parse(ended ?? '{}')).toMatchObject({
      pages: 2,
      assets: 700,
      retries: 2,
      end: 'done',
      outcome: 'finished',
    });
  });

  it('ends with a retryable error frame after five attempts, Google’s message verbatim', async () => {
    const cai = mockCai(syntheticPages(10), {
      override: () => googleError(503, 'UNAVAILABLE', 'The service is currently unavailable.'),
    });
    const { app, delays } = await start(cai.fetch);
    const frames = framesOf((await post(app, BODY)).body);
    expect(cai.calls).toHaveLength(5);
    expect(delays).toEqual([375, 750, 1500, 3000]);
    expect(frames).toEqual([
      { t: 'progress', pages: 0, assets: 0 },
      {
        t: 'error',
        message: 'The service is currently unavailable.',
        status: 503,
        code: 'UNAVAILABLE',
        retryable: true,
      },
    ]);
  });

  it('retries a page that does not answer in time and reports the timeout', async () => {
    const cai = mockCai(syntheticPages(10), { override: (call) => untilAborted(call.signal) });
    // A 60 s timeout per attempt would make this test slow; the client's timeout is an option.
    const { app } = await start(cai.fetch, { upstream: { timeoutMs: 20 } });
    const frames = framesOf((await post(app, BODY)).body);
    expect(cai.calls).toHaveLength(5);
    expect(frames.at(-1)).toMatchObject({
      t: 'error',
      status: 504,
      code: 'UPSTREAM_TIMEOUT',
      retryable: true,
    });
    expect(frames.at(-1)?.message).toBe(
      'Google did not answer within 0 s for a page of Cloud Asset Inventory results (5 attempts). Try again later.',
    );
  });
});

describe('POST /api/assets/stream: Google’s errors as frames', () => {
  const cases = [
    {
      name: 'a 400 on assetTypes',
      answer: () =>
        googleError(
          400,
          'INVALID_ARGUMENT',
          'No RESOURCE found that matches asset type nonexistent.googleapis.com/Nothing for consumer project: 10000000001.',
        ),
      frame: {
        status: 400,
        code: 'INVALID_ARGUMENT',
        message:
          'No RESOURCE found that matches asset type nonexistent.googleapis.com/Nothing for consumer project: 10000000001.',
      },
    },
    {
      name: 'CAI’s own 403 (no reason)',
      answer: () =>
        googleError(
          403,
          'PERMISSION_DENIED',
          'Request denied by Cloud IAM. Missing required IAM permission on requested scope.',
        ),
      frame: {
        status: 403,
        code: 'PERMISSION_DENIED',
        message: 'Request denied by Cloud IAM. Missing required IAM permission on requested scope.',
      },
    },
    {
      name: 'a disabled API in the quota project',
      answer: () =>
        googleError(
          403,
          'PERMISSION_DENIED',
          'Cloud Asset API has not been used in project demo-quota-1 before or it is disabled.',
          'SERVICE_DISABLED',
        ),
      frame: {
        status: 403,
        code: 'PERMISSION_DENIED',
        reason: 'SERVICE_DISABLED',
        message: 'Cloud Asset API has not been used in project demo-quota-1 before or it is disabled.',
      },
    },
    {
      name: 'a readTime before the scope existed',
      answer: () => googleError(404, 'NOT_FOUND', 'Requested entity was not found.'),
      frame: { status: 404, code: 'NOT_FOUND', message: 'Requested entity was not found.' },
    },
    {
      name: 'an expired token',
      answer: () => googleError(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.'),
      frame: {
        status: 401,
        code: 'UNAUTHENTICATED',
        message: 'Request had invalid authentication credentials.',
      },
    },
    {
      name: 'an HTML page (never forwarded)',
      answer: () => htmlResponse(404),
      frame: {
        status: 404,
        code: 'NOT_FOUND',
        message: 'Google answered HTTP 404 without a readable error message.',
      },
    },
  ] as const;

  for (const { name, answer, frame } of cases) {
    it(`surfaces ${name} at once, without a retry`, async () => {
      const cai = mockCai(syntheticPages(10), { override: () => answer() });
      const { app, delays } = await start(cai.fetch);
      const response = await post(app, BODY);
      expect(response.statusCode).toBe(200);
      expect(framesOf(response.body)).toEqual([
        { t: 'progress', pages: 0, assets: 0 },
        { t: 'error', ...frame },
      ]);
      expect(cai.calls).toHaveLength(1);
      expect(delays).toEqual([]);
      const failure = await ingest(response.body, {
        scope: { kind: 'project', id: 'demo-app-1' },
        source: { kind: 'api' },
        clock: () => 0,
        entropy: () => 0.5,
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(IngestError);
      expect(failure).toMatchObject({
        code: 'upstream',
        message: frame.message,
        upstream: { status: frame.status, code: frame.code },
      });
    });
  }

  it('ends a stream that fails after its first page with the error frame', async () => {
    const cai = mockCai(syntheticPages(800), {
      override: (_call, index) =>
        index === 1 ? googleError(403, 'PERMISSION_DENIED', 'Denied.') : undefined,
    });
    const { app } = await start(cai.fetch);
    const frames = framesOf((await post(app, BODY)).body);
    expect(frames.map((frame) => frame.t)).toEqual(['progress', 'page', 'progress', 'error']);
  });

  it('refuses a page over 25 MiB, declared or streamed, without a retry', async () => {
    const big = 25 * 1024 * 1024 + 1;
    for (const answer of [
      () => new Response('{}', { status: 200, headers: { 'content-length': String(big) } }),
      () => new Response(chunkedBody(new Uint8Array(big).fill(0x20), 1024 * 1024), { status: 200 }),
    ]) {
      const cai = mockCai([[]], { override: () => answer() });
      const { app } = await start(cai.fetch);
      const frames = framesOf((await post(app, BODY)).body);
      expect(cai.calls).toHaveLength(1);
      expect(frames.at(-1)).toEqual({
        t: 'error',
        message:
          "Google's answer for a page of Cloud Asset Inventory results is larger than 25 MiB. Narrow the asset " +
          'types, or read an export of the scope instead.',
        status: 502,
        code: 'RESPONSE_TOO_LARGE',
      });
    }
  });

  it('refuses an answer that is not a page, and a repeated page token', async () => {
    const notAPage = mockCai([[]], { override: () => jsonResponse(200, { assets: 'nope' }) });
    const { app: refusing } = await start(notAPage.fetch);
    expect(framesOf((await post(refusing, BODY)).body).at(-1)).toMatchObject({
      t: 'error',
      code: 'BAD_UPSTREAM_ANSWER',
    });
    const looping = mockCai([[]], {
      override: () => jsonResponse(200, { assets: [], nextPageToken: 'same', readTime: READ_TIME }),
    });
    const { app: loopingServer } = await start(looping.fetch);
    const frames = framesOf((await post(loopingServer, BODY)).body);
    expect(looping.calls).toHaveLength(2);
    expect(frames.at(-1)).toMatchObject({ t: 'error', code: 'BAD_UPSTREAM_ANSWER' });
  });
});

describe('POST /api/assets/stream: what it accepts', () => {
  const invalid: readonly [string, unknown][] = [
    ['no quota project in user mode', { ...BODY, quotaProject: undefined }],
    ['a quota project in service-account mode', { ...BODY, mode: 'sa' }],
    ['another content type', { ...BODY, contentType: 'IAM_POLICY' }],
    ['an unknown field', { ...BODY, url: 'https://example.com' }],
    ['a scope without an id', { ...BODY, scope: 'projects/' }],
    ['a folder that is not a number', { ...BODY, scope: 'folders/abc' }],
    ['another kind of scope', { ...BODY, scope: 'billingAccounts/1' }],
    ['a path in the scope', { ...BODY, scope: 'projects/demo/../../v1/x' }],
    ['a readTime that is not RFC 3339', { ...BODY, readTime: 'yesterday' }],
    ['no asset types in the list', { ...BODY, assetTypes: [] }],
    ['an asset type with a space', { ...BODY, assetTypes: ['compute.googleapis.com/ Instance'] }],
    ['a mode that does not exist', { ...BODY, mode: 'admin' }],
    ['a quota project that is not a project', { ...BODY, quotaProject: 'Demo Project' }],
    ['not an object', ['projects/demo-app-1']],
  ];

  for (const [name, body] of invalid) {
    it(`answers 400 for ${name}, and calls nothing`, async () => {
      const cai = mockCai([[]]);
      const { app } = await start(cai.fetch);
      const response = await post(app, body);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ statusCode: 400, error: 'Bad Request' });
      expect(response.json<{ message: string }>().message).toMatch(/^Invalid request: /);
      expect(cai.calls).toHaveLength(0);
    });
  }
});

describe('POST /api/assets/stream: service-account mode never skips the gate', () => {
  // The gate's refusals over HTTP, the mode off and a build without the identity are sa-mode.test.ts's; here, the
  // pull the gate lets through.
  const SA_BODY = { scope: 'folders/20000000001', contentType: 'RESOURCE', mode: 'sa' } as const;

  /** Resource Manager's testIamPermissions and tokeninfo next to the CAI mock: the gate's calls. */
  function gateAnswers(granted: boolean): Override {
    return (call) => {
      if (call.url.host === 'oauth2.googleapis.com')
        return jsonResponse(200, { email: 'person@example.com', expires_in: '3599' });
      if (call.url.host === 'cloudresourcemanager.googleapis.com') {
        const asked = (bodyOf(call) as { permissions?: string[] }).permissions ?? [];
        return jsonResponse(200, granted ? { permissions: asked } : {});
      }
      return undefined;
    };
  }

  const caiCalls = (calls: readonly RecordedCall[]): RecordedCall[] =>
    calls.filter((call) => call.url.host === 'cloudasset.googleapis.com');

  it('runs the gate before every page, uses the account’s token and sends no quota project', async () => {
    const cai = mockCai(syntheticPages(1200), { override: gateAnswers(true) });
    const account = fakeAccount();
    const { app, logs } = await start(cai.fetch, {
      env: { SA_MODE_ENABLED: 'true' },
      serviceAccount: account,
    });
    const frames = framesOf((await post(app, SA_BODY)).body);
    expect(frames.at(-1)).toEqual({ t: 'done', assets: 1200, readTime: READ_TIME });
    expect(account.accessToken).toHaveBeenCalledTimes(3);
    expect(caiCalls(cai.calls).map((call) => call.headers.get('authorization'))).toEqual([
      `Bearer ${ACCOUNT_TOKEN}`,
      `Bearer ${ACCOUNT_TOKEN}`,
      `Bearer ${ACCOUNT_TOKEN}`,
    ]);
    expect(caiCalls(cai.calls).every((call) => !call.headers.has('x-goog-user-project'))).toBe(true);
    // The caller's check ran once; the memo answered for pages two and three.
    expect(cai.calls.filter((call) => call.url.host === 'cloudresourcemanager.googleapis.com')).toHaveLength(
      1,
    );
    const audit = logs()
      .filter((line) => line.includes('"service-account gate"'))
      .map((line) => (JSON.parse(line) as { audit: { cached: boolean; decision: string } }).audit);
    expect(audit.map((entry) => [entry.decision, entry.cached])).toEqual([
      ['allowed', false],
      ['allowed', true],
      ['allowed', true],
    ]);
    const text = logs().join('\n');
    for (const secret of [TOKEN, ACCOUNT_TOKEN, 'person@example.com']) expect(text).not.toContain(secret);
  });

  it('stops with an error frame when the gate closes in the middle of a stream', async () => {
    const cai = mockCai(syntheticPages(1200), { override: gateAnswers(true) });
    let runs = 0;
    const account = fakeAccount(() => {
      runs += 1;
      return runs < 2 ? Promise.resolve(ACCOUNT_TOKEN) : Promise.reject(new Error('metadata server gone'));
    });
    const { app } = await start(cai.fetch, { env: { SA_MODE_ENABLED: 'true' }, serviceAccount: account });
    const frames = framesOf((await post(app, SA_BODY)).body);
    expect(caiCalls(cai.calls)).toHaveLength(1);
    expect(frames.at(-1)).toEqual({
      t: 'error',
      message:
        "This gcportrait instance could not get its service account's access token. Try again later; if it goes " +
        'on, tell whoever runs the instance.',
      status: 503,
      code: 'SA_CREDENTIALS_UNAVAILABLE',
      retryable: true,
    });
  });
});

describe('POST /api/assets/stream: operational guards', () => {
  it('runs at most four streams at once per token', async () => {
    const waiting: (() => void)[] = [];
    const cai = mockCai([[]], {
      override: () =>
        new Promise<Response | undefined>((resolve) => {
          waiting.push(() => {
            resolve(undefined);
          });
        }),
    });
    const { app } = await start(cai.fetch);
    const running = Array.from({ length: 4 }, () => post(app, BODY));
    await expect.poll(() => cai.calls.length).toBe(4);

    const fifth = await post(app, BODY);
    expect(fifth.statusCode).toBe(429);
    expect(fifth.json<{ statusCode: number; message: string }>().statusCode).toBe(429);
    expect(fifth.json<{ statusCode: number; message: string }>().message).toMatch(/^4 asset streams/);
    expect(fifth.json()).toMatchObject({ code: 'STREAMS_BUSY', retryable: true });
    expect(fifth.headers['retry-after']).toBe('30');
    expect(cai.calls).toHaveLength(4);

    // Another sign-in has its own four.
    const other = post(app, BODY, OTHER_TOKEN);
    await expect.poll(() => cai.calls.length).toBe(5);

    for (const release of waiting.splice(0)) release();
    await expect.poll(() => waiting.length).toBe(0);
    const done = await Promise.all([...running, other]);
    expect(done.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200]);
    // The slots came back: the same token streams again.
    const again = post(app, BODY);
    await expect.poll(() => waiting.length).toBe(1);
    waiting.splice(0).forEach((release) => {
      release();
    });
    expect((await again).statusCode).toBe(200);
  });

  it('rate-limits per token hash', async () => {
    const { app } = await start(mockCai([[]]).fetch, { streamRateLimitPerMinute: 2 });
    expect((await post(app, BODY)).statusCode).toBe(200);
    expect((await post(app, BODY)).statusCode).toBe(200);
    const limited = await post(app, BODY);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({
      statusCode: 429,
      error: 'Too Many Requests',
      code: 'RATE_LIMITED',
    });
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
    expect((await post(app, BODY, OTHER_TOKEN)).statusCode).toBe(200);
  });

  it('never logs the token, the scope, the quota project or an asset', async () => {
    const pages = syntheticPages(600);
    const { app, logs } = await start(
      mockCai(pages, {
        override: (_call, index) => (index === 1 ? googleError(503, 'UNAVAILABLE', 'busy') : undefined),
      }).fetch,
    );
    await post(app, BODY);
    const text = logs().join('\n');
    expect(text).toContain('asset stream ended');
    for (const secret of [TOKEN, 'demo-app-1', 'demo-quota-1', 'vm-1', 'europe-west3-a'])
      expect(text, secret).not.toContain(secret);
  });
});

describe('POST /api/assets/stream over a real connection', () => {
  async function listening(
    fetch: UpstreamFetch,
  ): Promise<{ readonly url: string; readonly logs: () => string[] }> {
    const { app, logs } = await start(fetch);
    const port = await listenOnLoopback(app);
    return { url: `http://127.0.0.1:${String(port)}/api/assets/stream`, logs };
  }

  it('cancels the upstream request when the client goes away', async () => {
    let hanging: RecordedCall | null = null;
    const cai = mockCai(syntheticPages(1000), {
      override: (call, index) => {
        if (index === 0) return undefined;
        hanging = call;
        return untilAborted(call.signal);
      },
    });
    const { url, logs } = await listening(cai.fetch);
    // node:http rather than fetch: undici opens a fresh idle connection after an abort, which would keep the
    // server's close waiting in afterEach; a browser leaving the page is just the closed socket.
    const client = request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    });
    client.on('error', () => undefined);
    const firstPage = new Promise<void>((resolve, reject) => {
      client.on('response', (response) => {
        expect(response.statusCode).toBe(200);
        let text = '';
        response.on('data', (chunk: Buffer) => {
          text += chunk.toString('utf8');
          if (text.includes('"pages":1')) resolve();
        });
        response.on('error', () => undefined);
      });
      client.on('error', reject);
    });
    client.end(JSON.stringify(BODY));
    await firstPage;
    await expect.poll(() => hanging).not.toBeNull();
    client.destroy();
    await expect.poll(() => hanging?.signal?.aborted).toBe(true);
    await expect.poll(() => logs().some((line) => line.includes('"outcome":"client-gone"'))).toBe(true);
    expect(cai.calls).toHaveLength(2);
  });

  it('streams a 5 000-asset organisation end to end in under 10 s', async () => {
    // Ten pages of 500, each answered after 50 ms, as a slow-ish Google would.
    const pages = syntheticPages(5000);
    const cai = mockCai(pages, {
      override: () =>
        new Promise<undefined>((resolve) => {
          setTimeout(() => {
            resolve(undefined);
          }, 50);
        }),
    });
    const { url } = await listening(cai.fetch);
    const started = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ ...BODY, scope: 'organizations/30000000001' }),
    });
    if (response.body === null) throw new Error('no body');
    const { snapshot, report } = await ingest(response.body, {
      scope: { kind: 'organization', id: '30000000001' },
      source: { kind: 'api', detail: 'live pull' },
      clock: () => Date.now(),
      entropy: Math.random,
    });
    const elapsed = performance.now() - started;
    const megabytes = snapshot.stats.bytes / (1024 * 1024);
    // The budget's figures, for CI's log; a local run stays quiet.
    if (process.env.CI !== undefined)
      console.info(
        `5 000-asset mocked organisation: ${String(snapshot.assets.length)} assets, ${String(report.upstream?.pages)} pages, ` +
          `${megabytes.toFixed(1)} MiB streamed and ingested in ${elapsed.toFixed(0)} ms (budget 10 000 ms)`,
      );
    expect(snapshot.assets).toHaveLength(5000);
    expect(snapshot.readTimeSource).toBe('api');
    expect(report.upstream).toMatchObject({ pages: 10, complete: true, reportedAssets: 5000 });
    expect(cai.calls).toHaveLength(10);
    expect(elapsed).toBeLessThan(10_000);
  });
});
