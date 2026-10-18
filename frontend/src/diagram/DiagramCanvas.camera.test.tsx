// SPDX-License-Identifier: MIT
/**
 * What the app store asks of the canvas: a pending `jumpTo` becomes a camera glide to the node as soon as
 * it is drawn (at once with reduced motion), into the part of the canvas the panels lying over it leave in view (a
 * phone's or a tablet's View or More sheet, or details drawer with the disclosure bar's row in the part it leaves: the
 * largest part clear of both, whichever comes first; a panel out of sight counts for nothing), where a zoom key's step
 * keeps the focused item too and
 * which a fit shows the whole drawing in (a new view's, `0`'s); a panel opening or closing (`panels`) fits the drawing
 * again to the part the panels then leave while the camera still rests on the last fit, and leaves a camera the person
 * moved; and the node under the pointer is reported for the store's hover.
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { focusTransform, GLIDE_MS, REVEAL_MARGIN, REVEAL_MS, ZOOM_STEP } from './camera';
import { DiagramCanvas, type DiagramCanvasProps } from './DiagramCanvas';
import { keyboardMap, navigate } from './keyboard/navigation';
import {
  cameraOf,
  canvasOf as canvas,
  canvasProps,
  manualFrames,
  mouseClick,
  moveCamera,
  nodeOf,
  reduceMotion,
} from './testing/canvas';
import { card, modelOf, scene, smallScene, wideScene, zone } from './testing/scenes';
import { cameraAttribute, CLICK_DISTANCE, FIT_PADDING, fitTransform } from './viewport';

const model = modelOf(smallScene([['run/web', 'run/api', 'uses']]));

const props = (overrides: Partial<DiagramCanvasProps> = {}): DiagramCanvasProps =>
  canvasProps(model, overrides);

describe('the camera jump', () => {
  it('glides at once to the node with reduced motion, and reports the jump done', () => {
    reduceMotion();
    const done = vi.fn();
    const { container, rerender } = render(<DiagramCanvas {...props({ onJumpDone: done })} />);
    const svg = canvas(container);
    const fitted = cameraOf(svg);
    const rect = model.input.layout.rects['run/api'];
    if (rect === undefined) throw new Error('no rect');
    rerender(<DiagramCanvas {...props({ onJumpDone: done, jump: { id: 'run/api', seq: 1 } })} />);
    const expected = focusTransform(rect, 1280, 800, fitted);
    const now = cameraOf(svg);
    expect(now.k).toBeCloseTo(expected.k);
    expect(now.x).toBeCloseTo(expected.x);
    expect(now.y).toBeCloseTo(expected.y);
    expect(svg.querySelector('.dg-viewport')?.getAttribute('transform')).toBe(cameraAttribute(now));
    expect(done).toHaveBeenCalledWith(1);
  });

  it('glides frame by frame otherwise, ending on the node', () => {
    const frames = manualFrames();
    const begin = performance.now();
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const fitted = cameraOf(svg);
    rerender(<DiagramCanvas {...props({ jump: { id: 'run/web', seq: 4 } })} />);
    const rect = model.input.layout.rects['run/web'];
    if (rect === undefined) throw new Error('no rect');
    const target = focusTransform(rect, 1280, 800, fitted);
    frames.step(begin + GLIDE_MS / 2);
    const halfway = cameraOf(svg);
    expect(halfway.k).toBeGreaterThan(Math.min(fitted.k, target.k) - 1e-9);
    expect(halfway.k).toBeLessThan(Math.max(fitted.k, target.k) + 1e-9);
    frames.run(begin + 10_000);
    expect(cameraOf(svg).k).toBeCloseTo(target.k);
    expect(cameraOf(svg).x).toBeCloseTo(target.x);
  });

  it('keeps a jump to a node that is not drawn pending until a drawing has it', () => {
    reduceMotion();
    const done = vi.fn();
    const jump = { id: 'run/new', seq: 7 };
    const { rerender } = render(<DiagramCanvas {...props({ onJumpDone: done, jump })} />);
    expect(done).not.toHaveBeenCalled();
    const larger = modelOf(
      scene([
        zone('projects/demo-app', 'project', 'demo-app', [card('run/new', 'new'), card('run/old', 'old')]),
      ]),
    );
    rerender(<DiagramCanvas {...props({ model: larger, onJumpDone: done, jump })} />);
    expect(done).toHaveBeenCalledWith(7);
  });
});

/** A box on the page, in CSS px from the window's top-left corner. */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A stand-in for a sheet or the drawer at `box`, open or closed, for the rest of the test: what the canvas reads of
 * one is its marker, its box and `hidden`, which the test may toggle.
 */
