// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { compareStrings, compareTuples, sortedRecord, sortedUnique } from './order.js';

describe('compareStrings', () => {
  it('orders by code unit, independent of locale', () => {
    expect(['b', 'B', 'a', 'é', 'A'].sort(compareStrings)).toEqual(['A', 'B', 'a', 'b', 'é']);
  });
});

describe('ordering helpers', () => {
  it('sortedUnique sorts and removes repeats', () => {
    expect(sortedUnique(['b', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('compareTuples orders by element, then by length', () => {
    expect(compareTuples(['a', 'b'], ['a', 'c'])).toBeLessThan(0);
    expect(compareTuples(['a'], ['a', 'b'])).toBeLessThan(0);
    expect(compareTuples(['a', 'b'], ['a', 'b'])).toBe(0);
  });

  it('sortedRecord keeps __proto__ as an own key', () => {
    const record = sortedRecord(
      new Map([
        ['__proto__', 1],
        ['a', 2],
      ]),
    );
    expect(Object.keys(record)).toEqual(['__proto__', 'a']);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });
});
