// SPDX-License-Identifier: Apache-2.0
/**
 * SVG path data for a routed edge (skill gcp-diagram-style §5: orthogonal, 6 px rounded elbows; the layout's
 * `EdgePath`): every elbow becomes a quarter circle of the edge's `elbowRadius`, clamped so that two elbows
 * never overlap (at most half of a segment between two elbows) and so that an arrowhead always sits on a
 * straight stretch (the end segment keeps the head's length free of rounding). An end with a filled or hollow
 * head is drawn only to the head's base; the head itself is a marker whose tip lands where the layout ended
 * the edge (2 px inside the target's border).
 */
import type { Point } from '@gcportrait/layout';

export interface EdgePathOptions {
  /** The elbow radius (the layout's `elbowRadius`; 0 for a straight edge). */
  readonly radius: number;
  /** How far the drawn line stops short of the first and last point (a filled head's length). */
  readonly trimStart?: number;
  readonly trimEnd?: number;
  /** How much of the first and last segment must stay straight (a head's length, trimmed or not). */
  readonly straightStart?: number;
  readonly straightEnd?: number;
}

/**
 * A number as short as it can be written: at most `decimals` decimals, no trailing zeros, never `-0`. The
 * geometry's coordinates and the draw.io export's numbers are written this way.
 */
export function formatNumber(value: number, decimals = 2): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return String(rounded === 0 ? 0 : rounded);
}

/** A coordinate as short as it can be written. */
export function fmt(value: number): string {
  return formatNumber(value);
}

/** The straight line kept between an elbow and an arrowhead's base. */
export const HEAD_LEAD = 1;

const same = (a: Point, b: Point): boolean => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

/** Unit direction from `a` to `b` along an axis (orthogonal segments), or the general unit vector. */
function direction(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  return length === 0 ? { x: 0, y: 0 } : { x: dx / length, y: dy / length };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The points without repeats and without middle points that do not turn. */
export function simplifyPoints(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last !== undefined && same(last, point)) continue;
    const before = out[out.length - 2];
    if (last !== undefined && before !== undefined) {
      const d1 = direction(before, last);
      const d2 = direction(last, point);
      if (Math.abs(d1.x - d2.x) < 1e-9 && Math.abs(d1.y - d2.y) < 1e-9) out.pop();
    }
    out.push(point);
  }
  return out;
}

/**
 * The `d` attribute of a polyline with rounded elbows. Deterministic: the same points and options always give
 * the same string. Fewer than two distinct points give an empty string.
 */
export function edgePathData(points: readonly Point[], options: EdgePathOptions): string {
  const path = simplifyPoints(points);
  const first = path[0];
  const second = path[1];
  if (first === undefined || second === undefined) return '';
  const segments = path.length - 1;
  const lengths = path.slice(1).map((point, index) => distance(path[index] as Point, point));
  const firstLength = lengths[0] ?? 0;
  const lastLength = lengths[segments - 1] ?? 0;

  const trimStart = Math.max(0, options.trimStart ?? 0);
  const trimEnd = Math.max(0, options.trimEnd ?? 0);
  // Never trim a segment away entirely: a sliver keeps the marker's orientation (the line's direction).
  const sliver = (length: number, trim: number, other = 0): number =>
    Math.max(0, Math.min(trim, length - other - Math.min(0.5, length / 4)));
  const startCut = sliver(firstLength, trimStart, segments === 1 ? trimEnd : 0);
  const endCut = sliver(lastLength, trimEnd, segments === 1 ? startCut : 0);
  const keepStart = Math.max(trimStart, options.straightStart ?? 0);
  const keepEnd = Math.max(trimEnd, options.straightEnd ?? 0);

  const start = {
    x: first.x + direction(first, second).x * startCut,
    y: first.y + direction(first, second).y * startCut,
  };
  const last = path[segments] as Point;
  const beforeLast = path[segments - 1] as Point;
  const endDirection = direction(beforeLast, last);
  const end = { x: last.x - endDirection.x * endCut, y: last.y - endDirection.y * endCut };

  const parts = [`M${fmt(start.x)} ${fmt(start.y)}`];
  let at = start;
  // A line to where the path already is would be a zero-length piece: leave it out.
  const lineTo = (point: Point): void => {
    if (fmt(point.x) === fmt(at.x) && fmt(point.y) === fmt(at.y)) return;
    parts.push(`L${fmt(point.x)} ${fmt(point.y)}`);
    at = point;
  };
  for (let i = 1; i < segments; i += 1) {
    const previous = path[i - 1] as Point;
    const corner = path[i] as Point;
    const next = path[i + 1] as Point;
    const inLength = lengths[i - 1] ?? 0;
    const outLength = lengths[i] ?? 0;
    // Next to a head, one more px of straight line, so the path never ends in a zero-length piece whose
    // direction a renderer would have to guess (the marker's orientation is the path's direction at its end).
    const inRoom = i - 1 === 0 ? inLength - keepStart - (keepStart > 0 ? HEAD_LEAD : 0) : inLength / 2;
    const outRoom = i === segments - 1 ? outLength - keepEnd - (keepEnd > 0 ? HEAD_LEAD : 0) : outLength / 2;
    const radius = Math.max(0, Math.min(options.radius, inRoom, outRoom));
    if (radius < 0.25) {
      lineTo(corner);
      continue;
    }
    const din = direction(previous, corner);
    const dout = direction(corner, next);
    const sweep = din.x * dout.y - din.y * dout.x > 0 ? 1 : 0;
    lineTo({ x: corner.x - din.x * radius, y: corner.y - din.y * radius });
    const exit = { x: corner.x + dout.x * radius, y: corner.y + dout.y * radius };
    parts.push(`A${fmt(radius)} ${fmt(radius)} 0 0 ${String(sweep)} ${fmt(exit.x)} ${fmt(exit.y)}`);
    at = exit;
  }
  lineTo(end);
  return parts.join('');
}
