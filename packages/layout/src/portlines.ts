// SPDX-License-Identifier: Apache-2.0
/**
 * Port lines (skill §5): a straight way out of a rect that nothing stands beside. A port's stub meets the
 * gutter line of its container on that side (ports.ts); when that line is the container's padding ring (the
 * rect is the last of its row on that side, or in the last row for a bottom port) the space beyond it is free
 * up to the container's border, and beyond the border up to the parent's gutter on that side, and so on
 * outwards while each zone is the last of its row on that side. A port line runs straight through that free
 * space, from the stub's gutter line to the first gutter beside which another child stands (or the canvas
 * margin), so a route can leave a deeply nested rect in one straight run instead of turning along the padding
 * ring, which reads as a doubled border.
 *
 * A port line belongs to its port alone: only its edge (or, for a hub bundle's shared port, the bundle's members)
 * may run along it (`GutterPiece.holder`: the edge's index, or the bundle's lane holder), always on lane 0, the port's own coordinate, so the route leaves the
 * port without a jog. Other routes may cross it. It is split into one piece per container it passes through,
 * so the router's scope (the containers an edge has to cross) applies to it as to any gutter. Never on a top
 * side (above a rect is its container's header) and never for a port on the inside of a containing zone.
 * Skipped where a gutter line runs alongside it (its lanes could come within a lane pitch of the port's
 * coordinate), where another port's stub runs on it, or where another port line meets it at nearly the same
 * coordinate (two rects facing each other across a gap at one height); and where it would have no length: with
 * no padding a zone's ring lies on its border, and with no gap beside the zone so does the gutter it would end
 * at. Such a line would be a single point that leads nowhere, and a run along it would cover no segment
 * (the router still knows it for a port run by the line, route.ts `runEnds`): the stub's own gutter line is
 * the way out there.
 */
import type { Routing } from './constants.js';
import { EPSILON } from './geometry.js';
import { BELOW, LEFT, RIGHT, type GutterLine, type GutterPiece, type Gutters } from './gutters.js';
import type { LayoutNode } from './normalise.js';
import type { EdgePorts, Port } from './ports.js';

export interface PortLines {
  /** The port lines, to append to the gutter lines of the pass (their indexes follow the gutters'). */
  readonly lines: GutterLine[];
  /** Per edge end (index × 2 + 0 for the source, + 1 for the target): its port line's index, or -1. */
  readonly lineOf: Int32Array;
}

/** The width a port line's strip is given: lane 0 with the gutter base on either side. */
function stripOf(routing: Routing): number {
  return 2 * routing.gutterBase;
}

/**
 * The pieces of the port line of `node`'s port on `side` at coordinate `at` (y for a left or right side, x for
 * a bottom one), from the stub's gutter line outwards; empty when the stub's gutter line is not its container's
 * ring (something stands beside the rect) or the container is the canvas.
 */
function piecesOf(
  node: LayoutNode,
  side: 'left' | 'right' | 'bottom',
  gutters: Gutters,
  strip: number,
  holder: number,
  key: string,
): GutterPiece[] {
  const slot = side === 'left' ? LEFT : side === 'right' ? RIGHT : BELOW;
  const pieces: GutterPiece[] = [];
  let index = node.index;
  let start = gutters.around[index * 4 + slot] as number;
  for (;;) {
    const owner = gutters.parentOf[index] as number;
    const container = gutters.containers[owner];
    if (container === undefined) break;
    const around = gutters.around[index * 4 + slot] as number;
    const ring =
      side === 'left' ? container.ringLeft : side === 'right' ? container.ringRight : container.ringBottom;
    const zone = container.node;
    if (zone === null || around !== ring) {
      // Something stands beside it here (or this is the canvas): the line ends at this gutter.
      if (pieces.length > 0 && around !== start) {
        pieces.push({
          a: Math.min(start, around),
          b: Math.max(start, around),
          owner,
          strip,
          gap: { kind: 'port', key },
          holder,
        });
      }
      break;
    }
    const border = side === 'left' ? zone.x : side === 'right' ? zone.x + zone.width : zone.y + zone.height;
    pieces.push({
      a: Math.min(start, border),
      b: Math.max(start, border),
      owner,
      strip,
      gap: { kind: 'port', key },
      holder,
    });
    start = border;
    index = zone.index;
  }
  return pieces;
}

/**
 * The port lines of a pass: one per port that has one (a bundle's shared port once), in edge order, numbered
 * from `base` (the number of gutter lines they are appended to).
 */
