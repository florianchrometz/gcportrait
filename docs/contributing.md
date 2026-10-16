<!-- SPDX-License-Identifier: MIT -->

# Contributing to gcportrait

This guide takes you from a fork to a green `pnpm check` and an open pull request. It is written for people
and AI assistants alike. [AGENTS.md](../AGENTS.md) holds every rule of the project in one place, and
[.agents/skills/contributor-workflow/SKILL.md](../.agents/skills/contributor-workflow/SKILL.md) is the
checklist version that reviewers use.

> What gcportrait does, with its features, screenshots and animated demos, is on the [root
README](../README.md), whose "Roadmap" section says what comes later; [backlog.md](backlog.md) lists the open
work, and [AGENTS.md](../AGENTS.md) every rule. [packages.md](packages.md) maps the packages.
Not ready for a pull request? Open an issue from one of the forms (a bug report, a feature request or an
asset type request; the chooser also links the user guides and the sign-in-free demo), and reproduce a
problem in demo mode first: the demo organisations are synthetic and safe to share.

## 1. What you need

- **Git** and a GitHub account to fork the repository.
- **Node.js 22, version 22.22.2 or newer.** `.nvmrc` names `22`, so `nvm install` (or `fnm install`) in the
  repository picks the latest 22.x release. The root `package.json` requires `^22.22.2` and `.npmrc` sets
  `engine-strict=true`, so `pnpm install` refuses an older Node instead of failing later in odd ways.
- **pnpm 10.18.1**, the version pinned in the `packageManager` field of the root `package.json`. Node 22 ships
  Corepack; run `corepack enable` once and every `pnpm` command in this repository uses exactly that version.
- **No Google Cloud account, project or credentials.** Everything in this guide runs on synthetic data.

pnpm runs package scripts through its cross-platform shell emulator (set in `.npmrc`), so scripts such as
`VITE_DEMO=1 vite` work the same on macOS, Linux and Windows.

## 2. Get the code and install it

```sh
git clone https://github.com/YOUR_GITHUB_USER/YOUR_FORK.git
cd YOUR_FORK
corepack enable
pnpm install
```

A clone is for working on gcportrait. Running it needs none: self-hosters install a release with one line
(`curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project YOUR_PROJECT`,
[self-host.md](self-host.md)). To build from source without a fork of your own, clone the project's repository
the same way: `git clone https://github.com/florianchrometz/gcportrait.git`.

`pnpm install` installs every workspace package from the lockfile: `frontend/`, `backend/`, `e2e/` and
`packages/*`. CI installs with `pnpm install --frozen-lockfile`, so commit `pnpm-lock.yaml` whenever you add,
remove or upgrade a dependency. pnpm 10 runs no dependency install scripts unless `pnpm-workspace.yaml` allows
them.

### With an AI assistant

[AGENTS.md](../AGENTS.md) and the skills under `.agents/skills/` are the one source of instructions for every
assistant; Codex CLI, Cursor and GitHub Copilot read both as they are. The repository commits no file of a
particular tool. `pnpm agents:setup` writes the local, git-ignored pointer files that close the gaps, each one
paragraph that points to AGENTS.md and the skills: `CLAUDE.md` with an `@AGENTS.md` import and a link per
skill under `.claude/skills/` for Claude Code, `GEMINI.md` with an `@./AGENTS.md` import for Gemini CLI, a
Cursor rule and Copilot's instructions file. It never overwrites a file of yours without `--force`, and
running it again changes nothing; `--tool claude` writes one tool's files only ([AGENTS.md](../AGENTS.md),
"Assistants"). A rule goes in AGENTS.md, never in a pointer file.

## 3. Run the app

| Command | What starts | Open |
|---|---|---|
| `pnpm dev:demo` | The single-page app in demo mode: no backend, no API calls, no Google account. | <http://localhost:5174> |
| `pnpm dev` | The app (Vite, which proxies `/api` to the backend) and the backend (Fastify under `tsx watch`, pretty logs). | <http://localhost:5173>; the backend answers on <http://localhost:8080/healthz> |

Stop either with Ctrl+C. The app draws the synthetic demo organisations as diagrams: open
<http://localhost:5174/diagram#snapshot=demo:M> (or press "Try the demo" on the Connect page, or pick S, M or
L from the Snapshot menu), then switch the lens, focus, filters and detail level in the top bar, press `/` to
search, select a resource for its details drawer, click a collapsed zone to open it, drill in, export SVG or
PNG from the Export menu, and switch light, dark or system from the top bar's Theme menu or on the Settings
page. Every view is in the URL hash, so a reload keeps it, the timeline's day included: the bar at the bottom
moves through the demo's 35 days (`[` and `]`, the slider, playback), marking what was added, removed or
changed since the day before ([timeline.md](timeline.md)). `pnpm dev` reads `backend/.env` if it exists;
`backend/.env.example` documents every variable, and none is needed for local development.

