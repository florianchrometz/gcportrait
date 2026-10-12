// SPDX-License-Identifier: MIT
/**
 * Test helpers (not part of the public API): small hand-built Scenes and a fast-check arbitrary of random
 * Scene trees (depth ≤ 8, up to 300 nodes) with edges, chips, empty zones, badges and odd labels. Every Scene
 * they build passes `SceneSchema`.
 */
import fc from 'fast-check';
import type {
  ChipCounts,
  Scene,
  SceneCard,
  SceneEdge,
  SceneNode,
  SceneZone,
  ZoneKind,
} from '@gcportrait/model';

export const ORGANISATION_ID = '//cloudresourcemanager.googleapis.com/organizations/30000000001';

export function card(id: string, label = id, subtitle?: string): SceneCard {
  return {
    type: 'card',
    id,
    label,
    ...(subtitle === undefined ? {} : { subtitle }),
    icon: 'cloud_generic',
    product: 'Compute Engine',
    assetType: 'compute.googleapis.com/Instance',
  };
}

export function zone(
  id: string,
  kind: ZoneKind,
  children: SceneNode[],
  extra: { label?: string; subtitle?: string; badges?: string[]; collapsed?: ChipCounts } = {},
): SceneZone {
  return {
    type: 'zone',
    id,
    kind,
    label: extra.label ?? id,
    ...(extra.subtitle === undefined ? {} : { subtitle: extra.subtitle }),
    badges: extra.badges ?? [],
    ...(extra.collapsed === undefined ? {} : { collapsed: extra.collapsed }),
    children,
  };
}

export function countNodes(nodes: readonly SceneNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + (node.type === 'zone' ? countNodes(node.children) : 0), 0);
}

export function scene(children: SceneNode[], edges: SceneEdge[] = []): Scene {
  return {
    children,
    edges,
    metadata: {
      rootLabel: 'example.com',
      lens: 'overview',
      readTime: '2026-10-08T00:00:00Z',
      rectCount: countNodes(children),
    },
  };
}

/**
 * A chain of `levels` nested group zones, `z1` at the top, with the card `leaf` at the bottom: the Scene's depth
 * is `levels + 1`. Its metadata is `scene([])`'s, as counting the nodes recursively would overflow the call
 * stack on a chain of thousands of levels.
 */
export function nestedChain(levels: number): Scene {
  let node: SceneNode = card('leaf');
  for (let level = levels; level >= 1; level -= 1) node = zone(`z${String(level)}`, 'group', [node]);
  return { ...scene([]), children: [node] };
}

const ZONE_KINDS: readonly ZoneKind[] = [
  'folder',
  'project',
  'vpc',
  'subnet',
  'region',
  'product-container',
  'group',
];

const LABELS = fc.oneof(
  fc.string({ minLength: 1, maxLength: 24 }),
  fc.string({ unit: 'grapheme', minLength: 1, maxLength: 40 }),
  fc.constantFrom(
    'demo-web-1',
    'Shared VPC host (Production)',
    'eventarc-europe-west3-orders-handler-614468-sub-400',
    'a',
    'Ünïcødé · ラベル · 中文标签',
    'W'.repeat(80),
    '10.0.0.0/22 · europe-west3',
  ),
);

interface NodeSpec {
  readonly zone: boolean;
  readonly kind: ZoneKind;
  readonly parent: number;
  readonly collapsed: boolean;
  readonly label: string;
  readonly subtitle: string | null;
  readonly badges: string[];
  readonly oddId: boolean;
}

const NODE_SPEC: fc.Arbitrary<NodeSpec> = fc.record({
  zone: fc.boolean(),
  kind: fc.constantFrom(...ZONE_KINDS),
  parent: fc.nat(),
  collapsed: fc.boolean(),
  label: LABELS,
  subtitle: fc.option(LABELS),
  badges: fc.array(fc.constantFrom('shared with 3 projects', '12 hidden', 'external', 'x'), { maxLength: 3 }),
  oddId: fc.boolean(),
});

const ODD_IDS = ['__proto__', 'constructor', 'toString', '//compute.googleapis.com/projects/demo-a/x'];

export interface ArbitrarySceneOptions {
  readonly maxNodes?: number;
  readonly maxDepth?: number;
  /** At most this many random edges (default 60). */
  readonly maxEdges?: number;
  /** Draw edge lists across their whole length range, not fast-check's small default size. */
  readonly denseEdges?: boolean;
}

