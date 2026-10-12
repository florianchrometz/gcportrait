// SPDX-License-Identifier: MIT
/**
 * `@gcportrait/model/testing`: helpers for tests and data tooling that the app must not ship, kept out of the
 * main entry point. Today that is the "synthetic only" guard every package runs over its fixtures and
 * generated data (agents.md rule 6). Pure and dependency-free.
 */
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
