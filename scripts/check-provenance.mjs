// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Provenance guard (ADRs 0001, 0007 and 0017). Fails when anything outside the frozen legacy/ tree
 *   (a) imports, requires or re-exports a path containing `legacy/`,
 *   (b) mentions a name of the previous implementation or its upstream, or carries a Google copyright notice
 *       (see FORBIDDEN_TERMS), in its contents or in its path (file or directory names),
 *   (c) is a Go file, a Graphviz .dot/.gv file or a Gizmo query,
 *   (d) is a text source file without the SPDX header line in its first lines, or a text file of a type for
 *       which no header form and no header-free rule is defined,
 *   (e) is a symbolic link,
 *   (f) writes Google's company suffix after its name ("Google" or "Google Cloud" is the wording, ADR 0018) or names
 *       the retired planning document of the build (see RETIRED_TERMS), in its contents or in its path, or
 *   (g) cites a step of the build's retired implementation plan by its id (a task, a phase or, in Markdown, a
 *       decision; see PLAN_IDS) outside the historical records, docs/adr/ and docs/history/, or
 *   (h) names the project's former licence (see FORMER_LICENCE_TERMS) outside the few places that must (see
 *       FORMER_LICENCE_EXEMPTIONS), in its contents, or anywhere in its path.
 *
 * Usage:
 *   node scripts/check-provenance.mjs               check the repository this script lives in
 *   node scripts/check-provenance.mjs --root <dir>  check another tree (used by the tests)
 *   node scripts/check-provenance.mjs --list-exempt print the rules and exemptions, then exit
 *
 * Exit code 0 when the tree is clean, 1 on any violation, 2 on a usage error. Plain ESM, Node built-ins only.
 * Every forbidden string is assembled at run time or written as a pattern that does not match itself, so that this
 * file, which the check scans too, spells out none of them.
 */
import { readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  BINARY_EXTENSIONS,
  HEADER_EXEMPTIONS,
  HEADER_FREE_EXTENSIONS,
  HEADER_FREE_FILENAMES,
  HEADER_STYLE_BY_EXTENSION,
  HEADER_STYLE_BY_FILENAME,
  HEADER_WINDOW,
  SKIPPED_DIR_NAMES,
  SKIPPED_FILE_PATTERNS,
  SKIPPED_ROOT_PATHS,
  findHeader,
  headerLine,
  isBinary,
  isHeaderExempt,
  isHeaderFree,
  listRepoFiles,
  readProjectLicenseId,
  requiredHeaderStyle,
  splitLines,
} from './lib/repo-files.mjs';

const SELF = 'scripts/check-provenance.mjs';

/**
 * Strings that must not appear outside the exempt documents, matched case-insensitively per line. The names
 * match anywhere, also inside a longer word, so camelCase identifiers built on them are caught too. A Google
 * copyright notice is any line with "copyright" (or the © sign) followed later on the same line by the word
 * "google", which covers the usual header forms with a year or "(c)" in between. The three names are assembled
 * at run time, so that this file does not contain them either: the hand-off tree (scripts/handoff.sh) names them
 * only in docs/adr/.
 */
const FORBIDDEN_NAMES = Object.freeze([
  ['gcp', 'viz'].join(''),
  ['kno', 'yog'].join(''),
  ['for', 'seti'].join(''),
]);
const FORBIDDEN_TERMS = Object.freeze([
  ...FORBIDDEN_NAMES.map((name) => ({ label: name, pattern: new RegExp(name, 'i') })),
  { label: 'Copyright Google', pattern: /(?:copyright|\u00a9)[^\n]*\bgoogle/i },
]);

/** Files and directories (root-relative) where the forbidden names may appear, in contents and in names. */
const TERM_EXEMPTIONS = Object.freeze([
  { test: (/** @type {string} */ p) => p.startsWith('docs/adr/'), rule: 'docs/adr/**' },
  { test: (/** @type {string} */ p) => p === 'packages/icons/README.md', rule: 'packages/icons/README.md' },
  { test: (/** @type {string} */ p) => p === SELF, rule: `${SELF} (this checker)` },
]);

/**
 * Rule (f): strings that may not appear anywhere, the decision records included, matched case-insensitively per line
 * and in paths. Google's name with its company suffix: the project writes "Google" or "Google Cloud" (ADR 0018). The
 * file name of the implementation plan the project was built from: the plan was retired on 2026-10-12, and its
 * rules live on in the ADRs (ADR 0035), the skills and the guides. Assembled at run time, like the names above.
 */
