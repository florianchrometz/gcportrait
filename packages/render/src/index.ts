// SPDX-License-Identifier: MIT
/**
 * @gcportrait/render — the render library (packages/AGENTS.md, The render library): a snapshot and a view
 * drawn as the app's renderer draws them (the frontend's SVG components rendered without a browser),
 * rasterised by resvg's WebAssembly build or translated into a draw.io file, byte-stable for the same input
 * on every platform. `pnpm render` (`@gcportrait/render-cli`) and the backend's `POST /api/render` both draw
 * through it. This file is the package's only public surface.
 */
export { PALETTES, TAGLINE, WORDMARK, type DiagramTheme } from '@gcportrait/frontend';
export {
  RESVG_WASM_PACKAGE,
  assetPackageDirs,
  readAssetDir,
  writeAssetDir,
  type RenderAssets,
} from './assets.js';
export { readDrawioFile, type DrawioFile } from '@gcportrait/frontend';
export { drawDrawio, drawPng, drawSvg, THEMES, type DrawioDrawOptions } from './draw.js';
export { initRasteriser, svgFrame, type Raster } from './raster.js';
export { renderView, ViewRefusedError } from './render.js';
export { viewSpecOf } from '@gcportrait/graph';
export {
  checkAssetCount,
  createSnapshotReader,
  snapshotFromBundle,
  snapshotFromDemo,
  SnapshotInputError,
  type SnapshotReader,
} from './snapshot.js';
export {
  DEFAULT_VIEWPORT,
  FIXTURES,
  createDemoViews,
  type DemoView,
  type DemoViews,
  type Viewport,
} from './view.js';
