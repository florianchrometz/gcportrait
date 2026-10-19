// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The timeline diff of a drawn day (tickDiff.ts) on demo organisation S's history, worked out as the data
 * worker does: the diff is `diffSnapshots` of the two days, by name and order-independent; what the view drew the
 * day before and no longer draws comes back as ghosts in its old container, with the reason, holding only what is
 * gone (on demo M's two days with its perimeter removed, a project it secured that is still there, inside a chip,
 * comes back with nothing), and the zones the ghosts depend on are listed as that day drew them; a region zone the
 * drawn day no longer draws since everything in it was removed (demo M's two days with a project's us-central1
 * emptied) is a ghost itself in its open project, holding theirs, or the project's chip counts them; one the earlier
 * day drew as a chip comes back as that chip, counting only what of it is gone (demo M's zone us-central1-a or region
 * us-central1 emptied, closed by hand, and on demo L's history a bundle whose members are bundled anew); a changed
 * asset left out in such a zone comes back in its ghost, not drawn now, the zone not drawn now when nothing in it was
 * removed (demo M's two Batch jobs that succeeded); an asset zone unchanged itself that the view no longer draws is
 * not drawn now where it was, holding what was removed in it (demo M's CI runner VM removed, empty projects hidden);
 * what the earlier day drew only inside a chip comes back in the zone it lay in when the drawn day draws that zone
 * open (demo L's VM in a subnet of a bundle bundled anew; demo M's network of a project moved out of its folders, as
 * the drawn day's view draws a zone there), not in a zone the earlier day drew as a chip and the drawn day draws only
 * because it holds nothing now; inside the ghost of an asset an asset comes back as in a container drawn open (demo
 * M's job that succeeded in a project marked for deletion, not drawn now; a project the removed perimeter secured,
 * emptied, with empty projects hidden); the ghost of an asset the earlier day drew as a chip counts only what of it
 * comes back (that project marked for deletion: the job, not what its folder draws now, or nothing when the project
 * alone changed), and so does a zone that is no asset drawn as a chip inside an asset's ghost (that project's region
 * zone closed by hand, all it held removed but a service still there that the view no longer draws); a changed asset
 * the drawn day still holds is a ghost only where the view leaves it out (on demo M's two days with a project moved
 * into another folder, it is none, and the chip that holds it counts it); chips count what changed inside them, also
 * those that are no Graph container (a region zone flipped closed, and on demo L's history a bundle), and what they
 * count is no ghost; nothing changes when the days are alike, and nothing is ghosted when the drill-in root moved.
 */
import { catalog } from '@gcportrait/catalog';
import {
  BUNDLE_ID_PREFIX,
  buildGraph,
  buildSceneWithReport,
  CHIP_COUNT_OF_KIND,
  diffSnapshots,
  flipIdOf,
  isVirtualNode,
} from '@gcportrait/graph';
import { layoutScene, type Layout } from '@gcportrait/layout';
import {
  normalizeViewSpec,
  SceneSchema,
  type ChipCounts,
  type SceneNode,
  type Snapshot,
  type ViewSpecInput,
} from '@gcportrait/model';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DEMO_S } from '../testing/demoData';
import {
  bundledVmRemoved,
  ciRunnerRemoved,
  demoDayGraph,
  demoLDay,
  DEMO_L_RESPLIT,
  DEMO_M_CI_RUNNER,
  DEMO_M_JOBS,
  DEMO_M_MOVE,
  DEMO_M_PARTNER_NETWORK,
  DEMO_M_PERIMETER,
  DEMO_M_REGION,
  jobsSucceeded,
  partnerNetworkRemoved,
  paymentsWebMarked,
  paymentsWebRetired,
  paymentsWebWoundDown,
  perimeterEmptied,
  perimeterRemoved,
  projectMoved,
  regionRemoved,
  sceneEnv as env,
  zoneRemoved,
  type DemoDay,
} from '../testing/demoScenes';
import { parentsOf as parents, sceneZones, zoneOf } from '../testing/scenes';
import { hasChip, openView, tickDiff, type TickDiffInput } from './tickDiff';

// Each test builds two days of a demo organisation, the view's Scenes on both and the diff's own, and a layout: the
// graph and layout packages' work, with their timeout (vitest.config.ts there); up to about 350 ms on demo M and over
// a second on demo L on a quiet machine, many times that when every core runs another test process.
vi.setConfig({ testTimeout: 60_000 });

beforeAll(async () => {
  await import('../pipeline/demo');
});

let removedRegionPair: ReturnType<typeof regionRemoved> | undefined;
let retiredPaymentsPair: ReturnType<typeof paymentsWebRetired> | undefined;
let movedProjectPair: ReturnType<typeof projectMoved> | undefined;

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
/** A bundle of demo L's everything lens at `all` on 26 September that no bundle of 27 September is. */
const RESPLIT_BUNDLE = DEMO_L_RESPLIT.bundle;
/** In that bundle on 26 September; removed on 27 September. */
const RESPLIT_FIREWALL = '//compute.googleapis.com/projects/demo-net-1/global/firewalls/allow-debug-164';

function reversed(snapshot: Snapshot): Snapshot {
  return { ...snapshot, assets: [...snapshot.assets].reverse() };
}

/** What a chip counts of the nodes `nodes` and all they hold, as the scene builder counts what a chip holds. */
function counted(nodes: readonly SceneNode[]): ChipCounts {
  const counts: ChipCounts = {};
  const visit = (list: readonly SceneNode[]): void => {
    for (const node of list) {
      const kind = node.type === 'card' ? 'resources' : CHIP_COUNT_OF_KIND[node.kind];
      if (kind !== undefined) counts[kind] = (counts[kind] ?? 0) + 1;
      if (node.type === 'zone') visit(node.children);
    }
  };
  visit(nodes);
  return counts;
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

  it('is what would come back in a container drawn open: a project the removed perimeter secured, emptied, with empty projects hidden, not drawn now', async () => {
    const [before, after] = await perimeterEmptied();
    // The perimeter focus with every zone open: the earlier day drew the perimeter around its two projects; the drawn
    // day has no perimeter (the view falls back to the organisation) and no longer draws the data project, which is
    // still there, unchanged, emptied by the removals.
    const view = {
      snapshot: 'demo:M',
      detail: 'all',
      focus: { kind: 'perimeter', params: { perimeter: 'data_perimeter' } },
    } as const;
    const input = pairInput(before, after, { ...view, filters: { hideEmptyProjects: true } });
    const earlier = buildSceneWithReport(before.graph, input.spec, catalog, input.envBefore);
    expect(parents(earlier.scene).get(STILL_THERE)).toBe(PERIMETER);
    const held = parents({ ...earlier.scene, children: zoneOf(earlier.scene, STILL_THERE)?.children ?? [] });
    expect(held.size).toBeGreaterThanOrEqual(10);
    expect(parents(input.scene).has(STILL_THERE)).toBe(false);
    expect(Object.hasOwn(after.graph.nodes, STILL_THERE)).toBe(true);

    const { scene, diff } = tickDiff(input);
    expect([...diff.removed, ...diff.changed]).not.toContain(STILL_THERE);
    // Not drawn now, in the perimeter's ghost, holding what was removed in it, each where it stood.
    expect(diff.ghosts).toMatchObject({
      [PERIMETER]: 'removed',
      [SECURED]: 'removed',
      [STILL_THERE]: 'hidden',
    });
    expect(SceneSchema.safeParse(scene).success).toBe(true);
    const up = parents(scene);
    expect(up.get(STILL_THERE)).toBe(PERIMETER);
    for (const [id, zone] of held) {
      expect(diff.ghosts[id], id).toBe('removed');
      expect(up.get(id), id).toBe(zone ?? STILL_THERE);
    }
    expect(diff.earlier[STILL_THERE]).toMatchObject({ kind: 'project', parent: PERIMETER, collapsed: false });
    expect(scene.metadata.rectCount).toBe(input.scene.metadata.rectCount + Object.keys(diff.ghosts).length);
    // With empty projects drawn, the drawn day draws the project, open and empty, in its folder: what was removed
    // in it comes back there, and the project is no ghost.
    const shown = tickDiff(pairInput(before, after, view));
    expect(Object.hasOwn(shown.diff.ghosts, STILL_THERE)).toBe(false);
    for (const [id, zone] of held) {
      expect(shown.diff.ghosts[id], id).toBe('removed');
      expect(parents(shown.scene).get(id), id).toBe(zone ?? STILL_THERE);
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
    const [before, after] = await (removedRegionPair ??= regionRemoved());
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
    const [before, after] = await (removedRegionPair ??= regionRemoved());
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

describe('a zone that is no asset, drawn as a chip, whose contents were removed', () => {
  const { project: PROJECT, region: REGION, zone: ZONE } = DEMO_M_REGION;
  const view = {
    snapshot: 'demo:M',
    lens: 'overview',
    detail: 'all',
    filters: { showRegions: true },
  } as const;

  /** The assets the earlier day's view with every zone open draws inside zone `id`, at any depth. */
  function heldOpen(input: TickDiffInput, id: string): string[] {
    const open = buildSceneWithReport(input.before.graph, openView(input.spec), catalog, input.envBefore);
    const zone = zoneOf(open.scene, id);
    if (zone === undefined) throw new Error(`no zone ${id}`);
    return [...parents({ ...open.scene, children: zone.children }).keys()].filter(
      (held) => !isVirtualNode(held),
    );
  }

  it('is a ghost chip in its open region, as the earlier day drew it, and counted by no chip', async () => {
    const [before, after] = await zoneRemoved();
    // Every zone open but the zone us-central1-a, closed by hand: the earlier day drew it as a chip in the open
    // region; the drawn day draws the region (its regional assets are still there) without it, and has no chip.
    const input = pairInput(before, after, { ...view, flips: [flipIdOf(ZONE)] });
    const earlier = buildSceneWithReport(before.graph, input.spec, catalog, input.envBefore);
    const chip = zoneOf(earlier.scene, ZONE);
    expect(chip?.collapsed).toBeDefined();
    expect(parents(earlier.scene).get(ZONE)).toBe(REGION);
    expect(zoneOf(input.scene, REGION)?.collapsed).toBeUndefined();
    expect(parents(input.scene).has(ZONE)).toBe(false);
    expect(hasChip(input.scene)).toBe(false);
    const held = heldOpen(input, ZONE);
    expect(held.length).toBeGreaterThanOrEqual(5);

    const { scene, diff } = tickDiff(input);
    const removed = new Set(diff.removed);
    for (const id of held) expect(removed.has(id), id).toBe(true);
    // The chip comes back as the earlier day drew it, counting what it held, all of it removed.
    expect(diff.ghosts).toEqual({ [ZONE]: 'removed' });
    expect(SceneSchema.safeParse(scene).success).toBe(true);
    expect(parents(scene).get(ZONE)).toBe(REGION);
    expect(zoneOf(scene, ZONE)).toEqual(chip);
    expect(diff.inside).toEqual({});
    expect(scene.metadata.rectCount).toBe(input.scene.metadata.rectCount + 1);
    expect(diff.earlier[ZONE]).toEqual({
      kind: 'region',
      parent: REGION,
      overlay: false,
      collapsed: true,
      empty: false,
    });
    expect(diff.earlier[REGION]).toMatchObject({ collapsed: false });
    expect(diff.earlier[PROJECT]).toMatchObject({ collapsed: false });
    expectPlacedAmongSiblings(layoutScene(scene), ZONE, REGION);

    // With the region closed too, the region's chip counts what was removed in it, and nothing is a ghost.
    const closed = pairInput(before, after, { ...view, flips: [flipIdOf(ZONE), flipIdOf(REGION)] });
    const counted = tickDiff(closed);
    expect(counted.diff.ghosts).toEqual({});
    expect(counted.scene).toBe(closed.scene);
    expect(counted.diff.inside).toEqual({ [REGION]: { added: 0, removed: held.length, changed: 0 } });
  });

  it('is a ghost chip in its open project when it is a region zone that is gone', async () => {
    const [before, after] = await (removedRegionPair ??= regionRemoved());
    const input = pairInput(before, after, { ...view, flips: [flipIdOf(REGION)] });
    const earlier = buildSceneWithReport(before.graph, input.spec, catalog, input.envBefore);
    const chip = zoneOf(earlier.scene, REGION);
    expect(chip?.collapsed).toBeDefined();
    expect(parents(input.scene).has(REGION)).toBe(false);
    expect(hasChip(input.scene)).toBe(false);

    const { scene, diff } = tickDiff(input);
    expect(diff.ghosts).toEqual({ [REGION]: 'removed' });
    expect(parents(scene).get(REGION)).toBe(PROJECT);
    expect(zoneOf(scene, REGION)).toEqual(chip);
    expect(diff.inside).toEqual({});
    expect(diff.earlier[REGION]).toMatchObject({ parent: PROJECT, collapsed: true });
  });

  it('counts only what is gone of what it held: a bundle of demo L whose members are bundled anew', async () => {
    // Demo L's everything lens at `all`, the bundle "demo-web-7 – allow-grpc-to-demo-web-2" of the shared
    // production network closed by hand. On 27 September a firewall rule in it is removed, the network's members
    // are bundled anew, and no bundle has that id any more; the other members are drawn in the new bundles.
    const [before, after] = await Promise.all([demoLDay('2026-09-26'), demoLDay('2026-09-27')]);
    const open = { snapshot: 'demo:L', lens: 'everything', detail: 'all' } as const;
    const input = pairInput(before, after, { ...open, flips: [flipIdOf(RESPLIT_BUNDLE)] });
    const earlier = buildSceneWithReport(before.graph, input.spec, catalog, input.envBefore);
    const chip = zoneOf(earlier.scene, RESPLIT_BUNDLE);
    expect(chip?.collapsed).toMatchObject({ subnets: expect.any(Number) as number });
    const network = parents(earlier.scene).get(RESPLIT_BUNDLE) ?? '';
    expect(zoneOf(input.scene, network)?.collapsed).toBeUndefined();
    expect(parents(input.scene).has(RESPLIT_BUNDLE)).toBe(false);
    const members = heldOpen(input, RESPLIT_BUNDLE);
    expect(members.length).toBeGreaterThan(10);

    const { scene, diff } = tickDiff(input);
    const removed = members.filter((id) => diff.removed.includes(id));
    expect(removed).toEqual([RESPLIT_FIREWALL]);
    // The members still there are drawn where the drawn day has them, and none is a ghost.
    const drawn = parents(scene);
    for (const id of members) {
      if (id !== RESPLIT_FIREWALL) expect(drawn.has(id) && !Object.hasOwn(diff.ghosts, id), id).toBe(true);
    }
    // The chip comes back as it was, counting only what was removed in it.
    expect(diff.ghosts[RESPLIT_BUNDLE]).toBe('removed');
    expect(drawn.get(RESPLIT_BUNDLE)).toBe(network);
    expect(zoneOf(scene, RESPLIT_BUNDLE)).toEqual({ ...chip, collapsed: { resources: 1 } });
    expect(Object.hasOwn(diff.inside, RESPLIT_BUNDLE)).toBe(false);
    expect(diff.earlier[RESPLIT_BUNDLE]).toMatchObject({ kind: 'group', parent: network, collapsed: true });
  });
});

describe('what the earlier day drew only inside a chip, with the zone it lay in', () => {
  const { bundle: GONE_BUNDLE, subnet: SUBNET, vm: VM } = DEMO_L_RESPLIT;
  const { project: PARTNER, from: NETWORKING } = DEMO_M_MOVE;
  const NETWORK = DEMO_M_PARTNER_NETWORK;

  it('comes back in that zone when the drawn day draws it open: a VM in a subnet of a demo L bundle bundled anew', async () => {
    // Demo L's everything lens at `all`, the bundle "demo-web-7 – allow-grpc-to-demo-web-2" closed by hand: the
    // earlier day drew it as a chip, holding the subnet dmz-europe-west3 and its one VM. On 27 September the
    // network's members are bundled anew, no bundle has that id any more, the subnet is drawn open in a new
    // bundle, and the VM is removed.
    const [before, after] = await bundledVmRemoved();
    const open = { snapshot: 'demo:L', lens: 'everything', detail: 'all' } as const;
    const input = pairInput(before, after, { ...open, flips: [flipIdOf(GONE_BUNDLE)] });
    const earlier = buildSceneWithReport(before.graph, input.spec, catalog, input.envBefore);
    expect(zoneOf(earlier.scene, GONE_BUNDLE)?.collapsed).toBeDefined();
    for (const id of [SUBNET, VM]) expect(parents(earlier.scene).has(id), id).toBe(false);
    const bundle = parents(input.scene).get(SUBNET) ?? '';
    expect(bundle.startsWith(BUNDLE_ID_PREFIX) && bundle !== GONE_BUNDLE, bundle).toBe(true);
    expect(zoneOf(input.scene, bundle)?.collapsed).toBeUndefined();
    expect(zoneOf(input.scene, SUBNET)).toMatchObject({ children: [] });
    expect(zoneOf(input.scene, SUBNET)?.collapsed).toBeUndefined();

    const { scene, diff } = tickDiff(input);
    expect(diff.removed).toContain(VM);
    // A ghost in the subnet, where the earlier day's view with every zone open has it, and counted by no chip.
    expect(diff.ghosts[VM]).toBe('removed');
    expect(SceneSchema.safeParse(scene).success).toBe(true);
    expect(parents(scene).get(VM)).toBe(SUBNET);
    expect(diff.inside).toEqual({});
    // The bundle's ghost chip still counts only the firewall rule removed in it.
    expect(zoneOf(scene, GONE_BUNDLE)?.collapsed).toEqual({ resources: 1 });
    // It depends on the zones around it as the drawn day draws them.
    expect(diff.earlier[SUBNET]).toEqual({
      kind: 'subnet',
      parent: bundle,
      overlay: false,
      collapsed: false,
      empty: true,
    });
    expect(diff.earlier[bundle]).toMatchObject({ kind: 'group', collapsed: false, empty: false });
    expectPlacedAmongSiblings(layoutScene(scene), VM, SUBNET);
    // With the bundle open, the earlier day drew the VM in the subnet: the same ghost, in the same place.
    const plain = tickDiff(pairInput(before, after, open));
    expect(plain.diff.ghosts[VM]).toBe('removed');
    expect(parents(plain.scene).get(VM)).toBe(SUBNET);
  });

  it('comes back with its zones as the drawn day’s view draws a zone there: demo M’s network of a project moved out of its folders', async () => {
    // The networking lens with every zone open but those deeper than one asset zone: the earlier day drew Platform
    // open and Platform / Networking as a chip, holding partner exchange and its network; the drawn day draws the
    // project open at the top level, where it lies now, without the network, removed with all it held.
    const [before, after] = await partnerNetworkRemoved();
    const view = { snapshot: 'demo:M', lens: 'networking', detail: 'all', filters: { depth: 1 } } as const;
    const input = pairInput(before, after, view);
    const earlier = buildSceneWithReport(before.graph, input.spec, catalog, input.envBefore);
    expect(zoneOf(earlier.scene, NETWORKING)?.collapsed).toBeDefined();
    for (const id of [PARTNER, NETWORK]) expect(parents(earlier.scene).has(id), id).toBe(false);
    expect(parents(input.scene).get(PARTNER)).toBeNull();
    expect(zoneOf(input.scene, PARTNER)?.collapsed).toBeUndefined();
    const opened = buildSceneWithReport(before.graph, openView(input.spec), catalog, input.envBefore);
    expect(parents(opened.scene).get(NETWORK)).toBe(PARTNER);

    const { scene, diff } = tickDiff(input);
    // Two asset zones deep, past the depth filter: a chip, as the view draws a network there, counting what was
    // removed in it (a subnet, its forwarding rule, a firewall rule and a route).
    expect(diff.ghosts).toEqual({ [NETWORK]: 'removed' });
    expect(SceneSchema.safeParse(scene).success).toBe(true);
    expect(parents(scene).get(NETWORK)).toBe(PARTNER);
    expect(zoneOf(scene, NETWORK)).toMatchObject({ collapsed: { subnets: 1, resources: 3 }, children: [] });
    expect(diff.inside).toEqual({});
    expect(diff.earlier[NETWORK]).toEqual({
      kind: 'vpc',
      parent: PARTNER,
      overlay: false,
      collapsed: true,
      empty: false,
    });
    expect(diff.earlier[PARTNER]).toMatchObject({ kind: 'project', parent: null, collapsed: false });
    expectPlacedAmongSiblings(layoutScene(scene), NETWORK, PARTNER);

    // Opened by hand, it comes back open, holding the ghosts of what it held, each zone as the view draws it there:
    // the subnet, three asset zones deep, a chip.
    const flipped = tickDiff(pairInput(before, after, { ...view, flips: [flipIdOf(NETWORK)] }));
    const network = zoneOf(flipped.scene, NETWORK);
    expect(network?.collapsed).toBeUndefined();
    const subnets = sceneZones(network?.children ?? []).filter((zone) => zone.kind === 'subnet');
    expect(subnets).toHaveLength(1);
    expect(subnets[0]?.collapsed).toEqual({ resources: 1 });
    for (const child of network?.children ?? [])
      expect(flipped.diff.ghosts[child.id], child.id).toBe('removed');
    expect(flipped.diff.earlier[NETWORK]).toMatchObject({ collapsed: false, empty: false });
  });

  it('does not come back in a zone the earlier day drew as a chip that the drawn day draws only as it holds nothing now', async () => {
    // Demo S's everything lens at the folder level, which draws projects as chips: on 17 September the reports
    // project, marked for deletion (this lens draws what is hidden too), holds nothing, so it is drawn open.
    const input = await inputOf('2026-09-16', '2026-09-17', { lens: 'everything', detail: 'folders' });
    const earlier = buildSceneWithReport(input.before.graph, input.spec, catalog, input.envBefore);
    expect(zoneOf(earlier.scene, REPORTS_PROJECT)?.collapsed).toBeDefined();
    expect(zoneOf(input.scene, REPORTS_PROJECT)).toMatchObject({ children: [] });
    expect(zoneOf(input.scene, REPORTS_PROJECT)?.collapsed).toBeUndefined();

    const { scene, diff } = tickDiff(input);
    expect(diff.removed).toContain(REPORTS_VM);
    // What it held showed as that chip: the drawn day draws it as it is, empty.
    expect(zoneOf(scene, REPORTS_PROJECT)?.children).toEqual([]);
    expect(Object.hasOwn(diff.ghosts, REPORTS_VM)).toBe(false);
  });
});

describe('a changed asset left out in a zone that is no asset, which is gone', () => {
  const { project: PROJECT, region: REGION } = DEMO_M_REGION;
  const { inRegion: IN_REGION, alone: ALONE, aloneRegion: ALONE_REGION } = DEMO_M_JOBS;
  const view = {
    snapshot: 'demo:M',
    lens: 'overview',
    detail: 'all',
    filters: { showRegions: true },
  } as const;

  it('comes back as not drawn now in the zone’s ghost, which is not drawn now when nothing in it was removed', async () => {
    const [before, after] = await jobsSucceeded();
    const input = pairInput(before, after, view);
    // The earlier day drew each running job in its region zone, open in the project; the drawn day draws the project
    // open with neither region zone: the jobs that succeeded are not drawn, and the rest of us-central1 is removed.
    const earlier = buildSceneWithReport(before.graph, input.spec, catalog, input.envBefore);
    const up = parents(earlier.scene);
    expect(up.get(ALONE)).toBe(ALONE_REGION);
    expect(up.get(ALONE_REGION)).toBe(PROJECT);
    expect(zoneOf(earlier.scene, ALONE_REGION)?.children.map((child) => child.id)).toEqual([ALONE]);
    expect(up.get(IN_REGION)).toBe(REGION);
    expect(zoneOf(input.scene, PROJECT)?.collapsed).toBeUndefined();
    for (const id of [ALONE, ALONE_REGION, IN_REGION, REGION]) {
      expect(parents(input.scene).has(id), id).toBe(false);
    }
    // Neither job moved: the drawn day's Graph holds each in the project, as the day before.
    for (const id of [ALONE, IN_REGION]) {
      expect(after.graph.containment.parent[id], id).toBe(PROJECT);
      expect(before.graph.containment.parent[id], id).toBe(PROJECT);
    }

    const { scene, diff } = tickDiff(input);
    expect(diff.changed).toEqual([IN_REGION, ALONE].sort());
    expect(SceneSchema.safeParse(scene).success).toBe(true);
    const ghostUp = parents(scene);
    // The region zone that held only the job that succeeded is not drawn now, holding the job, not drawn now.
    expect(diff.ghosts[ALONE_REGION]).toBe('hidden');
    expect(diff.ghosts[ALONE]).toBe('hidden');
    expect(ghostUp.get(ALONE_REGION)).toBe(PROJECT);
    expect(zoneOf(scene, ALONE_REGION)?.children.map((child) => child.id)).toEqual([ALONE]);
    // The region zone that held removed assets too is removed, holding each with its own reason.
    expect(diff.ghosts[REGION]).toBe('removed');
    expect(diff.ghosts[IN_REGION]).toBe('hidden');
    expect(ghostUp.get(REGION)).toBe(PROJECT);
    expect(ghostUp.get(IN_REGION)).toBe(REGION);
    const removed = new Set(diff.removed);
    const held = parents({ ...earlier.scene, children: zoneOf(earlier.scene, REGION)?.children ?? [] });
    expect(held.size).toBeGreaterThanOrEqual(10);
    for (const id of held.keys()) {
      if (id === IN_REGION) continue;
      expect(diff.ghosts[id], id).toBe('removed');
      expect(removed.has(id) || isVirtualNode(id), id).toBe(true);
    }
    // Nothing else is a ghost, no chip counts either job, and both region zones depend on the earlier day.
    expect(Object.keys(diff.ghosts).sort()).toEqual([ALONE_REGION, ALONE, REGION, ...held.keys()].sort());
    expect(diff.inside).toEqual({});
    expect(scene.metadata.rectCount).toBe(input.scene.metadata.rectCount + Object.keys(diff.ghosts).length);
    expect(diff.earlier[ALONE_REGION]).toEqual({
      kind: 'region',
      parent: PROJECT,
      overlay: false,
      collapsed: false,
      empty: false,
    });
    expect(diff.earlier[REGION]).toMatchObject({ parent: PROJECT, collapsed: false });
    expectPlacedAmongSiblings(layoutScene(scene), ALONE_REGION, PROJECT);
  });
});

describe('an asset zone the drawn day no longer draws, itself unchanged', () => {
  const { vm: VM, disk: DISK, project: PROJECT, folder: FOLDER, platform: PLATFORM } = DEMO_M_CI_RUNNER;
  const view = { snapshot: 'demo:M', lens: 'compute', detail: 'all' } as const;

  it('is not drawn now where the earlier day drew it, holding what was removed in it', async () => {
    const [before, after] = await ciRunnerRemoved();
    // Empty projects hidden: the earlier day drew the project with its VM and disk in its folder; the drawn day
    // draws the folder open, now without the project, which holds nothing the compute lens draws.
    const input = pairInput(before, after, { ...view, filters: { hideEmptyProjects: true } });
    const earlier = buildSceneWithReport(before.graph, input.spec, catalog, input.envBefore);
    expect(parents(earlier.scene).get(PROJECT)).toBe(FOLDER);
    expect(
      zoneOf(earlier.scene, PROJECT)
        ?.children.map((child) => child.id)
        .sort(),
    ).toEqual([DISK, VM]);
    expect(zoneOf(input.scene, FOLDER)?.collapsed).toBeUndefined();
    expect(parents(input.scene).has(PROJECT)).toBe(false);
    const sibling = zoneOf(earlier.scene, FOLDER)?.children.map((child) => child.id) ?? [];
    expect(sibling).toEqual([PROJECT]);

    const { scene, diff } = tickDiff(input);
    expect([diff.added, diff.removed, diff.changed]).toEqual([[], [DISK, VM].sort(), []]);
    // The project did not change: it is not drawn now, and holds what was removed in it, where it was removed.
    expect(diff.ghosts).toEqual({ [PROJECT]: 'hidden', [VM]: 'removed', [DISK]: 'removed' });
    expect(SceneSchema.safeParse(scene).success).toBe(true);
    const up = parents(scene);
    expect(up.get(PROJECT)).toBe(FOLDER);
    expect(up.get(VM)).toBe(PROJECT);
    expect(up.get(DISK)).toBe(PROJECT);
    expect(diff.inside).toEqual({});
    expect(scene.metadata.rectCount).toBe(input.scene.metadata.rectCount + 3);
    expect(diff.earlier[PROJECT]).toEqual({
      kind: 'project',
      parent: FOLDER,
      overlay: false,
      collapsed: false,
      empty: false,
    });
    expectPlacedAmongSiblings(layoutScene(scene), PROJECT, FOLDER);

    // Empty folders hidden too: the folder is gone as well, and comes back in its own around the project.
    const folders = pairInput(before, after, {
      ...view,
      filters: { hideEmptyProjects: true, hideEmptyFolders: true },
    });
    expect(parents(folders.scene).has(FOLDER)).toBe(false);
    expect(zoneOf(folders.scene, PLATFORM)?.collapsed).toBeUndefined();
    const nested = tickDiff(folders);
    expect(nested.diff.ghosts).toEqual({
      [FOLDER]: 'hidden',
      [PROJECT]: 'hidden',
      [VM]: 'removed',
      [DISK]: 'removed',
    });
    expect(parents(nested.scene).get(FOLDER)).toBe(PLATFORM);
    expect(parents(nested.scene).get(PROJECT)).toBe(FOLDER);
    // Empty projects drawn: the drawn day draws the project, open and empty, and the VM and the disk are its ghosts.
    const shown = tickDiff(pairInput(before, after, view));
    expect(shown.diff.ghosts).toEqual({ [VM]: 'removed', [DISK]: 'removed' });
  });
});

describe('a changed asset inside the ghost of a changed asset', () => {
  const { project: PROJECT } = DEMO_M_REGION;
  const { alone: JOB, aloneRegion: JOB_REGION } = DEMO_M_JOBS;
  const view = { snapshot: 'demo:M', lens: 'overview', detail: 'all' } as const;

  it('comes back not drawn now where it stood, as in a container drawn open: a job that succeeded in a project marked for deletion', async () => {
    const [before, after] = await (retiredPaymentsPair ??= paymentsWebRetired());
    // The earlier day drew the running job in the project; the drawn day draws neither: a project being deleted is
    // hidden (what else it holds is drawn in its folder), and a finished job starts hidden.
    const input = pairInput(before, after, view);
    const earlier = buildSceneWithReport(before.graph, input.spec, catalog, input.envBefore);
    const folder = parents(earlier.scene).get(PROJECT) ?? '';
    expect(parents(earlier.scene).get(JOB)).toBe(PROJECT);
    for (const id of [PROJECT, JOB]) expect(parents(input.scene).has(id), id).toBe(false);
    expect(after.graph.containment.parent[JOB]).toBe(PROJECT);
    const others = (zoneOf(earlier.scene, PROJECT)?.children ?? []).filter((child) => child.id !== JOB);
    expect(others.length).toBeGreaterThan(0);
    for (const child of others) expect(parents(input.scene).get(child.id), child.id).toBe(folder);

    const { scene, diff } = tickDiff(input);
    expect([diff.added, diff.removed, diff.changed]).toEqual([[], [], [JOB, PROJECT].sort()]);
    // The project's ghost holds the job's: the change shows where it happened. What else it held is drawn in the
    // folder, and is no ghost.
    expect(diff.ghosts).toEqual({ [PROJECT]: 'hidden', [JOB]: 'hidden' });
    expect(SceneSchema.safeParse(scene).success).toBe(true);
    expect(parents(scene).get(PROJECT)).toBe(folder);
    expect(zoneOf(scene, PROJECT)?.children.map((child) => child.id)).toEqual([JOB]);
    expect(diff.inside).toEqual({});
    expect(scene.metadata.rectCount).toBe(input.scene.metadata.rectCount + 2);
    expectPlacedAmongSiblings(layoutScene(scene), PROJECT, folder);

    // With region zones shown, the job's region zone comes back around it, with the reason of the ghost around it.
    const regions = tickDiff(pairInput(before, after, { ...view, filters: { showRegions: true } }));
    expect(regions.diff.ghosts).toEqual({ [PROJECT]: 'hidden', [JOB_REGION]: 'hidden', [JOB]: 'hidden' });
    expect(parents(regions.scene).get(JOB_REGION)).toBe(PROJECT);
    expect(parents(regions.scene).get(JOB)).toBe(JOB_REGION);
  });
});

describe('the ghost of an asset the earlier day drew as a chip', () => {
  const { project: PROJECT } = DEMO_M_REGION;
  const { alone: JOB } = DEMO_M_JOBS;
  const overview = { snapshot: 'demo:M', lens: 'overview' } as const;
  // The views in which the earlier day drew the project as a chip: `auto` (the folder level, at the default budget),
  // the folder level (with region zones too), closed by hand at the project level and at `all`, and past the depth
  // filter.
  const chipViews: readonly Partial<ViewSpecInput>[] = [
    { detail: 'auto' },
    { detail: 'folders' },
    { detail: 'folders', filters: { showRegions: true } },
    { detail: 'projects', flips: [flipIdOf(PROJECT)] },
    { detail: 'all', flips: [flipIdOf(PROJECT)] },
    { detail: 'all', filters: { depth: 3 } },
  ];

  /** The project's chip on the earlier day, at the level the drawn Scene uses, and the zone it lay in. */
  function earlierChip(input: TickDiffInput): { chip: SceneNode | undefined; folder: string } {
    const spec = normalizeViewSpec({ ...input.spec, detail: input.report.detail.used });
    const { scene } = buildSceneWithReport(input.before.graph, spec, catalog, input.envBefore);
    return { chip: zoneOf(scene, PROJECT), folder: parents(scene).get(PROJECT) ?? '' };
  }

  it('counts only what of it comes back, not what is drawn elsewhere now: a project marked for deletion counts the Batch job that succeeded in it', async () => {
    const [before, after] = await (retiredPaymentsPair ??= paymentsWebRetired());
    // Every zone open (the earlier day's view with every zone open), the project's ghost holds what of it comes back:
    // the job's, not drawn now.
    const open = tickDiff(pairInput(before, after, { ...overview, detail: 'all' }));
    const ghost = zoneOf(open.scene, PROJECT);
    expect(ghost?.children.map((child) => child.id)).toEqual([JOB]);
    const expected = counted(ghost?.children ?? []);
    expect(expected).toEqual({ resources: 1 });
    // What else the earlier day held in it is drawn in its folder at the folder level.
    const atAuto = pairInput(before, after, { ...overview, detail: 'auto' });
    expect(atAuto.report.detail.used).toBe('folders');
    const opened = buildSceneWithReport(before.graph, openView(atAuto.spec), catalog, atAuto.envBefore);
    const others = (zoneOf(opened.scene, PROJECT)?.children ?? []).filter((child) => child.id !== JOB);
    expect(others.length).toBeGreaterThan(10);
    const { folder } = earlierChip(atAuto);
    for (const child of others) expect(parents(atAuto.scene).get(child.id), child.id).toBe(folder);

    for (const view of chipViews) {
      const what = JSON.stringify(view);
      const input = pairInput(before, after, { ...overview, ...view });
      const { chip } = earlierChip(input);
      // The scene builder counted all it held, the job and what the folder draws now.
      expect(chip, what).toMatchObject({ collapsed: { containers: 2, resources: 21 }, children: [] });

      const { scene, diff } = tickDiff(input);
      expect(diff.ghosts, what).toEqual({ [PROJECT]: 'hidden' });
      expect(SceneSchema.safeParse(scene).success, what).toBe(true);
      // The chip as the earlier day drew it, counting only what comes back of what it held.
      expect(parents(scene).get(PROJECT), what).toBe(folder);
      expect(zoneOf(scene, PROJECT), what).toEqual({ ...chip, collapsed: expected });
      expect(diff.inside, what).toEqual({});
      expect(diff.earlier[PROJECT], what).toEqual({
        kind: 'project',
        parent: folder,
        overlay: false,
        collapsed: true,
        empty: false,
      });
      expect(scene.metadata.rectCount, what).toBe(input.scene.metadata.rectCount + 1);
      expectPlacedAmongSiblings(layoutScene(scene), PROJECT, folder);
    }
  });

  it('counts nothing when nothing of it comes back: the project marked for deletion alone is still not drawn now', async () => {
    const [before, after] = await paymentsWebMarked();
    // Every zone open, the project is not drawn now where it stood, holding nothing: what it held is drawn in its
    // folder, and nothing in it changed.
    const open = tickDiff(pairInput(before, after, { ...overview, detail: 'all' }));
    expect([open.diff.added, open.diff.removed, open.diff.changed]).toEqual([[], [], [PROJECT]]);
    expect(open.diff.ghosts).toEqual({ [PROJECT]: 'hidden' });
    expect(zoneOf(open.scene, PROJECT)?.children).toEqual([]);

    for (const view of chipViews) {
      const what = JSON.stringify(view);
      const input = pairInput(before, after, { ...overview, ...view });
      const { chip, folder } = earlierChip(input);
      expect(chip, what).toMatchObject({ collapsed: { containers: 2, resources: 20 }, children: [] });

      const { scene, diff } = tickDiff(input);
      // Still a ghost, as the chip it was, counting nothing.
      expect(diff.ghosts, what).toEqual({ [PROJECT]: 'hidden' });
      expect(SceneSchema.safeParse(scene).success, what).toBe(true);
      expect(parents(scene).get(PROJECT), what).toBe(folder);
      expect(zoneOf(scene, PROJECT), what).toEqual({ ...chip, collapsed: {} });
      expect(diff.inside, what).toEqual({});
      expect(diff.earlier[PROJECT], what).toMatchObject({ parent: folder, collapsed: true });
      expectPlacedAmongSiblings(layoutScene(scene), PROJECT, folder);
    }
  });
});

describe('a zone that is no asset, drawn as a chip, inside the ghost of an asset', () => {
  const { project: PROJECT, region: REGION, zone: ZONE, service: SERVICE } = DEMO_M_REGION;
  // The overview with region zones shown and every zone open, cards without a drawn line hidden.
  const view = {
    snapshot: 'demo:M',
    lens: 'overview',
    detail: 'all',
    filters: { showRegions: true, hideDisconnected: true },
  } as const;

  it('counts only what of it comes back, not what is still there: a region zone closed by hand in a project marked for deletion', async () => {
    const [before, after] = await paymentsWebWoundDown();
    // The region zone us-central1 closed by hand: the earlier day drew it as a chip in the open project, the scene
    // builder counting all it held, the Cloud Run service included. The drawn day draws neither: a project being
    // deleted is hidden, what it held in the region is removed, and the service, still there, has no line any more.
    const input = pairInput(before, after, { ...view, flips: [flipIdOf(REGION)] });
    const earlier = buildSceneWithReport(before.graph, input.spec, catalog, input.envBefore);
    const chip = zoneOf(earlier.scene, REGION);
    expect(chip).toMatchObject({ collapsed: { containers: 2, resources: 11 }, children: [] });
    expect(parents(earlier.scene).get(REGION)).toBe(PROJECT);
    const folder = parents(earlier.scene).get(PROJECT) ?? '';
    expect(zoneOf(input.scene, folder)?.collapsed).toBeUndefined();
    for (const id of [PROJECT, REGION, SERVICE]) expect(parents(input.scene).has(id), id).toBe(false);
    expect(after.graph.containment.parent[SERVICE]).toBe(PROJECT);

    // Every zone open, the region's ghost in the project's holds what was removed in it, and the service is none.
    const open = tickDiff(pairInput(before, after, view));
    expect(parents(open.scene).get(REGION)).toBe(PROJECT);
    expect(open.diff.ghosts[REGION]).toBe('hidden');
    expect(Object.hasOwn(open.diff.ghosts, SERVICE)).toBe(false);
    const expected = counted(zoneOf(open.scene, REGION)?.children ?? []);
    expect(expected).toEqual({ containers: 2, resources: 10 });

    const { scene, diff } = tickDiff(input);
    expect(diff.changed).toEqual([PROJECT]);
    expect(diff.removed).not.toContain(SERVICE);
    // The project's ghost holds the region's chip as the earlier day drew it, counting what that ghost holds open.
    expect(diff.ghosts).toEqual({ [PROJECT]: 'hidden', [REGION]: 'hidden' });
    expect(SceneSchema.safeParse(scene).success).toBe(true);
    expect(parents(scene).get(PROJECT)).toBe(folder);
    expect(zoneOf(scene, PROJECT)?.children.map((child) => child.id)).toEqual([REGION]);
    expect(zoneOf(scene, REGION)).toEqual({ ...chip, collapsed: expected });
    expect(diff.inside).toEqual({});
    expect(diff.earlier[REGION]).toEqual({
      kind: 'region',
      parent: PROJECT,
      overlay: false,
      collapsed: true,
      empty: false,
    });
    expect(scene.metadata.rectCount).toBe(input.scene.metadata.rectCount + 2);
    expectPlacedAmongSiblings(layoutScene(scene), REGION, PROJECT);

    // Closed a level deeper, the zone us-central1-a's chip in the region's ghost counts what was removed in it.
    const deeper = tickDiff(pairInput(before, after, { ...view, flips: [flipIdOf(ZONE)] }));
    expect(parents(deeper.scene).get(ZONE)).toBe(REGION);
    expect(zoneOf(deeper.scene, ZONE)?.collapsed).toEqual(counted(zoneOf(open.scene, ZONE)?.children ?? []));
    // With every card drawn, the drawn day draws the region's chip in the folder, holding the service: no ghost,
    // and the chip counts what was removed in it.
    const lines = pairInput(before, after, {
      ...view,
      filters: { showRegions: true },
      flips: [flipIdOf(REGION)],
    });
    expect(parents(lines.scene).get(REGION)).toBe(folder);
    const drawn = tickDiff(lines).diff;
    expect(drawn.ghosts).toEqual({ [PROJECT]: 'hidden' });
    const removed = Object.values(open.diff.ghosts).filter((reason) => reason === 'removed');
    expect(drawn.inside).toEqual({ [REGION]: { added: 0, removed: removed.length, changed: 0 } });
  });
});

describe('a changed asset the drawn day still holds', () => {
  const { project: PARTNER, from: NETWORKING, to: LOGISTICS_PRODUCTION } = DEMO_M_MOVE;
  const view = { snapshot: 'demo:M', lens: 'overview', detail: 'folders' } as const;

  it('is no ghost when it moved into a chip: the chip that holds it counts it, and nothing is drawn twice', async () => {
    const [before, after] = await (movedProjectPair ??= projectMoved());
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
    const [before, after] = await (movedProjectPair ??= projectMoved());
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

  it('that are bundles count what changed inside them: what the bundle holds opened (demo L)', async () => {
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
      const { scene } = buildSceneWithReport(day.graph, normalizeViewSpec(open), catalog, env(day.snapshot));
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
  });

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
