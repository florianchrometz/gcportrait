// SPDX-License-Identifier: MIT
/**
 * scripts/third-party-notices.mjs: the notices file for a throw-away pnpm workspace whose frontend,
 * backend and render library (the backend's render worker, ADR 0033) depend on planted packages under chosen
 * licences (`file:` dependencies, installed offline), and its helpers on their own. Every name, author and text is
 * synthetic, except the canonical licence texts of scripts/licenses/.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { installOffline, json, plant as plantPackage } from './testing/pnpm-fixture.js';
import { createTempTree, REPO, runScript, SCRIPTS_DIR, type TempTree } from './testing/temp-tree.js';
import {
  apacheExtra,
  copyrightLines,
  NON_AFFILIATION_LONG,
  productionPackageDirs,
  renderNotices,
} from './third-party-notices.mjs';

const APACHE = readFileSync(path.join(SCRIPTS_DIR, 'licenses', 'Apache-2.0.txt'), 'utf8');
/** The canonical MPL-2.0 text (https://mozilla.org/MPL/2.0/), which the notices carry once. */
const MPL = readFileSync(path.join(SCRIPTS_DIR, 'licenses', 'MPL-2.0.txt'), 'utf8');
/** A line only the canonical MPL-2.0 text holds, not the planted package's stub. */
const MPL_CANONICAL_LINE = '10.4. Distributing Source Code Form that is Incompatible With Secondary';
const MIT_TEXT = (holder: string) =>
  `MIT License\n\nCopyright (c) 2024 ${holder}\n\nPermission is hereby granted, free of charge, to any person ` +
  'obtaining a copy of this software, to deal in the Software without restriction.\n\nThe above copyright notice ' +
  'and this permission notice shall be included in all copies or substantial portions of the Software.\n';
const OFL_TEXT =
  'Copyright 2020 The Example Font Project Authors\n\nThis Font Software is licensed under the SIL Open Font ' +
  'License, Version 1.1.\n\nSIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\n';
const MPL_TEXT = 'Mozilla Public License Version 2.0\n==================================\n\n1. Definitions\n';
const APACHE_TERMS_HEADING = 'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION';

/** A planted package at version 1.2.3: its manifest fields and files. */
function plant(
  tree: TempTree,
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string>,
): void {
  plantPackage(tree, name, { version: '1.2.3', ...manifest }, files);
}

function workspace(tree: TempTree): void {
  tree.write(
    'package.json',
    json({ name: 'fixture', private: true, license: 'MIT', packageManager: 'pnpm@10.18.1' }),
  );
  tree.write('pnpm-workspace.yaml', 'packages:\n  - frontend\n  - backend\n  - pkgs/*\n  - packages/*\n');
  tree.write('scripts/licenses/Apache-2.0.txt', APACHE);
  tree.write('scripts/licenses/MPL-2.0.txt', MPL);
  plant(tree, 't-isc', { license: 'ISC', author: 'Transitive Author' }, {});
  plant(
    tree,
    'a-mit',
    { license: 'MIT', dependencies: { 't-isc': 'file:../t-isc' } },
    { LICENSE: MIT_TEXT('Example Author') },
  );
  plant(
    tree,
    'a-apache',
    { license: 'Apache-2.0', homepage: 'https://example.com/a-apache' },
    {
      LICENSE: `${APACHE}\nThis product bundles tiny-helper, under these terms: be nice.\n`,
      NOTICE:
        'a-apache\nCopyright 2023 Example Apache Authors\nThis product includes software made at example.com.\n',
    },
  );
  plant(
    tree,
    'a-mpl',
    { license: 'MPL-2.0', repository: 'git+https://example.com/a-mpl.git' },
    {
      LICENSE: MPL_TEXT,
    },
  );
  plant(tree, 'f-ofl', { license: 'OFL-1.1' }, { LICENSE: OFL_TEXT });
  plant(
    tree,
    'z-bsd',
    { license: 'BSD-3-Clause' },
    { 'LICENSE.md': 'Copyright (c) 2021, Z Example\nAll rights reserved.\n' },
  );
  plant(tree, 'd-dev', { license: 'MIT' }, { LICENSE: MIT_TEXT('Dev Only') });
  tree.write(
    'pkgs/model/package.json',
    json({
      name: '@fx/model',
      version: '0.0.0',
      license: 'MIT',
      dependencies: { 'z-bsd': 'file:../../vendor/z-bsd' },
    }),
  );
  // The render library: what the backend's render worker bundles, apart from the server.
  tree.write(
    'packages/render/package.json',
    json({
      name: '@fx/render',
      version: '0.0.0',
      license: 'MIT',
      dependencies: { 'a-mpl': 'file:../../vendor/a-mpl', 'a-mit': 'file:../../vendor/a-mit' },
    }),
  );
  tree.write(
    'backend/package.json',
    json({
      name: '@fx/backend',
      version: '0.0.0',
      license: 'MIT',
      dependencies: {
        '@fx/model': 'workspace:*',
        '@fx/render': 'workspace:*',
        'a-mit': 'file:../vendor/a-mit',
        'a-apache': 'file:../vendor/a-apache',
      },
      devDependencies: { 'd-dev': 'file:../vendor/d-dev' },
    }),
  );
  tree.write(
    'frontend/package.json',
    json({
      name: '@fx/frontend',
      version: '0.0.0',
      license: 'MIT',
      dependencies: { 'f-ofl': 'file:../vendor/f-ofl', 'a-mit': 'file:../vendor/a-mit' },
      optionalDependencies: {},
    }),
  );
  installOffline(tree);
}

