// SPDX-License-Identifier: MIT
/**
 * Scoped checks (`pnpm catalog:check --group <group>` and `--file <path>`): the full catalog is still compiled,
 * because rules prove themselves against fixtures of other types and duplicates only show across files, but
 * the report keeps only the problems blamed on the selected files, so an author gets a clean signal while other
 * groups are mid-edit. The compiler blames every problem on the file that has to change, so a problem blamed
 * on another group's file that names a selected one as related (a copy of your type, your type mapped in their
 * file) is listed as a note and does not fail the check: the other group fixes it. Pure.
 */
import type { CoverageReport, TypeTrace, Violation } from './types.js';

export interface Scope {
  /** Group file stems (`networking-fabric`): the group file, its product files and its fixtures. */
  readonly groups: readonly string[];
  /** Files relative to the catalog root (`products/dns.googleapis.com.yaml`). */
  readonly files: readonly string[];
}

export interface ScopedResult {
  readonly report: CoverageReport;
  readonly trace?: readonly TypeTrace[];
  /** Every file the selection covers, sorted. */
  readonly files: readonly string[];
  /** Violations left out because they are blamed on no selected file (the notes among them included). */
  readonly outside: number;
  /** Violations blamed on a file outside the selection that name a selected file as related: notes, not failures. */
  readonly related: readonly Violation[];
}

/** Why a selection cannot be applied: a group or file that does not exist. */
export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

const FIXTURE_TYPE = /^fixtures\/([^/]+)\/([^/]+)\.json$/;

function blamedOn(violation: Violation, files: ReadonlySet<string>): boolean {
  return violation.file !== undefined && files.has(violation.file);
}

function names(violation: Violation, files: ReadonlySet<string>): boolean {
  return (violation.related ?? []).some((file) => files.has(file));
}

/**
 * The report restricted to a selection. `knownFiles` are the paths of every data file there is (also those
 * that did not parse), so a misspelt `--file` or `--group` fails instead of selecting nothing.
 */
export function scopeReport(
  report: CoverageReport,
  scope: Scope,
  knownFiles: ReadonlySet<string>,
  trace?: readonly TypeTrace[],
): ScopedResult {
  const files = new Set<string>();
  const byStem = new Map(report.groups.map((group) => [group.group, group]));
  for (const stem of scope.groups) {
    const group = byStem.get(stem);
    const groupFile = `known-unmapped/${stem}.yaml`;
    if (group === undefined && knownFiles.has(groupFile)) {
      // The group file itself does not parse (mid-edit): its own problems are all there is to show.
      files.add(groupFile);
      continue;
    }
    if (group === undefined) {
      throw new ScopeError(
        `no group ${stem}; the groups are: ${report.groups.map((g) => g.group).join(', ') || '(none)'}`,
      );
    }
    for (const file of [group.file, ...group.productFiles, ...group.fixtureFiles]) files.add(file);
  }
  for (const file of scope.files) {
    if (!knownFiles.has(file)) throw new ScopeError(`no catalog file ${file}`);
    files.add(file);
  }
  const selectedGroups = new Set(scope.groups);
  const groups = report.groups.filter(
    (group) =>
      selectedGroups.has(group.group) ||
      [group.file, ...group.productFiles, ...group.fixtureFiles].some((file) => scope.files.includes(file)),
  );
  const violations = report.violations.filter((violation) => blamedOn(violation, files));
  const related = report.violations.filter(
    (violation) => !blamedOn(violation, files) && names(violation, files),
  );
  const fixtureTypes = new Set(
    [...files].flatMap((file) => {
      const match = FIXTURE_TYPE.exec(file);
      return match === null ? [] : [`${match[1] ?? ''}/${match[2] ?? ''}`];
    }),
  );
  return {
    report: {
      ...report,
      groups,
      violations,
      warnings: report.warnings.filter((warning) => blamedOn(warning, files)),
    },
    ...(trace === undefined
      ? {}
      : { trace: trace.filter((entry) => files.has(entry.file) || fixtureTypes.has(entry.assetType)) }),
    files: [...files].sort(),
    outside: report.violations.length - violations.length,
    related,
  };
}
