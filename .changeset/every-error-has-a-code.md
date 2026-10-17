---
'@gcportrait/backend': patch
---

Every error answer of the API now carries a `code` a script can test, not only those of `POST /api/render`: `INVALID_REQUEST`, `UNAUTHENTICATED`, `RATE_LIMITED`, `STREAMS_BUSY` (now also marked `retryable`), `SA_MODE_OFF`, `SA_MODE_UNAVAILABLE`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT` and `UPSTREAM_ERROR` for the scope search, `ROUTE_NOT_FOUND` for a path the instance does not serve, `INTERNAL` for a server error, and the service-account gate's codes as before. Every status and header stays as it was.
