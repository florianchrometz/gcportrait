---
'@gcportrait/frontend': minor
'@gcportrait/render': minor
'@gcportrait/render-cli': minor
'@gcportrait/backend': minor
'@gcportrait/model': minor
---

A view can now be drawn as a draw.io file, through the render API, `pnpm render` and the render library, that diagrams.net opens as an editable diagram that looks like the PNG and the SVG: the same drawing translated into draw.io's cells, with zones as nested containers, resources as groups of their body, icon and labels, lines connected to their resources with the drawing's bends, heads and dashes, the title block and the legend, in three layers, and the drawing's own colours in diagrams.net's light and dark interface. `POST /api/render` takes `"format": "drawio"` (with `"compressed": false` for plain XML and `"fontSource": false` to leave out the Google Fonts stylesheet), `pnpm render` takes `--drawio FILE` and `--drawio-plain` (and `drawio` in `--formats`), and the render library has `drawDrawio`. The diagram's groups and lines now carry markers in the SVG export and on the canvas: `data-kind` with a short index (`data-n`, `data-parent`) on zones and nodes, and the indices of a line's two ends (`data-ends`) on its path.
