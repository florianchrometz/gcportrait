---
'@gcportrait/frontend': minor
'@gcportrait/model': minor
---

Before drawing a snapshot of more than 10,000 assets, the app asks first: drawing that many at once is slow and heavy on memory, though the diagram still works. "Draw it anyway" draws it, "Cancel" leaves you where you were (nothing is generated, loaded or stored twice; a pull or a Cloud Storage read stops), and "Do not ask again in this session" keeps the question away for the rest of the browser tab. It is asked by "Try the demo" with size XL before the organisation is generated, by Load on the Snapshots page, by a link or the Snapshot menu, by an export imported on the Connect page, and by a pull or a Cloud Storage read as soon as its count passes 10,000. A view change, a timeline step or an export never asks again for the same snapshot. The threshold is `LARGE_SNAPSHOT_ASSETS` in `@gcportrait/model`.
