// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ErrorResponseSchema, HealthResponseSchema } from './schemas.js';
import { cspDirectives, PERMISSIONS_POLICY } from './security.js';
import { BODY_LIMIT_BYTES } from './server.js';
import { listenOnLoopback, startTestServer, type TestServerOptions } from './server.testing.js';
import { mockCai } from './stream/google.testing.js';
import type { UpstreamFetch } from './upstream/request.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'gcportrait-backend-test-'));

const THEME_SCRIPT = "document.documentElement.dataset.theme='dark';";
/** The CSP source that allows THEME_SCRIPT, worked out here rather than by the code under test. */
const THEME_SCRIPT_SOURCE = `'sha256-${createHash('sha256').update(THEME_SCRIPT, 'utf8').digest('base64')}'`;
const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head><script>${THEME_SCRIPT}</script><script type="module" src="/assets/index-abc123.js"></script></head>
  <body><div id="root"></div></body>
</html>
`;

/**
 * A minimal stand-in for frontend/dist, including an api/ folder that must never shadow the API; a directory of its
 * own for each call, so no test sees what another added.
 */
function makeDist(): string {
  const dir = mkdtempSync(path.join(scratch, 'dist-'));
  mkdirSync(path.join(dir, 'assets'));
  mkdirSync(path.join(dir, 'api'));
  writeFileSync(path.join(dir, 'index.html'), INDEX_HTML);
  writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log("app");\n');
  writeFileSync(path.join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(path.join(dir, 'api', 'config'), '{"shadowed":true}');
  return dir;
}

/** A Content-Security-Policy header as sent, read back as directive name -> sources. */
function sentCsp(header: unknown): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  for (const directive of String(header).split(';')) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (name !== undefined && name !== '') directives[name] = sources;
  }
  return directives;
}

/** A server for this test, without a SPA build unless `env` names one. */
async function start(options: TestServerOptions = {}) {
  return (await startTestServer(options)).app;
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('GET /healthz and GET /api/healthz', () => {
  it.each(['/healthz', '/api/healthz'])('%s reports ok and the version, uncached', async (url) => {
    const app = await start();
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(HealthResponseSchema.parse(response.json())).toEqual({ status: 'ok', version: '9.9.9-test' });
  });

  it('answers /api/healthz from the API even when the SPA build has an api/ folder', async () => {
    const app = await start({ env: { STATIC_DIR: makeDist() } });
    const response = await app.inject({ method: 'GET', url: '/api/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '9.9.9-test' });
  });

  it('/healthz, the probes’ path, is not rate limited; /api/healthz is, like the rest of /api', async () => {
    const app = await start({ rateLimitPerMinute: 1 });
    for (let i = 0; i < 3; i += 1) {
      expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'GET', url: '/api/healthz' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/healthz' })).statusCode).toBe(429);
  });
});

describe('security headers', () => {
  // The directives themselves are cspDirectives' (security.test.ts pins them); here, what goes out on the wire.
  it('sets a strict CSP and the usual hardening headers on API responses', async () => {
    const app = await start();
    const response = await app.inject({ method: 'GET', url: '/api/config' });
    // Exactly cspDirectives' policy: nothing added, dropped or overridden on the way to helmet.
    expect(sentCsp(response.headers['content-security-policy'])).toEqual(cspDirectives([]));
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    // Google's sign-in window reaches its opener (security.ts, OPENER_POLICY).
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
    // No embedder policy with sign-in: alone it isolates nothing (security.ts, crossOriginPolicies).
    expect(response.headers['cross-origin-embedder-policy']).toBeUndefined();
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['permissions-policy']).toBe(PERMISSIONS_POLICY);
  });

  it.each([
    [
      'with a SPA build: the SPA, its files and errors',
      true,
      ['/', '/diagram', '/assets/index-abc123.js', '/api/nope', '/healthz'],
    ],
    ['without one: the 404s, with the hint and without', false, ['/diagram', '/api/nope']],
  ] as const)('sends the same headers %s', async (_label, built, urls) => {
    const app = await start(built ? { env: { STATIC_DIR: makeDist() } } : {});
    const csp = cspDirectives(built ? [THEME_SCRIPT_SOURCE] : []);
    for (const url of urls) {
      const response = await app.inject({ method: 'GET', url });
      expect(sentCsp(response.headers['content-security-policy']), url).toEqual(csp);
      expect(response.headers['permissions-policy'], url).toBe(PERMISSIONS_POLICY);
      expect(response.headers['strict-transport-security'], url).toMatch(/max-age=\d+/);
      expect(response.headers['x-content-type-options'], url).toBe('nosniff');
      expect(response.headers['referrer-policy'], url).toBe('no-referrer');
      expect(response.headers['cross-origin-resource-policy'], url).toBe('same-origin');
    }
  });
});

describe('request ids', () => {
  it('echoes a well-formed x-request-id', async () => {
    const app = await start();
    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(response.headers['x-request-id']).toBe('abc-123');
  });

  it('replaces a malformed one with a UUID', async () => {
    const app = await start();
    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'bad id\nwith newline' },
    });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('unknown API paths', () => {
  it.each(['/api/nope', '/api', '/api/config/extra'])('answers %s with 404 JSON', async (url) => {
    const app = await start();
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    const body = ErrorResponseSchema.parse(response.json());
    expect(body.statusCode).toBe(404);
    expect(body.error).toBe('Not Found');
    expect(body.code).toBe('ROUTE_NOT_FOUND');
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });

  it('answers a POST to a GET-only route with 404 JSON', async () => {
    const app = await start();
    const response = await app.inject({ method: 'POST', url: '/api/config', payload: {} });
    expect(response.statusCode).toBe(404);
    expect(ErrorResponseSchema.parse(response.json()).statusCode).toBe(404);
  });
});

describe('without a SPA build (development)', () => {
  it.each(['/', '/diagram', '/assets/index-abc123.js'])(
    'answers %s with 404 JSON and a hint',
    async (url) => {
      const app = await start();
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
      expect(ErrorResponseSchema.parse(response.json()).message).toMatch(/Vite dev server/);
    },
  );
});

describe('with a SPA build (production image)', () => {
  let distDir = '';
  beforeAll(() => {
    distDir = makeDist();
  });

  it.each(['/', '/diagram', '/settings', '/snapshots?x=1'])(
    'serves index.html for the client route %s',
    async (url) => {
      const app = await start({ env: { STATIC_DIR: distDir } });
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/^text\/html/);
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.body).toBe(INDEX_HTML);
    },
  );

  it('allows the inline theme script by its hash in the CSP', async () => {
    const app = await start({ env: { STATIC_DIR: distDir } });
    const response = await app.inject({ method: 'GET', url: '/diagram' });
    expect(String(response.headers['content-security-policy'])).toContain(
      `script-src 'self' ${THEME_SCRIPT_SOURCE}`,
    );
  });

  it('serves hashed assets as immutable files', async () => {
    const app = await start({ env: { STATIC_DIR: distDir } });
    const response = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.body).toBe('console.log("app");\n');
  });

  it('serves other top-level files with revalidation', async () => {
    const app = await start({ env: { STATIC_DIR: distDir } });
    const response = await app.inject({ method: 'GET', url: '/favicon.svg' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('answers a missing asset with 404 JSON instead of index.html', async () => {
    const app = await start({ env: { STATIC_DIR: distDir } });
    const response = await app.inject({ method: 'GET', url: '/assets/missing-123.js' });
    expect(response.statusCode).toBe(404);
    expect(ErrorResponseSchema.parse(response.json()).statusCode).toBe(404);
  });

  it('never lets static files or the fallback shadow the API', async () => {
    const app = await start({ env: { STATIC_DIR: distDir } });
    const config = await app.inject({ method: 'GET', url: '/api/config' });
    expect(config.json()).toMatchObject({ demo: false });
    const unknown = await app.inject({ method: 'GET', url: '/api/unknown' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.headers['content-type']).toMatch(/^application\/json/);
  });

  it('does not answer non-GET requests with the SPA', async () => {
    const app = await start({ env: { STATIC_DIR: distDir } });
    const response = await app.inject({ method: 'POST', url: '/diagram', payload: {} });
    expect(response.statusCode).toBe(404);
  });

  it('never serves a dotfile or anything in a dot folder', async () => {
    const withDotfiles = makeDist();
    writeFileSync(path.join(withDotfiles, '.env'), 'SECRET=dotfile-content\n');
    mkdirSync(path.join(withDotfiles, '.private'));
    writeFileSync(path.join(withDotfiles, '.private', 'notes.txt'), 'dot-folder-content\n');
    const app = await start({ env: { STATIC_DIR: withDotfiles } });
    for (const url of ['/.env', '/.private/notes.txt', '/assets/../.env']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(404);
      expect(response.body, url).not.toContain('content');
    }
    // A last segment without a dot is a client route (the SPA's index.html), never the folder or the file.
    for (const url of ['/%2eenv', '/.private/']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.body, url).toBe(INDEX_HTML);
    }
  });

  it('never serves a file outside the build, however the path is spelled', async () => {
    const app = await start({ env: { STATIC_DIR: distDir } });
    for (const url of [
      '/../package.json',
      '/..%2fpackage.json',
      '/assets/..%2f..%2fpackage.json',
      '/%2e%2e/%2e%2e/package.json',
      '/assets/%2e%2e%2f%2e%2e%2fserver.test.ts',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect([400, 403, 404], url).toContain(response.statusCode);
      expect(response.body, url).not.toContain('"name"');
    }
  });
});

describe('error answers', () => {
  it('answers an internal failure with "Internal error." and the request id; the detail goes to the log only', async () => {
    const { app, logs } = await startTestServer({ logLevel: 'error' });
    app.get('/api/boom', () => {
      throw new Error('internal detail: /srv/secret/path and a stack');
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/boom',
      headers: { 'x-request-id': 'probe-500' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal error.',
      requestId: 'probe-500',
      code: 'INTERNAL',
    });
    expect(response.body).not.toContain('secret');
    expect(logs.text()).toContain('internal detail');
    expect(logs.text()).toContain('"requestId":"probe-500"');
  });
});

describe('request limits', () => {
  /** The cap docs/security.md documents ("64 KiB per body"); BODY_LIMIT_BYTES must not exceed it. */
  const DOCUMENTED_BODY_LIMIT = 64 * 1024;

  it('refuses a body over 64 KiB with 413, before any route sees it', async () => {
    const app = await start();
    const response = await app.inject({
      method: 'POST',
      url: '/api/preflight',
      headers: { 'content-type': 'application/json', 'x-gcportrait-token': 'ya29.limit-test' },
      payload: JSON.stringify({ scope: 'x'.repeat(DOCUMENTED_BODY_LIMIT) }),
    });
    expect(response.statusCode).toBe(413);
    expect(ErrorResponseSchema.parse(response.json())).toMatchObject({
      message: 'Request body is too large',
      code: 'BODY_TOO_LARGE',
    });
  });

  it('takes the largest legitimate body, a pull with 100 asset-type patterns of 256 characters', async () => {
    const cai = mockCai([[]]);
    const app = await start({ fetch: cai.fetch });
    const assetTypes = Array.from({ length: 100 }, () => 'a'.repeat(256));
    const payload = JSON.stringify({
      scope: 'projects/demo-app-1',
      contentType: 'RESOURCE',
      mode: 'user',
      quotaProject: 'demo-app-1',
      assetTypes,
    });
    // With room to spare: a limit cut below twice the largest legitimate body (about 27 KiB) fails here.
    expect(Buffer.byteLength(payload)).toBeLessThan(BODY_LIMIT_BYTES / 2);
    const response = await app.inject({
      method: 'POST',
      url: '/api/assets/stream',
      headers: { 'content-type': 'application/json', 'x-gcportrait-token': 'ya29.limit-test' },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(cai.calls).toHaveLength(1);
    expect(cai.calls[0]?.body).toContain(assetTypes[0]);
  });

  /** Sends `text` on a raw connection and resolves with the status line of the answer (or what came). */
  function rawExchange(port: number, text: string, waitMs = 5_000): Promise<string> {
    return new Promise((resolve) => {
      let answer = '';
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(text);
      });
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(`(no answer) ${answer}`);
      }, waitMs);
      socket.on('data', (chunk: Buffer) => {
        answer += chunk.toString('utf8');
      });
      socket.on('close', () => {
        clearTimeout(timer);
        resolve(answer.split('\r\n')[0] ?? '');
      });
      socket.on('error', () => undefined);
    });
  }

  async function listening(options: TestServerOptions) {
    const app = await start(options);
    return { app, port: await listenOnLoopback(app) };
  }

  it('gives a client a bounded time to send its headers', async () => {
    const { app, port } = await listening({ requestTimeoutMs: 300 });
    expect(app.server.requestTimeout).toBe(300);
    expect(await rawExchange(port, 'GET /api/config HTTP/1.1\r\nHost: x\r\n')).toBe(
      'HTTP/1.1 408 Request Timeout',
    );
  });

  it('gives a client a bounded time to send its body, and closes the connection', async () => {
    const { port } = await listening({ requestTimeoutMs: 300 });
    const started = Date.now();
    const status = await rawExchange(
      port,
      'POST /api/preflight HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{',
    );
    expect(status).toBe('HTTP/1.1 408 Request Timeout');
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('does not limit how long an answer streams', async () => {
    let calls = 0;
    const slowPage: UpstreamFetch = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 400));
      return new Response(JSON.stringify({ assets: [], readTime: '2026-10-08T12:00:00Z' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const { port } = await listening({ requestTimeoutMs: 150, fetch: slowPage });
    const body = JSON.stringify({
      scope: 'projects/demo-app-1',
      mode: 'user',
      contentType: 'RESOURCE',
      quotaProject: 'demo-app-1',
    });
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/assets/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gcportrait-token': 'ya29.stream-timeout-test' },
      body,
    });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(calls).toBe(1);
    expect(text.trim().split('\n').at(-1)).toBe('{"t":"done","assets":0,"readTime":"2026-10-08T12:00:00Z"}');
  });
});

describe('rate limiting', () => {
  it('limits API requests per client and answers 429 JSON', async () => {
    const app = await start({ rateLimitPerMinute: 2 });
    expect((await app.inject({ method: 'GET', url: '/api/config' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/config' })).statusCode).toBe(200);
    const limited = await app.inject({ method: 'GET', url: '/api/config' });
    expect(limited.statusCode).toBe(429);
    const body = ErrorResponseSchema.parse(limited.json());
    expect(body.error).toBe('Too Many Requests');
    expect(body.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('keys the budget on the forwarded client address only when proxy hops are trusted', async () => {
    const fromClient = (app: FastifyInstance, client: string) =>
      app.inject({ method: 'GET', url: '/api/config', headers: { 'x-forwarded-for': client } });

    const direct = await start({ rateLimitPerMinute: 1 });
    expect((await fromClient(direct, '198.51.100.1')).statusCode).toBe(200);
    expect((await fromClient(direct, '198.51.100.2')).statusCode).toBe(429);

    const behindProxy = await start({ env: { TRUST_PROXY_HOPS: '1' }, rateLimitPerMinute: 1 });
    expect((await fromClient(behindProxy, '198.51.100.1')).statusCode).toBe(200);
    expect((await fromClient(behindProxy, '198.51.100.2')).statusCode).toBe(200);
    expect((await fromClient(behindProxy, '198.51.100.1')).statusCode).toBe(429);
  });

  it('also limits requests for unknown paths', async () => {
    const app = await start({ rateLimitPerMinute: 1 });
    expect((await app.inject({ method: 'GET', url: '/api/a' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/b' })).statusCode).toBe(429);
  });
});

describe('logging', () => {
  it('writes JSON lines with request ids and never logs credentials, identity or bodies', async () => {
    const { app, logs } = await startTestServer({ logLevel: 'info' });
    const secrets = {
      authorization: 'Bearer header-secret',
      // The caller's token as the app sends it (AGENTS.md, Security and privacy, Tokens).
      'x-gcportrait-token': 'ya29.own-header-secret',
      cookie: 'sid=cookie-secret',
      'x-goog-iam-authorization-token': 'iam-secret',
      // What Cloud Run and IAP add in front of a self-hosted deployment (docs/self-host-options.md, deploy.sh --iap).
      'x-goog-iap-jwt-assertion': 'eyJhbGciOiJFUzI1NiJ9.iap-jwt-secret.sig',
      'x-goog-authenticated-user-email': 'accounts.google.com:person-secret@example.com',
      'x-goog-authenticated-user-id': 'accounts.google.com:user-id-secret',
      'x-serverless-authorization': 'Bearer serverless-secret',
      'x-api-key': 'api-key-secret',
    };
    for (const url of ['/api/anything?access_token=query-secret', '/api/config?code=query-code-secret']) {
      await app.inject({
        method: url.startsWith('/api/config') ? 'GET' : 'POST',
        url,
        headers: { ...secrets, 'x-request-id': 'req-42', 'user-agent': 'logged-agent' },
        ...(url.startsWith('/api/config') ? {} : { payload: { asset: 'body-secret' } }),
      });
    }
    const lines = logs.lines();
    expect(lines.length).toBeGreaterThan(0);
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.some((record) => record.requestId === 'req-42')).toBe(true);
    expect(records.every((record) => typeof record.severity === 'string')).toBe(true);
    const text = lines.join('\n');
    for (const secret of [
      ...Object.values(secrets),
      'header-secret',
      'own-header-secret',
      'cookie-secret',
      'iam-secret',
      'iap-jwt-secret',
      'person-secret',
      'user-id-secret',
      'serverless-secret',
      'api-key-secret',
      'query-secret',
      'query-code-secret',
      'body-secret',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('[redacted]');
    expect(text).toContain('x-goog-iap-jwt-assertion');
    expect(text).toContain('logged-agent');
  });

  it('never logs the client address, direct or forwarded', async () => {
    // Trust one proxy hop so the forwarded address becomes request.ip, as on Cloud Run.
    const { app, logs } = await startTestServer({ logLevel: 'info', env: { TRUST_PROXY_HOPS: '1' } });
    await app.inject({
      method: 'GET',
      url: '/api/config',
      remoteAddress: '192.0.2.10',
      headers: { 'x-forwarded-for': '198.51.100.23' },
    });
    const lines = logs.lines();
    expect(lines.length).toBeGreaterThan(0);
    const text = lines.join('\n');
    expect(text).not.toContain('192.0.2.10');
    expect(text).not.toContain('198.51.100.23');
    expect(text).not.toContain('remoteAddress');
    expect(text).toContain('x-forwarded-for');
  });

  it('honours the configured log level', async () => {
    const { app, logs } = await startTestServer({ logLevel: 'error' });
    await app.inject({ method: 'GET', url: '/api/config' });
    expect(logs.lines()).toEqual([]);
  });
});
