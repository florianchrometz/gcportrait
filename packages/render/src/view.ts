// SPDX-License-Identifier: Apache-2.0
/**
 * A view of a snapshot, prepared the way the app prepares it (the data flow in docs/packages.md): the Graph
 * with the compiled catalog, the Scene for the ViewSpec at the viewport's rect budget, the layout with its
 * default options, and the diagram input the page builds (lens title, `secures` overlay zones, icons, zone
 * type names). Everything here is deterministic.
 *
 * `createDemoViews` adds the demo organisations on top, read by the data worker's demo loader (demo-data → CAI
 * NDJSON → ingest, fixed clock and entropy) as `pnpm render --fixture` takes them; the Graph of each organisation is
 * built once and reused for every view of it.
 */
import { catalog } from '@gcportrait/catalog';
import { DEMO_SIZES } from '@gcportrait/demo-data';
import { diagramIcons, zoneTypeNames, type DiagramInput } from '@gcportrait/frontend';
import { buildGraph, buildSceneWithReport, viewportBudget } from '@gcportrait/graph';
import { checkLayout, layoutScene, type InvariantViolation, type Layout } from '@gcportrait/layout';
import {
  RENDER_DEFAULT_VIEWPORT,
  type DemoSize,
  type Graph,
  type SceneReport,
  type Snapshot,
  type ViewSpec,
} from '@gcportrait/model';

import { initRasteriser } from './raster.js';
import { snapshotFromDemo } from './snapshot.js';

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** The app's smallest supported canvas, and what `auto` detail is computed for unless told otherwise. */
export const DEFAULT_VIEWPORT: Viewport = RENDER_DEFAULT_VIEWPORT;

/** The demo organisations, smallest first. */
export const FIXTURES: readonly DemoSize[] = DEMO_SIZES;

export interface PreparedView {
  readonly spec: ViewSpec;
  readonly input: DiagramInput;
  readonly report: SceneReport;
  readonly layout: Layout;
  /** The snapshot's asset count. */
  readonly assets: number;
  /** The layout's invariants (skill gcp-diagram-layout §5); empty when the layout is sound. */
  readonly violations: readonly InvariantViolation[];
}

/** A prepared view of a demo organisation. */
export interface DemoView extends PreparedView {
  readonly fixture: DemoSize;
}

/** The Graph of a snapshot, as the app's data worker builds it. */
export function graphOf(snapshot: Snapshot): Graph {
  return buildGraph(snapshot, catalog);
}

/** The laid-out view of `snapshot` for `spec`, with `graph` when it was built already. */
export function prepareView(
  snapshot: Snapshot,
  spec: ViewSpec,
  viewport: Viewport = DEFAULT_VIEWPORT,
  graph: Graph = graphOf(snapshot),
): PreparedView {
  const { scene, report } = buildSceneWithReport(graph, spec, catalog, {
    readTime: snapshot.readTime,
    rootLabel: snapshot.scope.displayName ?? snapshot.scope.id,
    viewportBudget: viewportBudget(viewport.width, viewport.height),
  });
  const layout = layoutScene(scene);
  const input: DiagramInput = {
    scene,
    layout,
    lensTitle: catalog.lenses[spec.lens].title,
    overlayZones: report.overlays.map((overlay) => overlay.zone),
    icons: diagramIcons(scene),
    zoneTypes: zoneTypeNames(scene, graph),
  };
  return {
    spec,
    input,
    report,
    layout,
    assets: snapshot.assets.length,
    violations: checkLayout(scene, layout),
  };
}

export interface DemoViews {
  /**
   * The laid-out view; `spec.snapshot` is set to the fixture's demo reference. The rasteriser is started with the
   * installed packages' assets too, so the view can be drawn as a PNG at once.
   */
  prepare(fixture: DemoSize, spec: ViewSpec, viewport?: Viewport): Promise<DemoView>;
}

export function createDemoViews(): DemoViews {
  const loaded = new Map<DemoSize, Promise<{ readonly snapshot: Snapshot; readonly graph: Graph }>>();
  const load = (fixture: DemoSize): Promise<{ readonly snapshot: Snapshot; readonly graph: Graph }> => {
    let entry = loaded.get(fixture);
    if (entry === undefined) {
      entry = snapshotFromDemo(fixture).then((snapshot) => ({ snapshot, graph: graphOf(snapshot) }));
      loaded.set(fixture, entry);
    }
    return entry;
  };
  return {
    async prepare(fixture, requested, viewport = DEFAULT_VIEWPORT) {
      const [{ snapshot, graph }] = await Promise.all([load(fixture), initRasteriser()]);
      const spec: ViewSpec = { ...requested, snapshot: `demo:${fixture}` };
      return { fixture, ...prepareView(snapshot, spec, viewport, graph) };
    },
  };
}
