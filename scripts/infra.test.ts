// SPDX-License-Identifier: MIT
/**
 * infra/: what the image says about itself, what deploy.sh uploads, and how deploy.sh behaves, run with bash
 * against stand-ins for `gcloud`, `curl` and `sleep` that answer from a rule list and log every call
 * (scripts/testing/infra-stub.ts): the checks before any change, a build and a deploy, the marks it keeps on what it
 * creates, IAP, the readiness wait, the next steps it ends with and the banner; and every command of the Cloud Shell
 * tutorial and the Cloud Run Button's hook. Nothing here reaches Google. Beside this file, so that Vitest runs them
 * in parallel: uninstall.sh (infra-uninstall.test.ts), demo-only instances, domains and legal pages
 * (infra-demo-only.test.ts), released images from ghcr.io (infra-ghcr.test.ts) and the installer with the release's
 * deploy scripts (infra-install.test.ts); `pnpm test:infra` runs all five. The non-affiliation wording in the labels,
 * --help and the tutorial: non-affiliation-copies.test.ts.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { brandingConstant } from './testing/branding.js';
import {
  ALL_APIS,
  BASH_AVAILABLE,
  EMPTY_PROJECT,
  NUMBER,
  TOKEN,
  changesIn,
  count,
  read,
  useStandIns,
  type Rule,
} from './testing/infra-stub.js';
import { REPO } from './testing/temp-tree.js';

describe('the image labels', () => {
  it("name gcportrait's own licence", () => {
    const manifest = JSON.parse(read('package.json')) as { license: string };
    expect(/org\.opencontainers\.image\.licenses="([^"]+)"/.exec(read('infra/Dockerfile'))?.[1]).toBe(
      manifest.license,
    );
    expect(
      /org\.opencontainers\.image\.licenses=(\S+)$/m.exec(read('.github/workflows/release.yml'))?.[1],
    ).toBe(manifest.license);
  });
});

describe('what deploy.sh --build uploads', () => {
  it('leaves out every credential pattern that .dockerignore keeps out of the image', () => {
    const lines = read('.dockerignore').split('\n');
    const start = lines.findIndex((line) => line.startsWith('# Local environment and credentials'));
    const end = lines.findIndex((line, index) => index > start && line.trim() === '');
    const patterns = lines.slice(start + 1, end).map((line) => line.replace(/^\*\*\//, ''));
    expect(patterns).toEqual(expect.arrayContaining(['.env', '*.pem', '*-key.json']));
    const deploy = read('infra/deploy.sh');
    for (const pattern of patterns) expect(deploy).toContain(`'${pattern}'`);
  });
});

/** The non-affiliation statement's long form, which closes every --help (and nothing else of a run). */
const LONG_FORM = brandingConstant('NON_AFFILIATION_LONG');

