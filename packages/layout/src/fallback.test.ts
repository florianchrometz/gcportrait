// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { directRoute, gridRoute } from './fallback.js';
import { ObstacleIndex } from './geometry.js';
import { checkLayout } from './invariants.js';
import { layoutSceneWith } from './layout.js';
import type { Port } from './ports.js';
import { card, scene, zone } from './testing/scenes.js';

function port(x: number, y: number, side: Port['side']): Port {
  return { x, y, side, inward: false, line: -1, t: 0, inset: 2 };
}

describe('gridRoute', () => {
  const bounds = { x: 0, y: 0, width: 400, height: 200 };
  // Two cards with a wall between them that reaches down to y = 150.
  const obstacles = new ObstacleIndex([
    { id: 'a', header: false, x: 20, y: 80, width: 100, height: 40 },
    { id: 'b', header: false, x: 280, y: 80, width: 100, height: 40 },
    { id: 'wall', header: true, x: 180, y: 0, width: 40, height: 150 },
  ]);

  it('goes around obstacles, leaving and entering perpendicular to the ports’ sides', () => {
    const points = gridRoute(obstacles, port(120, 100, 'right'), port(280, 100, 'left'), bounds, 8, 40);
    expect(points).not.toBeNull();
    const path = points ?? [];
    expect(path[0]).toEqual({ x: 120, y: 100 });
    expect(path[path.length - 1]).toEqual({ x: 280, y: 100 });
    for (let i = 1; i < path.length; i += 1) {
      const [p, q] = [path[i - 1], path[i]];
      if (p === undefined || q === undefined) continue;
      expect(p.x === q.x || p.y === q.y).toBe(true);
      expect(obstacles.blocked(p, q)).toBe(false);
    }
    // Below the wall, the only way through.
    expect(Math.max(...path.map((p) => p.y))).toBeGreaterThanOrEqual(150);
  });

  it('gives up when the target cannot be reached', () => {
    const boxed = new ObstacleIndex([
      { id: 'a', header: false, x: 20, y: 80, width: 100, height: 40 },
      { id: 'cage', header: false, x: 250, y: 0, width: 150, height: 200 },
    ]);
    expect(gridRoute(boxed, port(120, 100, 'right'), port(300, 100, 'left'), bounds, 8, 40)).toBeNull();
  });

  it('falls back to a plain orthogonal line when even the grid fails', () => {
    expect(directRoute(port(0, 0, 'right'), port(50, 30, 'left'))).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 30 },
    ]);
    expect(directRoute(port(0, 0, 'bottom'), port(50, 30, 'top'))).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 30 },
      { x: 50, y: 30 },
    ]);
  });
});

describe('the fallback in a layout', () => {
  it('routes every edge over the grid when no gutter path exists, counting and warning, within the invariants', () => {
    const input = scene(
      [zone('p', 'project', [card('a'), card('b'), card('c')]), zone('q', 'project', [card('d')])],
      [
        { from: 'a', to: 'd', kind: 'uses' },
        { from: 'c', to: 'b', kind: 'peers' },
      ],
    );
    const layout = layoutSceneWith(input, {}, { network: false });
    expect(Object.values(layout.edges).every((edge) => edge.fallback)).toBe(true);
    expect(layout.report.routing).toMatchObject({ fallbacks: 2, failed: 0 });
    expect(layout.report.warnings).toContain(
      '2 edge(s) found no gutter path and were routed over the coarse grid: a -uses-> d, b -peers-> c',
    );
    expect(checkLayout(input, layout)).toEqual([]);
  });

  it('warns about an edge not even the grid can route (cards with no gap between them)', () => {
    const options = { sizing: { gapHorizontal: 0, gapVertical: 0, zonePadding: 0 } };
    const input = scene(
      [zone('g', 'group', [card('a'), card('b'), card('c'), card('d')])],
      [{ from: 'a', to: 'd', kind: 'uses' }],
    );
    const layout = layoutSceneWith(input, options, { network: false });
    expect(layout.report.routing).toMatchObject({ fallbacks: 1, failed: 1 });
    expect(layout.report.warnings).toContain('1 edge(s) could not be routed around every card and header');
    // The plain orthogonal line it draws instead still has at least two points and a head 2 px inside.
    expect(layout.edges['a -uses-> d']?.points.length).toBeGreaterThanOrEqual(2);
  });
});
