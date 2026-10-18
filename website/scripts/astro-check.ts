// SPDX-License-Identifier: Apache-2.0
/**
 * The type check of the .astro files (`pnpm --filter @gcportrait/website typecheck:astro`, run by the package's
 * typecheck and the root `pnpm typecheck`; docs/website.md, "Building and checking"): @astrojs/check, the checker
 * of `astro check`, over tsconfig.astro.json, which holds the .astro files and src/env.d.ts. `tsc -b` checks the .ts
 * files (tsconfig.json) and does not read an .astro file's frontmatter, expressions or scripts.
 *
 * Every diagnostic fails, hints included. ESLint does not read .astro files, so the checker's hints (a declaration
 * never read, a deprecated API, an `await` that has no effect, a promise chain an async function would replace) are
 * all that stands in for the rules that fail a .ts file, and a clean run reports none. Code that needs an exception
 * lives in a module under src/lib/, where an ESLint disable comment carries its reason.
 *
 * It calls the checker itself rather than through `astro check`, which offers to install @astrojs/check when it cannot
 * load it (`pnpm add`, rewriting package.json's pins) and otherwise exits 0 with nothing checked. Here a checker that
 * cannot be loaded fails the script, with the module it could not find.
 */
import { fileURLToPath } from 'node:url';

const TSCONFIG = 'tsconfig.astro.json';

const { check } = await import('@astrojs/check').catch((error: unknown) => {
  console.error(
    `astro check: @astrojs/check cannot be loaded: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error(
    'A package that an earlier install of this tree left out as an optional one for another platform stays out of a ' +
      'later `pnpm install`: remove node_modules at the repository root and run `pnpm install` again.',
  );
  process.exit(1);
});

console.info(`astro check: the website's .astro files (website/${TSCONFIG})`);
const failed = await check({
  root: fileURLToPath(new URL('..', import.meta.url)),
  tsconfig: TSCONFIG,
  watch: false,
  minimumSeverity: 'hint',
  minimumFailingSeverity: 'hint',
});
process.exitCode = failed ? 1 : 0;
