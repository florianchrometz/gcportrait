// SPDX-License-Identifier: MIT
/**
 * The frontend's only entry point for other workspaces (`@gcportrait/frontend`): what the render library
 * (`@gcportrait/render`, used by `pnpm render` and the backend's `POST /api/render`) needs to read data and
 * draw a view as the app does, without a browser. The demo snapshot loader and the zone type names of the data
 * worker, the icon resolution of the data worker, the standalone SVG document of the renderer (`renderDiagramSvg`,
 * the same components as the canvas, rendered with `react-dom/server`), the diagram palettes, the tagline and the
 * wordmark, the export's file name, and the app's own readers of data:
 * the import worker's handler (a pull's frames or an export's NDJSON into a snapshot, exactly as the app imports
 * them), the stored-document decoder, the `.gcportrait.json` bundle reader, and the draw.io translator (the SVG
 * document as a `.drawio` file, the module the app's export flow loads on demand) with the key it names a view's page
 * by. The app itself never imports this
 * module, so `react-dom/server` stays out of its bundle.
 */
export { TAGLINE, WORDMARK } from './branding';
export { documentText, type StaticOptions } from './diagram/DiagramSvg';
export { diagramIcons } from './diagram/iconTable';
export type { DiagramInput } from './diagram/model';
export { loadDemoSnapshot, zoneTypeNames } from './diagram/pipeline/dataHandler';
export { renderDiagramSvg } from './diagram/static';
export { PALETTES, type DiagramTheme } from './diagram/theme/tokens';
export {
  DRAWIO_EXTENSION,
  DRAWIO_MEDIA_TYPE,
  DrawioError,
  FONT_STYLESHEET,
  readDrawioFile,
  svgToDrawio,
  type DrawioFile,
  type DrawioOptions,
  type DrawioSummary,
  type ReadDrawio,
} from './export/drawio';
export { exportFileName, type ExportExtension, type FileNameParts } from './export/fileName';
export { drawnViewKey } from './state/sceneKey';
export { createImportHandler, type HandlerEnvironment } from './import/worker/handler';
export type { ImportResponse, StreamFailure, StreamSettings } from './import/worker/protocol';
export { isBundle } from './snapshots/bundle';
export { decodeJson } from './snapshots/codec';
export { parseBundle, SnapshotFileError, type ParsedBundle } from './snapshots/worker/parse';
