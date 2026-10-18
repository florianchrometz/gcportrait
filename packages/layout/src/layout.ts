// SPDX-License-Identifier: Apache-2.0
/**
 * `layoutScene(scene, options)`: Scene → Layout, stages 1–5 of the package README's "Pipeline" (forest
 * normalisation, sizing, packing, gutters, routing). Pure and deterministic: no DOM, no randomness, no clock
 * unless the caller passes one for timings, text widths from the metrics table only. The same Scene (whatever
 * the order of its children and edges) and options always give a byte-identical Layout.
 *
 * Passes (skill gcp-diagram-layout §5): route over the packed gutters; widen every gutter whose lanes do not fit
 * (through the gutter hook, `GutterReservations`) and re-pack with the first pass's arrangements pinned, so
 * every row, column and gutter stays where it was, only wider; re-route by laying the routes onto the widened
 * gutters (route.ts, "Re-route"). Further rounds widen what the re-route before still needed, if anything
 * (`Routing.wideningRounds`, 3 in all; 2 above `Routing.lateRoundsUpTo` lane holders; 1 when the first pass's
 * search work is above `Routing.oneRoundWork`). Once the first pass's search work reaches
 * `Routing.singlePassWork`, it searches the rest of its edges weighted and its route is final (single-pass
 * mode).
 */
import type { Scene } from '@gcportrait/model';
import {
  ASPECT_TOLERANCE,
  DEFAULT_ROUTING,
  DEFAULT_SIZING,
  ROOT_ASPECT,
  TARGET_ASPECT,
  type Routing,
  type Sizing,
} from './constants.js';
import { mergeEdges } from './edges.js';
import { ObstacleIndex, type Obstacle } from './geometry.js';
import { buildGutters, type PlacedTree } from './gutters.js';
import { LayoutInputError } from './errors.js';
import { defaultFontMetrics, parseFontMetricsTable, type FontMetricsTable } from './metrics.js';
import { normaliseScene, type LayoutNode, type NormalisedScene } from './normalise.js';
import { compareCodePoints } from './order.js';
import {
  DEFAULT_PACK_POLICY,
  arrangementProblem,
  packChildren,
  type Gaps,
  type PackPolicy,
  type PackTarget,
} from './pack.js';
import {
  accumulate,
  addWidening,
  pathsOf,
  routePassSteps,
  wideningOf,
  type Pass,
  type Widening,
} from './route.js';
import { sizeNodes } from './size.js';
import { drain } from './steps.js';
import type {
  Arrangement,
  EdgePath,
  GutterReservations,
  GutterWidening,
  Insets,
  Layout,
  LayoutOptions,
  LayoutProgress,
  LayoutRect,
  LayoutReport,
  Rect,
  RoutingReport,
  StageTimings,
} from './types.js';

/** Options with every default applied and every value checked. */
export interface ResolvedOptions {
  readonly sizing: Sizing;
  readonly targetAspect: number;
  readonly rootAspect: number;
  readonly aspectTolerance: number;
  readonly fontMetrics: FontMetricsTable;
  readonly gutters: GutterReservations;
  readonly arrangements: NonNullable<LayoutOptions['arrangements']>;
  readonly route: boolean;
  readonly routing: Routing;
  /** How zone rows may be built (skill §4); only the measurement script changes it (`LayoutInternals`). */
  readonly packPolicy: PackPolicy;
}

const validatedTables = new WeakSet<FontMetricsTable>();

function checkNumber(name: string, value: number, positive: boolean): void {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0)) {
    throw new LayoutInputError(
      'invalid-option',
      [name],
      `layout option ${name} must be a finite ${positive ? 'positive' : 'non-negative'} number`,
    );
  }
}

