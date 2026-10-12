// SPDX-License-Identifier: MIT
/**
 * The second skip link (style skill §13): on the diagram page, "Skip to the diagram" moves focus straight to
 * the drawing's tab stop (its roving node), past the top bar's controls; while nothing is drawn, to the canvas
 * area itself, whose demo links follow. Like "Skip to content" it never touches the URL hash, which holds the
 * view.
 */
import type { MouseEvent, ReactElement } from 'react';
import { useLocation } from 'react-router';

import { DIAGRAM_PATH } from '../routes';

/** The id of the diagram page's canvas area (pages/DiagramPage.tsx): the skip link's target. */
export const DIAGRAM_CANVAS_ID = 'diagram-canvas';

/**
 * Focuses the diagram: the drawing's tab stop when one is drawn, else the canvas area. False when the page has no
 * canvas.
 */
export function focusDiagramCanvas(document: Document): boolean {
  const canvas = document.getElementById(DIAGRAM_CANVAS_ID);
  if (canvas === null) return false;
  const stop = canvas.querySelector('svg.dg-canvas [tabindex="0"]');
  const target = stop instanceof SVGElement || stop instanceof HTMLElement ? stop : canvas;
  target.focus({ preventScroll: true });
  return true;
}

export function SkipToCanvas({
  className,
}: {
  readonly className?: string | undefined;
}): ReactElement | null {
  const { pathname } = useLocation();
  if (pathname !== DIAGRAM_PATH) return null;
  const skip = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    focusDiagramCanvas(event.currentTarget.ownerDocument);
  };
  return (
    <a href={`#${DIAGRAM_CANVAS_ID}`} className={className} onClick={skip}>
      Skip to the diagram
    </a>
  );
}
