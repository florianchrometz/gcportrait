// SPDX-License-Identifier: Apache-2.0
/**
 * Containment (skill gcp-diagram-layout §2): every node gets at most one parent,
 * and the result is a forest by construction.
 *
 * Each node's parent is the first acceptable candidate of these tiers:
 *
 * 1. **Declared by a container** — a catalog `contains` rule (a JSONPath naming the child, or `byParent`
 *    matching its type) or, for Kubernetes objects, the name path (`…/clusters/c/k8s/namespaces/n/…` nests
 *    in the namespace, else the cluster). Several claims: the innermost (longest name) wins. Otherwise
 *    **declared by the child**: the first container its type's `nestsIn` rules name (an instance's managed
 *    group, a volume's storage pool). These are decided first for every node, so a declaration always beats
 *    a weaker preference of another node.
 * 2. **Attachment** (rule 1) — the node's resolved `attaches` targets, reduced to the innermost ones (a
 *    network yields to a subnet inside it): exactly one left that is a container → nest there; several or
 *    none → no nesting from attachments (the edges are drawn instead).
 * 3. **The `parent` field** — the parent asset if it is a container; a parent that is not a container passes
 *    its own placement on (a key version nests where its key nests).
 * 4. **`ancestors`** — the closest ancestor (project, folder, organisation) present in the snapshot.
 * 5. Otherwise the node is a root.
 *
 * A candidate is acceptable when it is a node other than the child, when a resource-hierarchy child
 * (organisation, folder, project) gets a hierarchy parent, when it does not lie in another project (rule 2:
 * never nest across projects; Shared VPC resources stay in their service project), and when it does not
 * close a cycle (rule 5: the cycle is recorded with the ids involved and the next candidate is tried).
 */
import type { Asset, GraphNode, ProjectIndex } from '@gcportrait/model';
import { compareStrings, compareTuples } from './order.js';
import { HIERARCHY_TYPES, ancestorNodeId } from './structure.js';

export interface ContainmentInput {
  /** Asset node ids, in name order (the order nodes are placed in). */
  readonly ids: readonly string[];
  readonly assets: ReadonlyMap<string, Asset>;
  readonly nodes: ReadonlyMap<string, GraphNode>;
  /** child → the containers whose catalog rules or name path claim it (tier 1). */
  readonly declared: ReadonlyMap<string, readonly string[]>;
  /** child → the nodes its own type's `nestsIn` rules name, in rule order (tier 1, after `declared`). */
  readonly nestsIn?: ReadonlyMap<string, readonly string[]>;
  /** node → the nodes its resolved `attaches` relations point at, weak ones included (tier 2). */
  readonly attaches: ReadonlyMap<string, readonly string[]>;
  readonly projects: ProjectIndex;
}

export interface ContainmentResult {
  /** child → parent. */
  readonly parent: Map<string, string>;
  /** Refused cycles, each starting at its smallest id, in child → parent order. */
  readonly cycles: string[][];
  /** Nodes that had a nesting candidate in another project refused. */
  readonly crossProjectRefused: number;
  /** Nodes nested in a container their own `nestsIn` rules name. */
  readonly nestedByReference: number;
}

