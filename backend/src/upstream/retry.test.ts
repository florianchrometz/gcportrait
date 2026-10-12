// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RETRY_POLICY, backoffDelay, isRetryableStatus, sleep } from './retry.js';

describe('the retry policy (skill cai-ingestion §4)', () => {
  it('is 500 ms, ×2, at most 8 s, 5 attempts', () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({ baseDelayMs: 500, maxDelayMs: 8000, attempts: 5 });
  });

  it('retries 429 and every 5xx, nothing else', () => {
    for (const status of [429, 500, 502, 503, 504, 599]) expect(isRetryableStatus(status)).toBe(true);
    for (const status of [200, 204, 400, 401, 403, 404, 409, 412, 428, 430, 600])
      expect(isRetryableStatus(status)).toBe(false);
  });

  it.each([
    [1, 500],
    [2, 1000],
    [3, 2000],
    [4, 4000],
    [5, 8000],
    [6, 8000],
    [7, 8000],
  ])(
    'waits within [ceiling / 2, ceiling] before retry %i (ceiling %i ms: doubled per retry, at most 8 s)',
    (retry, ceiling) => {
      for (const value of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999, 0.999_999_999]) {
        const delay = backoffDelay(retry, () => value, DEFAULT_RETRY_POLICY);
        expect(delay, String(value)).toBeGreaterThanOrEqual(ceiling / 2);
        expect(delay, String(value)).toBeLessThanOrEqual(ceiling);
      }
      // The jitter spans the ceiling's upper half: its bottom, its middle, and all but its very top.
      expect(backoffDelay(retry, () => 0, DEFAULT_RETRY_POLICY)).toBe(ceiling / 2);
      expect(backoffDelay(retry, () => 0.5, DEFAULT_RETRY_POLICY)).toBe((ceiling * 3) / 4);
      expect(backoffDelay(retry, () => 0.999_999_999, DEFAULT_RETRY_POLICY)).toBeGreaterThan(
        (ceiling * 99) / 100,
      );
    },
  );
});

describe('sleep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits on the timer', async () => {
    vi.useFakeTimers();
    let woke = false;
    const waiting = sleep(1000, new AbortController().signal).then(() => {
      woke = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(woke).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(woke).toBe(true);
  });

  it('stops at once when the signal aborts, with its reason', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = sleep(8000, controller.signal);
    const reason = new Error('client gone');
    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses to start on an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(new Error('gone'));
    await expect(sleep(10, controller.signal)).rejects.toThrow('gone');
  });
});
