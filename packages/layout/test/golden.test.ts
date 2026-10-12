// SPDX-License-Identifier: MIT
/**
 * Golden layouts (skill gcp-diagram-layout §8): the demo organisations S and M × the overview, networking and
 * load-balancing lenses at detail `auto`, and M × the same lenses at detail `all`, built through
 * @gcportrait/graph with the real catalog (development only). Each layout, rects and routed edges, is compared
 * with its committed JSON under test/golden/, must satisfy the invariants (edges included) and be
 * deterministic, and keeps its edges apart (skill §8 "lanes spaced"): no two edges (a hub bundle's members
 * count as one) run alongside each other closer than the lane pitch, every lane fits its gutter, and the
 * ports on a side are at least the port spacing apart. At detail `auto` (what the app opens) the routing must
 * not grow the packed canvas more than twofold, and the canvas stays wider than tall. The packing is checked
 * on the same Scene laid out without routing (the arrangement the router pins): it fills its rows, and every
 * container with at least four children is checked against its packing target by an independent oracle
 * (src/testing/oracle.ts) and against a fill floor (skill §9, "huge empty zones"), as ADR 0025 restates the
 * packing criterion: within 20 % unless no arrangement with full rows reaches 20 % or every one that does
 * needs more area than the chosen one framed to the target; fill ≥ 40 %. The L organisation is too large to
 * commit as JSON: L × networking (at `auto` and `all`) and L × overview and load-balancing (at `auto`) are
 * compared by their summaries (counts, the routing report with its fallbacks, bends histogram, lanes,
 * bundles, widening and passes, canvas and growth, spacing), with the same spacing checks and the invariants,
 * and L networking at `all` with determinism; the rest of L (overview and load-balancing at `all`,
 * single-pass mode) by the invariants.
 *
 * Update the goldens deliberately, after looking at the change (README "Golden layouts"):
 *   pnpm --filter @gcportrait/layout test:golden:update
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as prettier from 'prettier';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ASPECT_TOLERANCE,
  DEFAULT_ROUTING,
  assertLayout,
  checkDeterminism,
  layoutScene,
  packingAspects,
  type Layout,
} from '../src/index.js';
import { NEAR_TIE } from '../src/pack.js';
import { routeQuality } from '../src/testing/quality.js';
import { fullRowViolations } from '../src/testing/rows.js';
import { laneSpacing, portSpacing } from '../src/testing/spacing.js';
import { arrangements, frameArea, naturalChildren } from '../src/testing/oracle.js';
import { GOLDEN_CASES, demoScene, type GoldenCase } from '../scripts/lib/scenes.js';

const GOLDEN_DIR = path.resolve(import.meta.dirname, 'golden');
const UPDATE = process.env.LAYOUT_UPDATE_GOLDEN === '1';
const PITCH = DEFAULT_ROUTING.lanePitch;
const PORT_SPACING = DEFAULT_ROUTING.portSpacing;
/** At detail `auto`, routing may at most double the packed canvas's area. */
const AUTO_GROWTH = 2;

/** Edges apart: no overlap, nothing closer than a lane pitch, every lane in its gutter, ports spaced. */
function expectSpaced(layout: Layout): void {
  const { routing } = layout.report;
  expect(routing.squeezed).toBe(0);
  expect(routing.overlaps).toBe(0);
  const spacing = laneSpacing(layout);
  expect(spacing.overlaps, spacing.examples.join('; ')).toBe(0);
  expect(spacing.closest).toBeGreaterThanOrEqual(PITCH);
  expect(spacing.closestStubs).toBeGreaterThanOrEqual(PORT_SPACING / 2);
  expect(portSpacing(layout, PORT_SPACING).crowded).toBe(0);
}

/** The routed canvas's area over the packed one's. */
function growthOf(layout: Layout, packed: Layout): number {
  return (layout.bounds.width * layout.bounds.height) / (packed.bounds.width * packed.bounds.height);
}
/** No container with four or more children may leave more than 60 % of its children box empty. */
const FILL_FLOOR = 0.4;

async function formatted(layout: Layout, file: string): Promise<string> {
  const config = (await prettier.resolveConfig(file)) ?? {};
  return prettier.format(JSON.stringify(layout), { ...config, filepath: file });
}

interface Miss {
  readonly id: string;
  readonly children: number;
  readonly aspect: number;
  readonly deviation: number;
  readonly fill: number;
  /** `unreachable`: no tidy arrangement is within 20 %; `costlier`: every one takes more area. */
  readonly reason: 'unreachable' | 'costlier';
  /** costlier: how much more area the tightest tidy arrangement within 20 % takes than the chosen one, framed. */
  readonly extraArea?: number;
  /** The best fill of any arrangement within 20 % under the skill's rules, full rows or not (if any). */
  readonly anyInBandFill?: number;
}

