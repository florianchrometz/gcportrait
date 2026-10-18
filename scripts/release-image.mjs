// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * The names, tags, labels and annotations of the image that .github/workflows/release.yml (job publish-image)
 * publishes, written in the `name=value` format of $GITHUB_OUTPUT to standard output (lists as multi-line values,
 * one entry per line, which docker/build-push-action reads as its `tags`, `labels` and `annotations` inputs).
 *
 * - `image`: ghcr.io/OWNER/gcportrait, the owner lowercase (ghcr.io package names are lowercase).
 * - `app_version`: what /healthz reports, the git tag (`vX.Y.Z`), or `dev-SHA7` for a run by hand.
 * - `latest`: `true` only for the newest release, the highest `vX.Y.Z` tag of the repository; never a pre-release,
 *   nor a patch of an older line tagged after a newer release.
 * - `tags`: a tag push publishes `X.Y.Z` and `X.Y` (a pre-release `X.Y.Z-SUFFIX` only its own version), plus
 *   `latest` when `latest` is true; a run by hand publishes `dev` only.
 * - `labels`: what infra/Dockerfile does not set itself, the source repository, its URL, the revision, the
 *   creation time, and the version as the image tag reads it (`X.Y.Z` or `dev`, overriding the Dockerfile's).
 * - `annotations`: on every platform manifest and on the index (ghcr.io shows a multi-platform package's
 *   description from the index), the title, description and licence of infra/Dockerfile's `LABEL`, so the long
 *   form of the non-affiliation statement has one copy for the image, plus the labels above.
 *
 * Usage:
 *   node scripts/release-image.mjs --event push|workflow_dispatch --tag REF_NAME --sha SHA
 *                                  --repository OWNER/NAME [--server-url https://github.com]
 *                                  [--created ISO-8601] [--root DIR]
 *
 * Reads the repository's `v*` tags with git and infra/Dockerfile under --root (default: the repository). Exit
 * code 0 with the outputs on standard output; 1 when the tag of a push is no release tag (`vX.Y.Z[-SUFFIX]`) or
 * the Dockerfile lacks a label; 2 on a usage error. Plain ESM, Node built-ins only: the job runs it on the
 * runner's own Node, without installing one.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** A release tag: v, then a semantic version (a pre-release suffix allowed). */
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

/** A final release tag, the only ones `latest` can point at. */
const FINAL_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** The OCI keys the annotations take from infra/Dockerfile's LABEL. */
export const DOCKERFILE_KEYS = Object.freeze([
  'org.opencontainers.image.title',
  'org.opencontainers.image.description',
  'org.opencontainers.image.licenses',
]);

/** The annotation levels: every platform manifest and the index. */
const LEVELS = Object.freeze(['manifest', 'index']);

class UsageError extends Error {}
class ReleaseError extends Error {}

/**
 * Negative, zero or positive as version `a` is lower than, equal to or higher than `b`.
 * @param {readonly number[]} a
 * @param {readonly number[]} b
 * @returns {number}
 */
function compareVersions(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The newest final release among `tags`, compared by version numbers, or undefined when there is none.
 * @param {readonly string[]} tags
 * @returns {string | undefined}
 */
export function newestRelease(tags) {
  /** @type {{ tag: string, parts: number[] } | undefined} */
  let newest;
  for (const tag of tags) {
    const match = FINAL_TAG.exec(tag);
    if (match === null) continue;
    const parts = match.slice(1, 4).map(Number);
    if (newest === undefined || compareVersions(parts, newest.parts) > 0) newest = { tag, parts };
  }
  return newest?.tag;
}

/**
 * The values of a Dockerfile's `LABEL key="value"` pairs (double-quoted values, continuation lines joined).
 * @param {string} dockerfile
 * @returns {Map<string, string>}
 */
export function dockerfileLabels(dockerfile) {
  const joined = dockerfile.replace(/\\\r?\n/g, ' ');
  /** @type {Map<string, string>} */
  const labels = new Map();
  for (const line of joined.split('\n')) {
    if (!/^\s*LABEL\s/.test(line)) continue;
    for (const match of line.matchAll(/([A-Za-z0-9._-]+)="((?:[^"\\]|\\.)*)"/g)) {
      labels.set(match[1] ?? '', (match[2] ?? '').replace(/\\(.)/g, '$1'));
    }
  }
  return labels;
}

/**
 * @typedef {object} ImageInput
 * @property {string} event `push` (a tag) or `workflow_dispatch` (by hand)
 * @property {string} tag the git ref name: the tag of a push
 * @property {string} sha the commit
 * @property {string} repository OWNER/NAME
 * @property {string} serverUrl https://github.com
 * @property {string} created the creation time, ISO 8601
 * @property {readonly string[]} releaseTags the repository's `v*` tags
 * @property {string} dockerfile the text of infra/Dockerfile
 */

/**
 * @typedef {object} ImageMeta
 * @property {string} image
 * @property {string} appVersion
 * @property {boolean} latest
 * @property {string[]} tags full references, image:tag
 * @property {string[]} labels key=value
 * @property {string[]} annotations level:key=value
 */

/**
 * @param {ImageInput} input
 * @returns {ImageMeta}
 */
export function imageMeta(input) {
  const { event, tag, sha, repository, serverUrl, created, releaseTags, dockerfile } = input;
  const owner = repository.split('/')[0] ?? '';
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository))
    throw new UsageError(`--repository ${repository}: not OWNER/NAME`);
  const image = `ghcr.io/${owner.toLowerCase()}/gcportrait`;
  /** @type {string} */
  let appVersion;
  /** @type {string} */
  let version;
  /** @type {string[]} */
  let tagNames;
  let latest = false;
  if (event === 'workflow_dispatch') {
    appVersion = `dev-${sha.slice(0, 7)}`;
    version = 'dev';
    tagNames = ['dev'];
  } else if (event === 'push') {
    const match = RELEASE_TAG.exec(tag);
    if (match === null) throw new ReleaseError(`${tag} is not a release tag (vX.Y.Z or vX.Y.Z-SUFFIX)`);
    appVersion = tag;
    version = tag.slice(1);
    const final = FINAL_TAG.test(tag);
    tagNames = final ? [version, `${match[1] ?? ''}.${match[2] ?? ''}`] : [version];
    latest = final && newestRelease(releaseTags) === tag;
    if (latest) tagNames.push('latest');
  } else {
    throw new UsageError(`--event ${event}: push or workflow_dispatch`);
  }

  const fromDockerfile = dockerfileLabels(dockerfile);
  /** @type {[string, string][]} */
  const own = [];
  for (const key of DOCKERFILE_KEYS) {
    const value = fromDockerfile.get(key);
    if (value === undefined || value === '') throw new ReleaseError(`infra/Dockerfile sets no label ${key}`);
    own.push([key, value]);
  }
  const url = `${serverUrl}/${repository}`;
  /** @type {[string, string][]} */
  const added = [
    ['org.opencontainers.image.created', created],
    ['org.opencontainers.image.revision', sha],
    ['org.opencontainers.image.source', url],
    ['org.opencontainers.image.url', url],
    ['org.opencontainers.image.version', version],
  ];
  const labels = added.map(([key, value]) => `${key}=${value}`);
  const annotations = LEVELS.flatMap((level) =>
    [...own, ...added].map(([key, value]) => `${level}:${key}=${value}`),
  );
  return {
    image,
    appVersion,
    latest,
    tags: tagNames.map((name) => `${image}:${name}`),
    labels,
    annotations,
  };
}

