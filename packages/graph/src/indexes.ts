// SPDX-License-Identifier: Apache-2.0
/** The graph's lookup indexes: by type, project, address and host name. */
import type { GraphIndexes, GraphNode } from '@gcportrait/model';
import { compareStrings, sortedRecord } from './order.js';

function add(index: Map<string, string[]>, key: string, id: string): void {
  const list = index.get(key);
  if (list === undefined) index.set(key, [id]);
  else list.push(id);
}

/**
 * Builds the indexes. Every node is in `byType`; `byProject` is keyed by project id, or by number when the
 * id is unknown; `byIp` and `byDomain` by every address and host name the catalog extracted. Lists are in
 * node-id order, keys sorted. `aliases` is the alias index.
 */
export function buildIndexes(nodes: Iterable<GraphNode>, aliases: ReadonlyMap<string, string>): GraphIndexes {
  const byType = new Map<string, string[]>();
  const byProject = new Map<string, string[]>();
  const byIp = new Map<string, string[]>();
  const byDomain = new Map<string, string[]>();
  for (const node of [...nodes].sort((a, b) => compareStrings(a.id, b.id))) {
    add(byType, node.assetType, node.id);
    const project = node.projectId ?? node.projectNumber;
    if (project !== undefined) add(byProject, project, node.id);
    for (const ip of node.ips) add(byIp, ip, node.id);
    for (const domain of node.domains) add(byDomain, domain, node.id);
  }
  return {
    byType: sortedRecord(byType),
    byProject: sortedRecord(byProject),
    byIp: sortedRecord(byIp),
    byDomain: sortedRecord(byDomain),
    aliases: sortedRecord(aliases),
  };
}
