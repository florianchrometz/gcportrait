// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * Opens or updates the one issue a weekly drift workflow keeps (.github/workflows/catalog-drift.yml and
 * icon-drift.yml), with the gh CLI and the workflow's own token (`GH_TOKEN`).
 *
 * It reads the drift check's report: the JSON (`drift`, a 64-hex `digest` that identifies this particular drift,
 * a one-line `summary`) and the Markdown that becomes the issue body. The body opens with the hidden marker
 * `<!-- <marker> digest: <digest> -->` and ends with a link to the run. With no open issue of exactly `--title`,
 * it opens one; an open one whose body carries the same digest has its body replaced (refreshing the run link)
 * and nobody is notified; an open one describing another drift has its body replaced and gets a comment, so its
 * subscribers hear of the change. A report without drift posts nothing.
 *
 * Usage:
 *   node scripts/drift-issue.mjs --title <title> --marker <name> --report <report.json> --markdown <report.md>
 *                                --again <comment opening> --rerun <command> [--label <name> ...]
 *     --title     the issue's title, matched exactly among the open issues
 *     --marker    the marker's name (`catalog-drift`, `icon-drift`)
 *     --again     the comment on a changed drift, before ": <summary>"
 *     --rerun     the command that prints the whole report, named when the body is truncated
 *     --label     optional label to attach when creating a new issue (repeatable)
 *   Environment: GITHUB_REPOSITORY (owner/name), GITHUB_RUN_ID, GITHUB_SERVER_URL (default https://github.com);
 *   gh reads GH_TOKEN.
 * Exit codes: 0 posted (or no drift), 1 gh failed, 2 a usage error or an unreadable report. Plain ESM, Node
 * built-ins only.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** GitHub refuses issue bodies above 65 536 characters; this leaves room for the marker and the run line. */
export const MAX_REPORT_CHARS = 60_000;

/** @typedef {(args: readonly string[], input?: string) => string} Gh */
/**
 * @typedef {object} IssueOptions
 * @property {string} repo owner/name
 * @property {string} title
 * @property {string} marker
 * @property {string} digest
 * @property {string} summary
 * @property {string} markdown
 * @property {string} again
 * @property {string} rerun
 * @property {string} runId
 * @property {string} runUrl
 * @property {readonly string[] | undefined} [labels]
 */

class UsageError extends Error {}

/**
 * The issue body: the digest marker, the report (truncated when GitHub would refuse it) and the run line.
 * @param {{ marker: string, digest: string, markdown: string, rerun: string, runId: string, runUrl: string }} options
 * @returns {string}
 */
export function issueBody({ marker, digest, markdown, rerun, runId, runUrl }) {
  let report = markdown.trimEnd();
  if (report.length > MAX_REPORT_CHARS) {
    report = `${report.slice(0, MAX_REPORT_CHARS)}\n\n… (truncated; run \`${rerun}\` locally)`;
  }
  return [
    `<!-- ${marker} digest: ${digest} -->`,
    report,
    '',
    `_Last checked by [workflow run ${runId}](${runUrl})._`,
  ].join('\n');
}

/**
 * Opens the issue, refreshes the one that describes this drift already, or updates and comments on the one that
 * describes another.
 * @param {IssueOptions} options
 * @param {Gh} gh
 * @returns {{ action: 'opened' | 'refreshed' | 'updated', number: number }}
 */
export function postDriftIssue(options, gh) {
  const { repo, title, marker, digest, labels } = options;
  const body = issueBody(options);
  /** @type {unknown} */
  const listed = JSON.parse(
    gh([
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--limit',
      '1000',
      '--json',
      'number,title,body',
    ]),
  );
  if (!Array.isArray(listed)) throw new Error('gh issue list answered no list');
  const open = /** @type {Array<{ number: number, title: string, body?: string | null }>} */ (listed);
  const existing = open.find((issue) => issue.title === title);
  if (existing === undefined) {
    const labelArgs = (labels ?? []).flatMap((label) => ['--label', label]);
    const url = gh(
      ['issue', 'create', '--repo', repo, '--title', title, ...labelArgs, '--body-file', '-'],
      body,
    ).trim();
    const number = Number(/\/issues\/([0-9]+)$/.exec(url)?.[1]);
    if (!Number.isInteger(number)) throw new Error(`gh issue create answered no issue URL: ${url}`);
    return { action: 'opened', number };
  }
  const issue = String(existing.number);
  const sameDrift = (existing.body ?? '').includes(`${marker} digest: ${digest}`);
  gh(['issue', 'edit', issue, '--repo', repo, '--body-file', '-'], body);
  if (sameDrift) return { action: 'refreshed', number: existing.number };
  gh(
    ['issue', 'comment', issue, '--repo', repo, '--body-file', '-'],
    `${options.again}: ${options.summary} ([run](${options.runUrl}))`,
  );
  return { action: 'updated', number: existing.number };
}

/** @type {Gh} */
function runGh(args, input) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input: input ?? '' });
  if (result.error !== undefined)
    throw new Error(`gh ${args.slice(0, 2).join(' ')}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `gh ${args.slice(0, 2).join(' ')} failed (exit ${String(result.status)}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

/**
 * @param {string} file
 * @returns {string}
 */
function readReportFile(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new UsageError(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The command line on `argv`.
 * @param {readonly string[]} argv
 * @param {Record<string, string | undefined>} [env]
 * @param {Gh} [gh]
 * @returns {number}
 */
export function run(argv, env = process.env, gh = runGh) {
  try {
    return main(argv, env, gh);
  } catch (error) {
    // parseArgs reports an unknown or malformed option as a TypeError with a code (ERR_PARSE_ARGS_...).
    if (error instanceof UsageError || (error instanceof TypeError && 'code' in error)) {
      process.stderr.write(`drift-issue: ${error.message}\n`);
      return 2;
    }
    process.stderr.write(`drift-issue: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

/**
 * @param {readonly string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {Gh} gh
 * @returns {number}
 */
function main(argv, env, gh) {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      title: { type: 'string' },
      marker: { type: 'string' },
      report: { type: 'string' },
      markdown: { type: 'string' },
      again: { type: 'string' },
      rerun: { type: 'string' },
      label: { type: 'string', multiple: true },
    },
    strict: true,
  });
  const { title, marker, report: reportFile, markdown: markdownFile, again, rerun } = values;
  for (const [name, value] of Object.entries({
    title,
    marker,
    report: reportFile,
    markdown: markdownFile,
    again,
    rerun,
  })) {
    if (value === undefined || value === '') throw new UsageError(`--${name} is required`);
  }
  const labels = values.label;
  if (labels !== undefined) {
    for (const label of labels) {
      if (label === '') throw new UsageError('--label must not be empty');
    }
  }
  if (!/^[a-z][a-z0-9-]*$/.test(marker ?? ''))
    throw new UsageError(`--marker must be a lowercase name, not ${String(marker)}`);
  const repo = env.GITHUB_REPOSITORY;
  const runId = env.GITHUB_RUN_ID;
  if (repo === undefined || !/^[^/\s]+\/[^/\s]+$/.test(repo))
    throw new UsageError('GITHUB_REPOSITORY must be owner/name');
  if (runId === undefined || !/^[0-9]+$/.test(runId))
    throw new UsageError('GITHUB_RUN_ID must be the run id');
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com';

  const text = readReportFile(String(reportFile));
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UsageError(`${String(reportFile)} is not JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null)
    throw new UsageError(`${String(reportFile)} is no report`);
  const report = /** @type {{ drift?: unknown, digest?: unknown, summary?: unknown }} */ (parsed);
  if (report.drift !== true) {
    process.stdout.write('The report shows no drift; nothing to post.\n');
    return 0;
  }
  const digest = String(report.digest);
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new UsageError('the drift report carries no digest');
  if (typeof report.summary !== 'string') throw new UsageError('the drift report carries no summary');

  const result = postDriftIssue(
    {
      repo,
      title: String(title),
      marker: String(marker),
      digest,
      summary: report.summary,
      markdown: readReportFile(String(markdownFile)),
      again: String(again),
      rerun: String(rerun),
      runId,
      runUrl: `${server}/${repo}/actions/runs/${runId}`,
      labels,
    },
    gh,
  );
  const line =
    result.action === 'opened'
      ? `::notice::Opened issue #${String(result.number)}: ${report.summary}`
      : result.action === 'updated'
        ? `::notice::Updated issue #${String(result.number)}: ${report.summary}`
        : `Issue #${String(result.number)} already describes this drift; refreshed its last line.`;
  process.stdout.write(`${line}\n`);
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
