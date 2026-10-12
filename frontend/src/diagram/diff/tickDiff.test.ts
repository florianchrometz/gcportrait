// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The timeline diff of a drawn day (tickDiff.ts) on demo organisation S's history, worked out as the data
 * worker does: the diff is `diffSnapshots` of the two days, by name and order-independent; what the view drew the
 * day before and no longer draws comes back as ghosts in its old container, with the reason; chips count what
 * changed inside them; nothing changes when the days are alike, and nothing is ghosted when the drill-in root moved.
 */
import { catalog } from '@gcportrait/catalog';
import { buildGraph, buildSceneWithReport, diffSnapshots } from '@gcportrait/graph';
import { layoutScene } from '@gcportrait/layout';
import { normalizeViewSpec, SceneSchema, type Snapshot, type ViewSpecInput } from '@gcportrait/model';
import { beforeAll, describe, expect, it } from 'vitest';

import { DEMO_S } from '../testing/demoData';
import { demoDayGraph, sceneEnv as env } from '../testing/demoScenes';
import { parentsOf as parents } from '../testing/scenes';
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

function reversed(snapshot: Snapshot): Snapshot {
  return { ...snapshot, assets: [...snapshot.assets].reverse() };
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
    expect(result.diff).toMatchObject({ added: [], removed: [], changed: [], ghosts: {}, inside: {} });
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
    const layout = layoutScene(scene);
    const rect = layout.rects[SCRATCH_BUCKET];
    expect(rect?.parent).toBe(DATA_PROJECT);
    for (const [id, other] of Object.entries(layout.rects)) {
      if (id === SCRATCH_BUCKET || other.parent !== DATA_PROJECT || rect === undefined) continue;
      const apart =
        other.x >= rect.x + rect.width ||
        rect.x >= other.x + other.width ||
        other.y >= rect.y + rect.height ||
        rect.y >= other.y + other.height;
      expect(apart, id).toBe(true);
    }
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
