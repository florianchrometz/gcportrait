// SPDX-License-Identifier: MIT
/** The human-readable form of the coverage report (skill gcp-asset-catalog §8). */
import type { CoverageReport, GroupCoverage, TypeTrace, Violation } from './types.js';

/** At most this many violations of one code are listed; the rest are counted. */
const MAX_PER_CODE = 40;

function list(items: readonly string[]): string {
  return items.length === 0 ? 'none' : items.join(', ');
}

function location(violation: Violation): string {
  if (violation.file === undefined) return '';
  return violation.line === undefined
    ? `${violation.file}: `
    : `${violation.file}:${String(violation.line)}: `;
}

/** The violations grouped by code, each group capped, one per line. */
export function formatViolations(violations: readonly Violation[]): string[] {
  const byCode = new Map<string, Violation[]>();
  for (const violation of violations)
    byCode.set(violation.code, [...(byCode.get(violation.code) ?? []), violation]);
  const lines: string[] = [];
  for (const [code, group] of byCode) {
    for (const violation of group.slice(0, MAX_PER_CODE)) {
      lines.push(`  [${code}] ${location(violation)}${violation.message}`);
    }
    if (group.length > MAX_PER_CODE) {
      lines.push(`  [${code}] … and ${String(group.length - MAX_PER_CODE)} more (--json lists every one)`);
    }
  }
  return lines;
}

/** One line per group: owned official types, mapped by role, unmapped, missing and the coverage. */
export function formatGroups(groups: readonly GroupCoverage[]): string[] {
  const width = Math.max(0, ...groups.map((group) => group.group.length));
  return groups.map((group) => {
    const { mapped } = group;
    const roles = (['container', 'core', 'leaf', 'hidden'] as const)
      .filter((role) => mapped[role] > 0)
      .map((role) => `${String(mapped[role])} ${role}`);
    return (
      `    ${group.group.padEnd(width)}  ${String(group.official).padStart(3)} official · ` +
      `${String(mapped.total)} mapped${roles.length === 0 ? '' : ` (${roles.join(', ')})`} · ` +
      `${String(group.unmapped.total)} unmapped · ${String(group.missing.length)} missing · ` +
      `${group.coveragePercent.toFixed(1)} %`
    );
  });
}

/** Each group's line, then its unmapped types by reason and the types it is missing. */
export function formatGroupDetails(groups: readonly GroupCoverage[]): string[] {
  const lines = formatGroups(groups);
  return groups.flatMap((group, i) => [
    lines[i] ?? '',
    ...Object.entries(group.unmapped.byReason).map(
      ([reason, count]) => `        unmapped, ${reason}: ${String(count)}`,
    ),
    ...(group.missing.length === 0 ? [] : [`        missing: ${group.missing.join(', ')}`]),
  ]);
}

/** Every traced rule: rule → fixture value → normalised name (or what went missing). */
export function formatTrace(trace: readonly TypeTrace[]): string[] {
  const lines: string[] = [];
  for (const type of trace) {
    lines.push(`  ${type.assetType} (${type.file})`);
    for (const rule of type.rules) {
      lines.push(`    ${rule.rule}`);
      if (rule.results.length === 0) {
        lines.push(
          rule.rule.includes(' byParent ')
            ? '      (nests children by their parent or name; nothing to read from the data)'
            : '      (no value on any fixture)',
        );
      }
      for (const result of rule.results) {
        const resolved = result.resolved ?? '(nothing: dangling or not a valid value)';
        lines.push(
          rule.rule.startsWith('label ') ||
            rule.rule.startsWith('subtitle ') ||
            rule.rule.startsWith('console ')
            ? `      ${result.fixture} → ${resolved}`
            : `      ${result.fixture}: ${result.raw} → ${resolved}`,
        );
      }
    }
  }
  return lines;
}

export interface ReportExtras {
  /**
   * A `--group`/`--file` selection: what it covered, how many violations it left out, and the notes (problems
   * blamed on other files that name a selected one).
   */
  readonly scope?: {
    readonly label: string;
    readonly files: number;
    readonly outside: number;
    readonly related?: readonly Violation[];
  };
  /** `--verbose`: the rule traces, and every warning listed. */
  readonly trace?: readonly TypeTrace[];
  readonly verbose?: boolean;
}

