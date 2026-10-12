// SPDX-License-Identifier: MIT
// @ts-check
/**
 * File-walking and SPDX-header rules shared by the repository tooling (scripts/check-provenance.mjs and
 * scripts/set-license.mjs). Both tools must agree on which files exist and what a header looks like, so the
 * rules live here once. Plain ESM, Node built-ins only.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The placeholder SPDX identifier every file carried until the maintainer chose the licence (ADR 0017: `MIT` since
 * 2026-10-12). Only a fallback now, for a tree whose root package.json names no licence (the tools' tests build
 * such trees).
 */
export const PLACEHOLDER_LICENSE_ID = 'LicenseRef-gcportrait-TBD';

/** How many lines from the top of a file (or from the end of Markdown/Astro frontmatter) may precede the header. */
export const HEADER_WINDOW = 10;

/**
 * Directory names that are never walked, wherever they occur: VCS data, and the directories .gitignore
 * ignores at any depth (installed dependencies, build output, per-user assistant settings). Keep this list in
 * step with the unanchored directory entries of .gitignore.
 */
export const SKIPPED_DIR_NAMES = Object.freeze([
  '.git',
  'node_modules',
  '.pnpm-store',
  'dist',
  'build',
  'coverage',
  '.astro',
  '.vite',
  '.claude',
]);

/**
 * Root-relative paths that are never walked: legacy/, the frozen previous implementation (ADR 0007; it exists in
 * the build repository only), the scratch output directory of `pnpm render`, and the Playwright output
 * directories, which .gitignore ignores under e2e/ only.
 */
export const SKIPPED_ROOT_PATHS = Object.freeze([
  'legacy',
  'out',
  'e2e/test-results',
  'e2e/playwright-report',
  'e2e/blob-report',
]);

/**
 * File names that are never read, wherever they occur: the files .gitignore ignores by pattern (logs,
 * TypeScript build info, local render output, OS metadata). Local environment files are handled separately
 * (see isSkippedFileName). Keep this list in step with .gitignore.
 */
export const SKIPPED_FILE_PATTERNS = Object.freeze([
  { pattern: /\.log$/, rule: '*.log' },
  { pattern: /\.tsbuildinfo$/, rule: '*.tsbuildinfo' },
  { pattern: /\.local\.(?:png|svg)$/, rule: '*.local.png, *.local.svg' },
  { pattern: /^(?:\.DS_Store|Thumbs\.db)$/, rule: '.DS_Store, Thumbs.db' },
]);

/** Extensions treated as binary: never read for text rules. Other files are also treated as binary if they hold a NUL byte. */
export const BINARY_EXTENSIONS = Object.freeze(
  new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.avif',
    '.ico',
    '.bmp',
    '.tif',
    '.tiff',
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
    '.eot',
    '.pdf',
    '.zip',
    '.gz',
    '.tgz',
    '.br',
    '.wasm',
    '.node',
    '.mp4',
    '.webm',
    '.mov',
    '.mp3',
    '.ogg',
    '.wav',
  ]),
);

/**
 * @typedef {'slash' | 'hash' | 'block' | 'html'} CommentStyle
 * @typedef {{ prefix: string, suffix: string }} CommentDelimiters
 */

/** @type {Readonly<Record<CommentStyle, CommentDelimiters>>} */
const DELIMITERS = Object.freeze({
  slash: { prefix: '// ', suffix: '' },
  hash: { prefix: '# ', suffix: '' },
  block: { prefix: '/* ', suffix: ' */' },
  html: { prefix: '<!-- ', suffix: ' -->' },
});

/**
 * Text source files that must carry an SPDX header, by extension, with the comment style of the header.
 * @type {ReadonlyMap<string, CommentStyle>}
 */
export const HEADER_STYLE_BY_EXTENSION = new Map([
  ['.ts', 'slash'],
  ['.tsx', 'slash'],
  ['.mts', 'slash'],
  ['.cts', 'slash'],
  ['.js', 'slash'],
  ['.jsx', 'slash'],
  ['.mjs', 'slash'],
  ['.cjs', 'slash'],
  ['.css', 'block'],
  ['.yaml', 'hash'],
  ['.yml', 'hash'],
  ['.sh', 'hash'],
  ['.md', 'html'],
  ['.html', 'html'],
  ['.astro', 'html'],
]);

/**
 * Text files without a usable extension that must carry an SPDX header, by base name, with the comment style
 * of the header. `path.extname()` is empty for dotfiles such as `.npmrc`, so these are looked up by name
 * before the extension. All accept `#` comments; in a Dockerfile the header may follow a `# syntax=` parser
 * directive. `.nvmrc` is deliberately absent: not every Node version manager accepts a comment there.
 * @type {ReadonlyMap<string, CommentStyle>}
 */
