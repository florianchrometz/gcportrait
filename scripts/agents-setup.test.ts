// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POINTER } from './agents-setup.mjs';
import { ASSISTANT_DIR_NAMES, ASSISTANT_FILE_NAMES } from './lib/repo-files.mjs';
import { REPO, createTempTree, runScript, type TempTree } from './testing/temp-tree.js';

const SKILL = (name: string): string => `---\nname: ${name}\ndescription: A skill.\n---\n# ${name}\n`;

/** Every path `pnpm agents:setup` writes for the fixture's two skills. */
const WRITTEN = [
  'CLAUDE.md',
  '.claude/skills/alpha',
  '.claude/skills/beta',
  'GEMINI.md',
  '.cursor/rules/agents.mdc',
  '.github/copilot-instructions.md',
];

describe('agents-setup', () => {
  let tree: TempTree;
  const run = (...args: string[]) => runScript('agents-setup.mjs', ['--root', tree.root, ...args]);
  const git = (...args: string[]) =>
    spawnSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      {
        cwd: tree.root,
        encoding: 'utf8',
      },
    );

  beforeEach(() => {
    tree = createTempTree('agents-setup');
    tree.write('AGENTS.md', '# Rules\n');
    tree.write('.agents/skills/alpha/SKILL.md', SKILL('alpha'));
    tree.write('.agents/skills/beta/SKILL.md', SKILL('beta'));
    tree.write('.agents/README.md', '# Skills\n');
  });

  afterEach(() => {
    tree.remove();
  });

  it('writes a pointer file per tool, with the import line where the tool has one, and links each skill for Claude Code', () => {
    const result = run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(tree.read('CLAUDE.md')).toBe(`@AGENTS.md\n\n${POINTER}\n`);
    expect(tree.read('GEMINI.md')).toBe(`@./AGENTS.md\n\n${POINTER}\n`);
    expect(tree.read('.cursor/rules/agents.mdc')).toMatch(
      /^---\ndescription: .+\nalwaysApply: true\n---\n\n/,
    );
    expect(tree.read('.cursor/rules/agents.mdc').endsWith(`${POINTER}\n`)).toBe(true);
    expect(tree.read('.github/copilot-instructions.md')).toBe(`${POINTER}\n`);
    expect(
      POINTER.startsWith(
        'Read AGENTS.md and the skills under .agents/skills/ first; this file only points there.',
      ),
    ).toBe(true);
    for (const name of ['alpha', 'beta']) {
      const link = path.join(tree.root, '.claude/skills', name);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readFileSync(path.join(link, 'SKILL.md'), 'utf8')).toBe(SKILL(name));
      if (process.platform !== 'win32') expect(readlinkSync(link)).toBe(`../../.agents/skills/${name}`);
    }
    // Codex CLI reads AGENTS.md and .agents/skills/ itself, and an AGENTS.override.md would replace AGENTS.md.
    expect(result.stdout).toContain('Codex CLI reads AGENTS.md and the skills under .agents/skills/ itself');
    expect(existsSync(path.join(tree.root, 'AGENTS.override.md'))).toBe(false);
    expect(readdirSync(path.join(tree.root, '.claude/skills')).sort()).toEqual(['alpha', 'beta']);
  });

  it('changes nothing when run again, and never overwrites a file of a person’s own without --force', () => {
    expect(run().status).toBe(0);
    const again = run();
    expect(again.status).toBe(0);
    expect(again.stdout).not.toMatch(/^ {2}(?:wrote|overwrote|linked|removed) /m);
    expect(again.stdout).toContain('kept CLAUDE.md (up to date)');
    expect(again.stdout).toContain('kept .claude/skills/alpha (linked)');

    tree.write('GEMINI.md', 'My own notes.\n');
    const kept = run('--tool', 'gemini');
    expect(kept.stdout).toContain('kept GEMINI.md (it exists; --force overwrites it)');
    expect(tree.read('GEMINI.md')).toBe('My own notes.\n');

    const forced = run('--tool', 'gemini', '--force');
    expect(forced.status).toBe(0);
    expect(forced.stdout).toContain('overwrote GEMINI.md');
    expect(tree.read('GEMINI.md')).toBe(`@./AGENTS.md\n\n${POINTER}\n`);
  });

  it('never writes through a link, and never replaces a folder, even with --force', () => {
    rmSync(path.join(tree.root, 'CLAUDE.md'), { force: true });
    symlinkSync('AGENTS.md', path.join(tree.root, 'CLAUDE.md'));
    mkdirSync(path.join(tree.root, '.claude/skills/alpha'), { recursive: true });
    tree.write('.claude/skills/alpha/SKILL.md', 'A skill of my own.\n');
    const first = run('--tool', 'claude');
    expect(first.stdout).toContain('kept CLAUDE.md (it exists; --force overwrites it)');
    expect(first.stdout).toContain('left .claude/skills/alpha alone: it is not a link');
    expect(first.stdout).toContain('linked .claude/skills/beta to .agents/skills/beta');
    expect(tree.read('AGENTS.md')).toBe('# Rules\n');

    const forced = run('--tool', 'claude', '--force');
    expect(forced.status).toBe(0);
    expect(forced.stdout).toContain('overwrote CLAUDE.md');
    expect(lstatSync(path.join(tree.root, 'CLAUDE.md')).isSymbolicLink()).toBe(false);
    expect(tree.read('AGENTS.md')).toBe('# Rules\n');
    expect(forced.stdout).toContain('left .claude/skills/alpha alone: it is not a link');
    expect(tree.read('.claude/skills/alpha/SKILL.md')).toBe('A skill of my own.\n');
  });

  it('links a skill added since and removes the link to a skill that is gone', () => {
    expect(run('--tool', 'claude').status).toBe(0);
    rmSync(path.join(tree.root, '.agents/skills/beta'), { recursive: true });
    tree.write('.agents/skills/gamma/SKILL.md', SKILL('gamma'));
    const result = run('--tool', 'claude');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('linked .claude/skills/gamma to .agents/skills/gamma');
    expect(result.stdout).toContain('removed .claude/skills/beta (no such skill any more)');
    expect(readdirSync(path.join(tree.root, '.claude/skills')).sort()).toEqual(['alpha', 'gamma']);
  });

  it('writes only the tools asked for, and refuses an unknown tool or a folder without AGENTS.md', () => {
    expect(run('--tool', 'cursor', '--tool', 'copilot').status).toBe(0);
    expect(existsSync(path.join(tree.root, '.cursor/rules/agents.mdc'))).toBe(true);
    expect(existsSync(path.join(tree.root, '.github/copilot-instructions.md'))).toBe(true);
    expect(existsSync(path.join(tree.root, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(path.join(tree.root, 'GEMINI.md'))).toBe(false);

    const unknown = run('--tool', 'notepad');
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('unknown tool "notepad"');

    rmSync(path.join(tree.root, 'AGENTS.md'));
    const empty = run();
    expect(empty.status).toBe(1);
    expect(empty.stdout).toContain('has no AGENTS.md');
  });

  it('writes only paths the repository’s .gitignore ignores: git status shows nothing new', () => {
    tree.write('.gitignore', readFileSync(path.join(REPO, '.gitignore'), 'utf8'));
    expect(git('init', '--quiet').status).toBe(0);
    expect(git('add', '--all').status).toBe(0);
    expect(git('commit', '--quiet', '--message', 'fixture').status).toBe(0);
    expect(run().status).toBe(0);
    for (const written of WRITTEN) expect(existsSync(path.join(tree.root, written)), written).toBe(true);
    expect(git('status', '--porcelain', '--untracked-files=all').stdout).toBe('');
    const ignored = git('check-ignore', '--no-index', ...WRITTEN);
    expect(ignored.stdout.trim().split('\n')).toEqual(WRITTEN);
  });
});