const panel = (box: Box, closed: boolean): HTMLElement => {
  const element = document.createElement('div');
  element.setAttribute('data-canvas-overlay', '');
  element.hidden = closed;
  element.getBoundingClientRect = () => DOMRect.fromRect(box);
  document.body.append(element);
  onTestFinished(() => {
    element.remove();
  });
  return element;
};

/**
 * A stand-in for the disclosure bar at rest at `box`: it floats over the canvas and is marked for the directed moves
 * alone (`data-canvas-jump`), not as a panel a fit clears (`data-canvas-overlay`).
 */
const restingBar = (box: Box): HTMLElement => {
  const element = panel(box, false);
  element.removeAttribute('data-canvas-overlay');
  element.setAttribute('data-canvas-jump', '');
  return element;
};

/** The disclosure bar at rest at a desktop canvas's foot, right: 432 × 54 px in its corner. */
const REST_BAR: Box = { x: 836, y: 734, width: 432, height: 54 };

function panelResizes() {
  const observers: { readonly notify: () => void; readonly targets: Set<Element> }[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly entry: (typeof observers)[number];
      constructor(notify: () => void) {
        this.entry = { notify, targets: new Set() };
        observers.push(this.entry);
      }
      observe(target: Element): void {
        this.entry.targets.add(target);
      }
      disconnect(): void {
        this.entry.targets.clear();
      }
    },
  );
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  return {
    notify(target: Element): void {
      for (const observer of observers) {
        if (observer.targets.has(target)) observer.notify();
      }
    },
    watching: (target: Element): number =>
      observers.filter((observer) => observer.targets.has(target)).length,
  };
}

/** Puts the canvas at the window's top-left corner, 1280 × 800 (jsdom lays nothing out). */
const atTopLeft = (svg: SVGSVGElement): void => {
  svg.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 1280, height: 800 });
};

/** Puts the canvas at the window's top-left corner at another size: a tablet's, or a desktop's beside its drawer. */
const sized = (svg: SVGSVGElement, width: number, height: number): void => {
  Object.defineProperty(svg, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(svg, 'clientHeight', { configurable: true, value: height });
  svg.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width, height });
};

/** Where the node `id` is on screen under the canvas's camera: its box, and its centre. */
const onScreen = (svg: SVGSVGElement, id: string) => {
  const rect = model.input.layout.rects[id];
  if (rect === undefined) throw new Error('no rect');
  const { k, x, y } = cameraOf(svg);
  const top = rect.y * k + y;
  const bottom = (rect.y + rect.height) * k + y;
  return { top, bottom, x: (rect.x + rect.width / 2) * k + x, y: (top + bottom) / 2 };
};

/** The drawing's frame (its background, the box a fit shows whole), in drawing units. */
const frameOf = (svg: SVGSVGElement): Box => {
  const background = svg.querySelector('.dg-background');
  if (background === null) throw new Error('no background');
  const at = (name: string): number => Number(background.getAttribute(name));
  return { x: at('x'), y: at('y'), width: at('width'), height: at('height') };
};

/** Where the drawing's frame is on screen under the canvas's camera. */
const drawingOnScreen = (svg: SVGSVGElement): Box => {
  const frame = frameOf(svg);
  const { k, x, y } = cameraOf(svg);
  return { x: frame.x * k + x, y: frame.y * k + y, width: frame.width * k, height: frame.height * k };
};

/**
 * Expects the drawing fitted to `room` (a box on the canvas, CSS px) as a fit fills a canvas of that size: at the scale
 * that shows its frame whole there, centred in it, inside its margins (`FIT_PADDING`), none of it outside.
 */
const expectFittedTo = (svg: SVGSVGElement, room: Box): void => {
  const box = drawingOnScreen(svg);
  expect(cameraOf(svg).k).toBeCloseTo(fitTransform(frameOf(svg), room.width, room.height).k);
  expect(box.x + box.width / 2).toBeCloseTo(room.x + room.width / 2);
  expect(box.y + box.height / 2).toBeCloseTo(room.y + room.height / 2);
  expect(box.x).toBeGreaterThanOrEqual(room.x + FIT_PADDING - 1e-6);
  expect(box.y).toBeGreaterThanOrEqual(room.y + FIT_PADDING - 1e-6);
  expect(box.x + box.width).toBeLessThanOrEqual(room.x + room.width - FIT_PADDING + 1e-6);
  expect(box.y + box.height).toBeLessThanOrEqual(room.y + room.height - FIT_PADDING + 1e-6);
};

