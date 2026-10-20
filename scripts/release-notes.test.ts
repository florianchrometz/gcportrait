// SPDX-License-Identifier: Apache-2.0
/**
 * scripts/release-notes.mjs: the GitHub release's notes from the commits since the previous release tag, or
 * from a version's section of CHANGELOG.md, its command line run in this process on synthetic git trees (`run`),
 * and once as a command of its own.
 */
import { execFileSync } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NON_AFFILIATION_LONG, changelogSection, releaseNotes, run } from './release-notes.mjs';
import {
  REPO,
  SPAWN_TIMEOUT,
  createTempTree,
  runInProcess,
  runScript,
  type TempTree,
} from './testing/temp-tree.js';

/** Runs git in `tree`, as the tooling's own quiet identity (no global git config is read). */
const git = (tree: TempTree, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=gcportrait test', '-c', 'user.email=test@example.com', ...args], {
    cwd: tree.root,
    encoding: 'utf8',
  });

/** A commit on the tree's only branch, and the tag of a release at that commit. */
const commit = (tree: TempTree, subject: string): void => {
  git(tree, 'commit', '--allow-empty', '--quiet', '--message', subject);
};
const tag = (tree: TempTree, name: string): void => {
  git(tree, 'tag', name);
};

/** The notes' "Changes" section, between its heading and the next one. */
const changesOf = (text: string) => /\n## Changes\n\n([\s\S]*?)\n+## Deploy\n/.exec(text)?.[1];

const WORKSPACE = 'packages:\n  - app\n';

