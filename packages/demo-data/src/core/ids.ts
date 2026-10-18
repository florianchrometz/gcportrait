// SPDX-License-Identifier: Apache-2.0
/** Identifier formats of the Google APIs and Kubernetes, drawn from a seeded generator. */
import type { Rng } from './rng.js';

/** Compute Engine's numeric resource id: an unsigned 64-bit integer, here always 19 digits. */
export function computeId(rng: Rng): string {
  return rng.digits(19);
}

/** A random (version 4) UUID. */
export function uuid(rng: Rng): string {
  const variant = rng.pick(['8', '9', 'a', 'b']);
  return `${rng.hex(8)}-${rng.hex(4)}-4${rng.hex(3)}-${variant}${rng.hex(3)}-${rng.hex(12)}`;
}

/** The alphabet Kubernetes uses for generated name suffixes (no vowels, no look-alike digits). */
const K8S_ALPHABET = 'bcdfghjklmnpqrstvwxz2456789';

/** A pod-name suffix such as `x2k9p`. */
export function podSuffix(rng: Rng): string {
  return rng.chars(K8S_ALPHABET, 5);
}

/** A ReplicaSet `pod-template-hash` such as `7d9c8b6f5d`. */
export function templateHash(rng: Rng): string {
  return rng.chars(K8S_ALPHABET, 10);
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A canonical ULID for an instant, with the 80 random bits drawn from `rng`. */
export function ulid(ms: number, rng: Rng): string {
  let time = '';
  let rest = ms;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD.charAt(rest % 32) + time;
    rest = Math.floor(rest / 32);
  }
  return time + rng.chars(CROCKFORD, 16);
}
