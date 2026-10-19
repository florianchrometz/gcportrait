// SPDX-License-Identifier: Apache-2.0
/**
 * The stand-ins the infra tests (scripts/infra*.test.ts) run deploy.sh, uninstall.sh and, with a stand-in for
 * GitHub's downloads of its own, install.sh against: `gcloud`, `curl` and `sleep` answer from a rule list and
 * log every call, so nothing reaches Google. The rules the tests share live here too.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach } from 'vitest';

import { REPO, createTempTree, type TempTree } from './temp-tree.js';

/** A file of the repository, by its path from the root. */
export const read = (relPath: string): string => readFileSync(path.join(REPO, relPath), 'utf8');

/**
 * One answer of a stand-in: the tool, a shell pattern over its arguments (joined by spaces), how often the
 * rule applies (a number, or '*' for always), the exit code and the output (printf %b escapes). The first rule
 * that matches and is not used up answers; a call no rule matches fails with "stub: no rule", so an
 * unexpected call shows in the test.
 */
export type Rule = readonly [
  tool: 'gcloud' | 'curl',
  pattern: string,
  times: number | '*',
  code: number,
  output: string,
];

/** The stand-in itself: one bash script for every tool, which answers by the name it is called as. */
export const STUB = `#!/usr/bin/env bash
name="\${0##*/}"
args="$*"
printf '%s %s\\n' "$name" "$args" >>"$STUB_DIR/calls"
if [ "$name" = sleep ]; then exit 0; fi
if [ "$name" = curl ] && [ ! -t 0 ]; then cat >>"$STUB_DIR/curl-stdin"; fi
n=0
while IFS='|' read -r tool pattern times code output; do
  n=$((n + 1))
  [ "$tool" = "$name" ] || continue
  case "$args" in $pattern) ;; *) continue ;; esac
  if [ "$times" != '*' ]; then
    used="$(cat "$STUB_DIR/used-$n" 2>/dev/null || echo 0)"
    [ "$used" -lt "$times" ] || continue
    echo $((used + 1)) >"$STUB_DIR/used-$n"
  fi
  printf '%b' "$output"
  exit "$code"
done <"$STUB_DIR/rules"
echo "stub: no rule for $name $args" >&2
exit 1
`;

export const TOKEN = 'stub-access-token';
/** A synthetic project number (below 100000000000; AGENTS.md, Data and graph semantics). */
export const NUMBER = '98765432101';
/** The digest ghcr.io's stand-in reports for every image. */
export const DIGEST = `sha256:${'d'.repeat(64)}`;
/** The anonymous pull token ghcr.io's stand-in hands out. */
export const GHCR_TOKEN = 'anonymous-pull-token';
/** Whether bash runs here: the scripts are bash, so their tests skip where it does not (`describe.skipIf`). */
export const BASH_AVAILABLE = process.platform !== 'win32' && spawnSync('bash', ['-c', 'true']).status === 0;

/** The project's answers before anything of the instance exists (default service name, region). */
export const EMPTY_PROJECT: readonly Rule[] = authenticated(
  ['gcloud', 'billing projects describe *', '*', 0, 'True\\n'],
  ['gcloud', 'projects get-iam-policy *', '*', 0, ''],
  ['gcloud', 'iam service-accounts describe *', '*', 1, 'NOT_FOUND\\n'],
  ['gcloud', 'iam service-accounts create *', '*', 0, ''],
  ['gcloud', 'artifacts repositories describe *', '*', 1, 'NOT_FOUND\\n'],
  ['gcloud', 'artifacts repositories create *', '*', 0, ''],
  ['gcloud', 'artifacts repositories set-cleanup-policies *', '*', 0, ''],
  ['gcloud', 'storage buckets describe *', '*', 1, 'NOT_FOUND\\n'],
  ['curl', '*https://storage.googleapis.com/storage/v1/b?project=example-project', '*', 0, '{}'],
  ['gcloud', 'artifacts repositories add-iam-policy-binding *', '*', 0, ''],
  ['gcloud', 'run services describe *iap-enabled*', '*', 0, ''],
  [
    'gcloud',
    'run services describe *latestCreatedRevisionName*',
    '*',
    0,
    'gcportrait-00001\\tgcportrait-00001\\n',
  ],
  ['gcloud', 'run services describe *status.url*', '*', 0, 'https://gcportrait-abc-ey.a.run.app\\n'],
  ['gcloud', 'run services get-iam-policy *', '*', 0, 'allUsers\\n'],
  // With --write-out, curl prints the body, a line break, then "STATUS CONTENT-TYPE".
  ['curl', '*/api/healthz', '*', 0, '{"status":"ok","version":"test"}\\n200 application/json; charset=utf-8'],
  ['curl', '*/api/config', '*', 0, '{"demo":false}'],
  ['curl', '*.run.app/', '*', 0, '<div id="root"></div>'],
  // GitHub Container Registry, asked anonymously for a released image (common.sh, ghcr_manifest): a token, then
  // the manifest's headers with --head, each followed by the status line that --write-out adds.
  ['curl', '*https://ghcr.io/token?scope=repository:*', '*', 0, `{"token":"${GHCR_TOKEN}"}\\n200`],
  [
    'curl',
    '*--head*https://ghcr.io/v2/*/manifests/*',
    '*',
    0,
    `HTTP/2 200\\r\\ncontent-type: application/vnd.oci.image.index.v1+json\\r\\ndocker-content-digest: ${DIGEST}\\r\\n\\r\\n\\n200`,
  ],
);

