// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The timeline diff of a drawn day (tickDiff.ts) on demo organisation S's history, worked out as the data
 * worker does: the diff is `diffSnapshots` of the two days, by name and order-independent; what the view drew the
 * day before and no longer draws comes back as ghosts in its old container, with the reason, holding only what is
 * gone (on demo M's two days with its perimeter removed, a project it secured that is still there, inside a chip,
 * comes back with nothing), and the zones the ghosts depend on are listed as that day drew them; a region zone the
 * drawn day no longer draws since everything in it was removed (demo M's two days with a project's us-central1
 * emptied) is a ghost itself in its open project, holding theirs, or the project's chip counts them; a changed
 * asset the drawn day still holds is a ghost only where the view leaves it out (on demo M's two days with a project
 * moved into another folder, it is none, and the chip that holds it counts it); chips count what changed inside
 * them, also those that are no Graph container (a region zone flipped closed, and on demo L's history a bundle), and
 * what they count is no ghost; nothing changes when the days are alike, and nothing is ghosted when the drill-in root
 * moved.
 */
import { catalog } from '@gcportrait/catalog';
import {
  BUNDLE_ID_PREFIX,
  buildGraph,
  buildSceneWithReport,
  diffSnapshots,
  flipIdOf,
  isVirtualNode,
} from '@gcportrait/graph';
import { layoutScene, type Layout } from '@gcportrait/layout';
import { normalizeViewSpec, SceneSchema, type Snapshot, type ViewSpecInput } from '@gcportrait/model';
import { beforeAll, describe, expect, it } from 'vitest';

import { DEMO_S } from '../testing/demoData';
import {
  demoDayGraph,
  DEMO_M_MOVE,
  DEMO_M_PERIMETER,
  DEMO_M_REGION,
  perimeterRemoved,
  projectMoved,
  regionRemoved,
  sceneEnv as env,
  type DemoDay,
} from '../testing/demoScenes';
import { parentsOf as parents, sceneZones, zoneOf } from '../testing/scenes';
import { openView, tickDiff, type TickDiffInput } from './tickDiff';

beforeAll(async () => {
  await import('../pipeline/demo');
});

const {
  scratchBucket: SCRATCH_BUCKET,
  debugSubscription: DEBUG_SUBSCRIPTION,
  servicesProject: SERVICES_PROJECT,
  dataProject: DATA_PROJECT,
  reportsProject: REPORTS_PROJECT,
  reportsVm: REPORTS_VM,
} = DEMO_S;

/** The input of a diff of S from day `since` to day `day` for a view, the drawn Scene built as the worker does. */
async function inputOf(
  since: string,
  day: string,
  view: Partial<ViewSpecInput> = {},
): Promise<TickDiffInput> {
  const [before, after] = await Promise.all([demoDayGraph('S', since), demoDayGraph('S', day)]);
  const spec = normalizeViewSpec({ snapshot: 'demo:S', lens: 'overview', ...view });
  const { scene, report } = buildSceneWithReport(after.graph, spec, catalog, env(after.snapshot));
  return {
    before: { snapshot: before.snapshot, graph: before.graph, tick: since },
    after: { snapshot: after.snapshot, graph: after.graph, tick: day },
    spec,
    scene,
    report,
    catalog,
    envBefore: env(before.snapshot),
    envAfter: env(after.snapshot),
  };
}

/** The input of a diff between two days for a view, the drawn Scene built as the worker does. */
function pairInput(before: DemoDay, after: DemoDay, view: ViewSpecInput): TickDiffInput {
  const spec = normalizeViewSpec(view);
  const { scene, report } = buildSceneWithReport(after.graph, spec, catalog, env(after.snapshot));
  return {
    before,
    after,
    spec,
    scene,
    report,
    catalog,
    envBefore: env(before.snapshot),
    envAfter: env(after.snapshot),
  };
}

/** Demo L's day `day` (`YYYY-MM-DD`), as the data worker holds it, with its tick. */
async function demoLDay(day: string): Promise<DemoDay> {
  return { ...(await demoDayGraph('L', day)), tick: day };
}

/** How long a test on demo L may take (its days are read and its Scenes built ten times larger than M's). */
const DEMO_L = 30_000;

/** Demo S's data project's europe-west3 region zone (region zones shown): it holds the lake bucket. */
const DATA_REGION = '//gcportrait.virtual/projects/demo-data-1/locations/europe-west3';
/** Changed on 17 September. */
const LAKE_BUCKET = '//storage.googleapis.com/demo-data-1-lake';

/** Demo S's view with region zones shown and every zone open but the data project's region. */
function regionClosed(): Partial<ViewSpecInput> {
  return { detail: 'all', filters: { showRegions: true }, flips: [flipIdOf(DATA_REGION)] };
}

/** A bundle of demo L's everything lens at `all` (its id names its first member), and a subnet in it. */
const BUNDLE = `${BUNDLE_ID_PREFIX}//compute.googleapis.com/projects/demo-net-1/regions/us-central1/subnetworks/demo-svc-4-run-us-central1`;
/** Changed on 22 September. */
const BUNDLED_SUBNET =
  '//compute.googleapis.com/projects/demo-net-1/regions/us-central1/subnetworks/demo-vm-3-us-central1';

function reversed(snapshot: Snapshot): Snapshot {
  return { ...snapshot, assets: [...snapshot.assets].reverse() };
}

/** Expects the rect of `id` in a layout to lie in zone `parent`, overlapping none of its siblings there. */
function expectPlacedAmongSiblings(layout: Layout, id: string, parent: string): void {
  const rect = layout.rects[id];
  expect(rect?.parent, id).toBe(parent);
  if (rect === undefined) return;
  for (const [other, box] of Object.entries(layout.rects)) {
    if (other === id || box.parent !== parent) continue;
    const apart =
      box.x >= rect.x + rect.width ||
      rect.x >= box.x + box.width ||
      box.y >= rect.y + rect.height ||
      rect.y >= box.y + box.height;
    expect(apart, other).toBe(true);
  }
}

describe('the diff of a drawn day', () => {
  it('is diffSnapshots of the day on screen before and the drawn day, with the day compared with', async () => {
    const input = await inputOf('2026-09-07', '2026-09-08');
    const { diff } = tickDiff(input);
    const expected = diffSnapshots(input.before.snapshot, input.after.snapshot);
    expect(diff).toMatchObject(expected);
    expect(diff.since).toEqual({ tick: '2026-09-07', readTime: '2026-09-07T00:00:00Z' });
    expect(diff.added).toContain(DEBUG_SUBSCRIPTION);
    expect(diff.removed).toContain(SCRATCH_BUCKET);
    expect(diff.changed).toEqual([SERVICES_PROJECT]);
  });

  it('does not depend on the order of either day’s assets', async () => {
    const input = await inputOf('2026-09-16', '2026-09-17');
    const shuffledBefore = reversed(input.before.snapshot);
    const shuffledAfter = reversed(input.after.snapshot);
    const shuffled: TickDiffInput = {
      ...input,
      before: { ...input.before, snapshot: shuffledBefore, graph: buildGraph(shuffledBefore, catalog) },
      after: { ...input.after, snapshot: shuffledAfter, graph: buildGraph(shuffledAfter, catalog) },
    };
    expect(tickDiff(shuffled)).toEqual(tickDiff(input));
  });

  it('names the snapshot’s own day without a tick', async () => {
    const input = await inputOf('2026-10-07', '2026-10-08');
    const own = { snapshot: input.before.snapshot, graph: input.before.graph };
    const { diff } = tickDiff({ ...input, before: own });
    expect(diff.since).toEqual({ readTime: '2026-10-07T00:00:00Z' });
  });

  it('is empty and leaves the Scene alone when the two days are alike', async () => {
    const input = await inputOf('2026-09-08', '2026-09-08');
    const result = tickDiff(input);
    expect(result.diff).toMatchObject({
      added: [],
      removed: [],
      changed: [],
      ghosts: {},
      earlier: {},
      inside: {},
    });
    expect(result.scene).toBe(input.scene);
  });
});

describe('ghosts', () => {
  it('puts a removed card back into its old container for the layout to place, the Scene still valid', async () => {
    const input = await inputOf('2026-09-07', '2026-09-08');
    const { scene, diff } = tickDiff(input);
    expect(diff.ghosts).toEqual({ [SCRATCH_BUCKET]: 'removed' });
    expect(SceneSchema.safeParse(scene).success).toBe(true);
    expect(parents(scene).get(SCRATCH_BUCKET)).toBe(DATA_PROJECT);
    expect(parents(input.scene).has(SCRATCH_BUCKET)).toBe(false);
    expect(scene.metadata.rectCount).toBe(input.scene.metadata.rectCount + 1);
    // The layout places it among its siblings, as the day before, overlapping nothing (its invariants hold).
    expectPlacedAmongSiblings(layoutScene(scene), SCRATCH_BUCKET, DATA_PROJECT);
  });

  it('ghosts a project marked for deletion as hidden, with what it held as removed, in its old folder', async () => {
    const input = await inputOf('2026-09-16', '2026-09-17');
    const { scene, diff } = tickDiff(input);
    expect(diff.ghosts[REPORTS_PROJECT]).toBe('hidden');
    expect(diff.ghosts[REPORTS_VM]).toBe('removed');
    expect(Object.values(diff.ghosts).filter((reason) => reason === 'removed')).toHaveLength(4);
    const up = parents(scene);
    const earlier = buildSceneWithReport(input.before.graph, input.spec, catalog, input.envBefore);
    expect(up.get(REPORTS_PROJECT)).toBe(parents(earlier.scene).get(REPORTS_PROJECT));
    expect(up.get(REPORTS_PROJECT)).not.toBeNull();
    // Nested ghosts stay inside their ghost: only the project is added to a container of the drawn day.
    for (const id of Object.keys(diff.ghosts)) {
      if (id === REPORTS_PROJECT) continue;
      let at = up.get(id) ?? null;
      while (at !== null && at !== REPORTS_PROJECT) at = up.get(at) ?? null;
      expect(at, id).toBe(REPORTS_PROJECT);
    }
    expect(scene.metadata.rectCount).toBe(input.scene.metadata.rectCount + 5);
  });

  it('lists the zones the ghosts depend on as the earlier day drew them: each ghost zone, and the zones around a ghost up to the canvas', async () => {
    const input = await inputOf('2026-09-16', '2026-09-17');
    const { scene, diff } = tickDiff(input);
    const earlier = buildSceneWithReport(input.before.graph, input.spec, catalog, input.envBefore);
    const up = parents(earlier.scene);
    const around: string[] = [];
    for (let at = up.get(REPORTS_PROJECT) ?? null; at !== null; at = up.get(at) ?? null) around.push(at);
    expect(around.length).toBeGreaterThan(0);
    const ghostZones = sceneZones(scene).filter((zone) => Object.hasOwn(diff.ghosts, zone.id));
    expect(ghostZones.map((zone) => zone.id)).toContain(REPORTS_PROJECT);
    expect(Object.keys(diff.earlier).sort()).toEqual(
      [...around, ...ghostZones.map((zone) => zone.id)].sort(),
    );
    for (const id of around) {
      expect(diff.earlier[id], id).toMatchObject({ collapsed: false, empty: false, overlay: false });
    }
    for (const zone of ghostZones) {
      expect(diff.earlier[zone.id], zone.id).toEqual({
        kind: zone.kind,
        parent: up.get(zone.id),
        overlay: false,
        collapsed: zone.collapsed !== undefined,
        empty: zone.collapsed === undefined && zone.children.length === 0,
      });
    }
    // A ghost card depends only on the zones around it.
    const card = tickDiff(await inputOf('2026-09-07', '2026-09-08')).diff;
    expect(card.ghosts).toEqual({ [SCRATCH_BUCKET]: 'removed' });
    expect(Object.keys(card.earlier)).toContain(DATA_PROJECT);
    expect(Object.hasOwn(card.earlier, SCRATCH_BUCKET)).toBe(false);
  });

  it('works backwards too: stepping back, what the later day had is the ghost', async () => {
    const input = await inputOf('2026-09-08', '2026-09-07');
    const { diff } = tickDiff(input);
    expect(diff.since.tick).toBe('2026-09-08');
    expect(diff.added).toContain(SCRATCH_BUCKET);
    expect(diff.removed).toContain(DEBUG_SUBSCRIPTION);
    expect(diff.ghosts).toEqual({ [DEBUG_SUBSCRIPTION]: 'removed' });
  });

  it('puts ghosts at the top level of a drill-in whose root is still there', async () => {
    const input = await inputOf('2026-09-16', '2026-09-17', { root: REPORTS_PROJECT });
    const { scene, diff } = tickDiff(input);
    expect(input.report.root.used).toBe(REPORTS_PROJECT);
    expect(input.scene.children).toHaveLength(0);
    expect(diff.ghosts[REPORTS_VM]).toBe('removed');
    expect(scene.children.length).toBeGreaterThan(0);
  });

  it('ghosts nothing when the earlier day was drawn from another root', async () => {
    // Drilled into the reports project's network, which is gone the next day: the view falls back to another root.
    const network = DEMO_S.reportsNetwork;
    const input = await inputOf('2026-09-16', '2026-09-17', { root: network });
    expect(input.report.root.used).not.toBe(network);
    const { diff } = tickDiff(input);
    expect(diff.removed).toContain(network);
    expect(diff.ghosts).toEqual({});
  });
});

describe('what a ghost holds', () => {
  const { perimeter: PERIMETER, secured: SECURED, stillThere: STILL_THERE } = DEMO_M_PERIMETER;

  it('is only what is gone: a project the removed perimeter secured that is still there, inside a chip, comes back with nothing', async () => {
    const [before, after] = await perimeterRemoved();
    // Every zone open but those deeper than one asset zone. The earlier day drew the perimeter around its two
    // projects, each open; the drawn day has no perimeter, so the view falls back to the organisation.
    const input = pairInput(before, after, {
      snapshot: 'demo:M',
      detail: 'all',
      filters: { depth: 1 },
      focus: { kind: 'perimeter', params: { perimeter: 'data_perimeter' } },
    });
    const earlier = buildSceneWithReport(before.graph, input.spec, catalog, input.envBefore);
    expect(parents(earlier.scene).get(STILL_THERE)).toBe(PERIMETER);
    expect(zoneOf(earlier.scene, STILL_THERE)?.collapsed).toBeUndefined();
    // The project that is still there is not drawn on the drawn day: a chip holds it (its folder's, or one around).
    expect(parents(input.scene).has(STILL_THERE)).toBe(false);
    let holder = after.graph.containment.parent[STILL_THERE];
    while (holder !== undefined && !parents(input.scene).has(holder)) {
      holder = after.graph.containment.parent[holder];
    }
    expect(holder === undefined ? undefined : zoneOf(input.scene, holder)?.collapsed).toBeDefined();

    const { scene, diff } = tickDiff(input);
    expect(diff.ghosts).toMatchObject({ [PERIMETER]: 'removed', [SECURED]: 'removed' });
    // Neither it nor anything in it is a ghost, nor anything else the drawn day still has.
    expect(Object.hasOwn(diff.ghosts, STILL_THERE)).toBe(false);
    expect(Object.hasOwn(diff.earlier, STILL_THERE)).toBe(false);
    const removed = new Set(diff.removed);
    for (const id of Object.keys(diff.ghosts)) expect(removed.has(id), id).toBe(true);
    expect(zoneOf(scene, PERIMETER)?.children.map((child) => child.id)).toEqual([SECURED]);
    expect(scene.metadata.rectCount).toBe(input.scene.metadata.rectCount + Object.keys(diff.ghosts).length);
  });

  it('brings back the region zones around what is gone, with the reason of the ghost around them', async () => {
    // Demo S's reports project, marked for deletion, with region zones shown: what it held lies in its region.
    const input = await inputOf('2026-09-16', '2026-09-17', { filters: { showRegions: true } });
    const { scene, diff } = tickDiff(input);
    expect(diff.ghosts[REPORTS_PROJECT]).toBe('hidden');
    const project = zoneOf(scene, REPORTS_PROJECT);
    const regions = sceneZones(project?.children ?? []).filter((zone) => zone.kind === 'region');
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      // No asset, so not in the diff: the ghost around it gives its reason, and it holds what was removed.
      expect(diff.removed, region.id).not.toContain(region.id);
      expect(diff.ghosts[region.id], region.id).toBe('hidden');
      expect(region.children.length, region.id).toBeGreaterThan(0);
      for (const child of region.children) {
        const zone = child.type === 'zone' && child.kind === 'region';
        expect(diff.ghosts[child.id], child.id).toBe(zone ? 'hidden' : 'removed');
      }
    }
  });
});

