<!-- SPDX-License-Identifier: MIT -->

# @gcportrait/render

The render library (AGENTS.md, Exports and the render API): a snapshot and a view drawn as the app's renderer
draws them, as a standalone SVG, a PNG and a draw.io file, byte-stable for the same input on every platform.
`pnpm render` ([`@gcportrait/render-cli`](../render-cli/README.md)) and the backend's `POST /api/render`
([docs/api.md](../../docs/api.md)) both draw through it, so a demo view comes out byte for byte the same from
either.

> gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
> not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons
> are trademarks of Google and are used under Google's icon usage terms.

The drawings carry no affiliation line (AGENTS.md, Non-affiliation, brand and legal): the title block holds
the scope, the lens with the read time and the tagline. Neither does anything that travels with them: not the
command line's output, not the API's answer; the statement is in the app's footer and the long-form texts
only.

## What it does

| Module | |
|---|---|
| `src/snapshot.ts` | Snapshots, read by the app's own code: `snapshotFromDemo(size)` (the data worker's demo loader), `snapshotFromBundle(text)` (`parseBundle`, a `.gcportrait.json` file), and `createSnapshotReader(settings)`, NDJSON pushed chunk by chunk (a Cloud Asset Inventory export, a saved stream, or a live pull's frames) through the app's import handler with the settings the app gives a pull or an export, read back as the app reads a stored snapshot. Failures are `SnapshotInputError`s with the app's messages. |
| `src/view.ts` | `prepareView(snapshot, spec, viewport)`: the Graph, the Scene at the viewport's rect budget, the layout and the diagram input, as the app's data worker and page build them; `createDemoViews()` for the demo organisations, each Graph built once. |
| `src/draw.ts` | `drawSvg(view, theme)` (the frontend's `renderDiagramSvg`, read time in UTC), `drawPng(svg, theme, options)` and `drawDrawio(view, theme, { compressed, fontSource, version })`: the SVG translated into a `.drawio` file by the frontend's translator (`svgToDrawio`, `frontend/src/export/drawio/`, the module the app's export loads), compressed by default, with the data's read time as its `modified` and `gcportrait` and `version` (none by default) as its `agent`. |
| `src/raster.ts` | The export's PNG geometry (`pngGeometry`, `framedSvg`: scale or width, a 24 px margin, 16 384 px a side, 2^27 px or a lower `maxPixels`) and `rasterise` with resvg's WebAssembly build; `initRasteriser(assets)` once per thread. |
| `src/fonts.ts`, `src/woff.ts` | The self-hosted Roboto faces in their loading order (Latin subsets first), unwrapped from WOFF to OpenType in memory. |
| `src/assets.ts` | `packageAssets()` (the wasm module and the faces from the installed packages), `writeAssetDir(dir)` and `readAssetDir(dir)`: the directory the backend's bundle ships, written and read by one module, so the font order has one source. |
| `src/render.ts` | `renderView(snapshot, options, context)`: `RenderOptionsSchema` (`@gcportrait/model`) to the bytes (PNG, SVG or draw.io), the app's export file name, the view's hash, the detail level and the scale used; `context.version` goes into a draw.io file's `agent`. A refused root or a focus that does not apply is a `ViewRefusedError`. |

```ts
import { RenderOptionsSchema } from '@gcportrait/model';
import { initRasteriser, renderView, snapshotFromDemo } from '@gcportrait/render';

await initRasteriser();
const result = renderView(await snapshotFromDemo('M'), RenderOptionsSchema.parse({ view: { lens: 'networking' } }), {
  snapshotRef: 'demo:M',
});
// result.bytes is the PNG; result.fileName is gcportrait_example.com_networking_20261008T000000Z.png
```

## The rasteriser

`@resvg/resvg-wasm` 2.6.2 (MPL-2.0, used unmodified, pinned exactly: the pixels depend on its version). A
WebAssembly build computes the same pixels on every platform, and it can be bundled into the backend's image,
which has no `node_modules`. `test/parity.test.ts` draws six views and a capped one with it and with the
native `@resvg/resvg-js` 2.6.2 (a dev dependency, used only there) and finds the same bytes; the committed
golden (`e2e/baselines/render/S-overview-auto-light.png`) comes out byte for byte. It is 1.2 to 1.9 times
slower than the native binding, and its memory grows to about 10 bytes per pixel of the largest PNG drawn and
is never given back while its thread lives: the backend draws each render in a fresh worker.

## Boundaries and dependencies

The one package that may import the frontend (`eslint.config.js`): `model`, `catalog`, `graph`, `layout`,
`demo-data` and `frontend`, through `frontend/src/headless.ts`, which the app never imports, so
`react-dom/server` stays out of its bundle. The frontend may not import this package. Node only (`fs`, `zlib`,
WebAssembly); the draw.io translator it reaches through the frontend is plain TypeScript with fflate (MIT) as
its compressor, the same code the browser runs. Dependencies: the workspace packages above,
`@resvg/resvg-wasm` (MPL-2.0) and `@fontsource/roboto` and `@fontsource/roboto-mono` (OFL-1.1, the font
exception of AGENTS.md, Licence and dependencies; the backend's image copies the faces with their licences).
Dev only: `@resvg/resvg-js` (the parity test), `pngjs`. The backend's image ships resvg-wasm's glue code in
`backend/dist/render-worker.mjs` and its module as `backend/dist/render-assets/resvg.wasm`; the package has no
licence file of its own, so `THIRD_PARTY_NOTICES.txt` and `server-dependencies.txt` name those files, where
its source is, and carry the MPL-2.0 text (`scripts/licenses/MPL-2.0.txt`).

| Command | |
|---|---|
| `pnpm --filter @gcportrait/render test` | WOFF, fonts and the asset directory, the rasteriser and its parity with the native binding, the snapshot readers against the app's import, `renderView` against the SVG baselines and the golden PNG, and its draw.io file (compressed, plain, without `fontSource`). |
| `pnpm --filter @gcportrait/render lint` / `typecheck` | ESLint and `tsc -b` for this package. |