describe('the room a jump keeps the node in', () => {
  /**
   * The canvas at the window's top-left corner, 1280 × 800, under the open `panels` and the closed `hidden` ones,
   * after a jump to `id` (at once: reduced motion).
   */
  const jumpTo = (id: string, panels: readonly Box[], hidden: readonly Box[] = []): SVGSVGElement => {
    reduceMotion();
    for (const box of panels) panel(box, false);
    for (const box of hidden) panel(box, true);
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    atTopLeft(svg);
    rerender(<DiagramCanvas {...props({ jump: { id, seq: 1 } })} />);
    return svg;
  };

  it('centres the node in the canvas a sheet hanging from its top edge leaves below it (a phone’s)', () => {
    // A phone's View sheet: the canvas's width but the margins at its sides, 520 px of its 800 down.
    const svg = jumpTo('run/api', [{ x: 8, y: 0, width: 1264, height: 520 }]);
    const node = onScreen(svg, 'run/api');
    expect(node.x).toBeCloseTo(640);
    expect(node.y).toBeCloseTo(520 + 280 / 2);
    expect(node.top).toBeGreaterThan(520);
  });

  it('takes the larger part a narrower sheet leaves: on a tablet the canvas to its left, the whole height', () => {
    // 888 × 800 to its left against 1280 × 280 below it.
    const svg = jumpTo('run/web', [{ x: 888, y: 0, width: 384, height: 520 }]);
    const node = onScreen(svg, 'run/web');
    expect(node.x).toBeCloseTo(888 / 2);
    expect(node.y).toBeCloseTo(400);
  });

  it('keeps a jump above the disclosure bar beside a tablet’s open View or More sheet', () => {
    const svg = jumpTo('run/web', [
      { x: 888, y: 0, width: 384, height: 520 },
      { x: 12, y: 734, width: 400, height: 54 },
    ]);
    const node = onScreen(svg, 'run/web');
    expect(node.x).toBeCloseTo(888 / 2);
    expect(node.y).toBeCloseTo(734 / 2);
    expect(node.bottom).toBeLessThan(734);
  });

  it('keeps the node clear of a drawer along the canvas’s right edge (a tablet’s)', () => {
    const right = onScreen(jumpTo('run/api', [{ x: 640, y: 0, width: 640, height: 800 }]), 'run/api');
    expect(right.x).toBeCloseTo(320);
    expect(right.y).toBeCloseTo(400);
  });

  it('and of one over the canvas’s lower half (a phone’s)', () => {
    const lower = onScreen(jumpTo('run/api', [{ x: 0, y: 400, width: 1280, height: 400 }]), 'run/api');
    expect(lower.x).toBeCloseTo(640);
    expect(lower.y).toBeCloseTo(200);
  });

  /** A phone's drawer over the canvas's lower half, and the disclosure bar's row riding above it and its handle. */
  const sheet: Box = { x: 0, y: 400, width: 1280, height: 400 };
  const row: Box = { x: 8, y: 316, width: 1264, height: 54 };

  it.each([
    ['the drawer first', [sheet, row]],
    ['the row first', [row, sheet]],
  ] as const)(
    'keeps the node in the band above the disclosure bar’s row riding above a phone’s drawer (%s)',
    (_, panels) => {
      // The row leaves 316 px above it and 30 px between it and the drawer: the band above it, whatever the order.
      const node = onScreen(jumpTo('run/api', panels), 'run/api');
      expect(node.x).toBeCloseTo(640);
      expect(node.y).toBeCloseTo(316 / 2);
      expect(node.bottom).toBeLessThan(316);
    },
  );

  it('and above the row at the foot of the part a tablet’s drawer leaves, beside it', () => {
    // Left of the drawer, 640 × 800; the row in its bottom-left corner leaves 640 × 734 above it, the most.
    const svg = jumpTo('run/api', [
      { x: 640, y: 0, width: 640, height: 800 },
      { x: 12, y: 734, width: 400, height: 54 },
    ]);
    const node = onScreen(svg, 'run/api');
    expect(node.x).toBeCloseTo(320);
    expect(node.y).toBeCloseTo(734 / 2);
  });

  it('counts a panel out of sight (`visibility: hidden`) for nothing: the row on a canvas too short for it', () => {
    panel(row, false).style.visibility = 'hidden';
    const node = onScreen(jumpTo('run/api', [sheet]), 'run/api');
    expect(node.x).toBeCloseTo(640);
    expect(node.y).toBeCloseTo(200);
  });

  it('counts a closed sheet, and a drawer beside the canvas (a desktop’s), for nothing', () => {
    const svg = jumpTo(
      'run/api',
      [{ x: 1280, y: 0, width: 400, height: 800 }],
      [{ x: 8, y: 0, width: 1264, height: 520 }],
    );
    const node = onScreen(svg, 'run/api');
    expect(node.x).toBeCloseTo(640);
    expect(node.y).toBeCloseTo(400);
  });

  /**
   * The canvas at the window's top-left corner, 1280 × 800, the disclosure bar at rest at `bar`, fitted to the whole
   * canvas, after a jump to `id` (at once: reduced motion).
   */
  const jumpPastTheBar = (id: string, bar: Box): SVGSVGElement => {
    reduceMotion();
    restingBar(bar);
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    atTopLeft(svg);
    // The bar at rest is no fit obstacle: the fit is the whole canvas, as with no bar at all.
    expectFittedTo(svg, WHOLE);
    rerender(<DiagramCanvas {...props({ jump: { id, seq: 1 } })} />);
    return svg;
  };

  it('keeps a jump clear of the disclosure bar at rest, at a desktop’s foot right', () => {
    // The canvas above the bar, 1280 × 734, is the part it leaves: the most.
    const node = onScreen(jumpPastTheBar('run/api', REST_BAR), 'run/api');
    expect(node.x).toBeCloseTo(640);
    expect(node.y).toBeCloseTo(734 / 2);
    expect(node.bottom).toBeLessThan(734);
  });

  it('and above a phone’s row across the canvas’s foot at rest', () => {
    const node = onScreen(jumpPastTheBar('run/web', { x: 8, y: 734, width: 1264, height: 54 }), 'run/web');
    expect(node.x).toBeCloseTo(640);
    expect(node.y).toBeCloseTo(734 / 2);
    expect(node.bottom).toBeLessThan(734);
  });

  it('counts a bar at rest that is out of sight (`visibility: hidden`) for nothing', () => {
    reduceMotion();
    const bar = restingBar(REST_BAR);
    bar.style.visibility = 'hidden';
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    atTopLeft(svg);
    rerender(<DiagramCanvas {...props({ jump: { id: 'run/api', seq: 1 } })} />);
    expect(onScreen(svg, 'run/api').y).toBeCloseTo(400);
  });
});

