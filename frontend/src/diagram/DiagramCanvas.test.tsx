// SPDX-License-Identifier: MIT
/**
 * The interactive canvas on its own: it says it is ready (`data-diagram-ready`) only once it can be used, numbers
 * each drawing (`data-drawing`) so that the next one can be told from the last, a theme change, which re-renders
 * the same elements, leaves no stale highlight behind but keeps the selection and the keyboard focus painted, and it
 * publishes its camera while it is mounted. A mouse and a pen: a click selects though the hand wobbled a few pixels and
 * moves nothing, a drag pans the drawing pixel for pixel from the press (only with the primary button, without Ctrl),
 * takes the pointer, keeps the browser from dragging or selecting what it pressed and swallows its click, and a press
 * stops a glide on its way. The wheel zooms about the pointer, 2^0.2 a notch, ten times as far with Ctrl, and leaves a
 * turn on its own at the scale extent to the page.
 */
import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { canvasCamera } from './canvasCamera';
import { DiagramCanvas, type DiagramCanvasProps } from './DiagramCanvas';
import {
  cameraOf,
  canvasOf as canvas,
  canvasProps,
  manualFrames,
  mouseClick,
  mouseEvent,
  moveCamera,
  nodeOf as node,
  wheel,
} from './testing/canvas';
import { modelOf, smallScene, withConsoleLinks } from './testing/scenes';
import { CLICK_DISTANCE, IDENTITY_CAMERA, SCALE_EXTENT } from './viewport';

const model = modelOf(
  smallScene([
    ['run/web', 'run/api', 'uses'],
    ['run/jobs', 'pools/default', 'routes'],
  ]),
);

const props = (overrides: Partial<DiagramCanvasProps> = {}): DiagramCanvasProps =>
  canvasProps(model, overrides);

const shownRings = (svg: Element, selector: string): number =>
  [...svg.querySelectorAll(selector)].filter((ring) => ring.getAttribute('display') === null).length;