The pipeline also runs without the app. `pnpm render-scene --fixture M --lens networking` ingests the
synthetic organisation M, builds its graph and the scene for a view, and prints a summary; `--help` lists the
view options (focus, drill-in root, filters, detail level, JSON output). `pnpm render --fixture M --lens
networking --png out.png` lays the same view out and draws it exactly as the app does (`--theme dark` for the
dark theme, `--help` for the rest); it is how contributors and agents look at a visual change.
[packages.md](packages.md) explains each step.

## 4. The checks

### `pnpm check`

Run it before every push. It runs these steps in order and stops at the first failure:

| Step | Runs | Fails when |
|---|---|---|
| `format:check` | `prettier --check .` | a TypeScript, JavaScript, JSON, YAML, CSS or HTML file is not formatted. Markdown is excluded: it is hand-wrapped prose at 110 columns. |
| `lint` | `pnpm catalog:build`, then `eslint . --max-warnings=0` | any lint rule fails: typescript-eslint's strict type-checked rules, `any`, an import across a package boundary. |
| `typecheck` | `pnpm catalog:build`, then `tsc -b` | any project listed in the root `tsconfig.json` has a type error. |
| `test` | `pnpm catalog:build`, then `vitest run` | a unit test fails in any package or in the repository tooling (`scripts/**/*.test.ts`). |
| `catalog:check` | the catalog package's `check` script (`packages/catalog/tooling/check.ts`) | the asset catalog is invalid: a schema error in a YAML file, a type described twice, a type missing from the newest official list, an official type neither mapped nor listed in the `known-unmapped/<group>.yaml` that owns it, a rule without a proving fixture, a fixture with real-looking data, or a committed `src/generated/` file. It also prints the coverage report, per group. |
| `provenance` | `node scripts/check-provenance.mjs` | a provenance rule is broken (section 5). |
| `licenses` | `node scripts/check-licenses.mjs` | an installed package has a licence on the deny list (copyleft that would reach gcportrait's combined work, non-commercial, proprietary, unknown) or outside the allowlist, or `THIRD_PARTY.md` is stale. |

A green run ends like this (the counts change as the project grows):

```text
catalog:check: OK.
provenance: OK. 2483 files scanned, 1373 SPDX headers (MIT) verified; no forbidden names, banned terms or banned files.
licenses: project licence MIT (the "license" field of the root package.json).
licenses: compatibility: every accepted dependency licence is permissive, file-scoped weak copyleft (MPL-2.0) or, for the self-hosted font packages only, OFL-1.1; all are compatible with MIT, and none requires gcportrait to publish its code or relicense its combined work.
licenses: OK. 565 installed packages are under allowed licences; the workspace packages (14) declare MIT; THIRD_PARTY.md is up to date.
```

### Fixing a failing step

- **Formatting:** `pnpm format` runs `prettier --write .`; review the diff before committing.
- **One package at a time:** `pnpm --filter @gcportrait/<package> lint`, `... typecheck` or `... test`, for
  example `pnpm --filter @gcportrait/model test`.
- **One test project from the root:** `pnpm test --project <name>`, where the name is `model`, `demo-data`,
  `ingest`, `catalog`, `graph`, `layout`, `icons`, `render-cli`, `frontend`, `backend` or `tooling`. `pnpm
  test:watch` re-runs tests as you edit.
- **Coverage:** `pnpm test --coverage` writes a report to `coverage/`; it is not enforced repository-wide yet.
  Some packages enforce their own thresholds when run with coverage: `@gcportrait/model` 100 % of its schemas
  and codec, `@gcportrait/ingest` and `@gcportrait/graph` near 100 % (see their `vitest.config.ts`), for
  example `pnpm --filter @gcportrait/model test -- --coverage`.
- **The asset catalog:** the compiled catalog (`packages/catalog/src/generated/`) is a git-ignored build
  artefact that `pnpm install`, `lint`, `typecheck` and `test` rebuild; after editing YAML under
  `packages/catalog/`, run `pnpm catalog:check` (`--group <group>` for one authoring group's files only). The
  [gcp-asset-catalog skill](../.agents/skills/gcp-asset-catalog/SKILL.md) is the step-by-step guide and the
  catalog README's "Authoring a group" the group workflow.
- **Licences:** after you add, remove or upgrade a dependency, run `pnpm run licenses --write` to regenerate
  the dependency table in `THIRD_PARTY.md`, and commit it. `--write` cannot fix a licence on the deny list or
  outside the allowlist: choose another package, or propose a change to the licence rules
  ([AGENTS.md](../AGENTS.md), "Licence and dependencies"). The report names the project licence
  (`MIT`) and why every allowed licence is compatible with it; `THIRD_PARTY.md` has the reasoning.
  Always type `pnpm run licenses`; plain `pnpm licenses` is pnpm's own built-in command.
- **Provenance:** every problem is printed as `path:line  [rule] message` (the rule is one of
  `forbidden-name`, `banned-term`, `banned-file`, `symlink`, `spdx-header`, `plan-id`, `licence-name`,
  `encoding`), and the message says what to add or remove. Section 5 explains the rules;
  `node scripts/check-provenance.mjs --list-exempt` prints them, the refused names and phrases as labels only.

### Continuous integration

Every pull request and every push to `main` runs two workflows. **CI** (`.github/workflows/pr.yml`) starts all
its jobs at once; each one installs the dependencies itself from the pnpm store cache, which `pnpm-lock.yaml`
keys, so a run takes as long as its slowest job. **Website** (`.github/workflows/pages.yml`) builds and checks
the site again (and its generated media, as a warning) and deploys it from `main` once the maintainer has
switched deployment on ([website.md](website.md)). The CI jobs:

| Job | Runs |
|---|---|
| `lint` | `pnpm format:check`, then `pnpm lint` |
| `typecheck` | `pnpm typecheck` |
| `unit (layout)`, `unit (frontend)`, `unit (all other projects)` | `pnpm test --project layout`; `pnpm test --project frontend`; `pnpm test --project '!layout' --project '!frontend'`, which is every other project, a new one included |
| `layout-budget` | `pnpm --filter @gcportrait/layout test:budget`, then the runner's CPU and the `bench` table in the job summary. **Non-blocking**: the strict budgets describe a quiet M1-class machine, so the runner's figures are expected above them and a miss only warns, while `unit (layout)` enforces twice the budgets |
| `catalog-check` | `pnpm catalog:build`, then `pnpm catalog:check` |
| `build` | `pnpm build:app` (every workspace with a build script but the website), then `pnpm size` |
| `e2e (desktop 1/2)`, `e2e (desktop 2/2)` | `pnpm e2e --project chromium-live --project chromium --shard=N/2`, Chromium: the desktop specs, in demo and normal mode |
| `e2e (phones and tablets 1/2)`, `e2e (phones and tablets 2/2)` | `pnpm e2e --project chromium-phone --project chromium-tablet --project mobile --shard=N/2`, Chromium: every project but the desktop's, a new one included: the app's phone and tablet check (`mobile`) and its flows by finger on a phone and a tablet (`chromium-phone`, `chromium-tablet`) |
| `website` | `pnpm website:build` and `pnpm website:check`, then `pnpm --filter @gcportrait/website mobile --only layout` |
| `provenance` | `pnpm provenance`, then a self-test: a planted banned file (a `.go` file) must fail the guard |
| `licenses` | `pnpm run licenses` |
| `audit` | `node scripts/check-audit.mjs` (asks the npm registry) |
| `workflows-and-shell` | `actionlint`; `shellcheck -x infra/*.sh`; every other shell script with `shellcheck -x --severity=warning` |
| `required` | nothing of its own: green only when every job above but `layout-budget` succeeded |

GitHub's standard runners have 4 vCPUs for a public repository and 2 for a private one, and Playwright runs
half as many workers as there are vCPUs. Each job also spends about a minute on the checkout, Node and the
install from the cache, and the e2e legs and `website` about another minute on Chromium's system libraries.
The four e2e legs are the longest jobs, which is why the suite is split in four. `--shard` splits a leg's
tests by count, in the order of the projects in `e2e/playwright.config.ts`, which puts each leg's lighter
projects first so that both of its shards get a share of the slow tests; the run's page shows each job's time.

Some of these gates are not part of `pnpm check`; run these three locally when you touch the app:

| Command | What it does |
|---|---|
| `pnpm build` | Builds every workspace that has a build script: `frontend/dist` (Vite), `backend/dist` (tsc and the bundles), the compiled catalog, the icon module and the website. `pnpm build:app` leaves the website out, as CI's `build` job does. |
| `pnpm size` | After `pnpm build`: sorts the build by thread and fails when either budget is exceeded, gzipped, fonts and the fetched JSON data tables excluded ([AGENTS.md](../AGENTS.md), "Quality gates, testing and CI"): the UI thread (the entry script, its static imports and the CSS; a lazy chunk only when it is part of the first paint of `/diagram`) 350 kB, the workers (every worker script and every chunk a worker loads) 400 kB. Lazy UI chunks outside the first paint are listed and count against neither. It also fails when a UI-thread chunk contains zod (its minified signatures): zod belongs in the workers. |
| `pnpm e2e` | Playwright: functional, export and axe accessibility tests in light and dark, against demo mode (port 5174) and normal mode (port 5173), the app's phone and tablet check (below), and its flows by finger at a phone's and a tablet's size (`e2e/tests/handheld.spec.ts`; `pnpm e2e --project chromium-phone --project chromium-tablet` runs them alone). It starts both dev servers itself, or reuses ones already running. Run `pnpm --filter @gcportrait/e2e install-browsers` once per machine first. |
| `pnpm --filter @gcportrait/frontend mobile` | The app's phone and tablet check alone (the e2e suite's `mobile` project, `e2e/tests/mobile.spec.ts`): Chromium emulating a touch device at 320, 375, 390, 430 and 820 CSS pixels and four phones turned sideways, in both themes, on the Connect, Permissions, Snapshots and Settings pages (the Snapshots page also with a snapshot stored), a live instance's pages signed out and signed in (its Account panel inside More, its Impressum and Privacy pages) and the diagram of demo S and M with the View and More sheets, every menu and panel in them and the details drawer open. It fails on sideways scrolling, a page laid out wider than the window or scrolling up and down by itself, text squeezed into a narrow column, an element past the viewport, overlapping top-bar items, parts of the timeline bar over each other, a details drawer reaching past the canvas, a target under 44 × 44 px, a control out of sight when it has focus or covered where it is tapped, a canvas the chrome leaves too little of, and an axe violation, and checks the sheets' keys, a theme picked in More, a long breadcrumb swiped and tapped, the drawer's handle by key and by finger, a one-finger pan, a two-finger pinch and taps on the canvas. The same project runs `e2e/tests/touch.spec.ts`, the canvas's gestures by finger at 390 × 844 (a pan, a pinch, taps, double taps, a long press) and a mouse's drag and double-click on the same page. CI runs it in the `e2e (phones and tablets …)` legs. |

The phone-width check runs its layout half only (Chromium at 320 to 430 CSS pixels in both themes: sideways
overflow, the header, 44 px touch targets, axe). Its playback half, the landing page's animated demos on an
iPhone in WebKit, stays a local check before a release: Playwright's WebKit on Linux plays media through
GStreamer, not through the iPhone's media stack, so a pass or a failure there would not say what the check is
for (`pnpm website:mobile`, once per machine `pnpm --filter @gcportrait/website exec playwright install
webkit`).

**Running a job as the runner does.** Each job's commands are in the table. The runner's time zone is UTC, its
locale is `C.UTF-8` (Node formats dates and numbers as `en-US` then) and `CI` is set, which changes three
things: the tests' wall-clock limits (the layout's and the ingest's budget ceilings, the demo organisations'
generation) are never skipped for a busy machine, Playwright retries a failed test twice, starts fresh dev
servers and writes an HTML report, and `test.only` fails the run. To reproduce a failure that does not happen
on your machine:

