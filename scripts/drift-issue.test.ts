// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_REPORT_CHARS, issueBody, postDriftIssue, run } from './drift-issue.mjs';
import {
  SCRIPTS_DIR,
  SPAWN_TIMEOUT,
  createTempTree,
  runInProcess,
  type TempTree,
} from './testing/temp-tree.js';

const DIGEST = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const TITLE = 'Catalog drift: official asset-type list changed';
const RUN = { runId: '42', runUrl: 'https://github.com/example/repo/actions/runs/42' };

interface Call {
  readonly args: readonly string[];
  readonly input: string | undefined;
}

/** A stand-in for the gh CLI: answers `issue list` with `open` and `issue create` with an issue URL. */
function fakeGh(open: ReadonlyArray<{ number: number; title: string; body: string }>) {
  const calls: Call[] = [];
  const gh = (args: readonly string[], input?: string): string => {
    calls.push({ args, input });
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(open);
    if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/example/repo/issues/7\n';
    return '';
  };
  return { calls, gh };
}

const options = {
  repo: 'example/repo',
  title: TITLE,
  marker: 'catalog-drift',
  digest: DIGEST,
  summary: 'catalog drift: 1 added, 0 removed asset types.',
  markdown: 'The report.\n',
  again: 'The official asset-type list changed again',
  rerun: 'pnpm catalog:fetch-official',
  ...RUN,
};

describe('issueBody', () => {
  it('opens with the digest marker and ends with the run that checked', () => {
    expect(
      issueBody({ marker: 'icon-drift', digest: DIGEST, markdown: 'Report\n\n', rerun: 'x', ...RUN }),
    ).toBe(
      [
        `<!-- icon-drift digest: ${DIGEST} -->`,
        'Report',
        '',
        `_Last checked by [workflow run 42](${RUN.runUrl})._`,
      ].join('\n'),
    );
  });

  it('truncates a report GitHub would refuse and names the command that prints it whole', () => {
    const body = issueBody({
      marker: 'icon-drift',
      digest: DIGEST,
      markdown: 'x'.repeat(MAX_REPORT_CHARS + 10),
      rerun: 'pnpm --filter @gcportrait/icons drift',
      ...RUN,
    });
    expect(body).toContain('… (truncated; run `pnpm --filter @gcportrait/icons drift` locally)');
    expect(body.length).toBeLessThan(65_536);
  });
});

describe('postDriftIssue', () => {
  it('opens the issue when none with the title is open', () => {
    const { calls, gh } = fakeGh([{ number: 3, title: 'Something else', body: '' }]);
    expect(postDriftIssue(options, gh)).toEqual({ action: 'opened', number: 7 });
    expect(calls.map((call) => call.args)).toEqual([
      [
        'issue',
        'list',
        '--repo',
        'example/repo',
        '--state',
        'open',
        '--limit',
        '1000',
        '--json',
        'number,title,body',
      ],
      ['issue', 'create', '--repo', 'example/repo', '--title', TITLE, '--body-file', '-'],
    ]);
    expect(calls[1]?.input).toContain(`<!-- catalog-drift digest: ${DIGEST} -->\nThe report.`);
  });

  it('only refreshes the body of an open issue that describes the same drift, notifying no one', () => {
    const { calls, gh } = fakeGh([
      { number: 5, title: TITLE, body: `<!-- catalog-drift digest: ${DIGEST} -->\nold` },
    ]);
    expect(postDriftIssue(options, gh)).toEqual({ action: 'refreshed', number: 5 });
    expect(calls.map((call) => call.args.slice(0, 3))).toEqual([
      ['issue', 'list', '--repo'],
      ['issue', 'edit', '5'],
    ]);
    expect(calls[1]?.args).toEqual(['issue', 'edit', '5', '--repo', 'example/repo', '--body-file', '-']);
  });

  it('updates an open issue that describes another drift and comments, so its subscribers hear of it', () => {
    const { calls, gh } = fakeGh([
      { number: 5, title: TITLE, body: `<!-- catalog-drift digest: ${OTHER} -->\nold` },
    ]);
    expect(postDriftIssue(options, gh)).toEqual({ action: 'updated', number: 5 });
    expect(calls.map((call) => call.args.slice(0, 3))).toEqual([
      ['issue', 'list', '--repo'],
      ['issue', 'edit', '5'],
      ['issue', 'comment', '5'],
    ]);
    expect(calls[2]?.input).toBe(
      `The official asset-type list changed again: catalog drift: 1 added, 0 removed asset types. ([run](${RUN.runUrl}))`,
    );
  });

  it('takes the exact title only, never a similar one or another marker’s digest', () => {
    const { gh } = fakeGh([
      { number: 4, title: `${TITLE} (old)`, body: '' },
      { number: 5, title: TITLE, body: `<!-- icon-drift digest: ${DIGEST} -->` },
    ]);
    expect(postDriftIssue(options, gh)).toEqual({ action: 'updated', number: 5 });
  });
});

