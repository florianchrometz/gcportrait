// SPDX-License-Identifier: MIT
// @ts-check
/**
 * `pnpm agents:setup`: writes the local pointer files that lead an AI assistant to the repository's one source of
 * instructions, AGENTS.md and the skills under .agents/skills/ (AGENTS.md, "Assistants"). Each file is one paragraph
 * that points there, with the tool's own way to include a file where it has one; it holds no rule. Every path it
 * writes is git-ignored (.gitignore) and skipped by the provenance check, so nothing it writes can be committed by
 * accident or drift from AGENTS.md.
 *
 * What each tool reads by itself, and so what it gets, as its documentation says:
 * - Claude Code (from v2.1.277) reads AGENTS.md only while no CLAUDE.md is present, imports a file named on an `@path`
 *   line of a CLAUDE.md, and loads skills only from .claude/skills/, where a skill's folder may be a symbolic link to
 *   a folder elsewhere (https://code.claude.com/docs/en/memory, "AGENTS.md" and "Import additional files";
 *   https://code.claude.com/docs/en/skills, where skills live). It gets CLAUDE.md with `@AGENTS.md`, and a link
 *   .claude/skills/NAME to .agents/skills/NAME for each skill.
 * - Gemini CLI reads GEMINI.md, which imports a file named on an `@./path` line, and the skills under .agents/skills/
 *   (https://geminicli.com/docs/cli/gemini-md/; https://geminicli.com/docs/cli/skills/). It gets GEMINI.md with
 *   `@./AGENTS.md`.
 * - Codex CLI reads AGENTS.md (an AGENTS.override.md in the same folder would replace it) and the skills under
 *   .agents/skills/ (https://learn.chatgpt.com/docs/agent-configuration/agents-md;
 *   https://learn.chatgpt.com/docs/build-skills). It needs nothing.
 * - Cursor reads AGENTS.md, its project rules in .cursor/rules/*.mdc (`alwaysApply: true`: in every chat) and the
 *   skills under .agents/skills/ (https://cursor.com/docs/context/rules; https://cursor.com/docs/context/skills). It
 *   gets .cursor/rules/agents.mdc.
 * - GitHub Copilot reads AGENTS.md, .github/copilot-instructions.md and the skills under .agents/skills/
 *   (https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions;
 *   https://docs.github.com/en/copilot/concepts/agents/about-agent-skills). It gets .github/copilot-instructions.md.
 *
 * Usage:
 *   node scripts/agents-setup.mjs                  write the pointer files of every tool
 *   node scripts/agents-setup.mjs --tool claude    only one tool's (claude, gemini, codex, cursor, copilot; repeatable)
 *   node scripts/agents-setup.mjs --force          also overwrite a pointer file or link that exists (never a folder)
 *   node scripts/agents-setup.mjs --root <dir>     write into another checkout (used by the tests)
 *
 * It never overwrites a file that exists without --force, and running it again changes nothing that is in place: a
 * skill added since gets its link, and a link to a skill that is gone is removed. Exit code 0 when everything is in
 * place, 1 when something could not be written, 2 on a usage error. Plain ESM, Node built-ins only.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** The one rules file, under the name the tools look for. */
export const RULES_FILE = 'AGENTS.md';
/** The skills, one folder each with its SKILL.md. */
export const SKILLS_DIR = '.agents/skills';

/** What every pointer file says. */
export const POINTER =
  'Read AGENTS.md and the skills under .agents/skills/ first; this file only points there. It is git-ignored and ' +
  'written by `pnpm agents:setup`: a rule belongs in AGENTS.md, never here.';

/**
 * @typedef {'claude' | 'gemini' | 'codex' | 'cursor' | 'copilot'} ToolId
 * @typedef {{ path: string, content: string }} PointerFile
 * @typedef {{ id: ToolId, name: string, files: readonly PointerFile[], linkSkillsInto?: string, note?: string }} Tool
 */

/** @type {readonly Tool[]} */
export const TOOLS = Object.freeze([
  {
    id: 'claude',
    name: 'Claude Code',
    files: [{ path: 'CLAUDE.md', content: `@${RULES_FILE}\n\n${POINTER}\n` }],
    linkSkillsInto: '.claude/skills',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    files: [{ path: 'GEMINI.md', content: `@./${RULES_FILE}\n\n${POINTER}\n` }],
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    files: [],
    note: 'reads AGENTS.md and the skills under .agents/skills/ itself: nothing to write',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    files: [
      {
        path: '.cursor/rules/agents.mdc',
        content:
          '---\ndescription: The rules of this repository are in AGENTS.md, its procedures in the skills under .agents/skills/.\n' +
          `alwaysApply: true\n---\n\n${POINTER}\n`,
      },
    ],
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    files: [{ path: '.github/copilot-instructions.md', content: `${POINTER}\n` }],
  },
]);

class UsageError extends Error {}

/**
 * @typedef {{ root: string, tools?: readonly ToolId[], force?: boolean }} SetupOptions
 * @typedef {{ lines: string[], failed: boolean }} SetupResult
 */

/**
 * The skills of a checkout: the folders under .agents/skills/ that hold a SKILL.md, sorted.
 * @param {string} root
 * @returns {string[]}
 */
