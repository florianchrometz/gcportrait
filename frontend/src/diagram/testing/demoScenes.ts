// SPDX-License-Identifier: Apache-2.0
/**
 * Demo diagrams for the tests, built the way the app builds them: the data worker's demo loader (demo-data →
 * CAI NDJSON → ingest), the graph and Scene builders with the compiled catalog at the default 1280×800 rect
 * budget, and the layout. Synchronous parts are cached per organisation; nothing here touches a DOM. A day of an
 * organisation's history is read as the data worker reads it (timeline/worker/replay.ts), and a day compared with
 * another one gets its diff and ghosts as the data worker gives them (diff/tickDiff.ts), also for the two-day pairs
 * the history does not have (demo M's perimeter removed between two days, `perimeterRemoved`, or with all the other
 * project it secures holds, `perimeterEmptied`, a project moved into another folder, `projectMoved`, or out of its
 * folders with its network removed, `partnerNetworkRemoved`, everything a project holds in one region removed,
 * `regionRemoved`, or in one zone, `zoneRemoved`, two Batch jobs that succeeded, one where the rest of its region was
 * removed, `jobsSucceeded`, one as its project is marked for deletion, `paymentsWebRetired`, that project marked for
 * deletion alone, `paymentsWebMarked`, or with all it holds in us-central1 removed but a service,
 * `paymentsWebWoundDown`, or a project's only VM removed, `ciRunnerRemoved`; demo L's VM in a subnet of a bundle that
 * is bundled anew removed, `bundledVmRemoved`).
 * For the tests that only need the scene builder: the builder's environment for a snapshot (`sceneEnv`), and a demo
 * Graph built synchronously straight from the generator (`demoGraphSync`). Demo data without a Scene is in
 * demoData.ts.
 */
import { catalog } from '@gcportrait/catalog';
import { generateOrganization, toSnapshot } from '@gcportrait/demo-data';
import {
  BUNDLE_ID_PREFIX,
  buildGraph,
  buildSceneWithReport,
  DEFAULT_VIEWPORT_BUDGET,
} from '@gcportrait/graph';
import { layoutScene, type Layout } from '@gcportrait/layout';
import {
  normalizeViewSpec,
  type Asset,
  type DemoSize,
  type DetailLevel,
  type Graph,
  type LensId,
  type SceneEnv,
  type SceneReport,
  type Snapshot,
  type ViewSpec,
} from '@gcportrait/model';

import { historySnapshot } from '../../timeline/worker/replay';
import { tickDiff, type DiffDayData } from '../diff/tickDiff';
import type { TickDiff } from '../diff/types';
import { diagramIcons } from '../iconTable';
import type { DiagramInput } from '../model';
import {
  consoleLinks,
  consoleSource,
  loadDemoSnapshot,
  zoneTypeNames,
  type ConsoleSource,
} from '../pipeline/dataHandler';
import { demoHistory } from '../pipeline/demo';

interface DemoGraph {
  readonly snapshot: Snapshot;
  readonly graph: Graph;
  readonly console: ConsoleSource;
}

/** The scene builder's environment for a snapshot, as the data worker passes it (default: the 1280×800 budget). */
export function sceneEnv(snapshot: Snapshot, budget: number = DEFAULT_VIEWPORT_BUDGET): SceneEnv {
  return {
    readTime: snapshot.readTime,
    rootLabel: snapshot.scope.displayName ?? snapshot.scope.id,
    viewportBudget: budget,
  };
}

const plainGraphs = new Map<DemoSize, Graph>();

/**
 * The Graph of demo organisation `size` built straight from the generator (`toSnapshot`, no ingest), synchronously and
 * once per test file: for the tests that only need the scene builder's output, not the data worker's snapshot.
 */
export function demoGraphSync(size: DemoSize): Graph {
  let graph = plainGraphs.get(size);
  if (graph === undefined) {
    graph = buildGraph(toSnapshot(generateOrganization({ size })), catalog);
    plainGraphs.set(size, graph);
  }
  return graph;
}

const graphs = new Map<DemoSize, Promise<DemoGraph>>();