// Each test runs the scripts end to end, a few hundred stand-in processes for the longest ones: a few seconds on
// an idle machine, much more on a loaded one, hence the generous limit.
describe.skipIf(!BASH_AVAILABLE)('deploy.sh (bash, against stand-ins)', { timeout: 60_000 }, () => {
  const { run } = useStandIns();

  describe('--hosted-by follows the backend rules (backend/src/config.ts) in any locale', () => {
    const refused: readonly [string, string][] = [
      ['   ', 'must not be blank'],
      ['Google Cloud fans', 'must not name Google'],
      ['gOOgLe', 'must not name Google'],
      ['Example‮Ltd', 'must be plain text on one line'],
      ['Soft­hyphen', 'must be plain text on one line'],
      ['Zero​width', 'must be plain text on one line'],
      ['Tag\u{E0041}', 'must be plain text on one line'],
      ['Two\nlines', 'must be plain text on one line'],
      ['Bell\u0007', 'must be plain text on one line'],
      ['C1\u0085control', 'must be plain text on one line'],
      ['a <b> tag', 'must be plain text on one line'],
      ['M'.repeat(81), 'must be at most 80 characters'],
      ['\u{1F600}'.repeat(41), 'must be at most 80 characters'],
    ];
    const accepted = [
      'Example Ltd IT',
      '  Example Ltd  ',
      'Müller & Söhne',
      'Narrow space',
      'M'.repeat(80),
      'ü'.repeat(80),
      '\u{1F600}'.repeat(40),
    ];

    for (const locale of ['C', 'en_US.UTF-8']) {
      it(`refuses what the backend refuses, before any gcloud call (LC_ALL=${locale})`, () => {
        for (const [value, message] of refused) {
          const result = run('deploy.sh', ['--project', 'example-project', '--hosted-by', value], [], locale);
          expect(result.status, JSON.stringify(value)).toBe(1);
          expect(result.out).toContain(`--hosted-by ${message}`);
          expect(result.calls).toEqual([]);
        }
      });

      it(`accepts what the backend accepts (LC_ALL=${locale})`, () => {
        for (const value of accepted) {
          // No rules: the first gcloud call fails, which shows the value passed the checks.
          const result = run('deploy.sh', ['--project', 'example-project', '--hosted-by', value], [], locale);
          expect(result.out, JSON.stringify(value)).toContain('gcloud has no active account');
        }
      });
    }
  });

  it('--build on an empty project: records the APIs it enables, retries only the refusals of new accounts', () => {
    const result = run(
      'deploy.sh',
      ['--project', 'example-project', '--build', '--verbose'],
      [
        ['gcloud', 'services list --enabled*', '*', 0, ALL_APIS.replace('cloudbuild.googleapis.com\\n', '')],
        ['gcloud', 'services enable cloudbuild.googleapis.com --project=example-project', 1, 0, ''],
        [
          'gcloud',
          'storage buckets add-iam-policy-binding *',
          1,
          1,
          'ERROR: (gcloud.storage.buckets.add-iam-policy-binding) HTTPError 400: Service account x does not exist.\\n',
        ],
        ['gcloud', 'storage buckets add-iam-policy-binding *', '*', 0, ''],
        [
          'gcloud',
          'builds submit *',
          1,
          1,
          'ERROR: (gcloud.builds.submit) FAILED_PRECONDITION: invalid bucket "b"; service account s does not have access to the bucket\\n',
        ],
        ['gcloud', 'builds submit *', '*', 0, 'DONE\\n'],
        ['gcloud', 'run deploy *', '*', 0, 'Done.\\n'],
        ...EMPTY_PROJECT,
      ],
    );
    expect(result.status, result.out).toBe(0);
    const { calls } = result;
    const repoCreate = calls.find((call) => call.startsWith('gcloud artifacts repositories create'));
    expect(repoCreate).toContain('--labels=managed-by=gcportrait-deploy,gcportrait-api-cloudbuild=enabled');
    // The bucket comes with its label in the same request.
    const bucket = calls.find((call) => call.includes('storage/v1/b?project='));
    expect(bucket).toContain('"labels":{"managed-by":"gcportrait-deploy"}');
    expect(bucket).toContain('"publicAccessPrevention":"enforced"');
    // Storage Admin on the bucket (Cloud Build reads the bucket itself), tried again once the account exists.
    expect(count(calls, 'gcloud storage buckets add-iam-policy-binding')).toBe(2);
    expect(calls.find((call) => call.includes('storage buckets add-iam-policy-binding'))).toContain(
      '--role=roles/storage.admin',
    );
    expect(count(calls, 'gcloud builds submit')).toBe(2);
    expect(calls.filter((call) => call.startsWith('sleep '))).toEqual(['sleep 15', 'sleep 30']);
    const deploy = calls.find((call) => call.startsWith('gcloud run deploy')) ?? '';
    expect(deploy).toContain(
      '--update-labels=managed-by=gcportrait-deploy,gcportrait-api-cloudbuild=enabled',
    );
    expect(deploy).toContain('--memory=2Gi --concurrency=80 --min-instances=0');
    expect(deploy).toContain('httpGet.path=/healthz');
    // The readiness wait goes to /api/healthz: Cloud Run's front end answers /healthz itself.
    const address = `https://gcportrait-${NUMBER}.europe-west3.run.app`;
    expect(calls).toContain(
      `curl --silent --max-time 10 --write-out \\n%{http_code} %{content_type} ${address}/api/healthz`,
    );
    expect(count(calls, 'curl --silent --max-time 10 --write-out')).toBe(1);
    expect(calls).toContain(`curl --silent --fail --max-time 10 ${address}/`);
    expect(calls.some((call) => call.startsWith('curl') && call.endsWith('.run.app/healthz'))).toBe(false);
    expect(result.out).toContain('revision gcportrait-00001 is ready: its startup probe GET /healthz passed');
    expect(result.out).toContain('GET /api/healthz: {"status":"ok","version":"test"}');
    expect(result.out).toContain('GET /api/config: {"demo":false}');
    // The access token reaches curl on its standard input only, never on a command line or in the output.
    expect(result.stdin).toContain(`Authorization: Bearer ${TOKEN}`);
    expect(calls.join('\n')).not.toContain(TOKEN);
    expect(result.out).not.toContain(TOKEN);
  });

  it('never repeats a build that ran and failed', () => {
    const result = run(
      'deploy.sh',
      ['--project', 'example-project', '--build'],
      [
        ['gcloud', 'services list --enabled*', '*', 0, ALL_APIS],
        ['gcloud', 'storage buckets add-iam-policy-binding *', '*', 0, ''],
        [
          'gcloud',
          'builds submit *',
          '*',
          1,
          'ERROR: (gcloud.builds.submit) build 1 completed with status "FAILURE"\\n',
        ],
        ...EMPTY_PROJECT,
      ],
    );
    expect(result.status).toBe(1);
    expect(count(result.calls, 'gcloud builds submit')).toBe(1);
    expect(count(result.calls, 'gcloud run deploy')).toBe(0);
    expect(result.out).toContain(
      'the build failed; its log is above and in gs://example-project-gcportrait-builds/logs/',
    );
  });

  it('repeats a deploy only while the new account is unknown, never a revision that does not start', () => {
    const image = ['--image', 'registry.example.com/team/gcportrait:1.0.0'];
    const unknownAccount = run(
      'deploy.sh',
      ['--project', 'example-project', ...image],
      [
        ['gcloud', 'services list --enabled*', '*', 0, ALL_APIS],
        ['gcloud', 'run deploy *', 1, 1, 'ERROR: (gcloud.run.deploy) Service account s does not exist.\\n'],
        ['gcloud', 'run deploy *', '*', 0, 'Done.\\n'],
        ...EMPTY_PROJECT,
      ],
    );
    expect(unknownAccount.status, unknownAccount.out).toBe(0);
    expect(count(unknownAccount.calls, 'gcloud run deploy')).toBe(2);

    const notReady = run(
      'deploy.sh',
      ['--project', 'example-project', ...image],
      [
        ['gcloud', 'services list --enabled*', '*', 0, ALL_APIS],
        [
          'gcloud',
          'run deploy *',
          '*',
          1,
          "ERROR: (gcloud.run.deploy) Revision 'gcportrait-00001' is not ready and cannot serve traffic. The user-provided container failed the configured startup probe checks.\\n",
        ],
        ...EMPTY_PROJECT,
      ],
    );
    expect(notReady.status).toBe(1);
    expect(count(notReady.calls, 'gcloud run deploy')).toBe(1);
    expect(notReady.out).toContain('deploy.sh stopped during "Deploying the Cloud Run service"');
  });

  it('names the APIs it enabled when it stops before anything records them', () => {
    const result = run(
      'deploy.sh',
      ['--project', 'example-project'],
      [
        ['gcloud', 'services list --enabled*', '*', 0, 'cloudasset.googleapis.com\\n'],
        ['gcloud', 'services enable *', '*', 0, ''],
        [
          'gcloud',
          'iam service-accounts create *',
          '*',
          1,
          'ERROR: (gcloud.iam.service-accounts.create) PERMISSION_DENIED\\n',
        ],
        ...EMPTY_PROJECT,
      ],
    );
    expect(result.status).toBe(1);
    expect(result.out).toContain(
      'deploy.sh stopped during "Creating the backend\'s service account (no roles)"',
    );
    expect(result.out).toContain(
      'gcloud services disable run.googleapis.com iam.googleapis.com cloudresourcemanager.googleapis.com artifactregistry.googleapis.com --project=example-project',
    );
    // Exactly one error report: failing queries inside $(...) do not set off the trap.
    expect(result.out.match(/deploy\.sh stopped/g)).toHaveLength(1);

    // The same after a refusal of the script's own (die), here a repository named like the remote repository of
    // released images that cannot serve them, found after the APIs were enabled.
    const noRemote = run(
      'deploy.sh',
      ['--project', 'example-project', '--image', 'v9.9.9'],
      [
        ['gcloud', 'services list --enabled*', '*', 0, 'cloudasset.googleapis.com\\n'],
        ['gcloud', 'services enable *', '*', 0, ''],
        ['gcloud', 'artifacts repositories describe ghcr *', '*', 0, 'STANDARD_REPOSITORY|DOCKER|||\\n'],
        ...EMPTY_PROJECT,
      ],
    );
    expect(noRemote.status).toBe(1);
    expect(noRemote.out).toContain(
      'the Artifact Registry repository ghcr in europe-west3 is not a remote repository of https://ghcr.io',
    );
    expect(noRemote.out).toContain('gcloud services disable run.googleapis.com iam.googleapis.com');
    expect(count(noRemote.calls, 'gcloud run deploy')).toBe(0);
  });

  it("--build uses an existing bucket only when it is the project's own and carries the label", () => {
    const buildRules = (bucketAnswer: string): readonly Rule[] => [
      ['gcloud', 'services list --enabled*', '*', 0, ALL_APIS],
      ['gcloud', 'storage buckets describe *', '*', 0, bucketAnswer],
      ['gcloud', 'storage buckets add-iam-policy-binding *', '*', 0, ''],
      ['gcloud', 'builds submit *', '*', 0, 'DONE\\n'],
      ['gcloud', 'run deploy *', '*', 0, 'Done.\\n'],
      ...EMPTY_PROJECT,
    ];
    const elsewhere = run(
      'deploy.sh',
      ['--project', 'example-project', '--build'],
      buildRules('12345678901\\tmanaged-by=gcportrait-deploy\\n'),
    );
    expect(elsewhere.status).toBe(1);
    expect(elsewhere.out).toContain(
      'the bucket gs://example-project-gcportrait-builds exists but belongs to another project',
    );
    const unlabelled = run(
      'deploy.sh',
      ['--project', 'example-project', '--build'],
      buildRules(`${NUMBER}\\tteam=data\\n`),
    );
    expect(unlabelled.status).toBe(1);
    expect(unlabelled.out).toContain('without the managed-by=gcportrait-deploy label');
    for (const refused of [elsewhere, unlabelled]) {
      expect(count(refused.calls, 'gcloud storage buckets add-iam-policy-binding')).toBe(0);
      expect(count(refused.calls, 'gcloud builds submit')).toBe(0);
    }

    const own = run(
      'deploy.sh',
      ['--project', 'example-project', '--build', '--build-machine', 'e2-standard-2', '--sa-mode'],
      buildRules(`${NUMBER}\\tgcportrait-api-iap=enabled;managed-by=gcportrait-deploy\\n`),
    );
    expect(own.status, own.out).toBe(0);
    expect(own.out).toContain('bucket exists: gs://example-project-gcportrait-builds');
    expect(count(own.calls, 'gcloud builds submit')).toBe(1);
    // The closing hints: the redeploy reuses the image just built; service-account mode is already on.
    const image = /--image=(\S+)/.exec(own.calls.find((c) => c.startsWith('gcloud run deploy')) ?? '')?.[1];
    expect(image).toMatch(
      /^europe-west3-docker\.pkg\.dev\/example-project\/gcportrait-builds\/gcportrait:\d{8}-\d{6}-/,
    );
    expect(own.out).toContain(
      `Redeploy with the same settings: infra/deploy.sh --project example-project --image ${String(image)} --sa-mode`,
    );
    expect(own.out).toContain('It is on. A team grants the account read access');
  });

  describe('the banner and the non-affiliation statement (its words: non-affiliation-copies.test.ts)', () => {
    it('opens --help and every run of both scripts with the script’s name; the long form closes --help only', () => {
      for (const script of ['deploy.sh', 'uninstall.sh'] as const) {
        const help = run(script, ['--help'], []);
        expect(help.status).toBe(0);
        expect(help.out.split('\n')[0]).toBe(`gcportrait infra/${script}`);
        // The long form, wrapped, after the options (ADR 0018: footers and long-form texts).
        expect(help.out.trimEnd().split('\n\n').at(-1)?.replace(/\s+/g, ' ')).toBe(LONG_FORM);
        expect(help.calls).toEqual([]);
        // A run: the first line, before anything is asked of Google; no affiliation line in the run's output.
        const started = run(script, ['--project', 'example-project'], []);
        expect(started.out.trimStart().split('\n')[0]).toBe(`gcportrait infra/${script}`);
        expect(started.out).not.toMatch(/affiliated/i);
      }
    });
  });

  it('--oauth-client-id: the example in the refusal is a synthetic number (agents.md rule 6)', () => {
    const result = run('deploy.sh', ['--project', 'example-project', '--oauth-client-id', 'bad id'], []);
    expect(result.status).toBe(1);
    expect(result.out).toContain('must look like 12345678901-abc.apps.googleusercontent.com');
    expect(result.out).not.toMatch(/\d{12}/);
  });

  describe('never uses or changes what deploy.sh did not create', () => {
    const buildRules = (extra: readonly Rule[]): readonly Rule[] => [
      ...extra,
      ['gcloud', 'services list --enabled*', '*', 0, ALL_APIS],
      ['gcloud', 'storage buckets add-iam-policy-binding *', '*', 0, ''],
      ['gcloud', 'builds submit *', '*', 0, 'DONE\\n'],
      ['gcloud', 'run deploy *', '*', 0, 'Done.\\n'],
      ...EMPTY_PROJECT,
    ];

    const cases: readonly (readonly [string, readonly Rule[], string, string])[] = [
      [
        'a Cloud Run service of that name without the label',
        [
          [
            'gcloud',
            'run services describe gcportrait * --format=value(metadata.labels)',
            '*',
            0,
            'team=web\\n',
          ],
        ],
        'the Cloud Run service gcportrait in europe-west3 has no managed-by=gcportrait-deploy label',
        'gcloud run services update gcportrait --project=example-project --region=europe-west3 --update-labels=managed-by=gcportrait-deploy',
      ],
      [
        'a backend account of that name made by someone else',
        [
          [
            'gcloud',
            'iam service-accounts describe gcportrait-backend@* --format=value(email)',
            '*',
            0,
            'x\\n',
          ],
          [
            'gcloud',
            'iam service-accounts describe gcportrait-backend@* --format=value(description)',
            '*',
            0,
            'Made by hand\\n',
          ],
        ],
        'the service account gcportrait-backend@example-project.iam.gserviceaccount.com was not created by deploy.sh',
        'gcloud iam service-accounts update gcportrait-backend@example-project.iam.gserviceaccount.com --project=example-project --description="Created by gcportrait infra/deploy.sh for the Cloud Run service gcportrait."',
      ],
      [
        'a build account marked for another service whose name starts the same way',
        [
          [
            'gcloud',
            'iam service-accounts describe gcportrait-build@* --format=value(email)',
            '*',
            0,
            'x\\n',
          ],
          [
            'gcloud',
            'iam service-accounts describe gcportrait-build@* --format=value(description)',
            '*',
            0,
            'Created by gcportrait infra/deploy.sh for the Cloud Run service gcportrait-fresh: runs its Cloud Build builds.\\n',
          ],
        ],
        'the service account gcportrait-build@example-project.iam.gserviceaccount.com was not created by deploy.sh',
        '--description="Created by gcportrait infra/deploy.sh for the Cloud Run service gcportrait: runs its Cloud Build builds."',
      ],
      [
        'a build repository of that name without the label',
        [['gcloud', 'artifacts repositories describe *', '*', 0, 'team=data\\n']],
        'the Artifact Registry repository gcportrait-builds in europe-west3 has no managed-by=gcportrait-deploy label',
        'gcloud artifacts repositories update gcportrait-builds --project=example-project --location=europe-west3 --update-labels=managed-by=gcportrait-deploy',
      ],
    ];

    for (const [label, rules, problem, handover] of cases) {
      it(`stops before changing anything for ${label}, naming it and the way out`, () => {
        for (const dryRun of [false, true]) {
          const args = ['--project', 'example-project', '--build', ...(dryRun ? ['--dry-run'] : [])];
          const result = run('deploy.sh', args, buildRules(rules));
          expect(result.status, result.out).toBe(1);
          expect(result.out).toContain(problem);
          expect(result.out).toContain(handover);
          expect(result.out).toContain('Deploy with another --service name');
          expect(result.out).toContain('==> Checking that what exists already was made by deploy.sh');
          expect(changesIn(result.calls)).toEqual([]);
        }
      });
    }

    it('lists every resource that is not its own in one go', () => {
      const result = run(
        'deploy.sh',
        ['--project', 'example-project', '--build'],
        buildRules([
          ['gcloud', 'run services describe gcportrait * --format=value(metadata.labels)', '*', 0, '\\n'],
          ['gcloud', 'artifacts repositories describe *', '*', 0, '\\n'],
          ['gcloud', 'storage buckets describe *', '*', 0, `${NUMBER}\\tteam=data\\n`],
        ]),
      );
      expect(result.status).toBe(1);
      expect(result.out.match(/^ {4}- the /gm)).toHaveLength(3);
      expect(changesIn(result.calls)).toEqual([]);
    });

    it('uses and updates what carries its marks, removing the redundant Object Admin grant of an earlier version', () => {
      const ours: readonly Rule[] = [
        [
          'gcloud',
          'run services describe gcportrait * --format=value(metadata.labels)',
          '*',
          0,
          'cloud.googleapis.com/location=europe-west3;managed-by=gcportrait-deploy\\n',
        ],
        ['gcloud', 'iam service-accounts describe * --format=value(email)', '*', 0, 'x\\n'],
        [
          'gcloud',
          'iam service-accounts describe gcportrait-backend@* --format=value(description)',
          '*',
          0,
          'Created by gcportrait infra/deploy.sh for the Cloud Run service gcportrait.\\n',
        ],
        [
          'gcloud',
          'iam service-accounts describe gcportrait-build@* --format=value(description)',
          '*',
          0,
          'Created by gcportrait infra/deploy.sh for the Cloud Run service gcportrait: runs its Cloud Build builds.\\n',
        ],
        ['gcloud', 'artifacts repositories describe *', '*', 0, 'managed-by=gcportrait-deploy\\n'],
        ['gcloud', 'storage buckets describe *', '*', 0, `${NUMBER}\\tmanaged-by=gcportrait-deploy\\n`],
      ];
      const policy = (withObjectAdmin: boolean): Rule => [
        'gcloud',
        'storage buckets get-iam-policy gs://example-project-gcportrait-builds *',
        '*',
        0,
        'roles/storage.admin\\tserviceAccount:gcportrait-build@example-project.iam.gserviceaccount.com\\n' +
          (withObjectAdmin
            ? 'roles/storage.objectAdmin\\tserviceAccount:gcportrait-build@example-project.iam.gserviceaccount.com\\n'
            : '') +
          'roles/storage.objectAdmin\\tserviceAccount:someone-else@example-project.iam.gserviceaccount.com\\n',
      ];
      for (const withObjectAdmin of [true, false]) {
        const result = run(
          'deploy.sh',
          ['--project', 'example-project', '--build'],
          buildRules([
            ...ours,
            policy(withObjectAdmin),
            ['gcloud', 'storage buckets remove-iam-policy-binding *', '*', 0, ''],
          ]),
        );
        expect(result.status, result.out).toBe(0);
        expect(result.out).toContain('Cloud Run service gcportrait (europe-west3) exists, made by deploy.sh');
        expect(count(result.calls, 'gcloud iam service-accounts create')).toBe(0);
        expect(count(result.calls, 'gcloud artifacts repositories create')).toBe(0);
        expect(count(result.calls, 'gcloud artifacts repositories set-cleanup-policies')).toBe(1);
        expect(result.calls.some((call) => call.includes('storage/v1/b?project='))).toBe(false);
        // Storage Admin on its bucket, and the earlier Object Admin grant of its own account gone; nobody else's.
        expect(result.calls.find((call) => call.includes('buckets add-iam-policy-binding'))).toContain(
          '--role=roles/storage.admin',
        );
        expect(result.calls.filter((call) => call.includes('buckets remove-iam-policy-binding'))).toEqual(
          withObjectAdmin
            ? [
                'gcloud storage buckets remove-iam-policy-binding gs://example-project-gcportrait-builds --member=serviceAccount:gcportrait-build@example-project.iam.gserviceaccount.com --role=roles/storage.objectAdmin --format=none',
              ]
            : [],
        );
        expect(count(result.calls, 'gcloud run deploy')).toBe(1);
      }
    });
  });

  it('--iap --dry-run prints the IAP service-identity request, and sends nothing', () => {
    const result = run(
      'deploy.sh',
      [
        '--project',
        'example-project',
        '--image',
        'registry.example.com/team/gcportrait:1.0.0',
        '--iap',
        '--dry-run',
      ],
      [['gcloud', 'services list --enabled*', '*', 0, `${ALL_APIS}iap.googleapis.com\\n`], ...EMPTY_PROJECT],
    );
    expect(result.status, result.out).toBe(0);
    expect(result.out).toContain(
      '+ POST https://serviceusage.googleapis.com/v1beta1/projects/example-project/services/iap.googleapis.com:generateServiceIdentity',
    );
    expect(result.out).toContain('gcloud run services add-iam-policy-binding gcportrait');
    expect(result.out).toContain('gcloud iap web add-iam-policy-binding');
    expect(result.calls.filter((call) => call.startsWith('curl'))).toEqual([]);
    expect(result.calls.filter((call) => call.startsWith('gcloud run deploy'))).toEqual([]);
  });

  describe('the end of a run: the next steps come first', () => {
    const rules: readonly Rule[] = [
      ['gcloud', 'services list --enabled*', '*', 0, ALL_APIS],
      ['gcloud', 'run deploy *', '*', 0, 'Done.\\n'],
      ...EMPTY_PROJECT,
    ];
    const ADDRESS = `https://gcportrait-${NUMBER}.europe-west3.run.app`;
    /** What a run prints after its last step, from "gcportrait is deployed" or "Dry run finished" on. */
    const ending = (out: string): string => {
      const start = [out.indexOf('gcportrait is deployed'), out.indexOf('Dry run finished')].find(
        (at) => at >= 0,
      );
      return start === undefined ? '' : out.slice(start);
    };
    /** Whether every text is in `text`, in this order. */
    const inOrder = (text: string, parts: readonly string[]): boolean => {
      const at = parts.map((part) => text.indexOf(part));
      return at.every((index, n) => index >= 0 && (n === 0 || index > (at[n - 1] ?? -1)));
    };

    it('with --project alone: open the address, create the OAuth client, redeploy with its id, before anything else', () => {
      const result = run('deploy.sh', ['--project', 'example-project'], rules);
      expect(result.status, result.out).toBe(0);
      const end = ending(result.out);
      expect(end.split('\n').slice(0, 4)).toEqual([
        expect.stringMatching(/^gcportrait is deployed in \dm\d\ds\.$/),
        '',
        'Next steps',
        `    1. Open ${ADDRESS}: "Try the demo" works at once.`,
      ]);
      const step2 = end.indexOf('    2. Create the OAuth client for "Sign in with Google"');
      const step3 = end.indexOf('    3. Redeploy with the client id in place of CLIENT_ID:');
      expect(step2).toBeGreaterThan(0);
      expect(step3).toBeGreaterThan(step2);
      // Step 2: the console link and the exact origins to paste; step 3: the exact command, this run's flags and the id.
      const two = end.slice(step2, step3);
      expect(two).toContain(
        '\n       https://console.cloud.google.com/auth/clients?project=example-project\n',
      );
      expect(two).toContain(`\n         ${ADDRESS}\n`);
      expect(two).toContain(
        '\n         https://gcportrait-abc-ey.a.run.app   (only if people use this address)\n',
      );
      expect(end.slice(step3).split('\n')[1]).toBe(
        '       infra/deploy.sh --project example-project --oauth-client-id CLIENT_ID',
      );
      // Then what the instance is, the optional service-account mode, and the redeploy and removal lines.
      expect(
        inOrder(end, [
          '\nThe instance\n',
          `    Address:          ${ADDRESS}\n`,
          '\nService-account mode (optional',
          '\nLater\n',
          '    Redeploy with the same settings: infra/deploy.sh --project example-project\n',
          '    Remove everything this script created: infra/uninstall.sh --project example-project --region europe-west3 --service gcportrait\n',
        ]),
      ).toBe(true);
      // The answers of the check are for --verbose: the run says what to do next, not what it saw.
      expect(result.out).not.toContain('GET /api/config:');
    });

    it('with a client id: open and sign in, the origins to check, no redeploy step; a dry run names the same steps', () => {
      const client = '12345678901-abc.apps.googleusercontent.com';
      const result = run(
        'deploy.sh',
        ['--project', 'example-project', '--oauth-client-id', client, '--dry-run'],
        rules,
      );
      expect(result.status, result.out).toBe(0);
      const end = ending(result.out);
      expect(end).toMatch(
        /^Dry run finished in \dm\d\ds: nothing was changed\. After the same command without --dry-run:\n\nNext steps\n {4}1\. Open /,
      );
      expect(end).toContain(
        `    1. Open ${ADDRESS} and choose "Sign in with Google" ("Try the demo" works too).\n`,
      );
      expect(end).toContain(
        `    2. Make sure the OAuth client ${client} lists these Authorised JavaScript origins\n`,
      );
      expect(end).toContain(`\n         ${ADDRESS}\n`);
      expect(end).not.toContain('3. Redeploy');
      expect(end).toContain(`    Sign-in:          ${client}\n`);
      expect(end).toContain(
        `    Redeploy with the same settings: infra/deploy.sh --project example-project --oauth-client-id ${client}\n`,
      );
      expect(changesIn(result.calls)).toEqual([]);
    });
  });

  describe('the readiness wait', () => {
    const deployWith = (healthz: readonly Rule[], verbose = true) =>
      run(
        'deploy.sh',
        [
          '--project',
          'example-project',
          '--image',
          'registry.example.com/team/gcportrait:0.9.0',
          ...(verbose ? ['--verbose'] : []),
        ],
        [
          ['gcloud', 'services list --enabled*', '*', 0, ALL_APIS],
          ['gcloud', 'run deploy *', '*', 0, 'Done.\\n'],
          ...healthz,
          ...EMPTY_PROJECT,
        ],
      );
    const healthzCalls = (calls: readonly string[]) =>
      calls.filter((call) => call.startsWith('curl') && call.endsWith('/api/healthz')).length;
    const sleeps = (calls: readonly string[]) => calls.filter((call) => call === 'sleep 5').length;
    /** Google's front end, before the new address answers: its own HTML page. */
    const FRONT_END_404 = '<html>Error 404 (Not Found)</html>\\n404 text/html; charset=UTF-8';

    it('waits for /api/healthz while the new address still answers with Google’s own 404 page', () => {
      const result = deployWith([['curl', '*/api/healthz', 2, 0, FRONT_END_404]]);
      expect(result.status, result.out).toBe(0);
      expect(healthzCalls(result.calls)).toBe(3);
      expect(sleeps(result.calls)).toBe(2);
      expect(result.out).toContain('GET /api/healthz: {"status":"ok","version":"test"}');
      expect(result.out).toContain('GET /api/config: {"demo":false}');
    });

    it('takes /api/config at once for an image that predates /api/healthz (the backend’s own JSON 404)', () => {
      const result = deployWith([
        [
          'curl',
          '*/api/healthz',
          '*',
          0,
          '{"statusCode":404,"error":"Not Found","message":"Route GET:/api/healthz not found"}\\n404 application/json; charset=utf-8',
        ],
      ]);
      expect(result.status, result.out).toBe(0);
      // No retries: the 404 came from the backend, so the image is up.
      expect(healthzCalls(result.calls)).toBe(1);
      expect(sleeps(result.calls)).toBe(0);
      expect(result.out).toContain(
        'GET /api/healthz: not in this image (an image from before 2026-10-10); /api/config answers',
      );
      expect(result.out).toContain('GET /api/config: {"demo":false}');
      expect(result.out).not.toContain('did not answer yet');
    });

    it('says in one line what the check saw, and shows the answers only with --verbose', () => {
      const plain = deployWith([], false);
      expect(plain.status, plain.out).toBe(0);
      expect(plain.out).toContain('==> Checking the running instance');
      expect(plain.out).toContain('    the instance answers (version test) and serves the app\n');
      for (const line of [
        'revision gcportrait-00001 is ready',
        'GET /api/healthz:',
        'GET /api/config:',
        'GET /:',
      ])
        expect(plain.out).not.toContain(line);
      const verbose = deployWith([]);
      expect(verbose.status, verbose.out).toBe(0);
      expect(verbose.out).toContain(
        'revision gcportrait-00001 is ready: its startup probe GET /healthz passed',
      );
      expect(verbose.out).toContain('GET /api/config: {"demo":false}');
      expect(verbose.out).toContain('    the instance answers (version test) and serves the app\n');
      // The same checks either way.
      expect(verbose.calls.filter((call) => call.startsWith('curl'))).toEqual(
        plain.calls.filter((call) => call.startsWith('curl')),
      );
    });

    it('gives up after 7 tries 5 s apart, with a warning, when nothing answers', () => {
      const result = deployWith([['curl', '*/api/healthz', '*', 7, '\\n000 ']]);
      expect(result.status, result.out).toBe(0);
      expect(healthzCalls(result.calls)).toBe(7);
      expect(sleeps(result.calls)).toBe(6);
      expect(result.out).toContain('/api/healthz did not answer yet');
      expect(result.out).not.toContain('GET /api/config:');
    });
  });
});

