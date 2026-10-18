// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Visual baselines as deterministic SVG text, not screenshots: CI runs on Linux and pixels from
 * another platform would never match, but the SVG the renderer writes is the same everywhere. Each case is a
 * demo organisation × lens × theme, rendered as a standalone export-like SVG (legend and title block included,
 * read time at UTC) and compared with `e2e/baselines/diagram/<fixture>-<lens>-<detail>-<theme>.svg`. The
 * headless renderer rasterises the same files for review.
 *
 * Update them deliberately: `pnpm --filter @gcportrait/frontend test src/diagram/baselines.test.tsx -u` (the
 * file before `-u`, which takes an optional value), look at the changed SVGs (a browser opens them), and say why
 * in the pull request.
 *
 * The cases: S, M and L at detail `auto` (what the app opens at 1280×800; S is fully open, M and L are at the
 * folder level), and M at `all` as the fourth, so cards, subnets, edge heads and dim mode are pinned at a
 * realistic size and not only at S (S at `all` would repeat S at `auto`, which is already fully open). XL is not
 * drawn here: its folder-level chips are what M and L at `auto` already pin, and its layout's cost is budgeted by
 * `pnpm --filter @gcportrait/layout test:budget`.
 *
 * Selected states: demo S with a node selected, drawn with its selection trace (the path to the root,
 * the traced lines on top, the reached nodes' rings, the selection ring and the legend's trace column) as the
 * canvas paints it: a global forwarding rule in the load-balancing lens (its chain to the backends) and a VM
 * in the overview lens (its subnet and instance-group lines), both themes, as
 * `<fixture>-<lens>-<detail>-<theme>-selected-<what>.svg`.
 *
 * Timeline days compared with the day before: demo S in the overview lens on 8 September after 7 September
 * (an added subscription outlined, a removed bucket as a ghost in its project, a changed project's dot, the three
 * legend rows) and on 17 September after 16 September (the deleted reports project as a ghost zone with the ghosts
 * of what it held, a changed bucket's dot), both themes, as `<fixture>-<lens>-<detail>-<theme>-diff-<day>.svg`.
 */
import type { DemoSize, DetailLevel, LensId } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { TAGLINE } from '../branding';
import { renderDiagramSvg } from './static';
import { DEMO_S } from './testing/demoData';
import { demoDiagram, demoDiffDiagram } from './testing/demoScenes';
import type { DiagramTheme } from './theme/tokens';

const CASES: ReadonlyArray<{ readonly size: DemoSize; readonly detail: DetailLevel }> = [
  { size: 'S', detail: 'auto' },
  { size: 'M', detail: 'auto' },
  { size: 'L', detail: 'auto' },
  { size: 'M', detail: 'all' },
];
const LENSES: readonly LensId[] = ['overview', 'networking', 'load-balancing'];
const THEMES: readonly DiagramTheme[] = ['light', 'dark'];

/**
 * What every drawing must show, whatever else changes (style skill §7, §11), and what none may: the
 * non-affiliation line, in the title block or in `<desc>` (the statement goes in the app footer only; AGENTS.md,
 * Non-affiliation, brand and legal).
 */
function expectInvariants(svg: string, rootLabel: string, day = '2026-10-08'): void {
  expect(svg).toContain(`>${TAGLINE}</text>`);
  expect(svg).not.toMatch(/affiliated/i);
  expect(svg).toContain('class="dg-legend"');
  expect(svg).toContain(`>${rootLabel}<`);
  expect(svg).toContain(`${day}T00:00:00+00:00`);
  const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((match) => Number(match[1]));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10.5);
}

describe.each(CASES)('demo $size at detail $detail', ({ size, detail }) => {
  it.each(LENSES)(
    '%s lens matches its baselines in both themes',
    async (lens) => {
      const { input } = await demoDiagram(size, lens, detail);
      for (const theme of THEMES) {
        const svg = renderDiagramSvg(input, { theme, utcOffsetMinutes: 0 });
        expectInvariants(svg, input.scene.metadata.rootLabel);
        await expect(svg).toMatchFileSnapshot(
          `../../../e2e/baselines/diagram/${size}-${lens}-${detail}-${theme}.svg`,
        );
      }
    },
    120_000,
  );
});

const SELECTED: ReadonlyArray<{ readonly lens: LensId; readonly what: string; readonly id: string }> = [
  { lens: 'load-balancing', what: 'forwarding-rule', id: DEMO_S.forwardingRule },
  { lens: 'overview', what: 'vm', id: DEMO_S.webVm },
];

describe('demo S with a node selected (the selection trace)', () => {
  it.each(SELECTED)(
    '$lens lens, $what selected: matches its baselines in both themes',
    async ({ lens, what, id }) => {
      const { input } = await demoDiagram('S', lens, 'auto');
      expect(input.layout.rects[id]).toBeDefined();
      for (const theme of THEMES) {
        const svg = renderDiagramSvg(input, { theme, utcOffsetMinutes: 0, selection: id });
        expectInvariants(svg, input.scene.metadata.rootLabel);
        expect(svg).toContain('class="dg-select-ring"');
        expect(svg).toContain('class="dg-traced"');
        expect(svg).toContain('path to root');
        await expect(svg).toMatchFileSnapshot(
          `../../../e2e/baselines/diagram/S-${lens}-auto-${theme}-selected-${what}.svg`,
        );
      }
    },
    120_000,
  );
});

const DIFF_DAYS: ReadonlyArray<{ readonly since: string; readonly day: string; readonly ghost: string }> = [
  { since: '2026-09-07', day: '2026-09-08', ghost: DEMO_S.scratchBucket },
  { since: '2026-09-16', day: '2026-09-17', ghost: DEMO_S.reportsProject },
];

describe('demo S on a timeline day compared with the day before (the diff overlay)', () => {
  it.each(DIFF_DAYS)(
    'overview lens on $day after $since: matches its baselines in both themes',
    async ({ since, day, ghost }) => {
      const { input } = await demoDiffDiagram('S', 'overview', 'auto', since, day);
      expect(input.diff?.ghosts[ghost]).toBeDefined();
      for (const theme of THEMES) {
        const svg = renderDiagramSvg(input, { theme, utcOffsetMinutes: 0 });
        expectInvariants(svg, input.scene.metadata.rootLabel, day);
        expect(svg).toContain(`data-ghost="${ghost}"`);
        expect(svg).toContain('class="dg-changed"');
        expect(svg).toContain(`changed since ${since}`);
        expect(svg).toContain(`removed since ${since}`);
        expect(svg).toContain(`Changes since ${since}: `);
        await expect(svg).toMatchFileSnapshot(
          `../../../e2e/baselines/diagram/S-overview-auto-${theme}-diff-${day}.svg`,
        );
      }
    },
    120_000,
  );
});