interface CaseStats {
  readonly name: string;
  readonly rects: number;
  readonly checked: number;
  readonly within: number;
  readonly misses: readonly Miss[];
  readonly meanDeviation: number;
  readonly worstDeviation: number;
  readonly minFill: number;
  readonly meanFill: number;
}

const stats: CaseStats[] = [];
const spacingStats: {
  name: string;
  overlaps: number;
  closest: number;
  crowded: number;
  squeezed: number;
  bundles: number;
  passes: number;
  growth: number;
}[] = [];
const pct = (value: number): string => `${(value * 100).toFixed(1)} %`;

afterAll(() => {
  const total = stats.reduce((sum, s) => sum + s.checked, 0);
  const within = stats.reduce((sum, s) => sum + s.within, 0);
  const misses = stats.flatMap((s) => s.misses.map((miss) => ({ ...miss, name: s.name })));
  const lines = [
    `packing of containers with ≥ 4 children (target 1.6, canvas 1.75; tolerance ${pct(ASPECT_TOLERANCE)}):`,
    'case                  rects  checked  within  unreachable  costlier  mean dev  worst dev  min fill  mean fill',
    ...stats.map(
      (s) =>
        `${s.name.padEnd(20)}  ${String(s.rects).padStart(5)}  ${String(s.checked).padStart(7)}  ${String(s.within).padStart(6)}  ` +
        `${String(s.misses.filter((m) => m.reason === 'unreachable').length).padStart(11)}  ` +
        `${String(s.misses.filter((m) => m.reason === 'costlier').length).padStart(8)}  ${pct(s.meanDeviation).padStart(8)}  ` +
        `${pct(s.worstDeviation).padStart(9)}  ${pct(s.minFill).padStart(8)}  ${pct(s.meanFill).padStart(9)}`,
    ),
    `all cases: ${String(within)} of ${String(total)} within 20 %; ` +
      `${String(misses.filter((m) => m.reason === 'unreachable').length)} cannot reach 20 % with full rows ` +
      `(${String(misses.filter((m) => m.reason === 'unreachable' && m.anyInBandFill === undefined).length)} of them not even with rows left short); ` +
      `${String(misses.filter((m) => m.reason === 'costlier').length)} could, but only with more area than the arrangement chosen.`,
    'outside 20 % (case, container, children, aspect, deviation, fill, reason, best fill of any arrangement within 20 % under the skill’s rules):',
    ...misses.map(
      (m) =>
        `  ${m.name} ${m.id.replace(/^\/\/[^/]+\//, '')} n=${String(m.children)} aspect ${m.aspect.toFixed(2)} dev ${pct(m.deviation)} fill ${pct(m.fill)} ` +
        `${m.reason}${m.extraArea === undefined ? '' : ` (+${pct(m.extraArea)} area)`}` +
        (m.anyInBandFill === undefined
          ? '; none within 20 % at all'
          : `; within 20 % at fill ${pct(m.anyInBandFill)}`),
    ),
  ];
  console.log(lines.join('\n'));
  console.log(
    [
      'edge spacing (pairs of different holders alongside each other; a bundle counts as one):',
      'case                  overlaps  closest  ports < 12 px  squeezed lines  bundles  passes  growth',
      ...spacingStats.map(
        (s) =>
          `${s.name.padEnd(20)}  ${String(s.overlaps).padStart(8)}  ${(Number.isFinite(s.closest) ? String(s.closest) : '-').padStart(7)}  ${String(s.crowded).padStart(13)}  ${String(s.squeezed).padStart(14)}  ${String(s.bundles).padStart(7)}  ${String(s.passes).padStart(6)}  ${s.growth.toFixed(2).padStart(6)}`,
      ),
    ].join('\n'),
  );
});

