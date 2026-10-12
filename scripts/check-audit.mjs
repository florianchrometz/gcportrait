// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Dependency audit gate (ADR 0035 §4, principle 7; docs/security.md, "Dependency audit"): `pnpm audit` over the
 * production dependencies and over the whole tree (development dependencies included), failing on any high or
 * critical advisory that is not accepted in scripts/audit-allowlist.json.
 *
 *   node scripts/check-audit.mjs                       audit (CI: the `audit` job of .github/workflows/pr.yml)
 *   node scripts/check-audit.mjs --today 2026-10-11    judge expiry dates against that day (tests)
 *   node scripts/check-audit.mjs --prod-report F --all-report G    read saved `pnpm audit --json` output (tests)
 *
 * An accepted advisory is an entry of the allowlist: its GitHub advisory id (or npm's numeric id), the
 * package, why it does not affect gcportrait (or why there is no fix yet), the day it was added (not after
 * the day the gate runs), and an expiry date at most 90 days after that, so every acceptance is looked at
 * again. After its expiry an entry no longer counts and the job fails until it is renewed (with a fresh
 * reason) or the dependency is fixed; an entry that matches no advisory any more is reported for removal.
 * Moderate and low advisories are listed and do not fail the gate (Dependabot proposes their fixes,
 * .github/dependabot.yml).
 *
 * `pnpm audit` asks the npm registry's advisory service, so this needs the network; it is not part of `pnpm check`,
 * whose result must not change with the day it runs. Exit code 0 when no high or critical advisory is open, 1 when
 * one is (or the allowlist has an expired or overlong entry), 2 when the audit could not run or the allowlist is
 * malformed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOWLIST_PATH = 'scripts/audit-allowlist.json';

/** Severities that fail the gate. */
export const FAILING_SEVERITIES = Object.freeze(['high', 'critical']);

/** The longest an acceptance may last before it is looked at again. */
export const MAX_ACCEPTANCE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ADVISORY_ID = /^(?:GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}|\d{1,10})$/;

/**
 * @typedef {{ id: string, package: string, reason: string, added: string, expires: string }} Acceptance
 * @typedef {{
 *   id: string, ghsa: string | undefined, module: string, severity: string, title: string, url: string,
 *   vulnerable: string, patched: string, scope: 'production' | 'development',
 * }} Advisory
 * @typedef {{
 *   failures: string[], accepted: string[], reported: string[], unused: string[],
 * }} AuditVerdict
 */

