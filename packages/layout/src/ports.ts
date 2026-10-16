// SPDX-License-Identifier: MIT
/**
 * Ports (skill gcp-diagram-layout §5): where an edge leaves and enters its rects.
 *
 * - Side. An edge leaves (or enters) a rect on the side facing the other end: the axis along which the two
 *   rects are further apart decides between left/right and top/bottom. An open zone's top side is its header,
 *   so an edge never ends there: one that would face up uses the zone's left or right side instead, below the
 *   header. When one end is an open zone that contains the other, the zone's port is on the inside of its
 *   border, on the side nearest the inner end (left, right or bottom), and the inner end leaves on that same
 *   side.
 * - Bundles. A rect that many edges of one kind meet at the same end (a hub: a Shared VPC host project that a
 *   hundred service projects share from, a load balancer that thirty backends use) cannot give each its own
 *   port 12 px apart, and its gutters cannot give each its own lane. Such edges are bundled: those of one kind
 *   that meet one rect at the same end (all as targets, or all as sources) from `bundleMin` (3) on, and on a
 *   side that more ports face than it holds, those of one kind facing it from two on. The members of a bundle
 *   that face one side share one port there, and the router lets them share lanes, so they join into one
 *   trunk towards the hub instead of running side by side (`Layout.edges[…].bundle`). An edge belongs to at
 *   most one bundle (the larger group of its two ends).
 * - Slots. The ports on one side (a bundle's shared port counts once) are spaced `portSpacing` (12 px) apart,
 *   near the middle of the side and clear of its corners (on an open zone, only beside its children:
 *   `sideIntervals`); ports that do not fit move to the neighbouring sides and then to the opposite side, and
 *   only when every side is full do they share a side more closely. They are ordered by where their other ends
 *   lie along the side, so neighbouring edges do not cross at the rect.
 * - Stub. From the port a short stub runs straight out, perpendicular to the side, to the gutter line of the
 *   rect's container on that side (for a containing zone: straight in, to the zone's own ring). The stub meets
 *   the line at the port's coordinate: that point is where the route starts or ends.
 * - Tip. An arrowhead ends `arrowInset` (2 px) inside its rect's border; inside an open zone at most its
 *   padding deep, and at the border itself for a port on the inside of a containing zone.
 */
import type { RelationKind } from '@gcportrait/model';
import type { Routing } from './constants.js';
import type { DrawnEdge } from './edges.js';
import { ABOVE, BELOW, LEFT, RIGHT, type Container, type GutterLine, type Gutters } from './gutters.js';
import type { LayoutNode } from './normalise.js';
import type { Side } from './types.js';

export interface Port {
  readonly x: number;
  readonly y: number;
  readonly side: Side;
  /** The port is on the inside of a zone that contains the edge's other end. */
  readonly inward: boolean;
  /** The gutter line the stub meets (-1 if none was found) and the coordinate along it. */
  readonly line: number;
  readonly t: number;
  /** How far an arrowhead at this end reaches past the port into the rect. */
  readonly inset: number;
}

/** A bundle: edges of one kind that share their port on one side of one rect (a hub) and lanes towards it. */
export interface PortBundle {
  /** Number of the bundle in this pass (0, 1, …, in the order of the edges). */
  readonly index: number;
  /** Which end of its members the shared port is: 0 their source, 1 their target. */
  readonly end: 0 | 1;
  /**
   * `<rect> <-kind- * (side)` for a shared target, `<rect> -kind-> * (side)` for a shared source (`side, inside`
   * for a port on the inside of a containing zone; ` #2`, … when two bundles would share a name).
   */
  readonly id: string;
  /** How many edges share it. */
  readonly size: number;
}

export interface EdgePorts {
  readonly source: Port;
  readonly target: Port;
  /**
   * Who holds the edge's lanes: the edge's own index, or (for a bundle's member) the number of edges plus the
   * bundle's index, so that a bundle's members share their lanes.
   */
  readonly holder: number;
  /** The edge's bundle; null for an edge of its own. */
  readonly bundle: PortBundle | null;
}

