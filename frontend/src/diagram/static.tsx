// SPDX-License-Identifier: MIT
/**
 * The diagram as an SVG string, without a browser: the snapshot baselines (`baselines.test.tsx`) and the
 * headless renderer use it. Not imported by the app, so `react-dom/server` stays out of the bundle.
 */
import { renderToStaticMarkup } from 'react-dom/server';

import { DiagramSvg, type StaticOptions } from './DiagramSvg';
import { buildDiagramModel, type DiagramInput } from './model';

/** A standalone SVG document of a laid-out Scene, with its XML declaration and a trailing newline. */
export function renderDiagramSvg(input: DiagramInput, options: StaticOptions): string {
  const markup = renderToStaticMarkup(<DiagramSvg model={buildDiagramModel(input)} options={options} />);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}\n`;
}
