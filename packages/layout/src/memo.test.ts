// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { LayoutMemo, MEMO_CAPACITY } from './memo.js';
import type { Layout } from './types.js';

/** Stand-in Layouts: the memo only stores and returns them. */
function fake(name: string): Layout {
  return { chips: [name] } as unknown as Layout;
}

describe('LayoutMemo', () => {
  it('keeps MEMO_CAPACITY Layouts by default and evicts the least recently used', () => {
    const memo = new LayoutMemo();
    expect(memo.capacity).toBe(MEMO_CAPACITY);
    const key = (i: number): string => `k${String(i)}`;
    for (let i = 0; i < MEMO_CAPACITY; i += 1) memo.set(key(i), fake(`l${String(i)}`));
    expect(memo.size).toBe(MEMO_CAPACITY);
    // Using k0 makes k1 the least recently used.
    expect(memo.get('k0')).toEqual(fake('l0'));
    memo.set(key(MEMO_CAPACITY), fake('newest'));
    expect(memo.size).toBe(MEMO_CAPACITY);
    expect(memo.get('k1')).toBeUndefined();
    expect(memo.keys()).toEqual([
      ...Array.from({ length: MEMO_CAPACITY - 2 }, (_, i) => key(i + 2)),
      'k0',
      key(MEMO_CAPACITY),
    ]);
  });

  it('replaces a stored key as the most recently used', () => {
    const memo = new LayoutMemo(2);
    memo.set('a', fake('1'));
    memo.set('b', fake('2'));
    memo.set('a', fake('3'));
    memo.set('c', fake('4'));
    expect(memo.keys()).toEqual(['a', 'c']);
    expect(memo.get('a')).toEqual(fake('3'));
  });

  it('returns the stored object itself (byte-identical by construction)', () => {
    const memo = new LayoutMemo(1);
    const layout = fake('x');
    memo.set('x', layout);
    expect(memo.get('x')).toBe(layout);
    expect(memo.get('missing')).toBeUndefined();
  });

  it('keeps nothing at capacity 0, and clears', () => {
    const off = new LayoutMemo(0);
    off.set('a', fake('a'));
    expect(off.size).toBe(0);
    const memo = new LayoutMemo(3);
    memo.set('a', fake('a'));
    memo.clear();
    expect(memo.size).toBe(0);
  });

  it('refuses a capacity that is not a non-negative integer', () => {
    expect(() => new LayoutMemo(-1)).toThrow(RangeError);
    expect(() => new LayoutMemo(1.5)).toThrow(RangeError);
    expect(() => new LayoutMemo(Number.NaN)).toThrow(RangeError);
  });
});
