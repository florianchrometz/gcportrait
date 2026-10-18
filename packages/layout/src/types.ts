// SPDX-License-Identifier: Apache-2.0
/**
 * The layout's output and options. Plain, serialisable data (no Map, Set or class instance) so a Layout
 * survives `postMessage` from the layout worker and JSON unchanged. Every coordinate is in px at scale 1 in
 * the canvas's coordinate system: the canvas (the organisation, or the drill-in root) spans `bounds`.
 */
import type { LayoutWorkerOptions } from '@gcportrait/model';

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
  LayoutWorkerOptions,
  Point,
  Rect,
  RectRole,
  RoutingReport,
  Side,
  StageTimings,
} from '@gcportrait/model';

export interface LayoutOptions extends LayoutWorkerOptions {
  /**
   * A millisecond clock for `report.timings` (e.g. `performance.now`). The layout itself reads no clock, so
   * without one the output is byte-identical across runs.
   */
  readonly clock?: () => number;
}