/** The longest name (the innermost container on one name path); ties by name. */
function innermostByName(candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const candidate of candidates) {
    if (
      best === undefined ||
      candidate.length > best.length ||
      (candidate.length === best.length && compareStrings(candidate, best) < 0)
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Removes cycles from a child → parent map in place: in each cycle, the member with the smallest id loses
 * its parent. Each cycle is reported in child → parent order.
 */
function breakCycles(
  next: Map<string, string>,
  order: readonly string[],
  report: (ids: string[]) => void,
): void {
  const state = new Map<string, 'walking' | 'done'>();
  for (const start of order) {
    const path: string[] = [];
    let current: string | undefined = start;
    while (current !== undefined && !state.has(current)) {
      state.set(current, 'walking');
      path.push(current);
      current = next.get(current);
    }
    if (current !== undefined && state.get(current) === 'walking') {
      const cycle = path.slice(path.indexOf(current));
      report(cycle);
      const smallest = cycle.reduce((a, b) => (compareStrings(a, b) <= 0 ? a : b));
      next.delete(smallest);
    }
    for (const id of path) state.set(id, 'done');
  }
}

/** Resolves the containment forest. Pure; the order of `ids` only breaks ties between cyclic preferences. */
export function resolveContainment(input: ContainmentInput): ContainmentResult {
  const { ids, assets, nodes, declared, attaches, projects } = input;
  const nestsIn = input.nestsIn ?? new Map<string, readonly string[]>();
  const parent = new Map<string, string>();
  const decided = new Set<string>();
  const placing = new Set<string>();
  const cycles = new Map<string, string[]>();
  const refused = new Set<string>();
  const limit = nodes.size + 1;

  const isContainer = (id: string): boolean => nodes.get(id)?.role === 'container';
  const isHierarchy = (id: string): boolean => HIERARCHY_TYPES.has(nodes.get(id)?.assetType ?? '');

  function crossesProjects(a: string, b: string): boolean {
    const x = nodes.get(a);
    const y = nodes.get(b);
    if (x?.projectNumber !== undefined && y?.projectNumber !== undefined)
      return x.projectNumber !== y.projectNumber;
    if (x?.projectId !== undefined && y?.projectId !== undefined) return x.projectId !== y.projectId;
    return false;
  }

  function admissible(child: string, candidate: string): boolean {
    if (candidate === child || !nodes.has(candidate)) return false;
    if (isHierarchy(child) && !isHierarchy(candidate)) return false;
    if (crossesProjects(child, candidate)) {
      refused.add(child);
      return false;
    }
    return true;
  }

  function recordCycle(members: readonly string[]): void {
    let start = 0;
    members.forEach((id, index) => {
      if (compareStrings(id, members[start] ?? id) < 0) start = index;
    });
    const rotated = [...members.slice(start), ...members.slice(0, start)];
    const key = [...rotated].sort(compareStrings).join('\u0000');
    if (!cycles.has(key)) cycles.set(key, rotated);
  }

  // Tier 1: what containers declare, else what the node's own nestsIn rules name, decided for every node
  // before anything else.
  const declaredParent = new Map<string, string>();
  const byReference = new Map<string, string>();
  for (const id of ids) {
    const best = innermostByName((declared.get(id) ?? []).filter((candidate) => admissible(id, candidate)));
    if (best !== undefined) {
      declaredParent.set(id, best);
      continue;
    }
    const referenced = (nestsIn.get(id) ?? []).find(
      (candidate) => isContainer(candidate) && admissible(id, candidate),
    );
    if (referenced !== undefined) {
      declaredParent.set(id, referenced);
      byReference.set(id, referenced);
    }
  }
  breakCycles(declaredParent, ids, recordCycle);
  for (const [child, container] of declaredParent) {
    parent.set(child, container);
    decided.add(child);
  }

  /** The chain above a node, placing nodes on the way; it stops at a node that is still being placed. */
  function ancestorsOf(start: string): string[] {
    const chain: string[] = [];
    let current = start;
    for (let step = 0; step < limit; step += 1) {
      if (!decided.has(current)) {
        if (placing.has(current)) break;
        place(current);
      }
      const next = parent.get(current);
      if (next === undefined) break;
      chain.push(next);
      current = next;
    }
    return chain;
  }

  function accept(child: string, candidate: string): boolean {
    if (!admissible(child, candidate)) return false;
    const chain = ancestorsOf(candidate);
    const at = chain.indexOf(child);
    if (at === -1) return true;
    recordCycle([child, candidate, ...chain.slice(0, at)]);
    return false;
  }

  /** Tier 2 (rule 1): the single innermost attachment target, if it is a container. */
  function attachmentTarget(id: string): string | undefined {
    const targets = [...new Set(attaches.get(id) ?? [])].filter(
      (target) => target !== id && nodes.has(target),
    );
    if (targets.length === 0) return undefined;
    const chains = new Map(targets.map((target) => [target, targets.length > 1 ? ancestorsOf(target) : []]));
    const innermost = targets.filter(
      (outer) => !targets.some((inner) => inner !== outer && (chains.get(inner) ?? []).includes(outer)),
    );
    const [target] = innermost;
    return innermost.length === 1 && target !== undefined && isContainer(target) ? target : undefined;
  }

  /** Tier 3: the `parent` field, or where a non-container parent is placed. */
  function parentFieldCandidate(id: string): string | undefined {
    const declaredParentName = assets.get(id)?.parent;
    if (declaredParentName === undefined || declaredParentName === id || !nodes.has(declaredParentName)) {
      return undefined;
    }
    if (isContainer(declaredParentName)) return declaredParentName;
    if (!decided.has(declaredParentName)) {
      if (placing.has(declaredParentName)) return undefined;
      place(declaredParentName);
    }
    return parent.get(declaredParentName);
  }

  function choose(id: string): string | undefined {
    const target = attachmentTarget(id);
    if (target !== undefined && accept(id, target)) return target;
    const inherited = parentFieldCandidate(id);
    if (inherited !== undefined && accept(id, inherited)) return inherited;
    for (const entry of assets.get(id)?.ancestors ?? []) {
      const candidate = ancestorNodeId(entry, projects);
      if (accept(id, candidate)) return candidate;
    }
    return undefined;
  }

  function place(id: string): void {
    placing.add(id);
    const chosen = choose(id);
    if (chosen !== undefined) parent.set(id, chosen);
    placing.delete(id);
    decided.add(id);
  }

  for (const id of ids) {
    if (!decided.has(id)) place(id);
  }

  let nestedByReference = 0;
  for (const [child, container] of byReference) if (parent.get(child) === container) nestedByReference += 1;
  return {
    parent,
    cycles: [...cycles.values()].sort(compareTuples),
    crossProjectRefused: refused.size,
    nestedByReference,
  };
}