/** Edge kinds of every arrowhead style: one head, both (symmetric `peers`), none (`connects`). */
const EDGE_KINDS = ['uses', 'routes', 'peers', 'attaches', 'connects', 'memberOf', 'shares'] as const;

/**
 * Random Scene trees: nodes are attached in turn to a random open zone of depth < `maxDepth` (or the top
 * level); a collapsed zone takes no children; zones that receive none are empty zones. Edges of random kinds
 * join random pairs of distinct nodes (a zone and its own descendant included, duplicates and reciprocal pairs
 * too). Sometimes the whole tree sits inside an organisation zone, which the layout drops.
 */
export function arbitraryScene(options: ArbitrarySceneOptions = {}): fc.Arbitrary<Scene> {
  const maxNodes = options.maxNodes ?? 300;
  const maxDepth = options.maxDepth ?? 8;
  const maxEdges = options.maxEdges ?? 60;
  return fc
    .record({
      specs: fc.array(NODE_SPEC, { minLength: 0, maxLength: maxNodes, size: 'max' }),
      edges: fc.array(fc.tuple(fc.nat(), fc.nat(), fc.constantFrom(...EDGE_KINDS)), {
        maxLength: maxEdges,
        ...(options.denseEdges === true ? { size: 'max' as const } : {}),
      }),
      organisation: fc.boolean(),
    })
    .map(({ specs, edges, organisation }) => {
      const top: SceneNode[] = [];
      const open: { node: SceneZone; depth: number }[] = [];
      const ids: string[] = [];
      specs.forEach((spec, index) => {
        const id =
          spec.oddId && index < ODD_IDS.length
            ? (ODD_IDS[index] ?? `n${String(index)}`)
            : `n${String(index)}`;
        const candidates = open.filter((entry) => entry.depth < maxDepth);
        const pick = spec.parent % (candidates.length + 1);
        const parent = pick === candidates.length ? undefined : candidates[pick];
        const depth = parent === undefined ? 1 : parent.depth + 1;
        let node: SceneNode;
        if (spec.zone) {
          node = zone(id, spec.kind, [], {
            label: spec.label,
            ...(spec.subtitle === null ? {} : { subtitle: spec.subtitle }),
            badges: spec.badges,
            ...(spec.collapsed ? { collapsed: { resources: 1 + (index % 7) } } : {}),
          });
          if (!spec.collapsed) open.push({ node, depth });
        } else {
          node = card(id, spec.label, spec.subtitle ?? undefined);
        }
        if (parent === undefined) top.push(node);
        else parent.node.children.push(node);
        ids.push(id);
      });
      const sceneEdges: SceneEdge[] = [];
      if (ids.length >= 2) {
        for (const [a, b, kind] of edges) {
          const from = ids[a % ids.length] ?? '';
          const to = ids[b % ids.length] ?? '';
          if (from !== to) sceneEdges.push({ from, to, kind });
        }
      }
      const children =
        organisation && top.length > 0
          ? [zone(ORGANISATION_ID, 'folder', top, { label: 'example.com' })]
          : top;
      return scene(children, sceneEdges);
    });
}

/**
 * A Scene with many edges (worker and stepping tests): `projects` projects of `cards` cards each, and from
 * every card an edge to `fanOut` cards of the next project, so `projects × cards × fanOut` distinct edges.
 */
export function busyScene(projects = 4, cards = 12, fanOut = 4): Scene {
  const id = (p: number, c: number): string => `p${String(p)}-vm${String(c)}`;
  const zones = Array.from({ length: projects }, (_, p) =>
    zone(
      `project-${String(p)}`,
      'project',
      Array.from({ length: cards }, (_, c) =>
        card(id(p, c), `vm-${String(c)}`, `10.0.${String(p)}.${String(c)}`),
      ),
    ),
  );
  const edges: SceneEdge[] = [];
  for (let p = 0; p < projects; p += 1) {
    for (let c = 0; c < cards; c += 1) {
      for (let k = 0; k < fanOut; k += 1) {
        edges.push({ from: id(p, c), to: id((p + 1) % projects, (c + k) % cards), kind: 'uses' });
      }
    }
  }
  return scene([zone('folder', 'folder', zones)], edges);
}
