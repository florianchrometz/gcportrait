// SPDX-License-Identifier: MIT
/**
 * Fingers on the interactive canvas (touch.ts, AGENTS.md's touch model), as synthetic pointer events of `pointerType`
 * `touch` in jsdom (whose boxes are all at 0, 0, so a client point is the canvas's point): one finger pans and never
 * selects, two pinch about a midpoint that stays put, a tap selects or clears as a click does and flips a chip, a
 * double tap zooms in about its point (on a chip the first tap's flip stands, and nothing zooms), and a long press
 * shows what hover shows a mouse, until the next finger touches. A tap leaves a glide on its way, a pan stops it. The
 * clicks, double-clicks and right-clicks the browser makes of a finger change nothing more, and its mouse events move
 * no camera, while a mouse keeps its hover, click, double-click and drag, and a pen is read as a mouse is.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DOUBLE_TAP_ZOOM, focusTransform } from './camera';
import { DiagramCanvas, type DiagramCanvasProps } from './DiagramCanvas';
import {
  cameraOf,
  canvasOf,
  canvasProps,
  chipOf,
  manualFrames,
  mouseClick,
  mouseEvent,
  nodeOf,
  reduceMotion,
} from './testing/canvas';
import { card, modelOf, scene, smallScene, withConsoleLinks, zone } from './testing/scenes';
import { LONG_PRESS_MS, TOUCH_MOUSE_MS } from './touch';
import { cameraAttribute, SCALE_EXTENT } from './viewport';

const model = modelOf(smallScene([['run/web', 'run/api', 'uses']]));

const props = (overrides: Partial<DiagramCanvasProps> = {}): DiagramCanvasProps =>
  canvasProps(model, overrides);

/** One finger, `id`, the first on the canvas (`primary`) or a second one. */
function finger(id: number, primary = true) {
  const init = (x: number, y: number) => ({
    pointerType: 'touch',
    pointerId: id,
    isPrimary: primary,
    clientX: x,
    clientY: y,
  });
  return {
    down: (target: Element, x: number, y: number) => fireEvent.pointerDown(target, init(x, y)),
    move: (target: Element, x: number, y: number) => fireEvent.pointerMove(target, init(x, y)),
    up: (target: Element, x: number, y: number) => fireEvent.pointerUp(target, init(x, y)),
  };
}

/** A tap at `x`, `y` on `target`, and the click the browser makes of it. */
function tap(target: Element, x: number, y: number, id = 1): void {
  const touch = finger(id);
  touch.down(target, x, y);
  touch.up(target, x, y);
  fireEvent.click(target, { clientX: x, clientY: y, detail: 1 });
}

/** Where the drawing's point under the screen point (`x`, `y`) is, under the canvas's camera now. */
function drawingPoint(svg: SVGSVGElement, x: number, y: number): { x: number; y: number } {
  const camera = cameraOf(svg);
  return { x: (x - camera.x) / camera.k, y: (y - camera.y) / camera.k };
}

