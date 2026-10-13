// SPDX-License-Identifier: MIT
/**
 * scripts/check-licenses.mjs end to end, on throw-away pnpm projects: each test plants dependencies with chosen
 * licences as local packages (`file:` dependencies, so the install needs no network), installs them with pnpm
 * offline, and runs the guard on the tree with --root.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { installOffline, json, plant } from './testing/pnpm-fixture.js';
import { createTempTree, runScript, type TempTree } from './testing/temp-tree.js';

const PROJECT_LICENSE = 'MIT';
const DENIED = "would impose obligations on gcportrait's combined work or is unverifiable";
const THIRD_PARTY = [
  '# Third-party material',
  '',
  '<!-- BEGIN GENERATED: npm-dependencies (scripts/check-licenses.mjs --write) -->',
  '<!-- END GENERATED: npm-dependencies -->',
  '',
].join('\n');

/** A planted dependency: its package name and the `license` field it declares (undefined: none). */
type Planted = readonly [name: string, license: string | undefined];

/**
 * A pnpm project at the tree's root (a workspace of one, so `pnpm ls -r` lists only it) whose dependencies are
 * the planted packages, installed. The same pnpm version as the repository, which Corepack already has.
 */
function plantedProject(tree: TempTree, planted: readonly Planted[]): void {
  const dependencies = Object.fromEntries(planted.map(([name]) => [name, `file:./vendor/${name}`]));
  tree.write(
    'package.json',
    json({
      name: 'fixture',
      private: true,
      license: PROJECT_LICENSE,
      packageManager: 'pnpm@10.18.1',
      dependencies,
    }),
  );
  tree.write('pnpm-workspace.yaml', 'packages: []\n');
  tree.write('THIRD_PARTY.md', THIRD_PARTY);
  for (const [name, license] of planted) plant(tree, name, license === undefined ? {} : { license });
  installOffline(tree);
}

const run = (tree: TempTree, ...args: string[]) =>
  runScript('check-licenses.mjs', ['--root', tree.root, ...args]);

