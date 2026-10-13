// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Writes the notes of a GitHub release (.github/workflows/release.yml, job github-release) to standard
 * output, in Markdown: the long-form non-affiliation statement, the changes of the version, read
 * from the `## X.Y.Z` sections of the workspace packages' CHANGELOG.md files that `pnpm release:version`
 * (changesets) wrote, the installer line that deploys the release (infra/install.sh, served by the website, with the
 * release's deploy scripts and checksums.txt that scripts/release-assets.sh attaches), and the container image with
 * its tags, digest and the command that runs it locally.
 *
 * All `@gcportrait/*` packages form one fixed changesets group, so every package that changed carries the same
 * version; a change listed by several packages appears once. "Updated dependencies" entries (the changesets
 * bookkeeping between the workspace's own packages) and the short commit hash changesets puts in front of each
 * entry are left out, and so is a paragraph of an entry that repeats the long form, which the notes open with
 * already (the 1.0.0 entry is the whole of CHANGELOG.md's 1.0.0 section, the long form included).
 *
 * Usage:
 *   node scripts/release-notes.mjs --tag vX.Y.Z [--image ghcr.io/OWNER/gcportrait] [--digest sha256:...]
 *                                  [--latest true|false] [--root DIR]
 *
 * Exit code 0 with the notes on standard output; 1 when no CHANGELOG.md has a section for the version (tag only
 * after `pnpm release:version`); 2 on a usage error. Plain ESM, Node built-ins only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/**
 * The long-form non-affiliation statement (agents.md, Non-affiliation, brand and legal);
 * scripts/release-notes.test.ts keeps it equal to the app's.
 */
export const NON_AFFILIATION_LONG =
  'gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is ' +
  'not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are ' +
  "trademarks of Google and are used under Google's icon usage terms.";

/** The kinds of change changesets writes, in the order the notes list them. */
const KINDS = Object.freeze(['Major', 'Minor', 'Patch']);

/** A release tag: v, then a semantic version (a pre-release suffix allowed). */
const TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** Where the website serves infra/install.sh (website/astro.config.ts). */
export const INSTALLER_URL = 'https://gcportrait.app/install.sh';

class UsageError extends Error {}

/**
 * The workspace package directories of pnpm-workspace.yaml (its `packages:` list; `dir/*` expanded one level),
 * relative to root and sorted, the ones that exist only.
 * @param {string} root
 * @returns {string[]}
 */
export function workspaceDirs(root) {
  const manifest = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  const list = /^packages:\s*\n((?:[ \t]+-[^\n]*\n?)+)/m.exec(manifest)?.[1] ?? '';
  /** @type {string[]} */
  const dirs = [];
  for (const line of list.split('\n')) {
    const entry = /^\s+-\s*['"]?([^'"#\s]+)['"]?/.exec(line)?.[1];
    if (entry === undefined) continue;
    if (entry.endsWith('/*')) {
      const parent = entry.slice(0, -2);
      if (!existsSync(path.join(root, parent))) continue;
      for (const child of readdirSync(path.join(root, parent)).sort()) {
        if (statSync(path.join(root, parent, child)).isDirectory()) dirs.push(path.join(parent, child));
      }
    } else if (existsSync(path.join(root, entry))) {
      dirs.push(entry);
    }
  }
  return dirs.sort();
}

/**
 * The entries of one version's section of a changesets CHANGELOG.md, by kind: each entry is a top-level bullet
 * with its indented continuation lines, without the commit hash prefix; "Updated dependencies" entries are dropped.
 * Null when the file has no `## version` section.
 * @param {string} changelog
 * @param {string} version
 * @returns {Map<string, string[]> | null}
 */
export function sectionEntries(changelog, version) {
  /** @type {Map<string, string[]>} */
  const entries = new Map();
  const lines = changelog.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return null;
  let kind = '';
  /** @type {string[] | undefined} */
  let current;
  const finish = () => {
    if (current === undefined) return;
    const text = current.join('\n').trimEnd();
    if (kind !== '' && !/^- Updated dependencies\b/.test(text)) {
      const list = entries.get(kind) ?? [];
      list.push(text.replace(/^- [0-9a-f]{7,40}: /, '- '));
      entries.set(kind, list);
    }
    current = undefined;
  };
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    const heading = /^### (\w+) Changes\s*$/.exec(line);
    if (heading !== null) {
      finish();
      kind = heading[1] ?? '';
      continue;
    }
    if (line.startsWith('- ')) {
      finish();
      current = [line];
    } else if (current !== undefined && (line.startsWith('  ') || line.trim() === '')) {
      current.push(line);
    } else if (line.trim() !== '') {
      finish();
    }
  }
  finish();
  return entries;
}

/**
 * An entry without the paragraphs that repeat the long-form statement (whitespace and line breaks aside), which the
 * notes carry once at the top. The entry's first paragraph, its bullet, is always kept.
 * @param {string} entry a top-level bullet with its indented continuation lines
 * @returns {string}
 */
export function withoutLongForm(entry) {
  const paragraphs = entry.split(/\n[ \t]*\n/);
  const kept = paragraphs.filter(
    (paragraph, index) => index === 0 || paragraph.replace(/\s+/g, ' ').trim() !== NON_AFFILIATION_LONG,
  );
  return kept.join('\n\n');
}

/**
 * The notes of the release `tag`, or null when no CHANGELOG.md has a section for its version.
 * @param {{ root: string, tag: string, image?: string | undefined, digest?: string | undefined, latest?: boolean }} options
 * @returns {string | null}
 */
export function releaseNotes({ root, tag, image, digest, latest = false }) {
  const version = TAG.exec(tag)?.[1];
  if (version === undefined) throw new UsageError(`--tag must be a release tag such as v1.2.3, not "${tag}"`);
  /** @type {Map<string, string[]>} */
  const byKind = new Map();
  const seen = new Set();
  let sections = 0;
  for (const dir of workspaceDirs(root)) {
    const file = path.join(root, dir, 'CHANGELOG.md');
    if (!existsSync(file)) continue;
    const entries = sectionEntries(readFileSync(file, 'utf8'), version);
    if (entries === null) continue;
    sections += 1;
    for (const [kind, list] of entries) {
      for (const raw of list) {
        const entry = withoutLongForm(raw);
        if (seen.has(entry)) continue;
        seen.add(entry);
        byKind.set(kind, [...(byKind.get(kind) ?? []), entry]);
      }
    }
  }
  if (sections === 0) return null;

  const out = [NON_AFFILIATION_LONG, '', '## Changes', ''];
  const kinds = [...KINDS, ...[...byKind.keys()].filter((kind) => !KINDS.includes(kind))];
  let listed = 0;
  for (const kind of kinds) {
    const list = byKind.get(kind);
    if (list === undefined || list.length === 0) continue;
    out.push(`### ${kind} changes`, '', ...list, '');
    listed += list.length;
  }
  if (listed === 0) out.push('No user-facing changes are recorded for this version.', '');

  out.push(
    '## Deploy',
    '',
    'Deploy this release to Cloud Run in a Google Cloud project of yours; the project id is all it needs',
    '(docs/self-host.md):',
    '',
    '```sh',
    `curl -fsSL ${INSTALLER_URL} | bash -s -- --version ${tag} --project YOUR_PROJECT`,
    '```',
    '',
    `The installer downloads \`gcportrait-deploy-${tag}.tar.gz\` from this release, checks its SHA-256 against`,
    "`checksums.txt` before it unpacks or runs anything, and runs the release's `infra/deploy.sh` with this release's",
    'image. It ends with the next steps: open the address, create the OAuth client, redeploy with its id.',
    '',
  );

  if (image !== undefined && image !== '') {
    const [major, minor] = version.split('.');
    const prerelease = version.includes('-');
    const tags = [
      version,
      ...(prerelease ? [] : [`${String(major)}.${String(minor)}`]),
      ...(latest ? ['latest'] : []),
    ];
    out.push(
      '## Container image',
      '',
      `\`${image}\`, for linux/amd64 and linux/arm64, tagged ${tags.map((t) => `\`${t}\``).join(', ')}` +
        (digest !== undefined && digest !== '' ? `; digest \`${digest}\`.` : '.'),
      '',
      'Run it on your machine:',
      '',
      '```sh',
      `docker run --rm --publish 127.0.0.1:8080:8080 ${image}:${version}`,
      '```',
      '',
      'The SPDX software bills of materials of both platform images are attached to this release; `checksums.txt`',
      'lists the SHA-256 of every file attached to it.',
      '',
    );
  }
  return `${out.join('\n').trimEnd()}\n`;
}

function main() {
  const { values } = parseArgs({
    options: {
      tag: { type: 'string' },
      image: { type: 'string' },
      digest: { type: 'string' },
      latest: { type: 'string', default: 'false' },
      root: { type: 'string' },
    },
    strict: true,
  });
  if (values.tag === undefined) throw new UsageError('--tag is required (a release tag such as v1.2.3)');
  if (values.latest !== 'true' && values.latest !== 'false')
    throw new UsageError('--latest must be true or false');
  const root = values.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const notes = releaseNotes({
    root,
    tag: values.tag,
    image: values.image,
    digest: values.digest,
    latest: values.latest === 'true',
  });
  if (notes === null) {
    process.stderr.write(
      `release-notes: no CHANGELOG.md has a section "## ${values.tag.slice(1)}". Run \`pnpm release:version\` ` +
        'and commit its changes before tagging the release.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(notes);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    // parseArgs reports an unknown or malformed option as a TypeError with a code (ERR_PARSE_ARGS_...).
    if (error instanceof UsageError || (error instanceof TypeError && 'code' in error)) {
      process.stderr.write(`release-notes: ${error.message}\n`);
      process.exitCode = 2;
    } else {
      throw error;
    }
  }
}
