// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * The workspace's package directories, as pnpm-workspace.yaml lists them: the tools that touch every
 * package.json of the tree (scripts/set-version.mjs) or read a package's files (scripts/release-notes.mjs)
 * take the list from there, so a new package is a change to the workspace file only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The workspace package directories of pnpm-workspace.yaml (its `packages:` list; `dir/*` expanded one level),
 * relative to `root` and sorted, the ones that exist only.
 * @param {string} root
 * @returns {string[]}
 */
export function workspaceDirs(root) {
  const manifest = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  const list = /^packages:\s*\n((?:[ \t]+-[^\n]*\n?)+)/m.exec(manifest)?.[1] ?? '';
  /** @type {string[]} */
  const dirs = [];
  for (const line of list.split('\n')) {
    const entry = /^\s+-\s*['"]?([^'"#\s]+)['"]?/.exec(line)?.[1];
    if (entry === undefined) continue;
    if (entry.endsWith('/*')) {
      const parent = entry.slice(0, -2);
      if (!existsSync(path.join(root, parent))) continue;
      for (const child of readdirSync(path.join(root, parent)).sort()) {
        if (statSync(path.join(root, parent, child)).isDirectory()) dirs.push(path.join(parent, child));
      }
    } else if (existsSync(path.join(root, entry))) {
      dirs.push(entry);
    }
  }
  return dirs.sort();
}
