// SPDX-License-Identifier: MIT
/**
 * Test and measurement helper (not part of the public API): how a Layout's routes read, from its points and
 * rects alone (independent of the router). Used by the golden test of skill §8's check view and by
 * `scripts/measure.ts` to compare the routing before and after a change.
 *
 * - `length`: the total drawn length of every edge (a hub bundle's members count once where they coincide:
 *   each holder's segments are merged per line before they are summed).
 * - `bends`: the total number of elbows.
 * - `hugging`: the length of edge segments that run along a single border: inside a zone's padding band
 *   (between the border and the zone's children, parallel to that side) or the canvas margin, or outside a
 *   rect within `HUG_DISTANCE` of its border with no other rect's border facing it from the other side within
 *   that distance (beside a shorter neighbour, under a shorter row): what reads like a doubled border or an
 *   underline (skill §5). Crossing a band (leaving or entering a zone) and running between two boxes do not
 *   count.
 * - `detours`: edges whose drawn length is more than twice the Manhattan distance between their ports (and
 *   more than 200 px longer than it), and the worst ratio.
 * - `crossings`: pairs of perpendicular segments of different holders that cross (not at an end).
 * - `margin` and `marginEdges`: the length of edge segments in the canvas margin (outside the box around the
 *   top-level rects; a bundle's coinciding trunk once) and how many edges have any: a route needs the margin
 *   only to reach the side of an outermost rect that faces the canvas edge; one that runs round the diagram
 *   through it (skill §9) shows up here.
 * - `overshoots` and `worstOvershoot`: how far a route runs past both of its ends, the farthest any of its
 *   points lies outside the box around its two ports, as the number of edges that go more than
 *   `OVERSHOOT_LIMIT` past and the worst distance: a route that goes round to reach a cheaper line and comes
 *   back (a U-turn inside the canvas, which neither `detours` nor `margin` sees when the ends are far apart)
 *   shows up here.
 */
import { DEFAULT_SIZING, type Sizing } from '../constants.js';
import type { EdgePath, Layout, Point } from '../types.js';

export interface RouteQuality {
  readonly edges: number;
  readonly length: number;
  readonly bends: number;
  readonly hugging: number;
  readonly detours: number;
  readonly worstDetour: number;
  readonly crossings: number;
  readonly margin: number;
  readonly marginEdges: number;
  readonly overshoots: number;
  readonly worstOvershoot: number;
}

/** How far past both of its ends a route may run before `overshoots` counts it (px). */
export const OVERSHOOT_LIMIT = 1000;

/** How far the farthest of a route's points lies outside the box around its two ports (0 inside it). */
export function overshootOf(edge: Pick<EdgePath, 'source' | 'target' | 'points'>): number {
  const x0 = Math.min(edge.source.x, edge.target.x);
  const x1 = Math.max(edge.source.x, edge.target.x);
  const y0 = Math.min(edge.source.y, edge.target.y);
  const y1 = Math.max(edge.source.y, edge.target.y);
  let worst = 0;
  for (const point of edge.points)
    worst = Math.max(worst, x0 - point.x, point.x - x1, y0 - point.y, point.y - y1);
  return worst;
}

interface Segment {
  readonly horizontal: boolean;
  readonly c: number;
  readonly a: number;
  readonly b: number;
  readonly holder: string;
}

/** Where routes may hug: a band along one side of a zone (or the canvas), between `lo` and `hi` across it. */
interface Band {
  /** Horizontal band (top or bottom side): segments along x count. */
  readonly horizontal: boolean;
  /** The band across the side: y range for a horizontal band, x range for a vertical one. */
  readonly lo: number;
  readonly hi: number;
  /** Its extent along the side. */
  readonly from: number;
  readonly to: number;
}

function segmentsOf(points: readonly Point[], holder: string): Segment[] {
  const segments: Segment[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i - 1] as Point;
    const q = points[i] as Point;
    if (p.y === q.y && p.x !== q.x)
      segments.push({ horizontal: true, c: p.y, a: Math.min(p.x, q.x), b: Math.max(p.x, q.x), holder });
    else if (p.x === q.x && p.y !== q.y)
      segments.push({ horizontal: false, c: p.x, a: Math.min(p.y, q.y), b: Math.max(p.y, q.y), holder });
  }
  return segments;
}

/** Collinear segments of one holder merged, so a bundle's coinciding trunk counts once. */
function mergedSegments(segments: readonly Segment[]): Segment[] {
  const groups = new Map<string, Segment[]>();
  for (const segment of segments) {
    const key = `${segment.holder}\u0000${segment.horizontal ? 'h' : 'v'}${String(segment.c)}`;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [segment]);
    else list.push(segment);
  }
  const merged: Segment[] = [];
  for (const list of groups.values()) {
    list.sort((p, q) => p.a - q.a || p.b - q.b);
    let current: { horizontal: boolean; c: number; a: number; b: number; holder: string } | undefined;
    for (const segment of list) {
      if (current !== undefined && segment.a <= current.b) current.b = Math.max(current.b, segment.b);
      else {
        if (current !== undefined) merged.push(current);
        current = { ...segment };
      }
    }
    if (current !== undefined) merged.push(current);
  }
  return merged;
}

