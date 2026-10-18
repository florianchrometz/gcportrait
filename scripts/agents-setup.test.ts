// SPDX-License-Identifier: Apache-2.0
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

import { FOLDER_POINTER, POINTER, copilotFolderPointer } from './agents-setup.mjs';
import { ASSISTANT_DIR_NAMES, ASSISTANT_FILE_NAMES } from './lib/repo-files.mjs';
import { FOLDER_FILE_OPENING } from './lib/rules-files.mjs';
import { REPO, createTempTree, runScript, type TempTree } from './testing/temp-tree.js';

const SKILL = (name: string): string => `---\nname: ${name}\ndescription: A skill.\n---\n# ${name}\n`;
const FOLDER_RULES = (name: string): string => `# ${name}\n\n${FOLDER_FILE_OPENING}\n`;

/** The folders of the fixture that hold an AGENTS.md of their own. */
const RULES_FOLDERS = ['.github', 'frontend', 'packages'];

/** Every path `pnpm agents:setup` writes for the fixture's two skills and three folder files. */
const WRITTEN = [
  'CLAUDE.md',
  '.github/CLAUDE.md',
  'frontend/CLAUDE.md',
  'packages/CLAUDE.md',
  '.claude/skills/alpha',
  '.claude/skills/beta',
  'GEMINI.md',
  '.github/GEMINI.md',
  'frontend/GEMINI.md',
  'packages/GEMINI.md',
  '.cursor/rules/agents.mdc',
  '.github/copilot-instructions.md',
  '.github/instructions/github.instructions.md',
  '.github/instructions/frontend.instructions.md',
  '.github/instructions/packages.instructions.md',
];

