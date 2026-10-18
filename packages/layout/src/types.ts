// SPDX-License-Identifier: MIT
/**
 * The layout's output and options. Plain, serialisable data (no Map, Set or class instance) so a Layout
 * survives `postMessage` from the layout worker and JSON unchanged. Every coordinate is in px at scale 1 in
 * the canvas's coordinate system: the canvas (the organisation, or the drill-in root) spans `bounds`.
 */
import type { EdgePath, Insets, LayoutRect, LayoutReport, Rect } from '@gcportrait/model';
import type { Routing, Sizing } from './constants.js';
import type { FontMetricsTable } from './metrics.js';

export type {
  EdgeBundle,
  EdgeHeads,
  EdgePath,
  EdgePort,
  Insets,
  LayoutCounts,
  LayoutRect,
  LayoutReport,
  Point,
  Rect,
  RectRole,
  RoutingReport,
  Side,
  StageTimings,
} from '@gcportrait/model';

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
