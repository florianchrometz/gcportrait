// SPDX-License-Identifier: MIT
/**
 * The backend is not an open proxy (ADR 0035 §4, principle 3): attempts to make it call anything but
 * the four Google API hosts, directly through the allowlist and through the bodies of the routes that call Google.
 */
import { describe, expect, it, vi } from 'vitest';

import { answers, fakeGoogle } from '../preflight/google.testing.js';
import { startTestServer } from '../server.testing.js';
import { UPSTREAM_HOSTS, UpstreamHostError, allowedUpstreamUrl } from './allowlist.js';
import { callGoogle, getScope } from './google.js';
import { CALLER_TOKEN, scopeOf, testClient, testContext } from './google.testing.js';
import { openStream, requestJson, type UpstreamFetch } from './request.js';

const ATTACKS = [
  // Other hosts, look-alikes and suffix or prefix tricks.
  'https://example.com/v3/projects/demo-app-1',
  'https://cloudresourcemanager.googleapis.com.example.com/v3/projects/demo-app-1',
  'https://example.com.cloudresourcemanager.googleapis.com/v3/projects/demo-app-1',
  'https://evilcloudasset.googleapis.com/v1/projects/demo-app-1/assets',
  'https://x.cloudasset.googleapis.com/v1/projects/demo-app-1/assets',
  'https://cloudasset.googleapis.com./v1/projects/demo-app-1/assets',
  'https://googleapis.com/v1/projects/demo-app-1/assets',
  'https://compute.googleapis.com/compute/v1/projects/demo-app-1',
  'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/x:generateAccessToken',
  'https://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
  'https://169.254.169.254/computeMetadata/v1/',
  'https://127.0.0.1/',
  'https://[::1]/',
  'https://2130706433/',
  // User info that names an allowed host while the real host is another.
  'https://cloudasset.googleapis.com@example.com/v1/x',
  'https://cloudasset.googleapis.com:443@example.com/v1/x',
  'https://user:pass@cloudasset.googleapis.com/v1/x',
  'https://user@cloudasset.googleapis.com/v1/x',
  'https://example.com\\@cloudasset.googleapis.com/v1/x',
  'https://example.com#@cloudasset.googleapis.com/v1/x',
  'https://example.com?@cloudasset.googleapis.com/v1/x',
  // Look-alike characters and encodings.
  'https://cloudаsset.googleapis.com/v1/x',
  'https://cloudasset.googleapis%2Ecom.example.com/v1/x',
  'https://example.com%2Fcloudasset.googleapis.com/v1/x',
  // Other schemes and ports.
  'http://cloudasset.googleapis.com/v1/x',
  'ftp://cloudasset.googleapis.com/v1/x',
  'file:///etc/passwd',
  'javascript:alert(1)',
  'data:text/plain,hello',
  'wss://cloudasset.googleapis.com/v1/x',
  'https://cloudasset.googleapis.com:8443/v1/x',
  'https://cloudasset.googleapis.com:80/v1/x',
  // Not absolute URLs.
  '//cloudasset.googleapis.com/v1/x',
  '/v1/projects/demo-app-1/assets',
  'cloudasset.googleapis.com/v1/x',
  '',
  ' ',
];

/** Each way the backend sends a request, given a URL; each must check it before anything is sent. */
const ENTRY_POINTS: readonly (readonly [string, (fetch: UpstreamFetch, url: string) => Promise<unknown>])[] =
  [
    [
      'requestJson',
      (fetch, url) =>
        requestJson(
          testClient(fetch),
          { url, method: 'GET', headers: {} },
          { signal: new AbortController().signal, maxBytes: 100 },
        ),
    ],
    [
      'openStream',
      (fetch, url) =>
        openStream(
          testClient(fetch),
          { url, method: 'GET', headers: {} },
          { signal: new AbortController().signal, maxBytes: 100 },
        ),
    ],
    [
      'callGoogle',
      (fetch, url) =>
        callGoogle(testContext(fetch), { operation: 'test', method: 'GET', url, token: CALLER_TOKEN }),
    ],
  ];

