// SPDX-License-Identifier: MIT
/**
 * The data worker's memo of built Scenes, per Graph: a timeline step builds the drawn day's view and, for its
 * diff (diff/tickDiff.ts), the earlier day's view at the level the drawn Scene uses and the view with every zone open
 * on both days. Stepping on day by day, the earlier day is the day drawn the step before, so its views were built
 * then: kept here, a step builds two Scenes instead of four, and stepping back and forth between two days builds
 * none.
 *
 * The key is the view without its snapshot and its `tick` (the Graph is the day: the scene builder reads neither)
 * and the environment the builder reads (read time, root label, `auto` budget, region zones). A Scene built at
 * `auto` is kept under its own key and under the level `auto` picked, with that level as the one asked for: the
 * builder makes the same Scene and report for both (sceneMemo.test.ts), and the diff asks for the earlier day's view
 * at that level. Each Graph keeps its last `SCENES_PER_GRAPH` keys, least recently used out first; a Graph the worker
 * no longer keeps takes its Scenes with it (a `WeakMap`). The Scenes are shared: nothing may mutate one.
 *
 * What the memo builds, it builds through `sharedPreparation`: the last view's preparation (`prepareView` of
 * `@gcportrait/graph`: lens, focus, root, filters and the scene tree) is kept, so a view that differs from it only in
 * detail level, flips, `depth`, selection or highlight is finished from it. A step's open view is the drawn view with
 * every zone open, and a chip expanded is the view with one more flip: each costs about half a build on demo L.
 */
import { buildPreparedScene, prepareView, preparedViewKey, type PreparedView } from '@gcportrait/graph';
import {
  encodeViewSpec,
  type Catalog,
  type Graph,
  type SceneBuild,
  type SceneEnv,
  type ViewSpec,
  type ViewSpecInput,
} from '@gcportrait/model';
import { keepNewest } from '../../lru';

/** How many views (keys) each Graph keeps: the drawn view, its `auto` alias, the open view, and a spare. */
export const SCENES_PER_GRAPH = 6;

export type SceneBuilder = (graph: Graph, spec: ViewSpec, env: SceneEnv) => SceneBuild;

export interface SceneMemo {
  /** The Scene and report of `spec` on `graph`, built once per key. */
  readonly build: SceneBuilder;
  /** How often a build was answered from the memo, and how often it built. */
  readonly stats: () => { readonly hits: number; readonly misses: number };
}

/** The memo key of a view on a Graph: the view without its snapshot and tick, and the builder's environment. */
export function sceneMemoKey(spec: ViewSpec, env: SceneEnv): string {
  const view: ViewSpecInput = { ...spec, snapshot: '' };
  delete view.tick;
  return [
    encodeViewSpec(view),
    env.readTime,
    env.rootLabel ?? '',
    String(env.viewportBudget ?? ''),
    String(env.showRegions ?? ''),
  ].join('\u0000');
}

/** A scene builder like `buildSceneWithReport`: a view on a Graph with a catalog and environment. */
export type CatalogSceneBuilder = (
  graph: Graph,
  spec: ViewSpec,
  catalog: Catalog,
  env: SceneEnv,
) => SceneBuild;

/**
 * A scene builder that keeps the last view's preparation (see the file comment) and finishes every view it serves
 * from it: the same Scene and report as `buildSceneWithReport` (a property test of `@gcportrait/graph`).
 */
export function sharedPreparation(): CatalogSceneBuilder {
  let last: { readonly catalog: Catalog; readonly prepared: PreparedView } | null = null;
  return (graph, spec, catalog, env) => {
    if (
      last?.catalog !== catalog ||
      last.prepared.graph !== graph ||
      last.prepared.key !== preparedViewKey(spec, env)
    )
      last = { catalog, prepared: prepareView(graph, spec, catalog, env) };
    return buildPreparedScene(last.prepared, spec, env);
  };
}

export function createSceneMemo(
  catalog: Catalog,
  build: CatalogSceneBuilder = sharedPreparation(),
): SceneMemo {
  const byGraph = new WeakMap<Graph, Map<string, SceneBuild>>();
  let hits = 0;
  let misses = 0;

  const keep = (kept: Map<string, SceneBuild>, key: string, value: SceneBuild): void => {
    keepNewest(kept, key, value, SCENES_PER_GRAPH);
  };

  return {
    build(graph, spec, env) {
      let kept = byGraph.get(graph);
      if (kept === undefined) {
        kept = new Map();
        byGraph.set(graph, kept);
      }
      const key = sceneMemoKey(spec, env);
      const known = kept.get(key);
      if (known !== undefined) {
        hits += 1;
        keep(kept, key, known);
        return known;
      }
      misses += 1;
      const built = build(graph, spec, catalog, env);
      keep(kept, key, built);
      const { detail } = built.report;
      if (detail.requested === 'auto') {
        // The same view at the level `auto` picked: the same Scene, and the report of a view that asked for it.
        const level = sceneMemoKey({ ...spec, detail: detail.used }, env);
        if (!kept.has(level))
          keep(kept, level, {
            scene: built.scene,
            report: { ...built.report, detail: { ...detail, requested: detail.used } },
          });
      }
      return built;
    },
    stats: () => ({ hits, misses }),
  };
}