export function portLines(
  ends: readonly { readonly from: LayoutNode; readonly to: LayoutNode }[],
  ports: readonly EdgePorts[],
  gutters: Gutters,
  routing: Routing,
  base: number,
): PortLines {
  const lines: GutterLine[] = [];
  const lineOf = new Int32Array(ports.length * 2).fill(-1);
  const shared = new Map<string, number>();
  const strip = stripOf(routing);
  const pitch = routing.lanePitch;
  // Segments near which no port line may run, bucketed by orientation and coordinate (one lane pitch per
  // bucket, so a query looks at its bucket and the two beside it):
  // - every port's stub: a port line must not run along another port's stub at nearly its coordinate (a
  //   containing zone's own port where the line leaves it, a rect facing the line's end across a gap at one
  //   height), or the two would share a lane there;
  // - every port line made so far, widened by four pitches at either end: two port lines on nearly one
  //   coordinate that meet in a gap would put two routes on one lane there.
  interface Blocker {
    readonly c: number;
    readonly a: number;
    readonly b: number;
    readonly owner: number;
  }
  const buckets = new Map<string, Blocker[]>();
  const bucketKey = (horizontal: boolean, bucket: number): string =>
    `${horizontal ? 'h' : 'v'}${String(bucket)}`;
  const block = (horizontal: boolean, blocker: Blocker): void => {
    const key = bucketKey(horizontal, Math.floor(blocker.c / pitch));
    const list = buckets.get(key);
    if (list === undefined) buckets.set(key, [blocker]);
    else list.push(blocker);
  };
  const blocked = (horizontal: boolean, c: number, a: number, b: number, owner: number): boolean => {
    const bucket = Math.floor(c / pitch);
    for (let k = bucket - 1; k <= bucket + 1; k += 1) {
      for (const other of buckets.get(bucketKey(horizontal, k)) ?? []) {
        if (other.owner === owner || Math.abs(other.c - c) >= pitch) continue;
        if (Math.min(b, other.b) - Math.max(a, other.a) > -pitch) return true;
      }
    }
    return false;
  };
  const ownerOf = (edgePorts: EdgePorts, edge: number, end: number): number =>
    // A hub bundle's shared port has one line for all its members; any other end's line is its edge's.
    edgePorts.bundle !== null && edgePorts.bundle.end === end ? edgePorts.holder : edge;
  ports.forEach((edgePorts, edge) => {
    [edgePorts.source, edgePorts.target].forEach((port, end) => {
      const attach = gutters.lines[port.line];
      if (attach === undefined) return;
      const from = attach.horizontal ? port.y : port.x;
      block(!attach.horizontal, {
        c: port.t,
        a: Math.min(from, attach.c),
        b: Math.max(from, attach.c),
        owner: ownerOf(edgePorts, edge, end),
      });
    });
  });
  ports.forEach((edgePorts, edge) => {
    const endsOf: [LayoutNode, Port][] = [
      [(ends[edge] as { from: LayoutNode }).from, edgePorts.source],
      [(ends[edge] as { to: LayoutNode }).to, edgePorts.target],
    ];
    endsOf.forEach(([node, port], end) => {
      if (port.inward || port.side === 'top' || port.line < 0) return;
      const horizontal = port.side !== 'bottom';
      const at = horizontal ? port.y : port.x;
      const owner = ownerOf(edgePorts, edge, end);
      const sharedKey = `${String(node.index)} ${port.side} ${String(at)} ${String(owner)}`;
      const known = shared.get(sharedKey);
      if (known !== undefined) {
        lineOf[edge * 2 + end] = known;
        return;
      }
      const key = `${String(edge)}.${String(end)}`;
      const pieces = piecesOf(node, port.side, gutters, strip, owner, key);
      if (pieces.length === 0) return;
      const a = Math.min(...pieces.map((piece) => piece.a));
      const b = Math.max(...pieces.map((piece) => piece.b));
      // No length: the stub's gutter line lies on the first gap already (no padding, and no gap beside).
      if (b - a <= EPSILON) return;
      // A gutter line alongside it (its lanes could run within a pitch of the port's), or one ending on the
      // same gutter from the far side at nearly its coordinate (its elbow reaches across), would crowd it.
      const ends = 4 * pitch;
      if (
        gutters.alongside(horizontal, at, a - ends, b + ends, pitch) ||
        blocked(horizontal, at, a, b, owner)
      )
        return;
      const index = base + lines.length;
      lines.push({ horizontal, c: at, a, b, strip, pieces });
      block(horizontal, { c: at, a: a - 3 * pitch, b: b + 3 * pitch, owner });
      shared.set(sharedKey, index);
      lineOf[edge * 2 + end] = index;
    });
  });
  return { lines, lineOf };
}

/** Whether a gutter piece is a port line's. */
export function isPortPiece(piece: GutterPiece): boolean {
  return piece.gap.kind === 'port';
}
