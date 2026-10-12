// SPDX-License-Identifier: MIT
/**
 * The routing graph (skill gcp-diagram-layout §5): the gutter lines are its segments, their intersections its
 * nodes. Every point where a port's stub meets a line becomes a node too, so a route starts and ends at a node.
 * A node lies on at most one horizontal and one vertical line (collinear lines are merged in stage 4).
 *
 * Plain typed arrays, so a search over thousands of nodes allocates nothing per step:
 * - node n has coordinates `x[n]`, `y[n]`; `line[2n]` is its horizontal line and `line[2n + 1]` its vertical
 *   one (-1 for none); `pos[2n + axis]` is its index along that line;
 * - line l holds nodes `nodes[start[l]] … nodes[start[l + 1] − 1]`, sorted along the line;
 * - segment s joins the line's nodes i and i + 1, with s = `segment[l] + i`; `length[s]` is its length and
 *   `pressure[s]` the lane cost a route pays on it for every lane already used there: `laneCost` spread over
 *   the gutter it belongs to (the gap, ring side or extension it is the centre-line of, before merging) in
 *   proportion to length. So running the length of one gutter costs `laneCost` per lane already there, however
 *   many other gutters cross or join it and however many ports split it.
 */
import type { GutterLine, GutterPiece } from './gutters.js';

/** `Network.hug` values: a segment through a gap or free space, along a ring side, in the canvas margin. */
export const HUG_NONE = 0;
export const HUG_RING = 1;
export const HUG_MARGIN = 2;

export interface Network {
  readonly lines: readonly GutterLine[];
  readonly nodeCount: number;
  /** Nodes below this number are intersections; the rest are attach points on one line only. */
  readonly crossings: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly line: Int32Array;
  readonly pos: Int32Array;
  readonly start: Int32Array;
  readonly nodes: Int32Array;
  readonly segment: Int32Array;
  readonly segmentCount: number;
  readonly length: Float64Array;
  readonly pressure: Float64Array;
  /** The width of the free strip along segment s: the narrowest strip of the gutter pieces covering it. */
  readonly strip: Float64Array;
  /**
   * The containers whose gutter pieces cover segment s: `owners[ownerStart[s]] … owners[ownerStart[s + 1] − 1]`.
   * A route may run along a segment only when one of them is a container it has to cross.
   */
  readonly ownerStart: Int32Array;
  readonly owners: Int32Array;
  /**
   * The gutter pieces covering segment s, as stable keys (container and gap, which survive a re-pack with the
   * arrangements pinned): `pieceKeys[pieceStart[s]] … pieceKeys[pieceStart[s + 1] − 1]`.
   */
  readonly pieceStart: Int32Array;
  /** The pieces' stable keys as numbers (`PieceIds`, shared by every pass of one layout). */
  readonly pieceKeys: Int32Array;
  /**
   * Whether segment s runs along a border (`GutterPiece.hugSpans`, where every piece covering it does):
   * `HUG_NONE`, `HUG_RING` (a ring side inside its zone's padding band) or `HUG_MARGIN` (the canvas margin).
   */
  readonly hug: Uint8Array;
  /**
   * For a hugging segment, the length of the border stretch it runs along (the ring side between its zone's
   * corners, or the canvas's side for the margin; the longest where pieces of several zones cover it): the
   * router caps what a route pays above its length per side (`Routing.hugCap`). 0 for any other segment.
   */
  readonly hugSide: Float64Array;
  /** The only holder that may run along segment s (a port line's, `GutterPiece.holder`); -1 for any. */
  readonly exclusive: Int32Array;
}

/**
 * Numbers for gutter pieces' stable keys (`pieceKey`), shared by the passes of one layout so that a route's
 * corridor (the pieces it ran along) can be looked up in the next pass by number instead of by string.
 */
export class PieceIds {
  private readonly ids = new Map<string, number>();

  idOf(piece: GutterPiece): number {
    const key = pieceKey(piece);
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.ids.size;
      this.ids.set(key, id);
    }
    return id;
  }
}

/** A gutter piece's stable key: its container and the gap it is the centre-line of. */
export function pieceKey(piece: GutterPiece): string {
  const { gap } = piece;
  const where =
    gap.kind === 'ring'
      ? gap.side
      : gap.kind === 'zone-column'
        ? `${String(gap.row)}.${String(gap.index)}`
        : gap.kind === 'stack'
          ? `${String(gap.row)}.${String(gap.cell)}.${String(gap.index)}`
          : gap.kind === 'port'
            ? gap.key
            : String(gap.index);
  return `${String(piece.owner)}:${gap.kind}:${where}`;
}

