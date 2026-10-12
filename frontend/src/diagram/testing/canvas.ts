// SPDX-License-Identifier: MIT
/**
 * The interactive canvas (DiagramCanvas.tsx) in jsdom: its props with defaults, the elements the tests look up, and
 * the two things jsdom lacks that the camera reads: `prefers-reduced-motion` (glides land at once) and animation
 * frames the test runs by hand (a glide steps only when the test says so, at the time it gives).
 */
import { afterEach, vi } from 'vitest';

import type { DiagramCanvasProps } from '../DiagramCanvas';
import type { DiagramModel } from '../model';

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
