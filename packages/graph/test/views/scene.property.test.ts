// SPDX-License-Identifier: Apache-2.0
/**
 * Property tests (fast-check) of the scene builder on the demo organisations: random views — any lens, focus
 * (valid or not), drill-in root (any container, or junk), filters (any combination, drawn from the ids, types
 * and locations the organisation has), detail level, budget, flips and selection — must always give a scene
 * that is deterministic, valid (every edge joins two nodes of the scene; chips hold nothing; the report
 * agrees), whose chips hide everything below them, that the independent oracle accepts, and whose filter stage
 * is idempotent; and a view built from another view's preparation is the view built from scratch.
 */
import {
  DetailLevelSchema,
  FocusKindSchema,
  LensIdSchema,
  SceneBuildSchema,
  normalizeViewSpec,
  type Focus,
  type Graph,
  type ViewSpec,
  type ViewSpecInput,
} from '@gcportrait/model';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REAL_CATALOG } from '../../src/testing/fixtures.js';
import { isInside } from '../../src/testing/graph.js';
import { placed } from '../../src/testing/scene.js';
import { candidates, settle } from '../../src/views/filters.js';
import { flipIdOf } from '../../src/views/flip.js';
import {
  buildPreparedScene,
  buildScene,
  buildSceneWithReport,
  prepareView,
  preparedViewKey,
  viewContext,
} from '../../src/views/scene.js';
import { APPLICATION, READ_TIME, demoGraphBuild, type DemoSize } from './fixtures.js';
import { violations } from './oracle.js';

const CATALOG = REAL_CATALOG;
const ENV = { readTime: READ_TIME };

interface Pools {
  readonly graph: Graph;
  readonly containers: readonly string[];
  readonly projects: readonly string[];
  readonly folders: readonly string[];
  readonly types: readonly string[];
  readonly locations: readonly string[];
  readonly ids: readonly string[];
}

function pools(size: DemoSize): Pools {
  const graph = demoGraphBuild(size).graph;
  const nodes = Object.values(graph.nodes);
  const unique = (values: (string | undefined)[]): string[] =>
    [...new Set(values.flatMap((value) => (value === undefined ? [] : [value])))].sort();
  return {
    graph,
    containers: nodes.filter((node) => node.role === 'container').map((node) => node.id),
    projects: unique(nodes.flatMap((node) => [node.projectId, node.projectNumber])),
    folders: nodes
      .filter((node) => node.assetType === 'cloudresourcemanager.googleapis.com/Folder')
      .map((node) => node.id.slice(node.id.lastIndexOf('/') + 1)),
    types: unique(nodes.map((node) => node.assetType)),
    locations: unique(nodes.map((node) => node.location)),
    ids: nodes.map((node) => node.id),
  };
}

const POOLS = { S: pools('S'), M: pools('M') } as const;

function focusArbitrary(p: Pools): fc.Arbitrary<Focus | undefined> {
  const value = (pool: readonly string[]): fc.Arbitrary<string> =>
    fc.oneof(fc.constantFrom(...pool), fc.constantFrom('nope', 'demo-web-1', 'data_perimeter', 'Shop'));
  return fc.option(
    fc.oneof(
      value(p.projects).map((project): Focus => ({ kind: 'project', params: { project } })),
      value(p.projects).map((host): Focus => ({ kind: 'shared-vpc', params: { host } })),
      fc.constant<Focus>({ kind: 'standalone-projects', params: {} }),
      value(['data_perimeter']).map((perimeter): Focus => ({ kind: 'perimeter', params: { perimeter } })),
      value([APPLICATION, ...p.containers]).map((application): Focus => ({
        kind: 'application',
        params: { application },
      })),
      fc.constantFrom(...FocusKindSchema.options).map((kind): Focus => ({ kind, params: {} })),
    ),
    { nil: undefined },
  );
}

