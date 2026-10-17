// SPDX-License-Identifier: MIT
/**
 * Demo-only mode (DEMO_ONLY=true; backend/AGENTS.md, Demo-only mode and legal pages): the route matrix against the normal mode,
 * the configuration it reports and refuses, the legal pages, the CSP, the rate limit and the SPA. Fastify
 * inject, no network: a request that reached Google would fail on the fetch below.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SOURCE_URL, parseConfig } from './config.js';
import { ErrorResponseSchema, LegalResponseSchema, PublicConfigResponseSchema } from './schemas.js';
import { BROWSER_GOOGLE_ORIGINS, GIS_CONNECT_SOURCE, GIS_SCRIPT_SOURCE } from './security.js';
import type { BuildServerOptions } from './server.js';
import { configRefusal, noGoogle, startTestServer } from './server.testing.js';
import { UPSTREAM_ORIGINS } from './upstream/allowlist.js';
import type { UpstreamFetch } from './upstream/request.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'gcportrait-demo-only-test-'));
const INDEX_HTML = '<!doctype html><html><head></head><body><div id="root"></div></body></html>\n';
const dist = path.join(scratch, 'dist');
mkdirSync(path.join(dist, 'assets'), { recursive: true });
writeFileSync(path.join(dist, 'index.html'), INDEX_HTML);
writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log("app");\n');
const legal = path.join(scratch, 'legal');
mkdirSync(legal);
/** Synthetic texts (AGENTS.md, Security and privacy, principle 6). */
const IMPRESSUM = '# Impressum\n\nExample Operator, Example Street 1, 12345 Example City\n';
writeFileSync(path.join(legal, 'impressum.md'), IMPRESSUM);

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * A server with the SPA build above and `env` over the test defaults. Every call to Google fails (noGoogle): in
 * demo-only mode nothing may reach it.
 */
async function start(
  env: Record<string, string> = {},
  options: Omit<BuildServerOptions, 'upstream'> & { readonly fetch?: UpstreamFetch } = {},
) {
  return (await startTestServer({ env: { STATIC_DIR: dist, ...env }, ...options })).app;
}

/** The routes that call Google (docs/api.md) and the render API, with a body each would accept. */
const GOOGLE_ROUTES: readonly { readonly url: string; readonly body: Record<string, unknown> }[] = [
  { url: '/api/scopes/search', body: { query: 'demo' } },
  { url: '/api/preflight', body: { scope: 'projects/demo-project', mode: 'user' } },
  { url: '/api/assets/stream', body: { scope: 'projects/demo-project', contentType: 'RESOURCE' } },
  { url: '/api/export/read', body: { uri: 'gs://demo-bucket/export.json' } },
  { url: '/api/render', body: { source: { kind: 'demo', size: 'S' } } },
];

const TOKEN_HEADERS = { 'x-gcportrait-token': 'demo-only-test-token', 'content-type': 'application/json' };