```sh
TZ=UTC LC_ALL=C.UTF-8 CI=true pnpm test --project frontend      # one leg of `unit`, as on the runner
CI=true pnpm e2e --project chromium-live --project chromium --shard=2/2   # the e2e leg desktop 2/2
actionlint && shellcheck -x infra/*.sh                            # workflows-and-shell (Homebrew has both)
```

A failed `e2e` leg uploads `playwright-report-` and its id (`desktop-1`, `desktop-2`, `phones-and-tablets-1`,
`phones-and-tablets-2`): the HTML report, the traces of the failed tests (`pnpm --filter @gcportrait/e2e exec
playwright show-trace FILE` opens one) and, under `out/export/e2e/`, the export comparisons' images and their
difference pictures. A failed `unit` leg uploads `render-golden-failures-N` when the render golden did not
match: the image the runner drew and a picture of the differences.

**Required checks.** Branch protection needs exactly one check: `required`. In Settings > Rules > Rulesets, a
branch ruleset for the default branch with "Require status checks to pass" and the check `required` (source:
GitHub Actions); add "Require a pull request before merging" as you see fit. Do not list the other jobs or the
matrix legs one by one: `required` already waits for them, and the ruleset then needs no change when a job is
added, renamed or split. `layout-budget` is left out on purpose. The Website workflow's `website-build` may be
required too; CI's `website` job already builds and checks the same site. GitHub offers a check in the ruleset
only after it has run once, so add it after the first push to `main`.