export interface Attachment {
  readonly line: number;
  readonly t: number;
}

/** A node on a line: its coordinate along the line. */
interface Entry {
  at: number;
  node: number;
}
type OnLine = Entry[];

const CELL = 256;
const KEY_SPAN = 1 << 20;
const EPSILON = 1e-6;

function cellOf(value: number): number {
  return Math.max(0, Math.floor(value / CELL));
}

/**
 * Builds the routing graph of `lines` with a node at every intersection and at every attachment (a port's
 * stub meeting a line). Returns the network and, per attachment, its node (-1 for an attachment without a line).
 */
export function buildNetwork(
  lines: readonly GutterLine[],
  attachments: readonly Attachment[],
  laneCost: number,
  ids: PieceIds = new PieceIds(),
): { network: Network; attached: Int32Array } {
  // Vertical lines in a grid, so each horizontal line meets only the vertical lines near it.
  const cells = new Map<number, number[]>();
  lines.forEach((entry, index) => {
    if (entry.horizontal) return;
    const cx = cellOf(entry.c);
    for (let cy = cellOf(entry.a); cy <= cellOf(entry.b); cy += 1) {
      const key = cx * KEY_SPAN + cy;
      const list = cells.get(key);
      if (list === undefined) cells.set(key, [index]);
      else list.push(index);
    }
  });

  const xs: number[] = [];
  const ys: number[] = [];
  const hLine: number[] = [];
  const vLine: number[] = [];
  const onLine: OnLine[] = lines.map(() => []);
  lines.forEach((h, hi) => {
    if (!h.horizontal) return;
    const cy = cellOf(h.c);
    for (let cx = cellOf(h.a); cx <= cellOf(h.b); cx += 1) {
      for (const vi of cells.get(cx * KEY_SPAN + cy) ?? []) {
        const v = lines[vi] as GutterLine;
        if (v.c < h.a - EPSILON || v.c > h.b + EPSILON || h.c < v.a - EPSILON || h.c > v.b + EPSILON)
          continue;
        const node = xs.length;
        xs.push(v.c);
        ys.push(h.c);
        hLine.push(hi);
        vLine.push(vi);
        (onLine[hi] as OnLine).push({ at: v.c, node });
        (onLine[vi] as OnLine).push({ at: h.c, node });
      }
    }
  });
  for (const list of onLine) list.sort((p, q) => p.at - q.at);
  const crossings = xs.length;

  // Attachments: an existing node at that point of the line, or a new node on that line only.
  const attached = new Int32Array(attachments.length).fill(-1);
  const created = new Map<string, number>();
  const pending = new Set<number>();
  attachments.forEach((attachment, index) => {
    const entry = lines[attachment.line];
    const list = onLine[attachment.line];
    if (entry === undefined || list === undefined) return;
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const at = (list[mid] as Entry).at;
      if (Math.abs(at - attachment.t) <= EPSILON) {
        attached[index] = (list[mid] as Entry).node;
        return;
      }
      if (at < attachment.t) lo = mid + 1;
      else hi = mid - 1;
    }
    const key = `${String(attachment.line)}:${String(attachment.t)}`;
    const known = created.get(key);
    if (known !== undefined) {
      attached[index] = known;
      return;
    }
    const node = xs.length;
    xs.push(entry.horizontal ? attachment.t : entry.c);
    ys.push(entry.horizontal ? entry.c : attachment.t);
    hLine.push(entry.horizontal ? attachment.line : -1);
    vLine.push(entry.horizontal ? -1 : attachment.line);
    created.set(key, node);
    pending.add(attachment.line);
    attached[index] = node;
  });
  for (let node = crossings; node < xs.length; node += 1) {
    const l = hLine[node] as number;
    const owner = l >= 0 ? l : (vLine[node] as number);
    (onLine[owner] as OnLine).push({ at: l >= 0 ? (xs[node] as number) : (ys[node] as number), node });
  }
  for (const l of pending) (onLine[l] as OnLine).sort((p, q) => p.at - q.at || p.node - q.node);

  const nodeCount = xs.length;
  const x = Float64Array.from(xs);
  const y = Float64Array.from(ys);
  const line = new Int32Array(nodeCount * 2);
  for (let n = 0; n < nodeCount; n += 1) {
    line[n * 2] = hLine[n] as number;
    line[n * 2 + 1] = vLine[n] as number;
  }
  const pos = new Int32Array(nodeCount * 2).fill(-1);
  const start = new Int32Array(lines.length + 1);
  const segment = new Int32Array(lines.length);
  let total = 0;
  let segments = 0;
  onLine.forEach((list, l) => {
    start[l] = total;
    segment[l] = segments;
    total += list.length;
    segments += Math.max(0, list.length - 1);
  });
  start[lines.length] = total;
  const nodes = new Int32Array(total);
  const length = new Float64Array(segments);
  const pressure = new Float64Array(segments);
  const strip = new Float64Array(segments);
  const ownerStart = new Int32Array(segments + 1);
  const ownerList: number[] = [];
  const pieceStart = new Int32Array(segments + 1);
  const pieceKeys: number[] = [];
  const hug = new Uint8Array(segments);
  const hugSide = new Float64Array(segments);
  const exclusive = new Int32Array(segments).fill(-1);
  onLine.forEach((list, l) => {
    const horizontal = (lines[l] as GutterLine).horizontal;
    const base = start[l] as number;
    list.forEach((entry, i) => {
      nodes[base + i] = entry.node;
      pos[entry.node * 2 + (horizontal ? 0 : 1)] = i;
    });
    // Lengths, owners and pressure per segment: the gutter pieces covering its midpoint give its owners, and
    // laneCost is spread over the longest of them (the gutter it is part of) in proportion to length.
    const first = segment[l] as number;
    const pieces = (lines[l] as GutterLine).pieces;
    const count = list.length - 1;
    if (count <= 0) return;
    // The pieces covering each segment's midpoint, in the pieces' order: each piece finds its first segment
    // by binary search and walks on while it covers the midpoints.
    const covering: number[][] = Array.from({ length: count }, () => []);
    const midOf = (i: number): number => ((list[i] as Entry).at + (list[i + 1] as Entry).at) / 2;
    pieces.forEach((piece, p) => {
      let lo = 0;
      let hi = count;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (midOf(mid) < piece.a - EPSILON) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < count && midOf(i) <= piece.b + EPSILON; i += 1) (covering[i] as number[]).push(p);
    });
    const pieceIds = pieces.map((piece) => ids.idOf(piece));
    for (let i = 0; i < count; i += 1) {
      const s = first + i;
      const from = (list[i] as Entry).at;
      const to = (list[i + 1] as Entry).at;
      length[s] = to - from;
      ownerStart[s] = ownerList.length;
      pieceStart[s] = pieceKeys.length;
      const mid = (from + to) / 2;
      let gutter = 0;
      let narrowest = Infinity;
      let hugging = true;
      let side = 0;
      let margin = true;
      let covered = false;
      for (const p of covering[i] as number[]) {
        const piece = pieces[p] as GutterPiece;
        covered = true;
        if (hugging) {
          const span = piece.hugSpans?.find(([a, b]) => mid > a - EPSILON && mid < b + EPSILON);
          if (span === undefined) hugging = false;
          else side = Math.max(side, span[1] - span[0]);
        }
        if (piece.margin !== true) margin = false;
        if (piece.holder !== undefined) exclusive[s] = piece.holder;
        gutter = Math.max(gutter, piece.b - piece.a);
        narrowest = Math.min(narrowest, piece.strip);
        pieceKeys.push(pieceIds[p] as number);
        if (!ownerList.includes(piece.owner, ownerStart[s])) ownerList.push(piece.owner);
      }
      hug[s] = covered && hugging ? (margin ? HUG_MARGIN : HUG_RING) : HUG_NONE;
      if (hug[s] !== HUG_NONE) hugSide[s] = side;
      pressure[s] = gutter > 0 ? (laneCost * (to - from)) / gutter : laneCost;
      strip[s] = Number.isFinite(narrowest) ? narrowest : (lines[l] as GutterLine).strip;
    }
  });
  ownerStart[segments] = ownerList.length;
  pieceStart[segments] = pieceKeys.length;

  return {
    network: {
      lines,
      nodeCount,
      crossings,
      x,
      y,
      line,
      pos,
      start,
      nodes,
      segment,
      segmentCount: segments,
      length,
      pressure,
      strip,
      ownerStart,
      owners: Int32Array.from(ownerList),
      pieceStart,
      pieceKeys: Int32Array.from(pieceKeys),
      hug,
      hugSide,
      exclusive,
    },
    attached,
  };
}
