// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { compareTimestamps } from './timestamps.js';

const T1 = '2026-10-01T08:00:00.000000Z';

describe('compareTimestamps', () => {
  it.each([
    ['2026-10-07T18:22:41.5Z', '2026-10-07T20:22:41.500+02:00'],
    ['2026-10-07T18:22:41Z', '2026-10-07T18:22:41.000000Z'],
    ['2026-10-07T18:22:41.123456Z', '2026-10-07t18:22:41.123456z'],
    ['2026-10-07T00:30:00-01:00', '2026-10-07T01:30:00Z'],
  ])('treats %s and %s as the same instant', (a, b) => {
    expect(compareTimestamps(a, b)).toBe(0);
  });

  it.each([
    ['2026-10-07T18:22:41.123455Z', '2026-10-07T18:22:41.123456Z'],
    ['2026-10-07T18:22:41.9Z', '2026-10-07T18:22:42Z'],
    ['2026-10-07T20:00:00+02:00', '2026-10-07T19:00:00Z'],
    ['2026-02-28T23:59:59Z', '2026-03-01T00:00:00Z'],
  ])('orders %s before %s', (a, b) => {
    expect(compareTimestamps(a, b)).toBe(-1);
    expect(compareTimestamps(b, a)).toBe(1);
  });

  it('sorts text that is no timestamp after every timestamp, and such texts by string order', () => {
    expect(compareTimestamps('later', T1)).toBe(1);
    expect(compareTimestamps(T1, 'later')).toBe(-1);
    expect(compareTimestamps('a', 'b')).toBe(-1);
    expect(compareTimestamps('b', 'a')).toBe(1);
    expect(compareTimestamps('b', 'b')).toBe(0);
  });
});
