<!-- SPDX-License-Identifier: MIT -->

# Architecture decision records

Each file here records one decision that shapes gcportrait: the context, what was decided, what follows from
it, and the alternatives that lost. ADRs 0001 to 0018 record the founding decisions of 2026-10-08, which are
final unless a later ADR supersedes them; ADRs 0019 to 0034 and 0036 record the decisions taken while building
gcportrait; [ADR 0035](0035-decisions-inherited-from-the-implementation-plan.md) keeps the remaining decisions
of the first design (the product's scope and non-goals, the hosted surfaces and the image distribution, the
lessons, the security and privacy principles, the frontend architecture, versioning). The "Alternatives
considered" section appears only where an alternative was actually weighed. *Proposed* means written and in
force in the tree, waiting for the maintainer's acceptance; none is proposed today.

## By topic

| Topic | ADRs | User guide |
|---|---|---|
| Provenance and licence | [0001](0001-no-go-and-no-reuse-of-previous-code.md), [0007](0007-legacy-tree-quarantine.md), [0017](0017-licence-chosen-by-maintainer.md), [0019](0019-font-licence-exception.md), [0035](0035-decisions-inherited-from-the-implementation-plan.md) | [contributing.md](../contributing.md#5-rules-every-change-follows) |
| Non-affiliation | [0018](0018-non-affiliation-statement.md) | [export.md](../export.md#6-licences-trademarks-and-the-source-link) |
| Stack and architecture | [0002](0002-typescript-everywhere.md), [0003](0003-fastify-backend-on-cloud-run.md), [0005](0005-stateless-backend-browser-snapshots.md), [0010](0010-live-api-pull-and-export-files.md), [0029](0029-bundle-budgets.md), [0033](0033-render-api.md), [0035](0035-decisions-inherited-from-the-implementation-plan.md) | [modes.md](../modes.md), [api.md](../api.md) |
| Sign-in, permissions and the service account | [0004](0004-user-sign-in-and-service-account-mode.md), [0028](0028-quota-project-and-sa-gate.md), [0031](0031-token-header-behind-iap.md) | [permissions.md](../permissions.md) |
| The asset catalog and the graph | [0015](0015-maintainability-catalog-as-data.md), [0020](0020-graph-depends-on-catalog.md), [0021](0021-catalog-group-authoring.md), [0022](0022-reverse-rules-and-child-side-containment.md), [0023](0023-sibling-and-kubernetes-reference-normalisers.md), [0024](0024-graph-builder-project-matching-and-shared-vpc.md) | [lenses-and-filters.md](../lenses-and-filters.md) |
| Layout | [0006](0006-clean-room-layout-engine.md), [0025](0025-layout-packing-rules.md), [0026](0026-stacks-and-near-ties-in-packing.md), [0027](0027-gutter-routing-rules-beyond-skill-5.md) | [lenses-and-filters.md](../lenses-and-filters.md#7-detail-levels-and-chips) |
| The app and its diagrams | [0011](0011-desktop-only.md), [0012](0012-light-and-dark-themes.md), [0013](0013-png-and-svg-export.md), [0014](0014-demo-mode-first-class.md), [0033](0033-render-api.md), [0036](0036-drawio-export-from-the-svg-drawing.md) | [export.md](../export.md), [modes.md](../modes.md#4-the-demo), [api.md](../api.md#post-apirender) |
| Timeline | [0008](0008-timeline-daily-ticks.md) | [timeline.md](../timeline.md) |
| Hosting, deployment and the website | [0009](0009-astro-website-on-github-pages.md), [0030](0030-own-cloud-build-service-account.md), [0032](0032-hosted-surfaces-and-domains.md), [0034](0034-static-demo-on-pages.md), [0035](0035-decisions-inherited-from-the-implementation-plan.md) | [self-host.md](../self-host.md), [configuration.md](../configuration.md) |
| Contributors and assistants | [0016](0016-agents-md-only-entry-point.md) | [contributing.md](../contributing.md) |

## All decisions

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-no-go-and-no-reuse-of-previous-code.md) | No Go code and no reuse of the previous implementation or its upstream | accepted |
| [0002](0002-typescript-everywhere.md) | TypeScript everywhere (Node 22, pnpm workspaces, strict) | accepted |
| [0003](0003-fastify-backend-on-cloud-run.md) | Fastify backend on Cloud Run | accepted |
| [0004](0004-user-sign-in-and-service-account-mode.md) | User sign-in by default, service-account mode for teams | accepted (note of 2026-10-12: no hosted sign-in instance) |
| [0005](0005-stateless-backend-browser-snapshots.md) | Stateless backend; snapshots live in the browser | accepted |
| [0006](0006-clean-room-layout-engine.md) | Clean-room layout engine: nested-zone grid packing and gutter routing | accepted |
| [0007](0007-legacy-tree-quarantine.md) | The previous implementation moves to `legacy/` and is quarantined; it exists only in the build repository | accepted |
| [0008](0008-timeline-daily-ticks.md) | Timeline of daily ticks over 35 days, fetched lazily | accepted |
| [0009](0009-astro-website-on-github-pages.md) | Website: Astro static site on GitHub Pages | accepted; its Firebase Hosting fallback superseded by 0034 |
| [0010](0010-live-api-pull-and-export-files.md) | Two import paths: live API pull and CAI export files | accepted |
| [0011](0011-desktop-only.md) | Desktop only | accepted |
| [0012](0012-light-and-dark-themes.md) | Light and dark themes, WCAG 2.2 AA, Google colour semantics | accepted |
| [0013](0013-png-and-svg-export.md) | PNG and SVG export of the current view | accepted |
| [0014](0014-demo-mode-first-class.md) | Demo mode is first-class; no real organisation data, ever | accepted |
| [0015](0015-maintainability-catalog-as-data.md) | Maintainability is a design goal: the asset catalog is data | accepted |
| [0016](0016-agents-md-only-entry-point.md) | `agents.md` is the only entry point for AI assistants | accepted |
| [0017](0017-licence-chosen-by-maintainer.md) | The licence is the maintainer's choice and is not inherited; since 2026-10-12: `MIT`, the gcportrait name and icon reserved, no CLA | accepted (decision taken 2026-10-10; amended 2026-10-12) |
| [0018](0018-non-affiliation-statement.md) | Non-affiliation is stated where a user or contributor looks: the footers and long-form texts only, never in a drawing or an export; the trademark sentence names "Google" | accepted (amended 2026-10-10, 2026-10-11 and 2026-10-12) |
| [0019](0019-font-licence-exception.md) | Accept OFL-1.1 for the two self-hosted Roboto font packages | accepted (2026-10-10); amended 2026-10-11, the amendment withdrawn 2026-10-12 |
| [0020](0020-graph-depends-on-catalog.md) | The graph builder depends on the catalog package, which owns rule semantics | accepted |
| [0021](0021-catalog-group-authoring.md) | Catalog authoring by groups: group-owned files and a generated, uncommitted compiled catalog | accepted |
| [0022](0022-reverse-rules-and-child-side-containment.md) | Reverse relation rules and child-side containment (`reverse`, `nestsIn`) in the catalog schema | accepted |
| [0023](0023-sibling-and-kubernetes-reference-normalisers.md) | Sibling and Kubernetes reference normalisers, display templates and the `hiddenWhen` proof | accepted |
| [0024](0024-graph-builder-project-matching-and-shared-vpc.md) | Graph builder: canonical project matching, Shared VPC evidence, reciprocal links, `hiddenWhen` under `includeTypes` | accepted |
| [0025](0025-layout-packing-rules.md) | Layout packing rules (full rows, wider than tall, smallest frame) and the restated packing criterion | accepted |
| [0026](0026-stacks-and-near-ties-in-packing.md) | Stacks beside a tall zone, and near ties that keep grids from growing downwards | accepted |
| [0027](0027-gutter-routing-rules-beyond-skill-5.md) | Gutter routing rules beyond skill §5: port lines, border hugging, lane holders, hub bundles; single-pass mode by search work | accepted |
| [0028](0028-quota-project-and-sa-gate.md) | Quota project (when to send `x-goog-user-project`), the preflight order and its messages, the service-account gate (the caller's `testIamPermissions`, an optional strict exposure check, a five-minute memo), and the OAuth scopes, from the quota-project spike | accepted |
| [0029](0029-bundle-budgets.md) | Bundle budgets by thread: 350 kB for the UI thread, 400 kB for the workers; zod off the UI thread (guarded by `pnpm size`); the demo generator in workers only (the data worker draws, a demo worker per job prepares) | accepted (amended 2026-10-11) |
| [0030](0030-own-cloud-build-service-account.md) | `deploy.sh --build` runs Cloud Build as a build account of its own (Storage Admin on its bucket, Artifact Registry Writer on its repository), not the Compute Engine default account | accepted (2026-10-12) |
| [0031](0031-token-header-behind-iap.md) | The person's token travels in `X-Gcportrait-Token` (`Authorization: Bearer` only without it, the non-IAP path), so user mode works behind Identity-Aware Proxy; the header is not a cookie and not cached | accepted (2026-10-12) |
| [0032](0032-hosted-surfaces-and-domains.md) | Hosted surfaces: demo-only mode (`DEMO_ONLY`, no route that calls Google) for a sign-in-free instance; legal texts from `LEGAL_DIR`/`LEGAL_BUNDLE`, never from the repository; amended 2026-10-11: the website and the demo link the legal pages on the maintainer's website (`LEGAL_IMPRESSUM_URL`, `LEGAL_PRIVACY_URL`), and the maintainer's demo is the static build of 0034 | accepted (2026-10-12) for decisions 1, 3 and 4; decision 2 (a Cloud Run domain mapping for the maintainer's demo) superseded by 0034 |
| [0033](0033-render-api.md) | Render API: `POST /api/render` draws SVG and PNG on the server with the code `pnpm render` runs: one render library (`@gcportrait/render`, the one package that imports the frontend), resvg's WebAssembly build in a fresh worker per render, one render per instance with fixed limits, on by default except on a demo-only instance (`RENDER_API`) | accepted (2026-10-11; amended 2026-10-12: no `x-gcportrait-notice` header; the draw.io format of 0036) |
| [0034](0034-static-demo-on-pages.md) | The maintainer's demo is a static build of the app in demo-only mode on the website's GitHub Pages site at `/demo/` (`pnpm demo:static`): configuration built in, a copy of index.html per route, the backend's demo-only CSP as a `<meta>` without `frame-ancestors`; `demo.gcportrait.app` and the Firebase Hosting fallback dropped; demo-only mode stays for self-hosters | accepted (2026-10-12) |
| [0035](0035-decisions-inherited-from-the-implementation-plan.md) | Decisions kept from the first design: product scope and non-goals, hosted surfaces and image distribution (ghcr.io, a remote repository, no Workload Identity Federation), the lessons as constraints, the seven security and privacy principles, the frontend architecture, maintainability and versioning | accepted (2026-10-12) |
| [0036](0036-drawio-export-from-the-svg-drawing.md) | The draw.io export is the SVG drawing translated into draw.io's cells: structure from markers on the components (`data-kind`, short indices for zones, nodes and lines' ends; zones as containers, nodes as groups, lines between their nodes), text placed at its baselines in Roboto via `fontSource`, deterministic and compressed with fflate, the translator a lazy chunk; the Export menu, `POST /api/render`, `pnpm render` and the website's sample exports offer it, and an mxGraph fidelity check holds it to the SVG | accepted (2026-10-12) |

## Writing an ADR

1. Every decision gets an ADR: a design choice that constrains later work, a rule a check enforces, or a
   change to one of the decisions above. Copy [0000-template.md](0000-template.md) to `NNNN-short-title.md`,
   using the next free number and a lower-case, hyphenated title.
2. Open it with status `proposed` in the pull request that needs the decision; it becomes `accepted` (with
   that day's date) when the maintainer approves and the pull request merges.
3. To change an accepted decision, write a new ADR that supersedes it; set the old one's status to
   `superseded by NNNN` and leave the rest of it untouched. A small change to an accepted decision may instead
   be a dated amendment section in the ADR itself, as ADRs 0017, 0018, 0019, 0028, 0029 and 0032 have.
4. Add a row to "All decisions" above, and the number to its topic in "By topic". Keep the ADR short: a reader
   should finish it in two minutes.

ADRs, like every Markdown file, start with the SPDX header line
`<!-- SPDX-License-Identifier: MIT -->`. `docs/adr/` is one of the few places where the
provenance check allows the previous implementation's and its upstream's names, because a decision record
sometimes has to say what it departs from; nowhere else in the repository may name them.