describe('check-licenses', () => {
  let tree: TempTree | undefined;

  afterEach(() => {
    tree?.remove();
    tree = undefined;
  });

  it('denies every family on the list and accepts allowed alternatives', { timeout: 60_000 }, () => {
    tree = createTempTree('licenses-families');
    const denied: ReadonlyArray<readonly [string, string | undefined, string]> = [
      ['planted-gpl', 'GPL-3.0-only', 'GPL-*'],
      ['d-gpl-later', 'GPL-2.0-or-later', 'GPL-*'],
      ['d-lgpl', 'LGPL-2.1-only', 'LGPL-*'],
      ['d-agpl', 'AGPL-3.0-only', 'AGPL-*'],
      ['d-sspl', 'SSPL-1.0', 'SSPL-*'],
      ['d-cc-by-sa', 'CC-BY-SA-4.0', 'CC-BY-SA-*'],
      ['d-cc-by-nc', 'CC-BY-NC-SA-4.0', 'CC-BY-NC-*'],
      ['d-eupl', 'EUPL-1.2', 'EUPL-*'],
      ['d-osl', 'OSL-3.0', 'OSL-*'],
      ['d-cpal', 'CPAL-1.0', 'CPAL-*'],
      ['d-epl', 'EPL-2.0', 'EPL-*'],
      ['d-cddl', 'CDDL-1.1', 'CDDL-*'],
      ['d-see', 'SEE LICENSE IN LICENSE.md', 'SEE LICENSE IN …'],
      ['d-ref', 'LicenseRef-acme', 'LicenseRef-*'],
      ['d-unlicensed', 'UNLICENSED', 'UNLICENSED'],
      ['d-proprietary', 'Proprietary', 'proprietary'],
      ['d-absent', undefined, 'unknown or absent'],
      ['d-and', 'MIT AND GPL-3.0-only', 'GPL-*'],
      ['d-classpath', 'GPL-2.0-only WITH Classpath-exception-2.0', 'GPL-*'],
    ];
    const accepted: readonly Planted[] = [
      ['a-mit', 'MIT'],
      ['a-or', '(MIT OR GPL-3.0-only)'],
      ['a-llvm', 'Apache-2.0 WITH LLVM-exception'],
      ['a-mpl', 'MPL-2.0'],
    ];
    plantedProject(tree, [
      ...denied.map(([name, license]): Planted => [name, license]),
      ...accepted,
      ['n-bsd4', 'BSD-4-Clause'],
    ]);
    const result = run(tree, '--write');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`licenses: project licence ${PROJECT_LICENSE}`);
    expect(result.stdout).not.toContain('licenses: OK.');
    const lines = result.stderr.split('\n');
    for (const [name, , family] of denied) {
      const line = lines.find((text) => text.startsWith(`  ${name} `));
      expect(line, `${name} is reported`).toBeDefined();
      expect(line).toContain(`is denied (${family}: `);
      expect(line).toContain(DENIED);
    }
    for (const [name] of accepted) {
      expect(lines.some((text) => text.startsWith(`  ${name} `))).toBe(false);
    }
    // Neither allowed nor on the deny list: still refused, as before.
    expect(lines.find((text) => text.startsWith('  n-bsd4 '))).toContain(
      '"BSD-4-Clause" is not on the allowlist',
    );
    expect(result.stderr).toContain(`licenses: FAILED with ${String(denied.length + 1)} problem(s):`);
  });

  it('tells a workspace project from a third-party package by path, not by name', { timeout: 60_000 }, () => {
    tree = createTempTree('licenses-impostor');
    tree.write(
      'package.json',
      json({
        name: 'fixture',
        private: true,
        license: PROJECT_LICENSE,
        packageManager: 'pnpm@10.18.1',
        // A third-party package that shares the name of the workspace project below.
        dependencies: { '@fx/app': 'file:./vendor/impostor' },
      }),
    );
    tree.write('pnpm-workspace.yaml', 'packages:\n  - pkgs/*\n');
    tree.write('THIRD_PARTY.md', THIRD_PARTY);
    tree.write(
      'pkgs/app/package.json',
      json({ name: '@fx/app', version: '0.0.0', license: PROJECT_LICENSE }),
    );
    tree.write(
      'pkgs/web/package.json',
      json({
        name: '@fx/web',
        version: '0.0.0',
        license: PROJECT_LICENSE,
        dependencies: { '@fx/app': 'workspace:*' },
      }),
    );
    tree.write(
      'vendor/impostor/package.json',
      json({ name: '@fx/app', version: '1.0.0', license: 'GPL-3.0-only' }),
    );
    installOffline(tree);
    const result = run(tree, '--write');
    expect(result.status).toBe(1);
    // The impostor is checked although a workspace project has its name; the project itself is not.
    expect(result.stderr).toContain('licenses: FAILED with 1 problem(s):');
    expect(result.stderr).toContain(`@fx/app (local, no version): "GPL-3.0-only" is denied (GPL-*: `);
    expect(result.stderr).toContain(DENIED);
    // The dependency table lists the impostor for the root, and skips the workspace link.
    expect(tree.read('THIRD_PARTY.md')).toContain('| `@fx/app` | GPL-3.0-only | (root) | runtime |');
  });

  it('passes a tree of allowed licences and states the compatibility', { timeout: 60_000 }, () => {
    tree = createTempTree('licenses-clean');
    plantedProject(tree, [
      ['a-mit', 'MIT'],
      ['a-apache', 'Apache-2.0'],
    ]);
    expect(run(tree, '--write').status).toBe(0);
    expect(tree.read('THIRD_PARTY.md')).toContain('| `a-apache` | Apache-2.0 | (root) | runtime |');
    const result = run(tree);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`licenses: project licence ${PROJECT_LICENSE}`);
    expect(result.stdout).toContain(
      `licenses: compatibility: every accepted dependency licence is permissive, file-scoped weak copyleft ` +
        `(MPL-2.0) or, for the self-hosted font packages only, OFL-1.1; all are compatible with ${PROJECT_LICENSE}`,
    );
    expect(result.stdout).toContain(
      'licenses: OK. 2 installed packages are under allowed licences; the workspace packages (1) declare ' +
        `${PROJECT_LICENSE}; THIRD_PARTY.md is up to date.`,
    );
  });

  it(
    "checks a tree without a single third-party package instead of crashing on pnpm's message",
    { timeout: 60_000 },
    () => {
      tree = createTempTree('licenses-empty');
      plantedProject(tree, []);
      // pnpm prints "No licenses in packages found" here, not JSON, which must not crash the check.
      expect(run(tree, '--write').status).toBe(0);
      const result = run(tree);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('licenses: OK. 0 installed packages are under allowed licences');
    },
  );

  it(
    "requires every workspace package to declare the root package.json's licence",
    { timeout: 60_000 },
    () => {
      tree = createTempTree('licenses-workspace');
      tree.write(
        'package.json',
        json({ name: 'fixture', private: true, license: PROJECT_LICENSE, packageManager: 'pnpm@10.18.1' }),
      );
      tree.write('pnpm-workspace.yaml', 'packages:\n  - pkgs/*\n');
      tree.write('THIRD_PARTY.md', THIRD_PARTY);
      tree.write(
        'pkgs/same/package.json',
        json({ name: '@fx/same', version: '0.0.0', license: PROJECT_LICENSE }),
      );
      tree.write(
        'pkgs/apache/package.json',
        json({ name: '@fx/apache', version: '0.0.0', license: 'Apache-2.0' }),
      );
      tree.write('pkgs/none/package.json', json({ name: '@fx/none', version: '0.0.0' }));
      installOffline(tree);
      const result = run(tree, '--write');
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('licenses: FAILED with 2 problem(s):');
      expect(result.stderr).toContain(
        `  @fx/apache (pkgs/apache/package.json): license "Apache-2.0" differs from the project licence "${PROJECT_LICENSE}" of the root package.json`,
      );
      expect(result.stderr).toContain(
        `  @fx/none (pkgs/none/package.json): no license field; every workspace package declares the project licence "${PROJECT_LICENSE}"`,
      );
      expect(result.stderr).not.toContain('@fx/same');
    },
  );

  it('lists the deny list with a reason for every family', () => {
    const result = runScript('check-licenses.mjs', ['--list-rules']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Denied (${DENIED}):`);
    for (const family of [
      'GPL-*',
      'LGPL-*',
      'AGPL-*',
      'SSPL-*',
      'CC-BY-SA-*',
      'CC-BY-NC-*',
      'EUPL-*',
      'OSL-*',
      'CPAL-*',
      'EPL-*',
      'CDDL-*',
      'SEE LICENSE IN …',
      'UNLICENSED',
      'proprietary',
      'unknown or absent',
    ]) {
      expect(result.stdout).toMatch(
        new RegExp(`^ {2}${family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: \\S`, 'm'),
      );
    }
    // gcportrait is MIT: copyleft that reaches the combined work stays denied, the network kind included.
    expect(result.stdout).toMatch(/^ {2}GPL-\*: .*could no longer be offered under the MIT License$/m);
    expect(result.stdout).toMatch(
      /^ {2}AGPL-\*: network copyleft: .*could no longer be offered under the MIT License$/m,
    );
    expect(result.stdout).toContain('@fontsource/roboto: OFL-1.1');
    expect(result.stdout).toContain('@fontsource/roboto-mono: OFL-1.1');
    // The two Roboto packages are the only font exception.
    expect(result.stdout.match(/^ {2}\S+: OFL-1\.1\b/gm)).toHaveLength(2);
  });

  it('refuses unknown options with exit code 2', () => {
    expect(runScript('check-licenses.mjs', ['--nope']).status).toBe(2);
  });
});