describe('the route matrix', () => {
  it.each(GOOGLE_ROUTES)(
    '$url is not registered in demo-only mode: the JSON 404 of an unknown route',
    async ({ url, body }) => {
      const app = await start({ DEMO_ONLY: 'true' });
      const response = await app.inject({ method: 'POST', url, headers: TOKEN_HEADERS, payload: body });
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.headers['cache-control']).toBe('no-store');
      const error = ErrorResponseSchema.parse(response.json());
      expect(error.message).toBe(
        `No route for POST ${url}. This instance runs in demo-only mode: it offers no sign-in and reads nothing from Google Cloud.`,
      );
      // Not the SPA either, for any method.
      const get = await app.inject({ method: 'GET', url });
      expect(get.statusCode).toBe(404);
      expect(get.headers['content-type']).toMatch(/^application\/json/);
    },
  );

  // Without DEMO_ONLY (and with DEMO_ONLY=false) every one of them exists, and checks the caller's token first
  // (upstream/route-support.ts): one that is missing or malformed is refused before anything reaches Google.
  it.each(GOOGLE_ROUTES)(
    '$url answers 401 without a usable token, before calling Google',
    async ({ url }) => {
      const NOT_TOKENS: readonly Record<string, string>[] = [
        {},
        { authorization: 'Basic dXNlcjpwYXNz' },
        { authorization: 'Bearer' },
        { authorization: 'Bearer two words' },
        { authorization: 'bearer\ttoken' },
        // A malformed dedicated header is never replaced by Authorization (AGENTS.md, Security and privacy,
        // Tokens).
        { 'x-gcportrait-token': 'not a token', authorization: 'Bearer ya29.demo-only-test-token' },
      ];
      for (const env of [{}, { DEMO_ONLY: 'false' }]) {
        const google = vi.fn<UpstreamFetch>(noGoogle);
        const app = await start(env, { fetch: google });
        for (const headers of NOT_TOKENS) {
          const response = await app.inject({
            method: 'POST',
            url,
            headers: { 'content-type': 'application/json', ...headers },
            payload: {},
          });
          const variant = `${JSON.stringify(env)} ${JSON.stringify(headers)}`;
          expect(response.statusCode, variant).toBe(401);
          expect(response.headers['www-authenticate'], variant).toBe('Bearer');
          expect(response.json(), variant).toMatchObject({ statusCode: 401, error: 'Unauthorized' });
        }
        expect(google).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ['/healthz', 200],
    ['/api/healthz', 200],
    ['/api/config', 200],
    ['/api/legal', 200],
    ['/', 200],
    ['/diagram', 200],
    ['/impressum', 200],
    ['/privacy', 200],
    ['/assets/index-abc123.js', 200],
    ['/api/nope', 404],
  ] as const)('GET %s answers %i in demo-only mode', async (url, status) => {
    const app = await start({ DEMO_ONLY: 'true' });
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(status);
    if (url === '/' || url === '/diagram' || url === '/impressum' || url === '/privacy') {
      expect(response.body).toBe(INDEX_HTML);
    }
  });

  it('keeps the rate limit: 404s of the missing routes count against it like any request', async () => {
    const app = await start({ DEMO_ONLY: 'true' }, { rateLimitPerMinute: 2 });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await app.inject({ method: 'POST', url: '/api/preflight', payload: {} })).statusCode);
    }
    expect(statuses).toEqual([404, 404, 429]);
    expect((await app.inject({ method: 'GET', url: '/api/config' })).statusCode).toBe(429);
  });
});

describe('GET /api/config in demo-only mode', () => {
  it('reports demoOnly, no OAuth client, no service-account mode and no account', async () => {
    const app = await start({
      DEMO_ONLY: 'true',
      BACKEND_SA_EMAIL: 'gcportrait-demo-backend@example.com',
      HOSTED_BY: 'Example Ltd',
    });
    const body = PublicConfigResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/config' })).json(),
    );
    expect(body).toEqual({
      oauthClientId: null,
      saMode: false,
      saStrictExposure: false,
      backendServiceAccount: null,
      version: '9.9.9-test',
      sourceUrl: DEFAULT_SOURCE_URL,
      hostedBy: 'Hosted by Example Ltd.',
      demo: false,
      demoOnly: true,
      legal: { impressum: false, privacy: false, impressumUrl: null, privacyUrl: null },
      render: null,
    });
  });

  it('refuses an OAuth client id and service-account mode at start-up, naming the variables only', () => {
    const message = configRefusal({
      DEMO_ONLY: 'true',
      OAUTH_CLIENT_ID: '12345678901-secret.apps.googleusercontent.com',
      SA_MODE_ENABLED: 'true',
    });
    expect(message).toBe(
      'Invalid backend configuration:\n' +
        '  OAUTH_CLIENT_ID: must be unset with DEMO_ONLY=true (a demo-only instance offers no sign-in)\n' +
        '  SA_MODE_ENABLED: must not be "true" with DEMO_ONLY=true (a demo-only instance reads no scope)',
    );
    expect(message).not.toContain('secret');
    // SA_MODE_ENABLED=false is fine; so is a blank client id.
    expect(parseConfig({ DEMO_ONLY: 'true', SA_MODE_ENABLED: 'false', OAUTH_CLIENT_ID: ' ' }).demoOnly).toBe(
      true,
    );
  });

  it('accepts only "true" or "false" for DEMO_ONLY', () => {
    expect(parseConfig({}).demoOnly).toBe(false);
    expect(parseConfig({ DEMO_ONLY: '' }).demoOnly).toBe(false);
    expect(parseConfig({ DEMO_ONLY: 'false' }).demoOnly).toBe(false);
    for (const value of ['1', 'yes', 'TRUE', 'on']) {
      expect(() => parseConfig({ DEMO_ONLY: value }), value).toThrow(
        /DEMO_ONLY: must be "true" or "false" \(or unset, which means off\)/,
      );
    }
  });
});

