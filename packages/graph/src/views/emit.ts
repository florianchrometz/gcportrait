// SPDX-License-Identifier: Apache-2.0
/**
 * The last step of the scene builder: the model `Scene` from the tree and the chips. A collapsed zone keeps
 * no children and carries the counts of what it holds (`{ networks: 2, resources: 39 }`; the renderer writes
 * "2 networks · 39 resources"). Every edge end inside a chip is re-targeted to the chip; edges that then join
 * the same two nodes with the same kind are merged with a count, and an edge that ends where it starts (both
 * ends in one chip) is dropped. Peerings are symmetric, so their merged ends are ordered. A product container
 * carries its catalog type's icon (`SceneZone.icon`), so its header shows its product's mark rather than
 * the generic cloud; other zones leave it out and draw their kind's own mark.
 */
import type {
  ChipCountKind,
  ChipCounts,
  RelationEdge,
  SceneEdge,
  SceneNode,
  ZoneKind,
} from '@gcportrait/model';
import { compareTuples } from '../order.js';
import type { Disclosure } from './detail.js';
import type { SceneTree } from './tree.js';

/**
 * What a chip counts a zone it holds as, by the zone's kind (a card it holds is one of its `resources`; a region
 * zone or a bundle is not counted).
 */
export const CHIP_COUNT_OF_KIND: Readonly<Partial<Record<ZoneKind, ChipCountKind>>> = Object.freeze({
  folder: 'folders',
  project: 'projects',
  vpc: 'networks',
  subnet: 'subnets',
  'product-container': 'containers',
});

/** What a zone holds, at any depth: folders, projects, networks, subnets, containers and resources. */
function chipCounts(tree: SceneTree, id: string): ChipCounts {
  const counts: ChipCounts = {};
  const add = (kind: ChipCountKind): void => {
    counts[kind] = (counts[kind] ?? 0) + 1;
  };
  const visit = (ids: readonly string[]): void => {
    for (const child of ids) {
      const entry = tree.entries.get(child);
      if (entry?.type === 'card') add('resources');
      else if (entry !== undefined) {
        const kind = CHIP_COUNT_OF_KIND[entry.kind];
        if (kind !== undefined) add(kind);
      }
      visit(tree.children.get(child) ?? []);
    }
  };
  visit(tree.children.get(id) ?? []);
  return counts;
}

export interface Emitted {
  readonly children: SceneNode[];
  /** Scene id or node id → the scene node that shows it (itself, or the outermost chip it is inside). */
  readonly shownAs: ReadonlyMap<string, string>;
}

/** The scene's node tree; `badges` gives each zone's header pills. */
export function emitNodes(
  tree: SceneTree,
  disclosure: Disclosure,
  badges: (id: string) => string[],
): Emitted {
  const shownAs = new Map<string, string>();
  const hide = (ids: readonly string[], chip: string): void => {
    for (const id of ids) {
      shownAs.set(id, chip);
      hide(tree.children.get(id) ?? [], chip);
    }
  };
  const emit = (ids: readonly string[]): SceneNode[] =>
    ids.flatMap((id): SceneNode[] => {
      const entry = tree.entries.get(id);
      if (entry === undefined) return [];
      shownAs.set(id, id);
      if (entry.type === 'card') {
        return [
          {
            type: 'card',
            id,
            label: entry.label,
            ...(entry.subtitle === undefined ? {} : { subtitle: entry.subtitle }),
            icon: entry.icon,
            product: entry.product,
            assetType: entry.assetType,
          },
        ];
      }
      const children = tree.children.get(id) ?? [];
      const collapsed = disclosure.collapsed.has(id);
      if (collapsed) hide(children, id);
      return [
        {
          type: 'zone',
          id,
          kind: entry.kind,
          label: entry.label,
          ...(entry.subtitle === undefined ? {} : { subtitle: entry.subtitle }),
          ...(entry.icon === undefined ? {} : { icon: entry.icon }),
          badges: badges(id),
          ...(collapsed ? { collapsed: chipCounts(tree, id) } : {}),
          children: collapsed ? [] : emit(children),
        },
      ];
    });
  return { children: emit(tree.top), shownAs };
}

/** The scene's edges: ends re-targeted to chips, merged with counts, sorted by (from, to, kind). */
export function emitEdges(edges: readonly RelationEdge[], shownAs: ReadonlyMap<string, string>): SceneEdge[] {
  const merged = new Map<string, { edge: SceneEdge; count: number; merged: boolean }>();
  for (const edge of edges) {
    const from = shownAs.get(edge.from);
    const to = shownAs.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    const [a, b] = edge.kind === 'peers' && to < from ? [to, from] : [from, to];
    const key = `${a}\u0000${b}\u0000${edge.kind}`;
    const retargeted = from !== edge.from || to !== edge.to;
    const existing = merged.get(key);
    if (existing === undefined)
      merged.set(key, { edge: { from: a, to: b, kind: edge.kind }, count: 1, merged: retargeted });
    else {
      existing.count += 1;
      existing.merged ||= retargeted;
    }
  }
  return [...merged.values()]
    .map(({ edge, count, merged: wasMerged }) => ({
      ...edge,
      ...(count > 1 ? { count } : {}),
      ...(wasMerged ? { merged: true } : {}),
    }))
    .sort((x, y) => compareTuples([x.from, x.to, x.kind], [y.from, y.to, y.kind]));
}
