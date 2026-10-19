// SPDX-License-Identifier: Apache-2.0
/**
 * scripts/check-licenses.mjs end to end, on throw-away projects with saved pnpm reports. One real offline install
 * proves that pnpm's reports still parse; the policy cases use saved reports without installing dependencies.
 */
import { Console } from 'node:console';
import { chmodSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run as checkLicenses } from './check-licenses.mjs';
import { installOffline, json, plant } from './testing/pnpm-fixture.js';
import {
  createTempTree,
  runInProcess,
  runScript,
  SCRIPTS_DIR,
  SPAWN_TIMEOUT,
  type TempTree,
} from './testing/temp-tree.js';

const PROJECT_LICENSE = 'Apache-2.0';
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
 * the planted packages. A real install uses the repository's pnpm version, which Corepack already has.
 */
function plantedProject(tree: TempTree, planted: readonly Planted[], install = false): void {
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
  if (install) installOffline(tree);
  else {
    const root = realpathSync(tree.root);
    const report: Record<string, unknown[]> = {};
    for (const [name, license] of planted) {
      const declared = license ?? 'Unknown';
      (report[declared] ??= []).push({
        name,
        license: declared,
        versions: [null],
        paths: [path.join(root, 'node_modules', name)],
      });
    }
    savedReports(tree, report);
  }
}

function savedReports(
  tree: TempTree,
  licenses: unknown,
  projects: readonly { name: string; path: string }[] = [{ name: 'fixture', path: realpathSync(tree.root) }],
): void {
  tree.write('licenses-report.json', json(licenses));
  tree.write('projects-report.json', json(projects));
}

const run = (tree: TempTree, ...args: string[]) =>
  runInProcess(() => checkLicenses(['--root', tree.root, ...args]));

const runSaved = (tree: TempTree, ...args: string[]) =>
  run(
    tree,
    '--licenses-report',
    path.join(tree.root, 'licenses-report.json'),
    '--projects-report',
    path.join(tree.root, 'projects-report.json'),
    ...args,
  );

