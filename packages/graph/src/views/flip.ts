// SPDX-License-Identifier: MIT
/**
 * Flip ids: the per-zone expand/collapse overrides of the URL hash (the ViewSpec's `flips`, skill
 * gcp-diagram-layout §6). A zone id is a long resource name, so the hash stores a short token derived from it:
 * the 64-bit FNV-1a hash of the id's UTF-16 code units, in base 36 (at most 13 characters, which
 * `FlipIdSchema` accepts). The UI computes the token of a clicked chip with the same function.
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** The flip token of a scene zone id. Deterministic and the same in every runtime. */
export function flipIdOf(zoneId: string): string {
  let hash = FNV_OFFSET;
  for (let index = 0; index < zoneId.length; index += 1) {
    hash ^= BigInt(zoneId.charCodeAt(index));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(36);
}
