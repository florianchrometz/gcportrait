<!-- SPDX-License-Identifier: MIT -->

# agents.md — working on gcportrait

This file is the single entry point for anyone or anything that edits this repository: human contributors,
Claude Code, Gemini CLI, Codex, Cursor, Copilot, or whatever comes next. There is intentionally no
`CLAUDE.md` or `GEMINI.md` ([ADR 0016](docs/adr/0016-agents-md-only-entry-point.md)). Reusable skills live under
`.agents/skills/` as plain Markdown that any tool can load. Humans new to the repository start with
[docs/contributing.md](docs/contributing.md).

## What this repository is

**gcportrait** renders a Google Cloud organisation, folder or project as a Google Cloud-style architecture
diagram from Cloud Asset Inventory data, with a 35-day timeline, PNG/SVG export, light and dark themes, a demo
mode, and a one-script self-host path to Cloud Run. It is an independent project, not affiliated with Google
([ADR 0018](docs/adr/0018-non-affiliation-statement.md)). Its own work is licensed under the MIT License, `MIT`
([LICENSE](LICENSE), [ADR 0017](docs/adr/0017-licence-chosen-by-maintainer.md)), except the gcportrait name and
icon, which stay reserved ([brand/LICENSE.md](brand/LICENSE.md)); third-party material keeps its own licences
([THIRD_PARTY.md](THIRD_PARTY.md)). The decisions that shape it are the ADRs in [docs/adr/](docs/adr/README.md):
read their index, and [ADR 0035](docs/adr/0035-decisions-inherited-from-the-implementation-plan.md) for the
product's scope, its security and privacy principles and its frontend architecture, before you change
anything that touches them. Open work is in [docs/backlog.md](docs/backlog.md).

The previous implementation (Go + React, wrapping an upstream Apache-2.0 tool) was moved under `legacy/` on
2026-10-08, as a reference for *what* was done. `legacy/` exists only in the build repository; the hand-off to
the public repository leaves it behind ([ADR 0007](docs/adr/0007-legacy-tree-quarantine.md)).

## Hard rules

1. **No Go code. Nothing is copied, ported or paraphrased from the previous implementation, from the upstream
   tool it wrapped, or from any other licensed project.** If your solution reads like a translation, start
   over. gcportrait's own code is `MIT`, and whoever receives it may rely on that licence alone, so nothing may
   bring in an obligation that would force the project to publish or relicense its combined work under someone
   else's terms (no dependency whose copyleft reaches beyond its own files: `pnpm run licenses` enforces the
   allowlist and a deny list). CI runs `scripts/check-provenance.mjs` to enforce the quarantine, and to keep the
   former licence's name out of the tree outside the record of the licence decision
   (`node scripts/check-provenance.mjs --list-exempt` prints its exact rules).
2. **Every new text source file starts with the SPDX licence line `SPDX-License-Identifier: MIT`**
   in the comment form of its type. The identifier is the `license` field of the root `package.json`, which
   `pnpm provenance` reads and checks every header against (`scripts/set-license.mjs` applied it to every
   file and `package.json`, last on 2026-10-12 for the MIT License). The exact forms:
   - `// SPDX-License-Identifier: MIT` for ts, tsx, mts, cts, js, jsx, mjs, cjs;
   - `# SPDX-License-Identifier: MIT` for yaml, yml, sh and the extension-less files
     that accept `#` comments, matched by name: `.editorconfig`, `.gitignore`, `.gitattributes`, `.npmrc`,
     `.prettierignore`, `.dockerignore`, `.env.example`, `Dockerfile`, `CODEOWNERS`. A shebang (or a
     Dockerfile `# syntax=` directive) may precede it. `.nvmrc` stays a bare version number because not every
     Node version manager accepts comments there;
   - `/* SPDX-License-Identifier: MIT */` for css;
   - `<!-- SPDX-License-Identifier: MIT -->` for md, html, astro; in Markdown with YAML
     frontmatter it goes on the first line after the closing `---`.

   The line must be within the first 10 lines. A new workspace package's `package.json` declares
   `"license": "MIT"`. JSON (also `.jsonl`, `.ndjson`, `.prettierrc`), plain text, SVG, draw.io files,
   `LICENSE`, `.nvmrc`, `.gitkeep`, `CNAME`, lockfiles, images, fonts and other binary files are exempt,
   and so are changeset entries and generated `CHANGELOG.md` files. A text file of any other type fails the
   check until `scripts/lib/repo-files.mjs` gives its type a header form or lists it as header-free. File and
   directory names may not carry the old project or upstream names either.
