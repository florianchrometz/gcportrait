// SPDX-License-Identifier: MIT
/**
 * The rate limit per token hash (docs/security.md §3): a fixed window per key, in memory
 * only, keyed by the SHA-256 of the caller's token (`tokenKeyOf`), never by the token itself.
 *
 * It runs in a route's handler, after the server-wide limit per client address (`@fastify/rate-limit`, global),
 * so both apply: the plugin runs one limiter per request (a second `app.rateLimit()` preHandler after the global
 * hook is skipped), which is why this one is separate.
 */

export interface TokenRateLimiterOptions {
  /** Requests per key and window. */
  readonly max: number;
  readonly windowMs?: number;
  /** Keys kept at most; the oldest windows are dropped first. A brake on memory, not a security bound. */
  readonly maxKeys?: number;
  readonly now?: () => number;
}

export interface TokenRateDecision {
  readonly allowed: boolean;
  /** Whole seconds until the key's window ends (for `retry-after`); 0 when allowed. */
  readonly retryAfterSeconds: number;
}

interface Window {
  readonly start: number;
  count: number;
}

export class TokenRateLimiter {
  readonly #max: number;
  readonly #windowMs: number;
  readonly #maxKeys: number;
  readonly #now: () => number;
  readonly #windows = new Map<string, Window>();

  constructor(options: TokenRateLimiterOptions) {
    this.#max = options.max;
    this.#windowMs = options.windowMs ?? 60_000;
    this.#maxKeys = options.maxKeys ?? 10_000;
    this.#now = options.now ?? Date.now;
  }

  /** Counts one request for `key` and says whether it is within the limit. */
  take(key: string): TokenRateDecision {
    const now = this.#now();
    let window = this.#windows.get(key);
    if (window === undefined || now - window.start >= this.#windowMs) {
      this.#windows.delete(key);
      this.#prune(now);
      window = { start: now, count: 0 };
      this.#windows.set(key, window);
    }
    window.count += 1;
    if (window.count <= this.#max) return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((window.start + this.#windowMs - now) / 1000)),
    };
  }

  /** Keys with a window open (tests). */
  get size(): number {
    return this.#windows.size;
  }

  #prune(now: number): void {
    if (this.#windows.size < this.#maxKeys) return;
    for (const [key, window] of this.#windows) {
      if (now - window.start >= this.#windowMs) this.#windows.delete(key);
    }
    // Still full: drop the oldest windows (a Map iterates in insertion order).
    for (const key of this.#windows.keys()) {
      if (this.#windows.size < this.#maxKeys) break;
      this.#windows.delete(key);
    }
  }
}