/** Sizing fields that must be strictly positive (the rest may be 0). */
const POSITIVE_SIZING = new Set<keyof Sizing>([
  'cardHeight',
  'cardMinWidth',
  'cardMaxWidth',
  'chipHeight',
  'chipMinWidth',
  'chipMaxWidth',
  'zoneTitleMaxWidth',
  'headerHeight',
  'deepHeaderHeight',
  'cardTitleSize',
  'cardSubtitleSize',
  'zoneTitleSize',
  'deepZoneTitleSize',
  'badgeTextSize',
]);

/** Routing fields that must be strictly positive (the rest may be 0). */
const POSITIVE_ROUTING = new Set<keyof Routing>(['lanePitch', 'portSpacing', 'fallbackGrid']);

function checkWidening(name: string, widening: GutterWidening): void {
  for (const key of ['horizontal', 'vertical', 'ring'] as const) {
    const value = widening[key];
    if (value !== undefined) checkNumber(`${name}.${key}`, value, false);
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const value = widening.ringSides?.[side];
    if (value !== undefined) checkNumber(`${name}.ringSides.${side}`, value, false);
  }
  const { cardColumns, zoneColumns, rows, stacks } = widening.gaps ?? {};
  stacks?.forEach((row, r) => {
    row.forEach((cell, c) => {
      cell.forEach((value, k) => {
        checkNumber(`${name}.gaps.stacks.${String(r)}.${String(c)}.${String(k)}`, value, false);
      });
    });
  });
  cardColumns?.forEach((value, i) => {
    checkNumber(`${name}.gaps.cardColumns.${String(i)}`, value, false);
  });
  rows?.forEach((value, i) => {
    checkNumber(`${name}.gaps.rows.${String(i)}`, value, false);
  });
  zoneColumns?.forEach((row, r) => {
    row.forEach((value, i) => {
      checkNumber(`${name}.gaps.zoneColumns.${String(r)}.${String(i)}`, value, false);
    });
  });
}

export function resolveOptions(options: LayoutOptions = {}): ResolvedOptions {
  const sizing: Sizing = { ...DEFAULT_SIZING, ...options.sizing };
  for (const key of Object.keys(DEFAULT_SIZING) as (keyof Sizing)[]) {
    checkNumber(`sizing.${key}`, sizing[key], POSITIVE_SIZING.has(key));
  }
  for (const [min, max] of [
    ['cardMinWidth', 'cardMaxWidth'],
    ['chipMinWidth', 'chipMaxWidth'],
  ] as const) {
    if (sizing[min] > sizing[max]) {
      throw new LayoutInputError(
        'invalid-option',
        [`sizing.${min}`, `sizing.${max}`],
        `layout option sizing.${min} must not exceed sizing.${max}`,
      );
    }
  }
  const targetAspect = options.targetAspect ?? TARGET_ASPECT;
  const rootAspect = options.rootAspect ?? ROOT_ASPECT;
  const aspectTolerance = options.aspectTolerance ?? ASPECT_TOLERANCE;
  checkNumber('targetAspect', targetAspect, true);
  checkNumber('rootAspect', rootAspect, true);
  checkNumber('aspectTolerance', aspectTolerance, false);
  if (aspectTolerance >= 1) {
    throw new LayoutInputError(
      'invalid-option',
      ['aspectTolerance'],
      'layout option aspectTolerance must be below 1',
    );
  }
  const gutters = options.gutters ?? {};
  if (gutters.canvas !== undefined) checkWidening('gutters.canvas', gutters.canvas);
  for (const [id, widening] of Object.entries(gutters.zones ?? {}))
    checkWidening(`gutters.zones.${id}`, widening);
  const routing: Routing = { ...DEFAULT_ROUTING, ...options.routing };
  for (const key of Object.keys(DEFAULT_ROUTING) as (keyof Routing)[]) {
    checkNumber(`routing.${key}`, routing[key], POSITIVE_ROUTING.has(key));
  }
  let fontMetrics = defaultFontMetrics();
  if (options.fontMetrics !== undefined) {
    if (!validatedTables.has(options.fontMetrics)) {
      try {
        parseFontMetricsTable(options.fontMetrics);
      } catch (error) {
        throw new LayoutInputError('invalid-option', ['fontMetrics'], (error as Error).message);
      }
      validatedTables.add(options.fontMetrics);
    }
    fontMetrics = options.fontMetrics;
  }
  return {
    sizing,
    targetAspect,
    rootAspect,
    aspectTolerance,
    fontMetrics,
    gutters,
    arrangements: options.arrangements ?? {},
    route: options.route ?? true,
    routing,
    packPolicy: DEFAULT_PACK_POLICY,
  };
}

