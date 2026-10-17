<!-- SPDX-License-Identifier: MIT -->

# gcportrait documentation

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.

## User guides

For people who use gcportrait or run an instance of it. They say what to do; `node scripts/user-docs.mjs` (run
by `pnpm test`) fails when the ten guides from modes.md to api.md name a command, flag or setting the tree
does not have; when a guide, getting-started.md, cloudshell-tutorial.md, website.md or a README for running
gcportrait logs what was verified when and where (a dated note, a machine, a timed run, a recorded run in
code); and when self-host.md asks for more than the project id, the OAuth client id and the email address to
grant. The project's website (`gcportrait.app`) builds its /docs/ pages from the same files, and its "About
the author" section from [author.md](author.md).

| Guide | What it covers |
|---|---|
| [getting-started.md](getting-started.md) | The first steps: the demo (hosted or on your machine), a first tour, and which guide to read next. |
| [modes.md](modes.md) | The four ways to a diagram side by side: your own account, the instance's service account, export files and the demo; which instance offers which (a normal instance, a demo-only one, the static demo at `gcportrait.app/demo/`), and where the data goes. |
| [permissions.md](permissions.md) | What reading a scope needs: the whole permission matrix as implemented, with the exact `gcloud` commands the app prints; signing in, the three OAuth scopes and what Google's consent screen says; the quota project; service-account mode, its grant and its gate; what the permission check says item by item and what to do; removing access. |
| [lenses-and-filters.md](lenses-and-filters.md) | How a view is chosen: the 11 lenses with their intent, arrows, detail ceiling and type bundles (generated from the catalog), the 13 relation kinds, the five focus views, every filter with its key in the link, drill-in and the breadcrumb, detail levels, chips and "N of M shown". |
| [timeline.md](timeline.md) | The last 35 days of a scope: ticks, moving through them, where a day comes from, what is kept in the browser, the diff overlay and "What changed", playback, extra ticks from exports and pulls, estimated read times, the limits. |
| [export.md](export.md) | SVG, PNG and draw.io: the Export menu's options, file names, the title block and the legend, what the files contain, `pnpm render`, and what travels with an exported file (licences, trademarks, the source link). |
| [faq.md](faq.md) | Short answers: missing arrows, dangling references, Shared VPC, unknown asset types, ids instead of names, freshness, the 35-day limit, the cost of Cloud Asset Inventory calls, privacy, hosting. |
| [self-host.md](self-host.md) | Running your own instance on Cloud Run, right away: deploy with one installer line and the project id (or the "Open in Cloud Shell" tutorial), create the OAuth client, redeploy with its id; then using it, what you got, updating and uninstalling. |
| [self-host-options.md](self-host-options.md) | Everything optional, each with its flag, default and an example: the installer's own options and limits, region and service name, memory and instances, "Hosted by", the OAuth client in detail, Identity-Aware Proxy, service-account mode, a demo-only instance, a custom domain, legal pages, the render API, versions and rollback, building from source (the "Run on Google Cloud" button, `--build` from a clone, the image locally); everything `infra/deploy.sh` creates and never does, the roles to run it, `infra/uninstall.sh` in detail, costs, logs, troubleshooting. |
| [configuration.md](configuration.md) | Every setting of an instance with its default: the backend's environment (kept equal to its zod schema by a test), the service-account credentials, what deploy.sh sets on Cloud Run, the flags of `infra/install.sh`, `infra/deploy.sh` and `infra/uninstall.sh`, the names and labels of what they create, the image, compose, the Cloud Run Button, the release workflow and the SPA's build variables. |
| [api.md](api.md) | Every route an instance serves under `/api`, for scripts: your own token in `X-Gcportrait-Token`, the routes and their bodies, `POST /api/render` (a view of a scope, an uploaded export or snapshot file, or a demo organisation drawn as SVG, PNG or a draw.io file on the server, byte for byte what `pnpm render` draws) with its options, headers and `curl` examples, every error with its `code` and `Retry-After`, and the limits. |
| [cloudshell-tutorial.md](cloudshell-tutorial.md) | The guided path of the quick start as a Cloud Shell tutorial, opened by the "Open in Cloud Shell" button: sign in, choose a project, deploy, open the address, create the OAuth client, redeploy with its id, read your project, clean up. |

## For contributors

