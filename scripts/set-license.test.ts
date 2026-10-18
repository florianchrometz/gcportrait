// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import { Console } from 'node:console';
import { existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run as setLicense } from './set-license.mjs';
import {
  FIXTURE_LICENSE,
  SCRIPTS_DIR,
  SPAWN_TIMEOUT,
  createTempTree,
  manifest,
  runInProcess,
  runScript,
  type TempTree,
} from './testing/temp-tree.js';

/**
 * A licence of the denied network-copyleft family, assembled at run time so that this file does not name
 * it.
 */
const DENIED_LICENCE = `${['A', 'GPL'].join('')}-3.0-only`;

/** header line for a comment style and identifier */
const ts = (id: string) => `// SPDX-License-Identifier: ${id}`;
const md = (id: string) => `<!-- SPDX-License-Identifier: ${id} -->`;
const hash = (id: string) => `# SPDX-License-Identifier: ${id}`;
const css = (id: string) => `/* SPDX-License-Identifier: ${id} */`;

const FIXTURE_FILES: ReadonlyArray<readonly [string, (id: string) => string]> = [
  ['src/index.ts', (id) => `${ts(id)}\nexport const placeholder = '${FIXTURE_LICENSE}';\n`],
  ['scripts/run.sh', (id) => `#!/bin/sh\n${hash(id)}\necho ok\n`],
  ['docs/guide.md', (id) => `---\ntitle: Guide\n---\n${md(id)}\n\n# Guide\n`],
  ['config.yaml', (id) => `${hash(id)}\nkey: value\n`],
  ['styles.css', (id) => `${css(id)}\r\nbody { margin: 0; }\r\n`],
  // Files without an extension, matched by name.
  ['.gitignore', (id) => `${hash(id)}\nnode_modules/\n`],
  ['.npmrc', (id) => `${hash(id)}\nengine-strict=true\n`],
  ['.editorconfig', (id) => `${hash(id)}\nroot = true\n`],
  ['.prettierignore', (id) => `${hash(id)}\ndist/\n`],
  ['infra/Dockerfile', (id) => `# syntax=docker/dockerfile:1\n${hash(id)}\nFROM scratch\n`],
];

/** How many fixture headers a run rewrites. */
const HEADER_COUNT = String(FIXTURE_FILES.length);

function writeTree(tree: TempTree): void {
  tree.write('package.json', manifest(FIXTURE_LICENSE));
  tree.write('packages/a/package.json', manifest(FIXTURE_LICENSE));
  tree.write('LICENSE', 'placeholder\n');
  for (const [relPath, content] of FIXTURE_FILES) tree.write(relPath, content(FIXTURE_LICENSE));
  // Never touched: skipped directories, and headers that carry some other identifier.
  tree.write('node_modules/dep/index.js', `${ts(FIXTURE_LICENSE)}\n`);
  tree.write('out/old.ts', `${ts(FIXTURE_LICENSE)}\n`);
  tree.write('vendor-note.md', `${md('CC-BY-4.0')}\n\nThird-party note.\n`);
  // Never touched: .nvmrc carries no header.
  tree.write('.nvmrc', '22\n');
}

