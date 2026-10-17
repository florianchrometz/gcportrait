// SPDX-License-Identifier: MIT
/**
 * `@gcportrait/model/testing`: helpers for tests and data tooling that the app must not ship, kept out of the
 * main entry point: the "synthetic only" guard every package runs over its fixtures and generated data
 * (AGENTS.md, Data and graph semantics), the rule for the tests' wall-clock limits every package that
 * times its work applies (budget.ts), and the property tests' seed and number of runs (seed.ts).
 * Dependency-free, and without Node imports.
 */
export {
  BATCHES,
  BATCH_TIMEOUT_SHARE,
  OVERLOAD_PER_CORE,
  PAUSE_MS,
  anotherBatchFits,
  measureBatches,
  noteSkipped,
  onCi,
  overloadReason,
  skipIfOverloaded,
  type BatchOptions,
  type Batches,
  type BudgetPlan,
  type MissedLimit,
  type OverloadContext,
} from './budget.js';
export { CI_PROPERTY_SEED, propertyRuns, propertySeed } from './seed.js';
export {
  EXAMPLE_DOMAINS,
  PLATFORM_DOMAINS,
  SYNTHETIC_IPV4_RANGES,
  SYNTHETIC_ORGANIZATION_IDS,
  SYNTHETIC_PROJECT_ID,
  assertSyntheticOnly,
  findNonSyntheticData,
  formatSyntheticFindings,
  type SyntheticFinding,
  type SyntheticFindingKind,
  type SyntheticGuardOptions,
} from './synthetic.js';
