// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Generate the guides' lens blocks and check documentation against the tree (checkUserDocs and its helpers).
 * Writing rules: AGENTS.md, "Documentation"; guide registration: docs/AGENTS.md, "User guides".
 *
 * docs/lenses-and-filters.md's `lens-table` and `lens-types` blocks use the compiled catalog
 * (packages/catalog/dist/catalog.json), between `<!-- user-docs:NAME:start -->` and `<!-- user-docs:NAME:end -->`.
 * Run `pnpm catalog:build` after changing lens files; install, lint, typecheck and test already do so.
 *
 *   node scripts/user-docs.mjs            check and list problems
 *   node scripts/user-docs.mjs --write    rewrite the generated parts, then check
 *
 * scripts/user-docs.test.ts runs the repository check in `pnpm test`.
 * Exit 0 on success, 1 on reported problems, 2 on a thrown error (including usage or file-read errors).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { dependencyVersions, exactPinProblem } from './lib/dependency-versions.mjs';
import { isHeaderExempt, listRepoFiles } from './lib/repo-files.mjs';
import { rulesFiles } from './lib/rules-files.mjs';
import { workspaceDirs } from './release-notes.mjs';

/** The user guides: the commands in their code must exist, and they keep no verification log. */
export const GUIDES = Object.freeze([
  'docs/modes.md',
  'docs/permissions.md',
  'docs/self-host.md',
  'docs/self-host-options.md',
  'docs/configuration.md',
  'docs/lenses-and-filters.md',
  'docs/timeline.md',
  'docs/export.md',
  'docs/faq.md',
  'docs/api.md',
]);

/** Other documents whose commands are checked too. */
const COMMAND_DOCS = Object.freeze([
  'docs/README.md',
  'docs/getting-started.md',
  'docs/cloudshell-tutorial.md',
]);

/**
 * Other documents, checked for verification logs only (their commands are not all the scripts'), besides the
 * rules files and the skills that logFreeDocs adds: the README, the skills' README, the contributor references
 * and the package READMEs. Every document says what is, never how it came to be (AGENTS.md, Documentation).
 * Not listed: the generated THIRD_PARTY.md and CHANGELOGs, the changesets, docs/contributing.md (its
 * troubleshooting table names Node versions), and the catalog's and the icons' READMEs (dates of Google's own
 * retirements and of the icon download are data there).
 */
export const LISTED_LOG_FREE_DOCS = Object.freeze([
  'README.md',
  '.agents/README.md',
  'infra/README.md',
  'docs/website.md',
  'docs/backlog.md',
  'docs/catalog-followups.md',
  'docs/packages.md',
  'docs/security.md',
  'docs/threat-model.md',
  'backend/README.md',
  'frontend/README.md',
  'e2e/README.md',
  'e2e/baselines/render/README.md',
  'website/README.md',
  'brand/README.md',
  'packages/model/README.md',
  'packages/ingest/README.md',
  'packages/graph/README.md',
  'packages/layout/README.md',
  'packages/render/README.md',
  'packages/render-cli/README.md',
  'packages/demo-data/README.md',
]);

/** The skills, one folder each with its SKILL.md. */
const SKILLS_DIR = '.agents/skills';

/**
 * Every document checked for verification logs only: every rules file of the checkout (the root's AGENTS.md
 * and each folder's, scripts/lib/rules-files.mjs), every skill's SKILL.md, and LISTED_LOG_FREE_DOCS. Found on
 * disk, so a new folder file or skill is checked without a change here.
 * @param {string} root
 * @returns {string[]}
 */
export function logFreeDocs(root) {
  const skillsDir = path.join(root, SKILLS_DIR);
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(path.join(skillsDir, entry.name, 'SKILL.md')))
        .map((entry) => `${SKILLS_DIR}/${entry.name}/SKILL.md`)
        .sort()
    : [];
  return [...rulesFiles(root), ...skills, ...LISTED_LOG_FREE_DOCS];
}

/**
 * What reads as a log for the maintainer rather than an instruction, matched per line outside code: a line or
 * section that says on which date something was verified, or a heading about how a page was verified; a dated
 * note of when something happened (on, until or as of a date, a request or decision of a date); a machine
 * with its versions (an operating system or Node with a version, an Apple chip); a measured or timed run; the
 * record of a first version.
 */
