// SPDX-License-Identifier: Apache-2.0
/**
 * Small hand-built Scenes for the renderer's unit tests: synthetic ids under example.com, laid out by the real
 * layout engine so every rect and route is what the renderer meets in the app; and walkers over a Scene's nodes.
 */
import type { ConsoleLink } from '@gcportrait/catalog';
import { layoutScene } from '@gcportrait/layout';
import type { RelationKind, Scene, SceneCard, SceneEdge, SceneNode, SceneZone } from '@gcportrait/model';

import { diagramIcons } from '../iconTable';
import { buildDiagramModel, type DiagramModel } from '../model';

export function card(id: string, label: string, extra: Partial<SceneCard> = {}): SceneCard {
  return {
    type: 'card',
    id,
    label,
    icon: 'cloud_run',
    product: 'Cloud Run',
    assetType: 'run.googleapis.com/Service',
    ...extra,
  };
}

export function zone(
  id: string,
  kind: SceneZone['kind'],
  label: string,
  children: SceneNode[],
  extra: Partial<SceneZone> = {},
): SceneZone {
  return { type: 'zone', id, kind, label, badges: [], children, ...extra };
}

function count(nodes: readonly SceneNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + (node.type === 'zone' ? count(node.children) : 0), 0);
}

export function scene(children: SceneNode[], edges: SceneEdge[] = [], label = 'example.com'): Scene {
  return {
    children,
    edges,
    metadata: {
      rootLabel: label,
      lens: 'overview',
      readTime: '2026-10-08T00:00:00Z',
      rectCount: count(children),
    },
  };
}

/**
 * A folder holding a project with a VPC, a subnet with two cards (one with an address), a nested product
 * container with a card, a card in the project, and a collapsed project; the given edges between them.
 */
export function smallScene(edges: ReadonlyArray<readonly [string, string, RelationKind]> = []): Scene {
  return scene(
    [
      zone(
        'folders/1',
        'folder',
        'Platform',
        [
          zone(
            'projects/web',
            'project',
            'Retail web',
            [
              zone(
                'networks/vpc',
                'vpc',
                'vpc-prod',
                [
                  zone('subnets/a', 'subnet', 'subnet-a', [
                    card('run/api', 'orders-api', { subtitle: '10.0.0.4 · europe-west3' }),
                    card('run/web', 'storefront'),
                  ]),
                ],
                { badges: ['shared with 2 projects'] },
              ),
              zone('clusters/gke', 'product-container', 'retail-prod', [
                card('pools/default', 'default-pool'),
              ]),
              card('run/jobs', 'batch-jobs'),
            ],
            { subtitle: 'demo-web-1' },
          ),
          zone('projects/data', 'project', 'Analytics', [], { collapsed: { networks: 2, resources: 39 } }),
        ],
        { subtitle: 'folder 20000000001' },
      ),
    ],
    edges.map(([from, to, kind]) => ({ from, to, kind })),
  );
}

export function modelOf(
  source: Scene,
  lensTitle = 'Overview',
  overlayZones: readonly string[] = [],
): DiagramModel {
  return buildDiagramModel({
    scene: source,
    layout: layoutScene(source),
    lensTitle,
    overlayZones,
    icons: diagramIcons(source),
  });
}

/**
 * Lines of the small scene for the selection trace: the web service routes to the API, which routes to the
 * pool (a `routes` chain through `run/api`), and an unrelated `uses` line from the batch jobs to the chip.
 */
export const TRACE_EDGES = [
  ['run/web', 'run/api', 'routes'],
  ['run/api', 'pools/default', 'routes'],
  ['run/jobs', 'projects/data', 'uses'],
] as const satisfies ReadonlyArray<readonly [string, string, RelationKind]>;

/** Console actions for the small scene: a resource page, a project fallback, and an open zone's page. */
export const CONSOLE_LINKS = {
  'run/api': {
    kind: 'resource',
    url: 'https://console.cloud.google.com/run/detail/europe-west3/orders-api/metrics?project=demo-web-1',
  },
  'run/web': {
    kind: 'project',
    url: 'https://console.cloud.google.com/home/dashboard?project=demo-web-1',
    projectId: 'demo-web-1',
  },
  'projects/web': {
    kind: 'resource',
    url: 'https://console.cloud.google.com/home/dashboard?project=demo-web-1',
  },
} as const satisfies Readonly<Record<string, ConsoleLink>>;

/** `model` with the small scene's console actions, as the data worker would send them. */
export function withConsoleLinks(model: DiagramModel): DiagramModel {
  return buildDiagramModel({ ...model.input, consoleLinks: CONSOLE_LINKS });
}

/** Twelve cards in one row of ids, `run/c0` to `run/c11`. */
export function denseCards(): SceneCard[] {
  return Array.from({ length: 12 }, (_, index) => card(`run/c${String(index)}`, `s${String(index)}`));
}

/** The first `count` of the 66 `uses` lines between every pair of the twelve cards (c0 → c1, c0 → c2, …). */
export function denseEdges(count = 66): SceneEdge[] {
  const edges: SceneEdge[] = [];
  for (let i = 0; i < 12; i += 1)
    for (let j = i + 1; j < 12; j += 1)
      edges.push({ from: `run/c${String(i)}`, to: `run/c${String(j)}`, kind: 'uses' });
  return edges.slice(0, count);
}

/** The twelve cards in one project with `edgeCount` of their lines: above 30 drawn lines a drawing dims them. */
export function denseScene(edgeCount: number): Scene {
  return scene([zone('projects/p', 'project', 'p', denseCards())], denseEdges(edgeCount));
}

/** `count` projects side by side, each with one card: wider than the canvas, so a keyboard move must pan. */
export function wideScene(count = 12): Scene {
  return scene(
    Array.from({ length: count }, (_, index) =>
      zone(`projects/p${String(index)}`, 'project', `p${String(index)}`, [
        card(`run/c${String(index)}`, `c${String(index)}`),
      ]),
    ),
  );
}

/** Every zone of a Scene, each before the zones inside it. */
export function sceneZones(source: Scene | readonly SceneNode[]): SceneZone[] {
  const nodes = 'children' in source ? source.children : source;
  return nodes.flatMap((node) => (node.type === 'zone' ? [node, ...sceneZones(node.children)] : []));
}

/** The zone `id` of a Scene, wherever it is. */
export function zoneOf(source: Scene, id: string): SceneZone | undefined {
  return sceneZones(source).find((candidate) => candidate.id === id);
}

/** The first collapsed zone (a chip) of a Scene in drawing order, if it draws one. */
export function firstChip(source: Scene): string | undefined {
  return sceneZones(source).find((candidate) => candidate.collapsed !== undefined)?.id;
}

/** Each node's zone in a Scene (null at the top level). */
export function parentsOf(source: Scene): Map<string, string | null> {
  const parents = new Map<string, string | null>();
  const visit = (nodes: readonly SceneNode[], up: string | null): void => {
    for (const node of nodes) {
      parents.set(node.id, up);
      if (node.type === 'zone') visit(node.children, node.id);
    }
  };
  visit(source.children, null);
  return parents;
}
