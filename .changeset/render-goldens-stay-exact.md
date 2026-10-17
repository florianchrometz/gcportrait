---
'@gcportrait/render-cli': patch
---

Make render golden checks unconditionally tolerance-free. General PNG comparisons and the CLI's
`--compare` and `--max-diff` options keep their existing behavior.
