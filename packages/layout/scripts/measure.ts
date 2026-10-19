// SPDX-License-Identifier: Apache-2.0
/**
 * `pnpm --filter @gcportrait/layout measure`: how the routes of a set of demo views read (total length,
 * bends, border-hugging length, detours, crossings, the canvas margin and how far routes run past both of
 * their ends; `src/testing/quality.ts`) and how long each takes, so that a routing change can be compared
 * before and after. With `--packing` it prints instead, per view, the canvas area, the mean fill, the mean
 * deviation from the target aspect and the share within 20 % of it of the containers with two or more
 * children, under each packing rule it compares: plain rows in sibling order, skill §9's rows by height, and
 * the rule in use (skill §4: stacks and near ties). Prints a table; `--json` prints JSON.
 *
 *   pnpm --filter @gcportrait/layout measure
 *   pnpm --filter @gcportrait/layout measure --view M:overview:auto --view L:overview:projects --json
 *   pnpm --filter @gcportrait/layout measure --packing --view M:overview:all
 */
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { DetailLevelSchema, LensIdSchema, type DetailLevel, type LensId } from '@gcportrait/model';
import { ASPECT_TOLERANCE, packingAspects, type PackingAspect } from '../src/index.js';
import { layoutSceneWith } from '../src/layout.js';
import type { PackPolicy } from '../src/pack.js';
import { routeQuality } from '../src/testing/quality.js';
import { demoScene, type Fixture } from './lib/scenes.js';

export interface View {
  readonly fixture: Fixture;
  readonly lens: LensId;
  readonly detail: DetailLevel;
}

/** The default views: M at `auto` (the collapsed overviews the app opens at) and L at `projects`. */
export const DEFAULT_VIEWS: readonly View[] = [
  { fixture: 'M', lens: 'overview', detail: 'auto' },
  { fixture: 'M', lens: 'networking', detail: 'auto' },
  { fixture: 'M', lens: 'load-balancing', detail: 'auto' },
  { fixture: 'L', lens: 'overview', detail: 'projects' },
];

/** The packing rules `--packing` compares, by name. */
export const PACKING_RULES: readonly (readonly [string, PackPolicy])[] = [
  ['order', { stacks: false }],
  ['height', { stacks: false, byHeight: true }],
  ['chosen', { stacks: true }],
];

const USAGE = `Usage:
  pnpm --filter @gcportrait/layout measure [--view FIXTURE:LENS:DETAIL ...] [--runs N] [--packing] [--json]

Lays out each view (default: M overview, networking and load-balancing at auto, L overview at projects) and
prints its lane holders, its first routing pass's search work (the states it settled, which decide single-pass
mode), its mode and passes, and its routes' length, bends, border-hugging length, detours,
crossings, canvas-margin length and edges,
and the routes that run more than 1 000 px past both of their ends with the worst such distance (overshoots),
or with --packing the canvas area and the containers' mean fill, mean aspect deviation and share within 20 % of
the target under each packing rule.`;

export function parseView(text: string): View {
  const [fixture, lens, detail = 'auto'] = text.split(':');
  if (fixture !== 'S' && fixture !== 'M' && fixture !== 'L' && fixture !== 'XL')
    throw new Error(`unknown fixture in --view ${text}`);
  return { fixture, lens: LensIdSchema.parse(lens), detail: DetailLevelSchema.parse(detail) };
}

function nameOf(view: View): string {
  return `${view.fixture} ${view.lens} ${view.detail}`;
}

/** One view's routing figures: the routing report's essentials, the quality metrics, the best of `runs`. */
export function measureRoutes(view: View, runs = 3): Record<string, string | number> {
  const scene = demoScene(view.fixture, view.lens, view.detail);
  let best = Infinity;
  let layout = layoutSceneWith(scene, {}, {});
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    layout = layoutSceneWith(scene, {}, {});
    best = Math.min(best, performance.now() - start);
  }
  const { routing, counts } = layout.report;
  return {
    view: nameOf(view),
    rects: counts.rects,
    routed: routing.edges,
    holders: routing.holders,
    work: routing.work,
    mode: `${routing.mode} (${String(routing.passes)})`,
    squeezed: routing.squeezed,
    canvas: `${String(layout.bounds.width)}×${String(layout.bounds.height)}`,
    ...routeQuality(layout),
    ms: Math.round(best * 10) / 10,
  };
}

/**
 * One view's packing under each rule (packing only): the canvas area, and over its containers with two or more
 * children the mean fill, the mean deviation from the target aspect and how many lie within
 * `ASPECT_TOLERANCE` (20 %) of it.
 */
export function measurePacking(view: View): Record<string, string | number> {
  const scene = demoScene(view.fixture, view.lens, view.detail);
  const row: Record<string, string | number> = { view: nameOf(view) };
  for (const [name, packing] of PACKING_RULES) {
    const layout = layoutSceneWith(scene, { route: false }, { packing });
    const aspects = packingAspects(layout).filter((aspect) => aspect.children >= 2);
    const mean = (of: (aspect: PackingAspect) => number): number =>
      aspects.reduce((sum, aspect) => sum + of(aspect), 0) / Math.max(1, aspects.length);
    const within = aspects.filter((aspect) => aspect.deviation <= ASPECT_TOLERANCE).length;
    row[name] = [
      `${((layout.bounds.width * layout.bounds.height) / 1e6).toFixed(2)} M px²`,
      `fill ${(mean((aspect) => aspect.fill) * 100).toFixed(1)} %`,
      `deviation ${(mean((aspect) => aspect.deviation) * 100).toFixed(1)} %`,
      `within 20 % ${String(within)}/${String(aspects.length)}`,
    ].join(', ');
  }
  return row;
}

export function run(
  argv: readonly string[],
  write: (text: string) => void = (text) => process.stdout.write(text),
): number {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        view: { type: 'string', multiple: true },
        runs: { type: 'string', default: '3' },
        packing: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    write(`${(error as Error).message}\n${USAGE}\n`);
    return 2;
  }
  if (values.help) {
    write(`${USAGE}\n`);
    return 0;
  }
  const runs = Number(values.runs);
  let views: readonly View[];
  try {
    if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive whole number`);
    views = values.view === undefined ? DEFAULT_VIEWS : values.view.map(parseView);
  } catch (error) {
    write(`${(error as Error).message}\n${USAGE}\n`);
    return 2;
  }
  const rows = views.map((view) => (values.packing ? measurePacking(view) : measureRoutes(view, runs)));
  if (values.json) {
    write(`${JSON.stringify(rows, null, 2)}\n`);
    return 0;
  }
  const columns = Object.keys(rows[0] ?? {});
  write(`gcportrait layout measure\n${columns.join('\t')}\n`);
  for (const row of rows) write(`${columns.map((column) => String(row[column])).join('\t')}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(run(process.argv.slice(2)));
