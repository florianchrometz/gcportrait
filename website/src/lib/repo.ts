// SPDX-License-Identifier: MIT
/**
 * The repository the website is built from. The site renders files from it at build time (docs/, .changeset/,
 * the catalog's coverage), so the build needs its root: the nearest directory above the working directory (the
 * website package when pnpm runs the build) that holds pnpm-workspace.yaml, or GCPORTRAIT_REPO_ROOT when set.
 * Not import.meta.url: Astro bundles this module, so its own location is the build output's.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

let cachedRoot: string | undefined;

export function repoRoot(): string {
  if (cachedRoot !== undefined) return cachedRoot;
  const override = process.env.GCPORTRAIT_REPO_ROOT;
  if (override !== undefined && override !== '') {
    cachedRoot = path.resolve(override);
    return cachedRoot;
  }
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir)
      throw new Error(`no pnpm-workspace.yaml above ${process.cwd()}: set GCPORTRAIT_REPO_ROOT`);
    dir = parent;
  }
}

/** A repository file's text, or undefined when it does not exist. */
export function readRepoFile(repoPath: string): string | undefined {
  const file = path.join(repoRoot(), repoPath);
  return existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : undefined;
}

export function isRepoDirectory(repoPath: string): boolean {
  const file = path.join(repoRoot(), repoPath);
  return existsSync(file) && statSync(file).isDirectory();
}

/**
 * Whether the build is strict (`WEBSITE_STRICT=1`, set by the deploy workflows): a strict build fails where a local
 * build warns: a guide of the docs manifest missing (src/lib/docs.ts), a placeholder in docs/author.md
 * (src/lib/author.ts, through src/lib/placeholders.ts), a generated medium missing (src/lib/media.ts).
 */
export function isStrictBuild(): boolean {
  return process.env.WEBSITE_STRICT === '1' || process.env.WEBSITE_STRICT === 'true';
}
