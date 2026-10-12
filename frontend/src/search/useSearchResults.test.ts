// @vitest-environment node
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import type { SearchHit, SearchKind } from './protocol';
import { groupHits } from './useSearchResults';

function hit(id: string, kind: SearchKind): SearchHit {
  return { id, label: id, kind, typeName: 'Type', icon: 'cloud_generic', hidden: false, tier: 'fuzzy' };
}

describe('groupHits', () => {
  it('groups by kind in the order of each kind’s best hit, keeping the rank inside a kind', () => {
    const ranked = [
      hit('a', 'resource'),
      hit('b', 'project'),
      hit('c', 'resource'),
      hit('d', 'network'),
      hit('e', 'project'),
    ];
    expect(groupHits(ranked).map((entry) => entry.id)).toEqual(['a', 'c', 'b', 'e', 'd']);
    expect(groupHits([])).toEqual([]);
  });
});
