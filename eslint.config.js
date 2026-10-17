// SPDX-License-Identifier: MIT
// @ts-check
/**
 * ESLint flat config for the whole monorepo. `pnpm lint` runs it from the root; each package's own `lint`
 * script runs the same config on that package.
 *
 * Boundaries are enforced with two mechanisms:
 *  - eslint-plugin-import-x `no-relative-packages` resolves every relative import (through the TypeScript
 *    resolver, so `./x.js` → `x.ts` works) and reports one that lands inside another workspace package.
 *    import-x is used rather than eslint-plugin-boundaries because only this rule needs module resolution;
 *    the rest of the boundary policy is a short allow-list that reads best as plain data (below) without a
 *    second plugin's element/rule vocabulary to learn.
 *  - core `no-restricted-imports` patterns, generated per workspace from WORKSPACE_DEPENDENCIES below, keep
 *    the dependency direction of docs/packages.md §2 (frontend/backend → packages → model; AGENTS.md,
 *    Architecture and code) and force imports through the package entry point (`@gcportrait/<pkg>`, never a
 *    deep path).
 *
 * One more rule keeps zod imported as a namespace, so the backend's bundles leave out what they do not use
 * (ZOD_NAMESPACE_SELECTORS below).
 */
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { ASSISTANT_DIR_NAMES } from './scripts/lib/repo-files.mjs';

const SOURCE_FILES = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

/**
 * Which internal packages (`@gcportrait/<name>`) each workspace may import (docs/packages.md §2).
 * Later entries win for files matched by several globs, so the general `packages/*` rule comes before the
 * model rule. Repository tooling (scripts/, root config files) is not restricted.
 * @type {ReadonlyArray<{ files: string, allowed: readonly string[] }>}
 */
const WORKSPACE_DEPENDENCIES = [
  { files: 'packages/*/**', allowed: ['model'] },
  { files: 'packages/model/**', allowed: [] },
  // The ingest budget test reads the demo organisation XL from @gcportrait/demo-data, written as an export (a
  // dev dependency; tests only: nothing under packages/ingest/src/ imports it).
  { files: 'packages/ingest/test/**', allowed: ['model', 'demo-data'] },
  // The graph builder evaluates catalog rules through @gcportrait/catalog's rule engine: the catalog owns
  // rule semantics (AGENTS.md, Data and graph semantics).
  { files: 'packages/graph/**', allowed: ['model', 'catalog'] },
  // Its tests build the demo organisations with @gcportrait/demo-data (a dev dependency; tests only).
  { files: 'packages/graph/test/**', allowed: ['model', 'catalog', 'demo-data'] },
  // Its render-scene command ingests the demo fixtures like the app does (Node tooling, not the library).
  { files: 'packages/graph/scripts/**', allowed: ['model', 'catalog', 'demo-data', 'ingest'] },
  // The layout's golden, performance and property tests and its debug-svg dumper build the demo Scenes through
  // @gcportrait/graph with the real catalog from @gcportrait/demo-data (dev dependencies; development only:
  // nothing under packages/layout/src/ imports them).
  { files: 'packages/layout/test/**', allowed: ['model', 'graph', 'catalog', 'demo-data'] },
  { files: 'packages/layout/scripts/**', allowed: ['model', 'graph', 'catalog', 'demo-data'] },
  // The render library is Node code on top of the app, not a library under it: it reads data and draws
  // views with the frontend's own readers and SVG components (@gcportrait/frontend's entry point, src/headless.ts)
  // so its output is the app's picture. It is the one package that may import the frontend; the frontend may not
  // import it (AGENTS.md, Architecture and code).
  {
    files: 'packages/render/**',
    allowed: ['model', 'catalog', 'graph', 'layout', 'demo-data', 'frontend'],
  },
  // `pnpm render`: the command line around the render library. Nothing imports it. Its tests check the `auto`
  // budget against @gcportrait/graph's (a dev dependency; tests only: nothing under src/ imports it).
  { files: 'packages/render-cli/**', allowed: ['model', 'demo-data', 'render'] },
  { files: 'packages/render-cli/test/**', allowed: ['model', 'graph', 'demo-data', 'render'] },
  { files: 'frontend/**', allowed: ['model', 'catalog', 'graph', 'layout', 'icons', 'ingest', 'demo-data'] },
  // The backend reaches the frontend only through the render library, in its render worker (AGENTS.md,
  // Architecture and code).
  { files: 'backend/**', allowed: ['model', 'catalog', 'ingest', 'render'] },
  { files: 'website/**', allowed: ['model', 'catalog', 'demo-data'] },
  { files: 'e2e/**', allowed: ['model', 'demo-data'] },
];

const WORKSPACE_DIRS = ['packages', 'frontend', 'backend', 'website', 'e2e'];