describe('a region zone whose contents were removed', () => {
  const { project: PROJECT, region: REGION } = DEMO_M_REGION;
  // The overview with region zones shown, every zone open.
  const view = {
    snapshot: 'demo:M',
    lens: 'overview',
    detail: 'all',
    filters: { showRegions: true },
  } as const;

  /** What the earlier day's view drew inside the region zone, at any depth, with the zone each lay in. */
  function heldByRegion(input: TickDiffInput): Map<string, string | null> {
    const earlier = buildSceneWithReport(input.before.graph, input.spec, catalog, input.envBefore);
    const region = zoneOf(earlier.scene, REGION);
    if (region === undefined) throw new Error(`no region zone ${REGION}`);
    const held = parents({ ...earlier.scene, children: region.children });
    for (const [id, up] of held) if (up === null) held.set(id, REGION);
    return held;
  }

  it('is a ghost in its project, open, holding the ghosts of what it held, and counted by no chip', async () => {
    const [before, after] = await regionRemoved();
    const input = pairInput(before, after, view);
    // The earlier day drew the region zone open in the project; the drawn day draws the project open without it.
    const earlier = buildSceneWithReport(before.graph, input.spec, catalog, input.envBefore);
    expect(parents(earlier.scene).get(REGION)).toBe(PROJECT);
    expect(zoneOf(earlier.scene, REGION)?.collapsed).toBeUndefined();
    expect(zoneOf(input.scene, PROJECT)?.collapsed).toBeUndefined();
    expect(parents(input.scene).has(REGION)).toBe(false);
    const held = heldByRegion(input);
    const assets = [...held.keys()].filter((id) => !isVirtualNode(id));
    expect(assets.length).toBeGreaterThanOrEqual(10);

    const { scene, diff } = tickDiff(input);
    const removed = new Set(diff.removed);
    for (const id of assets) expect(removed.has(id), id).toBe(true);
    // No asset, so not in the diff: the ghost takes the reason of what it holds, as does the zone inside it.
    expect(removed.has(REGION)).toBe(false);
    expect(diff.ghosts[REGION]).toBe('removed');
    expect(SceneSchema.safeParse(scene).success).toBe(true);
    const up = parents(scene);
    expect(up.get(REGION)).toBe(PROJECT);
    for (const [id, zone] of held) {
      expect(diff.ghosts[id], id).toBe('removed');
      expect(up.get(id), id).toBe(zone);
    }
    // Nothing else is a ghost, and no chip counts what the ghost holds.
    expect(Object.keys(diff.ghosts).sort()).toEqual([REGION, ...held.keys()].sort());
    expect(diff.inside).toEqual({});
    expect(scene.metadata.rectCount).toBe(input.scene.metadata.rectCount + held.size + 1);
    // It depends on its own state there and on the zones around it, up to the canvas.
    expect(diff.earlier[REGION]).toEqual({
      kind: 'region',
      parent: PROJECT,
      overlay: false,
      collapsed: false,
      empty: false,
    });
    expect(diff.earlier[PROJECT]).toMatchObject({ collapsed: false });
    // The layout places it in its project among the zones and cards still there.
    expectPlacedAmongSiblings(layoutScene(scene), REGION, PROJECT);
  });

  it('is no ghost when its project is a chip: the chip counts what was removed in it', async () => {
    const [before, after] = await regionRemoved();
    const input = pairInput(before, after, { ...view, flips: [flipIdOf(PROJECT)] });
    expect(zoneOf(input.scene, PROJECT)?.collapsed).toBeDefined();
    const assets = [...heldByRegion(pairInput(before, after, view)).keys()].filter(
      (id) => !isVirtualNode(id),
    );

    const { scene, diff } = tickDiff(input);
    expect(diff.ghosts).toEqual({});
    expect(scene).toBe(input.scene);
    expect(diff.inside).toEqual({ [PROJECT]: { added: 0, removed: assets.length, changed: 0 } });
  });
});

