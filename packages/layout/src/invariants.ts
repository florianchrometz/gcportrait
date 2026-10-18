// SPDX-License-Identifier: Apache-2.0
/**
 * Layout invariants (stage 6; skill gcp-diagram-layout §5), checked from the Scene
 * and the Layout alone, independently of how the layout was computed. Used by the tests (unit, property and
 * golden) and by the render library; `pnpm render --strict` fails on reported violations. The app's workers
 * do not call these checks. Edge invariants (no segment through a card or a
 * header, ports on borders) are checked once edges are routed.
 *
 * 1. No two solid rects (cards, chips, empty zones) overlap, and no two siblings overlap.
 * 2. Every child rect lies inside its parent's padding (below the header); top-level rects inside the
 *    canvas margin.
 * 3. Every Scene node has exactly one rect (an organisation zone at the top level is the canvas and has
 *    none), with the right parent, depth, role and sizes.
 * 4. The bounding box is finite and contains every rect; `chips` lists the chip rects and `arrangements` holds
 *    one arrangement for the canvas and for every open zone, fitting its children.
 * 5. Laying out twice, or with the children in another order, gives byte-identical JSON
 *    (`checkDeterminism`).
 * 6. Edges (stages 4–5): exactly one routed edge per distinct (from, to, kind) of the Scene's drawable edges
 *    (ends re-targeted to chips, symmetric kinds with ordered ends, an end at the canvas dropped), with the
 *    heads of its kind; every edge has at least two finite points and only horizontal and vertical segments;
 *    every port lies on its rect's border, on the side it names, never on a zone header (an open zone's top
 *    side, or its left or right side beside the header); each end stops at its port, or at the arrowhead's tip
 *    `arrowInset` inside the border (at most the zone's padding deep in an open zone; at the border for a port
 *    on the inside of a zone that contains the other end) with the port on the last segment; and no segment
 *    passes through the interior of a card, chip, empty zone or zone header (the tip of an arrowhead only
 *    through its own target).
 *
 * The geometry of the rects is checked against the gutter reservations the layout reports it was packed with
 * (`Layout.gutters`: the caller's plus the router's widening).
 */
import { RELATION_KINDS, type Scene, type SceneNode } from '@gcportrait/model';
import { EPSILON as GEOMETRY_EPSILON, ObstacleIndex, normalOf, type Obstacle } from './geometry.js';
import { layoutScene, resolveOptions } from './layout.js';
import { compareCodePoints } from './order.js';
import { chipWidth } from './chips.js';
import { arrangementProblem } from './pack.js';
import { basePaddingOf, cardWidth, headerHeightAt } from './size.js';
import type {
  Arrangement,
  EdgePath,
  EdgePort,
  Layout,
  LayoutOptions,
  LayoutRect,
  Point,
  Rect,
  RectRole,
} from './types.js';

export type InvariantCode =
  | 'missing-rect'
  | 'unexpected-rect'
  | 'non-finite'
  | 'wrong-parent'
  | 'wrong-depth'
  | 'wrong-role'
  | 'wrong-size'
  | 'outside-parent'
  | 'overlap'
  | 'outside-bounds'
  | 'chips'
  | 'arrangement'
  | 'not-deterministic'
  | 'edge-missing'
  | 'edge-unexpected'
  | 'edge-shape'
  | 'edge-port'
  | 'edge-tip'
  | 'edge-crossing';

export interface InvariantViolation {
  readonly code: InvariantCode;
  readonly ids: readonly string[];
  readonly message: string;
}

export class LayoutInvariantError extends Error {
  readonly violations: readonly InvariantViolation[];

  constructor(violations: readonly InvariantViolation[]) {
    const shown = violations
      .slice(0, 10)
      .map((v) => `[${v.code}] ${v.message}`)
      .join('\n');
    const more = violations.length > 10 ? `\n… and ${String(violations.length - 10)} more` : '';
    super(`layout invariants violated (${String(violations.length)}):\n${shown}${more}`);
    this.name = 'LayoutInvariantError';
    this.violations = violations;
  }
}

