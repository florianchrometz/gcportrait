<!-- SPDX-License-Identifier: MIT -->

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
| `scripts/`, `brand/`, `.agents/`, `.changeset/` | tooling/brand/skills/releases | this file |

## How this file works

- **AGENTS.md is capitalised on disk and in git.** Rules binding multiple folders or every change live at
  root; others in one top-level folder, never deeper. Keep rules current and unduplicated to avoid drift.
  Folder files open "These rules add to the root AGENTS.md, which applies here too." for nearest-file
  readers. Read the AGENTS.md of every folder you change before editing its files.
  `scripts/rules-files.test.ts` caps root at 32 768 bytes and folder files at 16 384; these are file caps,
  not combined read limits (.agents/README.md).
- **Skills are procedural handbooks** with constants and rule citations, never rule history; their format is
  in .agents/README.md.
- **State present rules with one-sentence reasons**, no decision-makers, dates or replaced behavior.
- **Cite a rule's file and heading**, not retold reasons: "AGENTS.md, Security and privacy, principle 2" or
  "backend/AGENTS.md, Hardening". Heading anchors and citations change together; rules tests validate
  citations.
- **Docs, rules and skills change in the code's PR**; changes to scope, hosting, security and privacy
  principles, licence or non-affiliation are the maintainer's call. Open work and questions belong in
  docs/backlog.md or docs/catalog-followups.md, never rules.
