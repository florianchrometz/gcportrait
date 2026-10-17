// SPDX-License-Identifier: MIT
/**
 * `pnpm --filter @gcportrait/e2e leg`: one of CI's e2e legs (.github/workflows/pr.yml), a round-robin share of
 * its projects' tests, so that the slow files spread over the legs instead of landing in one.
 *
 *   pnpm --filter @gcportrait/e2e leg --projects "chromium-live chromium" --leg 2 --of 3
 *   pnpm --filter @gcportrait/e2e leg --projects '!chromium-live !chromium' --leg 1 --of 2 --list-only
 *   pnpm --filter @gcportrait/e2e leg --projects "chromium-phone chromium-tablet" --leg 1 --of 2 -- --headed
 *
 * 1. Lists the config's tests (`playwright test --list --reporter=json`) and keeps the leg's projects: the ones
 *    named, or with every name negated every project of playwright.config.ts but those. A name the config does
 *    not have fails the leg, and so do two tests of one project, file and title path, which neither a test list
 *    nor a report tells apart.
 * 2. Deals the tests out in the listing's order (file after file, and in a file as the report nests them, a
 *    block's own tests before those of the blocks inside it): leg i of k takes the tests at positions i − 1,
 *    i − 1 + k, i − 1 + 2k, …, so the k legs' shares hold every test once.
 * 3. Writes leg i's share as a test list in the list reporter's format, `[project] › file:line:column ›
 *    describe › title`, which `--test-list` reads (a title path names every test it is a prefix of).
 * 4. Runs `playwright test --test-list FILE --project …` with the arguments after `--`, the config's reporters
 *    and Playwright's JSON report (PLAYWRIGHT_JSON_OUTPUT_FILE, which the config reads), and fails unless the
 *    report holds exactly the share's tests, so a test the list cannot name, or names besides, is never dropped
 *    or run in silence.
 * 5. Prints the share's test count and its summed test time (every run of every test, retries included), and
 *    writes them to $GITHUB_STEP_SUMMARY when it is set, so the legs compare by their tests' own time, apart
 *    from each job's set-up.
 *
 * `--list-only` runs nothing after step 3: it has Playwright read the test list (`--list --test-list`), fails
 * unless that names exactly the share, and prints the share on standard output, one line per test (a file for
 * `--test-list`), and the counts on standard error. Node runs this file as it is (it strips the types): it
 * imports only Node's modules and Playwright's types.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter';

const E2E = path.resolve(import.meta.dirname, '..');
const PLAYWRIGHT = createRequire(import.meta.url).resolve('@playwright/test/cli');
const ON_GITHUB = process.env.GITHUB_ACTIONS === 'true';
/** How many names a failure lists before it counts the rest. */
const NAMED = 20;

const USAGE = `Usage:
  pnpm --filter @gcportrait/e2e leg --projects "NAME …" --leg I --of K [--list-only] [-- PLAYWRIGHT_ARGS …]

Runs every K-th test of the projects' listing, starting at the I-th, through playwright test --test-list, and fails
unless the run addressed every test of that share. --projects names the projects, or negates every name ('!a !b')
for every project of playwright.config.ts but those. --list-only prints the share without running it, once
Playwright reads the list as exactly that share. The arguments after -- go to the run only; one that filters
tests (a file, --grep) makes the run miss tests of the share, which fails the leg.`;

/** One test of one project, as a listing or a report holds it. */
interface Test {
  readonly project: string;
  /** Its file, relative to the config's testDir, as Playwright names it. */
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** The titles of its describe blocks, then its own. */
  readonly titles: readonly string[];
  /** The duration of each of its runs in milliseconds (none in a listing; a retry adds one). */
  readonly durations: readonly number[];
}

class LegError extends Error {}

/** The tests of a JSON report or listing in its order: file after file, a suite's specs before its suites'. */
function testsOf(report: JSONReport): Test[] {
  const tests: Test[] = [];
  const walk = (suite: JSONReportSuite, titles: readonly string[]): void => {
    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        tests.push({
          project: test.projectName,
          file: spec.file,
          line: spec.line,
          column: spec.column,
          titles: [...titles, spec.title],
          durations: test.results.map((result) => result.duration),
        });
      }
    }
    // An anonymous describe block has no title, and Playwright's title path leaves it out.
    for (const child of suite.suites ?? [])
      walk(child, child.title === '' ? titles : [...titles, child.title]);
  };
  for (const file of report.suites) walk(file, []);
  return tests;
}

/** What tells one test from every other: its project, file and title path. */
function keyOf(test: Test): string {
  return JSON.stringify([test.project, test.file, ...test.titles]);
}