/** The report as text lines, ending with OK or the violations; a scoped report shows only its groups. */
export function formatReport(report: CoverageReport, extras: ReportExtras = {}): string[] {
  const { officialList } = report;
  const { scope } = extras;
  const lines =
    scope === undefined
      ? wholeReport(report)
      : [
          `catalog:check: official list ${officialList.date} (${String(officialList.total)} types, ${officialList.file})`,
          `  scope:        ${scope.label} (${String(scope.files)} file${scope.files === 1 ? '' : 's'}); ` +
            `${String(scope.outside)} violation(s) elsewhere not shown (run without --group/--file for them)`,
          `  groups (official types owned · mapped · unmapped · missing · coverage):`,
          ...formatGroupDetails(report.groups),
        ];
  if (extras.trace !== undefined) {
    lines.push(
      'catalog:check: rule traces (rule → fixture value → normalised):',
      ...formatTrace(extras.trace),
    );
  }
  if (scope === undefined && extras.verbose === true && report.typesWithoutConsole.length > 0) {
    lines.push(
      `catalog:check: ${String(report.typesWithoutConsole.length)} type(s) without a console template (the app offers the project's console home instead):`,
      ...report.typesWithoutConsole.map((assetType) => `  ${assetType}`),
    );
  }
  if (report.warnings.length > 0 && (scope !== undefined || extras.verbose === true)) {
    lines.push(
      `catalog:check: ${String(report.warnings.length)} warning(s):`,
      ...formatViolations(report.warnings),
    );
  }
  const related = scope?.related ?? [];
  if (related.length > 0) {
    lines.push(
      `catalog:check: ${String(related.length)} note(s): problems blamed on files outside the selection that name one of yours (each is blamed on the file that has to change, so they do not fail this check):`,
      ...formatViolations(related),
    );
  }
  if (report.violations.length === 0) {
    lines.push(`catalog:check: OK${scope === undefined ? '' : ` for ${scope.label}`}.`);
  } else {
    lines.push(
      `catalog:check: ${String(report.violations.length)} violation(s):`,
      ...formatViolations(report.violations),
    );
  }
  return lines;
}

/** The whole catalog's header: totals, reasons, counts, icon keys and one line per group. */
function wholeReport(report: CoverageReport): string[] {
  const { officialList, mapped, unmapped, notOfficial, counts } = report;
  const reasons = Object.entries(unmapped.knownByReason).map(([reason, n]) => `${reason}: ${String(n)}`);
  return [
    `catalog:check: official list ${officialList.date} (${String(officialList.total)} types, ${officialList.file})`,
    `  mapped:       ${String(mapped.total)} of ${String(officialList.total)} (${report.coveragePercent.toFixed(1)} %): ` +
      `container ${String(mapped.container)}, core ${String(mapped.core)}, leaf ${String(mapped.leaf)}, hidden ${String(mapped.hidden)}`,
    `  unmapped:     ${String(unmapped.total)}: ${String(unmapped.known)} listed in known-unmapped/, ` +
      `${String(unmapped.unlisted.length)} not listed there`,
    ...reasons.map((reason) => `                  ${reason}`),
    `  not official: ${String(notOfficial.deprecated.length + notOfficial.unmarked.length)} ` +
      `(${String(notOfficial.deprecated.length)} marked deprecated: ${list(notOfficial.deprecated)})`,
    `  catalog:      ${String(counts.products)} products in ${String(counts.productFiles)} files, ${String(counts.types)} types, ` +
      `${String(counts.rules)} rules, ${String(counts.fixtures)} fixture files (${String(counts.typesWithoutFixtures)} types without one), ` +
      `${String(counts.lenses)} lenses, ${String(counts.iconKeys)} icon keys, ${String(counts.groups)} groups`,
    `  unused icon keys:       ${list(report.unusedIconKeys)}`,
    `  pending icon keys:      ${
      report.pendingIconKeys.length === 0
        ? 'none'
        : `${String(report.pendingIconKeys.length)} (not in icon-keys.json yet; a warning without --strict-icons): ${list(report.pendingIconKeys)}`
    }`,
    `  rules without fixtures: ${String(report.rulesWithoutFixtures.length)}`,
    `  fixtures without rules: ${list(report.fixturesWithoutRules)}`,
    `  types without a console template: ${String(report.typesWithoutConsole.length)} (list in --verbose)`,
    `  types no group owns:    ${String(report.ungrouped.length)}`,
    `  groups (official types owned · mapped · unmapped · missing · coverage):`,
    ...formatGroups(report.groups),
  ];
}