3. **TypeScript only** (Node 22, pnpm workspaces, strict, no `any`). Shell scripts are allowed under `infra/`
   and `scripts/` for deployment and repo tooling. `erasableSyntaxOnly` is on: no enums, namespaces or
   constructor parameter properties. Every workspace except `frontend/` uses NodeNext module resolution, so
   its relative imports end in `.js`.
4. **Data over code.** Asset types, relations, lenses, icon mappings, product names, console URL templates and
   relation styles are declarative files in `packages/catalog` and `packages/icons`. Do not add a second map
   in code. Types that cross a package boundary are zod schemas in `@gcportrait/model`, declared once.
5. **Unknown asset types must still render.** Never drop an asset because the catalog lacks an entry
   (gcp-diagram-layout skill §2, rule 6).
6. **No real organisation data anywhere.** Fixtures and demo data are synthetic (`example.com`, project
   numbers below 100000000000). Tests fail otherwise.
7. **Desktop only** (≥ 1280×800). Do not add responsive breakpoints for phones or tablets to the app (the
   website serves phones; `pnpm website:mobile` checks it).
8. **Both themes, every time.** A visual change is done when it looks right in light and dark and passes the
   contrast tests.
9. **Pure cores.** `packages/ingest`, `packages/graph` and `packages/layout` have no side effects, no DOM, no
   randomness. Everything in them is unit-tested; layout and graph also have property tests.
10. **Tokens and secrets never touch disk, logs or URLs.** The backend is stateless and is not an open proxy
    (ADR 0035 §4).
11. **`legacy/` exists only in the build repository: never touch it, never import from it, never copy from
    it.** The provenance check and ESLint reject a `legacy/` import whether the directory exists or not.
12. **The non-affiliation statement goes in the app and website footers and in long-form texts, never in a
    drawing or an export; never call the project official or Google's, and never name Google with its company
    suffix.** The wording (the footer notice, the long form, the title block's tagline) and
    where each goes are fixed in [ADR 0018](docs/adr/0018-non-affiliation-statement.md); the app takes them from
    `frontend/src/branding.ts`. Never alter Google's icons. Never describe the maintainer by any programme
    membership.
13. **The running app links its source.** The shell footer's "Source (MIT)" link, a courtesy to the people who
    use an instance (the MIT License does not ask for it), stays on every route, next to the non-affiliation
    notice; it points at `sourceUrl` from `/api/config` (backend `SOURCE_URL`) or, in demo mode, at the
    build-time `VITE_SOURCE_URL`. Exports stay as they are.
14. **Filters, focus views and drill-in compose.** A filter applies in every focus view and under every
    drill-in, never only in the overview; a new lens, focus view or filter gets a table-driven case in
    `packages/graph` against the others.
15. **Generated artefacts are built by their command, never edited by hand, and checked for staleness**: the
    compiled catalog (`pnpm catalog:build`), the layout's metrics table, the icon module, `docs/media/`
    (`pnpm media`, `node scripts/exports.mjs`), the guides' lens tables (`node scripts/user-docs.mjs --write`),
    `THIRD_PARTY.md`'s dependency table (`pnpm run licenses --write`), the golden files and baselines (their
    update commands below, deliberately, with the diff reviewed).

## Layout

```
frontend/      React 19 + Vite SPA (shell, themes, routes, IndexedDB wrapper; the app store in src/state/,
               the top bar in src/shell/topbar/, the diagram renderer in src/diagram/, the export flow in
               src/export/; frontend/README.md maps every module)
backend/       Fastify service for Cloud Run (/healthz, /api/config, the live pull, the render API
               POST /api/render with its render worker, static serving, security headers; docs/api.md)
packages/      model (zod schemas, URL-hash codec, synthetic-data guard), demo-data (synthetic orgs S/M/L/XL
               with history), ingest (CAI NDJSON → Snapshot), catalog (asset types as YAML, rule engine,
               compiler, coverage check), graph (Snapshot → Graph → Scene), layout (Scene → Layout:
               packing, gutter routing, invariants, worker), icons (Google's product icons, vendored
               unmodified, and a few own drawings), render (the render library: a snapshot and a view as SVG
               and PNG, resvg-wasm; behind `pnpm render` and POST /api/render), render-cli (`pnpm render`)
e2e/           Playwright: functional, export and axe tests, mostly in demo mode; the renderer's SVG
               baselines (baselines/diagram/) and the render golden PNG (baselines/render/)
docs/          contributing.md, packages.md (with the terms), backlog.md, catalog-followups.md, ADRs (docs/adr/),
               spikes (docs/spikes/), legal facts (docs/legal/), generated media (docs/media/), and the user
               guides (getting-started, modes, permissions, lenses-and-filters, timeline, export, faq, self-host,
               self-host-options, configuration, api, the Cloud Shell tutorial), which
               `node scripts/user-docs.mjs` checks against the tree and docs/README.md lists
scripts/       repo tooling: provenance, licence, audit and bundle-size checks, the official asset-type list
               fetcher (catalog-fetch-official.mjs), media, sample exports, the static demo, release notes,
               set-license, the hand-off
website/       the Astro site at gcportrait.app (docs/website.md)
brand/         icon.svg, the one source of gcportrait's mark (the favicons, the website's logo; brand/README.md)
infra/         Dockerfile, deploy.sh, uninstall.sh, compose.yaml, cloud-run-button.sh (app.json's hook for the
               "Run on Google Cloud" button), cloudbuild.yaml
.agents/       skills for assistants          .github/     CI, release, Pages and drift workflows, templates
.changeset/    pending release notes          legacy/      the previous implementation (build repository only)
```

