// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { vi } from 'vitest';

/** Absolute path of the repository's scripts/ directory. */
export const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Absolute path of the repository's root. */
export const REPO = path.resolve(SCRIPTS_DIR, '..');

/**
 * The licence identifier the fixture trees declare (their package.json and SPDX headers): the tools' fallback
 * (FALLBACK_LICENSE_ID in scripts/lib/repo-files.mjs), not the project's Apache-2.0, so the tests show that the
 * tools take the identifier from the tree they check.
 */
export const FIXTURE_LICENSE = 'LicenseRef-gcportrait-unset';

/** A throw-away directory tree for exercising the repo tooling. */
export interface TempTree {
  readonly root: string;
  write(relPath: string, content: string | Uint8Array): void;
  read(relPath: string): string;
  remove(): void;
}

export function createTempTree(prefix: string): TempTree {
  const root = mkdtempSync(path.join(tmpdir(), `gcportrait-${prefix}-`));
  return {
    root,
    write(relPath, content) {
      const absPath = path.join(root, relPath);
      mkdirSync(path.dirname(absPath), { recursive: true });
      writeFileSync(absPath, content);
    },
    read(relPath) {
      return readFileSync(path.join(root, relPath), 'utf8');
    },
    remove() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export interface ScriptResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The timeout of a test that starts a script in a Node process of its own (`runScript`): a start of a few tens of
 * milliseconds on a quiet machine, which a machine whose every core runs another test process stretches past Vitest's
 * 5 s default. A test that needs only what a tool's command line writes and returns runs it in-process instead
 * (`runInProcess`), and a process of its own checks the command's wiring.
 */
export const SPAWN_TIMEOUT = { timeout: 30_000 } as const;

/** Runs one of the scripts/*.mjs tools with Node and captures its output. */
export function runScript(script: string, args: readonly string[]): ScriptResult {
  const result = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, script), ...args], {
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Runs a tool's command line in this process (the `run` a scripts/*.mjs tool exports) and captures what it writes to
 * standard output and standard error, as `runScript` does for a process of its own.
 */
export async function runInProcess(run: () => number | Promise<number>): Promise<ScriptResult> {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const written = (spy: typeof stdout): string => spy.mock.calls.map(([chunk]) => String(chunk)).join('');
  try {
    const status = await run();
    return { status, stdout: written(stdout), stderr: written(stderr) };
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

/** A root package.json declaring the given project licence. */
export function manifest(license: string): string {
  return `${JSON.stringify({ name: 'fixture', private: true, license }, null, 2)}\n`;
}
