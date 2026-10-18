// SPDX-License-Identifier: Apache-2.0
/**
 * infra/install.sh, the one-line installer the website serves, end to end with bash: the release's deploy scripts as
 * scripts/release-assets.sh writes them (the files .github/workflows/release.yml attaches to a release), served by a
 * stand-in for GitHub's downloads from a local directory, then the release's own deploy.sh against the stand-ins for
 * `gcloud` and `curl` of scripts/testing/infra-stub.ts. Nothing here reaches GitHub or Google.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { brandingConstant } from './testing/branding.js';
import {
  ALL_APIS,
  BASH_AVAILABLE,
  EMPTY_PROJECT,
  STUB,
  changesIn,
  read,
  type Rule,
} from './testing/infra-stub.js';
import { REPO, createTempTree, type TempTree } from './testing/temp-tree.js';

const REPOSITORY = 'florianchrometz/gcportrait';
const DOWNLOADS = `github.com/${REPOSITORY}/releases/download`;
const LATEST_API = `api.github.com/repos/${REPOSITORY}/releases/latest`;
const LATEST_PAGE = `github.com/${REPOSITORY}/releases/latest`;
/** The image deploy.sh deploys for release v1.2.3, through the remote repository in the project. */
const IMAGE_1_2_3 = 'europe-west3-docker.pkg.dev/example-project/ghcr/florianchrometz/gcportrait:1.2.3';

/**
 * The stand-in for curl: github.com and api.github.com answer from $WEB_DIR, a file per address (WEB_DIR/HOST/PATH;
 * PATH.redirect holds where an address redirects to, PATH.fail the error a download of it fails with), or a 404;
 * with $WEB_DIR/offline nothing answers. Every other address goes to the rule stand-in in $RULES_BIN, as deploy.sh's
 * calls to ghcr.io and the instance do.
 */
const WEB_CURL = `#!/usr/bin/env bash
all=("$@")
url="" out="" write="" fail=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output | -o) out="$2"; shift 2 ;;
    --write-out | -w) write="$2"; shift 2 ;;
    --header | -H | --max-time | --proto | --retry) shift 2 ;;
    --fail | -f | -fsSL | -fsS) fail=1; shift ;;
    http://* | https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
case "$url" in
  https://github.com/* | https://api.github.com/*) ;;
  *) exec "$RULES_BIN/curl" "\${all[@]}" ;;
esac
printf '%s\\n' "$url" >>"$STUB_DIR/web"
if [ -e "$WEB_DIR/offline" ]; then echo "curl: (6) Could not resolve host" >&2; exit 6; fi
file="$WEB_DIR/\${url#https://}"
if [ -f "$file.fail" ]; then cat "$file.fail" >&2; exit 7; fi
if [ "$write" = '%{redirect_url}' ]; then
  if [ -f "$file.redirect" ]; then cat "$file.redirect"; fi
  exit 0
fi
if [ -f "$file" ]; then
  if [ -n "$out" ]; then cp "$file" "$out"; else cat "$file"; fi
  exit 0
fi
if [ "$fail" = 1 ]; then echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; fi
printf 'Not Found'
`;

/** What one run of the installer did. */
type Install = {
  readonly status: number | null;
  readonly out: string;
  /** The calls of gcloud and curl that reached the rule stand-ins (deploy.sh's). */
  readonly calls: string[];
  /** The addresses asked of GitHub's stand-in, in order. */
  readonly web: string[];
};

/** The absolute path of a tool of this machine, or undefined. */
function which(tool: string): string | undefined {
  const found = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
  return found.status === 0 ? found.stdout.trim() : undefined;
}