export const VERIFICATION_LOG = Object.freeze([
  /\bverified\s+on\b/i,
  /^#{1,6}\s.*\bverified\b/i,
  /\b(?:on|until|as of)\s+20\d\d-\d\d-\d\d\b/i,
  /\b(?:request|decision|pass|polish)\s+of\s+20\d\d-\d\d-\d\d\b/i,
  /\b(?:macOS|Ubuntu|Debian|Windows)\s+\d+(?:\.\d+)*\b/,
  /\bNode(?:\.js)?\s+\d+\.\d+\.\d+\b/,
  /\bApple M\d\b/,
  /\bmeasured (?:on|that way on)\b/i,
  /\btook (?:about )?\d+(?:[.,]\d+)?\s?(?:ms|s|min|minutes|seconds)\b/i,
  /\(before: \d/i,
  /\bthe first version\b/i,
]);

/** A shell prompt in code: a recorded run (a command with its output), where a user document shows the command alone. */
const PROMPT = /^\s*\$ \S/;

/**
 * The only variables the self-hosting guide's code may name (docs/self-host.md): its quick start needs the project
 * id, then the OAuth client id, and the email address that gets read access; whatever else a command there takes
 * is written as its default or an example, and the guide says how to put another value in its place.
 */
export const QUICK_START_DOC = 'docs/self-host.md';
export const QUICK_START_VARIABLES = Object.freeze(['YOUR_PROJECT', 'YOUR_OAUTH_CLIENT_ID', 'YOUR_EMAIL']);

/** The registry of command variables (`@gcportrait/model`): a TypeScript module that imports nothing at run time. */
export const VARIABLES_MODULE = 'packages/model/src/schemas/command-variables.ts';

/** The directories whose Markdown documents' code may name variables. */
const VARIABLE_DIRS = Object.freeze(['docs', 'docs/legal']);

/** Where the lens blocks go, and where the compiled catalog is. */
export const LENS_DOC = 'docs/lenses-and-filters.md';
/** The guide that names the large-snapshot threshold, and the module of the model that declares it. */
export const LARGE_SNAPSHOT_DOC = 'docs/modes.md';
export const VOCABULARY_MODULE = 'packages/model/src/schemas/vocabulary.ts';
export const CATALOG_JSON = 'packages/catalog/dist/catalog.json';
/**
 * The one document that names the rasteriser's version: the render golden PNG is the bytes of that version,
 * which the render library pins exactly (packages/AGENTS.md, The render library). Every other document names
 * resvg without a number, so a bump changes this one line, which the check holds to the version installed.
 */
export const RASTERISER_DOC = 'e2e/baselines/render/README.md';
/** The rasteriser's package, and the workspace package that pins it. */
export const RASTERISER = Object.freeze({ name: '@resvg/resvg-wasm', workspace: 'packages/render' });

/** pnpm's own commands that may appear in a guide (`pnpm install`, `pnpm --filter X exec ...`). */
const PNPM_COMMANDS = new Set([
  'install',
  'i',
  'add',
  'exec',
  'dlx',
  'licenses',
  'why',
  'list',
  'ls',
  'audit',
]);

/** Lines are wrapped at this width, as the hand-written Markdown is (AGENTS.md, Documentation). */
export const WIDTH = 110;

/** A URL in a line: a scheme with `//` (`https://`, `gs://`) or `mailto:`. */
const URL_IN_LINE = /\b[a-z][a-z\d+.-]*:\/\/|\bmailto:/i;

/** An HTML tag or comment: a line break inside one would land in an attribute's value or a marker. */
const HTML_TAG = /<!--.*?-->|<\/?[a-z][^<>]*>/gi;

/** What opens a line before its first word: the indentation, blockquote markers and a list marker. */
const LINE_OPENING = /^\s*(?:>\s*)*(?:(?:[-*+]|\d{1,9}[.)])\s+)?/;

/**
 * @typedef {{
 *   title: string,
 *   description: string,
 *   types: string[],
 *   relationKinds: string[],
 *   showHidden: boolean,
 *   defaultDetail: string,
 * }} Lens
 */

/**
 * Words wrapped into lines of at most `width` characters; the first line starts with `first`, the others with
 * `rest`. A word longer than a line stays whole.
 * @param {readonly string[]} words
 * @param {string} first
 * @param {string} rest
 * @param {number} [width]
 * @returns {string[]}
 */
export function wrapWords(words, first, rest, width = WIDTH) {
  /** @type {string[]} */
  const lines = [];
  let line = first;
  let empty = true;
  for (const word of words) {
    const candidate = empty ? line + word : `${line} ${word}`;
    if (!empty && candidate.length > width) {
      lines.push(line);
      line = rest + word;
    } else {
      line = candidate;
    }
    empty = false;
  }
  lines.push(line);
  return lines;
}

/**
 * The lens files' `types` grouped by service, in the order they are listed: `[service, names]`, where a `*` glob
 * of the service is the name `*`, and the lens-wide `*` is the service `*`.
 * @param {readonly string[]} types
 * @returns {Array<[string, string[]]>}
 */
export function typesByService(types) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const type of types) {
    const slash = type.indexOf('/');
    const service = slash === -1 ? type : type.slice(0, slash);
    const name = slash === -1 ? '*' : type.slice(slash + 1);
    const names = groups.get(service) ?? [];
    if (!names.includes(name)) names.push(name);
    groups.set(service, names);
  }
  return [...groups.entries()];
}

/**
 * The relation kinds a lens draws as arrows, in the lens file's order: `contains` is nesting, never an arrow.
 * @param {Lens} lens
 * @returns {string}
 */
function arrowKinds(lens) {
  const kinds = lens.relationKinds.filter((kind) => kind !== 'contains');
  return kinds.length === 0 ? 'none' : kinds.map((kind) => `\`${kind}\``).join(', ');
}

/**
 * The lens table: one row per lens, in the catalog's order.
 * @param {Readonly<Record<string, Lens>>} lenses
 * @returns {string[]}
 */
export function lensTableLines(lenses) {
  const lines = [
    '| Lens | What it is for | Arrows it draws | `auto` opens at most at | Hidden types |',
    '|---|---|---|---|---|',
  ];
  for (const [id, lens] of Object.entries(lenses)) {
    const ceiling = lens.defaultDetail === 'auto' ? 'no limit' : `\`${lens.defaultDetail}\``;
    const hidden = lens.showHidden ? 'shown' : 'held back (`N hidden`)';
    const intent = lens.description.replace(/\s+/g, ' ').trim();
    lines.push(
      `| **${lens.title}** (\`${id}\`) | ${intent} | ${arrowKinds(lens)} | ${ceiling} | ${hidden} |`,
    );
  }
  return lines;
}

/**
 * The type bundles: per lens a heading line and one bullet per service, wrapped.
 * @param {Readonly<Record<string, Lens>>} lenses
 * @returns {string[]}
 */
export function lensTypesLines(lenses) {
  /** @type {string[]} */
  const lines = [];
  for (const [id, lens] of Object.entries(lenses)) {
    if (lines.length > 0) lines.push('');
    const count = lens.types.length;
    lines.push(`**${lens.title}** (\`${id}\`): ${String(count)} ${count === 1 ? 'entry' : 'entries'}`);
    lines.push('');
    for (const [service, names] of typesByService(lens.types)) {
      if (service === '*') {
        lines.push(
          `- every asset type (\`*\`)${lens.showHidden ? ', hidden types included' : ''}, known to the catalog or not`,
        );
        continue;
      }
      const words = names.map((name, index) => {
        const shown = name === '*' ? 'every type (`*`)' : name;
        return index < names.length - 1 ? `${shown},` : shown;
      });
      lines.push(...wrapWords(words, `- \`${service}\`: `, '  '));
    }
  }
  return lines;
}

