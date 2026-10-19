// SPDX-License-Identifier: Apache-2.0
/** Step (e) and the emitted scene: detail levels, depth, flips, chips, bundles, edges, pointers, order. */
import {
  FlipIdSchema,
  type Asset,
  type Graph,
  type SceneBuild,
  type SceneEnv,
  type ViewSpecInput,
} from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { catalogWith, folder, project, resource } from '../testing/fixtures.js';
import {
  GADGET,
  HOST_SUBNET,
  LOCAL_VPC,
  ON_HOST,
  ON_SUBNET,
  PROJECT_HOST,
  PROJECT_WEB,
  SHARED_VPC,
} from '../testing/scenario.js';
import { cards, childIds, edgesBetween, placed, zone, zones } from '../testing/scene.js';
import {
  APP,
  ENV,
  FOLDER_PLATFORM,
  FOLDER_WORKLOADS,
  PEER_VPC_A,
  POLICY,
  PROJECT_EMPTY,
  PROJECT_PEER_A,
  PROJECT_PEER_B,
  PROJECT_SOLO,
  ROUTE,
  SOLO_NUMBER,
  checkedScene,
  view,
  viewAssets,
  viewCatalog,
  viewGraphOf,
} from '../testing/views.js';
import { DEFAULT_VIEWPORT_BUDGET, GENERIC_ICON, viewportBudget } from './constants.js';
import { DETAIL_LEVELS, ZONE_OPENS_AT, autoCeiling, autoDetailLevel, zoneOpensAt } from './detail.js';
import { flipIdOf } from './flip.js';
import { buildScene, buildSceneWithReport } from './scene.js';

const CATALOG = viewCatalog();
const GRAPH = viewGraphOf();

function build(input: ViewSpecInput, graph: Graph = GRAPH, env: SceneEnv = ENV): SceneBuild {
  return checkedScene(input, { graph, catalog: CATALOG, env });
}

function chips(build: SceneBuild): string[] {
  return zones(build.scene)
    .filter((z) => z.collapsed !== undefined)
    .map((z) => z.id)
    .sort();
}

/** The scenario with `count` more buckets in demo-solo-1. */
function withBuckets(count: number): Asset[] {
  const buckets = Array.from({ length: count }, (_, index) => {
    const name = `demo-solo-1-${String(index).padStart(3, '0')}`;
    return resource(
      `//storage.googleapis.com/${name}`,
      'storage.googleapis.com/Bucket',
      SOLO_NUMBER,
      { name },
      {
        location: 'europe-west3',
        folders: ['20000000001'],
      },
    );
  });
  return [...viewAssets(), ...buckets];
}

describe('flip ids and the viewport budget', () => {
  it('derives a short, URL-safe, stable token from a zone id', () => {
    const id = flipIdOf(PROJECT_WEB);
    expect(FlipIdSchema.safeParse(id).success).toBe(true);
    expect(id.length).toBeLessThanOrEqual(13);
    expect(flipIdOf(PROJECT_WEB)).toBe(id);
    expect(flipIdOf(PROJECT_HOST)).not.toBe(id);
    // Pinned (64-bit FNV-1a, base 36; checked against an independent implementation): the hash is part of
    // every shared URL with flips.
    expect(flipIdOf('')).toBe('33niihzj4ux45');
    expect(flipIdOf('a')).toBe('2o0ongoiv4rrg');
  });

  it('budgets 73 rects when the viewport is unknown', () => {
    expect(DEFAULT_VIEWPORT_BUDGET).toBe(73);
  });

  it.each([
    [1920, 1080, 148],
    [100, 100, 24],
    [10_000, 10_000, 250],
    [Number.NaN, 800, 24],
    [-5, 800, 24],
  ])('budgets a %d × %d viewport at %d rects (clamped to 24–250)', (width, height, budget) => {
    expect(viewportBudget(width, height)).toBe(budget);
  });
});

