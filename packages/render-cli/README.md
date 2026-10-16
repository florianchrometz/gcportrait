<!-- SPDX-License-Identifier: MIT -->

# @gcportrait/render-cli

The headless renderer (export rules: skill gcp-diagram-style §8): `pnpm render` draws a view of a demo
organisation exactly as the app draws it, legend and title block included, and writes it as SVG and as a PNG
rasterised with [resvg](https://github.com/thx/resvg-js)'s WebAssembly build (`@resvg/resvg-wasm`, MPL-2.0,
used unmodified). The output is byte-stable: the same arguments give the same bytes, on every run, in every
process and on every platform. The drawing is done by the render library,
[`@gcportrait/render`](../render/README.md), which the backend's `POST /api/render` draws with too: a view an
instance draws through its API is byte for byte what this command writes (`--hash` takes the API's
`x-gcportrait-view` header). The website's sample exports (`node scripts/exports.mjs`), the render golden
under [`e2e/baselines/render/`](../../e2e/baselines/render/README.md) and contributors' and agents' visual
self-checks (AGENTS.md, "How to work a task") use it.

> gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
> not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons
> are trademarks of Google and are used under Google's icon usage terms.

Every run prints the command's name, `gcportrait render`, as the first line of standard error. Neither its
output, `index.json` nor the drawings carry an affiliation line (footers and long-form texts only: AGENTS.md,
Non-affiliation, brand and legal). Every SVG and PNG has the app's own title block, the same three lines as
the canvas, ending with the tagline `gcportrait.app - Visualize your Google Cloud Infrastructure`, and the
SVG's `<desc>` holds the scope, the lens, the read time and "Drawn with gcportrait." only.

## Usage

```sh
pnpm render --fixture M --lens networking --png out.png               # light, 2×, detail auto
pnpm render --fixture M --lens networking --theme dark --png out-dark.png --svg out-dark.svg
pnpm render --fixture L --lens overview                               # → out/render/L-overview-auto-light.png
pnpm render --fixture S --lens load-balancing --detail all --focus kind=project,project=demo-web-1
pnpm render --fixture M --lens networking --drawio out.drawio         # a draw.io file of the same drawing
pnpm -s render --fixture S --drawio - --drawio-plain > s.drawio          # its diagram as plain XML
pnpm render --hash 'snapshot=demo%3AM&lens=networking&detail=networks' --svg -   # a view copied from the app's URL
pnpm render --fixture M --lens networking --compare before.png --diff diff.png   # exit 1 if any pixel changed
pnpm render --all --out out/render/all                                # every fixture × lens × theme, with index.json
pnpm render --list-fixtures
pnpm render --help
```