function isAncestor(ancestor: LayoutNode, node: LayoutNode): boolean {
  for (let up = node.parent; up !== null; up = up.parent) if (up === ancestor) return true;
  return false;
}

/** The side of `rect` facing `other` (both disjoint); `allowTop` is false for an open zone (its header). */
export function facingSide(rect: LayoutNode, other: LayoutNode, allowTop: boolean): Side {
  const dx = other.x + other.width / 2 - (rect.x + rect.width / 2);
  const dy = other.y + other.height / 2 - (rect.y + rect.height / 2);
  const gapX = Math.max(other.x - (rect.x + rect.width), rect.x - (other.x + other.width));
  const gapY = Math.max(other.y - (rect.y + rect.height), rect.y - (other.y + other.height));
  if (gapY > gapX && (dy > 0 || allowTop)) return dy > 0 ? 'bottom' : 'top';
  return dx < 0 ? 'left' : 'right';
}

/** The side of the open zone `zone` nearest to its descendant `inner`: left, right or bottom. */
export function innerSide(zone: LayoutNode, inner: LayoutNode): Side {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  const left = cx - zone.x;
  const right = zone.x + zone.width - cx;
  const bottom = zone.y + zone.height - cy;
  if (left <= right && left <= bottom) return 'left';
  return right <= bottom ? 'right' : 'bottom';
}

/** One end of an edge: the rect it meets, the edge's other end, and the side chosen for it. */
interface End {
  readonly edge: number;
  readonly end: 0 | 1;
  readonly inward: boolean;
  readonly node: LayoutNode;
  /** The other end of the edge. */
  readonly other: LayoutNode;
  readonly kind: RelationKind;
  side: Side;
}

/** A port to place: one edge end, or the shared end of a bundle's members on one side. */
interface Request {
  readonly ends: End[];
  readonly node: LayoutNode;
  readonly inward: boolean;
  side: Side;
  /** Where the other ends lie along the side (their mean), for ordering: see `keyOf`. */
  key: number;
  /** The lowest edge index among the ends (ties). */
  readonly first: number;
}

/** Where an end's other end lies along a side: its centre's y for a left or right side, x for top or bottom. */
function endKey(end: End, side: Side): number {
  const { other } = end;
  return side === 'left' || side === 'right' ? other.y + other.height / 2 : other.x + other.width / 2;
}

/** A request's key on its current side: the mean of its ends' keys. */
function keyOf(request: Request): number {
  let sum = 0;
  for (const end of request.ends) sum += endKey(end, request.side);
  return sum / request.ends.length;
}

function byKey(a: Request, b: Request): number {
  return a.key - b.key || a.first - b.first;
}

function requestOf(ends: End[]): Request {
  const head = ends[0] as End;
  const request: Request = {
    ends,
    node: head.node,
    inward: head.inward,
    side: head.side,
    key: 0,
    first: Math.min(...ends.map((end) => end.edge)),
  };
  request.key = keyOf(request);
  return request;
}

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/**
 * The gutter lines a side's ports must keep clear of: those that pass through the side's border (a zone's
 * gutters, and its descendants', run out through its border; stage 4), as bands along the side: the line's
 * centre ± half the widest strip of its pieces at the border. A port's stub there would run along their lanes.
 */
export interface Crossings {
  /** The bands of the lines with this orientation that pass through `border` within `from`…`to`. */
  bands(horizontal: boolean, border: number, from: number, to: number): [number, number][];
}