const ORGANISATION_ID = /^\/\/cloudresourcemanager\.googleapis\.com\/organizations\/[^/]+$/;
/** Tolerance for coordinates computed from fractional sizing overrides. */
const EPSILON = 1e-6;

interface Expected {
  readonly node: SceneNode;
  readonly parent: string | null;
  readonly depth: number;
  readonly role: RectRole;
}

function expectedRects(scene: Scene): Map<string, Expected> {
  const expected = new Map<string, Expected>();
  const visit = (nodes: readonly SceneNode[], parent: string | null, depth: number): void => {
    for (const node of nodes) {
      const role: RectRole =
        node.type === 'card'
          ? 'card'
          : node.collapsed !== undefined
            ? 'chip'
            : node.children.length === 0
              ? 'empty'
              : 'zone';
      expected.set(node.id, { node, parent, depth, role });
      if (node.type === 'zone') visit(node.children, node.id, depth + 1);
    }
  };
  for (const node of scene.children) {
    if (node.type === 'zone' && ORGANISATION_ID.test(node.id)) visit(node.children, null, 1);
    else visit([node], null, 1);
  }
  return expected;
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - EPSILON &&
    b.x < a.x + a.width - EPSILON &&
    a.y < b.y + b.height - EPSILON &&
    b.y < a.y + a.height - EPSILON
  );
}

/** Every overlapping pair among `items`, by a sweep over x. */
function overlappingPairs(items: readonly [string, Rect][]): [string, string][] {
  const sorted = [...items].sort((a, b) => a[1].x - b[1].x || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const active: [string, Rect][] = [];
  const pairs: [string, string][] = [];
  for (const item of sorted) {
    const [, rect] = item;
    for (let i = active.length - 1; i >= 0; i -= 1) {
      const other = active[i];
      if (other !== undefined && other[1].x + other[1].width <= rect.x + EPSILON) active.splice(i, 1);
    }
    for (const other of active) if (overlaps(other[1], rect)) pairs.push([other[0], item[0]]);
    active.push(item);
  }
  return pairs;
}

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - EPSILON &&
    inner.y >= outer.y - EPSILON &&
    inner.x + inner.width <= outer.x + outer.width + EPSILON &&
    inner.y + inner.height <= outer.y + outer.height + EPSILON
  );
}

/** The area a rect's children must lie in: inside its padding (and any extra per side), below its header. */
export function contentBox(rect: LayoutRect): Rect {
  const extra = rect.paddingExtra ?? { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    x: rect.x + rect.padding + extra.left,
    y: rect.y + rect.headerHeight + rect.padding + extra.top,
    width: rect.width - 2 * rect.padding - extra.left - extra.right,
    height: rect.height - rect.headerHeight - 2 * rect.padding - extra.top - extra.bottom,
  };
}

/** The canvas area top-level rects must lie in. */
export function canvasContentBox(layout: Layout, options: LayoutOptions = {}): Rect {
  const resolved = resolveOptions(options);
  const margin = resolved.sizing.canvasMargin + (layout.gutters.canvas?.ring ?? 0);
  const sides = layout.gutters.canvas?.ringSides;
  const { bounds } = layout;
  const left = margin + (sides?.left ?? 0);
  const top = margin + (sides?.top ?? 0);
  return {
    x: bounds.x + left,
    y: bounds.y + top,
    width: bounds.width - left - margin - (sides?.right ?? 0),
    height: bounds.height - top - margin - (sides?.bottom ?? 0),
  };
}