describe('DiagramCanvas', () => {
  it('sets data-diagram-ready and data-drawing only once the painter and its listeners are attached', () => {
    // What a test (or the e2e suite) can do the moment it sees either: find the tab stop, hover a node.
    const seen: Array<{ name: string; stops: number; hoverPaints: boolean }> = [];
    // The real method, read off its descriptor: it runs with whatever element the spy is called on.
    const original: unknown = Object.getOwnPropertyDescriptor(Element.prototype, 'setAttribute')?.value;
    if (typeof original !== 'function') throw new Error('no Element.prototype.setAttribute');
    const spy = vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (
      this: Element,
      name: string,
      value: string,
    ) {
      if (name === 'data-diagram-ready' || name === 'data-drawing') {
        const card = this.querySelector('[data-id="run/api"]');
        card?.dispatchEvent(new Event('pointerover', { bubbles: true }));
        seen.push({
          name,
          stops: this.querySelectorAll('.dg-node[tabindex="0"]').length,
          hoverPaints: card?.classList.contains('is-path') === true,
        });
        this.dispatchEvent(new Event('pointerleave'));
      }
      Reflect.apply(original, this, [name, value]);
    });
    try {
      const { container } = render(<DiagramCanvas {...props()} />);
      expect(canvas(container).getAttribute('data-diagram-ready')).toBe('true');
    } finally {
      spy.mockRestore();
    }
    // Each mount writes the pair once (under StrictMode the first mount's pair comes first), and at every write
    // the tab stop is there and hover paints.
    expect(seen.length % 2).toBe(0);
    expect(seen.length).toBeGreaterThan(0);
    for (let i = 0; i < seen.length; i += 2) {
      expect(seen.slice(i, i + 2)).toEqual([
        { name: 'data-drawing', stops: 1, hoverPaints: true },
        { name: 'data-diagram-ready', stops: 1, hoverPaints: true },
      ]);
    }
  });

  it('gives every drawing the next number: a new view and a theme change draw again, a selection does not', () => {
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const drawing = (): number => Number(svg.getAttribute('data-drawing'));
    const first = drawing();
    expect(first).toBeGreaterThan(0);
    // A selection only paints the drawing on the canvas.
    rerender(<DiagramCanvas {...props({ selection: 'run/web' })} />);
    expect(drawing()).toBe(first);
    // Another view (a lens, a drill-in, a day): a drawing of its own, and the canvas is ready again at once.
    const other = modelOf(smallScene([['run/web', 'run/api', 'uses']]));
    rerender(<DiagramCanvas {...props({ model: other, selection: 'run/web' })} />);
    const second = drawing();
    expect(second).toBeGreaterThan(first);
    expect(svg.getAttribute('data-diagram-ready')).toBe('true');
    // The same view in the other theme is drawn again too.
    rerender(<DiagramCanvas {...props({ model: other, selection: 'run/web', theme: 'dark' })} />);
    expect(drawing()).toBeGreaterThan(second);
  });

  it('numbers the drawings for the page: a canvas mounted again repeats no number', () => {
    const before = render(<DiagramCanvas {...props()} />);
    const first = Number(canvas(before.container).getAttribute('data-drawing'));
    before.unmount();
    const after = render(<DiagramCanvas {...props()} />);
    expect(Number(canvas(after.container).getAttribute('data-drawing'))).toBeGreaterThan(first);
  });

  it('leaves no hover highlight behind when the theme changes under the pointer', () => {
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const api = node(svg, 'run/api');
    fireEvent.pointerOver(api);
    expect(svg.querySelectorAll('.is-path')).toHaveLength(5);
    expect(shownRings(svg, '.dg-path-ring')).toBe(5);
    expect(svg.querySelectorAll('.dg-edge-top.is-focus')).toHaveLength(1);

    rerender(<DiagramCanvas {...props({ theme: 'dark' })} />);
    // React kept the elements (it re-renders the same drawing in the other theme) ...
    expect(node(svg, 'run/api')).toBe(api);
    expect(svg.getAttribute('data-theme')).toBe('dark');
    // ... and the old painter took its marks off them.
    expect(svg.querySelectorAll('.is-path, .dg-edge-top.is-focus')).toHaveLength(0);
    expect(shownRings(svg, '.dg-path-ring')).toBe(0);

    // The new painter paints and clears as usual.
    fireEvent.pointerOver(node(svg, 'run/jobs'));
    expect(svg.querySelectorAll('.is-path')).toHaveLength(3);
    fireEvent.pointerLeave(svg);
    expect(svg.querySelectorAll('.is-path')).toHaveLength(0);
    expect(shownRings(svg, '.dg-path-ring')).toBe(0);
  });

  it('keeps the selection and the keyboard focus painted across a theme change, with one tab stop', () => {
    const { container, rerender } = render(<DiagramCanvas {...props({ selection: 'run/web' })} />);
    const svg = canvas(container);
    const web = node(svg, 'run/web');
    const api = node(svg, 'run/api');
    expect(web.getAttribute('aria-pressed')).toBe('true');
    api.focus();
    expect(document.activeElement).toBe(api);
    expect(shownRings(svg, '.dg-focus-ring')).toBe(1);
    const stops = (): Array<string | null> =>
      [...svg.querySelectorAll('[tabindex="0"]')].map((element) => element.getAttribute('data-id'));
    expect(stops()).toEqual(['run/api']);

    rerender(<DiagramCanvas {...props({ selection: 'run/web', theme: 'dark' })} />);
    expect(document.activeElement).toBe(api);
    expect(web.classList.contains('is-selected')).toBe(true);
    expect(web.getAttribute('aria-pressed')).toBe('true');
    expect(shownRings(svg, '.dg-select-ring')).toBe(1);
    expect(shownRings(svg, '.dg-focus-ring')).toBe(1);
    expect(stops()).toEqual(['run/api']);
  });

  it('publishes its camera while it is mounted, and no longer once it is gone', () => {
    const { container, unmount } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const fitted = cameraOf(svg);
    expect(fitted).not.toEqual(IDENTITY_CAMERA);
    expect(svg.querySelector('.dg-viewport')?.getAttribute('transform')).toBe(
      `translate(${String(fitted.x)},${String(fitted.y)}) scale(${String(fitted.k)})`,
    );
    moveCamera(svg, { k: 2, x: -40, y: 10 });
    expect(cameraOf(svg)).toEqual({ k: 2, x: -40, y: 10 });
    expect(svg.querySelector('.dg-viewport')?.getAttribute('transform')).toBe('translate(-40,10) scale(2)');
    expect(svg.getAttribute('data-scale')).toBe('2');
    unmount();
    expect(canvasCamera(svg)).toBeNull();
    expect(cameraOf(svg)).toEqual(IDENTITY_CAMERA);
  });

  it('selects on a mouse click that wobbled a few pixels; a drag further pans and selects nothing', () => {
    const onSelect = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ selection: 'run/web', onSelect })} />);
    const svg = canvas(container);
    const api = node(svg, 'run/api');
    const fitted = cameraOf(svg);
    // A 3 px wobble between the press and the release is still a click: on a node it selects ...
    mouseClick(api, 300, 200, 3, 0);
    // ... and on the bare canvas it clears the selection.
    mouseClick(svg, 5, 5, 0, 3);
    // As far as the click distance, still a click.
    mouseClick(api, 300, 200, 0, -CLICK_DISTANCE);
    expect(onSelect.mock.calls).toEqual([['run/api'], [null], ['run/api']]);
    // None of them moved the drawing: the camera still rests on its fit.
    expect(cameraOf(svg)).toEqual(fitted);
    // A drag of 10 px pans the drawing by as much, and the click the browser makes of it selects nothing.
    onSelect.mockClear();
    const before = cameraOf(svg);
    mouseClick(node(svg, 'run/web'), 300, 200, 10, 0);
    expect(cameraOf(svg).x).toBeCloseTo(before.x + 10);
    expect(cameraOf(svg).y).toBeCloseTo(before.y);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('makes the selected card’s console action the tab stop after it; Escape there goes back to the card', () => {
    const linked = withConsoleLinks(model);
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramCanvas {...props({ model: linked, selection: 'run/api', onSelect })} />,
    );
    const svg = canvas(container);
    const api = node(svg, 'run/api');
    const action = svg.querySelector<SVGAElement>('.dg-console-action');
    if (action === null) throw new Error('no console action');
    // DOM order is tab order: the roving node, then the action (drawn after every node).
    const stops = [...svg.querySelectorAll('[tabindex="0"]')];
    expect(stops).toEqual([api, action]);
    action.focus();
    expect(document.activeElement).toBe(action);
    fireEvent.keyDown(action, { key: 'Escape' });
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(document.activeElement).toBe(api);
    // A click on the action opens its link (a new tab) and changes nothing in the app.
    onSelect.mockClear();
    fireEvent.click(action);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('a mouse and a pen', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drag the drawing pixel for pixel from the press, wherever the moves come from, as long as the button is held', () => {
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const before = cameraOf(svg);
    mouseClick(node(svg, 'run/api'), 300, 200, 37, 23, { steps: 6 });
    const dragged = cameraOf(svg);
    expect(dragged.k).toBe(before.k);
    expect(dragged.x).toBeCloseTo(before.x + 37, 9);
    expect(dragged.y).toBeCloseTo(before.y + 23, 9);
    // Moves heard on the window (the pointer off the canvas) drag as well; a move after the button was let go where the
    // canvas did not hear it ends the press, and the next move pans nothing.
    const mouse = { pointerType: 'mouse', pointerId: 1, isPrimary: true };
    fireEvent.pointerDown(svg, { ...mouse, buttons: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { ...mouse, buttons: 1, clientX: 40, clientY: 90 });
    expect(cameraOf(svg).x).toBeCloseTo(dragged.x - 60, 9);
    expect(cameraOf(svg).y).toBeCloseTo(dragged.y - 10, 9);
    const away = cameraOf(svg);
    fireEvent.pointerMove(window, { ...mouse, buttons: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(window, { ...mouse, buttons: 1, clientX: 400, clientY: 300 });
    expect(cameraOf(svg)).toEqual(away);
  });

  it('pan nothing with Ctrl (a Mac’s right-click), with another button, or with the mouse events alone', () => {
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const before = cameraOf(svg);
    mouseClick(svg, 100, 100, 40, 0, { ctrlKey: true, steps: 4 });
    const right = { pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 2, buttons: 2 };
    fireEvent.pointerDown(svg, { ...right, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { ...right, button: -1, clientX: 160, clientY: 100 });
    fireEvent.pointerUp(svg, { ...right, buttons: 0, clientX: 160, clientY: 100 });
    svg.dispatchEvent(mouseEvent('mousedown', 100, 100));
    window.dispatchEvent(mouseEvent('mousemove', 160, 100, { buttons: 1 }));
    window.dispatchEvent(mouseEvent('mouseup', 160, 100));
    expect(cameraOf(svg)).toEqual(before);
  });

  it('take the pointer once they drag, never for a click, whose target stays what was pressed', () => {
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const capture = vi.fn();
    svg.setPointerCapture = capture;
    mouseClick(svg, 100, 100, 3, 0);
    expect(capture).not.toHaveBeenCalled();
    mouseClick(svg, 100, 100, 30, 0, { pointerId: 7, steps: 3 });
    expect(capture.mock.calls).toEqual([[7]]);
  });

  it('keep the browser from dragging or selecting what they press, and swallow a drag’s click, not a click’s', () => {
    const linked = withConsoleLinks(model);
    const { container } = render(<DiagramCanvas {...props({ model: linked, selection: 'run/api' })} />);
    const svg = canvas(container);
    const action = svg.querySelector('.dg-console-action');
    if (action === null) throw new Error('no console action');
    const heard = vi.fn();
    document.addEventListener('click', heard);
    const native = (type: string): boolean =>
      action.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    // Held: the link is not dragged off and no text is selected.
    fireEvent.pointerDown(action, {
      pointerType: 'mouse',
      pointerId: 1,
      buttons: 1,
      clientX: 300,
      clientY: 200,
    });
    expect(native('dragstart')).toBe(false);
    expect(native('selectstart')).toBe(false);
    fireEvent.pointerUp(action, {
      pointerType: 'mouse',
      pointerId: 1,
      buttons: 0,
      clientX: 300,
      clientY: 200,
    });
    expect(native('dragstart')).toBe(true);
    // A drag from the console action: its click opens no link, and nothing on the page hears it.
    expect(mouseClick(action, 300, 200, 12, 0)).toBe(false);
    expect(heard).not.toHaveBeenCalled();
    // A click on it that wobbled opens the link, as a click does.
    expect(mouseClick(action, 300, 200, 2, 0)).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    document.removeEventListener('click', heard);
  });

  it('stop a glide on its way with a press, which moves nothing by itself', () => {
    const frames = manualFrames();
    const begin = performance.now();
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const fitted = cameraOf(svg);
    rerender(<DiagramCanvas {...props({ jump: { id: 'run/api', seq: 1 } })} />);
    frames.step(begin + 50);
    const halfway = cameraOf(svg);
    expect(halfway).not.toEqual(fitted);
    fireEvent.pointerDown(svg, { pointerType: 'mouse', pointerId: 1, buttons: 1, clientX: 5, clientY: 5 });
    expect(frames.pending()).toBe(0);
    frames.run(begin + 10_000);
    expect(cameraOf(svg)).toEqual(halfway);
  });
});

describe('the wheel', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('zooms by 2^0.2 a notch of 100 px about the pointer, which keeps what was drawn under it', () => {
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const before = cameraOf(svg);
    const under = { x: (300 - before.x) / before.k, y: (200 - before.y) / before.k };
    expect(wheel(svg, 300, 200, -100)).toBe(true);
    const after = cameraOf(svg);
    expect(after.k / before.k).toBeCloseTo(2 ** 0.2, 12);
    expect(under.x * after.k + after.x).toBeCloseTo(300, 9);
    expect(under.y * after.k + after.y).toBeCloseTo(200, 9);
    expect(svg.getAttribute('data-scale')).toBe(String(Math.round(after.k * 1000) / 1000));
    expect(wheel(svg, 300, 200, 100)).toBe(true);
    expect(cameraOf(svg).k).toBeCloseTo(before.k, 12);
  });

  it('zooms ten times as far with Ctrl (a touchpad’s pinch), by lines and by pages as their units say', () => {
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const start = cameraOf(svg).k;
    wheel(svg, 300, 200, -10, { ctrlKey: true });
    expect(cameraOf(svg).k / start).toBeCloseTo(2 ** 0.2, 12);
    wheel(svg, 300, 200, -3, { deltaMode: 1 });
    expect(cameraOf(svg).k / start).toBeCloseTo(2 ** 0.35, 12);
    wheel(svg, 300, 200, 1, { deltaMode: 2 });
    expect(cameraOf(svg).k / start).toBeCloseTo(2 ** -0.65, 12);
  });

  it('stops at the scale extent: a turn on its own there is the page’s, one within a gesture the canvas’s', () => {
    vi.useFakeTimers();
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    moveCamera(svg, { k: 190, x: 0, y: 0 });
    expect(wheel(svg, 300, 200, -100)).toBe(true);
    expect(cameraOf(svg).k).toBe(SCALE_EXTENT[1]);
    // The next turn of the same gesture has nothing to do, and still neither scrolls nor zooms the page.
    vi.advanceTimersByTime(100);
    expect(wheel(svg, 300, 200, -100)).toBe(true);
    vi.advanceTimersByTime(149);
    expect(wheel(svg, 300, 200, -100, { ctrlKey: true })).toBe(true);
    // A turn after the gesture is over, with nothing to do, is the page's: with Ctrl the browser zooms it.
    vi.advanceTimersByTime(150);
    expect(wheel(svg, 300, 200, -100, { ctrlKey: true })).toBe(false);
    expect(cameraOf(svg).k).toBe(SCALE_EXTENT[1]);
    // So is a turn sideways, which zooms nothing.
    expect(wheel(svg, 300, 200, 0, { deltaX: 100 })).toBe(false);
  });

  it('stops a glide on its way, and zooms from where it stopped', () => {
    const frames = manualFrames();
    const begin = performance.now();
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    rerender(<DiagramCanvas {...props({ jump: { id: 'run/web', seq: 1 } })} />);
    frames.step(begin + 50);
    const halfway = cameraOf(svg);
    wheel(svg, 300, 200, -100);
    expect(frames.pending()).toBe(0);
    const zoomed = cameraOf(svg);
    expect(zoomed.k / halfway.k).toBeCloseTo(2 ** 0.2, 12);
    frames.run(begin + 10_000);
    expect(cameraOf(svg)).toEqual(zoomed);
  });
});
