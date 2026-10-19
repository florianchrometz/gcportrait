// SPDX-License-Identifier: Apache-2.0
/**
 * @gcportrait/demo-data — deterministic synthetic Google Cloud organisations in four sizes, with a 35-day
 * history, as Cloud Asset Inventory records or as `@gcportrait/model` Snapshots. The guard that keeps real
 * organisation data out of fixtures lives in `@gcportrait/model/testing`. This file is the package's only
 * public surface.
 */
export {
  DEFAULT_SEED,
  DEMO_ORGANIZATION_DOMAIN,
  DEMO_ORGANIZATION_IDS,
  DEMO_SIZES,
  DEMO_TODAY,
  HISTORY_TICKS,
} from './constants.js';
export { generateOrganization, historyFor, type GenerateOptions } from './generate.js';
export { snapshotAt } from './history/replay.js';
export type { DemoHistory, DemoOrganization, HistoryTick, Mutation } from './history/types.js';
export { toCaiAsset, toCaiNdjson, type CaiAsset, type CaiKeyStyle, type CaiResource } from './output/cai.js';
export { computeStats, toSnapshot, type AssetStats } from './output/snapshot.js';
export { checklistMarkdown, realismChecklist, type ChecklistRow } from './report/checklist.js';
