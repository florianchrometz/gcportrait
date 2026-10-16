---
'@gcportrait/frontend': patch
---

"Expand all" and "Collapse all" stay unavailable when pressing them would leave the diagram as it is. A zone with nothing inside under the current lens or filters (a project the networking lens shows without a network, for example) is never collapsed into a chip, so a zone you opened or closed by hand before switching lens no longer makes "Expand all" look available while it would change nothing on screen. On a timeline day, a zone that holds only the ghosts of removed resources counts as empty in the same way.
