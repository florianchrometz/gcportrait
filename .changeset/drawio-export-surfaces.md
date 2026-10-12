---
'@gcportrait/frontend': minor
'@gcportrait/render': minor
'@gcportrait/render-cli': minor
'@gcportrait/backend': minor
'@gcportrait/website': minor
---

The Export menu offers "Download draw.io (.drawio)" next to SVG and PNG, in the area and theme chosen for the other files: a file diagrams.net and draw.io open as an editable diagram that looks like the picture, translated by a module the app loads on first use, with the instance's version in its `agent`. The diagram's markers name zones, nodes and the lines' ends by short indices, so they add 4 to 7 % to an SVG export. A draw.io file's page id depends on the theme and the view drawn as well as the name and the read time, so files of several views, themes or days keep different page ids; the app writes the render library's bytes for the same view (demo S light is byte for byte the render golden). The website's sample exports include each view as a `.drawio` file, with "Open in diagrams.net", and its check verifies those files and links. An end-to-end check draws the downloaded file with mxGraph and holds it to the SVG export on demos S, M and L in both themes.