function reservedFor(gutters: GutterReservations, id: string | null): GutterWidening {
  if (id === null) return gutters.canvas ?? {};
  const zones = gutters.zones;
  return zones !== undefined && Object.hasOwn(zones, id) ? (zones[id] ?? {}) : {};
}

/** The pinned arrangement of a container (`null`: the canvas), checked against its children. */
function pinnedOf(
  arrangements: ResolvedOptions['arrangements'],
  node: LayoutNode | null,
  children: readonly LayoutNode[],
): Arrangement | undefined {
  const { canvas, zones } = arrangements;
  const pinned =
    node === null
      ? canvas
      : zones !== undefined && Object.hasOwn(zones, node.id)
        ? zones[node.id]
        : undefined;
  if (pinned === undefined) return undefined;
  const cards = children.filter((child) => child.role === 'card').length;
  const problem = arrangementProblem(pinned, cards, children.length - cards);
  if (problem !== undefined) {
    const name = node === null ? 'arrangements.canvas' : `arrangements.zones.${node.id}`;
    throw new LayoutInputError('invalid-option', [name], `layout option ${name}: ${problem}`);
  }
  return pinned;
}

/** A reservation's extra padding per side (zeros when it has none). */
function sidesOf(widening: GutterWidening): { top: number; right: number; bottom: number; left: number } {
  const sides = widening.ringSides;
  return {
    top: sides?.top ?? 0,
    right: sides?.right ?? 0,
    bottom: sides?.bottom ?? 0,
    left: sides?.left ?? 0,
  };
}

function gapsOf(sizing: Sizing, widening: GutterWidening): Gaps {
  return {
    horizontal: sizing.gapHorizontal + (widening.horizontal ?? 0),
    vertical: sizing.gapVertical + (widening.vertical ?? 0),
  };
}

/** Measurement only (`PackPolicy.byHeight`): cards first, then the zones tallest first, each stable. */
function reorderByHeight(children: LayoutNode[]): void {
  const cards = children.filter((child) => child.role === 'card');
  const zones = children
    .filter((child) => child.role !== 'card')
    .map((zone, index) => ({ zone, index }))
    .sort((a, b) => b.zone.height - a.zone.height || a.index - b.index)
    .map(({ zone }) => zone);
  children.splice(0, children.length, ...cards, ...zones);
}

/** Stage 3 for one open zone, after its children: packs them and sizes the zone around them. */
function packZone(
  node: LayoutNode,
  options: ResolvedOptions,
  gutters: GutterReservations,
  arrangements: ResolvedOptions['arrangements'],
): { arrangement: Arrangement; widened: boolean } {
  const gaps = gapsOf(options.sizing, reservedFor(gutters, node.id));
  const target: PackTarget = {
    aspect: options.targetAspect,
    tolerance: options.aspectTolerance,
  };
  const widening = reservedFor(gutters, node.id);
  if (options.packPolicy.byHeight === true) reorderByHeight(node.children);
  const content = packChildren(
    node.children,
    target,
    gaps,
    pinnedOf(arrangements, node, node.children),
    widening.gaps,
    options.packPolicy,
  );
  const fitted = content.width + 2 * node.padding + node.extra.left + node.extra.right;
  node.width = Math.max(fitted, node.minWidth);
  node.height = node.headerHeight + 2 * node.padding + node.extra.top + node.extra.bottom + content.height;
  return { arrangement: content.arrangement, widened: node.minWidth > fitted };
}

