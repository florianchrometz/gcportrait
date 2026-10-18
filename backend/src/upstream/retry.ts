// SPDX-License-Identifier: Apache-2.0
/**
 * Retries of transient upstream answers (skill cai-ingestion §4): 429 and 5xx statuses, timeouts and broken
 * connections are tried again with exponential backoff and jitter (base 500 ms, doubling, at most 8 s, 5
 * attempts); every other answer (400, 401, 403, 404, …) is final, because it is actionable and would only
 * repeat. request.ts applies the policy; the waits are injectable so tests neither sleep nor depend on chance.
 */

export interface RetryPolicy {
  /** Attempts in all, the first included. */
  readonly attempts: number;
  /** The first wait, before jitter. */
  readonly baseDelayMs: number;
  /** The cap on one wait, before jitter. */
  readonly maxDelayMs: number;
}

/** Skill §4: base 500 ms, ×2, at most 8 s, 5 attempts. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  attempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 8000,
});

/** Waits `ms`, or rejects with the signal's reason as soon as it aborts. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export const sleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason as Error);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

/** Whether an HTTP status is worth another attempt (skill §4): 429 and every 5xx. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * The wait after failed attempt `attempt` (from 1): the exponential step capped at `maxDelayMs`, with "equal
 * jitter" (half of it fixed, half random), so waits neither collapse to zero nor fall into step.
 */
export function backoffDelay(attempt: number, random: () => number, policy: RetryPolicy): number {
  const step = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(step / 2 + random() * (step / 2));
}
