// SPDX-License-Identifier: MIT
/**
 * Test helpers of the render command line's tests: fresh temporary directories, removed after the file's
 * tests.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

/** Returns a maker of fresh temporary directories named after `prefix`; they are removed after the file's tests. */
export function tempDirs(prefix: string): () => string {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  return () => {
    const dir = mkdtempSync(path.join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
}