describe('release-notes.mjs', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = createTempTree('release-notes');
    tree.write('pnpm-workspace.yaml', WORKSPACE);
    tree.write('app/package.json', '{ "name": "@gcportrait/app", "version": "1.1.0" }\n');
    git(tree, 'init', '--quiet', '--initial-branch', 'main');
    commit(tree, 'First commit');
    tag(tree, 'v1.1.0');
    commit(tree, 'App: collapse all follows the drawing');
    commit(tree, 'Docs: the guide names the flag');
    commit(tree, 'Other work without an area marker');
    tag(tree, 'v1.2.0');
  });

  afterEach(() => {
    tree.remove();
  });

  const notes = (...args: string[]) => runInProcess(() => run(['--root', tree.root, ...args]));

  it('lists the commits since the previous release, one group per area, without merge commits', async () => {
    // A side branch merged back before the tag: its commit is listed once, the merge commit itself not at all.
    git(tree, 'tag', '--delete', 'v1.2.0');
    git(tree, 'checkout', '--quiet', '-b', 'side');
    commit(tree, 'Backend: read folders too');
    git(tree, 'checkout', '--quiet', 'main');
    commit(tree, 'Tests: cover the folders');
    git(tree, 'merge', '--quiet', '--no-ff', '--message', 'Merge branch side', 'side');
    tag(tree, 'v1.2.0');
    const result = await notes(
      '--tag',
      'v1.2.0',
      '--image',
      'ghcr.io/example/gcportrait',
      '--digest',
      `sha256:${'0'.repeat(64)}`,
      '--latest',
      'true',
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      [
        NON_AFFILIATION_LONG,
        '',
        '## Changes',
        '',
        'The commits since `v1.1.0`, oldest first, one group per area:',
        '',
        '### App',
        '',
        '- collapse all follows the drawing',
        '',
        '### Docs',
        '',
        '- the guide names the flag',
        '',
        '### Other',
        '',
        '- Other work without an area marker',
        '',
        '### Backend',
        '',
        '- read folders too',
        '',
        '### Tests',
        '',
        '- cover the folders',
        '',
        '## Deploy',
        '',
        'Deploy this release to Cloud Run in a Google Cloud project of yours; the project id is all it needs',
        '(docs/self-host.md):',
        '',
        '```sh',
        'curl -fsSL https://gcportrait.app/install.sh | bash -s -- --version v1.2.0 --project YOUR_PROJECT',
        '```',
        '',
        'The installer downloads `gcportrait-deploy-v1.2.0.tar.gz` from this release, checks its SHA-256 against',
        "`checksums.txt` before it unpacks or runs anything, and runs the release's `infra/deploy.sh` with this release's",
        'image. It ends with the next steps: open the address, create the OAuth client, redeploy with its id.',
        '',
        '## Container image',
        '',
        `\`ghcr.io/example/gcportrait\`, for linux/amd64 and linux/arm64, tagged \`1.2.0\`, \`1.2\`, \`latest\`; digest \`sha256:${'0'.repeat(64)}\`.`,
        '',
        'Run it on your machine:',
        '',
        '```sh',
        'docker run --rm --publish 127.0.0.1:8080:8080 ghcr.io/example/gcportrait:1.2.0',
        '```',
        '',
        'The SPDX software bills of materials of both platform images are attached to this release; `checksums.txt`',
        'lists the SHA-256 of every file attached to it.',
        '',
      ].join('\n'),
    );
  });

  it('counts from the last final release, so a release after a pre-release lists every commit since it', async () => {
    commit(tree, 'App: a change the pre-release carried');
    tag(tree, 'v1.3.0-rc.1');
    commit(tree, 'App: a fix the pre-release did not have');
    tag(tree, 'v1.3.0');
    const release = await notes('--tag', 'v1.3.0');
    expect(release.status, release.stderr).toBe(0);
    expect(changesOf(release.stdout)).toContain('- a change the pre-release carried');
    expect(changesOf(release.stdout)).toContain('- a fix the pre-release did not have');
    expect(changesOf(release.stdout)).toContain('since `v1.2.0`');
  });

  it('names only the tags the image gets: no X.Y for a pre-release, latest only for the newest release', async () => {
    commit(tree, 'App: a pre-release candidate');
    tag(tree, 'v1.4.0-rc.1');
    const pre = await notes('--tag', 'v1.4.0-rc.1', '--image', 'ghcr.io/example/gcportrait');
    expect(pre.status, pre.stderr).toBe(0);
    expect(pre.stdout).toContain('tagged `1.4.0-rc.1`.');
    const patch = await notes(
      '--tag',
      'v1.2.0',
      '--image',
      'ghcr.io/example/gcportrait',
      '--latest',
      'false',
    );
    expect(patch.status, patch.stderr).toBe(0);
    expect(patch.stdout).toContain('tagged `1.2.0`, `1.2`.');
    expect(changesOf(patch.stdout)).toContain('- collapse all follows the drawing');
  });

  it('lists the version’s section of CHANGELOG.md when the maintainer wrote one', async () => {
    tree.write(
      'CHANGELOG.md',
      [
        '# Changelog',
        '',
        '## 1.2.0 (2026-10-12)',
        '',
        'The drawings keep their contrast in both themes.',
        '',
        '### Highlights',
        '',
        '- A highlight.',
        '',
        NON_AFFILIATION_LONG,
        '',
        '## 1.1.0',
        '',
        'The first release.',
        '',
      ].join('\n'),
    );
    const release = await notes('--tag', 'v1.2.0');
    expect(release.status, release.stderr).toBe(0);
    expect(changesOf(release.stdout)).toBe(
      ['The drawings keep their contrast in both themes.', '', '### Highlights', '', '- A highlight.'].join(
        '\n',
      ),
    );
    expect(release.stdout.split(NON_AFFILIATION_LONG).length - 1).toBe(1);
    // A pre-release tag without a section of its own takes the section of the release it precedes.
    tag(tree, 'v1.2.0-rc.1');
    const pre = await notes('--tag', 'v1.2.0-rc.1');
    expect(pre.status, pre.stderr).toBe(0);
    expect(pre.stdout).toContain("A pre-release of 1.2.0, published for checking; its notes are 1.2.0's.");
    expect(changesOf(pre.stdout)).toBe(changesOf(release.stdout));
    expect(pre.stdout).toContain('bash -s -- --version v1.2.0-rc.1 --project YOUR_PROJECT');
  });

  it('lists every commit of the repository for the first release', async () => {
    const first = createTempTree('release-notes-first');
    try {
      first.write('pnpm-workspace.yaml', WORKSPACE);
      git(first, 'init', '--quiet', '--initial-branch', 'main');
      commit(first, 'gcportrait: initial commit');
      commit(first, 'App: the first feature');
      tag(first, 'v1.0.0');
      const result = await runInProcess(() => run(['--root', first.root, '--tag', 'v1.0.0']));
      expect(result.status, result.stderr).toBe(0);
      expect(changesOf(result.stdout)).toContain('Every commit of the repository, oldest first');
      expect(changesOf(result.stdout)).toContain('- initial commit');
      expect(changesOf(result.stdout)).toContain('- the first feature');
    } finally {
      first.remove();
    }
  });

  it('reads a version’s section of the repository’s own CHANGELOG.md, the long form once', () => {
    const own = releaseNotes({ root: REPO, tag: 'v1.0.0', packageVersion: '1.0.0' });
    expect(own.startsWith(`${NON_AFFILIATION_LONG}\n\n## Changes\n\n`)).toBe(true);
    expect(own.split(NON_AFFILIATION_LONG).length - 1).toBe(1);
    for (const heading of ['Highlights', 'Diagrams', 'Timeline', 'Self-hosting', 'Known limitations']) {
      expect(own).toContain(`### ${heading}\n`);
    }
    // The 1.0.0 heading names its date, which the section still matches.
    expect(changelogSection('## 1.0.0 (2026-10-12)\n\nThe first release.\n', '1.0.0')).toBe(
      'The first release.',
    );
  });

  it('refuses a tag the tree does not have, and bad arguments', async () => {
    const missing = await notes('--tag', 'v9.9.9');
    expect(missing.status).toBe(2);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toContain('release-notes: the tree has no tag v9.9.9');
    expect((await notes('--tag', '1.2.0')).status).toBe(2);
    expect((await notes('--tag', 'v1.2.0', '--latest', 'yes')).status).toBe(2);
    expect((await notes('--tag', 'v1.2.0', '--unknown')).status).toBe(2);
    expect((await notes()).status).toBe(2);
  });

  it(
    'runs as a command of its own: the output `run` gives in-process, and its exit code',
    SPAWN_TIMEOUT,
    async () => {
      const args = ['--root', tree.root, '--tag', 'v9.9.9'];
      const command = runScript('release-notes.mjs', args);
      expect(command.status).toBe(2);
      expect(command).toEqual(await runInProcess(() => run(args)));
    },
  );
});
