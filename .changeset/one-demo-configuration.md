---
'@gcportrait/frontend': patch
---

`pnpm dev:demo` now serves the same demo build the static demo is: a demo-only instance with its configuration built in, so its Connect page offers the way to deploy gcportrait to your own project and says that the demo processes no personal data, and its Permissions page says that nothing can be checked here. `VITE_DEMO` and `VITE_STATIC_DEMO` still exclude each other.