describe('a changed asset the drawn day still holds', () => {
  const { project: PARTNER, from: NETWORKING, to: LOGISTICS_PRODUCTION } = DEMO_M_MOVE;
  const view = { snapshot: 'demo:M', lens: 'overview', detail: 'folders' } as const;

  it('is no ghost when it moved into a chip: the chip that holds it counts it, and nothing is drawn twice', async () => {
    const [before, after] = await projectMoved();
    // Two levels of folders open: the day before, Platform / Networking drew the project as a chip; the drawn day,
    // Logistics / Production, a level deeper, is a chip itself, and holds it.
    const input = pairInput(before, after, { ...view, filters: { depth: 2 } });
    const earlier = buildSceneWithReport(before.graph, input.spec, catalog, input.envBefore);
    expect(parents(earlier.scene).get(PARTNER)).toBe(NETWORKING);
    expect(zoneOf(input.scene, NETWORKING)?.collapsed).toBeUndefined();
    expect(parents(input.scene).has(PARTNER)).toBe(false);
    expect(after.graph.containment.parent[PARTNER]).toBe(LOGISTICS_PRODUCTION);
    expect(zoneOf(input.scene, LOGISTICS_PRODUCTION)?.collapsed).toBeDefined();

    const { scene, diff } = tickDiff(input);
    expect([diff.added, diff.removed, diff.changed]).toEqual([[], [], [PARTNER]]);
    // Not a ghost at its old place: the chip's marker is the one place it is drawn.
    expect(diff.ghosts).toEqual({});
    expect(diff.earlier).toEqual({});
    expect(scene).toBe(input.scene);
    expect(diff.inside).toEqual({ [LOGISTICS_PRODUCTION]: { added: 0, removed: 0, changed: 1 } });
  });

  it('is no ghost when it moved where the view draws it, or out of the view', async () => {
    const [before, after] = await projectMoved();
    // Every folder open: the drawn day draws it in its new folder (with the changed dot).
    const drawn = pairInput(before, after, view);
    expect(parents(drawn.scene).get(PARTNER)).toBe(LOGISTICS_PRODUCTION);
    const moved = tickDiff(drawn);
    expect(moved.diff.changed).toEqual([PARTNER]);
    expect(moved.diff.ghosts).toEqual({});
    expect(moved.diff.inside).toEqual({});
    expect(moved.scene).toBe(drawn.scene);
    // Drilled into its old folder: the drawn day's view holds it nowhere, since it lies outside the root now.
    const left = pairInput(before, after, { ...view, root: NETWORKING });
    expect(left.report.root.used).toBe(NETWORKING);
    const earlier = buildSceneWithReport(before.graph, left.spec, catalog, left.envBefore);
    expect(parents(earlier.scene).get(PARTNER)).toBeNull();
    expect(parents(left.scene).has(PARTNER)).toBe(false);
    const gone = tickDiff(left);
    expect(gone.diff.changed).toEqual([PARTNER]);
    expect(gone.diff.ghosts).toEqual({});
    expect(gone.diff.earlier).toEqual({});
    expect(gone.scene).toBe(left.scene);
  });
});

