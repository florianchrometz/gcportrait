// SPDX-License-Identifier: MIT
/**
 * The layout's output and options. Plain, serialisable data (no Map, Set or class instance) so a Layout
 * survives `postMessage` from the layout worker and JSON unchanged. Every coordinate is in px at scale 1 in
 * the canvas's coordinate system: the canvas (the organisation, or the drill-in root) spans `bounds`.
 */
import type { RelationKind, ZoneKind } from '@gcportrait/model';
import type { Routing, Sizing } from './constants.js';
import type { FontMetricsTable } from './metrics.js';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A length per side of a rect. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * How a Scene node is drawn:
 * - `zone`: an open zone with a header band and children inside its padding;
 * - `chip`: a collapsed zone, a fixed-size chip in the zone's tint;
 * - `empty`: a zone with no children in the Scene, drawn card-sized with its icon (skill §2 rule 4);
 * - `card`: a resource card.
 * Chips, empty zones and cards are solid: nothing is drawn inside them and no edge crosses them.
 */
export type RectRole = 'zone' | 'chip' | 'empty' | 'card';

export interface LayoutRect extends Rect {
  /** The parent zone's id; `null` for the top level (the canvas). */
  readonly parent: string | null;
  readonly role: RectRole;
  /** The zone kind (zones, chips and empty zones) or `card`. */
  readonly kind: ZoneKind | 'card';
  /** Depth from the canvas: the canvas is 0, so top-level zones and cards are 1. */
  readonly depth: number;
  /** Height of the header band at the top of an open zone; 0 for chips, empty zones and cards. */
  readonly headerHeight: number;
  /** The open zone's inner padding ring (including any uniform `ring` reservation); 0 otherwise. */
  readonly padding: number;
  /**
   * Extra padding on single sides of an open zone (the router's lane space, `GutterWidening.ringSides`), on top
   * of `padding`; absent when there is none. The children lie inside `padding` + `paddingExtra` on each side;
   * the header is unaffected (a folder's title still starts `padding` from the left).
   */
  readonly paddingExtra?: Insets;
  /** True for a chip (a collapsed zone). */
  readonly collapsed: boolean;
}

/** A side of a rect. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** Where an edge meets one of its rects: a point on that rect's border and the side it lies on. */
export interface EdgePort extends Point {
  readonly side: Side;
}

/**
 * Which ends of an edge carry an arrowhead, from the relation kind's default style (`RELATION_KINDS` in
 * `@gcportrait/model`): `both` for a double-headed (symmetric) kind such as `peers`, `none` for a kind drawn
 * with round caps (`connects`), `end` otherwise.
 */
export type EdgeHeads = 'end' | 'both' | 'none';

/**
 * A routed edge (stage 5): an orthogonal polyline through the gutters. `points` run from the source end to
 * the target end; an end with an arrowhead stops at the head's tip, `Routing.arrowInset` (2 px) inside the
 * rect's border, an end without one at its port. Every segment is horizontal or vertical; the renderer rounds
 * each elbow with `elbowRadius`, at most half the shorter of its two segments and, next to an arrowhead, at
 * most what the end segment leaves beside the head (the end segment can be as short as the gutter allows,
 * e.g. 10 px in a 16 px padding ring, shorter than a 9 px head plus the radius): the head sits on a straight
 * stretch.
 */
export interface EdgePath {
  readonly from: string;
  readonly to: string;
  readonly kind: RelationKind;
  /** How many Scene relations the edge stands for (merged duplicates, re-targeted ends); at least 1. */
  readonly count: number;
  /** Whether the Scene marked an end re-targeted to a chip or the layout merged several Scene edges into it. */
  readonly merged: boolean;
  readonly heads: EdgeHeads;
  /** The port on the border of `from`'s rect. */
  readonly source: EdgePort;
  /** The port on the border of `to`'s rect. */
  readonly target: EdgePort;
  readonly points: readonly Point[];
  /** Radius of the rounded elbows; 0 when the path is straight. */
  readonly elbowRadius: number;
  /** True when no gutter path existed and the coarse-grid fallback routed the edge (should never happen). */
  readonly fallback: boolean;
  /**
   * The hub bundle the edge belongs to; absent for an edge of its own. Its members share the port at the
   * bundle's end (`end`), and lanes towards it: where their points coincide they are one trunk, so the renderer
   * draws a member's dashes from that shared end (the dash patterns then coincide along the trunk) and its
   * shared arrowhead once.
   */
  readonly bundle?: EdgeBundle;
}

