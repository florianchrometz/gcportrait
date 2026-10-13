// SPDX-License-Identifier: MIT
/**
 * One render (agents.md, Exports and the render API): a snapshot and the render options
 * (`RenderOptionsSchema` of `@gcportrait/model`) to the bytes of an SVG, a PNG or a draw.io file, with the
 * app's export file name and what was drawn. The same functions as `pnpm render` (view.ts, draw.ts,
 * raster.ts), so a demo view comes out byte for byte as the command line writes it.
 *
 * The view is resolved as the command line resolves it: a hash is decoded leniently by `decodeViewSpec`, as the app
 * decodes its URL (its `snapshot`, `selection` and `highlight` do not change the drawing); explicit fields are
 * normalised with the flips' zone ids turned into flip tokens, as `--flip` does. Unlike the command line, which
 * reports them, a refused drill-in root or a focus that does not apply is an error ({@link ViewRefusedError}).
 */
import { DRAWIO_MEDIA_TYPE, exportFileName } from '@gcportrait/frontend';
import { flipIdOf } from '@gcportrait/graph';
import {
  RENDER_DEFAULT_SCALE,
  decodeViewSpec,
  encodeViewSpec,
  normalizeViewSpec,
  type DetailLevel,
  type Graph,
  type RenderOptions,
  type RenderView,
  type Snapshot,
  type SnapshotRef,
  type ViewSpec,
} from '@gcportrait/model';

import { drawDrawio, drawPng, drawSvg } from './draw.js';
import { prepareView, type PreparedView } from './view.js';

/** The drill-in root was refused, or the focus does not apply to the snapshot; the message is for the person. */
export class ViewRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewRefusedError';
  }
}

/** The ViewSpec of the render options' view, for `snapshot` (the hash's own `snapshot` is replaced). */
export function viewSpecOf(view: RenderView, snapshot: SnapshotRef): ViewSpec {
  if (view.hash !== undefined) {
    const decoded = decodeViewSpec(view.hash.startsWith('#') ? view.hash : `#${view.hash}`);
    return { ...decoded, snapshot };
  }
  return normalizeViewSpec({
    snapshot,
    lens: view.lens ?? 'overview',
    detail: view.detail ?? 'auto',
    filters: view.filters ?? {},
    flips: (view.flips ?? []).map(flipIdOf),
    ...(view.focus === undefined ? {} : { focus: view.focus }),
    ...(view.root === undefined ? {} : { root: view.root }),
  });
}

export interface RenderContext {
  /** The snapshot's reference in the view hash: `demo:SIZE` for a demo organisation; default none. */
  readonly snapshotRef?: SnapshotRef;
  /** The PNG's pixel limit (RENDER_MAX_PIXELS); default the export's 2^27. */
  readonly maxPixels?: number;
  /** The snapshot's Graph, when it was built already. */
  readonly graph?: Graph;
  /** A draw.io file's `agent` version (the instance's or the command's); none by default. */
  readonly version?: string;
}

export interface RenderResult {
  readonly bytes: Uint8Array;
  readonly contentType: 'image/png' | 'image/svg+xml; charset=utf-8' | typeof DRAWIO_MEDIA_TYPE;
  /** The app's export file name: `gcportrait_<scope>_<lens>_<readTime>.<ext>`. */
  readonly fileName: string;
  /** The view drawn, as the app's URL hash (`encodeViewSpec`). */
  readonly viewHash: string;
  /** The detail level the view was drawn at (what `auto` chose). */
  readonly detailUsed: DetailLevel;
  /** PNG only: the pixels per drawing unit used (lower than asked when the pixel limit applied). */
  readonly scale?: number;
  readonly capped?: boolean;
  readonly width?: number;
  readonly height?: number;
  /** The snapshot's asset count. */
  readonly assets: number;
}

/** Throws {@link ViewRefusedError} for a refused root or a focus that does not apply. */
export function checkView(view: PreparedView): void {
  const { metadata } = view.input.scene;
  if (metadata.rootError !== undefined) throw new ViewRefusedError(`root: ${metadata.rootError.message}`);
  if (metadata.focusError !== undefined) throw new ViewRefusedError(`focus: ${metadata.focusError.message}`);
}

/**
 * Draws `snapshot` by `options`. For a PNG the rasteriser must have been started in this thread
 * (`initRasteriser`). A draw.io file is the SVG's drawing as draw.io cells; the pixel limit does not apply to it.
 */
export function renderView(
  snapshot: Snapshot,
  options: RenderOptions,
  context: RenderContext = {},
): RenderResult {
  const spec = viewSpecOf(options.view, context.snapshotRef ?? '');
  const view = prepareView(snapshot, spec, options.viewport, context.graph);
  checkView(view);
  const { metadata } = view.input.scene;
  const parts = { scope: metadata.rootLabel, lens: metadata.lens, readTime: metadata.readTime };
  const common = {
    viewHash: encodeViewSpec(spec),
    detailUsed: view.report.detail.used,
    assets: view.assets,
  };
  if (options.format === 'drawio') {
    const file = drawDrawio(view, options.theme, {
      ...(options.compressed === undefined ? {} : { compressed: options.compressed }),
      ...(options.fontSource === undefined ? {} : { fontSource: options.fontSource }),
      ...(context.version === undefined ? {} : { version: context.version }),
    });
    return {
      ...common,
      bytes: new TextEncoder().encode(file.text),
      contentType: DRAWIO_MEDIA_TYPE,
      fileName: exportFileName(parts, 'drawio'),
    };
  }
  const svg = drawSvg(view, options.theme);
  if (options.format === 'svg') {
    return {
      ...common,
      bytes: new TextEncoder().encode(svg),
      contentType: 'image/svg+xml; charset=utf-8',
      fileName: exportFileName(parts, 'svg'),
    };
  }
  const raster = drawPng(svg, options.theme, {
    ...(options.width === undefined
      ? { scale: options.scale ?? RENDER_DEFAULT_SCALE }
      : { width: options.width }),
    ...(context.maxPixels === undefined ? {} : { maxPixels: context.maxPixels }),
  });
  return {
    ...common,
    bytes: raster.png,
    contentType: 'image/png',
    fileName: exportFileName(parts, 'png'),
    scale: raster.scale,
    capped: raster.capped,
    width: raster.width,
    height: raster.height,
  };
}