describe('chips', () => {
  it('count what changed inside them that the view would draw were they open', async () => {
    const input = await inputOf('2026-09-07', '2026-09-08', { detail: 'folders' });
    const { diff } = tickDiff(input);
    // The services project holds the new subscription, the data project held the removed bucket; the project's own
    // change is its own (it is drawn, as a chip), and the pod restarts are not drawn by the overview lens.
    expect(diff.inside).toEqual({
      [SERVICES_PROJECT]: { added: 1, removed: 0, changed: 0 },
      [DATA_PROJECT]: { added: 0, removed: 1, changed: 0 },
    });
    expect(diff.ghosts).toEqual({});
  });

  it('that are no asset zone count what changed inside them too: a region zone flipped closed', async () => {
    // Demo S's data project with region zones shown, every zone open but its europe-west3 region: the region holds
    // the lake bucket, changed on 17 September. No Graph holds a region zone: the Graph holds the bucket in the
    // project, which is drawn open around the region's chip.
    const input = await inputOf('2026-09-16', '2026-09-17', regionClosed());
    expect(zoneOf(input.scene, DATA_REGION)?.collapsed).toBeDefined();
    expect(parents(input.scene).get(DATA_REGION)).toBe(DATA_PROJECT);
    expect(zoneOf(input.scene, DATA_PROJECT)?.collapsed).toBeUndefined();
    expect(input.after.graph.containment.parent[LAKE_BUCKET]).toBe(DATA_PROJECT);

    const { diff } = tickDiff(input);
    expect(diff.changed).toContain(LAKE_BUCKET);
    // No ghost (the earlier day drew the region closed too), but the chip that holds it counts it.
    expect(Object.hasOwn(diff.ghosts, LAKE_BUCKET)).toBe(false);
    expect(diff.inside).toEqual({ [DATA_REGION]: { added: 0, removed: 0, changed: 1 } });
  });

  it('that are region zones count what was removed or added inside them, either way, with no ghost of it', async () => {
    // The region held the scratch bucket until 8 September.
    const forwards = tickDiff(await inputOf('2026-09-07', '2026-09-08', regionClosed())).diff;
    expect(forwards.removed).toContain(SCRATCH_BUCKET);
    expect(forwards.ghosts).toEqual({});
    expect(forwards.inside).toEqual({ [DATA_REGION]: { added: 0, removed: 1, changed: 0 } });
    const backwards = tickDiff(await inputOf('2026-09-08', '2026-09-07', regionClosed())).diff;
    expect(backwards.added).toContain(SCRATCH_BUCKET);
    // The one ghost is the subscription, global and so drawn in its project, not in a region.
    expect(backwards.ghosts).toEqual({ [DEBUG_SUBSCRIPTION]: 'removed' });
    expect(backwards.inside).toEqual({ [DATA_REGION]: { added: 1, removed: 0, changed: 0 } });
  });

  it(
    'that are bundles count what changed inside them: what the bundle holds opened (demo L)',
    async () => {
      // Demo L's everything lens at `all` bundles the subnets of the shared production network, both days alike; on
      // 22 September a subnet in the bundle "demo-svc-4 – demo-web-4" changed. No Graph holds a bundle: the Graph
      // holds the subnet in its network, which is drawn open around the bundle's chip.
      const [before, after] = await Promise.all([demoLDay('2026-09-21'), demoLDay('2026-09-22')]);
      const open = { snapshot: 'demo:L', lens: 'everything', detail: 'all' } as const;
      const input = pairInput(before, after, { ...open, flips: [flipIdOf(BUNDLE)] });
      expect(zoneOf(input.scene, BUNDLE)?.collapsed).toBeDefined();
      const network = input.after.graph.containment.parent[BUNDLED_SUBNET];
      expect(network).toBeDefined();
      expect(zoneOf(input.scene, network ?? '')?.collapsed).toBeUndefined();
      // What the bundle holds opened, on each day: the same view without the flip.
      const held = (day: DemoDay): Set<string> => {
        const { scene } = buildSceneWithReport(
          day.graph,
          normalizeViewSpec(open),
          catalog,
          env(day.snapshot),
        );
        const bundle = zoneOf(scene, BUNDLE);
        if (bundle === undefined) throw new Error(`no bundle ${BUNDLE}`);
        return new Set(parents({ ...scene, children: bundle.children }).keys());
      };
      const now = held(after);
      const then = held(before);

      const { diff } = tickDiff(input);
      expect(diff.changed).toContain(BUNDLED_SUBNET);
      const expected = {
        added: diff.added.filter((id) => now.has(id)).length,
        removed: diff.removed.filter((id) => then.has(id)).length,
        changed: diff.changed.filter((id) => now.has(id) || then.has(id)).length,
      };
      expect(expected.changed).toBeGreaterThan(0);
      for (const id of Object.keys(diff.ghosts)) expect(now.has(id) || then.has(id), id).toBe(false);
      expect(diff.inside).toEqual({ [BUNDLE]: expected });
    },
    DEMO_L,
  );

  it('opens every zone of the view, and nothing else of it, to count', () => {
    const spec = normalizeViewSpec({
      snapshot: 'demo:S',
      lens: 'networking',
      detail: 'folders',
      flips: ['a1b2c3'],
      filters: { depth: 2, hideEmptyProjects: true },
    });
    const open = openView(spec);
    expect(open).toMatchObject({ lens: 'networking', detail: 'all', flips: [] });
    expect(open.filters.depth).toBeUndefined();
    expect(open.filters.hideEmptyProjects).toBe(true);
  });
});