/** The section of one package in the notices: from its heading to the next one. */
function section(notices: string, name: string): string {
  const rule = '='.repeat(100);
  const heading = `${rule}\n${name}@1.2.3\n${rule}\n`;
  const start = notices.indexOf(heading);
  expect(start, name).toBeGreaterThan(0);
  const end = notices.indexOf(`\n${rule}\n`, start + heading.length);
  return notices.slice(start + heading.length, end < 0 ? undefined : end);
}

describe('third-party-notices', () => {
  let tree: TempTree | undefined;
  afterEach(() => {
    tree?.remove();
    tree = undefined;
  });

  it('writes the notices of the production closure of frontend and backend', { timeout: 60_000 }, () => {
    tree = createTempTree('notices');
    workspace(tree);
    const result = runScript('third-party-notices.mjs', [
      '--root',
      tree.root,
      '--out',
      path.join(tree.root, 'out.txt'),
    ]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('third-party-notices: 6 packages written to');
    const notices = tree.read('out.txt');

    // The non-affiliation long form, exactly, and the project's own licence.
    expect(notices).toContain(NON_AFFILIATION_LONG);
    expect(notices).toContain(
      "gcportrait's own work is licensed under the MIT License, except the gcportrait name",
    );
    // Production dependencies, transitive ones and those of workspace packages; never dev dependencies or the
    // workspace packages themselves.
    for (const name of ['a-mit', 't-isc', 'a-apache', 'a-mpl', 'f-ofl', 'z-bsd'])
      expect(notices).toContain(`\n${name}@1.2.3\n`);
    expect(notices).not.toContain('d-dev');
    expect(notices).not.toContain('@fx/model@');
    expect(notices).not.toContain('@fx/render@');
    // Where each ships: the server only what the backend reaches without the render library, the render worker
    // the render library's closure.
    expect(notices).toMatch(/ {2}a-mit@1\.2\.3 +MIT +app, server, worker\n/);
    expect(notices).toMatch(/ {2}a-apache@1\.2\.3 +Apache-2\.0 +server\n/);
    expect(notices).toMatch(/ {2}a-mpl@1\.2\.3 +MPL-2\.0 +worker\n/);
    expect(notices).toMatch(/ {2}f-ofl@1\.2\.3 +OFL-1\.1 +app\n/);
    expect(section(notices, 'a-mpl')).toContain('In: the render worker (backend/dist/render-worker.mjs)\n');
    expect(section(notices, 'a-apache')).toContain('In: the server (backend/dist/server.mjs)\n');

    // A permissive licence: its file verbatim, with the copyright line listed.
    const mit = section(notices, 'a-mit');
    expect(mit).toContain('Copyright:\n  Copyright (c) 2024 Example Author');
    expect(mit).toContain(MIT_TEXT('Example Author').trimEnd());
    expect(mit).not.toContain(APACHE_TERMS_HEADING);
    expect(section(notices, 't-isc')).toContain('its package.json names the author: Transitive Author');

    // Apache-2.0: the NOTICE verbatim, the extra terms of its licence file, the licence's full text once at the end.
    const apache = section(notices, 'a-apache');
    expect(apache).toContain('NOTICE (verbatim):');
    expect(apache).toContain('This product includes software made at example.com.');
    expect(apache).toContain('Copyright 2023 Example Apache Authors');
    expect(apache).toContain('This product bundles tiny-helper, under these terms: be nice.');
    expect(notices.split(APACHE_TERMS_HEADING)).toHaveLength(2);
    expect(notices.trimEnd().endsWith(APACHE.trimEnd())).toBe(true);

    // MPL-2.0: sections 3.2 and 3.3, where the Source Code Form is, and the licence text.
    const mpl = section(notices, 'a-mpl');
    expect(mpl).toContain('MPL-2.0 (sections 3.2 and 3.3)');
    expect(mpl).toContain('used unmodified as part of a Larger Work, gcportrait (MIT)');
    expect(mpl).toContain(
      'https://registry.npmjs.org/a-mpl/-/a-mpl-1.2.3.tgz (project: https://example.com/a-mpl)',
    );
    expect(mpl).toContain(MPL_TEXT.trimEnd());
    expect(mpl).toContain(
      'The Mozilla Public License 2.0 is at the end of this file (and at https://mozilla.org/MPL/2.0/).',
    );
    expect(notices).not.toContain('(No MPL-2.0 package is part of this build.)');
    // The canonical MPL-2.0 text once, before the Apache-2.0 text, which still ends the file.
    expect(notices.split(MPL_CANONICAL_LINE)).toHaveLength(2);
    const mplAt = notices.indexOf('Mozilla Public License, Version 2.0 (full text)');
    expect(mplAt).toBeGreaterThan(notices.indexOf('\na-mpl@1.2.3\n'));
    expect(notices.slice(mplAt)).toContain(MPL.trimEnd());
    expect(mplAt).toBeLessThan(notices.indexOf('Apache License, Version 2.0 (full text)'));

    // OFL-1.1: the copyright notice and the licence text, verbatim.
    expect(section(notices, 'f-ofl')).toContain(OFL_TEXT.trimEnd());

    // A package whose files the bundle step copies into the render worker's asset directory names them; one
    // whose code is not in the worker (a font) is not listed for the worker's code.
    const withAssets = renderNotices({
      root: tree.root,
      app: [],
      server: productionPackageDirs(tree.root, ['backend']),
      assetFiles: {
        'a-mpl': { files: 'backend/dist/render-assets/a.wasm', code: true },
        'a-mit': { files: 'backend/dist/render-assets/fonts/', code: false },
      },
    });
    expect(withAssets).toMatch(/ {2}a-mpl@1\.2\.3 +MPL-2\.0 +worker, assets\n/);
    expect(section(withAssets, 'a-mpl')).toContain(
      "In: the render worker (backend/dist/render-worker.mjs), the render worker's assets " +
        '(backend/dist/render-assets/a.wasm)\n',
    );
    expect(withAssets).toMatch(/ {2}a-mit@1\.2\.3 +MIT +server, assets\n/);
  });

  it('refuses unknown options with exit code 2', () => {
    expect(runScript('third-party-notices.mjs', ['--nope']).status).toBe(2);
  });
});

describe('copyrightLines', () => {
  it('keeps the lines that name a holder, once each, and leaves licence clauses out', () => {
    expect(
      copyrightLines([
        { text: 'Copyright (c) 2024 Example Author\nThe above copyright notice and this permission notice…' },
        { text: '(c) You must retain, in the Source form…\nGrant of Copyright License. Subject to…' },
        { text: 'Original code Copyright Example Person <person@example.com>\n© 2020 Another Example' },
        { text: 'Copyright [yyyy] [name of copyright owner]\nCopyright (c) 2024 Example Author' },
        { text: '(c) 2019 Short Form Example\ncopyright holders and contributors "as is"' },
        { text: 'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM\nunder Copyright Law.' },
      ]),
    ).toEqual([
      'Copyright (c) 2024 Example Author',
      'Original code Copyright Example Person <person@example.com>',
      '© 2020 Another Example',
      '(c) 2019 Short Form Example',
    ]);
  });
});

describe('apacheExtra', () => {
  it('is empty for the licence alone, with or without its appendix', () => {
    expect(apacheExtra(APACHE)).toBe('');
    expect(apacheExtra(APACHE.slice(0, APACHE.indexOf('APPENDIX')))).toBe('');
  });

  it('is what a package added after the licence', () => {
    expect(apacheExtra(`${APACHE}\n\nBundled: tiny-helper (MIT).\n`)).toBe('Bundled: tiny-helper (MIT).');
  });

  it('is the whole text when the file is not the Apache licence', () => {
    expect(apacheExtra('Custom terms.')).toBe('Custom terms.');
  });
});

describe('the third-party statements about the Google Cloud product icons', () => {
  const read = (file: string): string => readFileSync(path.join(REPO, file), 'utf8').replace(/\s+/g, ' ');

  it('THIRD_PARTY.md says they are Google Cloud’s, provided at cloud.google.com/icons, not licensed by gcportrait', () => {
    const text = read('THIRD_PARTY.md');
    // The maintainer's rule of 2026-10-11: "Google" or "Google Cloud", never the company's legal name.
    expect(text).not.toContain(['Google', 'LLC'].join(' '));
    expect(text).toContain('https://cloud.google.com/icons');
    expect(text).toMatch(/Google Cloud product icons\*\*: Google Cloud's/);
    expect(text).toContain('neither gcportrait nor its maintainer licenses them');
  });

  it('LICENSE leaves them, and the gcportrait name and icon, out of the MIT License', () => {
    const text = read('LICENSE');
    expect(text.startsWith('MIT License Copyright (c) 2026 Florian Chrometz ')).toBe(true);
    expect(text).toContain('Not covered by the MIT License above:');
    expect(text).toContain(
      "the Google Cloud product icons under Google's icon usage terms. See THIRD_PARTY.md.",
    );
    expect(text).toContain('forks must use their own name and icon. See brand/LICENSE.md.');
  });
});
