<!-- SPDX-License-Identifier: MIT -->

# 0008. Timeline of daily ticks over 35 days, fetched lazily

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** skill `cai-ingestion` §5, [ADR 0010](0010-live-api-pull-and-export-files.md), [docs/timeline.md](../timeline.md)

## Context

Cloud Asset Inventory can list resources as they were at a past `readTime`, up to 35 days back. Users want to
see what an environment looked like on a given day and what was added, removed or changed since.

## Decision

The timeline has one tick per day for the last 35 days. Each tick is one set of `assets.list` calls with that
tick's `readTime`, fetched only when the user stops on it, and cached in the browser.

## Consequences

- Ticks are today and the 34 previous days at 00:00 UTC; the latest tick uses "now" so it is never in the
  future.
- Fetched ticks are cached per `(scope, readTime)` in IndexedDB (the `tickCache` store); the
  two neighbouring ticks are prefetched at idle, with at most two fetches in flight.
- The diff between two ticks (added, removed, changed by `updateTime`) is a pure function in `packages/graph`,
  with no API calls.
- Snapshots from export files and manual pulls appear as extra, labelled ticks.
- For very large organisations, 35 ticks can hit the CAI list quota; mitigations are lazy fetching, caching,
  optional restriction of asset types to the active lens, and the export path.
- Delivered on 2026-10-10 ([docs/timeline.md](../timeline.md)).

## Alternatives considered

- **`batchGetAssetsHistory`.** Rejected for the timeline: it takes at most 100 asset names per call. It
  remains a candidate for a per-asset history tab later.
- **Prefetching all 35 ticks.** Rejected: it multiplies API calls and quota use for days the user may never
  look at.