export const HEADER_STYLE_BY_FILENAME = new Map([
  ['.editorconfig', 'hash'],
  ['.gitignore', 'hash'],
  ['.gitattributes', 'hash'],
  ['.npmrc', 'hash'],
  ['.prettierignore', 'hash'],
  ['.dockerignore', 'hash'],
  ['.env.example', 'hash'],
  ['Dockerfile', 'hash'],
  ['CODEOWNERS', 'hash'],
]);

/**
 * Text formats that carry no SPDX header because they cannot hold a comment (JSON and its line-delimited
 * forms, the bare version number in .nvmrc, empty placeholder files) or are data and licence texts rather
 * than source (plain text, SVG artwork, draw.io files such as the render golden, LICENSE). Every other text file
 * must match a header style above; a file type that matches neither fails the provenance check until one of the
 * two lists names it.
 */
export const HEADER_FREE_EXTENSIONS = Object.freeze(
  new Set(['.json', '.jsonl', '.ndjson', '.txt', '.svg', '.drawio']),
);

/**
 * File names that carry no SPDX header, see HEADER_FREE_EXTENSIONS. `.prettierrc` holds JSON; GitHub Pages
 * requires `CNAME` (website/public/CNAME, ADR 0009) to hold nothing but the domain; `LICENSE` is the licence text
 * (ADR 0017), which states the licence in its own words.
 */
export const HEADER_FREE_FILENAMES = Object.freeze(
  new Set(['LICENSE', '.nvmrc', '.prettierrc', '.gitkeep', 'CNAME']),
);

/** Extensions whose header is searched after a leading `---` frontmatter block, if there is one. */
const FRONTMATTER_EXTENSIONS = new Set(['.md', '.astro']);

/**
 * Header-exempt text sources, with the reason. Everything else matched by a name or extension above needs the
 * header.
 * @type {ReadonlyArray<{ test: (relPath: string) => boolean, rule: string }>}
 */
export const HEADER_EXEMPTIONS = Object.freeze([
  { test: (p) => p === 'pnpm-lock.yaml', rule: 'pnpm-lock.yaml (lockfile, generated)' },
  {
    test: (p) => /^\.changeset\/[^/]+\.md$/.test(p) && p !== '.changeset/README.md',
    rule: '.changeset/*.md except README.md (changeset entries, consumed and deleted at release)',
  },
  {
    test: (p) => p === 'CHANGELOG.md' || p.endsWith('/CHANGELOG.md'),
    rule: '**/CHANGELOG.md (generated by `changeset version`)',
  },
]);

/**
 * @param {string} relPath root-relative POSIX path
 * @returns {boolean}
 */
export function isHeaderExempt(relPath) {
  return HEADER_EXEMPTIONS.some((exemption) => exemption.test(relPath));
}

/**
 * The exact header line for a comment style and licence identifier.
 * @param {CommentStyle} style
 * @param {string} licenseId
 * @returns {string}
 */
export function headerLine(style, licenseId) {
  const { prefix, suffix } = DELIMITERS[style];
  return `${prefix}SPDX-License-Identifier: ${licenseId}${suffix}`;
}

/**
 * The comment style an SPDX header takes in a file, by base name first and extension second, or undefined
 * for files that never carry one (JSON, plain text, LICENSE, .nvmrc, ...). Ignores the exemptions, so that
 * scripts/set-license.mjs still rewrites a header an exempt file happens to carry.
 * @param {string} relPath root-relative POSIX path
 * @returns {CommentStyle | undefined}
 */
export function headerStyleFor(relPath) {
  return (
    HEADER_STYLE_BY_FILENAME.get(path.posix.basename(relPath)) ??
    HEADER_STYLE_BY_EXTENSION.get(path.posix.extname(relPath).toLowerCase())
  );
}

/**
 * Whether a text file is of a format that never carries an SPDX header (HEADER_FREE_EXTENSIONS and
 * HEADER_FREE_FILENAMES).
 * @param {string} relPath root-relative POSIX path
 * @returns {boolean}
 */
export function isHeaderFree(relPath) {
  return (
    HEADER_FREE_FILENAMES.has(path.posix.basename(relPath)) ||
    HEADER_FREE_EXTENSIONS.has(path.posix.extname(relPath).toLowerCase())
  );
}

/**
 * The header comment style required for a path, or undefined when the file needs no header.
 * @param {string} relPath root-relative POSIX path
 * @returns {CommentStyle | undefined}
 */
export function requiredHeaderStyle(relPath) {
  if (isHeaderExempt(relPath)) return undefined;
  return headerStyleFor(relPath);
}

