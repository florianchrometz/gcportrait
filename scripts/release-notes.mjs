// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * Writes the notes of a GitHub release (.github/workflows/release.yml, job github-release) to standard
 * output, in Markdown: the long-form non-affiliation statement, the changes of the version, the installer
 * line that deploys the release (infra/install.sh, served by the website, with the release's deploy scripts
 * and checksums.txt that scripts/release-assets.sh attaches), and the container image with its tags, digest
 * and the command that runs it locally.
 *
 * The changes of a version come from the tree, not from a file a pull request had to add: a `## X.Y.Z`
 * section of the root CHANGELOG.md when the maintainer wrote one for that version — the release's summary for
 * people — and otherwise the subject of every commit since the previous release tag, oldest first, one group
 * per area of the subject's `Area: …` prefix (a subject without one is listed under "Other"), merge commits
 * left out. A pre-release tag (vX.Y.Z-SUFFIX, such as v1.0.0-rc.1) takes the `## X.Y.Z` section when the
 * changelog has no section of its own, under one sentence saying so, and otherwise the commits since the
 * previous release tag, which are the ones its release will carry.
 *
 * The previous release tag is the highest final tag (vX.Y.Z, no suffix) among the tag's ancestors, so a
 * release after a pre-release still lists everything since the last release. The first release has no earlier
 * tag and lists every commit of the repository. A paragraph of a CHANGELOG.md section that repeats the
 * long-form statement is left out, since the notes open with it.
 *
 * Usage:
 *   node scripts/release-notes.mjs --tag vX.Y.Z[-SUFFIX] [--image ghcr.io/OWNER/gcportrait]
 *                                  [--digest sha256:...] [--latest true|false] [--root DIR]
 *
 * Exit code 0 with the notes on standard output; 2 on a usage error — an unknown option, a tag that is not a
 * release tag, a root that is not a git work tree with that tag. Plain ESM, Node built-ins only.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
/** @type {unknown} */
const branding = require(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend/src/branding.ts'),
);
const brandingRecord =
  typeof branding === 'object' && branding !== null ? /** @type {Record<string, unknown>} */ (branding) : {};

/**
 * The long-form non-affiliation statement (AGENTS.md, Non-affiliation, brand and legal),
 * loaded directly from frontend/src/branding.ts.
 * @type {string}
 */
export const NON_AFFILIATION_LONG =
  typeof brandingRecord.NON_AFFILIATION_LONG === 'string'
    ? brandingRecord.NON_AFFILIATION_LONG
    : (() => {
        throw new Error('frontend/src/branding.ts exports no NON_AFFILIATION_LONG string.');
      })();

/** A release tag: v, then a semantic version (a pre-release suffix allowed). */
const TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** A final release tag: vX.Y.Z, the tags a release's commits are counted from. */
const FINAL_TAG = /^v\d+\.\d+\.\d+$/;

/** Where the website serves infra/install.sh (website/astro.config.ts). */
export const INSTALLER_URL = 'https://gcportrait.app/install.sh';

/**
 * The heading of a version's section in CHANGELOG.md, which may name the release date after the version.
 * @param {string} version
 * @returns {RegExp}
 */
const sectionPattern = (version) => new RegExp(`^## ${version.replace(/\./g, '\\.')}(?:\\s|$)`);

/** A commit subject's area prefix: `App: collapse all …` groups the commit under "App". */
const SUBJECT_AREA = /^([^:]{1,40}):\s+(\S.*)$/;

export class UsageError extends Error {}

/**
 * Reads the "version" field from package.json under root, or undefined if absent or unreadable.
 * @param {string} root
 * @returns {string | undefined}
 */