/** Moves every node from parent-relative to absolute coordinates, top-down. */
function place(nodes: readonly LayoutNode[], originX: number, originY: number): void {
  for (const node of nodes) {
    node.x += originX;
    node.y += originY;
    if (node.role === 'zone')
      place(
        node.children,
        node.x + node.padding + node.extra.left,
        node.y + node.headerHeight + node.padding + node.extra.top,
      );
  }
}

function rectOf(node: LayoutNode): LayoutRect {
  const { extra } = node;
  const sided =
    node.role === 'zone' && (extra.top !== 0 || extra.right !== 0 || extra.bottom !== 0 || extra.left !== 0);
  return {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    parent: node.parent?.id ?? null,
    role: node.role,
    kind: node.kind,
    depth: node.depth,
    headerHeight: node.role === 'zone' ? node.headerHeight : 0,
    padding: node.role === 'zone' ? node.padding : 0,
    ...(sided ? { paddingExtra: { ...extra } } : {}),
    ...(node.chipCountLine === undefined ? {} : { chipCountLine: node.chipCountLine }),
    collapsed: node.role === 'chip',
  };
}

/** Stages 2 and 3 over the normalised tree: the nodes' sizes and absolute positions. */
interface Placement {
  readonly arrangements: Map<LayoutNode, Arrangement>;
  readonly canvas: Arrangement;
  readonly bounds: Rect;
  /** The canvas margin on each side (with any reserved ring). */
  readonly margins: Insets;
  readonly gutters: GutterReservations;
  readonly headerWidened: number;
  readonly truncatedLabels: number;
  readonly cappedTitles: number;
}

/**
 * Sizes and packs the normalised tree (stages 2–3) with the given gutter reservations and pinned
 * arrangements; the nodes' sizes and positions are overwritten, so the tree can be placed again.
 */
function placeTree(
  normalised: NormalisedScene,
  options: ResolvedOptions,
  gutters: GutterReservations,
  arrangements: ResolvedOptions['arrangements'],
): Placement {
  return drain(placeTreeSteps(normalised, options, gutters, arrangements, () => undefined));
}

/** {@link placeTree} in steps: `mark` is called and a `size` step yielded between the two stages. */
function* placeTreeSteps(
  normalised: NormalisedScene,
  options: ResolvedOptions,
  gutters: GutterReservations,
  arrangements: ResolvedOptions['arrangements'],
  mark: () => void,
): Generator<LayoutProgress, Placement, undefined> {
  const { sizing } = options;
  const sizingCounts = sizeNodes(normalised.order, {
    sizing,
    metrics: options.fontMetrics,
    ringOf: (id) => reservedFor(gutters, id).ring ?? 0,
    sidesOf: (id) => sidesOf(reservedFor(gutters, id)),
  });
  mark();
  yield { stage: 'size', pass: 0, routed: 0, edges: 0 };
  // Bottom-up: reverse pre-order visits every child before its parent; then the canvas.
  let headerWidened = 0;
  const packed = new Map<LayoutNode, Arrangement>();
  for (let i = normalised.order.length - 1; i >= 0; i -= 1) {
    const node = normalised.order[i];
    if (node?.role !== 'zone') continue;
    const { arrangement, widened } = packZone(node, options, gutters, arrangements);
    packed.set(node, arrangement);
    if (widened) headerWidened += 1;
  }
  const canvasWidening = reservedFor(gutters, null);
  const margin = sizing.canvasMargin + (canvasWidening.ring ?? 0);
  const sides = sidesOf(canvasWidening);
  const margins: Insets = {
    top: margin + sides.top,
    right: margin + sides.right,
    bottom: margin + sides.bottom,
    left: margin + sides.left,
  };
  if (options.packPolicy.byHeight === true) reorderByHeight(normalised.roots);
  const content = packChildren(
    normalised.roots,
    { aspect: options.rootAspect, tolerance: options.aspectTolerance },
    gapsOf(sizing, canvasWidening),
    pinnedOf(arrangements, null, normalised.roots),
    canvasWidening.gaps,
    options.packPolicy,
  );
  place(normalised.roots, margins.left, margins.top);
  return {
    arrangements: packed,
    canvas: content.arrangement,
    bounds: {
      x: 0,
      y: 0,
      width: content.width + margins.left + margins.right,
      height: content.height + margins.top + margins.bottom,
    },
    margins,
    gutters,
    headerWidened,
    truncatedLabels: sizingCounts.truncatedLabels,
    cappedTitles: sizingCounts.cappedTitles,
  };
}

