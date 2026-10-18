// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { compareDecimal, compareText, compareTimestamps } from './order.js';

const sign = (value: number) => Math.sign(value);

describe('compareText', () => {
  it.each([
    ['a', 'b', -1],
    ['b', 'a', 1],
    ['a', 'a', 0],
    ['Z', 'a', -1],
    ['ä', 'z', 1],
  ])('%s vs %s → %i', (left, right, expected) => {
    expect(sign(compareText(left, right))).toBe(expected);
  });
});

describe('compareDecimal', () => {
  it('orders decimal strings numerically', () => {
    expect(['10000000001', '900', '35', '10000000000', '36'].sort(compareDecimal)).toEqual([
      '35',
      '36',
      '900',
      '10000000000',
      '10000000001',
    ]);
    expect(compareDecimal('42', '42')).toBe(0);
  });
});

describe('compareTimestamps', () => {
  it.each([
    ['2026-10-07T18:22:41Z', '2026-10-07T18:22:42Z', -1],
    ['2026-10-07T20:22:41+02:00', '2026-10-07T18:22:41Z', 0],
    ['2026-10-07T20:22:41.5+02:00', '2026-10-07T18:22:41.4Z', 1],
    ['2026-10-07T18:22:41.123456Z', '2026-10-07T18:22:41.123Z', 1],
    ['2026-10-07T18:22:41.123Z', '2026-10-07T18:22:41.1234Z', -1],
    ['2026-10-07T18:22:41.123000Z', '2026-10-07T18:22:41.123Z', 0],
    ['2026-10-07T18:22:41.123456789Z', '2026-10-07T18:22:41.123456788Z', 1],
    ['not a time', '2026-10-07T18:22:41Z', 1],
    ['2026-10-07T18:22:41Z', 'not a time', -1],
    ['not a time', 'also not', 1],
  ])('%s vs %s → %i', (left, right, expected) => {
    expect(sign(compareTimestamps(left, right))).toBe(expected);
  });
});
