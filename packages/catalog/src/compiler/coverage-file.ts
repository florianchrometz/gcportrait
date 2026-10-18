// SPDX-License-Identifier: Apache-2.0
/**
 * The coverage data the website renders (`packages/catalog/dist/coverage.json`, written by `pnpm catalog:build`
 * next to the compiled catalog): the official list's date and total, and per authoring group the types it owns,
 * the mapped ones by role and the unmapped ones with their reasons — what the coverage page and the landing
 * page's numbers read, and no more of the report that `pnpm catalog:coverage --json` prints. One definition of
 * the file's shape, here in the package that writes it, so the site neither spawns a command nor re-declares it.
 * Unmapped types are sorted by type, so the file reads as the page shows it and two builds of one catalog agree.
 */
import type { CoverageReport, RoleCounts } from './types.js';

/** An official type the catalog does not map, and why. */
export interface CatalogCoverageUnmapped {
  readonly type: string;
  readonly reason: string;
}

/** One authoring group's coverage, as the website's coverage table rows read it. */
export interface CatalogCoverageGroup {
  readonly group: string;
  readonly title: string;
  readonly official: number;
  readonly mapped: RoleCounts & { readonly total: number };
  readonly unmapped: readonly CatalogCoverageUnmapped[];
  readonly coveragePercent: number;
}

/** `dist/coverage.json`: the coverage of the catalog as it was built. */
export interface CatalogCoverage {
  readonly officialDate: string;
  readonly officialTotal: number;
  readonly groups: readonly CatalogCoverageGroup[];
}

/** The website's coverage data from a compiled report. */
export function catalogCoverage(report: CoverageReport): CatalogCoverage {
  return {
    officialDate: report.officialList.date,
    officialTotal: report.officialList.total,
    groups: report.groups.map((group) => ({
      group: group.group,
      title: group.title,
      official: group.official,
      mapped: group.mapped,
      unmapped: Object.entries(group.unmapped.types)
        .map(([type, reason]) => ({ type, reason }))
        .sort((a, b) => (a.type < b.type ? -1 : 1)),
      coveragePercent: group.coveragePercent,
    })),
  };
}
