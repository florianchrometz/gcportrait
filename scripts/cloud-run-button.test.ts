// SPDX-License-Identifier: MIT
/**
 * The "Run on Google Cloud" and "Open in Cloud Shell" buttons: app.json against the Cloud Run Button's
 * file format, and the two buttons where the docs show them. The button itself runs only in Cloud Shell; its
 * postcreate hook (infra/cloud-run-button.sh) runs against stand-ins in scripts/infra.test.ts.
 */
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SCRIPTS_DIR } from './testing/temp-tree.js';

const REPO = path.resolve(SCRIPTS_DIR, '..');
const read = (relPath: string): string => readFileSync(path.join(REPO, relPath), 'utf8');

/**
 * The fields the Cloud Run Button accepts in app.json, by their JSON type. The button decodes the file with
 * Go's DisallowUnknownFields, so any other field makes it fail (cmd/cloudshell_open/appfile.go of
 * GoogleCloudPlatform/cloud-run-button); `description`, `keywords`, `logo`, `repository`, `website`, `stack`
 * and `formation` are accepted and ignored, for Heroku's app.json.
 */
const TOP_LEVEL: Readonly<Record<string, string>> = {
  name: 'string',
  env: 'object',
  options: 'object',
  build: 'object',
  hooks: 'object',
  description: 'string',
  keywords: 'array',
  logo: 'string',
  repository: 'string',
  website: 'string',
  stack: 'string',
  formation: 'any',
};
const ENV_FIELDS: Readonly<Record<string, string>> = {
  description: 'string',
  value: 'string',
  required: 'boolean',
  generator: 'string',
  order: 'integer',
};
const OPTIONS: Readonly<Record<string, string>> = {
  'allow-unauthenticated': 'boolean',
  memory: 'string',
  cpu: 'string',
  port: 'integer',
  http2: 'boolean',
  concurrency: 'integer',
  'max-instances': 'integer',
};
const HOOKS = ['prebuild', 'postbuild', 'precreate', 'postcreate'];

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/** The problems of `value` against `fields`, each as "PATH: problem". */
function checkFields(value: unknown, fields: Readonly<Record<string, string>>, where: string): string[] {
  if (typeOf(value) !== 'object') return [`${where}: must be an object`];
  const problems: string[] = [];
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    const expected = fields[key];
    if (expected === undefined) problems.push(`${where}.${key}: unknown field`);
    else if (expected !== 'any' && typeOf(field) !== expected)
      problems.push(`${where}.${key}: must be ${expected}`);
  }
  return problems;
}

/** Every problem the Cloud Run Button's parser would report for an app.json, empty when it accepts it. */
function appJsonProblems(app: unknown): string[] {
  const problems = checkFields(app, TOP_LEVEL, 'app.json');
  if (problems.length > 0) return problems;
  const file = app as Record<string, unknown>;
  for (const [name, entry] of Object.entries((file.env ?? {}) as Record<string, unknown>)) {
    problems.push(...checkFields(entry, ENV_FIELDS, `env.${name}`));
    const env = entry as Record<string, unknown>;
    if (env.generator === 'secret' && env.value !== undefined && env.value !== '') {
      problems.push(`env.${name}: a value and the secret generator exclude each other`);
    }
  }
  if (file.options !== undefined) problems.push(...checkFields(file.options, OPTIONS, 'options'));
  if (file.build !== undefined) {
    problems.push(...checkFields(file.build, { skip: 'boolean', buildpacks: 'object' }, 'build'));
    const buildpacks = (file.build as Record<string, unknown>).buildpacks;
    if (buildpacks !== undefined)
      problems.push(...checkFields(buildpacks, { builder: 'string' }, 'build.buildpacks'));
  }
  if (file.hooks !== undefined) {
    problems.push(...checkFields(file.hooks, Object.fromEntries(HOOKS.map((h) => [h, 'object'])), 'hooks'));
    for (const [hook, entry] of Object.entries(file.hooks as Record<string, unknown>)) {
      problems.push(...checkFields(entry, { commands: 'array' }, `hooks.${hook}`));
      const commands = (entry as Record<string, unknown>).commands;
      if (Array.isArray(commands) && !commands.every((c) => typeof c === 'string')) {
        problems.push(`hooks.${hook}.commands: must hold strings`);
      }
    }
  }
  return problems;
}

/** The repository the buttons clone: the default SOURCE_URL of the backend (backend/src/config.ts). */
function repository(): string {
  return /export const DEFAULT_SOURCE_URL = '([^']+)';/.exec(read('backend/src/config.ts'))?.[1] ?? '';
}

const app = JSON.parse(read('app.json')) as {
  name: string;
  env: Record<string, { description: string; value: string; order: number }>;
  options: Record<string, unknown>;
  build: { skip: boolean };
  hooks: Record<string, { commands: string[] }>;
};

