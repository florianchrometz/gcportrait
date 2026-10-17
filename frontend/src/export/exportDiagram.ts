// SPDX-License-Identifier: MIT
/**
 * The export (skill gcp-diagram-style §8, docs/export.md): the diagram on screen as an SVG, PNG or draw.io file, or a
 * PNG on the clipboard; the whole diagram or the part the canvas shows; in the light or the dark theme, whichever the
 * app shows. Each export draws the view again off-screen in the chosen theme (render.tsx), clones that `<svg>`
 * into a standalone file (serialize.ts), and for a PNG draws the file on a canvas (raster.ts). The draw.io file is
 * the same drawing translated into draw.io's cells (drawio/), a module loaded only when that export is asked for.
 */
import type { Rect } from '@gcportrait/layout';

import { WORDMARK } from '../branding';
import { documentText } from '../diagram/DiagramSvg';
import { planDrawing } from '../diagram/Drawing';
import { PALETTES, type DiagramTheme } from '../diagram/theme/tokens';
import { exportFileName, type ExportExtension, type FileNameParts } from './fileName';
import { addRasterFrame, pngGeometry, rasterizeSvg, PNG_MARGIN, type PngGeometry } from './raster';
import {
  embedFontFaces,
  prepareExportSvg,
  serializeSvg,
  type OverlayBoxes,
  type PreparedSvg,
} from './serialize';
import { intersectRects, type ExportSource } from './source';
import { withStandaloneSvg } from './render';

export type ExportArea = 'whole' | 'viewport';

export interface ExportSettings {
  readonly area: ExportArea;
  readonly theme: DiagramTheme;
}

/** Why an export could not be made, in words for the person who asked for it. */
export class ExportError extends Error {
  readonly code: 'nothing-in-view' | 'no-canvas';

  constructor(code: ExportError['code'], message: string) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
  }
}

/** Space between a "current viewport" crop and the title and legend bands (the drawing's own margin). */
export const CROP_MARGIN = PNG_MARGIN;

export function fileNameParts(source: ExportSource): FileNameParts {
  const { metadata } = source.model.input.scene;
  return { scope: metadata.rootLabel, lens: metadata.lens, readTime: metadata.readTime };
}

export function exportName(source: ExportSource, extension: ExportExtension): string {
  return exportFileName(fileNameParts(source), extension);
}

/** The part of the drawing a "current viewport" export keeps: what the canvas shows of the diagram. */
export function viewportCrop(source: ExportSource): Rect {
  const visible = source.visibleArea();
  if (visible === null) throw new ExportError('no-canvas', 'The diagram is not on screen.');
  const crop = intersectRects(visible, source.model.input.layout.bounds);
  if (crop === null) {
    throw new ExportError(
      'nothing-in-view',
      'No part of the diagram is in view. Pan back to it, or export the whole diagram.',
    );
  }
  return crop;
}

/** The export SVG as a DOM tree (not yet serialised), with its frame. */
export function prepareDiagramSvg(source: ExportSource, settings: ExportSettings): PreparedSvg {
  const { model, utcOffsetMinutes } = source;
  const plan = planDrawing(model, { overlays: true, utcOffsetMinutes });
  if (plan.title === null) throw new Error('The drawing plan has no title block.');
  const overlays: OverlayBoxes = {
    title: {
      x: plan.title.x,
      y: plan.title.y,
      width: plan.title.block.width,
      height: plan.title.block.height,
    },
    legend:
      plan.legend === null
        ? null
        : {
            x: plan.legend.x,
            y: plan.legend.y,
            width: plan.legend.layout.width,
            height: plan.legend.layout.height,
          },
  };
  const crop = settings.area === 'viewport' ? { area: viewportCrop(source), margin: CROP_MARGIN } : undefined;
  // `<title>` and `<desc>` are the diagram's own (`documentText`), the same the canvas and the baselines carry:
  // the description reads on its own, with the scope, the lens, the read time and what drew it.
  const { title, desc } = documentText(model, utcOffsetMinutes);
  return withStandaloneSvg(model, { theme: settings.theme, utcOffsetMinutes }, (svg) =>
    prepareExportSvg(svg, {
      theme: settings.theme,
      title,
      desc,
      frame: plan.frame,
      overlays,
      crop,
    }),
  );
}

