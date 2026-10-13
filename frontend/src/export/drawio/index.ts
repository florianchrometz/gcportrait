// SPDX-License-Identifier: MIT
/**
 * The draw.io export (docs/api.md; agents.md, Exports and the render API): the diagram's SVG document turned into a
 * `.drawio` file that diagrams.net opens as an editable diagram that looks like the picture (translate.ts says how).
 * One function for every surface: the app's export flow (`exportDrawioFile`) loads this module on demand with the
 * drawing it renders for the export, and the render library (`pnpm render --drawio`, `POST /api/render` with
 * `"format": "drawio"`) imports it through the frontend's headless entry with the static render of the same
 * components. No DOM: it runs in the browser and in Node alike.
 */
import { modelXml, mxfileXml, readDrawio, type ReadDrawio } from './model';
import { translateSvg, type DrawioSummary, type TranslateOptions } from './translate';

export { DrawioError, DEFAULT_AREA_MARGIN, type DrawioSummary } from './translate';
export { FONT_STYLESHEET } from './label';
export { DRAWIO_VERSION, LAYERS, decompressDiagram } from './model';
export type { ReadDrawio } from './model';

/** The file's extension and media type (draw.io's own). */
export const DRAWIO_EXTENSION = 'drawio';
export const DRAWIO_MEDIA_TYPE = 'application/vnd.jgraph.mxfile';

export interface DrawioOptions extends TranslateOptions {
  /** When the drawing's data was read (ISO-8601): the file's `modified`, written at UTC. */
  readonly modified: string;
  /** What wrote the file and its version (`agent`), e.g. `gcportrait 1.1.0`. */
  readonly agent: string;
  /** The diagram's (page's) name; default the drawing's `<title>`. */
  readonly name?: string;
  /**
   * The view drawn, as the app's link names it (its hash without the selection and the highlight, which do not change
   * an export): with the drawing's theme and read time it makes the page's id, so files of different views, themes
   * and days of the same data keep different page ids. Default none.
   */
  readonly view?: string;
  /** Compress the diagram as draw.io saves it (default), or write its XML as it is. */
  readonly compressed?: boolean;
}

export interface DrawioFile {
  /** The `.drawio` file's text. */
  readonly text: string;
  readonly summary: DrawioSummary;
}

/** `modified` as draw.io writes it: an instant at UTC with milliseconds; a value that is no instant as it is. */
function utcInstant(value: string): string {
  const instant = Date.parse(value);
  return Number.isNaN(instant) ? value : new Date(instant).toISOString();
}

/** The `.drawio` file of a diagram's SVG document (`renderDiagramSvg`'s, or the export's drawing serialised). */
export function svgToDrawio(svg: string, options: DrawioOptions): DrawioFile {
  const translation = translateSvg(svg, options);
  const model = modelXml(translation.cells, translation.page, translation.background);
  const text = mxfileXml(model, {
    host: 'gcportrait',
    modified: utcInstant(options.modified),
    agent: options.agent,
    name: options.name ?? (translation.title === '' ? 'Diagram' : translation.title),
    theme: translation.theme,
    view: options.view ?? '',
    compressed: options.compressed ?? true,
  });
  return { text, summary: translation.summary };
}

/** Reads a `.drawio` file (its first diagram, plain or compressed) back to its model's XML, as draw.io opens it. */
export function readDrawioFile(text: string): ReadDrawio {
  return readDrawio(text);
}
