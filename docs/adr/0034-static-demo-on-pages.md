<!-- SPDX-License-Identifier: MIT -->

# 0034. The maintainer's demo is a static build of the app on the website's GitHub Pages site, at `/demo/`

- **Status:** accepted (2026-10-12): the maintainer's own decision of 2026-10-11, built and checked
  (`pnpm website:check`'s demo check, the demo e2e)
- **Date:** 2026-10-11 (accepted 2026-10-12)
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** ADRs [0009](0009-astro-website-on-github-pages.md), [0014](0014-demo-mode-first-class.md),
  [0032](0032-hosted-surfaces-and-domains.md), [0035](0035-decisions-inherited-from-the-implementation-plan.md)
  §2; supersedes the demo's host in [ADR 0032](0032-hosted-surfaces-and-domains.md)
  (decision 2) and the Firebase Hosting fallback of [ADR 0009](0009-astro-website-on-github-pages.md);
  [docs/website.md](../website.md), "The demo"

## Context

ADR 0032 put the maintainer's sign-in-free demo on Cloud Run at `demo.gcportrait.app`: the container image with
`DEMO_ONLY=true`. In that mode the backend serves the app, `/api/config` and the legal texts and calls nothing at
Google; everything the demo does happens in the visitor's browser (the synthetic organisations are generated there and
kept in IndexedDB). The maintainer decided on 2026-10-11 that everything is hosted on GitHub: the website and the demo
share one GitHub Pages site, images stay on ghcr.io, releases and CI on GitHub Actions. GitHub Pages serves files only:
no server code, no rewrites, no response headers of the site's own, and its own `/404.html` for every missing file
(a `404.html` in a folder is never used).

## Decision

1. **The demo is a static build of the app** (`pnpm demo:static`, scripts/static-demo.mjs), served by the website's
   Pages site below `/demo/`; `demo.gcportrait.app` is dropped. The build is the frontend's with `VITE_STATIC_DEMO=1`:
   Vite's base `/demo/`, content-hashed assets, the theme bootstrap kept, the brand icon as favicon, the licence files.
2. **Its configuration is built in**, not fetched (frontend/src/api/staticConfig.ts): exactly what a demo-only
   instance's `/api/config` answers (no OAuth client, no service-account mode, no render API, `demoOnly: true`), plus
   the version (`git describe`, or the release tag), the source link and the Impressum and privacy notice the footer
   links (`--impressum-url`, `--privacy-url`; the maintainer's pages by default). The app then behaves exactly as on a
   demo-only instance. The static bundle contains no sign-in code: the build sees `VITE_STATIC_DEMO` as a constant, so
   Google's sign-in script, tokeninfo and `/api/config` are not in it.
3. **Routes by copies of index.html.** The app routes by path and the URL hash is the diagram's view, so hash routing
   is not an option. The build writes `index.html` and a byte-for-byte copy per route (`diagram.html`,
   `snapshots.html`, `permissions.html`, `settings.html`, `impressum.html`, `privacy.html`); GitHub Pages serves
   `/demo/diagram` from `demo/diagram.html` without a redirect, so a reload or a shared link on any route boots the app
   there, hash included. An unknown address below `/demo/` gets the website's 404 page, which links to the demo. The
   router's basename is the build's base. `/demo/impressum` and `/demo/privacy` link to the external pages.
4. **The policy travels in the page.** `<meta http-equiv="Content-Security-Policy">` right after `<meta charset>`:
   the backend's demo-only policy (`cspDirectives(hashes, { google: false })`) without `frame-ancestors`, which a
   `<meta>` cannot carry, with the inline bootstrap's SHA-256 hash; and `<meta name="referrer" content="no-referrer">`
   for the backend's referrer policy.
5. **The website build places the bundle at `website/dist/demo/`**: its Astro build runs the root command itself, or
   copies a bundle built before (`WEBSITE_DEMO_DIST`, which the Pages and release workflows use after building the demo
   as a step of its own). Every "Try the demo" link of the site points at `/demo/`; the sitemap lists `/demo/` only.
6. **Demo-only mode stays a feature of the image**, for self-hosters (`infra/deploy.sh --demo-only`); the maintainer's
   Cloud Run demo service is removed. Firebase Hosting, ADR 0009's fallback, is dropped with its job and files.

## Consequences

- The demo costs nothing and has no server, no secret, no Google Cloud project and no DNS record of its own: the
  website's records cover it (the apex, `www` and the Pages verification TXT).
- Weaker than the image's headers, because a static host sets none: no `frame-ancestors` or X-Frame-Options (another
  site may frame the demo; it has no sign-in and no action of consequence), no Cross-Origin-Opener- or -Embedder-Policy
  (the page is not cross-origin isolated; it needs nothing that requires it), no Permissions-Policy (the app uses no
  device feature), no Cross-Origin-Resource-Policy, and nosniff only as far as GitHub Pages sends it. HTTPS is enforced
  by Pages, and `.app` is on the browsers' HSTS preload list. The workers run without a policy of their own (a
  `<meta>` policy does not reach them); they load only the bundle's own files.
- The demo is a build of one version, deployed with the website: `main` on every deploy of the site, the tag on a
  release. A change to the app reaches the demo with the next website deploy.
- `'self'` is the whole site, so the demo's policy also allows the website's own files; the site's own check refuses
  anything from another host on either.
- Enforced by `scripts/static-demo.test.ts` (the policy is the backend's minus `frame-ancestors`, the route copies are
  App.tsx's routes, the footer's legal links are the website's), the bundle check after every build
  (`staticDemoProblems`, scripts/lib/static-demo.mjs), `pnpm website:check` (`checkDemo`: the pages, the policy, no
  sign-in host anywhere, the favicon, the footer's links in the script, the licences; every "Try the demo" link at
  `/demo/`), `frontend/src/pages/ConnectPage.staticDemo.test.tsx` and `pnpm --filter @gcportrait/website demo` (the
  built site served as Pages serves it, in Chromium: S, M and L, drill-in, timeline, export, a reload on a deep link,
  every route, axe in both themes, no request elsewhere, no policy violation).

## Alternatives considered

- **Keep the demo on Cloud Run** (ADR 0032): full response headers, but a service, a project, a domain mapping in
  Preview and a CNAME to look after, for an app that needs no server. Lost to the decision to host everything on GitHub.
- **Hash routing in the static build**: the URL hash already holds the diagram's view (shareable links), so the route
  cannot live there too without changing every link the app writes.
- **One `404.html` that boots the app for every unknown address** (the usual single-page-app trick on Pages): GitHub
  Pages uses only the site's top-level `404.html`, which is the website's, and it answers with status 404, so the demo's
  routes would be served as errors. Copies of index.html answer 200 and need no script.
- **Fetching a `config.json` next to the bundle**: one request more and a file to keep in step, for values that are
  fixed at build time anyway.
