// SPDX-License-Identifier: MIT
/**
 * What the app store asks of the canvas: a pending `jumpTo` becomes a camera glide to the node as soon as
 * it is drawn (at once with reduced motion), into the part of the canvas a panel lying over it leaves in view (a
 * phone's or a tablet's View or More sheet, or details drawer), and the node under the pointer is reported for the
 * store's hover.
 */
import { fireEvent, render } from '@testing-library/react';
import { zoomTransform } from 'd3-zoom';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { focusTransform } from './camera';
import { DiagramCanvas, type DiagramCanvasProps } from './DiagramCanvas';
import { canvasOf as canvas, canvasProps, manualFrames, nodeOf, reduceMotion } from './testing/canvas';
import { card, modelOf, scene, smallScene, zone } from './testing/scenes';

const model = modelOf(smallScene([['run/web', 'run/api', 'uses']]));

const props = (overrides: Partial<DiagramCanvasProps> = {}): DiagramCanvasProps =>
  canvasProps(model, overrides);

describe('the camera jump', () => {
  it('glides at once to the node with reduced motion, and reports the jump done', () => {
    reduceMotion();
    const done = vi.fn();
    const { container, rerender } = render(<DiagramCanvas {...props({ onJumpDone: done })} />);
    const svg = canvas(container);
    const fitted = zoomTransform(svg);
    const rect = model.input.layout.rects['run/api'];
    if (rect === undefined) throw new Error('no rect');
    rerender(<DiagramCanvas {...props({ onJumpDone: done, jump: { id: 'run/api', seq: 1 } })} />);
    const expected = focusTransform(rect, 1280, 800, fitted);
    const now = zoomTransform(svg);
    expect(now.k).toBeCloseTo(expected.k);
    expect(now.x).toBeCloseTo(expected.x);
    expect(now.y).toBeCloseTo(expected.y);
    expect(svg.querySelector('.dg-viewport')?.getAttribute('transform')).toBe(now.toString());
    expect(done).toHaveBeenCalledWith(1);
  });

  it('glides frame by frame otherwise, ending on the node', () => {
    const frames = manualFrames();
    const begin = performance.now();
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const fitted = zoomTransform(svg);
    rerender(<DiagramCanvas {...props({ jump: { id: 'run/web', seq: 4 } })} />);
    const rect = model.input.layout.rects['run/web'];
    if (rect === undefined) throw new Error('no rect');
    const target = focusTransform(rect, 1280, 800, fitted);
    frames.step(begin + 225);
    const halfway = zoomTransform(svg);
    expect(halfway.k).toBeGreaterThan(Math.min(fitted.k, target.k) - 1e-9);
    expect(halfway.k).toBeLessThan(Math.max(fitted.k, target.k) + 1e-9);
    frames.run(begin + 10_000);
    expect(zoomTransform(svg).k).toBeCloseTo(target.k);
    expect(zoomTransform(svg).x).toBeCloseTo(target.x);
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

describe('the room a jump keeps the node in', () => {
  /** A box on the page, in CSS px from the window's top-left corner. */
  interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }

  /**
   * A stand-in for a sheet or the drawer at `box`, open or closed, for the rest of the test: what the canvas reads of
   * one is its marker, its box and `hidden`.
   */
  const panel = (box: Box, closed: boolean): void => {
    const element = document.createElement('div');
    element.setAttribute('data-canvas-overlay', '');
    element.hidden = closed;
    element.getBoundingClientRect = () => DOMRect.fromRect(box);
    document.body.append(element);
    onTestFinished(() => {
      element.remove();
    });
  };

  /**
   * The canvas at the window's top-left corner, 1280 × 800 (jsdom lays nothing out), under the open `panels` and the
   * closed `hidden` ones, after a jump to `id` (at once: reduced motion).
   */
  const jumpTo = (id: string, panels: readonly Box[], hidden: readonly Box[] = []): SVGSVGElement => {
    reduceMotion();
    for (const box of panels) panel(box, false);
    for (const box of hidden) panel(box, true);
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    svg.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 1280, height: 800 });
    rerender(<DiagramCanvas {...props({ jump: { id, seq: 1 } })} />);
    return svg;
  };

  /** Where the node `id` is on screen under the canvas's camera: its box, and its centre. */
  const onScreen = (svg: SVGSVGElement, id: string) => {
    const rect = model.input.layout.rects[id];
    if (rect === undefined) throw new Error('no rect');
    const { k, x, y } = zoomTransform(svg);
    const top = rect.y * k + y;
    const bottom = (rect.y + rect.height) * k + y;
    return { top, bottom, x: (rect.x + rect.width / 2) * k + x, y: (top + bottom) / 2 };
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
