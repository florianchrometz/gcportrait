// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/** tokeninfo gets the token in a form body, never in its URL, with no cookie and no referrer. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchTokenInfo, TOKENINFO_URL, TokenRefusedError } from './tokeninfo';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('fetchTokenInfo', () => {
  it('posts the token as a form body to Google and reads the audience and email', async () => {
    const fetch = stubFetch(
      Response.json({
        aud: 'client-1',
        azp: 'client-1',
        email: 'ada@example.com',
        scope: 'x',
        expires_in: '3599',
      }),
    );
    await expect(fetchTokenInfo('secret-token')).resolves.toEqual({
      audience: 'client-1',
      email: 'ada@example.com',
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(TOKENINFO_URL);
    expect(typeof url === 'string' ? url : '').not.toContain('secret-token');
    expect(init).toMatchObject({
      method: 'POST',
      body: 'access_token=secret-token',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  });

  it('falls back to azp and to null fields', async () => {
    stubFetch(Response.json({ azp: 'client-2' }));
    await expect(fetchTokenInfo('t')).resolves.toEqual({ audience: 'client-2', email: null });
  });

  it('refuses a token Google does not accept, and fails on other answers', async () => {
    stubFetch(Response.json({ error: 'invalid_token' }, { status: 400 }));
    await expect(fetchTokenInfo('t')).rejects.toBeInstanceOf(TokenRefusedError);
    stubFetch(new Response('oops', { status: 503 }));
    await expect(fetchTokenInfo('t')).rejects.toThrow(/503/);
    stubFetch(Response.json('nope'));
    await expect(fetchTokenInfo('t')).rejects.toThrow(/no object/);
  });
});