**Runs on GitHub.** What to expect, and what to do:

- **Caches.** A repository's first run finds neither the pnpm store nor the Playwright browsers cached, so every job
  downloads them and takes a minute or two longer. A pull request reads the caches that `main`'s runs saved.
- **Visual baselines.** There are no screenshot baselines that depend on the machine that wrote them, so e2e
  runs on the plain `ubuntu-latest` runner, not in Playwright's container. The renderer's baselines
  (`e2e/baselines/diagram/`) are SVG text, compared as text by the frontend's unit tests. The render golden
  (`e2e/baselines/render/`) is drawn by resvg's WebAssembly build with the bundled fonts, which computes the
  same bytes on every platform, and is compared byte for byte by the unit tests (render-cli, render, backend);
  `packages/render/test/parity.test.ts` compares resvg's native Linux binding with the WebAssembly build the
  same way, and is the comparison most likely to differ. Should one of these golden comparisons fail on the
  runner: download the artifact, look at the difference picture, and if it is anti-aliasing only, add a second
  golden for Linux rather than a tolerance. The export checks in `e2e/tests/export.spec.ts` have no golden:
  they compare the PNG that Chromium draws with resvg's drawing of the same SVG, both made on the runner, and
  allow 1 % of pixels to differ; the log prints the figure. Linux draws text through FreeType and macOS
  through Core Text, so the figure differs between them, though not near the limit.
- **Locale and time zone.** A unit test that passes on your machine can fail on the runner when it formats a
  date or a number in the viewer's locale without fixing one: reproduce it with `TZ=UTC LC_ALL=C.UTF-8`
  (above). The end-to-end specs that read dates fix `en-GB` and UTC themselves.
- **The layout's budgets.** They describe a quiet M1-class machine, not a shared runner. `unit (layout)` holds
  the layout to twice its budgets on whatever runner it gets; `layout-budget`'s summary shows the runner's CPU
  and its strict figures, which are expected above the budgets by a margin.