describe.each(GOLDEN_CASES)('golden layout $name', (golden: GoldenCase) => {
  const scene = demoScene(golden.fixture, golden.lens, golden.detail);
  const layout = layoutScene(scene);
  // The packing alone: what the router pins and widens.
  const packed = layoutScene(scene, { route: false });
  const file = path.join(GOLDEN_DIR, `${golden.name}.json`);

  it('matches the committed JSON', async () => {
    if (UPDATE) {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      writeFileSync(file, await formatted(layout, file));
    }
    const committed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    expect(JSON.parse(JSON.stringify(layout))).toEqual(committed);
  });

  it('satisfies the invariants', () => {
    expect(() => {
      assertLayout(scene, layout);
    }).not.toThrow();
  });

  it('keeps the arrangement it packed while routing widens the gutters', () => {
    expect(layout.arrangements).toEqual(packed.arrangements);
  });

  it('fills every row of its packing', () => {
    expect(fullRowViolations(scene, packed)).toEqual([]);
  });

  it('is deterministic and independent of the order of the Scene children', () => {
    expect(checkDeterminism(scene)).toEqual([]);
  });

  it('routes every edge through the gutters with its edges spaced, and grows the packing little at auto', () => {
    const { routing } = layout.report;
    expect(routing.fallbacks).toBe(0);
    expect(routing.failed).toBe(0);
    expect(routing.edges).toBe(Object.keys(layout.edges).length);
    const spacing = laneSpacing(layout);
    const growth = growthOf(layout, packed);
    spacingStats.push({
      name: golden.name,
      overlaps: spacing.overlaps,
      closest: spacing.closest,
      crowded: portSpacing(layout, PORT_SPACING).crowded,
      squeezed: routing.squeezed,
      bundles: routing.bundles,
      passes: routing.passes,
      growth,
    });
    expectSpaced(layout);
    if (golden.detail === 'auto') {
      expect(growth).toBeLessThanOrEqual(AUTO_GROWTH);
      expect(layout.bounds.width).toBeGreaterThan(layout.bounds.height);
    }
  });

  it('packs every container with ≥ 4 children within 20 % of its target unless no tidy arrangement does so in less area, and never leaves most of a box empty', () => {
    const checked = packingAspects(packed).filter((aspect) => aspect.children >= 4);
    const misses: Miss[] = [];
    for (const aspect of checked) {
      const id = aspect.id ?? 'canvas';
      expect(aspect.fill, `${id}: fill`).toBeGreaterThanOrEqual(FILL_FLOOR);
      if (aspect.deviation <= ASPECT_TOLERANCE) continue;

      const children = naturalChildren(scene, packed, aspect.id);
      const all = arrangements(children);
      const inBand = (a: { width: number; height: number }): boolean =>
        Math.abs(a.width / a.height - aspect.target) <= ASPECT_TOLERANCE * aspect.target;
      const tidy = all.filter((a) => a.full);
      const oriented = tidy.filter((a) => a.width >= a.height);
      const pool = oriented.length > 0 ? oriented : tidy;
      const frame = (a: { width: number; height: number }): number =>
        frameArea(a.width, a.height, aspect.target, ASPECT_TOLERANCE);
      const chosenFrame = frame(aspect);
      // The packer's choice is the best tidy arrangement: none needs a smaller frame by more than the near-tie
      // margin (within 2 %, a grid that does not grow downwards and then fewer rows rank first: ADR 0026).
      // Stacks (ADR 0026), which the oracle does not enumerate, only ever take a smaller frame.
      expect(chosenFrame, `${id}: a tidy arrangement needs a smaller frame`).toBeLessThanOrEqual(
        Math.min(...pool.map(frame)) * (1 + NEAR_TIE) + 1e-6,
      );
      const tidyInBand = pool.filter(inBand);
      const anyInBand = all.filter(inBand);
      const area = children.reduce((sum, child) => sum + child.width * child.height, 0);
      const anyInBandFill =
        anyInBand.length === 0 ? undefined : Math.max(...anyInBand.map((a) => area / (a.width * a.height)));
      let extraArea: number | undefined;
      if (tidyInBand.length > 0) {
        // Outside the band only when every tidy arrangement inside it takes more area than the chosen one
        // after framing it to the band's edge.
        const tightest = Math.min(...tidyInBand.map((a) => a.width * a.height));
        expect(tightest, `${id}: a tidy arrangement within 20 % fits in less area`).toBeGreaterThan(
          chosenFrame,
        );
        extraArea = tightest / chosenFrame - 1;
      }
      misses.push({
        id,
        children: aspect.children,
        aspect: aspect.aspect,
        deviation: aspect.deviation,
        fill: aspect.fill,
        reason: extraArea === undefined ? 'unreachable' : 'costlier',
        ...(extraArea === undefined ? {} : { extraArea }),
        ...(anyInBandFill === undefined ? {} : { anyInBandFill }),
      });
    }
    stats.push({
      name: golden.name,
      rects: packed.report.counts.rects,
      checked: checked.length,
      within: checked.length - misses.length,
      misses,
      meanDeviation: checked.reduce((sum, a) => sum + a.deviation, 0) / Math.max(1, checked.length),
      worstDeviation: Math.max(0, ...checked.map((a) => a.deviation)),
      minFill: Math.min(1, ...checked.map((a) => a.fill)),
      meanFill: checked.reduce((sum, a) => sum + a.fill, 0) / Math.max(1, checked.length),
    });
  });
});

