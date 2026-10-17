---
'@gcportrait/backend': patch
---

The image carries about 1.1 MB less JavaScript, as the server and the render worker no longer bundle the translations of zod's validation messages they never use, and the render worker that every `POST /api/render` starts afresh loads faster; error messages stay as they were.