/** The test's line in a test list, as the list reporter prints it. */
function lineOf(test: Test): string {
  return [
    `[${test.project}]`,
    `${test.file}:${String(test.line)}:${String(test.column)}`,
    ...test.titles,
  ].join(' › ');
}

/** The projects a leg runs, in the config's order. */
function resolveProjects(spec: string, configured: readonly string[]): string[] {
  const names = spec.split(/\s+/).filter((name) => name !== '');
  const negated = names.filter((name) => name.startsWith('!'));
  if (names.length === 0) throw new LegError('--projects names no project.');
  if (negated.length !== 0 && negated.length !== names.length)
    throw new LegError(`--projects "${spec}" mixes names and negations; use one or the other.`);
  const bare = names.map((name) => name.replace(/^!/, ''));
  const unknown = bare.filter((name) => !configured.includes(name));
  if (unknown.length > 0)
    throw new LegError(
      `playwright.config.ts has no project ${unknown.join(', ')} (its projects: ${configured.join(', ')}).`,
    );
  const projects = configured.filter((name) => bare.includes(name) !== negated.length > 0);
  if (projects.length === 0)
    throw new LegError(`--projects "${spec}" leaves no Playwright project for this leg.`);
  return projects;
}

/**
 * Throws when two tests have one key: one line of a test list would name both, and the report's check could count
 * one for the other.
 */
function checkUnique(tests: readonly Test[]): void {
  const seen = new Set<string>();
  for (const test of tests) {
    const key = keyOf(test);
    if (seen.has(key)) throw new LegError(`The listing names a test twice: ${lineOf(test)}`);
    seen.add(key);
  }
}

/** Leg `leg` of `of`'s share of `tests` (both from 1): the tests at positions leg − 1, leg − 1 + of, …. */
function shareOf<T>(tests: readonly T[], leg: number, of: number): T[] {
  return tests.filter((_, index) => index % of === leg - 1);
}

/** The tests of `expected` that `actual` lacks, and those it holds besides, as lines of a test list. */
function difference(
  expected: readonly Test[],
  actual: readonly Test[],
): { missing: string[]; extra: string[] } {
  const want = new Set(expected.map(keyOf));
  const got = new Set(actual.map(keyOf));
  return {
    missing: expected.filter((test) => !got.has(keyOf(test))).map(lineOf),
    extra: actual.filter((test) => !want.has(keyOf(test))).map(lineOf),
  };
}

function named(lines: readonly string[]): string {
  const shown = lines.slice(0, NAMED).map((line) => `\n  ${line}`);
  const rest = lines.length > NAMED ? `\n  … and ${String(lines.length - NAMED)} more` : '';
  return shown.join('') + rest;
}