For a visual change (layout, renderer, icons, palette), also render the M fixture in both themes and look at
the PNGs (`pnpm render --fixture M --lens networking --png out.png`, then `--theme dark`), walk the checklists
of the style and layout skills (the style skill's fact-check list, §11, and the layout skill's checklist, §8)
item by item, and update the baselines deliberately: the renderer's SVG baselines with `pnpm --filter
@gcportrait/frontend test src/diagram/baselines.test.tsx -u` (the file before `-u`), the render golden PNG
with `pnpm --filter @gcportrait/render-cli test:golden:update`, and the layout's golden JSON with `pnpm
--filter @gcportrait/layout test:golden:update`. Say in the pull request why each changed file changed. The
layout's budgets run on their own with `pnpm --filter @gcportrait/layout test:budget`; quote their figures for
a layout change.

## 5. Rules every change follows

Every rule is in [AGENTS.md](../AGENTS.md); these are the ones the checks enforce or that reviewers most often
catch.

### Provenance

gcportrait is original work, licensed under the MIT License (`MIT`; [AGENTS.md](../AGENTS.md), "Licence and
dependencies"), and whoever receives it may rely on that licence alone, so nothing may bring in someone else's
licence or an obligation that would force the project to publish its code or relicense its combined work.

- Never copy, port or paraphrase another licensed project. If your solution reads like a translation of
  someone else's code, start over.
- No Go files, no Graphviz `.dot` or `.gv` files, no Gizmo graph queries, and no symbolic links.
- The strings of AGENTS.md, "Names that never appear", never appear in a file's contents or its name: Google's
  name with its company suffix (Google is "Google" or "Google Cloud"), a few project names, decision-record
  numbers and links, numbered rules of AGENTS.md, phrases that record how something was built rather than what
  it is, and work-item ids. Say what a thing is or does, and cite a rule by its heading in AGENTS.md.
  `--list-exempt` prints the rules. Some phrases are known to the check only by their SHA-256 digest;
  `node scripts/check-provenance.mjs --digest-of "<phrase>"` prints the entry that adds one to
  `PHRASE_DIGESTS`.
- Every text file is UTF-8, without a byte-order mark or NUL bytes, and a file with a binary extension holds
  that format (`encoding`). The check reads text in any encoding and the metadata of binary files, so neither
  hides a refused string.
- The names of denied licences appear only in the dependency deny list (`THIRD_PARTY.md`,
  `scripts/check-licenses.mjs` and its test) and in the verbatim licence texts in `scripts/licenses/`
  (`licence-name`).
- Every pull request carries the statement "Original work; nothing copied from other projects."

### The SPDX header

Every new text source file starts with the SPDX licence line for `MIT`, within its first 10 lines
(a shebang or a Dockerfile `# syntax=` line may come first; in Markdown with YAML frontmatter, the header goes
on the first line after the closing `---`). Add the line for the file's type:

| Files | Header line |
|---|---|
| `.ts` `.tsx` `.mts` `.cts` `.js` `.jsx` `.mjs` `.cjs` | `// SPDX-License-Identifier: MIT` |
| `.yaml` `.yml` `.sh`, and by name `.editorconfig` `.gitignore` `.gitattributes` `.npmrc` `.prettierignore` `.dockerignore` `.env.example` `Dockerfile` `CODEOWNERS` | `# SPDX-License-Identifier: MIT` |
| `.css` | `/* SPDX-License-Identifier: MIT */` |
| `.md` `.html` `.astro` | `<!-- SPDX-License-Identifier: MIT -->` |

`pnpm provenance` checks every header against the `license` field of the root `package.json`, so a header
with any other identifier fails, and a new workspace package's `package.json` declares
`"license": "MIT"` too. Files that cannot hold a comment or are data or licence texts need no
header: `.json` (and `.jsonl`, `.ndjson`, `.prettierrc`), `.txt`, `.svg`, `.drawio`, `LICENSE`, `.nvmrc`,
`.gitkeep`, `CNAME`, lockfiles, images, fonts and other binary files; so do changeset entries and generated
`CHANGELOG.md` files. A text file of any other type fails the check until `scripts/lib/repo-files.mjs` gives
its type a header form or lists it as header-free, in the same change. Should the project licence ever
change, `scripts/set-license.mjs` rewrites every header; it is not needed otherwise.

### Contributions and licensing

Contributions are accepted under the MIT License, the project's licence (inbound = outbound): by opening a
pull request you offer your change under it, and the provenance statement in the template confirms that it is
your own work. You keep the copyright in what you write. There is no contributor licence agreement, and none
is planned: with a permissive licence, nobody needs more rights than the MIT License gives. The gcportrait
name and icon are not covered by the MIT License ([brand/LICENSE.md](../brand/LICENSE.md)): a fork uses its
own. Third-party material keeps its own licences and is listed in [THIRD_PARTY.md](../THIRD_PARTY.md); a new
dependency must pass `pnpm run licenses`.

### Code

- TypeScript only, strict, no `any`. `erasableSyntaxOnly` is on: no enums, namespaces or constructor parameter
  properties; use union types and `as const` objects.