describe('set-license', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = createTempTree('set-license');
    writeTree(tree);
    const output = new Console(process.stdout, process.stderr);
    vi.spyOn(console, 'log').mockImplementation(output.log.bind(output));
    vi.spyOn(console, 'error').mockImplementation(output.error.bind(output));
  });

  afterEach(() => {
    tree.remove();
    vi.restoreAllMocks();
  });

  const run = (...args: string[]) => runInProcess(() => setLicense(['--root', tree.root, ...args]));

  it('imports without running the command or changing the exit code', async () => {
    const argv = process.argv;
    const exitCode = process.exitCode;
    process.argv = [process.execPath, path.join(SCRIPTS_DIR, 'set-license.test.ts')];
    vi.resetModules();
    try {
      const result = await runInProcess(async () => {
        const imported = await import('./set-license.mjs');
        expect(imported).toHaveProperty('run');
        return 0;
      });
      expect(result).toEqual({ status: 0, stdout: '', stderr: '' });
      expect(process.exitCode).toBe(exitCode);
      expect(tree.read('LICENSE')).toBe('placeholder\n');
    } finally {
      process.argv = argv;
      process.exitCode = exitCode;
      vi.resetModules();
    }
  });

  it('changes nothing in --dry-run mode but reports the counts', async () => {
    const result = await run('MIT', '--holder', 'Example Maintainer', '--dry-run');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `${FIXTURE_LICENSE} -> MIT: would rewrite ${HEADER_COUNT} SPDX header(s) and 2 package.json licence field(s)`,
    );
    expect(result.stdout).toContain('Dry run: nothing was written.');
    expect(tree.read('LICENSE')).toBe('placeholder\n');
    for (const [relPath, content] of FIXTURE_FILES) expect(tree.read(relPath)).toBe(content(FIXTURE_LICENSE));
  });

  it('rewrites headers, package.json licence fields and LICENSE for MIT', async () => {
    const result = await run('MIT', '--holder', 'Example Maintainer', '--year', '2030');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `rewrote ${HEADER_COUNT} SPDX header(s) and 2 package.json licence field(s)`,
    );
    expect(result.stdout).toContain('vendor-note.md: header names "CC-BY-4.0", left unchanged');

    for (const [relPath, content] of FIXTURE_FILES) expect(tree.read(relPath)).toBe(content('MIT'));
    expect(JSON.parse(tree.read('package.json'))).toMatchObject({ license: 'MIT' });
    expect(JSON.parse(tree.read('packages/a/package.json'))).toMatchObject({ license: 'MIT' });

    const license = tree.read('LICENSE');
    expect(license.startsWith('MIT License\n')).toBe(true);
    expect(license).toContain('Copyright (c) 2030 Example Maintainer');
    expect(license).not.toContain('<copyright holders>');

    expect(tree.read('node_modules/dep/index.js')).toBe(`${ts(FIXTURE_LICENSE)}\n`);
    expect(tree.read('out/old.ts')).toBe(`${ts(FIXTURE_LICENSE)}\n`);
    expect(tree.read('vendor-note.md')).toContain('CC-BY-4.0');
    expect(tree.read('.nvmrc')).toBe('22\n');
  });

  it('rewrites the headers of dotfiles and Dockerfiles, which have no file extension', async () => {
    expect((await run('Apache-2.0')).status).toBe(0);
    for (const relPath of ['.gitignore', '.npmrc', '.editorconfig', '.prettierignore']) {
      expect(tree.read(relPath).startsWith(`${hash('Apache-2.0')}\n`)).toBe(true);
    }
    expect(tree.read('infra/Dockerfile')).toBe(
      `# syntax=docker/dockerfile:1\n${hash('Apache-2.0')}\nFROM scratch\n`,
    );
  });

  it('does not rewrite outside files through a tracked directory replaced by a link', async () => {
    const outside = createTempTree('outside-license');
    try {
      const original = `${ts(FIXTURE_LICENSE)}\nexport {};\n`;
      outside.write('file.ts', original);
      outside.write('package.json', manifest(FIXTURE_LICENSE));
      tree.write('tracked/file.ts', original);
      tree.write('tracked/package.json', manifest(FIXTURE_LICENSE));
      expect(spawnSync('git', ['init', '--quiet'], { cwd: tree.root }).status).toBe(0);
      expect(spawnSync('git', ['add', 'tracked'], { cwd: tree.root }).status).toBe(0);
      rmSync(path.join(tree.root, 'tracked'), { recursive: true });
      symlinkSync(outside.root, path.join(tree.root, 'tracked'));
      const result = await run('Apache-2.0');
      expect(result.status, result.stderr).toBe(0);
      expect(outside.read('file.ts')).toBe(original);
      expect(outside.read('package.json')).toBe(manifest(FIXTURE_LICENSE));
      expect(tree.read('src/index.ts').startsWith(ts('Apache-2.0'))).toBe(true);
    } finally {
      outside.remove();
    }
  });

  it.each(
    ['package.json', 'LICENSE'].flatMap((file) =>
      [false, true].flatMap((missing) => [false, true].map((dryRun) => ({ file, missing, dryRun }))),
    ),
  )(
    'refuses a root $file link (missing: $missing, dry run: $dryRun) before any writes',
    async ({ file, missing, dryRun }) => {
      const outside = createTempTree('outside-root-license');
      const original =
        file === 'package.json' ? manifest(FIXTURE_LICENSE) : 'Outside licence stays intact.\n';
      try {
        if (!missing) outside.write(file, original);
        rmSync(path.join(tree.root, file));
        symlinkSync(path.join(outside.root, file), path.join(tree.root, file));
        const result = await run('Apache-2.0', ...(dryRun ? ['--dry-run'] : []));
        expect(result.status, result.stderr).toBe(2);
        expect(result.stderr).toContain(`${file} must be a regular file`);
        if (missing) expect(existsSync(path.join(outside.root, file))).toBe(false);
        else expect(outside.read(file)).toBe(original);
        expect(tree.read('src/index.ts')).toBe(FIXTURE_FILES[0]?.[1](FIXTURE_LICENSE));
        expect(tree.read('packages/a/package.json')).toBe(manifest(FIXTURE_LICENSE));
      } finally {
        outside.remove();
      }
    },
  );

  it('uses the fallback without a root manifest and creates a missing LICENSE', async () => {
    rmSync(path.join(tree.root, 'package.json'));
    rmSync(path.join(tree.root, 'LICENSE'));
    const result = await run('Apache-2.0');
    expect(result.status, result.stderr).toBe(0);
    expect(tree.read('LICENSE')).toBe(
      readFileSync(path.join(SCRIPTS_DIR, 'licenses', 'Apache-2.0.txt'), 'utf8'),
    );
    expect(tree.read('src/index.ts').startsWith(ts('Apache-2.0'))).toBe(true);
  });

  it('leaves a tree that passes the provenance check with the new identifier', async () => {
    tree.write('vendor-note.md', `${md(FIXTURE_LICENSE)}\n\nThird-party note.\n`);
    expect((await run('Apache-2.0')).status).toBe(0);
    const result = runScript('check-provenance.mjs', ['--root', tree.root]);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('(Apache-2.0) verified');
  });

  it('writes the built-in Apache-2.0 text verbatim', async () => {
    expect((await run('Apache-2.0')).status).toBe(0);
    expect(tree.read('LICENSE')).toBe(
      readFileSync(path.join(SCRIPTS_DIR, 'licenses', 'Apache-2.0.txt'), 'utf8'),
    );
  });

  it('can be run again to switch from one chosen licence to another', async () => {
    expect((await run('Apache-2.0')).status).toBe(0);
    const result = await run('MIT', '--holder', 'Example Maintainer', '--year', '2030');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Apache-2.0 -> MIT: rewrote ${HEADER_COUNT} SPDX header(s)`);
    expect(tree.read('src/index.ts').startsWith(`${ts('MIT')}\n`)).toBe(true);
    expect(tree.read('LICENSE')).toContain('Copyright (c) 2030 Example Maintainer');
  });

  it('takes the text of any other licence from --text', async () => {
    tree.write('my-licence.txt', 'Custom licence text\n');
    const result = await run('LicenseRef-custom', '--text', path.join(tree.root, 'my-licence.txt'));
    expect(result.status).toBe(0);
    expect(tree.read('LICENSE')).toBe('Custom licence text\n');
    expect(tree.read('config.yaml').startsWith(`${hash('LicenseRef-custom')}\n`)).toBe(true);
  });

  it.each([
    { args: ['MIT'], message: 'MIT needs --holder' },
    { args: ['GPL-3.0-only'], message: 'no built-in text for "GPL-3.0-only"' },
    // A denied licence has no built-in text.
    { args: [DENIED_LICENCE], message: `no built-in text for "${DENIED_LICENCE}"` },
    { args: ['MIT OR Apache-2.0'], message: 'is not a single SPDX licence identifier' },
    { args: [], message: 'expected exactly one SPDX licence identifier' },
    { args: ['MIT', '--year', '30'], message: '--year must be a four-digit year' },
  ])('rejects $args with a usage error and writes nothing', async ({ args, message }) => {
    const result = await run(...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
    expect(tree.read('LICENSE')).toBe('placeholder\n');
    expect(tree.read('src/index.ts')).toBe(FIXTURE_FILES[0]?.[1](FIXTURE_LICENSE));
  });

  it('matches the real command output and written files', SPAWN_TIMEOUT, async () => {
    const args = ['MIT', '--holder', 'Example Maintainer', '--year', '2030'];
    const result = await run(...args);
    expect(result.status).toBe(0);
    const paths = [
      'LICENSE',
      'package.json',
      'packages/a/package.json',
      ...FIXTURE_FILES.map(([file]) => file),
    ];
    const written = paths.map((file) => tree.read(file));
    writeTree(tree);
    expect(runScript('set-license.mjs', ['--root', tree.root, ...args])).toEqual(result);
    expect(paths.map((file) => tree.read(file))).toEqual(written);
  });
});
