<!-- SPDX-License-Identifier: MIT -->

# 0035. Decisions inherited from the implementation plan

- **Status:** accepted
- **Date:** 2026-10-12
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** ADRs [0001](0001-no-go-and-no-reuse-of-previous-code.md) to
  [0018](0018-non-affiliation-statement.md), [0028](0028-quota-project-and-sa-gate.md),
  [0029](0029-bundle-budgets.md), [0032](0032-hosted-surfaces-and-domains.md),
  [0034](0034-static-demo-on-pages.md); [agents.md](../../agents.md); the skills in `.agents/skills/`

## Context

gcportrait was built from an implementation plan written in October 2026. ADRs 0001 to 0018 record its founding
decisions. This record keeps the rest of the decisions that still bind (the product's scope, the hosted surfaces
and how releases are distributed, the lessons from the previous implementation, the security and privacy
principles, the frontend architecture, and the rules for maintainability and versioning), so that the plan
document itself could be retired. Where `agents.md`, a skill or a guide holds the operative rule, this record names it; a change to
any of these decisions is a new ADR that supersedes or amends this one.

## Decision

### 1. Product scope and non-goals

gcportrait answers "what does this environment look like *right now*, and what changed in the last five
weeks?". It is not a planning or drawing tool: nothing can be dragged, added or edited. Every box on the screen
is a real asset returned by Cloud Asset Inventory, and every arrow is a reference that exists in that asset's
JSON.

Its users:

- the **explorer**, a cloud engineer or architect who opens an organisation, a folder or a project to understand
  or document it;
- the **reviewer**, a security or compliance person who checks exposure (public addresses, peerings, perimeters,
  Shared VPC);
- the **contributor**, who adds an asset type or a view or fixes the layout, and must be able to test without
  access to Google Cloud (demo mode, [ADR 0014](0014-demo-mode-first-class.md)).

Version 1 connects (sign-in, a scope, the missing permissions with the exact `gcloud` commands, user or
service-account mode), imports (a live pull or export files, both into one Snapshot), renders, explores (lenses,
focus views, filters, drill-in, search, the selection trace, the details drawer with a Cloud Console link), moves
through 35 days of history, exports PNG and SVG, follows the system theme in light and dark, ships a demo, and can
be self-hosted with one script and a published image.

**Not planned (non-goals of version 1):** editing diagrams, cost data, IAM policy analysis beyond showing
identities, multi-cloud, mobile layouts ([ADR 0011](0011-desktop-only.md)), server-side storage of snapshots
([ADR 0005](0005-stateless-backend-browser-snapshots.md)) and real-time feeds.

### 2. Hosted surfaces and distribution

Decided by the maintainer on 2026-10-10 and revised on 2026-10-11; [ADR 0032](0032-hosted-surfaces-and-domains.md)
and [ADR 0034](0034-static-demo-on-pages.md) hold the details this section does not.

1. **Two maintainer-hosted surfaces, both on GitHub Pages.** The website `gcportrait.app` explains the project
   and its capabilities, is built to be found (metadata, sitemap, structured data), and presents the maintainer,
   Florian Chrometz, with an author section, links and Person structured data (`docs/author.md`,
   [docs/website.md](../website.md)). The static demo at `gcportrait.app/demo/` lets anyone try gcportrait
   without signing in, on the four synthetic demo organisations (ADR 0034).
2. **No hosted sign-in instance**, hence no OAuth app verification and no terms of use: there are no accounts and
   no service. Self-hosters who enable sign-in run their own instance with their own OAuth client (an internal
   audience needs no verification).
3. **Legal pages** are the Impressum and the privacy notice on the maintainer's website only; the website and the
   demo link them (ADR 0032, amendment of 2026-10-11).
4. **Images on GitHub Container Registry:** `ghcr.io/florianchrometz/gcportrait`, for linux/amd64 and
   linux/arm64, one per release tag (`X.Y.Z`, `X.Y`, `latest`), pushed by `release.yml` with the workflow's own
   `GITHUB_TOKEN`. No Workload Identity Federation and no registry of the maintainer's on Google Cloud.
5. **`infra/deploy.sh` pulls a release through an Artifact Registry remote repository** in the self-hoster's
   project by default, or builds the checkout from source with `--build` ([ADR 0030](0030-own-cloud-build-service-account.md)).
   Cloud Run can run a public ghcr.io image directly (the first design assumed it could not), but Google
   recommends a remote repository for availability: Artifact Registry keeps the image, so a redeploy or a new
   instance does not depend on ghcr.io ([docs/self-host.md](../self-host.md), "What deploy.sh does"). The remote
   repository stays the default.
6. **"Open in Cloud Shell" and "Run on Google Cloud"** (`docs/cloudshell-tutorial.md`, `app.json` with
   `infra/cloud-run-button.sh`) sit next to the manual steps in the README and the self-hosting guide.

Rationale: promote the tool and its maintainer, and keep the risk at zero. The project has no revenue, so the
maintainer runs nothing that holds accounts, tokens or anyone's data. The project never describes the maintainer
by any programme membership ([ADR 0018](0018-non-affiliation-statement.md)).

### 3. Lessons from the previous implementation, as constraints

1. **Typed end to end.** Graph, layout and render never pass through a lossy text format (such as DOT) that is
   parsed back.