/** Moves the faked clock on, inside React's `act` (a long press sets the canvas's state from its timer). */
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('one finger', () => {
  it('pans the drawing, what it touched staying under it, and never selects, even with a click after it', () => {
    const onSelect = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ onSelect })} />);
    const svg = canvasOf(container);
    const api = nodeOf(svg, 'run/api');
    const before = cameraOf(svg);
    const under = drawingPoint(svg, 300, 200);
    const touch = finger(1);
    touch.down(api, 300, 200);
    touch.move(api, 300, 206);
    // Within the slop: nothing moves yet.
    expect(cameraOf(svg)).toEqual(before);
    touch.move(api, 260, 260);
    touch.up(api, 260, 260);
    fireEvent.click(api, { clientX: 260, clientY: 260, detail: 1 });
    const after = cameraOf(svg);
    expect(after.k).toBe(before.k);
    expect(after.x).toBeCloseTo(before.x - 40);
    expect(after.y).toBeCloseTo(before.y + 60);
    expect(drawingPoint(svg, 260, 260).x).toBeCloseTo(under.x);
    expect(drawingPoint(svg, 260, 260).y).toBeCloseTo(under.y);
    expect(svg.querySelector('.dg-viewport')?.getAttribute('transform')).toBe(cameraAttribute(after));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('taps to select what it touched, and the click the browser makes of the tap changes nothing more', () => {
    const onSelect = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ onSelect })} />);
    const svg = canvasOf(container);
    const before = cameraOf(svg);
    tap(nodeOf(svg, 'run/api'), 300, 200);
    expect(onSelect.mock.calls).toEqual([['run/api']]);
    expect(cameraOf(svg)).toEqual(before);
  });

  it('taps the bare canvas to clear the selection, as a click there does', () => {
    const onSelect = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ selection: 'run/api', onSelect })} />);
    tap(canvasOf(container), 5, 5);
    expect(onSelect.mock.calls).toEqual([[null]]);
  });

  it('opens nothing on the console action with a tap: its link opens with the browser’s click', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramCanvas {...props({ model: withConsoleLinks(model), selection: 'run/api', onSelect })} />,
    );
    const action = canvasOf(container).querySelector('.dg-console-action');
    if (action === null) throw new Error('no console action');
    tap(action, 300, 200);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('a double tap', () => {
  it('zooms in about the point it tapped, after its first tap selected as a click does', () => {
    reduceMotion();
    const onSelect = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ onSelect })} />);
    const svg = canvasOf(container);
    const api = nodeOf(svg, 'run/api');
    const before = cameraOf(svg);
    const under = drawingPoint(svg, 320, 210);
    tap(api, 320, 210, 1);
    tap(api, 324, 212, 2);
    const after = cameraOf(svg);
    expect(after.k).toBeCloseTo(before.k * DOUBLE_TAP_ZOOM);
    // The second tap's point keeps what was drawn there (4 px from the first's).
    const kept = drawingPoint(svg, 324, 212);
    expect(kept.x).toBeCloseTo(under.x + 4 / before.k);
    expect(kept.y).toBeCloseTo(under.y + 2 / before.k);
    expect(onSelect.mock.calls).toEqual([['run/api']]);
  });

  it('is two taps when the second comes too late', () => {
    vi.useFakeTimers();
    reduceMotion();
    const onSelect = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ onSelect })} />);
    const svg = canvasOf(container);
    const before = cameraOf(svg);
    tap(nodeOf(svg, 'run/api'), 320, 210, 1);
    advance(400);
    tap(nodeOf(svg, 'run/web'), 320, 210, 2);
    expect(cameraOf(svg).k).toBe(before.k);
    expect(onSelect.mock.calls).toEqual([['run/api'], ['run/web']]);
  });

  it('on a chip leaves it opened by its first tap: no flip back, no drill-in and no zoom', () => {
    reduceMotion();
    const onFlip = vi.fn();
    const onDrillIn = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ onFlip, onDrillIn, onSelect })} />);
    const svg = canvasOf(container);
    const before = cameraOf(svg);
    const chip = chipOf(svg, 'projects/data');
    tap(chip, 600, 400, 1);
    expect(onFlip.mock.calls).toEqual([['projects/data']]);
    tap(chip, 602, 401, 2);
    // The browser's double-click after it is the finger's too.
    fireEvent.dblClick(chip, { detail: 2 });
    expect(onFlip.mock.calls).toEqual([['projects/data']]);
    expect(onDrillIn).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(cameraOf(svg)).toEqual(before);
  });

  it('zooms in on the bare canvas too, and never past the scale extent', () => {
    reduceMotion();
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvasOf(container);
    const before = cameraOf(svg);
    tap(svg, 5, 5, 1);
    tap(svg, 5, 5, 2);
    expect(cameraOf(svg).k).toBeCloseTo(before.k * DOUBLE_TAP_ZOOM);
    // A tap after a double tap starts over, the next one is a double tap again: twenty of them reach the extent.
    for (let id = 3; id < 43; id += 1) tap(svg, 5, 5, id);
    expect(cameraOf(svg).k).toBe(SCALE_EXTENT[1]);
  });
});

