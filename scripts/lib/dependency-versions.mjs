// SPDX-License-Identifier: MIT
// @ts-check
/**
 * A dependency as a workspace package declares it and as it is installed for that package, and the check that
 * the declaration pins exactly the version installed. Shared by the user-docs check (scripts/user-docs.mjs, the
 * rasteriser's version), the backend's bundle test (backend/src/render/bundle.test.ts, the licence report's
 * versions) and the render package's tests (packages/render/test/pins.ts, the asset manifest's resvg version),
 * so a bump changes the declaration and the lockfile and no test. The two tests load it by its path at run
 * time, as the bundle test loads scripts/third-party-notices.mjs and the frontend's build
 * scripts/lib/static-demo.mjs: repository tooling is no workspace package to import by name, eslint.config.js
 * refuses a relative import from a workspace into it (`import-x/no-relative-packages`; AGENTS.md, Architecture
 * and code), and their TypeScript projects check no JavaScript. Plain ESM, Node built-ins only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * A JSON file's top-level object, or an empty one when it holds something else.
 * @param {string} file
 * @returns {Record<string, unknown>}
 */
function readJsonObject(file) {
  /** @type {unknown} */
  const value = JSON.parse(readFileSync(file, 'utf8'));
  return typeof value === 'object' && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * The version a manifest gives `name` in one of its dependency fields, or undefined.
 * @param {Record<string, unknown>} manifest
 * @param {'dependencies' | 'devDependencies'} field
 * @param {string} name
 * @returns {string | undefined}
 */
function declaredIn(manifest, field, name) {
  const entries = manifest[field];
  if (typeof entries !== 'object' || entries === null) return undefined;
  const version = /** @type {Record<string, unknown>} */ (entries)[name];
  return typeof version === 'string' ? version : undefined;
}

/**
 * A dependency as a workspace package declares it (its package.json's `dependencies`, else its
 * `devDependencies`) and as it is installed for that package (the version in the installed package's own
 * package.json, its directory found as Node looks a package up, since a package's `exports` may leave its
 * package.json out, as `@resvg/resvg-wasm`'s does, but only in the `node_modules` directories inside `root`:
 * the NODE_PATH that pnpm's scripts set and the directories above the tree install nothing for a package);
 * null where there is none.
 * @param {string} root the tree's root
 * @param {string} workspace the workspace package's directory, relative to `root`
 * @param {string} name
 * @returns {{ declared: string | null, installed: string | null }}
 */
export function dependencyVersions(root, workspace, name) {
  const manifestFile = path.join(root, workspace, 'package.json');
  const manifest = readJsonObject(manifestFile);
  const declared =
    declaredIn(manifest, 'dependencies', name) ?? declaredIn(manifest, 'devDependencies', name);
  const dir = createRequire(manifestFile)
    .resolve.paths(name)
    ?.filter((modules) => !path.relative(root, modules).startsWith('..'))
    .map((modules) => path.join(modules, name))
    .find((candidate) => existsSync(path.join(candidate, 'package.json')));
  const installed = dir === undefined ? undefined : readJsonObject(path.join(dir, 'package.json')).version;
  return {
    declared: declared ?? null,
    installed: typeof installed === 'string' ? installed : null,
  };
}

/**
 * What is wrong with a dependency's pin: it is not installed, or the declaration is not exactly the version
 * installed; null when it is pinned exactly.
 * @param {{ declared: string | null, installed: string | null }} pin as dependencyVersions reads it
 * @param {string} workspace the declaring workspace package's directory
 * @param {string} name
 * @returns {string | null}
 */
export function exactPinProblem(pin, workspace, name) {
  const { declared, installed } = pin;
  if (installed === null) return `${name} is not installed for ${workspace}; run \`pnpm install\``;
  if (declared !== installed)
    return `${workspace}/package.json declares ${name} ${declared ?? 'not at all'}, not exactly the version installed, ${installed}`;
  return null;
}

/**
 * The version of `name` installed for a workspace package whose package.json pins exactly that version; it
 * throws the problem (exactPinProblem) otherwise.
 * @param {string} root the tree's root
 * @param {string} workspace the workspace package's directory, relative to `root`
 * @param {string} name
 * @returns {string}
 */
export function exactPin(root, workspace, name) {
  const pin = dependencyVersions(root, workspace, name);
  const problem = exactPinProblem(pin, workspace, name);
  if (problem !== null) throw new Error(problem);
  // exactPinProblem passes a pin only with a version installed.
  return /** @type {string} */ (pin.installed);
}
