// SPDX-License-Identifier: MIT
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StateHeap } from './heap.js';

describe('StateHeap', () => {
  it('pops by priority, then by tie key, then by state number', () => {
    const heap = new StateHeap();
    heap.push(5, 0, 9);
    heap.push(3, 2, 4);
    heap.push(3, 1, 7);
    heap.push(3, 1, 2);
    heap.push(1, 9, 8);
    expect(heap.size).toBe(5);
    expect([heap.pop(), heap.pop(), heap.pop(), heap.pop(), heap.pop(), heap.pop()]).toEqual([
      8, 2, 7, 4, 9, -1,
    ]);
    expect(heap.size).toBe(0);
  });

  it('grows past its first capacity and empties on clear', () => {
    const heap = new StateHeap();
    for (let i = 3000; i > 0; i -= 1) heap.push(i, 0, i);
    expect(heap.size).toBe(3000);
    expect(heap.pop()).toBe(1);
    heap.clear();
    expect(heap.size).toBe(0);
    expect(heap.pop()).toBe(-1);
  });

  it('agrees with a sort (random entries)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 5 })), {
          maxLength: 300,
        }),
        (entries) => {
          const heap = new StateHeap();
          entries.forEach(([priority, tie], state) => {
            heap.push(priority, tie, state);
          });
          const expected = entries
            .map(([priority, tie], state) => ({ priority, tie, state }))
            .sort((a, b) => a.priority - b.priority || a.tie - b.tie || a.state - b.state)
            .map((entry) => entry.state);
          const popped: number[] = [];
          while (heap.size > 0) popped.push(heap.pop());
          expect(popped).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
