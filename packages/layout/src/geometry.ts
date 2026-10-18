// SPDX-License-Identifier: Apache-2.0
/**
 * Geometry shared by the router's fallback and the invariant checker: axis-parallel segments against the
 * interiors of rects, through a uniform grid index so that a check costs the rects near the segment, not every
 * rect of the layout. Borders are not interior: a segment that runs along a card's border or touches it does
 * not intersect it.
 */
import type { Point, Rect, Side } from './types.js';

/** Tolerance for comparing coordinates that went through divisions. */
export const EPSILON = 1e-6;

/** Whether the axis-parallel segment p–q passes through the interior of `rect`. */
export function segmentHitsRect(p: Point, q: Point, rect: Rect): boolean {
  const x0 = Math.min(p.x, q.x);
  const x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y);
  const y1 = Math.max(p.y, q.y);
  // Open intervals: touching a border is allowed, and a degenerate (point) segment counts when strictly inside.
  const overlapX =
    x0 === x1
      ? x0 > rect.x + EPSILON && x0 < rect.x + rect.width - EPSILON
      : x0 < rect.x + rect.width - EPSILON && x1 > rect.x + EPSILON;
  const overlapY =
    y0 === y1
      ? y0 > rect.y + EPSILON && y0 < rect.y + rect.height - EPSILON
      : y0 < rect.y + rect.height - EPSILON && y1 > rect.y + EPSILON;
  return overlapX && overlapY;
}

/** The outward unit normal of a side. */
export function normalOf(side: Side): Point {
  switch (side) {
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
  }
}

const CELL = 256;
/** Cells per row of the hash key; layouts are far smaller than CELL × KEY_SPAN px. */
const KEY_SPAN = 1 << 20;

/** A labelled obstacle: what `ObstacleIndex.hits` reports. */
export interface Obstacle extends Rect {
  /** The id of the rect, or of the zone whose header this is. */
  readonly id: string;
  readonly header: boolean;
}

/** Rects in a uniform grid, queried by axis-parallel segments. */
export class ObstacleIndex {
  private readonly cells = new Map<number, number[]>();
  readonly obstacles: readonly Obstacle[];

  constructor(obstacles: readonly Obstacle[]) {
    this.obstacles = obstacles;
    obstacles.forEach((rect, index) => {
      for (let cx = cellOf(rect.x); cx <= cellOf(rect.x + rect.width); cx += 1) {
        for (let cy = cellOf(rect.y); cy <= cellOf(rect.y + rect.height); cy += 1) {
          const key = cx * KEY_SPAN + cy;
          const list = this.cells.get(key);
          if (list === undefined) this.cells.set(key, [index]);
          else list.push(index);
        }
      }
    });
  }

  /** Every obstacle whose interior the segment p–q passes through, in index order. */
  hits(p: Point, q: Point): Obstacle[] {
    const found = new Set<number>();
    for (let cx = cellOf(Math.min(p.x, q.x)); cx <= cellOf(Math.max(p.x, q.x)); cx += 1) {
      for (let cy = cellOf(Math.min(p.y, q.y)); cy <= cellOf(Math.max(p.y, q.y)); cy += 1) {
        for (const index of this.cells.get(cx * KEY_SPAN + cy) ?? []) {
          const rect = this.obstacles[index];
          if (rect !== undefined && !found.has(index) && segmentHitsRect(p, q, rect)) found.add(index);
        }
      }
    }
    return [...found].sort((a, b) => a - b).map((index) => this.obstacles[index] as Obstacle);
  }

  /** Whether the segment p–q passes through the interior of any obstacle. */
  blocked(p: Point, q: Point): boolean {
    for (let cx = cellOf(Math.min(p.x, q.x)); cx <= cellOf(Math.max(p.x, q.x)); cx += 1) {
      for (let cy = cellOf(Math.min(p.y, q.y)); cy <= cellOf(Math.max(p.y, q.y)); cy += 1) {
        for (const index of this.cells.get(cx * KEY_SPAN + cy) ?? []) {
          const rect = this.obstacles[index];
          if (rect !== undefined && segmentHitsRect(p, q, rect)) return true;
        }
      }
    }
    return false;
  }
}

function cellOf(value: number): number {
  return Math.max(0, Math.floor(value / CELL));
}

/** Points without consecutive repeats and without middle points that lie between their neighbours on a line. */
export function simplifyPolyline(points: readonly Point[]): Point[] {
  const deduped: Point[] = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last === undefined || Math.abs(last.x - point.x) > EPSILON || Math.abs(last.y - point.y) > EPSILON)
      deduped.push(point);
  }
  const result: Point[] = [];
  for (const point of deduped) {
    const b = result[result.length - 1];
    const a = result[result.length - 2];
    if (a !== undefined && b !== undefined && between(a, b, point)) result[result.length - 1] = point;
    else result.push(point);
  }
  return result;
}

/** Whether b lies on the straight segment a–c (a, b, c on one horizontal or vertical line, b between). */
function between(a: Point, b: Point, c: Point): boolean {
  if (Math.abs(a.x - b.x) <= EPSILON && Math.abs(b.x - c.x) <= EPSILON) return (b.y - a.y) * (c.y - b.y) >= 0;
  if (Math.abs(a.y - b.y) <= EPSILON && Math.abs(b.y - c.y) <= EPSILON) return (b.x - a.x) * (c.x - b.x) >= 0;
  return false;
}