describe('a glide on its way', () => {
  it('goes on under a tap, and stops where it is when a finger pans', () => {
    const frames = manualFrames();
    const begin = performance.now();
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvasOf(container);
    rerender(<DiagramCanvas {...props({ jump: { id: 'run/web', seq: 1 } })} />);
    const rect = model.input.layout.rects['run/web'];
    if (rect === undefined) throw new Error('no rect');
    const target = focusTransform(rect, 1280, 800, cameraOf(svg));
    frames.step(begin + 50);
    // A tap on the bare canvas: the glide goes on to its end.
    tap(svg, 5, 5);
    frames.run(begin + 10_000);
    expect(cameraOf(svg).k).toBeCloseTo(target.k);
    expect(cameraOf(svg).x).toBeCloseTo(target.x);
    // Another glide, and a finger's pan on its way: the camera stays where the finger leaves it.
    rerender(<DiagramCanvas {...props({ jump: { id: 'run/api', seq: 2 } })} />);
    frames.step(begin + 10_050);
    const touch = finger(7);
    touch.down(svg, 100, 100);
    touch.move(svg, 140, 100);
    touch.up(svg, 140, 100);
    const panned = cameraOf(svg);
    expect(frames.pending()).toBe(0);
    frames.run(begin + 20_000);
    expect(cameraOf(svg)).toEqual(panned);
  });
});

