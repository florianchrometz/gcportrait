// SPDX-License-Identifier: Apache-2.0
/**
 * Where the selected node's console action goes: inside the node, in its top-right corner, so it never
 * covers another card. The first pill hung 9 px under the card and was 20 px tall, while two rows of cards are
 * 20 px apart, so it lay on the next card (`partner-gw-1` over `partner-gw-2` in demo M's compute lens). And the
 * keyboard focus ring, which keeps its screen size at any zoom.
 */
import type { LayoutRect, Rect } from '@gcportrait/layout';
import { describe, expect, it } from 'vitest';

import { CONSOLE_LABELS } from './actions';
import {
  consoleActionAnchor,
  consoleActionBox,
  consoleActionExpands,
  consoleActionWidth,
  consoleGlyphPath,
  focusRingPlacement,
} from './marks';
import { demoDiagram } from './testing/demoScenes';
import { CONSOLE_ACTION } from './theme/styles';

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Whether two boxes share any area (touching edges do not count). */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function ancestors(rects: Readonly<Record<string, LayoutRect>>, id: string): Set<string> {
  const found = new Set<string>();
  for (let parent = rects[id]?.parent ?? null; parent !== null; parent = rects[parent]?.parent ?? null)
    found.add(parent);
  return found;
}

const LABELS = [CONSOLE_LABELS.resource, CONSOLE_LABELS.project];

describe.each(['all', 'auto'] as const)('the console action in demo M, compute lens, detail %s', (detail) => {
  it('lies inside the node’s rect for every card, chip and card-sized zone, labelled or not', async () => {
    const { layout } = await demoDiagram('M', 'compute', detail);
    const entries = Object.entries(layout.rects);
    const solids = entries.filter(([, rect]) => rect.role !== 'zone');
    expect(solids.length).toBeGreaterThan(detail === 'all' ? 100 : 10);
    let expanded = 0;
    for (const [id, rect] of solids) {
      const boxes = [consoleActionBox(rect, CONSOLE_ACTION.compactWidth)];
      for (const label of LABELS) {
        const width = consoleActionWidth(label);
        if (consoleActionExpands(rect, width)) boxes.push(consoleActionBox(rect, width));
      }
      expanded += boxes.length - 1;
      const around = ancestors(layout.rects, id);
      for (const box of boxes) {
        expect(inside(box, rect), `${id}: ${JSON.stringify(box)} in ${JSON.stringify(rect)}`).toBe(true);
        // Inside its own rect, it can only share area with the zones around it: never another card.
        const others = entries.filter(([other, r]) => other !== id && !around.has(other) && overlaps(box, r));
        expect(
          others.map(([other]) => other),
          id,
        ).toEqual([]);
      }
    }
    // Most cards have room for "Open in Cloud Console"; the longer project wording fits fewer.
    expect(expanded).toBeGreaterThan(solids.length / 2);
  });

  it('keeps the icon-only pill of an open zone inside the zone, clear of its children', async () => {
    const { layout } = await demoDiagram('M', 'compute', detail);
    const entries = Object.entries(layout.rects);
    for (const [id, rect] of entries.filter(([, r]) => r.role === 'zone' && !r.collapsed)) {
      const box = consoleActionBox(rect, CONSOLE_ACTION.compactWidth);
      expect(inside(box, rect), id).toBe(true);
      for (const label of LABELS) expect(consoleActionExpands(rect, consoleActionWidth(label))).toBe(false);
      const around = ancestors(layout.rects, id);
      const others = entries.filter(([other, r]) => other !== id && !around.has(other) && overlaps(box, r));
      expect(
        others.map(([other]) => other),
        id,
      ).toEqual([]);
    }
  });
});

describe('the console action’s geometry', () => {
  const card: LayoutRect = {
    x: 100,
    y: 40,
    width: 160,
    height: 44,
    parent: null,
    role: 'card',
    kind: 'card',
    depth: 1,
    headerHeight: 0,
    padding: 0,
    collapsed: false,
  };

  it('anchors at a card’s top-right corner, a 16 px circle concentric with its 8 px corner', () => {
    expect(consoleActionAnchor(card)).toEqual({ x: 260, y: 40 });
    expect(consoleActionBox(card, 16)).toEqual({ x: 244, y: 40, width: 16, height: 16 });
    // A zone's corner is 10 px: the circle moves 2 px in to share its centre.
    const zone: LayoutRect = { ...card, role: 'zone', kind: 'project', width: 400, height: 300 };
    expect(consoleActionAnchor(zone)).toEqual({ x: 498, y: 42 });
  });

  it('labels the pill only where it fits inside the card', () => {
    const width = consoleActionWidth(CONSOLE_LABELS.resource);
    // 6 px padding, the 11 px / 500 label, 2 px, and the glyph's 12 px slot.
    expect(width).toBeGreaterThan(120);
    expect(width).toBeLessThan(148);
    expect(consoleActionExpands(card, width)).toBe(true);
    expect(consoleActionExpands({ ...card, width: width - 1 }, width)).toBe(false);
    expect(consoleActionExpands({ ...card, role: 'chip' }, width)).toBe(true);
  });

  it('draws the ↗ glyph centred in the icon-only pill', () => {
    expect(consoleGlyphPath()).toBe('M-12 12L-4 4M-8.8 4H-4V8.8');
  });
});

describe('the focus ring at a scale', () => {
  const rect = { x: 100, y: 100, width: 180, height: 44, role: 'card' } as Parameters<
    typeof focusRingPlacement
  >[0];

  it('is the drawing’s ring at 100 % and closer, and keeps its screen size further out', () => {
    expect(focusRingPlacement(rect, 1)).toMatchObject({ x: 97, y: 97, band: 6, line: 2 });
    expect(focusRingPlacement(rect, 3)).toMatchObject({ x: 97, band: 6, line: 2 });
    const far = focusRingPlacement(rect, 0.1);
    expect(far.line * 0.1).toBeCloseTo(2);
    expect(far.band * 0.1).toBeCloseTo(6);
    expect((rect.x - far.x) * 0.1).toBeCloseTo(3);
  });
});
