// SPDX-License-Identifier: Apache-2.0
/**
 * @gcportrait/layout — the pure, deterministic layout engine (skill gcp-diagram-layout): a `Scene`
 * from `@gcportrait/model` becomes a `Layout` of absolute rects and routed edges. Stages 1–3 (forest
 * normalisation, sizing, packing) and 4–5 (gutters, routing) are here, and the worker protocol that runs them
 * off the UI thread with cancellation and memoisation. This file is the package's only public surface.
 */
export { layoutScene, layoutSteps, resolveOptions, type ResolvedOptions } from './layout.js';

export {
  createLayoutWorkerHandler,
  type LayoutCancelReason,
  type LayoutWorkerEnvironment,
  type LayoutWorkerErrorCode,
  type LayoutWorkerErrorInfo,
  type LayoutWorkerRequest,
  type LayoutWorkerResponse,
} from './worker.js';

export {
  LayoutCancelledError,
  LayoutClient,
  LayoutWorkerError,
  createLayoutClient,
  isLayoutCancelled,
  layoutClient,
  type AbortSignalLike,
  type LayoutCancelledReason,
  type LayoutRequestOptions,
  type LayoutResult,
  type LayoutWorkerLike,
  type MessageEventLike,
} from './client.js';

export { MAX_KEY_DEPTH, MAX_KEY_UNITS, layoutKey, structuralHash } from './hash.js';

export { LayoutMemo, MEMO_CAPACITY } from './memo.js';

export { ROUTE_STEP } from './steps.js';

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
  LayoutOptions,
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
} from './types.js';

export {
  DEFAULT_ROUTING,
  DEFAULT_SIZING,
  MAX_SCENE_DEPTH,
  ROOT_ASPECT,
  TARGET_ASPECT,
  TEXT_WEIGHTS,
  ZONE_KIND_RANK,
  ZONE_TITLE_SEPARATOR,
  type Routing,
  type Sizing,
} from './constants.js';

export {
  FONT_FACE_KEYS,
  defaultFontMetrics,
  fontFaceKey,
  measureText,
  parseFontMetricsTable,
  type FontFaceKey,
  type FontFaceMetrics,
  type FontFamily,
  type FontMetricsTable,
  type FontWeight,
  type MeasureOptions,
} from './metrics.js';

export {
  cardWidth,
  headerHeightAt,
  subtitleRuns,
  zoneTitleSizeAt,
  zoneTitleWidth,
  type TextRun,
} from './size.js';

export { CHIP_COUNT_NAMES, chipCountLine, chipWidth, type ChipText } from './chips.js';

export { compareCodePoints, compareSiblings } from './order.js';

export { LayoutInputError, type LayoutInputErrorCode } from './errors.js';

export {
  LayoutInvariantError,
  assertLayout,
  canvasContentBox,
  checkDeterminism,
  checkEdges,
  checkLayout,
  contentBox,
  type InvariantCode,
  type InvariantViolation,
} from './invariants.js';

export { packingAspects, type PackingAspect } from './aspects.js';

export { ASPECT_TOLERANCE } from './constants.js';
