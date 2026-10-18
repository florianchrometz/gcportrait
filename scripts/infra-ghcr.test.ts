// SPDX-License-Identifier: MIT
/**
 * Released images from GitHub Container Registry (AGENTS.md, Releases): deploy.sh deploys them through an
 * Artifact Registry remote repository of ghcr.io that it creates once, and uninstall.sh removes that
 * repository with the last instance that deploys from it; against the stand-ins of
 * scripts/testing/infra-stub.ts.
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_APIS,
  DIGEST,
  EMPTY_PROJECT,
  GHCR_TOKEN,
  changesIn,
  count,
  BASH_AVAILABLE,
  instanceOnly,
  useStandIns,
  type Rule,
} from './testing/infra-stub.js';

// Each test runs the scripts end to end, a few hundred stand-in processes for the longest ones: a few seconds on
// an idle machine, much more on a loaded one, hence the generous limit.
describe.skipIf(!BASH_AVAILABLE)(
  'deploy.sh and uninstall.sh with released images (bash, against stand-ins)',
  { timeout: 60_000 },
  () => {
    const { run } = useStandIns();

    describe('released images from GitHub Container Registry, through a remote repository', () => {
      it('--image takes a release as its git tag or its image tag, and checks it on ghcr.io before deploying', () => {
        const cases: readonly [string, string][] = [
          ['v1.2.3', '1.2.3'],
          ['1.2.3', '1.2.3'],
          ['v1.2', '1.2'],
          ['v1.2.3-rc.1', '1.2.3-rc.1'],
          ['latest', 'latest'],
          ['dev', 'dev'],
        ];
        for (const [arg, tag] of cases) {
          const result = run(
            'deploy.sh',
            ['--project', 'example-project', '--image', arg],
            [
              ['gcloud', 'services list --enabled*', '*', 0, ALL_APIS],
              ['gcloud', 'run deploy *', '*', 0, 'Done.\\n'],
              ...EMPTY_PROJECT,
            ],
          );
          expect(result.status, result.out).toBe(0);
          // release.yml publishes tag v1.2.3 as the image tag 1.2.3 (scripts/release-image.mjs), pulled
          // through the remote repository `ghcr` in the instance's own project.
          expect(result.calls.find((call) => call.includes('https://ghcr.io/v2/'))).toMatch(
            new RegExp(
              `https://ghcr\\.io/v2/florianchrometz/gcportrait/manifests/${tag.replace(/\./g, '\\.')}$`,
            ),
          );
          const image = `europe-west3-docker.pkg.dev/example-project/ghcr/florianchrometz/gcportrait:${tag}`;
          expect(result.calls.find((call) => call.startsWith('gcloud run deploy'))).toContain(
            `--image=${image}`,
          );
          expect(count(result.calls, 'gcloud artifacts docker images describe')).toBe(0);
        }
      });

      const REMOTE_DESCRIBE =
        'gcloud artifacts repositories describe ghcr --project=example-project --location=europe-west3 ' +
        '--format=value[separator="|"](mode,format,labels,remoteRepositoryConfig.commonRepository.uri,' +
        'remoteRepositoryConfig.dockerRepository.customRepository.uri)';
      const MANAGED = 'managed-by=gcportrait-deploy';
      /**
       * gcloud's answer to that describe: `MODE|FORMAT|LABELS|COMMON|CUSTOM`, the upstream's address in one of the
       * two fields Artifact Registry may give it and an empty string for the other (gcloud prints a field that is not
       * set as one). A repository created with --remote-docker-repo is described with `commonRepository.uri`;
       * `dockerRepository.customRepository.uri` is the older shape.
       */
      const described = (
        mode: string,
        labels: string,
        upstream: string,
        field: 'commonRepository' | 'customRepository' = 'commonRepository',
      ): string =>
        [
          mode,
          'DOCKER',
          labels,
          field === 'commonRepository' ? upstream : '',
          field === 'customRepository' ? upstream : '',
        ].join('|');
      /** What gcloud prints for the remote repository deploy.sh creates. */
      const DESCRIBED_OURS = 'REMOTE_REPOSITORY|DOCKER|managed-by=gcportrait-deploy|https://ghcr.io|';
      const REMOTE_CREATE =
        'gcloud artifacts repositories create ghcr --project=example-project --location=europe-west3 ' +
        '--repository-format=docker --mode=remote-repository --remote-docker-repo=https://ghcr.io ' +
        '--remote-repo-config-desc=GitHub Container Registry --labels=managed-by=gcportrait-deploy ' +
        '--description=Public GitHub Container Registry images, pulled through for infra/deploy.sh (gcportrait)';
      const pullRules = (extra: readonly Rule[] = []): readonly Rule[] => [
        ...extra,
        ['gcloud', 'services list --enabled*', '*', 0, ALL_APIS],
        ['gcloud', 'run deploy *', '*', 0, 'Done.\\n'],
        ...EMPTY_PROJECT,
      ];
      const deployedImage = (calls: readonly string[]) =>
        /--image=(\S+)/.exec(calls.find((call) => call.startsWith('gcloud run deploy')) ?? '')?.[1];

      it('without --image: looks the newest release up first, creates the remote repository once, deploys through it', () => {
        const result = run('deploy.sh', ['--project', 'example-project'], pullRules());
        expect(result.status, result.out).toBe(0);
        const { calls } = result;
        // ghcr.io is asked before anything else is: a token, then the manifest of :latest.
        const token = calls.findIndex((call) => call.includes('https://ghcr.io/token?'));
        expect(calls[token]).toContain('scope=repository:florianchrometz/gcportrait:pull&service=ghcr.io');
        expect(calls[token + 1]).toMatch(
          /--head .*https:\/\/ghcr\.io\/v2\/florianchrometz\/gcportrait\/manifests\/latest$/,
        );
        expect(token).toBeLessThan(calls.findIndex((call) => call.startsWith('gcloud services list')));
        // The anonymous token reaches curl on its standard input, never on a command line.
        expect(result.stdin).toContain(`Authorization: Bearer ${GHCR_TOKEN}`);
        expect(calls.join('\n')).not.toContain(GHCR_TOKEN);
        // The remote repository: looked up, then created with deploy.sh's label; no clean-up policy, no build.
        expect(calls).toContain(REMOTE_DESCRIBE);
        expect(calls.filter((call) => call.startsWith('gcloud artifacts repositories create'))).toEqual([
          REMOTE_CREATE,
        ]);
        expect(count(calls, 'gcloud artifacts repositories set-cleanup-policies')).toBe(0);
        expect(count(calls, 'gcloud builds submit')).toBe(0);
        expect(count(calls, 'gcloud artifacts docker images describe')).toBe(0);
        expect(deployedImage(calls)).toBe(
          'europe-west3-docker.pkg.dev/example-project/ghcr/florianchrometz/gcportrait:latest',
        );
        expect(result.out).toContain(`image: ghcr.io/florianchrometz/gcportrait (latest), digest ${DIGEST}`);
        expect(result.out).toContain(`(ghcr.io/florianchrometz/gcportrait latest: ${DIGEST})`);
        expect(result.out).toContain(
          'Redeploy with the same settings: infra/deploy.sh --project example-project\n',
        );
        expect(result.out).toContain(
          '(that deploys whatever release is the newest then; --image vX.Y.Z pins one)',
        );
      });

      it('any ghcr.io image goes through the same repository: a fork, no tag (latest) or a digest', () => {
        const digest = `sha256:${'e'.repeat(64)}`;
        const cases: readonly [string, string, string][] = [
          ['ghcr.io/someone/fork:2.0.0', 'someone/fork/manifests/2.0.0', 'someone/fork:2.0.0'],
          ['ghcr.io/someone/fork', 'someone/fork/manifests/latest', 'someone/fork:latest'],
          [
            `ghcr.io/team/apps/fork@${digest}`,
            `team/apps/fork/manifests/${digest}`,
            `team/apps/fork@${digest}`,
          ],
        ];
        for (const [arg, manifest, path] of cases) {
          const result = run('deploy.sh', ['--project', 'example-project', '--image', arg], pullRules());
          expect(result.status, result.out).toBe(0);
          expect(result.calls.some((call) => call.endsWith(`https://ghcr.io/v2/${manifest}`))).toBe(true);
          expect(deployedImage(result.calls)).toBe(
            `europe-west3-docker.pkg.dev/example-project/ghcr/${path}`,
          );
        }
        // ghcr.io package paths are lowercase; a reference that is not one stops before any call.
        const refused = run(
          'deploy.sh',
          ['--project', 'example-project', '--image', 'ghcr.io/Someone/Fork:1'],
          [],
        );
        expect(refused.status).toBe(1);
        expect(refused.out).toContain(
          'is not a ghcr.io image reference such as ghcr.io/OWNER/NAME:TAG (lowercase)',
        );
        expect(refused.calls).toEqual([]);
        // Any other full reference is deployed as it is, without ghcr.io or a remote repository.
        const other = run(
          'deploy.sh',
          ['--project', 'example-project', '--image', 'registry.example.com/team/gcportrait:1.0.0'],
          pullRules(),
        );
        expect(other.status, other.out).toBe(0);
        expect(other.calls.filter((call) => call.includes('ghcr'))).toEqual([]);
        expect(deployedImage(other.calls)).toBe('registry.example.com/team/gcportrait:1.0.0');
      });

      it('stops before any change when the release or the package is not there, and goes on when ghcr.io is silent', () => {
        const noRelease = run(
          'deploy.sh',
          ['--project', 'example-project'],
          pullRules([['curl', '*https://ghcr.io/token?*', '*', 0, '{"errors":[{"code":"DENIED"}]}\\n403']]),
        );
        expect(noRelease.status).toBe(1);
        expect(noRelease.out).toContain(
          'ghcr.io/florianchrometz/gcportrait has no public release yet (GitHub Container Registry refuses anonymous access to it), so there is nothing to pull yet; build from this checkout instead: the same command with --build.',
        );
        const noTag = run(
          'deploy.sh',
          ['--project', 'example-project', '--image', 'v9.9.9'],
          pullRules([['curl', '*--head*https://ghcr.io/v2/*', '*', 0, 'HTTP/2 404\\r\\n\\r\\n\\n404']]),
        );
        expect(noTag.status).toBe(1);
        expect(noTag.out).toContain(
          'ghcr.io/florianchrometz/gcportrait has no image 9.9.9. Pick a released tag (--image vX.Y.Z), or build from this checkout instead: the same command with --build.',
        );
        const noFork = run(
          'deploy.sh',
          ['--project', 'example-project', '--image', 'ghcr.io/someone/fork:1.0.0'],
          pullRules([['curl', '*https://ghcr.io/token?*', '*', 0, '{}\\n403']]),
        );
        expect(noFork.status).toBe(1);
        expect(noFork.out).toContain('ghcr.io/someone/fork does not exist or is not public');
        for (const refused of [noRelease, noTag, noFork]) {
          expect(changesIn(refused.calls)).toEqual([]);
          expect(count(refused.calls, 'gcloud services list')).toBe(0);
        }
        // curl's exit 7: ghcr.io could not be reached from here. Cloud Run would report a missing image itself.
        const silent = run(
          'deploy.sh',
          ['--project', 'example-project', '--image', 'v1.0.0'],
          pullRules([['curl', '*https://ghcr.io/*', '*', 7, '']]),
        );
        expect(silent.status, silent.out).toBe(0);
        expect(silent.out).toContain(
          'warning: could not ask ghcr.io whether ghcr.io/florianchrometz/gcportrait has 1.0.0; going on',
        );
        expect(deployedImage(silent.calls)).toBe(
          'europe-west3-docker.pkg.dev/example-project/ghcr/florianchrometz/gcportrait:1.0.0',
        );
      });

      it('accepts on the next run the remote repository it created, described as Artifact Registry does today', () => {
        // With a synthetic image: the first run creates the repository, the second, with the same flags,
        // finds it with its upstream in commonRepository.uri and deploys through it as it is.
        const args = [
          '--project',
          'example-project',
          '--region',
          'europe-west3',
          '--service',
          'gcportrait-p77',
          '--image',
          'ghcr.io/someone/echo:42',
        ];
        expect(described('REMOTE_REPOSITORY', MANAGED, 'https://ghcr.io')).toBe(DESCRIBED_OURS);
        const first = run('deploy.sh', args, pullRules());
        expect(first.status, first.out).toBe(0);
        expect(first.calls.filter((call) => call.startsWith('gcloud artifacts repositories create'))).toEqual(
          [REMOTE_CREATE],
        );
        const second = run(
          'deploy.sh',
          args,
          pullRules([['gcloud', 'artifacts repositories describe ghcr *', '*', 0, `${DESCRIBED_OURS}\\n`]]),
        );
        expect(second.status, second.out).toBe(0);
        expect(second.calls).toContain(REMOTE_DESCRIBE);
        expect(second.out).toContain(
          'remote repository ghcr (europe-west3) of https://ghcr.io exists, made by deploy.sh',
        );
        expect(second.out).not.toContain('is not a remote repository');
        expect(count(second.calls, 'gcloud artifacts repositories create')).toBe(0);
        expect(deployedImage(second.calls)).toBe(
          'europe-west3-docker.pkg.dev/example-project/ghcr/someone/echo:42',
        );
        expect(deployedImage(first.calls)).toBe(deployedImage(second.calls));
      });

      it('uses an existing remote repository of ghcr.io as it is, its upstream in commonRepository.uri or in the older customRepository.uri', () => {
        const ours = 'remote repository ghcr (europe-west3) of https://ghcr.io exists, made by deploy.sh';
        const theirs =
          'remote repository ghcr (europe-west3) of https://ghcr.io exists, not made by deploy.sh: it pulls through it and changes nothing there';
        const answers: readonly (readonly [string, string])[] = [
          [DESCRIBED_OURS, ours],
          [described('REMOTE_REPOSITORY', 'team=platform', 'https://ghcr.io/'), theirs],
          [described('REMOTE_REPOSITORY', MANAGED, 'https://ghcr.io', 'customRepository'), ours],
          [described('REMOTE_REPOSITORY', 'team=platform', 'https://ghcr.io/', 'customRepository'), theirs],
        ];
        for (const [info, said] of answers) {
          for (const dryRun of [false, true]) {
            const result = run(
              'deploy.sh',
              ['--project', 'example-project', '--image', 'v1.0.0', ...(dryRun ? ['--dry-run'] : [])],
              pullRules([['gcloud', 'artifacts repositories describe ghcr *', '*', 0, `${info}\\n`]]),
            );
            expect(result.status, `${info}\n${result.out}`).toBe(0);
            expect(result.out).toContain(said);
            expect(result.out).not.toContain(said === ours ? theirs : ours);
            expect(result.out).toContain(
              'remote repository exists: europe-west3-docker.pkg.dev/example-project/ghcr',
            );
            expect(count(result.calls, 'gcloud artifacts repositories create')).toBe(0);
            expect(count(result.calls, 'gcloud artifacts repositories update')).toBe(0);
            if (!dryRun)
              expect(deployedImage(result.calls)).toBe(
                'europe-west3-docker.pkg.dev/example-project/ghcr/florianchrometz/gcportrait:1.0.0',
              );
          }
        }
      });

      it('stops before any change at a repository of that name that is not a remote repository of ghcr.io, whichever field holds its upstream', () => {
        const answers: readonly (readonly [string, string])[] = [
          [described('STANDARD_REPOSITORY', MANAGED, ''), 'STANDARD_REPOSITORY DOCKER '],
          [described('REMOTE_REPOSITORY', '', ''), 'REMOTE_REPOSITORY DOCKER '],
          [
            described('REMOTE_REPOSITORY', MANAGED, 'https://registry.example.com'),
            'REMOTE_REPOSITORY DOCKER https://registry.example.com',
          ],
          [
            described('REMOTE_REPOSITORY', MANAGED, 'https://ghcr.io/someone', 'customRepository'),
            'REMOTE_REPOSITORY DOCKER https://ghcr.io/someone',
          ],
        ];
        for (const [info, found] of answers) {
          for (const dryRun of [false, true]) {
            const result = run(
              'deploy.sh',
              ['--project', 'example-project', '--image', 'v1.0.0', ...(dryRun ? ['--dry-run'] : [])],
              pullRules([['gcloud', 'artifacts repositories describe ghcr *', '*', 0, `${info}\\n`]]),
            );
            expect(result.status, `${info}\n${result.out}`).toBe(1);
            expect(result.out).toContain(
              `the Artifact Registry repository ghcr in europe-west3 is not a remote repository of https://ghcr.io (${found}), so deploy.sh cannot pull ghcr.io images through it. Deploy in another --region, or with --build`,
            );
            expect(changesIn(result.calls)).toEqual([]);
            expect(count(result.calls, 'gcloud artifacts repositories update')).toBe(0);
          }
        }
      });

      it('--dry-run prints the remote repository and the deploy, and makes neither', () => {
        const result = run('deploy.sh', ['--project', 'example-project', '--dry-run'], pullRules());
        expect(result.status, result.out).toBe(0);
        expect(result.out).toContain('+ gcloud artifacts repositories create ghcr --project=example-project');
        expect(result.out).toContain(
          '+ gcloud run deploy gcportrait --project=example-project --region=europe-west3 --image=europe-west3-docker.pkg.dev/example-project/ghcr/florianchrometz/gcportrait:latest',
        );
        expect(changesIn(result.calls)).toEqual([]);
        expect(result.out).toContain('Dry run finished');
      });

      describe('uninstall.sh and the remote repository', () => {
        const OWN_IMAGE =
          'europe-west3-docker.pkg.dev/example-project/ghcr/florianchrometz/gcportrait:latest';
        const uninstallRules = (
          remote: string,
          services: string | null,
          jobs: string | null = '',
        ): readonly Rule[] => [
          ...instanceOnly('cloud.googleapis.com/location=europe-west3;managed-by=gcportrait-deploy', [
            'gcloud',
            'artifacts repositories describe ghcr *',
            '*',
            remote === '' ? 1 : 0,
            `${remote || 'NOT_FOUND'}\\n`,
          ]),
          services === null
            ? ['gcloud', 'run services list *', '*', 1, 'ERROR: PERMISSION_DENIED\\n']
            : ['gcloud', 'run services list *', '*', 0, services],
          jobs === null
            ? ['gcloud', 'run jobs list *', '*', 1, 'ERROR: PERMISSION_DENIED\\n']
            : ['gcloud', 'run jobs list *', '*', 0, jobs],
          ['gcloud', '* delete *', '*', 0, ''],
        ];
        const OURS = DESCRIBED_OURS;
        const remoteDeletes = (calls: readonly string[]) =>
          calls.filter((call) => call.startsWith('gcloud artifacts repositories delete ghcr'));

        it('goes with the last instance that deploys from it, after the service', () => {
          const result = run(
            'uninstall.sh',
            ['--project', 'example-project', '--yes'],
            uninstallRules(
              OURS,
              `gcportrait|europe-west3|${OWN_IMAGE}\\nwebsite|europe-west1|registry.example.com/web:1\\n`,
            ),
          );
          expect(result.status, result.out).toBe(0);
          expect(result.calls).toContain(
            'gcloud run services list --project=example-project --format=value[separator="|"](metadata.name,region,spec.template.spec.containers[].image.list())',
          );
          expect(result.calls).toContain(
            'gcloud run jobs list --project=example-project --format=value[separator="|"](metadata.name,region,spec.template.spec.template.spec.containers[].image.list())',
          );
          expect(result.out).toContain(
            'Artifact Registry remote repository: ghcr (europe-west3), with the ghcr.io images it holds',
          );
          expect(remoteDeletes(result.calls)).toEqual([
            'gcloud artifacts repositories delete ghcr --project=example-project --location=europe-west3 --quiet',
          ]);
          const service = result.calls.findIndex((call) => call.startsWith('gcloud run services delete'));
          expect(service).toBeGreaterThan(-1);
          expect(service).toBeLessThan(
            result.calls.findIndex((call) => call.startsWith('gcloud artifacts repositories delete ghcr')),
          );
        });

        it('stays while another service or a job deploys from it, when they cannot be listed, and when it is not deploy.sh’s', () => {
          const kept: readonly (readonly [readonly Rule[], string])[] = [
            [
              uninstallRules(
                OURS,
                `gcportrait|europe-west3|${OWN_IMAGE}\\ngcportrait-demo|europe-west1|${OWN_IMAGE}\\n`,
              ),
              'keeping remote repository ghcr (europe-west3): service gcportrait-demo (europe-west1) still deploys from it',
            ],
            [
              uninstallRules(
                OURS,
                `gcportrait|europe-west3|${OWN_IMAGE}\\n`,
                `nightly|europe-west3|registry.example.com/a:1,${OWN_IMAGE}\\n`,
              ),
              'keeping remote repository ghcr (europe-west3): job nightly (europe-west3) still deploys from it',
            ],
            [
              uninstallRules(OURS, null),
              "keeping remote repository ghcr (europe-west3): the project's Cloud Run services and jobs could not be listed",
            ],
            [
              uninstallRules(described('REMOTE_REPOSITORY', 'team=platform', 'https://ghcr.io'), ''),
              'keeping remote repository ghcr (europe-west3): it has no managed-by=gcportrait-deploy label',
            ],
          ];
          for (const [rules, said] of kept) {
            const result = run('uninstall.sh', ['--project', 'example-project', '--yes'], rules);
            expect(result.status, result.out).toBe(0);
            expect(result.out).toContain(said);
            expect(remoteDeletes(result.calls)).toEqual([]);
            expect(count(result.calls, 'gcloud run services delete gcportrait')).toBe(1);
          }
          // Without a remote repository there is nothing to look at.
          const none = run('uninstall.sh', ['--project', 'example-project', '--yes'], uninstallRules('', ''));
          expect(none.status, none.out).toBe(0);
          expect(count(none.calls, 'gcloud run services list')).toBe(0);
        });

        it('knows its own repository by the label, whichever field holds the upstream', () => {
          const deleted =
            'Artifact Registry remote repository: ghcr (europe-west3), with the ghcr.io images it holds';
          const kept =
            'keeping remote repository ghcr (europe-west3): it has no managed-by=gcportrait-deploy label';
          // The label alone decides, as for everything uninstall.sh deletes: deploy.sh sets it only on the remote
          // repository of ghcr.io it creates. So the upstream's field does not matter, nor does an upstream deploy.sh
          // would refuse (the last case).
          const answers: readonly (readonly [string, string])[] = [
            [DESCRIBED_OURS, deleted],
            [described('REMOTE_REPOSITORY', MANAGED, 'https://ghcr.io/', 'customRepository'), deleted],
            [described('REMOTE_REPOSITORY', 'team=platform', 'https://ghcr.io'), kept],
            [described('REMOTE_REPOSITORY', 'team=platform', 'https://ghcr.io', 'customRepository'), kept],
            [described('REMOTE_REPOSITORY', MANAGED, 'https://registry.example.com'), deleted],
          ];
          for (const [info, said] of answers) {
            const result = run(
              'uninstall.sh',
              ['--project', 'example-project', '--yes'],
              uninstallRules(info, `gcportrait|europe-west3|${OWN_IMAGE}\\n`),
            );
            expect(result.status, `${info}\n${result.out}`).toBe(0);
            expect(result.out).toContain(said);
            expect(remoteDeletes(result.calls)).toEqual(
              said === deleted
                ? [
                    'gcloud artifacts repositories delete ghcr --project=example-project --location=europe-west3 --quiet',
                  ]
                : [],
            );
          }
        });

        it('--dry-run names the deletion and deletes nothing', () => {
          const result = run(
            'uninstall.sh',
            ['--project', 'example-project', '--dry-run'],
            uninstallRules(OURS, `gcportrait|europe-west3|${OWN_IMAGE}\\n`),
          );
          expect(result.status, result.out).toBe(0);
          expect(result.out).toContain(
            '+ gcloud artifacts repositories delete ghcr --project=example-project --location=europe-west3 --quiet',
          );
          expect(result.calls.filter((call) => call.includes(' delete '))).toEqual([]);
        });
      });
    });
  },
);