/** The three pointers the script writes for one folder file. */
const folderPointers = (folder: string): string[] => [
  `${folder}/CLAUDE.md`,
  `${folder}/GEMINI.md`,
  `.github/instructions/${folder.replace(/^\./, '')}.instructions.md`,
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
    for (const folder of RULES_FOLDERS) tree.write(`${folder}/AGENTS.md`, FOLDER_RULES(folder));
    // A folder without rules of its own, and an AGENTS.md deeper than one folder, which is no rules file.
    tree.write('docs/README.md', '# Docs\n');
    tree.write('packages/model/AGENTS.md', FOLDER_RULES('model'));
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
        'Read AGENTS.md, the AGENTS.md of every folder you change and the skills under .agents/skills/ first; ' +
          'this file only points there.',
      ),
    ).toBe(true);
    for (const name of ['alpha', 'beta']) {
      const link = path.join(tree.root, '.claude/skills', name);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readFileSync(path.join(link, 'SKILL.md'), 'utf8')).toBe(SKILL(name));
      if (process.platform !== 'win32') expect(readlinkSync(link)).toBe(`../../.agents/skills/${name}`);
    }
    // Codex CLI reads the AGENTS.md files and .agents/skills/ itself; an AGENTS.override.md would replace one.
    expect(result.stdout).toContain(
      'Codex CLI reads the AGENTS.md files from the root down to the folder it starts in, and the skills under .agents/skills/, itself',
    );
    expect(existsSync(path.join(tree.root, 'AGENTS.override.md'))).toBe(false);
    expect(readdirSync(path.join(tree.root, '.claude/skills')).sort()).toEqual(['alpha', 'beta']);
  });

  it('writes, for each folder file, a CLAUDE.md and a GEMINI.md beside it and Copilot’s instructions for its files', () => {
    expect(run().status).toBe(0);
    expect(
      FOLDER_POINTER.startsWith(
        "Read ../AGENTS.md, this folder's AGENTS.md and the skills under .agents/skills/ first; this file only points there.",
      ),
    ).toBe(true);
    expect(tree.read('frontend/CLAUDE.md')).toBe(`@AGENTS.md\n\n${FOLDER_POINTER}\n`);
    expect(tree.read('frontend/GEMINI.md')).toBe(`@./AGENTS.md\n\n${FOLDER_POINTER}\n`);
    expect(tree.read('.github/instructions/frontend.instructions.md')).toBe(
      `---\napplyTo: "frontend/**"\n---\n\n${copilotFolderPointer('frontend')}\n`,
    );
    expect(copilotFolderPointer('frontend')).toMatch(
      /^Read AGENTS\.md, frontend\/AGENTS\.md and the skills under \.agents\/skills\/ first; /,
    );
    // A folder's name loses its leading dot in Copilot's file name, never in the glob.
    expect(tree.read('.github/instructions/github.instructions.md')).toBe(
      `---\napplyTo: ".github/**"\n---\n\n${copilotFolderPointer('.github')}\n`,
    );
    expect(tree.read('packages/CLAUDE.md')).toBe(`@AGENTS.md\n\n${FOLDER_POINTER}\n`);
    // Nothing for a folder without an AGENTS.md, nor deeper than one folder below the root.
    for (const absent of [...folderPointers('docs'), ...folderPointers('packages/model')]) {
      expect(existsSync(path.join(tree.root, absent)), absent).toBe(false);
    }
    expect(readdirSync(path.join(tree.root, '.github/instructions')).sort()).toEqual([
      'frontend.instructions.md',
      'github.instructions.md',
      'packages.instructions.md',
    ]);
  });

  it('changes nothing when run again, and never overwrites a file of a person’s own without --force', () => {
    expect(run().status).toBe(0);
    const again = run();
    expect(again.status).toBe(0);
    expect(again.stdout).not.toMatch(/^ {2}(?:wrote|overwrote|linked|removed) /m);
    expect(again.stdout).toContain('kept CLAUDE.md (up to date)');
    expect(again.stdout).toContain('kept frontend/CLAUDE.md (up to date)');
    expect(again.stdout).toContain('kept .github/instructions/frontend.instructions.md (up to date)');
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

  it('keeps a person’s own pointer in a folder, and overwrites it only with --force', () => {
    tree.write('frontend/CLAUDE.md', 'My own notes on the frontend.\n');
    const kept = run('--tool', 'claude');
    expect(kept.status).toBe(0);
    expect(kept.stdout).toContain('kept frontend/CLAUDE.md (it exists; --force overwrites it)');
    expect(kept.stdout).toContain('wrote packages/CLAUDE.md');
    expect(tree.read('frontend/CLAUDE.md')).toBe('My own notes on the frontend.\n');

    const forced = run('--tool', 'claude', '--force');
    expect(forced.stdout).toContain('overwrote frontend/CLAUDE.md');
    expect(tree.read('frontend/CLAUDE.md')).toBe(`@AGENTS.md\n\n${FOLDER_POINTER}\n`);
  });

  it('writes the pointers of a folder file added since, and removes those it wrote for one that is gone', () => {
    expect(run().status).toBe(0);
    tree.write('backend/AGENTS.md', FOLDER_RULES('backend'));
    const added = run();
    expect(added.status).toBe(0);
    for (const written of folderPointers('backend')) expect(added.stdout).toContain(`wrote ${written}`);

    rmSync(path.join(tree.root, 'frontend/AGENTS.md'));
    rmSync(path.join(tree.root, 'packages/AGENTS.md'));
    tree.write('packages/GEMINI.md', 'My own notes on the packages.\n');
    const removed = run();
    expect(removed.status).toBe(0);
    for (const pointer of folderPointers('frontend')) {
      expect(removed.stdout).toContain(`removed ${pointer} (frontend/AGENTS.md is gone)`);
      expect(existsSync(path.join(tree.root, pointer)), pointer).toBe(false);
    }
    // What a person wrote stays, even where the folder's AGENTS.md is gone.
    expect(removed.stdout).not.toContain('removed packages/GEMINI.md');
    expect(tree.read('packages/GEMINI.md')).toBe('My own notes on the packages.\n');
    expect(existsSync(path.join(tree.root, 'packages/CLAUDE.md'))).toBe(false);
    for (const folder of ['.github', 'backend']) {
      for (const pointer of folderPointers(folder))
        expect(existsSync(path.join(tree.root, pointer)), pointer).toBe(true);
    }
    expect(run().stdout).not.toMatch(/^ {2}(?:wrote|overwrote|linked|removed) /m);
  });

  it('never writes through a link, and never replaces a folder, even with --force', () => {
    rmSync(path.join(tree.root, 'CLAUDE.md'), { force: true });
    symlinkSync('AGENTS.md', path.join(tree.root, 'CLAUDE.md'));
    symlinkSync('AGENTS.md', path.join(tree.root, 'frontend/CLAUDE.md'));
    mkdirSync(path.join(tree.root, '.claude/skills/alpha'), { recursive: true });
    tree.write('.claude/skills/alpha/SKILL.md', 'A skill of my own.\n');
    const first = run('--tool', 'claude');
    expect(first.stdout).toContain('kept CLAUDE.md (it exists; --force overwrites it)');
    expect(first.stdout).toContain('kept frontend/CLAUDE.md (it exists; --force overwrites it)');
    expect(first.stdout).toContain('left .claude/skills/alpha alone: it is not a link');
    expect(first.stdout).toContain('linked .claude/skills/beta to .agents/skills/beta');
    expect(tree.read('AGENTS.md')).toBe('# Rules\n');

    const forced = run('--tool', 'claude', '--force');
    expect(forced.status).toBe(0);
    expect(forced.stdout).toContain('overwrote CLAUDE.md');
    expect(forced.stdout).toContain('overwrote frontend/CLAUDE.md');
    expect(lstatSync(path.join(tree.root, 'CLAUDE.md')).isSymbolicLink()).toBe(false);
    expect(lstatSync(path.join(tree.root, 'frontend/CLAUDE.md')).isSymbolicLink()).toBe(false);
    expect(tree.read('AGENTS.md')).toBe('# Rules\n');
    expect(tree.read('frontend/AGENTS.md')).toBe(FOLDER_RULES('frontend'));
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
    expect(existsSync(path.join(tree.root, '.github/instructions/frontend.instructions.md'))).toBe(true);
    expect(existsSync(path.join(tree.root, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(path.join(tree.root, 'frontend/CLAUDE.md'))).toBe(false);
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
  // The names and places of the rules files themselves: scripts/rules-files.test.ts.
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
      'the AGENTS.md files and .agents/skills/ are the one source of instructions (AGENTS.md, "Assistants")',
    ).toEqual([]);
  });
});
