---
'@gcportrait/frontend': patch
---

When another tab of the same browser reads a timeline day of the scope you have open, or deletes one on the Snapshots page, the timeline bar now marks that day ready (or not read) at once, and playback goes through it, instead of waiting until you move next to it. The tabs tell each other only which day of which scope changed, never its assets.
