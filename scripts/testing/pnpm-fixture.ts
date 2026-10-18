// SPDX-License-Identifier: Apache-2.0
/**
 * Throw-away pnpm projects for the dependency tooling's tests (check-licenses, third-party-notices): packages planted
 * under vendor/ as `file:` dependencies, installed offline, so no test needs the network.
 */
import { spawnSync } from 'node:child_process';

import { expect } from 'vitest';

import type { TempTree } from './temp-tree.js';

/** A JSON file's text as the repository writes it: two-space indent, a final newline. */
export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Plants the package `name` at vendor/<name>: its package.json (version 1.0.0 unless `manifest` names one, and the
 * other fields of `manifest`) and `files` beside it.
 */
export function plant(
  tree: TempTree,
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
): void {
  tree.write(`vendor/${name}/package.json`, json({ name, version: '1.0.0', ...manifest }));
  for (const [file, text] of Object.entries(files)) tree.write(`vendor/${name}/${file}`, text);
}

/** `pnpm install`, offline and without scripts, of the tree as written; fails the test when it fails. */
export function installOffline(tree: TempTree): void {
  const install = spawnSync(
    'pnpm',
    ['install', '--offline', '--no-frozen-lockfile', '--ignore-scripts', '--reporter=silent'],
    {
      cwd: tree.root,
      encoding: 'utf8',
      env: { ...process.env, npm_config_update_notifier: 'false' },
      shell: process.platform === 'win32',
    },
  );
  expect(install.status, `pnpm install failed:\n${install.stdout}\n${install.stderr}`).toBe(0);
}
