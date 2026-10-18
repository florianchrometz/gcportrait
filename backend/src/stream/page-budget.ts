// SPDX-License-Identifier: Apache-2.0
/**
 * Process-wide claims for live-pull page bytes (docs/security.md, "Response caps and memory").
 * Claims grow as bytes arrive and remain held until the frame is written out; an error, cancellation
 * or closed response releases them. The per-token slot limit cannot bound bytes across tokens.
 *
 * A claim over the budget is refused synchronously, never queued, so readers cannot block one another.
 * The upstream client retries that busy attempt; asset-list.ts maps exhaustion to INSTANCE_BUSY.
 * Released claims cannot grow again, and release is idempotent. ndjson.ts owns stalled-client cleanup.
 */
import type { ByteClaim } from '../upstream/request.js';

export type { ByteClaim } from '../upstream/request.js';

/** 64 MiB of raw page bytes: two pages at the 25 MiB cap plus room for small ones; about 5x that at the peak. */
export const DEFAULT_PAGE_BUDGET_BYTES = 64 * 1024 * 1024;

export class PageBudget {
  readonly #limit: number;
  #used = 0;

  constructor(limit = DEFAULT_PAGE_BUDGET_BYTES) {
    this.#limit = limit;
  }

  /** A new, empty claim on the budget. */
  claim(): ByteClaim {
    let held = 0;
    let released = false;
    return {
      take: (bytes) => {
        if (released || this.#used + bytes > this.#limit) return false;
        this.#used += bytes;
        held += bytes;
        return true;
      },
      release: () => {
        if (released) return;
        released = true;
        this.#used -= held;
        held = 0;
      },
    };
  }

  /** Bytes claimed now (tests and the log). */
  get used(): number {
    return this.#used;
  }

  get limit(): number {
    return this.#limit;
  }
}