describe('two fingers', () => {
  it('pinch about their midpoint, which stays put, and pan with it; neither finger selects', () => {
    const onSelect = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ onSelect })} />);
    const svg = canvasOf(container);
    const api = nodeOf(svg, 'run/api');
    const before = cameraOf(svg);
    const middle = drawingPoint(svg, 450, 300);
    const one = finger(1);
    const two = finger(2, false);
    one.down(api, 400, 300);
    two.down(svg, 500, 300);
    one.move(api, 350, 300);
    two.move(svg, 550, 300);
    expect(cameraOf(svg).k).toBeCloseTo(before.k * 2);
    expect(drawingPoint(svg, 450, 300).x).toBeCloseTo(middle.x);
    expect(drawingPoint(svg, 450, 300).y).toBeCloseTo(middle.y);
    // Both fingers move up together: the midpoint pans, the scale stays.
    one.move(api, 350, 250);
    two.move(svg, 550, 250);
    expect(cameraOf(svg).k).toBeCloseTo(before.k * 2);
    expect(drawingPoint(svg, 450, 250).y).toBeCloseTo(middle.y);
    one.up(api, 350, 250);
    two.up(svg, 550, 250);
    fireEvent.click(api);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('a long press', () => {
  it('shows what hover shows a mouse, and its name by the finger, until the next finger touches', () => {
    vi.useFakeTimers();
    const onHover = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ onHover, onSelect })} />);
    const svg = canvasOf(container);
    const api = nodeOf(svg, 'run/api');
    const touch = finger(1);
    touch.down(api, 300, 200);
    // A finger's own pointerover is no hover.
    fireEvent.pointerOver(api, { pointerType: 'touch', pointerId: 1 });
    advance(LONG_PRESS_MS - 1);
    expect(onHover).not.toHaveBeenCalled();
    advance(1);
    expect(onHover.mock.calls).toEqual([['run/api']]);
    // The hover's trace preview, as a mouse resting there paints it.
    expect(svg.querySelectorAll('.is-path')).toHaveLength(5);
    const hint = container.querySelector('p[aria-hidden="true"]');
    expect(hint?.textContent).toBe(api.getAttribute('aria-label'));
    // Lifting it selects nothing, and keeps what it showed.
    touch.up(api, 300, 200);
    fireEvent.pointerLeave(svg, { pointerType: 'touch', pointerId: 1 });
    fireEvent.click(api);
    expect(onSelect).not.toHaveBeenCalled();
    expect(svg.querySelectorAll('.is-path')).toHaveLength(5);
    // The next finger takes it away.
    advance(TOUCH_MOUSE_MS);
    finger(2).down(svg, 5, 5);
    expect(onHover.mock.calls).toEqual([['run/api'], [null]]);
    expect(svg.querySelectorAll('.is-path')).toHaveLength(0);
    expect(container.querySelector('p[aria-hidden="true"]')).toBeNull();
  });

  it('names what a resting mouse’s tooltip names, and shows the console action’s label; never the node’s menu', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramCanvas {...props({ model: withConsoleLinks(model), selection: 'run/api', onSelect })} />,
    );
    const svg = canvasOf(container);
    const action = svg.querySelector('.dg-console-action');
    const glyph = action?.querySelector('.dg-console-resource .dg-console-glyph');
    if (action === null || glyph === null || glyph === undefined) throw new Error('no console action');
    finger(1).down(glyph, 300, 200);
    // The browser's menu for the link stays (a long press's contextmenu is not taken).
    expect(fireEvent.contextMenu(glyph)).toBe(true);
    advance(LONG_PRESS_MS);
    expect(action.classList.contains('is-held')).toBe(true);
    expect(container.querySelector('p[aria-hidden="true"]')?.textContent).toBe(
      'Open in Cloud Console ↗ (opens a new tab)',
    );
    finger(1).up(glyph, 300, 200);
    // On a node, the browser's contextmenu of a long press is taken, and opens no menu.
    advance(TOUCH_MOUSE_MS);
    const web = nodeOf(svg, 'run/web');
    finger(2).down(web, 100, 100);
    expect(action.classList.contains('is-held')).toBe(false);
    expect(fireEvent.contextMenu(web)).toBe(false);
    advance(LONG_PRESS_MS);
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('a mouse', () => {
  it('keeps its hover, its click and its right-click after a finger was on the canvas', () => {
    vi.useFakeTimers();
    const onHover = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ onHover, onSelect })} />);
    const svg = canvasOf(container);
    tap(nodeOf(svg, 'run/web'), 100, 100);
    advance(TOUCH_MOUSE_MS);
    const api = nodeOf(svg, 'run/api');
    fireEvent.pointerOver(api, { pointerType: 'mouse' });
    expect(onHover).toHaveBeenLastCalledWith('run/api');
    fireEvent.pointerDown(api, { pointerType: 'mouse', clientX: 300, clientY: 200 });
    fireEvent.click(api, { clientX: 300, clientY: 200, detail: 1 });
    expect(onSelect.mock.calls).toEqual([['run/web'], ['run/api']]);
    fireEvent.pointerDown(api, { pointerType: 'mouse', button: 2 });
    expect(fireEvent.contextMenu(api)).toBe(false);
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('drills in with a double-click after a finger was on the canvas, and a pen’s pointer events are no finger’s', () => {
    vi.useFakeTimers();
    const onFlip = vi.fn();
    const onDrillIn = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ onFlip, onDrillIn, onSelect })} />);
    const svg = canvasOf(container);
    tap(svg, 5, 5);
    advance(TOUCH_MOUSE_MS);
    const before = cameraOf(svg);
    const chip = chipOf(svg, 'projects/data');
    fireEvent.pointerDown(chip, { pointerType: 'mouse', clientX: 600, clientY: 400 });
    fireEvent.click(chip, { clientX: 600, clientY: 400, detail: 1 });
    fireEvent.click(chip, { clientX: 600, clientY: 400, detail: 2 });
    fireEvent.dblClick(chip, { clientX: 600, clientY: 400, detail: 2 });
    expect(onFlip.mock.calls).toEqual([['projects/data'], ['projects/data', { history: 'replace' }]]);
    expect(onDrillIn.mock.calls).toEqual([['projects/data', { history: 'replace' }]]);
    expect(cameraOf(svg)).toEqual(before);
    // A pen is read as a mouse is, never as a finger: its press let go where it was pressed selects by its click, it
    // rests on the drawing as long as it likes without a long press, and its drag pans the drawing as far as it moved,
    // whose click selects nothing.
    const api = nodeOf(svg, 'run/api');
    mouseClick(api, 300, 200, 0, 0, { pointerType: 'pen', pointerId: 9 });
    const pen = { pointerType: 'pen', pointerId: 9, isPrimary: true, buttons: 1 };
    fireEvent.pointerDown(svg, { ...pen, clientX: 100, clientY: 100 });
    advance(LONG_PRESS_MS);
    expect(container.querySelector('p[aria-hidden="true"]')).toBeNull();
    fireEvent.pointerMove(svg, { ...pen, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(svg, { ...pen, buttons: 0, clientX: 300, clientY: 300 });
    fireEvent.click(svg, { clientX: 300, clientY: 300, detail: 1 });
    expect(onSelect.mock.calls).toEqual([[null], ['run/api']]);
    const dragged = cameraOf(svg);
    expect(dragged.k).toBe(before.k);
    expect(dragged.x).toBeCloseTo(before.x + 200);
    expect(dragged.y).toBeCloseTo(before.y + 200);
  });

  it('drags the camera, while the mouse events a browser makes of a finger’s tap do not', () => {
    vi.useFakeTimers();
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvasOf(container);
    const before = cameraOf(svg);
    // Right after a tap, the mouse events the browser makes of it move nothing, even as a drag: the canvas reads a
    // mouse from its pointer events.
    const touch = finger(1);
    touch.down(svg, 100, 100);
    touch.up(svg, 100, 100);
    svg.dispatchEvent(mouseEvent('mousedown', 100, 100));
    window.dispatchEvent(mouseEvent('mousemove', 160, 100, { buttons: 1 }));
    window.dispatchEvent(mouseEvent('mouseup', 160, 100));
    expect(cameraOf(svg)).toEqual(before);
    // A mouse's own drag pans the drawing as far as the mouse moved.
    advance(TOUCH_MOUSE_MS);
    mouseClick(svg, 100, 100, 60, 0, { steps: 3 });
    expect(cameraOf(svg).k).toBe(before.k);
    expect(cameraOf(svg).x).toBeCloseTo(before.x + 60);
    expect(cameraOf(svg).y).toBeCloseTo(before.y);
  });
});

