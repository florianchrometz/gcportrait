// SPDX-License-Identifier: MIT
/**
 * Test helpers to read a Graph: a node's parent and containers, the edges between two nodes. They read the
 * Graph's records only and share no code with the builder, so the oracles that use them stay independent of
 * it. Not part of the public API.
 */
import type { Graph } from '@gcportrait/model';

type GraphEdge = Graph['edges'][number];

/** A node's parent in the containment forest; undefined for a root (own keys only). */
export function parentOf(graph: Graph, id: string): string | undefined {
  return Object.hasOwn(graph.containment.parent, id) ? graph.containment.parent[id] : undefined;
}

/** A node's containers, closest first. */
export function ancestorsOf(graph: Graph, id: string): string[] {
  const { parent } = graph.containment;
  const chain: string[] = [];
  for (let current = parent[id]; current !== undefined; current = parent[current]) chain.push(current);
  return chain;
}

/** Whether `outer` contains `inner` at any depth (a node is not inside itself). */
export function isInside(graph: Graph, inner: string, outer: string): boolean {
  const { parent } = graph.containment;
  for (let current = parent[inner]; current !== undefined; current = parent[current]) {
    if (current === outer) return true;
  }
  return false;
}

/** The first edge from one node to another, optionally of one kind. */
export function edgeBetween(graph: Graph, from: string, to: string, kind?: string): GraphEdge | undefined {
  return graph.edges.find(
    (edge) => edge.from === from && edge.to === to && (kind === undefined || edge.kind === kind),
  );
}

/** The targets of a node's edges of one kind, in edge order. */
export function targets(graph: Graph, from: string, kind: string): string[] {
  return graph.edges.filter((edge) => edge.from === from && edge.kind === kind).map((edge) => edge.to);
}
