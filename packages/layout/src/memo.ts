// SPDX-License-Identifier: MIT
/**
 * The layout worker's memo: the most recently used Layouts by request key (hash.ts), at most
 * `capacity` of them. A `Map` keeps its keys in insertion order, so moving a key to the end on every use makes
 * its first key the least recently used, which is the one evicted.
 */
import type { Layout } from './types.js';

/** Layouts the worker keeps by default (skill gcp-diagram-layout §7: "memoise by Scene hash"). */
export const MEMO_CAPACITY = 8;

export class LayoutMemo {
  readonly #capacity: number;
  readonly #entries = new Map<string, Layout>();

  /** `capacity` 0 keeps nothing (every request is laid out). */
  constructor(capacity: number = MEMO_CAPACITY) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
      throw new RangeError(`memo capacity must be a non-negative integer, not ${String(capacity)}`);
    }
    this.#capacity = capacity;
  }

  get capacity(): number {
    return this.#capacity;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** The keys from least to most recently used. */
  keys(): string[] {
    return [...this.#entries.keys()];
  }

  /** The Layout stored under `key`, which becomes the most recently used; undefined when there is none. */
  get(key: string): Layout | undefined {
    const layout = this.#entries.get(key);
    if (layout !== undefined) {
      this.#entries.delete(key);
      this.#entries.set(key, layout);
    }
    return layout;
  }

  /** Stores a Layout as the most recently used, evicting the least recently used beyond the capacity. */
  set(key: string, layout: Layout): void {
    if (this.#capacity === 0) return;
    this.#entries.delete(key);
    this.#entries.set(key, layout);
    for (const oldest of this.#entries.keys()) {
      if (this.#entries.size <= this.#capacity) break;
      this.#entries.delete(oldest);
    }
  }

  clear(): void {
    this.#entries.clear();
  }
}