export function demoGraph(size: DemoSize): Promise<DemoGraph> {
  let entry = graphs.get(size);
  if (entry === undefined) {
    entry = loadDemoSnapshot(`demo:${size}`, () => undefined).then((snapshot) => ({
      snapshot,
      graph: buildGraph(snapshot, catalog),
      console: consoleSource(snapshot),
    }));
    graphs.set(size, entry);
  }
  return entry;
}

export interface DemoDiagram {
  readonly input: DiagramInput;
  readonly report: SceneReport;
  readonly layout: Layout;
}

/** The laid-out Scene of a demo organisation for a lens and detail level, as the app would draw it. */
export async function demoDiagram(
  size: DemoSize,
  lens: LensId,
  detail: DetailLevel = 'auto',
): Promise<DemoDiagram> {
  const { snapshot, graph, console: links } = await demoGraph(size);
  const spec = normalizeViewSpec({ snapshot: `demo:${size}`, lens, detail });
  const { scene, report } = buildSceneWithReport(graph, spec, catalog, sceneEnv(snapshot));
  const layout = layoutScene(scene);
  return {
    input: {
      scene,
      layout,
      lensTitle: catalog.lenses[lens].title,
      overlayZones: report.overlays.map((overlay) => overlay.zone),
      icons: diagramIcons(scene),
      zoneTypes: zoneTypeNames(scene, graph),
      consoleLinks: consoleLinks(scene, links),
    },
    report,
    layout,
  };
}

const days = new Map<string, Promise<DemoGraph>>();

/** Day `day` (`YYYY-MM-DD`) of a demo organisation's history; its last day is the organisation itself. */
export function demoDayGraph(size: DemoSize, day: string): Promise<DemoGraph> {
  const key = `${size} ${day}`;
  let entry = days.get(key);
  if (entry === undefined) {
    entry = demoGraph(size).then(async (base) => {
      const history = demoHistory(size);
      if (day === history.today) return base;
      const snapshot = await historySnapshot(history, day, base.snapshot);
      return { snapshot, graph: buildGraph(snapshot, catalog), console: consoleSource(snapshot) };
    });
    days.set(key, entry);
  }
  return entry;
}

export interface DemoDiffDiagram extends DemoDiagram {
  readonly diff: TickDiff;
}

/** A day as the data worker holds it for a diff, with the console links of its assets. */
export type DiffDay = DiffDayData & { readonly console: ConsoleSource };

/**
 * Day `after` for a view, compared with day `before` as if that day had been on screen before: its Scene with the
 * ghosts, its layout and its diff, as the app would draw it.
 */
export function diffDiagramOf(before: DiffDay, after: DiffDay, spec: ViewSpec): DemoDiffDiagram {
  const built = buildSceneWithReport(after.graph, spec, catalog, sceneEnv(after.snapshot));
  const { scene, diff } = tickDiff({
    before,
    after,
    spec,
    scene: built.scene,
    report: built.report,
    catalog,
    envBefore: sceneEnv(before.snapshot),
    envAfter: sceneEnv(after.snapshot),
  });
  const layout = layoutScene(scene);
  return {
    input: {
      scene,
      layout,
      lensTitle: catalog.lenses[spec.lens].title,
      overlayZones: built.report.overlays.map((overlay) => overlay.zone),
      icons: diagramIcons(scene),
      zoneTypes: zoneTypeNames(scene, after.graph, before.graph),
      consoleLinks: consoleLinks(scene, after.console),
      diff,
    },
    report: built.report,
    layout,
    diff,
  };
}

/**
 * Day `day` of a demo organisation for a lens and detail level, compared with day `since` as if that day had been
 * on screen before: its Scene with the ghosts, its layout and its diff, as the app would draw it.
 */
export async function demoDiffDiagram(
  size: DemoSize,
  lens: LensId,
  detail: DetailLevel,
  since: string,
  day: string,
): Promise<DemoDiffDiagram> {
  const [before, after] = await Promise.all([demoDayGraph(size, since), demoDayGraph(size, day)]);
  const history = demoHistory(size);
  const tickOf = (at: string): { tick?: string } => (at === history.today ? {} : { tick: at });
  return diffDiagramOf(
    { ...before, ...tickOf(since) },
    { ...after, ...tickOf(day) },
    normalizeViewSpec({ snapshot: `demo:${size}`, lens, detail }),
  );
}

