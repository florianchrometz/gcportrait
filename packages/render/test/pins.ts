// SPDX-License-Identifier: MIT
/**
 * The versions the render package's tests hold resvg to: a dependency as packages/render/package.json declares
 * it and as it is installed for the package, read from the installed package's own package.json, so a bump
 * changes the declaration and the lockfile and no test. The lookup and the check are the repository's one
 * (scripts/lib/dependency-versions.mjs), loaded by its path as repository tooling.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/** The part of scripts/lib/dependency-versions.mjs these tests use. */
interface DependencyVersions {
  readonly exactPin: (root: string, workspace: string, name: string) => string;
}

const versions = (await import(
  pathToFileURL(path.join(REPO_ROOT, 'scripts/lib/dependency-versions.mjs')).href
)) as DependencyVersions;

/**
 * The version of `name` installed for this package, after checking that its package.json (`dependencies` or
 * `devDependencies`) pins exactly that version: it throws what is wrong otherwise.
 */
export function exactPin(name: string): string {
  return versions.exactPin(REPO_ROOT, 'packages/render', name);
}
