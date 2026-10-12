// SPDX-License-Identifier: MIT
/**
 * A small seedable pseudo-random generator (mulberry32). Every random choice in this package goes through it,
 * so a seed fully determines the output. `fork(label)` derives an independent stream from the seed and a label
 * only (not from how much the parent has been used), so adding a template never perturbs another one.
 */
import { hash32 } from './hash.js';

export class Rng {
  readonly seed: number;
  #state: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.#state = this.seed;
  }

  /** A float in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** One element of a non-empty list. */
  pick<T>(items: readonly T[]): T {
    return at(items, Math.floor(this.next() * items.length));
  }

  /** A shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = at(copy, i);
      copy[i] = at(copy, j);
      copy[j] = tmp;
    }
    return copy;
  }

  /** `count` characters drawn from `alphabet`. */
  chars(alphabet: string, count: number): string {
    let out = '';
    for (let i = 0; i < count; i++) out += alphabet.charAt(Math.floor(this.next() * alphabet.length));
    return out;
  }

  /** `count` lower-case hexadecimal digits. */
  hex(count: number): string {
    return this.chars('0123456789abcdef', count);
  }

  /** A decimal string of exactly `count` digits without a leading zero. */
  digits(count: number): string {
    return this.chars('123456789', 1) + this.chars('0123456789', count - 1);
  }

  /** An independent stream derived from this generator's seed and `label`. */
  fork(label: string): Rng {
    return new Rng(hash32(label, this.seed));
  }
}

/** `items[index]`, failing loudly instead of returning `undefined`. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined)
    throw new RangeError(`index ${String(index)} is outside a list of ${String(items.length)}`);
  return item;
}