describe('drift-issue command line', () => {
  let tree: TempTree;
  beforeEach(() => {
    tree = createTempTree('drift-issue');
  });
  afterEach(() => {
    tree.remove();
  });

  const env = {
    GITHUB_REPOSITORY: 'example/repo',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_RUN_ID: '42',
  };
  const writeReport = (report: unknown): string[] => {
    tree.write('report.json', JSON.stringify(report));
    tree.write('report.md', 'The report.\n');
    return [
      '--title',
      TITLE,
      '--marker',
      'catalog-drift',
      '--report',
      path.join(tree.root, 'report.json'),
      '--markdown',
      path.join(tree.root, 'report.md'),
      '--again',
      'The official asset-type list changed again',
      '--rerun',
      'pnpm catalog:fetch-official',
    ];
  };

  it('posts a drift report and says what it did', async () => {
    const { calls, gh } = fakeGh([]);
    const args = writeReport({ drift: true, digest: DIGEST, summary: 'catalog drift: 1 added.' });
    const result = await runInProcess(() => run(args, env, gh));
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('::notice::Opened issue #7: catalog drift: 1 added.\n');
    expect(calls[1]?.input).toContain(`_Last checked by [workflow run 42](${RUN.runUrl})._`);
  });

  it('posts nothing for a report without drift', async () => {
    const { calls, gh } = fakeGh([]);
    const args = writeReport({ drift: false, digest: DIGEST, summary: 'catalog drift: none.' });
    const result = await runInProcess(() => run(args, env, gh));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no drift');
    expect(calls).toEqual([]);
  });

  it('refuses a report without a digest, a missing option and a missing run', async () => {
    const { calls, gh } = fakeGh([]);
    const noDigest = writeReport({ drift: true, digest: 'abc', summary: 's' });
    expect((await runInProcess(() => run(noDigest, env, gh))).stderr).toContain('no digest');
    const args = writeReport({ drift: true, digest: DIGEST, summary: 's' });
    const noTitle = await runInProcess(() => run(args.slice(2), env, gh));
    expect(noTitle.status).toBe(2);
    expect(noTitle.stderr).toContain('--title');
    const noRun = await runInProcess(() => run(args, { GITHUB_REPOSITORY: 'example/repo' }, gh));
    expect(noRun.status).toBe(2);
    expect(noRun.stderr).toContain('GITHUB_RUN_ID');
    expect(calls).toEqual([]);
  });

  it('fails with gh’s message when gh fails', async () => {
    const gh = (): string => {
      throw new Error('gh issue list: HTTP 401');
    };
    const args = writeReport({ drift: true, digest: DIGEST, summary: 's' });
    const result = await runInProcess(() => run(args, env, gh));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gh issue list: HTTP 401');
  });

  it(
    'runs the gh on PATH, feeding bodies on standard input',
    () => {
      tree.write(
        'bin/gh',
        [
          '#!/usr/bin/env node',
          "const fs = require('node:fs');",
          "const input = process.argv[3] === 'list' ? '' : fs.readFileSync(0, 'utf8');",
          "fs.appendFileSync(process.env.GH_LOG, JSON.stringify([process.argv.slice(2), input]) + '\\n');",
          "if (process.argv[3] === 'list') process.stdout.write('[]');",
          "if (process.argv[3] === 'create') process.stdout.write('https://github.com/example/repo/issues/9\\n');",
          '',
        ].join('\n'),
      );
      chmodSync(path.join(tree.root, 'bin/gh'), 0o755);
      const args = writeReport({ drift: true, digest: DIGEST, summary: 'catalog drift: 1 added.' });
      const result = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'drift-issue.mjs'), ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...env,
          PATH: `${path.join(tree.root, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
          GH_LOG: path.join(tree.root, 'gh.log'),
        },
      });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('::notice::Opened issue #9: catalog drift: 1 added.\n');
      const log = tree
        .read('gh.log')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as [string[], string]);
      expect(log.map(([argv]) => argv[1])).toEqual(['list', 'create']);
      expect(log[1]?.[1]).toContain(`<!-- catalog-drift digest: ${DIGEST} -->`);
    },
    SPAWN_TIMEOUT.timeout,
  );
});
