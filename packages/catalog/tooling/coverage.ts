// SPDX-License-Identifier: MIT
/**
 * `pnpm --filter @gcportrait/catalog coverage` (also `pnpm catalog:coverage`): per authoring group, the
 * official types it owns, how many the catalog maps (by role), which are listed as unmapped (by reason) and
 * which are missing from both. A report, not a gate: it exits 0 unless a `--group` does not exist;
 * `pnpm catalog:check` is the gate.
 *
 *   --group <group>   only these groups (repeatable)
 *   --json            the groups as JSON, with every unmapped type and its reason
 *   --root <dir>      another catalog directory (tests)
 *   --official <dir>  the official snapshot from another directory (tests)
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { compileCatalog } from '../src/compiler/compile.js';
import { formatGroupDetails } from '../src/compiler/report.js';
import { CATALOG_ROOT, catalogVersion, loadSources, readOfficialList } from './files.js';

const { values } = parseArgs({
  options: {
    group: { type: 'string', multiple: true, default: [] },
    json: { type: 'boolean', default: false },
    root: { type: 'string' },
    official: { type: 'string' },
  },
});

const root = values.root === undefined ? CATALOG_ROOT : path.resolve(values.root);
const officialList =
  values.official === undefined ? readOfficialList() : readOfficialList(path.resolve(values.official));
const { report } = compileCatalog(loadSources(root), officialList, { version: catalogVersion(root) });
const wanted = values.group.map((group) => path.basename(group).replace(/\.yaml$/, ''));
const unknown = wanted.filter((stem) => !report.groups.some((group) => group.group === stem));
if (unknown.length > 0) {
  console.error(
    `catalog:coverage: no group ${unknown.join(', ')}; the groups are: ${report.groups.map((g) => g.group).join(', ')}`,
  );
  process.exit(2);
}
const groups =
  wanted.length === 0 ? report.groups : report.groups.filter((group) => wanted.includes(group.group));

if (values.json) {
  const output = {
    officialList: report.officialList,
    groups,
    ...(wanted.length === 0 ? { ungrouped: report.ungrouped } : {}),
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} else {
  console.log(
    `catalog:coverage: official list ${report.officialList.date}; per group: official types owned · mapped (by role) · unmapped · missing · coverage`,
  );
  for (const line of formatGroupDetails(groups)) console.log(line);
  if (wanted.length === 0) {
    console.log(
      `  types no group owns: ${report.ungrouped.length === 0 ? 'none' : report.ungrouped.join(', ')}`,
    );
  }
}