export function skillNames(root) {
  const dir = path.join(root, SKILLS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

/**
 * What is at `absPath` (a broken link included), or undefined when nothing is.
 * @param {string} absPath
 * @returns {import('node:fs').Stats | undefined}
 */
function entryAt(absPath) {
  try {
    return lstatSync(absPath);
  } catch {
    return undefined;
  }
}

/**
 * Writes one pointer file unless one is there (or with `force`, unless it already says the same).
 * @param {string} root
 * @param {PointerFile} file
 * @param {boolean} force
 * @param {string[]} lines
 * @returns {boolean} false when it could not be written
 */
function writePointer(root, file, force, lines) {
  const absPath = path.join(root, file.path);
  const existing = entryAt(absPath);
  if (existing?.isDirectory()) {
    lines.push(`  left ${file.path} alone: it is a folder`);
    return true;
  }
  if (existing !== undefined) {
    const same = existing.isFile() && readFileSync(absPath, 'utf8') === file.content;
    if (same) {
      lines.push(`  kept ${file.path} (up to date)`);
      return true;
    }
    if (!force) {
      lines.push(`  kept ${file.path} (it exists; --force overwrites it)`);
      return true;
    }
    if (existing.isSymbolicLink()) unlinkSync(absPath);
  }
  try {
    mkdirSync(path.dirname(absPath), { recursive: true });
    writeFileSync(absPath, file.content);
  } catch (error) {
    lines.push(`  could not write ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  lines.push(`  ${existing === undefined ? 'wrote' : 'overwrote'} ${file.path}`);
  return true;
}

/**
 * Links every skill into `linkDir` (relative to the root) and removes the links this script made to skills that are
 * gone. A folder or file of the same name is kept, a link elsewhere too unless `force`.
 * @param {string} root
 * @param {string} linkDir
 * @param {boolean} force
 * @param {string[]} lines
 * @returns {boolean} false when a link could not be made
 */
function linkSkills(root, linkDir, force, lines) {
  const absDir = path.join(root, linkDir);
  const skills = skillNames(root);
  if (entryAt(absDir)?.isSymbolicLink()) {
    lines.push(`  kept ${linkDir} (a link of your own)`);
    return true;
  }
  let ok = true;
  try {
    mkdirSync(absDir, { recursive: true });
  } catch (error) {
    lines.push(`  could not create ${linkDir}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  for (const name of skills) {
    const relPath = `${linkDir}/${name}`;
    const absPath = path.join(absDir, name);
    const source = path.join(root, SKILLS_DIR, name);
    // A relative link, so the checkout can move; Windows makes a junction, which needs no privilege but an absolute path.
    const target = process.platform === 'win32' ? source : path.relative(absDir, source);
    const existing = entryAt(absPath);
    if (existing?.isSymbolicLink() && path.resolve(absDir, readlinkSync(absPath)) === path.resolve(source)) {
      lines.push(`  kept ${relPath} (linked)`);
      continue;
    }
    if (existing !== undefined && (!existing.isSymbolicLink() || !force)) {
      lines.push(
        existing.isSymbolicLink()
          ? `  kept ${relPath} (it links elsewhere; --force replaces it)`
          : `  left ${relPath} alone: it is not a link`,
      );
      continue;
    }
    try {
      if (existing !== undefined) unlinkSync(absPath);
      symlinkSync(target, absPath, process.platform === 'win32' ? 'junction' : 'dir');
      lines.push(`  linked ${relPath} to ${SKILLS_DIR}/${name}`);
    } catch (error) {
      ok = false;
      lines.push(`  could not link ${relPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const skillsRoot = path.resolve(root, SKILLS_DIR);
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (!entry.isSymbolicLink() || skills.includes(entry.name)) continue;
    const absPath = path.join(absDir, entry.name);
    const pointsTo = path.resolve(absDir, readlinkSync(absPath));
    if (path.dirname(pointsTo) !== skillsRoot) continue;
    unlinkSync(absPath);
    lines.push(`  removed ${linkDir}/${entry.name} (no such skill any more)`);
  }
  return ok;
}

/**
 * Writes the pointer files of the chosen tools into `root`.
 * @param {SetupOptions} options
 * @returns {SetupResult}
 */
export function setup({ root, tools = TOOLS.map((tool) => tool.id), force = false }) {
  if (!existsSync(path.join(root, RULES_FILE))) {
    return {
      lines: [`agents:setup: ${root} has no ${RULES_FILE}; run it in a checkout of the repository.`],
      failed: true,
    };
  }
  /** @type {string[]} */
  const lines = [];
  let failed = false;
  for (const tool of TOOLS.filter((candidate) => tools.includes(candidate.id))) {
    if (tool.note !== undefined) {
      lines.push(`${tool.name} ${tool.note}.`);
      continue;
    }
    lines.push(`${tool.name}:`);
    for (const file of tool.files) failed = !writePointer(root, file, force, lines) || failed;
    if (tool.linkSkillsInto !== undefined)
      failed = !linkSkills(root, tool.linkSkillsInto, force, lines) || failed;
  }
  return { lines, failed };
}

const USAGE = `Usage: node scripts/agents-setup.mjs [--tool ${TOOLS.map((tool) => tool.id).join('|')}]... [--force] [--root DIR]`;

function main() {
  const { values } = parseArgs({
    options: {
      tool: { type: 'string', multiple: true },
      force: { type: 'boolean', default: false },
      root: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  /** @type {ToolId[]} */
  const tools = [];
  for (const id of values.tool ?? TOOLS.map((tool) => tool.id)) {
    const tool = TOOLS.find((candidate) => candidate.id === id);
    if (tool === undefined) throw new UsageError(`unknown tool "${id}"\n${USAGE}`);
    tools.push(tool.id);
  }
  const root = values.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = setup({ root, tools, force: values.force });
  process.stdout.write(`${result.lines.join('\n')}\n`);
  if (result.failed) process.exitCode = 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    // parseArgs reports an unknown or malformed option as a TypeError with a code (ERR_PARSE_ARGS_...).
    if (error instanceof UsageError || (error instanceof TypeError && 'code' in error)) {
      process.stderr.write(`agents:setup: ${error.message}\n`);
      process.exitCode = 2;
    } else {
      throw error;
    }
  }
}
