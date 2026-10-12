// SPDX-License-Identifier: MIT
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import { describe, expect, it } from 'vitest';

import { canvasVisibleArea, intersectRects, visibleAreaIn } from './source';

function canvas(width: number, height: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'dg-canvas');
  Object.defineProperty(svg, 'clientWidth', { value: width });
  Object.defineProperty(svg, 'clientHeight', { value: height });
  return svg;
}

describe('the visible area of the canvas', () => {
  it('is the canvas size through the inverse of the d3-zoom camera, in drawing coordinates', () => {
    const svg = canvas(1200, 800);
    zoom<SVGSVGElement, unknown>()
      .extent([
        [0, 0],
        [1200, 800],
      ])
      .transform(select(svg), zoomIdentity.translate(-300, 40).scale(2));
    expect(canvasVisibleArea(svg)).toEqual({ x: 150, y: -20, width: 600, height: 400 });
    const page = document.createElement('section');
    page.append(svg);
    expect(visibleAreaIn(page)).toEqual({ x: 150, y: -20, width: 600, height: 400 });
  });

  it('is unknown without a laid-out canvas', () => {
    expect(canvasVisibleArea(canvas(0, 0))).toBeNull();
    expect(visibleAreaIn(document.createElement('section'))).toBeNull();
    expect(visibleAreaIn(null)).toBeNull();
  });
});

describe('intersectRects', () => {
  it('is the overlap, or null when the rects only touch or are apart', () => {
    const a = { x: 0, y: 0, width: 100, height: 50 };
    expect(intersectRects(a, { x: 60, y: -10, width: 100, height: 30 })).toEqual({
      x: 60,
      y: 0,
      width: 40,
      height: 20,
    });
    expect(intersectRects(a, { x: 100, y: 0, width: 10, height: 10 })).toBeNull();
    expect(intersectRects(a, { x: 500, y: 500, width: 10, height: 10 })).toBeNull();
  });
});