/** What the L summaries record: everything but the geometry itself. */
function summaryOf(name: string, layout: Layout, packed: Layout): Record<string, unknown> {
  const { counts, routing } = layout.report;
  const spacing = laneSpacing(layout);
  const ports = portSpacing(layout, PORT_SPACING);
  return {
    name,
    rects: counts.rects,
    zones: counts.zones,
    chips: counts.chips,
    emptyZones: counts.emptyZones,
    cards: counts.cards,
    sceneEdges: counts.edges,
    routing,
    canvas: { width: layout.bounds.width, height: layout.bounds.height },
    packed: { width: packed.bounds.width, height: packed.bounds.height },
    growth: Math.round(growthOf(layout, packed) * 100) / 100,
    spacing: {
      overlaps: spacing.overlaps,
      close: spacing.close,
      closest: spacing.closest,
      closestStubs: spacing.closestStubs,
      portsCloserThanSpacing: ports.crowded,
      closestPorts: ports.closest,
    },
  };
}

// Determinism is checked on one L view: each check lays the view out three more times, and the S and M goldens
// and the property tests (src/layout.property.test.ts) cover it on every other Scene.
describe.each([
  { lens: 'networking' as const, detail: 'auto' as const, name: 'L-networking', determinism: false },
  { lens: 'networking' as const, detail: 'all' as const, name: 'L-networking-all', determinism: true },
  { lens: 'overview' as const, detail: 'auto' as const, name: 'L-overview', determinism: false },
  { lens: 'load-balancing' as const, detail: 'auto' as const, name: 'L-load-balancing', determinism: false },
])('golden summary $name', ({ lens, detail, name, determinism }) => {
  const scene = demoScene('L', lens, detail);
  const layout = layoutScene(scene);
  const packed = layoutScene(scene, { route: false });
  const file = path.join(GOLDEN_DIR, `${name}.summary.json`);

  it('matches the committed summary', async () => {
    const summary = summaryOf(name, layout, packed);
    if (UPDATE) {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      const config = (await prettier.resolveConfig(file)) ?? {};
      writeFileSync(file, await prettier.format(JSON.stringify(summary), { ...config, filepath: file }));
    }
    expect(JSON.parse(JSON.stringify(summary))).toEqual(JSON.parse(readFileSync(file, 'utf8')));
  });

  it('routes every edge through the gutters', () => {
    expect(layout.report.routing.fallbacks).toBe(0);
    expect(layout.report.routing.failed).toBe(0);
  });

  it('keeps its edges apart: no overlap, lanes a pitch apart and inside their gutters, ports spaced', () => {
    expectSpaced(layout);
  });

  if (detail === 'auto') {
    it('grows the packing at most twofold and stays wider than tall', () => {
      expect(growthOf(layout, packed)).toBeLessThanOrEqual(AUTO_GROWTH);
      expect(layout.bounds.width).toBeGreaterThan(layout.bounds.height);
    });
  }

  it('satisfies the invariants', () => {
    expect(() => {
      assertLayout(scene, layout);
    }).not.toThrow();
  });

  if (determinism) {
    it('is deterministic and independent of the order of the Scene children', () => {
      expect(checkDeterminism(scene)).toEqual([]);
    });
  }
});