/**
 * Index range [start, end) of the lines in which the header must appear. For Markdown and Astro files that
 * open with a `---` frontmatter block, the window starts on the line after the closing `---`.
 * @param {readonly string[]} lines
 * @param {string} relPath
 * @returns {{ start: number, end: number }}
 */
export function headerWindow(lines, relPath) {
  let start = 0;
  if (FRONTMATTER_EXTENSIONS.has(path.posix.extname(relPath).toLowerCase()) && lines[0] === '---') {
    const closing = lines.indexOf('---', 1);
    if (closing > 0) start = closing + 1;
  }
  return { start, end: Math.min(lines.length, start + HEADER_WINDOW) };
}

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds the SPDX header line of a file in its header window, whatever identifier it carries.
 * @param {readonly string[]} lines file content split into lines
 * @param {string} relPath root-relative POSIX path
 * @param {CommentStyle} style
 * @returns {{ index: number, licenseId: string } | undefined}
 */
export function findHeader(lines, relPath, style) {
  const { prefix, suffix } = DELIMITERS[style];
  const pattern = new RegExp(
    `^${escapeRegExp(prefix)}SPDX-License-Identifier: (\\S+)${escapeRegExp(suffix)}$`,
  );
  const { start, end } = headerWindow(lines, relPath);
  for (let index = start; index < end; index += 1) {
    const match = pattern.exec((lines[index] ?? '').trimEnd());
    const licenseId = match?.[1];
    if (licenseId !== undefined) return { index, licenseId };
  }
  return undefined;
}

/**
 * Splits text into lines, accepting LF and CRLF endings.
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  return text.split(/\r?\n/);
}

/**
 * @param {string} relPath root-relative POSIX path
 * @param {Buffer} content
 * @returns {boolean}
 */
export function isBinary(relPath, content) {
  if (BINARY_EXTENSIONS.has(path.posix.extname(relPath).toLowerCase())) return true;
  return content.subarray(0, 8192).includes(0);
}

/**
 * Local environment files (git-ignored, may hold secrets) are never read; `.env.example` is a normal file.
 * Nor are the other files .gitignore ignores by pattern (SKIPPED_FILE_PATTERNS).
 * @param {string} name file base name
 * @returns {boolean}
 */
function isSkippedFileName(name) {
  if ((name === '.env' || name.startsWith('.env.')) && name !== '.env.example') return true;
  return SKIPPED_FILE_PATTERNS.some(({ pattern }) => pattern.test(name));
}

/**
 * @typedef {{ absPath: string, relPath: string, isSymlink: boolean }} RepoFile
 */

/**
 * Every file under `root` that the tooling looks at, in a stable (sorted) order. Symbolic links are never
 * followed: they are returned with `isSymlink: true` so that the provenance check can report them (a link
 * could otherwise reach into legacy/ or outside the repository unnoticed) and the licence rewriter can skip
 * them. Links inside skipped directories are not listed, like everything else there.
 * @param {string} root absolute path of the repository root
 * @returns {RepoFile[]}
 */
export function listRepoFiles(root) {
  /** @type {RepoFile[]} */
  const files = [];
  /** @param {string} relDir */
  const visit = (relDir) => {
    const absDir = path.join(root, relDir);
    const entries = readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        if (SKIPPED_DIR_NAMES.includes(entry.name) || SKIPPED_ROOT_PATHS.includes(relPath)) continue;
        files.push({ absPath: path.join(root, relPath), relPath, isSymlink: true });
      } else if (entry.isDirectory()) {
        if (SKIPPED_DIR_NAMES.includes(entry.name)) continue;
        if (SKIPPED_ROOT_PATHS.includes(relPath)) continue;
        visit(relPath);
      } else if (entry.isFile()) {
        if (SKIPPED_ROOT_PATHS.includes(relPath) || isSkippedFileName(entry.name)) continue;
        files.push({ absPath: path.join(root, relPath), relPath, isSymlink: false });
      }
    }
  };
  visit('');
  return files;
}

/**
 * The project's licence identifier: the `license` field of the root package.json (`MIT`), which
 * scripts/set-license.mjs rewrites together with every header. Falls back to the placeholder when the field is
 * missing.
 * @param {string} root absolute path of the repository root
 * @returns {string}
 */
export function readProjectLicenseId(root) {
  const manifestPath = path.join(root, 'package.json');
  if (!existsSync(manifestPath)) return PLACEHOLDER_LICENSE_ID;
  /** @type {unknown} */
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof manifest === 'object' && manifest !== null && 'license' in manifest) {
    const { license } = manifest;
    if (typeof license === 'string' && license.trim() !== '') return license.trim();
  }
  return PLACEHOLDER_LICENSE_ID;
}
