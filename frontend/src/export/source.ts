// SPDX-License-Identifier: MIT
/**
 * What the export menu exports (docs/export.md): the diagram on screen, published by the diagram page through the
 * diagram session, and the part of it the canvas shows (for "current viewport"). The menu lives in the top bar
 * and never reaches into the page; the page never knows about the menu.
 */
import type { Rect } from '@gcportrait/layout';

import { cameraOf } from '../diagram/canvasCamera';
import type { DiagramModel } from '../diagram/model';

export interface ExportSource {
  readonly model: DiagramModel;
  /** The viewer's UTC offset in minutes, for the read time in the title block and `<desc>`. */
  readonly utcOffsetMinutes: number;
  /** The part of the drawing the canvas shows now, in drawing coordinates; null when no canvas is on screen. */
  readonly visibleArea: () => Rect | null;
  /**
   * The view drawn, as its app link names it without the selection and the highlight (the pipeline's scene key): a
   * draw.io file's page id is made from it. Default none.
   */
  readonly view?: string;
}

/**
 * The part of the drawing a canvas `<svg>` shows: its size in CSS px through the inverse of its camera (the one
 * DiagramCanvas keeps and publishes, diagram/canvasCamera.ts). Null for a canvas with no size (not laid out, hidden).
 */
export function canvasVisibleArea(svg: SVGSVGElement): Rect | null {
  const width = svg.clientWidth;
  const height = svg.clientHeight;
  if (width <= 0 || height <= 0) return null;
  const { k, x, y } = cameraOf(svg);
  return { x: -x / k, y: -y / k, width: width / k, height: height / k };
}

/** The diagram canvas inside a page element (the canvas section of the diagram page), if one is drawn. */
export function visibleAreaIn(container: Element | null): Rect | null {
  const svg = container?.querySelector('svg.dg-canvas');
  return svg instanceof SVGSVGElement ? canvasVisibleArea(svg) : null;
}

/** The overlap of two rects, or null when they do not overlap (touching edges do not count). */
export function intersectRects(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
