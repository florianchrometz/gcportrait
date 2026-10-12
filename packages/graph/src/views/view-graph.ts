// SPDX-License-Identifier: MIT
/**
 * The scene builder's working copy of a Graph: the nodes and the containment forest as Maps, with the virtual
 * region and zone containers (skill gcp-diagram-layout §2, rule 3) present exactly when the view asks for
 * them, whatever the graph was built with. Everything is iterated in node-id order, so nothing depends on the
 * order of the graph's records.
 */
import type { Graph, GraphNode } from '@gcportrait/model';
import { compareStrings } from '../order.js';
import { addRegionContainers } from '../regions.js';
import { PROJECT_TYPE, isVirtualNode, projectNodeId } from '../structure.js';

export interface ViewGraph {
  readonly graph: Graph;
  readonly nodes: ReadonlyMap<string, GraphNode>;
  /** Child → parent. */
  readonly parent: ReadonlyMap<string, string>;
  /** Parent → children, each list in id order. */
  readonly children: ReadonlyMap<string, readonly string[]>;
  /** Every node id, sorted. */
  readonly ids: readonly string[];
  /** Whether the virtual region and zone containers are present. */
  readonly regions: boolean;
}

/** The working copy, with virtual region containers added (`regions`) or removed (otherwise). */
export function viewGraph(graph: Graph, regions: boolean): ViewGraph {
  const entries = Object.entries(graph.nodes).sort(([a], [b]) => compareStrings(a, b));
  const ids = entries.map(([id]) => id);
  const nodes = new Map<string, GraphNode>(entries);
  const parent = new Map<string, string>();
  for (const id of ids) {
    const container = graph.containment.parent[id];
    if (container !== undefined) parent.set(id, container);
  }
  const virtual = ids.filter(isVirtualNode);
  if (regions && virtual.length === 0) {
    addRegionContainers(ids, nodes, parent);
  } else if (!regions && virtual.length > 0) {
    // Lift every child of a virtual container to the first real ancestor, then drop the virtual nodes.
    for (const id of ids) {
      let container = parent.get(id);
      while (container !== undefined && isVirtualNode(container)) container = parent.get(container);
      if (container !== undefined) parent.set(id, container);
    }
    for (const id of virtual) {
      nodes.delete(id);
      parent.delete(id);
    }
  }
  const allIds = [...nodes.keys()].sort(compareStrings);
  const children = new Map<string, string[]>();
  for (const id of allIds) {
    const container = parent.get(id);
    if (container === undefined) continue;
    const list = children.get(container);
    if (list === undefined) children.set(container, [id]);
    else list.push(id);
  }
  return { graph, nodes, parent, children, ids: allIds, regions };
}

/** Whether `ancestor` is a proper ancestor of `id`. */
export function isAncestor(vg: ViewGraph, ancestor: string, id: string): boolean {
  for (let current = vg.parent.get(id); current !== undefined; current = vg.parent.get(current)) {
    if (current === ancestor) return true;
  }
  return false;
}

/** The node and everything below it, in depth-first order (children in id order). */
export function subtree(vg: ViewGraph, id: string): string[] {
  const result: string[] = [];
  const stack = [id];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    result.push(current);
    for (const child of [...(vg.children.get(current) ?? [])].reverse()) stack.push(child);
  }
  return result;
}

/** The Resource Manager project node a node belongs to, when the graph has it. */
export function projectOf(vg: ViewGraph, id: string): string | undefined {
  const node = vg.nodes.get(id);
  if (node === undefined) return undefined;
  if (node.assetType === PROJECT_TYPE) return id;
  if (node.projectNumber === undefined) return undefined;
  const project = projectNodeId(node.projectNumber);
  return vg.nodes.has(project) ? project : undefined;
}