/** Import patterns forbidden everywhere. */
const BASE_RESTRICTED_PATTERNS = [
  {
    regex: `^(\\.\\./)+(${WORKSPACE_DIRS.join('|')})(/|$)`,
    message: 'Import another workspace package by its name (@gcportrait/<pkg>), not by a relative path.',
  },
  // A package's `testing` subpath export (test and data-tooling helpers kept out of the app, such as
  // @gcportrait/model/testing) is the one other entry point.
  {
    regex: '^@gcportrait/[^/]+/(?!testing$).',
    message:
      'Import a package through its entry point (@gcportrait/<pkg>, or its @gcportrait/<pkg>/testing export), not a path inside it.',
  },
];

/** zod and its subpaths (`zod/v4`, `zod/mini`), as an esquery regular expression. */
const ZOD_SOURCE = '/^zod(\\/|$)/';
const ZOD_NAMESPACE_MESSAGE =
  "Import zod as a namespace, `import * as z from 'zod'` (`import type * as z` for types only): with a named or default `z`, esbuild keeps all of zod in the backend's bundles, every locale included.";

/**
 * zod's `z` as a named or default import (or re-export) keeps the whole namespace object, and with it every
 * locale zod ships, in the backend's esbuild bundles; the namespace import lets esbuild keep only what the
 * code uses. `no-restricted-imports` cannot say this: with `importNames: ['z']` it refuses the namespace
 * import as well, since that imports every name.
 */
const ZOD_NAMESPACE_SELECTORS = [
  `ImportDeclaration[source.value=${ZOD_SOURCE}] > ImportSpecifier[imported.name=/^(z|default)$/]`,
  `ImportDeclaration[source.value=${ZOD_SOURCE}] > ImportDefaultSpecifier`,
  `ExportNamedDeclaration[source.value=${ZOD_SOURCE}] > ExportSpecifier[local.name=/^(z|default)$/]`,
];

/**
 * @param {readonly string[]} allowed
 * @returns {{ regex: string, message: string }}
 */
function internalPackagePattern(allowed) {
  const lookahead = allowed.length === 0 ? '' : `(?!(${allowed.join('|')})(/|$))`;
  return {
    regex: `^@gcportrait/${lookahead}`,
    message:
      allowed.length === 0
        ? 'This package is the bottom of the dependency graph and imports no other @gcportrait package (docs/packages.md §2).'
        : `Dependency direction (docs/packages.md §2): this workspace may import only @gcportrait/{${allowed.join(',')}}.`,
  };
}

/**
 * The config block that enforces one workspace's allowed internal imports.
 * @param {{ files: string, allowed: readonly string[] }} workspace
 * @returns {import('eslint').Linter.Config}
 */
function dependencyDirection({ files, allowed }) {
  return {
    name: `gcportrait/dependency-direction:${files}`,
    files: [`${files.replace(/\/\*\*$/, '')}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...BASE_RESTRICTED_PATTERNS, internalPackagePattern(allowed)] },
      ],
    },
  };
}

export default defineConfig(
  // The assistants' own, git-ignored folders (AGENTS.md, Assistants) are no source of the project; Claude Code also
  // keeps whole worktrees of the repository under its, which linted as part of `.` cost a copy's memory each.
  // The compiled catalog is a git-ignored module of plain data, written by `pnpm catalog:build` and held to
  // its type by tsc (packages/catalog/tooling/generate.ts): linting it costs every run its size and finds
  // nothing.
  globalIgnores(
    [
      '**/dist/',
      '**/build/',
      '**/coverage/',
      '**/.astro/',
      '**/.vite/',
      'packages/catalog/src/generated/',
      'out/',
      'e2e/test-results/',
      'e2e/playwright-report/',
      'e2e/blob-report/',
      ...ASSISTANT_DIR_NAMES.map((name) => `${name}/`),
    ],
    'gcportrait/ignores',
  ),

  {
    name: 'gcportrait/javascript',
    files: SOURCE_FILES,
    extends: [js.configs.recommended],
  },

  {
    name: 'gcportrait/typescript',
    files: SOURCE_FILES,
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  {
    name: 'gcportrait/import-boundaries',
    files: SOURCE_FILES,
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        // The root solution file; the resolver follows its project references.
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project: `${import.meta.dirname}/tsconfig.json`,
        }),
      ],
    },
    rules: {
      'import-x/no-relative-packages': 'error',
      'no-restricted-imports': ['error', { patterns: BASE_RESTRICTED_PATTERNS }],
    },
  },

  // Per-workspace dependency direction. Each block repeats the base patterns because a later config object
  // replaces (does not merge) the options of the same rule.
  ...WORKSPACE_DEPENDENCIES.map(dependencyDirection),

  {
    name: 'gcportrait/zod-namespace',
    files: SOURCE_FILES,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...ZOD_NAMESPACE_SELECTORS.map((selector) => ({ selector, message: ZOD_NAMESPACE_MESSAGE })),
      ],
    },
  },

  {
    name: 'gcportrait/node-globals',
    files: [
      '*.{js,mjs,cjs,ts}',
      'scripts/**',
      'backend/**',
      'e2e/**',
      '*/*.config.ts',
      'packages/*/*.config.ts',
    ],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    name: 'gcportrait/browser-globals',
    files: ['frontend/src/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