/**
 * `text` with the block between `<!-- user-docs:NAME:start ... -->` and `<!-- user-docs:NAME:end -->` replaced
 * by `lines` (the marker lines stay). Null when the markers are missing or out of order.
 * @param {string} text
 * @param {string} name
 * @param {readonly string[]} lines
 * @returns {string | null}
 */
export function replaceBlock(text, name, lines) {
  const startMarker = new RegExp(`^<!-- user-docs:${name}:start\\b.*-->$`, 'm');
  const endMarker = new RegExp(`^<!-- user-docs:${name}:end -->$`, 'm');
  const start = startMarker.exec(text);
  const end = endMarker.exec(text);
  if (start === null || end === null || end.index < start.index) return null;
  const head = text.slice(0, start.index + start[0].length);
  const tail = text.slice(end.index);
  return `${head}\n${lines.join('\n')}\n${tail}`;
}

/**
 * The lenses of the compiled catalog, checked for the fields the blocks use.
 * @param {string} root
 * @returns {Record<string, Lens>}
 */
export function readLenses(root) {
  const file = path.join(root, CATALOG_JSON);
  if (!existsSync(file)) {
    throw new Error(`${CATALOG_JSON} does not exist: run \`pnpm catalog:build\` first.`);
  }
  /** @type {unknown} */
  const catalog = JSON.parse(readFileSync(file, 'utf8'));
  const lenses =
    typeof catalog === 'object' && catalog !== null && 'lenses' in catalog ? catalog.lenses : null;
  if (typeof lenses !== 'object' || lenses === null) throw new Error(`${CATALOG_JSON} has no lenses.`);
  /** @type {Record<string, Lens>} */
  const result = {};
  for (const [id, value] of Object.entries(lenses)) {
    result[id] = asLens(id, value);
  }
  return result;
}

/**
 * @param {string} id
 * @param {unknown} value
 * @returns {Lens}
 */
function asLens(id, value) {
  const record =
    typeof value === 'object' && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
  const { title, description, types, relationKinds, showHidden, defaultDetail } = record;
  const strings = (/** @type {unknown} */ list) =>
    Array.isArray(list) && list.every((item) => typeof item === 'string')
      ? /** @type {string[]} */ (list)
      : null;
  const typeList = strings(types);
  const kindList = strings(relationKinds);
  if (
    typeof title !== 'string' ||
    typeof description !== 'string' ||
    typeList === null ||
    kindList === null ||
    typeof showHidden !== 'boolean' ||
    typeof defaultDetail !== 'string'
  ) {
    throw new Error(`${CATALOG_JSON}: the lens ${id} lacks a field the guide shows.`);
  }
  return { title, description, types: typeList, relationKinds: kindList, showHidden, defaultDetail };
}

/**
 * The lens document with its generated blocks brought up to date, or the problems that stop it.
 * @param {string} text
 * @param {Readonly<Record<string, Lens>>} lenses
 * @returns {{ text: string, problems: string[] }}
 */
export function generateLensDoc(text, lenses) {
  /** @type {string[]} */
  const problems = [];
  let result = text;
  for (const [name, lines] of /** @type {const} */ ([
    ['lens-table', lensTableLines(lenses)],
    ['lens-types', lensTypesLines(lenses)],
  ])) {
    const next = replaceBlock(result, name, lines);
    if (next === null) problems.push(`${LENS_DOC}: the markers of the generated block "${name}" are missing`);
    else result = next;
  }
  return { text: result, problems };
}

/**
 * The cells of the Markdown table rows in the section headed `## heading` (up to the next `## `).
 * @param {string} text
 * @param {string} heading
 * @returns {string[][] | null}
 */
export function sectionTableRows(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return null;
  /** @type {string[][]} */
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (!line.startsWith('|') || /^\|[-| :]+\|$/.test(line.trim())) continue;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim());
    rows.push(cells);
  }
  return rows;
}

/**
 * @param {string} text
 * @param {Record<string, { count: number, byType: Record<string, number> }>} sizes
 * @returns {string[]}
 */
export function demoSizeProblems(text, sizes) {
  const rows = sectionTableRows(text, '4. The demo')?.slice(1) ?? [];
  const problems = [];
  for (const [size, stats] of Object.entries(sizes)) {
    const matches = rows.filter((cells) => cells[0] === size);
    const cells = matches[0];
    if (
      matches.length !== 1 ||
      Number(cells?.[1]?.replaceAll(' ', '')) !== stats.count ||
      Number(cells?.[2]?.replaceAll(' ', '')) !== Object.keys(stats.byType).length
    )
      problems.push(
        `docs/modes.md: ${size} must occur once with the asset and type counts in demo-data/fixtures/stats.json`,
      );
  }
  for (const cells of rows) {
    if (cells[0] === undefined || !Object.hasOwn(sizes, cells[0]))
      problems.push(`docs/modes.md: unknown demo size ${cells[0] ?? ''}`);
  }
  return problems;
}

/**
 * The code spans of a cell: `` `--image TAG\|IMAGE` `` → `--image TAG\|IMAGE`.
 * @param {string} cell
 * @returns {string[]}
 */
function codeSpans(cell) {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
}

/**
 * The environment variables of the backend's zod schema (`const EnvSchema = z.object({ NAME: ... })`), and the
 * literal defaults `parseConfig` gives them (`vars.NAME ?? 8080`, `vars.NAME ?? 'info'`, `DEFAULT_SOURCE_URL`).
 * @param {string} source backend/src/config.ts
 * @returns {{ names: string[], defaults: Map<string, string> }}
 */
