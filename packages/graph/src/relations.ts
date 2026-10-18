// SPDX-License-Identifier: Apache-2.0
/**
 * Relation edges. The catalog's rule engine evaluates an asset's rules (`evaluateRelations`); this module
 * resolves each produced target to a node (names also with their project segment swapped, `names.ts`), turns
 * `reverse` relations around, keeps the ones that resolve nowhere as dangling references, merges copies of
 * one edge that several assets draw, and applies the edge-level rules (skill gcp-asset-catalog §4): weak
 * edges yield to stronger ones, and reciprocal `peers` and `connects` edges become one.
 */
import type { CatalogRelationKind, EvaluatedRelation, RelationEdge, RelationTarget } from '@gcportrait/model';
import type { NameMatch, ProjectForm } from './names.js';
import { compareTuples } from './order.js';

/** A relation whose target is a node. */
export interface ResolvedRelation {
  readonly from: string;
  readonly kind: CatalogRelationKind;
  readonly to: string;
  readonly weak: boolean;
  /** The reference matched only with its project segment swapped: the form of the matched name. */
  readonly matchedProject?: ProjectForm | undefined;
}

/** A relation whose target matched no node: kept with the value as read, counted, never drawn. */
export interface DanglingRelation extends ResolvedRelation {
  readonly raw: string;
}

export interface ResolvedRelations {
  readonly resolved: ResolvedRelation[];
  readonly dangling: DanglingRelation[];
}

/**
 * Resolves one asset's evaluated relations against the nodes and the alias index. A name target resolves when
 * `resolveName` finds a node for it (the name itself, or with its project segment swapped), an alias target
 * when the alias index knows it; a value the normaliser did not understand resolves only if it names a node
 * itself. A `reverse` relation is drawn from the node it names to the asset. Unresolved relations stay with the
 * asset and keep the normalised name (or the alias, or the raw value) as `to`. A reference to the asset itself
 * is dropped, and a relation produced twice is kept once, weak only if every copy is weak.
 */
export function resolveRelations(
  from: string,
  evaluated: readonly EvaluatedRelation[],
  resolveName: (name: string) => NameMatch | undefined,
  aliases: ReadonlyMap<string, string>,
): ResolvedRelations {
  const resolved = new Map<string, ResolvedRelation>();
  const dangling = new Map<string, DanglingRelation>();
  for (const relation of evaluated) {
    const weak = relation.weak === true;
    const { match, to } = resolveTarget(relation.target, relation.raw, resolveName, aliases);
    if (match?.id === from) continue;
    if (match !== undefined) {
      const reverse = relation.reverse === true;
      const edge = reverse
        ? { from: match.id, kind: relation.kind, to: from }
        : { from, kind: relation.kind, to: match.id };
      const key = `${edge.from}\u0000${edge.kind}\u0000${edge.to}`;
      const existing = resolved.get(key);
      resolved.set(key, {
        ...edge,
        weak: weak && (existing?.weak ?? true),
        // Marked only when every copy needed the project swap.
        matchedProject:
          existing === undefined || existing.matchedProject !== undefined ? match.matchedProject : undefined,
      });
    } else {
      const key = `${relation.kind}\u0000${to}`;
      const existing = dangling.get(key);
      dangling.set(key, {
        from,
        kind: relation.kind,
        to,
        weak: weak && (existing?.weak ?? true),
        raw: existing?.raw ?? relation.raw,
      });
    }
  }
  return { resolved: [...resolved.values()], dangling: [...dangling.values()] };
}

function resolveTarget(
  target: RelationTarget | undefined,
  raw: string,
  resolveName: (name: string) => NameMatch | undefined,
  aliases: ReadonlyMap<string, string>,
): { match?: NameMatch; to: string } {
  if (target === undefined) {
    const match = resolveName(raw);
    return match === undefined ? { to: raw } : { match, to: match.id };
  }
  if (target.by === 'name') {
    const match = resolveName(target.name);
    return match === undefined ? { to: target.name } : { match, to: match.id };
  }
  const node = aliases.get(target.alias);
  return node === undefined ? { to: target.alias } : { match: { id: node }, to: node };
}

/**
 * One edge per (from, kind, to) over every asset's relations: an edge two assets draw (a reverse rule on one
 * side, the target's own rule on the other) is kept once, in first-seen order, weak only if every copy is
 * weak, and marked `matchedProject` only if every copy needed the project swap.
 */