- **No committed tool instructions or user settings**: ignored at every depth, skipped by provenance; copies
  drift and favour tools (`CLAUDE.md`, `GEMINI.md`, `.cursor/rules/`, `.github/copilot-instructions.md`,
  `AGENTS.override.md`, `.claude/`, etc.). Local pointers: [Assistants](#assistants).

## What gcportrait is and is not

gcportrait renders a Google Cloud organisation, folder or project as a Google Cloud-style architecture diagram
from Cloud Asset Inventory (CAI) data, and answers one question: what does this environment look like right
now, and what changed in the last five weeks?

- **A viewer, not a drawing tool.** Nothing can be dragged, added or edited. Every box on the screen is a real
  asset that Cloud Asset Inventory returned, and every arrow is a reference that exists in that asset's JSON,
  because a picture of an environment is only useful when it can be trusted.
- **Its users.** The *explorer*, a cloud engineer or architect who opens a scope to understand or document it;
  the *reviewer*, a security or compliance person who checks exposure (public addresses, peerings, perimeters,
  Shared VPC); the *contributor*, who adds an asset type or a view or fixes the layout and must be able to
  test without access to Google Cloud.
- **What version 1 does.** It connects (sign-in, a scope, the missing permissions with the exact `gcloud`
  commands, your own account or the instance's service account), imports (a live pull or export files, both
  into one Snapshot), renders, explores (lenses, focus views, filters, drill-in, search, the selection trace,
  the details drawer with a Cloud Console link), moves through 35 days of history, exports SVG, PNG and
  draw.io, draws any view on the server through its API, follows the system theme in light and dark, works on
  phones, tablets and desktops with the same controls, ships a demo, and is self-hosted with one installer
  line and a published image.
- **Three ways to use it**, with the same diagrams in each: self-hosted (one Cloud Run service in a project of
  the operator's), the web app, and the API (`POST /api/render`).
- **Not planned:** editing diagrams, cost data, IAM policy analysis beyond showing identities, multi-cloud,
  storing snapshots on a server, and real-time feeds. Features wanted but not scheduled are under "Later" in
  [docs/backlog.md](docs/backlog.md).
- **An independent open-source project**, not affiliated with Google ([Non-affiliation, brand and
  legal](#non-affiliation-brand-and-legal)), licensed under the MIT License with its name and icon reserved
  ([Licence and dependencies](#licence-and-dependencies)).

## Product rules

- **Every control, menu item, page, dialog and keyboard action at every width**, by touch and keyboard under
  the same accessible name, never desktop-only: people open views anywhere, and missing controls make
  actions impossible. `frontend/src/ui/screen.ts`: phone ≤47.99rem in portrait and landscape, tablet
  48–79.99rem, desktop ≥80rem. Folding and touch follow frontend/AGENTS.md, "Phones, tablets and desktops";
  coverage follows e2e/AGENTS.md, "Widths, gestures and axe". Website works on phones (`pnpm
  website:mobile`).
- **Both themes pass visual and contrast checks**, because users and documents come in both.
- **First-class demo**: seeded, deterministic, realistic synthetic S, M, L and XL organisations, 35 days of
  CAI NDJSON from demo-data, for tests, screenshots, website, agent checks and Try the demo; no real
  inventories. `pnpm dev:demo` needs no backend, `/api` or account. Servers follow e2e/AGENTS.md, "What the
  suite runs against".
- **35 daily ticks**, today plus 34 days at 00:00 UTC, latest "now", never future. Read when settled via
  `assets.list` at readTime, because each day reads the whole scope; caching, prefetch, cancellation, graph
  diff and extra ticks follow the cai-ingestion skill §5 and docs/timeline.md.
- **Every surface says "as of", never "live"**, naming read time: CAI delays products by hours, IAM by up to
  seven days, so "live" overpromises.
- **The URL hash holds the full ViewSpec through the model codec**, preserving reloads and sharing;
  recipients need the same snapshot.
- **The render API and `pnpm render` never confirm large snapshots**; the app guard follows
  frontend/AGENTS.md, "Snapshots".
- **Filters compose in every focus view and drill-in**, not just overview, lest silently stopping mislead; a
  new lens, focus or filter gets graph table-driven composition tests.
- **Unknown types render** generic cards, product or category icons and `parent` containment
  (gcp-diagram-layout skill §2 rule 6): Google adds types; precision may be absent, assets never are.
- **Source URL**: `/api/config.sourceUrl` (`SOURCE_URL`) or build-time demo `VITE_SOURCE_URL`, default this
  repo; forks and modified instances use their source. The footer follows frontend/AGENTS.md, "The source
  link".

## Data and graph semantics

- **Catalog and icons data, not code maps**, define types, relations, lenses, icons, products, console
  templates, styles and domain and address extraction: a second source drifts.
- **Package-boundary types:** one zod schema in `@gcportrait/model`, inferred by `z.infer`, never
  duplicated.
- **One ingest streaming NDJSON parser and Snapshot** for paginated streamed `assets.list` (`POST
  /api/assets/stream`) and exports (drop or token-read `gs://`, `POST /api/export/read`). Downstream
  distinguishes origin only through Snapshot `source` (`api`/`export`/`demo`). Synchronous list reads any of
  35 days; exports serve quota-heavy sizes.
- **The UI names the export read-time source**, since files carry none (packages/AGENTS.md, "Catalog and
  graph semantics").
- **Synthetic fixtures, examples and demos**: `example.com` or `example.org`, project numbers <100000000000,
  documentation IPs `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` or private ranges. Tests reject
  real-looking data; PRs never name real scopes, tested or not: inventories leak others' names, addresses
  and structure.

`packages/AGENTS.md` governs catalog/graph semantics, layout and budgets.

## Exports and the render API

- **One drawing: SVG, PNG, draw.io**, version 1 essentials because pictures are used elsewhere. PNG:
  2×/requested 3×, theme background. The gcp-diagram-style skill §7–8 governs the SVG-contained legend and
  title, resolved CSS, inline icons and the three title lines on canvas and every export. `<desc>`: neutral
  scope, lens, read time, timeline-day changes and "Drawn with gcportrait." only.
- **API `POST /api/render` uses `pnpm render`'s code**, all three formats, for scriptable exports.
  frontend/AGENTS.md, "Exports", governs menu and translator; packages/AGENTS.md, "The render library", the
  shared renderer and rasteriser; backend/AGENTS.md, "The render API", the route; docs/api.md is reference,
  docs/export.md guide.

## Style and accessibility

- **WCAG 2.2 AA** in every page, diagram, theme and width; only decorative subnet and VPC strokes are
  excepted, their title text and card strokes pass. Checks follow e2e/AGENTS.md, "Widths, gestures and axe".
- **44×44 CSS-pixel targets below desktop** (WCAG 2.5.5), except sentence links and code-line fields;
  persistent bars pad `env(safe-area-inset-*)`: imprecise fingers, notches, rounded corners and home
  indicators need clearance.
- **Colour never stands alone**: edge dash or head, zone title position or badge identify them too.
- Google's icon rules: [Non-affiliation, brand and legal](#non-affiliation-brand-and-legal).
- **Self-host Roboto and Roboto Mono**, never a CDN: CSP and offline demo forbid it; layout uses their
  metrics. Themes follow frontend/AGENTS.md, "Diagram and themes"; palettes and checks follow the
  gcp-diagram-style skill.

## Security and privacy

The seven principles, numbered so that [docs/threat-model.md](docs/threat-model.md) and
[docs/security.md](docs/security.md) can cite them ("AGENTS.md, Security and privacy, principle 4"):

1. **Asset data never leaves the person's browser except to be fetched.** The backend streams it from Google
   and forgets it; snapshots, saved views, cached days and preferences live in the browser's IndexedDB. An
   asset inventory lists an organisation's projects, networks, addresses and identities, and storing it would
   make every instance a data processor.
2. **Tokens are never stored, never logged and never put in URLs.** A token in a file, a log line or a URL
   outlives the session it was given for.
3. **The backend is not an open proxy**: an upstream host allowlist, schema-validated request bodies and rate
   limits.
4. **Service-account mode is gated by the caller's own access to the scope**, so the instance's account never
   reads a scope for someone who could not see it.
5. **Exports are downloads the person starts.** gcportrait uploads nothing anywhere on its own, and the render
   API draws what its caller sends and keeps nothing.
6. **The demo data is synthetic**, and the test suite fails when a fixture holds anything that looks like a
   real project number or an email domain outside `example.com` and `example.org`.
7. **Dependencies pass the licence allowlist and deny list (`pnpm run licenses`), the dependency audit
   (`node scripts/check-audit.mjs`) and Dependabot.**

### Tokens

- The app sends the person's Google access token in `X-Gcportrait-Token` (the bare token) on every `/api/*`
  call, through the one function that adds it (`fetchWithToken`, `frontend/src/auth/fetch.ts`), and never in
  `Authorization`, because Identity-Aware Proxy treats `Authorization` as its own and user mode has to work
  behind it.
- The backend reads `X-Gcportrait-Token` first and accepts `Authorization: Bearer` only on a request without
  it (the path for scripts against a public instance). A malformed `X-Gcportrait-Token` is refused with 401
  and never replaced by what `Authorization` holds.
- Neither header is ever logged: the request logger keeps the values of an allowlist of harmless headers only,
  and both names are on pino's redaction list.
- The token is not a cookie: the browser never stores it or sends it on its own, and the backend answers no
  CORS request. API requests are `cache: "no-store"`, and every `/api/*` answer carries `cache-control:
  no-store`.
- In the browser the token lives in memory only. Upstream, the backend forwards it to Google as
  `Authorization: Bearer`.

### Quota project and the permission check

- In user mode `quotaProject` is a required, schema-validated project id in every request body that leads to
  a CAI call, and a request without it is refused (400).
- The candidates, in order, are the scope itself when it is a project and the project the person picked (the
  app remembers the last pick per scope); the instance's project is never a candidate.

The backend's headers, probes and error classification follow [backend/AGENTS.md](backend/AGENTS.md),
"Quota project and the permission check". Its hardening and service-account gate are in the same file.

### OAuth scopes

Sign-in requests `https://www.googleapis.com/auth/cloud-platform.read-only`,
`https://www.googleapis.com/auth/cloudasset` and `https://www.googleapis.com/auth/userinfo.email`, never
`cloud-platform`, which would grant read-write access to every Google Cloud API the person can reach. Cloud
Asset Inventory refuses a token with `cloud-platform.read-only` alone and Resource Manager one with
`cloudasset` alone, so both are needed. A grant missing either Cloud scope is revoked at once and the person
is asked again; without `userinfo.email` sign-in still works, without the address in the account menu.

## Modes and hosting

- **Ways in**: own account (default, no third-party grant), operator-enabled SA (team's shared grant),
  exports, demo. One code path from CAI onward draws identical diagrams; only reader identity differs
  (backend/AGENTS.md, "The service-account gate").
- **One Cloud Run service and image per installation**, serving API and SPA.
- **Demo-only** (`DEMO_ONLY`) needs no sign-in; `/api/config` has `demoOnly: true`, no OAuth client, SA or
  render API. See backend/AGENTS.md, "Demo-only mode and legal pages", and infra/AGENTS.md, "Self-hosting".
- **Static demo**, `gcportrait.app/demo/`, app demo-only build (`pnpm demo:static`, `VITE_STATIC_DEMO=1`,
  `/demo/` base), with website; built-in config equals demo-only `/api/config`, route copies of `index.html`
  byte-identical. Backend demo CSP in `<meta>` excludes unsupported `frame-ancestors`, beside `<meta
  name="referrer" content="no-referrer">`; no sign-in code. No server means no cost or storage.
- **Hosted surfaces.** The maintainer hosts only the website `gcportrait.app` (Astro on GitHub Pages) and its
  static demo: no sign-in instance, no accounts, no service and so no terms of use. The project has no
  revenue, so the maintainer runs nothing that holds accounts, tokens or anyone's data. Self-hosters who
  enable sign-in run their own instance with their own OAuth client.
- **No telemetry, except the website's page views.** The app, the static demo and every self-hosted instance
  send no usage data, error reports or page views anywhere: an instance runs in someone else's project and
  must never phone home. The website's analytics follow
  [website/AGENTS.md](website/AGENTS.md), "Analytics".
- **Legal pages.** The Impressum and the privacy notice are on the maintainer's website, and the website, the
  static demo and the app's footer link them. An instance's links or served pages follow
  [backend/AGENTS.md](backend/AGENTS.md), "Demo-only mode and legal pages". Legal texts never live in the
  repository, because they name a person and an address and every operator needs their own.
- `infra/deploy.sh` creates the account with no project roles; customers grant it `roles/cloudasset.viewer`
  only, on folders or projects rather than the organisation where they can, since every member of a domain
  can usually `get` its organisation.
- **Self-hosting** follows infra/AGENTS.md, "Self-hosting", docs/self-host.md and docs/self-host-options.md.
  The Cloud Shell tutorial (docs/cloudshell-tutorial.md) and Run on Google Cloud (`app.json`,
  `infra/cloud-run-button.sh`) sit beside README and guide manual steps. Website placement, presentation,
  metadata and demo links follow website/AGENTS.md, "The site".

## Non-affiliation, brand and legal

gcportrait draws Google Cloud-style diagrams with Google's product icons, which invites the assumption that it
is a Google product; nothing may suggest Google's endorsement. The wording is fixed in three texts, defined
once in `frontend/src/branding.ts`; every other copy (the backend, the tooling, the image, the infra scripts,
the website) is compared with it by a test.

- **Footer notice**, with the maintainer's name linked to <https://florian-chrometz.de> (new tab,
  `rel="noopener"`, named "Florian Chrometz (personal website)"):

  > Not affiliated with Google / Google Cloud. gcportrait is an independent open-source project by
  > Florian Chrometz

- **Long form:**

  > gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and
  > is not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product
  > icons are trademarks of Google and are used under Google's icon usage terms.

- **Tagline**, the last line of a diagram's title block: `gcportrait.app - Visualize your Google Cloud
  Infrastructure`. It is branding, not a statement.

Where each goes:

- **The footer notice** is in the app's footer on every route (next to the "Source (MIT)" link) and the
  website's footer on every page.
- **The long form** is in every long-form text: the root README (the box under "Not affiliated with Google"),
  the docs index, the Cloud Shell
  tutorial, [packages/icons/README.md](packages/icons/README.md), the release notes, the image's
  `org.opencontainers.image.description` label, the close of the infra scripts' and the installer's `--help`,
  the Connect page's About block, and on the website the author section (the closing paragraph of
  [docs/author.md](docs/author.md)) and the licence page. The guides and the contributing page carry it in the
  footer only: a page says it once.
- **Nowhere else.** No drawing carries a statement: not the canvas, an exported SVG, PNG or draw.io file, a
  render of `pnpm render`, the render API or the layout's debug script, nor the website's sample exports. Nor
  does a command-line banner, an API header, the backend's `hostedBy` line ("Hosted by NAME." alone, or null),
  the Permissions page, a snapshot file or the website's metadata (a meta tag, the JSON-LD). A reviewer who
  finds it there treats it as a defect.

Rules that go with it:

- Never call gcportrait official, Google's or verified.
- Google is "Google" or "Google Cloud", never named with its company suffix, anywhere.
- `HOSTED_BY` may not name Google.
- Google's icons are used unmodified under Google's icon usage terms, documented in
  [packages/icons/README.md](packages/icons/README.md).
- The maintainer is named only in the footer notice, the author sections (the README's
  "Author", [docs/author.md](docs/author.md) and the website's author section) and copyright notices
  (`LICENSE`, the licence sections that quote it, the package metadata's `author`) and the structured data
  that names a page's author for search engines, and never by any programme membership.
- The gcportrait name and the gcportrait icon are not covered by the MIT License: "They identify this project
  and may not be used to present other software or services as gcportrait or as endorsed by it; forks must use
  their own name and icon." [brand/LICENSE.md](brand/LICENSE.md) holds the text; `brand/icon.svg` is the one
  source of the mark (the favicons, the website's logo, the app's mark, the wordmarks;
  [brand/README.md](brand/README.md)).

## Licence and dependencies

- **gcportrait's own work, its code, its texts and its images, is licensed under the MIT License**, `MIT`,
  "Copyright (c) 2026 Florian Chrometz" ([LICENSE](LICENSE)), so that anyone can use, study, change, embed and
  run it, hosted or not, commercially or not. The name and the icon are reserved
  ([Non-affiliation, brand and legal](#non-affiliation-brand-and-legal)).
- **Every new text source file starts with the SPDX line for `MIT`** within its first 10 lines, in the
  comment form of its type, so the licence of every file is machine-readable: use the forms, placement and
  exemptions in docs/contributing.md, "The SPDX header". `.nvmrc` is exempt because not every Node version
  manager accepts comments. Should the project licence change, scripts/set-license.mjs rewrites every
  header, `license` field and `LICENSE`.
- **Third-party material keeps its own terms**: the npm dependencies, the self-hosted Roboto fonts (SIL Open
  Font License 1.1), Google's product icons (Google's icon usage terms) and the verbatim licence texts in
  `scripts/licenses/`. [THIRD_PARTY.md](THIRD_PARTY.md) lists every category; its dependency table is
  generated.
- **Dependencies stay permissive.** `pnpm run licenses` allows MIT, MIT-0, ISC, 0BSD, BSD-2-Clause,
  BSD-3-Clause, Apache-2.0, CC0-1.0, Unlicense, BlueOak-1.0.0, Python-2.0 and MPL-2.0 (its copyleft is
  file-scoped), and denies, each with its reason, the GPL family in every variant (the library and the network
  forms included), SSPL, CC-BY-SA, CC-BY-NC, EUPL, OSL, CPAL, EPL, CDDL, "SEE LICENSE IN", UNLICENSED,
  proprietary, unknown and absent licences: an MIT project cannot carry copyleft that reaches beyond the
  dependency's own files, or its combined work could no longer be offered under the MIT License.
  `node scripts/check-licenses.mjs --list-rules` prints the rules with their reasons.
- **The one exception is the font licence**: OFL-1.1 is accepted for `@fontsource/roboto` and
  `@fontsource/roboto-mono` only, whose font files are copied into the build; each package's own `LICENSE`
  ships next to them (`dist/licenses/`). OFL-1.1 binds the font files, not the software that uses them.
  Bundling another font extends both lists and this rule.
- **The names of denied licences** appear only in the deny list (`THIRD_PARTY.md`,
  `scripts/check-licenses.mjs` and its test) and in the verbatim licence texts, so the project's own licence
  is never in doubt.
- **Contributions** are accepted under the MIT License, inbound = outbound, with the pull-request template's
  provenance statement; there is no contributor licence agreement, and with a permissive licence none is
  needed. Contributors keep the copyright in what they write.
- **Original work only.** Nothing is copied, ported or paraphrased from another licensed project; a solution
  that reads like a translation of someone else's code is rejected and started over, because whoever receives
  gcportrait must be able to rely on its own licence alone. Every pull request states "Original work; nothing
  copied from other projects."
- **No Go files, no Graphviz files (`.dot`, `.gv`), no Gizmo queries and no symbolic links**; the provenance
  check refuses them.

## Architecture and code

- **TypeScript only**, Node `^22.22.2` (`.nvmrc`: `22`, `.npmrc`: `engine-strict`), pnpm workspace pinned by
  `packageManager` and Corepack: one language and types across browser, backend and tooling. Shell only in
  infra or scripts.
- **Strict**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`,
  `erasableSyntaxOnly` (no enums, namespaces or constructor parameter properties), typescript-eslint
  `strictTypeChecked`, no `any`. TypeScript stays 6.0.x until typescript-eslint supports newer.
- **NodeNext** (`tsconfig.node.json`, `.js` relative imports) except frontend bundler resolution; `pnpm
  typecheck` is `tsc -b`, new packages join root `tsconfig.json` references.
- **UTF-8, no BOM or NUL**, per `.editorconfig`, so tools read what editors show. Binary extensions hold
  their format; register new ones in `BINARY_EXTENSIONS` (scripts/lib/repo-files.mjs). Provenance enforces
  both.
- **Downward graph**: `model ← catalog ← graph ← frontend`; packages import only model, graph also catalog.
  Development-only: graph tests use demo-data; render-scene uses demo-data and ingest; layout tests and
  debug-svg use graph, catalog and demo-data; ingest tests use demo-data, XL exports for the budget. Outside
  libraries, these stay cycle-free and independently testable.
- **Upward exception**: Node render imports `frontend/src/headless.ts` for app components/readers, never
  vice versa. Render-cli and backend jobs use render; nothing imports render-cli. Backend job and worker
  bundle into `dist/render-worker.mjs`, never `dist/server.mjs`.
- **Package-name imports**, `@gcportrait/<pkg>` via `src/index.ts`/`testing`, never deep/relative
  cross-package; eslint.config.js enforces direction.
- **Workers** run ingest, graph, layout and demo (data worker; demo worker per Try-the-demo job); UI only
  renders, never loads zod (zod-free codec/vocabularies).

## Quality gates, testing and CI

- **Before every push run `pnpm check`**, whose checks the Commands table lists. App work also runs build,
  size and e2e; visual work renders M in both themes and inspects it. SPA budgets follow frontend/AGENTS.md,
  "Bundle budgets".
- **Pure packages: tests first; catalog: fixtures first; renderers: goldens and baselines**
  (contributor-workflow skill §4).
- **Intentional baselines/goldens only**, update command and PR diff explanation; render goldens exact,
  platform differences need platform goldens, never tolerance.
- **Generate, never hand-edit; check staleness**: catalog, metrics, icons, media, exports, lens tables,
  THIRD_PARTY dependency table, goldens and baselines, by their commands.
- **Audit fails high/critical advisories** unless `scripts/audit-allowlist.json` accepts one with an expiry.
- **Dependabot never closed unread**: adopt main (merge/checked commit), or decline with reason in
  docs/backlog.md; findings belong in the tree from the start.

CI follows .github/AGENTS.md, "CI" and "A change of only docs and media"; legs follow e2e/AGENTS.md, "CI
legs".

## Releases

- **Fixed semver through changesets**, all workspace packages private, never npm (`.changeset/config.json`).
  Behavioral PRs add user-facing changesets; version and tag per contributor-workflow skill §7. CHANGELOG.md
  records releases.
- **Tagged releases pass check, build and size**, smoke-test one image for linux/amd64 and linux/arm64,
  publish `ghcr.io/florianchrometz/gcportrait` tags `X.Y.Z`, `X.Y`, `latest` (newest only, never
  prerelease). Package is public so self-hosters' Artifact Registry pulls anonymously. Manual runs publish
  `dev` only.
- **Release artifacts**: per-platform SPDX SBOM, CHANGELOG section notes (long form first, installer line,
  image tags/digest), installer deploy scripts and checksums.txt.
- **Prereleases trial their release**: `vX.Y.Z-rc.1` gets its version tag only, no `latest`/`X.Y`; GitHub
  prerelease, not latest; use `X.Y.Z` notes absent its own section, so the pipeline can be checked
  beforehand.

Workflow execution and website deployment follow .github/AGENTS.md, "Releases"; setup and steps:
docs/contributing.md §9.

## Documentation

- **User guides are indexed in docs/README.md; each package's README is its reference.**
- **What is, never history**: no run, machine, timing, review or verification records, decision or change
  dates or replaced behavior. Figures are current values; user-docs/provenance enforce this: the repo is all
  readers see.
- Guides say what to do and link explanations.
- **Markdown: 110 columns**, hand-wrapped, not Prettier, with SPDX; except tables, URL lines, fences,
  frontmatter, one-word or one-HTML-tag lines. user-docs checks it.
- **Placeholders: `YOUR_` capitals**, one word (`YOUR_PROJECT`), model `COMMAND_VARIABLES`; website fields,
  user-docs checks. Other capitals stay text.
- **Each user guide opens with the long form**; registration follows docs/AGENTS.md, "User guides".
- **README front page** follows order/content in scripts/readme.test.ts: purpose/quick starts first,
  statements last, since visitors decide fit/how to start on the first screen. Keep badges; illustrate every
  feature with a still or animated demo from docs/media/, in both themes.

## How to work a task

1. Start from an issue or backlog item; read needed skills, affected folder rules and package READMEs.
2. Use a topic-named branch or worktree; follow [Quality gates, testing and
   CI](#quality-gates-testing-and-ci).
3. Use the PR template: what, why, commands and results, screenshots, changeset, provenance; remove the
   completed backlog item. One small feature or function per PR for quick review and merge; propose rewrites
   in an issue, then split them.
4. Report changes, checks, failures and exclusions honestly; a human or agent reviews acceptance, skills and
   rules before merge.

**Never force-push or rewrite main**: clones and forks must stay valid; only the maintainer decides history
cuts.

## Skills

Load `.agents/skills/NAME/SKILL.md`: **contributor-workflow** for every task, review or release;
**gcp-diagram-style** for visuals, exports, accessibility or render review; **gcp-diagram-layout** for
containment, layout, routing, disclosure, performance or layout review; **gcp-asset-catalog** for types,
relations, lenses, icons, console links or coverage; **cai-ingestion** for CAI, parsing, permissions, quota,
timeline or demos.

## Assistants

- **Pointers contain no rules**, just ignored tool imports and references, to avoid drift. Discovery,
  pointer text and safe setup procedures: .agents/README.md; tool sources: scripts/agents-setup.mjs.

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
| Dependency licences (`run` is required): allowlist, deny list, the project licence's compatibility | `pnpm run licenses` (`--write` regenerates THIRD_PARTY.md, `node scripts/check-licenses.mjs --list-rules` prints the rules with reasons) |
| Dependency audit: high and critical advisories fail unless `scripts/audit-allowlist.json` accepts them with an expiry (needs the network; CI's `audit` job; docs/security.md) | `node scripts/check-audit.mjs` |
| Build, then the SPA's size budgets (frontend/AGENTS.md, Bundle budgets) | `pnpm build`, then `pnpm size` |
| End-to-end + accessibility | `pnpm e2e` (once per machine: `pnpm --filter @gcportrait/e2e install-browsers`; `--project chromium-phone --project chromium-tablet` for the app's flows by finger on a phone and a tablet alone) |
| Add a changeset | `pnpm changeset` |
| Write the local, git-ignored pointer files that lead an assistant to the AGENTS.md files and the skills (Assistants) | `pnpm agents:setup` (`--tool claude`, `--force`, `--help`) |
| Draw a demo view as the app's renderer draws it (PNG, SVG and draw.io, byte-stable; the drawing carries no non-affiliation line) | `pnpm render --fixture M --lens networking --png out.png` (`--theme dark`, `--detail`, `--svg`, `--drawio`, `--strict`, `--compare`, `--all`, `--help`; without `--png`/`--svg`/`--drawio` it writes `out/render/`) |


Other commands are in each folder's AGENTS.md, "Commands". References: docs/packages.md and
docs/configuration.md.

## Names that never appear

Provenance refuses the names and phrases in docs/contributing.md, "Provenance", in all file contents and
paths. All tracked and nonignored files are read, any encoding and binary metadata included. Refused strings
are assembled or known by SHA-256, never spelled out. `node scripts/check-provenance.mjs --list-exempt`
labels the rules; `--digest-of <phrase>` prints a deny entry. State what a thing is or does; cite the rule's
file and heading.