describe('app.json (the Cloud Run Button)', () => {
  it('uses only the fields and types the button accepts', () => {
    expect(appJsonProblems(app)).toEqual([]);
    // The check itself refuses what the button refuses.
    expect(appJsonProblems({ ...app, region: 'europe-west3' })).toEqual(['app.json.region: unknown field']);
    expect(appJsonProblems({ ...app, options: { ...app.options, port: '8080' } })).toEqual([
      'options.port: must be integer',
    ]);
    expect(appJsonProblems({ env: { A: { generator: 'secret', value: 'x' } } })).toEqual([
      'env.A: a value and the secret generator exclude each other',
    ]);
  });

  it('asks for OAUTH_CLIENT_ID and SA_MODE_ENABLED with defaults the backend accepts, and sizes the service as deploy.sh does', () => {
    expect(app.name).toBe('gcportrait');
    expect(Object.keys(app.env).sort()).toEqual(['OAUTH_CLIENT_ID', 'SA_MODE_ENABLED']);
    // The button refuses an empty answer, so "none" stands for "no client yet"; the postcreate hook removes it.
    expect(app.env.OAUTH_CLIENT_ID?.value).toBe('none');
    expect(read('infra/cloud-run-button.sh')).toContain('[ "$CLIENT_ID" = none ]');
    expect(app.env.SA_MODE_ENABLED?.value).toBe('false');
    // Descriptions fit on the prompt's line.
    for (const env of Object.values(app.env)) expect(env.description.length).toBeLessThanOrEqual(80);
    expect(app.options).toEqual({
      'allow-unauthenticated': true,
      memory: '2Gi',
      cpu: '1',
      port: 8080,
      concurrency: 80,
      'max-instances': 10,
    });
    const deploy = read('infra/deploy.sh');
    expect(deploy).toContain('--port=8080 --cpu=1 --memory="$MEMORY" --concurrency=80');
    expect(deploy).toContain('MEMORY=2Gi');
    expect(deploy).toMatch(/^MAX_INSTANCES=10$/m);
    // The button writes max-instances under a misspelt annotation key (autoscaling.knative.dev + maxScale, no
    // slash), which Cloud Run does not apply, so the postcreate hook sets the same limit (10, as above) itself.
    expect(read('infra/cloud-run-button.sh')).toContain(' --max-instances=10\n');
  });

  it('builds infra/Dockerfile from the repository root, as Cloud Build does for deploy.sh --build', () => {
    expect(app.build).toEqual({ skip: true });
    const [prebuild, ...more] = app.hooks.prebuild?.commands ?? [];
    expect(more).toEqual([]);
    expect(prebuild).toMatch(
      /^docker build --file infra\/Dockerfile --build-arg APP_VERSION="[^"]+" --tag "\$IMAGE_URL" \.$/,
    );
    const cloudbuild = read('infra/cloudbuild.yaml');
    expect(cloudbuild).toContain('- --file=infra/Dockerfile');
    expect(cloudbuild).toContain('- --build-arg=APP_VERSION=${_APP_VERSION}');
    expect(Object.keys(app.hooks).sort()).toEqual(['postcreate', 'prebuild']);
    expect(app.hooks.postcreate?.commands).toEqual(['infra/cloud-run-button.sh']);
    accessSync(path.join(REPO, 'infra/cloud-run-button.sh'), constants.X_OK);
  });
});

describe('the buttons in README.md, docs/self-host.md and docs/self-host-options.md', () => {
  const repo = `${repository()}.git`;
  const openInCloudShell =
    '[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)]' +
    `(https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=${repo}&cloudshell_git_branch=main` +
    '&cloudshell_workspace=.&cloudshell_tutorial=docs/cloudshell-tutorial.md&show=ide%2Cterminal)';
  const runOnGoogleCloud =
    '[![Run on Google Cloud](https://deploy.cloud.run/button.svg)]' +
    `(https://deploy.cloud.run/?git_repo=${repo}&revision=main)`;
  const CLOUD_SHELL = [openInCloudShell, /^\*\*Guided/] as const;
  const CLOUD_RUN = [runOnGoogleCloud, /^\*\*Built from source/] as const;

  it('clone the project repository and open the tutorial that exists', () => {
    expect(repo).toBe('https://github.com/florianchrometz/gcportrait.git');
    expect(existsSync(path.join(REPO, 'docs/cloudshell-tutorial.md'))).toBe(true);
  });

  // README.md offers both below the installer line; the self-hosting guide's quick start offers the guided tutorial
  // (no terminal needed) below its installer line, and its options page the Cloud Run Button under "Building from
  // source".
  const INSTALLER = 'curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project YOUR_PROJECT';
  for (const [doc, after, buttons] of [
    ['README.md', INSTALLER, [CLOUD_SHELL, CLOUD_RUN]],
    ['docs/self-host.md', INSTALLER, [CLOUD_SHELL]],
    ['docs/self-host-options.md', '## Building from source', [CLOUD_RUN]],
  ] as const) {
    it(`${doc} shows ${buttons.length === 2 ? 'both' : 'its button'} below "${after}", each on a line of its own next to its explanation`, () => {
      const lines = read(doc).split('\n');
      const anchor = lines.findIndex((line) => line.startsWith(after));
      expect(anchor, `${doc} lacks "${after}"`).toBeGreaterThan(-1);
      for (const [button, explanation] of buttons) {
        const at = lines.indexOf(button);
        expect(at, `${doc} lacks ${button}`).toBeGreaterThan(anchor);
        expect(lines[at + 1]).toMatch(explanation);
      }
    });
  }

  it('docs/self-host.md leaves the Cloud Run Button to the options page', () => {
    expect(read('docs/self-host.md').split('\n')).not.toContain(runOnGoogleCloud);
  });

  it('the landing page shows both below its installer line, the Cloud Run Button last', () => {
    const page = read('website/src/pages/index.astro');
    const installer = page.indexOf('<Fragment set:html={deployBlock.html} />');
    const cloudShell = page.indexOf('href={CLOUD_SHELL_URL}');
    const cloudRun = page.indexOf('href={CLOUD_RUN_BUTTON_URL}');
    expect(installer).toBeGreaterThan(-1);
    expect(cloudShell).toBeGreaterThan(installer);
    expect(cloudRun).toBeGreaterThan(cloudShell);
    expect(page.split('href={CLOUD_RUN_BUTTON_URL}')).toHaveLength(2);
  });
});