Relative paths are taken from the directory the command was started in (pnpm's `INIT_CWD`). Without `--png`,
`--svg` or `--drawio` the PNG goes to `out/render/<fixture>-<lens>-<detail>-<theme>.png` at the repository
root (git-ignored). A path of `-` writes to standard output; the report then goes to standard error.

| Option | Meaning |
|---|---|
| `--fixture S\|M\|L\|XL` | the demo organisation (default `M`); `--list-fixtures` prints them with their asset counts |
| `--lens LENS` | one of the eleven lenses (default `overview`) |
| `--theme light\|dark` | default `light` |
| `--detail auto\|folders\|projects\|networks\|all` | default `auto`: what the app opens at the viewport |
| `--focus kind=KIND[,NAME=VALUE…]`, `--root NODE_ID`, `--filter KEY=VALUE`, `--flip ZONE_ID` | the rest of the ViewSpec, as `pnpm render-scene` takes them; an invalid value is an error, never silently dropped |
| `--hash VIEW_HASH` | the whole view from an app URL (the part after `#`); its `snapshot=demo:<size>` names the fixture |
| `--viewport WIDTHxHEIGHT` | the canvas the `auto` detail level fits (default `1280x800`, the smallest the app supports) |
| `--scale N` / `--width PX` | PNG pixels per drawing unit, up to 3 (default 2, the export's default), or the PNG's width in pixels (margin included). A PNG beyond the app export's canvas limits (16 384 px a side, 2^27 px in all) is drawn at the largest two-decimal scale that fits, and the report says so |
| `--png FILE`, `--svg FILE`, `--drawio FILE` | where to write; any of them |
| `--drawio-plain` | the draw.io file's diagram as plain XML instead of compressed as diagrams.net saves it (several times larger, readable and diffable) |
| `--drawio-unversioned` | the draw.io file's `agent` without this package's version (`gcportrait` alone, as the library writes it by default and the golden is), so a release changes no byte of the file; the website's sample exports are written this way (`scripts/exports.mjs`) |
| `--compare EXPECTED.png [--max-diff N] [--diff FILE]` | compare the PNG with an earlier one (pixelmatch, colour threshold 0, anti-aliased pixels counted); exit 1 when more than N pixels (default 0) differ; `--diff` writes the differences as an image |
| `--strict` | exit 1 when the layout breaks one of its invariants (skill gcp-diagram-layout §5); the report always says whether they hold |
| `--all [--out DIR] [--fixtures …] [--lenses …] [--themes …] [--formats png,svg,drawio] [--drawio-plain] [--drawio-unversioned]` | every combination (default: S, M, L, XL × all lenses × both themes, PNG and SVG; `drawio` adds the draw.io files) into `DIR` (default `out/render/all`), named like the renderer's baselines, with an `index.json` listing each file, its size, rect and edge counts and the detail level used. All 88 take a few minutes |

Exit codes: 0 done, 1 a check failed (`--compare`, `--strict`), 2 a usage error.

The report names the fixture, lens, the detail level `auto` chose and its budget, the layout's rect and edge
counts, whether its invariants hold, any refused root or focus, and each file written:

```text
gcportrait render
demo M (952 assets) · lens networking · detail auto → folders (budget 73) · light
layout: 42 rects, 36 edges routed (0 fallbacks, 0 failed); invariants hold
svg: 1861×1446 → /…/out/render/M-networking-auto-light.svg (45 091 bytes)
png: 3818×2988 px at 2× with a 24 px margin → /…/out/render/M-networking-auto-light.png (600 202 bytes)
```

A draw.io file's line names what it holds and how it is stored
(`drawio: 15 zones, 40 nodes, 45 edges, 271 cells, compressed → …`).

**The draw.io file.** `--drawio` writes the view as a `.drawio` file that diagrams.net opens as an editable
diagram looking like the PNG: the SVG's drawing translated into draw.io's cells by the translator the app's
export uses (`frontend/src/export/drawio/`, through the library's `drawDrawio`): zones as nested containers
with their titles, cards and chips as groups of body, icon and text, lines between their nodes with the
drawing's bends, heads and dashes, three layers (Diagram, Connections, Title and legend), the theme's canvas
as the page's background (with diagrams.net's adaptive colours off, so its dark interface shows the drawing's
own colours). Its labels name Google Fonts' stylesheet of Roboto and Roboto Mono, which diagrams.net loads
when it opens the file (the render API's `fontSource`, [docs/api.md](../../docs/api.md#drawio-files)). The
file's `modified` is the data's read time and its `agent` is `gcportrait` and this package's version
(`gcportrait` alone with `--drawio-unversioned`), so the same arguments give the same bytes; the diagram is
compressed as diagrams.net saves it (deflate, plain JavaScript, so the bytes are the same on every platform)
unless `--drawio-plain` is given.

## How it draws the app's picture

1. **The view.** `createDemoViews().prepare(fixture, spec, viewport)` (`@gcportrait/render`'s `src/view.ts`)
   takes the app's path: the data worker's demo loader (`loadDemoSnapshot`: demo-data → CAI NDJSON → ingest,
   fixed clock and entropy), `buildGraph` with the compiled catalog, `buildSceneWithReport` at the viewport's
   rect budget, `layoutScene` with its default options, and the diagram input the page builds (lens title,
   `secures` overlay zones, icons resolved through `@gcportrait/icons`, zone type names). The Graph of each
   fixture is built once and reused for every view of it. It also runs the layout's `checkLayout`.
2. **The SVG.** The frontend's `renderDiagramSvg`: the same React components as the interactive canvas
   (`frontend/src/diagram/`), rendered with `react-dom/server`, with every theme colour written as an
   attribute, icons inline (unaltered, as `<use>` of one definition each), fonts as the label and mono stacks,
   the legend and the title block included. The read time is written in UTC (`+00:00`) so the output does not
   depend on the machine's time zone. The SVG is byte for byte the renderer's own baseline
   (`e2e/baselines/diagram/`, written by the frontend's tests); `test/render.test.ts` and `test/cli.test.ts`
   check that.
3. **The PNG.** resvg draws the SVG by the export rules (skill gcp-diagram-style §8) and the geometry of the
   app's PNG export: at the chosen scale, on the theme's canvas colour, with a 24 px margin, the pixel
   size rounded up; only the root element's size and viewBox are changed for that. Text is set with **only**
   the self-hosted Roboto 400/500/700 and Roboto Mono 400 faces (`@fontsource`, the versions the layout's
   metrics table was generated from; a test compares them), unwrapped from WOFF in memory, Latin subsets
   first. The WebAssembly rasteriser loads no system font, so `"Google Sans"` in the label stack falls through
   to Roboto and text is set with the advances the layout measured (a test checks a bold label's drawn width
   against `measureText`).

The CLI imports the render library only (`eslint.config.js` allows it `model`, `graph`, `demo-data` and
`render`), and nothing may import it. The library reaches the frontend's components through the frontend's
entry point for other workspaces, `frontend/src/headless.ts`, which the app never imports. The `render` script
runs `src/cli.ts` through tsx with the frontend's tsconfig, so the frontend's `.tsx` files compile with its
JSX settings; Vitest picks each file's nearest tsconfig by itself.

## Goldens and comparisons

| Helper | What |
|---|---|
| `samePixels(a, b)` | tolerance-free: same size, same RGBA bytes |
| `comparePng(actual, expected, { threshold?, includeAA?, diffImage? })` | pixelmatch count of differing pixels (threshold 0 and anti-aliased pixels counted by default), the ratio, and optionally an image of the differences |
| `checkGolden(png, goldenPath, { exact?, maxDiffPixels?, threshold?, update?, failureDir? })` | the golden check: exact by default; `exact: false` accepts up to `maxDiffPixels` (for renders too large to commit); a mismatch leaves `<name>.actual.png` and `<name>.diff.png` in `failureDir`; `update` rewrites the golden |

| `checkTextGolden(text, goldenPath, { update?, failureDir? })` | a text golden (the draw.io file): the same bytes; a mismatch names the first line and column that differ and leaves `<name>.actual<ext>` in `failureDir` |

The committed goldens are `e2e/baselines/render/S-overview-auto-light.png`, demo S, overview, detail auto,
light, exactly what `pnpm render --fixture S --lens overview` writes (2×), compared tolerance-free, and
`S-overview-auto-light.drawio`, the same view as the library's `drawDrawio` writes it (compressed, `agent`
without a version, so a release leaves it as it is; `--drawio` writes the same bytes with this package's
version in the `agent`), compared byte for byte, both by `test/golden.test.ts`. After an intended visual
change (layout, renderer, fonts, resvg version, the draw.io translator), regenerate them deliberately, look at
them, and say why in the pull request:

```sh
pnpm --filter @gcportrait/render-cli test:golden:update
```

A failing golden test leaves the actual file (and for the PNG a picture of the differences) under
`out/render/golden-failures/`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm render …` (root) | the command line above (`pnpm --filter @gcportrait/render-cli run render …`) |
| `pnpm --filter @gcportrait/render-cli test` | argument parsing, the comparison helpers, byte stability (two runs in process, two child processes, the draw.io file included), sameness with the renderer's SVG baselines, the golden PNG and the golden draw.io file (the fonts, the WOFF unwrapper and the rasteriser are the render library's tests) |
| `pnpm --filter @gcportrait/render-cli test:golden:update` | rewrites the golden PNG and the golden draw.io file |
| `pnpm --filter @gcportrait/render-cli lint` / `typecheck` | ESLint and `tsc -b` for this package |

## Dependencies

`@gcportrait/render` (which brings `@resvg/resvg-wasm` 2.6.2, MPL-2.0, pinned exactly, the `@fontsource`
Roboto packages, OFL-1.1, the font exception of AGENTS.md, Licence and dependencies, and through the
frontend's draw.io translator fflate 0.8.2, MIT, pinned exactly), `pixelmatch` 7.2.0 (ISC) and `pngjs` 7.0.0
(MIT) for the comparisons, and the workspace packages above.

## Known limits

- **Platforms.** The rasteriser is WebAssembly, which computes the same pixels on every platform. It is slower
  than a native binding would be (1.2 to 1.9 times, [`@gcportrait/render`](../render/README.md)), so `--all`
  takes a few minutes.
- **Demo data only.** The command draws the demo organisations. A stored snapshot, an export or a live pull is
  drawn by the app's Export menu or by the render API (`POST /api/render`, [docs/api.md](../../docs/api.md)).
- **Whole diagram only.** The export's "current viewport" option is an interactive concept; the command
  always draws the whole diagram (also as a draw.io file).