| Path | What it is for |
|---|---|
| [AGENTS.md](../AGENTS.md) | The rules of the project, for people and AI assistants alike: what gcportrait is and is not, the product, data, layout, export, style, security, hosting, brand, licence, architecture, quality and release rules, how to work a task, the skills and every command; a top-level folder with rules of its own holds them in its own `AGENTS.md`, which the root names. Cite a rule by its file and heading ("AGENTS.md, Security and privacy"). |
| [docs/AGENTS.md](AGENTS.md) | This folder's rules: registering user guides, where the shared writing and media rules live, and the documentation commands. |
| [contributing.md](contributing.md) | From a clone of your fork to a green `pnpm check` and a small, focused pull request: setup, the local loop, the checks, the provenance rules, changesets, and the maintainer's release setup. |
| [website.md](website.md) | The website at `gcportrait.app` (`website/`): building and checking it, the generated screenshots, animated demos and link-preview images in [media/](media/manifest.json) (`pnpm media`, and `pnpm media --check` for staleness), Lighthouse, deploying to GitHub Pages, the DNS records for the apex and `www`, the footer's links to the legal pages on the maintainer's website, the favicon and logo from `brand/icon.svg`, the static demo at `/demo/`, the sample exports, the fillable commands, the sticky header, and the header's repository widget (the latest release, the stars and the forks). |
| [legal/](legal/README.md) | What `gcportrait.app` (the demo under `/demo/` included) processes (a fact sheet, not legal advice): the data-processing inventory (GitHub Pages' request logs, the header's repository widget, the website's page views counted with TelemetryDeck, what stays in the visitor's browser) and what they do not, and the facts the maintainer's privacy notice covers. The Impressum and the privacy notice themselves are on the maintainer's website, which the site and the demo both link. |
| [packages.md](packages.md) | The workspace packages: what each one is responsible for, its public entry points, the dependency direction, and how data flows from a Cloud Asset Inventory source through the Scene and the layout to a drawn and exported diagram, with the real function and type names and the command-line entry points (`pnpm render-scene`, `pnpm render`, the budgets and goldens). |
| [threat-model.md](threat-model.md) | What gcportrait protects (the person's token, the instance's account, the inventory, availability, the supply chain), from whom, the trust boundaries between the browser, the backend and Google's APIs, the token's path, service-account mode and its gate, demo mode and exports, and the threats with their controls, citing the security and privacy principles of [AGENTS.md](../AGENTS.md), "Security and privacy". |
| [security.md](security.md) | The security controls as a checklist with the evidence for each item: the upstream host allowlist, request bodies, rate limits and the stream cap, timeouts, response caps and memory, the CSP and the other headers, logs without tokens at `LOG_LEVEL=trace`, errors, request ids, shutdown, static files, the container and Cloud Run, the dependency audit (`node scripts/check-audit.mjs`) and Dependabot, the licence-compliance follow-ups, and the open findings with their severity. |
| [backlog.md](backlog.md) | The open work: the maintainer's pending decisions, what is left before the first release, the CI follow-ups, open items for self-hosting and the backend, the app, performance, the catalog and icons, the website and docs, and the "Later" list. Start a task from an item here or from an issue. Not a page of the website. |
| [catalog-followups.md](catalog-followups.md) | The asset catalog's own backlog: engine and schema work (project id versus number, reverse and child-side rules, missing normalisers, template filters), demo-data cases, and per service the field formats, roles and console links that public documentation could not settle. Read it before changing a catalog rule's semantics or when you have a real Cloud Asset Inventory export to check against. |

## Documentation elsewhere in the repository

- [AGENTS.md](../AGENTS.md): the rules of the project, the repository map, the commands and how to work a
  task, for humans and AI assistants alike; a top-level folder with rules of its own holds them in an
  `AGENTS.md` of its own, which the root names.
- [.agents/skills/](../.agents/README.md): style, layout, asset catalog, ingestion and contributor-workflow
  skills, the handbooks that apply AGENTS.md's rules, usable as checklists by reviewers too.
- [brand/](../brand/README.md): `icon.svg`, the one source of gcportrait's mark (the favicons and the
  website's logo).
- Each workspace package's `README.md` (`frontend/`, `backend/`, `e2e/`, `packages/*/`): its scripts,
  structure and conventions.
- [CHANGELOG.md](../CHANGELOG.md): the release notes, 1.0.0 first; each workspace package's own `CHANGELOG.md`
  is written by `pnpm release:version` from the changesets in `.changeset/`.
- [LICENSE](../LICENSE): gcportrait's own work is licensed under the MIT License, except the gcportrait
  name and icon ([brand/LICENSE.md](../brand/LICENSE.md)); the root README's "Licence" section says what that
  means.
- [THIRD_PARTY.md](../THIRD_PARTY.md): every category of third-party material, why the dependency licences
  are compatible with the project licence, and the dependency licence table.
