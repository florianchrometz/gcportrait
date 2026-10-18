// SPDX-License-Identifier: Apache-2.0
/**
 * A small synthetic catalog for the compiler's unit tests (not part of the public API): one Compute Engine product
 * file mapping Network and Subnetwork, a fixture of each, every lens, the group net (which owns
 * compute.googleapis.com/* and lists Route as unmapped) and the icon keys. A test takes a fresh world, plants
 * one problem in it and compiles it against a three-type official list.
 */
import { LensIdSchema } from '@gcportrait/model';
import { compileCatalog } from '../compiler/compile.js';
import { scopeReport, type ScopedResult } from '../compiler/scope.js';
import type {
  CatalogSources,
  CoverageReport,
  OfficialList,
  SourceFile,
  UnparsedFile,
  Violation,
  ViolationCode,
} from '../compiler/types.js';
import { rawAsset } from './assets.js';

export const SELF = 'https://www.googleapis.com/compute/v1/projects';
export const NETWORK = 'compute.googleapis.com/Network';
export const SUBNETWORK = 'compute.googleapis.com/Subnetwork';
export const ROUTE = 'compute.googleapis.com/Route';
export const ZONE = 'dns.googleapis.com/ManagedZone';
export const NET_GROUP = 'known-unmapped/net.yaml';
export const DNS_GROUP = 'known-unmapped/dns.yaml';
export const COMPUTE_FILE = 'products/compute.googleapis.com.yaml';

export function source(path: string, content: unknown, lineOf?: SourceFile['lineOf']): SourceFile {
  return lineOf === undefined ? { path, content } : { path, content, lineOf };
}

export const networkFixture = rawAsset(
  '//compute.googleapis.com/projects/demo-net-1/global/networks/core',
  NETWORK,
  {
    name: 'core',
    subnetworks: [`${SELF}/demo-net-1/regions/europe-west3/subnetworks/app`],
    peerings: [{ network: `${SELF}/demo-partner-1/global/networks/partner` }],
  },
  { location: 'global' },
);

export const subnetFixture = rawAsset(
  '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/app',
  SUBNETWORK,
  {
    name: 'app',
    network: `${SELF}/demo-net-1/global/networks/core`,
    ipCidrRange: '10.10.0.0/20',
  },
);

/** A Private NAT subnetwork: what the planted `hiddenWhen` of the tests hides. */
export const natSubnetFixture = rawAsset(
  '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/nat',
  SUBNETWORK,
  {
    name: 'nat',
    network: `${SELF}/demo-net-1/global/networks/core`,
    ipCidrRange: '10.11.0.0/24',
    purpose: 'PRIVATE_NAT',
  },
);

export interface World {
  products: Record<string, unknown>;
  fixtures: Record<string, unknown>;
  lenses: Record<string, unknown>;
  groups: Record<string, unknown>;
  icons: unknown;
}

export function world(): World {
  const lens = { title: 'Lens', description: 'A lens.', types: ['*'], relationKinds: ['contains'] };
  return {
    products: {
      [COMPUTE_FILE]: {
        product: 'Compute Engine',
        service: 'compute.googleapis.com',
        icon: 'compute_engine',
        types: {
          [NETWORK]: {
            role: 'container',
            label: '{{data.name}}',
            icon: 'virtual_private_cloud',
            console:
              'https://console.cloud.google.com/networking/networks/details/{{data.name}}?project={{projectId}}',
            relations: [{ kind: 'peers', to: '$.data.peerings[*].network', normalize: 'computeSelfLink' }],
            contains: ['$.data.subnetworks[*]'],
          },
          [SUBNETWORK]: {
            role: 'container',
            label: '{{data.name}}',
            subtitle: '{{data.ipCidrRange}}',
            ips: ['$.data.ipCidrRange'],
            relations: [{ kind: 'attaches', to: '$.data.network', normalize: 'computeSelfLink' }],
          },
        },
      },
    },
    fixtures: {
      'fixtures/compute.googleapis.com/Network.json': networkFixture,
      'fixtures/compute.googleapis.com/Subnetwork.json': [subnetFixture],
    },
    lenses: Object.fromEntries(LensIdSchema.options.map((id) => [`lenses/${id}.yaml`, lens])),
    groups: {
      [NET_GROUP]: {
        title: 'Networking',
        owns: ['compute.googleapis.com/*'],
        types: { [ROUTE]: 'pending (networking-fabric)' },
      },
    },
    icons: { description: 'Icon keys.', keys: ['compute_engine', 'virtual_private_cloud'] },
  };
}