/** A day of demo M's history, or one made from it, as the data worker holds it, with its tick. */
export type DemoDay = DiffDay & { readonly tick: string };

/** Demo M's day `day` (`YYYY-MM-DD`), as the data worker holds it, with its tick. */
export async function demoMDay(day: string): Promise<DemoDay> {
  return { ...(await demoDayGraph('M', day)), tick: day };
}

/** Demo L's day `day` (`YYYY-MM-DD`), as the data worker holds it, with its tick. */
export async function demoLDay(day: string): Promise<DemoDay> {
  return { ...(await demoDayGraph('L', day)), tick: day };
}

/** How a two-day pair makes a day's assets from those of the day it starts from, whose Graph it is given. */
type AssetChange = (graph: Graph, assets: readonly Asset[]) => Asset[];

/** Day `tick` (`YYYY-MM-DD`, read at its 00:00 UTC) made of the assets of day `from` as `change` leaves them. */
function changedDay(from: DemoDay, tick: string, change: AssetChange): DemoDay {
  const snapshot: Snapshot = {
    ...from.snapshot,
    readTime: `${tick}T00:00:00Z`,
    assets: change(from.graph, from.snapshot.assets),
  };
  return { snapshot, graph: buildGraph(snapshot, catalog), console: consoleSource(snapshot), tick };
}

/**
 * Demo M's day 2026-09-16 and a next day, 2026-09-17, made of its assets as `change` leaves them: a two-day pair
 * the demo history does not have.
 */
export async function demoMNextDay(change: AssetChange): Promise<readonly [DemoDay, DemoDay]> {
  const before = await demoMDay('2026-09-16');
  return [before, changedDay(before, '2026-09-17', change)];
}

/**
 * Demo M's day 2026-09-16 with its assets as `earlier` leaves them, and a next day, 2026-09-17, made of those as
 * `next` leaves them (`demoMNextDay`): for a pair whose first day holds what the demo history does not.
 */
export async function demoMChangedDays(
  earlier: AssetChange,
  next: AssetChange,
): Promise<readonly [DemoDay, DemoDay]> {
  const before = changedDay(await demoMDay('2026-09-16'), '2026-09-16', earlier);
  return [before, changedDay(before, '2026-09-17', next)];
}

/** Demo M's perimeter and the two projects it secures (a perimeter focus draws it around them as an overlay). */
export const DEMO_M_PERIMETER = {
  perimeter:
    '//accesscontextmanager.googleapis.com/accessPolicies/40000000001/servicePerimeters/data_perimeter',
  /** Retail services (`demo-svc-1`), which `perimeterRemoved` removes with the perimeter, with all it holds. */
  secured: '//cloudresourcemanager.googleapis.com/projects/10000000011',
  /** The data project (`demo-data-1`), which is still there the next day, in its folder. */
  stillThere: '//cloudresourcemanager.googleapis.com/projects/10000000012',
} as const;

/**
 * Demo M's perimeter removed between two days (`demoMNextDay`), and with it Retail services, one of the two
 * projects it secures, with everything in it; the other one, the data project, is still there.
 */
export function perimeterRemoved(): Promise<readonly [DemoDay, DemoDay]> {
  return demoMNextDay((_graph, assets) =>
    assets.filter(
      (asset) =>
        asset.name !== DEMO_M_PERIMETER.perimeter && !asset.ancestors.includes('projects/10000000011'),
    ),
  );
}

/**
 * Demo M's perimeter removed between two days with Retail services, as in `perimeterRemoved`, and everything the
 * data project holds removed too; the data project itself is still there, unchanged, in its folder.
 */