export function backendEnvironment(source) {
  const body = /const EnvSchema = z\.object\(\{\n([\s\S]*?)\n\}\);/.exec(source)?.[1] ?? '';
  const names = [...body.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1] ?? '');
  /** @type {Map<string, string>} */
  const defaults = new Map();
  for (const match of source.matchAll(/vars\.([A-Z][A-Z0-9_]*) \?\? (\d+|'[^']*')/g)) {
    defaults.set(match[1] ?? '', (match[2] ?? '').replace(/^'|'$/g, ''));
  }
  const sourceUrl = /DEFAULT_SOURCE_URL = '([^']+)'/.exec(source)?.[1];
  if (sourceUrl !== undefined && /vars\.SOURCE_URL \?\? DEFAULT_SOURCE_URL/.test(source)) {
    defaults.set('SOURCE_URL', sourceUrl);
  }
  return { names, defaults };
}

/**
 * The flags a script's `--help` lists, with the default each states (`(default: X)` up to `,`, `;` or `)`).
 * @param {string} help
 * @returns {Map<string, string | null>}
 */
export function helpFlags(help) {
  /** @type {Map<string, string | null>} */
  const flags = new Map();
  /** @type {string | null} */
  let current = null;
  for (const line of help.split('\n')) {
    const flag = /^ {2}(?:(-[a-z]), )?(--[a-z][a-z-]*)\b/.exec(line);
    if (flag !== null) {
      current = flag[2] ?? null;
      if (current !== null) flags.set(current, null);
      if (flag[1] !== undefined) flags.set(flag[1], null);
    } else if (line.trim() === '' || !line.startsWith(' ')) {
      current = null;
    }
    const stated = /\(default: ([^,;)]+)/.exec(line)?.[1];
    if (current !== null && stated !== undefined && flags.get(current) === null)
      flags.set(current, stated.trim());
  }
  return flags;
}

/**
 * A script's `--help`, run with bash.
 * @param {string} root
 * @param {string} script
 * @returns {string}
 */
function scriptHelp(root, script) {
  const result = spawnSync('bash', [path.join(root, script), '--help'], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.status !== 0) throw new Error(`${script} --help failed: ${result.stderr}`);
  return result.stdout;
}

/**
 * Problems of docs/configuration.md against the tree.
 * @param {string} root
 * @param {{ deployHelp: string, uninstallHelp: string, installHelp: string }} help
 * @returns {string[]}
 */
export function configurationProblems(root, help) {
  const doc = 'docs/configuration.md';
  const text = readFileSync(path.join(root, doc), 'utf8');
  /** @type {string[]} */
  const problems = [];
  /**
   * @param {string} heading
   * @returns {string[][]}
   */
  const rows = (heading) => {
    const found = sectionTableRows(text, heading);
    if (found === null) problems.push(`${doc}: no section "## ${heading}"`);
    return found ?? [];
  };
  /**
   * @param {string} what
   * @param {Iterable<string>} expected
   * @param {Iterable<string>} documented
   * @param {boolean} exact
   */
  const compare = (what, expected, documented, exact) => {
    const want = new Set(expected);
    const have = new Set(documented);
    for (const name of want) if (!have.has(name)) problems.push(`${doc}: ${what} lacks ${name}`);
    if (exact)
      for (const name of have)
        if (!want.has(name)) problems.push(`${doc}: ${what} lists ${name}, which does not exist`);
  };

  // The backend's environment, from its zod schema.
  const env = backendEnvironment(readFileSync(path.join(root, 'backend/src/config.ts'), 'utf8'));
  if (env.names.length === 0) problems.push('backend/src/config.ts: no EnvSchema found');
  const envRows = rows('Backend environment');
  compare(
    '"Backend environment"',
    env.names,
    envRows.flatMap((cells) => codeSpans(cells[0] ?? '').slice(0, 1)),
    true,
  );
  for (const [name, value] of env.defaults) {
    const row = envRows.find((cells) => codeSpans(cells[0] ?? '')[0] === name);
    if (row !== undefined && !codeSpans(row[1] ?? '').includes(value)) {
      problems.push(`${doc}: "Backend environment" gives ${name} another default than \`${value}\``);
    }
  }

  // The scripts' flags and defaults, from their --help.
  for (const [heading, helpText] of /** @type {const} */ ([
    ['infra/deploy.sh', help.deployHelp],
    ['infra/uninstall.sh', help.uninstallHelp],
    ['infra/install.sh', help.installHelp],
  ])) {
    const flags = helpFlags(helpText);
    const flagRows = rows(heading);
    const documented = flagRows.flatMap((cells) =>
      codeSpans(cells[0] ?? '').flatMap((span) => span.match(/^-{1,2}[a-z][a-z-]*/) ?? []),
    );
    compare(`"${heading}"`, flags.keys(), documented, true);
    for (const [flag, value] of flags) {
      if (value === null) continue;
      const row = flagRows.find((cells) =>
        codeSpans(cells[0] ?? '').some((span) => span.split(' ')[0] === flag),
      );
      if (row !== undefined && !(row[1] ?? '').includes(value)) {
        problems.push(`${doc}: "${heading}" gives ${flag} another default than "${value}" (its --help)`);
      }
    }
  }

  // Every variable compose.yaml reads.
  const compose = readFileSync(path.join(root, 'infra/compose.yaml'), 'utf8');
  const composeVariables = [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1] ?? '');
  compare(
    '"Local runs with compose"',
    composeVariables,
    rows('Local runs with compose').flatMap((cells) => codeSpans(cells[0] ?? '')),
    false,
  );

  // The SPA's build-time variables.
  const viteEnv = readFileSync(path.join(root, 'frontend/src/vite-env.d.ts'), 'utf8');
  const viteVariables = [...viteEnv.matchAll(/readonly (VITE_[A-Z0-9_]+)\??:/g)].map(
    (match) => match[1] ?? '',
  );
  compare(
    '"SPA build"',
    viteVariables,
    rows('SPA build').flatMap((cells) =>
      codeSpans(cells[0] ?? '').filter((span) => span.startsWith('VITE_')),
    ),
    true,
  );
  return problems;
}

