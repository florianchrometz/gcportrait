// SPDX-License-Identifier: MIT
/**
 * scripts/release-image.mjs: the image name, version, tags, labels and annotations of release.yml's publish-image
 * job (AGENTS.md, Releases), on synthetic tags and Dockerfiles, on the repository's own infra/Dockerfile, once as a
 * command of its own in a throw-away git repository, and the workflow's wiring of it and of the pinned Syft.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dockerfileLabels, githubOutput, imageMeta, newestRelease } from './release-image.mjs';
import { brandingConstant } from './testing/branding.js';
import { REPO, SPAWN_TIMEOUT, createTempTree, runScript, type TempTree } from './testing/temp-tree.js';

const read = (relPath: string): string => readFileSync(path.join(REPO, relPath), 'utf8');

const DOCKERFILE = `FROM scratch
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="gcportrait" \\
      org.opencontainers.image.description="A description, with commas and Google's apostrophe." \\
      org.opencontainers.image.licenses="MIT" \\
      org.opencontainers.image.version="\${APP_VERSION}"
`;

const SHA = '0123456789abcdef0123456789abcdef01234567';
const CREATED = '2026-10-18T00:00:00.000Z';
const TAGS = ['v0.9.0', 'v1.0.0', 'v1.0.1', 'v1.1.0-rc.1', 'v1.10.0', 'v1.9.3', 'vnext'];

const meta = (event: string, tag: string, releaseTags: readonly string[] = TAGS) =>
  imageMeta({
    event,
    tag,
    sha: SHA,
    repository: 'Example-Owner/gcportrait',
    serverUrl: 'https://github.com',
    created: CREATED,
    releaseTags,
    dockerfile: DOCKERFILE,
  });

describe('newestRelease', () => {
  it('is the highest vX.Y.Z by version numbers, never a pre-release or another tag', () => {
    expect(newestRelease(TAGS)).toBe('v1.10.0');
    expect(newestRelease(['v2.0.0-rc.1', 'v1.2.3'])).toBe('v1.2.3');
    expect(newestRelease(['v1.0.0-rc.1', 'vnext'])).toBeUndefined();
    expect(newestRelease([])).toBeUndefined();
  });
});

describe('dockerfileLabels', () => {
  it('reads the double-quoted values of a LABEL across its continuation lines', () => {
    const labels = dockerfileLabels(DOCKERFILE);
    expect(labels.get('org.opencontainers.image.title')).toBe('gcportrait');
    expect(labels.get('org.opencontainers.image.description')).toBe(
      "A description, with commas and Google's apostrophe.",
    );
    expect(labels.get('org.opencontainers.image.licenses')).toBe('MIT');
  });
});

describe('imageMeta', () => {
  it('names the image under the lowercase owner', () => {
    expect(meta('push', 'v1.10.0').image).toBe('ghcr.io/example-owner/gcportrait');
  });

  it('tags the newest release X.Y.Z, X.Y and latest', () => {
    const result = meta('push', 'v1.10.0');
    expect(result.appVersion).toBe('v1.10.0');
    expect(result.latest).toBe(true);
    expect(result.tags).toEqual([
      'ghcr.io/example-owner/gcportrait:1.10.0',
      'ghcr.io/example-owner/gcportrait:1.10',
      'ghcr.io/example-owner/gcportrait:latest',
    ]);
  });

  it('leaves latest alone for a patch of an older line tagged after a newer release', () => {
    const result = meta('push', 'v1.0.1');
    expect(result.latest).toBe(false);
    expect(result.tags).toEqual([
      'ghcr.io/example-owner/gcportrait:1.0.1',
      'ghcr.io/example-owner/gcportrait:1.0',
    ]);
  });

  it('tags a pre-release with its own version only, even when no release is newer', () => {
    const result = meta('push', 'v2.0.0-rc.1', ['v1.0.0', 'v2.0.0-rc.1']);
    expect(result.latest).toBe(false);
    expect(result.appVersion).toBe('v2.0.0-rc.1');
    expect(result.tags).toEqual(['ghcr.io/example-owner/gcportrait:2.0.0-rc.1']);
    expect(result.labels).toContain('org.opencontainers.image.version=2.0.0-rc.1');
  });

  it('publishes dev only when run by hand, reporting dev-SHA', () => {
    const result = meta('workflow_dispatch', 'main');
    expect(result.appVersion).toBe('dev-0123456');
    expect(result.latest).toBe(false);
    expect(result.tags).toEqual(['ghcr.io/example-owner/gcportrait:dev']);
    expect(result.labels).toContain('org.opencontainers.image.version=dev');
  });

  it('refuses a pushed tag that is no release tag, and an unknown event', () => {
    expect(() => meta('push', 'vnext')).toThrow('vnext is not a release tag');
    expect(() => meta('push', 'v1.2')).toThrow('is not a release tag');
    expect(() => meta('schedule', 'v1.0.0')).toThrow('push or workflow_dispatch');
  });

  it('labels what the Dockerfile does not: created, revision, source, url, the version as tagged', () => {
    expect(meta('push', 'v1.10.0').labels).toEqual([
      `org.opencontainers.image.created=${CREATED}`,
      `org.opencontainers.image.revision=${SHA}`,
      'org.opencontainers.image.source=https://github.com/Example-Owner/gcportrait',
      'org.opencontainers.image.url=https://github.com/Example-Owner/gcportrait',
      'org.opencontainers.image.version=1.10.0',
    ]);
  });

  it("annotates every manifest and the index with the Dockerfile's title, description and licence and the labels", () => {
    const { annotations, labels } = meta('push', 'v1.10.0');
    for (const level of ['manifest', 'index']) {
      expect(annotations).toEqual(
        expect.arrayContaining([
          `${level}:org.opencontainers.image.title=gcportrait`,
          `${level}:org.opencontainers.image.description=A description, with commas and Google's apostrophe.`,
          `${level}:org.opencontainers.image.licenses=MIT`,
          ...labels.map((label) => `${level}:${label}`),
        ]),
      );
    }
    expect(annotations).toHaveLength(16);
  });

  it('refuses a Dockerfile without one of the labels the annotations take', () => {
    expect(() =>
      imageMeta({
        event: 'push',
        tag: 'v1.0.0',
        sha: SHA,
        repository: 'example/gcportrait',
        serverUrl: 'https://github.com',
        created: CREATED,
        releaseTags: [],
        dockerfile: 'FROM scratch\nLABEL org.opencontainers.image.title="gcportrait"\n',
      }),
    ).toThrow('infra/Dockerfile sets no label org.opencontainers.image.description');
  });
});

describe("the repository's infra/Dockerfile", () => {
  const own = imageMeta({
    event: 'push',
    tag: 'v1.0.0',
    sha: SHA,
    repository: 'example/gcportrait',
    serverUrl: 'https://github.com',
    created: CREATED,
    releaseTags: [],
    dockerfile: read('infra/Dockerfile'),
  }).annotations;

  it("gives the index the app's long form and gcportrait's own licence", () => {
    const manifest = JSON.parse(read('package.json')) as { license: string };
    expect(own).toContain(
      `index:org.opencontainers.image.description=${brandingConstant('NON_AFFILIATION_LONG')}`,
    );
    expect(own).toContain(`index:org.opencontainers.image.licenses=${manifest.license}`);
  });
});

describe('githubOutput', () => {
  it('writes single values as name=value and the lists between delimiters', () => {
    expect(githubOutput(meta('workflow_dispatch', 'main')).split('\n').slice(0, 7)).toEqual([
      'image=ghcr.io/example-owner/gcportrait',
      'app_version=dev-0123456',
      'latest=false',
      'tags<<GCPORTRAIT_TAGS_EOF',
      'ghcr.io/example-owner/gcportrait:dev',
      'GCPORTRAIT_TAGS_EOF',
      'labels<<GCPORTRAIT_LABELS_EOF',
    ]);
  });
});

describe('the command', () => {
  let tree: TempTree;
  beforeEach(() => {
    tree = createTempTree('release-image');
    tree.write('infra/Dockerfile', DOCKERFILE);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: tree.root, stdio: 'ignore' });
    git('init', '--quiet');
    git(
      '-c',
      'user.name=Example',
      '-c',
      'user.email=dev@example.com',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'x',
    );
    for (const tag of ['v1.0.0', 'v1.2.0', 'v1.1.5']) git('tag', tag);
  });
  afterEach(() => {
    tree.remove();
  });

  it(
    "reads the repository's tags and Dockerfile and writes $GITHUB_OUTPUT",
    () => {
      const args = ['--event', 'push', '--tag', 'v1.2.0', '--sha', SHA, '--repository', 'example/gcportrait'];
      const result = runScript('release-image.mjs', [...args, '--created', CREATED, '--root', tree.root]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('latest=true\n');
      expect(result.stdout).toContain('\nghcr.io/example/gcportrait:1.2\n');
      const older = runScript('release-image.mjs', [
        ...args.slice(0, 3),
        'v1.1.5',
        ...args.slice(4),
        '--root',
        tree.root,
      ]);
      expect(older.stdout).toContain('latest=false\n');
      const bad = runScript('release-image.mjs', [
        '--event',
        'push',
        '--tag',
        'v1',
        '--sha',
        SHA,
        '--repository',
        'a/b',
        '--root',
        tree.root,
      ]);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('v1 is not a release tag');
      expect(runScript('release-image.mjs', ['--event', 'push']).status).toBe(2);
    },
    SPAWN_TIMEOUT.timeout,
  );
});

describe('release.yml', () => {
  const workflow = read('.github/workflows/release.yml');

  it('takes the image name, tags, labels and annotations from this script, with no metadata or login action', () => {
    expect(workflow).toContain('node scripts/release-image.mjs');
    expect(workflow).toContain('tags: ${{ steps.names.outputs.tags }}');
    expect(workflow).toContain('labels: ${{ steps.names.outputs.labels }}');
    expect(workflow).toContain('annotations: ${{ steps.names.outputs.annotations }}');
    expect(workflow).toContain('docker login ghcr.io --username "$ACTOR" --password-stdin');
    expect(workflow).not.toMatch(/docker\/(login|metadata)-action|anchore\/sbom-action/);
    // The long form has one copy for the image, infra/Dockerfile's.
    expect(workflow).not.toContain('org.opencontainers.image.description=');
  });

  it('runs Syft pinned by version and SHA-256, checked before it runs, for both platforms', () => {
    expect(workflow).toMatch(/SYFT_VERSION: \d+\.\d+\.\d+\n/);
    expect(workflow).toMatch(/SYFT_SHA256: [0-9a-f]{64}\n/);
    expect(workflow).toContain('sha256sum --check --strict');
    for (const arch of ['amd64', 'arm64']) {
      expect(workflow).toContain(`sbom/gcportrait-\${VERSION}-linux-${arch}.spdx.json`);
    }
  });
});
