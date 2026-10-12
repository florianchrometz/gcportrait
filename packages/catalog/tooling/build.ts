// SPDX-License-Identifier: MIT
/**
 * `pnpm catalog:build` (`pnpm --filter @gcportrait/catalog build`): compiles the catalog and writes
 * dist/catalog.json and src/generated/compiled-catalog.ts, the git-ignored module the package exports (see
 * generate.ts). It writes the catalog even while some file has violations, leaving out every type that has a
 * violation of its own (and every file that does not parse), so that one group's half-finished YAML never stops
 * another group's typecheck and never reaches the graph builder; the left-out types are named on stderr, and
 * `pnpm catalog:check` is the gate. It fails, writing nothing, only when no catalog can be assembled at all (a
 * lens file missing or invalid). `--strict` restores the old behaviour: no output while any violation exists. Unchanged outputs are not rewritten, so watchers and incremental builds stay quiet. `--quiet` (the
 * typecheck, lint and test hooks) prints nothing unless something is wrong, and then only to stderr.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { compileCatalog } from '../src/compiler/compile.js';
import { formatViolations } from '../src/compiler/report.js';
import {
  CATALOG_ROOT,
  DIST_CATALOG,
  GENERATED_MODULE,
  catalogVersion,
  loadSources,
  readOfficialList,
  repositoryLicense,
} from './files.js';
import { renderCatalogJson, renderCatalogModule } from './generate.js';

const { values } = parseArgs({
  options: {
    strict: { type: 'boolean', default: false },
    'strict-icons': { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
  },
});

const { catalog, excluded, report } = compileCatalog(loadSources(), readOfficialList(), {
  version: catalogVersion(),
  strictIcons: values['strict-icons'],
});
const count = report.violations.length;
if (catalog === undefined || (values.strict && count > 0)) {
  console.error(`catalog:build: ${String(count)} violation(s); nothing written.`);
  for (const line of formatViolations(report.violations)) console.error(line);
  process.exit(1);
}

function write(file: string, text: string): boolean {
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return true;
}

const modulePath = path.join(CATALOG_ROOT, GENERATED_MODULE);
const jsonPath = path.join(CATALOG_ROOT, DIST_CATALOG);
const changed = [
  write(jsonPath, renderCatalogJson(catalog)) ? DIST_CATALOG : undefined,
  write(modulePath, await renderCatalogModule(catalog, repositoryLicense(), modulePath))
    ? GENERATED_MODULE
    : undefined,
].filter((file): file is string => file !== undefined);
if (!values.quiet) {
  console.log(
    `catalog:build: ${String(catalog.products.length)} products, ${String(Object.keys(catalog.types).length)} types, ` +
      `official list ${catalog.officialListDate}; ${changed.length === 0 ? 'outputs unchanged' : `wrote ${changed.join(' and ')}`}.`,
  );
}
if (count > 0) {
  console.error(
    `catalog:build: ${String(count)} violation(s); left out ${String(excluded.length)} type(s) with a violation of their own` +
      `${excluded.length === 0 ? '' : ` (${excluded.join(', ')})`}, and any entry or file that does not validate. ` +
      'pnpm catalog:check lists them (--group <group> for one group).',
  );
}