/** @param {string[]} lines */
function* fencedLines(lines) {
  /** @type {{ marker: string, language: string } | null} */
  let fence = null;
  for (const [index, line] of lines.entries()) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const marker = match?.[1];
    const info = match?.[2] ?? '';
    if (fence !== null) {
      const boundary = marker !== undefined && marker.startsWith(fence.marker) && /^[ \t]*$/.test(info);
      yield { line, index, language: fence.language, boundary };
      if (boundary) fence = null;
    } else if (marker !== undefined && (marker[0] !== '`' || !info.includes('`'))) {
      fence = { marker, language: info.trim().split(/\s+/)[0] ?? '' };
      yield { line, index, language: fence.language, boundary: true };
    } else {
      yield { line, index, language: null, boundary: false };
    }
  }
}

/**
 * The commands in a Markdown document's code: the lines of `sh`/`bash`/plain fenced blocks (continuations
 * joined, `$ ` prompts and comments removed), the `$ ` lines of `text` blocks (with their continuations), and inline
 * code spans; each split at
 * `&&`, `||`, `;` and `|`, with leading `NAME=value` assignments dropped.
 * @param {string} markdown
 * @returns {string[]}
 */
export function commandsIn(markdown) {
  /** @type {string[]} */
  const commands = [];
  /** @param {string} line */
  const add = (line) => {
    for (const part of line.split(/&&|\|\||;|\|/)) {
      const command = part
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/^(?:[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, '');
      if (command !== '') commands.push(command);
    }
  };
  let pending = '';
  for (const { line: raw, language, boundary } of fencedLines(markdown.split(/\r?\n/))) {
    if (boundary) {
      pending = '';
      continue;
    }
    if (language !== null) {
      let line = raw.trimEnd();
      if (language === 'text') {
        // A prompt line, or the continuation of one that ended in a backslash.
        if (pending === '' && !line.startsWith('$ ')) continue;
      } else if (!['', 'sh', 'bash', 'shell', 'console'].includes(language)) {
        continue;
      }
      line = line.replace(/^\s*\$ /, '').replace(/(^|\s)#.*$/, '');
      if (line.endsWith('\\')) {
        pending += `${line.slice(0, -1)} `;
        continue;
      }
      add(pending + line);
      pending = '';
      continue;
    }
    for (const match of raw.matchAll(/`([^`]+)`/g)) {
      const span = match[1] ?? '';
      if (/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)*(?:pnpm|infra\/[a-z-]+\.sh|node scripts\/)/.test(span)) add(span);
    }
  }
  return commands;
}

/**
 * Problems with one command: a pnpm script or package that does not exist, a flag the infra script does not take,
 * a missing `node scripts/` file. `bash -s -- FLAGS`, the shell end of the installer line
 * (`curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project …`), and `bash install.sh FLAGS`, the
 * installer downloaded first, are checked as `infra/install.sh FLAGS`.
 * Commands with placeholders (`<pkg>`) are skipped.
 * @param {string} command
 * @param {{ rootScripts: ReadonlySet<string>, packages: ReadonlyMap<string, ReadonlySet<string>>,
 *   flags: ReadonlyMap<string, ReadonlySet<string>>, exists: (file: string) => boolean }} tree
 * @returns {string | null}
 */
export function commandProblem(command, tree) {
  if (command.includes('<')) return null;
  const words = command.split(/\s+/);
  const first = words[0] ?? '';
  if (first === 'pnpm') {
    let at = 1;
    while (words[at] === '-s' || words[at] === '--silent') at += 1;
    if (words[at] === '--filter') {
      const name = words[at + 1] ?? '';
      at += 2;
      if (words[at] === 'run') at += 1;
      const script = words[at] ?? '';
      const scripts = tree.packages.get(name);
      if (scripts === undefined) return `\`${command}\`: no workspace package ${name}`;
      if (!scripts.has(script) && !PNPM_COMMANDS.has(script))
        return `\`${command}\`: ${name} has no script ${script}`;
      return null;
    }
    if (words[at] === 'run') at += 1;
    const script = words[at] ?? '';
    if (script === '' || script.startsWith('-')) return null;
    if (!tree.rootScripts.has(script) && !PNPM_COMMANDS.has(script))
      return `\`${command}\`: no root script ${script}`;
    return null;
  }
  const piped = first === 'bash' && words[1] === '-s' && words[2] === '--';
  const downloaded = first === 'bash' && /(?:^|\/)install\.sh$/.test(words[1] ?? '');
  const script = piped || downloaded ? 'infra/install.sh' : first;
  const flags = tree.flags.get(script);
  if (flags !== undefined) {
    for (const word of words.slice(piped ? 3 : downloaded ? 2 : 1)) {
      const flag = /^(-{1,2}[a-z][a-z-]*)/.exec(word)?.[1];
      if (flag !== undefined && !flags.has(flag)) return `\`${command}\`: ${script} has no flag ${flag}`;
    }
    return null;
  }
  if (first === 'node' && (words[1] ?? '').startsWith('scripts/')) {
    return tree.exists(words[1] ?? '') ? null : `\`${command}\`: ${words[1] ?? ''} does not exist`;
  }
  return null;
}

/**
 * The code of a Markdown document: the lines of its fenced blocks (any language, indented ones too) and its
 * inline code spans (a span may continue on the next line of its paragraph), in order.
 * @param {string} markdown
 * @returns {string[]}
 */
export function codeIn(markdown) {
  /** @type {string[]} */
  const code = [];
  /** @type {string[]} */
  let paragraph = [];
  const flush = () => {
    const text = paragraph.join('\n');
    paragraph = [];
    // CommonMark: a line ending inside a span is a space, and a span loses one space at each end when it has one
    // at both (`` `x` `` is `x`).
    for (const match of text.matchAll(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g)) {
      code.push((match[2] ?? '').replace(/\n/g, ' ').replace(/^ ([\s\S]*\S[\s\S]*) $/, '$1'));
    }
  };
  for (const { line, language, boundary } of fencedLines(markdown.split(/\r?\n/))) {
    if (boundary) {
      flush();
    } else if (language !== null) {
      code.push(line);
    } else if (line.trim() === '') {
      flush();
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return code;
}

/**
 * @typedef {{ names: ReadonlySet<string>, tokens: (text: string) => string[] }} VariableRegistry
 */

/**
 * The registry's variable names and its token finder, loaded from the TypeScript module itself (Node strips its
 * types), so the check and the website read one list.
 * @param {string} root
 * @returns {VariableRegistry}
 */
export function readVariableRegistry(root) {
  const require = createRequire(import.meta.url);
  /** @type {unknown} */
  const loaded = require(path.resolve(root, VARIABLES_MODULE));
  const record =
    typeof loaded === 'object' && loaded !== null ? /** @type {Record<string, unknown>} */ (loaded) : {};
  const { COMMAND_VARIABLES: variables, variableTokens: tokens } = record;
  if (!Array.isArray(variables) || typeof tokens !== 'function') {
    throw new Error(`${VARIABLES_MODULE} exports no COMMAND_VARIABLES or variableTokens.`);
  }
  /** @type {Set<string>} */
  const names = new Set();
  for (const variable of /** @type {unknown[]} */ (variables)) {
    const name =
      typeof variable === 'object' && variable !== null && 'name' in variable ? variable.name : undefined;
    if (typeof name !== 'string') throw new Error(`${VARIABLES_MODULE}: a variable without a name.`);
    names.add(name);
  }
  const finder = /** @type {(text: string) => unknown} */ (tokens);
  return {
    names,
    tokens: (text) => {
      const found = finder(text);
      return Array.isArray(found) ? found.filter((token) => typeof token === 'string') : [];
    },
  };
}

/**
 * The tokens in a document's code that the registry does not list, each once, in order.
 * @param {string} markdown
 * @param {VariableRegistry} registry
 * @returns {string[]}
 */
export function unregisteredTokens(markdown, registry) {
  /** @type {string[]} */
  const unknown = [];
  for (const code of codeIn(markdown)) {
    for (const token of registry.tokens(code)) {
      if (!registry.names.has(token) && !unknown.includes(token)) unknown.push(token);
    }
  }
  return unknown;
}

/**
 * The Markdown documents whose code may name variables: every `.md` file of VARIABLE_DIRS, relative to `root`.
 * @param {string} root
 * @returns {string[]}
 */
function variableDocs(root) {
  return VARIABLE_DIRS.flatMap((dir) =>
    readdirSync(path.join(root, dir), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => `${dir}/${entry.name}`)
      .sort(),
  );
}

/**
 * The lines of a document that read as a verification log (VERIFICATION_LOG), each as a problem, outside code, which
 * may print anything; and in code, a shell prompt (a recorded run).
 * @param {string} markdown
 * @returns {string[]}
 */
export function verificationLogLines(markdown) {
  /** @type {string[]} */
  const problems = [];
  for (const { line, index, language, boundary } of fencedLines(markdown.split(/\r?\n/))) {
    if (boundary) continue;
    const quoted = line.trim().slice(0, 60);
    if (language !== null) {
      if (PROMPT.test(line))
        problems.push(
          `line ${String(index + 1)} records a run ("${quoted}"): show the command without a prompt and its output; a guide keeps no record of runs`,
        );
      continue;
    }
    if (VERIFICATION_LOG.some((pattern) => pattern.test(line)))
      problems.push(
        `line ${String(index + 1)} logs a verification ("${quoted}"): a guide says what to do, not when or where it was checked`,
      );
  }
  return problems;
}

/**
 * The variables a document's code names (registered ones, in the order they first appear) that QUICK_START_VARIABLES
 * does not list, and those it lists that the code lacks. Inline code that is nothing but one token names the variable
 * in a sentence and is no field on the website, so it does not count.
 * @param {string} markdown
 * @param {{ names: ReadonlySet<string>, tokens: (text: string) => string[] }} registry
 * @returns {{ extra: string[], missing: string[] }}
 */
export function quickStartVariables(markdown, registry) {
  const named = [
    ...new Set(
      codeIn(markdown)
        .filter((code) => !/^YOUR_[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(code.trim()))
        .flatMap((code) => registry.tokens(code))
        .filter((token) => registry.names.has(token)),
    ),
  ];
  return {
    extra: named.filter((name) => !QUICK_START_VARIABLES.includes(name)),
    missing: QUICK_START_VARIABLES.filter((name) => !named.includes(name)),
  };
}

/**
 * The large-snapshot threshold as the model declares it (`export const LARGE_SNAPSHOT_ASSETS = 10_000;`), or null
 * when the module declares no plain number.
 * @param {string} source
 * @returns {number | null}
 */
export function largeSnapshotAssets(source) {
  const match = /^export const LARGE_SNAPSHOT_ASSETS = ([\d_]+);$/m.exec(source);
  return match?.[1] === undefined ? null : Number(match[1].replaceAll('_', ''));
}

/**
 * What is wrong with a guide's statement of the large-snapshot threshold: it must say "more than N assets" with
 * the model's N, written as the app writes it ("10,000"), and name no other "more than … assets".
 * @param {string} guide
 * @param {string} source the model's vocabulary module
 * @returns {string[]}
 */
export function largeSnapshotProblems(guide, source) {
  const assets = largeSnapshotAssets(source);
  if (assets === null) return [`${VOCABULARY_MODULE} no longer declares LARGE_SNAPSHOT_ASSETS as a number`];
  const expected = assets.toLocaleString('en');
  const stated = [...guide.replaceAll(/\s+/g, ' ').matchAll(/more than ([\d,]+) assets/g)].map(
    (match) => match[1] ?? '',
  );
  if (stated.length === 0) return [`${LARGE_SNAPSHOT_DOC}: it does not say "more than ${expected} assets"`];
  return stated
    .filter((count) => count !== expected)
    .map((count) => `${LARGE_SNAPSHOT_DOC}: it says "more than ${count} assets", the model ${expected}`);
}

/**
 * A version of resvg named in prose: one of its packages, in code or not, or resvg itself, followed by a
 * version number (`@resvg/resvg-wasm` 2.6.2, resvg v0.45.1); the name in group 2, the number in group 3. A
 * package's name with `@` and its version (`@resvg/resvg-wasm@2.6.2`) is a command's argument, not prose.
 */
const RESVG_VERSION =
  /(?<![\w@/.-])(`?)(@resvg\/resvg-(?:wasm|js)|resvg(?:-wasm|-js)?)\1\s+v?(\d+(?:\.\d+){1,2})\b/gi;

/**
 * The versions of resvg a document names (RESVG_VERSION), in order, a line break read as a space.
 * @param {string} markdown
 * @returns {Array<{ name: string, version: string }>}
 */
export function resvgVersionsIn(markdown) {
  return [...markdown.replaceAll(/\s+/g, ' ').matchAll(RESVG_VERSION)].map((match) => ({
    name: match[2] ?? '',
    version: match[3] ?? '',
  }));
}

// The rasteriser's pin, as packages/render declares it and as it is installed for it
// (scripts/lib/dependency-versions.mjs), exported for the tests next to the check that reads it.
export { dependencyVersions };

/**
 * What is wrong with the versions of resvg the documents name: the rasteriser is pinned exactly at the
 * version installed, RASTERISER_DOC names it with that version and names no other version of resvg, and no
 * other document names a version of resvg at all.
 * @param {{ declared: string | null, installed: string | null }} pin the rasteriser's (dependencyVersions)
 * @param {ReadonlyMap<string, string>} docs the Markdown documents' texts by their paths
 * @returns {string[]}
 */
export function rasteriserVersionProblems(pin, docs) {
  const { name, workspace } = RASTERISER;
  const pinProblem = exactPinProblem(pin, workspace, name);
  /** @type {string[]} */
  const problems = pinProblem === null ? [] : [pinProblem];
  const { installed } = pin;
  if (installed === null) return problems;
  const stated = resvgVersionsIn(docs.get(RASTERISER_DOC) ?? '');
  if (stated.length === 0)
    problems.push(`${RASTERISER_DOC}: it does not name ${name} ${installed}, the version installed`);
  for (const named of stated) {
    if (named.name !== name)
      problems.push(
        `${RASTERISER_DOC}: it names ${named.name} ${named.version}; it names the version of ${name} alone`,
      );
    else if (named.version !== installed)
      problems.push(
        `${RASTERISER_DOC}: it names ${name} ${named.version}, the version installed is ${installed}`,
      );
  }
  for (const [doc, text] of docs) {
    if (doc === RASTERISER_DOC) continue;
    for (const named of resvgVersionsIn(text))
      problems.push(
        `${doc}: it names ${named.name} ${named.version}; only ${RASTERISER_DOC} names resvg's version (name the package alone, pinned in ${workspace}/package.json)`,
      );
  }
  return problems;
}

/**
 * Whether a line is one word: once its opening (LINE_OPENING) is set aside, it has no space a line break could
 * take, an HTML tag or comment counting as one word.
 * @param {string} line
 * @returns {boolean}
 */
function isOneWord(line) {
  return !/\s/.test(line.replace(LINE_OPENING, '').replace(HTML_TAG, '<>').trimEnd());
}

/**
 * The lines of a Markdown document wider than WIDTH columns, counted in code points, as 1-based line numbers with
 * their widths; but not the YAML frontmatter (data, which the assistants read), fenced code with its fences, a
 * table row, a line that holds a URL, or a line of one word, which no line break can shorten.
 * @param {string} markdown
 * @returns {Array<{ line: number, columns: number }>}
 */
export function overlongLines(markdown) {
  const lines = markdown.split(/\r?\n/);
  const frontmatterEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  /** @type {Array<{ line: number, columns: number }>} */
  const found = [];
  const offset = frontmatterEnd + 1;
  for (const { line, index, language, boundary } of fencedLines(lines.slice(offset))) {
    if (boundary || language !== null) continue;
    const columns = Array.from(line).length;
    if (columns <= WIDTH || /^\s*\|/.test(line) || URL_IN_LINE.test(line) || isOneWord(line)) continue;
    found.push({ line: index + offset + 1, columns });
  }
  return found;
}

/**
 * The Markdown files the width rule holds, relative to `root`: every `.md` file of the tree as
 * scripts/lib/repo-files.mjs walks it (what git tracks, and every other file outside the ignored directories),
 * but those the provenance check exempts from the header as generated or consumed (the CHANGELOGs that
 * `changeset version` writes, the changeset entries).
 * @param {string} root
 * @returns {string[]}
 */
export function wrappedMarkdownFiles(root) {
  return listRepoFiles(root)
    .filter(
      (file) =>
        !file.isSymlink && file.relPath.toLowerCase().endsWith('.md') && !isHeaderExempt(file.relPath),
    )
    .map((file) => file.relPath);
}

/**
 * Every line of the tree's Markdown files that is wider than WIDTH outside the exemptions (overlongLines), as
 * `path:line: N columns, the limit is 110`.
 * @param {string} root
 * @returns {string[]}
 */
export function markdownWidthProblems(root) {
  return wrappedMarkdownFiles(root).flatMap((relPath) =>
    overlongLines(readFileSync(path.join(root, relPath), 'utf8')).map(
      ({ line, columns }) =>
        `${relPath}:${String(line)}: ${String(columns)} columns, the limit is ${String(WIDTH)}`,
    ),
  );
}

/**
 * Every problem of the user guides against the tree, and every Markdown line too wide; empty when they are
 * current.
 * @param {string} root
 * @returns {string[]}
 */
export function checkUserDocs(root) {
  /** @type {string[]} */
  const problems = [];
  /** @type {unknown} */
  const stats = JSON.parse(readFileSync(path.join(root, 'packages/demo-data/fixtures/stats.json'), 'utf8'));
  const demoStats =
    /** @type {{ sizes: Record<string, { count: number, byType: Record<string, number> }> }} */ (stats);
  problems.push(...demoSizeProblems(readFileSync(path.join(root, 'docs/modes.md'), 'utf8'), demoStats.sizes));
  const lensDoc = readFileSync(path.join(root, LENS_DOC), 'utf8');
  const generated = generateLensDoc(lensDoc, readLenses(root));
  problems.push(...generated.problems);
  if (generated.problems.length === 0 && generated.text !== lensDoc) {
    problems.push(
      `${LENS_DOC}: the generated lens blocks are stale; run \`node scripts/user-docs.mjs --write\``,
    );
  }

  for (const doc of [...GUIDES, ...COMMAND_DOCS, ...logFreeDocs(root)]) {
    for (const problem of verificationLogLines(readFileSync(path.join(root, doc), 'utf8')))
      problems.push(`${doc}: ${problem}`);
  }

  const help = {
    deployHelp: scriptHelp(root, 'infra/deploy.sh'),
    uninstallHelp: scriptHelp(root, 'infra/uninstall.sh'),
    installHelp: scriptHelp(root, 'infra/install.sh'),
  };
  problems.push(...configurationProblems(root, help));

  /** @type {Map<string, ReadonlySet<string>>} */
  const packages = new Map();
  for (const dir of workspaceDirs(root)) {
    const manifest = path.join(root, dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const { name, scripts } = packageScripts(readFileSync(manifest, 'utf8'));
    if (name !== null) packages.set(name, scripts);
  }
  const tree = {
    rootScripts: packageScripts(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts,
    packages,
    flags: new Map([
      ['infra/deploy.sh', new Set(helpFlags(help.deployHelp).keys())],
      ['infra/uninstall.sh', new Set(helpFlags(help.uninstallHelp).keys())],
      // The installer's own flags, and deploy.sh's, which it passes on.
      [
        'infra/install.sh',
        new Set([...helpFlags(help.installHelp).keys(), ...helpFlags(help.deployHelp).keys()]),
      ],
    ]),
    exists: (/** @type {string} */ file) => existsSync(path.join(root, file)),
  };
  for (const doc of [...GUIDES, ...COMMAND_DOCS]) {
    for (const command of commandsIn(readFileSync(path.join(root, doc), 'utf8'))) {
      const problem = commandProblem(command, tree);
      if (problem !== null) problems.push(`${doc}: ${problem}`);
    }
  }

  problems.push(
    ...largeSnapshotProblems(
      readFileSync(path.join(root, LARGE_SNAPSHOT_DOC), 'utf8'),
      readFileSync(path.join(root, VOCABULARY_MODULE), 'utf8'),
    ),
  );
  problems.push(
    ...rasteriserVersionProblems(
      dependencyVersions(root, RASTERISER.workspace, RASTERISER.name),
      new Map(
        wrappedMarkdownFiles(root).map((relPath) => [
          relPath,
          readFileSync(path.join(root, relPath), 'utf8'),
        ]),
      ),
    ),
  );

  const registry = readVariableRegistry(root);
  const quickStart = quickStartVariables(readFileSync(path.join(root, QUICK_START_DOC), 'utf8'), registry);
  if (quickStart.extra.length > 0)
    problems.push(
      `${QUICK_START_DOC}: its code names ${quickStart.extra.join(', ')}, which the quick start does not need: the page asks only for ${QUICK_START_VARIABLES.join(', ')} (write the default or an example instead, and say how to change it)`,
    );
  if (quickStart.missing.length > 0)
    problems.push(`${QUICK_START_DOC}: its code no longer names ${quickStart.missing.join(', ')}`);
  for (const doc of variableDocs(root)) {
    for (const token of unregisteredTokens(readFileSync(path.join(root, doc), 'utf8'), registry)) {
      problems.push(
        `${doc}: \`${token}\` in its code is not a variable of ${VARIABLES_MODULE} (add it there, or write the value without YOUR_)`,
      );
    }
  }
  problems.push(...markdownWidthProblems(root));
  return problems;
}

/**
 * A package.json's name and script names.
 * @param {string} text
 * @returns {{ name: string | null, scripts: Set<string> }}
 */
function packageScripts(text) {
  /** @type {unknown} */
  const manifest = JSON.parse(text);
  const record =
    typeof manifest === 'object' && manifest !== null
      ? /** @type {Record<string, unknown>} */ (manifest)
      : {};
  const scripts =
    typeof record.scripts === 'object' && record.scripts !== null ? Object.keys(record.scripts) : [];
  return { name: typeof record.name === 'string' ? record.name : null, scripts: new Set(scripts) };
}

function main() {
  const { values } = parseArgs({
    options: { write: { type: 'boolean', default: false }, root: { type: 'string' } },
    strict: true,
  });
  const root = values.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (values.write) {
    const file = path.join(root, LENS_DOC);
    const text = readFileSync(file, 'utf8');
    const generated = generateLensDoc(text, readLenses(root));
    if (generated.problems.length === 0 && generated.text !== text) {
      writeFileSync(file, generated.text);
      process.stdout.write(`user-docs: rewrote the generated blocks of ${LENS_DOC}.\n`);
    }
  }
  const problems = checkUserDocs(root);
  if (problems.length > 0) {
    process.stderr.write(`user-docs: FAILED\n${problems.map((problem) => `  ${problem}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  const rasteriser = dependencyVersions(root, RASTERISER.workspace, RASTERISER.name).installed ?? '';
  process.stdout.write(
    `user-docs: OK. ${String(GUIDES.length)} guides current with the tree; ${String(GUIDES.length + COMMAND_DOCS.length + logFreeDocs(root).length)} user documents without a verification log; ${QUICK_START_DOC} asks only for ${QUICK_START_VARIABLES.join(', ')}; ${RASTERISER_DOC} alone names ${RASTERISER.name}'s version, ${rasteriser} as installed; ${String(wrappedMarkdownFiles(root).length)} Markdown files wrapped at ${String(WIDTH)} columns.\n`,
  );
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`user-docs: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