/** A placement's arrangements in the shape of `LayoutOptions.arrangements` (to pin them). */
function pinnedArrangements(placement: Placement): ResolvedOptions['arrangements'] {
  const zones = Object.create(null) as Record<string, Arrangement>;
  for (const [node, arrangement] of placement.arrangements) zones[node.id] = arrangement;
  return { canvas: placement.canvas, zones };
}

/** The obstacles a route must not cross: every solid rect (card, chip, empty zone) and every zone header. */
function obstaclesOf(order: readonly LayoutNode[]): ObstacleIndex {
  const obstacles: Obstacle[] = [];
  for (const node of order) {
    const header = node.role === 'zone';
    obstacles.push({
      id: node.id,
      header,
      x: node.x,
      y: node.y,
      width: node.width,
      height: header ? node.headerHeight : node.height,
    });
  }
  return new ObstacleIndex(obstacles);
}

/**
 * Stages 1–3 of a Scene as the router sees them (tests of stages 4–5; not part of the public API): the placed
 * tree for `buildGutters`.
 */
export function placedTree(
  scene: Scene,
  options: LayoutOptions = {},
): PlacedTree & { normalised: NormalisedScene } {
  const resolved = resolveOptions(options);
  const normalised = normaliseScene(scene);
  const placement = placeTree(normalised, resolved, resolved.gutters, resolved.arrangements);
  return {
    normalised,
    order: normalised.order,
    roots: normalised.roots,
    arrangements: placement.arrangements,
    canvasArrangement: placement.canvas,
    bounds: placement.bounds,
    margins: placement.margins,
  };
}

/** Test hooks, not part of the public API. */
export interface LayoutInternals {
  /** False routes every edge by the coarse-grid fallback instead of the gutter network. */
  readonly network?: boolean;
  /** How zone rows may be built (`measure --packing` compares them); default `DEFAULT_PACK_POLICY`. */
  readonly packing?: PackPolicy;
}

const NO_ROUTING: RoutingReport = {
  mode: 'none',
  passes: 0,
  edges: 0,
  holders: 0,
  work: 0,
  duplicatesMerged: 0,
  reciprocalMerged: 0,
  bundles: 0,
  bundledEdges: 0,
  dropped: 0,
  fallbacks: 0,
  failed: 0,
  bends: [],
  maxLanes: 0,
  widened: 0,
  wideningRounds: 0,
  squeezed: 0,
  overlaps: 0,
};

/** Lays out a Scene: absolute rects for every zone, chip and card, and the routed edges. */
export function layoutScene(scene: Scene, options: LayoutOptions = {}): Layout {
  return drain(layoutSteps(scene, options));
}

/** `layoutScene` with test hooks. */
export function layoutSceneWith(scene: Scene, options: LayoutOptions, internals: LayoutInternals): Layout {
  return drain(layoutSteps(scene, options, internals));
}

/**
 * `layoutScene` in steps: a generator that yields a {@link LayoutProgress} after each stage and
 * every `ROUTE_STEP` edges of a routing pass, and returns the Layout. Nothing is shared between two
 * generators, so a host may drop one at any step (the layout worker does, for a superseded request) or
 * interleave several. Driven to completion it computes exactly what `layoutScene` does (which drains it).
 * Option and Scene errors are thrown by the first `next()`. With a `clock`, `report.timings` include the
 * time the host spent between steps.
 */