/** `playwright test --list --reporter=json` with `args`, its report read from a file in `dir`. */
function listing(dir: string, name: string, args: readonly string[]): JSONReport {
  const file = path.join(dir, `${name}.json`);
  const result = spawnSync(process.execPath, [PLAYWRIGHT, 'test', '--list', '--reporter=json', ...args], {
    cwd: E2E,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: file },
    // Playwright adds its listing on standard output when every reporter writes to a file.
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let report: JSONReport | undefined;
  try {
    report = JSON.parse(readFileSync(file, 'utf8')) as JSONReport;
  } catch {
    report = undefined;
  }
  const errors = report?.errors.map((error) => error.message ?? String(error.value)) ?? [];
  if (result.status !== 0 || report === undefined || errors.length > 0)
    throw new LegError(
      `playwright test --list ${args.join(' ')} failed (exit ${String(result.status)}).${named(errors)}`,
    );
  return report;
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${String(n)}${suffix}`;
}

function integer(value: string | undefined, option: string): number {
  if (value === undefined || !/^[1-9]\d*$/.test(value))
    throw new LegError(`${option} takes a whole number from 1.`);
  return Number(value);
}

function main(argv: readonly string[], dir: string): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      projects: { type: 'string' },
      leg: { type: 'string' },
      of: { type: 'string' },
      'list-only': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  // Everything after `--` (which pnpm passes on) is a positional: the run's own arguments.
  const extra = positionals;
  const leg = integer(values.leg, '--leg');
  const of = integer(values.of, '--of');
  if (leg > of) throw new LegError(`--leg ${String(leg)} is past --of ${String(of)}.`);
  if (values.projects === undefined) throw new LegError('--projects is required.');

  const all = listing(dir, 'listing', []);
  const projects = resolveProjects(
    values.projects,
    all.config.projects.map((project) => project.name),
  );
  const tests = testsOf(all).filter((test) => projects.includes(test.project));
  checkUnique(tests);
  const share = shareOf(tests, leg, of);
  const title = `e2e leg ${String(leg)}/${String(of)} (${projects.join(', ')})`;
  const counts =
    `${String(share.length)} of the projects' ${String(tests.length)} tests,` +
    ` every ${ordinal(of)} from the ${ordinal(leg)}`;
  if (share.length === 0) throw new LegError(`${title}: no test to run (${counts}).`);

  const list = path.join(dir, `leg-${String(leg)}-of-${String(of)}.txt`);
  writeFileSync(list, `${share.map(lineOf).join('\n')}\n`);
  const projectArgs = projects.flatMap((project) => ['--project', project]);

  if (values['list-only']) {
    // No run follows to check what the list names, so Playwright reads it here.
    const read = difference(share, testsOf(listing(dir, 'read', ['--test-list', list, ...projectArgs])));
    if (read.missing.length > 0 || read.extra.length > 0)
      throw new LegError(
        `${title}: Playwright reads the test list as other tests than the share's.` +
          (read.missing.length > 0 ? `\nNot named by the list:${named(read.missing)}` : '') +
          (read.extra.length > 0 ? `\nNamed besides:${named(read.extra)}` : ''),
      );
    console.error(`${title}: ${counts}; Playwright reads the test list as exactly this share.`);
    console.log(share.map(lineOf).join('\n'));
    return 0;
  }
  console.error(`${title}: ${counts}.`);

  const reportFile = path.join(dir, 'report.json');
  const run = spawnSync(
    process.execPath,
    [PLAYWRIGHT, 'test', '--test-list', list, ...projectArgs, ...extra],
    {
      cwd: E2E,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile },
      stdio: 'inherit',
    },
  );
  let report: JSONReport | undefined;
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8')) as JSONReport;
  } catch {
    report = undefined;
  }
  const ran = report === undefined ? [] : testsOf(report);
  const { missing, extra: besides } = difference(share, ran);
  const runs = ran.reduce((sum, test) => sum + test.durations.length, 0);
  const retries = ran.reduce((sum, test) => sum + Math.max(0, test.durations.length - 1), 0);
  const time = ran.reduce(
    (sum, test) => sum + test.durations.reduce((total, duration) => total + duration, 0),
    0,
  );
  const clock = report === undefined ? '' : `, ${seconds(report.stats.duration)} on the clock`;
  const summary =
    `${counts}: ${String(ran.length)} addressed, ${seconds(time)} of test time summed over ${String(runs)} runs` +
    ` (${String(retries)} retries)${clock}.`;
  // The guard: a test of the share the run did not address (or one outside it) fails the leg.
  const unnamed = missing.length > 0 ? missing : besides;
  const guard =
    missing.length > 0
      ? `The run addressed ${String(ran.length - besides.length)} of the share's ${String(share.length)}` +
        ' tests; it did not address:'
      : besides.length > 0
        ? 'The run addressed tests outside the share:'
        : '';
  console.log(`\n${title}: ${summary}`);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile !== undefined && summaryFile !== '') {
    const failed =
      guard === '' ? '' : `\n**${guard}**\n\n\`\`\`text${named(unnamed).replaceAll('\n  ', '\n')}\n\`\`\`\n`;
    appendFileSync(summaryFile, `### ${title}\n\n${summary}\n${failed}\n`);
  }
  if (guard !== '') {
    console.error(`${ON_GITHUB ? '::error::' : ''}${title}: ${guard}${named(unnamed)}`);
    return run.status === 0 ? 1 : (run.status ?? 1);
  }
  return run.status ?? 1;
}

const dir = mkdtempSync(path.join(tmpdir(), 'gcportrait-e2e-leg-'));
let code: number;
try {
  code = main(process.argv.slice(2), dir);
} catch (error) {
  // parseArgs throws a TypeError with an ERR_PARSE_ARGS_… code for an option it does not know or a missing value.
  const usage =
    error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS');
  if (!(error instanceof LegError) && !usage) throw error;
  console.error(`${ON_GITHUB ? '::error::' : ''}${error instanceof Error ? error.message : String(error)}`);
  if (usage) console.error(USAGE);
  code = usage ? 2 : 1;
}
if (code !== 0 && readdirSync(dir).some((file) => file.endsWith('.txt')))
  console.error(`The test list and the reports stay in ${dir}.`);
else rmSync(dir, { recursive: true, force: true });
process.exitCode = code;
