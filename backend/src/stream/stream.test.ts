// SPDX-License-Identifier: MIT
/**
 * What every stream shares: its slots per token (slots.ts) and the caller's token it keys them on
 * (caller.ts). The frames are frames.test.ts's.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { callerTokenOf, TOKEN_HEADER, tokenKeyOf } from './caller.js';
import { MAX_STREAMS_PER_TOKEN, StreamSlots } from './slots.js';

describe('StreamSlots', () => {
  it('gives four slots per key, each back exactly once', () => {
    const slots = new StreamSlots();
    expect(MAX_STREAMS_PER_TOKEN).toBe(4);
    const releases = Array.from({ length: 4 }, () => slots.acquire('a'));
    expect(releases.every((release) => release !== null)).toBe(true);
    expect(slots.acquire('a')).toBeNull();
    expect(slots.acquire('b')).not.toBeNull();
    releases[0]?.();
    releases[0]?.();
    expect(slots.inUse('a')).toBe(3);
    expect(slots.acquire('a')).not.toBeNull();
    expect(slots.acquire('a')).toBeNull();
  });

  it('forgets a key once its last slot is back', () => {
    const slots = new StreamSlots(2);
    const first = slots.acquire('a');
    const second = slots.acquire('a');
    first?.();
    second?.();
    expect(slots.size).toBe(0);
  });
});

describe('the caller’s token', () => {
  const request = (headers: Record<string, string | string[]>) => ({ headers });

  it('is read from X-Gcportrait-Token, the header the app sends, named as the app names it', () => {
    expect(TOKEN_HEADER).toBe('x-gcportrait-token');
    // The app's own constant (frontend/src/auth/fetch.ts), read as text: no package imports another's source.
    const client = readFileSync(
      path.resolve(import.meta.dirname, '../../../frontend/src/auth/fetch.ts'),
      'utf8',
    );
    expect(/export const TOKEN_HEADER = '([^']+)';/.exec(client)?.[1]).toBe(TOKEN_HEADER);
  });

  it.each([
    ['ya29.a0-b_c~d+e/f=', 'ya29.a0-b_c~d+e/f='],
    ['  ya29.padded  ', 'ya29.padded'],
  ])('accepts X-Gcportrait-Token %j', (value, token) => {
    expect(callerTokenOf(request({ [TOKEN_HEADER]: value }))).toBe(token);
  });

  it.each([
    ['empty', ''],
    ['a bearer header', 'Bearer ya29.x'],
    ['two words', 'a b'],
    ['broken across lines', 'ya29\nx'],
    // Sent twice, Node joins the values; an array is never a token either.
    ['sent twice', 'ya29.a, ya29.b'],
    ['an array', ['ya29.a', 'ya29.b']],
    ['longer than 4 KiB', 'a'.repeat(4097)],
  ] as const)('refuses an X-Gcportrait-Token that is %s', (_label, value) => {
    expect(callerTokenOf(request({ [TOKEN_HEADER]: value as string | string[] }))).toBeNull();
  });

  // The non-IAP path, only when X-Gcportrait-Token is absent. The scheme is case-insensitive and may be followed
  // by more than one space (RFC 7235 §2.1).
  it.each([
    ['Bearer ya29.a0-b_c~d+e/f=', 'ya29.a0-b_c~d+e/f='],
    ['bearer ya29.x', 'ya29.x'],
    ['BEARER ya29.x', 'ya29.x'],
    ['BeArEr ya29.x', 'ya29.x'],
    ['Bearer   ya29.x', 'ya29.x'],
    ['  Bearer ya29.x  ', 'ya29.x'],
  ])('accepts Authorization %j', (authorization, token) => {
    expect(callerTokenOf(request({ authorization }))).toBe(token);
  });

  it.each([
    ['empty', ''],
    ['a scheme without a token', 'Bearer'],
    ['a scheme and a space', 'Bearer '],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['two words', 'Bearer a b'],
    ['broken across lines', 'bearer\nx'],
    ['a token longer than 4 KiB', `Bearer ${'a'.repeat(4097)}`],
    ['a scheme without its space', 'Bearerya29.x'],
    ['a tab for the space', 'Bearer\tya29.x'],
    ['another word for the scheme', 'Bearers ya29.x'],
    ['a scheme with a prefix', 'xBearer ya29.x'],
  ])('refuses an Authorization that is %s', (_label, authorization) => {
    expect(callerTokenOf(request({ authorization }))).toBeNull();
  });

  it('is none without either header', () => {
    expect(callerTokenOf(request({}))).toBeNull();
  });

  it('comes from the dedicated header when both are sent; a malformed one is never replaced by Authorization', () => {
    expect(callerTokenOf(request({ [TOKEN_HEADER]: 'ya29.own', authorization: 'Bearer ya29.other' }))).toBe(
      'ya29.own',
    );
    expect(
      callerTokenOf(request({ [TOKEN_HEADER]: 'not a token', authorization: 'Bearer ya29.other' })),
    ).toBeNull();
  });

  it('keys the caps on a SHA-256 of the token, never the token', () => {
    const key = tokenKeyOf('ya29.synthetic');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('ya29');
    expect(tokenKeyOf('ya29.synthetic')).toBe(key);
    expect(tokenKeyOf('ya29.other')).not.toBe(key);
  });
});
