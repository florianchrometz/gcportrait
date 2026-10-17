// SPDX-License-Identifier: MIT
/**
 * Virtual region and zone containers (skill gcp-diagram-layout §2, rule 3).
 * Only built when the view asks for them (`showRegions`). They group a project's direct children by
 * `location` — a zonal resource in Project › region › zone, a regional or multi-regional one in Project ›
 * region — and never touch what sits deeper: a VPC is global and stays under the project, its subnets and
 * everything nested in them stay where they are. What is a zone and which region holds it is the one rule
 * of `@gcportrait/model` (`isZone`, `regionOfZone`, `isRegion`), which the regions filter follows too.
 */
import { isRegion, isZone, regionOfZone, type GraphNode } from '@gcportrait/model';
import { PROJECT_TYPE, REGION_TYPE, VIRTUAL_SERVICE, ZONE_TYPE } from './structure.js';

const LOCATION = /^[a-z0-9][a-z0-9-]*$/;

function virtualNode(
  id: string,
  assetType: string,
  location: string,
  subtitle: string,
  project: GraphNode,
): GraphNode {
  return {
    id,
    assetType,
    label: location,
    subtitle,
    role: 'container',
    product: VIRTUAL_SERVICE,
    ...(project.projectId === undefined ? {} : { projectId: project.projectId }),
    ...(project.projectNumber === undefined ? {} : { projectNumber: project.projectNumber }),
    location,
    ips: [],
    domains: [],
    hidden: false,
  };
}

/**
 * Moves every direct child of a project that has a non-global location into a virtual region container (and
 * a zone container inside it for a zone), creating the containers on first use. Mutates `nodes` and `parent`;
 * returns how many virtual nodes it added. Ids: `//gcportrait.virtual/projects/<project>/locations/<region>`
 * and `…/zones/<zone>` below it.
 */
export function addRegionContainers(
  ids: readonly string[],
  nodes: Map<string, GraphNode>,
  parent: Map<string, string>,
): number {
  let added = 0;
  const ensure = (node: GraphNode, container: string): void => {
    if (nodes.has(node.id)) return;
    nodes.set(node.id, node);
    parent.set(node.id, container);
    added += 1;
  };
  for (const id of ids) {
    const projectId = parent.get(id);
    const project = projectId === undefined ? undefined : nodes.get(projectId);
    const location = nodes.get(id)?.location?.toLowerCase();
    if (projectId === undefined || project?.assetType !== PROJECT_TYPE || location === undefined) continue;
    if (location === 'global' || !LOCATION.test(location)) continue;
    const zonal = isZone(location);
    const region = regionOfZone(location);
    const projectKey =
      project.projectId ?? project.projectNumber ?? projectId.slice(projectId.lastIndexOf('/') + 1);
    const regionId = `//${VIRTUAL_SERVICE}/projects/${projectKey}/locations/${region}`;
    ensure(
      virtualNode(regionId, REGION_TYPE, region, isRegion(region) ? 'region' : 'multi-region', project),
      projectId,
    );
    if (!zonal) {
      parent.set(id, regionId);
      continue;
    }
    const zoneId = `${regionId}/zones/${location}`;
    ensure(virtualNode(zoneId, ZONE_TYPE, location, 'zone', project), regionId);
    parent.set(id, zoneId);
  }
  return added;
}
