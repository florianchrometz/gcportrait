<!-- SPDX-License-Identifier: MIT -->

# Render goldens

`S-overview-auto-light.png` is the headless renderer's golden (`pnpm render`): demo organisation S, overview
lens, detail `auto`, light theme, exactly as `pnpm render --fixture S --lens overview` writes it (2×, the
self-hosted Roboto faces only). The render library (`@gcportrait/render`) rasterises with resvg's WebAssembly
build, `@resvg/resvg-wasm` 2.6.2, which draws the same bytes as the native `@resvg/resvg-js` 2.6.2
(`packages/render/test/parity.test.ts`). `packages/render-cli/test/golden.test.ts` compares it tolerance-free
(same size, same RGBA bytes); a mismatch leaves the actual image and a picture of the differences under
`out/render/golden-failures/`. The backend's `POST /api/render` must answer demo S with these bytes too:
`backend/src/routes/render.test.ts` through the route and `backend/src/render/bundle.test.ts` in the bundled
render worker.

`S-overview-auto-light.drawio` is the same view as a draw.io file, as the render library's `drawDrawio` writes
it: the SVG's drawing translated into draw.io's cells (`frontend/src/export/drawio/`), compressed as
diagrams.net saves it, its `modified` the data's read time and its `agent` `gcportrait` without a version, so
a release does not change it (`pnpm render --drawio` and the render API write the same bytes with their
version there). `packages/render-cli/test/golden.test.ts` compares it byte for byte and draws it twice to the
same bytes.

Regenerate them only for an intended visual change (layout, renderer, fonts, resvg version, the draw.io
translator), look at the new files, and say why in the pull request:

```sh
pnpm --filter @gcportrait/render-cli test:golden:update
```

The SVG goldens of the renderer itself are in `../diagram/`; the command and the comparison helpers are
described in [packages/render-cli/README.md](../../../packages/render-cli/README.md), the rasteriser in
[packages/render/README.md](../../../packages/render/README.md).
