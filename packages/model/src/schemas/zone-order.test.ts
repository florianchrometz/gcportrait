// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { ZoneKindSchema } from './scene.js';
import { ZONE_KIND_RANK } from './zone-order.js';

describe('ZONE_KIND_RANK', () => {
  it('ranks every zone kind once, folders first, then projects, VPCs and subnets before other containers', () => {
    expect(Object.keys(ZONE_KIND_RANK).sort()).toEqual([...ZoneKindSchema.options].sort());
    const ranks = Object.values(ZONE_KIND_RANK);
    expect(new Set(ranks).size).toBe(ranks.length);
    const order = [...ZoneKindSchema.options].sort((a, b) => ZONE_KIND_RANK[a] - ZONE_KIND_RANK[b]);
    expect(order).toEqual(['folder', 'project', 'vpc', 'subnet', 'region', 'product-container', 'group']);
    expect(Object.isFrozen(ZONE_KIND_RANK)).toBe(true);
  });
});
