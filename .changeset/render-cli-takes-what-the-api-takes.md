---
'@gcportrait/render-cli': patch
'@gcportrait/graph': patch
---

`pnpm render` and `pnpm render-scene` read their view flags the same way, and check them as `POST /api/render` checks its fields, so each command refuses what the API refuses: a viewport wider or taller than 16 384 px, a `--hash` that names a timeline day, a boolean `--filter` given as `1` or `0` (use `true` or `false`), a focus parameter whose name does not start with a letter, and `--scale` or `--width` when no PNG is written. A refusal names the flag, and what was typed where that helps (`--filter showRegions takes true or false, not "1"`).
