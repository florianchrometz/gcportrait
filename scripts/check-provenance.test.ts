// SPDX-License-Identifier: MIT
import { symlinkSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FIXTURE_LICENSE, createTempTree, manifest, runScript, type TempTree } from './testing/temp-tree.js';

// The forbidden names, the legacy path and the Gizmo calls are assembled at run time so that this file does
// not itself trip the checker it tests.
const UPSTREAM_NAME = ['gcp', 'viz'].join('');
const OLD_NAME = ['kno', 'yog'].join('');
const LEGACY = ['leg', 'acy'].join('');
const OLD_DEP_NAME = ['for', 'seti'].join('');
const NOTICE = ['Copy', 'right'].join('');
const COMPANY = ['Goo', 'gle'].join('');
const GIZMO_V = ['g.', 'V('].join('');
const GIZMO_M = ['g.', 'M('].join('');
const GIZMO_EMIT = ['g.', 'emit('].join('');
const QUOTE = '"';
// The retired terms and the plan's ids, assembled for the same reason.
const SUFFIX = ['L', 'LC'].join('');
const PLAN_FILE = ['IMPLEMENTATION', 'PLAN'].join('');
const TASK_ID = ['P3', '6'].join('.');
const PHASE = ['Phase', '5'].join(' ');
const DECISION_ID = ['D', '18'].join('');
// The project's former licence (rule h), assembled for the same reason.
const FORMER = ['A', 'GPL'].join('');
const FORMER_LONG = ['GNU', ['Aff', 'ero'].join('')].join(' ');

const TS_HEADER = `// SPDX-License-Identifier: ${FIXTURE_LICENSE}`;
const MD_HEADER = `<!-- SPDX-License-Identifier: ${FIXTURE_LICENSE} -->`;
const HASH_HEADER = `# SPDX-License-Identifier: ${FIXTURE_LICENSE}`;
const CSS_HEADER = `/* SPDX-License-Identifier: ${FIXTURE_LICENSE} */`;