export function mergeCopies(relations: readonly ResolvedRelation[]): ResolvedRelation[] {
  const merged = new Map<string, ResolvedRelation>();
  for (const relation of relations) {
    const key = `${relation.from}\u0000${relation.kind}\u0000${relation.to}`;
    const existing = merged.get(key);
    merged.set(
      key,
      existing === undefined
        ? relation
        : {
            ...existing,
            weak: existing.weak && relation.weak,
            matchedProject:
              existing.matchedProject !== undefined && relation.matchedProject !== undefined
                ? existing.matchedProject
                : undefined,
          },
    );
  }
  return [...merged.values()];
}

/**
 * Weak-edge precedence (skill gcp-asset-catalog §4): a weak edge yields to a stronger edge of the same kind
 * from the same asset whose target lies inside the weak edge's target (a NIC's network yields to its subnet).
 * A weak edge with nothing stronger inside its target stays, marked weak. Returns the kept edges and how many
 * yielded.
 */
export function applyWeakPrecedence(
  relations: readonly ResolvedRelation[],
  isInside: (inner: string, outer: string) => boolean,
): { kept: ResolvedRelation[]; yielded: number } {
  const strongTargets = new Map<string, string[]>();
  for (const relation of relations) {
    if (relation.weak) continue;
    const key = `${relation.from}\u0000${relation.kind}`;
    const list = strongTargets.get(key) ?? [];
    list.push(relation.to);
    strongTargets.set(key, list);
  }
  const kept: ResolvedRelation[] = [];
  let yielded = 0;
  for (const relation of relations) {
    const stronger = relation.weak ? (strongTargets.get(`${relation.from}\u0000${relation.kind}`) ?? []) : [];
    if (stronger.some((target) => target !== relation.to && isInside(target, relation.to))) yielded += 1;
    else kept.push(relation);
  }
  return { kept, yielded };
}

/** Kinds whose reciprocal pairs (A → B and B → A) are one link drawn once. */
const RECIPROCAL_KINDS: ReadonlySet<CatalogRelationKind> = new Set(['peers', 'connects']);

/**
 * Folds reciprocal `peers` edges (A → B and B → A, as both networks of a peering list it) and reciprocal
 * `connects` edges (a tunnel and its router naming each other) into one edge, kept in the direction from the
 * smaller id; either side's rule may draw the link. A one-sided edge stays as it is. Returns the edges and how
 * many of each kind were folded away.
 */
export function mergeReciprocal(relations: readonly ResolvedRelation[]): {
  edges: ResolvedRelation[];
  merged: { peers: number; connects: number };
} {
  const pairs = new Map<string, ResolvedRelation>();
  for (const relation of relations) {
    if (RECIPROCAL_KINDS.has(relation.kind))
      pairs.set(`${relation.kind}\u0000${relation.from}\u0000${relation.to}`, relation);
  }
  const edges: ResolvedRelation[] = [];
  const merged = { peers: 0, connects: 0 };
  for (const relation of relations) {
    const reverse = RECIPROCAL_KINDS.has(relation.kind)
      ? pairs.get(`${relation.kind}\u0000${relation.to}\u0000${relation.from}`)
      : undefined;
    if (reverse === undefined) edges.push(relation);
    else if (relation.from > relation.to) merged[relation.kind === 'peers' ? 'peers' : 'connects'] += 1;
    else
      edges.push({
        ...relation,
        weak: relation.weak && reverse.weak,
        matchedProject:
          relation.matchedProject !== undefined && reverse.matchedProject !== undefined
            ? relation.matchedProject
            : undefined,
      });
  }
  return { edges, merged };
}

/** A resolved relation as a model edge (`weak` and `matchedProject` only when set). */
export function toEdge(relation: ResolvedRelation): RelationEdge {
  return {
    from: relation.from,
    to: relation.to,
    kind: relation.kind,
    ...(relation.weak ? { weak: true } : {}),
    ...(relation.matchedProject === undefined ? {} : { matchedProject: relation.matchedProject }),
  };
}

/** A dangling relation as a model edge carrying the raw value. */
export function toDanglingEdge(relation: DanglingRelation): RelationEdge {
  return {
    from: relation.from,
    to: relation.to,
    kind: relation.kind,
    ...(relation.weak ? { weak: true } : {}),
    dangling: { raw: relation.raw },
  };
}

/** Edge order: from, kind, to (and the raw value of dangling references). */
export function compareEdges(a: RelationEdge, b: RelationEdge): number {
  return compareTuples(
    [a.from, a.kind, a.to, a.dangling?.raw ?? ''],
    [b.from, b.kind, b.to, b.dangling?.raw ?? ''],
  );
}