describe('the upstream allowlist against attacks', () => {
  it('holds exactly the four Google API hosts', () => {
    expect([...UPSTREAM_HOSTS].sort()).toEqual([
      'cloudasset.googleapis.com',
      'cloudresourcemanager.googleapis.com',
      'oauth2.googleapis.com',
      'storage.googleapis.com',
    ]);
  });

  it.each(ATTACKS)('refuses %j', (url) => {
    expect(() => allowedUpstreamUrl(url)).toThrow(UpstreamHostError);
  });

  it('accepts the four hosts, also spelled with upper case, escapes or the default port, which the parser normalises', () => {
    for (const [url, host] of [
      ['https://cloudasset.googleapis.com/v1/projects/demo-app-1/assets', 'cloudasset.googleapis.com'],
      [
        'https://CLOUDRESOURCEMANAGER.googleapis.com/v3/projects/demo-app-1',
        'cloudresourcemanager.googleapis.com',
      ],
      ['https://cloudasset.googleapis%2Ecom/v1/x', 'cloudasset.googleapis.com'],
      ['https://storage.googleapis.com:443/storage/v1/b/demo/o', 'storage.googleapis.com'],
      ['https://oauth2.googleapis.com/tokeninfo', 'oauth2.googleapis.com'],
    ] as const)
      expect(allowedUpstreamUrl(url).host, url).toBe(host);
  });

  it.each(ENTRY_POINTS)(
    'never calls fetch for a refused URL through %s: the call fails loudly, as a bug, not as an answer',
    async (_name, send) => {
      const fetch = vi.fn<UpstreamFetch>();
      for (const url of ATTACKS.slice(0, 8))
        await expect(send(fetch, url), url).rejects.toThrow(UpstreamHostError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('never follows a redirect: a 3xx is an answer, and nothing goes to where it points', async () => {
    const google = fakeGoogle({
      get: () => new Response(null, { status: 302, headers: { location: 'https://example.com/steal' } }),
    });
    const outcome = await getScope(testContext(google.fetch), scopeOf('projects/demo-app-1'), CALLER_TOKEN);
    expect(outcome).toMatchObject({ kind: 'answer', httpStatus: 302 });
    expect(google.calls.map((call) => call.url.host)).toEqual(['cloudresourcemanager.googleapis.com']);
    expect(google.calls[0]?.redirect).toBe('manual');
  });

  it('encodes a domain-scoped project id inside the path instead of letting it move the host', async () => {
    const google = fakeGoogle();
    await getScope(testContext(google.fetch), scopeOf('projects/example.com:demo-app'), CALLER_TOKEN);
    expect(google.calls[0]?.url.href).toBe(
      'https://cloudresourcemanager.googleapis.com/v3/projects/example.com%3Ademo-app',
    );
  });
});

describe('route bodies cannot steer the backend elsewhere', () => {
  async function start() {
    const google = fakeGoogle({ list: () => answers.listed() });
    const { app } = await startTestServer({ fetch: google.fetch });
    return { app, google };
  }

  const HOSTILE_BODIES: readonly (readonly [string, Record<string, unknown>])[] = [
    ['/api/preflight', { scope: 'projects/demo@example.com', mode: 'user' }],
    ['/api/preflight', { scope: 'projects/demo/../../../..//example.com', mode: 'user' }],
    ['/api/preflight', { scope: '//example.com/projects/x', mode: 'user' }],
    [
      '/api/preflight',
      { scope: 'projects/demo-app-1', mode: 'user', quotaProject: 'demo\nhost: example.com' },
    ],
    ['/api/preflight', { scope: 'projects/demo-app-1', mode: 'user', url: 'https://example.com' }],
    ['/api/preflight', { scope: 'projects/evil.com', mode: 'user' }],
    ['/api/preflight', { scope: 'projects/demo-app-1', mode: 'user', quotaProject: 'evil.com' }],
    [
      '/api/assets/stream',
      { scope: 'projects/evil.com', mode: 'user', contentType: 'RESOURCE', quotaProject: 'demo-app-1' },
    ],
    ['/api/export/read', { gcsUri: 'https://example.com/export.json' }],
    ['/api/export/read', { gcsUri: 'gs://example.com@evil/export.json' }],
    ['/api/scopes/search', { query: '', host: 'example.com' }],
    [
      '/api/scopes/search',
      { query: '', pageToken: Buffer.from('{"project":"x&url=https://example.com"}').toString('base64url') },
    ],
  ];

  it.each(HOSTILE_BODIES)('%s refuses %j without calling anything', async (url, payload) => {
    const { app, google } = await start();
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${CALLER_TOKEN}` },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(google.calls).toHaveLength(0);
  });

  it('a search text full of URL syntax stays a query parameter on Resource Manager', async () => {
    const { app, google } = await start();
    const response = await app.inject({
      method: 'POST',
      url: '/api/scopes/search',
      headers: { authorization: `Bearer ${CALLER_TOKEN}` },
      payload: { query: 'https://example.com/x?y=1#z @evil" OR name:* ) (' },
    });
    expect(response.statusCode).toBe(200);
    expect(new Set(google.calls.map((call) => call.url.host))).toEqual(
      new Set(['cloudresourcemanager.googleapis.com']),
    );
    expect(google.calls.every((call) => call.redirect === 'manual')).toBe(true);
    // Nothing of the URL or of Resource Manager's query syntax reaches the query itself.
    for (const call of google.calls) expect(call.url.searchParams.get('query') ?? '').not.toMatch(/["#?&/@]/);
  });

  it('every call of a preflight goes to an allowed host over https and follows no redirect', async () => {
    const { app, google } = await start();
    await app.inject({
      method: 'POST',
      url: '/api/preflight',
      headers: { authorization: `Bearer ${CALLER_TOKEN}` },
      payload: { scope: 'folders/20000000001', mode: 'user', quotaProject: 'demo-quota-1' },
    });
    expect(google.calls.length).toBeGreaterThan(0);
    for (const call of google.calls) {
      expect(() => allowedUpstreamUrl(call.url.href)).not.toThrow();
      expect(call.redirect).toBe('manual');
    }
  });
});