/** Writes a small tree that satisfies every rule, including the exempt places. */
function writeCleanTree(tree: TempTree): void {
  tree.write('package.json', manifest(FIXTURE_LICENSE));
  tree.write('LICENSE', 'placeholder licence text\n');
  tree.write('data.json', '{ "ok": true }\n');
  tree.write('image.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  tree.write('src/index.ts', `${TS_HEADER}\nexport const answer = 42;\n`);
  tree.write('scripts/tool.mjs', `#!/usr/bin/env node\n${TS_HEADER}\nconsole.log('ok');\n`);
  tree.write('README.md', `${MD_HEADER}\n\n# Fixture\n`);
  tree.write('docs/guide.md', `---\ntitle: Guide\n---\n${MD_HEADER}\n\n# Guide\n`);
  tree.write('config.yaml', `${HASH_HEADER}\nkey: value\n`);
  tree.write('styles.css', `${CSS_HEADER}\nbody { margin: 0; }\n`);
  tree.write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
  // Files without an extension are matched by name; .nvmrc stays a bare version number.
  tree.write('.gitignore', `${HASH_HEADER}\nnode_modules/\n`);
  tree.write('infra/Dockerfile', `# syntax=docker/dockerfile:1\n${HASH_HEADER}\nFROM scratch\n`);
  tree.write('.nvmrc', '22\n');
  // Exempt places may mention the old names, and skipped directories are not looked at at all.
  tree.write(
    'docs/adr/0001-decision.md',
    `${MD_HEADER}\n\nThe ${OLD_NAME} tree wrapped ${UPSTREAM_NAME}; we stop using it.\n`,
  );
  tree.write('packages/icons/README.md', `${MD_HEADER}\n\n# Icons\n\nNone of them from ${OLD_NAME}.\n`);
  tree.write(`${LEGACY}/${OLD_NAME}/main.go`, 'package main\n');
  tree.write(`${LEGACY}/README.md`, `The ${OLD_NAME} tree.\n`);
  tree.write('node_modules/dep/index.js', `module.exports = '${UPSTREAM_NAME}';\n`);
  tree.write('frontend/dist/bundle.js', 'console.log(1);\n');
}

describe('check-provenance', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = createTempTree('provenance');
    writeCleanTree(tree);
  });

  afterEach(() => {
    tree.remove();
  });

  const check = () => runScript('check-provenance.mjs', ['--root', tree.root]);

  it('passes a clean tree', () => {
    const result = check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('provenance: OK');
  });

  /**
   * The failing cases: files planted into the clean tree, the lines the check must print for them (`<file>:<line>
   * [rule] …`), and, where the case pins it, the summary's count of problems and files; `absent` must not be
   * reported. Every row is a rule of the provenance guard (agents.md rule 1 and 2): keep them all.
   */
  type Failing = {
    readonly name: string;
    readonly files: Readonly<Record<string, string | Uint8Array>>;
    readonly lines: readonly string[];
    readonly summary?: readonly [problems: number, files: number];
    readonly absent?: readonly string[];
  };
  const legacyTarget = `${QUOTE}../../${LEGACY}/thing.js${QUOTE}`;
  const FAILING: readonly Failing[] = [
    {
      name: 'a planted legacy import',
      files: {
        'frontend/src/bad.ts': `${TS_HEADER}\nimport x from ${QUOTE}../${LEGACY}/${OLD_NAME}/x${QUOTE};\nexport default x;\n`,
      },
      lines: ['frontend/src/bad.ts:2  [legacy-import]'],
      summary: [2, 1],
    },
    {
      name: 'require(), dynamic import() and re-exports from legacy',
      files: {
        'backend/src/a.cjs': `${TS_HEADER}\nconst thing = require(${legacyTarget});\n`,
        'backend/src/b.ts': `${TS_HEADER}\nconst m = await import(${legacyTarget});\n`,
        'backend/src/c.ts': `${TS_HEADER}\nexport * from ${legacyTarget};\n`,
      },
      lines: ['a.cjs', 'b.ts', 'c.ts'].map((file) => `backend/src/${file}:2  [legacy-import]`),
    },
    {
      name: 'a planted forbidden name, case-insensitively',
      files: { 'docs/notes.md': `${MD_HEADER}\n\nThis came from ${UPSTREAM_NAME.toUpperCase()}.\n` },
      lines: [`docs/notes.md:3  [forbidden-name] mentions "${UPSTREAM_NAME}"`],
    },
    {
      // A camelCase constructor, an identifier with a suffix and a hyphenated name all contain the name.
      name: 'the old names anywhere inside a word, including camelCase identifiers',
      files: {
        'src/camel.ts': `${TS_HEADER}\nexport const viz = ${['New', 'Gcp', 'Viz'].join('')}();\n`,
        'src/state.ts': `${TS_HEADER}\nexport const ${OLD_NAME}State = {};\n`,
        'src/bucket.ts': `${TS_HEADER}\nexport const bucket = 'react-${OLD_NAME}-state';\n`,
        'src/deps.ts': `${TS_HEADER}\nexport const dep = 'github.com/${OLD_DEP_NAME}Security/x';\n`,
      },
      lines: [
        `src/camel.ts:2  [forbidden-name] mentions "${UPSTREAM_NAME}"`,
        `src/state.ts:2  [forbidden-name] mentions "${OLD_NAME}"`,
        `src/bucket.ts:2  [forbidden-name] mentions "${OLD_NAME}"`,
        `src/deps.ts:2  [forbidden-name] mentions "${OLD_DEP_NAME}"`,
      ],
      summary: [4, 4],
    },
    {
      name: 'a Google copyright notice in its usual forms',
      files: {
        'src/a.ts': `${TS_HEADER}\n// ${NOTICE} 2022 ${COMPANY} LLC\nexport {};\n`,
        'src/b.ts': `${TS_HEADER}\n/* ${NOTICE} (c) 2019 ${COMPANY} Inc. */\nexport {};\n`,
        'src/c.ts': `${TS_HEADER}\n// ${NOTICE.toUpperCase()}  ${COMPANY.toLowerCase()} LLC\nexport {};\n`,
        'src/d.ts': `${TS_HEADER}\n// \u00a9 2021 ${COMPANY} LLC\nexport {};\n`,
      },
      lines: [
        ...['a', 'b', 'c', 'd'].map(
          (file) => `src/${file}.ts:2  [forbidden-name] mentions "${NOTICE} ${COMPANY}"`,
        ),
        // The company suffix is a retired term of its own: three of the four notices carry it.
        ...['a', 'c', 'd'].map((file) => `src/${file}.ts:2  [retired-term] mentions "${COMPANY} ${SUFFIX}"`),
      ],
      summary: [7, 4],
    },
    {
      // The shape of a copied upstream config file: our header, then the original licence header kept intact.
      name: 'an upstream file copied verbatim with only the SPDX line prepended',
      files: {
        'packages/model/labels.yaml': [
          HASH_HEADER,
          `# ${NOTICE} 2022 ${COMPANY} LLC`,
          '#',
          '# Licensed under the Apache License, Version 2.0 (the "License");',
          '# you may not use this file except in compliance with the License.',
          'labels:',
          '  - name: example',
          '',
        ].join('\n'),
      },
      lines: [`packages/model/labels.yaml:2  [forbidden-name] mentions "${NOTICE} ${COMPANY}"`],
    },
    {
      name: 'a forbidden name in a file or directory name, even with clean contents',
      files: {
        [`frontend/src/zz-plant-${OLD_NAME}-filename.ts`]: `${TS_HEADER}\nexport {};\n`,
        [`src/${UPSTREAM_NAME}/index.ts`]: `${TS_HEADER}\nexport {};\n`,
        [`assets/${OLD_NAME}.png`]: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
      },
      lines: [
        `frontend/src/zz-plant-${OLD_NAME}-filename.ts  [forbidden-name] path mentions "${OLD_NAME}"`,
        `src/${UPSTREAM_NAME}/index.ts  [forbidden-name] path mentions "${UPSTREAM_NAME}"`,
        `assets/${OLD_NAME}.png  [forbidden-name] path mentions "${OLD_NAME}"`,
      ],
      summary: [3, 3],
    },
    {
      // No exemption: not the decision records, not the icons README.
      name: "Google's company suffix and the retired planning document, in contents and in names, anywhere",
      files: {
        'docs/adr/0003-icons.md': `${MD_HEADER}\n\nThe icons are ${COMPANY}'s (${COMPANY}, ${SUFFIX.toLowerCase()}).\n`,
        'packages/icons/README.md': `${MD_HEADER}\n\n# Icons\n\nTrademarks of ${COMPANY} ${SUFFIX}.\n`,
        'src/rules.ts': `${TS_HEADER}\n// The packing rule (see ${PLAN_FILE}.md).\nexport {};\n`,
        [`docs/${PLAN_FILE}.md`]: `${MD_HEADER}\n\n# Plan\n`,
      },
      lines: [
        `docs/adr/0003-icons.md:3  [retired-term] mentions "${COMPANY} ${SUFFIX}"`,
        `packages/icons/README.md:5  [retired-term] mentions "${COMPANY} ${SUFFIX}"`,
        `src/rules.ts:2  [retired-term] mentions "${PLAN_FILE}"`,
        `docs/${PLAN_FILE}.md  [retired-term] path mentions "${PLAN_FILE}"`,
      ],
      summary: [4, 4],
    },
    {
      // Task and phase ids in any text file, decision ids in Markdown only: in code such a token is often a name.
      name: 'ids of the retired implementation plan outside the historical records',
      files: {
        'src/layout.ts': `${TS_HEADER}\n// Packing rules from ${TASK_ID}.\nexport const ${DECISION_ID} = 1;\n`,
        'docs/guide-two.md': `${MD_HEADER}\n\nAt the ${PHASE.toLowerCase()} review, decision ${DECISION_ID} said so.\n`,
        '.changeset/step.md': `---\n'@gcportrait/model': patch\n---\n\nThe ${PHASE} follow-ups.\n`,
      },
      lines: [
        `src/layout.ts:2  [plan-id] "${TASK_ID}" reads as a task id of the retired implementation plan`,
        `docs/guide-two.md:3  [plan-id] "${PHASE.toLowerCase()}" reads as a phase`,
        `docs/guide-two.md:3  [plan-id] "${DECISION_ID}" reads as a decision id`,
        `.changeset/step.md:5  [plan-id] "${PHASE}" reads as a phase`,
      ],
      summary: [4, 3],
      absent: ['src/layout.ts:3'],
    },
    {
      // Contents outside the exempt places, and paths anywhere; a CHANGELOG's intro and unreleased section count, its
      // released sections are history.
      name: 'the former licence outside the record of the decision',
      files: {
        'src/footer.ts': `${TS_HEADER}\nexport const SOURCE = 'Source (${FORMER}-3.0)';\n`,
        'docs/licence.md': `${MD_HEADER}\n\nLicensed under the ${FORMER_LONG.toUpperCase()} General Public License.\n`,
        [`scripts/licenses/${FORMER}-3.0-only.txt`]: 'licence text\n',
        'CHANGELOG.md': [
          '# Changelog',
          '',
          `Now under ${FORMER.toLowerCase()}-3.0.`,
          '',
          '## Unreleased',
          '',
          `Back to ${FORMER}.`,
          '',
          '## 1.0.0 (2026-10-12)',
          '',
          `Was ${FORMER}-3.0-only.`,
          '',
        ].join('\n'),
      },
      lines: [
        `src/footer.ts:2  [former-licence] mentions "${FORMER}"`,
        `docs/licence.md:3  [former-licence] mentions "${FORMER_LONG}"`,
        `scripts/licenses/${FORMER}-3.0-only.txt  [former-licence] path mentions "${FORMER}"`,
        `CHANGELOG.md:3  [former-licence] mentions "${FORMER}"`,
        `CHANGELOG.md:7  [former-licence] mentions "${FORMER}"`,
      ],
      summary: [5, 4],
      absent: ['CHANGELOG.md:11'],
    },
    {
      name: 'a missing SPDX header',
      files: { 'src/no-header.ts': 'export const x = 1;\n' },
      lines: ['src/no-header.ts  [spdx-header] missing SPDX header'],
      summary: [1, 1],
    },
    {
      name: 'a dotfile, Dockerfile or CODEOWNERS file without the header',
      files: {
        '.npmrc': 'engine-strict=true\n',
        '.editorconfig': 'root = true\n',
        '.prettierignore': 'dist/\n',
        'backend/Dockerfile': 'FROM scratch\n',
        '.github/CODEOWNERS': '* @example\n',
      },
      lines: ['.npmrc', '.editorconfig', '.prettierignore', 'backend/Dockerfile', '.github/CODEOWNERS'].map(
        (file) => `${file}  [spdx-header] missing SPDX header; add the line "${HASH_HEADER}"`,
      ),
      summary: [5, 5],
    },
    {
      name: 'a header in the wrong comment style or too far down',
      files: {
        'styles/bad.css': `${TS_HEADER}\nbody {}\n`,
        'src/late.ts': `${'\n'.repeat(10)}${TS_HEADER}\nexport {};\n`,
      },
      lines: ['styles/bad.css  [spdx-header]', 'src/late.ts  [spdx-header]'],
    },
    {
      // Shaped like the upstream query files: the Gizmo call sits mid-line, after an assignment or an `if`; ordinary
      // code that merely mentions emit or a V() method on another object is fine. A banned file is reported once: it
      // has to go, so the header rule does not report it as well.
      name: 'Go, Graphviz and Gizmo query files outside legacy',
      files: {
        'cmd/main.go': 'package main\n',
        'templates/graph.dot': 'digraph {}\n',
        'templates/graph.gv': 'digraph {}\n',
        'queries/all.js': `${TS_HEADER}\nvar root = ${GIZMO_V}${QUOTE}{{ index .Organizations 0 }}${QUOTE});\nroot.Out().All();\n`,
        'queries/typed.ts': `${TS_HEADER}\nexport {};\nfunction walk(node: { id: string }): void {\n  if (node.id) ${GIZMO_EMIT}node);\n}\n`,
        'queries/morph.mjs': `${TS_HEADER}\nexport const path = ${GIZMO_M}).Out('uses');\n`,
        'src/events.ts': `${TS_HEADER}\nexport function fire(bus: { emit(name: string): void }, graph: { V(id: number): void }): void {\n  bus.emit('ready');\n  graph.V(1);\n}\n`,
      },
      lines: [
        'cmd/main.go  [banned-file]',
        'templates/graph.dot  [banned-file]',
        'templates/graph.gv  [banned-file]',
        'queries/all.js:2  [banned-file]',
        'queries/typed.ts:4  [banned-file]',
        'queries/morph.mjs:2  [banned-file]',
      ],
      summary: [6, 6],
      absent: ['src/events.ts'],
    },
    {
      // Header-free formats and names next to them: JSON family, plain text, SVG, files that cannot carry a comment;
      // a NOTICE file is none of them (gcportrait has none since 2026-10-12, ADR 0017).
      name: 'a text file type that has no header rule, and accepts the header-free formats',
      files: {
        'config/settings.toml': 'key = "value"\n',
        'website/src/pages/intro.mdx': '# Intro\n',
        'infra/Dockerfile.dev': 'FROM scratch\n',
        'fixtures/export.ndjson': '{"name":"a"}\n',
        'fixtures/types.txt': 'compute.googleapis.com/Instance\n',
        'icons/vm.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
        '.prettierrc': '{}\n',
        'docs/screenshots/.gitkeep': '',
        'website/public/CNAME': 'diagrams.example.com\n',
        NOTICE: 'fixture\nCopyright (C) 2026  Example Maintainer\n',
      },
      lines: ['config/settings.toml', 'website/src/pages/intro.mdx', 'infra/Dockerfile.dev', 'NOTICE'].map(
        (file) => `${file}  [spdx-header] no SPDX header form is defined for this file type`,
      ),
      summary: [4, 4],
    },
  ];

  // A loop rather than it.each: its `$name` would cut the names at 40 characters.
  for (const { name, files, lines, summary, absent = [] } of FAILING) {
    it(`fails on ${name}`, () => {
      for (const [relPath, content] of Object.entries(files)) tree.write(relPath, content);
      const result = check();
      expect(result.status).toBe(1);
      for (const line of lines) expect(result.stderr).toContain(line);
      for (const text of absent) expect(result.stderr).not.toContain(text);
      if (summary !== undefined)
        expect(result.stderr).toContain(
          `FAILED with ${String(summary[0])} problem(s) in ${String(summary[1])} file(s)`,
        );
    });
  }

  it('does not mistake ordinary uses of the words for a Google copyright notice', () => {
    tree.write('src/ok.ts', `${TS_HEADER}\n// ${COMPANY} Cloud renders here.\n// ${NOTICE}: see LICENSE.\n`);
    const result = check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('allows the plan ids in the historical records, and look-alikes that are not ids', () => {
    tree.write(
      'docs/adr/0004-history.md',
      `${MD_HEADER}\n\nDecided as ${DECISION_ID} in ${TASK_ID} (${PHASE}).\n`,
    );
    tree.write('docs/history/2026-10-10-review.md', `${MD_HEADER}\n\nWhat ${TASK_ID} changed in ${PHASE}.\n`);
    // Versions, colours, CSS, and words that only start like an id.
    tree.write(
      'docs/notes.md',
      `${MD_HEADER}\n\nVersion 3.6.0, colour #D1D5DB, a DE1 adapter, P35, Phase 8, phased 2, ${DECISION_ID}x.\n`,
    );
    tree.write('src/sizes.ts', `${TS_HEADER}\nexport const P = { P30: 1, p3: 2 };\n`);
    const result = check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('allows the former licence in the decision record, the deny list, licence texts and released notes', () => {
    tree.write('THIRD_PARTY.md', `${MD_HEADER}\n\nDenied: GPL, LGPL, ${FORMER} (network copyleft).\n`);
    tree.write('docs/adr/0017-licence.md', `${MD_HEADER}\n\nFirst ${FORMER}-3.0-only, then MIT.\n`);
    tree.write('scripts/check-licenses.mjs', `${TS_HEADER}\nexport const family = '${FORMER}-*';\n`);
    tree.write('scripts/check-licenses.test.ts', `${TS_HEADER}\nexport const id = '${FORMER}-3.0-only';\n`);
    tree.write('scripts/licenses/MPL-2.0.txt', `the ${FORMER_LONG} General Public License, Version 3.0\n`);
    tree.write(
      'packages/model/CHANGELOG.md',
      `# @fx/model\n\n## 1.0.0\n\n### Major Changes\n\n- Licensed under ${FORMER}-3.0-only.\n`,
    );
    // Hashes and words that merely contain the letters.
    tree.write(
      'src/hash.ts',
      `${TS_HEADER}\nexport const integrity = 'sha512-x${FORMER.toLowerCase()}Q==';\nexport const lgpl = 'LGPL-2.1';\n`,
    );
    const result = check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('allows a forbidden name in the path of an exempt document', () => {
    tree.write(`docs/adr/0002-drop-${UPSTREAM_NAME}.md`, `${MD_HEADER}\n\nWhy ${UPSTREAM_NAME} goes.\n`);
    const result = check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('requires the identifier named in the root package.json', () => {
    tree.write('package.json', manifest('MIT'));
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`[spdx-header] SPDX header names "${FIXTURE_LICENSE}"`);
    // Files matched by name are held to the same identifier as files matched by extension.
    expect(result.stderr).toContain(`.gitignore:1  [spdx-header] SPDX header names "${FIXTURE_LICENSE}"`);
    expect(result.stderr).toContain(
      `infra/Dockerfile:2  [spdx-header] SPDX header names "${FIXTURE_LICENSE}"`,
    );
  });

  it('reports symbolic links instead of following them', () => {
    // The link targets live under legacy/, which the walker skips; only the links themselves are visible.
    tree.write(`${LEGACY}/vendor/main.go`, 'package main\n');
    tree.write(`${LEGACY}/vendor/util.ts`, 'export const copied = true;\n');
    tree.write('packages/model/.gitkeep', '');
    symlinkSync(path.join(tree.root, LEGACY, 'vendor'), path.join(tree.root, 'packages/model/vendor'), 'dir');
    symlinkSync(path.join(tree.root, LEGACY, 'vendor/util.ts'), path.join(tree.root, 'src/util.ts'), 'file');
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('packages/model/vendor  [symlink]');
    expect(result.stderr).toContain('src/util.ts  [symlink]');
    expect(result.stderr).toContain('FAILED with 2 problem(s) in 2 file(s)');
  });

  it('requires the hash header on .env.example, which is walked although other .env files are not', () => {
    tree.write('backend/.env', 'SECRET=never-read\n');
    tree.write('backend/.env.local', 'SECRET=never-read\n');
    tree.write('backend/.env.example', 'OAUTH_CLIENT_ID=\n');
    const failing = check();
    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain(
      `backend/.env.example  [spdx-header] missing SPDX header; add the line "${HASH_HEADER}"`,
    );
    expect(failing.stderr).toContain('FAILED with 1 problem(s) in 1 file(s)');
    tree.write('backend/.env.example', `${HASH_HEADER}\nOAUTH_CLIENT_ID=\n`);
    expect(check().status).toBe(0);
  });

  it('skips Playwright output only under e2e/, and git-ignored scratch files anywhere', () => {
    tree.write('e2e/test-results/run/trace.ts', 'export {};\n');
    tree.write('e2e/playwright-report/index.html', '<p>report</p>\n');
    tree.write('debug.log', 'log line\n');
    tree.write('frontend/.DS_Store', 'not really binary\n');
    expect(check().status).toBe(0);
    // The same directory names elsewhere are walked like any other directory.
    tree.write('frontend/test-results/leak.ts', 'export {};\n');
    tree.write('packages/model/playwright-report/leak.ts', 'export {};\n');
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('frontend/test-results/leak.ts  [spdx-header] missing SPDX header');
    expect(result.stderr).toContain(
      'packages/model/playwright-report/leak.ts  [spdx-header] missing SPDX header',
    );
  });

  it('prints the rules with --list-exempt', () => {
    const result = runScript('check-provenance.mjs', ['--list-exempt']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('(a) legacy-import');
    expect(result.stdout).toContain('(d) spdx-header');
    expect(result.stdout).toContain('docs/adr/**');
    expect(result.stdout).toContain('packages/icons/README.md');
    expect(result.stdout).toContain('.editorconfig');
    expect(result.stdout).toContain('Dockerfile');
    expect(result.stdout).toContain('.env.example');
    expect(result.stdout).toContain('header-free');
    expect(result.stdout).toContain('substring');
    expect(result.stdout).toContain('(f) retired-term');
    expect(result.stdout).toContain(`"${COMPANY} ${SUFFIX}", "${PLAN_FILE}"`);
    expect(result.stdout).toContain('(g) plan-id');
    expect(result.stdout).toContain('not applied in: docs/adr/**, docs/history/**');
    expect(result.stdout).toContain('(h) former-licence');
    expect(result.stdout).toContain(`"${FORMER}", "${FORMER_LONG}"`);
    expect(result.stdout).toContain('docs/adr/0017-* (the record of the licence decision)');
    expect(result.stdout).toContain('the released sections of any CHANGELOG.md');
  });

  it('exempts only the decision records, the icons README and the checker from the name rule, and only generated or consumed files from the header rule', () => {
    const result = runScript('check-provenance.mjs', ['--list-exempt']);
    expect(result.status).toBe(0);
    const allowed = /^ {4}allowed only in: (.+)$/m.exec(result.stdout)?.[1];
    expect(allowed).toBe(
      'docs/adr/**, packages/icons/README.md, scripts/check-provenance.mjs (this checker)',
    );
    const headerExempt = /^ {4}header-exempt:\n((?: {6}.+\n)+)/m.exec(result.stdout)?.[1] ?? '';
    expect(
      headerExempt
        .split('\n')
        .filter(Boolean)
        .map((line) => line.trim()),
    ).toEqual([
      'pnpm-lock.yaml (lockfile, generated)',
      '.changeset/*.md except README.md (changeset entries, consumed and deleted at release)',
      '**/CHANGELOG.md (generated by `changeset version`)',
    ]);
  });

  it('rejects unknown options', () => {
    const result = runScript('check-provenance.mjs', ['--bogus']);
    expect(result.status).toBe(2);
  });
});
