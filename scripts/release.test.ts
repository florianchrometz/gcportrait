// SPDX-License-Identifier: Apache-2.0
/**
 * Release tooling consistency checks: verifying that release tags (vX.Y.Z) match package.json#version
 * across scripts/release-notes.mjs and scripts/release-image.mjs.
 */
import { execFileSync } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ReleaseError,
  imageMeta,
  main as imageMain,
  packageVersionOf as imagePackageVersionOf,
} from './release-image.mjs';
import {
  UsageError,
  packageVersionOf as notesPackageVersionOf,
  releaseNotes,
  run as notesRun,
} from './release-notes.mjs';
import { REPO, createTempTree, runInProcess, type TempTree } from './testing/temp-tree.js';

const DOCKERFILE = `FROM scratch
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="gcportrait" \\
      org.opencontainers.image.description="Description." \\
      org.opencontainers.image.licenses="Apache-2.0" \\
      org.opencontainers.image.version="\${APP_VERSION}"
`;

const SHA = '0123456789abcdef0123456789abcdef01234567';
const CREATED = '2026-10-18T00:00:00.000Z';

const git = (tree: TempTree, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=gcportrait test', '-c', 'user.email=test@example.com', ...args], {
    cwd: tree.root,
    encoding: 'utf8',
  });

describe('release tag vs package.json version guard', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = createTempTree('release-guard');
    tree.write('package.json', JSON.stringify({ name: 'gcportrait', version: '1.2.3' }, null, 2) + '\n');
    tree.write('infra/Dockerfile', DOCKERFILE);
    git(tree, 'init', '--quiet', '--initial-branch', 'main');
    git(tree, 'commit', '--allow-empty', '--quiet', '--message', 'App: initial commit');
    git(tree, 'tag', 'v1.2.3');
  });

  afterEach(() => {
    tree.remove();
  });

  describe('packageVersionOf', () => {
    it('reads the version string from package.json under root', () => {
      expect(notesPackageVersionOf(tree.root)).toBe('1.2.3');
      expect(imagePackageVersionOf(tree.root)).toBe('1.2.3');
      expect(notesPackageVersionOf(REPO)).toBe('1.0.0');
      expect(imagePackageVersionOf(REPO)).toBe('1.0.0');
    });

    it('returns undefined when package.json does not exist or is invalid', () => {
      const emptyTree = createTempTree('empty-pkg');
      try {
        expect(notesPackageVersionOf(emptyTree.root)).toBeUndefined();
        expect(imagePackageVersionOf(emptyTree.root)).toBeUndefined();
        emptyTree.write('package.json', 'not-valid-json');
        expect(notesPackageVersionOf(emptyTree.root)).toBeUndefined();
        expect(imagePackageVersionOf(emptyTree.root)).toBeUndefined();
      } finally {
        emptyTree.remove();
      }
    });
  });

  describe('release-notes.mjs tag guard', () => {
    it('succeeds when tag matches package.json version', () => {
      const notes = releaseNotes({
        root: tree.root,
        tag: 'v1.2.3',
      });
      expect(notes).toContain('## Changes');
    });

    it('succeeds when tag matches explicit packageVersion option', () => {
      const notes = releaseNotes({
        root: tree.root,
        tag: 'v1.2.3',
        packageVersion: '1.2.3',
      });
      expect(notes).toContain('## Changes');
    });

    it('throws UsageError when tag does not match root package.json version', () => {
      git(tree, 'tag', 'v1.2.4');
      expect(() =>
        releaseNotes({
          root: tree.root,
          tag: 'v1.2.4',
        }),
      ).toThrow(UsageError);
      expect(() =>
        releaseNotes({
          root: tree.root,
          tag: 'v1.2.4',
        }),
      ).toThrow('release tag v1.2.4 does not match package.json version 1.2.3');
    });

    it('throws UsageError when tag does not match explicit packageVersion option', () => {
      expect(() =>
        releaseNotes({
          root: tree.root,
          tag: 'v1.2.3',
          packageVersion: '1.2.0',
        }),
      ).toThrow('release tag v1.2.3 does not match package.json version 1.2.0');
    });

    it('exits with code 2 via run() CLI on version mismatch', async () => {
      git(tree, 'tag', 'v1.9.9');
      const result = await runInProcess(() => notesRun(['--root', tree.root, '--tag', 'v1.9.9']));
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('release tag v1.9.9 does not match package.json version 1.2.3');
    });
  });

  describe('release-image.mjs tag guard', () => {
    it('succeeds when tag matches packageVersion', () => {
      const result = imageMeta({
        event: 'push',
        tag: 'v1.2.3',
        sha: SHA,
        repository: 'example/gcportrait',
        serverUrl: 'https://github.com',
        created: CREATED,
        releaseTags: ['v1.2.3'],
        dockerfile: DOCKERFILE,
        packageVersion: '1.2.3',
      });
      expect(result.appVersion).toBe('v1.2.3');
      expect(result.latest).toBe(true);
    });

    it('throws ReleaseError when tag does not match packageVersion', () => {
      expect(() =>
        imageMeta({
          event: 'push',
          tag: 'v1.2.4',
          sha: SHA,
          repository: 'example/gcportrait',
          serverUrl: 'https://github.com',
          created: CREATED,
          releaseTags: ['v1.2.4'],
          dockerfile: DOCKERFILE,
          packageVersion: '1.2.3',
        }),
      ).toThrow(ReleaseError);
      expect(() =>
        imageMeta({
          event: 'push',
          tag: 'v1.2.4',
          sha: SHA,
          repository: 'example/gcportrait',
          serverUrl: 'https://github.com',
          created: CREATED,
          releaseTags: ['v1.2.4'],
          dockerfile: DOCKERFILE,
          packageVersion: '1.2.3',
        }),
      ).toThrow('release tag v1.2.4 does not match package.json version 1.2.3');
    });

    it('ignores packageVersion check on workflow_dispatch event with non-v tag', () => {
      const result = imageMeta({
        event: 'workflow_dispatch',
        tag: 'main',
        sha: SHA,
        repository: 'example/gcportrait',
        serverUrl: 'https://github.com',
        created: CREATED,
        releaseTags: [],
        dockerfile: DOCKERFILE,
        packageVersion: '1.2.3',
      });
      expect(result.appVersion).toBe(`dev-${SHA.slice(0, 7)}`);
    });

    it('validates version when invoked via main() with root containing package.json', () => {
      const output = imageMain([
        '--event',
        'push',
        '--tag',
        'v1.2.3',
        '--sha',
        SHA,
        '--repository',
        'example/gcportrait',
        '--root',
        tree.root,
        '--created',
        CREATED,
      ]);
      expect(output).toContain('app_version=v1.2.3\n');

      expect(() =>
        imageMain([
          '--event',
          'push',
          '--tag',
          'v1.9.9',
          '--sha',
          SHA,
          '--repository',
          'example/gcportrait',
          '--root',
          tree.root,
          '--created',
          CREATED,
        ]),
      ).toThrow('release tag v1.9.9 does not match package.json version 1.2.3');
    });
  });
});
