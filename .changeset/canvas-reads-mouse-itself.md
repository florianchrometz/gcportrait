---
'@gcportrait/frontend': patch
---

The app loads about 15 kB (gzipped) less JavaScript before it first draws, as the diagram now pans and zooms with its own code, and a mouse or pen click whose pointer wobbled a few pixels no longer nudges the drawing: it only selects.