describe('check-licenses', () => {
  let tree: TempTree | undefined;

  beforeEach(() => {
    const output = new Console(process.stdout, process.stderr);
    vi.spyOn(console, 'log').mockImplementation(output.log.bind(output));
    vi.spyOn(console, 'error').mockImplementation(output.error.bind(output));
  });

  afterEach(() => {
    tree?.remove();
    tree = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('imports without running the command or changing the exit code', async () => {
    const argv = process.argv;
    const exitCode = process.exitCode;
    process.argv = [process.execPath, path.join(SCRIPTS_DIR, 'check-licenses.test.ts')];
    vi.resetModules();
    try {
      const result = await runInProcess(async () => {
        const imported = await import('./check-licenses.mjs');
        expect(imported).toHaveProperty('run');
        return 0;
      });
      expect(result).toEqual({ status: 0, stdout: '', stderr: '' });
      expect(process.exitCode).toBe(exitCode);
    } finally {
      process.argv = argv;
      process.exitCode = exitCode;
      vi.resetModules();
    }
  });

  it('denies every family on the list and accepts allowed alternatives', async () => {
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
    const result = await runSaved(tree, '--write');
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

  it('tells a workspace project from a third-party package by path, not by name', async () => {
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
    const root = realpathSync(tree.root);
    savedReports(
      tree,
      {
        MIT: [
          { name: '@fx/app', versions: ['0.0.0'], paths: [path.join(root, 'pkgs/app')] },
          { name: '@fx/web', versions: ['0.0.0'], paths: [path.join(root, 'pkgs/web')] },
        ],
        'GPL-3.0-only': [
          { name: '@fx/app', versions: [null], paths: [path.join(root, 'node_modules/@fx/app')] },
        ],
      },
      [
        { name: 'fixture', path: root },
        { name: '@fx/app', path: path.join(root, 'pkgs/app') },
        { name: '@fx/web', path: path.join(root, 'pkgs/web') },
      ],
    );
    const result = await runSaved(tree, '--write');
    expect(result.status).toBe(1);
    // The impostor is checked although a workspace project has its name; the project itself is not.
    expect(result.stderr).toContain('licenses: FAILED with 1 problem(s):');
    expect(result.stderr).toContain(`@fx/app (local, no version): "GPL-3.0-only" is denied (GPL-*: `);
    expect(result.stderr).toContain(DENIED);
    // The dependency table lists the impostor for the root, and skips the workspace link.
    expect(tree.read('THIRD_PARTY.md')).toContain('| `@fx/app` | GPL-3.0-only | (root) | runtime |');
  });

  it('passes a tree of allowed licences and states the compatibility', { timeout: 60_000 }, async () => {
    tree = createTempTree('licenses-clean');
    plantedProject(
      tree,
      [
        ['a-mit', 'MIT'],
        ['a-apache', 'Apache-2.0'],
      ],
      true,
    );
    expect((await run(tree, '--write')).status).toBe(0);
    expect(tree.read('THIRD_PARTY.md')).toContain('| `a-apache` | Apache-2.0 | (root) | runtime |');
    const result = await run(tree);
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
    async () => {
      tree = createTempTree('licenses-empty');
      plantedProject(tree, []);
      tree.write('licenses-report.json', 'No licenses in packages found\n');
      expect((await runSaved(tree, '--write')).status).toBe(0);
      const result = await runSaved(tree);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('licenses: OK. 0 installed packages are under allowed licences');
    },
  );

  it(
    "requires every workspace package to declare the root package.json's licence",
    { timeout: 60_000 },
    async () => {
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
      tree.write('pkgs/mit/package.json', json({ name: '@fx/mit', version: '0.0.0', license: 'MIT' }));
      tree.write('pkgs/none/package.json', json({ name: '@fx/none', version: '0.0.0' }));
      const root = realpathSync(tree.root);
      savedReports(tree, {}, [
        { name: 'fixture', path: root },
        ...['same', 'mit', 'none'].map((name) => ({
          name: `@fx/${name}`,
          path: path.join(root, 'pkgs', name),
        })),
      ]);
      const result = await runSaved(tree, '--write');
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('licenses: FAILED with 2 problem(s):');
      expect(result.stderr).toContain(
        `  @fx/mit (pkgs/mit/package.json): license "MIT" differs from the project licence "${PROJECT_LICENSE}" of the root package.json`,
      );
      expect(result.stderr).toContain(
        `  @fx/none (pkgs/none/package.json): no license field; every workspace package declares the project licence "${PROJECT_LICENSE}"`,
      );
      expect(result.stderr).not.toContain('@fx/same');
    },
  );

  it('lists the deny list with a reason for every family', async () => {
    const result = await runInProcess(() => checkLicenses(['--list-rules']));
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
    // gcportrait is Apache-2.0: copyleft that reaches the combined work stays denied, the network kind included.
    expect(result.stdout).toMatch(
      /^ {2}GPL-\*: .*could no longer be offered under the Apache License 2\.0$/m,
    );
    expect(result.stdout).toMatch(
      /^ {2}AGPL-\*: network copyleft: .*could no longer be offered under the Apache License 2\.0$/m,
    );
    expect(result.stdout).toContain('@fontsource/roboto: OFL-1.1');
    expect(result.stdout).toContain('@fontsource/roboto-mono: OFL-1.1');
    // The two Roboto packages are the only font exception.
    expect(result.stdout.match(/^ {2}\S+: OFL-1\.1\b/gm)).toHaveLength(2);
  });

  it('matches the real CLI output, exit code and generated dependency table', SPAWN_TIMEOUT, async () => {
    tree = createTempTree('licenses-cli');
    plantedProject(tree, [
      ['planted-gpl', 'GPL-3.0-only'],
      ['a-mit', 'MIT'],
    ]);
    const args = [
      '--root',
      tree.root,
      '--licenses-report',
      path.join(tree.root, 'licenses-report.json'),
      '--projects-report',
      path.join(tree.root, 'projects-report.json'),
      '--write',
    ];
    const inProcess = await runInProcess(() => checkLicenses(args));
    const document = tree.read('THIRD_PARTY.md');
    expect(inProcess.status).toBe(1);
    expect(inProcess.stderr).toContain('is denied');
    expect(document).not.toBe(THIRD_PARTY);
    tree.write('THIRD_PARTY.md', THIRD_PARTY);
    expect(runScript('check-licenses.mjs', args)).toEqual(inProcess);
    expect(tree.read('THIRD_PARTY.md')).toBe(document);
    expect((await runInProcess(() => checkLicenses(['--nope']))).status).toBe(2);
    expect(await runInProcess(() => checkLicenses(args))).toEqual(inProcess);
  });

  it('refuses unknown options with exit code 2', async () => {
    expect((await runInProcess(() => checkLicenses(['--nope']))).status).toBe(2);
  });

  it('checks saved reports without an install and still rejects a stale dependency table', async () => {
    tree = createTempTree('licenses-saved');
    plantedProject(tree, [['a-mit', 'MIT']]);
    expect(existsSync(path.join(tree.root, 'node_modules'))).toBe(false);
    expect((await runSaved(tree)).stderr).toContain('THIRD_PARTY.md is stale');
    expect((await runSaved(tree, '--write')).status).toBe(0);
    expect((await runSaved(tree)).status).toBe(0);
  });

  it.each(['licenses', 'projects'] as const)('refuses invalid saved %s reports', async (kind) => {
    tree = createTempTree('licenses-invalid');
    plantedProject(tree, []);
    for (const content of ['not JSON', 'null', kind === 'licenses' ? '[]' : '{}']) {
      tree.write(`${kind}-report.json`, content);
      const result = await runSaved(tree, '--write');
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain('unexpected output');
      expect(tree.read('THIRD_PARTY.md')).toBe(THIRD_PARTY);
    }
  });

  it.each(['licenses', 'projects'] as const)('reports a missing %s report and option value', async (kind) => {
    tree = createTempTree('licenses-missing-report');
    plantedProject(tree, []);
    const missing = path.join(tree.root, 'missing.json');
    const result = await runSaved(tree, `--${kind}-report`, missing);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(missing);
    expect((await run(tree, `--${kind}-report`)).status).toBe(2);
  });

  it('requires an install whenever either report remains live', async () => {
    tree = createTempTree('licenses-live');
    plantedProject(tree, []);
    for (const args of [
      [],
      ['--licenses-report', path.join(tree.root, 'licenses-report.json')],
      ['--projects-report', path.join(tree.root, 'projects-report.json')],
    ]) {
      const result = await run(tree, ...args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('node_modules is missing');
    }
  });

  it.each([
    ['group', { MIT: { name: 'hidden-dependency' } }],
    ['entry', { MIT: [null] }],
    ['name absent', { MIT: [{}] }],
    ['name blank', { MIT: [{ name: '' }] }],
    ['license object', { MIT: [{ name: 'hidden-dependency', license: {} }] }],
    ['paths object', { MIT: [{ name: 'hidden-dependency', paths: {} }] }],
    ['paths mixed', { MIT: [{ name: 'hidden-dependency', paths: ['/valid', null] }] }],
    ['paths relative', { MIT: [{ name: 'hidden-dependency', paths: ['relative'] }] }],
    ['versions object', { MIT: [{ name: 'hidden-dependency', versions: {} }] }],
    ['versions mixed', { MIT: [{ name: 'hidden-dependency', versions: ['1.0.0', 7] }] }],
    ['versions blank', { MIT: [{ name: 'hidden-dependency', versions: [''] }] }],
  ])('rejects malformed dependency %s before writing the table', async (_label, report) => {
    tree = createTempTree('licenses-invalid-entry');
    plantedProject(tree, []);
    tree.write('licenses-report.json', json(report));
    for (const args of [[], ['--write']]) {
      const result = await runSaved(tree, ...args);
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain('unexpected output from `pnpm licenses list --json`');
      expect(result.stdout).not.toContain('licenses: OK');
      expect(tree.read('THIRD_PARTY.md')).toBe(THIRD_PARTY);
    }
  });

  it.each([
    null,
    {},
    { name: '@fixture/bad' },
    { name: 7, path: '/valid' },
    { name: '', path: '/valid' },
    { name: '@fixture/bad', path: '' },
    { name: '@fixture/bad', path: 'relative' },
  ])('rejects malformed workspace record %j before writing the table', async (project) => {
    tree = createTempTree('licenses-invalid-project');
    plantedProject(tree, []);
    tree.write('pkgs/bad/package.json', json({ name: '@fixture/bad', license: 'GPL-3.0-only' }));
    tree.write('projects-report.json', json([{ name: 'fixture', path: realpathSync(tree.root) }, project]));
    for (const args of [[], ['--write']]) {
      const result = await runSaved(tree, ...args);
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain('unexpected output from `pnpm ls -r --json`');
      expect(result.stdout).not.toContain('licenses: OK');
      expect(tree.read('THIRD_PARTY.md')).toBe(THIRD_PARTY);
    }
  });

  it('keeps unknown and absent licence enforcement and local versions', async () => {
    tree = createTempTree('licenses-unknown');
    plantedProject(tree, []);
    savedReports(tree, {
      Unknown: [{ name: 'absent-license', versions: [null] }],
      '': [{ name: 'empty-license' }],
      MIT: [{ name: 'local-allowed', license: null, versions: [null] }],
    });
    const result = await runSaved(tree, '--write');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FAILED with 2 problem(s)');
    expect(result.stderr).toContain('absent-license (local, no version)');
    expect(result.stderr).toContain('empty-license (local, no version)');
    expect(result.stderr).not.toContain('local-allowed');
  });

  it.each(['licenses', 'projects'] as const)(
    'rejects malformed live %s output with the same validation',
    async (kind) => {
      tree = createTempTree('licenses-live-malformed');
      plantedProject(tree, []);
      tree.write('node_modules/.keep', '');
      tree.write(`${kind}-report.json`, json(kind === 'licenses' ? { MIT: {} } : [{ name: 'missing-path' }]));
      tree.write(
        'bin/pnpm',
        `#!${process.execPath}\nconst fs = require('node:fs'); process.stdout.write(fs.readFileSync(process.argv.includes('licenses') ? 'licenses-report.json' : 'projects-report.json', 'utf8'));\n`,
      );
      if (process.platform === 'win32')
        tree.write('bin/pnpm.cmd', `@"${process.execPath}" "%~dp0pnpm" %*\r\n`);
      chmodSync(path.join(tree.root, 'bin/pnpm'), 0o755);
      vi.stubEnv('PATH', `${path.join(tree.root, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`);
      const result = await run(tree, '--write');
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain('unexpected output');
      expect(tree.read('THIRD_PARTY.md')).toBe(THIRD_PARTY);
    },
  );
});
