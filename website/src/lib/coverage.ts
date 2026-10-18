// SPDX-License-Identifier: Apache-2.0
/**
 * The asset catalog's coverage, for the coverage page and the landing page's numbers, from the catalog's compiled
 * data (`catalog` of @gcportrait/catalog: products, types with their roles and console templates, lenses) and its
 * coverage report (`pnpm catalog:coverage --json`: the official list, and per authoring group the types it owns,
 * the mapped ones by role, and the unmapped ones with their reasons). Both are computed at build time, so the page
 * is never out of date with the catalog it is built with.
 */
import { execFileSync } from 'node:child_process';

import { catalog, typesWithoutConsole } from '@gcportrait/catalog';

import { repoRoot } from './repo.js';

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

export type GroupCoverage = {
  readonly group: string;
  readonly title: string;
  readonly official: number;
  readonly mapped: Readonly<Record<Role, number>> & { readonly total: number };
  readonly unmapped: readonly { readonly type: string; readonly reason: string }[];
  readonly coveragePercent: number;
};

export type CoverageReport = {
  readonly officialDate: string;
  readonly officialTotal: number;
  readonly groups: readonly GroupCoverage[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`catalog:coverage --json: ${what} is not a number`);
  return value;
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`catalog:coverage --json: ${what} is not a string`);
  return value;
}

/** Reads the JSON `pnpm catalog:coverage --json` prints (exported for the tests). */
export function parseCoverageReport(json: string): CoverageReport {
  const raw: unknown = JSON.parse(json);
  if (!isRecord(raw) || !isRecord(raw.officialList) || !Array.isArray(raw.groups)) {
    throw new Error('catalog:coverage --json: unexpected shape');
  }
  const groups = raw.groups.map((group: unknown, index): GroupCoverage => {
    if (!isRecord(group) || !isRecord(group.mapped) || !isRecord(group.unmapped)) {
      throw new Error(`catalog:coverage --json: group ${String(index)} has an unexpected shape`);
    }
    const types = isRecord(group.unmapped.types) ? group.unmapped.types : {};
    return {
      group: str(group.group, 'group'),
      title: str(group.title, 'title'),
      official: num(group.official, 'official'),
      mapped: {
        container: num(group.mapped.container, 'mapped.container'),
        core: num(group.mapped.core, 'mapped.core'),
        leaf: num(group.mapped.leaf, 'mapped.leaf'),
        hidden: num(group.mapped.hidden, 'mapped.hidden'),
        total: num(group.mapped.total, 'mapped.total'),
      },
      unmapped: Object.entries(types)
        .map(([type, reason]) => ({ type, reason: str(reason, `unmapped reason of ${type}`) }))
        .sort((a, b) => (a.type < b.type ? -1 : 1)),
      coveragePercent: num(group.coveragePercent, 'coveragePercent'),
    };
  });
  return {
    officialDate: str(raw.officialList.date, 'officialList.date'),
    officialTotal: num(raw.officialList.total, 'officialList.total'),
    groups,
  };
}

let cachedReport: CoverageReport | undefined;

/** `pnpm catalog:coverage --json`, run once per build. */
export function coverageReport(): CoverageReport {
  if (cachedReport !== undefined) return cachedReport;
  const execPath = process.env.npm_execpath;
  const viaNode = execPath !== undefined && /\.c?js$/.test(execPath);
  const command = viaNode
    ? process.execPath
    : execPath !== undefined && /pnpm/.test(execPath)
      ? execPath
      : 'pnpm';
  const args = [...(viaNode ? [execPath] : []), '--silent', 'catalog:coverage', '--json'];
  const output = execFileSync(command, args, {
    cwd: repoRoot(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  cachedReport = parseCoverageReport(output);
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