// Each test runs the installer and the release's deploy.sh end to end, a few hundred stand-in processes for the
// longest ones, hence the generous limit.
describe.skipIf(!BASH_AVAILABLE)(
  'install.sh (bash, against a stand-in for GitHub and the stand-ins)',
  { timeout: 60_000 },
  () => {
    let tree: TempTree;
    let runs = 0;
    const bash = which('bash') ?? 'bash';

    beforeEach(() => {
      tree = createTempTree('install');
      // gcloud and sleep answer from the rules; curl serves GitHub's addresses itself and passes the rest on.
      for (const tool of ['gcloud', 'sleep']) tree.write(`bin/${tool}`, STUB);
      tree.write('rules-bin/curl', STUB);
      tree.write('bin/curl', WEB_CURL);
      for (const file of ['bin/gcloud', 'bin/sleep', 'bin/curl', 'rules-bin/curl'])
        chmodSync(path.join(tree.root, file), 0o755);
      // The installer's working directory, and TMPDIR, which must be empty again after each run.
      tree.write('tmp/.keep', '');
      tree.write('work/.keep', '');
    });

    afterEach(() => {
      tree.remove();
    });

    const web = (relPath: string): string => path.join(tree.root, 'web', relPath);

    /** Publishes release `tag` as release.yml does: the files of scripts/release-assets.sh in its download folder. */
    function publish(tag: string): string {
      const out = web(`${DOWNLOADS}/${tag}`);
      const made = spawnSync(
        'bash',
        [path.join(REPO, 'scripts', 'release-assets.sh'), '--tag', tag, '--out', out],
        {
          encoding: 'utf8',
        },
      );
      expect(made.status, made.stderr).toBe(0);
      return out;
    }

    /** The GitHub API's answer for the newest release (abridged; the API pretty-prints its JSON). */
    function latestIs(tag: string): void {
      tree.write(
        `web/${LATEST_API}`,
        `{\n  "url": "https://api.github.com/repos/${REPOSITORY}/releases/1",\n  "tag_name": "${tag}",\n  "name": "gcportrait ${tag.slice(1)}"\n}\n`,
      );
    }

    const deployRules: readonly Rule[] = [
      ['gcloud', 'services list --enabled*', '*', 0, ALL_APIS],
      ['gcloud', 'run deploy *', '*', 0, 'Done.\\n'],
      ...EMPTY_PROJECT,
    ];

    function install(
      args: readonly string[],
      options: {
        readonly rules?: readonly Rule[];
        readonly pipe?: boolean;
        readonly path?: string;
      } = {},
    ): Install {
      runs += 1;
      const state = `run-${String(runs)}`;
      tree.write(
        `${state}/rules`,
        `${(options.rules ?? deployRules).map((rule) => rule.join('|')).join('\n')}\n`,
      );
      tree.write(`${state}/calls`, '');
      tree.write(`${state}/web`, '');
      const script = path.join(REPO, 'infra', 'install.sh');
      const result = spawnSync(bash, options.pipe === true ? ['-s', '--', ...args] : [script, ...args], {
        cwd: path.join(tree.root, 'work'),
        encoding: 'utf8',
        input: options.pipe === true ? read('infra/install.sh') : '',
        env: {
          PATH: options.path ?? `${path.join(tree.root, 'bin')}:/usr/bin:/bin`,
          STUB_DIR: path.join(tree.root, state),
          RULES_BIN: path.join(tree.root, 'rules-bin'),
          WEB_DIR: path.join(tree.root, 'web'),
          TMPDIR: path.join(tree.root, 'tmp'),
          LC_ALL: 'C',
        },
      });
      const lines = (file: string) => tree.read(`${state}/${file}`).split('\n').filter(Boolean);
      return {
        status: result.status,
        out: `${result.stdout}${result.stderr}`,
        calls: lines('calls'),
        web: lines('web'),
      };
    }

    /** The directories of the working directory, but the placeholder. */
    const kept = (): string[] =>
      readdirSync(path.join(tree.root, 'work'))
        .filter((name) => name !== '.keep')
        .sort();
    /** Whether the installer's download folders are all gone (deploy.sh's own temporary files included). */
    const tmpIsClean = (): boolean =>
      readdirSync(path.join(tree.root, 'tmp')).every((name) => name === '.keep');
    const deployedImage = (calls: readonly string[]) =>
      /--image=(\S+)/.exec(calls.find((call) => call.startsWith('gcloud run deploy')) ?? '')?.[1];

    describe('the release assets it downloads (scripts/release-assets.sh, attached by release.yml)', () => {
      it('are the deploy scripts with the tag in VERSION, never the build context, and checksums of every asset', () => {
        const out = publish('v1.2.3');
        writeFileSync(
          path.join(out, 'gcportrait-1.2.3-linux-amd64.spdx.json'),
          '{"spdxVersion":"SPDX-2.3"}\n',
        );
        const again = spawnSync(
          'bash',
          [path.join(REPO, 'scripts', 'release-assets.sh'), '--tag', 'v1.2.3', '--out', out],
          {
            encoding: 'utf8',
          },
        );
        expect(again.status, again.stderr).toBe(0);
        const listing = spawnSync('tar', ['-tzf', path.join(out, 'gcportrait-deploy-v1.2.3.tar.gz')], {
          encoding: 'utf8',
        });
        expect(
          listing.stdout
            .split('\n')
            .filter(Boolean)
            .map((member) => member.replace(/^\.\//, ''))
            .sort(),
        ).toEqual([
          'VERSION',
          'infra/',
          'infra/README.md',
          'infra/common.sh',
          'infra/deploy.sh',
          'infra/install.sh',
          'infra/uninstall.sh',
        ]);
        const version = spawnSync(
          'tar',
          ['-xzOf', path.join(out, 'gcportrait-deploy-v1.2.3.tar.gz'), 'VERSION'],
          {
            encoding: 'utf8',
          },
        );
        expect(version.stdout).toBe('v1.2.3\n');
        // One line per asset in sha256sum's form, the SBOM included and the list itself left out; each one checks.
        const sums = readFileSync(path.join(out, 'checksums.txt'), 'utf8');
        expect(
          sums
            .split('\n')
            .filter(Boolean)
            .map((line) => line.split(/\s+/)[1]),
        ).toEqual(['gcportrait-1.2.3-linux-amd64.spdx.json', 'gcportrait-deploy-v1.2.3.tar.gz']);
        const tool = which('sha256sum') !== undefined ? ['sha256sum', '-c'] : ['shasum', '-a', '256', '-c'];
        const check = spawnSync(tool[0] ?? '', [...tool.slice(1), 'checksums.txt'], {
          cwd: out,
          encoding: 'utf8',
        });
        expect(check.status, check.stdout + check.stderr).toBe(0);
      });

      it('come from the repository the deploy scripts name, so a fork changes all three together', () => {
        const constant = (file: string, name: string): string =>
          new RegExp(`^${name}="([^"]*)"$`, 'm').exec(read(file))?.[1] ?? '';
        expect(constant('infra/install.sh', 'REPOSITORY')).toBe(REPOSITORY);
        expect(constant('infra/common.sh', 'SOURCE_REPOSITORY')).toBe(`https://github.com/${REPOSITORY}`);
        expect(constant('infra/common.sh', 'PUBLISHED_IMAGE')).toBe(`ghcr.io/${REPOSITORY}`);
        expect(read('infra/deploy.sh')).not.toContain(`github.com/${REPOSITORY}`);
      });

      it('are what release.yml attaches to every release, with the installer line in the notes', () => {
        const workflow = read('.github/workflows/release.yml');
        expect(workflow).toContain('scripts/release-assets.sh --tag "$TAG" --out release-assets');
        expect(workflow).toMatch(/gh release create "\$TAG" "\$\{flags\[@\]\}" release-assets\/\*/);
        expect(read('infra/install.sh')).toContain('archive="gcportrait-deploy-${tag}.tar.gz"');
        expect(read('scripts/release-assets.sh')).toContain('ARCHIVE="gcportrait-deploy-${TAG}.tar.gz"');
      });
    });

    it('with --project alone: the newest release, checked, kept, and its deploy.sh run with its own image', () => {
      publish('v1.2.3');
      latestIs('v1.2.3');
      const result = install(['--project', 'example-project']);
      expect(result.status, result.out).toBe(0);
      expect(result.web).toEqual([
        `https://${LATEST_API}`,
        `https://${DOWNLOADS}/v1.2.3/gcportrait-deploy-v1.2.3.tar.gz`,
        `https://${DOWNLOADS}/v1.2.3/checksums.txt`,
      ]);
      // Every step said, in order, then deploy.sh of the release.
      const steps = [
        'gcportrait install.sh',
        '==> Checking the tools',
        '==> Finding the newest release',
        'v1.2.3 (the GitHub API)',
        '==> Downloading the deploy scripts of v1.2.3',
        '==> Checking the SHA-256 of gcportrait-deploy-v1.2.3.tar.gz',
        ': as checksums.txt says',
        '==> Keeping the scripts in gcportrait-v1.2.3',
        '==> Running deploy.sh of v1.2.3',
        '    + gcportrait-v1.2.3/infra/deploy.sh --image v1.2.3 --project example-project',
        'gcportrait infra/deploy.sh',
        'gcportrait is deployed',
      ];
      const at = steps.map((step) => result.out.indexOf(step));
      expect(
        at.every((index, n) => index >= 0 && (n === 0 || index > (at[n - 1] ?? 0))),
        result.out,
      ).toBe(true);
      expect(kept()).toEqual(['gcportrait-v1.2.3']);
      expect(read('infra/deploy.sh')).toBe(tree.read('work/gcportrait-v1.2.3/infra/deploy.sh'));
      expect(tree.read('work/gcportrait-v1.2.3/VERSION')).toBe('v1.2.3\n');
      expect(existsSync(path.join(tree.root, 'work/gcportrait-v1.2.3/infra/Dockerfile'))).toBe(false);
      expect(tmpIsClean()).toBe(true);
      // The release's image, through the remote repository.
      expect(deployedImage(result.calls)).toBe(IMAGE_1_2_3);
      expect(result.calls.find((call) => call.includes('https://ghcr.io/v2/'))).toMatch(
        /gcportrait\/manifests\/1\.2\.3$/,
      );
      // The commands it ends with name the scripts where the installer kept them, with the release's image.
      expect(result.out).toContain(
        '       gcportrait-v1.2.3/infra/deploy.sh --image v1.2.3 --project example-project --oauth-client-id CLIENT_ID\n',
      );
      expect(result.out).toContain(
        'Redeploy with the same settings: gcportrait-v1.2.3/infra/deploy.sh --image v1.2.3 --project example-project\n',
      );
      expect(result.out).toContain(
        'Remove everything this script created: gcportrait-v1.2.3/infra/uninstall.sh --project example-project',
      );
      // Those commands run as printed: the scripts are executable.
      const redeploy = spawnSync('gcportrait-v1.2.3/infra/deploy.sh', ['--help'], {
        cwd: path.join(tree.root, 'work'),
        encoding: 'utf8',
      });
      expect(redeploy.status, redeploy.stderr).toBe(0);
    });

    it('works through a pipe, as `curl … | bash -s --` runs it', () => {
      publish('v1.2.3');
      latestIs('v1.2.3');
      const result = install(['--project', 'example-project', '--dry-run'], { pipe: true });
      expect(result.status, result.out).toBe(0);
      expect(result.out).toContain('Dry run finished');
      expect(changesIn(result.calls)).toEqual([]);
    });

    it('passes every other flag to deploy.sh unchanged, and exits with its status', () => {
      publish('v1.2.3');
      latestIs('v1.2.3');
      const dryRun = install([
        '--dry-run',
        '--project',
        'example-project',
        '--region',
        'europe-west1',
        '--service',
        'team-portrait',
        '--hosted-by',
        'Example Ltd IT',
      ]);
      expect(dryRun.status, dryRun.out).toBe(0);
      expect(dryRun.out).toContain(
        '    + gcportrait-v1.2.3/infra/deploy.sh --image v1.2.3 --dry-run --project example-project --region europe-west1 --service team-portrait --hosted-by Example\\ Ltd\\ IT\n',
      );
      expect(dryRun.out).toContain(
        '+ gcloud run deploy team-portrait --project=example-project --region=europe-west1 --image=europe-west1-docker.pkg.dev/example-project/ghcr/florianchrometz/gcportrait:1.2.3',
      );
      expect(dryRun.out).toContain("      HOSTED_BY: 'Example Ltd IT'");
      expect(changesIn(dryRun.calls)).toEqual([]);

      // deploy.sh's own refusal and its own exit status, 1 for a refusal and the failing command's otherwise.
      const refused = install(['--project', 'example-project', '--region', 'nowhere']);
      expect(refused.status).toBe(1);
      expect(refused.out).toContain('--region must be a Cloud Run region such as europe-west3');
      const failed = install(['--project', 'example-project'], {
        rules: [
          ['gcloud', 'run deploy *', '*', 3, 'ERROR: (gcloud.run.deploy) something else\\n'],
          ...deployRules,
        ],
      });
      expect(failed.status).toBe(3);
      expect(failed.out).toContain('deploy.sh stopped during "Deploying the Cloud Run service"');
    });

    it('--version pins a release without asking for the newest; --image names another image', () => {
      publish('v1.1.0');
      publish('v1.2.3');
      latestIs('v1.2.3');
      for (const version of ['v1.1.0', '1.1.0']) {
        const result = install(['--version', version, '--project', 'example-project']);
        expect(result.status, result.out).toBe(0);
        expect(result.web).toEqual([
          `https://${DOWNLOADS}/v1.1.0/gcportrait-deploy-v1.1.0.tar.gz`,
          `https://${DOWNLOADS}/v1.1.0/checksums.txt`,
        ]);
        expect(result.out).toContain('==> The release: v1.1.0 (--version)');
        expect(deployedImage(result.calls)).toBe(IMAGE_1_2_3.replace('1.2.3', '1.1.0'));
      }
      // The same release twice: the second run uses the folder of the first as it is.
      expect(kept()).toEqual(['gcportrait-v1.1.0']);

      const image = install([
        '--project',
        'example-project',
        '--image',
        'registry.example.com/team/gcportrait:7',
      ]);
      expect(image.status, image.out).toBe(0);
      expect(image.out).toContain("--image is given, so it deploys that image, not release v1.2.3's own");
      expect(image.out).toContain(
        '    + gcportrait-v1.2.3/infra/deploy.sh --project example-project --image registry.example.com/team/gcportrait:7\n',
      );
      expect(deployedImage(image.calls)).toBe('registry.example.com/team/gcportrait:7');

      const bad = install(['--version', 'v1.2', '--project', 'example-project']);
      expect(bad.status).toBe(1);
      expect(bad.out).toContain('--version must be a release tag such as v1.2.3');
      expect(bad.web).toEqual([]);
    });

    it('asks github.com where /releases/latest leads when the API refuses, and says when there is no release yet', () => {
      publish('v1.2.3');
      tree.write(`web/${LATEST_PAGE}.redirect`, `https://github.com/${REPOSITORY}/releases/tag/v1.2.3`);
      const result = install(['--project', 'example-project', '--dry-run']);
      expect(result.status, result.out).toBe(0);
      expect(result.web.slice(0, 2)).toEqual([`https://${LATEST_API}`, `https://${LATEST_PAGE}`]);
      expect(result.out).toContain('the GitHub API did not answer; asking github.com instead');
      expect(result.out).toContain('v1.2.3 (github.com)');

      // Before the first release, github.com sends /releases/latest to the list of releases.
      tree.write(`web/${LATEST_PAGE}.redirect`, `https://github.com/${REPOSITORY}/releases`);
      const none = install(['--project', 'example-project']);
      expect(none.status).toBe(1);
      expect(none.out).toContain('gcportrait has no release yet, so there is nothing to install.');
      expect(none.out).toContain(`git clone https://github.com/${REPOSITORY}.git`);
      expect(none.calls).toEqual([]);

      tree.write('web/offline', '');
      const offline = install(['--project', 'example-project']);
      expect(offline.status).toBe(1);
      expect(offline.out).toContain(
        'could not find the newest release: neither the GitHub API nor github.com answered',
      );
      const pinned = install(['--version', 'v1.2.3', '--project', 'example-project']);
      expect(pinned.status).toBe(1);
      expect(pinned.out).toContain(
        `could not download https://${DOWNLOADS}/v1.2.3/gcportrait-deploy-v1.2.3.tar.gz (curl: (6)`,
      );
      expect([...none.calls, ...offline.calls, ...pinned.calls]).toEqual([]);
      expect(kept()).toEqual(['gcportrait-v1.2.3']);
    });

    describe('runs nothing it did not verify', () => {
      beforeEach(() => {
        latestIs('v1.2.3');
      });

      /** Each refusal: exit 1, nothing unpacked, kept or run (deploy.sh never asked gcloud anything), nothing left behind. */
      const refusedBeforeAnything = (result: Install, message: string) => {
        expect(result.status, result.out).toBe(1);
        expect(result.out).toContain(message);
        expect(result.calls).toEqual([]);
        expect(kept()).toEqual([]);
        expect(tmpIsClean()).toBe(true);
      };

      it('refuses an archive whose SHA-256 is not the one checksums.txt lists', () => {
        const out = publish('v1.2.3');
        // Another archive under the release's name: the one of another release, a valid archive of the same shape.
        const other = publish('v1.2.4');
        writeFileSync(
          path.join(out, 'gcportrait-deploy-v1.2.3.tar.gz'),
          readFileSync(path.join(other, 'gcportrait-deploy-v1.2.4.tar.gz')),
        );
        const result = install(['--project', 'example-project']);
        refusedBeforeAnything(result, 'the SHA-256 of the downloaded gcportrait-deploy-v1.2.3.tar.gz is ');
        expect(result.out).toContain("the file is not the release's, so nothing is unpacked or run.");
        expect(result.out).not.toContain('==> Keeping the scripts');
      });

      it('refuses when checksums.txt does not list the archive, or the release has no checksums at all', () => {
        const out = publish('v1.2.3');
        const sums = readFileSync(path.join(out, 'checksums.txt'), 'utf8');
        writeFileSync(path.join(out, 'checksums.txt'), sums.replace(/^.*gcportrait-deploy-.*\n/m, ''));
        refusedBeforeAnything(
          install(['--project', 'example-project']),
          'checksums.txt of release v1.2.3 lists no SHA-256 for gcportrait-deploy-v1.2.3.tar.gz, so nothing is unpacked or run.',
        );
        rmSync(path.join(out, 'checksums.txt'));
        const listless = install(['--project', 'example-project']);
        refusedBeforeAnything(
          listless,
          'release v1.2.3 has no checksums.txt (nor SHA256SUMS) to check gcportrait-deploy-v1.2.3.tar.gz against',
        );
        expect(listless.web.slice(-2)).toEqual([
          `https://${DOWNLOADS}/v1.2.3/checksums.txt`,
          `https://${DOWNLOADS}/v1.2.3/SHA256SUMS`,
        ]);
      });

      it('names the error when checksums.txt fails to download for another reason than a 404', () => {
        const out = publish('v1.2.3');
        writeFileSync(
          path.join(out, 'checksums.txt.fail'),
          'curl: (7) Failed to connect to github.com port 443\n',
        );
        const result = install(['--project', 'example-project']);
        refusedBeforeAnything(
          result,
          `could not download https://${DOWNLOADS}/v1.2.3/checksums.txt (curl: (7) Failed to connect to github.com port 443), so nothing is unpacked or run.`,
        );
        // It stops there: a connection that failed is no sign that the release has no checksums.txt.
        expect(result.out).not.toContain('has no checksums.txt');
        expect(result.web.at(-1)).toBe(`https://${DOWNLOADS}/v1.2.3/checksums.txt`);
      });

      it('takes SHA256SUMS, in sha256sum’s binary form too, where a release has no checksums.txt', () => {
        const out = publish('v1.2.3');
        const sums = readFileSync(path.join(out, 'checksums.txt'), 'utf8');
        const digest = sums
          .split('\n')
          .find((line) => line.endsWith('gcportrait-deploy-v1.2.3.tar.gz'))
          ?.split(/\s+/)[0];
        rmSync(path.join(out, 'checksums.txt'));
        writeFileSync(path.join(out, 'SHA256SUMS'), `${String(digest)} *gcportrait-deploy-v1.2.3.tar.gz\n`);
        const result = install(['--project', 'example-project', '--dry-run']);
        expect(result.status, result.out).toBe(0);
        expect(result.out).toContain(`    ${String(digest)}: as SHA256SUMS says`);
      });

      it('refuses a release without the deploy scripts, and an archive that holds anything else', () => {
        tree.write(`web/${DOWNLOADS}/v1.2.3/checksums.txt`, '');
        refusedBeforeAnything(
          install(['--project', 'example-project']),
          `could not download https://${DOWNLOADS}/v1.2.3/gcportrait-deploy-v1.2.3.tar.gz (curl: (22)`,
        );
        // An archive with the build context in it, listed with its right checksum: still not one of the deploy scripts.
        const out = publish('v1.2.3');
        const archive = path.join(out, 'gcportrait-deploy-v1.2.3.tar.gz');
        const stage = path.join(tree.root, 'stage');
        mkdirSync(stage);
        expect(spawnSync('tar', ['-xzf', archive, '-C', stage]).status).toBe(0);
        writeFileSync(path.join(stage, 'Dockerfile'), 'FROM scratch\n');
        const packed = spawnSync('tar', ['-czf', archive, '-C', stage, 'VERSION', 'infra', 'Dockerfile'], {
          env: { COPYFILE_DISABLE: '1', PATH: '/usr/bin:/bin' },
        });
        expect(packed.status).toBe(0);
        const tool = which('sha256sum') !== undefined ? ['sha256sum'] : ['shasum', '-a', '256'];
        const digest = spawnSync(tool[0] ?? '', [...tool.slice(1), 'gcportrait-deploy-v1.2.3.tar.gz'], {
          cwd: out,
          encoding: 'utf8',
        }).stdout;
        writeFileSync(path.join(out, 'checksums.txt'), digest);
        refusedBeforeAnything(
          install(['--project', 'example-project']),
          'gcportrait-deploy-v1.2.3.tar.gz holds Dockerfile, which is not one of the deploy scripts; nothing is unpacked or run.',
        );
      });
    });

    describe('its own refusals, before anything is downloaded', () => {
      it('without gcloud or curl: one line of advice each', () => {
        publish('v1.2.3');
        latestIs('v1.2.3');
        // PATHs of links to this machine's tar and SHA-256 tool, with and without the curl stand-in, but never a gcloud
        // (GitHub's runners have one in /usr/bin).
        const toolbox = (name: string, withCurl: boolean): string => {
          const dir = path.join(tree.root, name);
          mkdirSync(dir);
          const tools = [which('tar'), which('sha256sum') ?? which('shasum')];
          if (withCurl) tools.push(path.join(tree.root, 'bin', 'curl'));
          for (const tool of tools)
            if (tool !== undefined) symlinkSync(tool, path.join(dir, path.basename(tool)));
          return dir;
        };
        const noGcloud = install(['--project', 'example-project'], { path: toolbox('without-gcloud', true) });
        expect(noGcloud.status).toBe(1);
        expect(noGcloud.out).toContain(
          'error: the Google Cloud CLI (gcloud) is not installed: https://cloud.google.com/sdk/docs/install (Cloud Shell has it)\n',
        );
        const noCurl = install(['--project', 'example-project'], { path: toolbox('without-curl', false) });
        expect(noCurl.status).toBe(1);
        expect(noCurl.out).toContain(
          "error: curl is not installed: install it with your system's package manager\n",
        );
        for (const refused of [noGcloud, noCurl]) {
          expect(refused.web).toEqual([]);
          expect(refused.calls).toEqual([]);
        }
        expect(kept()).toEqual([]);
      });

      it('without --project, with --build, or with a bad option value; --help says what it takes', () => {
        const noProject = install(['--region', 'europe-west1']);
        expect(noProject.status).toBe(1);
        expect(noProject.out).toContain(
          '--project is required: the id of the Google Cloud project to deploy into',
        );
        const build = install(['--project', 'example-project', '--build']);
        expect(build.status).toBe(1);
        expect(build.out).toContain(
          `--build builds the image from a clone of the source, which the installer does not download: git clone https://github.com/${REPOSITORY}.git, then infra/deploy.sh --project YOUR_PROJECT --build`,
        );
        const noValue = install(['--project', 'example-project', '--dir']);
        expect(noValue.status).toBe(1);
        expect(noValue.out).toContain('--dir needs a value');
        for (const refused of [noProject, build, noValue]) expect(refused.web).toEqual([]);

        const help = install(['--help']);
        expect(help.status).toBe(0);
        expect(help.out.split('\n')[0]).toBe('gcportrait install.sh');
        expect(help.out).toContain(
          'curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project PROJECT_ID',
        );
        for (const flag of ['  --version TAG', '  --dir PATH', '  -h, --help'])
          expect(help.out).toContain(flag);
        // The long form closes --help, as it closes deploy.sh's.
        expect(help.out.trimEnd().split('\n\n').at(-1)?.replace(/\s+/g, ' ')).toBe(
          brandingConstant('NON_AFFILIATION_LONG'),
        );
        expect(help.web).toEqual([]);
      });
    });

    it('keeps the scripts in a fresh folder: the same release reused, another one beside it, --dir new or empty', () => {
      publish('v1.2.3');
      latestIs('v1.2.3');
      const first = install(['--project', 'example-project', '--dry-run']);
      expect(first.status, first.out).toBe(0);
      expect(first.out).toContain(
        '--dry-run: deploy.sh changes nothing in Google Cloud; the scripts stay here for the real run',
      );
      // A file the folder gained since (Finder's .DS_Store, say) does not make it another folder.
      tree.write('work/gcportrait-v1.2.3/.DS_Store', 'Finder\n');
      const same = install(['--project', 'example-project', '--dry-run']);
      expect(same.out).toContain('it holds these files already (the same release); using them as they are');
      expect(kept()).toEqual(['gcportrait-v1.2.3']);
      expect(install(['--project', 'example-project']).out).not.toContain('--dry-run: deploy.sh');
      // A folder of that name with other files is never touched: the scripts go beside it.
      tree.write('work/gcportrait-v1.2.3/infra/deploy.sh', '#!/usr/bin/env bash\necho changed\n');
      const beside = install(['--project', 'example-project', '--dry-run']);
      expect(beside.status, beside.out).toBe(0);
      expect(beside.out).toContain('==> Keeping the scripts in gcportrait-v1.2.3-2');
      expect(tree.read('work/gcportrait-v1.2.3/infra/deploy.sh')).toContain('echo changed');
      expect(kept()).toEqual(['gcportrait-v1.2.3', 'gcportrait-v1.2.3-2']);

      // --dir: the commands name the scripts there.
      const chosen = install(['--project', 'example-project', '--dir', 'tools/gcportrait', '--dry-run']);
      expect(chosen.status, chosen.out).toBe(0);
      expect(chosen.out).toContain(
        'Redeploy with the same settings: tools/gcportrait/infra/deploy.sh --image v1.2.3 --project example-project\n',
      );
      tree.write('work/occupied/notes.txt', 'mine\n');
      const occupied = install(['--project', 'example-project', '--dir', 'occupied']);
      expect(occupied.status).toBe(1);
      expect(occupied.out).toContain('--dir occupied holds other files; name a new or empty directory');
      expect(occupied.calls).toEqual([]);
      expect(tmpIsClean()).toBe(true);
    });

    it("the release's deploy.sh refuses --build itself, since a release's scripts are no clone", () => {
      publish('v1.2.3');
      latestIs('v1.2.3');
      expect(install(['--project', 'example-project', '--dry-run']).status).toBe(0);
      // Refused with the arguments, before gcloud is asked anything (no stand-in is on the PATH).
      const result = spawnSync(
        bash,
        ['gcportrait-v1.2.3/infra/deploy.sh', '--project', 'example-project', '--build'],
        {
          cwd: path.join(tree.root, 'work'),
          encoding: 'utf8',
          env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
        },
      );
      expect(result.status).toBe(1);
      // (The folder as bash sees it: on macOS the temporary directory is /var, a link to /private/var.)
      expect(result.stderr).toMatch(
        /--build needs a clone of the repository around this script \(\S*\/work\/gcportrait-v1\.2\.3 has no infra\/Dockerfile and pnpm-lock\.yaml\): git clone https:\/\/github\.com\/florianchrometz\/gcportrait\.git, then run its infra\/deploy\.sh/,
      );
    });
  },
);