export function perimeterEmptied(): Promise<readonly [DemoDay, DemoDay]> {
  const data = DEMO_M_PERIMETER.stillThere.slice(DEMO_M_PERIMETER.stillThere.indexOf('projects/'));
  return demoMNextDay((_graph, assets) =>
    assets.filter(
      (asset) =>
        asset.name !== DEMO_M_PERIMETER.perimeter &&
        !asset.ancestors.includes('projects/10000000011') &&
        (asset.name === DEMO_M_PERIMETER.stillThere || !asset.ancestors.includes(data)),
    ),
  );
}

/** Demo M's Payments web (prod) project, and the region zone `regionRemoved` empties (region zones shown). */
export const DEMO_M_REGION = {
  /** Payments web (prod), `demo-web-2`, which holds global assets too: they are still there the next day. */
  project: '//cloudresourcemanager.googleapis.com/projects/10000000016',
  /** Its us-central1 region zone, which holds its zone us-central1-a and the regional assets. */
  region: '//gcportrait.virtual/projects/demo-web-2/locations/us-central1',
  /** Its zone us-central1-a, inside the region zone, which holds its instance groups and VMs. */
  zone: '//gcportrait.virtual/projects/demo-web-2/locations/us-central1/zones/us-central1-a',
  /**
   * Its Cloud Run service storefront-api, in the region zone, whose one drawn line (the overview lens's) comes from
   * the network endpoint group web-run-neg there, which routes to it.
   */
  service: '//run.googleapis.com/projects/demo-web-2/locations/us-central1/services/storefront-api',
} as const;

/** The region whose assets `regionRemoved` removes, and the zone in it whose assets `zoneRemoved` removes. */
const REMOVED_REGION = 'us-central1';
const REMOVED_ZONE = 'us-central1-a';

/** Payments web (prod)'s `projects/…` ancestor entry. */
const PAYMENTS_WEB = DEMO_M_REGION.project.slice(DEMO_M_REGION.project.indexOf('projects/'));

/** Whether an asset of a day lies in Payments web (prod), at any depth, at a location `at` accepts. */
function inPaymentsWeb(graph: Graph, asset: Asset, at: (location: string) => boolean): boolean {
  if (asset.name === DEMO_M_REGION.project || !asset.ancestors.includes(PAYMENTS_WEB)) return false;
  return at(graph.nodes[asset.name]?.location?.toLowerCase() ?? '');
}

/** Whether a location lies in the region `regionRemoved` empties: the region itself, or one of its zones. */
function inRemovedRegion(location: string): boolean {
  return location === REMOVED_REGION || location.startsWith(`${REMOVED_REGION}-`);
}

/**
 * Everything demo M's Payments web (prod) holds in us-central1 (in the region, or in one of its zones) removed
 * between two days (`demoMNextDay`), at any depth inside the project; what it holds globally is still there, and
 * nothing else changes.
 */
export function regionRemoved(): Promise<readonly [DemoDay, DemoDay]> {
  return demoMNextDay((graph, assets) =>
    assets.filter((asset) => !inPaymentsWeb(graph, asset, inRemovedRegion)),
  );
}

/**
 * Everything demo M's Payments web (prod) holds in its zone us-central1-a (its instance groups, their managers and
 * VMs) removed between two days (`demoMNextDay`); what it holds in the region us-central1 itself, and globally, is
 * still there, and nothing else changes.
 */
export function zoneRemoved(): Promise<readonly [DemoDay, DemoDay]> {
  return demoMNextDay((graph, assets) =>
    assets.filter((asset) => !inPaymentsWeb(graph, asset, (location) => location === REMOVED_ZONE)),
  );
}

/** The Batch jobs `jobsSucceeded` runs in demo M's Payments web (prod) (`DEMO_M_REGION.project`). */
export const DEMO_M_JOBS = {
  /** In us-central1 (`DEMO_M_REGION.region`), where everything else the project holds is removed the next day. */
  inRegion: '//batch.googleapis.com/projects/demo-web-2/locations/us-central1/jobs/nightly-export',
  /** In europe-west3, where the project holds nothing else. */
  alone: '//batch.googleapis.com/projects/demo-web-2/locations/europe-west3/jobs/reindex',
  /** The project's europe-west3 region zone, which holds only that job. */
  aloneRegion: '//gcportrait.virtual/projects/demo-web-2/locations/europe-west3',
} as const;

