// SPDX-License-Identifier: MIT
import { UlidSchema } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { IngestError } from './errors.js';
import { seededEntropy } from './testing/helpers.js';
import { ulid } from './ulid.js';

describe('ulid', () => {
  it('encodes the time in the first ten characters and entropy in the last sixteen', () => {
    expect(ulid(0, () => 0)).toBe('00000000000000000000000000');
    expect(ulid(2 ** 48 - 1, () => 0.999999)).toBe('7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
    // 1469918176385 is the reference timestamp from the ULID specification.
    expect(ulid(1469918176385, () => 0).slice(0, 10)).toBe('01ARYZ6S41');
  });

  it('produces canonical ULIDs that sort by time', () => {
    const entropy = seededEntropy(7);
    const earlier = ulid(Date.UTC(2026, 0, 1), entropy);
    const later = ulid(Date.UTC(2026, 9, 8), entropy);
    expect(UlidSchema.safeParse(earlier).success).toBe(true);
    expect(UlidSchema.safeParse(later).success).toBe(true);
    expect(earlier < later).toBe(true);
  });

  it('is deterministic for a given clock reading and entropy sequence', () => {
    expect(ulid(1_000, seededEntropy(1))).toBe(ulid(1_000, seededEntropy(1)));
    expect(ulid(1_000, seededEntropy(1))).not.toBe(ulid(1_000, seededEntropy(2)));
  });

  it.each([-1, 1.5, 2 ** 48, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the clock reading %s',
    (time) => {
      expect(() => ulid(time, () => 0)).toThrow(IngestError);
    },
  );

  it.each([-0.1, 1, Number.NaN])('rejects the entropy sample %s', (sample) => {
    expect(() => ulid(0, () => sample)).toThrow(/entropy source returned/);
  });
});
