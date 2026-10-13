// SPDX-License-Identifier: MIT
/**
 * The layout worker's memo key: a structural hash of a Scene's tree (not its metadata, which the layout
 * does not read) and the layout options. Two values that are equal as data hash alike, whatever the
 * order of their objects' keys (zod lists a parsed object's keys in schema order, a hand-built Scene in any
 * order); arrays keep their order, so two Scenes whose
 * children or edges are listed in another order hash apart even though they lay out alike (the memo then
 * computes once more; it never returns a wrong Layout).
 *
 * The value is walked once, depth first, and every token is fed into two 32-bit hash lanes: a type tag per
 * value, a length before every string, array and object (so `["ab", "c"]` and `["a", "bc"]` differ), object
 * keys in code-unit order with keys whose value is `undefined` left out (as JSON leaves them out), numbers in
 * their shortest round-trip text (`-0` as `0`). Text is fed two UTF-16 code units at a time; each lane rotates,
 * xors and multiplies by its own constants. At the end each lane is avalanched and the two are cross-mixed,
 * giving 64 bits as 16 hex digits, followed by the number of code units fed, in base 36. Deterministic: no
 * randomness, no seed, no platform dependence (only `Math.imul` and 32-bit integer arithmetic). It walks a
 * demo XL Scene at `folders` (217 000 characters of JSON) in about 0.7 ms.
 *
 * A value that is not plain data (a function, a symbol), that nests objects and arrays more than
 * `MAX_KEY_DEPTH` levels deep (a value that contains itself, a cycle, nests without end) or that takes more
 * than `MAX_KEY_UNITS` code units to walk (a subtree shared many times over) has no key: the worker then lays
 * it out without the memo, and the layout itself refuses a Scene that is not a tree with its typed error. A
 * subtree reached twice without a cycle is hashed twice, like the data it stands for.
 */
import type { Scene } from '@gcportrait/model';
import { MAX_SCENE_DEPTH } from './constants.js';
import type { LayoutWorkerOptions } from './types.js';

/**
 * Levels of objects and arrays the hash walks at most: a Scene at the layout's depth limit nests two levels
 * per zone (the zone and its `children` array), plus the envelope; deeper values have no key.
 */
export const MAX_KEY_DEPTH = 2 * MAX_SCENE_DEPTH + 16;

/**
 * Code units the hash feeds at most (2^27, about half a second of hashing): far above the largest demo Scene
 * (XL with every zone open), it bounds the walk of a value whose shared subtrees multiply its size.
 */
export const MAX_KEY_UNITS = 2 ** 27;

/** The value cannot be hashed: not plain data, not a tree, or too deep. */
class Unhashable extends Error {}

// Type tags, fed before each value.
const TAG_UNDEFINED = 1;
const TAG_NULL = 2;
const TAG_FALSE = 3;
const TAG_TRUE = 4;
const TAG_NUMBER = 5;
const TAG_STRING = 6;
const TAG_ARRAY = 7;
const TAG_OBJECT = 8;
const TAG_BIGINT = 9;

// Lane A multiplies by the 32-bit FNV prime, lane B by an odd constant from the golden ratio; tags and lengths
// are xored in before the multiply, text words after a rotation (13 and 5 bits). The finaliser's constants
// are odd multipliers with good avalanche behaviour.
const SEED_A = 0x811c9dc5;
const PRIME_A = 0x01000193;
const SEED_B = 0x9e3779b9;
const PRIME_B = 0x61c88647;
const MIX_1 = 0x7feb352d;
const MIX_2 = 0x846ca68b;

/** Above this many keys an object's keys are sorted with `Array.prototype.sort`, below by insertion. */
const INSERTION_SORT_MAX = 16;

/** An object's keys whose value is not `undefined`, in code-unit order (locale-independent). */
function definedKeys(record: Readonly<Record<string, unknown>>): string[] {
  const keys = Object.keys(record);
  let n = 0;
  for (const key of keys) if (record[key] !== undefined) keys[n++] = key;
  keys.length = n;
  if (n > INSERTION_SORT_MAX) return keys.sort();
  // A Scene's objects have a handful of keys: insertion sort beats the generic sort there.
  for (let i = 1; i < n; i += 1) {
    const key = keys[i] as string;
    let j = i - 1;
    for (; j >= 0 && (keys[j] as string) > key; j -= 1) keys[j + 1] = keys[j] as string;
    keys[j + 1] = key;
  }
  return keys;
}

/** The running state of one hash: two lanes and the number of code units fed. */
class Hasher {
  a = SEED_A;
  b = SEED_B;
  units = 0;

  unit(unit: number): void {
    this.a = Math.imul(this.a ^ unit, PRIME_A);
    this.b = Math.imul(((this.b << 5) | (this.b >>> 27)) ^ unit, PRIME_B);
    this.units += 1;
  }

  /** A length or count as two 16-bit units (lengths above 2^32 do not occur). */
  length(length: number): void {
    this.unit(length & 0xffff);
    this.unit((length >>> 16) & 0xffff);
  }