const RETIRED_TERMS = Object.freeze([
  {
    label: ['Google', 'LLC'].join(' '),
    pattern: new RegExp(['\\bGoogle', 'LLC\\b'].join('[\\s,]+'), 'i'),
    message: 'write "Google" or "Google Cloud" without the company suffix (ADR 0018)',
  },
  {
    label: ['IMPLEMENTATION', 'PLAN'].join(''),
    pattern: new RegExp(['IMPLEMENTATION', 'PLAN'].join(''), 'i'),
    message:
      'the implementation plan was retired; point to the ADR, skill or guide that holds the rule (ADR 0035)',
  },
]);

/**
 * Rule (g): ids of the retired implementation plan. Its tasks were numbered by phase and step, its phases 0 to 7, its
 * decisions 1 to 19; text says what a thing is or does, names the ADR that records a decision, or gives a date. The
 * task and phase patterns apply to every text file, the decision pattern to Markdown only (in code, such letters
 * and digits are too often something else). No pattern matches its own source text.
 */
const PLAN_IDS = Object.freeze([
  { label: 'a task id', pattern: /\bP[0-7]\.[0-9]+\b/, markdownOnly: false },
  { label: 'a phase', pattern: /\bphase [0-7]\b/i, markdownOnly: false },
  { label: 'a decision id', pattern: /\bD(?:1[0-9]|[1-9])\b/, markdownOnly: true },
]);

/** The historical records, where rule (g) does not apply: the decision records and the dated reviews of the build. */
const PLAN_ID_EXEMPTIONS = Object.freeze([
  { test: (/** @type {string} */ p) => p.startsWith('docs/adr/'), rule: 'docs/adr/**' },
  { test: (/** @type {string} */ p) => p.startsWith('docs/history/'), rule: 'docs/history/**' },
]);

/**
 * Rule (h): the project's former licence. gcportrait is licensed under the MIT License since 2026-10-12 (ADR 0017); the
 * licence it carried before may be named only where the record of that decision, the dependency deny list, a
 * verbatim licence text or a released version's notes need it, so that it cannot creep back into a header, a
 * manifest, a footer or a document. Matched case-insensitively per line, in contents and in paths; the short form
 * only at the start of a word, so that a hash or an identifier that happens to contain the letters does not match.
 * Assembled at run time, like the names above.
 */
const FORMER_LICENCE_SHORT = ['A', 'GPL'].join('');
const FORMER_LICENCE_LONG = ['GNU', ['Aff', 'ero'].join('')];
const FORMER_LICENCE_TERMS = Object.freeze([
  { label: FORMER_LICENCE_SHORT, pattern: new RegExp(`\\b${FORMER_LICENCE_SHORT}`, 'i') },
  { label: FORMER_LICENCE_LONG.join(' '), pattern: new RegExp(FORMER_LICENCE_LONG.join('\\s+'), 'i') },
]);

/** Files (root-relative) whose contents may name the former licence, with the reason. Paths never may. */
const FORMER_LICENCE_EXEMPTIONS = Object.freeze([
  {
    test: (/** @type {string} */ p) => p === 'THIRD_PARTY.md',
    rule: 'THIRD_PARTY.md (the dependency deny list names it)',
  },
  {
    test: (/** @type {string} */ p) => /^docs\/adr\/0017-[^/]+$/.test(p),
    rule: 'docs/adr/0017-* (the record of the licence decision)',
  },
  {
    test: (/** @type {string} */ p) =>
      p === 'scripts/check-licenses.mjs' || p === 'scripts/check-licenses.test.ts',
    rule: 'scripts/check-licenses.mjs and its test (the deny list names the family it denies)',
  },
  {
    test: (/** @type {string} */ p) => p === 'scripts/licenses/MPL-2.0.txt',
    rule: 'scripts/licenses/MPL-2.0.txt (the verbatim MPL-2.0 text names it among its Secondary Licenses)',
  },
]);

/**
 * A CHANGELOG.md's released sections, where rule (h) does not apply either: the lines under a version heading
 * (`## 1.0.0`, `## v1.2.3 (2026-10-12)`), up to the next second-level heading that is not one (`## Unreleased`).
 */
const CHANGELOG_FILE = 'CHANGELOG.md';
const RELEASE_HEADING = /^##\s+v?\d+\.\d+\.\d+\b/;
const SECOND_LEVEL_HEADING = /^##\s/;

/** Extensions read as Markdown by rule (g). */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);

