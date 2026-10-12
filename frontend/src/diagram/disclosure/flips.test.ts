// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * Progressive disclosure against the scene builder, on the demo organisations with the real catalog: a flip
 * (the store's `flip`, through the URL hash) XORs the level default, so expanding a chip and collapsing it again
 * gives back the level's own Scene, and so does collapsing an open zone and expanding it again; the builder's own
 * level table (`zoneOpensAt`) predicts which zones of a drawn Scene start collapsed; "Expand all" opens the
 * shallowest collapsed tier and keeps what was open; "Collapse all" goes back to the automatic level's default; the
 * 48-flip cap and an `auto` level change are told apart from every other change.
 */
import { catalog } from '@gcportrait/catalog';
import { buildSceneWithReport, DETAIL_LEVELS, flipIdOf } from '@gcportrait/graph';
import {
  decodeViewSpec,
  normalizeViewSpec,
  VIEW_SPEC_MAX_FLIPS,
  type DemoSize,
  type LensId,
  type Scene,
  type SceneBuild,
  type SceneZone,
  type ViewSpec,
  type ViewSpecInput,
} from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { createAppStore } from '../../state/store';
import { demoGraphSync } from '../testing/demoScenes';
import { sceneZones as allZones, zoneOf as zoneIn } from '../testing/scenes';
import {
  autoLevelShift,
  collapseAllView,
  collapsedByDefault,
  expandAllView,
  flipsDroppedByCap,
  nextOpeningLevel,
  rectsShown,
  zonesByFlip,
  type DrawnView,
} from './flips';

const READ_TIME = '2026-10-08T00:00:00Z';
/** The e2e suite's canvas (1440 × 900 window): 1440 × 724, a budget of 74 rects. */
const BUDGET = 74;
/** A test on demo L builds its Scene several times: about a second, several under coverage. */
const DEMO_L = 30_000;

function build(size: DemoSize, input: ViewSpecInput, budget = BUDGET): SceneBuild {
  return buildSceneWithReport(demoGraphSync(size), normalizeViewSpec(input), catalog, {
    readTime: READ_TIME,
    viewportBudget: budget,
  });
}

function openZoneIds(scene: Scene): string[] {
  return allZones(scene)
    .filter((zone) => zone.collapsed === undefined && zone.children.length > 0)
    .map((zone) => zone.id);
}

/** A store on the diagram route at a hash (no router: writes only change the store). */
function storeAt(hash: string): ReturnType<typeof createAppStore> {
  return createAppStore({ location: { pathname: '/diagram', hash: `#${hash}` } });
}

/** The view a store holds, read back from its hash (what a reload would see). */
function hashView(store: ReturnType<typeof createAppStore>): ViewSpec {
  return decodeViewSpec(store.getState().view.hash);
}

/** A project chip of demo L at the folder level that holds networks. */
function projectChipWithNetworks(scene: Scene): SceneZone {
  const chip = allZones(scene).find((zone) => zone.kind === 'project' && (zone.collapsed?.networks ?? 0) > 0);
  if (chip === undefined) throw new Error('no project chip with networks');
  return chip;
}

describe('a flip XORs the level default (against buildScene)', () => {
  it(
    'expands a project chip of demo L and collapses it again: back to the level default',
    () => {
      const store = storeAt('snapshot=demo:L');
      const base = build('L', store.getState().view.spec);
      expect(base.report.detail.used).toBe('folders');
      const chip = projectChipWithNetworks(base.scene);

      store.actions.flip(chip.id);
      expect(hashView(store).flips).toEqual([flipIdOf(chip.id)]);
      const opened = build('L', store.getState().view.spec);
      // Flips apply after the level is chosen: the level stays.
      expect(opened.report.detail.used).toBe('folders');
      const zone = zoneIn(opened.scene, chip.id);
      expect(zone?.collapsed).toBeUndefined();
      // Inside it, the networks are chips (the folder level closes everything but folders).
      const networks = (zone?.children ?? []).filter(
        (child) => child.type === 'zone' && child.kind === 'vpc',
      );
      expect(networks.length).toBeGreaterThan(0);
      for (const network of networks) expect(network.type === 'zone' && network.collapsed).toBeTruthy();
      expect(opened.scene.metadata.rectCount).toBeGreaterThan(base.scene.metadata.rectCount);
      // Every other chip is still a chip.
      const chips = (scene: Scene): string[] =>
        allZones(scene)
          .filter((candidate) => candidate.collapsed !== undefined)
          .map((candidate) => candidate.id);
      expect(chips(opened.scene)).toEqual(
        expect.arrayContaining(chips(base.scene).filter((id) => id !== chip.id)),
      );

      store.actions.flip(chip.id);
      expect(hashView(store).flips).toEqual([]);
      expect(build('L', store.getState().view.spec)).toEqual(base);
    },
    DEMO_L,
  );

  it(
    'collapses an open folder and expands it again: back to the level default',
    () => {
      const store = storeAt('snapshot=demo:L');
      const base = build('L', store.getState().view.spec);
      const folder = allZones(base.scene).find((zone) => zone.kind === 'folder' && zone.children.length > 0);
      if (folder === undefined) throw new Error('no open folder');
      store.actions.flip(folder.id);
      const closed = build('L', store.getState().view.spec);
      expect(zoneIn(closed.scene, folder.id)?.collapsed).toBeDefined();
      expect(closed.scene.metadata.rectCount).toBeLessThan(base.scene.metadata.rectCount);
      store.actions.flip(folder.id);
      expect(build('L', store.getState().view.spec)).toEqual(base);
    },
    DEMO_L,
  );

  it('opens a zone the depth filter closes, and closes it again (demo M at all, depth 2)', () => {
    const store = storeAt('snapshot=demo:M&detail=all&depth=2');
    const base = build('M', store.getState().view.spec);
    const deep = allZones(base.scene).find((zone) => zone.collapsed !== undefined);
    if (deep === undefined) throw new Error('no zone closed by depth');
    store.actions.flip(deep.id);
    const opened = build('M', store.getState().view.spec);
    expect(zoneIn(opened.scene, deep.id)?.collapsed).toBeUndefined();
    // A flip can open what the depth filter closes: "N of M" never says N > M.
    const counts = rectsShown(opened);
    expect(counts.total).toBeGreaterThanOrEqual(counts.shown);
    store.actions.flip(deep.id);
    expect(build('M', store.getState().view.spec)).toEqual(base);
  });
});

describe('bundles', () => {
  it(
    'carry their member count as a badge, and a flip closes and reopens one like any zone',
    () => {
      const store = storeAt('snapshot=demo:L&lens=everything&detail=all');
      const base = build('L', store.getState().view.spec);
      const bundles = allZones(base.scene).filter((zone) => zone.kind === 'group');
      expect(bundles.length).toBeGreaterThan(0);
      for (const bundle of bundles)
        expect(bundle.badges).toContain(`${String(bundle.children.length)} items`);
      const bundle = bundles[0];
      if (bundle === undefined) throw new Error('no bundle');
      store.actions.flip(bundle.id);
      const closed = build('L', store.getState().view.spec);
      expect(zoneIn(closed.scene, bundle.id)?.collapsed).toBeDefined();
      store.actions.flip(bundle.id);
      expect(build('L', store.getState().view.spec)).toEqual(base);
    },
    DEMO_L,
  );
});

describe('the level table, restated for the page', () => {
  // Demo M at every level; demo L, whose Scenes are ten times larger, at the shallowest and the deepest.
  const L_LEVELS: ReadonlyArray<(typeof DETAIL_LEVELS)[number]> = ['folders', 'all'];
  const VIEWS: ReadonlyArray<readonly [DemoSize, LensId, ViewSpecInput['focus']?]> = [
    ['M', 'overview'],
    ['M', 'networking'],
    ['M', 'everything'],
    ['M', 'serverless', { kind: 'perimeter', params: { perimeter: 'data_perimeter' } }],
    ['L', 'overview'],
    ['L', 'everything'],
  ];

  for (const [size, lens, focus] of VIEWS)
    it(
      `agrees with the scene builder on demo ${size}, ${lens} lens, at ${size === 'L' ? 'folders and all' : 'every level'} and every depth`,
      () => {
        let checked = 0;
        const kinds = new Set<string>();
        for (const level of size === 'L' ? L_LEVELS : DETAIL_LEVELS)
          for (const depth of [undefined, 2]) {
            const input: ViewSpecInput = {
              snapshot: `demo:${size}`,
              lens,
              detail: level,
              ...(focus === undefined ? {} : { focus }),
              ...(depth === undefined ? {} : { filters: { depth } }),
            };
            const shown = build(size, input);
            for (const zone of zonesByFlip(shown).values()) {
              const children = zoneIn(shown.scene, zone.id)?.children.length ?? 0;
              // A zone with nothing inside is never a chip: no default to check.
              if (!zone.collapsed && children === 0) continue;
              expect(
                collapsedByDefault(zone, level, depth),
                `${zone.id} at ${level}, depth ${String(depth)}`,
              ).toBe(zone.collapsed);
              kinds.add(zone.overlay ? 'overlay' : zone.kind);
              checked += 1;
            }
          }
        expect(checked).toBeGreaterThan(20);
        if (focus !== undefined) expect(kinds).toContain('overlay');
        if (size === 'L' && lens === 'everything') expect(kinds).toContain('group');
      },
      DEMO_L,
    );
});

describe('Expand all', () => {
  it(
    'opens the shallowest collapsed tier of demo L, keeping what was opened by hand',
    () => {
      const store = storeAt('snapshot=demo:L');
      const base = build('L', store.getState().view.spec);
      const project = projectChipWithNetworks(base.scene);
      store.actions.flip(project.id);
      const network = zoneIn(build('L', store.getState().view.spec).scene, project.id)?.children.find(
        (child): child is SceneZone => child.type === 'zone' && child.kind === 'vpc',
      );
      if (network === undefined) throw new Error('no network chip');
      store.actions.flip(network.id);
      const spec = store.getState().view.spec;
      const shown = build('L', spec);
      expect(zoneIn(shown.scene, network.id)?.collapsed).toBeUndefined();

      // Folders → projects: the project's flip is redundant there and goes; the network's stays (projects still
      // closes networks), so nothing open closes.
      const projects = expandAllView(spec, shown);
      expect(projects).toMatchObject({ detail: 'projects', flips: [flipIdOf(network.id)] });
      const afterProjects = build('L', projects ?? {});
      expect(afterProjects.report.detail.used).toBe('projects');
      expect(openZoneIds(afterProjects.scene)).toEqual(expect.arrayContaining(openZoneIds(shown.scene)));
      expect(afterProjects.scene.metadata.rectCount).toBeGreaterThan(base.report.detail.rectCounts.projects);

      // Projects → networks: the network's flip is redundant too.
      const networks = expandAllView(normalizeViewSpec(projects ?? {}), afterProjects);
      expect(networks).toMatchObject({ detail: 'networks', flips: [] });
      const afterNetworks = build('L', networks ?? {});
      expect(openZoneIds(afterNetworks.scene)).toEqual(
        expect.arrayContaining(openZoneIds(afterProjects.scene)),
      );
      expect(afterNetworks.scene.metadata.rectCount).toBe(base.report.detail.rectCounts.networks);

      const all = expandAllView(normalizeViewSpec(networks ?? {}), afterNetworks);
      expect(all).toMatchObject({ detail: 'all', flips: [] });
      const afterAll = build('L', all ?? {});
      expect(afterAll.scene.metadata.rectCount).toBe(base.report.detail.rectCounts.all);
      expect(rectsShown(afterAll)).toEqual({ shown: 2497, total: 2497 });
      // Everything is open: nothing more to expand.
      expect(expandAllView(normalizeViewSpec(all ?? {}), afterAll)).toBeNull();
    },
    DEMO_L,
  );

  it('reopens zones closed by hand, also at the deepest level', () => {
    const spec = normalizeViewSpec({ snapshot: 'demo:M', detail: 'all' });
    const base = build('M', spec);
    const project = allZones(base.scene).find((zone) => zone.kind === 'project');
    if (project === undefined) throw new Error('no project');
    const closed = normalizeViewSpec({ ...spec, flips: [flipIdOf(project.id), 'elsewhere1'] });
    const shown = build('M', closed);
    expect(zoneIn(shown.scene, project.id)?.collapsed).toBeDefined();
    // The flip that keeps it closed goes; a flip that names no zone on screen stays.
    const next = expandAllView(closed, shown);
    expect(next).toMatchObject({ detail: 'all', flips: ['elsewhere1'] });
    expect(zoneIn(build('M', next ?? {}).scene, project.id)?.collapsed).toBeUndefined();
  });

  it('skips a level that would open nothing', () => {
    expect(nextOpeningLevel('projects', { folders: 10, projects: 40, networks: 40, all: 90 })).toBe('all');
    expect(nextOpeningLevel('networks', { folders: 10, projects: 40, networks: 90, all: 90 })).toBeNull();
    expect(nextOpeningLevel('folders', { folders: 10, projects: 40, networks: 50, all: 90 })).toBe(
      'projects',
    );
  });
});

describe('Collapse all', () => {
  it(
    'goes back to the automatic level with no flips: demo L’s default again',
    () => {
      const base = build('L', { snapshot: 'demo:L' });
      const project = projectChipWithNetworks(base.scene);
      const spec = normalizeViewSpec({
        snapshot: 'demo:L',
        detail: 'projects',
        flips: [flipIdOf(project.id)],
      });
      const shown = build('L', spec);
      const next = collapseAllView(spec, shown);
      expect(next).toMatchObject({ detail: 'auto', flips: [] });
      expect(build('L', next ?? {})).toEqual(base);
    },
    DEMO_L,
  );

  it(
    'never opens anything: a level shallower than auto’s stays, and only the flips go',
    () => {
      // Demo S never collapses at auto (at most 100 rects), so its folder level stays.
      const spec = normalizeViewSpec({ snapshot: 'demo:S', detail: 'folders', flips: ['k3x9a1'] });
      const shown = build('S', spec);
      expect(shown.report.detail.rectCounts.all).toBeLessThanOrEqual(100);
      expect(collapseAllView(spec, shown)).toMatchObject({ detail: 'folders', flips: [] });
      // Nothing opened by hand and nothing deeper than auto: nothing to do.
      const plain = normalizeViewSpec({ snapshot: 'demo:S', detail: 'folders' });
      expect(collapseAllView(plain, build('S', plain))).toBeNull();
      const auto = normalizeViewSpec({ snapshot: 'demo:L' });
      expect(collapseAllView(auto, build('L', auto))).toBeNull();
    },
    DEMO_L,
  );
});

describe('the 48-flip cap', () => {
  const tokens = (from: number, to: number): string[] =>
    Array.from({ length: to - from }, (_, index) => `t${String(from + index)}`);

  it('tells the flips the cap dropped when the store adds a 49th', () => {
    const store = storeAt(`snapshot=demo:L&flips=${tokens(0, VIEW_SPEC_MAX_FLIPS).join(',')}`);
    const before = store.getState().view.spec.flips;
    expect(before).toHaveLength(VIEW_SPEC_MAX_FLIPS);
    store.actions.flip('//cloudresourcemanager.googleapis.com/projects/10000000001');
    const after = store.getState().view.spec.flips;
    expect(after).toHaveLength(VIEW_SPEC_MAX_FLIPS);
    expect(flipsDroppedByCap(before, after)).toEqual(['t0']);
    // Back below the cap by removing a flip: nothing dropped.
    store.actions.flip('//cloudresourcemanager.googleapis.com/projects/10000000001');
    expect(flipsDroppedByCap(after, store.getState().view.spec.flips)).toEqual([]);
  });

  it('counts nothing else: a collapse, a reset, a view with other flips, a list under the cap', () => {
    const full = tokens(0, 48);
    expect(flipsDroppedByCap(full, full.slice(1))).toEqual([]);
    expect(flipsDroppedByCap(full, [])).toEqual([]);
    expect(flipsDroppedByCap(full, tokens(100, 148))).toEqual([]);
    expect(flipsDroppedByCap(tokens(0, 10), [...tokens(0, 10), 'n'])).toEqual([]);
    expect(flipsDroppedByCap(full, [...full.slice(2), 'a', 'b'])).toEqual(['t0', 't1']);
    expect(flipsDroppedByCap(full, [...full.slice(1, 47), 't0', 'n'].slice(0, 48))).toEqual([]);
  });
});

describe('an auto level change', () => {
  const drawn = (key: string, input: ViewSpecInput, budget: number): DrawnView => ({
    key,
    answer: build('M', input, budget),
  });

  it('is told when the same view was drawn again at another auto level', () => {
    // Demo M's networking lens: 42 rects at folders, 97 at projects.
    const input: ViewSpecInput = { snapshot: 'demo:M', lens: 'networking' };
    const small = drawn('k', input, 74);
    const large = drawn('k', input, 124);
    expect(small.answer.report.detail.used).toBe('folders');
    expect(large.answer.report.detail.used).toBe('projects');
    expect(autoLevelShift(small, large)).toEqual({ from: 'folders', to: 'projects', larger: true });
    expect(autoLevelShift(large, small)).toEqual({ from: 'projects', to: 'folders', larger: false });
  });

  it('is not told for another view, a level chosen by hand, the same drawing or the first one', () => {
    const input: ViewSpecInput = { snapshot: 'demo:M', lens: 'networking' };
    const small = drawn('k', input, 74);
    expect(autoLevelShift(small, drawn('other', input, 124))).toBeNull();
    expect(
      autoLevelShift(
        drawn('k', { ...input, detail: 'folders' }, 74),
        drawn('k', { ...input, detail: 'projects' }, 74),
      ),
    ).toBeNull();
    expect(autoLevelShift(small, small)).toBeNull();
    expect(autoLevelShift(null, small)).toBeNull();
    expect(autoLevelShift(small, drawn('k', input, 80))).toBeNull();
  });
});
