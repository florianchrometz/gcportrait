// SPDX-License-Identifier: Apache-2.0
/**
 * The fallback router (skill gcp-diagram-layout §5 "Fallback"): when no gutter path joins an edge's ports,
 * which the gutter construction rules out, the edge is routed by A* over a coarse grid (`fallbackGrid`, 8 px)
 * that avoids every card, chip, empty zone and zone header. The grid's columns and rows are the multiples of
 * the cell size inside the canvas plus the two ports' own coordinates, so a route starts and ends exactly at its
 * ports. Cost: length plus `bendCost` per bend; the route must leave and enter its ports perpendicular to their
 * sides. The router counts such edges and warns about them (`report.routing.fallbacks`).
 */
import { normalOf, type ObstacleIndex } from './geometry.js';
import { StateHeap } from './heap.js';
import type { Port } from './ports.js';
import type { Point, Rect } from './types.js';

/** Most grid states a fallback search may expand before it gives up. */
export const FALLBACK_EXPANSIONS = 400_000;

function axisCoordinates(from: number, to: number, step: number, extra: readonly number[]): number[] {
  const values = new Set<number>(extra);
  for (let v = Math.ceil(from / step) * step; v <= to; v += step) values.add(v);
  return [...values].sort((a, b) => a - b);
}

/**
 * A route from port `a` to port `b` over the coarse grid inside `bounds`, avoiding `obstacles`; null when none
 * is found within `FALLBACK_EXPANSIONS` expansions. The points run from `a` to `b`, bends only.
 */
export function gridRoute(
  obstacles: ObstacleIndex,
  a: Port,
  b: Port,
  bounds: Rect,
  step: number,
  bendCost: number,
): Point[] | null {
  const xs = axisCoordinates(bounds.x, bounds.x + bounds.width, step, [a.x, b.x]);
  const ys = axisCoordinates(bounds.y, bounds.y + bounds.height, step, [a.y, b.y]);
  const ny = ys.length;
  const startAxis = a.side === 'left' || a.side === 'right' ? 0 : 1;
  const goalAxis = b.side === 'left' || b.side === 'right' ? 0 : 1;
  const start = (xs.indexOf(a.x) * ny + ys.indexOf(a.y)) * 2 + startAxis;
  const goalPoint = xs.indexOf(b.x) * ny + ys.indexOf(b.y);
  const g = new Map<number, number>([[start, 0]]);
  const parent = new Map<number, number>([[start, -1]]);
  const closed = new Set<number>();
  const heap = new StateHeap();
  const estimate = (point: number): number => {
    const x = xs[Math.floor(point / ny)] as number;
    const y = ys[point % ny] as number;
    return Math.abs(x - b.x) + Math.abs(y - b.y);
  };
  heap.push(estimate(start >> 1), estimate(start >> 1), start);
  let expansions = 0;
  let found = -1;
  while (heap.size > 0 && expansions < FALLBACK_EXPANSIONS) {
    const state = heap.pop();
    if (closed.has(state)) continue;
    closed.add(state);
    expansions += 1;
    const point = state >> 1;
    const axis = state & 1;
    if (point === goalPoint && axis === goalAxis) {
      found = state;
      break;
    }
    const i = Math.floor(point / ny);
    const j = point % ny;
    const here = { x: xs[i] as number, y: ys[j] as number };
    const base = g.get(state) as number;
    const moves: [number, number, number][] = [
      [i - 1, j, 0],
      [i + 1, j, 0],
      [i, j - 1, 1],
      [i, j + 1, 1],
    ];
    for (const [ni, nj, moveAxis] of moves) {
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ny) continue;
      const there = { x: xs[ni] as number, y: ys[nj] as number };
      if (obstacles.blocked(here, there)) continue;
      const next = (ni * ny + nj) * 2 + moveAxis;
      const cost =
        base + Math.abs(there.x - here.x) + Math.abs(there.y - here.y) + (moveAxis === axis ? 0 : bendCost);
      if (cost < (g.get(next) ?? Infinity)) {
        g.set(next, cost);
        parent.set(next, state);
        const h = estimate(next >> 1);
        heap.push(cost + h, h, next);
      }
    }
  }
  if (found < 0) return null;
  const points: Point[] = [];
  for (let state = found; state >= 0; state = parent.get(state) as number) {
    const point = state >> 1;
    points.push({ x: xs[Math.floor(point / ny)] as number, y: ys[point % ny] as number });
  }
  points.reverse();
  return points;
}

/** The last resort when even the grid finds no way: a plain orthogonal line, counted as failed. */
export function directRoute(a: Port, b: Port): Point[] {
  const normal = normalOf(a.side);
  const corner = normal.x !== 0 ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  return [{ x: a.x, y: a.y }, corner, { x: b.x, y: b.y }];
}