export function sources(
  w: World,
  loadViolations: Violation[] = [],
  unparsed: UnparsedFile[] = [],
): CatalogSources {
  const files = (record: Record<string, unknown>) =>
    Object.entries(record).map(([path, content]) => source(path, content));
  return {
    products: files(w.products),
    lenses: files(w.lenses),
    fixtures: files(w.fixtures),
    knownUnmapped: files(w.groups),
    iconKeys: w.icons === undefined ? undefined : source('icon-keys.json', w.icons),
    loadViolations,
    unparsed,
  };
}

export const OFFICIAL: OfficialList = {
  date: '2026-10-08',
  file: 'references/cai-supported-asset-types.2026-10-08.txt',
  types: new Set([NETWORK, SUBNETWORK, ROUTE]),
};

export function compile(
  w: World,
  official: OfficialList = OFFICIAL,
  loadViolations: Violation[] = [],
  options: { strictIcons?: boolean; trace?: boolean } = {},
  unparsed: UnparsedFile[] = [],
): ReturnType<typeof compileCatalog> {
  return compileCatalog(sources(w, loadViolations, unparsed), official, { version: '1.2.3', ...options });
}

/** The violation codes of a compiled world. */
export function codes(w: World, official?: OfficialList): ViolationCode[] {
  return compile(w, official).report.violations.map((violation) => violation.code);
}

/** Violations as `code file`. */
export function show(violations: readonly Violation[]): string[] {
  return violations.map((v) => `${v.code} ${v.file ?? ''}`);
}

/** The group file of a world, for planting changes. */
export function group(
  w: World,
  path = NET_GROUP,
): { title: string; owns: string[]; types: Record<string, string> } {
  const content = w.groups[path] as
    { title: string; owns: string[]; types: Record<string, string> } | undefined;
  if (content === undefined) throw new Error(`no ${path}`);
  return content;
}

/** A product file of a world, for planting changes. */
export function product(w: World, path = COMPUTE_FILE): { product: string; types: Record<string, unknown> } {
  const content = w.products[path] as { product: string; types: Record<string, unknown> } | undefined;
  if (content === undefined) throw new Error(`no ${path}`);
  return content;
}

/** The type entry of the Compute Engine product file of a world, for planting changes. */
export function typeOf(w: World, assetType: string): Record<string, unknown> {
  const entry = product(w).types[assetType] as Record<string, unknown> | undefined;
  if (entry === undefined) throw new Error(`no ${assetType}`);
  return entry;
}

/** Every file of a world (and `extra` ones the loader saw but could not read): what `--group`/`--file` know. */
export function known(w: World, extra: string[] = []): Set<string> {
  return new Set([
    ...Object.keys(w.products),
    ...Object.keys(w.fixtures),
    ...Object.keys(w.groups),
    ...extra,
  ]);
}

/** A report scoped to one group, as `pnpm catalog:check --group <stem>` scopes it. */
export function scoped(report: CoverageReport, w: World, stem: string, extra: string[] = []): ScopedResult {
  return scopeReport(report, { groups: [stem], files: [] }, known(w, extra));
}

export const WEB_GROUP = 'known-unmapped/web.yaml';
export const NET_FILE = 'products/compute.googleapis.com.net.yaml';
export const WEB_FILE = 'products/compute.googleapis.com.web.yaml';

/**
 * Two groups sharing compute.googleapis.com, each with its own product file: net owns compute.googleapis.com/*
 * and maps Network and Subnetwork; web owns Route, the more specific owner, and maps it.
 */
export function shared(): World {
  const w = world();
  w.products = {
    [NET_FILE]: product(w),
    [WEB_FILE]: {
      product: 'Compute Engine',
      service: 'compute.googleapis.com',
      icon: 'compute_engine',
      types: { [ROUTE]: { role: 'leaf', label: 'web {{data.name}}' } },
    },
  };
  group(w).types = {};
  w.groups[WEB_GROUP] = { title: 'Web', owns: [ROUTE], types: {} };
  return w;
}