describe('the room a zoom key keeps the focused item in', () => {
  /**
   * The canvas at the window's top-left corner, 1280 × 800, under a phone's drawer open over its lower half (from
   * y 400 down), its camera set so that `run/api` is 120 px tall with its centre at (640, 330): inside the room above
   * the drawer, 10 px above its edge. Reduced motion, so a step lands at once.
   */
  const aboveTheDrawer = (): SVGSVGElement => {
    reduceMotion();
    panel({ x: 0, y: 400, width: 1280, height: 400 }, false);
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    atTopLeft(svg);
    const rect = model.input.layout.rects['run/api'];
    if (rect === undefined) throw new Error('no rect');
    const k = 120 / rect.height;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    moveCamera(svg, { k, x: 640 - cx * k, y: 330 - cy * k });
    return svg;
  };

  it('keeps the focused item above a drawer over the canvas’s lower half (a phone’s) on a step in', () => {
    const svg = aboveTheDrawer();
    const before = cameraOf(svg).k;
    const api = nodeOf(svg, 'run/api');
    api.focus();
    fireEvent.keyDown(api, { key: '+' });
    expect(cameraOf(svg).k).toBeCloseTo(before * ZOOM_STEP);
    // 180 px tall now: about its centre it would reach 20 px under the drawer; it moves up, inside the room's margin.
    const node = onScreen(svg, 'run/api');
    expect(node.bottom).toBeCloseTo(400 - REVEAL_MARGIN);
    expect(node.top).toBeGreaterThan(REVEAL_MARGIN);
    expect(node.x).toBeCloseTo(640);
  });

  it('zooms about the centre of the room the drawer leaves when the canvas itself has focus', () => {
    const svg = aboveTheDrawer();
    const before = cameraOf(svg);
    // The drawing's point at the centre of the room above the drawer, (640, 200), stays there.
    const held = { x: (640 - before.x) / before.k, y: (200 - before.y) / before.k };
    svg.focus();
    fireEvent.keyDown(svg, { key: '+' });
    const after = cameraOf(svg);
    expect(after.k).toBeCloseTo(before.k * ZOOM_STEP);
    expect(held.x * after.k + after.x).toBeCloseTo(640);
    expect(held.y * after.k + after.y).toBeCloseTo(200);
  });

  it('fits the drawing with `0` to the room above a drawer over the canvas’s lower half (a phone’s)', () => {
    const svg = aboveTheDrawer();
    const api = nodeOf(svg, 'run/api');
    api.focus();
    fireEvent.keyDown(api, { key: '0' });
    expectFittedTo(svg, { x: 0, y: 0, width: 1280, height: 400 });
    expect(document.activeElement).toBe(api);
  });

  it('fits with `0` to the whole canvas where the panels leave no room: the phone’s drawer at full height', () => {
    // The sheet covers the canvas but for the 22 px strip its handle stands in, and hides the drawing. Reduced
    // motion, so `0` lands at once.
    reduceMotion();
    panel({ x: 0, y: 22, width: 1280, height: 778 }, false);
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    atTopLeft(svg);
    moveCamera(svg, { k: 2, x: -300, y: -200 });
    svg.focus();
    fireEvent.keyDown(svg, { key: '0' });
    expectFittedTo(svg, { x: 0, y: 0, width: 1280, height: 800 });
  });
});