/**
 * A hub's bundle (skill gcp-diagram-layout §5, ports): the edges of one kind that meet one rect at the same end
 * (all as targets, or all as sources) and from the same side, sharing that end's port and their lanes towards it.
 */
export interface EdgeBundle {
  /**
   * Unique per bundle: `<rect id> <-<kind>- * (<side>)` for a shared target, `<rect id> -<kind>-> * (<side>)` for
   * a shared source (`<side>, inside` for a port on the inside of a zone that contains the other ends; a `#2`, …
   * suffix in the rare case of two bundles of one kind on one side).
   */
  readonly id: string;
  /** The end the members share. */
  readonly end: 'source' | 'target';
  /** How many edges the bundle holds. */
  readonly size: number;
}

export interface StageTimings {
  readonly normalise: number;
  /** Stage 2 of the first pass. */
  readonly size: number;
  /** Stage 3 of the first pass. */
  readonly pack: number;
  /** Stages 4–5: gutter networks, routing, and the widening re-pack between the passes. */
  readonly route: number;
  readonly total: number;
}

export interface LayoutCounts {
  /** Every rect: zones, chips, empty zones and cards. */
  readonly rects: number;
  readonly zones: number;
  readonly chips: number;
  readonly emptyZones: number;
  readonly cards: number;
  /** Edges in the Scene (before merging; `report.routing` says what became of them). */
  readonly edges: number;
  /** The deepest rect's depth (0 for an empty canvas). */
  readonly maxDepth: number;
  /** Organisation zones unwrapped because the canvas is the organisation (normally 0: the Scene omits it). */
  readonly organisationZonesDropped: number;
  /**
   * Cards, empty zones and chips whose text is wider than their widest box (the renderer ellipsises it).
   */
  readonly truncatedLabels: number;
  /**
   * Open zones whose title is wider than `Sizing.zoneTitleMaxWidth`: the zone is no wider for it and the
   * renderer ellipsises the title (the full label stays in the Scene).
   */
  readonly cappedTitles: number;
  /** Open zones made wider than their children by their header (title, id and badges). */
  readonly headerWidened: number;
}

/**
 * What stages 4–5 did. `mode` is the policy: `three-pass` (route; widen the gutters whose lanes do not fit and
 * re-pack; re-route, keeping lanes inside the widened gutters: the second and third passes run only when some
 * gutter is too narrow, see `passes`), `single-pass` (the first pass's search work reached
 * `Routing.singlePassWork`: the rest of it was searched weighted, one routing pass, no widening), or `none`
 * (nothing to route, or `LayoutOptions.route` is false).
 */
export interface RoutingReport {
  readonly mode: 'none' | 'single-pass' | 'three-pass';
  /** Routing passes run: 1, or 2 when a widening round re-packed and re-routed (more only with `wideningRounds`). */
  readonly passes: number;
  /** Routed edges: `Layout.edges`. */
  readonly edges: number;
  /**
   * Lane holders: the edges routed on their own plus the hub bundles (whose members share lanes). Above
   * `Routing.lateRoundsUpTo` of them at most two widening rounds run.
   */
  readonly holders: number;
  /**
   * The first routing pass's search work: the A* states it settled. Single-pass mode starts where it reaches
   * `Routing.singlePassWork`; above `Routing.oneRoundWork` one widening round runs at most (skill §5).
   */
  readonly work: number;
  /**
   * Scene edges folded into another one with the same ends and kind (their count is added to it), the second
   * edge of a reciprocal pair included.
   */
  readonly duplicatesMerged: number;
  /** Reciprocal pairs of a symmetric kind (`peers`) merged into one double-headed edge. */
  readonly reciprocalMerged: number;
  /** Hub bundles (edges sharing a port and lanes, `EdgePath.bundle`) and the edges in them. */
  readonly bundles: number;
  readonly bundledEdges: number;
  /** Scene edges not drawn: an end at a dropped organisation zone (the canvas), or both ends in one chip. */
  readonly dropped: number;
  /** Edges the coarse-grid fallback routed because no gutter path existed (0 unless something is wrong). */
  readonly fallbacks: number;
  /** Edges not even the fallback could route (drawn as a plain orthogonal line; 0 unless something is wrong). */
  readonly failed: number;
  /** Edges by number of bends: `bends[k]` edges have k elbows. */
  readonly bends: readonly number[];
  /** The most lanes any gutter line carries (the highest lane used + 1). */
  readonly maxLanes: number;
  /** Containers (the canvas or open zones) whose gutters the widening passes made wider. */
  readonly widened: number;
  /**
   * Widen-and-re-route rounds run after the first route (0: nothing needed widening, or single-pass mode):
   * the three passes (route, widen and re-pack, re-route) are one round (`Routing.wideningRounds`, default 1,
   * at most).
   */
  readonly wideningRounds: number;
  /** Gutter lines whose lanes did not fit their width in the final pass and were squeezed closer. */
  readonly squeezed: number;
  /**
   * Edges with a stretch that runs alongside another edge (closer than the lane pitch) because no lane was clear
   * there; 0 unless something is wrong. Members of one bundle share lanes and do not count.
   */
  readonly overlaps: number;
}