/** Checks invariants 1–4 of a Layout against its Scene; returns every violation (empty when it holds). */
export function checkLayout(scene: Scene, layout: Layout, options: LayoutOptions = {}): InvariantViolation[] {
  const { sizing, fontMetrics } = resolveOptions(options);
  const gutters = layout.gutters;
  const violations: InvariantViolation[] = [];
  const add = (code: InvariantCode, ids: readonly string[], message: string): void => {
    violations.push({ code, ids, message });
  };
  const expected = expectedRects(scene);
  const rects = Object.entries(layout.rects);
  // Sibling chips and empty zones share the widest natural width among them (size.ts).
  const solidWidth = new Map<string | null, number>();
  for (const info of expected.values()) {
    if (info.node.type !== 'zone' || (info.role !== 'chip' && info.role !== 'empty')) continue;
    const context = { sizing, metrics: fontMetrics };
    const natural =
      info.role === 'chip'
        ? chipWidth(info.node.label, info.node.collapsed ?? {}, context).width
        : cardWidth(info.node.label, info.node.subtitle, context).width;
    solidWidth.set(info.parent, Math.max(solidWidth.get(info.parent) ?? 0, natural));
  }

  for (const id of expected.keys()) {
    if (!Object.hasOwn(layout.rects, id)) add('missing-rect', [id], `${id} has no rect`);
  }

  const canvas = canvasContentBox(layout, options);
  const { bounds } = layout;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
    add('non-finite', [], 'the bounding box is not finite');
  }

  for (const [id, rect] of rects) {
    const info = expected.get(id);
    if (info === undefined) {
      add('unexpected-rect', [id], `${id} has a rect but is not a Scene node`);
      continue;
    }
    if (
      ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      add('non-finite', [id], `${id} has a non-finite or empty rect`);
      continue;
    }
    if (rect.parent !== info.parent) {
      add('wrong-parent', [id], `${id} has parent ${String(rect.parent)}, expected ${String(info.parent)}`);
    }
    if (rect.depth !== info.depth)
      add('wrong-depth', [id], `${id} has depth ${String(rect.depth)}, expected ${String(info.depth)}`);
    if (rect.role !== info.role || rect.collapsed !== (info.role === 'chip')) {
      add('wrong-role', [id], `${id} is drawn as ${rect.role}, expected ${info.role}`);
    }
    const kind = info.node.type === 'zone' ? info.node.kind : 'card';
    if (rect.kind !== kind) add('wrong-role', [id], `${id} has kind ${rect.kind}, expected ${kind}`);

    switch (info.role) {
      case 'card':
      case 'empty':
        if (
          Math.abs(rect.height - sizing.cardHeight) > EPSILON ||
          rect.width < sizing.cardMinWidth - EPSILON ||
          rect.width > Math.max(sizing.cardMaxWidth, sizing.chipMaxWidth) + EPSILON ||
          (info.role === 'empty' && Math.abs(rect.width - (solidWidth.get(info.parent) ?? 0)) > EPSILON)
        ) {
          add(
            'wrong-size',
            [id],
            `${id} is ${String(rect.width)}×${String(rect.height)}, outside the card size`,
          );
        }
        break;
      case 'chip': {
        // As wide as the widest of its sibling chips and empty zones needs (chips.ts, size.ts).
        const expected = solidWidth.get(rect.parent) ?? sizing.chipMinWidth;
        if (
          Math.abs(rect.width - expected) > EPSILON ||
          Math.abs(rect.height - sizing.chipHeight) > EPSILON
        ) {
          add(
            'wrong-size',
            [id],
            `${id} is ${String(rect.width)}×${String(rect.height)}, not its chip size ${String(expected)}×${String(sizing.chipHeight)}`,
          );
        }
        break;
      }
      case 'zone': {
        const reserved =
          gutters.zones !== undefined && Object.hasOwn(gutters.zones, id) ? gutters.zones[id] : undefined;
        const ring = reserved?.ring ?? 0;
        const sides = reserved?.ringSides;
        const extra = rect.paddingExtra;
        for (const side of ['top', 'right', 'bottom', 'left'] as const) {
          if (Math.abs((extra?.[side] ?? 0) - (sides?.[side] ?? 0)) > EPSILON) {
            add(
              'wrong-size',
              [id],
              `${id} has ${String(extra?.[side] ?? 0)} extra padding on its ${side} side, reserved ${String(sides?.[side] ?? 0)}`,
            );
          }
        }
        const padding = basePaddingOf({ kind, depth: info.depth }, sizing) + ring;
        if (
          rect.headerHeight !== headerHeightAt(info.depth, sizing) ||
          Math.abs(rect.padding - padding) > EPSILON
        ) {
          add(
            'wrong-size',
            [id],
            `${id} has header ${String(rect.headerHeight)} and padding ${String(rect.padding)}, expected ${String(headerHeightAt(info.depth, sizing))} and ${String(padding)}`,
          );
        }
        if (contentBox(rect).height < -EPSILON || contentBox(rect).width < -EPSILON) {
          add('wrong-size', [id], `${id} is shorter than its header and padding`);
        }
        break;
      }
    }

    const parentRect = rect.parent === null ? undefined : layout.rects[rect.parent];
    const box = parentRect === undefined ? canvas : contentBox(parentRect);
    if (!inside(rect, box)) {
      add(
        'outside-parent',
        rect.parent === null ? [id] : [id, rect.parent],
        `${id} lies outside the ${rect.parent === null ? 'canvas margin' : `padding of ${rect.parent}`}`,
      );
    }
    if (!inside(rect, bounds)) add('outside-bounds', [id], `${id} lies outside the bounding box`);
  }

  // Overlaps: solid rects across the whole layout, and siblings within each parent.
  const solid = rects.filter(([, rect]) => rect.role !== 'zone');
  for (const [a, b] of overlappingPairs(solid)) add('overlap', [a, b], `${a} overlaps ${b}`);
  const byParent = new Map<string | null, [string, Rect][]>();
  for (const [id, rect] of rects) {
    if (rect.role !== 'zone') continue;
    const list = byParent.get(rect.parent) ?? [];
    list.push([id, rect]);
    byParent.set(rect.parent, list);
  }
  for (const [id, rect] of rects) {
    if (rect.role === 'zone') continue;
    const list = byParent.get(rect.parent);
    if (list !== undefined) list.push([id, rect]);
  }
  for (const siblings of byParent.values()) {
    for (const [a, b] of overlappingPairs(siblings)) {
      if (layout.rects[a]?.role !== 'zone' && layout.rects[b]?.role !== 'zone') continue; // reported above
      add('overlap', [a, b], `${a} overlaps its sibling ${b}`);
    }
  }

  const chipIds = rects.filter(([, rect]) => rect.role === 'chip').map(([id]) => id);
  if (chipIds.length !== layout.chips.length || chipIds.some((id, index) => layout.chips[index] !== id)) {
    add('chips', layout.chips, 'layout.chips does not list exactly the chip rects in paint order');
  }

  // Arrangements: one for the canvas and for every open zone, each fitting its children's counts.
  const counts = new Map<string | null, { cards: number; zones: number }>([[null, { cards: 0, zones: 0 }]]);
  for (const [id, rect] of rects) if (rect.role === 'zone') counts.set(id, { cards: 0, zones: 0 });
  for (const [, rect] of rects) {
    const entry = counts.get(rect.parent);
    if (entry === undefined) continue;
    if (rect.role === 'card') entry.cards += 1;
    else entry.zones += 1;
  }
  const zoneArrangements = layout.arrangements.zones;
  for (const [id, entry] of counts) {
    const arrangement =
      id === null
        ? (layout.arrangements.canvas as Arrangement | undefined)
        : Object.hasOwn(zoneArrangements, id)
          ? zoneArrangements[id]
          : undefined;
    const problem =
      arrangement === undefined
        ? 'has no arrangement'
        : arrangementProblem(arrangement, entry.cards, entry.zones);
    if (problem !== undefined)
      add('arrangement', id === null ? [] : [id], `${id ?? 'the canvas'}: ${problem}`);
  }
  for (const id of Object.keys(zoneArrangements)) {
    if (!counts.has(id)) add('arrangement', [id], `${id} has an arrangement but is not an open zone`);
  }
  violations.push(...checkEdges(scene, layout, options));
  return violations;
}