export interface ExportFile {
  readonly blob: Blob;
  readonly fileName: string;
}

/** The SVG file; `fontFaces` (the embedded Roboto subset's CSS) only with the "embed fonts" option. */
export function exportSvgFile(
  source: ExportSource,
  settings: ExportSettings,
  fontFaces?: string,
): ExportFile & { readonly text: string } {
  const prepared = prepareDiagramSvg(source, settings);
  if (fontFaces !== undefined) embedFontFaces(prepared.svg, fontFaces);
  const text = serializeSvg(prepared.svg);
  return {
    text,
    blob: new Blob([text], { type: 'image/svg+xml;charset=utf-8' }),
    fileName: exportName(source, 'svg'),
  };
}

/**
 * The PNG's SVG source and pixel geometry: the export SVG with the fonts embedded, framed by the margin on the
 * theme's canvas colour and sized in pixels.
 */
export function pngSource(
  source: ExportSource,
  settings: ExportSettings & { readonly scale: number },
  fontFaces: string,
): { readonly text: string; readonly geometry: PngGeometry } {
  const prepared = prepareDiagramSvg(source, settings);
  embedFontFaces(prepared.svg, fontFaces);
  const geometry = pngGeometry(prepared.frame, settings.scale);
  addRasterFrame(prepared, geometry, PALETTES[settings.theme].canvas);
  return { text: serializeSvg(prepared.svg), geometry };
}

/** The PNG file. `rasterize` draws it (the browser's canvas by default; tests pass their own). */
export async function exportPngFile(
  source: ExportSource,
  settings: ExportSettings & { readonly scale: number },
  fontFaces: Promise<string>,
  rasterize: typeof rasterizeSvg = rasterizeSvg,
): Promise<ExportFile & { readonly geometry: PngGeometry }> {
  const { text, geometry } = pngSource(source, settings, await fontFaces);
  const blob = await rasterize(text, geometry, PALETTES[settings.theme].canvas);
  return { blob, geometry, fileName: exportName(source, 'png') };
}

/**
 * The draw.io file (frontend/AGENTS.md, Exports): the export's drawing, as the SVG export draws it,
 * translated into draw.io's cells (drawio/translate.ts) by a module this loads on demand, so it is no part of the
 * first paint. A "current viewport" export keeps the cells that meet the visible area, whole, and puts the title
 * block above and the legend below everything it keeps. `version` is the instance's (the file's `agent`).
 */
export async function exportDrawioFile(
  source: ExportSource,
  settings: ExportSettings,
  version?: string,
): Promise<ExportFile & { readonly text: string }> {
  const area = settings.area === 'viewport' ? viewportCrop(source) : undefined;
  const { svgToDrawio, DRAWIO_MEDIA_TYPE } = await import('./drawio');
  const { model, utcOffsetMinutes } = source;
  const markup = withStandaloneSvg(model, { theme: settings.theme, utcOffsetMinutes }, (svg) => {
    // React writes `xmlns` as a plain attribute; the serialiser declares the namespace itself.
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.removeAttribute('xmlns');
    return new XMLSerializer().serializeToString(copy);
  });
  const { text } = svgToDrawio(markup, {
    modified: model.input.scene.metadata.readTime,
    agent: version === undefined || version === '' ? WORDMARK : `${WORDMARK} ${version}`,
    ...(source.view === undefined ? {} : { view: source.view }),
    area,
    areaMargin: CROP_MARGIN,
  });
  return {
    text,
    blob: new Blob([text], { type: DRAWIO_MEDIA_TYPE }),
    fileName: exportName(source, 'drawio'),
  };
}