/** Extensions scanned for module specifiers (rule a). */
const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.astro',
  '.html',
  '.css',
]);

/** Patterns whose second capture group is a module specifier or a referenced path (rule a). */
const SPECIFIER_PATTERNS = Object.freeze([
  // import x from '…', import { x } from '…', export * from '…', import type …
  /\bfrom\s*(['"])([^'"\r\n]+)\1/g,
  // import '…' (side-effect import)
  /\bimport\s*(['"])([^'"\r\n]+)\1/g,
  // require('…'), require.resolve('…'), import('…'), import.meta.resolve('…')
  /\b(?:require(?:\.resolve)?|import(?:\.meta\.resolve)?)\s*\(\s*(['"`])([^'"`\r\n]+)\1/g,
  // new URL('…', import.meta.url)
  /\bnew\s+URL\s*\(\s*(['"`])([^'"`\r\n]+)\1/g,
  // CSS @import '…' and url('…')
  /@import\s+(?:url\(\s*)?(['"])([^'"\r\n]+)\1/g,
  /\burl\(\s*(['"]?)([^'")\r\n]+)\1\s*\)/g,
  // HTML/Astro src="…" and href="…"
  /\b(?:src|href)\s*=\s*(['"])([^'"\r\n]+)\1/g,
]);

/** Extensions of files that may not exist outside legacy/ (rule c): Go, and Graphviz in both spellings. */
const BANNED_EXTENSIONS = new Set(['.go', '.dot', '.gv']);

/**
 * JavaScript and TypeScript files are checked for Gizmo graph queries (rule c): a call on the Gizmo graph
 * object `g` (`V`, `Vertex`, `M`, `Morphism`, `emit`, `Emit`), anywhere on a line, which is how the upstream
 * query files are written (the call sits after an assignment or inside an `if`, never at line start). The
 * spelled-out forms are deliberately absent from this comment: the checker scans itself.
 */
const GIZMO_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const GIZMO_LINE = /\bg\.(?:V|Vertex|M|Morphism|emit|Emit)\(/;
const GIZMO_DESCRIPTION =
  'a call on the Gizmo graph object: g.V, g.Vertex, g.M, g.Morphism, g.emit or g.Emit';

/**
 * @typedef {{ relPath: string, line: number | undefined, rule: string, message: string }} Problem
 */

/**
 * @param {string} specifier
 * @returns {boolean}
 */
function pointsIntoLegacy(specifier) {
  return specifier.includes('legacy/') || specifier === 'legacy' || specifier.endsWith('/legacy');
}

/**
 * 1-based line number of a character offset.
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
function lineAt(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (text.charCodeAt(index) === 10) line += 1;
  return line;
}

/**
 * @param {string} relPath
 * @param {string} text
 * @param {Problem[]} problems
 */
function checkLegacyImports(relPath, text, problems) {
  if (relPath === SELF || !CODE_EXTENSIONS.has(path.posix.extname(relPath).toLowerCase())) return;
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const specifier = match[2];
      if (specifier === undefined || !pointsIntoLegacy(specifier)) continue;
      problems.push({
        relPath,
        line: lineAt(text, match.index),
        rule: 'legacy-import',
        message: `references "${specifier}"; nothing may import from legacy/ (ADRs 0001, 0007)`,
      });
    }
  }
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function isTermExempt(relPath) {
  return TERM_EXEMPTIONS.some((exemption) => exemption.test(relPath));
}

/**
 * Rule (b) on the path itself, so that a file or directory name cannot carry a forbidden name either.
 * Applies to binary files too.
 * @param {string} relPath
 * @param {Problem[]} problems
 */
function checkForbiddenPath(relPath, problems) {
  for (const term of FORMER_LICENCE_TERMS) {
    if (!term.pattern.test(relPath)) continue;
    problems.push({
      relPath,
      line: undefined,
      rule: 'former-licence',
      message: `path mentions "${term.label}"; gcportrait is MIT (ADR 0017), and its former licence has no file here`,
    });
  }
  for (const term of RETIRED_TERMS) {
    if (!term.pattern.test(relPath)) continue;
    problems.push({
      relPath,
      line: undefined,
      rule: 'retired-term',
      message: `path mentions "${term.label}"; ${term.message}`,
    });
  }
  if (isTermExempt(relPath)) return;
  for (const term of FORBIDDEN_TERMS) {
    if (!term.pattern.test(relPath)) continue;
    problems.push({
      relPath,
      line: undefined,
      rule: 'forbidden-name',
      message: `path mentions "${term.label}"; the previous implementation and its upstream stay in legacy/ (ADR 0001)`,
    });
  }
}

/**
 * @param {string} relPath
 * @param {string} text
 * @param {Problem[]} problems
 */
function checkForbiddenTerms(relPath, text, problems) {
  const exempt = isTermExempt(relPath);
  const lines = splitLines(text);
  lines.forEach((lineText, index) => {
    for (const term of RETIRED_TERMS) {
      if (!term.pattern.test(lineText)) continue;
      problems.push({
        relPath,
        line: index + 1,
        rule: 'retired-term',
        message: `mentions "${term.label}"; ${term.message}`,
      });
    }
    if (exempt) return;
    for (const term of FORBIDDEN_TERMS) {
      if (!term.pattern.test(lineText)) continue;
      problems.push({
        relPath,
        line: index + 1,
        rule: 'forbidden-name',
        message: `mentions "${term.label}"; the previous implementation and its upstream stay in legacy/ (ADR 0001)`,
      });
    }
  });
}

/**
 * Rule (g): the retired plan's ids, outside the historical records.
 * @param {string} relPath
 * @param {string} text
 * @param {Problem[]} problems
 */
function checkPlanIds(relPath, text, problems) {
  if (PLAN_ID_EXEMPTIONS.some((exemption) => exemption.test(relPath))) return;
  const markdown = MARKDOWN_EXTENSIONS.has(path.posix.extname(relPath).toLowerCase());
  const ids = PLAN_IDS.filter((id) => markdown || !id.markdownOnly);
  splitLines(text).forEach((lineText, index) => {
    for (const id of ids) {
      const match = id.pattern.exec(lineText);
      if (match === null) continue;
      problems.push({
        relPath,
        line: index + 1,
        rule: 'plan-id',
        message:
          `"${match[0]}" reads as ${id.label} of the retired implementation plan; say what the thing is or does, ` +
          'name its ADR, skill or guide, or give a date (ADR 0035)',
      });
    }
  });
}

/**
 * Rule (h): the former licence, outside its exemptions and a CHANGELOG's released sections.
 * @param {string} relPath
 * @param {string} text
 * @param {Problem[]} problems
 */
function checkFormerLicence(relPath, text, problems) {
  if (FORMER_LICENCE_EXEMPTIONS.some((exemption) => exemption.test(relPath))) return;
  const changelog = path.posix.basename(relPath) === CHANGELOG_FILE;
  let released = false;
  splitLines(text).forEach((lineText, index) => {
    if (changelog && SECOND_LEVEL_HEADING.test(lineText)) released = RELEASE_HEADING.test(lineText);
    if (released) return;
    for (const term of FORMER_LICENCE_TERMS) {
      if (!term.pattern.test(lineText)) continue;
      problems.push({
        relPath,
        line: index + 1,
        rule: 'former-licence',
        message:
          `mentions "${term.label}"; gcportrait is licensed under the MIT License since 2026-10-12 (ADR 0017): name ` +
          'MIT, or leave the former licence to the record of that decision',
      });
    }
  });
}

/**
 * @param {string} relPath
 * @param {string | undefined} text undefined for binary files
 * @param {Problem[]} problems
 * @returns {boolean} whether the file type itself is banned (the file has to go, so no other rule applies)
 */
function checkBannedFiles(relPath, text, problems) {
  const extension = path.posix.extname(relPath).toLowerCase();
  if (BANNED_EXTENSIONS.has(extension)) {
    problems.push({
      relPath,
      line: undefined,
      rule: 'banned-file',
      message: `${extension} files are not allowed outside legacy/ (ADR 0001: no Go code, no Graphviz templates)`,
    });
    return true;
  }
  if (text !== undefined && GIZMO_EXTENSIONS.has(extension) && GIZMO_LINE.test(text)) {
    problems.push({
      relPath,
      line: lineAt(text, text.search(GIZMO_LINE)),
      rule: 'banned-file',
      message: `looks like a Gizmo graph query (${GIZMO_DESCRIPTION}); not allowed outside legacy/ (ADR 0001)`,
    });
  }
  return false;
}

/**
 * Rule (e): symbolic links are reported, whatever they point at. A link can make legacy/, another checkout
 * or anything outside the repository reachable from a path the other rules consider clean.
 * @param {string} relPath
 * @param {string} absPath
 * @param {Problem[]} problems
 */
function reportSymlink(relPath, absPath, problems) {
  /** @type {string} */
  let target;
  try {
    target = readlinkSync(absPath);
  } catch {
    target = '(unreadable)';
  }
  problems.push({
    relPath,
    line: undefined,
    rule: 'symlink',
    message: `symbolic link to "${target}"; links are not allowed in the tree (they can reach into legacy/ or outside the repository)`,
  });
}

/**
 * @param {string} relPath
 * @param {string} text
 * @param {string} licenseId
 * @param {Problem[]} problems
 * @returns {boolean} whether the file needed a header
 */
function checkHeader(relPath, text, licenseId, problems) {
  const style = requiredHeaderStyle(relPath);
  if (style === undefined) {
    if (!isHeaderExempt(relPath) && !isHeaderFree(relPath)) {
      problems.push({
        relPath,
        line: undefined,
        rule: 'spdx-header',
        message:
          'no SPDX header form is defined for this file type; add its comment style to ' +
          'HEADER_STYLE_BY_EXTENSION or HEADER_STYLE_BY_FILENAME in scripts/lib/repo-files.mjs, or, if the ' +
          'format cannot hold a comment, add it to HEADER_FREE_EXTENSIONS or HEADER_FREE_FILENAMES there',
      });
    }
    return false;
  }
  const expected = headerLine(style, licenseId);
  const found = findHeader(splitLines(text), relPath, style);
  if (found?.licenseId === licenseId) return true;
  problems.push({
    relPath,
    line: found === undefined ? undefined : found.index + 1,
    rule: 'spdx-header',
    message:
      found === undefined
        ? `missing SPDX header; add the line "${expected}" within the first ${String(HEADER_WINDOW)} lines`
        : `SPDX header names "${found.licenseId}", expected "${expected}"`,
  });
  return true;
}

/**
 * Runs every rule over the tree rooted at `root`.
 * @param {string} root
 * @returns {{ problems: Problem[], fileCount: number, headerCount: number, licenseId: string }}
 */
function checkTree(root) {
  const licenseId = readProjectLicenseId(root);
  /** @type {Problem[]} */
  const problems = [];
  let fileCount = 0;
  let headerCount = 0;
  for (const { absPath, relPath, isSymlink } of listRepoFiles(root)) {
    fileCount += 1;
    checkForbiddenPath(relPath, problems);
    if (isSymlink) {
      reportSymlink(relPath, absPath, problems);
      continue;
    }
    const content = readFileSync(absPath);
    if (isBinary(relPath, content)) {
      checkBannedFiles(relPath, undefined, problems);
      continue;
    }
    const text = content.toString('utf8');
    checkLegacyImports(relPath, text, problems);
    checkForbiddenTerms(relPath, text, problems);
    checkPlanIds(relPath, text, problems);
    checkFormerLicence(relPath, text, problems);
    if (checkBannedFiles(relPath, text, problems)) continue;
    if (checkHeader(relPath, text, licenseId, problems)) headerCount += 1;
  }
  return { problems, fileCount, headerCount, licenseId };
}

/** @returns {string} */
function describeRules() {
  /** @type {Map<string, string[]>} */
  const headerForms = new Map();
  for (const [match, style] of [...HEADER_STYLE_BY_EXTENSION, ...HEADER_STYLE_BY_FILENAME]) {
    const line = headerLine(style, '<id>');
    headerForms.set(line, [...(headerForms.get(line) ?? []), match]);
  }
  return [
    'Provenance rules (scripts/check-provenance.mjs)',
    '',
    'Walked: every file under the repository root, except',
    `  directories named: ${SKIPPED_DIR_NAMES.join(', ')}`,
    `  root paths: ${SKIPPED_ROOT_PATHS.map((p) => `${p}/`).join(', ')}`,
    '  local environment files: .env, .env.* (except .env.example)',
    `  git-ignored files: ${SKIPPED_FILE_PATTERNS.map((p) => p.rule).join(', ')}`,
    `  binary files (by NUL byte, or extension ${[...BINARY_EXTENSIONS].join(' ')}) skip the text rules`,
    '',
    '(a) legacy-import: no import/export-from/require/import()/new URL()/CSS @import or url()/src=/href= whose',
    `    path contains "legacy/". Scanned extensions: ${[...CODE_EXTENSIONS].join(' ')}`,
    `(b) forbidden-name: case-insensitive substring, per line, in file contents and in file/directory names:`,
    `    ${FORBIDDEN_TERMS.map((t) => `"${t.label}"`).join(', ')}`,
    '    The names match inside longer words and camelCase identifiers too. "Copyright Google" matches any',
    '    line with "copyright" or the copyright sign followed later on the line by the word "google".',
    `    allowed only in: ${TERM_EXEMPTIONS.map((e) => e.rule).join(', ')}`,
    `(c) banned-file: ${[...BANNED_EXTENSIONS].join(', ')} files, and ${[...GIZMO_EXTENSIONS].join('/')} files containing`,
    `    ${GIZMO_DESCRIPTION} (anywhere on a line)`,
    `(d) spdx-header: the exact line below within the first ${String(HEADER_WINDOW)} lines (Markdown/Astro: the first`,
    `    ${String(HEADER_WINDOW)} lines after a leading --- frontmatter block). <id> is the "license" field of the root`,
    '    package.json (MIT since 2026-10-12, applied by scripts/set-license.mjs; ADR 0017).',
    '    Files are matched by exact base name first (dotfiles, Dockerfile, CODEOWNERS), then by extension:',
    ...[...headerForms].map(([line, extensions]) => `      ${line}   ${extensions.join(' ')}`),
    '    header-exempt:',
    ...HEADER_EXEMPTIONS.map((e) => `      ${e.rule}`),
    `    header-free formats (cannot hold a comment, or are data or licence texts): ${[
      ...HEADER_FREE_EXTENSIONS,
      ...HEADER_FREE_FILENAMES,
    ].join(' ')}, and binary files.`,
    '    Any other text file fails: its type needs a header style or a header-free entry in',
    '    scripts/lib/repo-files.mjs first.',
    '(e) symlink: no symbolic links anywhere in the walked tree, whatever they point at',
    `(f) retired-term: case-insensitive, per line, in file contents and in file/directory names, with no exemption:`,
    `    ${RETIRED_TERMS.map((t) => `"${t.label}"`).join(', ')}`,
    `(g) plan-id: per line, ${PLAN_IDS.filter((id) => !id.markdownOnly)
      .map((id) => `${id.label} (${String(id.pattern)})`)
      .join(' and ')} in every text file,`,
    `    ${PLAN_IDS.filter((id) => id.markdownOnly)
      .map((id) => `${id.label} (${String(id.pattern)})`)
      .join(' and ')} in Markdown (${[...MARKDOWN_EXTENSIONS].join(' ')})`,
    `    not applied in: ${PLAN_ID_EXEMPTIONS.map((e) => e.rule).join(', ')}`,
    `(h) former-licence: case-insensitive, per line, in file contents and in file/directory names:`,
    `    ${FORMER_LICENCE_TERMS.map((t) => `"${t.label}"`).join(', ')} (the first at the start of a word)`,
    '    contents allowed only in:',
    ...FORMER_LICENCE_EXEMPTIONS.map((e) => `      ${e.rule}`),
    `      the released sections of any ${CHANGELOG_FILE} (the lines under a "## <version>" heading)`,
    '    file and directory names: nowhere',
  ].join('\n');
}

/**
 * @param {readonly string[]} argv
 */
function parseCli(argv) {
  return parseArgs({
    args: [...argv],
    options: { root: { type: 'string' }, 'list-exempt': { type: 'boolean' } },
    strict: true,
  });
}

/**
 * @param {readonly string[]} argv
 * @returns {number} exit code
 */
function main(argv) {
  /** @type {ReturnType<typeof parseCli>} */
  let parsed;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    console.error(`provenance: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (parsed.values['list-exempt'] === true) {
    console.log(describeRules());
    return 0;
  }
  const root = path.resolve(parsed.values.root ?? fileURLToPath(new URL('..', import.meta.url)));
  const { problems, fileCount, headerCount, licenseId } = checkTree(root);
  if (problems.length === 0) {
    console.log(
      `provenance: OK. ${String(fileCount)} files scanned, ${String(headerCount)} SPDX headers ` +
        `(${licenseId}) verified; no legacy imports, forbidden names or banned files.`,
    );
    return 0;
  }
  const files = new Set(problems.map((problem) => problem.relPath));
  console.error(
    `provenance: FAILED with ${String(problems.length)} problem(s) in ${String(files.size)} file(s):`,
  );
  for (const problem of problems) {
    const location =
      problem.line === undefined ? problem.relPath : `${problem.relPath}:${String(problem.line)}`;
    console.error(`  ${location}  [${problem.rule}] ${problem.message}`);
  }
  console.error('Run `node scripts/check-provenance.mjs --list-exempt` for the rules and exemptions.');
  return 1;
}

process.exitCode = main(process.argv.slice(2));