describe('detail levels', () => {
  it('collapses projects at folders, networks and product containers at projects, product containers at networks', () => {
    expect(chips(build({ lens: 'everything', detail: 'folders' }))).toEqual(
      [POLICY, PROJECT_HOST, PROJECT_PEER_A, PROJECT_PEER_B, PROJECT_SOLO, PROJECT_WEB].sort(),
    );
    // The peered VPCs hold nothing, so they are no chips.
    expect(chips(build({ lens: 'everything', detail: 'projects' }))).toEqual(
      [APP, LOCAL_VPC, POLICY, SHARED_VPC].sort(),
    );
    expect(
      zone(build({ lens: 'everything', detail: 'projects' }).scene, PEER_VPC_A).collapsed,
    ).toBeUndefined();
    expect(chips(build({ lens: 'everything', detail: 'networks' }))).toEqual([APP, POLICY].sort());
    expect(chips(build({ lens: 'everything', detail: 'all' }))).toEqual([]);
  });

  it('draws containers as the zone kind their catalog type declares (zoneKind), product containers otherwise', () => {
    const { scene } = build({ lens: 'everything', detail: 'all' });
    expect(zone(scene, SHARED_VPC).kind).toBe('vpc');
    expect(zone(scene, HOST_SUBNET).kind).toBe('subnet');
    expect(zone(scene, APP).kind).toBe('product-container');
    // Nothing about networks is hard-coded: a catalog without the zone kinds draws them as product containers,
    // and the `networks` detail level then treats them like any product container.
    const plain = catalogWith(
      [
        {
          product: 'Compute Engine',
          service: 'compute.googleapis.com',
          icon: 'compute_engine',
          types: {
            'compute.googleapis.com/Network': { role: 'container', contains: ['$.data.subnetworks[*]'] },
            'compute.googleapis.com/Subnetwork': {
              role: 'container',
              zoneKind: 'product',
              relations: [{ kind: 'attaches', to: '$.data.network', normalize: 'computeSelfLink' }],
            },
          },
        },
      ],
      'override',
      CATALOG,
    );
    const generic = checkedScene(
      { lens: 'everything', detail: 'all' },
      { graph: GRAPH, catalog: plain },
    ).scene;
    expect(zone(generic, SHARED_VPC).kind).toBe('product-container');
    expect(zone(generic, HOST_SUBNET).kind).toBe('product-container');
  });

  it('never makes a chip of a zone with nothing inside', () => {
    const { scene } = build({ lens: 'everything', detail: 'folders' });
    expect(zone(scene, PROJECT_EMPTY).collapsed).toBeUndefined();
  });

  it('counts what a chip holds', () => {
    const { scene } = build({ lens: 'everything', detail: 'folders' });
    expect(zone(scene, PROJECT_WEB).collapsed).toEqual({
      networks: 1,
      subnets: 2,
      containers: 1,
      resources: 10,
    });
    expect(zone(scene, PROJECT_HOST).collapsed).toEqual({ networks: 1, subnets: 1, resources: 1 });
  });

  it('re-targets edges into chips, merges them with a count, and orders the ends of a peering', () => {
    const { scene, report } = build({ lens: 'overview', detail: 'folders' });
    expect(edgesBetween(scene, PROJECT_WEB, PROJECT_HOST)).toEqual([
      { from: PROJECT_WEB, to: PROJECT_HOST, kind: 'attaches', count: 2, merged: true },
      { from: PROJECT_WEB, to: PROJECT_HOST, kind: 'shares' },
    ]);
    expect(edgesBetween(scene, PROJECT_PEER_A, PROJECT_PEER_B, 'peers')).toEqual([
      { from: PROJECT_PEER_A, to: PROJECT_PEER_B, kind: 'peers', merged: true },
    ]);
    // An edge inside one chip is not drawn.
    expect(scene.edges.every((edge) => edge.from !== edge.to)).toBe(true);
    expect(report.counts.relations).toBe(scene.edges.reduce((sum, edge) => sum + (edge.count ?? 1), 0));
  });

  it('auto never collapses a view of at most 100 rects, and otherwise picks the deepest level that fits', () => {
    const small = build({ lens: 'everything' }, GRAPH, { ...ENV, viewportBudget: 1 });
    expect(small.report.detail).toMatchObject({ requested: 'auto', used: 'all', budget: 1 });

    const big = viewGraphOf(withBuckets(100));
    const fits = build({ lens: 'everything' }, big, { ...ENV, viewportBudget: 200 });
    expect(fits.report.detail.rectCounts.all).toBeGreaterThan(100);
    expect(fits.report.detail.used).toBe('all');
    expect(fits.report.detail.rectCounts).toEqual({ folders: 11, projects: 128, networks: 133, all: 136 });
    const networks = build({ lens: 'everything' }, big, { ...ENV, viewportBudget: 134 });
    expect(networks.report.detail.used).toBe('networks');
    const projects = build({ lens: 'everything' }, big, { ...ENV, viewportBudget: 130 });
    expect(projects.report.detail.used).toBe('projects');
    const folders = build({ lens: 'everything' }, big, { ...ENV, viewportBudget: 30 });
    expect(folders.report.detail.used).toBe('folders');
    expect(folders.scene.metadata.rectCount).toBe(11);
    const none = build({ lens: 'everything' }, big, { ...ENV, viewportBudget: 1 });
    expect(none.report.detail.used).toBe('folders');
    expect(none.report.detail.rectCounts.folders).toBeGreaterThan(1);
    expect(build({ lens: 'everything' }, big).report.detail.budget).toBe(DEFAULT_VIEWPORT_BUDGET);
  });

  it('auto never opens deeper than the lens default, its ceiling; an explicit level still opens deeper', () => {
    const lenses = CATALOG.lenses;
    const capped = {
      ...CATALOG,
      lenses: { ...lenses, everything: { ...lenses.everything, defaultDetail: 'projects' as const } },
    };
    const at = (input: ViewSpecInput, graph: Graph, env: SceneEnv = ENV) =>
      checkedScene(input, { graph, catalog: capped, env }).report.detail;
    // A view of at most 100 rects opens whole, whatever the ceiling.
    expect(at({ lens: 'everything' }, GRAPH, { ...ENV, viewportBudget: 1 })).toMatchObject({
      requested: 'auto',
      used: 'all',
      ceiling: 'projects',
    });
    const big = viewGraphOf(withBuckets(100));
    expect(at({ lens: 'everything' }, big, { ...ENV, viewportBudget: 200 }).used).toBe('projects');
    // Below the ceiling the budget decides, as before.
    expect(at({ lens: 'everything' }, big, { ...ENV, viewportBudget: 30 }).used).toBe('folders');
    // An explicit level is the person's: deeper than the ceiling is fine.
    expect(at({ lens: 'everything', detail: 'all' }, big).used).toBe('all');
    // A lens that opens at auto has no ceiling below all.
    expect(build({ lens: 'everything' }).report.detail.ceiling).toBe('all');
  });

  it('exports the level table, the ceiling and the auto rule the app reads', () => {
    expect(DETAIL_LEVELS).toEqual(['folders', 'projects', 'networks', 'all']);
    expect(ZONE_OPENS_AT).toEqual({
      folder: 'folders',
      group: 'folders',
      project: 'projects',
      region: 'projects',
      vpc: 'networks',
      subnet: 'networks',
      'product-container': 'all',
    });
    expect(zoneOpensAt('product-container', true)).toBe('folders');
    expect(zoneOpensAt('subnet', false)).toBe('networks');
    expect([autoCeiling('auto'), autoCeiling('networks'), autoCeiling('folders')]).toEqual([
      'all',
      'networks',
      'folders',
    ]);
  });

  const COUNTS = { folders: 20, projects: 70, networks: 90, all: 200 };
  const SMALL = { folders: 5, projects: 50, networks: 80, all: 100 };
  const OVER_100 = { ...SMALL, all: 101 };
  it.each([
    ['folders when nothing deeper fits the budget', COUNTS, 19, undefined, 'folders'],
    ['the deepest level that fits the budget', COUNTS, 73, undefined, 'projects'],
    ['all when all fits the budget', COUNTS, 300, undefined, 'all'],
    ['no level deeper than the ceiling', COUNTS, 300, 'networks', 'networks'],
    ['the budget’s level when it is shallower than the ceiling', COUNTS, 73, 'networks', 'projects'],
    // At most 100 rects: whole, whatever the budget and the ceiling.
    ['all for at most 100 rects, whatever the budget', SMALL, 24, undefined, 'all'],
    ['all for at most 100 rects, whatever the ceiling', SMALL, 24, 'projects', 'all'],
    ['all for at most 100 rects, even below a folders ceiling', SMALL, 24, 'folders', 'all'],
    ['the budget’s level again above 100 rects', OVER_100, 24, 'projects', 'folders'],
    ['the ceiling again above 100 rects', OVER_100, 300, 'projects', 'projects'],
  ] as const)('auto picks %s', (_, counts, budget, ceiling, level) => {
    expect(autoDetailLevel(counts, budget, ceiling)).toBe(level);
  });

  it('collapses asset zones deeper than the depth limit (bundles, regions and overlays are no level)', () => {
    const depth1 = build({ lens: 'everything', detail: 'all', filters: { depth: 1 } });
    expect(chips(depth1)).toEqual(
      [
        '//cloudresourcemanager.googleapis.com/folders/20000000003',
        PROJECT_HOST,
        PROJECT_PEER_A,
        PROJECT_PEER_B,
        PROJECT_SOLO,
      ].sort(),
    );
    const depth2 = build({ lens: 'everything', detail: 'all', filters: { depth: 2 } });
    expect(chips(depth2)).toEqual([PROJECT_WEB, SHARED_VPC].sort());
    // Nothing deeper than the limit is open: a zone one level below it is a chip or holds nothing.
    for (const { node, depth } of placed(depth2.scene).values()) {
      expect(depth).toBeLessThanOrEqual(3);
      if (node.type === 'zone' && depth === 3) expect(node.children).toEqual([]);
    }
  });

  it('flips XOR the default: a chip opens, an open zone closes, whatever collapsed it', () => {
    const opened = build({ lens: 'everything', detail: 'folders', flips: [flipIdOf(PROJECT_WEB)] });
    expect(zone(opened.scene, PROJECT_WEB).collapsed).toBeUndefined();
    expect(zone(opened.scene, LOCAL_VPC).collapsed).toBeDefined();
    const closed = build({ lens: 'everything', detail: 'all', flips: [flipIdOf(FOLDER_PLATFORM)] });
    expect(chips(closed)).toEqual([FOLDER_PLATFORM]);
    const deep = build({
      lens: 'everything',
      detail: 'all',
      filters: { depth: 1 },
      flips: [flipIdOf(PROJECT_SOLO)],
    });
    expect(zone(deep.scene, PROJECT_SOLO).collapsed).toBeUndefined();
    // The flip does not move auto's choice.
    expect(build({ lens: 'everything', flips: [flipIdOf(FOLDER_PLATFORM)] }).report.detail.used).toBe('all');
  });

  it('reports flips that match no zone of the view', () => {
    const { report } = build({ lens: 'everything', flips: ['stale1', flipIdOf(PROJECT_WEB)] });
    expect(report.unknownFlips).toEqual(['stale1']);
    expect(report.warnings).toEqual(['1 flip match no zone of this view.']);
  });
});