- The backend, the e2e suite, the tooling and every package under `packages/` use NodeNext module resolution,
  so relative imports carry an explicit `.js` extension (`import { x } from './x.js'`). Only the frontend uses
  bundler resolution.
- Each package exposes its public API through `src/index.ts`. Import another package by its name
  (`@gcportrait/model`), never through a deep path or a relative path into it. The dependency direction is
  fixed (`eslint.config.js`): packages under `packages/` may import only `@gcportrait/model`, which imports no
  other package, except that `@gcportrait/graph` also imports `@gcportrait/catalog`, and its tests and its
  `render-scene` command may use `demo-data` (and `ingest`); the backend may import `model`, `catalog` and
  `ingest`; the frontend also `graph`, `layout`, `icons` and `demo-data`. [packages.md](packages.md) has the
  full table.
- A type that crosses a package boundary is a zod schema in `@gcportrait/model`, with the type inferred
  through `z.infer`. Do not declare it a second time.
- A new workspace package must be added to the `references` of the root `tsconfig.json`, or `pnpm typecheck`
  skips it.
- Data over code: asset types, relation rules, lenses, icon mappings, product names and console URLs live in
  the catalog's data files (`packages/catalog/products/`, `lenses/`), never in a second map in code.

### Data, privacy and presentation

- No real organisation data, anywhere: fixtures and examples use `example.com` or `example.org`, project
  numbers below 100000000000, and documentation (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) or
  private IP ranges.
- Tokens and secrets never touch disk, logs or URLs. `.env` files are git-ignored and the provenance check
  never reads them; never paste credentials into an issue or a pull request.
- Phones, tablets and desktops, with every control at each ([AGENTS.md](../AGENTS.md), "Product rules"): a
  narrower layout folds the same components into sheets, never copies them; targets are 44 × 44 px on a phone
  and a tablet; a width is asked for only with the layouts' media queries in rem
  (`frontend/src/ui/screen.ts`). `frontend/src/shell/parity.test.tsx` and `pnpm --filter @gcportrait/frontend
  mobile` check it.
- Both themes, every time: anything visible must look right and pass the checks in light and dark.
- The non-affiliation statement ([AGENTS.md](../AGENTS.md), "Non-affiliation, brand and legal") goes in the
  footer of every route of the app and every page of the website and, as the long form above, in
  documentation, READMEs and release notes; never in a drawing or an export. Never call the project official
  or Google's, and never name Google with its company suffix.
- The app links its source on every route, a courtesy to the people who use an instance (the MIT License does
  not ask for it): the footer's "Source (MIT)" link, next to the non-affiliation notice, points at the
  backend's `SOURCE_URL` (`sourceUrl` in `/api/config`) or, in demo mode, at the build-time `VITE_SOURCE_URL`.
  Do not remove it or move it off a route.