export function* layoutSteps(
  scene: Scene,
  options: LayoutOptions = {},
  internals: LayoutInternals = {},
): Generator<LayoutProgress, Layout, undefined> {
  const clock = options.clock;
  const t0 = clock?.() ?? 0;
  const resolved: ResolvedOptions = {
    ...resolveOptions(options),
    ...(internals.packing === undefined ? {} : { packPolicy: internals.packing }),
  };

  // Stage 1: forest normalisation.
  const normalised = normaliseScene(scene);
  const t1 = clock?.() ?? 0;
  yield { stage: 'normalise', pass: 0, routed: 0, edges: 0 };

  // Stages 2–3: sizing and packing.
  let t2 = t1;
  let placement = yield* placeTreeSteps(normalised, resolved, resolved.gutters, resolved.arrangements, () => {
    t2 = clock?.() ?? 0;
  });
  const t3 = clock?.() ?? 0;
  yield { stage: 'pack', pass: 0, routed: 0, edges: 0 };

  // Stages 4–5: gutters and routing, in one or three passes.
  let edges: Record<string, EdgePath> = Object.create(null) as Record<string, EdgePath>;
  let routingReport = NO_ROUTING;
  const extraWarnings: string[] = [];
  if (resolved.route && scene.edges.length > 0) {
    const nodes = new Map(normalised.order.map((node) => [node.id, node] as const));
    const merged = mergeEdges(scene, nodes);
    // Single-pass mode is decided by the first pass's search work (route.ts: it switches to the weighted search
    // once its work reaches `singlePassWork`, and is then final); the number of widening rounds by that work
    // and the lane holders (an edge of its own, or a hub bundle once: its members share their lanes).
    let single = false;
    let holders = 0;
    let work = 0;
    const edgeCount = merged.edges.length;
    const pass = (current: Placement, previous: Pass | undefined, number: number) =>
      routePassSteps(
        {
          edges: merged.edges,
          gutters: buildGutters({
            order: normalised.order,
            roots: normalised.roots,
            arrangements: current.arrangements,
            canvasArrangement: current.canvas,
            bounds: current.bounds,
            margins: current.margins,
          }),
          routing: resolved.routing,
          bounds: current.bounds,
          obstacles: () => obstaclesOf(normalised.order),
          useNetwork: internals.network ?? true,
          ...(previous === undefined ? {} : { previous }),
        },
        number,
      );
    let final: Pass | undefined;
    let widened = 0;
    let rounds = 0;
    if (edgeCount > 0) {
      final = yield* pass(placement, undefined, 1);
      yield { stage: 'route', pass: 1, routed: edgeCount, edges: edgeCount };
      holders = final.holders;
      work = final.work;
      single = final.single;
      if (!single) {
        // Route (search every edge); widen the gutters whose lanes do not fit and re-pack with the arrangements
        // pinned; re-route by laying the routes onto the widened gutters (searching again only an edge whose
        // gutters no longer line up). A round runs only while some lanes do not fit, `wideningRounds` (3) at
        // most: the second widens what the first re-route still needed. A large layout runs two at most, and one
        // whose first pass was close to the single-pass budget one (the band between `oneRoundWork` and
        // `singlePassWork`), so its rounds stay within the time the first pass left.
        const pinned = pinnedArrangements(placement);
        const total = new Map<number, Widening>();
        const { wideningRounds, lateRoundsUpTo, oneRoundWork } = resolved.routing;
        const maxRounds =
          work > oneRoundWork
            ? Math.min(1, wideningRounds)
            : holders > lateRoundsUpTo
              ? Math.min(2, wideningRounds)
              : wideningRounds;
        for (let round = 0; round < maxRounds; round += 1) {
          const widening = wideningOf(final, resolved.routing);
          if (widening.size === 0) break;
          accumulate(total, widening);
          widened = total.size;
          const gutters = addWidening(resolved.gutters, total, final.gutters);
          placement = placeTree(normalised, resolved, gutters, pinned);
          yield { stage: 'widen', pass: round + 2, routed: 0, edges: edgeCount };
          final = yield* pass(placement, final, round + 2);
          yield { stage: 'route', pass: round + 2, routed: edgeCount, edges: edgeCount };
          rounds = round + 1;
        }
      }
    }
    const paths = final === undefined ? undefined : pathsOf(final, resolved.routing);
    if (paths !== undefined) edges = paths.edges;
    if (paths !== undefined && paths.fallbacks > 0) {
      extraWarnings.push(
        `${String(paths.fallbacks)} edge(s) found no gutter path and were routed over the coarse grid: ${paths.fallbackIds.join(', ')}`,
      );
    }
    if (paths !== undefined && paths.failed > 0) {
      extraWarnings.push(`${String(paths.failed)} edge(s) could not be routed around every card and header`);
    }
    if (paths !== undefined && paths.squeezed > 0) {
      extraWarnings.push(
        single
          ? `single-pass mode (the first pass's search work reached ${String(resolved.routing.singlePassWork)} states): ${String(paths.squeezed)} gutter line(s) carry more lanes than they fit and are squeezed closer than ${String(resolved.routing.lanePitch)} px`
          : `${String(paths.squeezed)} gutter line(s) carry more lanes than they fit after widening and are squeezed closer than ${String(resolved.routing.lanePitch)} px`,
      );
    }
    if (paths !== undefined && paths.overlaps > 0) {
      extraWarnings.push(
        `${String(paths.overlaps)} edge(s) run alongside another edge where no lane was clear`,
      );
    }
    routingReport = {
      mode: merged.edges.length === 0 ? 'none' : single ? 'single-pass' : 'three-pass',
      passes: final === undefined ? 0 : rounds + 1,
      edges: merged.edges.length,
      holders,
      work,
      duplicatesMerged: merged.duplicatesMerged,
      reciprocalMerged: merged.reciprocalMerged,
      bundles: final?.bundles ?? 0,
      bundledEdges: final?.bundled ?? 0,
      dropped: merged.dropped,
      fallbacks: paths?.fallbacks ?? 0,
      failed: paths?.failed ?? 0,
      bends: paths?.bends ?? [],
      maxLanes: final?.maxLanes ?? 0,
      widened,
      wideningRounds: rounds,
      squeezed: paths?.squeezed ?? 0,
      overlaps: paths?.overlaps ?? 0,
    };
  }
  const t4 = clock?.() ?? 0;

  // Prototype-free records: a node id such as `__proto__` is an ordinary key here.
  const rects = Object.create(null) as Record<string, LayoutRect>;
  const zoneArrangements = Object.create(null) as Record<string, Arrangement>;
  const chips: string[] = [];
  const counts = { zones: 0, chips: 0, emptyZones: 0, cards: 0, maxDepth: 0 };
  for (const node of normalised.order) {
    rects[node.id] = rectOf(node);
    const arrangement = placement.arrangements.get(node);
    if (arrangement !== undefined) zoneArrangements[node.id] = arrangement;
    counts.maxDepth = Math.max(counts.maxDepth, node.depth);
    if (node.role === 'zone') counts.zones += 1;
    else if (node.role === 'chip') {
      counts.chips += 1;
      chips.push(node.id);
    } else if (node.role === 'empty') counts.emptyZones += 1;
    else counts.cards += 1;
  }

  const warnings: string[] = [];
  for (const id of normalised.droppedOrganisations) {
    warnings.push(`organisation zone ${id} dropped: the canvas is the organisation`);
  }
  if (normalised.edgesAtCanvas > 0) {
    warnings.push(
      `${String(normalised.edgesAtCanvas)} edge(s) end at a dropped organisation zone (the canvas) and cannot be routed`,
    );
  }
  warnings.push(...extraWarnings);
  // Sorted in code-point order: the report is byte-identical whatever the order of the Scene's children and
  // edges.
  warnings.sort(compareCodePoints);

  const report: LayoutReport = {
    ...(clock === undefined
      ? {}
      : {
          timings: {
            normalise: t1 - t0,
            size: t2 - t1,
            pack: t3 - t2,
            route: t4 - t3,
            total: clock() - t0,
          } satisfies StageTimings,
        }),
    counts: {
      rects: normalised.order.length,
      zones: counts.zones,
      chips: counts.chips,
      emptyZones: counts.emptyZones,
      cards: counts.cards,
      edges: normalised.edgeCount,
      maxDepth: counts.maxDepth,
      organisationZonesDropped: normalised.droppedOrganisations.length,
      truncatedLabels: placement.truncatedLabels,
      cappedTitles: placement.cappedTitles,
      headerWidened: placement.headerWidened,
    },
    routing: routingReport,
    warnings,
  };

  return {
    rects,
    edges,
    chips,
    bounds: placement.bounds,
    arrangements: { canvas: placement.canvas, zones: zoneArrangements },
    gutters: normalisedGutters(placement.gutters, normalised.order),
    report,
  };
}