describe.skipIf(!BASH_AVAILABLE)(
  'docs/cloudshell-tutorial.md (the "Open in Cloud Shell" path), against stand-ins',
  { timeout: 60_000 },
  () => {
    const { run } = useStandIns();
    const tutorial = read('docs/cloudshell-tutorial.md');
    /** Every ```sh block, its continuation lines joined, the project placeholder replaced by a project id. */
    const commands = [...tutorial.matchAll(/^```sh\n([\s\S]*?)^```$/gm)].map((m) =>
      (m[1] ?? '')
        .replace(/\\\n\s*/g, '')
        .trim()
        .replaceAll('{{project-id}}', 'example-project'),
    );

    it('is a Cloud Shell tutorial: one H1 first, the duration right after it, steps as H2, known directives only', () => {
      const lines = tutorial.split('\n');
      expect(lines[0]).toMatch(/^# \S/);
      expect(lines.filter((line) => /^# /.test(line))).toHaveLength(1);
      expect(lines[2]).toBe('<walkthrough-tutorial-duration duration="10"></walkthrough-tutorial-duration>');
      expect(lines.slice(0, 10)).toContain('<!-- SPDX-License-Identifier: MIT -->');
      expect(lines.filter((line) => /^## /.test(line)).length).toBeGreaterThanOrEqual(5);
      const directives = new Set([...tutorial.matchAll(/<(walkthrough-[a-z-]+)/g)].map((m) => m[1]));
      expect([...directives].sort()).toEqual([
        'walkthrough-conclusion-trophy',
        'walkthrough-editor-open-file',
        'walkthrough-footnote',
        'walkthrough-project-setup',
        'walkthrough-tutorial-duration',
      ]);
      // Commands name the chosen project as {{project-id}}, as Google's own tutorials do
      // (GoogleCloudPlatform/cloud-shell-tutorials). Left unreplaced it is a harmless word to bash, while
      // <walkthrough-project-id/> would be a redirection from a file.
      expect(commands.filter((command) => command.includes('--project')).length).toBeGreaterThanOrEqual(4);
      for (const command of commands) expect(command).not.toContain('<walkthrough');
      expect(tutorial).toContain('gcloud config set project {{project-id}}');
      // The last step opens with the trophy (Cloud Shell's layout rule); opened files exist.
      const last = tutorial.slice(tutorial.lastIndexOf('\n## '));
      expect(last.split('\n').filter(Boolean)[1]).toBe(
        '<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>',
      );
      for (const m of tutorial.matchAll(/filePath="([^"]+)"/g))
        expect(existsSync(path.join(REPO, m[1] ?? ''))).toBe(true);
    });

    it('takes the steps deploy.sh ends with, in its order: deploy, open the address, the OAuth client, the redeploy', () => {
      const steps = tutorial.split('\n').filter((line) => line.startsWith('## '));
      const order = [
        '## Deploy',
        '## Open your instance',
        '## Create the OAuth client',
        '## Redeploy with the client id',
      ];
      const at = order.map((step) => steps.indexOf(step));
      expect(at).toEqual([at[0], (at[0] ?? 0) + 1, (at[0] ?? 0) + 2, (at[0] ?? 0) + 3]);
      expect(at[0]).toBeGreaterThan(0);
      // The redeploy is the first command with the client id added, as deploy.sh prints it.
      expect(commands).toContain('infra/deploy.sh --project example-project --oauth-client-id CLIENT_ID');
    });

    it('runs every deploy.sh and uninstall.sh command it shows, and only well-known gcloud commands besides', () => {
      expect(commands.length).toBeGreaterThanOrEqual(8);
      const scripts = commands.filter((command) => command.startsWith('infra/'));
      expect(scripts.map((command) => command.split(' ')[0])).toEqual([
        'infra/deploy.sh',
        'infra/deploy.sh',
        'infra/deploy.sh',
        'infra/uninstall.sh',
      ]);
      for (const command of scripts) {
        const [script = '', ...args] = command.split(/\s+/);
        const name = script === 'infra/deploy.sh' ? 'deploy.sh' : 'uninstall.sh';
        // uninstall.sh asks for the service name on a terminal; the stand-ins have none, hence --yes.
        const result = run(name, name === 'uninstall.sh' ? [...args, '--yes'] : args, [
          ['gcloud', 'services list --enabled*', '*', 0, ALL_APIS],
          ['gcloud', 'run deploy *', '*', 0, 'Done.\\n'],
          ['gcloud', 'storage buckets add-iam-policy-binding *', '*', 0, ''],
          ['gcloud', 'builds submit *', '*', 0, 'DONE\\n'],
          [
            'gcloud',
            'run services describe *metadata.labels*',
            '*',
            name === 'uninstall.sh' ? 0 : 1,
            name === 'uninstall.sh' ? 'managed-by=gcportrait-deploy\\n' : 'NOT_FOUND\\n',
          ],
          ['gcloud', '* delete *', '*', 0, ''],
          ...EMPTY_PROJECT,
        ]);
        expect(result.status, `${command}\n${result.out}`).toBe(0);
      }
      const others = commands.filter((command) => !command.startsWith('infra/'));
      expect(others.map((command) => command.split(' ').slice(0, 3).join(' '))).toEqual([
        'gcloud auth login',
        'gcloud config set',
        'echo "https://console.cloud.google.com/auth/clients?project=example-project"',
        'gcloud projects add-iam-policy-binding',
      ]);
      expect(commands).toContain('gcloud config set project example-project');
      expect(commands).toContain(
        'gcloud projects add-iam-policy-binding example-project --member="user:$(gcloud config get-value account)" --role=roles/cloudasset.viewer',
      );
    });
  },
);

describe.skipIf(!BASH_AVAILABLE)(
  'the Cloud Run Button hook (infra/cloud-run-button.sh, app.json postcreate), against stand-ins',
  { timeout: 60_000 },
  () => {
    const { run } = useStandIns();
    const BUTTON_ENV = {
      GOOGLE_CLOUD_PROJECT: 'example-project',
      GOOGLE_CLOUD_REGION: 'europe-west3',
      K_SERVICE: 'gcportrait',
      SERVICE_URL: 'https://gcportrait-abc123-ey.a.run.app',
      OAUTH_CLIENT_ID: 'none',
      SA_MODE_ENABLED: 'false',
    };
    const hookRules: readonly Rule[] = [
      ['gcloud', 'run services update *', '*', 0, 'Done.\\n'],
      ['gcloud', 'projects describe *', '*', 0, `${NUMBER}\\n`],
    ];

    it('adds what the button cannot set, drops the placeholder client id, and names the next steps', () => {
      const result = run('cloud-run-button.sh', [], hookRules, 'C', BUTTON_ENV);
      expect(result.status, result.out).toBe(0);
      expect(result.out.trimStart().split('\n')[0]).toBe('gcportrait infra/cloud-run-button.sh');
      expect(result.out).not.toMatch(/affiliated/i);
      expect(result.calls.filter((call) => call.startsWith('gcloud run services update'))).toEqual([
        'gcloud run services update gcportrait --project=example-project --region=europe-west3 ' +
          '--update-env-vars=TRUST_PROXY_HOPS=1 --timeout=900 --cpu-boost --max-instances=10 ' +
          '--startup-probe=httpGet.path=/healthz,initialDelaySeconds=0,periodSeconds=2,timeoutSeconds=2,failureThreshold=15 ' +
          '--liveness-probe=httpGet.path=/healthz,periodSeconds=30,timeoutSeconds=5,failureThreshold=3 ' +
          '--remove-env-vars=OAUTH_CLIENT_ID --quiet',
      ]);
      // deploy.sh probes the same way.
      const deploy = read('infra/deploy.sh');
      expect(deploy).toContain('--startup-probe="$STARTUP_PROBE" --liveness-probe="$LIVENESS_PROBE"');
      expect(result.out).toContain(
        `gcportrait is running at https://gcportrait-${NUMBER}.europe-west3.run.app`,
      );
      expect(result.out).toContain('https://console.cloud.google.com/auth/clients?project=example-project');
      expect(result.out).toContain(
        'gcloud run services update gcportrait --project=example-project --region=europe-west3 --update-env-vars=OAUTH_CLIENT_ID=CLIENT_ID',
      );
      expect(result.out).not.toContain('service-account mode is on');
      // A later click asks for OAUTH_CLIENT_ID again, and this hook does not run then.
      expect(result.out).toContain('A later click of the button asks for OAUTH_CLIENT_ID again');
    });

    it('keeps a real client id, warns about service-account mode, and refuses to run outside the button', () => {
      const result = run('cloud-run-button.sh', [], hookRules, 'C', {
        ...BUTTON_ENV,
        OAUTH_CLIENT_ID: '12345678901-abc.apps.googleusercontent.com',
        SA_MODE_ENABLED: 'true',
      });
      expect(result.status, result.out).toBe(0);
      expect(result.calls.find((call) => call.startsWith('gcloud run services update'))).not.toContain(
        '--remove-env-vars',
      );
      expect(result.out).toContain(
        '(The service already has the client id 12345678901-abc.apps.googleusercontent.com',
      );
      expect(result.out).toContain(
        'warning: service-account mode is on, and this service runs as the project',
      );
      const outside = run('cloud-run-button.sh', [], hookRules, 'C', {});
      expect(outside.status).toBe(1);
      expect(outside.out).toContain(
        'GOOGLE_CLOUD_PROJECT is not set: the Cloud Run Button sets it for its hooks',
      );
      expect(outside.calls).toEqual([]);
    });
  },
);
