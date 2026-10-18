// SPDX-License-Identifier: Apache-2.0
/**
 * The keyboard on the interactive canvas (style skill §13): the arrow keys, Home and End move focus between
 * the items of a zone (navigation.ts decides where; the canvas moves focus, keeps one tab stop, draws the focus
 * ring and pans the camera to show the item, zooming in first to the label scale when it is further out), ↓ on an
 * open zone goes inside it, Escape returns to the zone around the item once nothing is selected, and Enter still
 * selects; `+`, `-` and `0` zoom; the focus ring keeps 2 px on screen at any scale; focus parked on the canvas for
 * a drill-in goes to the new view's tab stop, and only then.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { expectNoAxeViolations } from '../../test/axe';
import { KEYBOARD_MIN_SCALE, ZOOM_STEP } from '../camera';
import { FOCUS_PARKED_ATTRIBUTE, parkCanvasFocus } from '../canvasFocus';
import { DiagramCanvas, type DiagramCanvasProps } from '../DiagramCanvas';
import { planDrawing } from '../Drawing';
import { FOCUS_DISTANCE } from '../marks';
import {
  cameraOf,
  canvasOf as canvas,
  canvasProps,
  collapseOf,
  element,
  manualFrames,
  moveCamera,
  nodeOf,
  reduceMotion,
  tabStops,
} from '../testing/canvas';
import { card, modelOf, scene, smallScene, wideScene } from '../testing/scenes';
import { FOCUS_WIDTH, RING_GAP } from '../theme/styles';
import { fitTransform, SCALE_EXTENT } from '../viewport';
import { keyboardMap, navigate } from './navigation';

const model = modelOf(smallScene([['run/web', 'run/api', 'uses']]));

/** The canvas on the small scene, flips handled (so every open zone has its collapse button). */
const props = (overrides: Partial<DiagramCanvasProps> = {}): DiagramCanvasProps =>
  canvasProps(model, { onFlip: () => undefined, ...overrides });
/** The node id of the focused element (a node, or the zone of a focused collapse button). */
const focusedId = (): string | null =>
  document.activeElement?.closest('[data-id]')?.getAttribute('data-id') ?? null;

function press(key: string, init: KeyboardEventInit = {}): void {
  const target = document.activeElement;
  if (target === null) throw new Error('nothing has focus');
  fireEvent.keyDown(target, { key, ...init });
}

/** The focus ring's line and band (its canvas gaps), as drawn. */
function focusRing(svg: Element): { shown: boolean; line: number; band: number; x: number } {
  const ring = element(svg, '.dg-focus-ring');
  return {
    shown: ring.getAttribute('display') !== 'none',
    line: Number(element(ring, '.dg-ring').getAttribute('stroke-width')),
    band: Number(element(ring, '.dg-ring-gap').getAttribute('stroke-width')),
    x: Number(element(ring, '.dg-ring').getAttribute('x')),
  };
}