/**
 * A Batch job of Payments web (prod) named `name` (`//batch.googleapis.com/projects/demo-web-2/locations/<region>/
 * jobs/<job>`) in `state` since `updateTime`, held as the project's other assets are.
 */
function paymentsWebJob(project: Asset, name: string, state: string, updateTime: string): Asset {
  const [, region = '', job = ''] = /\/locations\/([^/]+)\/jobs\/([^/]+)$/.exec(name) ?? [];
  const number = project.name.slice(project.name.lastIndexOf('/') + 1);
  return {
    name,
    assetType: 'batch.googleapis.com/Job',
    parent: project.name,
    ancestors: project.ancestors,
    location: region,
    updateTime,
    data: {
      name: `projects/${number}/locations/${region}/jobs/${job}`,
      uid: `${job}-0916`,
      status: { state, runDuration: '1800s' },
    },
  };
}

/**
 * Two Batch jobs of demo M's Payments web (prod) running on 2026-09-16 (`demoMChangedDays`), one in us-central1 and
 * one in europe-west3, where the project holds nothing else; the next day both succeeded, so the view no longer
 * draws them (a finished job starts hidden), and everything else the project holds in us-central1 is removed, as
 * in `regionRemoved`. Nothing else changes.
 */
export function jobsSucceeded(): Promise<readonly [DemoDay, DemoDay]> {
  const jobs: readonly string[] = [DEMO_M_JOBS.inRegion, DEMO_M_JOBS.alone];
  const projectOf = (assets: readonly Asset[]): Asset => {
    const project = assets.find((asset) => asset.name === DEMO_M_REGION.project);
    if (project === undefined) throw new Error(`demo M has no project ${PAYMENTS_WEB}`);
    return project;
  };
  return demoMChangedDays(
    (_graph, assets) => [
      ...assets,
      ...jobs.map((name) => paymentsWebJob(projectOf(assets), name, 'RUNNING', '2026-09-15T22:00:00Z')),
    ],
    (graph, assets) =>
      assets.flatMap((asset) => {
        if (jobs.includes(asset.name)) {
          return [paymentsWebJob(projectOf(assets), asset.name, 'SUCCEEDED', '2026-09-16T04:30:00Z')];
        }
        return inPaymentsWeb(graph, asset, inRemovedRegion) ? [] : [asset];
      }),
  );
}

/** When `paymentsWebRetired` and `paymentsWebMarked` mark the project for deletion: between the two days. */
const RETIRED_AT = '2026-09-16T15:00:00Z';

/** Payments web (prod)'s asset marked for deletion: its `lifecycleState` `DELETE_REQUESTED` since `RETIRED_AT`. */
function markedForDeletion(project: Asset): Asset {
  const data = typeof project.data === 'object' && project.data !== null ? project.data : {};
  return { ...project, updateTime: RETIRED_AT, data: { ...data, lifecycleState: 'DELETE_REQUESTED' } };
}

/**
 * Demo M's Payments web (prod) marked for deletion between two days (`demoMChangedDays`): on 2026-09-16 it runs a
 * Batch job in europe-west3 (`DEMO_M_JOBS.alone`), which has succeeded the next day (a finished job starts hidden),
 * when the project's `lifecycleState` is `DELETE_REQUESTED` (a project being deleted is hidden: what it holds that the
 * view draws is drawn in its folder). Nothing else changes.
 */
export function paymentsWebRetired(): Promise<readonly [DemoDay, DemoDay]> {
  const project = (assets: readonly Asset[]): Asset => {
    const found = assets.find((asset) => asset.name === DEMO_M_REGION.project);
    if (found === undefined) throw new Error(`demo M has no project ${PAYMENTS_WEB}`);
    return found;
  };
  return demoMChangedDays(
    (_graph, assets) => [
      ...assets,
      paymentsWebJob(project(assets), DEMO_M_JOBS.alone, 'RUNNING', '2026-09-15T22:00:00Z'),
    ],
    (_graph, assets) =>
      assets.map((asset) => {
        if (asset.name === DEMO_M_JOBS.alone) {
          return paymentsWebJob(project(assets), asset.name, 'SUCCEEDED', '2026-09-16T04:30:00Z');
        }
        return asset.name === DEMO_M_REGION.project ? markedForDeletion(asset) : asset;
      }),
  );
}

