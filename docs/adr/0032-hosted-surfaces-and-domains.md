<!-- SPDX-License-Identifier: MIT -->

# 0032. Hosted surfaces: a demo-only Cloud Run service with a domain mapping in europe-west1, legal texts from the environment

- **Status:** accepted (2026-10-12) for decisions 1, 3 and 4 and both amendments of 2026-10-11, on the
  maintainer's behalf by the build orchestrator, who decided on 2026-10-11 to accept ADRs 0030 to 0032; decision
  2 is superseded by [ADR 0034](0034-static-demo-on-pages.md) for the maintainer's demo (`--domain` stays for
  self-hosters). The maintainer may reopen it.
- **Date:** 2026-10-10 (amended 2026-10-11, accepted 2026-10-12)
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** ADRs [0009](0009-astro-website-on-github-pages.md), [0014](0014-demo-mode-first-class.md),
  [0018](0018-non-affiliation-statement.md), [0034](0034-static-demo-on-pages.md),
  [0035](0035-decisions-inherited-from-the-implementation-plan.md) §2; [docs/self-host.md](../self-host.md),
  "Demo-only instance", "Custom domain", "Legal pages: link or serve"

## Context

The maintainer's decision of 2026-10-10 on hosted surfaces (ADR 0035 §2) leaves two hosted surfaces and no
hosted sign-in app: the website at `gcportrait.app` (ADR 0009: Astro on GitHub Pages) and a sign-in-free demo at
`demo.gcportrait.app`, the container image in a demo-only mode, so people can try gcportrait before deploying it to
their own Google Cloud. Both need an Impressum and a minimal privacy notice, whose texts name a person and an
address and so must not live in the repository. The project has no revenue: every recurring cost is the
maintainer's. The maintainer's project `gcportrait` runs its services in `europe-west3` (Frankfurt), where Cloud
Run offers no domain mappings. Its sign-in instance `gcportrait` there is a private verification instance of
the maintainer's, not a hosted surface, and is never advertised.

## Decision

1. **Demo-only mode is a backend setting**, `DEMO_ONLY=true` (exactly `true` or `false`; anything else stops
   start-up). `/api/config` then reports `demoOnly: true`, no OAuth client, no service-account mode and no
   account; the backend refuses `OAUTH_CLIENT_ID` and `SA_MODE_ENABLED=true` next to it; the four routes that call
   Google (`/api/scopes/search`, `/api/preflight`, `/api/assets/stream`, `/api/export/read`) are not registered, so
   they answer the JSON 404 of any unknown route; the rate limits, the health checks, `/api/config`, `/api/legal`
   and the SPA stay; the Content Security Policy drops Google's script and API hosts. The SPA reads `demoOnly`
   and shows a Connect page with only "Try the demo" (S to XL), a link "Deploy gcportrait to your own Google Cloud
   project" to the website's self-hosting guide (`https://gcportrait.app/docs/self-host/`), and
   a notice that the demo processes no personal data. `infra/deploy.sh --demo-only` deploys it: service name
   `gcportrait-demo` by default, its own runtime account with no role (never the Compute Engine default account),
   only the `run`, `iam` and `artifactregistry` APIs, 256 MiB, 60 s requests, at most 2 instances, public.
2. **The demo's custom domain is a Cloud Run domain mapping, and the demo runs in `europe-west1`** (Belgium, one
   of the ten regions Google lists for domain mappings on 2026-10-10). `infra/deploy.sh --domain HOST` creates the
   mapping through the Cloud Run Admin API (no `gcloud beta` component needed), refuses a region without domain
   mappings before changing anything, explains Search Console verification when the account has not verified the
   domain, prints the DNS records Google asks for in zone-file form, checks them in public DNS (Google Public DNS
   over HTTPS) and waits for the certificate at most ten times 30 s. A mapping belongs to the instance by the
   service it routes to: deploy.sh stops at a mapping of the host to another service, and `infra/uninstall.sh`
   deletes the mappings that route to the service it deletes.
