<!-- SPDX-License-Identifier: Apache-2.0 -->

# AGENTS.md: the rules of gcportrait

Humans start with docs/contributing.md; assistants load [Skills](#skills).

| Folder | What it holds | Its rules |
|---|---|---|
| `packages/` | shared packages | `packages/AGENTS.md` |
| `backend/` | service/API | `backend/AGENTS.md` |
| `frontend/` | app/exports | `frontend/AGENTS.md` |
| `website/` | site/demo | `website/AGENTS.md` |
| `infra/` | image/deployment | `infra/AGENTS.md` |
| `.github/` | workflows/templates | `.github/AGENTS.md` |
| `e2e/` | browser tests/baselines | `e2e/AGENTS.md` |
| `docs/` | guides/media | `docs/AGENTS.md` |
| `scripts/`, `brand/`, `.agents/` | tooling, the mark, skills, releases | this file |

## How this file works

- **AGENTS.md is capitalised on disk and in git.** Root rules cover cross-folder or repository-wide changes;
  folder rules open "These rules add to the root AGENTS.md, which applies here too", each at most 20 000
  characters (`scripts/rules-files.test.ts`).
- **Skills are procedural handbooks** (constants, rule citations), never rule history (.agents/README.md).
- **State present rules with one-sentence reasons**: no decision-makers, dates or replaced behavior; **cite a
  rule by file and heading** ("AGENTS.md, Security and privacy, principle 2").
- **Rules, docs and skills change in the code's PR**; scope, hosting, security, privacy, licence and
  non-affiliation are the maintainer's call; open work goes to docs/backlog.md.
- **No committed tool instructions or user settings** (`CLAUDE.md`, `.cursor/rules/`, `.claude/`): ignored
  and skipped by provenance ([Assistants](#assistants)).

## What gcportrait is and is not

gcportrait renders an organisation, folder or project as a Google Cloud-style diagram from Cloud Asset
Inventory (CAI): current state and changes over five weeks; [docs/README.md](docs/README.md) lists what
version 1 does.

- **A viewer, not a drawing tool.** Nothing is dragged, added or edited: every box is a CAI asset, every
  arrow a reference in its JSON.
- **Not planned:** editing, cost data, multi-cloud, server snapshots, live feeds (docs/backlog.md).
- **An independent open-source project**, not affiliated with Google ([Non-affiliation, brand and
  legal](#non-affiliation-brand-and-legal)), Apache-2.0 licensed, name and icon reserved.

## Product rules

- **Every control, menu item, page and action at every width**, touch and keyboard under one accessible name
  (phone ≤47.99rem, tablet 48–79.99rem, desktop ≥80rem; `frontend/src/ui/screen.ts`), both themes
  contrast-checked.
- **First-class demo**: deterministic synthetic S, M, L, XL organisations, never real inventories.
- **35 daily ticks**, today plus 34 days at 00:00 UTC, never future, at readTime (cai-ingestion skill §5).
- **Every surface says "as of", never "live"**, naming read time: CAI lags hours, IAM up to a week.
- **The URL hash holds the full ViewSpec** through model codec, keeping state across reloads and links.
- **The render API and `pnpm render` never confirm large snapshots** (frontend/AGENTS.md, "Snapshots").
- **Filters compose in every focus view and drill-in**, with tests for each new lens or filter.
- **Unknown types render** generic cards, icons and `parent` containment (layout skill §2 rule 6).
- **Source URL**: `/api/config.sourceUrl` (`SOURCE_URL`) or `VITE_SOURCE_URL` in demo, default this repo.

## Data and graph semantics

- **Catalog and icons data, not code maps**, define types, relations, lenses, icons, products, console
  templates, styles and extraction.
- **Package-boundary types:** one zod schema in `@gcportrait/model`, inferred by `z.infer`.
- **One ingest parser and Snapshot** serve streamed `assets.list` (`POST /api/assets/stream`) and exports
  (`POST /api/export/read`), origin showing only in Snapshot `source`; UI names read-time source.
- **Synthetic fixtures, examples and demos**: `example.com` or `example.org`, project numbers <100000000000,
  documentation IPs `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` or private ranges; never real scopes.

`packages/AGENTS.md` governs catalog/graph semantics, layout and budgets.

## Exports and the render API

- **One drawing: SVG, PNG, draw.io**, PNG at 2× or 3× on theme background; gcp-diagram-style skill §7–8
  governs legend, title, CSS, icons and three title lines; `<desc>` carries neutral scope, lens, read time,
  changes and "Drawn with gcportrait." only.
- **`POST /api/render` uses `pnpm render`'s code** for all three formats (frontend/AGENTS.md, "Exports";
  backend/AGENTS.md, "The render API"; docs/api.md, docs/export.md).

## Style and accessibility

- **WCAG 2.2 AA** on every page, diagram, theme and width; only decorative subnet and VPC strokes are
  excepted (axe on every state; e2e/AGENTS.md, "Widths, gestures and axe").
- **44×44 CSS-pixel targets below desktop** (WCAG 2.5.5), except sentence links and code-line fields, with
  safe-area clearance on persistent bars.
- **Colour never stands alone**: edge dash or head, zone title position or badge identify them too.
- **Self-host Roboto and Roboto Mono**, never a CDN; themes follow frontend/AGENTS.md, "Diagram and themes".

## Security and privacy

Seven principles, numbered so the threat model and security guide
([docs/threat-model.md](docs/threat-model.md), [docs/security.md](docs/security.md)) can cite them
("AGENTS.md, Security and privacy, principle 4"):

1. **Asset data never leaves the person's browser except to be fetched.** The backend streams it and forgets
   it; snapshots, views, cached days and preferences live in IndexedDB, as storing inventories would make
   every instance a data processor.
2. **Tokens are never stored, never logged and never put in URLs.** A token in a file, log line or URL
   outlives the session it was given for.
3. **The backend is not an open proxy**: host allowlist, schema-validated bodies and rate limits.
4. **Service-account mode is gated by caller access** (and `SA_MODE_CALLERS` for organisations), so the
   instance's account never reads a scope for someone who could not see it.
5. **Exports are downloads the person starts**: gcportrait uploads nothing on its own, and the render API
   draws what its caller sends and keeps nothing.
6. **The demo data is synthetic**, and tests fail on fixtures holding real project numbers or domains
   outside `example.com` and `example.org`.
7. **Dependencies pass the licence allowlist and deny list (`pnpm run licenses`), the dependency audit
   (`node scripts/check-audit.mjs`) and Dependabot.**

### Tokens

- The app sends the token in `X-Gcportrait-Token` on every `/api/*` call (`fetchWithToken`), never in
  `Authorization`, which Identity-Aware Proxy claims as its own.
- The backend reads that header first, taking `Authorization: Bearer` only without it (scripts on public
  instances); malformed `X-Gcportrait-Token` returns 401, never falling back to `Authorization`.
- Neither header is logged (pino redaction); tokens are not cookies, browser never stores them, no CORS
  response, API traffic is `no-store`. In browser it lives in memory; backend forwards it as `Bearer`.
- Token audience is not checked against `OAUTH_CLIENT_ID` by default: `gcloud auth print-access-token` works
  for scripts and render API; private instances rely on IAP.

### Quota project and the permission check

In user mode `quotaProject` is a required, schema-validated project id in every CAI call body (400 without
it): scope itself when a project, else caller's pick, never instance's. Probes, errors and gate follow
[backend/AGENTS.md](backend/AGENTS.md), "Quota project and the permission check".

### OAuth scopes

Sign-in asks for `cloud-platform.read-only`, `cloudasset` and `userinfo.email`, never read-write
`cloud-platform`; CAI refuses the first alone and Resource Manager the second, so a grant missing either is
revoked and re-requested; without `userinfo.email` sign-in works without address in menu.

## Modes and hosting

- **Ways in**: own account (default), operator-enabled SA (team grant; `SA_MODE_CALLERS` for org scopes;
  optional `SA_MODE_AUDIT_KEY`), exports, demo; one Cloud Run service per installation.
- **Demo-only** (`DEMO_ONLY`) needs no sign-in: no OAuth client, SA or render API (backend/AGENTS.md,
  "Demo-only mode and legal pages").
- **Static demo** at `gcportrait.app/demo/`, demo-only build (`VITE_STATIC_DEMO=1`) shipped by site with no
  sign-in code; maintainer hosts it alone, with no accounts or terms of use.
- **No telemetry, anywhere**: app, demo, website and every instance send no usage data, error reports or
  page views; site makes no cross-host requests.
- **Legal pages**: Impressum and privacy notice live on maintainer's site, never in repo.
- `infra/deploy.sh` creates account with no project roles; callers grant `roles/cloudasset.viewer` on folders
  or projects, not organisation.
- **Self-hosting** follows infra/AGENTS.md and website/AGENTS.md, "The site".

## Non-affiliation, brand and legal

gcportrait draws Google Cloud-style diagrams with Google's product icons, which invites the assumption that it
is a Google product; nothing may suggest Google's endorsement. Three texts in `frontend/src/branding.ts` fix
the wording, and a test compares every copy with them.

- **Footer notice**, the maintainer's name linked to <https://florian-chrometz.de>: in the app's footer on
  every route in a new tab (`rel="noopener"`, named "Florian Chrometz (personal website)", preserving the
  in-memory session), and in the website's footer on every page in the same tab:

  > Not affiliated with Google / Google Cloud. gcportrait is an independent open-source project by
  > Florian Chrometz

- **Long form**, once per long-form text (root and package READMEs, docs index, docs, Cloud Shell tutorial,
  release notes, image label, infra and installer `--help`, Connect page, site author and licence pages;
  guides in their footer):

  > gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and
  > is not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product
  > icons are trademarks of Google and are used under Google's icon usage terms.

- **Tagline**, the last line of a diagram's title block: `gcportrait.app - Visualize your Google Cloud
  Infrastructure`; branding, not a statement.
- **Nowhere else**: no drawing, banner, API header, `hostedBy` line, Permissions page, snapshot file or site
  metadata carries it; a reviewer finding it there calls it a defect.

Rules that go with it: never call gcportrait official, Google's or verified; "Google" or "Google Cloud",
never with company suffix; `HOSTED_BY` may not name Google; icons stay unmodified; maintainer is named only
in footer notice, author sections, copyright notices and author structured data.
- The name and icon are not covered by the Apache License 2.0: "They identify this project and may not be used
  to present other software or services as gcportrait or as endorsed by it; forks must use their own name and
  icon." [brand/LICENSE.md](brand/LICENSE.md) holds it and `brand/icon.svg` is the one mark.

## Licence and dependencies

- **gcportrait's own work, code, texts and images, is licensed under the Apache License 2.0**, "Copyright (c)
  2026 Florian Chrometz" ([LICENSE](LICENSE)): anyone can use, study, change, embed and run it, attribution
  travelling in [NOTICE](NOTICE), name and icon staying reserved ([Non-affiliation, brand and
  legal](#non-affiliation-brand-and-legal)).
- **Every new text source file starts with the SPDX line for `Apache-2.0`** in comment form
  (docs/contributing.md, "The SPDX header"), machine-readable for every file.
- **Third-party material keeps its terms**: npm dependencies, self-hosted Roboto fonts (OFL-1.1 binds files,
  not software), Google icons and `scripts/licenses/` ([THIRD_PARTY.md](THIRD_PARTY.md)).
- **Dependencies stay permissive.** `pnpm run licenses` allows permissive licences and MPL-2.0 file-scoped
  copyleft, denying GPL, source-available, non-commercial, share-alike and unknown licences (`node
  scripts/check-licenses.mjs --list-rules`).
- **Contributions** are under Apache License 2.0, inbound = outbound, with the PR's provenance statement
  and no CLA.
- **Original work only.** Nothing is copied, ported or paraphrased from another licensed project; every pull
  request states "Original work; nothing copied from other projects."
- **No Go files, no Graphviz files (`.dot`, `.gv`), no Gizmo queries and no symbolic links**; provenance
  check refuses them.

## Architecture and code

- **TypeScript only**, Node `^22.22.2` (`.nvmrc`: `22`), pnpm workspace pinned by `packageManager` and
  Corepack.
- **Strict**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`,
  `erasableSyntaxOnly` (no enums, namespaces, parameter properties), `strictTypeChecked`, no `any`;
  TypeScript 6.0.x. **NodeNext** (`.js` relative imports) except frontend bundler resolution; `pnpm typecheck`
  is `tsc -b`.
- **UTF-8, no BOM or NUL** (`.editorconfig`); binary extensions registered in `BINARY_EXTENSIONS`.
- **Downward graph**: `model ← catalog ← graph ← frontend`; packages import only model, graph also catalog,
  demo-data and ingest staying cycle-free. **Upwards**, Node render imports `frontend/src/headless.ts`,
  backend bundles into `dist/render-worker.mjs`.
- **Package-name imports**, `@gcportrait/<pkg>` via `src/index.ts`/`testing`, never deep or relative
  cross-package; eslint.config.js holds direction.
- **Workers** run ingest, graph, layout and demo; UI only renders, never loading zod.

## Quality gates, testing and CI

- **Before every push run `pnpm check`** (Commands table); app work adds build, size and e2e; visual work
  renders M in both themes and inspects it.
- **Pure packages: tests first; catalog: fixtures first; renderers: goldens and baselines**, updated
  intentionally only, with command and PR explanation (contributor-workflow skill §4).
- **Generate, never hand-edit; check staleness**: catalog, metrics, icons, media, exports, tables, goldens,
  baselines.
- **Audit fails high and critical advisories** unless `scripts/audit-allowlist.json` accepts one with an
  expiry; **Dependabot is never closed unread**: adopt or decline in docs/backlog.md.

CI follows .github/AGENTS.md, "CI" and "A change of only docs and media"; legs follow e2e/AGENTS.md,
"CI legs".

## Releases

- **Fixed semver across workspace** (`pnpm release:version X.Y.Z`), packages private, never npm; version,
  notes and tag follow contributor-workflow skill §7.
- **Tagged releases pass check, build and size**, smoke-test images and publish
  `ghcr.io/florianchrometz/gcportrait` as `X.Y.Z`, `X.Y`, `latest` (newest only); manual runs publish `dev`.
- **Artifacts**: per-platform SPDX SBOM, CHANGELOG notes, installer scripts, checksums.txt; prereleases take
  their version tag only.

Workflows and website deployment follow .github/AGENTS.md, "Releases"; setup and steps in
docs/contributing.md §9.

## Documentation

- **User guides indexed in docs/README.md; package README is reference**: guides say what to do and link
  explanations (docs/AGENTS.md, "User guides").
- **What is, never history**: no run, timing, review or verification records, decision or change dates or
  replaced behavior (user-docs and provenance enforce it).
- **Markdown: 110 columns**, hand-wrapped, not Prettier, with SPDX, except tables, URL lines, fences,
  frontmatter and one-word lines.
- **Placeholders: `YOUR_` capitals**, one word (`YOUR_PROJECT`), modelled on `COMMAND_VARIABLES`.
- **README front page** follows scripts/readme.test.ts order, purpose and quick starts first, every feature
  illustrated from docs/media/ in both themes.

## How to work a task

1. Start from an issue or backlog item; read skills, affected folders' rules and package READMEs.
2. Work on a topic-named branch or worktree and follow [Quality gates, testing and
   CI](#quality-gates-testing-and-ci).
3. Use the PR template (what, why, commands and results, screenshots, provenance), remove completed backlog
   item, one small feature or function per PR.
4. Report changes, checks, failures and exclusions honestly; review acceptance, skills and rules before merge.

**Never force-push or rewrite main**: clones and forks must stay valid; only maintainer decides history cuts.

## Skills

Load `.agents/skills/NAME/SKILL.md`: **contributor-workflow** for every task, review or release;
**gcp-diagram-style** for visuals, exports, accessibility or render review; **gcp-diagram-layout** for
containment, layout, routing, disclosure or performance; **gcp-asset-catalog** for types, relations, lenses,
icons, console links or coverage; **cai-ingestion** for CAI, parsing, permissions, quota, timeline or demos.

## Assistants

- **Pointers contain no rules**, just ignored tool imports and references; discovery, pointer text and safe
  setup procedures are in .agents/README.md, sources in scripts/agents-setup.mjs.

## Commands

| Goal | Command |
|---|---|
| Install (Node ≥ 22.22.2) | `pnpm install` |
| App + backend (:5173, :8080) | `pnpm dev` |
| Demo mode (:5174, no GCP) | `pnpm dev:demo` |
| CI checks except build, size, e2e | `pnpm check` (format, lint, typecheck, test, catalog, provenance, licenses) |
| One package / one test project | `pnpm --filter @gcportrait/<pkg> test` (`lint`, `typecheck`) / `pnpm test --project <name>` |
| Provenance / licences / audit | `pnpm provenance`, `pnpm run licenses` (`--write`, `--list-rules`), `node scripts/check-audit.mjs` |
| Build, then size budgets | `pnpm build`, then `pnpm size` |
| End-to-end + accessibility | `pnpm e2e` (once: `pnpm --filter @gcportrait/e2e install-browsers`; `--project mobile`) |
| Draw demo view as app does | `pnpm render --fixture M --lens networking --png out.png` (`--svg`, `--drawio`, `--theme dark`) |

Folder rules hold remaining commands. References: docs/packages.md, docs/configuration.md.

## Names that never appear

Provenance refuses names and phrases in docs/contributing.md, "Provenance", in all contents and paths, every
tracked and nonignored file read in any encoding, binary metadata included. Refused strings are assembled or
keyed by SHA-256; `node scripts/check-provenance.mjs --list-exempt` labels rules and `--digest-of <phrase>`
prints a deny entry.
