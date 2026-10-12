<!-- SPDX-License-Identifier: MIT -->

# 0009. Website: Astro static site on GitHub Pages

- **Status:** accepted; its Firebase Hosting fallback superseded by [ADR 0034](0034-static-demo-on-pages.md)
  (2026-10-11)
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** [ADR 0032](0032-hosted-surfaces-and-domains.md), [ADR 0034](0034-static-demo-on-pages.md), [ADR 0035](0035-decisions-inherited-from-the-implementation-plan.md) §2, [docs/website.md](../website.md)

## Context

gcportrait needs a public website: a landing page, user documentation, a coverage page generated from the
asset catalog, a changelog, and screenshots that never go stale. It should cost nothing to run and be built in
CI.

## Decision

The website is an Astro static site in `website/`, deployed to GitHub Pages under the maintainer's custom
domain (a `CNAME` file and enforced HTTPS). If Pages cannot serve the domain, Firebase Hosting is the
fallback.

## Consequences

- Screenshots, animated demos and link-preview images are generated from demo mode by Playwright, in light and
  dark, with `pnpm media` (`scripts/media.mjs`); they are committed under `docs/media/`, and CI checks
  them for staleness (`pnpm media --check`).
- The coverage page is generated from the compiled `catalog.json`.
- `website/public/CNAME` holds only the domain; the provenance checker treats `CNAME` as header-free.
- `release.yml` and `pages.yml` contain the website build and deploy jobs, switched on by the repository
  variable `PAGES_DEPLOY` ([docs/website.md](../website.md)). A `firebase.json` and its disabled deploy job were
  kept for the fallback until ADR 0034 dropped both.
- The domain, `gcportrait.app`, is the maintainer's choice of 2026-10-10.

## Alternatives considered

- **Firebase Hosting.** Kept as the fallback, not the default, because GitHub Pages is free and deploys from
  the same CI; dropped altogether by ADR 0034.
