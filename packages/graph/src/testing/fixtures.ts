// SPDX-License-Identifier: MIT
/**
 * Test helpers: synthetic assets (organisation 30000000001, folders 2000000000x, projects demo-<role>-<n> with
 * numbers 1000000000x, example.com addresses, private and documentation IP ranges) and catalogs built from
 * product entries in the YAML shape. Not part of the public API.
 */
import { catalog as realCatalog } from '@gcportrait/catalog';
import {
  CatalogEntrySchema,
  CatalogSchema,
  type Asset,
  type Catalog,
  type CatalogType,
  type GraphNode,
} from '@gcportrait/model';
import type * as z from 'zod';

export const ORG_NUMBER = '30000000001';
export const ORG = `//cloudresourcemanager.googleapis.com/organizations/${ORG_NUMBER}`;
export const UPDATED = '2026-10-01T08:00:00.000000Z';

export function folderName(number: string): string {
  return `//cloudresourcemanager.googleapis.com/folders/${number}`;
}

export function projectName(number: string): string {
  return `//cloudresourcemanager.googleapis.com/projects/${number}`;
}

export function organization(): Asset {
  return {
    name: ORG,
    assetType: 'cloudresourcemanager.googleapis.com/Organization',
    ancestors: [`organizations/${ORG_NUMBER}`],
    location: 'global',
    updateTime: UPDATED,
    data: { name: `organizations/${ORG_NUMBER}`, displayName: 'example.com', lifecycleState: 'ACTIVE' },
  };
}

/** A folder; `ancestors` are the folder's own ancestors above it, closest first, ending at the organisation. */
export function folder(number: string, displayName: string, above: readonly string[] = []): Asset {
  const parent = above[0] ?? `organizations/${ORG_NUMBER}`;
  return {
    name: folderName(number),
    assetType: 'cloudresourcemanager.googleapis.com/Folder',
    parent: `//cloudresourcemanager.googleapis.com/${parent}`,
    ancestors: [`folders/${number}`, ...above, `organizations/${ORG_NUMBER}`],
    location: 'global',
    updateTime: UPDATED,
    data: { name: `folders/${number}`, parent, displayName, lifecycleState: 'ACTIVE' },
  };
}

/** A project in the Resource Manager v1 shape, under the given folders (closest first) or the organisation. */
export function project(number: string, projectId: string, folders: readonly string[] = []): Asset {
  const [closest] = folders;
  return {
    name: projectName(number),
    assetType: 'cloudresourcemanager.googleapis.com/Project',
    parent: closest === undefined ? ORG : folderName(closest),
    ancestors: [`projects/${number}`, ...folders.map((f) => `folders/${f}`), `organizations/${ORG_NUMBER}`],
    location: 'global',
    updateTime: UPDATED,
    data: {
      projectNumber: number,
      projectId,
      name: projectId,
      lifecycleState: 'ACTIVE',
      parent:
        closest === undefined ? { type: 'organization', id: ORG_NUMBER } : { type: 'folder', id: closest },
    },
  };
}

export interface ResourceOptions {
  readonly location?: string;
  readonly parent?: string;
  readonly folders?: readonly string[];
  readonly updateTime?: string;
}

/** Any resource in a project (by number): `parent` defaults to the project, `ancestors` start at it. */
export function resource(
  name: string,
  assetType: string,
  projectNumber: string,
  data: unknown,
  options: ResourceOptions = {},
): Asset {
  return {
    name,
    assetType,
    parent: options.parent ?? projectName(projectNumber),
    ancestors: [
      `projects/${projectNumber}`,
      ...(options.folders ?? []).map((f) => `folders/${f}`),
      `organizations/${ORG_NUMBER}`,
    ],
    ...(options.location === undefined ? {} : { location: options.location }),
    updateTime: options.updateTime ?? UPDATED,
    data,
  };
}

/** A Graph node for the builder's unit steps: a visible core card of a made-up type, with `extra` on top. */
export function graphNode(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    assetType: 'a.googleapis.com/Thing',
    label: 'x',
    role: 'core',
    product: 'p',
    ips: [],
    domains: [],
    hidden: false,
    ...extra,
  };
}

const COMPUTE = 'https://www.googleapis.com/compute/v1/projects';

/** A Compute self-link. */
export function selfLink(projectId: string, path: string): string {
  return `${COMPUTE}/${projectId}/${path}`;
}

/** A Compute full resource name. */
export function computeName(projectId: string, path: string): string {
  return `//compute.googleapis.com/projects/${projectId}/${path}`;
}

/** A VPC network listing its subnetworks (as the API does) and optional peerings. */
export function network(
  projectNumber: string,
  projectId: string,
  name: string,
  subnets: readonly string[] = [],
  peerings: readonly string[] = [],
): Asset {
  return resource(
    computeName(projectId, `global/networks/${name}`),
    'compute.googleapis.com/Network',
    projectNumber,
    {
      name,
      selfLink: selfLink(projectId, `global/networks/${name}`),
      routingConfig: { routingMode: 'GLOBAL' },
      subnetworks: subnets.map((subnet) => selfLink(projectId, subnet)),
      peerings: peerings.map((peer, index) => ({ name: `peer-${String(index)}`, network: peer })),
    },
    { location: 'global' },
  );
}

/** A subnetwork `regions/<region>/subnetworks/<name>` of a network in the same project. */
export function subnetwork(
  projectNumber: string,
  projectId: string,
  region: string,
  name: string,
  networkName: string,
  cidr: string,
): Asset {
  return resource(
    computeName(projectId, `regions/${region}/subnetworks/${name}`),
    'compute.googleapis.com/Subnetwork',
    projectNumber,
    {
      name,
      network: selfLink(projectId, `global/networks/${networkName}`),
      ipCidrRange: cidr,
      region: selfLink(projectId, `regions/${region}`),
    },
    { location: region },
  );
}

/** A product entry as written in YAML (defaults not applied yet). */
export type CatalogEntryInput = z.input<typeof CatalogEntrySchema>;

/**
 * A catalog: the real compiled catalog with the given product entries added. In `override` mode an entry's
 * types replace the real ones; in `fill` mode only types the real catalog lacks are added (the real rules
 * win). Validated with `CatalogSchema`, so a test catalog is as consistent as the compiled one.
 */
export function catalogWith(
  entries: readonly CatalogEntryInput[],
  mode: 'override' | 'fill' = 'override',
  base: Catalog = realCatalog,
): Catalog {
  const products = base.products.map((product) => ({ ...product, types: [...product.types] }));
  const types: Record<string, CatalogType> = { ...base.types };
  for (const input of entries) {
    const entry = CatalogEntrySchema.parse(input);
    let product = products.find((candidate) => candidate.service === entry.service);
    if (product === undefined) {
      product = { product: entry.product, service: entry.service, icon: entry.icon, types: [] };
      products.push(product);
    }
    for (const [assetType, type] of Object.entries(entry.types)) {
      const existing = types[assetType];
      if (existing !== undefined && mode === 'fill') continue;
      if (existing !== undefined) {
        const owner = products.find((candidate) => candidate.types.includes(assetType));
        if (owner !== undefined) owner.types = owner.types.filter((t) => t !== assetType);
      }
      product.types.push(assetType);
      types[assetType] = {
        ...type,
        assetType,
        product: product.product,
        service: product.service,
        icon: type.icon ?? product.icon,
      };
    }
  }
  return CatalogSchema.parse({ ...base, products, types });
}

/** The real compiled catalog. */
export const REAL_CATALOG: Catalog = realCatalog;
