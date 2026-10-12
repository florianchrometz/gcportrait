// SPDX-License-Identifier: MIT
/**
 * Demo diagrams for the tests, built the way the app builds them: the data worker's demo loader (demo-data →
 * CAI NDJSON → ingest), the graph and Scene builders with the compiled catalog at the default 1280×800 rect
 * budget, and the layout. Synchronous parts are cached per organisation; nothing here touches a DOM. A day of an
 * organisation's history is read as the data worker reads it (timeline/worker/replay.ts), and a day compared with
 * another one gets its diff and ghosts as the data worker gives them (diff/tickDiff.ts). For the tests that
 * only need the scene builder: the builder's environment for a snapshot (`sceneEnv`), and a demo Graph built
 * synchronously straight from the generator (`demoGraphSync`). Demo data without a Scene is in demoData.ts.
 */
import { catalog } from '@gcportrait/catalog';
import { generateOrganization, toSnapshot } from '@gcportrait/demo-data';
import { buildGraph, buildSceneWithReport, DEFAULT_VIEWPORT_BUDGET } from '@gcportrait/graph';
import { layoutScene, type Layout } from '@gcportrait/layout';
import {
  normalizeViewSpec,
  type DemoSize,
  type DetailLevel,
  type Graph,
  type LensId,
  type SceneEnv,
  type SceneReport,
  type Snapshot,
} from '@gcportrait/model';

import { historySnapshot } from '../../timeline/worker/replay';
import { tickDiff } from '../diff/tickDiff';
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
  const spec = normalizeViewSpec({ snapshot: `demo:${size}`, lens, detail });
  const built = buildSceneWithReport(after.graph, spec, catalog, sceneEnv(after.snapshot));
  const tickOf = (at: string): { tick?: string } => (at === history.today ? {} : { tick: at });
  const { scene, diff } = tickDiff({
    before: { snapshot: before.snapshot, graph: before.graph, ...tickOf(since) },
    after: { snapshot: after.snapshot, graph: after.graph, ...tickOf(day) },
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
      lensTitle: catalog.lenses[lens].title,
      overlayZones: built.report.overlays.map((overlay) => overlay.zone),
      icons: diagramIcons(scene),
      zoneTypes: zoneTypeNames(scene, after.graph),
      consoleLinks: consoleLinks(scene, after.console),
      diff,
    },
    report: built.report,
    layout,
    diff,
  };
}
