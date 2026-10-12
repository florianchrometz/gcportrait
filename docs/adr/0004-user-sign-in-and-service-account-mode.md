<!-- SPDX-License-Identifier: MIT -->

# 0004. User sign-in by default, service-account mode for teams

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** [ADR 0028](0028-quota-project-and-sa-gate.md) (amends the gate and the scopes), [ADR 0031](0031-token-header-behind-iap.md), [ADR 0035](0035-decisions-inherited-from-the-implementation-plan.md) §2 and §4, [docs/permissions.md](../permissions.md)

## Context

Cloud Asset Inventory (CAI) data can only be read with credentials that hold `cloudasset` permissions on the
organisation, folder or project being drawn. Individuals want to try gcportrait without any setup; teams want
one shared grant instead of giving every member CAI roles. Either way the backend must not become a place
where credentials or asset data accumulate.

## Decision

- **User mode (default).** The browser obtains a Google OAuth access token (Google Identity Services token
  client, scope `cloud-platform.read-only`), keeps it in memory only and sends it as `Authorization: Bearer`.
  The backend forwards it to CAI and never stores or logs it.
- **Service-account mode (optional, per operator).** A customer grants the gcportrait backend's service
  account `roles/cloudasset.viewer` on a scope, and the backend calls CAI with its own identity. Before using
  it for a scope, the backend proves that the *caller* can `get` that scope with their own token. Without that
  gate any signed-in user could read any organisation that granted the service account.
- Both modes use the same code path from the backend's CAI call onwards.

## Consequences

- The backend restricts upstream calls to four Google API hosts, so it cannot be used as an open proxy.
- CAI calls with user credentials need a quota project; the preflight finds a usable one and explains exactly
  what is missing ([docs/permissions.md](../permissions.md)). The quota-project spike confirmed the
  `x-goog-user-project` behaviour; ADR 0028 records it.
- `GET /api/config` reports whether service-account mode is enabled and which account to grant. Sign-in and
  service-account mode were built on 2026-10-10.
- The maintainer had decided that a hosted instance would enable service-account mode from day one, which
  means publishing the service-account email and documenting the gate on the permissions page. *Note
  (2026-10-12):* no hosted sign-in instance exists ([ADR 0032](0032-hosted-surfaces-and-domains.md), ADR 0035
  §2), so this applies to no instance; an operator who self-hosts decides it for their own.

## Alternatives considered

- **User sign-in only.** Rejected: every team member would need CAI roles on every scope.
- **Service account only.** Rejected: an individual could not try gcportrait without an administrator first
  granting a third party's service account.