/** Crossings of a set of gutter lines (sorted by orientation, then coordinate). */
export function crossingsOf(lines: readonly GutterLine[]): Crossings {
  const byOrientation = (horizontal: boolean): GutterLine[] =>
    lines.filter((line) => line.horizontal === horizontal);
  const sorted = { h: byOrientation(true), v: byOrientation(false) };
  const widest = Math.max(0, ...lines.map((line) => Math.max(...line.pieces.map((piece) => piece.strip))));
  return {
    bands(horizontal, border, from, to) {
      const list = horizontal ? sorted.h : sorted.v;
      // The first line whose band could reach `from`.
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((list[mid] as GutterLine).c < from - widest / 2) lo = mid + 1;
        else hi = mid;
      }
      const bands: [number, number][] = [];
      for (let i = lo; i < list.length; i += 1) {
        const line = list[i] as GutterLine;
        if (line.c > to + widest / 2) break;
        if (line.a >= border - 1e-6 || line.b <= border + 1e-6) continue;
        let strip = 0;
        for (const piece of line.pieces) {
          if (piece.a <= border && piece.b >= border) strip = Math.max(strip, piece.strip);
        }
        bands.push([line.c - strip / 2, line.c + strip / 2]);
      }
      return bands;
    },
  };
}

const NO_CROSSINGS: Crossings = { bands: () => [] };

/**
 * The grid ports lie on (half a pixel): every slot is rounded to it, so with whole-pixel sizes a port lies on a
 * whole or a half pixel.
 */
export const PORT_STEP = 0.5;

/**
 * Where on a side ports may sit, as intervals along it. A card, chip or empty zone: the side, clear of the
 * corners. An open zone: below its header (a left or right side) and clear of its lower corners, within its
 * ring (for ports facing inwards), and outside the bands of the gutter lines that pass through that side of its
 * border (`crossings`), so that a port's stub never runs along a gutter's lanes. Below the header means by the
 * greatest of half the padding, half the corner clearance and one port step: a slot may sit at an end of its
 * interval, and one on the header's lower edge (a zone without padding, a routing without corner clearance)
 * would point its stub and head at the header. A side too short for its clearance keeps one slot, its middle:
 * on an open zone's left or right side the middle of the stretch below its header, never beside the header
 * (where the middle of the clearances falls when the lower corner's clearance is longer than that stretch).
 */
export function sideIntervals(
  node: LayoutNode,
  side: Side,
  routing: Routing,
  crossings: Crossings = NO_CROSSINGS,
): [number, number][] {
  const vertical = side === 'left' || side === 'right';
  let lo: number;
  let hi: number;
  if (node.role !== 'zone') {
    const c = routing.portClearance;
    [lo, hi] = vertical ? [node.y + c, node.y + node.height - c] : [node.x + c, node.x + node.width - c];
  } else {
    const half = (which: Side): number => (node.padding + node.extra[which]) / 2;
    if (vertical) {
      lo = node.y + node.headerHeight + Math.max(half('top'), routing.portClearance / 2, PORT_STEP);
      hi = node.y + node.height - Math.max(half('bottom'), routing.zonePortClearance);
    } else {
      lo = node.x + Math.max(half('left'), routing.zonePortClearance);
      hi = node.x + node.width - Math.max(half('right'), routing.zonePortClearance);
    }
  }
  // A side too short for its clearance keeps its middle (on an open zone's left or right, below the header).
  if (lo >= hi) {
    const at =
      node.role === 'zone' && vertical ? node.y + (node.headerHeight + node.height) / 2 : (lo + hi) / 2;
    return [[at, at]];
  }
  const mid = (lo + hi) / 2;
  if (node.role !== 'zone') return [[lo, hi]];
  const border = side === 'left' ? node.x : side === 'right' ? node.x + node.width : node.y + node.height;
  const bands = crossings.bands(vertical, border, lo, hi).sort((p, q) => p[0] - q[0]);
  const intervals: [number, number][] = [];
  let at = lo;
  for (const [from, to] of bands) {
    if (from > at) intervals.push([at, Math.min(from, hi)]);
    at = Math.max(at, to);
  }
  if (at < hi) intervals.push([at, hi]);
  const usable = intervals.filter(([from, to]) => to > from);
  // A zone side taken entirely by gutters (never in a real layout) keeps its middle.
  return usable.length > 0 ? usable : [[mid, mid]];
}

