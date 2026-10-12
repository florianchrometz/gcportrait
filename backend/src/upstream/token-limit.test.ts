// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { TokenRateLimiter } from './token-limit.js';

describe('TokenRateLimiter', () => {
  it('allows `max` requests per key and window, then says when to retry', () => {
    let now = 1_000_000;
    const limiter = new TokenRateLimiter({ max: 2, windowMs: 60_000, now: () => now });
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(true);
    now += 15_000;
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterSeconds: 45 });
    // Another key has its own budget.
    expect(limiter.take('b').allowed).toBe(true);
    // A new window starts once the old one is over.
    now += 45_000;
    expect(limiter.take('a').allowed).toBe(true);
  });

  it('keeps at most `maxKeys` windows, dropping expired ones first, then the oldest', () => {
    let now = 0;
    const limiter = new TokenRateLimiter({ max: 1, windowMs: 1000, maxKeys: 3, now: () => now });
    limiter.take('a');
    limiter.take('b');
    limiter.take('c');
    expect(limiter.size).toBe(3);
    now = 500;
    limiter.take('d');
    expect(limiter.size).toBe(3);
    // 'a' (the oldest) went; 'b' is still limited within its window.
    expect(limiter.take('b').allowed).toBe(false);
    now = 2000;
    limiter.take('e');
    expect(limiter.size).toBeLessThanOrEqual(3);
  });
});
