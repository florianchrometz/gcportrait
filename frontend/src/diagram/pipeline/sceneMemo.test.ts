// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The data worker's Scene memo (sceneMemo.ts): a view on a Graph is built once; the key leaves the snapshot and
 * the timeline tick out (the Graph is the day) but keeps the builder's environment; a view built at `auto` is also
 * kept under the level it picked, as exactly what the builder makes for that level; each Graph keeps a few views;
 * a timeline step's diff builds only the drawn day's views (demo S's history); and the views it finishes from the
 * last view's preparation are the views the scene builder makes.
 */
import { catalog } from '@gcportrait/catalog';
import { buildSceneWithReport, flipIdOf } from '@gcportrait/graph';
import {
  normalizeViewSpec,
  type Catalog,
  type Graph,
  type SceneBuild,
  type SceneEnv,
  type ViewSpec,
  type ViewSpecInput,
} from '@gcportrait/model';
import { beforeAll, describe, expect, it } from 'vitest';

import { tickDiff } from '../diff/tickDiff';
import { demoDayGraph, demoGraph, sceneEnv as env } from '../testing/demoScenes';
import { firstChip } from '../testing/scenes';
import { createSceneMemo, SCENES_PER_GRAPH, sceneMemoKey, sharedPreparation } from './sceneMemo';

beforeAll(async () => {
  await import('./demo');
});

const view = (input: ViewSpecInput = {}): ViewSpec =>
  normalizeViewSpec({ snapshot: 'demo:M', lens: 'overview', ...input });

/** A memo over the real scene builder that counts the builds it asks for. */
function counted(): { memo: ReturnType<typeof createSceneMemo>; built: () => number } {
  let builds = 0;
  const memo = createSceneMemo(catalog, (graph: Graph, spec: ViewSpec, cat: Catalog, at: SceneEnv) => {
    builds += 1;
    return buildSceneWithReport(graph, spec, cat, at);
  });
  return { memo, built: () => builds };
}

describe('the Scene memo', () => {
  it('builds a view on a Graph once, whatever its snapshot ref and tick say', async () => {
    const { graph, snapshot } = await demoGraph('M');
    const { memo, built } = counted();
    const first = memo.build(graph, view(), env(snapshot));
    expect(memo.build(graph, view({ tick: '2026-09-17' }), env(snapshot))).toBe(first);
    expect(memo.build(graph, view({ snapshot: 'demo:L' }), env(snapshot))).toBe(first);
    expect(built()).toBe(1);
    expect(memo.stats()).toEqual({ hits: 2, misses: 1 });
    expect(first).toEqual(buildSceneWithReport(graph, view(), catalog, env(snapshot)));
  });

  it('builds again for another view, environment or Graph', async () => {
    const m = await demoGraph('M');
    const s = await demoGraph('S');
    const { memo, built } = counted();
    memo.build(m.graph, view(), env(m.snapshot));
    memo.build(m.graph, view({ lens: 'networking' }), env(m.snapshot));
    memo.build(
      m.graph,
      view({ selection: '//cloudresourcemanager.googleapis.com/projects/10000000009' }),
      env(m.snapshot),
    );
    memo.build(m.graph, view(), env(m.snapshot, 200));
    memo.build(m.graph, view(), { ...env(m.snapshot), readTime: '2026-09-17T00:00:00Z' });
    memo.build(s.graph, view(), env(s.snapshot));
    expect(built()).toBe(6);
    expect(sceneMemoKey(view(), env(m.snapshot))).not.toBe(
      sceneMemoKey(view({ detail: 'all' }), env(m.snapshot)),
    );
    expect(sceneMemoKey(view(), env(m.snapshot))).toBe(
      sceneMemoKey(view({ tick: '2026-09-01' }), env(m.snapshot)),
    );
  });

  it('keeps an `auto` view under the level it picked, exactly as the builder makes that level', async () => {
    const { graph, snapshot } = await demoGraph('M');
    const { memo, built } = counted();
    const auto = memo.build(graph, view(), env(snapshot));
    const level = auto.report.detail.used;
    expect(auto.report.detail.requested).toBe('auto');
    expect(level).toBe('folders');
    const explicit: SceneBuild = memo.build(graph, view({ detail: level }), env(snapshot));
    expect(built()).toBe(1);
    expect(explicit.scene).toBe(auto.scene);
    expect(explicit).toEqual(buildSceneWithReport(graph, view({ detail: level }), catalog, env(snapshot)));
    // With flips too: a flip XORs the level's default either way.
    const chip = firstChip(auto.scene);
    if (chip === undefined) throw new Error('demo M at folders has no chip');
    const flips = [flipIdOf(chip)];
    const flipped = memo.build(graph, view({ flips }), env(snapshot));
    expect(flipped.report.unknownFlips).toEqual([]);
    expect(flipped.report.detail.used).toBe('folders');
    expect(memo.build(graph, view({ flips, detail: 'folders' }), env(snapshot))).toEqual(
      buildSceneWithReport(graph, view({ flips, detail: 'folders' }), catalog, env(snapshot)),
    );
    expect(built()).toBe(2);
  });

  it(`keeps the last ${String(SCENES_PER_GRAPH)} views of each Graph`, async () => {
    const { graph, snapshot } = await demoGraph('S');
    const { memo, built } = counted();
    const lenses = [
      'overview',
      'networking',
      'compute',
      'data',
      'security',
      'identity',
      'serverless',
    ] as const;
    for (const lens of lenses) memo.build(graph, view({ lens, detail: 'all' }), env(snapshot));
    expect(built()).toBe(lenses.length);
    // The newest are kept; the oldest went first.
    memo.build(graph, view({ lens: 'serverless', detail: 'all' }), env(snapshot));
    memo.build(graph, view({ lens: 'networking', detail: 'all' }), env(snapshot));
    expect(built()).toBe(lenses.length);
    memo.build(graph, view({ lens: 'overview', detail: 'all' }), env(snapshot));
    expect(built()).toBe(lenses.length + 1);
  });

  it('lets a timeline step build only the drawn day’s views: the earlier day’s were built the step before', async () => {
    const days = ['2026-09-17', '2026-09-16', '2026-09-15'] as const;
    const loaded = await Promise.all([
      demoDayGraph('S', days[0]),
      demoDayGraph('S', days[1]),
      demoDayGraph('S', days[2]),
    ]);
    const { memo, built } = counted();
    // At `folders` S has chips, so the diff builds the open views too.
    const spec = normalizeViewSpec({ snapshot: 'demo:S', lens: 'overview', detail: 'folders' });
    const draw = (index: 0 | 1 | 2, since: 0 | 1 | 2 | null) => {
      const after = loaded[index];
      const tick = days[index];
      const { scene, report } = memo.build(after.graph, { ...spec, tick }, env(after.snapshot));
      if (since === null) return;
      const before = loaded[since];
      tickDiff({
        before: { snapshot: before.snapshot, graph: before.graph, tick: days[since] },
        after: { snapshot: after.snapshot, graph: after.graph, tick },
        spec: { ...spec, tick },
        scene,
        report,
        catalog,
        envBefore: env(before.snapshot),
        envAfter: env(after.snapshot),
        build: memo.build,
      });
    };
    draw(0, null);
    expect(built()).toBe(1);
    // 17 → 16: the drawn view and both days' open views are built; the 17th's view is kept.
    draw(1, 0);
    expect(built()).toBe(4);
    // 16 → 15: only the 15th's two views are built; the 16th's were built the step before.
    draw(2, 1);
    expect(built()).toBe(6);
    // Back to the 16th, compared with the 15th: everything is kept.
    draw(1, 2);
    expect(built()).toBe(6);
  });

  it('finishes a view from the last view’s preparation exactly as the scene builder builds it', async () => {
    const m = await demoGraph('M');
    const s = await demoGraph('S');
    const build = sharedPreparation();
    const chip = (graph: Graph, at: SceneEnv): string => {
      const found = firstChip(buildSceneWithReport(graph, view(), catalog, at).scene);
      if (found === undefined) throw new Error('demo M at folders has no chip');
      return found;
    };
    const flip = flipIdOf(chip(m.graph, env(m.snapshot)));
    // The drawn view, its open view, a chip expanded, a depth, a selection; then another lens, another Graph.
    const views: [Graph, ViewSpec, SceneEnv][] = [
      [m.graph, view(), env(m.snapshot)],
      [m.graph, view({ detail: 'all' }), env(m.snapshot)],
      [m.graph, view({ flips: [flip] }), env(m.snapshot)],
      [m.graph, view({ filters: { depth: 1 } }), env(m.snapshot, 40)],
      [
        m.graph,
        view({ selection: '//cloudresourcemanager.googleapis.com/projects/10000000009' }),
        env(m.snapshot),
      ],
      [m.graph, view({ lens: 'networking' }), env(m.snapshot)],
      [s.graph, view({ lens: 'networking' }), env(s.snapshot)],
      [m.graph, view(), env(m.snapshot)],
    ];
    for (const [graph, spec, at] of views) {
      expect(build(graph, spec, catalog, at), JSON.stringify(spec)).toEqual(
        buildSceneWithReport(graph, spec, catalog, at),
      );
    }
  });
});