export interface LayoutReport {
  /** Milliseconds per stage, present only when `LayoutOptions.clock` is given (the layout reads no clock). */
  readonly timings?: StageTimings;
  readonly counts: LayoutCounts;
  readonly routing: RoutingReport;
  /**
   * Human-readable notes about the input, sorted in code-point order (so reordering the Scene's children or
   * edges gives a byte-identical report).
   */
  readonly warnings: readonly string[];
}

/**
 * How a container's children are packed (stage 3): the card grid on top and the zone rows below it. A Layout
 * reports every container's arrangement, and `LayoutOptions.arrangements` can pin one (gutter routing's
 * re-pack).
 */
export interface Arrangement {
  /** Columns of the card grid; 0 when the container holds no cards. */
  readonly cardColumns: number;
  /** How many zones (open zones, chips, empty zones) each zone row holds, top to bottom; [] without zones. */
  readonly zoneRows: readonly number[];
  /**
   * The stacks of each zone row (skill §4): `zoneStacks[r]` lists, left to right, how many consecutive zones
   * each cell of row r sets one above the other (summing to `zoneRows[r]`). Absent when every cell holds one
   * zone (plain rows).
   */
  readonly zoneStacks?: readonly (readonly number[])[];
}

/** One arrangement per container: the canvas, and every open zone by id (in paint order). */
export interface Arrangements {
  readonly canvas: Arrangement;
  readonly zones: Readonly<Record<string, Arrangement>>;
}

export interface Layout {
  /**
   * One rect per Scene node, keyed by node id, in paint order: pre-order over the sorted tree, so a parent
   * always comes before its children.
   */
  readonly rects: Readonly<Record<string, LayoutRect>>;
  /**
   * Routed edges keyed by edge id (`<from> -<kind>-> <to>`), sorted by from, to and kind in code-point order.
   * One per distinct (from, to, kind) after merging; a symmetric kind's ends are ordered (`from` < `to`).
   */
  readonly edges: Readonly<Record<string, EdgePath>>;
  /** Ids of the zones drawn as chips (their rects are in `rects`), in paint order. */
  readonly chips: readonly string[];
  /** The canvas: every rect lies inside it, `canvasMargin` (plus any reserved ring) from its edge. */
  readonly bounds: Rect;
  /** How each container's children were packed. */
  readonly arrangements: Arrangements;
  /**
   * The gutter reservations the rects were packed with: the caller's (`LayoutOptions.gutters`) plus the lane
   * space the widening pass added, per container with any (zones in paint order).
   */
  readonly gutters: GutterReservations;
  readonly report: LayoutReport;
}

/** Extra space the router reserves for edge lanes in one container, added to the base sizes. */
export interface GutterWidening {
  /** Added to every column gap of the container's children. */
  readonly horizontal?: number;
  /** Added to every row gap of the container's children (and to the gap between cards and zones). */
  readonly vertical?: number;
  /** Added to the container's padding ring on all four sides (for the canvas: to its margin). */
  readonly ring?: number;
  /** Added to single sides of the padding ring (for the canvas: of its margin), on top of `ring`. */
  readonly ringSides?: Partial<Insets>;
  /**
   * Added to single gaps, on top of `horizontal` and `vertical` (the router widens only the gaps whose lanes do
   * not fit). Positional, so meant with a pinned arrangement; extras beyond the arrangement's gaps are
   * ignored, and the packer's choice of arrangement does not look at them.
   */
  readonly gaps?: GapWidening;
}

