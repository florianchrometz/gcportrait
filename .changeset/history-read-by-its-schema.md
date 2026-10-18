---
'@gcportrait/frontend': patch
---

A snapshot file whose history is damaged is refused with the place of the problem, such as
`ticks.3.mutations.0.asset.name`, because the history is now read through the model's `DemoHistorySchema` rather
than hand-written checks; every history the app accepted before is still accepted.