describe('demo L, lens overview, detail projects (skill §8 check view)', () => {
  const scene = demoScene('L', 'overview', 'projects');
  const layout = layoutScene(scene);

  it('routes in three passes with its lanes spaced, nothing in the margin and no long way round', () => {
    const { routing } = layout.report;
    expect(routing.mode).toBe('three-pass');
    expect(routing.wideningRounds).toBe(2);
    expect(routing.fallbacks).toBe(0);
    expect(routing.overlaps).toBe(0);
    // Two rounds (the cap above `lateRoundsUpTo` holders) leave a few lines squeezed, against hundreds in
    // single-pass mode.
    expect(routing.squeezed).toBeLessThanOrEqual(5);
    const quality = routeQuality(layout);
    // No route runs round through the canvas margin (a review on 2026-10-10 found 26 U-turns there while a gap
    // beside a single border cost more than the free space beside it: ADR 0027).
    expect(quality.marginEdges).toBe(0);
    // Nor inside the canvas: no route runs more than 1 000 px past both of its ends (an earlier rule had 140,
    // dropping up to 2 528 px to a row gap and climbing back, while a long ring side cost 1.5 × its whole
    // length; the surcharge is now capped per side, ADR 0027 rule 2). The farthest, under 1 000 px, run up
    // from a top-row project to Workloads' ring top, the only gutter across Workloads above its folders.
    expect(quality.overshoots).toBe(0);
    expect(() => {
      assertLayout(scene, layout);
    }).not.toThrow();
  });

  it('sits well inside the three-pass band of search work, so a small data change cannot flip it (ADR 0027)', () => {
    const { routing } = layout.report;
    const { oneRoundWork, singlePassWork } = DEFAULT_ROUTING;
    // 2 658 edges, 1 234 lane holders: the raw counts said nothing about its cost (a holder count put it 16
    // holders under a 1 250-holder threshold). Its first pass settles about 290 000 states: 15 % more work
    // keeps both widening rounds, 40 % more still routes in three passes.
    expect(routing.edges).toBe(2658);
    expect(routing.work * 1.15).toBeLessThan(oneRoundWork);
    expect(routing.work * 1.4).toBeLessThan(singlePassWork);
  });

  it('stays in three passes when a tenth of its edges go or a tenth more join (a demo-data change)', () => {
    // A tenth more edges like its own (every tenth edge also the other way round, as a `uses` edge): their
    // search costs about a third more, which the one-round band absorbs (measured: 380 776 states, one
    // round, 18 squeezed lines; about as fast as the view itself with two rounds).
    const extra = scene.edges.flatMap((edge, index) =>
      index % 10 === 0 ? [{ from: edge.to, to: edge.from, kind: 'uses' as const }] : [],
    );
    const grown = layoutScene({ ...scene, edges: [...scene.edges, ...extra] });
    expect(grown.report.routing.edges).toBeGreaterThan(layout.report.routing.edges * 1.09);
    expect(grown.report.routing.mode).toBe('three-pass');
    expect(grown.report.routing.wideningRounds).toBeGreaterThan(0);
    expect(grown.report.routing.work).toBeLessThan(DEFAULT_ROUTING.singlePassWork);
    // A tenth fewer: three passes with both rounds.
    const shrunk = layoutScene({ ...scene, edges: scene.edges.filter((_, index) => index % 10 !== 0) });
    expect(shrunk.report.routing.mode).toBe('three-pass');
    expect(shrunk.report.routing.wideningRounds).toBe(2);
  });
});

describe('widening rounds', () => {
  it('runs a third round where the second re-route still squeezes a lane, but not above lateRoundsUpTo holders nor in the one-round band', () => {
    // M networking at `all` needs three rounds to keep every lane inside its gutter (ADR 0027).
    const scene = demoScene('M', 'networking', 'all');
    const full = layoutScene(scene);
    expect(full.report.routing).toMatchObject({ wideningRounds: 3, squeezed: 0 });
    const capped = layoutScene(scene, { routing: { lateRoundsUpTo: 0 } });
    expect(capped.report.routing.wideningRounds).toBe(2);
    // In the band between oneRoundWork and singlePassWork one round at most, still three-pass (ADR 0027).
    const banded = layoutScene(scene, { routing: { oneRoundWork: full.report.routing.work - 1 } });
    expect(banded.report.routing).toMatchObject({ mode: 'three-pass', wideningRounds: 1 });
  });
});

// The rest of L (too large for JSON, no summary): overview and load-balancing fully open need more search work
// than `singlePassWork` (their exact first passes settle about 830 000 and 520 000 states), so they route in a
// single pass, its last edges searched weighted, and their busy gutters' lanes are squeezed (the report warns);
// every edge still routes through the gutters within the invariants (no segment through a card or header,
// ports on borders).
describe.each([
  { lens: 'overview' as const, detail: 'all' as const },
  { lens: 'load-balancing' as const, detail: 'all' as const },
])('demo L, lens $lens, detail $detail', ({ lens, detail }) => {
  it('routes every edge through the gutters in one pass and satisfies the invariants', () => {
    const scene = demoScene('L', lens, detail);
    const layout = layoutScene(scene);
    expect(layout.report.routing.mode).toBe('single-pass');
    // The switch came after the budget: the first pass settled at least `singlePassWork` states.
    expect(layout.report.routing.work).toBeGreaterThanOrEqual(DEFAULT_ROUTING.singlePassWork);
    expect(layout.report.routing.fallbacks).toBe(0);
    expect(layout.report.routing.failed).toBe(0);
    expect(layout.report.warnings.some((warning) => warning.startsWith('single-pass mode'))).toBe(true);
    expect(() => {
      assertLayout(scene, layout);
    }).not.toThrow();
  });
});
