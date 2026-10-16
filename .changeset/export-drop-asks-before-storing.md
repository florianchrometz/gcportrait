---
'@gcportrait/frontend': patch
---

Export files dropped on the Connect page that hold more than 10,000 assets are now asked about once they are read and before anything is stored. "Cancel" stores nothing and leaves you on the Connect page, so dropping the same files again asks again instead of leaving a second copy behind; "Draw it anyway" stores the snapshot once and opens the diagram without asking a second time. When the files hold several snapshots, the question is about the one the import opens, the last; "Do not ask again in this session" still skips it.
