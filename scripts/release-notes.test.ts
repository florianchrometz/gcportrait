// SPDX-License-Identifier: MIT
/**
 * scripts/release-notes.mjs: the GitHub release's notes from the CHANGELOG.md sections changesets
 * writes, run end to end on synthetic workspaces.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NON_AFFILIATION_LONG, releaseNotes } from './release-notes.mjs';
import { REPO, createTempTree, runScript, type TempTree } from './testing/temp-tree.js';

/** A changelog the way `changeset version` writes it (@changesets/cli/changelog). */
const BACKEND = `# @gcportrait/backend

## 1.2.0

### Minor Changes

- 1a2b3c4: Service-account mode reads folders too.
  A second line of the same entry.
- 5d6e7f8: Shared change, listed by every package it names.

### Patch Changes

- 9a8b7c6: A fix in the backend.
- Updated dependencies [1a2b3c4]
  - @gcportrait/model@1.2.0

## 1.1.0

### Minor Changes

- 0f0f0f0: An older change.
`;

const FRONTEND = `# @gcportrait/frontend

## 1.2.0

### Major Changes

- abcdef1: The export menu moved.

### Minor Changes

- 5d6e7f8: Shared change, listed by every package it names.

### Patch Changes

- Updated dependencies [5d6e7f8]
  - @gcportrait/model@1.2.0
`;

const WORKSPACE = "packages:\n  - frontend\n  - backend\n  - 'packages/*'\n  - website\n";

/** The notes' "Changes" section, between its heading and the next one. */
const changesOf = (text: string) => /\n## Changes\n\n([\s\S]*?)\n+## Deploy\n/.exec(text)?.[1];