  /** A tag, then the text's length, then its code units. */
  text(tag: number, text: string): void {
    const { length } = text;
    const low = length & 0xffff;
    const high = length >>> 16;
    let a = Math.imul(Math.imul(Math.imul(this.a ^ tag, PRIME_A) ^ low, PRIME_A) ^ high, PRIME_A);
    let b = Math.imul(((this.b << 5) | (this.b >>> 27)) ^ tag, PRIME_B);
    b = Math.imul(((b << 5) | (b >>> 27)) ^ low, PRIME_B);
    b = Math.imul(((b << 5) | (b >>> 27)) ^ high, PRIME_B);
    // Two code units per step: a 32-bit word (the odd last unit alone; the length tells the two apart).
    const pairs = length - (length & 1);
    for (let i = 0; i < pairs; i += 2) {
      const word = text.charCodeAt(i) | (text.charCodeAt(i + 1) << 16);
      a = Math.imul(((a << 13) | (a >>> 19)) ^ word, PRIME_A);
      b = Math.imul(((b << 5) | (b >>> 27)) ^ word, PRIME_B);
    }
    if (pairs < length) {
      const unit = text.charCodeAt(pairs);
      a = Math.imul(((a << 13) | (a >>> 19)) ^ unit, PRIME_A);
      b = Math.imul(((b << 5) | (b >>> 27)) ^ unit, PRIME_B);
    }
    this.a = a;
    this.b = b;
    this.units += length + 3;
  }

  value(value: unknown, depth: number): void {
    switch (typeof value) {
      case 'string':
        this.text(TAG_STRING, value);
        return;
      case 'number':
        // String(-0) is "0"; NaN and the infinities have texts of their own.
        this.text(TAG_NUMBER, String(value));
        return;
      case 'boolean':
        this.unit(value ? TAG_TRUE : TAG_FALSE);
        return;
      case 'undefined':
        this.unit(TAG_UNDEFINED);
        return;
      case 'bigint':
        this.text(TAG_BIGINT, value.toString());
        return;
      case 'object':
        break;
      default:
        // function, symbol: not data (they cannot cross postMessage either).
        throw new Unhashable();
    }
    if (value === null) {
      this.unit(TAG_NULL);
      return;
    }
    // A cycle nests without end, so the depth limit ends it; the unit limit ends a walk that shared subtrees
    // make exponential.
    if (depth >= MAX_KEY_DEPTH || this.units > MAX_KEY_UNITS) throw new Unhashable();
    if (Array.isArray(value)) {
      const items: readonly unknown[] = value;
      this.unit(TAG_ARRAY);
      this.length(items.length);
      for (const item of items) this.value(item, depth + 1);
    } else {
      const record = value as Readonly<Record<string, unknown>>;
      const keys = definedKeys(record);
      this.unit(TAG_OBJECT);
      this.length(keys.length);
      for (const key of keys) {
        // Keys carry the string tag too: a key and a string value are fed alike.
        this.text(TAG_STRING, key);
        this.value(record[key], depth + 1);
      }
    }
  }
}

/** A 32-bit finaliser: every input bit affects every output bit. */
function avalanche(h: number): number {
  let x = h ^ (h >>> 16);
  x = Math.imul(x, MIX_1);
  x ^= x >>> 15;
  x = Math.imul(x, MIX_2);
  return (x ^ (x >>> 16)) >>> 0;
}

function hex(n: number): string {
  return n.toString(16).padStart(8, '0');
}

/**
 * The structural hash of a plain-data value (see the module comment), or `null` when it has none (not plain
 * data, not a tree, or nested deeper than `MAX_KEY_DEPTH`).
 */
export function structuralHash(value: unknown): string | null {
  const state = new Hasher();
  try {
    state.value(value, 0);
  } catch (error) {
    if (error instanceof Unhashable) return null;
    throw error;
  }
  const a = avalanche(state.a ^ state.units);
  const b = avalanche(state.b ^ Math.imul(state.units, PRIME_A));
  const high = avalanche(a ^ Math.imul(b, PRIME_B));
  const low = avalanche(b ^ Math.imul(a, PRIME_A));
  return `${hex(high)}${hex(low)}-${state.units.toString(36)}`;
}

/**
 * The memo key of a layout request: the structural hash of the Scene's tree (its `children` and `edges`) and the
 * options together (absent options count as `{}`), or `null` when either has none (options with a `clock` have
 * none: a function is not data; the worker takes its clock from its environment). The Scene's `metadata` (root
 * label, lens, read time, rect count, refusals) is left out: the layout never reads it (`layout.test.ts` proves
 * it), so two timeline days whose Scenes differ only in their read time share one Layout.
 */
export function layoutKey(scene: Scene, options: LayoutWorkerOptions = {}): string | null {
  return structuralHash({ scene: { children: scene.children, edges: scene.edges }, options });
}
