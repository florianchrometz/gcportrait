// SPDX-License-Identifier: Apache-2.0
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compareCodePoints,
  compareDecimal,
  compareSiblings,
  compareText,
  compareTimestamps,
  sortedRecord,
  type Orderable,
} from './order.js';

const sign = (value: number): number => Math.sign(value);
const T1 = '2026-10-01T08:00:00.000000Z';

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

describe('compareCodePoints', () => {
  it('orders like code points, not UTF-16 code units', () => {
    // U+1F600 (a surrogate pair) is above U+FF5E, although its first code unit 0xD83D is below 0xFF5E, so
    // JavaScript's own < puts it first.
    expect(compareCodePoints('😀', '～')).toBe(1);
    expect(compareCodePoints('～', '😀')).toBe(-1);
    expect(compareCodePoints('😀', 'a')).toBe(1);
    expect(compareCodePoints('a', 'b')).toBe(-1);
    expect(compareCodePoints('B', 'a')).toBe(-1); // locale-independent: upper case first
    expect(compareCodePoints('ab', 'a')).toBe(1);
    expect(compareCodePoints('a', 'ab')).toBe(-1);
    expect(compareCodePoints('same', 'same')).toBe(0);
  });

  it('agrees with comparing the arrays of code points', () => {
    const byArrays = (a: string, b: string): number => {
      const x = Array.from(a).map((c) => c.codePointAt(0) ?? 0);
      const y = Array.from(b).map((c) => c.codePointAt(0) ?? 0);
      for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
        if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
      }
      return x.length - y.length;
    };
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), fc.string({ unit: 'grapheme' }), (a, b) => {
        expect(sign(compareCodePoints(a, b))).toBe(sign(byArrays(a, b)));
      }),
    );
  });
});

describe('compareTimestamps', () => {
  it.each([
    ['2026-10-07T18:22:41.5Z', '2026-10-07T20:22:41.500+02:00'],
    ['2026-10-07T18:22:41Z', '2026-10-07T18:22:41.000000Z'],
    ['2026-10-07T18:22:41.123456Z', '2026-10-07t18:22:41.123456z'],
    ['2026-10-07T00:30:00-01:00', '2026-10-07T01:30:00Z'],
    ['2026-10-07T18:22:41.123000Z', '2026-10-07T18:22:41.123Z'],
  ])('treats %s and %s as the same instant', (a, b) => {
    expect(compareTimestamps(a, b)).toBe(0);
  });

  it.each([
    ['2026-10-07T18:22:41Z', '2026-10-07T18:22:42Z'],
    ['2026-10-07T18:22:41.123Z', '2026-10-07T18:22:41.1234Z'],
    ['2026-10-07T18:22:41.123455Z', '2026-10-07T18:22:41.123456Z'],
    ['2026-10-07T18:22:41.123456788Z', '2026-10-07T18:22:41.123456789Z'],
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

  it('falls back to text order for out-of-range calendar dates and components', () => {
    // 2026-02-30 does not exist; Date.UTC would overflow it to 2026-03-02
    expect(compareTimestamps('2026-02-30T00:00:00Z', '2026-03-02T00:00:00Z')).toBe(1);
    expect(compareTimestamps('2026-03-02T00:00:00Z', '2026-02-30T00:00:00Z')).toBe(-1);
    expect(compareTimestamps('2026-02-30T00:00:00Z', '2026-02-31T00:00:00Z')).toBe(-1);
    expect(compareTimestamps('2026-13-01T00:00:00Z', '2026-12-31T23:59:59Z')).toBe(1);
    expect(compareTimestamps('2026-04-31T00:00:00Z', '2026-05-01T00:00:00Z')).toBe(1);
    expect(compareTimestamps('2026-01-01T24:00:00Z', '2026-01-02T00:00:00Z')).toBe(1);
    expect(compareTimestamps('2026-01-01T00:60:00Z', '2026-01-01T01:00:00Z')).toBe(1);
    expect(compareTimestamps('2026-01-01T00:00:61Z', '2026-01-01T00:01:00Z')).toBe(1);
    expect(compareTimestamps('2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00Z')).toBe(1);
    expect(compareTimestamps('2026-01-01T00:00:00+00:60', '2026-01-01T00:00:00Z')).toBe(1);
  });
});

describe('compareSiblings', () => {
  const zone = (id: string, kind: Orderable['kind'], label = id): Orderable => ({
    id,
    type: 'zone',
    kind,
    label,
  });
  const card = (id: string, label = id): Orderable => ({ id, type: 'card', label });

  it('puts zones before cards, zones by kind rank, then label, then id', () => {
    const items = [
      card('c2', 'b'),
      card('c1', 'b'),
      card('c0', 'a'),
      zone('p', 'project', 'a'),
      zone('v', 'vpc', 'a'),
      zone('f2', 'folder', 'z'),
      zone('f1', 'folder', 'z'),
      zone('g', 'group', 'a'),
      zone('s', 'subnet', 'a'),
      zone('r', 'region', 'a'),
      zone('x', 'product-container', 'a'),
    ];
    expect([...items].sort(compareSiblings).map((item) => item.id)).toEqual([
      'f1',
      'f2',
      'p',
      'v',
      's',
      'r',
      'x',
      'g',
      'c0',
      'c1',
      'c2',
    ]);
  });
});

describe('sortedRecord', () => {
  it('sorts keys by compareText by default', () => {
    const map = new Map([
      ['b', 2],
      ['a', 1],
      ['c', 3],
    ]);
    expect(sortedRecord(map)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('allows a custom key comparator such as compareDecimal', () => {
    const map = new Map([
      ['10000000001', 'b'],
      ['900', 'a'],
      ['35', 'c'],
    ]);
    expect(sortedRecord(map, compareDecimal)).toEqual({
      '35': 'c',
      '900': 'a',
      '10000000001': 'b',
    });
  });
});