3. **Legal texts come from configuration, never from the repository.** The backend reads `LEGAL_DIR`
   (`impressum.md` and/or `privacy.md`) or `LEGAL_BUNDLE` (the same texts as one JSON object of base64 strings),
   checks them (UTF-8, at most 64 KiB, no control characters, not blank) and serves them at `/api/legal`; the SPA
   renders them at `/impressum` and `/privacy` with a Markdown reader that never produces HTML, and links them in
   the footer only when they exist. `deploy.sh --legal-dir PATH` builds `LEGAL_BUNDLE` from a local directory
   (at most 11 KiB per text, so both fit into one 32 KiB environment variable) and sets it on the service.
4. **The maintainer's private sign-in instance is not a hosted surface.** `gcportrait` in `europe-west3` stays
   unadvertised and is removed with `infra/uninstall.sh --project gcportrait --region europe-west3 --service
   gcportrait` once the self-hosting guide has been verified with it ([docs/backlog.md](../backlog.md), "Before
   the first release").

**Amended 2026-10-11 (maintainer decision): the legal pages are external links; the templates are removed.** The
maintainer runs no service and keeps the legal texts on their own website, so neither hosted surface carries texts of
its own. The website's footer links <https://florian-chrometz.de/legal/impressum> and
<https://florian-chrometz.de/legal/privacy-policy> on every page (`website/src/site.ts`; `pnpm website:check` requires both
links and refuses an `/impressum/` or `/privacy/` page of the site's own); the site no longer builds legal pages, so
the `WEBSITE_LEGAL_DIR` handling and the `WEBSITE_LEGAL_BUNDLE` secret of the Pages and release workflows are gone. The
backend gains `LEGAL_IMPRESSUM_URL` and `LEGAL_PRIVACY_URL` (https URLs, `infra/deploy.sh --impressum-url` and
`--privacy-url`), reported in `/api/config` as `legal.impressumUrl` and `legal.privacyUrl` next to the unchanged
booleans, for the app's footer to link (the app's side followed the same day); the demo is deployed with the maintainer's
two addresses. A page is linked or served, never both: the backend refuses to start, and deploy.sh to deploy, with a
link and a text for the same page. Decision 3 stays for self-hosters who serve their own texts (`LEGAL_DIR`,
`LEGAL_BUNDLE`, `--legal-dir`, `/api/legal`). The drafts of the Impressum and the privacy notice that were kept in
`docs/legal/` are removed; `docs/legal/data-processing-inventory.md` stays as the fact sheet the maintainer's
privacy notice is checked against, and `docs/legal/README.md` lists what that notice covers. An Impressum is still
needed for the website and the demo, and a privacy notice because GitHub Pages and Cloud Run log visitors' IP
addresses; there are no terms of use (no accounts, no service).

**Amended 2026-10-11 (maintainer decision): the maintainer's demo is a static build on GitHub Pages; decision 2 is
superseded for it by [ADR 0034](0034-static-demo-on-pages.md).** Everything the maintainer hosts is on GitHub: the
website and a static build of the app in demo-only mode share one GitHub Pages site, the demo at
<https://gcportrait.app/demo/>, with its configuration built in and the backend's demo-only Content Security Policy
as a `<meta>` (ADR 0034). `demo.gcportrait.app`, its domain mapping, its CNAME and the Cloud Run service `gcportrait-demo`
in `europe-west1` are dropped. Decision 1 (demo-only mode, `DEMO_ONLY`, `infra/deploy.sh --demo-only`) stays as a
feature for self-hosters who want a sign-in-free instance of their own, and decision 2's `--domain` stays for them
(any instance, demo-only or not). The static demo's footer links the same two legal pages as the website.

## Consequences

- (Until the amendment of 2026-10-11, for the maintainer's demo; now for a self-hoster's demo-only instance.)
  Hosting the demo costs Cloud Run's request-based billing only (zero instances while nobody uses it; the free
  tier covers a promotional demo's traffic) plus the build artefacts `deploy.sh --build` keeps (five images, 14
  days of build logs). No load balancer, no Firebase project, no secret.
