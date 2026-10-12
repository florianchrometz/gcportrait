// SPDX-License-Identifier: MIT
/**
 * One prepared view drawn as the app's standalone SVG document (the frontend's `renderDiagramSvg`: the same React
 * components as the canvas, rendered with `react-dom/server`, colours as attributes of the theme, icons inline,
 * legend and title block included) and, optionally, rasterised, or translated into a draw.io file (the frontend's
 * `svgToDrawio`, the translator the app's export uses: the same drawing as editable cells). The read time in the
 * title block is written in UTC (`+00:00`), so the output does not depend on the machine's time zone.
 */
import {
  drawnViewKey,
  PALETTES,
  renderDiagramSvg,
  svgToDrawio,
  WORDMARK,
  type DiagramTheme,
  type DrawioFile,
} from '@gcportrait/frontend';

import { rasterise, type Raster, type RasterOptions } from './raster.js';
import type { PreparedView } from './view.js';

export const THEMES: readonly DiagramTheme[] = ['light', 'dark'];

export function isTheme(value: string): value is DiagramTheme {
  return (THEMES as readonly string[]).includes(value);
}

/** The view as a standalone SVG document (XML declaration, trailing newline). */
export function drawSvg(view: PreparedView, theme: DiagramTheme): string {
  return renderDiagramSvg(view.input, { theme, utcOffsetMinutes: 0 });
}

/** The SVG as a PNG on the theme's canvas colour. */
export function drawPng(
  svg: string,
  theme: DiagramTheme,
  options: Omit<RasterOptions, 'background'> = {},
): Raster {
  return rasterise(svg, { ...options, background: PALETTES[theme].canvas });
}

export interface DrawioDrawOptions {
  /** The diagram compressed as draw.io saves it (default), or its XML as it is. */
  readonly compressed?: boolean;
  /** Every label names Google Fonts' stylesheet of Roboto and Roboto Mono, which diagrams.net loads (default). */
  readonly fontSource?: boolean;
  /** The version written after the wordmark in the file's `agent` (`gcportrait 1.1.0`); none by default. */
  readonly version?: string;
}

/**
 * The view as a `.drawio` file: the SVG of {@link drawSvg} translated into draw.io's cells, with the data's read time
 * as the file's `modified` and a page id of the view, the theme and the read time (as the app's export names it).
 * Byte-stable: the same view and options give the same bytes, on every platform (the compressor is plain JavaScript).
 */
export function drawDrawio(
  view: PreparedView,
  theme: DiagramTheme,
  options: DrawioDrawOptions = {},
): DrawioFile {
  return svgToDrawio(drawSvg(view, theme), {
    modified: view.input.scene.metadata.readTime,
    agent:
      options.version === undefined || options.version === '' ? WORDMARK : `${WORDMARK} ${options.version}`,
    view: drawnViewKey(view.spec),
    compressed: options.compressed ?? true,
    fontSource: options.fontSource ?? true,
  });
}