/**
 * The slots `portSpacing` apart that fit in each interval, centred in it; on a top or left side shifted by half
 * a spacing, so that two rects facing each other across a gutter (a card and the card below it in its column,
 * two neighbours in a row) never put ports at the same coordinate, whose stubs would run along each other.
 */
export function candidateSlots(
  intervals: readonly [number, number][],
  spacing: number,
  shifted: boolean,
): number[] {
  const slots: number[] = [];
  for (const [lo, hi] of intervals) {
    const half = (hi - lo) / 2;
    const mid = lo + half;
    // Unshifted: the middle and whole spacings either side of it. Shifted: half spacings either side of the
    // middle (an interval shorter than one spacing keeps its middle).
    const reach = Math.floor(half / spacing + (shifted ? 0.5 : 0) + 1e-9);
    const first = shifted ? -reach + 0.5 : -reach;
    const last = shifted ? reach - 0.5 : reach;
    if (last < first) slots.push(mid);
    for (let j = first; j <= last + 1e-9; j += 1) slots.push(mid + j * spacing);
  }
  return slots;
}

/**
 * Positions for k ports on a side, in increasing order: the k slots nearest the middle of the side when they
 * fit, else k positions spread evenly over the intervals (ports closer than `portSpacing`).
 */
export function slotPositions(
  intervals: readonly [number, number][],
  k: number,
  spacing: number,
  shifted: boolean,
): number[] {
  const slots = candidateSlots(intervals, spacing, shifted);
  if (slots.length >= k) {
    const lo = (intervals[0] as [number, number])[0];
    const hi = (intervals[intervals.length - 1] as [number, number])[1];
    const mid = (lo + hi) / 2;
    return [...slots]
      .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)
      .slice(0, k)
      .sort((a, b) => a - b);
  }
  const total = intervals.reduce((sum, [a, b]) => sum + (b - a), 0);
  const positions: number[] = [];
  for (let i = 0; i < k; i += 1) {
    // The point at (i + ½) / k of the intervals' total length, walking over the gaps between them.
    let t = (total * (i + 0.5)) / k;
    let j = 0;
    let [a, b] = intervals[0] as [number, number];
    while (t > b - a && j < intervals.length - 1) {
      t -= b - a;
      j += 1;
      [a, b] = intervals[j] as [number, number];
    }
    positions.push(a + Math.min(t, b - a));
  }
  return positions;
}

/** How many ports fit on a side `portSpacing` apart. */
function capacityOf(node: LayoutNode, side: Side, routing: Routing, crossings: Crossings): number {
  return candidateSlots(sideIntervals(node, side, routing, crossings), routing.portSpacing, isShifted(side))
    .length;
}

/** Top and left sides use the half-shifted slot grid. */
function isShifted(side: Side): boolean {
  return side === 'top' || side === 'left';
}

const OPPOSITE: Readonly<Record<Side, Side>> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };

/** The rect's port requests by side, with the capacity of each side (memoised). */
class RectPorts {
  readonly lists = new Map<Side, Request[]>();
  readonly node: LayoutNode;
  private readonly capacities = new Map<Side, number>();
  private readonly routing: Routing;
  private readonly crossings: Crossings;

  constructor(node: LayoutNode, routing: Routing, crossings: Crossings) {
    this.node = node;
    this.routing = routing;
    this.crossings = crossings;
  }

  list(side: Side): Request[] {
    let list = this.lists.get(side);
    if (list === undefined) {
      list = [];
      this.lists.set(side, list);
    }
    return list;
  }

