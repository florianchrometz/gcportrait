// SPDX-License-Identifier: MIT
/**
 * The demo Scenes the golden tests, the performance test and the debug renderer lay out: a demo organisation
 * (`@gcportrait/demo-data`, development only) through the graph builder and the scene builder
 * (`@gcportrait/graph`, development only) with the real compiled catalog. The layout library itself never
 * imports these packages.
 */
import { catalog } from '@gcportrait/catalog';
import { DEMO_ORGANIZATION_DOMAIN, generateOrganization, toSnapshot } from '@gcportrait/demo-data';
import { buildGraph, buildScene } from '@gcportrait/graph';
import {
  normalizeViewSpec,
  type DetailLevel,
  type Graph,
  type LensId,
  type Scene,
  type Snapshot,
} from '@gcportrait/model';

/** The demo sizes the layout's tests and scripts use; XL (about 51 000 assets) only collapsed (the bench). */
export type Fixture = 'S' | 'M' | 'L' | 'XL';
/** The fixtures with committed golden layouts; L is checked by its summary (test/golden/L-*.summary.json). */
export const FIXTURES: readonly Fixture[] = ['S', 'M'];
export const GOLDEN_LENSES: readonly LensId[] = ['overview', 'networking', 'load-balancing'];

const built = new Map<Fixture, { snapshot: Snapshot; graph: Graph }>();

function graphOf(fixture: Fixture): { snapshot: Snapshot; graph: Graph } {
  let entry = built.get(fixture);
  if (entry === undefined) {
    const snapshot = toSnapshot(generateOrganization({ size: fixture }));
    entry = { snapshot, graph: buildGraph(snapshot, catalog) };
    built.set(fixture, entry);
  }
  return entry;
}

/** The Scene of a demo organisation for a lens and detail level (default `auto` at the 1280×800 budget). */
export function demoScene(fixture: Fixture, lens: LensId, detail: DetailLevel = 'auto'): Scene {
  const { snapshot, graph } = graphOf(fixture);
  const spec = normalizeViewSpec({ snapshot: `demo:${fixture}`, lens, detail });
  return buildScene(graph, spec, catalog, {
    readTime: snapshot.readTime,
    rootLabel: snapshot.scope.displayName ?? DEMO_ORGANIZATION_DOMAIN,
  });
}

/** One golden case: a fixture, a lens and a detail level, with the file name its layout is stored under. */
export interface GoldenCase {
  readonly fixture: Fixture;
  readonly lens: LensId;
  readonly detail: DetailLevel;
  readonly name: string;
}

/**
 * The golden cases: S and M × overview, networking, load-balancing at `auto` (the view the app opens), and M
 * × the same lenses at `all`, which opens every zone and so exercises the packing of the whole organisation.
 */
export const GOLDEN_CASES: readonly GoldenCase[] = [
  ...FIXTURES.flatMap((fixture) =>
    GOLDEN_LENSES.map((lens) => ({ fixture, lens, detail: 'auto' as const, name: `${fixture}-${lens}` })),
  ),
  ...GOLDEN_LENSES.map((lens) => ({
    fixture: 'M' as const,
    lens,
    detail: 'all' as const,
    name: `M-${lens}-all`,
  })),
];
