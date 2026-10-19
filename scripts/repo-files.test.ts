// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listRepoFiles } from './lib/repo-files.mjs';
import { createTempTree, REPO, type TempTree } from './testing/temp-tree.js';

let tree: TempTree;

beforeEach(() => {
  tree = createTempTree('repo-files');
});

afterEach(() => {
  tree.remove();
});

function git(...args: string[]): string {
  const result = spawnSync('git', args, { cwd: tree.root, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

const paths = () => listRepoFiles(tree.root).map((file) => file.relPath);

describe('repository file listing', () => {
  it('uses repository ignore files, including nested negations and ignored generated output', () => {
    git('init', '--quiet');
    tree.write('.gitignore', readFileSync(path.join(REPO, '.gitignore'), 'utf8'));
    tree.write('e2e/.gitignore', '.scratch/\n*.tmp\n!keep.tmp\n');
    tree.write('packages/catalog/src/generated/compiled-catalog.ts', 'generated');
    tree.write('e2e/.scratch/image.png', 'scratch');
    tree.write('e2e/drop.tmp', 'ignored');
    tree.write('e2e/keep.tmp', 'kept');
    tree.write('src/space and\nnewline.ts', 'kept');
    tree.write('src/nested/dist/source.ts', 'kept');
    tree.write('e2e/.gitignore', `${tree.read('e2e/.gitignore')}extra/\n`);
    tree.write('e2e/extra/result.ts', 'ignored');
    const expected = git('ls-files', '-z', '--cached', '--others', '--exclude-per-directory=.gitignore')
      .split('\0')
      .filter(Boolean)
      .sort();
    expect(paths()).toEqual(expected);
    expect(paths()).toContain('e2e/keep.tmp');
    expect(paths()).not.toContain('packages/catalog/src/generated/compiled-catalog.ts');
  });

  it('does not let personal or repository-local excludes hide untracked files', () => {
    git('init', '--quiet');
    tree.write('.git/global-excludes', 'global.ts\n');
    tree.write('.git/info/exclude', 'local.ts\n');
    git('config', 'core.excludesFile', path.join(tree.root, '.git/global-excludes'));
    tree.write('global.ts', 'kept');
    tree.write('local.ts', 'kept');
    expect(paths()).toEqual(['global.ts', 'local.ts']);
  });

  it('keeps force-added ignored files, skips deleted files and returns each path once in order', () => {
    git('init', '--quiet');
    tree.write('.gitignore', 'ignored/\n');
    tree.write('ignored/kept.ts', 'kept');
    tree.write('src/.claude/notes.md', 'tracked');
    tree.write('deleted.ts', 'removed');
    tree.write('z.ts', 'kept');
    git('add', '--force', 'ignored/kept.ts', 'src/.claude/notes.md', 'deleted.ts', 'z.ts');
    rmSync(path.join(tree.root, 'deleted.ts'));
    tree.write('a.ts', 'kept');
    expect(paths()).toEqual(['.gitignore', 'a.ts', 'ignored/kept.ts', 'src/.claude/notes.md', 'z.ts']);
  });

  it('excludes untracked assistant and environment paths even without ignore entries', () => {
    git('init', '--quiet');
    for (const name of [
      'CLAUDE.md',
      'src/GEMINI.md',
      'src/.claude/settings.json',
      '.clinerules/rules.md',
      '.github/copilot-instructions.md',
      '.github/instructions/one.md',
      '.env',
      'backend/.env.local',
    ])
      tree.write(name, 'private');
    tree.write('.env.example', 'public');
    tree.write('AGENTS.md', 'public');
    expect(paths()).toEqual(['.env.example', 'AGENTS.md']);
  });

  it('returns symlinks without following them', () => {
    git('init', '--quiet');
    tree.write('.gitignore', 'ignored/\n');
    tree.write('ignored/target.ts', 'private');
    symlinkSync('ignored', path.join(tree.root, 'linked'));
    symlinkSync('missing', path.join(tree.root, 'broken'));
    expect(
      listRepoFiles(tree.root)
        .filter((file) => file.isSymlink)
        .map((file) => file.relPath),
    ).toEqual(['broken', 'linked']);
    expect(paths()).not.toContain('linked/target.ts');
  });

  it.each(['tracked', 'ignored/nested'])(
    'reports the linked ancestor of tracked paths under %s',
    (directory) => {
      git('init', '--quiet');
      tree.write('.gitignore', 'ignored/\n');
      tree.write(`${directory}/first.ts`, 'inside');
      tree.write(`${directory}/deeper/second.ts`, 'inside');
      git('add', '--force', directory);
      const outside = createTempTree('outside');
      try {
        outside.write('first.ts', 'outside');
        outside.write('deeper/second.ts', 'outside');
        rmSync(path.join(tree.root, directory), { recursive: true });
        symlinkSync(outside.root, path.join(tree.root, directory));
        expect(listRepoFiles(tree.root)).toEqual([
          { absPath: path.join(tree.root, '.gitignore'), relPath: '.gitignore', isSymlink: false },
          { absPath: path.join(tree.root, directory), relPath: directory, isSymlink: true },
        ]);
      } finally {
        outside.remove();
      }
    },
  );

  it('reports a broken linked ancestor even under an ignored path', () => {
    git('init', '--quiet');
    tree.write('.gitignore', 'ignored\n');
    tree.write('ignored/tracked.ts', 'inside');
    git('add', '--force', 'ignored/tracked.ts');
    rmSync(path.join(tree.root, 'ignored'), { recursive: true });
    symlinkSync('missing', path.join(tree.root, 'ignored'));
    expect(listRepoFiles(tree.root).find((file) => file.relPath === 'ignored')).toMatchObject({
      isSymlink: true,
    });
    expect(paths()).toEqual(['.gitignore', 'ignored']);
  });

  it('checks an ordinary file replacing a tracked ancestor without an ENOTDIR error', () => {
    git('init', '--quiet');
    tree.write('.gitignore', 'tracked\n');
    tree.write('tracked/deeper/file.ts', 'inside');
    git('add', '--force', 'tracked/deeper/file.ts');
    rmSync(path.join(tree.root, 'tracked'), { recursive: true });
    tree.write('tracked', 'replacement');
    expect(paths()).toEqual(['.gitignore', 'tracked']);
    rmSync(path.join(tree.root, 'tracked'));
    expect(paths()).toEqual(['.gitignore']);
  });

  it('accepts a work tree whose .git is a file', () => {
    git('init', '--quiet', '--separate-git-dir', path.join(tree.root, '.git-data'));
    tree.write('.gitignore', '.git-data/\nignored/\n');
    tree.write('ignored/result.ts', 'ignored');
    tree.write('source.ts', 'kept');
    expect(paths()).toEqual(['.gitignore', 'source.ts']);
  });

  it.each([false, true])(
    'uses each nested repository’s own ignore and tracked rules (tracked submodule: %s)',
    (tracked) => {
      git('init', '--quiet');
      tree.write('.gitignore', '/ignored-repo/\n*.cache\n');
      tree.write('ignored-repo/source.ts', 'ignored');
      git('init', '--quiet', 'ignored-repo');
      tree.write('nested/source.ts', 'kept');
      const metadata = tracked ? '.git/nested' : 'nested/.git';
      if (tracked) git('init', '--quiet', '--separate-git-dir', path.join(tree.root, metadata), 'nested');
      else git('init', '--quiet', 'nested');
      if (tracked) git('update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},nested`);
      tree.write('nested/.env', 'private');
      tree.write('nested/.claude/settings.json', 'private');
      tree.write('nested/.github/copilot-instructions.md', 'private');
      tree.write('nested/.gitignore', '*.tmp\n');
      tree.write('nested/custom.tmp', 'ignored');
      tree.write('nested/forced.tmp', 'tracked');
      tree.write('nested/ancestor/source.ts', 'tracked');
      git('-C', 'nested', 'add', '--force', 'forced.tmp', 'ancestor/source.ts');
      rmSync(path.join(tree.root, 'nested/ancestor'), { recursive: true });
      symlinkSync('../ignored-repo', path.join(tree.root, 'nested/ancestor'));
      tree.write('nested/parent.cache', 'parent content rules stop at repository boundary');
      tree.write(`${metadata}/global-excludes`, 'global.ts\n');
      tree.write(`${metadata}/info/exclude`, 'local.ts\n');
      git('-C', 'nested', 'config', 'core.excludesFile', path.join(tree.root, metadata, 'global-excludes'));
      tree.write('nested/global.ts', 'kept');
      tree.write('nested/local.ts', 'kept');
      symlinkSync('../ignored-repo', path.join(tree.root, 'nested/linked'));
      expect(paths()).toEqual([
        '.gitignore',
        'nested/.gitignore',
        'nested/ancestor',
        'nested/forced.tmp',
        'nested/global.ts',
        'nested/linked',
        'nested/local.ts',
        'nested/parent.cache',
        'nested/source.ts',
      ]);
      expect(listRepoFiles(tree.root).find((file) => file.relPath === 'nested/linked')).toMatchObject({
        isSymlink: true,
      });
      expect(listRepoFiles(tree.root).find((file) => file.relPath === 'nested/ancestor')).toMatchObject({
        isSymlink: true,
      });
    },
  );

  it('keeps the filesystem fallback without git metadata', () => {
    tree.write('source.ts', 'kept');
    tree.write('node_modules/pkg/index.js', 'ignored');
    tree.write('backend/.env', 'private');
    expect(paths()).toEqual(['source.ts']);
  });

  it('keeps the filesystem fallback when git is unavailable', () => {
    git('init', '--quiet');
    tree.write('source.ts', 'kept');
    tree.write('node_modules/pkg/index.js', 'ignored');
    const moduleUrl = pathToFileURL(path.join(REPO, 'scripts/lib/repo-files.mjs')).href;
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { listRepoFiles } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(listRepoFiles(${JSON.stringify(tree.root)}).map(file => file.relPath)));`,
      ],
      { encoding: 'utf8', env: { ...process.env, PATH: '' } },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(['source.ts']);
  });

  it('fails closed when existing git metadata cannot be read', () => {
    tree.write('.git', 'gitdir: does-not-exist\n');
    tree.write('source.ts', 'kept');
    expect(() => paths()).toThrow();
  });
});
