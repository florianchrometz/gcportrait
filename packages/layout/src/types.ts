// SPDX-License-Identifier: MIT
/**
 * The layout's output and options. Plain, serialisable data (no Map, Set or class instance) so a Layout
 * survives `postMessage` from the layout worker and JSON unchanged. Every coordinate is in px at scale 1 in
 * the canvas's coordinate system: the canvas (the organisation, or the drill-in root) spans `bounds`.
 */
import type {
  Arrangement,
  Arrangements,
  EdgePath,
  GutterReservations,
  LayoutRect,
  LayoutReport,
  Rect,
} from '@gcportrait/model';
import type { Routing, Sizing } from './constants.js';
import type { FontMetricsTable } from './metrics.js';

export type {
  Arrangement,
  Arrangements,
  EdgeBundle,
  EdgeHeads,
  EdgePath,
  EdgePort,
  GapWidening,
  GutterReservations,
  GutterWidening,
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