describe('a drawing replaced mid-gesture', () => {
  it('keeps a pan going with the finger’s moves heard on the window', () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(<DiagramCanvas {...props({ onSelect })} />);
    const svg = canvasOf(container);
    const touched = drawingPoint(svg, 300, 200);
    const touch = finger(1);
    touch.down(nodeOf(svg, 'run/api'), 300, 200);
    touch.move(svg, 340, 200);
    // A new view: the node the finger touched is gone, and the camera fitted to the new drawing.
    const other = modelOf(
      scene([zone('projects/demo-app', 'project', 'demo-app', [card('run/new', 'new')])]),
    );
    rerender(<DiagramCanvas {...props({ model: other, onSelect })} />);
    const fitted = cameraOf(svg);
    fireEvent.pointerMove(window, { pointerType: 'touch', pointerId: 1, clientX: 360, clientY: 200 });
    fireEvent.pointerUp(window, { pointerType: 'touch', pointerId: 1, clientX: 360, clientY: 200 });
    // The pan goes on at the new camera's scale, the point it touched under the finger.
    expect(cameraOf(svg).k).toBe(fitted.k);
    expect(drawingPoint(svg, 360, 200).x).toBeCloseTo(touched.x);
    expect(drawingPoint(svg, 360, 200).y).toBeCloseTo(touched.y);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
