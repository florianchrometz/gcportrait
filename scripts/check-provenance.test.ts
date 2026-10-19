// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { Console } from 'node:console';
import { readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './check-provenance.mjs';
import {
  FIXTURE_LICENSE,
  REPO,
  createTempTree,
  manifest,
  runInProcess,
  runScript,
  SPAWN_TIMEOUT,
  type TempTree,
} from './testing/temp-tree.js';

// Every string the checker refuses is assembled at run time, so that this file does not itself trip the
// checker it tests (it is scanned like every other file, with no exemption).
const NAME_A = ['gcp', 'viz'].join('');
const NAME_B = ['kno', 'yog'].join('');
const NAME_C = ['for', 'seti'].join('');
const NOTICE = ['Copy', 'right'].join('');
const COMPANY = ['Goo', 'gle'].join('');
const SUFFIX = ['L', 'LC'].join('');
const GIZMO_V = ['g.', 'V('].join('');
const GIZMO_M = ['g.', 'M('].join('');
const GIZMO_EMIT = ['g.', 'emit('].join('');
const QUOTE = '"';

/** A name with its letters in alternating case, as inside a camelCase identifier. */
function mixedCase(name: string): string {
  return name.replace(/[a-z]/g, (letter, index: number) => (index % 2 === 0 ? letter : letter.toUpperCase()));
}
// Decision records: the abbreviation, spelled out, a folder of them, and a numbered rule of AGENTS.md.
const RECORD = ['A', 'DR'].join('');
const RECORD_SPELLED = ['Architecture', 'Decision', 'Record'].join(' ');
const RECORD_NUMBERED = ['decision', 'record', '42'].join(' ');
const RECORD_FOLDER = ['handbook', RECORD.toLowerCase()].join('/');
const RULE_NUMBER = ['AGENTS.md', 'rule', '9'].join(' ');
const RULE_OF = ['rule', '12', 'of', 'AGENTS.md'].join(' ');
const FOLDER_RULE_NUMBER = ['frontend/AGENTS.md', 'rule', '3'].join(' ');
// Build-record wording the checker refuses by pattern.
const VERIFIED = ['Verified', 'on'].join(' ');
const AMENDED_ON = ['amended', 'on'].join(' ');
const AS_AMENDED = ['as', 'amended'].join(' ');
const AS_DECIDED = ['as', 'decided'].join(' ');
const DATE = ['2030', '04', '02'].join('-');
const DATE_WRITTEN = ['2', 'April', '2030'].join(' ');
const DATE_US = ['Apr', '2,', '2030'].join(' ');
// Phrases and a directory refused by digest only for a test run (--also-refuse): ordinary words, so that
// the mechanism is tested without this file naming a phrase the checker refuses for real.
const JOINED_PHRASE = 'blue-lantern';
const SPACED_PHRASE = 'copper kettle';
const DIRECTORY = 'vault/';
const DATED_WORD = 'voyage of <date>';
// Ids of work items.
const TASK_ID = ['P12', '4'].join('.');
const PHASE = ['Phase', '11'].join(' ');
const DECISION_ID = ['D', '42'].join('');
// The denied licence family (rule g).
const LICENCE_SHORT = ['A', 'GPL'].join('');
const LICENCE_LONG = ['GNU', ['Aff', 'ero'].join('')].join(' ');

const TS_HEADER = `// SPDX-License-Identifier: ${FIXTURE_LICENSE}`;
const MD_HEADER = `<!-- SPDX-License-Identifier: ${FIXTURE_LICENSE} -->`;
const HASH_HEADER = `# SPDX-License-Identifier: ${FIXTURE_LICENSE}`;
const CSS_HEADER = `/* SPDX-License-Identifier: ${FIXTURE_LICENSE} */`;

/** Every refused string at once, for the places the walker never reads. */
const EVERY_REFUSED_STRING = [
  NAME_A,
  NAME_B,
  `${COMPANY} ${SUFFIX}`,
  `${RECORD} 12`,
  RECORD_FOLDER,
  VERIFIED,
  TASK_ID,
  LICENCE_SHORT,
].join(' ');

/** Binary fixtures: the signature of a format, then bytes that are not plain text. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function bytes(...parts: ReadonlyArray<string | readonly number[] | Uint8Array>): Uint8Array {
  return Buffer.concat(
    parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part))),
  );
}
/** A PNG chunk: its length, type and data, and four bytes in place of the checksum. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return bytes(length, type, data, [0x12, 0x34, 0x56, 0x78]);
}
function utf16(text: string, order: 'le' | 'be' = 'le'): Buffer {
  const buffer = Buffer.from(text, 'utf16le');
  return order === 'be' ? buffer.swap16() : buffer;
}

/**
 * The PHRASE_DIGESTS entries the checker prints for phrases, in their order, in one invocation.
 */
async function digestsOf(...phrases: readonly string[]): Promise<string[]> {
  const result = await runInProcess(() => run(phrases.flatMap((phrase) => ['--digest-of', phrase])));
  expect(result.stderr).toBe('');
  const entries = result.stdout.trim().split('\n');
  expect(entries).toHaveLength(phrases.length);
  return entries;
}

/** Writes a small tree that satisfies every rule. */
function writeCleanTree(tree: TempTree): void {
  tree.write('package.json', manifest(FIXTURE_LICENSE));
  tree.write('LICENSE', 'licence text\n');
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
  tree.write('.gitignore', `${HASH_HEADER}\nnode_modules/\n/frontend/dist/\n`);
  tree.write('infra/Dockerfile', `# syntax=docker/dockerfile:1\n${HASH_HEADER}\nFROM scratch\n`);
  tree.write('.nvmrc', '22\n');
  // Skipped directories are not looked at at all, whatever they hold.
  tree.write('node_modules/dep/index.js', `module.exports = '${EVERY_REFUSED_STRING}';\n`);
  tree.write('node_modules/dep/main.go', 'package main\n');
  tree.write('frontend/dist/bundle.js', `console.log('${EVERY_REFUSED_STRING}');\n`);
}

describe('check-provenance', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = createTempTree('provenance');
    writeCleanTree(tree);
    const output = new Console(process.stdout, process.stderr);
    vi.spyOn(console, 'log').mockImplementation(output.log.bind(output));
    vi.spyOn(console, 'error').mockImplementation(output.error.bind(output));
  });

  afterEach(() => {
    tree.remove();
    vi.restoreAllMocks();
  });

  const check = (...args: string[]) => runInProcess(() => run(['--root', tree.root, ...args]));

  it('passes a clean tree', async () => {
    const result = await check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'provenance: OK. 14 files scanned, 8 SPDX headers (LicenseRef-gcportrait-unset) verified; no forbidden names, banned terms or banned files.',
    );
  });

  /**
   * The failing cases: files planted into the clean tree, the lines the check must print for them
   * (`<file>:<line> [rule] …`), and, where the case pins it, the summary's count of problems and files;
   * `absent` must not be reported. `refuse` lists phrases whose digests the run refuses as well
   * (`--also-refuse`). Every row is a rule of the provenance guard (AGENTS.md, Licence and dependencies,
   * and Names that never appear): keep them all.
   */
  type Failing = {
    readonly name: string;
    readonly files: Readonly<Record<string, string | Uint8Array>>;
    readonly lines: readonly string[];
    readonly summary?: readonly [problems: number, files: number];
    readonly absent?: readonly string[];
    readonly refuse?: readonly string[];
  };
  const FAILING: readonly Failing[] = [
    {
      name: 'a planted forbidden name, case-insensitively',
      files: { 'docs/notes.md': `${MD_HEADER}\n\nA line with ${NAME_A.toUpperCase()} in it.\n` },
      lines: [`docs/notes.md:3  [forbidden-name] mentions "${NAME_A}"`],
      summary: [1, 1],
    },
    {
      // A camelCase constructor, an identifier with a suffix and a hyphenated name all contain the name.
      name: 'the forbidden names anywhere inside a word, including camelCase identifiers',
      files: {
        'src/camel.ts': `${TS_HEADER}\nexport const made = New${mixedCase(NAME_A)}();\n`,
        'src/state.ts': `${TS_HEADER}\nexport const ${NAME_B}State = {};\n`,
        'src/bucket.ts': `${TS_HEADER}\nexport const bucket = 'demo-${NAME_B}-bucket';\n`,
        'src/deps.ts': `${TS_HEADER}\nexport const dep = 'example.com/${NAME_C}Extra/x';\n`,
      },
      lines: [
        `src/camel.ts:2  [forbidden-name] mentions "${NAME_A}"`,
        `src/state.ts:2  [forbidden-name] mentions "${NAME_B}"`,
        `src/bucket.ts:2  [forbidden-name] mentions "${NAME_B}"`,
        `src/deps.ts:2  [forbidden-name] mentions "${NAME_C}"`,
      ],
      summary: [4, 4],
    },
    {
      // A hyphen or an underscore between the halves of a name, and for the first two a space or a dot.
      name: 'the forbidden names with a separator between their halves',
      files: {
        'docs/split.md': [
          MD_HEADER,
          '',
          `The ${NAME_A.slice(0, 3)}-${NAME_A.slice(3)} tool.`,
          `The ${NAME_B.slice(0, 3).toUpperCase()} ${NAME_B.slice(3)} tool.`,
          `The ${NAME_C.slice(0, 3)}_${NAME_C.slice(3)} tool.`,
          `The ${NAME_A.slice(0, 3)}.${NAME_A.slice(3)} tool.`,
          '',
        ].join('\n'),
      },
      lines: [
        `docs/split.md:3  [forbidden-name] mentions "${NAME_A}"`,
        `docs/split.md:4  [forbidden-name] mentions "${NAME_B}"`,
        `docs/split.md:5  [forbidden-name] mentions "${NAME_C}"`,
        `docs/split.md:6  [forbidden-name] mentions "${NAME_A}"`,
      ],
      summary: [4, 1],
    },
    {
      // No document is exempt, wherever it sits.
      name: 'a forbidden name in any document',
      files: {
        'packages/icons/README.md': `${MD_HEADER}\n\n# Icons\n\nA line with ${NAME_B}.\n`,
        'docs/notes/team.md': `${MD_HEADER}\n\nTwo names: ${NAME_B} and ${NAME_A}.\n`,
      },
      lines: [
        `packages/icons/README.md:5  [forbidden-name] mentions "${NAME_B}"`,
        `docs/notes/team.md:3  [forbidden-name] mentions "${NAME_A}"`,
        `docs/notes/team.md:3  [forbidden-name] mentions "${NAME_B}"`,
      ],
      summary: [3, 2],
    },
    {
      name: 'a Google copyright notice in its usual forms',
      files: {
        'src/a.ts': `${TS_HEADER}\n// ${NOTICE} 2022 ${COMPANY} ${SUFFIX}\nexport {};\n`,
        'src/b.ts': `${TS_HEADER}\n/* ${NOTICE} (c) 2019 ${COMPANY} Inc. */\nexport {};\n`,
        'src/c.ts': `${TS_HEADER}\n// ${NOTICE.toUpperCase()}  ${COMPANY.toLowerCase()} ${SUFFIX}\nexport {};\n`,
        'src/d.ts': `${TS_HEADER}\n// © 2021 ${COMPANY} ${SUFFIX}\nexport {};\n`,
      },
      lines: [
        ...['a', 'b', 'c', 'd'].map(
          (file) => `src/${file}.ts:2  [forbidden-name] mentions "${NOTICE} ${COMPANY}"`,
        ),
        // The company suffix is a banned term of its own: three of the four notices carry it.
        `src/a.ts:2  [banned-term] mentions "${COMPANY} ${SUFFIX}" (${COMPANY}'s name with its company suffix)`,
        `src/c.ts:2  [banned-term] mentions "${COMPANY.toLowerCase()} ${SUFFIX}"`,
        `src/d.ts:2  [banned-term] mentions "${COMPANY} ${SUFFIX}"`,
      ],
      summary: [7, 4],
    },
    {
      // The shape of a copied config file: our header, then the original licence header kept intact.
      name: 'a file copied verbatim with only the SPDX line prepended',
      files: {
        'packages/model/labels.yaml': [
          HASH_HEADER,
          `# ${NOTICE} 2022 ${COMPANY} Inc.`,
          '#',
          '# Licensed under the Apache License, Version 2.0 (the "License");',
          '# you may not use this file except in compliance with the License.',
          'labels:',
          '  - name: example',
          '',
        ].join('\n'),
      },
      lines: [`packages/model/labels.yaml:2  [forbidden-name] mentions "${NOTICE} ${COMPANY}"`],
      summary: [1, 1],
    },
    {
      name: 'a forbidden name in a file or directory name, even with clean contents',
      files: {
        [`frontend/src/zz-plant-${NAME_B}-filename.ts`]: `${TS_HEADER}\nexport {};\n`,
        [`src/${NAME_A}/index.ts`]: `${TS_HEADER}\nexport {};\n`,
        [`assets/${NAME_B}.png`]: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
      },
      lines: [
        `frontend/src/zz-plant-${NAME_B}-filename.ts  [forbidden-name] path mentions "${NAME_B}"`,
        `src/${NAME_A}/index.ts  [forbidden-name] path mentions "${NAME_A}"`,
        `assets/${NAME_B}.png  [forbidden-name] path mentions "${NAME_B}"`,
      ],
      summary: [3, 3],
    },
    {
      name: "Google's company suffix in any document",
      files: {
        'docs/icons.md': `${MD_HEADER}\n\nThe icons are ${COMPANY}'s (${COMPANY}, ${SUFFIX.toLowerCase()}).\n`,
        'packages/icons/README.md': `${MD_HEADER}\n\n# Icons\n\nTrademarks of ${COMPANY} ${SUFFIX}.\n`,
      },
      lines: [
        `docs/icons.md:3  [banned-term] mentions "${COMPANY}, ${SUFFIX.toLowerCase()}"`,
        `packages/icons/README.md:5  [banned-term] mentions "${COMPANY} ${SUFFIX}"`,
      ],
      summary: [2, 2],
    },
    {
      // A citation with and without a number, a plural, one broken across a line, in any case and with or
      // without a separator before the number, spelled out, links into a folder of records (relative and
      // from the root), a folder of records as a path, and a numbered rule of AGENTS.md in both orders and of
      // a folder's AGENTS.md.
      name: 'citations of decision records and numbered rules',
      files: {
        'backend/src/cache.ts': `${TS_HEADER}\n// The cache (${RECORD} 12 §3).\nexport {};\n`,
        'docs/modes.md': `${MD_HEADER}\n\nSee [${RECORD}\n7](${RECORD.toLowerCase()}/colours.md).\n`,
        'docs/index.md': [
          MD_HEADER,
          '',
          `Read the ${RECORD}s first.`,
          `Links: ../${RECORD.toLowerCase()}/README.md and ${RECORD_FOLDER}/x.md.`,
          '',
        ].join('\n'),
        [`${RECORD_FOLDER}/notes.md`]: `${MD_HEADER}\n\n# Notes\n`,
        'backend/src/rules.ts': `${TS_HEADER}\n// Colours (${RULE_NUMBER}).\n// Pure (${RULE_OF}).\nexport {};\n`,
        'frontend/src/layouts.ts': `${TS_HEADER}\n// Folds (${FOLDER_RULE_NUMBER}).\nexport {};\n`,
        'docs/forms.md': [
          MD_HEADER,
          '',
          `See ${RECORD.toLowerCase()} 0042.`,
          `See ${RECORD.charAt(0)}${RECORD.slice(1).toLowerCase()} 9.`,
          `See ${RECORD}0042 and ${RECORD}_0042.`,
          `An ${RECORD_SPELLED} says so.`,
          `See ${RECORD_NUMBERED}.`,
          '',
        ].join('\n'),
      },
      lines: [
        `backend/src/cache.ts:2  [banned-term] mentions "${RECORD} 12" (a citation of a decision record); state the rule, or point to the section of the AGENTS.md that holds it`,
        `docs/modes.md:3  [banned-term] mentions "${RECORD}" (a citation of a decision record)`,
        `docs/modes.md:4  [banned-term] mentions "${RECORD.toLowerCase()}/" (a citation of a decision record)`,
        `docs/index.md:3  [banned-term] mentions "${RECORD}s"`,
        `docs/index.md:4  [banned-term] mentions "${RECORD.toLowerCase()}/"`,
        `${RECORD_FOLDER}/notes.md  [banned-term] path mentions "${RECORD.toLowerCase()}/"`,
        `backend/src/rules.ts:2  [banned-term] mentions "${RULE_NUMBER}" (a numbered rule of AGENTS.md)`,
        `backend/src/rules.ts:3  [banned-term] mentions "${RULE_OF}"`,
        `frontend/src/layouts.ts:2  [banned-term] mentions "${FOLDER_RULE_NUMBER.slice('frontend/'.length)}" (a numbered rule of AGENTS.md); cite the AGENTS.md that holds the rule`,
        `docs/forms.md:3  [banned-term] mentions "${RECORD.toLowerCase()} 0042"`,
        `docs/forms.md:4  [banned-term] mentions "${RECORD.charAt(0)}${RECORD.slice(1).toLowerCase()} 9"`,
        `docs/forms.md:5  [banned-term] mentions "${RECORD}0042"`,
        `docs/forms.md:6  [banned-term] mentions "${RECORD_SPELLED}"`,
        `docs/forms.md:7  [banned-term] mentions "${RECORD_NUMBERED.slice(0, -1)}"`,
      ],
      // One finding per label and line: the line broken in docs/modes.md is not reported twice.
      summary: [14, 7],
      absent: ['across a line break'],
    },
    {
      name: 'build-record wording, in Markdown, code and configuration',
      files: {
        'docs/records.md': [
          MD_HEADER,
          '',
          `${VERIFIED} ${DATE}.`,
          `The cache rule, ${AMENDED_ON} ${DATE}.`,
          `The budgets ${AS_AMENDED}.`,
          `Kept ${AS_DECIDED}.`,
          `Faster since the review of ${DATE}.`,
          `The colour rule, accepted ${DATE}.`,
          `About 300 ms (measured ${DATE}).`,
          `Since the audit of ${DATE_WRITTEN}.`,
          `Decided ${DATE_US}.`,
          '',
        ].join('\n'),
        'scripts/port.ts': `${TS_HEADER}\n// ${VERIFIED.toUpperCase()} the server.\nexport {};\n`,
        'infra/notes.yaml': `${HASH_HEADER}\n# kept ${AS_DECIDED}\nkey: value\n`,
      },
      lines: [
        `docs/records.md:3  [banned-term] mentions "${VERIFIED}" (a build-record phrase); a file says what is, not how it came to be (AGENTS.md, Documentation)`,
        `docs/records.md:4  [banned-term] mentions "${AMENDED_ON}" (a build-record phrase)`,
        `docs/records.md:5  [banned-term] mentions "${AS_AMENDED}"`,
        `docs/records.md:6  [banned-term] mentions "${AS_DECIDED}"`,
        `docs/records.md:7  [banned-term] mentions "review of ${DATE}"`,
        `docs/records.md:8  [banned-term] mentions "accepted ${DATE}"`,
        `docs/records.md:9  [banned-term] mentions "measured ${DATE}"`,
        `docs/records.md:10  [banned-term] mentions "audit of ${DATE_WRITTEN}"`,
        `docs/records.md:11  [banned-term] mentions "Decided ${DATE_US}"`,
        `scripts/port.ts:2  [banned-term] mentions "${VERIFIED.toUpperCase()}"`,
        `infra/notes.yaml:2  [banned-term] mentions "${AS_DECIDED}"`,
      ],
      // Line 3 and line 4 each match two patterns of the label: one finding per label and line.
      summary: [11, 3],
    },
    {
      // The phrases are refused for this run only; the forms a digest stands for (case, a hyphen, an
      // underscore or nothing between joined words, a plural; a word before a date in each date form) and
      // the places it is looked for (a line, a line break, a path, a binary file's metadata), and the near
      // misses that pass.
      name: 'phrases and a directory refused by digest',
      refuse: [JOINED_PHRASE, SPACED_PHRASE, DIRECTORY, DATED_WORD],
      files: {
        'docs/story.md': [
          MD_HEADER,
          '',
          'The blue-lantern step.',
          'A BlueLantern, two Blue_Lanterns.',
          'A copper kettle.',
          'Copper  kettles, three.',
          'The blue lantern glows; a copper-kettle; the blue cat lantern.',
          'Moved from vault/ to src/.',
          'See ./vault/a and (../vault/b).',
          'The vault holds src/vault/c and vault.',
          'Ignore **/vault/** and C:\\\\repo\\\\vault\\\\x; a vault-door and vault.ts are fine.',
          `The voyage of ${DATE} ended.`,
          `Voyage (${DATE_US}).`,
          `The voyage list of ${DATE}; a voyage since ${DATE_WRITTEN}.`,
          '',
        ].join('\n'),
        'src/wrap.ts': `${TS_HEADER}\n// The copper\n// kettle steps.\nexport {};\n`,
        'scripts/blue_lantern.sh': `#!/bin/sh\n${HASH_HEADER}\nexit 0\n`,
        'vault/keep.ts': `${TS_HEADER}\nexport {};\n`,
        'src/vault/fine.ts': `${TS_HEADER}\nexport {};\n`,
        'media/clip.webp': bytes(
          'RIFF',
          [0x40, 0, 0, 0],
          'WEBPXMP ',
          [0x20, 0, 0, 0],
          utf16('A copper kettle'),
        ),
      },
      lines: [
        'docs/story.md:3  [banned-term] mentions "blue-lantern" (a build-record phrase)',
        'docs/story.md:4  [banned-term] mentions "BlueLantern"',
        'docs/story.md:5  [banned-term] mentions "copper kettle"',
        'docs/story.md:6  [banned-term] mentions "Copper  kettles"',
        'docs/story.md:8  [banned-term] mentions "vault/"',
        'docs/story.md:9  [banned-term] mentions "vault/"',
        'docs/story.md:10  [banned-term] mentions "vault/"',
        'docs/story.md:11  [banned-term] mentions "vault/"',
        'src/wrap.ts:2  [banned-term] mentions "copper kettle" across a line break',
        'scripts/blue_lantern.sh  [banned-term] path mentions "blue_lantern"',
        'vault/keep.ts  [banned-term] path mentions "vault/"',
        'src/vault/fine.ts  [banned-term] path mentions "vault/"',
        'media/clip.webp  [banned-term] mentions "copper kettle" in its binary contents (a build-record phrase)',
        `docs/story.md:12  [banned-term] mentions "voyage of ${DATE}"`,
        `docs/story.md:13  [banned-term] mentions "Voyage (${DATE_US}"`,
      ],
      summary: [15, 6],
      absent: ['docs/story.md:7', 'docs/story.md:14'],
    },
    {
      // A banned term broken across a line break, in a block comment, line comments, a hash comment and
      // Markdown: the next line's comment marker is dropped, and the finding sits on the line where the term
      // starts.
      name: 'a banned term broken across a line break',
      files: {
        'backend/src/colours.ts': `${TS_HEADER}\n/**\n * Colours (${RULE_NUMBER.replace(' ', '\n * ')}).\n */\nexport {};\n`,
        'backend/src/pure.ts': `${TS_HEADER}\n// Pure functions (${RULE_OF.replace(' of', '\n// of')}).\nexport {};\n`,
        'infra/notes.sh': `#!/bin/sh\n${HASH_HEADER}\n# The budgets, ${AS_AMENDED.replace(' ', '\n# ')}.\nexit 0\n`,
        'docs/cache.md': `${MD_HEADER}\n\nThe cache, faster since the review of\n${DATE}, holds every page.\n`,
        'docs/name.md': `${MD_HEADER}\n\nWrite ${COMPANY}\n${SUFFIX} nowhere.\n`,
      },
      lines: [
        `backend/src/colours.ts:3  [banned-term] mentions "${RULE_NUMBER}" across a line break (a numbered rule of AGENTS.md)`,
        `backend/src/pure.ts:2  [banned-term] mentions "${RULE_OF}" across a line break`,
        `infra/notes.sh:3  [banned-term] mentions "${AS_AMENDED}" across a line break (a build-record phrase)`,
        `docs/cache.md:3  [banned-term] mentions "review of ${DATE}" across a line break`,
        `docs/name.md:3  [banned-term] mentions "${COMPANY} ${SUFFIX}" across a line break`,
      ],
      summary: [5, 5],
    },
    {
      // Task and phase ids in any text file, decision ids in Markdown only: in code such a token is often a
      // name. No folder is exempt, and any number counts.
      name: 'ids of work items, anywhere',
      files: {
        'src/layout.ts': `${TS_HEADER}\n// Packing rules from ${TASK_ID}.\nexport const ${DECISION_ID} = 1;\n`,
        'docs/guide-two.md': `${MD_HEADER}\n\nAt the ${PHASE.toLowerCase()} check, decision ${DECISION_ID} said so.\n`,
        'docs/step-two.md': `${MD_HEADER}\n\nThe ${PHASE} follow-ups.\n`,
        'docs/notes/week.md': `${MD_HEADER}\n\nDecided as ${DECISION_ID} in ${TASK_ID}.\n`,
      },
      lines: [
        `src/layout.ts:2  [plan-id] "${TASK_ID}" reads as a task id of a work plan; say what the thing is or does (AGENTS.md, Documentation)`,
        `docs/guide-two.md:3  [plan-id] "${PHASE.toLowerCase()}" reads as a phase`,
        `docs/guide-two.md:3  [plan-id] "${DECISION_ID}" reads as a decision id`,
        `docs/step-two.md:3  [plan-id] "${PHASE}" reads as a phase`,
        `docs/notes/week.md:3  [plan-id] "${TASK_ID}" reads as a task id`,
        `docs/notes/week.md:3  [plan-id] "${DECISION_ID}" reads as a decision id`,
      ],
      summary: [6, 4],
      absent: ['src/layout.ts:3'],
    },
    {
      // Contents outside the deny list and the licence texts, and paths anywhere; a CHANGELOG is no
      // exception.
      name: 'the denied licence family outside the deny list',
      files: {
        'src/footer.ts': `${TS_HEADER}\nexport const SOURCE = 'Source (${LICENCE_SHORT}-3.0)';\n`,
        'docs/licence.md': `${MD_HEADER}\n\nLicensed under the ${LICENCE_LONG.toUpperCase()} General Public License.\n`,
        [`scripts/licenses/${LICENCE_SHORT}-3.0-only.txt`]: 'licence text\n',
        'CHANGELOG.md': [
          '# Changelog',
          '',
          '## 1.0.0',
          '',
          `Not under ${LICENCE_SHORT.toLowerCase()}-3.0.`,
          '',
        ].join('\n'),
      },
      lines: [
        `src/footer.ts:2  [licence-name] mentions "${LICENCE_SHORT}"; gcportrait is Apache-2.0 (AGENTS.md, Licence and dependencies)`,
        `docs/licence.md:3  [licence-name] mentions "${LICENCE_LONG}"`,
        `scripts/licenses/${LICENCE_SHORT}-3.0-only.txt  [licence-name] path mentions "${LICENCE_SHORT}"`,
        `CHANGELOG.md:5  [licence-name] mentions "${LICENCE_SHORT}"`,
      ],
      summary: [4, 4],
    },
    {
      // A stray NUL byte, a wide encoding with and without a byte-order mark, invalid UTF-8 or a UTF-8
      // byte-order mark hides nothing from the other rules, and is itself reported.
      name: 'a text file that is not UTF-8 without NUL bytes, read all the same',
      files: {
        'docs/nul.md': `${MD_HEADER}\n\nA line with ${NAME_A}.\u0000\n`,
        'src/nul.ts': `export const x = '${NAME_B}';\u0000\n`,
        'docs/wide.md': bytes([0xff, 0xfe], utf16(`${MD_HEADER}\n\nA line with ${NAME_C}.\n`)),
        'docs/wide-be.md': bytes([0xfe, 0xff], utf16(`${MD_HEADER}\n\nA line with ${NAME_A}.\n`, 'be')),
        'docs/wide-plain.md': utf16(`${MD_HEADER}\n\nSee ${RECORD} 12.\n`),
        'docs/latin.md': bytes(`${MD_HEADER}\n\nCaf`, [0xe9], ' au lait.\n'),
        'docs/marked.md': bytes([0xef, 0xbb, 0xbf], `${MD_HEADER}\n\n# Marked\n`),
      },
      lines: [
        "docs/nul.md  [encoding] holds NUL bytes; every text file is UTF-8 without a byte-order mark or NUL bytes (.editorconfig), and a binary format's extension belongs in BINARY_EXTENSIONS",
        `docs/nul.md:3  [forbidden-name] mentions "${NAME_A}"`,
        'src/nul.ts  [encoding] holds NUL bytes',
        `src/nul.ts:1  [forbidden-name] mentions "${NAME_B}"`,
        'src/nul.ts  [spdx-header] missing SPDX header',
        'docs/wide.md  [encoding] is UTF-16 text',
        `docs/wide.md:3  [forbidden-name] mentions "${NAME_C}"`,
        'docs/wide-be.md  [encoding] is UTF-16 text',
        `docs/wide-be.md:3  [forbidden-name] mentions "${NAME_A}"`,
        'docs/wide-plain.md  [encoding] is UTF-16 text',
        `docs/wide-plain.md:3  [banned-term] mentions "${RECORD} 12"`,
        'docs/latin.md  [encoding] is not valid UTF-8',
        'docs/marked.md  [encoding] starts with a byte-order mark',
      ],
      // The SPDX headers of the wide and marked files are found once decoded.
      summary: [13, 7],
      absent: ['docs/wide.md  [spdx-header]', 'docs/marked.md  [spdx-header]'],
    },
    {
      // Plain text under a binary extension is read as text; a real binary file through its printable runs
      // (a PNG text chunk, UTF-16 metadata in a GIF, an XMP chunk in a WebP) and a PNG's compressed text
      // chunks, inflated.
      name: 'binary files: plain text under a binary extension, and the metadata of real ones',
      files: {
        'assets/note.png': `A note with ${NAME_A}.\n`,
        'assets/real.png': bytes(
          PNG_SIGNATURE,
          [0, 0, 0, 0x1c],
          'tEXtComment',
          [0],
          `Made with ${NAME_B} tools`,
          [0x12, 0x34, 0x56, 0x78],
        ),
        'assets/meta.gif': bytes(
          'GIF89a',
          [1, 0, 1, 0, 0x80, 0, 0],
          utf16(`Rights: ${COMPANY} ${SUFFIX}`),
          [0x3b],
        ),
        'assets/licence.webp': bytes(
          'RIFF',
          [0x40, 0, 0, 0],
          'WEBPXMP ',
          [0x20, 0, 0, 0],
          `Licence: ${LICENCE_LONG}`,
        ),
        'assets/compressed.png': bytes(
          PNG_SIGNATURE,
          pngChunk('zTXt', bytes('Comment', [0, 0], deflateSync(`Made with ${NAME_C}`))),
          pngChunk(
            'iTXt',
            bytes('Note', [0, 1, 0], 'en', [0], 'Note', [0], deflateSync(`The audit of ${DATE}`)),
          ),
          pngChunk('IEND', new Uint8Array()),
        ),
      },
      lines: [
        'assets/note.png  [encoding] holds plain text under a binary extension; give it the extension of its format',
        `assets/note.png:1  [forbidden-name] mentions "${NAME_A}"`,
        `assets/real.png  [forbidden-name] mentions "${NAME_B}" in its binary contents`,
        `assets/meta.gif  [banned-term] mentions "${COMPANY} ${SUFFIX}" in its binary contents`,
        `assets/licence.webp  [licence-name] mentions "${LICENCE_LONG}" in its binary contents`,
        `assets/compressed.png  [forbidden-name] mentions "${NAME_C}" in its binary contents`,
        `assets/compressed.png  [banned-term] mentions "audit of ${DATE}" in its binary contents`,
      ],
      summary: [7, 5],
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
      // Shaped like Gizmo query files: the call sits mid-line, after an assignment or an `if`; ordinary code
      // that merely mentions emit or a V() method on another object is fine. A banned file is reported once:
      // it has to go, so the header rule does not report it as well.
      name: 'Go, Graphviz and Gizmo query files',
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
        'cmd/main.go  [banned-file] .go files are not allowed: no Go code, no Graphviz templates (AGENTS.md, Licence and dependencies)',
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
      // Header-free formats and names next to them: JSON family, plain text, SVG, files that cannot carry a
      // comment, and the licence and attribution texts.
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
      lines: ['config/settings.toml', 'website/src/pages/intro.mdx', 'infra/Dockerfile.dev'].map(
        (file) => `${file}  [spdx-header] no SPDX header form is defined for this file type`,
      ),
      summary: [3, 3],
    },
  ];

  // A loop rather than it.each: its `$name` would cut the names at 40 characters.
  for (const { name, files, lines, summary, absent = [], refuse = [] } of FAILING) {
    it(`fails on ${name}`, async () => {
      for (const [relPath, content] of Object.entries(files)) tree.write(relPath, content);
      const digests = refuse.length === 0 ? [] : await digestsOf(...refuse);
      const result = await check(...digests.flatMap((digest) => ['--also-refuse', digest]));
      expect(result.status).toBe(1);
      for (const line of lines) expect(result.stderr).toContain(line);
      for (const text of absent) expect(result.stderr).not.toContain(text);
      if (summary !== undefined)
        expect(result.stderr).toContain(
          `FAILED with ${String(summary[0])} problem(s) in ${String(summary[1])} file(s)`,
        );
    });
  }

  it('does not mistake ordinary uses of the words for a Google copyright notice', async () => {
    tree.write('src/ok.ts', `${TS_HEADER}\n// ${COMPANY} Cloud renders here.\n// ${NOTICE}: see LICENSE.\n`);
    const result = await check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('allows the words the banned terms resemble, where they mean something else', async () => {
    tree.write(
      'src/words.ts',
      [
        TS_HEADER,
        `// Wait ${NAME_C.slice(0, 3)} settings; ${NAME_C.slice(0, 3)} setInterval; ${NAME_C.slice(0, 3)}.setItem.`,
        '// Each decision of the gate; a request of the user; the rule of thumb.',
        '// A review of the code; accepted until 2030-10-31; checked twice.',
        '// Added since 2030-09-23 and since 4 Sept 2030; measured in milliseconds; a review of 3 files.',
        `export const integrity = 'sha512-ab/${RECORD}+cd==';`,
        `export const uri = 'data:image/png;base64,xy/${RECORD.toLowerCase()}/z${RECORD}b';`,
        `export const ${RECORD}IATIC = 'quadr/';`,
        `// PADRES, ${RECORD}x, x${RECORD}, ${RECORD.toLowerCase()}enaline and ${RECORD.toLowerCase()}ift are words, not citations.`,
        '// Words that only look like a banned term when two lines are read as one: see AGENTS.md',
        '// rules apply; kept as',
        '// amendments allow; the review of',
        '// the 2030-10-08 ticks; rule 12 of',
        '// the guide.',
        '',
      ].join('\n'),
    );
    tree.write(
      'packages/catalog/data/cai-supported-asset-types.2030-01-15.txt',
      'compute.googleapis.com/Instance\n',
    );
    tree.write('docs/timeline.md', `${MD_HEADER}\n\nWhat changed since 2030-09-23.\n`);
    tree.write(
      'pnpm-lock.yaml',
      `lockfileVersion: '9.0'\npackages:\n  character-entities@2.0.2:\n    resolution: {integrity: sha512-${RECORD}+${RECORD.toLowerCase()}/Q==}\n`,
    );
    const result = await check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('allows look-alikes of the work-item ids', async () => {
    // Versions, colours, CSS, and words that only start like an id.
    tree.write(
      'docs/notes.md',
      `${MD_HEADER}\n\nVersion 3.6.0, colours #D1D5DB and #D93025, a DE1 adapter, P35, phased 2, ${DECISION_ID}x, D1234.\n`,
    );
    tree.write('src/sizes.ts', `${TS_HEADER}\nexport const P = { P30: 1, p3: 2 };\n`);
    const result = await check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('looks for short terms in text only, not in the bytes of a binary file', async () => {
    // Abbreviations, licence ids and work-item ids are short enough to occur by chance in compressed data.
    tree.write(
      'assets/noise.png',
      bytes(
        PNG_SIGNATURE,
        [0],
        `${RECORD} 12`,
        [0],
        `${LICENCE_SHORT}-3.0`,
        [0],
        `${TASK_ID} ${PHASE} ${DECISION_ID}`,
        [0],
        `${RECORD.toLowerCase()}/x`,
        [0, 0x89],
      ),
    );
    const result = await check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('allows the denied licence family in the deny list and the licence texts', async () => {
    tree.write('THIRD_PARTY.md', `${MD_HEADER}\n\nDenied: GPL, LGPL, ${LICENCE_SHORT} (network copyleft).\n`);
    tree.write('scripts/check-licenses.mjs', `${TS_HEADER}\nexport const family = '${LICENCE_SHORT}-*';\n`);
    tree.write(
      'scripts/check-licenses.test.ts',
      `${TS_HEADER}\nexport const id = '${LICENCE_SHORT}-3.0-only';\n`,
    );
    tree.write('scripts/licenses/MPL-2.0.txt', `the ${LICENCE_LONG} General Public License, Version 3.0\n`);
    // Hashes and words that merely contain the letters.
    tree.write(
      'src/hash.ts',
      `${TS_HEADER}\nexport const integrity = 'sha512-x${LICENCE_SHORT.toLowerCase()}Q==';\nexport const lgpl = 'LGPL-2.1';\n`,
    );
    const result = await check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('finds no refused string in the checker and in this test, which spell none of them out', async () => {
    for (const file of ['scripts/check-provenance.mjs', 'scripts/check-provenance.test.ts'])
      tree.write(file, readFileSync(path.join(REPO, file), 'utf8'));
    const result = await check();
    // Their headers name Apache-2.0, not the fixture's identifier; nothing else may be reported.
    const reported = result.stderr
      .split('\n')
      .filter((line) => line.startsWith('  scripts/check-provenance'));
    expect(reported).toEqual([
      expect.stringContaining('scripts/check-provenance.mjs:1  [spdx-header]'),
      expect.stringContaining('scripts/check-provenance.test.ts:1  [spdx-header]'),
    ]);
  });

  it('requires the identifier named in the root package.json', async () => {
    tree.write('package.json', manifest('Apache-2.0'));
    const result = await check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`[spdx-header] SPDX header names "${FIXTURE_LICENSE}"`);
    // Files matched by name are held to the same identifier as files matched by extension.
    expect(result.stderr).toContain(`.gitignore:1  [spdx-header] SPDX header names "${FIXTURE_LICENSE}"`);
    expect(result.stderr).toContain(
      `infra/Dockerfile:2  [spdx-header] SPDX header names "${FIXTURE_LICENSE}"`,
    );
  });

  it('skips a .git file at the root, as a linked work tree or a submodule has one', async () => {
    // A linked work tree's `.git` is a file naming the git directory, not a directory: VCS data either way,
    // never a source file that needs a header.
    const gitData = createTempTree('git-data');
    try {
      const initialized = spawnSync('git', ['init', '--quiet', '--separate-git-dir', gitData.root], {
        cwd: tree.root,
        encoding: 'utf8',
      });
      expect(initialized.status, initialized.stderr).toBe(0);
      const result = await check();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('provenance: OK. 14 files scanned');
    } finally {
      gitData.remove();
    }
  });

  it('reports symbolic links instead of following them', async () => {
    // The link targets live under node_modules/, which the walker skips; only the links themselves are
    // visible.
    tree.write('node_modules/vendor/main.go', 'package main\n');
    tree.write('node_modules/vendor/util.ts', 'export const copied = true;\n');
    tree.write('packages/model/.gitkeep', '');
    symlinkSync(
      path.join(tree.root, 'node_modules/vendor'),
      path.join(tree.root, 'packages/model/vendor'),
      'dir',
    );
    symlinkSync(
      path.join(tree.root, 'node_modules/vendor/util.ts'),
      path.join(tree.root, 'src/util.ts'),
      'file',
    );
    const result = await check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'packages/model/vendor  [symlink] symbolic link to "' +
        path.join(tree.root, 'node_modules/vendor') +
        '"; links are not allowed in the tree (they can reach outside the repository)',
    );
    expect(result.stderr).toContain('src/util.ts  [symlink]');
    expect(result.stderr).toContain('FAILED with 2 problem(s) in 2 file(s)');
  });

  it.each(['present', 'missing'] as const)(
    'refuses a root manifest link to a %s outside file',
    async (target) => {
      const outside = createTempTree('outside-root-manifest');
      const privateLicense = 'LicenseRef-outside-private';
      try {
        if (target === 'present') outside.write('package.json', manifest(privateLicense));
        rmSync(path.join(tree.root, 'package.json'));
        symlinkSync(path.join(outside.root, 'package.json'), path.join(tree.root, 'package.json'));
        const rejected = check();
        await expect(rejected).rejects.toThrow('package.json must be a regular file');
        await expect(rejected).rejects.not.toThrow(privateLicense);
        expect(console.log).not.toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalled();
        if (target === 'present') expect(outside.read('package.json')).toBe(manifest(privateLicense));
      } finally {
        outside.remove();
      }
    },
  );

  it('uses the fallback identifier when the root manifest is missing', async () => {
    rmSync(path.join(tree.root, 'package.json'));
    const result = await check();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`(${FIXTURE_LICENSE}) verified`);
  });

  it('requires the hash header on .env.example, which is walked although other .env files are not', async () => {
    tree.write('backend/.env', 'SECRET=never-read\n');
    tree.write('backend/.env.local', 'SECRET=never-read\n');
    tree.write('backend/.env.example', 'OAUTH_CLIENT_ID=\n');
    const failing = await check();
    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain(
      `backend/.env.example  [spdx-header] missing SPDX header; add the line "${HASH_HEADER}"`,
    );
    expect(failing.stderr).toContain('FAILED with 1 problem(s) in 1 file(s)');
    tree.write('backend/.env.example', `${HASH_HEADER}\nOAUTH_CLIENT_ID=\n`);
    expect((await check()).status).toBe(0);
  });

  it('reports a tracked directory replaced by a link without reading the outside files', async () => {
    const outside = createTempTree('outside-provenance');
    try {
      outside.write('file.ts', `${TS_HEADER}\nexport const name = '${NAME_A}';\n`);
      tree.write('tracked/file.ts', `${TS_HEADER}\nexport {};\n`);
      expect(spawnSync('git', ['init', '--quiet'], { cwd: tree.root }).status).toBe(0);
      expect(spawnSync('git', ['add', 'tracked/file.ts'], { cwd: tree.root }).status).toBe(0);
      rmSync(path.join(tree.root, 'tracked'), { recursive: true });
      symlinkSync(outside.root, path.join(tree.root, 'tracked'));
      const result = await check();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('tracked  [symlink]');
      expect(result.stderr).not.toContain(NAME_A);
      expect(result.stderr).not.toContain('tracked/file.ts');
      expect(result.stderr).toContain('FAILED with 1 problem(s) in 1 file(s)');
    } finally {
      outside.remove();
    }
  });

  it('skips build output only where .gitignore ignores it, and walks a deeper dist or build directory', async () => {
    tree.write('dist/demo/index.js', `console.log('${EVERY_REFUSED_STRING}');\n`);
    tree.write('packages/model/build/out.js', `console.log('${EVERY_REFUSED_STRING}');\n`);
    expect((await check()).status).toBe(0);
    // A directory of that name inside a source tree is committed, so it is checked.
    tree.write('frontend/src/build/leak.ts', 'export {};\n');
    tree.write('packages/model/src/dist/leak.ts', 'export {};\n');
    const result = await check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('frontend/src/build/leak.ts  [spdx-header] missing SPDX header');
    expect(result.stderr).toContain('packages/model/src/dist/leak.ts  [spdx-header] missing SPDX header');
    expect(result.stderr).toContain('FAILED with 2 problem(s) in 2 file(s)');
  });

  it('skips Playwright output only under e2e/, and git-ignored scratch files anywhere', async () => {
    tree.write('e2e/test-results/run/trace.ts', 'export {};\n');
    tree.write('e2e/playwright-report/index.html', '<p>report</p>\n');
    tree.write('debug.log', 'log line\n');
    tree.write('frontend/.DS_Store', 'not really binary\n');
    expect((await check()).status).toBe(0);
    // The same directory names elsewhere are walked like any other directory.
    tree.write('frontend/test-results/leak.ts', 'export {};\n');
    tree.write('packages/model/playwright-report/leak.ts', 'export {};\n');
    const result = await check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('frontend/test-results/leak.ts  [spdx-header] missing SPDX header');
    expect(result.stderr).toContain(
      'packages/model/playwright-report/leak.ts  [spdx-header] missing SPDX header',
    );
  });

  it('skips the assistants’ local instruction files and folders, as .gitignore ignores them', async () => {
    // What `pnpm agents:setup` writes, a link among it, and what a person keeps for their own tool.
    tree.write('CLAUDE.md', `@AGENTS.md\n\nA line with ${NAME_A}.\n`);
    tree.write('GEMINI.md', '@./AGENTS.md\n');
    // The pointers beside a folder's AGENTS.md, at any depth.
    tree.write('frontend/CLAUDE.md', `@AGENTS.md\n\nA line with ${NAME_A}.\n`);
    tree.write('frontend/GEMINI.md', '@./AGENTS.md\n');
    tree.write('.github/instructions/frontend.instructions.md', '---\napplyTo: "frontend/**"\n---\n');
    tree.write('packages/model/AGENTS.override.md', 'no header\n');
    tree.write('.cursor/rules/agents.mdc', '---\nalwaysApply: true\n---\n');
    tree.write('.github/copilot-instructions.md', 'no header\n');
    tree.write('.github/instructions/ts.instructions.md', 'no header\n');
    tree.write('.gemini/settings.json', '{}\n');
    tree.write('.agents/skills/one/SKILL.md', `---\nname: one\n---\n${MD_HEADER}\n`);
    tree.write('.claude/skills/.keep', '');
    symlinkSync('../../.agents/skills/one', path.join(tree.root, '.claude/skills/one'));
    expect((await check()).status).toBe(0);
    // A file of the same name elsewhere than .github/ is walked like any other.
    tree.write('docs/copilot-instructions.md', 'no header\n');
    expect((await check()).stderr).toContain(
      'docs/copilot-instructions.md  [spdx-header] missing SPDX header',
    );
  });

  it('checks every file git tracks, also under a path the walk skips', async () => {
    tree.write('coverage/kept.ts', `${TS_HEADER}\nexport const name = '${NAME_A}';\n`);
    tree.write('src/.claude/notes.md', `${MD_HEADER}\n\nA line with ${NAME_B}.\n`);
    expect((await check()).status).toBe(0);
    const git = (...args: string[]) => spawnSync('git', args, { cwd: tree.root, encoding: 'utf8' });
    expect(git('init', '--quiet').status).toBe(0);
    expect(git('add', '--force', 'coverage/kept.ts', 'src/.claude/notes.md').status).toBe(0);
    const result = await check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`coverage/kept.ts:2  [forbidden-name] mentions "${NAME_A}"`);
    expect(result.stderr).toContain(`src/.claude/notes.md:3  [forbidden-name] mentions "${NAME_B}"`);
    expect(result.stderr).toContain('FAILED with 2 problem(s) in 2 file(s)');
  });

  it('prints the digest entry of a phrase with --digest-of, the same for every form it stands for', async () => {
    const forms = ['Blue_Lantern', 'BlueLanterns', 'blue-lanterns', 'bluelantern'];
    const [joined, ...entries] = await digestsOf(
      JOINED_PHRASE,
      ...forms,
      'blue lantern',
      SPACED_PHRASE,
      'Copper   Kettles',
      DIRECTORY,
      './Vault/',
      DATED_WORD,
      'Voyage <date>',
    );
    expect(joined).toMatch(/^words:11:[0-9a-f]{8}:[0-9a-f]{64}$/);
    for (const entry of entries.slice(0, forms.length)) expect(entry).toBe(joined);
    const [spaced, kettle, kettles, directory, vault, dated, voyage] = entries.slice(forms.length);
    expect(spaced).toMatch(/^words:12:/);
    expect(kettle).toBe(kettles);
    expect(directory).toMatch(/^path:6:[0-9a-f]{8}:[0-9a-f]{64}$/);
    expect(vault).toBe(directory);
    expect(dated).toMatch(/^dated:6:[0-9a-f]{8}:[0-9a-f]{64}$/);
    expect(voyage).toBe(dated);
    // One phrase it cannot take refuses the whole run, and prints no entry.
    const refused = await runInProcess(() =>
      run(['--digest-of', JOINED_PHRASE, '--digest-of', 'one two three four']),
    );
    expect(refused.status).toBe(2);
    expect(refused.stdout).toBe('');
    expect((await check('--also-refuse', 'words:3:0:abc')).status).toBe(2);
  });

  it('prints the rules with --list-exempt, without the forbidden names, the secret patterns or the digests', async () => {
    const result = await runInProcess(() => run(['--list-exempt']));
    expect(result.status).toBe(0);
    for (const heading of [
      '(a) forbidden-name',
      '(b) banned-file',
      '(c) spdx-header',
      '(d) symlink',
      '(e) banned-term',
      '(f) plan-id',
      '(g) licence-name',
      '(h) encoding',
    ])
      expect(result.stdout).toContain(heading);
    expect(result.stdout).toContain(
      '3 names (assembled at run time, not printed) and a Google copyright notice',
    );
    expect(result.stdout).toContain('a citation of a decision record (3 patterns, not printed)');
    expect(result.stdout).toMatch(/a build-record phrase \(3 patterns and \d+ phrase digests, not printed\)/);
    expect(result.stdout).toContain('a numbered rule of AGENTS.md: /');
    expect(result.stdout).toContain('in Markdown (.md .mdx .markdown), with no exemption');
    expect(result.stdout).toContain(`"${LICENCE_SHORT}", "${LICENCE_LONG}"`);
    expect(result.stdout).toContain('THIRD_PARTY.md (the dependency deny list names it)');
    expect(result.stdout).toContain('.editorconfig');
    expect(result.stdout).toContain('Dockerfile');
    expect(result.stdout).toContain('.env.example');
    expect(result.stdout).toContain('header-free');
    expect(result.stdout).not.toMatch(/[0-9a-f]{64}/);
    for (const secret of [NAME_A, NAME_B, NAME_C, RECORD, VERIFIED, 'amended', 'decided'])
      expect(result.stdout.toLowerCase()).not.toContain(secret.toLowerCase());
  });

  it('exempts only the checker from the name rule, and only generated or consumed files from the header rule', async () => {
    const result = await runInProcess(() => run(['--list-exempt']));
    expect(result.status).toBe(0);
    const notApplied = /^ {4}not applied in: (.+)$/m.exec(result.stdout)?.[1];
    expect(notApplied).toBe('scripts/check-provenance.mjs (this checker)');
    const headerExempt = /^ {4}header-exempt:\n((?: {6}.+\n)+)/m.exec(result.stdout)?.[1] ?? '';
    expect(
      headerExempt
        .split('\n')
        .filter(Boolean)
        .map((line) => line.trim()),
    ).toEqual(['pnpm-lock.yaml (lockfile, generated)', 'CHANGELOG.md (release notes, not source)']);
  });

  it('rejects unknown options', async () => {
    const result = await runInProcess(() => run(['--bogus']));
    expect(result.status).toBe(2);
  });

  it('keeps custom phrases and malformed partial additions local to one invocation', async () => {
    const command = (...args: string[]) => runInProcess(() => run(['--root', tree.root, ...args]));
    const baseline = await command('--list-exempt');
    const generated = await command('--digest-of', JOINED_PHRASE);
    const digest = generated.stdout.trim();
    expect(generated.status).toBe(0);
    tree.write('src/custom.ts', `${TS_HEADER}\nconst label = '${JOINED_PHRASE}';\n`);
    expect((await command('--also-refuse', digest)).status).toBe(1);
    expect((await command()).status).toBe(0);
    const count = (text: string): number => Number(/(\d+) phrase digests/.exec(text)?.[1]);
    const custom = await command('--also-refuse', digest, '--list-exempt');
    expect(count(custom.stdout)).toBe(count(baseline.stdout) + 1);
    expect(await command('--list-exempt')).toEqual(baseline);
    expect((await command('--also-refuse', digest, '--also-refuse', 'malformed')).status).toBe(2);
    expect((await command()).status).toBe(0);
    expect(await command('--list-exempt')).toEqual(baseline);
    expect((await command('--also-refuse', digest, '--digest-of', JOINED_PHRASE)).stdout).toBe(
      generated.stdout,
    );
    expect((await command()).status).toBe(0);
    expect(await command('--list-exempt')).toEqual(baseline);
  });

  it('does not reuse word offsets from a longer scan in a short or empty one', async () => {
    const [digest] = await digestsOf(JOINED_PHRASE);
    if (digest === undefined) throw new Error('expected a phrase digest');
    tree.write('notes.txt', `ordinary words `.repeat(400) + JOINED_PHRASE);
    expect((await check('--also-refuse', digest)).status).toBe(1);
    for (const text of ['', 'ordinary']) {
      tree.write('notes.txt', text);
      expect((await check('--also-refuse', digest)).status).toBe(0);
    }
  });

  it('imports without scanning, printing or changing the exit code', async () => {
    const exitCode = process.exitCode;
    const scan = vi.fn(() => {
      throw new Error('import must not scan');
    });
    vi.doMock('./lib/repo-files.mjs', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./lib/repo-files.mjs')>()),
      listRepoFiles: scan,
      readProjectLicenseId: scan,
    }));
    vi.resetModules();
    try {
      const imported = await runInProcess(async () => {
        const module = await import('./check-provenance.mjs');
        expect(module.run).toBeTypeOf('function');
        return 0;
      });
      expect(imported).toEqual({ status: 0, stdout: '', stderr: '' });
      expect(scan).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(exitCode);
    } finally {
      vi.doUnmock('./lib/repo-files.mjs');
      vi.resetModules();
      process.exitCode = exitCode;
    }
  });

  it('matches the real command output and nonzero exit code', SPAWN_TIMEOUT, async () => {
    tree.write('src/refused.ts', `${TS_HEADER}\nconst label = '${NAME_A}';\n`);
    const expected = await check();
    expect(expected.status).toBe(1);
    expect(runScript('check-provenance.mjs', ['--root', tree.root])).toEqual(expected);
  });
});
