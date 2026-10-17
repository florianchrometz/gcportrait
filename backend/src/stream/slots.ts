// SPDX-License-Identifier: MIT
/**
 * The concurrent stream cap (skill cai-ingestion §4; docs/security.md §3): at most four streams at once
 * per token hash, across both streaming routes and the render route's pulls. In memory only; a slot is given back
 * exactly once, however the stream ends (finished, failed, or the client went away). With one slot under one key
 * it is the render lock too (`createRenderLock`, ../routes/render.ts).
 */

/** Streams one token may run at once. */
export const MAX_STREAMS_PER_TOKEN = 4;

/**
 * Seconds a client waits before trying again when all its slots are taken (`Retry-After` of that 429): a pull of a
 * large scope streams for tens of seconds, so sooner would mostly be refused again.
 */
export const STREAMS_BUSY_RETRY_SECONDS = 30;

export class StreamSlots {
  readonly #limit: number;
  readonly #used = new Map<string, number>();

  constructor(limit = MAX_STREAMS_PER_TOKEN) {
    this.#limit = limit;
  }

  /** Takes a slot for `key`; returns the function that gives it back (idempotent), or null when all are taken. */
  acquire(key: string): (() => void) | null {
    const used = this.#used.get(key) ?? 0;
    if (used >= this.#limit) return null;
    this.#used.set(key, used + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const now = (this.#used.get(key) ?? 1) - 1;
      if (now <= 0) this.#used.delete(key);
      else this.#used.set(key, now);
    };
  }

  /** Slots in use for `key` (tests and the log). */
  inUse(key: string): number {
    return this.#used.get(key) ?? 0;
  }

  /** Keys with a stream running (tests: proves nothing leaks). */
  get size(): number {
    return this.#used.size;
  }
}
