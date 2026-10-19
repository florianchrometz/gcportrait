// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The token goes only to this backend's /api/ paths, in X-Gcportrait-Token (Identity-Aware Proxy takes
 * `Authorization` for its own), never in `Authorization`, a URL or a cookie; a 401 expires the session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWithToken, NotSignedInError, TOKEN_HEADER } from './fetch';
import { testAuth as auth } from './testing';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWithToken', () => {
  it('sends the token in X-Gcportrait-Token to an /api/ path: not in Authorization, not in the URL, never cached', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetch);
    await fetchWithToken(auth('secret-token'), '/api/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('/api/preflight');
    const headers = new Headers(init?.headers);
    expect(TOKEN_HEADER).toBe('x-gcportrait-token');
    expect(headers.get('X-Gcportrait-Token')).toBe('secret-token');
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('content-type')).toBe('application/json');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    expect(JSON.stringify(fetch.mock.calls[0]?.[0])).not.toContain('secret-token');
  });

  it('drops an Authorization header a caller passed, so IAP never sees one, and keeps the caller’s other headers', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetch);
    await fetchWithToken(auth('secret-token'), '/api/assets/stream', {
      method: 'POST',
      headers: new Headers({ authorization: 'Bearer something-else', accept: 'application/x-ndjson' }),
    });
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get(TOKEN_HEADER)).toBe('secret-token');
    expect(headers.get('accept')).toBe('application/x-ndjson');
  });

  it('a token supplied in the caller’s own X-Gcportrait-Token is replaced by the session’s', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetch);
    await fetchWithToken(auth('session-token'), '/api/preflight', {
      headers: { [TOKEN_HEADER]: 'stale-token' },
    });
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get(TOKEN_HEADER)).toBe('session-token');
  });

  it('refuses any other address, and refuses to run without a token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    for (const path of ['https://evil.example.com/api/x', '//evil.example.com/api/x', '/healthz', 'api/x']) {
      await expect(fetchWithToken(auth('t'), path)).rejects.toThrow(/only calls this backend/);
    }
    await expect(fetchWithToken(auth(null), '/api/x')).rejects.toBeInstanceOf(NotSignedInError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('tells the session when the backend answers 401 for the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response('', { status: 401 }))),
    );
    const controls = auth('expired-token');
    const response = await fetchWithToken(controls, '/api/scopes/search');
    expect(response.status).toBe(401);
    expect(controls.rejectedTokens).toEqual(['expired-token']);
  });
});
