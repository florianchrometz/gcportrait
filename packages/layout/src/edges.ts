// SPDX-License-Identifier: Apache-2.0
/**
 * Stage 5, before routing: which edges to draw (skill gcp-diagram-layout §5 "Merging"). Every Scene edge is
 * resolved to the rects it is drawn between and merged:
 *
 * - an end inside a collapsed zone is re-targeted to that zone's chip (the outermost one); an end at a chip
 *   already ends at the chip. The Scene builder re-targets before the layout sees the Scene (a valid Scene
 *   holds nothing inside a chip), so this only guards the contract;
 * - an edge with both ends at one rect after that (inside one chip), or with an end at a dropped
 *   organisation zone (the canvas), is dropped and counted;
 * - a symmetric kind (`direction: 'both'` in the model's `RELATION_KINDS`: `peers`) has no direction, so its
 *   ends are ordered by code point and reciprocal edges become one double-headed edge;
 * - edges with the same (from, to, kind) collapse into one whose `count` is the sum of theirs (a Scene edge
 *   without a count stands for 1) and which is `merged`.
 *
 * The result is sorted by (from, to, kind) in code-point order, so it does not depend on the order of the
 * Scene's edges.
 */
import { RELATION_KINDS, type RelationKind, type Scene } from '@gcportrait/model';
import type { LayoutNode } from './normalise.js';
import { compareCodePoints } from './order.js';
import type { EdgeHeads } from './types.js';

export interface DrawnEdge {
  /** `<from> -<kind>-> <to>`: the key of `Layout.edges`. */
  readonly id: string;
  readonly from: LayoutNode;
  readonly to: LayoutNode;
  readonly kind: RelationKind;
  readonly count: number;
  readonly merged: boolean;
  readonly heads: EdgeHeads;
}

export interface MergedEdges {
  readonly edges: DrawnEdge[];
  readonly duplicatesMerged: number;
  readonly reciprocalMerged: number;
  readonly dropped: number;
}

/** The id of the edge from `from` to `to` of `kind`: the key of `Layout.edges`. */
export function edgeId(from: string, kind: RelationKind, to: string): string {
  return `${from} -${kind}-> ${to}`;
}

/** Arrowheads of a kind, from its default style in the model's relation table. */
export function headsOf(kind: RelationKind): EdgeHeads {
  const style = RELATION_KINDS[kind].defaultStyle;
  if (style === 'dashed-double-headed') return 'both';
  if (style === 'solid-round-caps') return 'none';
  return 'end';
}

/** Whether a kind has no direction (its ends are interchangeable). */
export function isSymmetric(kind: RelationKind): boolean {
  return RELATION_KINDS[kind].direction === 'both';
}

/** The rect an edge end is drawn at: the outermost collapsed zone around the node, or the node itself. */
function drawnAt(node: LayoutNode): LayoutNode {
  let drawn = node;
  for (let up = node.parent; up !== null; up = up.parent) if (up.role === 'chip') drawn = up;
  return drawn;
}

interface Group {
  from: LayoutNode;
  to: LayoutNode;
  kind: RelationKind;
  count: number;
  merged: boolean;
  members: number;
  /** For symmetric kinds: whether the Scene had the edge in each orientation. */
  forward: boolean;
  backward: boolean;
}

export function mergeEdges(scene: Scene, nodes: ReadonlyMap<string, LayoutNode>): MergedEdges {
  const groups = new Map<string, Group>();
  let dropped = 0;
  for (const edge of scene.edges) {
    const fromNode = nodes.get(edge.from);
    const toNode = nodes.get(edge.to);
    // A node the layout has no rect for is a dropped organisation zone: the canvas.
    if (fromNode === undefined || toNode === undefined) {
      dropped += 1;
      continue;
    }
    let from = drawnAt(fromNode);
    let to = drawnAt(toNode);
    if (from === to) {
      dropped += 1;
      continue;
    }
    const retargeted = from !== fromNode || to !== toNode;
    let backward = false;
    if (isSymmetric(edge.kind) && compareCodePoints(from.id, to.id) > 0) {
      [from, to] = [to, from];
      backward = true;
    }
    const id = edgeId(from.id, edge.kind, to.id);
    const count = edge.count ?? 1;
    const merged = edge.merged === true || retargeted;
    const group = groups.get(id);
    if (group === undefined) {
      groups.set(id, {
        from,
        to,
        kind: edge.kind,
        count,
        merged,
        members: 1,
        forward: !backward,
        backward,
      });
    } else {
      group.count += count;
      group.merged = true;
      group.members += 1;
      if (backward) group.backward = true;
      else group.forward = true;
    }
  }

  let duplicatesMerged = 0;
  let reciprocalMerged = 0;
  const edges: DrawnEdge[] = [];
  for (const [id, group] of groups) {
    duplicatesMerged += group.members - 1;
    if (group.forward && group.backward) reciprocalMerged += 1;
    edges.push({
      id,
      from: group.from,
      to: group.to,
      kind: group.kind,
      count: group.count,
      merged: group.merged || group.members > 1,
      heads: headsOf(group.kind),
    });
  }
  edges.sort(
    (a, b) =>
      compareCodePoints(a.from.id, b.from.id) ||
      compareCodePoints(a.to.id, b.to.id) ||
      compareCodePoints(a.kind, b.kind),
  );
  return { edges, duplicatesMerged, reciprocalMerged, dropped };
}
