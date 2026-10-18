// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { ObstacleIndex, normalOf, segmentHitsRect, simplifyPolyline } from './geometry.js';

describe('segmentHitsRect', () => {
  const rect = { x: 10, y: 10, width: 100, height: 40 };
  it('counts a segment through the interior, not one along or touching the border', () => {
    expect(segmentHitsRect({ x: 0, y: 30 }, { x: 200, y: 30 }, rect)).toBe(true);
    expect(segmentHitsRect({ x: 50, y: 0 }, { x: 50, y: 20 }, rect)).toBe(true);
    expect(segmentHitsRect({ x: 0, y: 10 }, { x: 200, y: 10 }, rect)).toBe(false);
    expect(segmentHitsRect({ x: 110, y: 0 }, { x: 110, y: 100 }, rect)).toBe(false);
    expect(segmentHitsRect({ x: 0, y: 30 }, { x: 10, y: 30 }, rect)).toBe(false);
    expect(segmentHitsRect({ x: 200, y: 30 }, { x: 300, y: 30 }, rect)).toBe(false);
  });

  it('counts a point (a segment of no length) strictly inside', () => {
    expect(segmentHitsRect({ x: 50, y: 30 }, { x: 50, y: 30 }, rect)).toBe(true);
    expect(segmentHitsRect({ x: 10, y: 30 }, { x: 10, y: 30 }, rect)).toBe(false);
  });
});

describe('ObstacleIndex', () => {
  const index = new ObstacleIndex([
    { id: 'a', header: false, x: 0, y: 0, width: 100, height: 40 },
    { id: 'h', header: true, x: 600, y: 600, width: 300, height: 32 },
    { id: 'b', header: false, x: 2000, y: 0, width: 100, height: 40 },
  ]);
  it('reports every obstacle a segment passes through, in order, once', () => {
    expect(index.hits({ x: -10, y: 20 }, { x: 3000, y: 20 }).map((o) => o.id)).toEqual(['a', 'b']);
    expect(index.hits({ x: 700, y: 0 }, { x: 700, y: 2000 }).map((o) => o.id)).toEqual(['h']);
    expect(index.hits({ x: 300, y: 300 }, { x: 400, y: 300 })).toEqual([]);
    expect(index.blocked({ x: 650, y: 610 }, { x: 650, y: 620 })).toBe(true);
    expect(index.blocked({ x: 0, y: 40 }, { x: 100, y: 40 })).toBe(false);
  });
});

describe('simplifyPolyline', () => {
  it('drops repeated points and points between two others on one line, keeping turns and reversals', () => {
    expect(
      simplifyPolyline([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 5 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 5 },
    ]);
  });
});

describe('normalOf', () => {
  it('points out of each side', () => {
    expect([normalOf('left'), normalOf('right'), normalOf('top'), normalOf('bottom')]).toEqual([
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ]);
  });
});