function bandsOf(layout: Layout, sizing: Sizing): Band[] {
  const bands: Band[] = [];
  const add = (
    x: number,
    y: number,
    width: number,
    height: number,
    pads: { top: number; right: number; bottom: number; left: number },
  ): void => {
    const right = x + width;
    const bottom = y + height;
    bands.push({ horizontal: true, lo: y, hi: y + pads.top, from: x, to: right });
    bands.push({ horizontal: true, lo: bottom - pads.bottom, hi: bottom, from: x, to: right });
    bands.push({ horizontal: false, lo: x, hi: x + pads.left, from: y, to: bottom });
    bands.push({ horizontal: false, lo: right - pads.right, hi: right, from: y, to: bottom });
  };
  const canvas = layout.gutters.canvas;
  const margin = sizing.canvasMargin + (canvas?.ring ?? 0);
  const { bounds } = layout;
  add(bounds.x, bounds.y, bounds.width, bounds.height, {
    top: margin + (canvas?.ringSides?.top ?? 0),
    right: margin + (canvas?.ringSides?.right ?? 0),
    bottom: margin + (canvas?.ringSides?.bottom ?? 0),
    left: margin + (canvas?.ringSides?.left ?? 0),
  });
  for (const rect of Object.values(layout.rects)) {
    if (rect.role !== 'zone') continue;
    const extra = rect.paddingExtra;
    add(rect.x, rect.y + rect.headerHeight, rect.width, rect.height - rect.headerHeight, {
      top: rect.padding + (extra?.top ?? 0),
      right: rect.padding + (extra?.right ?? 0),
      bottom: rect.padding + (extra?.bottom ?? 0),
      left: rect.padding + (extra?.left ?? 0),
    });
  }
  return bands;
}

/** The stretch of `segment` running along a band (parallel, strictly inside it across, overlapping along). */
function alongBand(segment: Segment, band: Band): Span | undefined {
  if (segment.horizontal !== band.horizontal) return undefined;
  if (segment.c <= band.lo || segment.c >= band.hi) return undefined;
  const from = Math.max(segment.a, band.from);
  const to = Math.min(segment.b, band.to);
  return to > from ? [from, to] : undefined;
}

/** How close to a border a segment runs to count as running along it (outside the rect). */
export const HUG_DISTANCE = 20;

type Span = readonly [number, number];

function unionLength(spans: readonly Span[]): number {
  const sorted = [...spans].sort((p, q) => p[0] - q[0]);
  let total = 0;
  let from = -Infinity;
  let to = -Infinity;
  for (const [a, b] of sorted) {
    if (a > to) {
      if (to > from) total += to - from;
      from = a;
      to = b;
    } else to = Math.max(to, b);
  }
  if (to > from) total += to - from;
  return total;
}

/** The stretches of a…b covered by exactly one of two span sets (independent of src/gutters.ts). */
function exactlyOne(a: number, b: number, first: readonly Span[], second: readonly Span[]): Span[] {
  const cuts = [a, b, ...first.flat(), ...second.flat()]
    .filter((t) => t >= a && t <= b)
    .sort((x, y) => x - y);
  const inside = (spans: readonly Span[], t: number): boolean => spans.some(([p, q]) => t > p && t < q);
  const result: Span[] = [];
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const from = cuts[i] as number;
    const to = cuts[i + 1] as number;
    if (to <= from) continue;
    const mid = (from + to) / 2;
    if (inside(first, mid) !== inside(second, mid)) result.push([from, to]);
  }
  return result;
}

/** The stretches of `segment` running along exactly one rect border outside the rects (see `hugging`). */
function outsideHugs(segment: Segment, layout: Layout): Span[] {
  const before: Span[] = [];
  const after: Span[] = [];
  for (const rect of Object.values(layout.rects)) {
    const [lo, hi] = segment.horizontal ? [rect.y, rect.y + rect.height] : [rect.x, rect.x + rect.width];
    const [from, to] = segment.horizontal ? [rect.x, rect.x + rect.width] : [rect.y, rect.y + rect.height];
    if (to <= segment.a || from >= segment.b) continue;
    // A rect that contains the segment is its container, not a neighbour.
    if (segment.c > lo && segment.c < hi) continue;
    if (hi <= segment.c && segment.c - hi <= HUG_DISTANCE) before.push([from, to]);
    else if (lo >= segment.c && lo - segment.c <= HUG_DISTANCE) after.push([from, to]);
  }
  return exactlyOne(segment.a, segment.b, before, after);
}

