<!-- SPDX-License-Identifier: MIT -->

# brand/

`icon.svg` is gcportrait's mark: a frame holding a project zone above a VPC network and a subnetwork tile, in the
diagram's tints, drawn for the project (no Google mark or icon). The gcportrait name and the icon are not covered
by the MIT License: [LICENSE.md](LICENSE.md) says what that means. It is the one source of the mark
([AGENTS.md](../AGENTS.md), "Non-affiliation, brand and legal"); nothing else draws it on its own:

| Where | How it uses `icon.svg` |
|---|---|
| The website's favicon, `/favicon.svg` | The file as it is: `website/astro.config.ts` copies it into the build and serves it in development. |
| The website's logo, in the header and the footer of every page | `website/src/components/Logo.astro` draws the same shapes with the same colours, read from the file at build time (`website/src/lib/brand.ts`). |
| The app's favicon, `favicon.svg` (`/demo/favicon.svg` in the static demo) | The file as it is: `frontend/vite.config.ts` writes it into every build of the app, serves it in development and links it from `index.html` under the build's base path. |
| The app's mark, at the top left of the top bar beside the wordmark | The same `favicon.svg`, as an `<img>` with an empty `alt` from the build's base path (`frontend/src/shell/topbar/TopBar.tsx`), 24 pixels square, centred on the wordmark with the website header's gap (0.6rem) before the name. Its `prefers-color-scheme` follows the app's theme. |

One file serves both themes: a `<style>` holds the light colours and a `@media (prefers-color-scheme: dark)` block the
dark ones. Keep it that simple, rounded rectangles (`<rect>`) coloured by class rules that set `fill`, `stroke` and
`stroke-width`, because the website's logo follows the file: `website/src/lib/brand.ts` refuses anything it cannot
follow, so the website's build fails rather than drawing a different mark. `website/src/lib/brand.test.ts` pins the
drawing and checks that the logo, the README's wordmarks (`docs/media/brand/`) and the mark on the link-preview images
(`scripts/media.mjs`) draw the same shapes in the same colours; `pnpm website:check` checks the built favicon and every
page's logo against each other.
