// SPDX-License-Identifier: MIT
/** Small, fast, deterministic string hashing (FNV-1a with a final avalanche). Not cryptographic. */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** A 32-bit unsigned hash of `text`, optionally mixed with a numeric `seed`. */
export function hash32(text: string, seed = 0): number {
  let h = (FNV_OFFSET ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