describe('the arrow keys on the canvas', () => {
  it('move focus where navigation.ts says, keeping one tab stop and the focus ring', () => {
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const map = keyboardMap(model.rects, true);
    nodeOf(svg, 'run/api').focus();
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'End', 'Home'] as const) {
      const from = focusedId();
      if (from === null) throw new Error('lost focus');
      const expected = navigate(map, from, key) ?? from;
      press(key);
      expect(focusedId(), `${key} from ${from}`).toBe(expected);
      expect(tabStops(svg)).toHaveLength(1);
    }
  });

  it('go inside an open zone with ↓, up to its header with ↑ from its first row, and to it with Escape', () => {
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    nodeOf(svg, 'run/api').focus();
    press('Escape');
    expect(document.activeElement).toBe(collapseOf(svg, 'subnets/a'));
    expect(tabStops(svg)).toEqual([collapseOf(svg, 'subnets/a')]);
    // The zone's collapse button stands for it and shows its own focus, and the focus ring goes around the zone
    // (its plate shrinks with the camera; the ring does not).
    const subnet = model.input.layout.rects['subnets/a'];
    expect(focusRing(svg).shown).toBe(true);
    // Fitted below 100 %: the ring keeps its screen size (FOCUS_DISTANCE on screen outside the zone's border).
    const { k } = cameraOf(svg);
    expect(k).toBeLessThan(1);
    expect(((subnet?.x ?? 0) - focusRing(svg).x) * k).toBeCloseTo(FOCUS_DISTANCE);
    press('Escape');
    expect(document.activeElement).toBe(collapseOf(svg, 'networks/vpc'));
    press('ArrowDown');
    expect(document.activeElement).toBe(collapseOf(svg, 'subnets/a'));
    press('ArrowDown');
    const first = keyboardMap(model.rects, true).items.get('subnets/a')?.[0];
    expect(focusedId()).toBe(first);
    expect(element(svg, '.dg-focus-ring').getAttribute('display')).toBeNull();
    press('ArrowUp');
    expect(document.activeElement).toBe(collapseOf(svg, 'subnets/a'));
  });

  it('leave a selection to Escape first, and Enter still selects (the drawer opens)', () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(<DiagramCanvas {...props({ onSelect })} />);
    const svg = canvas(container);
    const api = nodeOf(svg, 'run/api');
    api.focus();
    press('Enter');
    expect(onSelect).toHaveBeenLastCalledWith('run/api');
    rerender(<DiagramCanvas {...props({ onSelect, selection: 'run/api' })} />);
    press('Escape');
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(document.activeElement).toBe(api);
    rerender(<DiagramCanvas {...props({ onSelect, selection: null })} />);
    press('Escape');
    expect(document.activeElement).toBe(collapseOf(svg, 'subnets/a'));
  });

  it('leave modified keys alone, and from the canvas itself go to its tab stop', () => {
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const api = nodeOf(svg, 'run/api');
    api.focus();
    press('ArrowRight', { shiftKey: true });
    press('ArrowRight', { ctrlKey: true });
    expect(document.activeElement).toBe(api);
    svg.focus();
    fireEvent.keyDown(svg, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(tabStops(svg)[0]);
  });

  it('without collapse buttons, cross the whole drawing between solid nodes, and Escape stays', () => {
    const without: { -readonly [K in keyof DiagramCanvasProps]: DiagramCanvasProps[K] } = props();
    delete without.onFlip;
    const { container } = render(<DiagramCanvas {...without} />);
    const svg = canvas(container);
    const map = keyboardMap(model.rects, false);
    expect(map.zones.size).toBe(0);
    nodeOf(svg, 'run/api').focus();
    press('End');
    const last = map.items.get(null)?.at(-1);
    expect(focusedId()).toBe(last);
    press('Escape');
    expect(focusedId()).toBe(last);
  });

  it('pan the camera just enough to show an item out of view (at once with reduced motion)', () => {
    reduceMotion();
    const wide = modelOf(wideScene());
    const { container } = render(<DiagramCanvas {...props({ model: wide })} />);
    const svg = canvas(container);
    // Zoomed right in on the top-left corner: most of the drawing is out of view.
    moveCamera(svg, { k: 4, x: 0, y: 0 });
    expect(cameraOf(svg)).toMatchObject({ k: 4, x: 0, y: 0 });
    const start = keyboardMap(wide.rects, true).items.get(null)?.at(-1);
    if (start === undefined) throw new Error('no items');
    collapseOf(svg, start).focus();
    press('ArrowDown');
    const after = cameraOf(svg);
    expect(after.k).toBe(4);
    expect(after.x !== 0 || after.y !== 0).toBe(true);
  });

  it('stop a pan still on its way when a new view is drawn, which starts fitted', () => {
    const frames = manualFrames();
    const wide = modelOf(wideScene());
    const { container, rerender } = render(<DiagramCanvas {...props({ model: wide })} />);
    const svg = canvas(container);
    moveCamera(svg, { k: 4, x: 0, y: 0 });
    const last = keyboardMap(wide.rects, true).items.get(null)?.at(-1);
    if (last === undefined) throw new Error('no items');
    collapseOf(svg, last).focus();
    // The pan to the card glides (200 ms) ...
    press('ArrowDown');
    // ... and a drill-in draws another view at once: it is fitted, and the pan does not carry it off.
    rerender(<DiagramCanvas {...props()} />);
    const plan = planDrawing(model, { overlays: true, interactive: true, utcOffsetMinutes: 0 });
    const fit = fitTransform(plan.frame, 1280, 800);
    // Every frame the pan asked for runs, as late as can be: none of them moves the new view.
    frames.run(performance.now() + 10_000);
    const now = cameraOf(svg);
    expect(now.k).toBeCloseTo(fit.k);
    expect(now.x).toBeCloseTo(fit.x);
    expect(now.y).toBeCloseTo(fit.y);
  });

  it('give focus back to a zone’s collapse button when its menu closes, and across a drill-in to the new drawing', () => {
    const onDrillIn = vi.fn();
    const onSelect = vi.fn();
    const { container, rerender } = render(<DiagramCanvas {...props({ onDrillIn, onSelect })} />);
    const svg = canvas(container);
    const project = collapseOf(svg, 'projects/web');
    project.focus();
    press('F10', { shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith('projects/web');
    expect(screen.getByRole('menu')).toBeDefined();
    press('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(project);

    press('F10', { shiftKey: true });
    press('End');
    const drill = screen.getByRole('menuitem', { name: 'Details' });
    expect(document.activeElement).toBe(drill);
    // Enter on a menu item is its button's click (jsdom does not turn the key into one).
    fireEvent.click(drill);
    expect(onDrillIn).toHaveBeenCalledWith('projects/web');
    // The drawing is about to be replaced: focus waits on the canvas ...
    expect(document.activeElement).toBe(svg);
    // ... and goes to the new drawing's tab stop when it arrives.
    const drilled = modelOf(scene([card('run/a', 'a'), card('run/b', 'b')]));
    rerender(<DiagramCanvas {...props({ model: drilled, onDrillIn, onSelect })} />);
    expect(document.activeElement).toBe(nodeOf(svg, 'run/a'));
    expect(tabStops(svg)).toEqual([nodeOf(svg, 'run/a')]);
  });

  it('zoom in to the scale labels are drawn at when the keyboard moves further out, about the item', () => {
    reduceMotion();
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const api = nodeOf(svg, 'run/api');
    api.focus();
    // Zoomed out as far as the camera goes, with the zoom key.
    for (let presses = 0; presses < 20; presses += 1) press('-');
    expect(cameraOf(svg).k).toBe(SCALE_EXTENT[0]);
    expect(svg.getAttribute('class')).toContain('dg-lod-nolabel');
    press('ArrowRight');
    const moved = cameraOf(svg);
    expect(moved.k).toBe(KEYBOARD_MIN_SCALE);
    // Labels are drawn again, and the item the keyboard reached is in view.
    expect(svg.getAttribute('class')).not.toContain('dg-lod-nolabel');
    const id = focusedId();
    const rect = id === null ? undefined : model.input.layout.rects[id];
    if (rect === undefined) throw new Error('no focused item');
    const left = rect.x * moved.k + moved.x;
    const top = rect.y * moved.k + moved.y;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left + rect.width * moved.k).toBeLessThanOrEqual(1280);
    expect(top + rect.height * moved.k).toBeLessThanOrEqual(800);
    // Already at or past that scale, a move only pans.
    press('+');
    const closer = cameraOf(svg).k;
    press('ArrowLeft');
    expect(cameraOf(svg).k).toBe(closer);
  });

  it('zoom with + and -, about the focused item, and fit the drawing with 0; modified keys are the browser’s', () => {
    reduceMotion();
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const plan = planDrawing(model, { overlays: true, interactive: true, utcOffsetMinutes: 0 });
    const fit = fitTransform(plan.frame, 1280, 800);
    expect(cameraOf(svg).k).toBeCloseTo(fit.k);
    const api = nodeOf(svg, 'run/api');
    api.focus();
    const rect = model.input.layout.rects['run/api'];
    if (rect === undefined) throw new Error('no rect');
    const centre = (): { x: number; y: number } => {
      const t = cameraOf(svg);
      return { x: (rect.x + rect.width / 2) * t.k + t.x, y: (rect.y + rect.height / 2) * t.k + t.y };
    };
    const before = centre();
    press('+');
    expect(cameraOf(svg).k).toBeCloseTo(fit.k * ZOOM_STEP);
    // About the item: it stays where it was on screen (it was in view, and still is).
    expect(centre().x).toBeCloseTo(before.x);
    expect(centre().y).toBeCloseTo(before.y);
    press('=');
    expect(cameraOf(svg).k).toBeCloseTo(fit.k * ZOOM_STEP ** 2);
    press('-');
    expect(cameraOf(svg).k).toBeCloseTo(fit.k * ZOOM_STEP);
    // Ctrl or Cmd with them zoom the page: the browser's.
    press('+', { ctrlKey: true });
    press('-', { metaKey: true });
    expect(cameraOf(svg).k).toBeCloseTo(fit.k * ZOOM_STEP);
    // AltGr (Ctrl+Alt) typing the key is the key.
    press('+', { ctrlKey: true, altKey: true });
    expect(cameraOf(svg).k).toBeCloseTo(fit.k * ZOOM_STEP ** 2);
    press('0');
    expect(cameraOf(svg).k).toBeCloseTo(fit.k);
    expect(cameraOf(svg).x).toBeCloseTo(fit.x);
    expect(cameraOf(svg).y).toBeCloseTo(fit.y);
    // From the canvas itself, about the canvas's centre.
    svg.focus();
    fireEvent.keyDown(svg, { key: '+' });
    expect(cameraOf(svg).k).toBeCloseTo(fit.k * ZOOM_STEP);
    expect(document.activeElement).toBe(api.ownerSVGElement);
  });

  it('keep the focus ring 2 px wide between 2 px gaps on screen when zoomed out, as drawn at 100 % closer in', () => {
    reduceMotion();
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    // Moved to by a key, so the ring shows (jsdom has no focus-visible heuristic).
    const map = keyboardMap(model.rects, true);
    const key = (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'] as const).find(
      (candidate) => {
        const to = navigate(map, 'run/web', candidate);
        return to !== null && model.input.layout.rects[to]?.role === 'card';
      },
    );
    if (key === undefined) throw new Error('no key moves from run/web to a card');
    nodeOf(svg, 'run/web').focus();
    press(key);
    const id = focusedId();
    const rect = id === null ? undefined : model.input.layout.rects[id];
    const api = document.activeElement;
    if (rect === undefined || !(api instanceof SVGElement)) throw new Error('no focused card');
    expect(rect.role).toBe('card');
    for (let presses = 0; presses < 20; presses += 1) press('-');
    const k = cameraOf(svg).k;
    expect(k).toBe(SCALE_EXTENT[0]);
    const ring = focusRing(svg);
    expect(ring.shown).toBe(true);
    // In screen pixels: the line FOCUS_WIDTH, the band (the gap on both sides) FOCUS_WIDTH + 2 × RING_GAP.
    expect(ring.line * k).toBeCloseTo(FOCUS_WIDTH);
    expect(ring.band * k).toBeCloseTo(FOCUS_WIDTH + 2 * RING_GAP);
    expect((rect.x - ring.x) * k).toBeCloseTo(FOCUS_DISTANCE);
    // At 100 % and closer, the drawing's own ring (drawing units).
    for (let presses = 0; presses < 20; presses += 1) press('+');
    expect(cameraOf(svg).k).toBeGreaterThan(1);
    expect(focusRing(svg).line).toBe(FOCUS_WIDTH);
    expect(focusRing(svg).band).toBe(FOCUS_WIDTH + 2 * RING_GAP);
    // Focus gone: no ring, and its widths as React drew them.
    api.blur();
    expect(focusRing(svg).shown).toBe(false);
    expect(focusRing(svg).line).toBe(FOCUS_WIDTH);
  });

  it('start with the top-left solid node as the tab stop, whatever order the layout lists its rects in', () => {
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const solids = model.rects.filter(([, rect]) => rect.role !== 'zone');
    const [first] = [...solids].sort(([, a], [, b]) => a.y - b.y || a.x - b.x);
    expect(tabStops(svg)).toEqual([nodeOf(svg, first?.[0] ?? '')]);
  });

  it('move focus parked on the canvas (a drill-in from the drawer) to the new view’s tab stop, and only then', () => {
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    parkCanvasFocus(svg);
    expect(document.activeElement).toBe(svg);
    // The same view drawn again (a theme change) leaves focus waiting.
    rerender(<DiagramCanvas {...props({ theme: 'dark' })} />);
    expect(document.activeElement).toBe(svg);
    const drilled = modelOf(scene([card('run/a', 'a'), card('run/b', 'b')]));
    rerender(<DiagramCanvas {...props({ model: drilled, theme: 'dark' })} />);
    expect(document.activeElement).toBe(nodeOf(svg, 'run/a'));
    expect(svg.hasAttribute(FOCUS_PARKED_ATTRIBUTE)).toBe(false);

    // A drill-in that draws nothing new, then the person moves on: a later view does not pull focus.
    parkCanvasFocus(svg);
    fireEvent.pointerDown(svg);
    expect(svg.hasAttribute(FOCUS_PARKED_ATTRIBUTE)).toBe(false);
    rerender(<DiagramCanvas {...props({ theme: 'dark' })} />);
    expect(document.activeElement).toBe(svg);
    parkCanvasFocus(svg);
    nodeOf(svg, 'run/api').focus();
    expect(svg.hasAttribute(FOCUS_PARKED_ATTRIBUTE)).toBe(false);
  });

  it('keeps the canvas free of axe violations with focus inside a zone', async () => {
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    nodeOf(svg, 'run/api').focus();
    press('Escape');
    await expectNoAxeViolations(container);
  });
});
