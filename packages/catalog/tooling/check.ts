// SPDX-License-Identifier: Apache-2.0
/**
 * `pnpm catalog:check` (`pnpm --filter @gcportrait/catalog check`): validates the catalog and prints the
 * coverage report of skill gcp-asset-catalog §8, per authoring group too. Exits 1 on any violation.
 *
 *   --json                 the report as JSON (use `pnpm -s catalog:check --json` so pnpm adds nothing to stdout)
 *   --group <group>        only the problems blamed on one group's files (`known-unmapped/<group>.yaml`, its product
 *                          files and fixtures); repeatable; other groups' files may be mid-edit. Problems blamed on
 *                          other files that name one of yours are listed as notes and do not fail the check
 *   --file <path>          only the problems of one file (catalog-relative, repository-relative or absolute);
 *                          repeatable, combines with --group
 *   --verbose              every rule's fixture resolution (rule → fixture value → normalised name) and every warning
 *   --strict-icons         icon keys missing from icon-keys.json fail instead of warning
 *   --root <dir>           check another catalog directory (tests)
 *   --official <dir>       read the official snapshot from another directory (tests)
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { compileCatalog } from '../src/compiler/compile.js';
import { formatReport } from '../src/compiler/report.js';
import { ScopeError, scopeReport, type ScopedResult } from '../src/compiler/scope.js';
import type { CoverageReport, Violation } from '../src/compiler/types.js';
import {
  CATALOG_ROOT,
  REPO_ROOT,
  catalogVersion,
  committedGeneratedFiles,
  loadSources,
  readOfficialList,
  sourcePaths,
} from './files.js';

const { values } = parseArgs({
  options: {
    json: { type: 'boolean', default: false },
    group: { type: 'string', multiple: true, default: [] },
    file: { type: 'string', multiple: true, default: [] },
    verbose: { type: 'boolean', default: false },
    'strict-icons': { type: 'boolean', default: false },
    root: { type: 'string' },
    official: { type: 'string' },
  },
});

const root = values.root === undefined ? CATALOG_ROOT : path.resolve(values.root);
const sources = loadSources(root);
const known = sourcePaths(sources);
const officialList =
  values.official === undefined ? readOfficialList() : readOfficialList(path.resolve(values.official));
const { report, trace } = compileCatalog(sources, officialList, {
  version: catalogVersion(root),
  strictIcons: values['strict-icons'],
  trace: values.verbose,
});

const committed: Violation[] = committedGeneratedFiles(root).map((file) => ({
  code: 'generated-committed',
  file,
  message:
    'is a build artefact of pnpm catalog:build and is git-ignored: remove it from git (git rm --cached) and commit only the YAML and fixtures',
}));
const full: CoverageReport = { ...report, violations: [...report.violations, ...committed] };

/** A `--file` argument as a catalog-relative path, whichever way it was written. */
function catalogPath(file: string): string {
  const candidates = [
    file,
    file.replace(/^packages\/catalog\//, ''),
    path.relative(root, path.resolve(process.env['INIT_CWD'] ?? process.cwd(), file)),
    path.relative(root, path.resolve(REPO_ROOT, file)),
  ].map((candidate) => candidate.split(path.sep).join('/'));
  return candidates.find((candidate) => known.has(candidate)) ?? file;
}

/** A `--group` argument as a group stem: `networking-fabric`, with or without directory and `.yaml`. */
function groupStem(group: string): string {
  return path.basename(group).replace(/\.yaml$/, '');
}

let scoped: ScopedResult | undefined;
if (values.group.length > 0 || values.file.length > 0) {
  try {
    scoped = scopeReport(
      full,
      { groups: values.group.map(groupStem), files: values.file.map(catalogPath) },
      known,
      trace,
    );
  } catch (error) {
    if (!(error instanceof ScopeError)) throw error;
    console.error(`catalog:check: ${error.message}`);
    process.exit(2);
  }
}

const shown = scoped?.report ?? full;
const shownTrace = scoped === undefined ? trace : scoped.trace;
if (values.json) {
  const output = {
    ...shown,
    ...(scoped === undefined
      ? {}
      : {
          scope: {
            groups: values.group.map(groupStem),
            files: scoped.files,
            outside: scoped.outside,
            related: scoped.related,
          },
        }),
    ...(shownTrace === undefined ? {} : { trace: shownTrace }),
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} else {
  const label = [
    ...values.group.map((group) => `group ${groupStem(group)}`),
    ...values.file.map((file) => `file ${catalogPath(file)}`),
  ].join(', ');
  const lines = formatReport(shown, {
    ...(scoped === undefined
      ? {}
      : {
          scope: { label, files: scoped.files.length, outside: scoped.outside, related: scoped.related },
        }),
    ...(shownTrace === undefined ? {} : { trace: shownTrace }),
    verbose: values.verbose,
  });
  for (const line of lines) console.log(line);
}
process.exitCode = shown.violations.length === 0 ? 0 : 1;