Dependency direction is strictly downward (frontend/backend → packages → model; `graph` also imports
`catalog`, and its tests and `render-scene` script use `demo-data` and `ingest`: ADR 0020; the layout's tests
and `debug-svg` script build demo Scenes through `graph`, `catalog` and `demo-data`), enforced by
`eslint.config.js`. One exception points up: `packages/render`, the render library (ADR 0033), is Node code on
top of the app and imports the frontend's headless entry point (`frontend/src/headless.ts`) so that a view is
drawn with the app's own components and data readers; the frontend never imports it. `packages/render-cli`
(`pnpm render`) and the backend (only in its render job, `backend/src/render/job.ts` and `worker.ts`, which the
bundle turns into `dist/render-worker.mjs`, never into `dist/server.mjs`) draw through it; nothing imports
`render-cli`. Cross-package imports go through each package's `src/index.ts` by package name
(`@gcportrait/<pkg>`); a new package is also added to the root `tsconfig.json` references.
[docs/packages.md](docs/packages.md) explains the packages, the data flow and the terms (Snapshot, Graph, Scene,
Layout, Lens, Focus, Tick, dangling reference).

## Skills (load before the matching work)

| Skill | Load when you ... |
|---|---|
| [.agents/skills/gcp-diagram-style/SKILL.md](.agents/skills/gcp-diagram-style/SKILL.md) | touch colours, zone tints, typography, icons, edges, legend, themes, export or accessibility, or need to fact-check a render |
| [.agents/skills/gcp-diagram-layout/SKILL.md](.agents/skills/gcp-diagram-layout/SKILL.md) | work on nesting, packing, routing, progressive disclosure or performance, or judge whether a diagram "looks right" |
| [.agents/skills/gcp-asset-catalog/SKILL.md](.agents/skills/gcp-asset-catalog/SKILL.md) | add or change an asset type, relation rule, lens, icon mapping, console URL, or run the coverage tool |
| [.agents/skills/cai-ingestion/SKILL.md](.agents/skills/cai-ingestion/SKILL.md) | call Cloud Asset Inventory, parse exports, handle permissions, quota projects, timeline readTime, or write demo data |
| [.agents/skills/contributor-workflow/SKILL.md](.agents/skills/contributor-workflow/SKILL.md) | start any task, prepare a PR, self-host for testing, release, or review someone else's change |

## Commands

