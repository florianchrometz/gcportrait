// SPDX-License-Identifier: Apache-2.0
/**
 * A diagram drawn as static markup and parsed back into an XML document, for the tests that read the SVG the
 * drawing writes (attributes, order, text) without a canvas around it.
 */
import { renderToStaticMarkup } from 'react-dom/server';

import { DiagramDrawing, planDrawing, type DrawingOptions } from '../Drawing';
import type { DiagramModel } from '../model';

/** `model` drawn with `options` (default: light, legend and title block, not interactive, UTC) as a document. */
export function renderDrawing(model: DiagramModel, options: Partial<DrawingOptions> = {}): Document {
  const full: DrawingOptions = {
    theme: 'light',
    overlays: true,
    interactive: false,
    utcOffsetMinutes: 0,
    ...options,
  };
  const markup = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg">
      <DiagramDrawing model={model} options={full} plan={planDrawing(model, full)} />
    </svg>,
  );
  return parseSvg(markup);
}

/** SVG markup parsed as an XML document. */
export function parseSvg(markup: string): Document {
  return new DOMParser().parseFromString(markup, 'image/svg+xml');
}

/** The one element `selector` finds in `doc`, failing when there is none. */
export function one(doc: Document | Element, selector: string): Element {
  const found = doc.querySelector(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
}