2. **One source of truth per concept.** Lens type lists, product names, icon mappings and domain and address
   extraction come from the catalog, never from a second map in code (agents.md hard rule 4,
   [ADR 0015](0015-maintainability-catalog-as-data.md)).
3. **Unknown asset types still render**: a generic card, the product or category icon, containment from
   `parent` (agents.md hard rule 5; gcp-diagram-layout skill §2, rule 6). The catalog adds precision; its absence
   never drops an asset.
4. **Filters compose with focus views and drill-in**: a filter applies in every focus view and under every
   drill-in, never only in the overview (agents.md hard rule 14; the graph package's view tests).
5. **The render payload is proportional to the view**, not to the organisation: the browser holds the Snapshot
   and computes each view locally.
6. **Nothing is serialised through a global lock**: the layout is pure and runs in a worker per request
   (agents.md hard rule 9).
7. **Docs live next to the code, and what can be generated is generated** (§6; agents.md hard rule 15).

### 4. Security and privacy principles

Numbered so that [docs/threat-model.md](../threat-model.md) and [docs/security.md](../security.md) can cite
them as "ADR 0035, principle N".

1. Asset data never leaves the person's browser except to be fetched: the backend streams it and forgets it
   ([ADR 0005](0005-stateless-backend-browser-snapshots.md)).
2. Tokens are never stored, never logged and never put in URLs (agents.md hard rule 10;
   [ADR 0031](0031-token-header-behind-iap.md)).
3. The backend is not an open proxy: an upstream host allowlist, schema-validated request bodies and rate limits
   (the `cai-ingestion` skill §4, `docs/security.md`).
4. Service-account mode is gated by the caller's own access to the scope ([ADR 0004](0004-user-sign-in-and-service-account-mode.md),
   [ADR 0028](0028-quota-project-and-sa-gate.md) §4).
5. Exports (PNG, SVG, snapshot files) are downloads the person starts; gcportrait uploads nothing anywhere on its
   own. The render API draws what its caller sends and keeps nothing ([ADR 0033](0033-render-api.md)).
6. The demo data is synthetic; the test suite fails when a fixture holds anything that looks like a real project
   number or an email domain outside `example.com` and `example.org` (ADR 0014, agents.md hard rule 6).
7. Dependencies pass a licence allowlist and deny list (`pnpm run licenses`; ADRs
   [0017](0017-licence-chosen-by-maintainer.md) and [0019](0019-font-licence-exception.md)), the dependency
   audit (`node scripts/check-audit.mjs`) and Dependabot.

### 5. Frontend architecture

- React 19, Vite and strict TypeScript; CSS modules with Material-3-style design tokens (colour roles, type
  scale, elevation; gcp-diagram-style skill §9); the app's own small, headless, accessible primitives for menus,
  dialogs and sliders, and no component library.
- The URL hash holds everything that defines a view, so every view is a link (`@gcportrait/model`'s view codec).
  IndexedDB, through a small wrapper, holds snapshots, saved views, the timeline's day cache and preferences. The
  token lives in memory only.
- Ingest, the graph build and the layout run in workers; the UI thread only renders
  ([ADR 0029](0029-bundle-budgets.md) budgets both sides).
- The diagram is SVG drawn by React. Zoom and pan use d3-zoom (`scaleExtent [0.05, 200]`); double-click is
  reserved for drill-in; the level of detail follows the effective scale; a highlight change mutates attributes
  only and never lays out again (gcp-diagram-layout skill §9).
- Search is Fuse.js over the Graph's node index. Export serialises the live SVG with the theme's variables
  resolved to attributes, the icons, the legend and the title block inline; PNG goes through a canvas at 2× or
  3×; PNG can be copied to the clipboard (gcp-diagram-style skill §8).

### 6. Maintainability and versioning

- **An ADR for every decision**, and a decision changes only through a new or amended ADR
  ([README](README.md), "Writing an ADR").
- **Generated artefacts are built by a command, never edited by hand, and checked for staleness**: the compiled
  catalog, the layout's metrics table, the icon module, the screenshots, animated demos and sample exports under
  `docs/media/`, the guides' lens tables and `THIRD_PARTY.md`'s dependency table (agents.md hard rule 15).
- **Semantic versioning through changesets**, with one fixed version for every workspace package
  (`.changeset/config.json`, `fixed`); the release notes come from the changesets.
- The asset catalog carries its own `version` and `officialListDate`. The snapshot file format carries a
  `schemaVersion`, and `@gcportrait/model` migrates older files (`migrateSnapshot`).
- Data over code, a public `src/index.ts` per package, pure cores and no `any` stay as agents.md's hard rules 3,
  4 and 9 and its "Layout" section say; what each test layer covers is in the contributor-workflow skill §4.

## Consequences

- The ADRs, `agents.md`, the skills, the guides and [docs/backlog.md](../backlog.md) (the open work, the
  "Later" list included) hold everything a contributor needs.
- Enforced by: agents.md hard rules 4, 5, 6, 9, 10, 14 and 15; `pnpm check` (the catalog check, the provenance
  and licence checks, the user-docs check, the staleness tests); `pnpm size` (ADR 0029); `pnpm media --check`;
  the graph's view tests (filters under focus views and drill-in); the threat model's citations of §4.
- A change to the product's scope (§1), the hosted surfaces (§2) or a principle (§4) needs a new ADR.
- One design (2026-10-12): the maintainer kept the default design of the website and of the app's chrome (§5); the
  design variants built to compare it with were deleted, and nothing of their styling carries over.