describe('release-notes.mjs', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = createTempTree('release-notes');
    tree.write('pnpm-workspace.yaml', WORKSPACE);
    tree.write('backend/CHANGELOG.md', BACKEND);
    tree.write('frontend/CHANGELOG.md', FRONTEND);
    // A package without a section for the version, and one without a changelog.
    tree.write(
      'packages/model/CHANGELOG.md',
      '# @gcportrait/model\n\n## 1.1.0\n\n### Minor Changes\n\n- 0f0f0f0: Old.\n',
    );
    tree.write('packages/layout/package.json', '{}\n');
  });

  afterEach(() => {
    tree.remove();
  });

  const notes = (...args: string[]) => runScript('release-notes.mjs', ['--root', tree.root, ...args]);

  it('lists each change of the version once, by kind, without hashes and dependency bookkeeping', () => {
    const result = notes(
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
        '### Major changes',
        '',
        '- The export menu moved.',
        '',
        '### Minor changes',
        '',
        '- Service-account mode reads folders too.',
        '  A second line of the same entry.',
        '- Shared change, listed by every package it names.',
        '',
        '### Patch changes',
        '',
        '- A fix in the backend.',
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

  it('names only the tags the image gets: no X.Y for a pre-release, latest only for the newest release', () => {
    tree.write('backend/CHANGELOG.md', BACKEND.replace('## 1.2.0', '## 1.3.0-rc.1'));
    const pre = notes('--tag', 'v1.3.0-rc.1', '--image', 'ghcr.io/example/gcportrait');
    expect(pre.status, pre.stderr).toBe(0);
    expect(pre.stdout).toContain('tagged `1.3.0-rc.1`.');
    const older = notes('--tag', 'v1.1.0', '--image', 'ghcr.io/example/gcportrait', '--latest', 'false');
    expect(older.status, older.stderr).toBe(0);
    expect(older.stdout).toContain('tagged `1.1.0`, `1.1`.');
    expect(older.stdout).toContain('- An older change.');
    expect(older.stdout).not.toContain('Shared change');
  });

  it('takes the notes of the release a pre-release precedes when it has no section of its own', () => {
    const release = notes('--tag', 'v1.2.0');
    const pre = notes('--tag', 'v1.2.0-rc.1', '--image', 'ghcr.io/example/gcportrait', '--latest', 'false');
    expect(pre.status, pre.stderr).toBe(0);
    expect(
      pre.stdout.startsWith(
        `${NON_AFFILIATION_LONG}\n\n` +
          "A pre-release of 1.2.0, published for checking; its notes are 1.2.0's.\n\n" +
          '## Changes\n\n### Major changes\n\n- The export menu moved.\n',
      ),
    ).toBe(true);
    expect(changesOf(release.stdout)).toContain('- A fix in the backend.');
    expect(changesOf(pre.stdout)).toBe(changesOf(release.stdout));
    expect(pre.stdout).toContain('bash -s -- --version v1.2.0-rc.1 --project YOUR_PROJECT');
    expect(pre.stdout).toContain('tagged `1.2.0-rc.1`.');
    expect(pre.stdout).toContain('ghcr.io/example/gcportrait:1.2.0-rc.1');
    expect(release.stdout).not.toContain('A pre-release of');
  });

  it('takes a pre-release’s own sections when a changelog has them, not those of its release', () => {
    tree.write(
      'backend/CHANGELOG.md',
      BACKEND.replace(
        '## 1.1.0',
        '## 1.2.0-rc.1\n\n### Minor Changes\n\n- 2b3c4d5: Only in the pre-release.\n\n## 1.1.0',
      ),
    );
    const pre = notes('--tag', 'v1.2.0-rc.1');
    expect(pre.status, pre.stderr).toBe(0);
    expect(changesOf(pre.stdout)).toBe('### Minor changes\n\n- Only in the pre-release.');
    expect(pre.stdout).not.toContain('A pre-release of');
    expect(pre.stdout).not.toContain('The export menu moved.');
  });

  it('finds no notes for a pre-release of a version no changelog has', () => {
    expect(releaseNotes({ root: tree.root, tag: 'v9.9.9-rc.1' })).toBeNull();
    const missing = notes('--tag', 'v9.9.9-rc.1');
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toContain('no CHANGELOG.md has a section "## 9.9.9-rc.1" or "## 9.9.9".');
  });

  it('keeps the long form once when an entry repeats it, wrapped as the hand-written notes wrap it', () => {
    const wrapped = NON_AFFILIATION_LONG.replace('project and is ', 'project and is\n  ').replace(
      'Google Cloud product icons are ',
      'Google Cloud product icons are\n  ',
    );
    tree.write(
      'backend/CHANGELOG.md',
      `# @gcportrait/backend\n\n## 2.0.0\n\n### Major Changes\n\n- The first release.\n  \n  ${wrapped}\n  \n  ### Highlights\n  \n  - A highlight.\n`,
    );
    const result = notes('--tag', 'v2.0.0');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.split('is not affiliated with').length - 1).toBe(1);
    expect(result.stdout).toContain(
      ['- The first release.', '', '  ### Highlights', '', '  - A highlight.'].join('\n'),
    );
  });

  it('writes the notes of the repository’s own 1.0.0 release: one major change, the long form once', () => {
    const own = releaseNotes({ root: REPO, tag: 'v1.0.0' });
    expect(own).not.toBeNull();
    const text = own ?? '';
    expect(
      text.startsWith(
        `${NON_AFFILIATION_LONG}\n\n## Changes\n\n### Major changes\n\n- The first release of gcportrait.\n`,
      ),
    ).toBe(true);
    expect(text.split(NON_AFFILIATION_LONG).length - 1).toBe(1);
    expect(text.split('\n- ').length - 1).toBe(1);
    for (const heading of [
      'Highlights',
      'Diagrams',
      'Timeline',
      'Self-hosting',
      'Known limitations',
      'Licence',
    ])
      expect(text).toContain(`  ### ${heading}\n`);
    expect(text).not.toContain('Patch changes');
    expect(text).not.toContain('Updated dependencies');
    // A pre-release of it, v1.0.0-rc.1, has no section of its own and carries the same changes.
    const pre = releaseNotes({ root: REPO, tag: 'v1.0.0-rc.1' }) ?? '';
    expect(pre).toContain("A pre-release of 1.0.0, published for checking; its notes are 1.0.0's.");
    expect(changesOf(text)).toContain('- The first release of gcportrait.');
    expect(changesOf(pre)).toBe(changesOf(text));
  });

  it('refuses a version that no changelog has, and bad arguments', () => {
    const missing = notes('--tag', 'v9.9.9');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('no CHANGELOG.md has a section "## 9.9.9"');
    expect(missing.stderr).toContain('pnpm release:version');
    expect(notes('--tag', '1.2.0').status).toBe(2);
    expect(notes('--tag', 'v1.2.0', '--latest', 'yes').status).toBe(2);
    expect(notes('--tag', 'v1.2.0', '--unknown').status).toBe(2);
    expect(notes().status).toBe(2);
  });
});
