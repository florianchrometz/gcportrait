// SPDX-License-Identifier: Apache-2.0
/**
 * ULIDs for snapshot ids, from a caller-supplied clock and entropy source. The package never reads the time
 * or a random source itself (pure core).
 */
import { IngestError } from './errors.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAX_TIME = 2 ** 48 - 1;

/**
 * A canonical ULID: 10 characters of millisecond time, 16 of entropy, Crockford base 32, upper case.
 * @param time milliseconds since the Unix epoch, an integer from 0 to 2^48 − 1
 * @param entropy returns numbers in [0, 1), like `Math.random`; called 16 times
 */
export function ulid(time: number, entropy: () => number): string {
  if (!Number.isInteger(time) || time < 0 || time > MAX_TIME) {
    throw new IngestError(
      'invalid-options',
      `The clock returned ${String(time)}, not a time in milliseconds.`,
    );
  }
  let encoded = '';
  let rest = time;
  for (let index = 0; index < 10; index += 1) {
    encoded = CROCKFORD.charAt(rest % 32) + encoded;
    rest = Math.floor(rest / 32);
  }
  for (let index = 0; index < 16; index += 1) {
    const sample = entropy();
    if (!(sample >= 0 && sample < 1)) {
      throw new IngestError(
        'invalid-options',
        `The entropy source returned ${String(sample)}, not a number in [0, 1).`,
      );
    }
    encoded += CROCKFORD.charAt(Math.floor(sample * 32));
  }
  return encoded;
}
