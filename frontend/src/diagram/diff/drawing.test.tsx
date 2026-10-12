// SPDX-License-Identifier: MIT
/**
 * The timeline markers in the drawing (Drawing.tsx with diff/marks.ts; skill gcp-diagram-style §6, §7),
 * on demo S from 7 to 8 September in both themes: the added outline in `accent.peer` between canvas gaps, the 6 px
 * changed dot in `accent.path` on its `pathCasing` disc, the ghost (its body at 50 %, a dashed `accent.removed`
 * outline at full strength on a canvas band) where the layout placed it, the legend's rows only for what is drawn,
 * the description, the accessible names; a ghost is never a node (no id, no tab stop, no drill-in, no flip, not
 * counted), and pointing at it is pointing at the zone it lies in.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { canDrillIn } from '../actions';
import { rectsShown, zonesByFlip } from '../disclosure/flips';
import { buildDiagramModel, type DiagramModel } from '../model';
import { nodeIdOf } from '../painter';
import { renderDiagramSvg } from '../static';
import { DEMO_S } from '../testing/demoData';
import { demoDiagram, demoDiffDiagram } from '../testing/demoScenes';
import { one, parseSvg as parse, renderDrawing as render } from '../testing/drawing';
import {
  ADDED_WIDTH,
  CHANGED_DOT_CASING,
  CHANGED_DOT_RADIUS,
  GHOST_BAND,
  GHOST_DASH,
  GHOST_OPACITY,
  GHOST_STROKE_WIDTH,
  RING_GAP,
} from '../theme/styles';
import { PALETTES } from '../theme/tokens';
import { addedPathData, changedDotCentre } from './marks';

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

async function diffModel(since = '2026-09-07', day = '2026-09-08'): Promise<DiagramModel> {
  const { input } = await demoDiffDiagram('S', 'overview', 'auto', since, day);
  return buildDiagramModel(input);
}

describe.each(['light', 'dark'] as const)('the markers of a diff day, %s theme', (theme) => {
  const palette = PALETTES[theme];

  it('outlines an added node in accent.peer between canvas gaps, 8 px outside its border', async () => {
    const model = await diffModel();
    const doc = render(model, { theme });
    const rect = model.input.layout.rects[DEBUG_SUBSCRIPTION];
    if (rect === undefined) throw new Error('the subscription is not drawn');
    const line = one(doc, `.dg-added-lines path[data-added="${DEBUG_SUBSCRIPTION}"]`);
    expect(line.getAttribute('d')).toBe(addedPathData([rect]));
    const lines = one(doc, '.dg-added-lines');
    expect(lines.getAttribute('stroke')).toBe(palette.accentPeer);
    expect(lines.getAttribute('stroke-width')).toBe(String(ADDED_WIDTH));
    const gaps = one(doc, '.dg-added-gaps');
    expect(gaps.getAttribute('stroke')).toBe(palette.canvas);
    expect(gaps.getAttribute('stroke-width')).toBe(String(ADDED_WIDTH + 2 * RING_GAP));
    expect(one(doc, '.dg-diff').getAttribute('aria-hidden')).toBe('true');
  });

  it('puts the 6 px changed dot on a pathCasing disc on the changed node’s top-right corner', async () => {
    const model = await diffModel();
    const doc = render(model, { theme });
    const rect = model.input.layout.rects[SERVICES_PROJECT];
    if (rect === undefined) throw new Error('the project is not drawn');
    const circles = Array.from(
      one(doc, `.dg-changed[data-changed="${SERVICES_PROJECT}"]`).getElementsByTagName('circle'),
    );
    const at = changedDotCentre(rect);
    expect(circles.map((circle) => [circle.getAttribute('r'), circle.getAttribute('fill')])).toEqual([
      [String(CHANGED_DOT_RADIUS + CHANGED_DOT_CASING), palette.pathCasing],
      [String(CHANGED_DOT_RADIUS), palette.accentPath],
    ]);
    for (const circle of circles) {
      expect(Number(circle.getAttribute('cx'))).toBeCloseTo(at.x, 1);
      expect(Number(circle.getAttribute('cy'))).toBeCloseTo(at.y, 1);
    }
  });

  it('draws a removed node as a ghost where the layout placed it: body at 50 %, dashed accent.removed outline', async () => {
    const model = await diffModel();
    const doc = render(model, { theme });
    const ghost = one(doc, `.dg-ghost[data-ghost="${SCRATCH_BUCKET}"]`);
    expect(ghost.getAttribute('data-reason')).toBe('removed');
    expect(ghost.getAttribute('data-in')).toBe(DATA_PROJECT);
    expect(ghost.hasAttribute('data-id')).toBe(false);
    expect(doc.querySelector(`[data-id="${SCRATCH_BUCKET}"]`)).toBeNull();
    const rect = model.input.layout.rects[SCRATCH_BUCKET];
    const outline = one(doc, `.dg-ghost[data-ghost="${SCRATCH_BUCKET}"] .dg-ghost-line`);
    expect(outline.getAttribute('x')).toBe(String(rect?.x));
    expect(outline.getAttribute('stroke')).toBe(palette.accentRemoved);
    expect(outline.getAttribute('stroke-dasharray')).toBe(GHOST_DASH);
    expect(outline.getAttribute('stroke-width')).toBe(String(GHOST_STROKE_WIDTH));
    const band = one(doc, `.dg-ghost[data-ghost="${SCRATCH_BUCKET}"] .dg-ghost-band`);
    expect(band.getAttribute('stroke')).toBe(palette.canvas);
    expect(band.getAttribute('stroke-width')).toBe(String(GHOST_STROKE_WIDTH + 2 * GHOST_BAND));
    const body = Array.from(ghost.getElementsByTagName('g')).find((g) => g.getAttribute('opacity') !== null);
    expect(body?.getAttribute('opacity')).toBe(String(GHOST_OPACITY));
    expect(ghost.getElementsByTagName('title')[0]?.textContent).toBe(
      'Removed since 2026-09-07: Cloud Storage bucket: demo-data-1-scratch-1',
    );
    const texts = Array.from(ghost.getElementsByTagName('text')).map((text) => text.textContent);
    expect(texts).toEqual(['demo-data-1-scratch-1', 'removed']);
  });
});

describe('the markers’ place, legend rows and description', () => {
  it('paints ghosts after the nodes, and the markers before the overlays and lines', async () => {
    const doc = render(await diffModel());
    const order = Array.from(one(doc, '.dg-drawing').childNodes).flatMap((child) =>
      child.nodeType === 1 ? [(child as Element).getAttribute('class') ?? ''] : [],
    );
    const at = (name: string): number => order.indexOf(name);
    expect(at('dg-nodes')).toBeLessThan(at('dg-ghosts'));
    expect(at('dg-ghosts')).toBeLessThan(at('dg-diff'));
    expect(at('dg-diff')).toBeLessThan(at('dg-edges'));
  });

  it('adds the three rows to the legend, naming the day compared with', async () => {
    // Which rows a diff gets (only the markers drawn, none without one) is legend.test.ts's.
    const doc = render(await diffModel());
    const rows = Array.from(doc.querySelectorAll('.dg-legend text')).map((text) => text.textContent);
    expect(rows).toEqual(
      expect.arrayContaining([
        'added since 2026-09-07',
        'removed since 2026-09-07',
        'changed since 2026-09-07',
      ]),
    );
  });

  it('draws no marker or ghost layer without a diff', async () => {
    const { input } = await demoDiagram('S', 'overview');
    expect(render(buildDiagramModel(input)).querySelector('.dg-diff, .dg-ghosts')).toBeNull();
  });

  it('says “compared with” when the view stepped back to an earlier day', async () => {
    const doc = render(await diffModel('2026-09-08', '2026-09-07'));
    const rows = Array.from(doc.querySelectorAll('.dg-legend text')).map((text) => text.textContent);
    expect(rows).toContain('removed compared with 2026-09-08');
  });

  it('describes the day’s changes in the standalone SVG', async () => {
    const { input } = await demoDiffDiagram('S', 'overview', 'auto', '2026-09-07', '2026-09-08');
    const doc = parse(renderDiagramSvg(input, { theme: 'light', utcOffsetMinutes: 0 }));
    expect(doc.getElementsByTagName('desc')[0]?.textContent).toContain(
      'Changes since 2026-09-07: 2 added, 2 removed, 1 changed.',
    );
  });
});

describe('a ghost is no node', () => {
  it('is named and titled in the interactive canvas, but no button and no tab stop; changed nodes say so', async () => {
    const model = await diffModel();
    const doc = render(model, { interactive: true, collapsible: true });
    const ghost = one(doc, `.dg-ghost[data-ghost="${SCRATCH_BUCKET}"]`);
    expect(ghost.getAttribute('role')).toBe('graphics-symbol');
    expect(ghost.getAttribute('aria-label')).toBe(
      'Removed since 2026-09-07: Cloud Storage bucket: demo-data-1-scratch-1',
    );
    expect(ghost.hasAttribute('tabindex')).toBe(false);
    expect(ghost.querySelector('[tabindex], [role="button"]')).toBeNull();
    expect(one(doc, `[data-id="${DEBUG_SUBSCRIPTION}"]`).getAttribute('aria-label')).toMatch(
      /: debug-2, added since 2026-09-07$/,
    );
    expect(one(doc, `[data-id="${SERVICES_PROJECT}"]`).getAttribute('aria-label')).toMatch(
      /, changed since 2026-09-07$/,
    );
  });

  it('is pointed at as the zone it lies in (a click or a hover there is one on that zone)', async () => {
    const doc = render(await diffModel(), { interactive: true });
    const label = one(doc, `.dg-ghost[data-ghost="${SCRATCH_BUCKET}"] text`);
    expect(nodeIdOf(label)).toBe(DATA_PROJECT);
    // A ghost inside a ghost (the deleted project's VM) lies in the zone of the drawn day around the outer one.
    const top = render(await diffModel('2026-09-16', '2026-09-17'), { interactive: true });
    const project = one(top, `.dg-ghost[data-ghost="${REPORTS_PROJECT}"]`);
    expect(project.getAttribute('data-in')).not.toBeNull();
    const inside = one(top, `.dg-ghost[data-ghost="${REPORTS_VM}"]`);
    expect(inside.getAttribute('data-in')).toBe(project.getAttribute('data-in'));
  });

  it('is left out of the rects the canvas walks, of drill-in, of the flips and of “N of M shown”', async () => {
    const model = await diffModel('2026-09-16', '2026-09-17');
    const project = REPORTS_PROJECT;
    expect(model.ghosts.map(([id]) => id)).toContain(project);
    expect(model.rects.some(([id]) => id === project)).toBe(false);
    expect(model.nodes.has(project)).toBe(true);
    expect(canDrillIn(model, project)).toBe(false);
    const { input, report, diff } = await demoDiffDiagram(
      'S',
      'overview',
      'auto',
      '2026-09-16',
      '2026-09-17',
    );
    const shown = { scene: input.scene, report, diff };
    expect([...zonesByFlip(shown).values()].some((zone) => zone.id === project)).toBe(false);
    expect(rectsShown(shown).shown).toBe(input.scene.metadata.rectCount - Object.keys(diff.ghosts).length);
  });
});
