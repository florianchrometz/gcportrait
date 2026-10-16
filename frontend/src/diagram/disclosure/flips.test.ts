// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * Progressive disclosure against the scene builder, on the demo organisations with the real catalog: a flip
 * (the store's `flip`, through the URL hash) XORs the level default, so expanding a chip and collapsing it again
 * gives back the level's own Scene, and so does collapsing an open zone and expanding it again; the builder's own
 * level table (`zoneOpensAt`) predicts which zones of a drawn Scene start collapsed; "Expand all" opens the
 * shallowest collapsed tier and keeps what was open; "Collapse all" goes back to the automatic level's default; each
 * is inert exactly when the view it writes draws the Scene on screen (a property over random views and flips, a
 * zone drawn empty among them, whose flip each keeps as the person's choice), and on a timeline day exactly when it
 * also draws the same ghosts (a property over demo M's days); the 48-flip cap and an `auto` level change are told
 * apart from every other change.
 */
import { catalog } from '@gcportrait/catalog';
import {
  buildPreparedScene,
  buildSceneWithReport,
  DETAIL_LEVELS,
  flipIdOf,
  prepareView,
  preparedViewKey,
  type PreparedView,
} from '@gcportrait/graph';
import {
  decodeViewSpec,
  LENS_IDS,
  normalizeViewSpec,
  VIEW_SPEC_MAX_FLIPS,
  type DemoSize,
  type Graph,
  type LensId,
  type Scene,
  type SceneBuild,
  type SceneEnv,
  type SceneZone,
  type ViewSpec,
  type ViewSpecInput,
} from '@gcportrait/model';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';

import { createAppStore } from '../../state/store';
import { autoLevel } from '../autoDetail';
import { tickDiff } from '../diff/tickDiff';
import { demoHistory } from '../pipeline/demo';
import { demoDayGraph, demoGraphSync, sceneEnv } from '../testing/demoScenes';
import { sceneZones as allZones, zoneOf as zoneIn } from '../testing/scenes';
import {
  autoLevelShift,
  collapseAllTarget,
  collapseAllView,
  collapsedByDefault,
  expandAllTarget,
  expandAllView,
  flipsDroppedByCap,
  nextOpeningLevel,
  rectsShown,
  zonesByFlip,
  type DrawnView,
  type ShownScene,
} from './flips';

const READ_TIME = '2026-10-08T00:00:00Z';
/** The e2e suite's canvas (1440 × 900 window): 1440 × 724, a budget of 74 rects. */
const BUDGET = 74;
/** A test on demo L builds its Scene several times: about a second, several under coverage. */
const DEMO_L = 30_000;
/** Demo M's and L's Shared VPC host (Production): a project with a network, subnets and product containers. */
const SHARED_VPC_HOST = '//cloudresourcemanager.googleapis.com/projects/10000000001';
/** A project of demo M and L that holds no network: the networking lens draws it empty. */
const NO_NETWORK = '//cloudresourcemanager.googleapis.com/projects/10000000018';
/** Detail `auto` and every level. */
const LEVELS = ['auto', ...DETAIL_LEVELS] as const;

function build(size: DemoSize, input: ViewSpecInput, budget = BUDGET): SceneBuild {
  return buildSceneWithReport(demoGraphSync(size), normalizeViewSpec(input), catalog, {
    readTime: READ_TIME,
    viewportBudget: budget,
  });
}

/** The preparations of the views built by `buildView`, by organisation and prepared-view key. */
const prepared = new Map<string, PreparedView>();
const ENV = { readTime: READ_TIME, viewportBudget: BUDGET };

/**
 * What `build` builds, from one preparation per lens, focus, root and filters: views that differ only in their
 * level, flips or `depth` filter share it.
 */
function buildView(size: DemoSize, input: ViewSpecInput): SceneBuild {
  const spec = normalizeViewSpec(input);
  const key = `${size} ${preparedViewKey(spec, ENV)}`;
  let view = prepared.get(key);
  if (view === undefined) {
    view = prepareView(demoGraphSync(size), spec, catalog, ENV);
    prepared.set(key, view);
  }
  return buildPreparedScene(view, spec, ENV);
}

/** The open zones that hold something (an empty zone is never a chip), and the chips. */
function drawn(shown: SceneBuild): { readonly open: Set<string>; readonly chips: Set<string> } {
  const zones = allZones(shown.scene);
  return {
    open: new Set(zones.filter((z) => z.collapsed === undefined && z.children.length > 0).map((z) => z.id)),
    chips: new Set(zones.filter((z) => z.collapsed !== undefined).map((z) => z.id)),
  };
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

  it('opens the shallowest level at which a chip on screen opens, skipping a level that opens nothing there', () => {
    const level = (input: ViewSpecInput): string | null => {
      const spec = normalizeViewSpec(input);
      return nextOpeningLevel(spec, build('M', spec));
    };
    expect(level({ snapshot: 'demo:M', detail: 'folders' })).toBe('projects');
    // Drilled into a project: its networks and product containers are chips, and the projects level opens none.
    expect(level({ snapshot: 'demo:M', root: SHARED_VPC_HOST, detail: 'folders' })).toBe('networks');
    expect(level({ snapshot: 'demo:M', root: SHARED_VPC_HOST, detail: 'projects' })).toBe('networks');
    expect(level({ snapshot: 'demo:M', detail: 'all' })).toBeNull();
    // A zone closed by hand is reopened, not opened by a level.
    expect(level({ snapshot: 'demo:M', detail: 'all', flips: [flipIdOf(SHARED_VPC_HOST)] })).toBeNull();
  });
});

describe('at project level: a view rooted at or focused on one project', () => {
  /**
   * "Expand all" from `spec`: inert exactly when no chip is on screen (no `depth` filter here); otherwise every open
   * zone stays open and a chip opens. Returns the view it wrote, or null.
   */
  function expandChecked(size: DemoSize, spec: ViewSpec, what: string): ViewSpec | null {
    const shown = buildView(size, spec);
    const before = drawn(shown);
    const next = expandAllView(spec, shown);
    expect(next === null, `Expand all inert: ${what}`).toBe(before.chips.size === 0);
    if (next === null) return null;
    const after = drawn(buildView(size, next));
    for (const id of before.open) expect(after.open.has(id), `Expand all closed ${id}: ${what}`).toBe(true);
    expect(
      [...before.chips].some((id) => after.open.has(id)),
      `Expand all opened nothing: ${what}`,
    ).toBe(true);
    return normalizeViewSpec(next);
  }

  /**
   * "Collapse all" from `spec`: inert exactly when the view at its target level without the flips that open
   * zones (the builder's own defaults) closes no open zone; otherwise no chip opens and an open zone closes.
   */
  function collapseChecked(size: DemoSize, spec: ViewSpec, what: string): ViewSpec | null {
    const shown = buildView(size, spec);
    const before = drawn(shown);
    const { detail } = shown.report;
    const automatic = autoLevel(detail, detail.budget);
    const target =
      spec.detail !== 'auto' && DETAIL_LEVELS.indexOf(automatic) < DETAIL_LEVELS.indexOf(detail.used)
        ? automatic
        : detail.used;
    const opened = new Set([...before.open].map((id) => flipIdOf(id)));
    const reset = drawn(
      buildView(size, { ...spec, detail: target, flips: spec.flips.filter((token) => !opened.has(token)) }),
    );
    const closes = [...before.open].some((id) => !reset.open.has(id));
    const next = collapseAllView(spec, shown);
    expect(next !== null, `Collapse all available: ${what}`).toBe(closes);
    if (next === null) return null;
    const after = drawn(buildView(size, next));
    for (const id of before.chips)
      expect(after.open.has(id), `Collapse all opened ${id}: ${what}`).toBe(false);
    expect(
      [...before.open].some((id) => !after.open.has(id)),
      `Collapse all closed nothing: ${what}`,
    ).toBe(true);
    return normalizeViewSpec(next);
  }

  /** Presses `press` until it is inert (at most five times): the last view. */
  function pressUntilInert(
    press: (spec: ViewSpec, what: string) => ViewSpec | null,
    spec: ViewSpec,
    what: string,
  ): ViewSpec {
    let current = spec;
    for (let count = 1; count <= 5; count += 1) {
      const next = press(current, `${what}, press ${String(count)}`);
      if (next === null) return current;
      current = next;
    }
    throw new Error(`still not inert after five presses: ${what}`);
  }

  const VIEWS: ReadonlyArray<readonly [DemoSize, string, LensId?]> = [
    ['M', SHARED_VPC_HOST],
    // Retail platform (prod): product containers and cards, no network.
    ['M', '//cloudresourcemanager.googleapis.com/projects/10000000010'],
    // Retail services (prod): cards only.
    ['M', '//cloudresourcemanager.googleapis.com/projects/10000000011'],
    // A project the networking lens draws empty.
    ['M', NO_NETWORK, 'networking'],
    ['L', SHARED_VPC_HOST],
  ];

  for (const [size, project, lens] of VIEWS)
    for (const mode of ['root', 'focus'] as const)
      it(
        `demo ${size}, ${mode} ${project.slice(project.lastIndexOf('/') + 1)}${lens === undefined ? '' : `, ${lens} lens`}: Expand all and Collapse all at every level, by hand flips or none`,
        () => {
          let cases = 0;
          for (const level of LEVELS) {
            const view: ViewSpecInput = {
              snapshot: `demo:${size}`,
              detail: level,
              ...(lens === undefined ? {} : { lens }),
              ...(mode === 'root' ? { root: project } : { focus: { kind: 'project', params: { project } } }),
            };
            const plain = buildView(size, view);
            const { open, chips } = drawn(plain);
            const opened = [...chips].slice(0, 1).map((id) => flipIdOf(id));
            const closed = [...open].slice(-1).map((id) => flipIdOf(id));
            const empty = [...zonesByFlip(plain)].flatMap(([token, zone]) => (zone.empty ? [token] : []));
            const variants: ReadonlyArray<readonly [string, readonly string[]]> = [
              ['no flips', []],
              ['a chip opened by hand', opened],
              ['a zone closed by hand', closed],
              ['both', [...opened, ...closed]],
              // A flip of the organisation's view (another project's), which this view does not hold.
              [
                'another view’s flip',
                [flipIdOf('//cloudresourcemanager.googleapis.com/projects/10000000002')],
              ],
              // Flips the scene builder ignores: a zone with nothing inside is never a chip.
              ['flips of zones drawn empty', empty],
            ];
            for (const [name, flips] of variants) {
              if (name !== 'no flips' && flips.length === 0) continue;
              const spec = normalizeViewSpec({ ...view, flips: [...flips] });
              const what = `${mode} at ${level}, ${name}`;
              // Each alone, then one after the other, then each until it is inert.
              const expanded = expandChecked(size, spec, what);
              const collapsed = collapseChecked(size, spec, what);
              if (expanded !== null) collapseChecked(size, expanded, `${what}, expanded`);
              if (collapsed !== null) expandChecked(size, collapsed, `${what}, collapsed`);
              const all = pressUntilInert(
                (current, label) => expandChecked(size, current, label),
                spec,
                what,
              );
              expect(drawn(buildView(size, all)).chips.size, `everything open: ${what}`).toBe(0);
              const none = pressUntilInert(
                (current, label) => collapseChecked(size, current, label),
                all,
                what,
              );
              // Collapse all after Expand all: a zone closed by hand stays open (Expand all reopened it), and
              // another view's flips are never touched.
              expect(none.flips.filter((token) => !flips.includes(token))).toEqual([]);
              cases += 1;
            }
          }
          expect(cases).toBeGreaterThanOrEqual(LEVELS.length);
        },
        DEMO_L,
      );

  it('closing zones by hand at Auto (everything open): Collapse all keeps them closed, Expand all reopens them', () => {
    const view: ViewSpecInput = {
      snapshot: 'demo:M',
      focus: { kind: 'project', params: { project: SHARED_VPC_HOST } },
    };
    const open = buildView('M', view);
    expect(open.report.detail.used).toBe('all');
    const zones = allZones(open.scene).filter((zone) => zone.children.length > 0);
    const network = zones.find((zone) => zone.kind === 'vpc');
    if (network === undefined) throw new Error('no network');
    const spec = normalizeViewSpec({ ...view, flips: [flipIdOf(network.id), flipIdOf(SHARED_VPC_HOST)] });
    const shown = buildView('M', spec);
    expect(zoneIn(shown.scene, SHARED_VPC_HOST)?.collapsed).toBeDefined();
    expect(collapseAllView(spec, shown)).toBeNull();
    const expanded = expandAllView(spec, shown);
    expect(expanded).toMatchObject({ detail: 'auto', flips: [flipIdOf(network.id)] });
    // The network is hidden in the project's chip; once the project is open it shows closed, and Expand all
    // reopens it too.
    const again = normalizeViewSpec(expanded ?? {});
    expect(expandAllView(again, buildView('M', again))).toMatchObject({ detail: 'auto', flips: [] });
  });

  it('a flip the drill-in left behind (the project itself, now the canvas) changes nothing here', () => {
    const spec = normalizeViewSpec({
      snapshot: 'demo:M',
      root: SHARED_VPC_HOST,
      flips: [flipIdOf(SHARED_VPC_HOST)],
    });
    const shown = buildView('M', spec);
    expect(shown.report.unknownFlips).toEqual([flipIdOf(SHARED_VPC_HOST)]);
    expect(expandAllView(spec, shown)).toBeNull();
    expect(collapseAllView(spec, shown)).toBeNull();
  });

  it('a level carried in from the organisation (Expand all there, then a drill-in): Expand all opens on, and Collapse all, with Auto opening everything here, has nothing deeper than Auto to close', () => {
    const spec = normalizeViewSpec({ snapshot: 'demo:M', root: SHARED_VPC_HOST, detail: 'projects' });
    const shown = buildView('M', spec);
    expect(autoLevel(shown.report.detail, shown.report.detail.budget)).toBe('all');
    expect(collapseAllView(spec, shown)).toBeNull();
    const next = expandAllView(spec, shown);
    expect(next).toMatchObject({ detail: 'networks', flips: [] });
    const all = normalizeViewSpec(next ?? {});
    expect(collapseAllView(all, buildView('M', all))).toBeNull();
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
    'never opens anything: a level shallower than auto’s stays, and so does a zone closed by hand',
    () => {
      // Demo S never collapses at auto (at most 100 rects), so its folder level stays; its project chips stay.
      const folder = allZones(build('S', { snapshot: 'demo:S', detail: 'all' }).scene).find(
        (zone) => zone.kind === 'folder',
      );
      if (folder === undefined) throw new Error('no folder');
      const spec = normalizeViewSpec({ snapshot: 'demo:S', detail: 'folders', flips: [flipIdOf(folder.id)] });
      const shown = build('S', spec);
      expect(shown.report.detail.rectCounts.all).toBeLessThanOrEqual(100);
      // The folder closed by hand stays closed, so nothing would close: nothing to do.
      expect(zoneIn(shown.scene, folder.id)?.collapsed).toBeDefined();
      expect(collapseAllView(spec, shown)).toBeNull();
      // Nothing opened by hand and nothing deeper than auto: nothing to do.
      const plain = normalizeViewSpec({ snapshot: 'demo:S', detail: 'folders' });
      expect(collapseAllView(plain, build('S', plain))).toBeNull();
      const auto = normalizeViewSpec({ snapshot: 'demo:L' });
      expect(collapseAllView(auto, build('L', auto))).toBeNull();
    },
    DEMO_L,
  );

  it(
    'closes what was opened by hand and keeps what was closed by hand, at auto on demo L',
    () => {
      const base = build('L', { snapshot: 'demo:L' });
      const project = projectChipWithNetworks(base.scene);
      // An open folder that does not hold the project.
      const folder = allZones(base.scene).find(
        (zone) =>
          zone.kind === 'folder' &&
          zone.children.length > 0 &&
          !allZones(zone.children).some((inner) => inner.id === project.id),
      );
      if (folder === undefined) throw new Error('no open folder');
      const spec = normalizeViewSpec({
        snapshot: 'demo:L',
        flips: [flipIdOf(project.id), flipIdOf(folder.id), 'elsewhere1'],
      });
      const shown = build('L', spec);
      expect(shown.report.unknownFlips).toEqual(['elsewhere1']);
      const next = collapseAllView(spec, shown);
      // The project opened by hand closes; the folder closed by hand stays closed; another view's flip stays.
      expect(next).toMatchObject({ detail: 'auto', flips: [flipIdOf(folder.id), 'elsewhere1'] });
      const after = build('L', next ?? {});
      expect(zoneIn(after.scene, folder.id)?.collapsed).toBeDefined();
      expect(openZoneIds(after.scene)).not.toContain(project.id);
      expect(collapseAllView(normalizeViewSpec(next ?? {}), after)).toBeNull();
    },
    DEMO_L,
  );

  it('goes back to auto at the canvas’s budget, which a level chosen by hand never redraws at', () => {
    // Demo M's networking lens: auto is the folder level at a budget of 74, the projects level at 124.
    const spec = normalizeViewSpec({ snapshot: 'demo:M', lens: 'networking', detail: 'networks' });
    const shown = build('M', spec, 74);
    expect(collapseAllView(spec, shown)).toMatchObject({ detail: 'auto' });
    expect(collapseAllView(spec, shown, 124)).toMatchObject({ detail: 'auto' });
    // At a budget where auto opens the networks level itself, there is nothing deeper than auto to close.
    expect(autoLevel(shown.report.detail, 400)).toBe('networks');
    expect(collapseAllView(spec, shown, 400)).toBeNull();
  });
});

describe('a zone drawn empty: its flip changes nothing on screen', () => {
  it('demo M focused on a project the networking lens empties: with its flip, both buttons are inert at every level', () => {
    for (const detail of LEVELS) {
      const view: ViewSpecInput = {
        snapshot: 'demo:M',
        lens: 'networking',
        detail,
        focus: { kind: 'project', params: { project: NO_NETWORK } },
      };
      const plain = buildView('M', view);
      expect(zonesByFlip(plain).get(flipIdOf(NO_NETWORK))?.empty, detail).toBe(true);
      const spec = normalizeViewSpec({ ...view, flips: [flipIdOf(NO_NETWORK)] });
      const shown = buildView('M', spec);
      // The scene builder ignores the flip.
      expect(shown.scene).toEqual(plain.scene);
      expect(expandAllView(spec, shown), `Expand all at ${detail}`).toBeNull();
      expect(collapseAllView(spec, shown), `Collapse all at ${detail}`).toBeNull();
    }
  });

  it('a zone that holds only a timeline day’s ghosts is drawn empty: Collapse all has nothing to close in it', () => {
    // Demo M's Shared VPC host as the canvas at the projects level (Auto opens everything here, so Collapse all keeps
    // the level), with its network opened by hand.
    const view: ViewSpecInput = { snapshot: 'demo:M', root: SHARED_VPC_HOST, detail: 'projects' };
    const chip = allZones(buildView('M', view).scene).find(
      (zone) => zone.kind === 'vpc' && zone.collapsed !== undefined,
    );
    if (chip === undefined) throw new Error('no network chip');
    const spec = normalizeViewSpec({ ...view, flips: [flipIdOf(chip.id)] });
    const shown = buildView('M', spec);
    const children = zoneIn(shown.scene, chip.id)?.children ?? [];
    expect(children.length).toBeGreaterThan(0);
    expect(collapseAllView(spec, shown)).toMatchObject({ detail: 'projects', flips: [] });
    // What it holds stands in for a day's ghosts: the drawn day's builder saw the network empty and ignores its
    // flip, which Collapse all keeps as the person's choice; the earlier day still draws the network open, so its
    // ghosts stay and nothing on screen would close.
    const ghosts = Object.fromEntries(children.map((child) => [child.id, 'removed' as const]));
    const withGhosts = { ...shown, diff: { ghosts } };
    expect(zonesByFlip(withGhosts).get(flipIdOf(chip.id))).toMatchObject({ empty: true, ghosts: true });
    expect(collapseAllTarget(spec, withGhosts)).toMatchObject({ flips: [flipIdOf(chip.id)] });
    expect(collapseAllView(spec, withGhosts)).toBeNull();
  });
});

describe('a flip on a zone drawn empty is the person’s choice for when it holds something again', () => {
  /** Demo M at the projects level, with the project that holds no network closed by hand. */
  const CLOSED: ViewSpecInput = { snapshot: 'demo:M', detail: 'projects', flips: [flipIdOf(NO_NETWORK)] };

  /** Demo M under the networking lens, which draws that project empty, with the flips given. */
  function networking(input: ViewSpecInput): { readonly spec: ViewSpec; readonly shown: SceneBuild } {
    const spec = normalizeViewSpec({ ...input, lens: 'networking' });
    const shown = buildView('M', spec);
    expect(zonesByFlip(shown).get(flipIdOf(NO_NETWORK))?.empty).toBe(true);
    return { spec, shown };
  }

  /** A network chip of a view: something for a button to open, or, opened by hand, to close. */
  function networkChip(input: ViewSpecInput): string {
    const chip = allZones(buildView('M', input).scene).find(
      (zone) => zone.kind === 'vpc' && zone.collapsed !== undefined,
    );
    if (chip === undefined) throw new Error('no network chip');
    return chip.id;
  }

  /** Whether NO_NETWORK is a chip in the view, back under the overview lens. */
  const closedOnOverview = (input: ViewSpecInput): boolean =>
    zoneIn(buildView('M', { ...input, lens: 'overview' }).scene, NO_NETWORK)?.collapsed !== undefined;

  it('Collapse all keeps the flip: closed by hand, the project is still closed back on the first lens', () => {
    expect(closedOnOverview(CLOSED)).toBe(true);
    // A network opened by hand under the networking lens gives Collapse all something to close.
    const network = flipIdOf(networkChip({ ...CLOSED, lens: 'networking', flips: [] }));
    const { spec, shown } = networking({ ...CLOSED, flips: [flipIdOf(NO_NETWORK), network] });
    // At a budget where Auto is the projects level the level stays.
    const next = collapseAllView(spec, shown, 124);
    expect(next).toMatchObject({ detail: 'projects', flips: [flipIdOf(NO_NETWORK)] });
    expect(closedOnOverview(next ?? {})).toBe(true);
  });

  it('Collapse all back to Auto lets the flip go where the new level closes the project anyway, so it stays closed', () => {
    const { spec, shown } = networking(CLOSED);
    const next = collapseAllView(spec, shown);
    expect(next).toMatchObject({ detail: 'auto', flips: [] });
    expect(buildView('M', { ...next, lens: 'overview' }).report.detail.used).toBe('folders');
    expect(closedOnOverview(next ?? {})).toBe(true);
    // Kept, the flip would say the opposite at the folder level: opened by hand.
    expect(closedOnOverview({ ...next, flips: [flipIdOf(NO_NETWORK)] })).toBe(false);
  });

  it('Expand all keeps a closing flip, and lets an opening one go where the new level opens the project anyway', () => {
    // Closed by hand at the projects level: Expand all opens the networks level and the project stays closed.
    const { spec, shown } = networking(CLOSED);
    const next = expandAllView(spec, shown);
    expect(next).toMatchObject({ detail: 'networks', flips: [flipIdOf(NO_NETWORK)] });
    expect(closedOnOverview(next ?? {})).toBe(true);
    // Opened by hand at the folder level: Expand all opens the projects level, which opens the project anyway.
    const opened: ViewSpecInput = { snapshot: 'demo:M', detail: 'folders', flips: [flipIdOf(NO_NETWORK)] };
    expect(closedOnOverview(opened)).toBe(false);
    const folders = networking(opened);
    const projects = expandAllView(folders.spec, folders.shown);
    expect(projects).toMatchObject({ detail: 'projects', flips: [] });
    expect(closedOnOverview(projects ?? {})).toBe(false);
  });
});

describe('each button is inert exactly when the view it writes draws the Scene on screen (property)', () => {
  /** Where a view looks: the organisation, a drill-in, and a focus of each kind that demo M and L both hold. */
  const PLACES: ReadonlyArray<Pick<ViewSpecInput, 'root' | 'focus'>> = [
    {},
    { root: SHARED_VPC_HOST },
    { focus: { kind: 'project', params: { project: NO_NETWORK } } },
    { focus: { kind: 'project', params: { project: SHARED_VPC_HOST } } },
    { focus: { kind: 'shared-vpc', params: { host: SHARED_VPC_HOST } } },
    { focus: { kind: 'standalone-projects', params: {} } },
    { focus: { kind: 'perimeter', params: { perimeter: 'data_perimeter' } } },
  ];
  /** Where a flip comes from: a zone drawn empty, a zone on screen, any zone of the view, another view. */
  const SOURCES = ['empty', 'shown', 'any', 'elsewhere'] as const;
  // Up to four flips: mostly one of a zone drawn empty (when the view has one), and up to three from anywhere.
  const views = fc.record({
    lens: fc.constantFrom(...LENS_IDS),
    place: fc.constantFrom(...PLACES),
    detail: fc.constantFrom(...LEVELS),
    depth: fc.constantFrom(undefined, 2),
    empty: fc.option(fc.nat(), { nil: undefined, freq: 4 }),
    picks: fc.array(fc.tuple(fc.constantFrom(...SOURCES), fc.nat()), { maxLength: 3 }),
  });
  /** Random views per organisation: demo L's Scenes are ten times larger, so it gets fewer. */
  const RUNS: ReadonlyArray<readonly [DemoSize, number]> = [
    ['M', 100],
    ['L', 40],
  ];

  for (const [size, numRuns] of RUNS)
    it(
      `on demo ${size} across lenses, focus views, levels, the depth filter and flips: Expand all never closes, Collapse all never opens, and a zone drawn empty keeps its flip’s meaning`,
      () => {
        let emptyFlips = 0;
        fc.assert(
          fc.property(views, ({ lens, place, detail, depth, empty, picks }) => {
            const base: ViewSpecInput = {
              snapshot: `demo:${size}`,
              lens,
              detail,
              ...place,
              ...(depth === undefined ? {} : { filters: { depth } }),
            };
            const onScreen = zonesByFlip(buildView(size, base));
            const sources: Readonly<Record<(typeof SOURCES)[number], readonly string[]>> = {
              empty: [...onScreen].flatMap(([token, zone]) => (zone.empty ? [token] : [])),
              shown: [...onScreen.keys()],
              // Every zone of the view: at `all` without the depth filter nothing is a chip.
              any: [...zonesByFlip(buildView(size, { ...base, detail: 'all', filters: {} })).keys()],
              elsewhere: ['elsewhere1'],
            };
            const flips = new Set(
              [...(empty === undefined ? [] : [['empty', empty] as const]), ...picks].flatMap(
                ([source, index]) => {
                  const list = sources[source];
                  const token = list[index % Math.max(list.length, 1)];
                  return token === undefined ? [] : [token];
                },
              ),
            );
            const spec = normalizeViewSpec({ ...base, flips: [...flips] });
            const shown = buildView(size, spec);
            const scene = JSON.stringify(shown.scene);
            const before = drawn(shown);
            const what = JSON.stringify({ lens, ...place, detail, depth, flips: spec.flips });
            const emptyZones = [...zonesByFlip(shown)].filter(([, zone]) => zone.empty);
            if (emptyZones.some(([token]) => flips.has(token))) emptyFlips += 1;

            /**
             * A press leaves the flip of a zone drawn empty as it is while the level stays, never adds one, and lets
             * one go only where the level written gives the zone that state by default: what the flip meant stays.
             */
            const keepsEmptyFlips = (target: ViewSpecInput, written: SceneBuild, press: string): void => {
              const next = new Set(normalizeViewSpec(target).flips);
              const level = written.report.detail.used;
              const used = shown.report.detail.used;
              for (const [token, zone] of emptyZones) {
                const label = `${press}, ${zone.id}: ${what}`;
                if (!flips.has(token)) {
                  expect(next.has(token), `${label} gained a flip`).toBe(false);
                  continue;
                }
                if (level === used) expect(next.has(token), `${label} lost its flip`).toBe(true);
                // Collapsed by the flip where its level opens the zone, open where its level closes it.
                const meant = !collapsedByDefault(zone, used, depth);
                expect(collapsedByDefault(zone, level, depth) !== next.has(token), label).toBe(meant);
              }
            };

            const expandTarget = expandAllTarget(spec, shown);
            const expanded = buildView(size, expandTarget);
            const expand = expandAllView(spec, shown);
            expect(expand === null, `Expand all inert: ${what}`).toBe(
              JSON.stringify(expanded.scene) === scene,
            );
            keepsEmptyFlips(expandTarget, expanded, 'Expand all');
            if (expand !== null) {
              expect(expand).toEqual(expandTarget);
              const after = drawn(expanded);
              for (const id of before.open)
                expect(after.open.has(id), `Expand all closed ${id}: ${what}`).toBe(true);
            }

            const collapseTarget = collapseAllTarget(spec, shown);
            const collapsed = buildView(size, collapseTarget);
            const collapse = collapseAllView(spec, shown);
            expect(collapse === null, `Collapse all inert: ${what}`).toBe(
              JSON.stringify(collapsed.scene) === scene,
            );
            keepsEmptyFlips(collapseTarget, collapsed, 'Collapse all');
            if (collapse !== null) {
              expect(collapse).toEqual(collapseTarget);
              const after = drawn(collapsed);
              for (const id of before.chips)
                expect(after.open.has(id), `Collapse all opened ${id}: ${what}`).toBe(false);
            }
          }),
          { numRuns },
        );
        expect(emptyFlips).toBeGreaterThan(0);
      },
      DEMO_L,
    );
});

describe('on a timeline day the ghosts count', () => {
  beforeAll(async () => {
    await import('../pipeline/demo');
  });

  /** Demo M's reports project, marked for deletion on 2026-09-17, when what it held is gone. */
  const REPORTS = '//cloudresourcemanager.googleapis.com/projects/10000000008';
  /** The preparations of the views built on each day's Graph, by prepared-view key. */
  const dayViews = new WeakMap<Graph, Map<string, PreparedView>>();

  /** The scene builder on one day's Graph, through one preparation per lens, focus, root and filters. */
  function buildOn(graph: Graph, spec: ViewSpec, env: SceneEnv): SceneBuild {
    let views = dayViews.get(graph);
    if (views === undefined) {
      views = new Map();
      dayViews.set(graph, views);
    }
    const key = preparedViewKey(spec, env);
    let view = views.get(key);
    if (view === undefined) {
      view = prepareView(graph, spec, catalog, env);
      views.set(key, view);
    }
    return buildPreparedScene(view, spec, env);
  }

  interface DayDrawing {
    /** The drawn day's Scene, as the scene builder made it for the view. */
    readonly built: SceneBuild;
    /** What is on screen: that Scene with the ghosts, compared with the day before. */
    readonly shown: ShownScene & { readonly diff: ReturnType<typeof tickDiff>['diff'] };
  }

  /** Demo M's day `day` for a view, compared with day `since` as the data worker compares it. */
  async function dayDrawing(since: string, day: string, input: ViewSpecInput): Promise<DayDrawing> {
    const [before, after] = await Promise.all([demoDayGraph('M', since), demoDayGraph('M', day)]);
    const spec = normalizeViewSpec(input);
    const envBefore = sceneEnv(before.snapshot, BUDGET);
    const envAfter = sceneEnv(after.snapshot, BUDGET);
    const built = buildOn(after.graph, spec, envAfter);
    const { scene, diff } = tickDiff({
      before: { snapshot: before.snapshot, graph: before.graph, tick: since },
      after: { snapshot: after.snapshot, graph: after.graph, tick: day },
      spec,
      scene: built.scene,
      report: built.report,
      catalog,
      envBefore,
      envAfter,
      build: buildOn,
    });
    return { built, shown: { scene, report: built.report, diff } };
  }

  /** What a day's drawing shows: the Scene with its ghosts, and what the chips count inside them. */
  const picture = (drawing: DayDrawing): string =>
    JSON.stringify([drawing.shown.scene, drawing.shown.diff.inside]);

  /** Every open zone with something inside that the automatic level closes, closed by hand. */
  function closedAboveAuto(built: SceneBuild, depth: number | undefined): string[] {
    const automatic = autoLevel(built.report.detail, built.report.detail.budget);
    return [...zonesByFlip(built)].flatMap(([token, zone]) =>
      !zone.collapsed && !zone.empty && collapsedByDefault(zone, automatic, depth) ? [token] : [],
    );
  }

  it('Collapse all back to Auto that leaves every zone of the view as it is still turns an open ghost into a chip: it is live', async () => {
    // The networking lens at the projects level, every project with something inside closed by hand: only the
    // reports project's ghost, open with its network, opens at a level deeper than Auto's.
    const view: ViewSpecInput = { snapshot: 'demo:M', lens: 'networking', detail: 'projects' };
    const plain = await dayDrawing('2026-09-16', '2026-09-17', view);
    const spec = normalizeViewSpec({ ...view, flips: closedAboveAuto(plain.built, undefined) });
    const drawing = await dayDrawing('2026-09-16', '2026-09-17', spec);
    expect(drawing.shown.diff.ghosts[REPORTS]).toBe('hidden');
    const ghost = zoneIn(drawing.shown.scene, REPORTS);
    expect(ghost?.collapsed).toBeUndefined();
    expect(ghost?.children.length).toBeGreaterThan(0);

    const target = collapseAllTarget(spec, drawing.shown);
    expect(target).toMatchObject({ detail: 'auto', flips: [] });
    const after = await dayDrawing('2026-09-16', '2026-09-17', target);
    // The drawn day's Scene stays as it is; the earlier day, built at the folder level, draws the project as a chip.
    expect(after.built.scene).toEqual(drawing.built.scene);
    expect(after.built.report.detail.used).toBe('folders');
    expect(Object.keys(after.shown.diff.ghosts)).toEqual([REPORTS]);
    expect(zoneIn(after.shown.scene, REPORTS)?.collapsed).toBeDefined();
    expect(collapseAllView(spec, drawing.shown)).toEqual(target);
    // Without the ghosts the same press would change nothing.
    expect(collapseAllView(spec, drawing.built)).toBeNull();
  });

  it('a zone of the view that holds only ghosts loses them when the level written closes it on the earlier day', async () => {
    // The everything lens draws the reports project marked for deletion, its contents gone: ghosts only.
    const view: ViewSpecInput = { snapshot: 'demo:M', lens: 'everything', detail: 'projects' };
    const plain = await dayDrawing('2026-09-16', '2026-09-17', view);
    const spec = normalizeViewSpec({ ...view, flips: closedAboveAuto(plain.built, undefined) });
    const drawing = await dayDrawing('2026-09-16', '2026-09-17', spec);
    expect(zonesByFlip(drawing.shown).get(flipIdOf(REPORTS))).toMatchObject({ empty: true, ghosts: true });

    const target = collapseAllView(spec, drawing.shown);
    expect(target).toMatchObject({ detail: 'auto' });
    const after = await dayDrawing('2026-09-16', '2026-09-17', target ?? {});
    expect(after.built.scene).toEqual(drawing.built.scene);
    expect(after.shown.diff.ghosts).toEqual({});
    expect(collapseAllView(spec, drawing.built)).toBeNull();
  });

  describe('each button is inert exactly when the view it writes draws the day with the same ghosts (property)', () => {
    const history = demoHistory('M');
    /** The days on which something was added or removed, each compared with the day before and the day after. */
    const PAIRS = history.ticks.flatMap((tick, index): Array<readonly [string, string]> => {
      const previous = history.ticks[index - 1];
      if (previous === undefined || tick.mutations.every((mutation) => mutation.kind === 'change')) return [];
      return [
        [previous.tick, tick.tick],
        [tick.tick, previous.tick],
      ];
    });
    const PLACES: ReadonlyArray<Pick<ViewSpecInput, 'root' | 'focus'>> = [
      {},
      { root: SHARED_VPC_HOST },
      { focus: { kind: 'shared-vpc', params: { host: SHARED_VPC_HOST } } },
    ];
    /** Where a flip comes from: a zone of the view drawn empty or on screen, a ghost zone, another view. */
    const SOURCES = ['empty', 'shown', 'ghost', 'elsewhere'] as const;
    const views = fc.record({
      pair: fc.constantFrom(...PAIRS),
      lens: fc.constantFrom(...LENS_IDS),
      place: fc.constantFrom(...PLACES),
      detail: fc.constantFrom(...LEVELS),
      depth: fc.constantFrom(undefined, 2),
      closeAboveAuto: fc.boolean(),
      picks: fc.array(fc.tuple(fc.constantFrom(...SOURCES), fc.nat()), { maxLength: 4 }),
    });
    type TimelineView = typeof views extends fc.Arbitrary<infer T> ? T : never;
    /** The views first checked: the reports project's day, where only the ghosts tell Auto from a deeper level. */
    const EXAMPLES: ReadonlyArray<[TimelineView]> = (
      ['networking', 'everything', 'overview'] as const
    ).flatMap((lens) =>
      (['projects', 'all'] as const).map((detail): [TimelineView] => [
        {
          pair: ['2026-09-16', '2026-09-17'],
          lens,
          place: {},
          detail,
          depth: undefined,
          closeAboveAuto: true,
          picks: [],
        },
      ]),
    );

    it(
      'on demo M’s days across lenses, levels, the depth filter and flips, every zone Auto closes closed by hand among them',
      async () => {
        let ghosted = 0;
        await fc.assert(
          fc.asyncProperty(views, async ({ pair, lens, place, detail, depth, closeAboveAuto, picks }) => {
            const [since, day] = pair;
            const base: ViewSpecInput = {
              snapshot: 'demo:M',
              lens,
              detail,
              ...place,
              ...(depth === undefined ? {} : { filters: { depth } }),
            };
            const plain = await dayDrawing(since, day, base);
            const onScreen = zonesByFlip(plain.shown);
            const sources: Readonly<Record<(typeof SOURCES)[number], readonly string[]>> = {
              empty: [...onScreen].flatMap(([token, zone]) => (zone.empty ? [token] : [])),
              shown: [...onScreen.keys()],
              ghost: Object.keys(plain.shown.diff.ghosts).map((id) => flipIdOf(id)),
              elsewhere: ['elsewhere1'],
            };
            const flips = new Set([
              ...(closeAboveAuto ? closedAboveAuto(plain.built, depth) : []),
              ...picks.flatMap(([source, index]) => {
                const list = sources[source];
                const token = list[index % Math.max(list.length, 1)];
                return token === undefined ? [] : [token];
              }),
            ]);
            const spec = normalizeViewSpec({ ...base, flips: [...flips] });
            const drawing = await dayDrawing(since, day, spec);
            if (Object.keys(drawing.shown.diff.ghosts).length > 0) ghosted += 1;
            const what = JSON.stringify({ since, day, lens, ...place, detail, depth, flips: spec.flips });
            const presses = [
              ['Expand all', expandAllTarget(spec, drawing.shown), expandAllView(spec, drawing.shown)],
              ['Collapse all', collapseAllTarget(spec, drawing.shown), collapseAllView(spec, drawing.shown)],
            ] as const;
            for (const [press, target, view] of presses) {
              const after = await dayDrawing(since, day, target);
              expect(view === null, `${press} inert: ${what}`).toBe(picture(after) === picture(drawing));
            }
          }),
          { numRuns: 60, examples: [...EXAMPLES] },
        );
        expect(ghosted).toBeGreaterThan(0);
      },
      DEMO_L,
    );
  });
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