describe('bundles', () => {
  it('bundles more than 120 siblings into alphabetical groups of about 24', () => {
    const { scene, report } = build({ lens: 'everything', detail: 'all' }, viewGraphOf(withBuckets(130)));
    const groups = childIds(scene, PROJECT_SOLO);
    // 130 buckets, 3 more buckets, the build and the route: 135 → 6 bundles of 22 or 23.
    expect(groups).toHaveLength(6);
    expect(report.counts.bundles).toBe(6);
    const sizes = groups.map((id) => zone(scene, id).children.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(135);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    const first = zone(scene, groups[0] ?? '');
    expect(first).toMatchObject({ kind: 'group', id: `group:${first.children[0]?.id ?? ''}` });
    expect(first.badges).toEqual([`${String(first.children.length)} items`]);
    // Dictionary-style: the shortest prefixes that tell each end from the neighbouring bundle.
    expect(groups.map((id) => zone(scene, id).label)).toEqual([
      'b – demo-solo-1-01',
      'demo-solo-1-02 – demo-solo-1-041',
      'demo-solo-1-042 – demo-solo-1-063',
      'demo-solo-1-064 – demo-solo-1-086',
      'demo-solo-1-087 – demo-solo-1-10',
      'demo-solo-1-11 – demo-solo-1-o',
    ]);
  });

  it('bundles the top level, and lets a flip close a bundle into a chip', () => {
    const projects = Array.from({ length: 121 }, (_, index) =>
      project(String(10000000100 + index), `demo-many-${String(index).padStart(3, '0')}`),
    );
    const graph = viewGraphOf([...viewAssets(), ...projects]);
    const { scene } = build({ lens: 'everything', detail: 'all' }, graph);
    expect(scene.children.every((node) => node.type === 'zone' && node.kind === 'group')).toBe(true);
    const firstGroup = scene.children[0]?.id ?? '';
    const closed = build({ lens: 'everything', detail: 'all', flips: [flipIdOf(firstGroup)] }, graph);
    expect(zone(closed.scene, firstGroup).collapsed).toBeDefined();
  });

  it('labels a bundle of identical labels with the label', () => {
    const same = Array.from({ length: 121 }, (_, index) => folder(String(20000000100 + index), 'Same'));
    const { scene } = build(
      { lens: 'everything', detail: 'folders' },
      viewGraphOf([...viewAssets(), ...same]),
    );
    expect(scene.children.map((node) => node.label)).toContain('Same');
  });
});

describe('cards and pointers', () => {
  it('resolves icons through the catalog: the type, its service’s product, the generic mark', () => {
    const { scene } = build({ lens: 'everything', detail: 'all' });
    const icon = (id: string): string | undefined => cards(scene).find((card) => card.id === id)?.icon;
    // A type with no icon of its own takes its product's (VM instances: Compute Engine); a type with its own
    // icon (routes) keeps it.
    expect(icon(ON_HOST)).toBe('compute_engine');
    expect(icon(ROUTE)).toBe('cloud_routes');
    expect(icon(GADGET)).toBe(GENERIC_ICON);
  });

  it('gives a product container its catalog type’s icon; other zones draw their kind’s mark', () => {
    const { scene } = build({ lens: 'everything', detail: 'all' });
    const products = zones(scene).filter((z) => z.kind === 'product-container');
    expect(products.length).toBeGreaterThan(0);
    for (const z of products) {
      const assetType = GRAPH.nodes[z.id]?.assetType ?? '';
      expect(z.icon, z.id).toBe(CATALOG.types[assetType]?.icon);
    }
    for (const z of zones(scene).filter((other) => other.kind !== 'product-container'))
      expect(z, z.id).not.toHaveProperty('icon');
  });

  it('passes the selection and the highlight through, with the scene node that shows them', () => {
    const visible = build({
      lens: 'everything',
      detail: 'all',
      selection: ON_HOST,
      highlight: '10.0.0.2',
    }).report;
    expect(visible.selection).toEqual({ value: ON_HOST, node: ON_HOST, shownAs: ON_HOST });
    expect(visible.highlight).toEqual({ value: '10.0.0.2' });
    const chipped = build({
      lens: 'everything',
      detail: 'folders',
      selection: ON_SUBNET,
      highlight: FOLDER_WORKLOADS,
    }).report;
    expect(chipped.selection).toEqual({ value: ON_SUBNET, node: ON_SUBNET, shownAs: PROJECT_WEB });
    expect(chipped.highlight).toEqual({
      value: FOLDER_WORKLOADS,
      node: FOLDER_WORKLOADS,
      shownAs: FOLDER_WORKLOADS,
    });
    const hidden = build({ lens: 'networking', selection: ON_HOST }).report;
    expect(hidden.selection).toEqual({ value: ON_HOST, node: ON_HOST });
  });

  it('counts dangling references of visible nodes', () => {
    // The Cloud Run service runs as an account the scenario does not have.
    expect(build({ lens: 'everything' }).report.counts.dangling).toBe(1);
    expect(build({ lens: 'networking' }).report.counts.dangling).toBe(0);
  });
});

// That the scene does not depend on the order of the graph's records, and the label and id order of siblings,
// are properties (test/views/scene.property.test.ts, and the oracle on every row of the composition table).
describe('order', () => {
  it('orders zones before cards, and zones by kind', () => {
    const { scene } = build({ lens: 'everything', detail: 'all' });
    const web = childIds(scene, PROJECT_WEB);
    expect(web.indexOf(LOCAL_VPC)).toBeLessThan(web.indexOf(APP));
    expect(web.indexOf(APP)).toBeLessThan(web.indexOf(ON_HOST));
  });
});

describe('buildScene', () => {
  it('returns the scene of buildSceneWithReport, without the report', () => {
    const spec = view({ lens: 'everything', detail: 'projects', filters: { showRegions: true } });
    expect(buildScene(GRAPH, spec, CATALOG, ENV)).toEqual(
      buildSceneWithReport(GRAPH, spec, CATALOG, ENV).scene,
    );
  });
});