/** Extra width of single gaps of one container. */
export interface GapWidening {
  /** `cardColumns[c]`: the gap between card columns c and c + 1. */
  readonly cardColumns?: readonly number[];
  /**
   * `zoneColumns[r][i]`: the gap between cells i and i + 1 of zone row r (a cell is one zone, or a stack of
   * zones: `Arrangement.zoneStacks`).
   */
  readonly zoneColumns?: readonly (readonly number[])[];
  /** `stacks[r][c][k]`: the gap below zone k of the stack in cell c of zone row r. */
  readonly stacks?: readonly (readonly (readonly number[])[])[];
  /**
   * `rows[k]`: the gap below row k, counting the card rows first and then the zone rows (so with R card rows,
   * `rows[R − 1]` is the gap between the card block and the zone block).
   */
  readonly rows?: readonly number[];
}

/**
 * The hook through which gutter routing widens gutters and re-packs without re-implementing packing:
 * per container, extra lane space on top of the base gaps and padding: uniform (every column gap, every row
 * gap, the whole ring) or per gap (`gaps`). Wider gaps change the candidates' sizes, so a re-pack may
 * choose another arrangement; pass the first pass's `Layout.arrangements` as `LayoutOptions.arrangements` to
 * keep every row and column (and so every gutter's identity) across passes.
 */
export interface GutterReservations {
  readonly canvas?: GutterWidening;
  readonly zones?: Readonly<Record<string, GutterWidening>>;
}

export interface LayoutOptions {
  /** Theme-independent sizing overrides (defaults: `DEFAULT_SIZING`, the skill's constants). */
  readonly sizing?: Partial<Sizing>;
  /** Target aspect (width / height) of a zone's children grid. Default 1.6. */
  readonly targetAspect?: number;
  /** Target aspect of the canvas's top-level grid. Default 1.75. */
  readonly rootAspect?: number;
  /**
   * The band around the target, as a relative deviation, inside which every aspect counts as on target (and
   * the tightest arrangement in it wins). Default 0.2; at least 0, below 1.
   */
  readonly aspectTolerance?: number;
  /**
   * Arrangements to keep instead of choosing them, per container (typically a previous Layout's
   * `arrangements`, so a re-pack with wider gutters keeps every row and column). Each must fit its container's
   * children: `LayoutInputError` `invalid-option` otherwise. Containers not listed are chosen as usual.
   */
  readonly arrangements?: {
    readonly canvas?: Arrangement;
    readonly zones?: Readonly<Record<string, Arrangement>>;
  };
  /** Text metrics; default: the generated Roboto table (`metrics/roboto.json`). */
  readonly fontMetrics?: FontMetricsTable;
  /** Lane space reserved on top of the base gaps and padding; routing's widening adds to it. */
  readonly gutters?: GutterReservations;
  /** Whether to route the edges (stages 4–5). Default true; false stops after packing (`edges` empty). */
  readonly route?: boolean;
  /** Routing constant overrides (defaults: `DEFAULT_ROUTING`, the skill's constants). */
  readonly routing?: Partial<Routing>;
  /**
   * A millisecond clock for `report.timings` (e.g. `performance.now`). The layout itself reads no clock, so
   * without one the output is byte-identical across runs.
   */
  readonly clock?: () => number;
}

/**
 * The stage a layout has just completed: `normalise` (stage 1), `size` and `pack` (stages 2–3 of
 * the first placement), `route` (a stretch of a routing pass: `routed` of `edges` so far), `widen` (a widening
 * re-pack between two routing passes, before the pass it is numbered for).
 */
export type LayoutStage = 'normalise' | 'size' | 'pack' | 'route' | 'widen';

/**
 * How far a layout has got: what `layoutSteps` yields between its stages and what the layout worker posts as
 * `progress`. The worker checks for cancellation at every step.
 */
export interface LayoutProgress {
  readonly stage: LayoutStage;
  /** The routing pass (1 to 3) for `route` and `widen`; 0 before routing. */
  readonly pass: number;
  /** Edges routed so far in this pass (`route`); 0 otherwise. */
  readonly routed: number;
  /** Edges to route after merging; 0 before routing. */
  readonly edges: number;
}

/**
 * The options a layout worker request carries: every `LayoutOptions` field but `clock`, which as a
 * function cannot cross `postMessage` (the worker's own clock, if its host gives it one, fills
 * `report.timings`).
 */
export type LayoutWorkerOptions = Omit<LayoutOptions, 'clock'>;
