// SPDX-License-Identifier: MIT
/**
 * @gcportrait/render — the render library (agents.md, Exports and the render API): a snapshot and a view
 * drawn as the app draws them (the frontend's SVG components rendered without a browser), rasterised by
 * resvg's WebAssembly build or translated into a draw.io file, byte-stable for the same input on every
 * platform. `pnpm render` (`@gcportrait/render-cli`) and the backend's `POST /api/render` both draw through
 * it. This file is the package's only public surface.
 */
export { PALETTES, TAGLINE, WORDMARK, type DiagramInput, type DiagramTheme } from '@gcportrait/frontend';
export {
  ASSET_MANIFEST,
  RESVG_WASM_PACKAGE,
  assetPackageDirs,
  packageAssets,
  readAssetDir,
  writeAssetDir,
  type AssetManifest,
  type RenderAssets,
} from './assets.js';
export {
  DRAWIO_EXTENSION,
  DRAWIO_MEDIA_TYPE,
  readDrawioFile,
  type DrawioFile,
  type DrawioSummary,
  type ReadDrawio,
} from '@gcportrait/frontend';
export { drawDrawio, drawPng, drawSvg, isTheme, THEMES, type DrawioDrawOptions } from './draw.js';
export {
  FONT_FACES,
  FONT_PACKAGES,
  faceFiles,
  fontBuffers,
  fontFiles,
  fontPackageVersions,
  subsetsOf,
  type FontFace,
} from './fonts.js';
export {
  DEFAULT_SCALE,
  MAX_SCALE,
  PNG_MARGIN,
  RASTER_LIMITS,
  RasterError,
  framedSvg,
  initRasteriser,
  pngGeometry,
  rasterise,
  rasteriserReady,
  svgFrame,
  type Frame,
  type PngGeometry,
  type Raster,
  type RasterOptions,
} from './raster.js';
export {
  checkView,
  renderView,
  viewSpecOf,
  ViewRefusedError,
  type RenderContext,
  type RenderResult,
} from './render.js';
export {
  checkAssetCount,
  createSnapshotReader,
  snapshotFromBundle,
  snapshotFromDemo,
  SnapshotInputError,
  tooManyAssets,
  type NdjsonSettings,
  type SnapshotInputCode,
  type SnapshotReader,
} from './snapshot.js';
export {
  DEFAULT_VIEWPORT,
  FIXTURES,
  createDemoViews,
  graphOf,
  prepareView,
  type DemoView,
  type DemoViews,
  type PreparedView,
  type Viewport,
} from './view.js';
export { WoffError, woffToSfnt } from './woff.js';