- The demo's address works only after two DNS records the maintainer creates: the Search Console verification
  TXT record of `gcportrait.app` (its token comes from `gcloud domains verify gcportrait.app`) and the record the
  mapping asks for, for a subdomain a CNAME `demo.gcportrait.app.` to `ghs.googlehosted.com.` (deploy.sh prints
  the exact record Google returns). Google provisions the certificate about 15 minutes after the record is
  public, up to 24 hours.
- Domain mappings are in Preview: Google calls them "not production-ready" and "not recommended for production
  services" because of latency. Acceptable for a free demo; a self-hoster who needs a production domain in any
  region puts a global external Application Load Balancer in front (documented in docs/self-host.md, not
  automated).
- The legal texts are visible to anyone who can read the service's configuration in the project, which is fine:
  they are published on the page anyway. A redeploy without `--legal-dir` removes them (deploy.sh is
  declarative), and one without `--impressum-url` or `--privacy-url` removes those links (amendment of 2026-10-11).
- Enforced by `backend/src/demo-only.test.ts` (route matrix, configuration, CSP, rate limit),
  `backend/src/legal.test.ts`, `frontend/src/legal/*.test.ts*`, `frontend/src/pages/ConnectPage.demoOnly.test.tsx`,
  `e2e/tests/demo-only.spec.ts` (the real backend in demo-only mode, axe in both themes) and the stand-in runs of
  `scripts/infra.test.ts` (`pnpm test:infra`).

## Alternatives considered

Figures read on 2026-10-10 from Google's pricing and documentation pages; check them before relying on them.

- **(a) A global external Application Load Balancer with a serverless NEG and a Google-managed certificate**, in
  front of the service in `europe-west3`. Production-grade and works in every region, but its forwarding rule
  alone costs $0.025 per hour (the first five rules), about $18.25 a month or $219 a year with no traffic at all,
  plus a per-GB data-processing charge, and it needs a reserved global address, a URL map, a target proxy, a
  backend service and a certificate resource that deploy.sh and uninstall.sh would have to create and remove.
  Lost on cost for a project without revenue.
- **(b) Firebase Hosting with a rewrite to the Cloud Run service.** Free at this traffic (10 GB of storage and
  360 MB a day of transfer at no cost, then $0.026 per GB stored and $0.15 per GB transferred; custom domain and
  certificate included) and supported in `europe-west1`. But it turns the Google Cloud project into a Firebase
  project, which cannot be undone short of deleting the project, so uninstall.sh could not remove what deploy.sh
  added; Firebase Hosting is under Firebase's terms, not the Google Cloud terms of service (Google's domain-mapping
  page says so); a deployment needs the Firebase CLI or the Hosting REST API (a site, a version, a release); and
  it is one more product to watch for a solo maintainer. Lost on simplicity and reversibility.
- **(c) A region with Cloud Run domain mappings**, chosen: $0 on top of Cloud Run, one API call and one CNAME,
  removable by uninstall.sh. Its costs are the Preview status (acceptable for a demo) and running the demo in
  `europe-west1` instead of next to the maintainer's other services in `europe-west3`, which has no weight: the
  demo processes no personal data and reads nothing from Google Cloud.
- **Legal texts in Secret Manager, mounted as a volume.** Cloud Run mounts one secret per directory (gcloud
  refuses a second: "Cloud Run only supports one secret per directory"), so two texts would need two secrets in
  two directories, `roles/secretmanager.secretAccessor` for the runtime account on each, an extra API, billed
  secret versions, and removal in uninstall.sh: an IAM change and resources for texts that are public. Lost to
  an environment variable on simplicity.
- **Legal texts baked into the image or the repository.** Ruled out: the Impressum names the maintainer's address
  (no personal data in the repository), and every self-hoster needs their own texts.
