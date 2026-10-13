// SPDX-License-Identifier: MIT
/**
 * Demo-only instances, custom domains and legal pages (agents.md, Modes and hosting): deploy.sh's
 * --demo-only, --domain, --legal-dir, --impressum-url and --privacy-url, uninstall.sh's domain mappings and
 * infra/common.sh's JSON reader, against the stand-ins of scripts/testing/infra-stub.ts.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALL_APIS,
  EMPTY_PROJECT,
  NUMBER,
  TOKEN,
  BASH_AVAILABLE,
  instanceOnly,
  useStandIns,
  type Rule,
} from './testing/infra-stub.js';
import { REPO } from './testing/temp-tree.js';

// Each test runs the scripts end to end, a few hundred stand-in processes for the longest ones: a few seconds on
// an idle machine, much more on a loaded one, hence the generous limit.
describe.skipIf(!BASH_AVAILABLE)(
  'deploy.sh and uninstall.sh for demo-only instances, domains and legal pages (bash, against stand-ins)',
  { timeout: 60_000 },
  () => {
    const { run, tree } = useStandIns();

    describe('--demo-only, --domain and --legal-dir', () => {
      const DEMO_ADDRESS = `https://gcportrait-demo-${NUMBER}.europe-west1.run.app`;
      const MAPPINGS =
        'https://europe-west1-run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/example-project/domainmappings';
      /** Cloud Run's answer for a domain mapping, as `curl --write-out '\n%{http_code}'` prints it. */
      const mapping = (route: string, ready: 'True' | 'Unknown', records = true): string =>
        `{"metadata": {"name": "demo.example.com"}, "spec": {"routeName": "${route}", "certificateMode": "AUTOMATIC"}, ` +
        `"status": {"conditions": [{"type": "Ready", "status": "${ready}", "message": "Waiting for certificate provisioning."}], ` +
        `"resourceRecords": [${records ? '{"name": "demo", "rrdata": "ghs.googlehosted.com.", "type": "CNAME"}' : ''}]}}\\n200`;
      const NOT_FOUND = '{"error": {"code": 404, "message": "not found", "status": "NOT_FOUND"}}\\n404';
      const DNS_CNAME =
        '{"Status": 0, "Answer": [{"name": "demo.example.com.", "type": 5, "TTL": 300, "data": "ghs.googlehosted.com."}]}';
      const DNS_NOTHING = '{"Status": 3}';
      const demoRules = (extra: readonly Rule[] = []): readonly Rule[] => [
        ...extra,
        ['gcloud', 'services list --enabled*', '*', 0, ALL_APIS],
        ['gcloud', 'artifacts docker images describe *', '*', 0, 'sha256:0\\n'],
        ['gcloud', 'run deploy *', '*', 0, 'Done.\\n'],
        ['gcloud', 'domains list-user-verified *', '*', 0, 'example.org\\nexample.com\\n'],
        ...EMPTY_PROJECT,
      ];
      const IMAGE = ['--image', 'v1.0.0'];

      it('--demo-only: its own service name, no Google API, DEMO_ONLY and the smaller limits', () => {
        const result = run(
          'deploy.sh',
          ['--project', 'example-project', '--demo-only', ...IMAGE],
          demoRules([
            ['gcloud', 'services list --enabled*', '*', 0, 'run.googleapis.com\\n'],
            ['gcloud', 'services enable *', '*', 0, ''],
          ]),
        );
        expect(result.status, result.out).toBe(0);
        // A demo-only instance calls no Google API: neither Cloud Asset Inventory nor Resource Manager is enabled.
        expect(result.calls).toContain(
          'gcloud services enable iam.googleapis.com artifactregistry.googleapis.com --project=example-project',
        );
        const deploy = result.calls.find((call) => call.startsWith('gcloud run deploy')) ?? '';
        expect(deploy).toMatch(
          /^gcloud run deploy gcportrait-demo --project=example-project --region=europe-west3 /,
        );
        expect(deploy).toContain(
          '--service-account=gcportrait-demo-backend@example-project.iam.gserviceaccount.com',
        );
        expect(deploy).toContain(
          '--memory=256Mi --concurrency=80 --min-instances=0 --max-instances=2 --timeout=60 ',
        );
        expect(deploy).toContain('--allow-unauthenticated');
        // The environment, as printed: DEMO_ONLY, and no account to publish.
        expect(result.out).toContain("      DEMO_ONLY: 'true'");
        expect(result.out).toContain("      SA_MODE_ENABLED: 'false'");
        expect(result.out).not.toContain('BACKEND_SA_EMAIL:');
        expect(result.out).toContain('Mode:             demo-only');
        // Its next steps: open it, and legal pages; no OAuth client and no service-account mode.
        expect(result.out).toContain(
          'Next steps\n    1. Open https://gcportrait-demo-98765432101.europe-west3.run.app: the demo organisations work at once, with no sign-in.\n    2. Add legal pages',
        );
        expect(result.out).not.toContain('OAuth client');
        expect(result.out).not.toContain('Service-account mode (optional');
        expect(result.out).toContain(
          'Redeploy with the same settings: infra/deploy.sh --project example-project --demo-only --image v1.0.0',
        );
        expect(result.out).toContain(
          'infra/uninstall.sh --project example-project --region europe-west3 --service gcportrait-demo',
        );

        const named = run(
          'deploy.sh',
          [
            '--project',
            'example-project',
            '--demo-only',
            '--service',
            'try-it',
            '--max-instances',
            '4',
            ...IMAGE,
          ],
          demoRules(),
        );
        expect(named.status, named.out).toBe(0);
        expect(named.calls.find((call) => call.startsWith('gcloud run deploy'))).toMatch(
          /^gcloud run deploy try-it .*--max-instances=4 /,
        );
      });

      it('--demo-only refuses sign-in, service-account mode and IAP before any gcloud call', () => {
        const cases: readonly (readonly [readonly string[], string])[] = [
          [
            ['--oauth-client-id', '12345678901-abc.apps.googleusercontent.com'],
            'leave out --oauth-client-id',
          ],
          [['--sa-mode'], 'leave out --sa-mode and --sa-strict-exposure'],
          [['--iap'], 'leave out --iap'],
        ];
        for (const [flags, message] of cases) {
          const result = run('deploy.sh', ['--project', 'example-project', '--demo-only', ...flags], []);
          expect(result.status).toBe(1);
          expect(result.out).toContain(message);
          expect(result.calls).toEqual([]);
        }
      });

      it('--domain: a host name, in a region with domain mappings, never with --iap; refused before any gcloud call', () => {
        const cases: readonly (readonly [readonly string[], string])[] = [
          [
            ['--domain', 'demo.example.com'],
            'Cloud Run offers domain mappings in asia-east1, asia-northeast1',
          ],
          [['--region', 'europe-west1', '--domain', 'not a host'], '--domain must be a host name'],
          [['--region', 'europe-west1', '--domain', 'localhost'], '--domain must be a host name'],
          [['--region', 'europe-west1', '--domain', 'demo.example.com', '--iap'], 'not supported together'],
        ];
        for (const [flags, message] of cases) {
          const result = run('deploy.sh', ['--project', 'example-project', ...flags], []);
          expect(result.status, flags.join(' ')).toBe(1);
          expect(result.out).toContain(message);
          expect(result.calls).toEqual([]);
        }
        const west3 = run('deploy.sh', ['--project', 'example-project', '--domain', 'demo.example.com'], []);
        expect(west3.out).toContain('not in europe-west3. Deploy with --region europe-west1');
      });

      it('--domain maps the host, prints the exact DNS record, sees it in public DNS and waits for the certificate', () => {
        const result = run(
          'deploy.sh',
          [
            '--project',
            'example-project',
            '--region',
            'europe-west1',
            '--demo-only',
            '--domain',
            'Demo.Example.com.',
            ...IMAGE,
          ],
          demoRules([
            ['curl', `*--request GET*${MAPPINGS}/demo.example.com`, 1, 0, NOT_FOUND],
            ['curl', `*--request POST*${MAPPINGS}`, 1, 0, mapping('gcportrait-demo', 'Unknown', false)],
            [
              'curl',
              `*--request GET*${MAPPINGS}/demo.example.com`,
              1,
              0,
              mapping('gcportrait-demo', 'Unknown', false),
            ],
            [
              'curl',
              `*--request GET*${MAPPINGS}/demo.example.com`,
              2,
              0,
              mapping('gcportrait-demo', 'Unknown'),
            ],
            [
              'curl',
              `*--request GET*${MAPPINGS}/demo.example.com`,
              '*',
              0,
              mapping('gcportrait-demo', 'True'),
            ],
            ['curl', '*https://dns.google/resolve?name=demo.example.com&type=CNAME', '*', 0, DNS_CNAME],
          ]),
        );
        expect(result.status, result.out).toBe(0);
        const post = result.calls.find((call) => call.includes('--request POST')) ?? '';
        expect(post).toContain(
          '{"apiVersion":"domains.cloudrun.com/v1","kind":"DomainMapping","metadata":{"name":"demo.example.com","namespace":"example-project"},"spec":{"routeName":"gcportrait-demo","certificateMode":"AUTOMATIC"}}',
        );
        expect(result.out).toContain('created the domain mapping demo.example.com -> gcportrait-demo');
        expect(result.out).toContain('  demo.example.com.  3600  IN  CNAME  ghs.googlehosted.com.');
        expect(result.out).toContain(
          '(name: demo in the zone example.com, type CNAME, value ghs.googlehosted.com.)',
        );
        // The records appeared at the second read (5 s), the certificate at the second check (30 s each).
        expect(result.calls.filter((call) => call.startsWith('sleep '))).toEqual([
          'sleep 5',
          'sleep 30',
          'sleep 30',
        ]);
        expect(result.out).toContain('https://demo.example.com is ready: the certificate is provisioned.');
        expect(result.out).toContain('Custom domain:    https://demo.example.com (ready)');
        // The token reaches curl on its standard input only.
        expect(result.calls.join('\n')).not.toContain(TOKEN);
        expect(result.out).not.toContain(TOKEN);
      });

      it('--domain waits for nothing while the DNS record is not public yet, and at most ten checks for the certificate', () => {
        const dnsMissing = run(
          'deploy.sh',
          [
            '--project',
            'example-project',
            '--region',
            'europe-west1',
            '--demo-only',
            '--domain',
            'demo.example.com',
            ...IMAGE,
          ],
          demoRules([
            ['curl', `*--request GET*${MAPPINGS}/demo.example.com`, 1, 0, NOT_FOUND],
            ['curl', `*--request POST*${MAPPINGS}`, 1, 0, mapping('gcportrait-demo', 'Unknown')],
            [
              'curl',
              `*--request GET*${MAPPINGS}/demo.example.com`,
              '*',
              0,
              mapping('gcportrait-demo', 'Unknown'),
            ],
            ['curl', '*https://dns.google/resolve*', '*', 0, DNS_NOTHING],
          ]),
        );
        expect(dnsMissing.status, dnsMissing.out).toBe(0);
        expect(dnsMissing.out).toContain('Public DNS does not show these records yet.');
        expect(dnsMissing.out).toContain(
          'Custom domain:    https://demo.example.com (mapped; waiting for the DNS records above)',
        );
        expect(dnsMissing.calls.filter((call) => call.startsWith('sleep 30'))).toEqual([]);

        const certificatePending = run(
          'deploy.sh',
          [
            '--project',
            'example-project',
            '--region',
            'europe-west1',
            '--demo-only',
            '--domain',
            'demo.example.com',
            ...IMAGE,
          ],
          demoRules([
            [
              'curl',
              `*--request GET*${MAPPINGS}/demo.example.com`,
              '*',
              0,
              mapping('gcportrait-demo', 'Unknown'),
            ],
            ['curl', '*https://dns.google/resolve*', '*', 0, DNS_CNAME],
          ]),
        );
        expect(certificatePending.status, certificatePending.out).toBe(0);
        // The mapping existed already: nothing created.
        expect(certificatePending.calls.filter((call) => call.includes('--request POST'))).toEqual([]);
        expect(certificatePending.out).toContain(
          'domain mapping demo.example.com (europe-west1) exists, to gcportrait-demo',
        );
        expect(certificatePending.calls.filter((call) => call === 'sleep 30')).toHaveLength(10);
        expect(certificatePending.out).toContain('Google is still provisioning the certificate');
      });

      it('--domain explains Search Console verification instead of asking Google for a mapping it would refuse', () => {
        const result = run(
          'deploy.sh',
          [
            '--project',
            'example-project',
            '--region',
            'europe-west1',
            '--demo-only',
            '--domain',
            'demo.gcportrait-example.dev',
            ...IMAGE,
          ],
          demoRules([['curl', `*--request GET*${MAPPINGS}/demo.gcportrait-example.dev`, '*', 0, NOT_FOUND]]),
        );
        expect(result.status, result.out).toBe(0);
        expect(result.calls.filter((call) => call.includes('--request POST'))).toEqual([]);
        expect(result.out).toContain(
          'domain: demo.gcportrait-example.dev, not verified by me@example.com yet',
        );
        expect(result.out).toContain('gcloud domains verify gcportrait-example.dev');
        expect(result.out).toContain(
          'gcportrait-example.dev.  TXT  "google-site-verification=TOKEN-FROM-SEARCH-CONSOLE"',
        );
        expect(result.out).toContain(
          '(not mapped: verify gcportrait-example.dev in Search Console first (above))',
        );
        // The service itself is deployed all the same.
        expect(result.calls.filter((call) => call.startsWith('gcloud run deploy'))).toHaveLength(1);
      });

      it('--domain stops before any change when the host is mapped to another service, and --dry-run creates nothing', () => {
        const elsewhere = run(
          'deploy.sh',
          [
            '--project',
            'example-project',
            '--region',
            'europe-west1',
            '--demo-only',
            '--domain',
            'demo.example.com',
            ...IMAGE,
          ],
          demoRules([
            ['curl', `*--request GET*${MAPPINGS}/demo.example.com`, '*', 0, mapping('website', 'True')],
          ]),
        );
        expect(elsewhere.status).toBe(1);
        expect(elsewhere.out).toContain(
          'the domain demo.example.com is mapped to the Cloud Run service website in europe-west1, so deploy.sh does not map it to gcportrait-demo',
        );
        expect(
          elsewhere.calls.filter((call) => call.startsWith('gcloud run deploy') || call.includes(' create ')),
        ).toEqual([]);

        const dryRun = run(
          'deploy.sh',
          [
            '--project',
            'example-project',
            '--region',
            'europe-west1',
            '--demo-only',
            '--domain',
            'demo.example.com',
            '--dry-run',
            ...IMAGE,
          ],
          demoRules([['curl', `*--request GET*${MAPPINGS}/demo.example.com`, '*', 0, NOT_FOUND]]),
        );
        expect(dryRun.status, dryRun.out).toBe(0);
        expect(dryRun.out).toContain(`+ POST ${MAPPINGS}`);
        expect(
          dryRun.calls.filter(
            (call) => call.includes('--request POST') || call.startsWith('gcloud run deploy'),
          ),
        ).toEqual([]);
        expect(dryRun.out).toContain(
          'Custom domain:    https://demo.example.com (would be mapped (dry run))',
        );
        expect(dryRun.out).toContain(`Address:          ${DEMO_ADDRESS}`);
      });

      describe('--legal-dir', () => {
        /** Writes `files` into a directory `dir` of the test's tree, and answers its path. */
        const legal = (files: Record<string, string | Uint8Array>, dir = 'legal'): string => {
          for (const [name, content] of Object.entries(files)) tree().write(`${dir}/${name}`, content);
          return path.join(tree().root, dir);
        };
        const bundle = (dir: string) =>
          spawnSync(
            'bash',
            ['-c', '. "$1"; legal_bundle "$2"', 'bash', path.join(REPO, 'infra', 'common.sh'), dir],
            {
              encoding: 'utf8',
              env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
            },
          );
        /** Synthetic texts only (agents.md, Data and graph semantics). */
        const IMPRESSUM =
          '# Impressum\n\nExample Operator  \nExample Street 1, 12345 Example City\n\nÄ ö ü ß – “quotes”\n';
        const PRIVACY = '# Privacy\r\n\r\nNothing about you is stored.\r\n';

        it('ships both texts as LEGAL_BUNDLE, a JSON object of their base64, and says so without printing them', () => {
          const dir = legal({ 'impressum.md': IMPRESSUM, 'privacy.md': PRIVACY, 'notes.txt': 'not shipped' });
          const made = bundle(dir);
          expect(made.status, made.stderr).toBe(0);
          const parsed = JSON.parse(made.stdout) as Record<string, string>;
          expect(Object.keys(parsed)).toEqual(['impressum', 'privacy']);
          expect(Buffer.from(parsed.impressum ?? '', 'base64').toString('utf8')).toBe(IMPRESSUM);
          expect(Buffer.from(parsed.privacy ?? '', 'base64').toString('utf8')).toBe(PRIVACY);

          const result = run(
            'deploy.sh',
            ['--project', 'example-project', '--demo-only', '--legal-dir', dir, ...IMAGE],
            demoRules(),
          );
          expect(result.status, result.out).toBe(0);
          expect(result.out).toContain('      LEGAL_BUNDLE: (the texts of --legal-dir, base64)');
          expect(result.out).toContain(
            'Legal pages:      /impressum /privacy (from --legal-dir; the footer links them)',
          );
          expect(result.out).not.toContain(parsed.impressum ?? 'missing');
          expect(result.out).not.toContain('Example Street');
        });

        it('refuses what the backend would refuse, before any gcloud call', () => {
          const cases: readonly (readonly [Record<string, string | Uint8Array>, string])[] = [
            [{ 'notes.txt': 'x' }, 'holds neither impressum.md nor privacy.md'],
            [{ 'impressum.md': ' \n\t\n' }, 'impressum.md is empty'],
            [{ 'privacy.md': new Uint8Array([0x23, 0x20, 0xff]) }, 'privacy.md is not valid UTF-8'],
            [{ 'privacy.md': 'bell \u0007' }, 'privacy.md contains control characters'],
            [{ 'privacy.md': 'nul \u0000 byte' }, 'privacy.md contains control characters'],
            [{ 'impressum.md': 'x'.repeat(11 * 1024 + 1) }, 'impressum.md is larger than 11 KiB'],
          ];
          for (const [index, [files, message]] of cases.entries()) {
            const dir = legal(files, `legal-${String(index)}`);
            const result = run('deploy.sh', ['--project', 'example-project', '--legal-dir', dir], []);
            expect(result.status, message).toBe(1);
            expect(result.out).toContain('error: --legal-dir: ');
            expect(result.out).toContain(message);
            expect(result.calls).toEqual([]);
          }
          const missing = run(
            'deploy.sh',
            ['--project', 'example-project', '--legal-dir', '/no/such/dir'],
            [],
          );
          expect(missing.out).toContain('--legal-dir: /no/such/dir is not a directory');
        });
      });

      describe('--impressum-url and --privacy-url (legal pages linked, not served)', () => {
        const IMPRESSUM_URL = 'https://operator.example.com/legal/impressum';
        const PRIVACY_URL = 'https://operator.example.com/legal/privacy';
        const legalDir = (files: Record<string, string>): string => {
          for (const [name, content] of Object.entries(files)) tree().write(`legal/${name}`, content);
          return path.join(tree().root, 'legal');
        };

        it('sets LEGAL_IMPRESSUM_URL and LEGAL_PRIVACY_URL, and the summary and the demo-only notes name them', () => {
          const result = run(
            'deploy.sh',
            [
              '--project',
              'example-project',
              '--demo-only',
              '--impressum-url',
              ` ${IMPRESSUM_URL} `,
              '--privacy-url',
              PRIVACY_URL,
              ...IMAGE,
            ],
            demoRules(),
          );
          expect(result.status, result.out).toBe(0);
          expect(result.out).toContain(`      LEGAL_IMPRESSUM_URL: '${IMPRESSUM_URL}'`);
          expect(result.out).toContain(`      LEGAL_PRIVACY_URL: '${PRIVACY_URL}'`);
          expect(result.out).not.toContain('LEGAL_BUNDLE');
          expect(result.out).toContain(
            `Impressum:        ${IMPRESSUM_URL} (--impressum-url; in /api/config for the footer)`,
          );
          expect(result.out).toContain(
            `Privacy notice:   ${PRIVACY_URL} (--privacy-url; in /api/config for the footer)`,
          );
          expect(result.out).toContain(
            `Legal pages linked on your own site: Impressum ${IMPRESSUM_URL} privacy notice ${PRIVACY_URL}`,
          );
          expect(result.out).not.toContain('No legal pages');
          // The redeploy line repeats the flags, so a redeploy keeps the links (deploy.sh is declarative).
          expect(result.out).toMatch(
            /Redeploy with the same settings: .*--privacy-url https:\/\/operator\.example\.com\/legal\/privacy/,
          );
        });

        it('may link one page while --legal-dir serves the other', () => {
          const dir = legalDir({ 'impressum.md': '# Impressum\n\nExample Operator\n' });
          const result = run(
            'deploy.sh',
            [
              '--project',
              'example-project',
              '--demo-only',
              '--legal-dir',
              dir,
              '--privacy-url',
              PRIVACY_URL,
              ...IMAGE,
            ],
            demoRules(),
          );
          expect(result.status, result.out).toBe(0);
          expect(result.out).toContain('      LEGAL_BUNDLE: (the texts of --legal-dir, base64)');
          expect(result.out).toContain(`      LEGAL_PRIVACY_URL: '${PRIVACY_URL}'`);
          expect(result.out).not.toContain('LEGAL_IMPRESSUM_URL');
          expect(result.out).toContain(
            'Legal pages:      /impressum (from --legal-dir; the footer links them)',
          );
        });

        it('refuses a page linked and served at once, and what the backend would refuse, before any gcloud call', () => {
          const dir = legalDir({ 'impressum.md': '# Impressum\n', 'privacy.md': '# Privacy\n' });
          for (const [flag, page] of [
            ['--impressum-url', 'impressum'],
            ['--privacy-url', 'privacy'],
          ] as const) {
            const both = run(
              'deploy.sh',
              [
                '--project',
                'example-project',
                '--legal-dir',
                dir,
                flag,
                `https://operator.example.com/${page}`,
              ],
              [],
            );
            expect(both.status, both.out).toBe(1);
            expect(both.out).toContain(
              `error: ${flag} and --legal-dir's ${page}.md are the same page: link it or serve the text, not both`,
            );
            expect(both.calls).toEqual([]);
          }
          const refused: readonly (readonly [string, string])[] = [
            ['http://operator.example.com/impressum', 'must be an https:// URL'],
            ['javascript:alert(1)', 'must be an https:// URL'],
            ['/legal/impressum', 'must be an https:// URL'],
            ['https://', 'must be an https:// URL'],
            ['https://exa mple.com/impressum', 'must be an https:// URL'],
            ['https://bad_host/impressum', 'must be an https:// URL'],
            ['https://user:password@operator.example.com/impressum', 'must not hold a user name or password'],
            [`https://operator.example.com/${'x'.repeat(2048)}`, 'must be at most 2048 characters'],
            ['   ', 'must be an https:// URL'],
          ];
          for (const flag of ['--impressum-url', '--privacy-url']) {
            for (const [value, message] of refused) {
              const result = run('deploy.sh', ['--project', 'example-project', flag, value], []);
              expect(result.status, `${flag} ${value}`).toBe(1);
              expect(result.out).toContain(`error: ${flag} ${message}`);
              expect(result.calls).toEqual([]);
            }
          }
        });

        it('tells a demo-only deploy without any legal page how to add them, once', () => {
          const result = run(
            'deploy.sh',
            ['--project', 'example-project', '--demo-only', ...IMAGE],
            demoRules(),
          );
          expect(result.status, result.out).toBe(0);
          const count = (text: string): number => result.out.split(text).length - 1;
          // Step 2 of the next steps says it, with the command that adds them; the Demo-only block does not repeat it.
          expect(result.out).toContain(
            '2. Add legal pages: a public demo usually needs an Impressum and a privacy notice.',
          );
          expect(count('usually needs an Impressum and a privacy notice')).toBe(1);
          expect(count('--impressum-url and --privacy-url, or serve texts with --legal-dir')).toBe(1);
          expect(result.out).toMatch(/then redeploy: .*--impressum-url URL --privacy-url URL/);
          expect(result.out).not.toContain('No legal pages');
        });
      });

      describe('uninstall.sh and domain mappings', () => {
        const LIST =
          '{"items": [{"metadata": {"name": "demo.example.com"}, "spec": {"routeName": "gcportrait-demo"}}, ' +
          '{"metadata": {"name": "www.example.com"}, "spec": {"routeName": "website"}}, ' +
          '{"metadata": {"name": "try.example.com"}, "spec": {"routeName": "gcportrait-demo"}}]}\\n200';
        const uninstallRules = (region: string): readonly Rule[] => [
          ...instanceOnly(`cloud.googleapis.com/location=${region};managed-by=gcportrait-deploy`),
          ['curl', `*--request GET*${MAPPINGS}`, '*', 0, LIST],
          ['curl', `*--request DELETE*${MAPPINGS}/*`, '*', 0, '{}\\n200'],
          ['gcloud', '* delete *', '*', 0, ''],
        ];

        it('deletes the mappings that route to the service, first, and keeps the others', () => {
          const result = run(
            'uninstall.sh',
            [
              '--project',
              'example-project',
              '--region',
              'europe-west1',
              '--service',
              'gcportrait-demo',
              '--yes',
            ],
            uninstallRules('europe-west1'),
          );
          expect(result.status, result.out).toBe(0);
          const deletions = result.calls.filter(
            (call) => call.includes('--request DELETE') || call.includes(' delete '),
          );
          expect(deletions.map((call) => call.replace(/^curl .* (\S+)$/, 'curl $1'))).toEqual([
            `curl ${MAPPINGS}/demo.example.com`,
            `curl ${MAPPINGS}/try.example.com`,
            'gcloud run services delete gcportrait-demo --project=example-project --region=europe-west1 --quiet',
          ]);
          expect(result.out).toContain('domain mapping: demo.example.com (routes to gcportrait-demo)');
          expect(result.out).not.toContain('www.example.com');
          expect(result.calls.join('\n')).not.toContain(TOKEN);

          const dryRun = run(
            'uninstall.sh',
            [
              '--project',
              'example-project',
              '--region',
              'europe-west1',
              '--service',
              'gcportrait-demo',
              '--dry-run',
            ],
            uninstallRules('europe-west1'),
          );
          expect(dryRun.status, dryRun.out).toBe(0);
          expect(dryRun.out).toContain(`+ DELETE ${MAPPINGS}/try.example.com`);
          expect(
            dryRun.calls.filter((call) => call.includes('--request DELETE') || call.includes(' delete ')),
          ).toEqual([]);
        });

        it('does not look for mappings in a region without them', () => {
          const result = run(
            'uninstall.sh',
            ['--project', 'example-project', '--yes'],
            uninstallRules('europe-west3'),
          );
          expect(result.status, result.out).toBe(0);
          expect(result.calls.filter((call) => call.startsWith('curl'))).toEqual([]);
        });
      });

      it('json_flatten reads Google’s JSON without jq, strings, numbers and nesting included', () => {
        const flattened = spawnSync(
          'bash',
          ['-c', '. "$1"; json_flatten', 'bash', path.join(REPO, 'infra', 'common.sh')],
          {
            encoding: 'utf8',
            input: '{"a": {"b": [1, {"c": "x, y [z]"}], "d": true}, "e": null, "f": "q\\"r"}',
            env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
          },
        );
        expect(flattened.stdout.split('\n').filter(Boolean)).toEqual([
          'a.b.0\t1',
          'a.b.1.c\tx, y [z]',
          'a.d\ttrue',
          'e\tnull',
          'f\tq\\"r',
        ]);
      });
    });
  },
);