/** A problem with the inputs (the allowlist, pnpm's output): exit code 2. */
export class AuditInputError extends Error {
  /** @override */
  name = 'AuditInputError';
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {string} text
 * @returns {number} the day as milliseconds since the epoch (UTC midnight)
 */
function dayOf(text) {
  const time = Date.parse(`${text}T00:00:00Z`);
  if (!DATE.test(text) || Number.isNaN(time))
    throw new AuditInputError(`"${text}" is not a date (YYYY-MM-DD)`);
  return time;
}

/**
 * The allowlist, checked: every entry with a valid id, the package, a reason, and dates in order.
 * @param {unknown} document
 * @param {string} [source] the file it was read from, for the messages
 * @returns {Acceptance[]}
 */
export function parseAllowlist(document, source = ALLOWLIST_PATH) {
  if (!isRecord(document) || !Array.isArray(document.advisories))
    throw new AuditInputError(`${source}: expected an object with an "advisories" array`);
  return document.advisories.map((entry, index) => {
    const where = `${source}: advisories[${String(index)}]`;
    if (!isRecord(entry)) throw new AuditInputError(`${where}: expected an object`);
    const { id, package: name, reason, added, expires } = entry;
    if (typeof id !== 'string' || !ADVISORY_ID.test(id))
      throw new AuditInputError(`${where}: "id" must be a GitHub advisory id (GHSA-…) or npm's numeric id`);
    if (typeof name !== 'string' || name === '') throw new AuditInputError(`${where}: "package" is required`);
    if (typeof reason !== 'string' || reason.trim().length < 20)
      throw new AuditInputError(
        `${where}: "reason" must say why the advisory is accepted (20 characters or more)`,
      );
    if (typeof added !== 'string' || typeof expires !== 'string')
      throw new AuditInputError(`${where}: "added" and "expires" are required dates (YYYY-MM-DD)`);
    try {
      if (dayOf(expires) < dayOf(added)) throw new AuditInputError(`"expires" is before "added"`);
    } catch (error) {
      throw new AuditInputError(`${where}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { id, package: name, reason, added, expires };
  });
}

/**
 * The advisories of one `pnpm audit --json` report.
 * @param {unknown} report
 * @param {'production' | 'development'} scope
 * @returns {Advisory[]}
 */
export function advisoriesOf(report, scope) {
  if (!isRecord(report)) throw new AuditInputError('`pnpm audit --json` did not print a JSON object');
  if (report.error !== undefined) {
    const error = isRecord(report.error) ? report.error : {};
    const summary = typeof error.summary === 'string' ? error.summary : JSON.stringify(report.error);
    throw new AuditInputError(`pnpm audit failed: ${summary}`);
  }
  if (!isRecord(report.advisories))
    throw new AuditInputError('`pnpm audit --json` has no "advisories" object');
  return Object.entries(report.advisories).map(([key, value]) => {
    const advisory = isRecord(value) ? value : {};
    const text = (/** @type {unknown} */ field, fallback = '') =>
      typeof field === 'string' ? field : fallback;
    return {
      id: String(typeof advisory.id === 'number' || typeof advisory.id === 'string' ? advisory.id : key),
      ghsa: typeof advisory.github_advisory_id === 'string' ? advisory.github_advisory_id : undefined,
      module: text(advisory.module_name, 'unknown'),
      severity: text(advisory.severity, 'unknown').toLowerCase(),
      title: text(advisory.title),
      url: text(advisory.url),
      vulnerable: text(advisory.vulnerable_versions),
      patched: text(advisory.patched_versions),
      scope,
    };
  });
}

/**
 * The gate's verdict on the advisories of both audits against the allowlist, on `today`. `source` names the
 * allowlist's file in the messages.
 * @param {{
 *   production: readonly Advisory[],
 *   all: readonly Advisory[],
 *   allowlist: readonly Acceptance[],
 *   today: string,
 *   source?: string,
 * }} input
 * @returns {AuditVerdict}
 */
export function evaluateAudit({ production, all, allowlist, today, source = ALLOWLIST_PATH }) {
  const now = dayOf(today);
  /** @type {AuditVerdict} */
  const verdict = { failures: [], accepted: [], reported: [], unused: [] };
  // One entry per advisory: production wins over development when both audits list it.
  /** @type {Map<string, Advisory>} */
  const advisories = new Map();
  for (const advisory of [...production, ...all]) {
    const key = advisory.ghsa ?? advisory.id;
    if (!advisories.has(key)) advisories.set(key, advisory);
  }
  for (const entry of allowlist) {
    // A date to come would let an acceptance run for more than 90 days from today.
    if (dayOf(entry.added) > now)
      verdict.failures.push(
        `${entry.id} (${entry.package}): "added" is ${entry.added}, after today (${today}); an acceptance starts ` +
          'on the day it is written',
      );
    if (dayOf(entry.expires) - dayOf(entry.added) > MAX_ACCEPTANCE_DAYS * DAY_MS)
      verdict.failures.push(
        `${entry.id} (${entry.package}): the acceptance runs from ${entry.added} to ${entry.expires}, longer than ` +
          `${String(MAX_ACCEPTANCE_DAYS)} days; shorten it`,
      );
  }
  for (const advisory of advisories.values()) {
    const label =
      `${advisory.ghsa ?? advisory.id} ${advisory.severity} in ${advisory.module} ${advisory.vulnerable}` +
      ` (${advisory.scope}; fixed in ${advisory.patched || 'no release yet'}): ${advisory.title} ${advisory.url}`;
    if (!FAILING_SEVERITIES.includes(advisory.severity)) {
      verdict.reported.push(label);
      continue;
    }
    const entry = allowlist.find(
      (candidate) =>
        (candidate.id === advisory.ghsa || candidate.id === advisory.id) &&
        candidate.package === advisory.module,
    );
    if (entry === undefined) verdict.failures.push(`${label}; not in ${source}`);
    else if (dayOf(entry.expires) < now)
      verdict.failures.push(
        `${label}; its acceptance expired on ${entry.expires}: fix it or renew the entry`,
      );
    else verdict.accepted.push(`${label}; accepted until ${entry.expires}: ${entry.reason}`);
  }
  for (const entry of allowlist) {
    const used = [...advisories.values()].some(
      (advisory) =>
        (entry.id === advisory.ghsa || entry.id === advisory.id) && entry.package === advisory.module,
    );
    if (!used) verdict.unused.push(`${entry.id} (${entry.package}): no longer reported; remove the entry`);
  }
  return verdict;
}

/**
 * `pnpm audit --json` (with `--prod` for the production dependencies), parsed. pnpm exits non-zero when it finds
 * an advisory, so its exit code alone says nothing; its output does.
 * @param {boolean} prod
 * @returns {unknown}
 */
function runAudit(prod) {
  const result = spawnSync('pnpm', ['audit', '--json', ...(prod ? ['--prod'] : [])], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, npm_config_update_notifier: 'false' },
    shell: process.platform === 'win32',
  });
  try {
    return JSON.parse(result.stdout);
  } catch {
    const said = `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(0, 3).join(' ');
    throw new AuditInputError(`pnpm audit${prod ? ' --prod' : ''} printed no JSON: ${said}`);
  }
}

/**
 * @param {string} file
 * @returns {unknown}
 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new AuditInputError(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @param {readonly string[]} argv
 * @returns {number}
 */
function main(argv) {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        today: { type: 'string' },
        allowlist: { type: 'string' },
        'prod-report': { type: 'string' },
        'all-report': { type: 'string' },
      },
      strict: true,
    });
    const today = values.today ?? new Date().toISOString().slice(0, 10);
    const source = values.allowlist ?? ALLOWLIST_PATH;
    const allowlist = parseAllowlist(
      readJson(path.resolve(values.allowlist ?? path.join(ROOT, ALLOWLIST_PATH))),
      source,
    );
    const production = advisoriesOf(
      values['prod-report'] === undefined ? runAudit(true) : readJson(values['prod-report']),
      'production',
    );
    const all = advisoriesOf(
      values['all-report'] === undefined ? runAudit(false) : readJson(values['all-report']),
      'development',
    );
    const verdict = evaluateAudit({ production, all, allowlist, today, source });
    for (const line of verdict.accepted) console.log(`audit: accepted: ${line}`);
    for (const line of verdict.reported) console.log(`audit: below the gate: ${line}`);
    for (const line of verdict.unused) console.log(`audit: unused allowlist entry: ${line}`);
    if (verdict.failures.length > 0) {
      console.error(
        `audit: FAILED with ${String(verdict.failures.length)} problem(s) (high and critical fail):`,
      );
      for (const line of verdict.failures) console.error(`  ${line}`);
      return 1;
    }
    console.log(
      `audit: OK on ${today}. Production: ${String(production.length)} advisories, whole tree: ${String(all.length)}; ` +
        `no open high or critical one (${String(verdict.accepted.length)} accepted in ${source}).`,
    );
    return 0;
  } catch (error) {
    if (
      error instanceof AuditInputError ||
      (error instanceof Error && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS'))
    ) {
      console.error(`audit: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