function viewArbitrary(p: Pools): fc.Arbitrary<{ spec: ViewSpec; budget: number; flipShare: number }> {
  const subset = (pool: readonly string[]): fc.Arbitrary<string[] | undefined> =>
    fc.option(fc.subarray([...pool], { minLength: 1, maxLength: Math.min(4, pool.length) }), {
      nil: undefined,
      freq: 3,
    });
  const typePatterns = fc.option(
    fc.subarray([...p.types, ...p.types.map((type) => `${type.slice(0, type.indexOf('/'))}/*`), '*'], {
      minLength: 1,
      maxLength: 3,
    }),
    { nil: undefined, freq: 3 },
  );
  return fc
    .record({
      lens: fc.constantFrom(...LensIdSchema.options),
      focus: focusArbitrary(p),
      root: fc.option(
        fc.oneof(fc.constantFrom(...p.containers), fc.constantFrom(...p.ids), fc.constant('junk')),
        {
          nil: undefined,
          freq: 2,
        },
      ),
      hideEmptyProjects: fc.boolean(),
      hideEmptyFolders: fc.boolean(),
      hideDisconnected: fc.boolean(),
      regions: subset(p.locations),
      projects: subset(p.projects),
      folders: subset(p.folders),
      includeTypes: typePatterns,
      excludeTypes: typePatterns,
      depth: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
      showRegions: fc.option(fc.boolean(), { nil: undefined }),
      showIdentities: fc.option(fc.boolean(), { nil: undefined }),
      detail: fc.constantFrom(...DetailLevelSchema.options),
      selection: fc.option(fc.constantFrom(...p.ids), { nil: undefined }),
      budget: fc.integer({ min: 24, max: 250 }),
      flipShare: fc.double({ min: 0, max: 0.5, noNaN: true }),
    })
    .map(({ budget, flipShare, lens, focus, root, detail, selection, ...filters }) => ({
      spec: normalizeViewSpec({
        snapshot: 'demo:S',
        lens,
        detail,
        filters,
        ...(focus === undefined ? {} : { focus }),
        ...(root === undefined ? {} : { root }),
        ...(selection === undefined ? {} : { selection }),
      }),
      budget,
      flipShare,
    }));
}

/** Flips for a share of the zones the unflipped scene shows, so that flips hit real chips and open zones. */
function withFlips(graph: Graph, spec: ViewSpec, budget: number, share: number): ViewSpec {
  const scene = buildScene(graph, spec, CATALOG, { ...ENV, viewportBudget: budget });
  const zones = [...placed(scene).values()].flatMap(({ node }) => (node.type === 'zone' ? [node.id] : []));
  const flips = zones.filter((_, index) => (index * 7919) % 100 < share * 100).slice(0, 40);
  return normalizeViewSpec({ ...spec, flips: [...flips.map(flipIdOf), 'stale1'] });
}

describe.each(['S', 'M'] as const)('scene builder properties on %s', (size) => {
  const p = POOLS[size];
  const runs = size === 'S' ? 150 : 60;

  it('is deterministic and independent of the order of the graph’s records', () => {
    const reversed: Graph = {
      ...p.graph,
      nodes: Object.fromEntries(Object.entries(p.graph.nodes).reverse()),
      containment: {
        parent: Object.fromEntries(Object.entries(p.graph.containment.parent).reverse()),
        children: Object.fromEntries(Object.entries(p.graph.containment.children).reverse()),
      },
      edges: [...p.graph.edges].reverse(),
    };
    fc.assert(
      fc.property(viewArbitrary(p), ({ spec, budget, flipShare }) => {
        const env = { ...ENV, viewportBudget: budget };
        const flipped = withFlips(p.graph, spec, budget, flipShare);
        const once = buildSceneWithReport(p.graph, flipped, CATALOG, env);
        expect(buildSceneWithReport(p.graph, flipped, CATALOG, env)).toEqual(once);
        expect(JSON.stringify(buildSceneWithReport(reversed, flipped, CATALOG, env))).toBe(
          JSON.stringify(once),
        );
      }),
      { numRuns: runs },
    );
  });

  it('gives a valid scene: every edge joins two scene nodes, chips hold nothing, the report agrees', () => {
    fc.assert(
      fc.property(viewArbitrary(p), ({ spec, budget, flipShare }) => {
        const flipped = withFlips(p.graph, spec, budget, flipShare);
        const build = SceneBuildSchema.parse(
          buildSceneWithReport(p.graph, flipped, CATALOG, { ...ENV, viewportBudget: budget }),
        );
        const shown = placed(build.scene);
        for (const edge of build.scene.edges) {
          expect(shown.has(edge.from) && shown.has(edge.to)).toBe(true);
        }
        // A chip hides its whole subtree: nothing it contains in the graph is drawn anywhere else.
        const chips = [...shown.values()].flatMap(({ node }) =>
          node.type === 'zone' && node.collapsed !== undefined ? [node.id] : [],
        );
        for (const chip of chips) {
          const inside = [...shown.keys()].filter((id) => isInside(p.graph, id, chip));
          expect([chip, inside]).toEqual([chip, []]);
        }
      }),
      { numRuns: runs },
    );
  });

  it('satisfies the composition oracle for any view', () => {
    fc.assert(
      fc.property(viewArbitrary(p), ({ spec, budget, flipShare }) => {
        const flipped = withFlips(p.graph, spec, budget, flipShare);
        const build = buildSceneWithReport(p.graph, flipped, CATALOG, { ...ENV, viewportBudget: budget });
        expect(violations(p.graph, flipped, CATALOG, build)).toEqual([]);
      }),
      { numRuns: runs },
    );
  });

  it('builds a view from the preparation of one that differs only in detail, flips, depth, selection or budget', () => {
    fc.assert(
      fc.property(viewArbitrary(p), viewArbitrary(p), ({ spec, budget }, other) => {
        const prepared = prepareView(p.graph, spec, CATALOG, { ...ENV, viewportBudget: budget });
        // `spec`'s lens, focus, root and filters with `other`'s detail level, depth, selection, flips and budget.
        const filters: ViewSpecInput['filters'] = { ...spec.filters };
        delete filters.depth;
        const input: ViewSpecInput = {
          ...spec,
          detail: other.spec.detail,
          filters: {
            ...filters,
            ...(other.spec.filters.depth === undefined ? {} : { depth: other.spec.filters.depth }),
          },
        };
        delete input.selection;
        const variant = withFlips(
          p.graph,
          normalizeViewSpec({
            ...input,
            ...(other.spec.selection === undefined ? {} : { selection: other.spec.selection }),
          }),
          other.budget,
          other.flipShare,
        );
        const env = { ...ENV, viewportBudget: other.budget };
        expect(preparedViewKey(variant, env)).toBe(prepared.key);
        expect(buildPreparedScene(prepared, variant, env)).toEqual(
          buildSceneWithReport(p.graph, variant, CATALOG, env),
        );
      }),
      { numRuns: runs },
    );
  });

  it('has idempotent filters: filtering the filtered nodes again changes nothing', () => {
    fc.assert(
      fc.property(viewArbitrary(p), ({ spec }) => {
        const ctx = viewContext(p.graph, spec, CATALOG, ENV);
        const once = settle(ctx, candidates(ctx));
        const twice = settle(ctx, once.nodes);
        expect([...twice.nodes].sort()).toEqual([...once.nodes].sort());
        expect([...twice.stubs].sort()).toEqual([...once.stubs].sort());
        expect(twice.edges).toEqual(once.edges);
      }),
      { numRuns: runs },
    );
  });
});

