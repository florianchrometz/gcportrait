// SPDX-License-Identifier: MIT
/**
 * Byte stability (PNG and SVG byte-stable for a fixed fixture across two runs; across two processes:
 * cli.test.ts), from scratch and from the cache `--all` reuses, and sameness with the app: the SVG is
 * the renderer's own baseline (e2e/baselines/diagram/, written by the frontend's tests from the same components),
 * so the headless picture is the app's picture. Demo S overview's baselines are checked by cli.test.ts (light
 * through `--svg`, dark through `--all`) and by the render library's own tests.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { generateOrganization } from '@gcportrait/demo-data';
import { DEFAULT_VIEWPORT_BUDGET, viewportBudget } from '@gcportrait/graph';
import { PALETTES, TAGLINE } from '@gcportrait/render';
import { normalizeViewSpec, type DemoSize, type LensId } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import {
  createDemoViews,
  decodePng,
  drawPng,
  drawSvg,
  REPO_ROOT,
  THEMES,
  type DemoViews,
} from '../src/index.js';

const spec = (fixture: DemoSize, lens: LensId) => normalizeViewSpec({ snapshot: `demo:${fixture}`, lens });

async function draw(views: DemoViews, fixture: DemoSize, lens: LensId) {
  const view = await views.prepare(fixture, spec(fixture, lens));
  return THEMES.map((theme) => {
    const svg = drawSvg(view, theme);
    return { theme, svg, png: drawPng(svg, theme).png };
  });
}

describe('byte stability', () => {
  // `pnpm render --all` prepares every view from one DemoViews, which builds each organisation's snapshot and Graph
  // once: a second view from that cache must be the picture a fresh one draws.
  it.each<{ how: string; reuse: (views: DemoViews) => DemoViews }>([
    { how: 'from scratch', reuse: () => createDemoViews() },
    { how: 'from one cached DemoViews', reuse: (views) => views },
  ])('draws demo S overview to the same SVG and PNG bytes twice, $how, in both themes', async ({ reuse }) => {
    const views = createDemoViews();
    const first = await draw(views, 'S', 'overview');
    const second = await draw(reuse(views), 'S', 'overview');
    for (const [index, run] of first.entries()) {
      const again = second[index];
      expect(again?.theme).toBe(run.theme);
      expect(again?.svg).toBe(run.svg);
      expect(Buffer.compare(again?.png ?? Buffer.alloc(0), run.png)).toBe(0);
    }
    expect(first[0]?.png.equals(first[1]?.png ?? Buffer.alloc(0))).toBe(false);
  });
});

describe('the app’s picture', () => {
  it.each(['S-networking', 'M-load-balancing'] as const)(
    '%s is byte for byte the renderer’s baseline SVG in both themes',
    async (name) => {
      const [fixture, ...rest] = name.split('-') as [DemoSize, ...string[]];
      const lens = rest.join('-') as LensId;
      const view = await createDemoViews().prepare(fixture, spec(fixture, lens));
      for (const theme of THEMES) {
        const baseline = readFileSync(
          path.join(REPO_ROOT, 'e2e/baselines/diagram', `${fixture}-${lens}-auto-${theme}.svg`),
          'utf8',
        );
        expect(drawSvg(view, theme)).toBe(baseline);
      }
    },
  );

  it('carries the tagline, the title and the description, no affiliation line, and fills the PNG with the theme canvas', async () => {
    const view = await createDemoViews().prepare('S', spec('S', 'overview'));
    for (const theme of THEMES) {
      const svg = drawSvg(view, theme);
      expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg ')).toBe(true);
      // The canvas's title block, ending with the tagline; the non-affiliation statement sits in the footers
      // and long-form texts only, so neither the title block nor <desc> carries it.
      expect(svg).toContain(`>${TAGLINE}</text>`);
      expect(svg).not.toMatch(/affiliated/i);
      expect(svg).toContain('Drawn with gcportrait.</desc>');
      expect(svg).toMatch(/<title>gcportrait diagram of example\.com, Overview lens<\/title>/);
      expect(svg).toContain('2026-10-08T00:00:00+00:00');
      const png = decodePng(drawPng(svg, theme, { scale: 1 }).png);
      const canvas = PALETTES[theme].canvas;
      const corner = Array.from(png.data.subarray(0, 4));
      expect(corner).toEqual([
        Number.parseInt(canvas.slice(1, 3), 16),
        Number.parseInt(canvas.slice(3, 5), 16),
        Number.parseInt(canvas.slice(5, 7), 16),
        255,
      ]);
    }
  });

  it('reports the layout’s invariants and the detail level the view used, budgeted as the app at its smallest viewport unless given another', async () => {
    const view = await createDemoViews().prepare('M', spec('M', 'networking'));
    expect(view.violations).toEqual([]);
    // The app's `auto` budget at 1280×800, its smallest viewport, so the headless view opens what the app
    // opens.
    expect(view.report.detail).toMatchObject({
      requested: 'auto',
      used: 'folders',
      budget: DEFAULT_VIEWPORT_BUDGET,
    });
    expect(view.assets).toBe(generateOrganization({ size: 'M' }).assets.length);
    const wide = await createDemoViews().prepare('M', spec('M', 'networking'), { width: 3840, height: 2160 });
    expect(wide.report.detail.budget).toBe(viewportBudget(3840, 2160));
    expect(wide.report.detail.budget).toBeGreaterThan(DEFAULT_VIEWPORT_BUDGET);
  });
});
