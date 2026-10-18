// SPDX-License-Identifier: Apache-2.0
/**
 * Test helper (not part of the public API): how well a Layout's edges keep apart (skill gcp-diagram-layout §1,
 * "parallel arrows in the same gap are spaced in lanes, never overlapping"; §8 "lanes spaced"), and how well
 * the ports on each side of a rect keep apart (§5, "a port slot spaced 12 px along that side"). Independent of
 * the router: it reads the points and ports only.
 *
 * Holders: the members of one hub bundle (`EdgePath.bundle`) share their port and lanes by design, so they
 * count as one; every other edge is its own. Looks at every pair of parallel segments of different holders
 * that run alongside each other for more than `alongside` px (default 0: any length): `overlaps` counts the
 * pairs on the same line, `close` the pairs nearer than `near` px (default 4), `closest` is the smallest
 * distance between any such pair (0 for an overlap) but two stubs, and `closestStubs` between two stubs (an
 * edge's first and last segments, from its ports across to its gutters: ports on rects facing each other
 * across a gutter are half a port spacing apart, so their stubs may be that close).
 */
import type { Layout } from '../types.js';

export interface Spacing {
  readonly overlaps: number;
  readonly close: number;
  /** Infinity when no two segments of different holders (not both stubs) run alongside each other. */
  readonly closest: number;
  /** The same between two stubs. */
  readonly closestStubs: number;
  /** The longest stretch two holders run on the same line (0 without overlaps). */
  readonly longestOverlap: number;
  /** The overlapping pairs, for messages: "edge a | edge b @ coordinate". */
  readonly examples: readonly string[];
}

interface Piece {
  readonly c: number;
  readonly a: number;
  readonly b: number;
  readonly edge: string;
  readonly holder: string;
  readonly stub: boolean;
}

/** Edges sharing a holder: the bundle's id, or the edge's own. */
function holderOf(id: string, layout: Layout): string {
  return layout.edges[id]?.bundle?.id ?? id;
}

export function laneSpacing(layout: Layout, options: { near?: number; alongside?: number } = {}): Spacing {
  const near = options.near ?? 4;
  const alongside = options.alongside ?? 0;
  const horizontal: Piece[] = [];
  const vertical: Piece[] = [];
  for (const [id, edge] of Object.entries(layout.edges)) {
    const holder = holderOf(id, layout);
    const last = edge.points.length - 1;
    for (let i = 1; i <= last; i += 1) {
      const p = edge.points[i - 1];
      const q = edge.points[i];
      if (p === undefined || q === undefined) continue;
      const stub = i === 1 || i === last;
      if (p.y === q.y && p.x !== q.x) {
        horizontal.push({ c: p.y, a: Math.min(p.x, q.x), b: Math.max(p.x, q.x), edge: id, holder, stub });
      } else if (p.x === q.x && p.y !== q.y) {
        vertical.push({ c: p.x, a: Math.min(p.y, q.y), b: Math.max(p.y, q.y), edge: id, holder, stub });
      }
    }
  }
  let overlaps = 0;
  let close = 0;
  let closest = Infinity;
  let closestStubs = Infinity;
  let longestOverlap = 0;
  const examples: string[] = [];
  // Pairs further apart than this cannot matter (a lane pitch is far below it).
  const window = Math.max(near, 16);
  for (const pieces of [horizontal, vertical]) {
    pieces.sort((p, q) => p.c - q.c || p.a - q.a);
    for (let i = 0; i < pieces.length; i += 1) {
      const p = pieces[i];
      if (p === undefined) continue;
      for (let j = i + 1; j < pieces.length; j += 1) {
        const q = pieces[j];
        if (q === undefined || q.c - p.c >= window) break;
        const along = Math.min(p.b, q.b) - Math.max(p.a, q.a);
        if (p.holder === q.holder || along <= alongside || along <= 1e-6) continue;
        const distance = q.c - p.c;
        if (p.stub && q.stub) closestStubs = Math.min(closestStubs, distance);
        else closest = Math.min(closest, distance);
        if (distance === 0) {
          overlaps += 1;
          longestOverlap = Math.max(longestOverlap, along);
          if (examples.length < 5) examples.push(`${p.edge} | ${q.edge} @ ${String(p.c)}`);
        } else if (distance < near) close += 1;
      }
    }
  }
  return { overlaps, close, closest, closestStubs, longestOverlap, examples };
}

export interface PortSpacing {
  /** Pairs of neighbouring ports on one side of one rect closer than `spacing` (a bundle's shared port counts once). */
  readonly crowded: number;
  /** The smallest distance between neighbouring ports on one side (Infinity with no two ports on a side). */
  readonly closest: number;
}

export function portSpacing(layout: Layout, spacing = 12): PortSpacing {
  const sides = new Map<string, Map<string, number>>();
  for (const [id, edge] of Object.entries(layout.edges)) {
    const holder = holderOf(id, layout);
    for (const [port, rect] of [
      [edge.source, edge.from],
      [edge.target, edge.to],
    ] as const) {
      const key = `${rect} ${port.side}`;
      const along = port.side === 'left' || port.side === 'right' ? port.y : port.x;
      let ports = sides.get(key);
      if (ports === undefined) {
        ports = new Map();
        sides.set(key, ports);
      }
      // A bundle's members share their port: one entry per holder and position.
      ports.set(`${holder} ${String(along)}`, along);
    }
  }
  let crowded = 0;
  let closest = Infinity;
  for (const ports of sides.values()) {
    const sorted = [...ports.values()].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = (sorted[i] as number) - (sorted[i - 1] as number);
      closest = Math.min(closest, gap);
      if (gap < spacing - 1e-6) crowded += 1;
    }
  }
  return { crowded, closest };
}