export function packageVersionOf(root) {
  const file = path.join(root, 'package.json');
  if (!existsSync(file)) return undefined;
  try {
    const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(file, 'utf8')));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      typeof parsed.version === 'string'
    ) {
      return parsed.version;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * What `git` prints for `args`, run in `root`, without its trailing newline.
 * @param {string} root
 * @param {readonly string[]} args
 * @returns {string}
 */
function git(root, args) {
  try {
    return execFileSync('git', [...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  } catch (error) {
    const stderr = /** @type {{ stderr?: unknown }} */ (error).stderr;
    const detail =
      typeof stderr === 'string'
        ? (stderr.trim().split('\n')[0] ?? '')
        : error instanceof Error
          ? error.message
          : '';
    throw new UsageError(`\`git ${args.join(' ')}\` failed in ${root}: ${detail}`.trim());
  }
}

/**
 * The body of a version's `## X.Y.Z` section of a changelog — up to the next `## ` heading, without the
 * paragraphs that repeat the long-form statement — or null when the changelog has no such section.
 * @param {string} changelog
 * @param {string} version
 * @returns {string | null}
 */
export function changelogSection(changelog, version) {
  const lines = changelog.replace(/\r\n?/g, '\n').split('\n');
  const pattern = sectionPattern(version);
  const start = lines.findIndex((line) => pattern.test(line));
  if (start === -1) return null;
  let end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  if (end === -1) end = lines.length;
  const paragraphs = lines
    .slice(start + 1, end)
    .join('\n')
    .trim()
    .split(/\n[ \t]*\n/);
  const kept = paragraphs.filter(
    (paragraph) => paragraph.replace(/\s+/g, ' ').trim() !== NON_AFFILIATION_LONG,
  );
  const body = kept.join('\n\n').trim();
  return body === '' ? null : body;
}

/**
 * The version's `## X.Y.Z` section of the root CHANGELOG.md, or null when the tree has none for it.
 * @param {string} root
 * @param {string} version
 * @returns {string | null}
 */
function sectionOfTree(root, version) {
  const file = path.join(root, 'CHANGELOG.md');
  if (!existsSync(file)) return null;
  return changelogSection(readFileSync(file, 'utf8'), version);
}

/**
 * The versions whose CHANGELOG.md section the notes of `version` may be read from, in order of preference: the
 * version itself and, for a pre-release (X.Y.Z-SUFFIX), then X.Y.Z, whose summary a pre-release without one of
 * its own takes.
 * @param {string} version
 * @returns {string[]}
 */
export function sectionVersions(version) {
  const release = /^\d+\.\d+\.\d+/.exec(version)?.[0];
  return release === undefined || release === version ? [version] : [version, release];
}

/**
 * The highest final release tag among `tag`'s ancestors, or undefined for the first release.
 * @param {string} root
 * @param {string} tag
 * @returns {string | undefined}
 */
export function previousReleaseTag(root, tag) {
  return git(root, ['tag', '--merged', tag, '--sort=-v:refname'])
    .split('\n')
    .map((line) => line.trim())
    .find((candidate) => candidate !== tag && FINAL_TAG.test(candidate));
}

/**
 * The subjects of the commits between the previous release tag and `tag`, oldest first (every commit of the
 * repository for the first release), with the tag they are counted from.
 * @param {string} root
 * @param {string} tag
 * @returns {{ previous: string | undefined, subjects: string[] }}
 */
export function commitsSince(root, tag) {
  if (!/^v/.test(tag) || !tagExists(root, tag)) {
    throw new UsageError(`the tree has no tag ${tag}; tag the release commit before writing its notes`);
  }
  const previous = previousReleaseTag(root, tag);
  const range = previous === undefined ? tag : `${previous}..${tag}`;
  const subjects = git(root, ['log', '--no-merges', '--reverse', '--format=%s', range])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return { previous, subjects };
}

/**
 * Whether `tag` is a tag of the tree.
 * @param {string} root
 * @param {string} tag
 * @returns {boolean}
 */
function tagExists(root, tag) {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Commit subjects by the area of their prefix, in the order the areas first appear: each group's bullets (the
 * subject without its prefix, or the whole subject when it has none) in the order the commits were made.
 * @param {readonly string[]} subjects
 * @returns {Map<string, string[]>}
 */
export function areaGroups(subjects) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const subject of subjects) {
    const match = SUBJECT_AREA.exec(subject);
    const area = match?.[1] ?? 'Other';
    const bullet = `- ${match?.[2] ?? subject}`;
    groups.set(area, [...(groups.get(area) ?? []), bullet]);
  }
  return groups;
}

/**
 * The "Changes" section of the notes of `tag`: the version's section of CHANGELOG.md when it has one, else the
 * commits since the previous release tag, grouped by area.
 * @param {string} root
 * @param {string} tag
 * @param {string} version
 * @returns {{ notesOf: string, lines: string[] }}
 */
function changesOf(root, tag, version) {
  for (const candidate of sectionVersions(version)) {
    const section = sectionOfTree(root, candidate);
    if (section !== null) return { notesOf: candidate, lines: [section, ''] };
  }
  const { previous, subjects } = commitsSince(root, tag);
  const groups = areaGroups(subjects);
  const lines = [
    previous === undefined
      ? 'Every commit of the repository, oldest first, one group per area:'
      : `The commits since \`${previous}\`, oldest first, one group per area:`,
    '',
  ];
  for (const [area, bullets] of groups) lines.push(`### ${area}`, '', ...bullets, '');
  if (groups.size === 0) lines.push('No commits since the previous release.', '');
  return { notesOf: version, lines };
}

/**
 * The notes of the release `tag`.
 * @param {{ root: string, tag: string, image?: string | undefined, digest?: string | undefined, latest?: boolean, packageVersion?: string | undefined }} options
 * @returns {string}
 */
export function releaseNotes({ root, tag, image, digest, latest = false, packageVersion }) {
  const version = TAG.exec(tag)?.[1];
  if (version === undefined) throw new UsageError(`--tag must be a release tag such as v1.2.3, not "${tag}"`);
  const expectedVersion = packageVersion ?? packageVersionOf(root);
  if (expectedVersion !== undefined && tag.startsWith('v')) {
    if (tag.slice(1) !== expectedVersion) {
      throw new UsageError(`release tag ${tag} does not match package.json version ${expectedVersion}`);
    }
  }
  const { notesOf, lines } = changesOf(root, tag, version);

  const out = [NON_AFFILIATION_LONG, ''];
  if (notesOf !== version) {
    out.push(`A pre-release of ${notesOf}, published for checking; its notes are ${notesOf}'s.`, '');
  }
  out.push('## Changes', '', ...lines);

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

/**
 * The command line on `argv`: the notes on standard output and 0, or the reason on standard error and 2 on a
 * usage error.
 * @param {readonly string[]} argv
 * @returns {number}
 */
export function run(argv) {
  try {
    return main(argv);
  } catch (error) {
    // parseArgs reports an unknown or malformed option as a TypeError with a code (ERR_PARSE_ARGS_...).
    if (error instanceof UsageError || (error instanceof TypeError && 'code' in error)) {
      process.stderr.write(`release-notes: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

/** @param {readonly string[]} argv @returns {number} */
function main(argv) {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tag: { type: 'string' },
      image: { type: 'string' },
      digest: { type: 'string' },
      latest: { type: 'string', default: 'false' },
      root: { type: 'string' },
      'package-version': { type: 'string' },
    },
    strict: true,
  });
  if (values.tag === undefined) throw new UsageError('--tag is required (a release tag such as v1.2.3)');
  if (values.latest !== 'true' && values.latest !== 'false')
    throw new UsageError('--latest must be true or false');
  const root = values.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.stdout.write(
    releaseNotes({
      root,
      tag: values.tag,
      image: values.image,
      digest: values.digest,
      latest: values.latest === 'true',
      packageVersion: values['package-version'],
    }),
  );
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