export const ALL_APIS =
  'run.googleapis.com\\niam.googleapis.com\\ncloudasset.googleapis.com\\ncloudresourcemanager.googleapis.com\\n' +
  'artifactregistry.googleapis.com\\ncloudbuild.googleapis.com\\nstorage.googleapis.com\\n';

/** The signed-in account, its access token and the project's number, then `rules`: what every run asks first. */
export function authenticated(...rules: readonly Rule[]): readonly Rule[] {
  return [
    ['gcloud', 'auth list*', '*', 0, 'me@example.com\\n'],
    ['gcloud', 'auth print-access-token*', '*', 0, `${TOKEN}\\n`],
    ['gcloud', 'projects describe *', '*', 0, `${NUMBER}\\n`],
    ...rules,
  ];
}

/**
 * What uninstall.sh finds of an instance: its Cloud Run service, labelled `labels`, then the more specific answers of
 * `found`, and nothing else of deploy.sh's (no build repository, bucket or service account).
 */
export function instanceOnly(labels: string, ...found: readonly Rule[]): readonly Rule[] {
  return authenticated(
    ['gcloud', 'run services describe *metadata.labels*', '*', 0, `${labels}\\n`],
    ...found,
    ['gcloud', 'artifacts repositories describe *', '*', 1, 'NOT_FOUND\\n'],
    ['gcloud', 'storage buckets describe *', '*', 1, 'NOT_FOUND\\n'],
    ['gcloud', 'iam service-accounts describe *', '*', 1, 'NOT_FOUND\\n'],
  );
}

/** The calls that would create, enable, grant, change, upload or deploy something. */
export const CHANGES = [
  'gcloud services enable',
  'gcloud iam service-accounts create',
  'gcloud artifacts repositories create',
  'gcloud artifacts repositories update',
  'gcloud artifacts repositories set-cleanup-policies',
  'gcloud artifacts repositories add-iam-policy-binding',
  'gcloud storage buckets add-iam-policy-binding',
  'gcloud storage buckets remove-iam-policy-binding',
  'gcloud builds submit',
  'gcloud run deploy',
  'gcloud run services add-iam-policy-binding',
  'gcloud iap web add-iam-policy-binding',
];

/** The calls of a run that change something (CHANGES, or the bucket's creation through the JSON API). */
export function changesIn(calls: readonly string[]): string[] {
  return calls.filter(
    (call) => CHANGES.some((prefix) => call.startsWith(prefix)) || call.includes('storage/v1/b?project='),
  );
}

/** How many calls start with `prefix`. */
export function count(calls: readonly string[], prefix: string): number {
  return calls.filter((call) => call.startsWith(prefix)).length;
}

/** What one run of a script did: its exit status, its output (stdout, then stderr), the calls it made and what curl read. */
export type Run = {
  readonly status: number | null;
  readonly out: string;
  readonly calls: string[];
  readonly stdin: string;
};

/**
 * Sets up the stand-ins for each test of the calling describe (a fresh temp tree with `bin/gcloud`, `bin/curl` and
 * `bin/sleep`), and answers `run`, which runs one of infra/'s scripts with bash against them, and `tree`, the current
 * test's tree.
 */
export function useStandIns(): {
  run: (
    script: 'deploy.sh' | 'uninstall.sh',
    args: readonly string[],
    rules: readonly Rule[],
    locale?: string,
    env?: Readonly<Record<string, string>>,
  ) => Run;
  tree: () => TempTree;
} {
  let current: TempTree | undefined;
  let runs = 0;

  beforeEach(() => {
    current = createTempTree('infra');
    for (const tool of ['gcloud', 'curl', 'sleep']) {
      current.write(`bin/${tool}`, STUB);
      chmodSync(path.join(current.root, 'bin', tool), 0o755);
    }
  });

  afterEach(() => {
    current?.remove();
    current = undefined;
  });

  const tree = (): TempTree => {
    if (current === undefined) throw new Error('the stand-ins exist only inside a test');
    return current;
  };

  function run(
    script: 'deploy.sh' | 'uninstall.sh',
    args: readonly string[],
    rules: readonly Rule[],
    locale = 'C',
    env: Readonly<Record<string, string>> = {},
  ): Run {
    const root = tree();
    // Each run gets its own rules, call log and rule counters.
    runs += 1;
    const state = `run-${String(runs)}`;
    root.write(`${state}/rules`, `${rules.map((rule) => rule.join('|')).join('\n')}\n`);
    root.write(`${state}/calls`, '');
    const result = spawnSync('bash', [path.join(REPO, 'infra', script), ...args], {
      encoding: 'utf8',
      input: '',
      env: {
        PATH: `${path.join(root.root, 'bin')}:/usr/bin:/bin`,
        STUB_DIR: path.join(root.root, state),
        LC_ALL: locale,
        ...env,
      },
    });
    const calls = root.read(`${state}/calls`).split('\n').filter(Boolean);
    const stdin = existsSync(path.join(root.root, state, 'curl-stdin'))
      ? root.read(`${state}/curl-stdin`)
      : '';
    return { status: result.status, out: `${result.stdout}${result.stderr}`, calls, stdin };
  }

  return { run, tree };
}
