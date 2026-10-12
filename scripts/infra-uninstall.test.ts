// SPDX-License-Identifier: MIT
/**
 * infra/uninstall.sh, against the stand-ins of scripts/testing/infra-stub.ts: it deletes only what carries
 * deploy.sh's mark, and with --disable-apis disables only the APIs deploy.sh enabled that nothing else in the project
 * still needs.
 */
import { describe, expect, it } from 'vitest';

import {
  NUMBER,
  TOKEN,
  authenticated,
  count,
  BASH_AVAILABLE,
  instanceOnly,
  useStandIns,
  type Rule,
} from './testing/infra-stub.js';

// Each test runs the scripts end to end, a few hundred stand-in processes for the longest ones: a few seconds on
// an idle machine, much more on a loaded one, hence the generous limit.
describe.skipIf(!BASH_AVAILABLE)('uninstall.sh (bash, against stand-ins)', { timeout: 60_000 }, () => {
  const { run } = useStandIns();

  it('uninstall.sh deletes only what carries the mark, and disables the APIs recorded on service and repository', () => {
    const result = run(
      'uninstall.sh',
      ['--project', 'example-project', '--yes', '--disable-apis'],
      authenticated(
        [
          'gcloud',
          'run services describe *metadata.labels*',
          '*',
          0,
          'cloud.googleapis.com/location=europe-west3;gcportrait-api-iap=enabled;managed-by=gcportrait-deploy\\n',
        ],
        [
          'gcloud',
          'artifacts repositories describe *value(labels)*',
          '*',
          0,
          'gcportrait-api-cloudbuild=enabled;gcportrait-api-iap=enabled;managed-by=gcportrait-deploy\\n',
        ],
        ['gcloud', 'artifacts repositories describe *', '*', 0, ''],
        [
          'gcloud',
          'storage buckets describe gs://example-project-gcportrait-builds --raw --format=value(projectNumber,labels)',
          '*',
          0,
          `${NUMBER}\\tmanaged-by=gcportrait-deploy\\n`,
        ],
        // The specific answers first: the first rule that matches answers.
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
          'Made by hand\\n',
        ],
        ['gcloud', 'iam service-accounts describe *', '*', 0, ''],
        // Only this instance's own service: nothing else in the project needs an API.
        ['gcloud', 'run services list *', '*', 0, 'gcportrait|europe-west3||managed-by=gcportrait-deploy\\n'],
        ['gcloud', 'run jobs list *', '*', 0, ''],
        ['gcloud', 'run worker-pools list *', '*', 0, ''],
        ['gcloud', '* delete *', '*', 0, ''],
        ['gcloud', 'storage rm *', '*', 0, ''],
        ['curl', '*serviceusage.googleapis.com*:disable', '*', 0, '{}'],
      ),
    );
    expect(result.status, result.out).toBe(0);
    const { calls } = result;
    expect(calls).toContain(
      'gcloud run services delete gcportrait --project=example-project --region=europe-west3 --quiet',
    );
    expect(count(calls, 'gcloud artifacts repositories delete gcportrait-builds')).toBe(1);
    expect(calls).toContain('gcloud storage rm --recursive gs://example-project-gcportrait-builds');
    expect(count(calls, 'gcloud iam service-accounts delete gcportrait-backend@')).toBe(1);
    expect(count(calls, 'gcloud iam service-accounts delete gcportrait-build@')).toBe(0);
    expect(result.out).toContain(
      'keeping service account gcportrait-build@example-project.iam.gserviceaccount.com',
    );
    const disabled = calls
      .filter((call) => call.includes(':disable'))
      .map((call) => /services\/([^:]+):disable/.exec(call)?.[1]);
    expect(disabled).toEqual(['iap.googleapis.com', 'cloudbuild.googleapis.com']);
    expect(calls.join('\n')).not.toContain(TOKEN);
  });

  it('uninstall.sh keeps a bucket of the same name that another project owns', () => {
    const result = run(
      'uninstall.sh',
      ['--project', 'example-project', '--yes', '--dry-run'],
      [
        ['gcloud', 'auth list*', '*', 0, 'me@example.com\\n'],
        ['gcloud', 'projects describe *', '*', 0, `${NUMBER}\\n`],
        ['gcloud', 'run services describe *', '*', 1, 'NOT_FOUND\\n'],
        ['gcloud', 'artifacts repositories describe *', '*', 1, 'NOT_FOUND\\n'],
        ['gcloud', 'storage buckets describe *', '*', 0, '12345678901\\tmanaged-by=gcportrait-deploy\\n'],
        ['gcloud', 'iam service-accounts describe *', '*', 1, 'NOT_FOUND\\n'],
      ],
    );
    expect(result.status, result.out).toBe(0);
    expect(result.out).toContain(
      'keeping bucket gs://example-project-gcportrait-builds: it belongs to another project',
    );
    expect(result.out).toContain('Nothing of gcportrait to remove in example-project.');
  });

  describe('--disable-apis keeps what other Cloud Run services, jobs and worker pools still need', () => {
    const uninstallRules = (
      services: string | null,
      jobs: string | null = '',
      workerPools: string | null = '',
    ): readonly Rule[] => [
      ...instanceOnly(
        'gcportrait-api-iap=enabled;gcportrait-api-cloudasset=enabled;gcportrait-api-cloudbuild=enabled;gcportrait-api-run=enabled;managed-by=gcportrait-deploy',
      ),
      services === null
        ? ['gcloud', 'run services list *', '*', 1, 'ERROR: PERMISSION_DENIED\\n']
        : ['gcloud', 'run services list *', '*', 0, services],
      jobs === null
        ? ['gcloud', 'run jobs list *', '*', 1, 'ERROR: PERMISSION_DENIED\\n']
        : ['gcloud', 'run jobs list *', '*', 0, jobs],
      // An older gcloud has no GA `run worker-pools`.
      workerPools === null
        ? ['gcloud', 'run worker-pools list *', '*', 2, 'ERROR: (gcloud.run) Invalid choice\\n']
        : ['gcloud', 'run worker-pools list *', '*', 0, workerPools],
      ['gcloud', '* delete *', '*', 0, ''],
      ['curl', '*serviceusage.googleapis.com*:disable', '*', 0, '{}'],
    ];
    const disabled = (calls: readonly string[]) =>
      calls
        .filter((call) => call.includes(':disable'))
        .map((call) => /services\/([^:]+):disable/.exec(call)?.[1]);
    const OWN = 'gcportrait|europe-west3||managed-by=gcportrait-deploy\\n';

    it('lists the services, jobs and worker pools of every region first, and disables everything when nothing else runs', () => {
      const result = run(
        'uninstall.sh',
        ['--project', 'example-project', '--yes', '--disable-apis'],
        uninstallRules(OWN),
      );
      expect(result.status, result.out).toBe(0);
      expect(result.calls.find((call) => call.startsWith('gcloud run services list'))).toBe(
        'gcloud run services list --project=example-project --format=value[separator="|"](metadata.name,region,metadata.annotations."run.googleapis.com/iap-enabled",metadata.labels)',
      );
      // No --region: gcloud then lists every region.
      expect(result.calls.filter((call) => / run (jobs|worker-pools) list /.test(call))).toEqual([
        'gcloud run jobs list --project=example-project --format=value[separator="|"](metadata.name,region)',
        'gcloud run worker-pools list --project=example-project --format=value[separator="|"](metadata.name,region)',
      ]);
      // The lists come before the first deletion.
      const firstDelete = result.calls.findIndex((call) => call.includes(' delete '));
      const lastList = result.calls.findLastIndex((call) => / run \S+ list /.test(call));
      expect(lastList).toBeGreaterThan(-1);
      expect(lastList).toBeLessThan(firstDelete);
      expect(disabled(result.calls)).toEqual([
        'iap.googleapis.com',
        'cloudasset.googleapis.com',
        'cloudbuild.googleapis.com',
        'run.googleapis.com',
      ]);
    });

    it('another service, in any region: keeps Cloud Run, its image and build APIs, disables the rest', () => {
      const result = run(
        'uninstall.sh',
        ['--project', 'example-project', '--yes', '--disable-apis'],
        uninstallRules(`${OWN}web|us-central1||team=web\\n`),
      );
      expect(result.status, result.out).toBe(0);
      expect(disabled(result.calls)).toEqual(['iap.googleapis.com', 'cloudasset.googleapis.com']);
      expect(result.out).toContain(
        'keeping run.googleapis.com: the Cloud Run service web/us-central1 still needs it',
      );
      expect(result.out).toContain(
        'keeping cloudbuild.googleapis.com: the Cloud Run service web/us-central1 still needs it',
      );
    });

    it('another service behind IAP keeps iap; another gcportrait instance keeps every API of an instance', () => {
      const iap = run(
        'uninstall.sh',
        ['--project', 'example-project', '--yes', '--disable-apis'],
        uninstallRules(`${OWN}intranet|europe-west1|true|\\n`),
      );
      expect(disabled(iap.calls)).toEqual(['cloudasset.googleapis.com']);
      const instance = run(
        'uninstall.sh',
        ['--project', 'example-project', '--yes', '--disable-apis'],
        uninstallRules(`${OWN}gcportrait-team|europe-west3||managed-by=gcportrait-deploy\\n`),
      );
      expect(disabled(instance.calls)).toEqual(['iap.googleapis.com']);
      expect(instance.out).toContain(
        'keeping cloudasset.googleapis.com: the Cloud Run service gcportrait-team/europe-west3 still needs it',
      );
    });

    it('a Cloud Run job or worker pool, in any region: keeps Cloud Run, its image and build APIs', () => {
      const job = run(
        'uninstall.sh',
        ['--project', 'example-project', '--yes', '--disable-apis'],
        uninstallRules(OWN, 'nightly-etl|us-east1\\n'),
      );
      expect(job.status, job.out).toBe(0);
      expect(disabled(job.calls)).toEqual(['iap.googleapis.com', 'cloudasset.googleapis.com']);
      expect(job.out).toContain(
        'keeping run.googleapis.com: the Cloud Run job nightly-etl/us-east1 still needs it',
      );
      expect(job.out).toContain(
        'keeping cloudbuild.googleapis.com: the Cloud Run job nightly-etl/us-east1 still needs it',
      );
      const pool = run(
        'uninstall.sh',
        ['--project', 'example-project', '--yes', '--disable-apis'],
        uninstallRules(OWN, '', 'queue-workers|asia-northeast1\\n'),
      );
      expect(pool.status, pool.out).toBe(0);
      expect(disabled(pool.calls)).toEqual(['iap.googleapis.com', 'cloudasset.googleapis.com']);
      expect(pool.out).toContain(
        'keeping run.googleapis.com: the Cloud Run worker pool queue-workers/asia-northeast1 still needs it',
      );
    });

    it('keeps every API when the services, jobs or worker pools cannot be listed', () => {
      const cases: readonly (readonly [string, readonly Rule[]])[] = [
        ['services', uninstallRules(null)],
        ['jobs', uninstallRules(OWN, null)],
        ['worker pools (an older gcloud)', uninstallRules(OWN, '', null)],
      ];
      for (const [label, rules] of cases) {
        const result = run(
          'uninstall.sh',
          ['--project', 'example-project', '--yes', '--disable-apis'],
          rules,
        );
        expect(result.status, `${label}: ${result.out}`).toBe(0);
        expect(disabled(result.calls), label).toEqual([]);
        expect(result.out, label).toContain(
          "could not list the project's Cloud Run services, jobs and worker pools, so every API deploy.sh enabled is kept",
        );
        // The instance itself is still removed.
        expect(count(result.calls, 'gcloud run services delete'), label).toBe(1);
      }
    });

    it('the --dry-run shows the same decision', () => {
      const result = run(
        'uninstall.sh',
        ['--project', 'example-project', '--dry-run', '--disable-apis'],
        uninstallRules(`${OWN}web|us-central1||\\n`),
      );
      expect(result.status, result.out).toBe(0);
      expect(result.out).toContain(
        'APIs deploy.sh enabled, to disable: iap.googleapis.com cloudasset.googleapis.com',
      );
      expect(result.out).toContain(
        'POST serviceusage.googleapis.com/v1/projects/example-project/services/iap.googleapis.com:disable',
      );
      expect(result.calls.filter((call) => call.includes(':disable') || call.includes(' delete '))).toEqual(
        [],
      );
    });
  });
});