describe('the room keyboard focus keeps the item in', () => {
  /**
   * The canvas at the window's top-left corner, 1280 × 800, the disclosure bar at rest across its foot, `run/api` 120
   * px tall with its centre at (640, 660): 14 px above the room's margin at 710, its bottom 720. Reduced motion, so a
   * step lands at once.
   */
  const aboveTheBar = (): SVGSVGElement => {
    reduceMotion();
    restingBar({ x: 8, y: 734, width: 1264, height: 54 });
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    atTopLeft(svg);
    const rect = model.input.layout.rects['run/api'];
    if (rect === undefined) throw new Error('no rect');
    const k = 120 / rect.height;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    moveCamera(svg, { k, x: 640 - cx * k, y: 660 - cy * k });
    return svg;
  };

  it('keeps the focused item above the bar at rest on a step in', () => {
    const svg = aboveTheBar();
    const before = cameraOf(svg).k;
    const api = nodeOf(svg, 'run/api');
    api.focus();
    fireEvent.keyDown(api, { key: '+' });
    expect(cameraOf(svg).k).toBeCloseTo(before * ZOOM_STEP);
    // 180 px tall now: about its centre it would reach 40 px under the bar; it moves up, inside the room's margin.
    const node = onScreen(svg, 'run/api');
    expect(node.bottom).toBeCloseTo(734 - REVEAL_MARGIN);
    expect(node.x).toBeCloseTo(640);
  });

  it('pans the item the arrow keys reach clear of the bar at rest', () => {
    reduceMotion();
    restingBar({ x: 836, y: 734, width: 432, height: 54 });
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    atTopLeft(svg);
    const map = keyboardMap(model.rects, false);
    const key = (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'] as const).find(
      (candidate) => navigate(map, 'run/web', candidate) !== null,
    );
    if (key === undefined) throw new Error('no key moves from run/web');
    const to = navigate(map, 'run/web', key);
    const rect = to === null ? undefined : model.input.layout.rects[to];
    if (to === null || rect === undefined) throw new Error('no item to move to');
    // Zoomed in with the item's centre at (640, 780), its box under the bar's row.
    const k = 2;
    moveCamera(svg, { k, x: 640 - (rect.x + rect.width / 2) * k, y: 780 - (rect.y + rect.height / 2) * k });
    expect(onScreen(svg, to).bottom).toBeGreaterThan(734);
    const web = nodeOf(svg, 'run/web');
    web.focus();
    fireEvent.keyDown(web, { key });
    expect(document.activeElement?.closest('[data-id]')?.getAttribute('data-id')).toBe(to);
    // The canvas above the bar, 1280 × 734, is the part it leaves: the item ends above it.
    expect(onScreen(svg, to).bottom).toBeCloseTo(734 - REVEAL_MARGIN);
  });
});

/** The whole canvas, 1280 × 800 at the window's top-left corner. */
const WHOLE: Box = { x: 0, y: 0, width: 1280, height: 800 };
/** A phone's View sheet over the canvas: its width but the margins at its sides, 520 px of its 800 down. */
const SHEET: Box = { x: 8, y: 0, width: 1264, height: 520 };
/** The part of the canvas below that sheet. */
const BELOW_THE_SHEET: Box = { x: 0, y: 520, width: 1280, height: 280 };
/** A phone's drawer over the canvas's lower half. */
const DRAWER: Box = { x: 0, y: 400, width: 1280, height: 400 };
/** The part of the canvas above that drawer. */
const ABOVE_THE_DRAWER: Box = { x: 0, y: 0, width: 1280, height: 400 };

