// SPDX-License-Identifier: Apache-2.0
/**
 * The selection trace (skill gcp-diagram-style §6): what a
 * selected (or hovered) node lights up so that its place and its connections stay traceable.
 *
 * - **Path to the root:** every zone around the node, innermost first, up to the top level (the canvas is the
 *   organisation).
 * - **Incident edges:** every line with an end at the node or anywhere inside it (an open zone's lines are
 *   its contents' lines).
 * - **Traffic chain:** the `routes` and `connects` lines followed transitively through the node, downstream
 *   (along `routes`, from its `from` to its `to`) and upstream (against it), up to {@link TRACE_HOPS} hops each
 *   way; `connects` has no direction and is followed both ways in both searches. A forwarding rule reaches its
 *   proxy, URL map, backend services, and their instance groups and network endpoint groups; a backend service
 *   reaches back to the forwarding rules in front of it and on to its backends, but never sideways to the other
 *   backends of the same URL map: only chains that pass through the node count.
 * - **Reached nodes:** the far ends of the traced lines, the node and its contents left out.
 *
 * It works on what is drawn, the Layout: an end inside a collapsed zone is its chip there (the layout already
 * re-targeted it), so a chip counts as a node, and the chain goes on through it. Pure and deterministic: ids in
 * code-point order; cycle-safe (each search visits a node once). It needs no Graph, so it lives with the
 * renderer rather than in `@gcportrait/graph`.
 */
import type { RelationKind } from '@gcportrait/model';

/** How far the traffic chain is followed, in hops, each way. */
export const TRACE_HOPS = 8;

/** The relation kinds a trace follows transitively. */
export const CHAIN_KINDS: ReadonlySet<RelationKind> = new Set<RelationKind>(['routes', 'connects']);

/** A drawn line: the layout's edge key, its ends (rects) and its kind. */
export interface TraceEdge {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly kind: RelationKind;
}

/** What a trace walks: the rects' nesting and the drawn lines, indexed by the rects they touch. */
export interface TraceIndex {
  /** Rect id → its parent zone (null at the top level). */
  readonly parent: ReadonlyMap<string, string | null>;
  readonly children: ReadonlyMap<string, readonly string[]>;
  readonly edges: ReadonlyMap<string, TraceEdge>;
  /** Rect id → the keys of the lines with an end at it. */
  readonly edgesAt: ReadonlyMap<string, readonly string[]>;
}

export interface Trace {
  /** The traced node. */
  readonly node: string;
  /** The zones around the node, innermost first, up to the top level. */
  readonly ancestors: readonly string[];
  /** Lines with an end at the node or inside it, sorted. */
  readonly incident: readonly string[];
  /** Lines of the `routes`/`connects` chain through the node, sorted (some may be incident too). */
  readonly chain: readonly string[];
  /** Every traced line: the incident ones and the chain, sorted. */
  readonly edges: readonly string[];
  /** The nodes the traced lines reach, the node and its contents left out, sorted. */
  readonly reached: readonly string[];
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Builds the index from the rects' parents and the drawn lines. */
export function traceIndex(
  parent: ReadonlyMap<string, string | null>,
  lines: Iterable<TraceEdge>,
): TraceIndex {
  const children = new Map<string, string[]>();
  for (const [id, up] of parent) {
    if (up === null) continue;
    const list = children.get(up);
    if (list === undefined) children.set(up, [id]);
    else list.push(id);
  }
  const edges = new Map<string, TraceEdge>();
  const edgesAt = new Map<string, string[]>();
  for (const edge of lines) {
    edges.set(edge.key, edge);
    for (const end of edge.from === edge.to ? [edge.from] : [edge.from, edge.to]) {
      const list = edgesAt.get(end);
      if (list === undefined) edgesAt.set(end, [edge.key]);
      else list.push(edge.key);
    }
  }
  return { parent, children, edges, edgesAt };
}

/** The node and everything inside it. */
function subtree(index: TraceIndex, id: string): Set<string> {
  const inside = new Set<string>();
  const stack = [id];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if (inside.has(current)) continue;
    inside.add(current);
    stack.push(...(index.children.get(current) ?? []));
  }
  return inside;
}

type Direction = 'down' | 'up';

/** The next node along a chain line from `at`, or undefined when the line does not lead on that way. */
function step(edge: TraceEdge, at: string, direction: Direction): string | undefined {
  if (edge.kind === 'connects') return edge.from === at ? edge.to : edge.to === at ? edge.from : undefined;
  if (direction === 'down') return edge.from === at ? edge.to : undefined;
  return edge.to === at ? edge.from : undefined;
}

/** One direction of the chain: breadth-first, at most `hops` hops, each node once. */
function follow(
  index: TraceIndex,
  start: string,
  direction: Direction,
  hops: number,
  lines: Set<string>,
  nodes: Set<string>,
): void {
  const visited = new Set([start]);
  let frontier = [start];
  for (let hop = 0; hop < hops && frontier.length > 0; hop += 1) {
    const next: string[] = [];
    for (const at of frontier) {
      for (const key of index.edgesAt.get(at) ?? []) {
        const edge = index.edges.get(key);
        if (edge === undefined || !CHAIN_KINDS.has(edge.kind)) continue;
        const other = step(edge, at, direction);
        if (other === undefined) continue;
        lines.add(key);
        nodes.add(other);
        if (!visited.has(other)) {
          visited.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
}

/**
 * The trace of a node, or null for an id the index does not know. `hops` caps each direction of the chain
 * ({@link TRACE_HOPS} by default).
 */
export function computeTrace(index: TraceIndex, id: string, hops = TRACE_HOPS): Trace | null {
  if (!index.parent.has(id)) return null;
  const ancestors: string[] = [];
  for (
    let up = index.parent.get(id) ?? null;
    up !== null && ancestors.length <= index.parent.size;
    up = index.parent.get(up) ?? null
  ) {
    ancestors.push(up);
  }
  const inside = subtree(index, id);
  const incident = new Set<string>();
  const reached = new Set<string>();
  for (const member of inside) {
    for (const key of index.edgesAt.get(member) ?? []) {
      const edge = index.edges.get(key);
      if (edge === undefined) continue;
      incident.add(key);
      for (const end of [edge.from, edge.to]) if (!inside.has(end)) reached.add(end);
    }
  }
  const chain = new Set<string>();
  const chainNodes = new Set<string>();
  follow(index, id, 'down', hops, chain, chainNodes);
  follow(index, id, 'up', hops, chain, chainNodes);
  for (const node of chainNodes) if (!inside.has(node)) reached.add(node);
  const edges = new Set([...incident, ...chain]);
  return {
    node: id,
    ancestors,
    incident: [...incident].sort(compare),
    chain: [...chain].sort(compare),
    edges: [...edges].sort(compare),
    reached: [...reached].sort(compare),
  };
}
