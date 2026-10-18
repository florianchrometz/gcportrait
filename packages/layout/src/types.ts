// SPDX-License-Identifier: MIT
/**
 * The layout's output and options. Plain, serialisable data (no Map, Set or class instance) so a Layout
 * survives `postMessage` from the layout worker and JSON unchanged. Every coordinate is in px at scale 1 in
 * the canvas's coordinate system: the canvas (the organisation, or the drill-in root) spans `bounds`.
 */
import type { Arrangement, GutterReservations } from '@gcportrait/model';
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
  Layout,
  LayoutCounts,
  LayoutProgress,
  LayoutRect,
  LayoutReport,
  LayoutStage,
  Point,
  Rect,
  RectRole,
  RoutingReport,
  Side,
  StageTimings,
} from '@gcportrait/model';

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
 * The options a layout worker request carries: every `LayoutOptions` field but `clock`, which as a
 * function cannot cross `postMessage` (the worker's own clock, if its host gives it one, fills
 * `report.timings`).
 */
export type LayoutWorkerOptions = Omit<LayoutOptions, 'clock'>;