/** The edges the Scene asks for, keyed like `Layout.edges`, with the count each stands for. */
function expectedEdges(scene: Scene, layout: Layout): Map<string, number> {
  const drawnAt = (id: string): string | undefined => {
    let rect = Object.hasOwn(layout.rects, id) ? layout.rects[id] : undefined;
    if (rect === undefined) return undefined;
    let drawn = id;
    for (let up = rect.parent; up !== null; up = rect.parent) {
      rect = layout.rects[up];
      if (rect === undefined) break;
      if (rect.role === 'chip') drawn = up;
    }
    return drawn;
  };
  const expected = new Map<string, number>();
  for (const edge of scene.edges) {
    let from = drawnAt(edge.from);
    let to = drawnAt(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    if (RELATION_KINDS[edge.kind].direction === 'both' && compareCodePoints(from, to) > 0)
      [from, to] = [to, from];
    const key = `${from} -${edge.kind}-> ${to}`;
    expected.set(key, (expected.get(key) ?? 0) + (edge.count ?? 1));
  }
  return expected;
}

function near(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= GEOMETRY_EPSILON && Math.abs(a.y - b.y) <= GEOMETRY_EPSILON;
}

/** Whether p lies on the axis-parallel segment a–b (ends included). */
function onSegment(p: Point, a: Point, b: Point): boolean {
  const e = GEOMETRY_EPSILON;
  return (
    p.x >= Math.min(a.x, b.x) - e &&
    p.x <= Math.max(a.x, b.x) + e &&
    p.y >= Math.min(a.y, b.y) - e &&
    p.y <= Math.max(a.y, b.y) + e &&
    (Math.abs(a.x - b.x) <= e || Math.abs(a.y - b.y) <= e)
  );
}

/** Why `port` is not a valid port of `rect` on its side, or undefined when it is. */
function portProblem(port: EdgePort, rect: LayoutRect): string | undefined {
  const e = GEOMETRY_EPSILON;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const open = rect.role === 'zone';
  switch (port.side) {
    case 'left':
    case 'right': {
      const x = port.side === 'left' ? rect.x : right;
      if (Math.abs(port.x - x) > e || port.y < rect.y - e || port.y > bottom + e) return 'is not on its side';
      if (open && port.y <= rect.y + rect.headerHeight + e) return 'is beside the zone header';
      return undefined;
    }
    case 'top':
      if (open) return 'is on the zone header';
      if (Math.abs(port.y - rect.y) > e || port.x < rect.x - e || port.x > right + e)
        return 'is not on its side';
      return undefined;
    case 'bottom':
      if (Math.abs(port.y - bottom) > e || port.x < rect.x - e || port.x > right + e)
        return 'is not on its side';
      return undefined;
  }
}

function isAncestorRect(layout: Layout, ancestor: string, id: string): boolean {
  for (let up = layout.rects[id]?.parent ?? null; up !== null; up = layout.rects[up]?.parent ?? null) {
    if (up === ancestor) return true;
  }
  return false;
}

/** Invariant 6: the routed edges. */
export function checkEdges(scene: Scene, layout: Layout, options: LayoutOptions = {}): InvariantViolation[] {
  const { routing, route } = resolveOptions(options);
  const violations: InvariantViolation[] = [];
  const add = (code: InvariantCode, ids: readonly string[], message: string): void => {
    violations.push({ code, ids, message });
  };
  const expected = route ? expectedEdges(scene, layout) : new Map<string, number>();
  for (const [key, count] of expected) {
    const edge = Object.hasOwn(layout.edges, key) ? layout.edges[key] : undefined;
    if (edge === undefined) add('edge-missing', [key], `the edge ${key} was not routed`);
    else if (edge.count !== count)
      add('edge-missing', [key], `${key} stands for ${String(edge.count)} relations, not ${String(count)}`);
  }
  const obstacles: Obstacle[] = [];
  for (const [id, rect] of Object.entries(layout.rects)) {
    const header = rect.role === 'zone';
    obstacles.push({
      id,
      header,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: header ? rect.headerHeight : rect.height,
    });
  }
  const index = new ObstacleIndex(obstacles);

  for (const [key, edge] of Object.entries(layout.edges)) {
    if (!expected.has(key)) {
      add('edge-unexpected', [key], `${key} is routed but the Scene has no such edge`);
      continue;
    }
    checkEdge(key, edge);
  }
  checkBundles();
  return violations;

  /**
   * A hub bundle's members share one port at the bundle's end (and so one rect, side and kind), and the bundle
   * counts them all.
   */
  function checkBundles(): void {
    const members = new Map<string, [string, EdgePath][]>();
    for (const [key, edge] of Object.entries(layout.edges)) {
      if (edge.bundle === undefined) continue;
      const list = members.get(edge.bundle.id);
      if (list === undefined) members.set(edge.bundle.id, [[key, edge]]);
      else list.push([key, edge]);
    }
    for (const [id, list] of members) {
      const [firstKey, first] = list[0] as [string, EdgePath];
      const end = first.bundle?.end ?? 'target';
      const shared = (edge: EdgePath): string => {
        const port = end === 'target' ? edge.target : edge.source;
        const rect = end === 'target' ? edge.to : edge.from;
        return `${rect} ${edge.kind} ${port.side} ${String(port.x)} ${String(port.y)}`;
      };
      for (const [key, edge] of list) {
        if (edge.bundle?.size !== list.length || edge.bundle.end !== end) {
          add(
            'edge-port',
            [key, firstKey],
            `${key}: its bundle ${id} does not hold ${String(list.length)} edges at one end`,
          );
        } else if (shared(edge) !== shared(first)) {
          add('edge-port', [key, firstKey], `${key} does not share the port of its bundle ${id}`);
        }
      }
    }
  }

  function checkEdge(key: string, edge: EdgePath): void {
    const from = layout.rects[edge.from];
    const to = layout.rects[edge.to];
    if (from === undefined || to === undefined) {
      add('edge-unexpected', [key], `${key} joins a node without a rect`);
      return;
    }
    const style = RELATION_KINDS[edge.kind].defaultStyle;
    const heads = style === 'dashed-double-headed' ? 'both' : style === 'solid-round-caps' ? 'none' : 'end';
    if (edge.heads !== heads) add('edge-shape', [key], `${key} has heads ${edge.heads}, its kind ${heads}`);
    const points = edge.points;
    if (points.length < 2 || !points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
      add('edge-shape', [key], `${key} has fewer than two finite points`);
      return;
    }
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1] as Point;
      const b = points[i] as Point;
      if (Math.abs(a.x - b.x) > GEOMETRY_EPSILON && Math.abs(a.y - b.y) > GEOMETRY_EPSILON) {
        add('edge-shape', [key], `${key} has a diagonal segment`);
        return;
      }
    }
    for (const [port, rect, name] of [
      [edge.source, from, edge.from],
      [edge.target, to, edge.to],
    ] as const) {
      const problem = portProblem(port, rect);
      if (problem !== undefined) add('edge-port', [key, name], `${key}: the port on ${name} ${problem}`);
    }

    // Each end: the port, or the arrowhead's tip with the port on the end segment.
    const inset = (rect: LayoutRect, inward: boolean, side: EdgePort['side']): number =>
      inward
        ? 0
        : rect.role === 'zone'
          ? Math.min(routing.arrowInset, rect.padding + (rect.paddingExtra?.[side] ?? 0))
          : routing.arrowInset;
    const tipOf = (port: EdgePort, rect: LayoutRect, inward: boolean): Point => {
      const normal = normalOf(port.side);
      const depth = inset(rect, inward, port.side);
      return { x: port.x - normal.x * depth, y: port.y - normal.y * depth };
    };
    const sourceInward = from.role === 'zone' && isAncestorRect(layout, edge.from, edge.to);
    const targetInward = to.role === 'zone' && isAncestorRect(layout, edge.to, edge.from);
    const core = [...points];
    const trimEnd = (
      list: Point[],
      port: EdgePort,
      rect: LayoutRect,
      inward: boolean,
      head: boolean,
      name: string,
    ): boolean => {
      const end = list[list.length - 1] as Point;
      const expectedEnd = head ? tipOf(port, rect, inward) : port;
      if (!near(end, expectedEnd)) {
        add(
          'edge-tip',
          [key, name],
          `${key} ends at (${String(end.x)}, ${String(end.y)}), not at its ${head ? 'arrowhead tip' : 'port'} on ${name}`,
        );
        return false;
      }
      if (near(end, port)) return true;
      const before = list[list.length - 2] as Point;
      if (!onSegment(port, before, end)) {
        add('edge-tip', [key, name], `${key}: the port on ${name} is not on the arrowhead's segment`);
        return false;
      }
      const tipHits = index.hits(port, end).filter((o) => !(o.id === name && !o.header));
      if (tipHits.length > 0)
        add(
          'edge-crossing',
          [key, ...tipHits.map((o) => o.id)],
          `${key}: the arrowhead on ${name} enters ${tipHits.map((o) => o.id).join(', ')}`,
        );
      list[list.length - 1] = { x: port.x, y: port.y };
      return true;
    };
    if (!trimEnd(core, edge.target, to, targetInward, heads !== 'none', edge.to)) return;
    core.reverse();
    if (!trimEnd(core, edge.source, from, sourceInward, heads === 'both', edge.from)) return;
    for (let i = 1; i < core.length; i += 1) {
      const hits = index.hits(core[i - 1] as Point, core[i] as Point);
      if (hits.length > 0) {
        add(
          'edge-crossing',
          [key, ...hits.map((o) => o.id)],
          `${key} crosses ${hits.map((o) => (o.header ? `the header of ${o.id}` : o.id)).join(', ')}`,
        );
      }
    }
  }
}