/** The reservations a placement used, with only containers that exist and fields that are not zero. */
function normalisedGutters(gutters: GutterReservations, order: readonly LayoutNode[]): GutterReservations {
  const list = (values: readonly number[] | undefined): number[] | undefined =>
    values !== undefined && values.some((value) => value !== 0) ? [...values] : undefined;
  const clean = (widening: GutterWidening | undefined): GutterWidening => {
    const result: {
      horizontal?: number;
      vertical?: number;
      ring?: number;
      ringSides?: { top?: number; right?: number; bottom?: number; left?: number };
      gaps?: { cardColumns?: number[]; zoneColumns?: number[][]; rows?: number[]; stacks?: number[][][] };
    } = {};
    for (const key of ['horizontal', 'vertical', 'ring'] as const) {
      const value = widening?.[key] ?? 0;
      if (value !== 0) result[key] = value;
    }
    const sides: { top?: number; right?: number; bottom?: number; left?: number } = {};
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const value = widening?.ringSides?.[side] ?? 0;
      if (value !== 0) sides[side] = value;
    }
    if (Object.keys(sides).length > 0) result.ringSides = sides;
    const cardColumns = list(widening?.gaps?.cardColumns);
    const rows = list(widening?.gaps?.rows);
    const zoneColumns = widening?.gaps?.zoneColumns?.some((row) => row.some((value) => value !== 0))
      ? widening.gaps.zoneColumns.map((row) => [...row])
      : undefined;
    const stacks = widening?.gaps?.stacks?.some((row) =>
      row.some((cell) => cell.some((value) => value !== 0)),
    )
      ? widening.gaps.stacks.map((row) => row.map((cell) => [...cell]))
      : undefined;
    if (
      cardColumns !== undefined ||
      rows !== undefined ||
      zoneColumns !== undefined ||
      stacks !== undefined
    ) {
      result.gaps = {
        ...(cardColumns === undefined ? {} : { cardColumns }),
        ...(zoneColumns === undefined ? {} : { zoneColumns }),
        ...(rows === undefined ? {} : { rows }),
        ...(stacks === undefined ? {} : { stacks }),
      };
    }
    return result;
  };
  const zones = Object.create(null) as Record<string, GutterWidening>;
  for (const node of order) {
    if (node.role !== 'zone') continue;
    const entry = clean(reservedFor(gutters, node.id));
    if (Object.keys(entry).length > 0) zones[node.id] = entry;
  }
  const canvas = clean(gutters.canvas);
  return {
    ...(Object.keys(canvas).length > 0 ? { canvas } : {}),
    ...(Object.keys(zones).length > 0 ? { zones } : {}),
  };
}