| Goal | Command |
|---|---|
| Install (Node ≥ 22.22.2, pnpm via `corepack enable`) | `pnpm install` |
| Run app + backend locally (:5173, backend :8080) | `pnpm dev` |
| Run app in demo mode (:5174, no GCP, no backend) | `pnpm dev:demo` |
| Open a demo organisation (S, M, L or XL) straight on the diagram; any view is a URL hash | `pnpm dev:demo`, then <http://localhost:5174/diagram#snapshot=demo:M> |
| Everything CI checks except build, size and e2e | `pnpm check` (format:check, lint, typecheck, test, catalog:check, provenance, licenses) |
| Fix formatting | `pnpm format` |
| One package / one test project | `pnpm --filter @gcportrait/<pkg> test` (also `lint`, `typecheck`) / `pnpm test --project <name>` |
| Provenance rules and exemptions | `pnpm provenance` / `node scripts/check-provenance.mjs --list-exempt` |
| Check the user guides under docs/ against the tree (commands, flags, settings; no verification logs) / regenerate their lens tables after a lens change (also part of `pnpm test`) | `node scripts/user-docs.mjs` / `node scripts/user-docs.mjs --write` |
| Dependency licences (`run` is required): allowlist, deny list, the project licence's compatibility | `pnpm run licenses` (`--write` regenerates THIRD_PARTY.md, `node scripts/check-licenses.mjs --list-rules` prints the rules with reasons) |
| Dependency audit: high and critical advisories fail unless `scripts/audit-allowlist.json` accepts them with an expiry (needs the network; CI's `audit` job; docs/security.md) | `node scripts/check-audit.mjs` |
| Build, then the SPA's size budgets (UI thread 350 kB, workers 400 kB gzipped; ADR 0029) | `pnpm build`, then `pnpm size` |
| End-to-end + accessibility | `pnpm e2e` (once per machine: `pnpm --filter @gcportrait/e2e install-browsers`) |
| Add a changeset | `pnpm changeset` |
| Validate the asset catalog and report coverage (exit 1 on any violation) | `pnpm catalog:check` (`--group <group>` / `--file <path>` for one group's or file's problems, `--verbose` for rule traces, `pnpm -s catalog:check --json` for JSON) |
| Per-group catalog coverage (owned official types, mapped by role, unmapped, missing) | `pnpm catalog:coverage` (`--group <group>`, `--json`) |
| Compile the catalog into its git-ignored module (also run by install, lint, typecheck and test) | `pnpm catalog:build` |
| Fetch the official asset-type list into a new dated snapshot and print the drift | `pnpm catalog:fetch-official` |
| Print the Scene summary of a demo organisation for a view (ingest → graph → scene) | `pnpm render-scene --fixture M --lens networking` (`--help` for focus, root, filters, detail, `--json`) |
| Generate a demo organisation / regenerate the committed demo fixtures | `pnpm --filter @gcportrait/demo-data generate --size L --out /tmp/l.ndjson` / `... fixtures` |
| Draw a demo view as the app draws it (PNG, SVG and draw.io, byte-stable; the drawing carries no non-affiliation line, ADR 0018) | `pnpm render --fixture M --lens networking --png out.png` (`--theme dark`, `--detail`, `--svg`, `--drawio`, `--strict`, `--compare`, `--all`, `--help`; without `--png`/`--svg`/`--drawio` it writes `out/render/`) |
| Smoke-test the render API on a local build (`POST /api/render`, docs/api.md; your own token, which Google's tokeninfo must accept) | `pnpm build`, then `node backend/dist/server.mjs` and `curl -s -OJ -H "X-Gcportrait-Token: $(gcloud auth print-access-token)" --json '{"source":{"kind":"demo","size":"S"}}' http://localhost:8080/api/render` (draws the render golden's bytes) |
| Performance budgets on their own (XL ingest 1.5 s, M graph build 150 ms, layout S 10 ms / M 60 ms / L 400 ms / XL 2 s through a worker; the app's targets are in the layout skill §7) | `pnpm --filter @gcportrait/ingest test:budget` / `pnpm --filter @gcportrait/graph test:budget` / `pnpm --filter @gcportrait/layout test:budget` |
| The layout's benchmark table (medians, memo, cancellation, memory; exit 1 on a missed budget) | `pnpm --filter @gcportrait/layout bench` |
| How a layout's routes read per view (length, bends, border hugging, crossings, detours, canvas margin, overshoots; lane holders, the first pass's search work and the mode), or with `--packing` the packing rules side by side | `pnpm --filter @gcportrait/layout measure` (`--view L:overview:projects`, `--packing`, `--json`; default: M at `auto` × three lenses and L overview at `projects`) |
| Look at a layout's packing and routing (debug SVG + PNG of rects, labels and routed edges, not the renderer) | `pnpm --filter @gcportrait/layout debug-svg --fixture M --lens overview --theme both --aspects` (writes `out/layout/`) |
| Regenerate the layout's golden JSON / its Roboto metrics table (deliberately; review the diff) | `pnpm --filter @gcportrait/layout test:golden:update` / `pnpm --filter @gcportrait/layout metrics` |
| Regenerate the renderer's SVG baselines / the render goldens, PNG and draw.io (deliberately; look at the changed files) | `pnpm --filter @gcportrait/frontend test src/diagram/baselines.test.tsx -u` (the file before `-u`) / `pnpm --filter @gcportrait/render-cli test:golden:update` |
| Re-vendor Google's icons / rebuild the icon module / the contact sheet (both themes, 16 px legibility) | `pnpm --filter @gcportrait/icons vendor --verify-render` / `... build` / `... contact-sheet` (writes `out/`) |
| Compare the vendored icons with what Google Cloud provides now (new, changed, renamed and removed icons; needs the network; the weekly `icon-drift.yml` runs it) | `pnpm --filter @gcportrait/icons drift` (`--markdown FILE`, `--json FILE`, `--offline --zips DIR`) |
| Deploy your checkout to Cloud Run in a project of yours / remove it again (docs/self-host.md; `--dry-run` prints the changes; never against a project you do not own) | `infra/deploy.sh --project YOUR_PROJECT --region europe-west3 --build` / `infra/uninstall.sh --project YOUR_PROJECT --region europe-west3` (`--yes` without a terminal) |
| Check a deployed instance from outside (Cloud Run's front end answers `/healthz` itself) | `curl -s https://YOUR_INSTANCE/api/healthz` (and `/api/config` for its settings) |
| Build and run the production image locally (needs Docker) | `pnpm docker:build`, then `pnpm docker:run` (<http://localhost:8080>) |
| Run the production build without Docker (the backend bundle serves the built SPA, as in the image) | `pnpm build`, then `pnpm --filter @gcportrait/backend start` (<http://localhost:8080>; `backend/.env` is not read, so pass `OAUTH_CLIENT_ID=…` for sign-in) |
| Shell-check the infra scripts after a change / run them offline against stand-ins | `shellcheck -x infra/*.sh` / `pnpm test:infra` |
| Build / check / serve the website (`website/`, docs/website.md) | `pnpm website:build`, then `pnpm website:check` (metadata, links, sitemap, the footer notice, the demo and its links) / `pnpm website:dev` (live) / `pnpm website:lighthouse` |
| Check the built website in real browsers: on phones (layout, the sticky header, touch targets, axe, the animated demos' playback) / the fillable commands / the header's repository widget / the static demo | `pnpm website:mobile` / `pnpm --filter @gcportrait/website fillable` / `... stars` / `... demo` (each after `pnpm website:build`) |
| Build the static demo the website serves at `/demo/` (ADR 0034; `pnpm website:build` runs it) | `pnpm demo:static` (`--out DIR`, `--base PATH`) |
| Regenerate the screenshots, animated demos and link-preview images from demo mode (`docs/media/`, both themes; needs Playwright's Chromium) / check them for staleness | `pnpm media` (`--only ID`, `--theme dark`) / `pnpm media --check` |
| Regenerate the website's sample exports (SVG, PNG and draw.io drawn by `pnpm render`, `docs/media/exports/`) / check them | `node scripts/exports.mjs` / `node scripts/exports.mjs --check` (`--render` also draws them again and compares) |
| Check the draw.io export against the SVG export (mxGraph in Chromium, demos S, M and L in both themes; ADR 0036's limits) | `pnpm e2e tests/drawio.spec.ts --project chromium` |
| Hand-off (maintainer, once; docs/handoff.md): copy the committed tree without `legacy/` into a new repository with one commit, after the provenance check and `pnpm check` pass in it | `scripts/handoff.sh --message "MESSAGE"` (`--dest DIR`, `--repository OWNER/NAME`, `--help`) |

[docs/packages.md](docs/packages.md) maps the packages, their entry points and the data flow;
[docs/configuration.md](docs/configuration.md) lists every setting of an instance.

## How to work a task

1. Start from an issue or an item of [docs/backlog.md](docs/backlog.md). If it needs a decision, write the ADR
   first ([docs/adr/README.md](docs/adr/README.md)).
2. Load the skills its area needs (above). Read the package README you are changing.
3. Work in a branch or worktree named after the topic (`gutter-lanes`, or `412-gutter-lanes` with the issue
   number).
4. Tests first for pure packages; fixtures first for catalog work; golden/visual baseline for renderer work.
5. Run `pnpm check`. For app work also `pnpm build`, `pnpm size` and `pnpm e2e`. For visual work run
   `pnpm render` on the M fixture and look at the PNG in both themes.
6. Write the PR with the template: what, why, how verified (commands + results), screenshots, changeset,
   provenance statement. Update docs, skills and ADRs in the same PR, and take the item off the backlog.
7. Finish with a short, honest report: what was built, what was verified (commands and their results), what was
   left out. A reviewer (human or agent) checks the acceptance criteria of the issue or backlog item, the rules in
   the skills, and the provenance rules before merge.

Report honestly: if a test fails, say so with the output; if a step was skipped, say that.

## Decisions and changes

Decisions are recorded as ADRs in [docs/adr/](docs/adr/README.md) and are final unless a later ADR supersedes
or amends them. Propose a change by opening an ADR in a PR; do not silently diverge. Follow-up work that is not
decided or not built yet goes into [docs/backlog.md](docs/backlog.md).