/**
 * Throws a `LayoutInvariantError` listing every violation `checkLayout` finds: invariants 1–4 and 6 (the
 * edges); invariant 5 is `checkDeterminism`.
 */
export function assertLayout(scene: Scene, layout: Layout, options: LayoutOptions = {}): void {
  const violations = checkLayout(scene, layout, options);
  if (violations.length > 0) throw new LayoutInvariantError(violations);
}

function reversedScene(scene: Scene): Scene {
  const reverse = (nodes: readonly SceneNode[]): SceneNode[] =>
    [...nodes]
      .reverse()
      .map((node) => (node.type === 'zone' ? { ...node, children: reverse(node.children) } : node));
  return { ...scene, children: reverse(scene.children), edges: [...scene.edges].reverse() };
}

/**
 * Invariant 5: laying the Scene out twice, and once more with every child list and the edges reversed, gives
 * byte-identical JSON. Timings are left out (no clock is passed).
 */
export function checkDeterminism(scene: Scene, options: LayoutOptions = {}): InvariantViolation[] {
  const rest: { -readonly [K in keyof LayoutOptions]: LayoutOptions[K] } = { ...options };
  delete rest.clock;
  const first = JSON.stringify(layoutScene(scene, rest));
  const second = JSON.stringify(layoutScene(scene, rest));
  const reordered = JSON.stringify(layoutScene(reversedScene(scene), rest));
  const violations: InvariantViolation[] = [];
  if (first !== second) {
    violations.push({ code: 'not-deterministic', ids: [], message: 'two runs gave different layouts' });
  }
  if (first !== reordered) {
    violations.push({
      code: 'not-deterministic',
      ids: [],
      message: 'reordering the Scene children gave a different layout',
    });
  }
  return violations;
}
