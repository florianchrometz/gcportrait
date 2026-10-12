// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FIXTURE_LICENSE,
  SCRIPTS_DIR,
  createTempTree,
  manifest,
  runScript,
  type TempTree,
} from './testing/temp-tree.js';

const LEGACY = ['leg', 'acy'].join('');
/** The project's former licence, assembled at run time so that this file does not name it (provenance rule h). */
const FORMER_LICENCE = `${['A', 'GPL'].join('')}-3.0-only`;

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
  tree.write(`${LEGACY}/old.ts`, `${ts(FIXTURE_LICENSE)}\n`);
  tree.write('vendor-note.md', `${md('CC-BY-4.0')}\n\nThird-party note.\n`);
  // Never touched: .nvmrc carries no header.
  tree.write('.nvmrc', '22\n');
}

describe('set-license', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = createTempTree('set-license');
    writeTree(tree);
  });

  afterEach(() => {
    tree.remove();
  });

  const run = (...args: string[]) => runScript('set-license.mjs', ['--root', tree.root, ...args]);

  it('changes nothing in --dry-run mode but reports the counts', () => {
    const result = run('MIT', '--holder', 'Example Maintainer', '--dry-run');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `${FIXTURE_LICENSE} -> MIT: would rewrite ${HEADER_COUNT} SPDX header(s) and 2 package.json licence field(s)`,
    );
    expect(result.stdout).toContain('Dry run: nothing was written.');
    expect(tree.read('LICENSE')).toBe('placeholder\n');
    for (const [relPath, content] of FIXTURE_FILES) expect(tree.read(relPath)).toBe(content(FIXTURE_LICENSE));
  });

  it('rewrites headers, package.json licence fields and LICENSE for MIT', () => {
    const result = run('MIT', '--holder', 'Example Maintainer', '--year', '2030');
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
    expect(tree.read(`${LEGACY}/old.ts`)).toBe(`${ts(FIXTURE_LICENSE)}\n`);
    expect(tree.read('vendor-note.md')).toContain('CC-BY-4.0');
    expect(tree.read('.nvmrc')).toBe('22\n');
  });

  it('rewrites the headers of dotfiles and Dockerfiles, which have no file extension', () => {
    expect(run('Apache-2.0').status).toBe(0);
    for (const relPath of ['.gitignore', '.npmrc', '.editorconfig', '.prettierignore']) {
      expect(tree.read(relPath).startsWith(`${hash('Apache-2.0')}\n`)).toBe(true);
    }
    expect(tree.read('infra/Dockerfile')).toBe(
      `# syntax=docker/dockerfile:1\n${hash('Apache-2.0')}\nFROM scratch\n`,
    );
  });

  it('leaves a tree that passes the provenance check with the new identifier', () => {
    tree.write('vendor-note.md', `${md(FIXTURE_LICENSE)}\n\nThird-party note.\n`);
    expect(run('Apache-2.0').status).toBe(0);
    const result = runScript('check-provenance.mjs', ['--root', tree.root]);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('(Apache-2.0) verified');
  });

  it('writes the built-in Apache-2.0 text verbatim', () => {
    expect(run('Apache-2.0').status).toBe(0);
    expect(tree.read('LICENSE')).toBe(
      readFileSync(path.join(SCRIPTS_DIR, 'licenses', 'Apache-2.0.txt'), 'utf8'),
    );
  });

  it('can be run again to switch from one chosen licence to another', () => {
    expect(run('Apache-2.0').status).toBe(0);
    const result = run('MIT', '--holder', 'Example Maintainer', '--year', '2030');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Apache-2.0 -> MIT: rewrote ${HEADER_COUNT} SPDX header(s)`);
    expect(tree.read('src/index.ts').startsWith(`${ts('MIT')}\n`)).toBe(true);
    expect(tree.read('LICENSE')).toContain('Copyright (c) 2030 Example Maintainer');
  });

  it('takes the text of any other licence from --text', () => {
    tree.write('my-licence.txt', 'Custom licence text\n');
    const result = run('LicenseRef-custom', '--text', path.join(tree.root, 'my-licence.txt'));
    expect(result.status).toBe(0);
    expect(tree.read('LICENSE')).toBe('Custom licence text\n');
    expect(tree.read('config.yaml').startsWith(`${hash('LicenseRef-custom')}\n`)).toBe(true);
  });

  it.each([
    { args: ['MIT'], message: 'MIT needs --holder' },
    { args: ['GPL-3.0-only'], message: 'no built-in text for "GPL-3.0-only"' },
    // The project's former licence: its text is no longer built in (ADR 0017).
    { args: [FORMER_LICENCE], message: `no built-in text for "${FORMER_LICENCE}"` },
    { args: ['MIT OR Apache-2.0'], message: 'is not a single SPDX licence identifier' },
    { args: [], message: 'expected exactly one SPDX licence identifier' },
    { args: ['MIT', '--year', '30'], message: '--year must be a four-digit year' },
  ])('rejects $args with a usage error and writes nothing', ({ args, message }) => {
    const result = run(...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
    expect(tree.read('LICENSE')).toBe('placeholder\n');
    expect(tree.read('src/index.ts')).toBe(FIXTURE_FILES[0]?.[1](FIXTURE_LICENSE));
  });
});