describe('a prepared view', () => {
  const { graph, containers, ids } = POOLS.S;
  const container = containers[0] ?? 'none';
  const base = normalizeViewSpec({ snapshot: 'demo:S', lens: 'networking' });

  it('serves the views that differ only in what the preparation does not read', () => {
    const key = preparedViewKey(base, ENV);
    for (const input of [
      { detail: 'all' },
      { flips: [flipIdOf(container)] },
      { filters: { depth: 2 } },
      { selection: ids[0] ?? 'none' },
      { highlight: 'web' },
      { tick: '2026-09-17' },
      { snapshot: 'demo:M' },
    ] satisfies ViewSpecInput[]) {
      expect(preparedViewKey(normalizeViewSpec({ ...base, ...input }), ENV), JSON.stringify(input)).toBe(key);
    }
    expect(preparedViewKey(base, { readTime: '2026-09-17T00:00:00Z', viewportBudget: 30 })).toBe(key);
  });

  it('canonicalizes undefined filter entries and focus parameter order', () => {
    const key = preparedViewKey(base, ENV);
    const withUndefinedFilters = {
      ...base,
      filters: {
        ...base.filters,
        regions: undefined,
        projects: undefined,
        folders: undefined,
      },
    } as unknown as ViewSpec;
    expect(preparedViewKey(withUndefinedFilters, ENV)).toBe(key);

    const focus1: ViewSpec = {
      ...base,
      focus: { kind: 'project', params: { project: 'p1', host: 'h1' } },
    };
    const focus2: ViewSpec = {
      ...base,
      focus: { kind: 'project', params: { host: 'h1', project: 'p1' } },
    };
    expect(preparedViewKey(focus1, ENV)).toBe(preparedViewKey(focus2, ENV));

    const focusWithUndefined: ViewSpec = {
      ...base,
      focus: { kind: 'project', params: { project: 'p1', host: undefined as unknown as string } },
    };
    const focusWithoutUndefined: ViewSpec = {
      ...base,
      focus: { kind: 'project', params: { project: 'p1' } },
    };
    expect(preparedViewKey(focusWithUndefined, ENV)).toBe(preparedViewKey(focusWithoutUndefined, ENV));
  });

  it('does not serve another lens, focus, root, filter, root label or region setting', () => {
    const key = preparedViewKey(base, ENV);
    for (const input of [
      { lens: 'overview' },
      { focus: { kind: 'standalone-projects', params: {} } },
      { root: container },
      { filters: { hideDisconnected: true } },
      { filters: { showRegions: true } },
      { filters: { excludeTypes: ['compute.googleapis.com/*'] } },
    ] satisfies ViewSpecInput[]) {
      expect(preparedViewKey(normalizeViewSpec({ ...base, ...input }), ENV), JSON.stringify(input)).not.toBe(
        key,
      );
    }
    expect(preparedViewKey(base, { ...ENV, rootLabel: 'example.org' })).not.toBe(key);
    expect(preparedViewKey(base, { ...ENV, showRegions: true })).not.toBe(key);
    const prepared = prepareView(graph, base, CATALOG, ENV);
    expect(() => buildPreparedScene(prepared, normalizeViewSpec({ ...base, lens: 'compute' }), ENV)).toThrow(
      /prepared for another/,
    );
  });
});