- A value the reader fills in, in a guide's code or a command the app shows, is written `YOUR_` and capitals
  as one word (`YOUR_PROJECT`, `YOUR_ORG_ID`): a plain word to a shell, so an unfilled copy fails clearly.
  Each is a variable of `COMMAND_VARIABLES` in `@gcportrait/model`, which the website turns into a field and
  `node scripts/user-docs.mjs` checks the guides against. Capitals without `YOUR_` stay text (an environment
  variable, a script's usage line, a name pattern, a redacted part of a recorded run).

## 6. Making a change

1. **Pick the work.** An issue or an item of [backlog.md](backlog.md); a change to a rule updates
   [AGENTS.md](../AGENTS.md) in the same pull request. Load the skills its area needs from `.agents/skills/`
   ([AGENTS.md](../AGENTS.md), "Skills"), and read the README of every package you change.
2. **Branch.** Name it after the topic: `<topic>-<slug>` or `<issue>-<slug>`, for example `ingest-parser` or
   `412-gutter-lanes`.
3. **Tests first** for `packages/*`; fixtures first for catalog work; an e2e test for anything a user does.
4. **Docs in the same pull request:** the package README if behaviour changed, the user guide under `docs/` if
   users will notice it (the guides are listed in [README.md](README.md#user-guides); a guide says what to do,
   with no record of when or where it was checked), and `AGENTS.md` and the skill that applies it if a rule
   changed. `node scripts/user-docs.mjs` (part of `pnpm test`) fails while a guide names a `pnpm` script, an
   `infra/` flag or a setting the tree does not have, logs a verification, or while the generated lens tables
   differ from the catalog (`--write` regenerates them).
5. **Add a changeset** (below) if users will notice the change.
6. **Run `pnpm check`**, and for app changes also `pnpm build`, `pnpm size` and `pnpm e2e`.
7. **Open the pull request** (section 7).

### Changesets

Release notes and version numbers come from [Changesets](https://changesets.dev). Every pull request that
changes behaviour adds one changeset file:

```sh
pnpm changeset                     # interactive: pick the packages, the semver bump and write a summary
pnpm changeset add --minor @gcportrait/frontend -m "Theme toggle remembers the choice across reloads."
pnpm changeset status              # lists pending changesets; exits 1 if packages changed without one
```

Either form writes a Markdown file under `.changeset/`; commit it with your change. Write the summary for
users, in one or two sentences. All `@gcportrait/*` packages are private, are never published to npm, and
share one version number (a `fixed` group), so pick the bump for the product as a whole. A change that does
not affect users (documentation, tests, tooling) needs no changeset; `pnpm changeset add --empty` records that
explicitly if you want `pnpm changeset status` to pass. Changeset files need no SPDX header.

## 7. Opening a pull request

Pull requests are highly welcome, preferably small ones about one feature or one function rather than full
rewrites: a focused change is quick to review and to merge, while a rewrite of a whole part is hard to review
and is better proposed in an issue first, then made in small steps. Open one pull request per change, with its
changeset ([Changesets](#changesets)).

Push your branch and open a pull request against `main`. The template asks for:

- what changed and why, with the issue or the [backlog.md](backlog.md) item;
- how you verified it: the demo fixtures used, whether you tested against a real scope (never name it), and
  the commands you ran with their real results, failures included;
- screenshots in light and dark for any visual change, with every visual baseline update called out;
- for asset catalog changes, the `catalog` label and a table of the types, roles and relation targets;
- a risk and rollback note for backend and infrastructure changes;
- the checklist, including the provenance statement and the changeset.

CI must be green. A reviewer, human or AI assistant, then checks the acceptance criteria of the issue or
backlog item and the rules in the skills, the provenance rules, and the review checklist in the
contributor-workflow skill (§6). `.github/CODEOWNERS` routes catalog, layout and infrastructure changes to the
right reviewers. Releases are tagged by the maintainer ([section 9](#9-releases)).

## 8. Testing against a real scope

Backend changes are verified with the backend's unit and HTTP tests (`pnpm --filter @gcportrait/backend
test`), which need no network; to try a change against a real scope, deploy your checkout to a project of
yours with `infra/deploy.sh --project YOUR_PROJECT --build` from the clone's root ([self-host-options.md,
"From a clone of the repository"](self-host-options.md#from-a-clone-of-the-repository), contributor-workflow
skill §3). `--build` needs the clone: the release's scripts the installer downloads refuse it. A change to
`infra/install.sh` reaches people with the next website deploy (the site serves it as
`https://gcportrait.app/install.sh`), and a change to the deploy scripts with the next release, which attaches
them (`scripts/release-assets.sh`); `pnpm test:infra` runs both against stand-ins.

## 9. Releases

For the maintainer. `.github/workflows/release.yml` publishes the image to GitHub Container Registry with the
workflow's own `GITHUB_TOKEN`: no secret, no repository variable, no Google Cloud account. On every `v*` tag:

1. **build-and-test**: `pnpm run check`, `pnpm run build` and the size budgets on the tag.
2. **publish-image**: builds `infra/Dockerfile` with Buildx for `linux/amd64` and `linux/arm64` (arm64 under
   QEMU emulation, the slow half), starts each image and checks `/healthz` (it must report the tag),
   `/api/config` and the SPA, then pushes one multi-platform image to `ghcr.io/OWNER/gcportrait` with the tags
   `X.Y.Z`, `X.Y` and `latest`. `latest` moves only for the newest release: never for a pre-release
   (`v1.2.0-rc.1` gets only its own tag), and not for a patch of an older line tagged after a newer release.
   The image carries the OCI labels and index annotations `org.opencontainers.image.source` (the repository),
   `.licenses` (`MIT`) and `.description` (the long non-affiliation statement). Then it checks that anyone can
   pull the image, as the remote repository of deploy.sh does, and writes one SPDX SBOM per platform with
   Syft.
3. **github-release**: the GitHub release `vX.Y.Z`, its notes built by `scripts/release-notes.mjs` from the
   version's sections of the `CHANGELOG.md` files, with the long non-affiliation statement, the installer
   line, the image's tags and digest. Attached: both SBOMs, the deploy scripts the installer downloads
   (`gcportrait-deploy-vX.Y.Z.tar.gz`) and `checksums.txt` with the SHA-256 of every other asset, both written
   by `scripts/release-assets.sh`. The installer needs both: a release without them installs nothing.

Run by hand (Actions › Release › Run workflow, on any branch), it publishes the same image as `dev` only, with
no other tag and no GitHub release, and reports `dev-SHA` as its version.

One-time setup, on GitHub:

1. **The first publish creates the package `gcportrait`**, private (GitHub's default for a new package). Run
   the workflow by hand once (`dev`); it ends with a warning that the image cannot be pulled anonymously.
2. **Make the package public**: the package's page (the repository's "Packages", or
   `https://github.com/users/OWNER/packages/container/package/gcportrait`) › Package settings › Change
   visibility › Public. Self-hosters' Artifact Registry pulls it without credentials, so it must be public; on
   a `v*` tag the workflow fails at its pull check while it is not. The `org.opencontainers.image.source`
   label links the package to the repository, which gives the workflow write access to it.
3. **Check it**: `infra/deploy.sh --project YOUR_PROJECT --image dev --dry-run` finds the image on ghcr.io
   and prints what it would deploy. A fork publishes to its own `ghcr.io/OWNER/gcportrait`, which deploys with
   `--image ghcr.io/OWNER/gcportrait:TAG`; `PUBLISHED_IMAGE` and `SOURCE_REPOSITORY` in `infra/common.sh` name
   the defaults, and `REPOSITORY` in `infra/install.sh` the repository whose releases the installer downloads.

Then, per release: `pnpm release:version` (consumes the changesets, writes the `CHANGELOG.md` files and the
versions), commit, and tag `vX.Y.Z` on `main`. The release job needs the version's `CHANGELOG.md` sections: a
tag without them fails at the release notes, after the image is published. Once the release is out, `curl
-fsSL https://gcportrait.app/install.sh | bash -s -- --version vX.Y.Z --project YOUR_PROJECT --dry-run`
downloads and checks its deploy scripts and prints what they would deploy.

**The first release, 1.0.0, is already versioned**: every `@gcportrait/*` package is at 1.0.0 and its notes
are in the `CHANGELOG.md` files, so its tag needs no versioning step. After the `dev` run of the one-time
setup:

```sh
git tag v1.0.0
git push origin v1.0.0
```

The tag runs `release.yml`: it checks and builds the tag, publishes the image as `1.0.0`, `1.0` and `latest`,
creates the GitHub release and, while `PAGES_DEPLOY` is `true`, deploys the website.

**Repository settings.** The workflows read two repository variables (Settings > Secrets and variables >
Actions), and nothing else besides GitHub's own `GITHUB_TOKEN`:

| Name | For |
|---|---|
| `PAGES_DEPLOY` | `true` switches on the website's deployment to GitHub Pages from `main` and from each `v*` tag. Set it after the Pages source ("GitHub Actions"), the `github-pages` environment allowing `main` and `v*`, the verified domain, the DNS records and the custom domain with HTTPS enforced ([website.md, "Deploying to GitHub Pages"](website.md#deploying-to-github-pages)). |
| `WEBSITE_ANALYTICS` | Optional. Unset, a deploying build counts the website's page views with TelemetryDeck (never the demo's), so the privacy notice must mention it ([website.md, "Analytics"](website.md#analytics)). `0` switches that off (what a fork sets), `1` on in every build. |

Under Settings > Advanced Security, Dependabot alerts and Dependabot security updates are on
([security.md](security.md), finding O7). Every pull request Dependabot opens is adopted on `main` or declined
with its reason in [backlog.md](backlog.md), never closed unread ([AGENTS.md](../AGENTS.md), "Quality gates,
testing and CI").

**A fork** publishes to its own `ghcr.io/OWNER/gcportrait` and changes the repository it names: the app's
"Source (MIT)" link falls back to `DEFAULT_SOURCE_URL` in `frontend/src/source.ts` and to `SOURCE_URL`'s
default in `backend/src/config.ts` when an instance sets neither `SOURCE_URL` nor `VITE_SOURCE_URL`, and the
tests that pin them (`backend/src/config.test.ts`, `e2e/tests/support.ts`) change with them; `PUBLISHED_IMAGE`
and `SOURCE_REPOSITORY` in `infra/common.sh`, `REPOSITORY` in `infra/install.sh`, `website/src/site.ts`, the
README and the docs name the repository too.

Not done yet, and listed in the workflow's header as follow-ups: signing the image (cosign with the workflow's
OIDC identity) and build provenance attestations. A copy in a Google Cloud registry is not needed: deploy.sh
pulls through a remote repository in the self-hoster's own project.

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `pnpm install` refuses to run because of the Node version | Install Node 22.22.2 or newer in the 22.x line (`nvm install` reads `.nvmrc`). |
| `pnpm` is a different version from the one in `packageManager` | Run `corepack enable`, then open a new shell. |
| `pnpm licenses` prints pnpm's own licence listing | Use `pnpm run licenses`. |
| `licenses: FAILED ... THIRD_PARTY.md is stale` | `pnpm run licenses --write`, then commit `THIRD_PARTY.md`. |
| `provenance: FAILED` with `[spdx-header]` on a new file | Add the header line for its file type (section 5), or give a new file type a header form in `scripts/lib/repo-files.mjs`. |
| `pnpm typecheck` ignores a new package | Add the package to the `references` of the root `tsconfig.json`. |
| `pnpm e2e` cannot launch a browser | `pnpm --filter @gcportrait/e2e install-browsers`. |
| Every CI job fails at "Install dependencies" with `ERR_PNPM_OUTDATED_LOCKFILE` | `pnpm-lock.yaml` does not match a `package.json`: run `pnpm install` and commit the lockfile. |
| A test fails on CI but not on your machine | Run it as the runner does: `TZ=UTC LC_ALL=C.UTF-8 CI=true pnpm test --project <name>` (section 4, "Continuous integration"). |
| `pnpm size` passes but says `frontend/dist does not exist yet` | It measured nothing: run `pnpm build` first. |
| `user-docs: FAILED` (or `scripts/user-docs.test.ts` fails) | A user guide is stale: the message names the guide and the command, flag, variable or lens block. Fix the guide, or run `node scripts/user-docs.mjs --write` for the lens blocks after a catalog lens change. |
