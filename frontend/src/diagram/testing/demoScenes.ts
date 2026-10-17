// SPDX-License-Identifier: MIT
/**
 * Demo diagrams for the tests, built the way the app builds them: the data worker's demo loader (demo-data →
 * CAI NDJSON → ingest), the graph and Scene builders with the compiled catalog at the default 1280×800 rect
 * budget, and the layout. Synchronous parts are cached per organisation; nothing here touches a DOM. A day of an
 * organisation's history is read as the data worker reads it (timeline/worker/replay.ts), and a day compared with
 * another one gets its diff and ghosts as the data worker gives them (diff/tickDiff.ts), also for the two-day pairs
 * the history does not have (demo M's perimeter removed between two days, `perimeterRemoved`, a project moved into
 * another folder, `projectMoved`, or everything a project holds in one region removed, `regionRemoved`). For the
 * tests that only need the scene builder: the builder's environment
 * for a snapshot (`sceneEnv`), and a demo Graph built synchronously straight from the generator (`demoGraphSync`).
 * Demo data without a Scene is in demoData.ts.
 */
import { catalog } from '@gcportrait/catalog';
import { generateOrganization, toSnapshot } from '@gcportrait/demo-data';
import { buildGraph, buildSceneWithReport, DEFAULT_VIEWPORT_BUDGET } from '@gcportrait/graph';
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

/**
 * Demo M's day 2026-09-16 and a next day, 2026-09-17, made of its assets as `change` leaves them: a two-day pair
 * the demo history does not have.
 */
export async function demoMNextDay(
  change: (graph: Graph, assets: readonly Asset[]) => Asset[],
): Promise<readonly [DemoDay, DemoDay]> {
  const before = await demoMDay('2026-09-16');
  const snapshot: Snapshot = {
    ...before.snapshot,
    readTime: '2026-09-17T00:00:00Z',
    assets: change(before.graph, before.snapshot.assets),
  };
  const after = { snapshot, graph: buildGraph(snapshot, catalog), console: consoleSource(snapshot) };
  return [before, { ...after, tick: '2026-09-17' }];
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

/** Demo M's Payments web (prod) project, and the region zone `regionRemoved` empties (region zones shown). */
export const DEMO_M_REGION = {
  /** Payments web (prod), `demo-web-2`, which holds global assets too: they are still there the next day. */
  project: '//cloudresourcemanager.googleapis.com/projects/10000000016',
  /** Its us-central1 region zone, which holds its zone us-central1-a and the regional assets. */
  region: '//gcportrait.virtual/projects/demo-web-2/locations/us-central1',
} as const;

/** The region whose assets `regionRemoved` removes. */
const REMOVED_REGION = 'us-central1';

/**
 * Everything demo M's Payments web (prod) holds in us-central1 (in the region, or in one of its zones) removed
 * between two days (`demoMNextDay`), at any depth inside the project; what it holds globally is still there, and
 * nothing else changes.
 */
export function regionRemoved(): Promise<readonly [DemoDay, DemoDay]> {
  const project = DEMO_M_REGION.project.slice(DEMO_M_REGION.project.indexOf('projects/'));
  return demoMNextDay((graph, assets) =>
    assets.filter((asset) => {
      if (asset.name === DEMO_M_REGION.project || !asset.ancestors.includes(project)) return true;
      const location = graph.nodes[asset.name]?.location?.toLowerCase() ?? '';
      return location !== REMOVED_REGION && !location.startsWith(`${REMOVED_REGION}-`);
    }),
  );
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
