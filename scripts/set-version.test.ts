// SPDX-License-Identifier: Apache-2.0
/**
 * scripts/set-version.mjs: one command sets the fixed version of the root and every workspace package, keeping
 * each package.json's formatting, and writes nothing when a manifest has no version to set.
 */
import { Console } from 'node:console';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { manifestsOf, run, withVersion } from './set-version.mjs';
import {
  FIXTURE_LICENSE,
  SPAWN_TIMEOUT,
  createTempTree,
  runInProcess,
  runScript,
  type TempTree,
} from './testing/temp-tree.js';

const WORKSPACE = "packages:\n  - app\n  - 'packages/*'\n";

/** A manifest as the repository's own are formatted: two spaces, the version first. */
const manifest = (version: string) =>
  [
    '{',
    '  "name": "fixture",',
    `  "version": "${version}",`,
    `  "license": "${FIXTURE_LICENSE}"`,
    '}',
    '',
  ].join('\n');

describe('set-version.mjs', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = createTempTree('set-version');
    tree.write('pnpm-workspace.yaml', WORKSPACE);
    tree.write('package.json', manifest('1.0.0'));
    tree.write('app/package.json', manifest('1.0.0'));
    tree.write('packages/a/package.json', manifest('1.0.0'));
    const output = new Console(process.stdout, process.stderr);
    vi.spyOn(console, 'log').mockImplementation(output.log.bind(output));
    vi.spyOn(console, 'error').mockImplementation(output.error.bind(output));
  });

  afterEach(() => {
    tree.remove();
    vi.restoreAllMocks();
  });

  const setVersion = (...args: string[]) => runInProcess(() => run(['--root', tree.root, ...args]));

  it('sets the version of the root and of every workspace package, keeping the formatting', async () => {
    const result = await setVersion('1.4.0');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('set the version to 1.4.0 in 3 package.json file(s).');
    for (const file of ['package.json', 'app/package.json', 'packages/a/package.json']) {
      expect(tree.read(file)).toBe(manifest('1.4.0'));
    }
  });

  it('lists the manifests of the workspace file, the root first', () => {
    expect(manifestsOf(tree.root)).toEqual(['package.json', 'app/package.json', 'packages/a/package.json']);
  });

  it('takes a pre-release version, and writes nothing on a dry run', async () => {
    const result = await setVersion('2.0.0-rc.1', '--dry-run');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('would set the version to 2.0.0-rc.1 in 3 package.json file(s)');
    expect(result.stdout).toContain('nothing was written');
    expect(tree.read('package.json')).toBe(manifest('1.0.0'));
  });

  it('leaves a manifest without a version field alone, and writes nothing at all', async () => {
    tree.write('packages/a/package.json', '{\n  "name": "fixture"\n}\n');
    const result = await setVersion('1.4.0');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('packages/a/package.json is not JSON with a top-level "version" field');
    expect(tree.read('package.json')).toBe(manifest('1.0.0'));
    expect(tree.read('app/package.json')).toBe(manifest('1.0.0'));
  });

  it('refuses a version that is not X.Y.Z, a missing manifest, and unknown options', async () => {
    expect((await setVersion('1.4')).status).toBe(2);
    expect((await setVersion('v1.4.0')).status).toBe(2);
    expect((await setVersion()).status).toBe(2);
    expect((await setVersion('1.4.0', '--bogus')).status).toBe(2);
    expect(withVersion('not json', '1.4.0')).toBeUndefined();
    expect(withVersion('{ "version": "1.0.0" }\n', '1.4.0')).toBe('{ "version": "1.4.0" }\n');
  });

  it(
    'runs as a command of its own: the output `run` gives in-process, and its exit code',
    SPAWN_TIMEOUT,
    async () => {
      const args = ['--root', tree.root, '--dry-run', '1.4.0'];
      const command = runScript('set-version.mjs', args);
      expect(command.status).toBe(0);
      expect(command).toEqual(await runInProcess(() => run(args)));
    },
  );
});
