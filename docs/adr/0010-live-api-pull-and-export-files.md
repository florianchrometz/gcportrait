<!-- SPDX-License-Identifier: MIT -->

# 0010. Two import paths: live API pull and CAI export files

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** skill `cai-ingestion`, [ADR 0008](0008-timeline-daily-ticks.md), [docs/modes.md](../modes.md)

## Context

Cloud Asset Inventory offers the same information two ways. `assets.list` is synchronous and supports a past
`readTime`, but very large inventories can run into list quotas. `exportAssets` writes newline-delimited JSON
to Cloud Storage; it suits large organisations and teams that already export, but it is a long-running
operation with its own constraints (one export per destination at a time, no `readTime` in the file itself).

## Decision

gcportrait supports both: a live pull through the backend (`assets.list`, paginated and streamed) and export
files, either dropped into the browser or read from a `gs://` URI with the user's token. Both are normalised
into the same Snapshot model.

## Consequences

- `packages/ingest` has one streaming NDJSON parser and normaliser for every source; everything
  after ingestion (graph, layout, renderer) does not know where a Snapshot came from, except through its
  `source` field (`api`, `export` or `demo`).
- The backend has `POST /api/assets/stream` and `POST /api/export/read` ([docs/api.md](../api.md)).
- An export carries no `readTime`; it is taken from an optional `operation.json` sidecar, set by the user, or
  defaulted to the newest `updateTime`, and the UI says which.
- Export snapshots appear as extra ticks on the timeline (ADR 0008).

## Alternatives considered

- **Live pull only.** Rejected: on very large inventories the list API can hit quota, and the export path is
  the fallback.
