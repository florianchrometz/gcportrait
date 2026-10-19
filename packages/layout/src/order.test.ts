// SPDX-License-Identifier: Apache-2.0
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareCodePoints, compareSiblings, type Orderable } from './order.js';

const sign = (n: number): number => Math.sign(n);

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

describe('compareSiblings', () => {
  const zone = (id: string, kind: Orderable['kind'], label = id): Orderable => ({
    id,
    type: 'zone',
    kind,
    label,
  });
  const card = (id: string, label = id): Orderable => ({ id, type: 'card', kind: 'card', label });

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
