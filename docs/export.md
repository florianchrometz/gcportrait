<!-- SPDX-License-Identifier: MIT -->

# Exporting a diagram: SVG, PNG and draw.io

The **Export** menu in the diagram page's top bar saves the view on screen as an SVG file, a PNG file or a
draw.io file, or copies the PNG to the clipboard. The draw.io file (`.drawio`) opens in
[diagrams.net](https://app.diagrams.net) and draw.io as an editable diagram that looks like the picture: it is
the SVG drawing translated into draw.io's shapes, not a second drawing ([section
4](#4-what-the-files-contain)). What you export is the view you see, with whatever lens, focus, filters,
drill-in, detail level and timeline day it has, drawn once more for the file with its title block and legend.
The same drawing comes out of `pnpm render` on the command line. This guide lists the options, the file names,
what the title block says, and what the files contain.

| Section | |
|---|---|
| [1. The Export menu](#1-the-export-menu) | Area, theme, PNG resolution, fonts; Download SVG, Download PNG, Download draw.io, Copy PNG. |
| [2. File names](#2-file-names) | `gcportrait_<scope>_<lens>_<readTime>.<ext>`. |
| [3. The title block and the legend](#3-the-title-block-and-the-legend) | What every exported file says about itself. |
| [4. What the files contain](#4-what-the-files-contain) | SVG, PNG and draw.io in detail; the current viewport; large diagrams. |
| [5. Exporting without a browser: `pnpm render`](#5-exporting-without-a-browser-pnpm-render) | The same picture from the command line, for demo views, and from an instance's API. |
| [6. Licences, trademarks and the source link](#6-licences-trademarks-and-the-source-link) | What travels with an exported file and what does not. |

Exporting a picture is not the same as exporting the data: the Snapshots page saves a snapshot as a
`.gcportrait.json` file to import again elsewhere ([modes.md](modes.md#5-export-files)).

## 1. The Export menu

The menu opens from the **Export** button, the last control at the right end of the top bar, filled in the
accent colour (Enter, Space or ↓ opens it on its first item, ↑ on its last; ↑ ↓ Home End move; Escape closes).
While nothing is drawn the button stays inert. The options keep the menu open; an action closes it and reports
in a status line next to the button.

| Group | Option | Default | What it does |
|---|---|---|---|
| Area | **Whole diagram** | yes | the whole layout, whatever part the canvas shows |
| | **Current viewport** | | only what the canvas shows now, clipped (a draw.io file keeps the shapes in view whole instead); the title block and the legend are added above and below it, so they are in the file even when they are scrolled out of view |
| Theme | **Light**, **Dark** | the app's theme | the colours of the file, any of the three. It follows the app's theme until you pick one, and the file is drawn in that theme, independently of the canvas |
| PNG resolution | **2×**, **3×** | 2× | pixels per drawing unit of the PNG |
| SVG file | **Embed fonts** | off | puts the Roboto faces into the SVG, so it looks the same where Roboto is not installed (a larger file) |
| | **Download SVG** | | saves the SVG file |
| | **Download PNG** | | saves the PNG file |
| | **Download draw.io (.drawio)** | | saves the draw.io file, which diagrams.net and draw.io open as an editable diagram ([below](#4-what-the-files-contain)) |
| | **Copy PNG** | | copies the PNG to the clipboard. A browser that cannot copy images says "This browser cannot copy images to the clipboard. Use Download PNG instead." |

The status line says what happened ("Saved gcportrait_example.com_networking_20261008T000000Z.png (WIDTH ×
HEIGHT px).", "Copied the PNG to the clipboard (WIDTH × HEIGHT px).") or why it failed.

## 2. File names

```text
gcportrait_<scope>_<lens>_<readTime>.svg
gcportrait_<scope>_<lens>_<readTime>.png
gcportrait_<scope>_<lens>_<readTime>.drawio
```

- `<scope>` is the name at the top of the canvas: the organisation, folder or project, or the container you
  drilled into;
- `<lens>` is the lens id (`overview`, `networking`, …,
  [lenses-and-filters.md](lenses-and-filters.md#2-lenses));
- `<readTime>` is the read time of the day drawn, in UTC, in ISO 8601's basic format: `2026-10-08T00:00:00Z`
  becomes `20261008T000000Z` (no `:`, which Windows does not allow in a file name).

Each part keeps only the letters A–Z and a–z, the digits, `.` and `-`; anything else becomes `-`, and a scope
or lens part is cut at 64 characters. Demo M through the networking lens on its last day is
`gcportrait_example.com_networking_20261008T000000Z.png`. A different day of the timeline gives a different
name, so exports of several days sort by day.

## 3. The title block and the legend

Every exported file carries its title block in the top-left corner, inside the drawing, in three lines:

```text
example.com                                                  the scope (or the drill-in root)
Networking lens · read 2026-10-08T00:00:00+00:00             the lens, and the read time at your UTC offset
gcportrait.app - Visualize your Google Cloud Infrastructure   the tagline
```

The read time is the moment Cloud Asset Inventory reported (or, for an export without its `operation.json`,
the estimate; [timeline.md](timeline.md#8-estimated-read-times)), written in ISO 8601 with the offset of the
computer that exported it, so `read 2026-10-10T18:15:23+02:00` was 16:15:23 UTC. The diagram on screen shows
the same three lines. The non-affiliation statement is in the app's footer and in the long form at the
top of this guide, not in the drawing: an exported file has no affiliation line in its title block or in its
description.

The **legend** (bottom left) lists what the drawing uses: the kinds of zones and cards (folder, project,
resource, collapsed zone, …), the arrow kinds with their line styles, and, on a compared day of the timeline,
the added, removed and changed markers ([timeline.md](timeline.md#5-what-changed-the-diff-overlay)). The title
block and the legend are always in an export, even when Settings › "Show the legend and the title block on the
canvas" hides them on screen.

An SVG also names itself for screen readers and file browsers: its `<title>` is "gcportrait diagram of
example.com, Networking lens", and its `<desc>` repeats the scope, the lens and the read time, then "Drawn
with gcportrait.".

## 4. What the files contain

**SVG.** A standalone drawing: the colours of the chosen theme written into the elements (no CSS variables, no
stylesheet to resolve), Google's product icons inline and unaltered, and text in the font stack
`'Google Sans', 'Google Sans Text', Roboto, system-ui, sans-serif`, so each viewer sees the first of them
installed (with "Embed fonts", the Roboto faces travel inside the file). Nothing interactive is left in it: no
focus rings, no selection highlight, no collapse buttons. It opens in browsers and in vector editors; links to
icons are written in both the current and the older `xlink:href` form, and haloed labels as two text elements,
so older editors draw what browsers draw.

**PNG.** The same SVG, with the Roboto faces always embedded, drawn by your browser on a canvas in the theme's
background colour with a 24-unit margin, at 2× or 3×: a drawing 1861 units wide is (1861 + 48) × 2 = 3818
pixels wide at 2×. The canvas is capped at 16 384 pixels a side and 2^27 pixels in all, what browsers can
draw; a larger export is drawn at the largest scale that fits, and the status line says so.

**draw.io.** The same drawing as draw.io's own cells, so diagrams.net and draw.io open it as a diagram you can
edit, not as a picture: zones are containers nested as on the canvas, each with its title, so moving a zone
moves what it holds; cards and chips are groups of their box, their icon (Google's icon embedded unaltered)
and their text; the lines are connectors between their two resources, with the drawing's bends, heads and
dashes; the title block and the legend sit on a layer of their own ("Title and legend", above "Connections"
and "Diagram"). Every shape, line and label is where the picture has it, in its colours and fonts: the file is
translated from the SVG export's drawing, not drawn a second time. The page's background is the theme's canvas
colour, and the file keeps its colours in diagrams.net's dark interface too. Each label names Roboto through
Google Fonts' stylesheet, which diagrams.net loads when it opens the file (your diagrams.net fetches it, not
gcportrait); where it cannot, it uses its default font and the labels keep their places but not their widths.
The diagram is stored compressed, as diagrams.net saves it. To open the file: in diagrams.net, File, Open
from, Device (or drag it onto the page); in draw.io's desktop app, File, Open; or put it at a public address
and open `https://app.diagrams.net/?url=` followed by that address, URL-encoded. Rendered by mxGraph, the
library diagrams.net is built on, the file matches the SVG within a pixel for every shape and every line of
text; draw.io draws a little differently in detail (its own arrowheads, odd line widths snapped to whole
pixels).

**Current viewport.** The canvas's visible part of the diagram, clipped; content keeps its position, the title
block goes into a band above it and the legend into a band below it, 24 units away. A draw.io file holds no
cut shape: it keeps every zone, card and label that meets the visible part whole, with the lines between what
it keeps, and puts the title block above and the legend below everything it keeps. Nothing in view is an error
with a hint.

**What is drawn.** Exactly the view: collapsed zones stay chips with their counts, hidden types stay counted
in their `N hidden` badges, and a day compared with another keeps its added, removed and changed markers. To
export more, open more first (Expand all, a deeper detail level) or export the whole diagram.

## 5. Exporting without a browser: `pnpm render`

From a checkout, `pnpm render` draws a view of a demo organisation exactly as the app draws it, legend and
title block included, and writes it as PNG (drawn with resvg), SVG and/or draw.io, byte for byte the same on
every run:

```sh
pnpm render --fixture M --lens networking --png out.png --svg out.svg --drawio out.drawio
pnpm render --fixture M --lens networking --theme dark --png out-dark.png
pnpm render --hash 'snapshot=demo%3AM&lens=security&focus=perimeter&focus.perimeter=data_perimeter' --png p.png
pnpm render --all --out out/render/all     # every demo × lens × theme, with an index.json
pnpm render --help
```

It takes the view as options (`--lens`, `--focus`, `--root`, `--filter`, `--detail`, `--flip`) or as the part
of an app link after `#` (`--hash`), the canvas size `auto` fits (`--viewport`, default 1280x800) and the
PNG's scale (`--scale`, up to 3, default 2). It draws the demo organisations only, never a real snapshot.
[packages/render-cli/README.md](../packages/render-cli/README.md) is its reference.

**From an instance, without the app.** A self-hosted instance draws the same files on the server: `POST
/api/render` takes the view as a hash or as fields, the theme, the format and the scale, and the data as a
scope it pulls with your token, an uploaded export or `.gcportrait.json` file, or a demo organisation, and
answers with the file under its export name, `"format": "drawio"` for a draw.io file. The code is `pnpm
render`'s, so a demo view comes out byte for byte the same from both. [api.md](api.md#post-apirender) has the
fields, limits and errors:

```sh
curl -s -H 'X-Gcportrait-Token: YOUR_ACCESS_TOKEN' -OJ \
  --json '{"source":{"kind":"scope","scope":"organizations/YOUR_ORG_ID","mode":"user","quotaProject":"YOUR_QUOTA_PROJECT"},"theme":"dark"}' \
  https://YOUR_INSTANCE/api/render
```

**Sample exports.** To see what a file looks like before you deploy, download real exports of the demo
organisations S and M in both themes from <https://gcportrait.app/exports/>, or take them from
[docs/media/exports/](media/exports/) in the repository: PNG (at 2×), SVG and draw.io files drawn by `pnpm
render`, each with the three-line title block an export from the app has and, like it, no affiliation line,
listed with the command that made it in the folder's `manifest.json`; the site opens each draw.io file in
diagrams.net too. `node scripts/exports.mjs` makes them again, and its `--check` fails an SVG that carries the
line ([website.md](website.md#sample-exports)).

## 6. Licences, trademarks and the source link

- **gcportrait is not Google's, and neither is your picture.** gcportrait is not affiliated with Google /
  Google Cloud; the app says so in its footer, and the files carry no such line. Do not present the picture as
  Google's.
- **Google's icons are Google's.** The product icons in a file are trademarks of Google, used unaltered
  under Google's icon usage terms ([packages/icons/README.md](../packages/icons/README.md)); keep them
  unaltered.
- **Fonts.** With "Embed fonts" the SVG carries the Roboto faces (a PNG is always drawn with them); a draw.io
  file names them and diagrams.net loads them from Google Fonts. Roboto is licensed under the SIL Open Font
  License 1.1 ([THIRD_PARTY.md](../THIRD_PARTY.md)).
- **The source link is in the app, not in the files.** gcportrait is licensed under the MIT License. The
  running app links its source on every page with the footer's "Source (MIT)" link (the backend's
  `SOURCE_URL`, or `VITE_SOURCE_URL` in a demo build), a courtesy the licence does not ask for. An exported
  SVG, PNG or draw.io file is a drawing of your diagram and carries no such link. If you run a modified
  version of gcportrait for other people and publish its source, you can point `SOURCE_URL` there
  ([configuration.md](configuration.md#backend-environment)).