/**
 * The $GITHUB_OUTPUT text of `meta`: single values as name=value, lists between heredoc delimiters.
 * @param {ImageMeta} meta
 * @returns {string}
 */
export function githubOutput(meta) {
  /** @param {string} name @param {readonly string[]} values */
  const list = (name, values) => {
    const delimiter = `GCPORTRAIT_${name.toUpperCase()}_EOF`;
    if (values.some((value) => value.includes('\n') || value === delimiter)) {
      throw new ReleaseError(`${name}: a value holds a line break or the delimiter`);
    }
    return [`${name}<<${delimiter}`, ...values, delimiter];
  };
  return [
    `image=${meta.image}`,
    `app_version=${meta.appVersion}`,
    `latest=${String(meta.latest)}`,
    ...list('tags', meta.tags),
    ...list('labels', meta.labels),
    ...list('annotations', meta.annotations),
    '',
  ].join('\n');
}

/**
 * @param {readonly string[]} argv
 * @returns {string}
 */
export function main(argv) {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      event: { type: 'string' },
      tag: { type: 'string' },
      sha: { type: 'string' },
      repository: { type: 'string' },
      'server-url': { type: 'string', default: 'https://github.com' },
      created: { type: 'string' },
      root: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  for (const name of /** @type {const} */ (['event', 'sha', 'repository'])) {
    if (values[name] === undefined || values[name] === '') throw new UsageError(`--${name} is required`);
  }
  const root = values.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const releaseTags = execFileSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return githubOutput(
    imageMeta({
      event: values.event ?? '',
      tag: values.tag ?? '',
      sha: values.sha ?? '',
      repository: values.repository ?? '',
      serverUrl: values['server-url'],
      created: values.created ?? new Date().toISOString(),
      releaseTags,
      dockerfile: readFileSync(path.join(root, 'infra', 'Dockerfile'), 'utf8'),
    }),
  );
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(main(process.argv.slice(2)));
  } catch (error) {
    const usage = error instanceof UsageError || (error instanceof TypeError && 'code' in error);
    process.stderr.write(`release-image: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(usage ? 2 : 1);
  }
}
