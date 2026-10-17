// SPDX-License-Identifier: MIT
/**
 * The interactive canvas (DiagramCanvas.tsx) in jsdom: its props with defaults, the elements the tests look up, its
 * camera (read, and moved as a person's pan or zoom does), a mouse's click and drag as a browser sends them, and the two
 * things jsdom lacks that the camera reads: `prefers-reduced-motion` (glides land at once) and animation frames the
 * test runs by hand (a glide steps only when the test says so, at the time it gives).
 */
import { fireEvent } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { canvasCamera } from '../canvasCamera';
import type { DiagramCanvasProps } from '../DiagramCanvas';
import type { DiagramModel } from '../model';
import type { CameraTransform } from '../viewport';

export { cameraOf } from '../canvasCamera';

/** The canvas's props on `model`: light theme, legend and title block, nothing selected; `overrides` win. */
export function canvasProps(
  model: DiagramModel,
  overrides: Partial<DiagramCanvasProps> = {},
): DiagramCanvasProps {
  return {
    model,
    theme: 'light',
    overlays: true,
    utcOffsetMinutes: 0,
    selection: null,
    onSelect: () => undefined,
    ...overrides,
  };
}

/** The canvas's `<svg>` in a rendered container. */
export function canvasOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector<SVGSVGElement>('svg.dg-canvas');
  if (svg === null) throw new Error('no canvas');
  return svg;
}

/** The one element `selector` finds in `root`, failing when there is none. */
export function element(root: Element, selector: string): SVGGElement {
  const found = root.querySelector<SVGGElement>(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
}

/** The solid node (card or chip) drawn for `id`; another element carrying the same `data-id` never matches. */
export const nodeOf = (svg: Element, id: string): SVGGElement => element(svg, `.dg-node[data-id="${id}"]`);
/** The chip drawn for the collapsed zone `id`. */
export const chipOf = (svg: Element, id: string): SVGGElement => element(svg, `.dg-chip[data-id="${id}"]`);
/** The collapse button of the open zone `id`. */
export const collapseOf = (svg: Element, id: string): SVGGElement =>
  element(svg, `.dg-collapse[data-collapse="${id}"]`);
/** The elements in the tab order (the drawing keeps one, plus the console action of a selection). */
export const tabStops = (svg: Element): Element[] => [...svg.querySelectorAll('[tabindex="0"]')];

/**
 * Moves the camera of the canvas `svg` to `to` (`k`, then the drawing's origin on the canvas, as the viewport group's
 * transform has them), as a person's pan or zoom does: at once, stopping a glide on its way.
 */
export function moveCamera(svg: SVGSVGElement, to: CameraTransform): void {
  const camera = canvasCamera(svg);
  if (camera === null) throw new Error('no canvas publishes a camera for this <svg>');
  camera.moveTo(to);
}

/**
 * A mouse event at the client point (`x`, `y`) with its window as `view`, as a browser makes it next to a pointer event
 * (the canvas reads the pointer events; the mouse events change nothing there). jsdom refuses vitest's window as a
 * `view` in the constructor, so it is set afterwards.
 */
export function mouseEvent(type: string, x: number, y: number, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...init });
  Object.defineProperty(event, 'view', { value: window });
  return event;
}

/**
 * A mouse's left button pressed on `target` at (`x`, `y`), moved by (`dx`, `dy`) in `steps` moves and let go there,
 * with every event a browser sends for it in its order: the pointer events and the mouse events of the press, the moves
 * and the release (the moves and the release on `target`, from where they bubble to the window, which hears them),
 * then the click it makes of them on `target`. `init` adds to every pointer event: another `pointerType` (a pen's), or
 * a modifier key. Answers whether the click went on as the browser sent it (nothing cancelled it: a link would open).
 */
export function mouseClick(
  target: Element,
  x: number,
  y: number,
  dx: number,
  dy: number,
  { steps = 1, ...init }: PointerEventInit & { readonly steps?: number } = {},
): boolean {
  const pointer = (at: number, by: number, buttons: number): PointerEventInit => ({
    pointerType: 'mouse',
    pointerId: 1,
    isPrimary: true,
    clientX: at,
    clientY: by,
    buttons,
    ...init,
  });
  const [toX, toY] = [x + dx, y + dy];
  // The left button, held from the press to the release.
  const held = 1;
  fireEvent.pointerDown(target, pointer(x, y, held));
  target.dispatchEvent(mouseEvent('mousedown', x, y, { detail: 1, ...init }));
  for (let step = 1; step <= steps; step += 1) {
    const [atX, atY] = [x + (dx * step) / steps, y + (dy * step) / steps];
    fireEvent.pointerMove(target, pointer(atX, atY, held));
    window.dispatchEvent(mouseEvent('mousemove', atX, atY, { buttons: held }));
  }
  fireEvent.pointerUp(target, pointer(toX, toY, 0));
  window.dispatchEvent(mouseEvent('mouseup', toX, toY, { detail: 1, ...init }));
  return target.dispatchEvent(mouseEvent('click', toX, toY, { detail: 1, ...init }));
}

/**
 * The wheel turned by `deltaY` (in pixels, or `init.deltaMode`'s units) with the pointer at the client point (`x`, `y`)
 * over `target`; answers whether the canvas took it (its default prevented: the page neither scrolls nor zooms).
 */
export function wheel(
  target: Element,
  x: number,
  y: number,
  deltaY: number,
  init: WheelEventInit = {},
): boolean {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    deltaY,
    ...init,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

/**
 * Answers `prefers-reduced-motion` with `reduce` for the rest of the test (jsdom has no matchMedia), so the camera
 * moves at once and a test reads where it ends. Registers its own clean-up.
 */
export function reduceMotion(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

/**
 * Animation frames run by the test: `requestAnimationFrame` queues, `cancelAnimationFrame` drops, and `run(at)` calls
 * what is queued with the time `at` until nothing is (a glide asks for its next frame from the one before).
 */
export function manualFrames(): {
  readonly pending: () => number;
  readonly step: (at: number) => void;
  readonly run: (at: number) => void;
} {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    next += 1;
    frames.set(next, callback);
    return next;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    frames.delete(handle);
  });
  const step = (at: number): void => {
    const due = [...frames.entries()];
    frames.clear();
    for (const [, callback] of due) callback(at);
  };
  return {
    pending: () => frames.size,
    step,
    run: (at) => {
      for (let guard = 0; frames.size > 0; guard += 1) {
        if (guard > 1000) throw new Error('animation frames never stop');
        step(at);
      }
    },
  };
}

// The stubs above are the test's only: every test starts with jsdom's own globals.
afterEach(() => {
  vi.unstubAllGlobals();
});
