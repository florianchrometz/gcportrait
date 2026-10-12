// SPDX-License-Identifier: MIT
/**
 * What the app store asks of the canvas: a pending `jumpTo` becomes a camera glide to the node as soon as
 * it is drawn (at once with reduced motion), and the node under the pointer is reported for the store's hover.
 */
import { fireEvent, render } from '@testing-library/react';
import { zoomTransform } from 'd3-zoom';
import { describe, expect, it, vi } from 'vitest';

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