describe('the repository’s instructions for assistants', () => {
  it('keeps the rules file as AGENTS.md, the name the tools read, in that case on disk and in git', () => {
    expect(readdirSync(REPO).filter((name) => name.toLowerCase() === 'agents.md')).toEqual(['AGENTS.md']);
    const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' });
    if (tracked.status !== 0) return; // not a git checkout (an unpacked archive): the name on disk is all there is
    const rules = tracked.stdout.split('\0').filter((file) => file.toLowerCase() === 'agents.md');
    expect(
      rules,
      'git tracks the rules file under another case; on a case-insensitive file system rename it with `git mv -f agents.md AGENTS.md`',
    ).toEqual(['AGENTS.md']);
  });

  it('commits no instruction file of a particular tool', () => {
    const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' });
    if (tracked.status !== 0) return;
    const own = tracked.stdout
      .split('\0')
      .filter(
        (file) =>
          ASSISTANT_FILE_NAMES.includes(path.posix.basename(file)) ||
          file.split('/').some((segment) => ASSISTANT_DIR_NAMES.includes(segment)) ||
          file === '.github/copilot-instructions.md' ||
          file.startsWith('.github/instructions/'),
      );
    expect(
      own,
      'AGENTS.md and .agents/skills/ are the one source of instructions (AGENTS.md, "Assistants")',
    ).toEqual([]);
  });
});
