// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { formatUtcMinute } from './utcTime';

describe('UTC minute formatting', () => {
  it.each([
    ['2026-10-08T00:00:00Z', '2026-10-08 00:00 UTC'],
    ['2026-10-08T02:30:45.987654+02:00', '2026-10-08 00:30 UTC'],
    ['0000-01-01T00:00:00+01:00', '-000001-12-31 23:00 UTC'],
    ['9999-12-31T23:30:00-01:00', '+010000-01-01 00:30 UTC'],
  ])('formats the instant of %s without fixed date widths', (timestamp, expected) => {
    expect(formatUtcMinute(Date.parse(timestamp))).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 8.64e15 + 1])(
    'rejects invalid instant %s with RangeError',
    (instant) => {
      expect(() => formatUtcMinute(instant)).toThrow(RangeError);
    },
  );
});
