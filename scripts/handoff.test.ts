// SPDX-License-Identifier: MIT
/**
 * scripts/handoff.sh: the clean-repository hand-off, run with bash on a small fixture repository with
 * a `legacy/` tree, ignored build output and local files, and a stand-in for `pnpm` that logs its calls (the real
 * `pnpm install --frozen-lockfile && pnpm check` on a scratch copy of this repository is recorded in
 * docs/handoff.md). git runs for real, with a configuration of its own. The last tests hold docs/handoff.md to the
 * script and the workflows.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workspaceDirs } from './release-notes.mjs';
import { SCRIPTS_DIR, createTempTree, manifest, type TempTree } from './testing/temp-tree.js';
import { commandProblem, commandsIn, helpFlags } from './user-docs.mjs';

const REPO = path.resolve(SCRIPTS_DIR, '..');
const read = (relPath: string): string => readFileSync(path.join(REPO, relPath), 'utf8');

// The previous implementation's and its upstream's names, assembled so that this file does not contain them.
const OLD_NAME = ['kno', 'yog'].join('');
const UPSTREAM_NAME = ['gcp', 'viz'].join('');

const MD = '<!-- SPDX-License-Identifier: MIT -->';
const TS = '// SPDX-License-Identifier: MIT';
const HASH = '# SPDX-License-Identifier: MIT';

/** The pnpm stand-in: logs `cwd<TAB>args`; `install` writes into node_modules/, `check` exits as told. */
const PNPM_STUB = `#!/usr/bin/env bash
printf '%s\\t%s\\n' "$PWD" "$*" >>"$STUB_LOG"
case "$1" in
  install) mkdir -p node_modules/.pnpm && printf 'x\\n' >node_modules/.pnpm/lock.yaml ;;
  check)
    if [ -n "\${STUB_CHECK_WRITES:-}" ]; then printf 'x\\n' >"$STUB_CHECK_WRITES"; fi
    exit "\${STUB_CHECK_EXIT:-0}" ;;
esac
`;

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

let tree: TempTree;
/** tree.root with its symbolic links resolved (macOS's /var is /private/var), as the script prints paths. */
let root: string;
let source: string;
let env: NodeJS.ProcessEnv;

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

/** git's exit status only, for commands that may fail. */
function gitStatus(cwd: string, ...args: string[]): number | null {
  return spawnSync('git', args, { cwd, env, encoding: 'utf8' }).status;
}

function write(relPath: string, content: string): void {
  tree.write(path.join('build-site', relPath), content);
}

function copyFromRepo(relPath: string, mode = 0o644): void {
  const target = path.join(source, relPath);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(REPO, relPath), target);
  chmodSync(target, mode);
}

function handoff(args: readonly string[], extraEnv: NodeJS.ProcessEnv = {}): Run {
  const result = spawnSync('bash', [path.join(source, 'scripts/handoff.sh'), ...args], {
    cwd: source,
    env: { ...env, ...extraEnv },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The pnpm calls the stand-in logged: [cwd, args]. */
function pnpmCalls(): Array<[string, string]> {
  const log = path.join(root, 'pnpm.log');
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [cwd = '', args = ''] = line.split('\t');
      return [cwd, args];
    });
}

const lines = (text: string): string[] => text.split('\n').filter((line) => line !== '');

beforeEach(() => {
  tree = createTempTree('handoff');
  root = realpathSync(tree.root);
  source = path.join(root, 'build-site');
  tree.write('gitconfig', '[user]\n\tname = Fixture Maintainer\n\temail = maintainer@example.com\n');
  tree.write('bin/pnpm', PNPM_STUB);
  chmodSync(path.join(root, 'bin/pnpm'), 0o755);
  env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('GIT_') || name.startsWith('STUB_')) Reflect.deleteProperty(env, name);
  }
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = path.join(root, 'gitconfig');
  env.PATH = `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`;
  env.STUB_LOG = path.join(root, 'pnpm.log');

  write('package.json', manifest('MIT'));
  write('.gitignore', `${HASH}\nnode_modules/\n/out/\n/*/dist/\n.env\n*.log\n`);
  write('README.md', `${MD}\n\n# Fixture\n`);
  write(
    'docs/adr/0001-no-reuse.md',
    `${MD}\n\n# 0001\n\nThe previous implementation, ${OLD_NAME}, wrapped ${UPSTREAM_NAME}. Nothing from it.\n`,
  );
  write('docs/guide.md', `${MD}\n\n# Guide\n`);
  write(
    'backend/src/config.ts',
    `${TS}\nexport const DEFAULT_SOURCE_URL = 'https://github.com/example-owner/gcportrait';\n`,
  );
  write(
    'frontend/src/source.ts',
    `${TS}\nexport const DEFAULT_SOURCE_URL = 'https://github.com/example-owner/gcportrait';\n`,
  );
  write(
    '.github/workflows/pages.yml',
    `${HASH}\non: push\njobs:\n  a:\n    if: vars.PAGES_DEPLOY == 'true'\n    env:\n      B: \${{ secrets.WEBSITE_LEGAL_BUNDLE }}\n      T: \${{ secrets.GITHUB_TOKEN }}\n`,
  );
  write('infra/run.sh', `#!/usr/bin/env bash\n${HASH}\necho run\n`);
  chmodSync(path.join(source, 'infra/run.sh'), 0o755);
  write('legacy/README.md', '# The previous implementation\n');
  write('legacy/old/main.go', 'package main\n');
  copyFromRepo('scripts/handoff.sh', 0o755);
  copyFromRepo('scripts/check-provenance.mjs');
  copyFromRepo('scripts/lib/repo-files.mjs');
  git(source, 'init', '--quiet', '--initial-branch=main');
  git(source, 'add', '-A');
  git(source, 'commit', '--quiet', '-m', 'fixture');

  // Ignored, so never copied: dependencies, build output, scratch output, local settings and credentials.
  write('node_modules/left/index.js', 'module.exports = 1;\n');
  write('frontend/dist/app.js', 'app\n');
  write('out/render.png', 'png\n');
  write('.env', 'SECRET=1\n');
  write('debug.log', 'log\n');
  write('.oauth-client.local.txt', 'local only\n');
  writeFileSync(path.join(source, '.git/info/exclude'), '.oauth-client.local.txt\n');
});

