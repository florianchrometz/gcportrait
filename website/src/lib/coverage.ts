// SPDX-License-Identifier: Apache-2.0
/**
 * The asset catalog's coverage, for the coverage page and the landing page's numbers, from the catalog's compiled
 * data (`catalog` of @gcportrait/catalog: products, types with their roles and console templates, lenses) and its
 * coverage data (`packages/catalog/dist/coverage.json`, which `pnpm catalog:build` writes next to the compiled
 * catalog: the official list, and per authoring group the types it owns, the mapped ones by role, and the
 * unmapped ones with their reasons — the shape is the catalog's, `CatalogCoverage`). Both are computed at build
 * time, so the page is never out of date with the catalog it is built with, and the site's build runs no command.
 */
import { catalog, typesWithoutConsole, type CatalogCoverage } from '@gcportrait/catalog';

import { readRepoFile } from './repo.js';

export const ROLES = ['container', 'core', 'leaf', 'hidden'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_DESCRIPTIONS: Readonly<Record<Role, string>> = {
  container:
    'drawn as a zone other resources nest in (VPC networks, subnetworks, clusters, datasets, key rings)',
  core: 'drawn as a card with arrows: it references other resources or is referenced by them',
  leaf: 'drawn as a card without arrows: worth seeing, with no references beyond its parent',
  hidden:
    'read and counted in its parent’s badge but not drawn by default (builds, job runs, versions, settings); a type filter shows it',
};

/** The coverage data `pnpm catalog:build` writes, relative to the repository root (git-ignored). */
const COVERAGE_FILE = 'packages/catalog/dist/coverage.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether the text holds the coverage `pnpm catalog:build` writes (its shape is the catalog's). */
function isCoverage(value: unknown): value is CatalogCoverage {
  return (
    isRecord(value) &&
    typeof value.officialDate === 'string' &&
    typeof value.officialTotal === 'number' &&
    Array.isArray(value.groups)
  );
}

/** Reads `dist/coverage.json` (exported for the tests): refuses text that is not what the catalog's build writes. */
export function parseCoverageJson(text: string): CatalogCoverage {
  const raw: unknown = JSON.parse(text);
  if (!isCoverage(raw)) {
    throw new Error(
      `${COVERAGE_FILE} is not the coverage \`pnpm catalog:build\` writes: rebuild the catalog.`,
    );
  }
  return raw;
}

let cachedReport: CatalogCoverage | undefined;

/** The catalog's coverage data, read once per build; `pnpm catalog:build` writes it with the compiled catalog. */
export function coverageReport(): CatalogCoverage {
  if (cachedReport !== undefined) return cachedReport;
  const text = readRepoFile(COVERAGE_FILE);
  if (text === undefined) {
    throw new Error(
      `${COVERAGE_FILE} is missing: run \`pnpm catalog:build\` (it writes it with the catalog).`,
    );
  }
  cachedReport = parseCoverageJson(text);
  return cachedReport;
}

export type ProductCoverage = {
  readonly product: string;
  readonly service: string;
  readonly types: readonly { readonly type: string; readonly role: Role; readonly console: boolean }[];
};

/** The catalog's products with their types, by product name. */
export function products(): ProductCoverage[] {
  return catalog.products
    .map((product) => ({
      product: product.product,
      service: product.service,
      types: product.types
        .map((type) => {
          const entry = catalog.types[type];
          return { type, role: entry?.role ?? 'hidden', console: entry?.console !== undefined };
        })
        .sort((a, b) => (a.type < b.type ? -1 : 1)),
    }))
    .sort((a, b) => a.product.localeCompare(b.product, 'en') || a.service.localeCompare(b.service, 'en'));
}

export type Totals = {
  readonly mapped: number;
  readonly byRole: Readonly<Record<Role, number>>;
  readonly withConsole: number;
  readonly withConsoleByRole: Readonly<Record<Role, number>>;
  readonly products: number;
  readonly lenses: number;
};

/** The catalog's numbers: mapped types by role, console templates by role, products, lenses. */
export function totals(): Totals {
  const byRole: Record<Role, number> = { container: 0, core: 0, leaf: 0, hidden: 0 };
  const withConsoleByRole: Record<Role, number> = { container: 0, core: 0, leaf: 0, hidden: 0 };
  const without = new Set(typesWithoutConsole(catalog));
  for (const [type, entry] of Object.entries(catalog.types)) {
    const role = entry.role;
    byRole[role] += 1;
    if (!without.has(type)) withConsoleByRole[role] += 1;
  }
  const mapped = Object.keys(catalog.types).length;
  return {
    mapped,
    byRole,
    withConsole: mapped - without.size,
    withConsoleByRole,
    products: catalog.products.length,
    lenses: Object.keys(catalog.lenses).length,
  };
}

/** A share as a percentage with one decimal ("98.6"). */
export function percent(part: number, whole: number): string {
  return whole === 0 ? '0' : ((part * 100) / whole).toFixed(1);
}
