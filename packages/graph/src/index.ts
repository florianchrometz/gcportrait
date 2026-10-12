// SPDX-License-Identifier: MIT
/**
 * @gcportrait/graph — Snapshot + asset catalog → Graph (docs/packages.md): the containment forest, relation
 * edges with dangling references, aliases, indexes, Shared VPC derivation, and the timeline diff; and Graph +
 * ViewSpec → Scene (docs/lenses-and-filters.md): drill-in, focus views, lenses, filters and detail levels.
 * Pure: no I/O, no clock, no randomness, no DOM; runs in the browser, in workers and in Node. This file is the
 * package's only public surface.
 */
export { buildGraph, buildGraphWithReport, type BuildOptions, type SnapshotAssets } from './build.js';
export { BuildMemo } from './memo.js';
export { diffSnapshots } from './diff.js';
export { compareTimestamps } from './timestamps.js';
export {
  FOLDER_TYPE,
  ORGANIZATION_TYPE,
  PROJECT_TYPE,
  REGION_TYPE,
  SERVICE_ACCOUNT_TYPE,
  VIRTUAL_SERVICE,
  ZONE_TYPE,
  isVirtualNode,
  projectNodeId,
} from './structure.js';
export {
  buildPreparedScene,
  buildScene,
  buildSceneWithReport,
  prepareView,
  preparedViewKey,
  type PreparedView,
} from './views/scene.js';
export {
  BUNDLE_ID_PREFIX,
  BUNDLE_SIZE,
  BUNDLE_THRESHOLD,
  DEFAULT_VIEWPORT_BUDGET,
  GENERIC_ICON,
  NEVER_COLLAPSE_RECTS,
  viewportBudget,
} from './views/constants.js';
export { DETAIL_LEVELS, ZONE_OPENS_AT, autoCeiling, autoDetailLevel, zoneOpensAt } from './views/detail.js';
export { flipIdOf } from './views/flip.js';
