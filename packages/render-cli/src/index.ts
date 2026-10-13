// SPDX-License-Identifier: MIT
/**
 * @gcportrait/render-cli — the headless renderer's command line (export rules: skill gcp-diagram-style §8):
 * `pnpm render` draws a demo view as the app draws it, as a standalone SVG, a PNG and a draw.io file,
 * byte-stable for the same input, through the render library (`@gcportrait/render`), which the backend's
 * `POST /api/render` draws with too. Used by the website's sample exports (scripts/exports.mjs), the render
 * goldens under e2e/baselines/render/, and agents' self-checks. This file is the package's only public
 * surface: the command line, the comparisons, and the library's drawing functions the command runs,
 * re-exported for its tests.
 */
export {
  parseCommand,
  USAGE,
  UsageError,
  viewFileName,
  type AllCommand,
  type Command,
  type OutputFormat,
  type RasterChoice,
  type RenderCommand,
} from './args.js';
export {
  comparePng,
  decodePng,
  encodePng,
  samePixels,
  type CompareOptions,
  type DecodedPng,
  type PngDiff,
} from './compare.js';
export {
  checkGolden,
  checkTextGolden,
  type GoldenOptions,
  type GoldenResult,
  type GoldenStatus,
} from './golden.js';
export {
  BANNER,
  CLI_VERSION,
  DEFAULT_OUT_DIR,
  REPO_ROOT,
  describeView,
  run,
  type IndexEntry,
  type Io,
} from './run.js';
export {
  DEFAULT_SCALE,
  DEFAULT_VIEWPORT,
  FIXTURES,
  MAX_SCALE,
  PNG_MARGIN,
  RASTER_LIMITS,
  THEMES,
  createDemoViews,
  drawDrawio,
  drawPng,
  drawSvg,
  isTheme,
  readDrawioFile,
  type DemoView,
  type DemoViews,
  type PreparedView,
  type Raster,
  type Viewport,
} from '@gcportrait/render';
