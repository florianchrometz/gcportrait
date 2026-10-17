// SPDX-License-Identifier: MIT
/**
 * The versions the render package's tests hold resvg to: a dependency as packages/render/package.json declares
 * it and as it is installed for the package, read from the installed package's own package.json, so a bump
 * changes the declaration and the lockfile and no test.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect } from 'vitest';

const MANIFEST = path.resolve(import.meta.dirname, '../package.json');

/**
 * The version of `name` installed for this package, after checking that its package.json (`dependencies` or
 * `devDependencies`) pins exactly that version.
 */
export function exactPin(name: string): string {
  const { dependencies, devDependencies } = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  // Node's lookup of the package's directory: a package's `exports` may leave its package.json out.
  const dir = createRequire(MANIFEST)
    .resolve.paths(name)
    ?.map((modules) => path.join(modules, name))
    .find((candidate) => existsSync(path.join(candidate, 'package.json')));
  if (dir === undefined) throw new Error(`${name} is not installed for packages/render`);
  const { version } = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version: string };
  const declared = dependencies?.[name] ?? devDependencies?.[name];
  expect(declared, `packages/render/package.json pins ${name} exactly`).toBe(version);
  return version;
}