describe('the legal pages', () => {
  it('/api/legal serves the texts of LEGAL_DIR, and /api/config names the pages that exist', async () => {
    const app = await start({ DEMO_ONLY: 'true', LEGAL_DIR: legal });
    const texts = await app.inject({ method: 'GET', url: '/api/legal' });
    expect(texts.headers['cache-control']).toBe('no-store');
    expect(LegalResponseSchema.parse(texts.json())).toEqual({ impressum: IMPRESSUM, privacy: null });
    const config = (await app.inject({ method: 'GET', url: '/api/config' })).json<{ legal: unknown }>();
    expect(config.legal).toEqual({ impressum: true, privacy: false, impressumUrl: null, privacyUrl: null });
  });

  it('/api/config names the pages a demo links on its operator’s website, and /api/legal serves none', async () => {
    const app = await start({
      DEMO_ONLY: 'true',
      LEGAL_IMPRESSUM_URL: 'https://operator.example.com/legal/impressum',
      LEGAL_PRIVACY_URL: 'https://operator.example.com/legal/privacy',
    });
    const config = (await app.inject({ method: 'GET', url: '/api/config' })).json<{ legal: unknown }>();
    expect(config.legal).toEqual({
      impressum: false,
      privacy: false,
      impressumUrl: 'https://operator.example.com/legal/impressum',
      privacyUrl: 'https://operator.example.com/legal/privacy',
    });
    expect((await app.inject({ method: 'GET', url: '/api/legal' })).json()).toEqual({
      impressum: null,
      privacy: null,
    });
  });

  it('/api/legal answers nulls when the instance publishes none, in either mode', async () => {
    for (const env of [{}, { DEMO_ONLY: 'true' }]) {
      const app = await start(env);
      expect((await app.inject({ method: 'GET', url: '/api/legal' })).json()).toEqual({
        impressum: null,
        privacy: null,
      });
    }
  });
});

describe('the Content Security Policy', () => {
  it('allows no Google host in demo-only mode, and keeps them otherwise', async () => {
    const demo = await start({ DEMO_ONLY: 'true' });
    const demoCsp = String(
      (await demo.inject({ method: 'GET', url: '/' })).headers['content-security-policy'],
    );
    expect(demoCsp).toContain("connect-src 'self';");
    expect(demoCsp).toMatch(/script-src 'self'(?: 'sha256-[^']+')*;/);
    for (const source of [...UPSTREAM_ORIGINS, GIS_SCRIPT_SOURCE, GIS_CONNECT_SOURCE]) {
      expect(demoCsp).not.toContain(source);
    }
    const live = await start();
    const liveCsp = String(
      (await live.inject({ method: 'GET', url: '/' })).headers['content-security-policy'],
    );
    expect(liveCsp).toContain(GIS_SCRIPT_SOURCE);
    expect(liveCsp).toContain(BROWSER_GOOGLE_ORIGINS[0]);
  });

  it('isolates the demo-only page (COOP same-origin, COEP require-corp); with sign-in, COOP allows the popup', async () => {
    const demo = await start({ DEMO_ONLY: 'true' });
    for (const url of ['/', '/api/config', '/api/legal']) {
      const response = await demo.inject({ method: 'GET', url });
      expect(response.headers['cross-origin-opener-policy'], url).toBe('same-origin');
      expect(response.headers['cross-origin-embedder-policy'], url).toBe('require-corp');
      expect(response.headers['cross-origin-resource-policy'], url).toBe('same-origin');
    }
    const live = await start();
    const response = await live.inject({ method: 'GET', url: '/' });
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
    expect(response.headers['cross-origin-embedder-policy']).toBeUndefined();
  });
});
