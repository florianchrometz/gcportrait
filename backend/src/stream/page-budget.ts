// SPDX-License-Identifier: MIT
/**
 * The process-wide budget of live-pull page bytes held in memory (docs/security.md "Response caps and
 * memory"). A Cloud Asset Inventory page is read whole (up to 25 MiB, `UPSTREAM_MAX_BYTES`) and written out
 * as one `page` frame (scanned, not parsed: list-page.ts). Pages held at once still add up: four at the cap
 * are about 100 MiB of bytes, and the per-token stream cap (slots.ts) does not bound them across tokens.
 *
 * Every page read claims its bytes here as they arrive, and keeps the claim until the response has written its
 * frame out to the connection (ndjson.ts asks the stream for its next line only then), or gives it back at once
 * when the page ends the stream with an error frame. A client that stops reading therefore keeps its page claimed
 * until it reads on, leaves, or is cut off after `STREAM_STALL_MS` (ndjson.ts). A claim that would take the total
 * over the budget is refused at once, never waited for, so no reader can block another: the page attempt fails as
 * `busy`, which the upstream client retries with its backoff like a timeout, and after the last attempt the
 * stream ends with a retryable `INSTANCE_BUSY` error frame. Typical pages are far below a megabyte, so only
 * several near-limit pages at once ever meet the budget. In memory only, per process.
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