/** The box around the top-level rects (the canvas without its margin); null when there are none. */
function contentBox(layout: Layout): { x0: number; y0: number; x1: number; y1: number } | null {
  const top = Object.values(layout.rects).filter((rect) => rect.parent === null);
  if (top.length === 0) return null;
  return {
    x0: Math.min(...top.map((rect) => rect.x)),
    y0: Math.min(...top.map((rect) => rect.y)),
    x1: Math.max(...top.map((rect) => rect.x + rect.width)),
    y1: Math.max(...top.map((rect) => rect.y + rect.height)),
  };
}

/** How much of `segment` lies outside the box (in the canvas margin). */
function outsideLength(segment: Segment, box: { x0: number; y0: number; x1: number; y1: number }): number {
  const [lo, hi] = segment.horizontal ? [box.y0, box.y1] : [box.x0, box.x1];
  if (segment.c < lo || segment.c > hi) return segment.b - segment.a;
  const [from, to] = segment.horizontal ? [box.x0, box.x1] : [box.y0, box.y1];
  return (
    Math.max(0, Math.min(segment.b, from) - segment.a) + Math.max(0, segment.b - Math.max(segment.a, to))
  );
}

const CELL = 128;

function countCrossings(segments: readonly Segment[]): number {
  // Vertical segments in a grid of cells; each horizontal segment checks the cells it spans.
  const cells = new Map<number, number[]>();
  const key = (cx: number, cy: number): number => cx * 1_000_003 + cy;
  segments.forEach((segment, index) => {
    if (segment.horizontal) return;
    const cx = Math.floor(segment.c / CELL);
    for (let cy = Math.floor(segment.a / CELL); cy <= Math.floor(segment.b / CELL); cy += 1) {
      const list = cells.get(key(cx, cy));
      if (list === undefined) cells.set(key(cx, cy), [index]);
      else list.push(index);
    }
  });
  let crossings = 0;
  for (const h of segments) {
    if (!h.horizontal) continue;
    const cy = Math.floor(h.c / CELL);
    const seen = new Set<number>();
    for (let cx = Math.floor(h.a / CELL); cx <= Math.floor(h.b / CELL); cx += 1) {
      for (const index of cells.get(key(cx, cy)) ?? []) {
        if (seen.has(index)) continue;
        seen.add(index);
        const v = segments[index] as Segment;
        if (v.holder === h.holder) continue;
        if (v.c > h.a && v.c < h.b && h.c > v.a && h.c < v.b) crossings += 1;
      }
    }
  }
  return crossings;
}

export function routeQuality(layout: Layout, sizing: Sizing = DEFAULT_SIZING): RouteQuality {
  const all: Segment[] = [];
  let bends = 0;
  let detours = 0;
  let worstDetour = 1;
  let edges = 0;
  let marginEdges = 0;
  let overshoots = 0;
  let worstOvershoot = 0;
  const box = contentBox(layout);
  for (const [id, edge] of Object.entries(layout.edges)) {
    edges += 1;
    const holder = edge.bundle?.id ?? id;
    const segments = segmentsOf(edge.points, holder);
    all.push(...segments);
    if (box !== null && segments.some((segment) => outsideLength(segment, box) > 0)) marginEdges += 1;
    bends += Math.max(0, edge.points.length - 2);
    const drawn = segments.reduce((sum, segment) => sum + segment.b - segment.a, 0);
    const direct = Math.abs(edge.source.x - edge.target.x) + Math.abs(edge.source.y - edge.target.y);
    const ratio = drawn / Math.max(1, direct);
    worstDetour = Math.max(worstDetour, ratio);
    if (ratio > 2 && drawn - direct > 200) detours += 1;
    const overshoot = overshootOf(edge);
    worstOvershoot = Math.max(worstOvershoot, overshoot);
    if (overshoot > OVERSHOOT_LIMIT) overshoots += 1;
  }
  const merged = mergedSegments(all);
  const length = merged.reduce((sum, segment) => sum + segment.b - segment.a, 0);
  const margin = box === null ? 0 : merged.reduce((sum, segment) => sum + outsideLength(segment, box), 0);
  const bands = bandsOf(layout, sizing);
  let hugging = 0;
  for (const segment of merged) {
    const spans: Span[] = outsideHugs(segment, layout);
    for (const band of bands) {
      const span = alongBand(segment, band);
      if (span !== undefined) spans.push(span);
    }
    hugging += unionLength(spans);
  }
  return {
    edges,
    length: Math.round(length),
    bends,
    hugging: Math.round(hugging),
    detours,
    worstDetour: Math.round(worstDetour * 100) / 100,
    crossings: countCrossings(merged),
    margin: Math.round(margin),
    marginEdges,
    overshoots,
    worstOvershoot: Math.round(worstOvershoot),
  };
}