describe('the fit a new view opens with', () => {
  /** Another view, a project with two cards: its frame is not the small scene's, so drawing it fits the camera anew. */
  const another = modelOf(
    scene([
      zone('projects/demo-app', 'project', 'demo-app', [card('run/new', 'new'), card('run/old', 'old')]),
    ]),
  );

  it('shows the whole drawing in the part of the canvas a drawer over its lower half (a phone’s) leaves', () => {
    panel(DRAWER, false);
    const { container, rerender } = render(<DiagramCanvas {...props({ panels: 'drawer' })} />);
    const svg = canvas(container);
    atTopLeft(svg);
    // A view drawn while the drawer is open (a day moved on the timeline): fitted anew, to the room above the drawer.
    rerender(<DiagramCanvas {...props({ model: another, panels: 'drawer' })} />);
    expectFittedTo(svg, ABOVE_THE_DRAWER);
  });

  it('and in the part below the View sheet (a lens picked in it), the whole canvas once the sheet closes', () => {
    reduceMotion();
    const sheet = panel(SHEET, false);
    const { container, rerender } = render(<DiagramCanvas {...props({ panels: 'view' })} />);
    const svg = canvas(container);
    atTopLeft(svg);
    rerender(<DiagramCanvas {...props({ model: another, panels: 'view' })} />);
    expectFittedTo(svg, BELOW_THE_SHEET);
    sheet.hidden = true;
    rerender(<DiagramCanvas {...props({ model: another, panels: '' })} />);
    expectFittedTo(svg, WHOLE);
  });
});

