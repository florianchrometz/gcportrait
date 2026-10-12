// SPDX-License-Identifier: MIT
/**
 * Keyboard focus across a new view. "Drill in" (a node's menu, the details drawer) replaces the
 * drawing, and the element that had focus goes with it; focus would fall to the page's body. Instead it is parked
 * on the canvas's `<svg>` and marked so; when the new view's drawing arrives, the canvas (DiagramCanvas.tsx) moves
 * it on to the new drawing's tab stop. The mark goes when focus leaves the `<svg>` or the pointer presses on it,
 * so a drill-in that draws nothing new never pulls focus later.
 */

/** The attribute that marks focus as parked on the canvas for the next view's drawing. */
export const FOCUS_PARKED_ATTRIBUTE = 'data-focus-parked';

/** The canvas's `<svg>` in a document, if one is drawn. */
export function canvasOf(document: Document): SVGSVGElement | null {
  return document.querySelector<SVGSVGElement>('svg.dg-canvas');
}

/** Parks keyboard focus on the canvas until the next view is drawn, when it moves to that drawing's tab stop. */
export function parkCanvasFocus(svg: SVGSVGElement): void {
  svg.setAttribute(FOCUS_PARKED_ATTRIBUTE, 'true');
  svg.focus({ preventScroll: true });
}

/** Whether focus waits on the canvas for the next view (it has focus and is marked). */
export function isCanvasFocusParked(svg: SVGSVGElement): boolean {
  return svg.ownerDocument.activeElement === svg && svg.hasAttribute(FOCUS_PARKED_ATTRIBUTE);
}

/** Takes the mark off: focus left the canvas, the pointer pressed on it, or the next view took focus. */
export function unparkCanvasFocus(svg: SVGSVGElement): void {
  svg.removeAttribute(FOCUS_PARKED_ATTRIBUTE);
}
