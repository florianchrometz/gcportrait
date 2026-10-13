// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the repository's scripts/ directory. */
export const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Absolute path of the repository's root. */
export const REPO = path.resolve(SCRIPTS_DIR, '..');

/**
 * The licence identifier the fixture trees declare (their package.json and SPDX headers): the tools' fallback
 * (FALLBACK_LICENSE_ID in scripts/lib/repo-files.mjs), not the project's MIT, so the tests show that the
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

/** Runs one of the scripts/*.mjs tools with Node and captures its output. */
export function runScript(script: string, args: readonly string[]): ScriptResult {
  const result = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, script), ...args], {
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A root package.json declaring the given project licence. */
export function manifest(license: string): string {
  return `${JSON.stringify({ name: 'fixture', private: true, license }, null, 2)}\n`;
}