describe('the refit when a panel over the canvas opens or closes', () => {
  /**
   * The canvas at the window's top-left corner, 1280 × 800, fitted to the whole of it under the stand-in panel at
   * `box`, closed; `show` opens or closes the panel and draws the canvas again with `overrides` (its `panels` value
   * among them), as the diagram page does in the same commit.
   */
  const fittedUnder = (box: Box) => {
    const stand = panel(box, true);
    const { container, rerender } = render(<DiagramCanvas {...props({ panels: '' })} />);
    const svg = canvas(container);
    atTopLeft(svg);
    expectFittedTo(svg, WHOLE);
    const show = (open: boolean, overrides: Partial<DiagramCanvasProps>): void => {
      stand.hidden = !open;
      rerender(<DiagramCanvas {...props(overrides)} />);
    };
    return { svg, show };
  };

  /** Moves the camera as a person's pan does: `dx` px to the right, at its scale. */
  const pan = (svg: SVGSVGElement, dx: number): void => {
    const { k, x, y } = cameraOf(svg);
    moveCamera(svg, { k, x: x + dx, y });
  };

  /** The camera as plain numbers, to compare. */
  const camera = (svg: SVGSVGElement) => {
    const { k, x, y } = cameraOf(svg);
    return { k, x, y };
  };

  it('refits when the disclosure notice grows or is dismissed, without a new panels value or drawing', () => {
    reduceMotion();
    const resizes = panelResizes();
    const drawer = panel(DRAWER, true);
    let box = { x: 8, y: 316, width: 1264, height: 54 };
    const disclosure = panel(box, true);
    disclosure.getBoundingClientRect = () => DOMRect.fromRect(box);
    const { container, rerender, unmount } = render(<DiagramCanvas {...props({ panels: '' })} />);
    const svg = canvas(container);
    atTopLeft(svg);
    drawer.hidden = false;
    disclosure.hidden = false;
    rerender(<DiagramCanvas {...props({ panels: 'drawer' })} />);
    expectFittedTo(svg, { x: 0, y: 0, width: 1280, height: 316 });
    const drawing = svg.getAttribute('data-drawing');
    box = { ...box, y: 250, height: 120 };
    resizes.notify(disclosure);
    expectFittedTo(svg, { x: 0, y: 0, width: 1280, height: 250 });
    box = { ...box, y: 316, height: 54 };
    resizes.notify(disclosure);
    expectFittedTo(svg, { x: 0, y: 0, width: 1280, height: 316 });
    expect(svg.getAttribute('data-drawing')).toBe(drawing);
    expect(resizes.watching(disclosure)).toBe(1);
    unmount();
    expect(resizes.watching(disclosure)).toBe(0);
    expect(resizes.watching(drawer)).toBe(0);
  });

  it('leaves a manually moved camera alone when an overlay resizes', () => {
    reduceMotion();
    const resizes = panelResizes();
    const sheet = panel(SHEET, false);
    const { container } = render(<DiagramCanvas {...props({ panels: 'view' })} />);
    const svg = canvas(container);
    atTopLeft(svg);
    svg.focus();
    fireEvent.keyDown(svg, { key: '0' });
    pan(svg, 40);
    const moved = camera(svg);
    sheet.getBoundingClientRect = () => DOMRect.fromRect({ ...SHEET, height: 600 });
    resizes.notify(sheet);
    expect(camera(svg)).toEqual(moved);
  });

  it('observes disclosure notices after a desktop drawer becomes a tablet overlay without changing panels', () => {
    reduceMotion();
    const resizes = panelResizes();
    const drawer = panel({ x: 1280, y: 0, width: 400, height: 800 }, false);
    let box = { x: 8, y: 734, width: 1264, height: 54 };
    const disclosure = panel(box, false);
    disclosure.removeAttribute('data-canvas-overlay');
    disclosure.setAttribute('data-canvas-resize', '');
    disclosure.getBoundingClientRect = () => DOMRect.fromRect(box);
    const { container } = render(<DiagramCanvas {...props({ panels: 'drawer' })} />);
    const svg = canvas(container);
    atTopLeft(svg);
    sized(svg, 820, 800);
    drawer.getBoundingClientRect = () => DOMRect.fromRect({ x: 410, y: 0, width: 410, height: 800 });
    box = { x: 12, y: 734, width: 386, height: 54 };
    disclosure.setAttribute('data-canvas-overlay', '');
    resizes.notify(drawer);
    expectFittedTo(svg, { x: 0, y: 0, width: 410, height: 734 });
    box = { ...box, y: 650, height: 138 };
    resizes.notify(disclosure);
    expectFittedTo(svg, { x: 0, y: 0, width: 410, height: 650 });
  });

  it('does not refit for a resized disclosure bar at rest, where it is not a marked overlay', () => {
    reduceMotion();
    const resizes = panelResizes();
    const disclosure = panel({ x: 8, y: 734, width: 1264, height: 54 }, false);
    disclosure.removeAttribute('data-canvas-overlay');
    disclosure.setAttribute('data-canvas-resize', '');
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    atTopLeft(svg);
    const fitted = camera(svg);
    disclosure.getBoundingClientRect = () => DOMRect.fromRect({ x: 8, y: 600, width: 1264, height: 188 });
    resizes.notify(disclosure);
    expect(camera(svg)).toEqual(fitted);
    expect(resizes.watching(disclosure)).toBe(1);
  });

  it('fits a drawing resting on its fit to the part a sheet that opens leaves, and to the canvas once it closes', () => {
    reduceMotion();
    const { svg, show } = fittedUnder(SHEET);
    show(true, { panels: 'view' });
    expectFittedTo(svg, BELOW_THE_SHEET);
    show(false, { panels: '' });
    expectFittedTo(svg, WHOLE);
  });

  it('glides there otherwise; a panel that closes while the glide is on its way fits the drawing back to the canvas', () => {
    const frames = manualFrames();
    const { svg, show } = fittedUnder(SHEET);
    const middle = (): number => {
      const box = drawingOnScreen(svg);
      return box.y + box.height / 2;
    };
    show(true, { panels: 'view' });
    frames.step(performance.now() + REVEAL_MS / 2);
    // On its way from the canvas's middle (400) to the middle of the part below the sheet (660).
    expect(middle()).toBeGreaterThan(400 + 1);
    expect(middle()).toBeLessThan(660 - 1);
    // Closed again before the glide ends: the camera rests on where it was going, the fit, and is fitted anew.
    show(false, { panels: '' });
    frames.run(performance.now() + 10_000);
    expectFittedTo(svg, WHOLE);
    show(true, { panels: 'view' });
    frames.run(performance.now() + 10_000);
    expectFittedTo(svg, BELOW_THE_SHEET);
  });

  it('leaves a camera the person panned where they put it, as a sheet opens and closes', () => {
    reduceMotion();
    const { svg, show } = fittedUnder(SHEET);
    pan(svg, 40);
    const panned = camera(svg);
    show(true, { panels: 'view' });
    expect(camera(svg)).toEqual(panned);
    show(false, { panels: '' });
    expect(camera(svg)).toEqual(panned);
  });

  it('rests on its fit after a mouse’s click that wobbled, which moves nothing: a sheet that opens refits', () => {
    reduceMotion();
    const { svg, show } = fittedUnder(SHEET);
    const fit = camera(svg);
    // A click on the bare canvas whose hand moved as far as the click distance between the press and the release.
    mouseClick(svg, 5, 5, CLICK_DISTANCE, 0);
    expect(camera(svg)).toEqual(fit);
    show(true, { panels: 'view' });
    expectFittedTo(svg, BELOW_THE_SHEET);
  });

  it('leaves one a mouse dragged, and the click the browser makes of the drag selects nothing', () => {
    reduceMotion();
    const onSelect = vi.fn();
    const { svg, show } = fittedUnder(SHEET);
    const fit = camera(svg);
    mouseClick(nodeOf(svg, 'run/api'), 300, 200, 12, -5, { steps: 3 });
    const dragged = camera(svg);
    expect(dragged).toEqual({ k: fit.k, x: fit.x + 12, y: fit.y - 5 });
    show(true, { panels: 'view', onSelect });
    expect(camera(svg)).toEqual(dragged);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('and one a zoom key stepped', () => {
    reduceMotion();
    const { svg, show } = fittedUnder(SHEET);
    svg.focus();
    fireEvent.keyDown(svg, { key: '+' });
    const zoomed = camera(svg);
    show(true, { panels: 'view' });
    expect(camera(svg)).toEqual(zoomed);
  });

  it('rests on the fit `0` made: the drawer that closes after it fits the drawing to the canvas', () => {
    reduceMotion();
    const { svg, show } = fittedUnder(DRAWER);
    pan(svg, 40);
    show(true, { panels: 'drawer' });
    // Moved, so the drawer's opening left it; `0` fits the drawing above the drawer.
    svg.focus();
    fireEvent.keyDown(svg, { key: '0' });
    expectFittedTo(svg, ABOVE_THE_DRAWER);
    show(false, { panels: '' });
    expectFittedTo(svg, WHOLE);
  });

  it('fits the drawing above a drawer a selection opens, which its reveal then leaves, and fills the canvas once it closes', () => {
    reduceMotion();
    const done = vi.fn();
    const { svg, show } = fittedUnder(DRAWER);
    // A tap on a node: the drawer opens, and asks for its reveal of the node.
    show(true, {
      panels: 'drawer',
      selection: 'run/api',
      onJumpDone: done,
      jump: { id: 'run/api', seq: 3, mode: 'reveal' },
    });
    expectFittedTo(svg, ABOVE_THE_DRAWER);
    expect(done).toHaveBeenCalledWith(3);
    show(false, { panels: '', selection: null, onJumpDone: done, jump: null });
    expectFittedTo(svg, WHOLE);
  });

  it('keeps the fit beside a tablet’s drawer that a reveal of a node by the drawing’s edge would pan off', () => {
    // A tablet's canvas, 820 × 1000, and its drawer over the right half. Thirty projects in a grid wider than the part
    // left of it are fitted there below a third of their size, which brings the leftmost project's edge 22.75 px from
    // the canvas's, inside a reveal's 24 px margin: the reveal would pan it 1.25 px, off the fit, and the drawing would
    // stay that small once the drawer closes.
    reduceMotion();
    const wide = modelOf(wideScene(30));
    const drawer = panel({ x: 410, y: 0, width: 410, height: 1000 }, true);
    const { container, rerender } = render(<DiagramCanvas {...props({ model: wide, panels: '' })} />);
    const svg = canvas(container);
    sized(svg, 820, 1000);
    drawer.hidden = false;
    const jump = { id: 'projects/p0', seq: 1, mode: 'reveal' } as const;
    rerender(<DiagramCanvas {...props({ model: wide, panels: 'drawer', selection: 'projects/p0', jump })} />);
    expectFittedTo(svg, { x: 0, y: 0, width: 410, height: 1000 });
    drawer.hidden = true;
    rerender(<DiagramCanvas {...props({ model: wide, panels: '', selection: null, jump: null })} />);
    expectFittedTo(svg, { x: 0, y: 0, width: 820, height: 1000 });
  });

  it('pans a node a drawer opens over into view when the person moved the camera, and leaves it there as it closes', () => {
    reduceMotion();
    const { svg, show } = fittedUnder(DRAWER);
    const rect = model.input.layout.rects['run/api'];
    if (rect === undefined) throw new Error('no rect');
    // Zoomed to 100 % and panned until the node's top lies 600 px down, where the drawer will be.
    moveCamera(svg, { k: 1, x: 640 - rect.x - rect.width / 2, y: 600 - rect.y });
    show(true, { panels: 'drawer', selection: 'run/api', jump: { id: 'run/api', seq: 1, mode: 'reveal' } });
    const node = onScreen(svg, 'run/api');
    expect(cameraOf(svg).k).toBe(1);
    expect(node.top).toBeGreaterThanOrEqual(REVEAL_MARGIN - 1e-6);
    expect(node.bottom).toBeLessThanOrEqual(400 - REVEAL_MARGIN + 1e-6);
    const revealed = camera(svg);
    show(false, { panels: '', selection: null, jump: null });
    expect(camera(svg)).toEqual(revealed);
  });

  it('changes nothing for a drawer beside the canvas, which narrows the canvas as it opens (a desktop’s)', () => {
    reduceMotion();
    const { svg, show } = fittedUnder({ x: 880, y: 0, width: 400, height: 800 });
    const fit = camera(svg);
    sized(svg, 880, 800);
    show(true, { panels: 'drawer' });
    expect(camera(svg)).toEqual(fit);
    sized(svg, 1280, 800);
    show(false, { panels: '' });
    expect(camera(svg)).toEqual(fit);
  });
});

describe('hover reporting', () => {
  it('reports the node under the pointer once per change, and null when it leaves', () => {
    const onHover = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ onHover })} />);
    const svg = canvas(container);
    const api = nodeOf(svg, 'run/api');
    fireEvent.pointerOver(api);
    fireEvent.pointerOver(api);
    fireEvent.pointerLeave(svg);
    expect(onHover.mock.calls).toEqual([['run/api'], [null]]);
  });
});