/**
 * Demo M's Payments web (prod) marked for deletion between two days (`demoMNextDay`), as in `paymentsWebRetired` but
 * with no Batch job: nothing it holds changes, and what the view draws of it is drawn in its folder the next day.
 * Nothing else changes.
 */
export function paymentsWebMarked(): Promise<readonly [DemoDay, DemoDay]> {
  return demoMNextDay((_graph, assets) =>
    assets.map((asset) => (asset.name === DEMO_M_REGION.project ? markedForDeletion(asset) : asset)),
  );
}

/**
 * Demo M's Payments web (prod) marked for deletion between two days (`demoMNextDay`), as in `paymentsWebMarked`, with
 * everything it holds in us-central1 removed, as in `regionRemoved`, but its Cloud Run service
 * (`DEMO_M_REGION.service`): the service is still there, unchanged, and the network endpoint group that routed to it
 * is removed with the rest. Nothing else changes.
 */
export function paymentsWebWoundDown(): Promise<readonly [DemoDay, DemoDay]> {
  return demoMNextDay((graph, assets) =>
    assets.flatMap((asset) => {
      if (asset.name === DEMO_M_REGION.project) return [markedForDeletion(asset)];
      if (asset.name === DEMO_M_REGION.service) return [asset];
      return inPaymentsWeb(graph, asset, inRemovedRegion) ? [] : [asset];
    }),
  );
}

/** Demo M's CI runner VM and its boot disk, which `ciRunnerRemoved` removes, and the zones around them. */
export const DEMO_M_CI_RUNNER = {
  vm: '//compute.googleapis.com/projects/demo-mgmt-1/zones/europe-west3-a/instances/ci-runner-1',
  disk: '//compute.googleapis.com/projects/demo-mgmt-1/zones/europe-west3-a/disks/ci-runner-1',
  /** Platform management, `demo-mgmt-1`, whose only VM it is (the compute lens draws nothing else of it). */
  project: '//cloudresourcemanager.googleapis.com/projects/10000000005',
  /** Platform / Operations, which holds the project, and CI and operations (empty in the compute lens). */
  folder: '//cloudresourcemanager.googleapis.com/folders/20000000004',
  /** Platform, which holds Operations, Networking and Security. */
  platform: '//cloudresourcemanager.googleapis.com/folders/20000000001',
} as const;

/**
 * Demo M's CI runner VM in Platform management removed with its boot disk between two days (`demoMNextDay`); the
 * project itself does not change, and nothing else does.
 */
export function ciRunnerRemoved(): Promise<readonly [DemoDay, DemoDay]> {
  const removed: readonly string[] = [DEMO_M_CI_RUNNER.vm, DEMO_M_CI_RUNNER.disk];
  return demoMNextDay((_graph, assets) => assets.filter((asset) => !removed.includes(asset.name)));
}

/** Demo L's bundle that is bundled anew on 27 September, and the subnet and VM `bundledVmRemoved` takes from it. */
export const DEMO_L_RESPLIT = {
  /**
   * The bundle "demo-web-7 – allow-grpc-to-demo-web-2" of the shared production network in the everything lens on 26
   * September, which no bundle of 27 September is (its id names its first member).
   */
  bundle: `${BUNDLE_ID_PREFIX}//compute.googleapis.com/projects/demo-net-1/regions/europe-west1/subnetworks/demo-web-7-europe-west1`,
  /** In that bundle on 26 September, and in a new bundle on 27 September. */
  subnet: '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/dmz-europe-west3',
  /** The one VM that subnet holds, which `bundledVmRemoved` removes on 27 September. */
  vm: '//compute.googleapis.com/projects/demo-net-1/zones/europe-west3-a/instances/nva-inspect-1',
} as const;

/**
 * Demo L's 26 September and its 27 September (on which the shared production network's members are bundled anew)
 * with the inspection VM of its dmz subnet removed too; nothing else differs from the history.
 */