  capacity(side: Side): number {
    let capacity = this.capacities.get(side);
    if (capacity === undefined) {
      capacity =
        side === 'top' && this.node.role === 'zone'
          ? 0
          : capacityOf(this.node, side, this.routing, this.crossings);
      this.capacities.set(side, capacity);
    }
    return capacity;
  }

  room(side: Side): number {
    return this.capacity(side) - (this.lists.get(side)?.length ?? 0);
  }
}

/**
 * Moves ports off a side that holds more than fit, while another side has room: first to the neighbouring
 * sides (from a left or right side the ports whose other ends lie highest go to the top, never an open zone's
 * header, and the lowest to the bottom; from a top or bottom side the leftmost go left and the rightmost
 * right), then to the opposite side (the ports at the end nearer the side with more room). A port moves with
 * every end it stands for (a bundle's shared port moves as one).
 */
function spill(rect: RectPorts): void {
  for (const side of SIDES) {
    const list = rect.lists.get(side);
    if (list === undefined) continue;
    const [before, after]: [Side, Side] =
      side === 'left' || side === 'right' ? ['top', 'bottom'] : ['left', 'right'];
    const opposite = OPPOSITE[side];
    while (list.length > rect.capacity(side)) {
      list.sort(byKey);
      const roomBefore = rect.room(before);
      const roomAfter = rect.room(after);
      let moved: Request;
      let to: Side;
      if (roomBefore > 0 || roomAfter > 0) {
        to = roomBefore >= roomAfter ? before : after;
        moved = (to === before ? list.shift() : list.pop()) as Request;
      } else if (rect.room(opposite) > 0) {
        to = opposite;
        moved = (list.length % 2 === 0 ? list.shift() : list.pop()) as Request;
      } else break;
      moved.side = to;
      for (const end of moved.ends) end.side = to;
      moved.key = keyOf(moved);
      rect.list(to).push(moved);
    }
  }
}

/** The side most of a bundle's ends face (ties: bottom, right, left, top). */
function majoritySide(ends: readonly End[]): Side {
  const votes: Record<Side, number> = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const end of ends) votes[end.side] += 1;
  let best: Side = 'bottom';
  for (const side of ['right', 'left', 'top'] as const) if (votes[side] > votes[best]) best = side;
  return best;
}

/**
 * Assigns every edge end a side, a slot on it and the gutter line its stub meets; bundles hubs' edges. With
 * `previous` (the ports of the pass before a re-pack, for the same edges), every end keeps its side and every
 * bundle its members, and only the slots are placed anew: the re-route then runs between the same sides of the
 * same rects as the route the widening was sized for.
 */
