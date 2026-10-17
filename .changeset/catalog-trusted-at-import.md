---
'@gcportrait/frontend': patch
---

The first diagram and each render start a little sooner: the asset catalog, checked when it is built, is no longer checked again each time the app's diagram worker, a render through the API or `pnpm render` starts.