export async function bundledVmRemoved(): Promise<readonly [DemoDay, DemoDay]> {
  const [before, after] = await Promise.all([demoLDay('2026-09-26'), demoLDay('2026-09-27')]);
  const removed = changedDay(after, after.tick, (_graph, assets) =>
    assets.filter((asset) => asset.name !== DEMO_L_RESPLIT.vm),
  );
  return [before, removed];
}

/** Demo M's partner exchange project, and the folders `projectMoved` moves it from and into. */
export const DEMO_M_MOVE = {
  /** Partner exchange, in Platform / Networking on 2026-09-16. */
  project: '//cloudresourcemanager.googleapis.com/projects/10000000003',
  /** Platform / Networking. */
  from: '//cloudresourcemanager.googleapis.com/folders/20000000002',
  /** Workloads / Logistics / Production, which holds it the next day. */
  to: '//cloudresourcemanager.googleapis.com/folders/20000000013',
} as const;

/** When `projectMoved` moves the project: between the two days. */
const MOVED_AT = '2026-09-16T12:00:00Z';

/**
 * Demo M's partner exchange moved from Platform / Networking into Logistics / Production between two days
 * (`demoMNextDay`): the project's `parent` and its `updateTime` change, and the `ancestors` of the project and of
 * everything in it; nothing else changes.
 */
export function projectMoved(): Promise<readonly [DemoDay, DemoDay]> {
  const project = DEMO_M_MOVE.project.slice(DEMO_M_MOVE.project.indexOf('projects/'));
  const folder = DEMO_M_MOVE.to.slice(DEMO_M_MOVE.to.indexOf('folders/'));
  return demoMNextDay((_graph, assets) => {
    const into = assets.find((asset) => asset.name === DEMO_M_MOVE.to);
    if (into === undefined) throw new Error(`demo M has no folder ${folder}`);
    return assets.map((asset) => {
      const at = asset.ancestors.indexOf(project);
      if (at < 0) return asset;
      const ancestors = [...asset.ancestors.slice(0, at + 1), ...into.ancestors];
      if (asset.name !== DEMO_M_MOVE.project) return { ...asset, ancestors };
      const data = typeof asset.data === 'object' && asset.data !== null ? asset.data : {};
      return {
        ...asset,
        parent: DEMO_M_MOVE.to,
        ancestors,
        updateTime: MOVED_AT,
        data: { ...data, parent: { type: 'folder', id: folder.slice('folders/'.length) } },
      };
    });
  });
}

/** Partner exchange's network, which `partnerNetworkRemoved` removes with everything nested in it. */
export const DEMO_M_PARTNER_NETWORK =
  '//compute.googleapis.com/projects/demo-partner-1/global/networks/vpc-partner';

/** Demo M's organisation, which `partnerNetworkRemoved` moves partner exchange into. */
const DEMO_M_ORGANIZATION = '//cloudresourcemanager.googleapis.com/organizations/30000000002';

/**
 * Demo M's partner exchange moved out of Platform / Networking straight into the organisation (as the Sandbox project
 * lies) between two days (`demoMNextDay`), its network `vpc-partner` removed with everything the Graph nests in it;
 * the project's `parent` and `ancestors` change, nothing else does.
 */
export function partnerNetworkRemoved(): Promise<readonly [DemoDay, DemoDay]> {
  return demoMNextDay((graph, assets) => {
    const removed = new Set<string>();
    const visit = (id: string): void => {
      removed.add(id);
      for (const child of graph.containment.children[id] ?? []) visit(child);
    };
    visit(DEMO_M_PARTNER_NETWORK);
    const project = DEMO_M_MOVE.project.slice(DEMO_M_MOVE.project.indexOf('projects/'));
    return assets.flatMap((asset) => {
      if (removed.has(asset.name)) return [];
      if (asset.name !== DEMO_M_MOVE.project) return [asset];
      return [{ ...asset, parent: DEMO_M_ORGANIZATION, ancestors: [project, 'organizations/30000000002'] }];
    });
  });
}
