---
'@gcportrait/model': patch
'@gcportrait/graph': patch
'@gcportrait/render-cli': patch
---

Require explicit values for list filters in `pnpm render` and `pnpm render-scene`, so a missing value reports
a usage error instead of silently filtering to an unintended region or project. Boolean filters keep their
key-only shorthand.
