// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { keepNewest } from './lru';

describe('keepNewest', () => {
  it('keeps the newest entries up to the capacity, oldest out first', () => {
    const kept = new Map<string, number>();
    keepNewest(kept, 'a', 1, 2);
    keepNewest(kept, 'b', 2, 2);
    keepNewest(kept, 'c', 3, 2);
    expect([...kept.keys()]).toEqual(['b', 'c']);
  });

  it('makes a re-set key the newest, and keeps every entry under the capacity', () => {
    const kept = new Map<string, number>();
    keepNewest(kept, 'a', 1, 2);
    keepNewest(kept, 'b', 2, 2);
    keepNewest(kept, 'a', 11, 2);
    expect([...kept.entries()]).toEqual([
      ['b', 2],
      ['a', 11],
    ]);
    keepNewest(kept, 'b', 22, 4);
    expect(kept.size).toBe(2);
  });
});
