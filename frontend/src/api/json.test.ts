// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testAuth } from '../auth/testing';
import { isRecord } from '../guards';
import { getPublicJson, isNullableString, postJson, readError, readErrorMessage } from './json';

const TOKEN = 'test-token-123';
const auth = (token: string | null = TOKEN): ReturnType<typeof testAuth> => testAuth(token);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isNullableString', () => {
  it('accepts null and strings', () => {
    expect(isNullableString(null)).toBe(true);
    expect(isNullableString('')).toBe(true);
    expect(isNullableString('test')).toBe(true);
  });

  it('rejects non-strings and undefined', () => {
    expect(isNullableString(undefined)).toBe(false);
    expect(isNullableString(123)).toBe(false);
    expect(isNullableString({})).toBe(false);
    expect(isNullableString([])).toBe(false);
    expect(isNullableString(true)).toBe(false);
  });
});

describe('readErrorMessage', () => {
  it('reads message from JSON error response', async () => {
    const res = Response.json({ message: 'Quota exceeded' }, { status: 429 });
    expect(await readErrorMessage(res)).toBe('Quota exceeded');
  });

  it('falls back when message is missing or not a string', async () => {
    const res = Response.json({ error: 'something' }, { status: 400 });
    expect(await readErrorMessage(res)).toBe('HTTP 400');
  });

  it('uses custom fallback when provided and response is not JSON with message', async () => {
    const res = new Response('Bad Gateway', { status: 502 });
    expect(await readErrorMessage(res, 'Custom 502')).toBe('Custom 502');
  });
});

describe('readError', () => {
  it('handles 429 rate limit', () => {
    expect(readError(429, null)).toBe('Too many requests for this sign-in. Wait a minute, then try again.');
  });

  it('reads message for 4xx errors', () => {
    expect(readError(400, { message: 'Bad request.' })).toBe('Bad request.');
  });

  it('formats server errors and missing messages as HTTP status', () => {
    expect(readError(400, null)).toBe('The backend could not answer (HTTP 400). Try again.');
    expect(readError(500, { message: 'Internal error' })).toBe(
      'The backend could not answer (HTTP 500). Try again.',
    );
    expect(readError(502, { message: 'Google did not answer' })).toBe(
      'The backend could not answer (HTTP 502). Try again.',
    );
  });
});

describe('getPublicJson', () => {
  const isTestData = (v: unknown): v is { count: number } => isRecord(v) && typeof v.count === 'number';

  it('fetches and validates json successfully', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ count: 42 })));
    const result = await getPublicJson('/api/test', isTestData);
    expect(result).toEqual({ count: 42 });
  });

  it('supports parsers returning T | null', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ count: 99 })));
    const result = await getPublicJson('/api/test', (raw) => (isTestData(raw) ? raw : null));
    expect(result).toEqual({ count: 99 });
  });

  it('returns null on invalid data', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ count: 'invalid' })));
    expect(await getPublicJson('/api/test', isTestData)).toBeNull();
  });

  it('returns null on non-ok response', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('Not found', { status: 404 })));
    expect(await getPublicJson('/api/test', isTestData)).toBeNull();
  });

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await getPublicJson('/api/test', isTestData)).toBeNull();
  });
});

describe('postJson', () => {
  it('posts JSON with session token and returns response and parsed body', async () => {
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect((init?.headers as Headers).get('x-gcportrait-token')).toBe(TOKEN);
      return Promise.resolve(Response.json({ success: true }));
    });
    const result = await postJson(auth(), '/api/action', { key: 'val' });
    expect(result).toMatchObject({
      kind: 'response',
      body: { success: true },
    });
  });

  it('handles non-JSON response by setting body to undefined', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('Not JSON', { status: 200 })));
    const result = await postJson(auth(), '/api/action', {});
    expect(result).toMatchObject({
      kind: 'response',
      body: undefined,
    });
  });

  it('returns signed-out when no token is available', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await postJson(auth(null), '/api/action', {});
    expect(result).toEqual({ kind: 'signed-out' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns signed-out when server answers 401', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(Response.json({ message: 'Unauthorized' }, { status: 401 })),
    );
    const controls = auth();
    const result = await postJson(controls, '/api/action', {});
    expect(result).toEqual({ kind: 'signed-out' });
    expect(controls.rejectedTokens).toEqual([TOKEN]);
  });

  it('re-throws when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', () => Promise.reject(new DOMException('Aborted', 'AbortError')));
    await expect(postJson(auth(), '/api/action', {}, controller.signal)).rejects.toThrow();
  });

  it('returns error kind on network error', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const result = await postJson(auth(), '/api/action', {});
    expect(result).toEqual({
      kind: 'error',
      message: 'The backend did not answer. Check your connection and try again.',
    });
  });
});