afterEach(() => {
  tree.remove();
});

describe('scripts/handoff.sh', () => {
  it('copies what git lists without legacy/, checks it, and commits it once on main', () => {
    const run = handoff(['--message', 'gcportrait: the first commit']);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);

    const dest = path.join(root, 'gcportrait');
    const tracked = lines(git(source, 'ls-files'))
      .filter((file) => !file.startsWith('legacy/'))
      .sort();
    expect(lines(git(dest, 'ls-files')).sort()).toEqual(tracked);
    expect(existsSync(path.join(dest, 'legacy'))).toBe(false);
    for (const left of ['frontend/dist', 'out', '.env', 'debug.log', '.oauth-client.local.txt']) {
      expect(existsSync(path.join(dest, left)), left).toBe(false);
    }
    expect(readdirSync(path.join(dest, 'node_modules'))).toEqual(['.pnpm']); // from the install, not copied

    expect(git(dest, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
    expect(git(dest, 'log', '-1', '--format=%s%n%an <%ae>')).toBe(
      'gcportrait: the first commit\nFixture Maintainer <maintainer@example.com>\n',
    );
    expect(git(dest, 'branch', '--show-current').trim()).toBe('main');
    expect(git(dest, 'status', '--porcelain')).toBe('');
    expect(statSync(path.join(dest, 'infra/run.sh')).mode & 0o111).not.toBe(0);
    expect(git(dest, 'ls-files', '-s', 'infra/run.sh')).toMatch(/^100755 /);

    expect(pnpmCalls()).toEqual([
      [dest, 'install --frozen-lockfile'],
      [dest, 'check'],
    ]);
    expect(git(source, 'status', '--porcelain')).toBe('');
    expect(git(source, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
  });

  it('prints the next steps for the repository DEFAULT_SOURCE_URL names', () => {
    const run = handoff(['-m', 'initial']);
    expect(run.status).toBe(0);
    const dest = path.join(root, 'gcportrait');
    expect(run.stdout).toContain(
      `copied ${String(lines(git(dest, 'ls-files')).length)} files; left out legacy/ (2 files)`,
    );
    expect(run.stdout).toContain('Create the GitHub repository example-owner/gcportrait');
    expect(run.stdout).toContain(
      `cd ${dest}\n     git remote add origin https://github.com/example-owner/gcportrait.git`,
    );
    expect(run.stdout).toContain('git push -u origin main');
    expect(run.stdout).toContain(
      'the variables PAGES_DEPLOY\n   and the secrets WEBSITE_LEGAL_BUNDLE (and GitHub',
    );
    expect(run.stdout).toMatch(
      /DEFAULT_SOURCE_URL already names https:\/\/github\.com\/example-owner\/gcportrait/,
    );
    expect(run.stdout).toContain('nothing to change');
    expect(run.stdout).toContain('ghcr.io/example-owner/gcportrait');
    expect(run.stdout).toContain('git tag v1.0.0\n       git push origin v1.0.0');
  });

  it('says to set DEFAULT_SOURCE_URL when the tree is pushed to another repository', () => {
    const run = handoff(['-m', 'initial', '--repository', 'Another-Owner/portrait']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Set DEFAULT_SOURCE_URL to https://github.com/Another-Owner/portrait.');
    expect(run.stdout).toContain(
      "It is 'https://github.com/example-owner/gcportrait' in backend/src/config.ts",
    );
    expect(run.stdout).toContain('git remote add origin https://github.com/Another-Owner/portrait.git');
    expect(run.stdout).toContain('ghcr.io/another-owner/gcportrait');
  });

  it('refuses a checkout with uncommitted changes, and copies them as they are with --allow-dirty', () => {
    write('README.md', `${MD}\n\n# Fixture, edited\n`);
    write('docs/new.md', `${MD}\n\n# New\n`);
    unlinkSync(path.join(source, 'docs/guide.md'));
    const dest = path.join(root, 'gcportrait');

    const refused = handoff(['-m', 'initial']);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('uncommitted changes or untracked files');
    expect(refused.stderr).toContain(' M README.md');
    expect(existsSync(dest)).toBe(false);

    const run = handoff(['-m', 'initial', '--allow-dirty']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('left out 1 files that are deleted in the working tree');
    expect(readFileSync(path.join(dest, 'README.md'), 'utf8')).toContain('edited');
    expect(lines(git(dest, 'ls-files'))).toContain('docs/new.md');
    expect(lines(git(dest, 'ls-files'))).not.toContain('docs/guide.md');
  });

  it('ignores changes inside legacy/', () => {
    write('legacy/README.md', '# Edited\n');
    expect(handoff(['-m', 'initial']).status).toBe(0);
  });

  it('refuses a destination that exists or overlaps the repository, and usage errors, before copying', () => {
    tree.write('gcportrait/keep.txt', 'mine\n');
    const exists = handoff(['-m', 'initial']);
    expect(exists.status).toBe(2);
    expect(exists.stderr).toContain('already exists');
    expect(readdirSync(path.join(root, 'gcportrait'))).toEqual(['keep.txt']);

    const inside = handoff(['-m', 'initial', '--dest', path.join(source, 'docs/out')]);
    expect(inside.status).toBe(2);
    expect(inside.stderr).toContain('--dest must lie outside this repository');
    expect(existsSync(path.join(source, 'docs/out'))).toBe(false);

    const noParent = handoff(['-m', 'initial', '--dest', path.join(root, 'missing/new')]);
    expect(noParent.status).toBe(2);
    expect(noParent.stderr).toContain('does not exist');

    const noMessage = handoff([]);
    expect(noMessage.status).toBe(2);
    expect(noMessage.stderr).toContain('--message is required');
    expect(handoff(['-m', 'x', '--repository', 'not a repository']).status).toBe(2);
    expect(handoff(['-m', 'x', '--frobnicate']).stderr).toContain('unknown argument: --frobnicate');
    expect(pnpmCalls()).toEqual([]);
  });

  it('accepts an empty destination directory', () => {
    mkdirSync(path.join(root, 'empty'));
    expect(handoff(['-m', 'initial', '--dest', path.join(root, 'empty')]).status).toBe(0);
    expect(git(path.join(root, 'empty'), 'rev-list', '--count', 'HEAD').trim()).toBe('1');
  });

  it('fails on the old names outside the ADRs, even where the provenance check allows them', () => {
    write('packages/icons/README.md', `${MD}\n\n# Icons\n\nNot from ${UPSTREAM_NAME}.\n`);
    write(`docs/${OLD_NAME}-notes.txt`, 'notes\n');
    git(source, 'add', '-A');
    git(source, 'commit', '--quiet', '-m', 'names');
    const run = handoff(['-m', 'initial']);
    expect(run.status).toBe(1);
    expect(lines(run.stderr).slice(0, 2)).toEqual(['packages/icons/README.md', `docs/${OLD_NAME}-notes.txt`]);
    expect(run.stderr).toContain('outside docs/adr/');
    expect(run.stderr).toContain('the copy stays at');
    expect(gitStatus(path.join(root, 'gcportrait'), 'rev-parse', '--verify', '--quiet', 'HEAD')).not.toBe(0);
    expect(pnpmCalls()).toEqual([]);
  });

  it('fails without a commit when the provenance check fails in the new tree', () => {
    write('docs/no-header.md', '# No SPDX header\n');
    git(source, 'add', '-A');
    git(source, 'commit', '--quiet', '-m', 'no header');
    const run = handoff(['-m', 'initial']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('docs/no-header.md');
    expect(run.stderr).toContain('the provenance check failed in the new tree');
    expect(existsSync(path.join(root, 'gcportrait/.git'))).toBe(true);
    expect(gitStatus(path.join(root, 'gcportrait'), 'rev-parse', '--verify', '--quiet', 'HEAD')).not.toBe(0);
    expect(pnpmCalls()).toEqual([]);
  });

  it('fails without a commit when pnpm check fails', () => {
    const run = handoff(['-m', 'initial'], { STUB_CHECK_EXIT: '1' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('pnpm check failed in the new tree');
    expect(gitStatus(path.join(root, 'gcportrait'), 'rev-parse', '--verify', '--quiet', 'HEAD')).not.toBe(0);
  });

  it('fails without a commit when the checks leave a file git does not ignore', () => {
    const run = handoff(['-m', 'initial'], { STUB_CHECK_WRITES: 'stray.txt' });
    expect(run.status).toBe(1);
    expect(lines(run.stderr)[0]).toBe('stray.txt');
    expect(run.stderr).toContain('which git does not ignore');
    expect(gitStatus(path.join(root, 'gcportrait'), 'rev-parse', '--verify', '--quiet', 'HEAD')).not.toBe(0);
  });

  it('fails before the checks when git has no identity for the commit', () => {
    tree.write('gitconfig', '');
    const run = handoff(['-m', 'initial']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('git has no user.name or user.email');
    expect(pnpmCalls()).toEqual([]);
  });
});

describe('docs/handoff.md', () => {
  let doc = '';
  let help = '';
  beforeAll(() => {
    doc = read('docs/handoff.md');
    help = spawnSync('bash', [path.join(REPO, 'scripts/handoff.sh'), '--help'], { encoding: 'utf8' }).stdout;
  });

  it('carries the SPDX header and links its dated rehearsal record in docs/history/ (its long form: non-affiliation-copies.test.ts)', () => {
    expect(doc.split('\n')[0]).toBe(MD);
    // The guide says what to do; the record of a run, with its date and machine, is kept in docs/history/.
    expect(doc).not.toMatch(/## Verified on/);
    const record = /\]\((history\/\d{4}-\d{2}-\d{2}-handoff-rehearsal\.md)\)/.exec(doc)?.[1];
    expect(record, 'docs/handoff.md links no history/DATE-handoff-rehearsal.md').toBeDefined();
    expect(existsSync(path.join(REPO, 'docs', record ?? ''))).toBe(true);
  });

  it("describes exactly the script's flags", () => {
    const flags = new Set([...helpFlags(help).keys()].filter((flag) => flag.startsWith('--')));
    expect([...flags].sort()).toEqual(['--allow-dirty', '--dest', '--help', '--message', '--repository']);
    const documented = new Set(
      [...doc.matchAll(/`(--[a-z][a-z-]*)/g)].map((match) => match[1] ?? '').filter((flag) => flag !== ''),
    );
    for (const flag of flags) expect(documented, flag).toContain(flag);
  });

  it('names only commands, scripts and flags that exist', () => {
    const packages = new Map<string, ReadonlySet<string>>();
    for (const dir of workspaceDirs(REPO)) {
      const file = path.join(REPO, dir, 'package.json');
      if (!existsSync(file)) continue;
      const { name, scripts } = JSON.parse(readFileSync(file, 'utf8')) as {
        name: string;
        scripts?: Record<string, string>;
      };
      packages.set(name, new Set(Object.keys(scripts ?? {})));
    }
    const rootManifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const scriptFlags = new Set(helpFlags(help).keys());
    const repoTree = {
      rootScripts: new Set(Object.keys(rootManifest.scripts)),
      packages,
      flags: new Map([['scripts/handoff.sh', scriptFlags]]),
      exists: (file: string) => existsSync(path.join(REPO, file)),
    };
    const commands = commandsIn(doc);
    expect(commands.some((command) => command.startsWith('scripts/handoff.sh --message'))).toBe(true);
    for (const command of commands) expect(commandProblem(command, repoTree), command).toBeNull();
    for (const match of doc.matchAll(/`(scripts\/handoff\.sh[^`]*)`/g)) {
      expect(commandProblem(match[1] ?? '', repoTree), match[1]).toBeNull();
    }
  });

  it('names every repository variable and secret the workflows read', () => {
    const workflows = readdirSync(path.join(REPO, '.github/workflows'))
      .filter((file) => file.endsWith('.yml'))
      .map((file) => read(`.github/workflows/${file}`))
      .join('\n');
    const names = new Set(
      [...workflows.matchAll(/(?:vars|secrets)\.([A-Z0-9_]+)/g)]
        .map((match) => match[1] ?? '')
        .filter((name) => name !== '' && name !== 'GITHUB_TOKEN'),
    );
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) expect(doc, name).toContain(`\`${name}\``);
  });
});