export function assignPorts(
  edges: readonly DrawnEdge[],
  gutters: Gutters,
  routing: Routing,
  previous?: readonly EdgePorts[],
): EdgePorts[] {
  const crossings = crossingsOf(gutters.lines);
  const ends: End[] = [];
  edges.forEach((edge, index) => {
    const { from, to } = edge;
    let sourceSide: Side;
    let targetSide: Side;
    let sourceInward = false;
    let targetInward = false;
    const before = previous?.[index];
    if (before !== undefined) {
      sourceSide = before.source.side;
      targetSide = before.target.side;
      sourceInward = before.source.inward;
      targetInward = before.target.inward;
    } else if (from.role === 'zone' && isAncestor(from, to)) {
      sourceSide = innerSide(from, to);
      targetSide = sourceSide;
      sourceInward = true;
    } else if (to.role === 'zone' && isAncestor(to, from)) {
      targetSide = innerSide(to, from);
      sourceSide = targetSide;
      targetInward = true;
    } else {
      sourceSide = facingSide(from, to, from.role !== 'zone');
      targetSide = facingSide(to, from, to.role !== 'zone');
    }
    const kind = edge.kind;
    ends.push({ edge: index, end: 0, inward: sourceInward, node: from, other: to, kind, side: sourceSide });
    ends.push({ edge: index, end: 1, inward: targetInward, node: to, other: from, kind, side: targetSide });
  });

  // Bundles by size: the edges of one kind meeting one rect at one end, from `bundleMin` on. Each edge joins
  // the larger of its two ends' groups (its target's on a tie).
  const groupOf = (end: End): string => `${String(end.node.index)}:${String(end.end)}:${end.kind}`;
  const groupSize = new Map<string, number>();
  for (const end of ends) groupSize.set(groupOf(end), (groupSize.get(groupOf(end)) ?? 0) + 1);
  const bundledEnd = new Int8Array(edges.length).fill(-1);
  const minimum = Math.max(2, routing.bundleMin);
  edges.forEach((_, index) => {
    if (previous !== undefined) {
      bundledEnd[index] = previous[index]?.bundle?.end ?? -1;
      return;
    }
    const source = groupSize.get(groupOf(ends[index * 2] as End)) ?? 0;
    const target = groupSize.get(groupOf(ends[index * 2 + 1] as End)) ?? 0;
    if (target >= minimum && target >= source) bundledEnd[index] = 1;
    else if (source >= minimum) bundledEnd[index] = 0;
  });

  // Requests: a bundle's members share one, on the side most of them face (a hub gets one port per kind, so its
  // edges join into one trunk); every other end has its own.
  const rects = new Map<LayoutNode, RectPorts>();
  const rectOf = (node: LayoutNode): RectPorts => {
    let rect = rects.get(node);
    if (rect === undefined) {
      rect = new RectPorts(node, routing, crossings);
      rects.set(node, rect);
    }
    return rect;
  };
  const shared = new Map<string, End[]>();
  const order: (End | End[])[] = [];
  for (const end of ends) {
    if (bundledEnd[end.edge] !== end.end) {
      order.push(end);
      continue;
    }
    // The previous pass's bundle, or the group by rect, end, kind and whether the port faces inwards.
    const key =
      previous === undefined
        ? `${groupOf(end)}:${end.inward ? 'in' : 'out'}`
        : `bundle ${String(previous[end.edge]?.bundle?.index ?? -1)}`;
    const members = shared.get(key);
    if (members === undefined) {
      const list = [end];
      shared.set(key, list);
      order.push(list);
    } else members.push(end);
  }
  for (const entry of order) {
    if (Array.isArray(entry) && entry.length === 1) bundledEnd[(entry[0] as End).edge] = -1;
    if (Array.isArray(entry) && entry.length > 1 && previous === undefined) {
      const side = majoritySide(entry);
      for (const end of entry) end.side = side;
    }
    const request = requestOf(Array.isArray(entry) ? entry : [entry]);
    rectOf(request.node).list(request.side).push(request);
  }

  // Bundles by crowding: on a side that more ports face than it holds, the single ends of one kind (and one end
  // and direction) whose edges are in no bundle yet share a port, the largest group first, until the side's
  // ports fit or no group of two is left.
  for (const rect of previous === undefined ? rects.values() : []) {
    for (const side of SIDES) {
      const list = rect.lists.get(side);
      if (list === undefined) continue;
      while (list.length > rect.capacity(side)) {
        const groups = new Map<string, Request[]>();
        for (const request of list) {
          if (request.ends.length !== 1) continue;
          const end = request.ends[0] as End;
          if (bundledEnd[end.edge] !== -1) continue;
          const key = `${String(end.end)}:${end.kind}:${end.inward ? 'in' : 'out'}`;
          const group = groups.get(key);
          if (group === undefined) groups.set(key, [request]);
          else group.push(request);
        }
        let found: Request[] | undefined;
        for (const group of groups.values()) {
          if (group.length < 2) continue;
          if (
            found === undefined ||
            group.length > found.length ||
            (group.length === found.length && (group[0] as Request).first < (found[0] as Request).first)
          )
            found = group;
        }
        if (found === undefined) break;
        const best = new Set(found);
        const merged = requestOf(found.flatMap((request) => request.ends));
        for (const end of merged.ends) bundledEnd[end.edge] = end.end;
        const keep = list.filter((request) => !best.has(request));
        list.length = 0;
        list.push(...keep, merged);
      }
    }
  }

  // Bundle numbers and ids, in the order of their first member.
  const bundles: (PortBundle | null)[] = new Array<PortBundle | null>(edges.length).fill(null);
  const bundleRequests: Request[] = [];
  for (const rect of rects.values())
    for (const list of rect.lists.values())
      for (const request of list) if (request.ends.length > 1) bundleRequests.push(request);
  bundleRequests.sort((a, b) => a.first - b.first);

  const positions = new Float64Array(edges.length * 2);
  const sides: Side[] = new Array<Side>(edges.length * 2).fill('top');
  for (const rect of rects.values()) {
    if (previous === undefined) spill(rect);
    for (const side of SIDES) {
      const list = rect.lists.get(side);
      if (list === undefined || list.length === 0) continue;
      list.sort(byKey);
      const slots = slotPositions(
        sideIntervals(rect.node, side, routing, crossings),
        list.length,
        routing.portSpacing,
        isShifted(side),
      );
      list.forEach((request, i) => {
        const position = Math.round((slots[i] as number) / PORT_STEP) * PORT_STEP;
        for (const end of request.ends) {
          positions[end.edge * 2 + end.end] = position;
          sides[end.edge * 2 + end.end] = side;
        }
      });
    }
  }
  const ids = new Set<string>();
  bundleRequests.forEach((request, index) => {
    const end = (request.ends[0] as End).end;
    const kind = (request.ends[0] as End).kind;
    const where = request.inward ? `${request.side}, inside` : request.side;
    const base =
      end === 1 ? `${request.node.id} <-${kind}- * (${where})` : `${request.node.id} -${kind}-> * (${where})`;
    // Two bundles of one kind can share a side (one spilled onto the other's): number the second.
    let id = base;
    for (let n = 2; ids.has(id); n += 1) id = `${base} #${String(n)}`;
    ids.add(id);
    const bundle: PortBundle = { index, end, id, size: request.ends.length };
    for (const member of request.ends) bundles[member.edge] = bundle;
  });

  const portOf = (node: LayoutNode, side: Side, isInward: boolean, position: number): Port => {
    const horizontalSide = side === 'top' || side === 'bottom';
    const x = horizontalSide ? position : side === 'left' ? node.x : node.x + node.width;
    const y = horizontalSide ? (side === 'top' ? node.y : node.y + node.height) : position;
    let lineCoordinate: number;
    if (isInward) {
      const container = gutters.containers[gutters.containerOf[node.index] as number] as Container;
      lineCoordinate =
        side === 'left' ? container.ringLeft : side === 'right' ? container.ringRight : container.ringBottom;
    } else {
      const at = node.index * 4;
      const slot = side === 'left' ? LEFT : side === 'right' ? RIGHT : side === 'top' ? ABOVE : BELOW;
      lineCoordinate = gutters.around[at + slot] as number;
    }
    const line = gutters.find(horizontalSide, lineCoordinate, position);
    const inset = isInward
      ? 0
      : node.role === 'zone'
        ? Math.min(routing.arrowInset, node.padding + node.extra[side])
        : routing.arrowInset;
    return { x, y, side, inward: isInward, line, t: position, inset };
  };

  return edges.map((edge, index) => {
    const source = ends[index * 2] as End;
    const target = ends[index * 2 + 1] as End;
    const bundle = bundles[index] ?? null;
    return {
      source: portOf(edge.from, sides[index * 2] as Side, source.inward, positions[index * 2] as number),
      target: portOf(
        edge.to,
        sides[index * 2 + 1] as Side,
        target.inward,
        positions[index * 2 + 1] as number,
      ),
      holder: bundle === null ? index : edges.length + bundle.index,
      bundle,
    };
  });
}
