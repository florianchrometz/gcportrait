// SPDX-License-Identifier: MIT
/**
 * The few asset types the builder knows by identity. They are the spine of the containment model (skill
 * gcp-diagram-layout §2) and of alias resolution, not catalog data: labels, roles, relations and
 * containment rules of every type (these included) still come from `@gcportrait/catalog`.
 *
 * - The Resource Manager hierarchy (organisation, folder, project) is where `ancestors` point, the only
 *   parents a hierarchy node accepts, and the project node is one end of a derived `shares` edge.
 * - IAM service accounts are the identity cards views show or hide (`showIdentities`). Their e-mail aliases,
 *   like every alias, come from the catalog (`aliases` on the type).
 * - Which containers are the network layers (`vpc`, `subnet` zones that the `networks` detail level opens,
 *   skill gcp-diagram-layout §6) is catalog data too: a container type's `zoneKind`.
 * - Virtual region and zone containers (skill gcp-diagram-layout §2, rule 3) are the builder's own nodes;
 *   their service name is not a real API host, so their ids can never collide with an asset name.
 * - A project's Compute settings (`compute.googleapis.com/Project`, not the Resource Manager project) say
 *   whether it is a Shared VPC host (`xpnProjectStatus: HOST`); the Shared VPC derivation needs to know.
 */
import type { Asset, ProjectIndex } from '@gcportrait/model';

const RESOURCE_MANAGER = '//cloudresourcemanager.googleapis.com/';

export const ORGANIZATION_TYPE = 'cloudresourcemanager.googleapis.com/Organization';
export const FOLDER_TYPE = 'cloudresourcemanager.googleapis.com/Folder';
export const PROJECT_TYPE = 'cloudresourcemanager.googleapis.com/Project';
export const SERVICE_ACCOUNT_TYPE = 'iam.googleapis.com/ServiceAccount';

/** A project's Compute Engine settings; `data.xpnProjectStatus` is `HOST` on a Shared VPC host project. */
export const COMPUTE_PROJECT_TYPE = 'compute.googleapis.com/Project';

/** The resource hierarchy: these nest only in each other. */
export const HIERARCHY_TYPES: ReadonlySet<string> = new Set([ORGANIZATION_TYPE, FOLDER_TYPE, PROJECT_TYPE]);

/** The service of the builder's virtual nodes; not a real API host. */
export const VIRTUAL_SERVICE = 'gcportrait.virtual';
/** A virtual region (or multi-region) container under a project (skill gcp-diagram-layout §2, rule 3). */
export const REGION_TYPE = `${VIRTUAL_SERVICE}/Region`;
/** A virtual zone container under a region container. */
export const ZONE_TYPE = `${VIRTUAL_SERVICE}/Zone`;

const NUMBER = /^[1-9][0-9]*$/;

/** The node id of a project, by number: `//cloudresourcemanager.googleapis.com/projects/<number>`. */
export function projectNodeId(projectNumber: string): string {
  return `${RESOURCE_MANAGER}projects/${projectNumber}`;
}

/**
 * The node id an `ancestors` entry names (`projects/…`, `folders/…`, `organizations/…`). A project given by
 * id is translated to its number through the project index, because project nodes are named by number.
 */
export function ancestorNodeId(entry: string, projects: ProjectIndex): string {
  const match = /^projects\/(.+)$/.exec(entry);
  const ref = match?.[1];
  if (ref === undefined || NUMBER.test(ref)) return `${RESOURCE_MANAGER}${entry}`;
  const number = Object.hasOwn(projects.numberById, ref) ? projects.numberById[ref] : undefined;
  return `${RESOURCE_MANAGER}projects/${number ?? ref}`;
}

/** Whether a node id is one of the builder's virtual nodes. */
export function isVirtualNode(id: string): boolean {
  return id.startsWith(`//${VIRTUAL_SERVICE}/`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether the asset is a project's Compute settings marking it a Shared VPC host. */
export function isSharedVpcHostSettings(asset: Pick<Asset, 'assetType' | 'data'>): boolean {
  return (
    asset.assetType === COMPUTE_PROJECT_TYPE &&
    isRecord(asset.data) &&
    asset.data['xpnProjectStatus'] === 'HOST'
  );
}
