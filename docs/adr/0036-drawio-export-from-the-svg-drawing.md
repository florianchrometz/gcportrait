<!-- SPDX-License-Identifier: MIT -->

# 0036. The draw.io export is the SVG drawing translated into draw.io's cells

- **Status:** accepted (2026-10-12): the maintainer asked for the format on 2026-10-12; it is offered in the app's
  Export menu, the render API, `pnpm render` and the website's sample exports
- **Date:** 2026-10-12
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** ADRs [0013](0013-png-and-svg-export.md), [0018](0018-non-affiliation-statement.md),
  [0029](0029-bundle-budgets.md), [0033](0033-render-api.md); [docs/api.md](../api.md#drawio-files),
  `frontend/src/export/drawio/`

## Context

The maintainer asked on 2026-10-12 for a third export next to PNG and SVG: a file diagrams.net (draw.io)
imports, "so that it looks exactly like the images but is in fact something that can be edited", offered
wherever the other exports are (the app's Export menu, `POST /api/render`, `pnpm render`, the website's sample
exports). draw.io reads its own XML format (`mxfile`, one `mxGraphModel` per page, cells with geometry and a
style string); it does not keep an imported SVG editable, and a second renderer that wrote cells from the
layout would drift from the picture with every change to the components.

## Decision

1. **One drawing, three files.** The `.drawio` file is made from the SVG markup the diagram's components draw
   (the static render of the render library, or the export's off-screen drawing in the app), never from a
   second renderer: a translator walks the markup and turns every primitive (rect, circle, line, path, text
   with its tspans, an icon's inline SVG) into a cell with the same coordinates, sizes, colours, stroke
   widths, dashes, corner radii, fonts and lines of text. A path draw.io cannot draw as a line (a curve, a
   filled shape) becomes an image of itself.
2. **Structure from markers on the components.** Zone and node groups carry `data-kind`, `data-id`, a short index
   `data-n` (the rect's place in the layout) and `data-parent` (the index of the zone they lie in), each line's
   path `data-ends` (the indices of the nodes at the drawn path's start and end; not `data-id`, which the canvas's
   painter reads as a node's), the title block and the legend `data-kind`. Naming the ends by index keeps the
   markers small: an asset name repeated on every line had made them a fifth to a third of an SVG. Zones become nested containers with their title as their own label,
   nodes groups of body, icon and text in their zone, lines edges between their nodes with the drawing's bends
   as waypoints and their ends fixed at the arrowheads' tips; three layers ("Diagram", "Connections", "Title
   and legend") keep the paint order.
3. **Text** is an HTML label per run of lines, each baseline placed where the SVG has it (draw.io's
   line-height 1.2 and Roboto's vertical metrics), in Roboto and Roboto Mono, with Google Fonts' stylesheet
   named in `fontSource` by default so diagrams.net loads the faces (the user's diagrams.net fetches it, never
   the instance). A zone's title and a badge's text are their cell's own label, placed by `spacingLeft` and
   `spacingTop`, which mxGraph and diagrams.net read as whole pixels: the file writes the whole-pixel spacing
   that puts the label on the pixel its exact place rounds to, where a text cell at that place is drawn.
4. **The file** is deterministic (ids from the drawing's ids, `modified` the data's read time, the page's id a hash
   of its name, the read time, the theme and the view drawn, so files of several views, themes and days keep
   different page ids when their pages are copied into one diagram), compressed as
   draw.io saves it (the URI-encoded XML deflated and base64-encoded) with fflate, plain JavaScript under MIT,
   so the bytes are the same in the browser and in Node on every platform; plain XML on request. The title
   block keeps its three lines and nothing else (ADR 0018). The page's background is the theme's canvas, and
   the model sets `adaptiveColors="none"`: diagrams.net recolours a diagram in its dark interface unless a file
   says otherwise, so without it neither theme's file would keep its colours there.
5. **The app loads the translator on demand**, a chunk of its own outside the first paint (ADR 0029). Its Export
   menu offers "Download draw.io (.drawio)" next to SVG and PNG, with the same area and theme; the instance's
   version goes into the file's `agent`. The website offers each sample export as a `.drawio` file too, with a link
   that opens it in diagrams.net (`https://app.diagrams.net/?url=` and the file's address on the site).
6. **A "current viewport" file** keeps the cells that meet the visible area whole (an editable file holds no
   cut shape), shifted so the crop's corner is 0,0. What it keeps can reach beyond the crop (a zone that meets
   it keeps its full size), so the title block goes above, and the legend below, the crop and everything kept,
   each 24 px away at their left edge: where the SVG export, which clips, puts them at the crop, they would
   cover kept zones.

## Consequences

- The render golden has a `.drawio` twin (`e2e/baselines/render/`), compared byte for byte, and the app's file of
  the same view is byte for byte the golden (`e2e/tests/drawio.spec.ts`); the SVG baselines carry the markers,
  which add 4 to 7 % to an SVG's size.
- draw.io's own rendering differs in detail, within what its format can say: it snaps lines of odd width to
  whole pixels, rounds a label's position to a whole pixel, and ignores a zone title's halo. Its arrowheads are
  its own shapes stroked with the line's width: the translator matches a head's length (`startSize`,
  `endSize`), but a `block` head is as wide as it is long, about 1 px wider than the drawing's 9 × 7 and 7 × 5
  heads (up to 1.26 px wider across, its outline and stroke `size + 2 × width`), and before an `open` head the
  line stops 2.236 × its width short of the tip (2.68 px at the 1.2 px memberOf line), where the SVG runs it to
  the tip. Measured with mxGraph 4.2.2 in Chromium against resvg's PNG of the same drawing at 1×, 2.0 to 3.3 %
  of the pixels differ at pixelmatch's threshold 0.1 on demos S, M and L in both themes (text anti-aliasing,
  the half-pixel snap and the heads); zone and node boxes and the lines' ends match exactly, colours and fonts
  match, and every text line lies within 0.77 px. The fidelity check (`e2e/tests/drawio.spec.ts`, mxGraph a
  development dependency served from `node_modules`) measures these on every run and fails above its limits:
  4 % of the pixels, 1.25 px for a text line, 0.5 px for a box or a line's end, 3 px for an open head's gap and
  1.5 px for a block head's width.
- The render API gains `"format": "drawio"` with `compressed` and `fontSource`; its pixel limits stay a PNG's.

## Alternatives considered

- **Cells from the layout instead of the markup.** A second renderer: every change to the components would
  need its twin, and the file would not be the picture by construction.
- **The SVG embedded as one image.** Looks right, edits nothing.
- **Node's zlib or the browser's `CompressionStream`.** Different deflate implementations write different
  bytes (by platform too), so neither the golden nor the app's file could match the API's byte for byte.
