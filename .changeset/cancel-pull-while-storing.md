---
'@gcportrait/frontend': patch
---

Cancelling "Pull now" or "Read from Cloud Storage" while the snapshot is being stored in the browser now stores nothing and says "Cancelled. Nothing was stored.", instead of keeping the snapshot. Leaving the page at that moment cancels it the same way, so no snapshot is stored after you have gone.
