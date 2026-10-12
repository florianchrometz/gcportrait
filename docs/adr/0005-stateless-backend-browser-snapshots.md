<!-- SPDX-License-Identifier: MIT -->

# 0005. Stateless backend; snapshots live in the browser

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** [ADR 0035](0035-decisions-inherited-from-the-implementation-plan.md) §4 and §5, [docs/packages.md](../packages.md)

## Context

An asset inventory is sensitive: it lists an organisation's projects, networks, addresses and identities.
Storing it on a server would make gcportrait a data processor for every user, require tenancy and access
control, and make self-hosting heavier.

## Decision

The backend is stateless: it streams data from Google to the browser and forgets it. Snapshots, saved views,
cached timeline ticks and preferences live in the browser's IndexedDB, and a snapshot can be saved to and
loaded from a file. Version 1 has no database and no storage bucket.

## Consequences

- The frontend's IndexedDB wrapper (`frontend/src/storage/`) has versioned stores for preferences,
  snapshots, saved views and the timeline tick cache. When IndexedDB is unavailable (some private windows),
  preferences fall back to memory for the session.
- Snapshot files carry a `schemaVersion`, and `@gcportrait/model` migrates older files (`migrateSnapshot`).
- A view is shared as a URL (the ViewSpec lives in the hash); the recipient needs the same snapshot, either
  their own pull or a snapshot file.
- What a user can hold is bounded by the browser's storage quota; the Snapshots page shows usage.
- Self-hosting is a single Cloud Run service with nothing to provision for data.

## Alternatives considered

- **A server-side store (a database or a storage bucket per installation).** Rejected for version 1 on
  privacy, tenancy and operating cost. An opt-in team workspace with storage is listed under "Later" in
  [docs/backlog.md](../backlog.md).
