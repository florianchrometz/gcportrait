<!-- SPDX-License-Identifier: MIT -->

# AGENTS.md: the rules of gcportrait

This file holds every rule of gcportrait in one place, for the people and the AI assistants (Claude Code,
Gemini CLI, Codex, Cursor, Copilot or whatever comes next) who change this repository. Each rule is stated as
it stands, with the reason for it in one sentence. Humans new to the repository start with
[docs/contributing.md](docs/contributing.md); assistants load the skills the work needs ([Skills](#skills)).

| Section | What it settles |
|---|---|
| [How this file works](#how-this-file-works) | One rules file, the skills as handbooks, how to cite a rule, how a rule changes |
| [What gcportrait is and is not](#what-gcportrait-is-and-is-not) | The question it answers, its users, what version 1 does, the non-goals |
| [Product rules](#product-rules) | Phones, tablets and desktops, both themes, the demo, the timeline, "as of", views as links, composition, the source link |
| [Data and graph semantics](#data-and-graph-semantics) | Data over code, the Snapshot, synthetic data, the catalog and the graph builder |
| [Layout and drawing rules](#layout-and-drawing-rules) | The layout engine, pure cores, packing, routing, progressive disclosure |
| [Exports and the render API](#exports-and-the-render-api) | SVG, PNG and draw.io, `pnpm render`, `POST /api/render` |
| [Style and accessibility](#style-and-accessibility) | Themes, WCAG 2.2 AA, touch targets and breakpoints, Google's colour semantics, icons, fonts |
| [Security and privacy](#security-and-privacy) | The seven principles, tokens, the backend, the quota project, the service-account gate, OAuth scopes |
| [Modes and hosting](#modes-and-hosting) | The ways in, demo-only mode, the static demo, hosted surfaces, the website, telemetry, legal pages, self-hosting |
| [Non-affiliation, brand and legal](#non-affiliation-brand-and-legal) | The statement's three texts and where each goes, the maintainer's name, the reserved name and icon |
| [Licence and dependencies](#licence-and-dependencies) | MIT, the SPDX header, the dependency licences, original work |
| [Architecture and code](#architecture-and-code) | TypeScript, the repository map, the dependency direction, backend and frontend |
| [Quality gates, testing and CI](#quality-gates-testing-and-ci) | `pnpm check`, budgets, tests, goldens, generated artefacts, CI, Dependabot |
| [Releases](#releases) | Changesets, tags, the release workflow, the image |
| [Documentation](#documentation) | Where things are written down, and how; the README's order |
| [How to work a task](#how-to-work-a-task) | From an issue to a reviewed pull request; git |
| [Skills](#skills) | Which handbook to load for which work |
| [Assistants](#assistants) | What each assistant reads by itself, and the local pointer files `pnpm agents:setup` writes |
| [Commands](#commands) | Every command, with what it does |
| [Names that never appear](#names-that-never-appear) | Strings the provenance check refuses |

## How this file works

- **AGENTS.md is the one rules file**, under the name the assistants look for: Claude Code, Codex, Cursor and
  GitHub Copilot read `AGENTS.md` by that name, in capitals, which a case-sensitive file system tells apart
  from any other spelling. Every rule of the project is here and is kept current. No instruction file of a
  particular tool is committed (`CLAUDE.md`, `GEMINI.md`, `.cursor/rules/`, `.github/copilot-instructions.md`,
  `AGENTS.override.md` and the like are git-ignored, as are per-user settings such as `.claude/`, and the
  provenance check skips them all): copies of the same rules for different tools drift apart and favour some
  tools over others. Who wants such a file locally writes one that points here with `pnpm agents:setup`
  ([Assistants](#assistants)).
- **The skills are handbooks.** Each skill in `.agents/skills/` is a plain Markdown procedure for one domain
  (`SKILL.md` with a `name` and a `description` in its frontmatter, optional `references/`): it says how the
  work is done and which constants it uses, and points here for the rules it applies. A skill never restates
  why or when a rule came about. [.agents/README.md](.agents/README.md) explains how to load one with any
  tool.
- **A rule is stated as it is.** Present tense, its reason in one sentence, no history: not who decided it,
  not when, not what it replaced.
- **Cite a rule by this file and its heading**: "AGENTS.md, Security and privacy", or for a numbered principle
  "AGENTS.md, Security and privacy, principle 2". The headings are anchors: renaming one updates every
  citation in the same change. A comment or a guide that needs a rule's reason points here instead of
  retelling it.
- **A rule changes in the same pull request as the code it governs**, here and in the skill that applies it.
  A change to the product's scope, a hosted surface, a security and privacy principle, the licence or the
  non-affiliation wording is the maintainer's call.
- **Open work is not a rule.** It lives in [docs/backlog.md](docs/backlog.md) (the asset catalog's in
  [docs/catalog-followups.md](docs/catalog-followups.md)), questions only the maintainer can settle included.

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

- **Phones, tablets and desktops, every control at each.** The app has three layouts, chosen by the window's
  width in rem (`frontend/src/ui/screen.ts`): the phone up to 47.99rem, in portrait and in landscape; the
  tablet from 48rem to 79.99rem; the desktop from 80rem. Every control, menu item, page, dialog and keyboard
  action of the desktop exists at every width, reachable by touch and by keyboard under the same accessible
  name, and nothing is desktop-only, because people open a view where they are (a link in a chat, a check
  during an incident) and a control missing on one screen makes what it does impossible there. The layouts
  fold the same components, never copies of them:
  - the desktop shows every control in place, in the top bar's two rows, with the details drawer beside the
    canvas;
  - narrower, the top bar's controls fold into two sheets: More holds the navigation and the app row's
    actions, View the view row's controls but the breadcrumb, with the search as a field the sheet's width; a
    tablet keeps the two rows, a phone has one (the mark, the breadcrumb, View and More); the breadcrumb
    scrolls sideways and rests at its end, so the current level always shows and a swipe or a focused crumb
    brings the levels above it into view;
  - every sheet and menu is the app's own Menu, Popover or Dialog: Escape closes it and gives focus back to
    its opener, a modal one traps focus, an action that takes its own control away (Sign out) and a pick that
    changes the view (a snapshot, a saved view, a theme) close the sheet too, while Copy link and a control's
    own popup (Export's menu) keep it open, and a popup inside a sheet opens in the sheet, as wide as the
    sheet, its long lines (a snapshot's description, an account's address) wrapping, so a sheet never scrolls
    sideways;
  - the chrome never covers the whole canvas while someone works on it: a View or More sheet hangs from the
    top bar, closes the details drawer (the selection stays, and a search result picked in View closes the
    sheet and opens the drawer) and leaves at least a third of the canvas in view, its content scrolling
    inside it; on a tablet the drawer is a panel over at most half the canvas's right side, on a phone a sheet
    over its lower half that its handle takes to the whole height (then the canvas's content is hidden until
    it comes down) and back, and a camera jump keeps the node in the part left in view; what floats over the
    canvas moves clear of the drawer (the disclosure bar to the bottom left on a tablet, above the sheet on a
    phone, or, on a canvas too short for it there, hidden while the sheet is open; on a phone it is hidden
    while View or More is open too), and the drawer's content scrolls inside it, never past its edge; the
    timeline bar and the disclosure bar wrap onto more lines instead, a phone's timeline with the slider
    across the width on a line as tall as its touch target and the row of day markers under its track, the
    readout below it and the buttons below the readout, and on a phone turned sideways, whose diagram area
    (the canvas and the bar) is under 18.5rem tall, one line while the details sheet is open, the slider with
    the step and play buttons, its readout and playback options hidden until the sheet closes;
  - no control is ever out of sight when it has focus or under something when tapped: a control the chrome
    covers is moved clear of it or hidden with what covers it;
  - a page flows in the width it has and only its own box scrolls, never the document, because a document
    that slides sideways or down under a finger takes the top bar and the footer off screen: text for
    assistive technology only (`.visually-hidden`, absolutely placed) lies inside a positioned box of the page
    (a table's own scroll box, the permission check's panel) rather than placed against the window past the
    page's edge; a table too wide for the page scrolls sideways in that box of its own; a table whose cells
    would squeeze a command to a few characters a line, where it can be neither read nor checked (the
    Permissions page's reference), is a list on a phone, each command as wide as the page; and a table whose
    row a reader would have to scroll sideways to read (the Snapshots page's) is a list of cards on a phone,
    one per row, its cells as labelled lines.

  The touch model: on a phone and a tablet every target is at least 44 × 44 CSS pixels and the bars keep clear
  of the safe-area insets ([Style and accessibility](#style-and-accessibility)). The canvas reads a finger
  from its pointer events (`pointerType` `touch`, `frontend/src/diagram/touch.ts`) and leaves a mouse and a
  pen their own input (d3-zoom's drag and wheel, the click, the double-click that drills in, the right-click
  menu, hover), so a device with a touch screen and a mouse works with both:
  - one finger pans and two pinch about their midpoint, what they touched staying under them; neither selects;
  - a tap (lifted within 10 px, before 500 ms) does what a click does: it selects, clears the selection on the
    bare canvas, opens a chip and closes a zone by its collapse button;
  - a double tap (a second tap touching within 300 ms of the first's lift and 24 px of where it touched) zooms
    in two times about its point, but on a chip or a collapse button leaves the first tap's flip as it is;
  - a long press (500 ms within 10 px) shows what hover shows, the trace's preview and by the finger the
    tooltip there or the node's name, until the next touch, and selects nothing;
  - the clicks, double-clicks and right-clicks a browser makes of a finger change nothing more;
  - the camera's limits and glides are the same for every pointer, and only the canvas keeps the browser's
    gestures off (`touch-action: none`), so the pages pinch-zoom as the browser does.

  A node's menu and drill-in have no touch gesture, because a long press is where people look for what a
  thing is and a double tap where they look for zoom; the details drawer carries both. The e2e suite's
  functional specs run at 1440 × 900, `e2e/tests/touch.spec.ts` uses the canvas by finger at a phone's size
  and `e2e/tests/handheld.spec.ts` the app's flows by finger at a phone's and a tablet's (the `chromium-phone`
  and `chromium-tablet` projects); `frontend/src/shell/parity.test.tsx` fails on a control the desktop offers
  and a narrower width lacks (in the DOM and the accessibility tree), and `pnpm --filter @gcportrait/frontend
  mobile` runs the touch spec and measures the phone and tablet layouts in a browser, including that every
  control is in sight when focused and can be tapped. The website serves phones too (`pnpm website:mobile`
  checks it).
- **Both themes, every time.** A visual change is done when it looks right in light and dark and passes the
  contrast tests, because users and their documents come in both ([Style and
  accessibility](#style-and-accessibility)).
- **Demo mode is first-class.** Four deterministic synthetic organisations, S, M, L and XL, each with 35 days
  of history, generated from a seed by `packages/demo-data` in CAI's NDJSON shape, are what the tests, the
  screenshots, the website, the agents' self-checks and the app's "Try the demo" draw: realistic organisations
  are needed everywhere, and real inventories may not be used. `pnpm dev:demo` runs the app without a backend,
  without `/api` calls and without a Google account, and the e2e suite runs against it.
- **The timeline** has one tick per day for the last 35 days: today and the 34 days before at 00:00 UTC, the
  latest tick reading "now" so that no read time lies in the future. A tick is one set of `assets.list` calls
  with its read time, read only when the view rests on it, because each day is a full read of the scope:
  - read days are cached in IndexedDB per scope and read time (the `tickCache` store), never shared between
    scopes;
  - once the view rests, its two neighbours are read at idle, at most two reads run at once, and a read of a
    day the view moved away from is cancelled;
  - nothing is read while the page stays on the snapshot's own day;
  - the diff between two days (added, removed, changed by `updateTime`) is a pure function in
    `packages/graph`, with no API calls;
  - snapshots from export files and manual pulls of the same scope are extra, labelled ticks at their read
    time.

  [docs/timeline.md](docs/timeline.md) and the cai-ingestion skill (§5) have the details.
- **"As of", never "live".** Every surface says when its data was read and calls it the inventory "as of"
  that time, never "live": Cloud Asset Inventory updates several products only every few hours and IAM data
  up to seven days late, so "live" would promise more than the data holds.
- **Every view is a link.** The URL hash holds everything that defines a view (the ViewSpec, through
  `@gcportrait/model`'s view codec), so a reload keeps it and a link shares it; the recipient needs the same
  snapshot (their own pull or a snapshot file).
- **A large snapshot is drawn once the person confirms it.** Before the app draws a snapshot of more than
  `LARGE_SNAPSHOT_ASSETS` (10 000, `@gcportrait/model`) assets it asks in an alert dialog ("Draw it anyway",
  "Cancel", and "Do not ask again in this session", kept in the tab's sessionStorage only), because drawing
  that many at once is slow and heavy on memory; every way that draws a snapshot goes through the one guard
  (`frontend/src/snapshots/LargeSnapshotGuard.tsx`; [docs/modes.md](docs/modes.md), "At a glance"), a snapshot
  the person chose to draw is not asked about again in the tab, and the render API and `pnpm render` never
  ask.
- **Filters, focus views and drill-in compose.** A filter applies in every focus view and under every
  drill-in, never only in the overview, because a filter that silently stops applying misleads the reader. A
  new lens, focus view or filter gets a table-driven case in `packages/graph` against the others.
- **Unknown asset types still render**: a generic card, the product or category icon, containment from
  `parent` (gcp-diagram-layout skill §2, rule 6). The catalog adds precision; its absence never drops an
  asset, because Google adds types every month and a diagram that silently loses assets is wrong.
- **The selection trace**: a click on a resource keeps its path to the root and its connections traced, in a
  bolder colour, until the selection changes; "Open in Cloud Console" is offered in the details drawer and
  opens the console only when the person chooses it.
- **The running app links its source.** The shell footer's "Source (MIT)" link stays on every route, next to
  the non-affiliation notice, so the people who use an instance can see where its source is and under which
  licence; the MIT License does not ask for it. It points at `sourceUrl` from `/api/config` (the backend's
  `SOURCE_URL`) or, in a demo build, at the build-time `VITE_SOURCE_URL`; both default to the project's
  repository, and a fork or a modified instance points them at its own source.

## Data and graph semantics

- **Data over code.** Asset types, relation rules, lenses, icon mappings, product names, console URL templates
  and relation styles are declarative files in `packages/catalog` and `packages/icons`; code reads them, and
  no second map lives in code. A second hard-coded map next to the data drifts from it.
- **One source of truth per concept.** Lens type lists, product names, icon mappings and domain and address
  extraction come from the catalog.
- **Types that cross a package boundary are zod schemas in `@gcportrait/model`**, declared once, every type
  inferred through `z.infer`; nothing is declared twice.
- **Two import paths, one Snapshot.** A live pull through the backend (`assets.list`, paginated and streamed:
  `POST /api/assets/stream`) and CAI export files (dropped into the browser, or read from a `gs://` URI with
  the person's token: `POST /api/export/read`) are normalised by `packages/ingest`'s one streaming NDJSON
  parser into the same Snapshot. Everything after ingestion knows the source only through the Snapshot's
  `source` (`api`, `export` or `demo`). The list API is synchronous and reads any of the last 35 days, while
  very large inventories can hit its quota; exports are the path for those.
- **An export's read time** comes from an `operation.json` next to it, from the person, or from the newest
  `updateTime`, and the UI says which, because an export file carries no read time of its own.
- **Synthetic data only.** Fixtures, examples and demo data use `example.com` and `example.org` names, project
  numbers below 100000000000, and documentation (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) or
  private IP ranges, and the test suite fails on anything that looks real. A pull request never names a real
  scope, even when the change was tested against one. Real inventories belong to someone and would leak names,
  addresses and structure into a public repository.
- **Snapshot files carry a `schemaVersion`**, and a format change adds a migration (`migrateSnapshot` in
  `@gcportrait/model`) in the same change, so every file a user saved stays readable.
- **The catalog is authored by groups.** Each group's `packages/catalog/known-unmapped/<group>.yaml` lists the
  official types it owns (`owns`: exact types or `<service>/*`, the most specific pattern wins) and those it
  has not mapped yet (`types`, each with a reason); every official type has exactly one owner, and the checker
  enforces it. Product files are `products/<service>[.<suffix>].yaml`, merged by service, each holding one
  group's types; a service several groups own has no plain `<service>.yaml` but one
  `products/<service>.<group>[-<more>].yaml` per group. Groups then work in disjoint files, and a check scoped
  to one group or file (`--group`, `--file`) fails only on what that selection has to fix.
- **The compiled catalog is a build artefact**: `packages/catalog/src/generated/compiled-catalog.ts` is
  git-ignored and written by `pnpm catalog:build`, which install, lint, typecheck and test run first. It
  leaves out every type whose own description has a violation, so a half-finished entry never reaches the
  graph builder; `pnpm catalog:check` fails (`generated-committed`) if a file under `src/generated/` is ever
  tracked.
- **Coverage is checked against the official asset-type list** in CI, and the weekly drift workflow opens or
  updates one issue when Google's list changes. The catalog carries its own `version` and `officialListDate`.
- **`@gcportrait/catalog` owns rule semantics.** Its rule engine (relations, containment, labels, subtitles,
  console links, IP and domain extraction, `hiddenWhen`, the normalisers) is the single implementation, used
  by the compiler's fixture proofs and the graph builder alike, so the two cannot disagree. It stays pure and
  browser-safe (no Node APIs, no I/O, deterministic), because the graph builder runs in a web worker; the
  catalog's Node tooling lives in `packages/catalog/tooling/`.
- **Reverse rules and child-side containment.** `reverse: true` on a relation rule draws the edge from the
  referenced asset to the one that holds the reference (a replica names its primary; the edge runs primary to
  replica). `nestsIn` on a type entry names the container the asset nests in; its `kind` is drawn instead
  whenever it cannot nest there, and never to the container it does nest in. Copies of one edge merge: one
  (from, kind, to) is one edge, strong when any copy is.
- **Sibling and Kubernetes references.** `siblingName` builds a target's name from a pattern and the
  referencing asset's own project and location; `k8sRef` resolves a Kubernetes name or object reference in the
  asset's cluster. A template drops every ` · ` segment whose expressions are all missing; `first(…)` stands
  in the first present variable; a console link drops entirely when a variable is missing.
- **Every `hiddenWhen` is proven** by a fixture it matches and one it does not (`hidden-unproven`), so an
  always-true predicate cannot hide a type.
- **Canonical project matching.** Asset names are never rewritten. A reference that matches no node is tried
  once more with its first `projects/<ref>` segment swapped through the snapshot's project index (number to id
  or id to number); an exact match wins, and a reference that matches neither way stays dangling as read.
- **Shared VPC only on evidence.** A cross-project `attaches` edge is a Shared VPC attachment when it goes
  into a subnetwork of another project in the snapshot, or into a network of a project whose Compute settings
  say `xpnProjectStatus: HOST`; other cross-project attachments are drawn but are no Shared VPC.
- **Reciprocal `connects` edges fold into one**, like `peers`, so either side's rule may draw the link.
- **`includeTypes` reveals a hidden type's nodes but not its `hiddenWhen` matches**, which only a lens with
  `showHidden` draws.

The gcp-asset-catalog skill and [packages/catalog/README.md](packages/catalog/README.md) hold the schema, the
normalisers and the authoring procedure; [packages/graph/README.md](packages/graph/README.md) the builder.

## Layout and drawing rules

- **gcportrait's own layout engine.** `packages/layout` is a pure TypeScript engine of nested-zone grid
  packing and orthogonal gutter routing, not built on ELK, Graphviz or Cytoscape: none of them routes the
  edges that cross zone boundaries the way these diagrams need. The gcp-diagram-layout skill is its
  specification and holds every constant.
- **Typed end to end.** Graph, layout and render never pass through a lossy text format (such as DOT) that is
  parsed back.
- **Pure cores.** `packages/ingest`, `packages/graph` and `packages/layout` have no side effects, no DOM and
  no randomness (text widths come from a generated Roboto metrics table), so they run anywhere, in a worker
  included, and test exactly. Everything in them is unit-tested; graph and layout also have property tests
  (fast-check).
- **Deterministic.** The same Scene gives a byte-identical Layout, report included (warnings sorted in
  code-point order), whatever order its children or edges came in. The invariants (no card overlap, children
  inside their parent's padding, no edge through a card or a zone header) are asserted in development and in
  tests, with golden layouts per demo fixture and lens.
- **Packing.** A container's children keep their sibling order and form a card grid above rows of zones. Among
  every column count and every split of the zones into rows: rows are full (no row but the last has room for
  the next child), the box is wider than tall, and the smallest frame wins (a box within 20 % of its target
  aspect is its own frame; any other is framed by the smallest rectangle of the target aspect around it). Near
  ties within 2 % prefer rows that do not grow downwards, then fewer rows. Short zones may stack beside a
  single taller one in their row, only when that makes the box no wider, no taller and its frame smaller.
  Sibling chips and empty zones share the widest of their widths. Tidy grids read as a picture, and sibling
  order keeps a folder's projects in the order a reader expects.
- **The packing criterion** for the golden layouts (S and M): every container with four or more children is
  within 20 % of its target aspect, unless no full-row arrangement reaches that band or every one that does
  needs more area than the chosen one framed to the target (the golden test's brute-force oracle shows which),
  and none fills less than 40 % of its children box on the demo fixtures.
- **Routing.** Routes run through the gutters between boxes, never across a card or a zone header, and leave a
  port in a straight run; border hugging and the canvas margin cost more than free gutters, and lane pressure
  makes a busy corridor dearer than a quiet one but cheaper than a detour; hub edges of one kind bundle into
  one trunk; `secures` edges are routed like every other kind; an edge from a node to itself is dropped and
  counted. The single-pass mode for very large views is decided by the first pass's search work, with a
  one-round band below it, so that a view loses a widening round before it loses the widening. The layout
  skill (§5) has the cost model and every threshold.
- **Progressive disclosure.** The `auto` detail level fits a budget of rects and never opens beyond the lens's
  ceiling, and a view of at most 100 rects opens whole; an explicit level is not capped (layout skill §6).
- **The layout runs in a worker per request**, memoised by Scene hash, superseded requests cancelled, never
  behind a global lock and never on the UI thread. A highlight change only changes attributes and never lays
  out again.
- **Budgets**: through a worker, layout S 10 ms, M 60 ms, L 400 ms, XL 2 s; XL ingest 1.5 s; the M graph build
  150 ms ([Quality gates, testing and CI](#quality-gates-testing-and-ci); the app's targets are in the layout
  skill §7).

## Exports and the render API

- **Three files, one drawing.** The Export menu saves the current view, the whole diagram or the visible part,
  in either theme, as SVG, as PNG (2×, or 3× on request, on the theme's background, also copied to the
  clipboard) or as a draw.io file. Exporting is a version 1 must-have, because the main reason to draw an
  environment is to put the picture somewhere else. The Export button is therefore the app row's last control,
  at its right edge, filled in the primary colour (4.5 : 1 in both themes); `e2e/tests/shell.spec.ts` holds
  its place.
- **Everything an export needs is in the SVG**: the legend and the title block are drawn inside it, never as
  an HTML overlay. An SVG export resolves every CSS variable to an attribute and keeps the icons inline.
- **The title block** has three lines on the canvas and in every export: the scope, the lens with the read
  time, and the tagline `gcportrait.app - Visualize your Google Cloud Infrastructure`. The SVG's `<desc>`
  holds neutral metadata only (the scope, the lens, the read time, a timeline day's changes and "Drawn with
  gcportrait."). No drawing carries the non-affiliation statement ([Non-affiliation, brand and
  legal](#non-affiliation-brand-and-legal)).
- **draw.io is the SVG drawing translated**, never a second renderer, which would drift from the picture: a
  translator walks the markup the diagram's components draw and turns every primitive into a cell with the
  same geometry, colours and text. Structure comes from markers on the components (`data-kind`, `data-id`, the
  short indices `data-n` and `data-parent`, a line's `data-ends`): zones become nested containers, nodes
  groups, lines edges between their nodes, on three layers. Text is placed at its baselines in Roboto, naming
  Google Fonts' stylesheet in `fontSource` by default (the person's diagrams.net fetches it, never the
  instance). The file is deterministic and compressed with fflate (plain XML on request), so the bytes are the
  same in the browser and in Node; it sets `adaptiveColors="none"` so both themes keep their colours. The
  translator is a lazy chunk outside the first paint. A viewport file keeps every cell that meets the visible
  area whole, with the title block above and the legend below. The fidelity check (`pnpm e2e
  tests/drawio.spec.ts`, maxGraph in Chromium) holds it to the SVG: at most 5 % of the pixels differ, a text
  line within 1.25 px, a box or a line's end within 0.5 px, an open head's gap within 3 px and a block head's
  width within 1.5 px.
- **`pnpm render` draws byte for byte what the app's renderer draws**, through the frontend's headless
  entry (`frontend/src/headless.ts`), for tests, screenshots and agents' self-checks.
- **The render API**, `POST /api/render`, draws SVG, PNG and draw.io on the server with the code `pnpm render`
  runs, so an instance's users can script exports:
  - **one render library**, `@gcportrait/render`, between a snapshot and the bytes, used by the CLI and the
    backend alike, so a view renders the same from either;
  - **one rasteriser**, `@resvg/resvg-wasm`, pinned to an exact version, which computes the same pixels on
    every platform, so the API, the CLI and the render golden agree by construction;
  - **POST only**: no GET form, because scope ids, quota projects and view values would land in URLs that
    request logs record in full;
  - **four sources**: a live `scope` (the pull's own fields, credentials and rules), an uploaded `ndjson`
    export or `bundle` snapshot (multipart), or a `demo` size; the view as an app link's hash (a `tick` is
    refused; `snapshot`, `selection` and `highlight` are ignored) or as explicit fields; `theme`, `format`
    (`png`, `svg`, `drawio`), `scale` or `width`;
  - **authentication as everywhere else**: the token in `X-Gcportrait-Token` (or `Authorization: Bearer`
    without it); a live scope proves the token through the pull, or in service-account mode through the gate
    before every page; a demo or an upload needs Google's tokeninfo to accept the token before any work,
    because the most expensive route of an instance is not open to anyone with a well-formed string;
  - **limits**: one render at a time per instance, 10 renders a minute per token, the four stream slots per
    token shared with the pulls, the `RENDER_*` settings (assets, pixels, timeout, body size; an invalid value
    stops start-up) and the fixed limits (a scale of at most 3, 16 384 px a side, a 1 GiB worker heap, the 30
    s body deadline, the 60 s stall rule);
  - **a fresh `worker_threads` worker per render**, terminated when the render ends, times out or the client
    goes away, which returns the WebAssembly memory and caps the heap; `server.mjs` never imports the library,
    and the bundle step fails on any `.node` input;
  - **errors before any byte** of the image, in the server's error shape with a `code`; the route logs one
    line of counts and nothing about the token, the scope or the view; the answer carries no affiliation
    header;
  - **absent** on a demo-only instance and with `RENDER_API=false` (`RENDER_API=true` next to `DEMO_ONLY=true`
    stops start-up).

  [docs/api.md](docs/api.md) is the reference for every field, header, error and limit;
  [docs/export.md](docs/export.md) the user guide; the gcp-diagram-style skill (§7, §8) the export rules.

## Style and accessibility

- **Light and dark themes** for the app and the diagrams, following the system setting with a manual override
  (`system`, `light`, `dark`) stored in IndexedDB and applied before the first paint, so no page flashes in
  the wrong theme.
- **WCAG 2.2 AA** on every page, the diagram included, in both themes and at every width: contrast tests cover
  every palette pair (`frontend/src/diagram/theme/theme.test.ts`) and the e2e suite runs axe in both themes,
  at the desktop's size and at the phone's and the tablet's (`pnpm --filter @gcportrait/frontend mobile`). The
  one documented exception is the decorative subnet and VPC zone strokes; the title text and card strokes
  inside them pass instead.
- **44-pixel targets and the safe area on phones and tablets.** Below the desktop's breakpoint every target is
  at least 44 × 44 CSS pixels (WCAG 2.5.5; `--control-height` grows to `--touch-target`), a link inside a
  sentence and a field inside a line of code excepted, and the bars that stay on screen pad themselves with
  `env(safe-area-inset-*)`, because a finger is less precise than a pointer and a phone's notch, rounded
  corners and home indicator hide what lies under them.
- **Breakpoints in rem, from one place.** A stylesheet asks for a width only with the layouts' media queries,
  written in rem as `MEDIA` in `frontend/src/ui/screen.ts` has them (media queries cannot read custom
  properties; `--breakpoint-tablet` and `--breakpoint-desktop` in `tokens.css` name the widths), and for a
  part's own room only with `CONTAINER`'s container queries, in rem too (a phone's canvas too short for the
  disclosure bar above the half-height sheet, a phone's diagram area too short for the timeline bar and the
  sheet together); `frontend/src/ui/screen.test.ts` refuses any other, so the layouts follow the reader's
  text size and every part folds at the same widths.
- **Google's colour semantics win; the values are adjusted.** Where Google's architecture-diagram conventions
  and WCAG conflict, what a tint means stays and its value changes until contrast passes, so the diagrams read
  as Google Cloud-style and stay readable.
- **Colour never carries meaning alone**: edge kinds differ by dash or arrowhead, zone kinds by title position
  or badge.
- **Google's icons are never recoloured, stretched or redrawn**; they are used unmodified under Google's icon
  usage terms.
- **Roboto and Roboto Mono are self-hosted**, never loaded from a CDN, because the backend's Content Security
  Policy and the offline demo rule a CDN out and the layout computes text widths from Roboto's metrics.
- **CSS modules with Material-3-style design tokens** (colour roles, type scale, elevation) and the app's own
  small, headless, accessible primitives for menus, dialogs and sliders; no component library.

The gcp-diagram-style skill holds both palettes, the tokens, the contrast pairs and the fact-check list.

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

### The backend

- Stateless: no database and no storage bucket. Self-hosting stays one service with nothing to provision for
  data.
- Upstream calls go to four hosts only: `cloudasset.googleapis.com`, `cloudresourcemanager.googleapis.com`,
  `storage.googleapis.com` and `oauth2.googleapis.com`.
- A strict Content Security Policy and the other security headers (`@fastify/helmet`), rate limits, request
  ids, timeouts, response caps and a process-wide page budget ([docs/security.md](docs/security.md)).
- Logs never carry query strings, bodies, client addresses or tokens. The service-account gate's audit line is
  the one log line that names a scope, on purpose.
- Secrets never touch disk; `.env` files are git-ignored and the provenance check never reads them.

### Quota project and the permission check

- In user mode every CAI call sends `x-goog-user-project` with the quota project the permission check found:
  `quotaProject` is a required, schema-validated project id in every request body that leads to a CAI call,
  and a request without it is refused (400). The backend never falls back to sending no header, because that
  would charge every person's pulls to the instance's project and share its rate quota among them.
- The candidates, in order, are the scope itself when it is a project and the project the person picked (the
  app remembers the last pick per scope); the instance's project is never a candidate.
- Service-account mode and every Resource Manager call send no quota header: the account's own project, the
  instance's, pays for the account's calls, and a person's quota project then needs only the Cloud Asset API.
- The permission check reads the scope's metadata first; a Resource Manager IAM denial there is a warning, not
  a stop, because `roles/cloudasset.viewer` alone cannot `get` a scope it may list. It then probes each
  candidate with `assets.list` (`pageSize: 1`).
- Google's errors are classified by HTTP status and the `ErrorInfo` reason together, never by message text. An
  answer that is not understood fails closed and is shown with its status, reason and message; HTML is never
  forwarded. The table of answers and messages is in [docs/permissions.md](docs/permissions.md) and the
  cai-ingestion skill (§3, §9).

### The service-account gate

Before every CAI call made as the instance's account, the backend checks the caller:

1. **The caller's permission.** Resource Manager `testIamPermissions` on the scope, with the caller's own
   token and no quota header, must return exactly `resourcemanager.organizations.get`,
   `resourcemanager.folders.get` or `resourcemanager.projects.get`, as the scope's kind says. Every other
   answer refuses (fail closed). Nothing is asked as the account, and no account token is requested, before
   this step passes.
2. **The exposure check, optional** (`SA_MODE_STRICT_EXPOSURE=true`, off by default): the account's own `GET`
   of the scope must be exactly Resource Manager's IAM denial of that `get`. A permission granted publicly
   counts as the caller's in step 1, so on a scope whose `get` is public step 1 no longer tells a member from
   anyone; operators who cannot rule that out turn the check on. It is off by default because it refuses
   every scope where a customer granted the account more than `roles/cloudasset.viewer`.
3. **The list**, as the account, without a quota header.

- A pass is remembered in memory for at most five minutes, keyed by the SHA-256 of the caller's token and the
  scope, never past the token's own expiry and never for a refusal, at most 10 000 passes. The permission
  check (`/api/preflight`) always checks afresh.
- Every route that takes `mode: "sa"` runs the gate, before every CAI call as the account, each page of a
  stream included; routes that take no mode refuse a `mode` field. Refusals are 403, 401 or 503 with a `code`.
- Every decision writes one audit log line (`service-account gate`): the route, the scope, the SHA-256 of the
  caller's lower-cased email, the outcome with its step, whether the memo answered and whether strict mode is
  on; never the token, never the email.
- The account's identity comes from Application Default Credentials (the metadata server on Cloud Run;
  locally an impersonation or key file); a person's own credentials (`authorized_user`) are refused.
- `SA_MODE_ENABLED` switches service-account mode off, never the gate.
- `infra/deploy.sh` creates the account with no project roles; customers grant it `roles/cloudasset.viewer`
  only, on folders or projects rather than the organisation where they can, since every member of a domain
  can usually `get` its organisation.

### OAuth scopes

Sign-in requests `https://www.googleapis.com/auth/cloud-platform.read-only`,
`https://www.googleapis.com/auth/cloudasset` and `https://www.googleapis.com/auth/userinfo.email`, never
`cloud-platform`, which would grant read-write access to every Google Cloud API the person can reach. Cloud
Asset Inventory refuses a token with `cloud-platform.read-only` alone and Resource Manager one with
`cloudasset` alone, so both are needed. A grant missing either Cloud scope is revoked at once and the person
is asked again; without `userinfo.email` sign-in still works, without the address in the account menu.

## Modes and hosting

- **The ways in**: the person's own account (user mode, the default), the instance's service account
  (service-account mode, enabled per instance by its operator), export files, and the demo. User mode lets an
  individual start without any grant to a third party; service-account mode gives a team one shared grant.
  Both modes share one code path from the backend's CAI call onwards, so they draw the same diagram of the
  same inventory and differ only in whose identity reads it ([The service-account
  gate](#the-service-account-gate)).
- **One Cloud Run service per installation**, one image serving the API and the single-page app.
- **Demo-only mode** (`DEMO_ONLY`, exactly `true` or `false`; anything else stops start-up) is a sign-in-free
  instance: `/api/config` reports `demoOnly: true` and no OAuth client, no service-account mode and no render
  API; the backend refuses `OAUTH_CLIENT_ID`, `SA_MODE_ENABLED=true` and `RENDER_API=true` next to it; the
  routes that call Google are not registered; the Content Security Policy names no Google host.
  `infra/deploy.sh --demo-only` deploys it with a runtime account of its own that holds no role, 256 MiB and
  at most two instances.
- **The static demo** at `gcportrait.app/demo/` is a static build of the app in demo-only mode (`pnpm
  demo:static`, `VITE_STATIC_DEMO=1`, base `/demo/`), deployed with the website: its configuration is built in
  (exactly what a demo-only instance's `/api/config` answers), a byte-for-byte copy of `index.html` serves
  each route, the backend's demo-only policy travels as a `<meta>` Content Security Policy (without
  `frame-ancestors`, which a `<meta>` cannot carry) next to `<meta name="referrer" content="no-referrer">`,
  and the bundle holds no sign-in code. A demo needs no server, so it costs nothing and holds nothing.
- **Every link to the demo on the website opens a new tab**, wherever it is (a page, a guide, the header, the
  footer), with `rel="noopener"`, and says so in its name ("opens in a new tab", visually hidden): the demo is
  the app, with no way back to the page it was opened from. `pnpm website:check` enforces it.
- **Hosted surfaces.** The maintainer hosts only the website `gcportrait.app` (Astro on GitHub Pages) and its
  static demo: no sign-in instance, no accounts, no service and so no terms of use. The project has no
  revenue, so the maintainer runs nothing that holds accounts, tokens or anyone's data. Self-hosters who
  enable sign-in run their own instance with their own OAuth client.
- **The website explains gcportrait and is built to be found.** It presents the project and its features with
  screenshots and animated demos of the demo organisations, and renders the user guides. Every page has a
  unique title (at most 60 characters) and description (50 to 160), as search results show them whole, a
  canonical URL on `https://gcportrait.app`, OpenGraph and Twitter card tags with a 1200 × 630 image,
  parseable JSON-LD and an entry in the sitemap; the JSON-LD never names an Organization, so that nothing
  reads as Google's, and no metadata carries the non-affiliation statement, which belongs in the footer and
  the long-form texts. The landing page presents the maintainer in an author section with links and Person
  structured data ([docs/author.md](docs/author.md)). People find a tool through search and link previews, and
  judge an open-source project by who stands behind it. `pnpm website:check` enforces all of it
  ([docs/website.md](docs/website.md)).
- **No telemetry, except the website's page views.** The app, the static demo and every self-hosted instance
  send no usage data, error reports or page views anywhere: an instance runs in someone else's project and
  must never phone home. The website alone counts its own pages' views with TelemetryDeck, through its npm SDK
  bundled into the site (no script from a CDN): only in a deploying build (the repository variable
  `WEBSITE_ANALYTICS`, which a fork sets to `0`), only when served from `gcportrait.app` itself, never when
  the browser sends Do Not Track or Global Privacy Control, without a cookie and without query strings or
  fragments. A count of visits is all the maintainer needs, and the privacy notice describes exactly that
  ([docs/website.md](docs/website.md), "Analytics").
- **Legal pages.** The Impressum and the privacy notice are on the maintainer's website, and the website, the
  static demo and the app's footer link them. An instance either links a page (`LEGAL_IMPRESSUM_URL`,
  `LEGAL_PRIVACY_URL`, https only) or serves its own text (`LEGAL_DIR` or `LEGAL_BUNDLE`, checked and rendered
  by a Markdown reader that never emits HTML), never both for one page. Legal texts never live in the
  repository, because they name a person and an address and every operator needs their own.
- **Self-hosting.** [docs/self-host.md](docs/self-host.md) and
  [docs/self-host-options.md](docs/self-host-options.md):
  - the installer line (`curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project YOUR_PROJECT`)
    downloads the newest release's deploy scripts and checks them against the release's checksums before it
    runs anything;
  - `infra/deploy.sh` and `infra/uninstall.sh` are declarative (each run sets the service to its flags), touch
    only what they created (marked by labels and descriptions) and print every change with `--dry-run`; never
    run them against a project you do not own;
  - a release image is pulled from ghcr.io through an Artifact Registry remote repository in the operator's
    project, so a redeploy does not depend on ghcr.io;
  - `--build` builds the checkout with Cloud Build as an account of its own, `SERVICE-build@PROJECT`, with
    Storage Admin on its labelled build bucket and Artifact Registry Writer on its repository and nothing at
    project level, never as the Compute Engine default account, which often holds Editor on the whole project;
  - `--iap` puts Identity-Aware Proxy in front, with user mode inside; `--domain` maps a custom domain through
    a Cloud Run domain mapping in a region that offers them;
  - a full instance gets 2 GiB of memory (the render API's worker and pixels need it), a demo-only one 256
    MiB;
  - the "Open in Cloud Shell" tutorial ([docs/cloudshell-tutorial.md](docs/cloudshell-tutorial.md)) and the
    "Run on Google Cloud" button (`app.json` with `infra/cloud-run-button.sh`) sit next to the manual steps in
    the README and the self-hosting guide, and beside "Self-host" on the website's landing page, where they
    open a new tab that their name announces and draw a mark of the site's own (the site loads nothing from
    another host).

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
- **Every new text source file starts with the SPDX line for `MIT`** within its first 10 lines, in the comment
  form of its type, so the licence of every file is machine-readable:
  - `// SPDX-License-Identifier: MIT` for ts, tsx, mts, cts, js, jsx, mjs, cjs;
  - `# SPDX-License-Identifier: MIT` for yaml, yml, sh and, by name, `.editorconfig`, `.gitignore`,
    `.gitattributes`, `.npmrc`, `.prettierignore`, `.dockerignore`, `.env.example`, `Dockerfile`, `CODEOWNERS`
    (a shebang or a Dockerfile `# syntax=` line may come first);
  - `/* SPDX-License-Identifier: MIT */` for css;
  - `<!-- SPDX-License-Identifier: MIT -->` for md, html, astro (in Markdown with YAML frontmatter, on the
    first line after the closing `---`).

  `pnpm provenance` checks every header against the `license` field of the root `package.json`, and every
  workspace package's `package.json` declares `"license": "MIT"`. JSON (also `.jsonl`, `.ndjson`,
  `.prettierrc`), plain text, SVG, draw.io files, `LICENSE`, `.nvmrc` (a bare version number, since not every
  Node version manager accepts comments), `.gitkeep`, `CNAME`, lockfiles, images, fonts and other binary files
  are exempt, and so are changeset entries and generated `CHANGELOG.md` files. A text file of any other type
  fails until `scripts/lib/repo-files.mjs` gives its type a header form or lists it as header-free, in the
  same change. `scripts/set-license.mjs` rewrites every header, `license` field and `LICENSE` should the
  project licence ever change.
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

- **TypeScript only**, on Node `^22.22.2` (`.nvmrc` holds `22`, `.npmrc` sets `engine-strict`) in a pnpm
  workspace, pnpm pinned through `packageManager` and Corepack, so one language and one set of types cover the
  browser, the backend and the tooling. Shell scripts are allowed only under `infra/` and `scripts/`.
- **Strict**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and
  `erasableSyntaxOnly` (no enums, namespaces or constructor parameter properties); ESLint's typescript-eslint
  `strictTypeChecked` set, and no `any`. TypeScript stays on 6.0.x for as long as typescript-eslint supports
  nothing newer.
- **NodeNext everywhere but the frontend**: the backend, e2e, the tooling and every shared package extend
  `tsconfig.node.json`, so relative imports end in `.js`; the frontend uses bundler resolution. `pnpm
  typecheck` runs `tsc -b` over the projects the root `tsconfig.json` references, so a new package is added
  there.
- **Text is UTF-8**, without a byte-order mark or NUL bytes, as `.editorconfig` tells editors, so that every
  tool, the provenance check included, reads what an editor shows. A file with a binary extension holds that
  binary format; a new binary format is listed in `BINARY_EXTENSIONS` (`scripts/lib/repo-files.mjs`). The
  provenance check reports a file that breaks either rule.

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
               unmodified, and a few own drawings), render (the render library: a snapshot and a view as SVG,
               PNG and draw.io, resvg-wasm; behind `pnpm render` and POST /api/render), render-cli
               (`pnpm render`)
e2e/           Playwright: functional, export and axe tests, mostly in demo mode; the renderer's SVG
               baselines (baselines/diagram/) and the render goldens, PNG and draw.io (baselines/render/)
docs/          contributing.md, packages.md (with the terms), backlog.md, catalog-followups.md, security.md,
               threat-model.md, website.md, legal facts (docs/legal/), generated media (docs/media/), and the
               user guides (getting-started, modes, permissions, lenses-and-filters, timeline, export, faq,
               self-host, self-host-options, configuration, api, the Cloud Shell tutorial), which
               `node scripts/user-docs.mjs` checks against the tree and docs/README.md lists
scripts/       repo tooling: provenance, licence, audit and bundle-size checks, the official asset-type list
               fetcher (catalog-fetch-official.mjs), media, sample exports, the static demo, release notes and
               assets, set-license, the probe of Google's API answers (probe-google-apis.sh)
website/       the Astro site at gcportrait.app (docs/website.md)
brand/         icon.svg, the one source of gcportrait's mark (the favicons, the website's logo; brand/README.md)
infra/         Dockerfile, install.sh, deploy.sh, uninstall.sh, compose.yaml, cloud-run-button.sh (app.json's
               hook for the "Run on Google Cloud" button), cloudbuild.yaml
.agents/       the skills                     .github/     CI, release, Pages and drift workflows, templates
.changeset/    pending release notes
```

- **The dependency direction points down**: `model ← catalog ← graph ← frontend`. Packages under `packages/`
  import only `@gcportrait/model`, except that `graph` also imports `catalog`; the graph's tests may use
  `demo-data`, and its `render-scene` command `demo-data` and `ingest`; the layout's tests and `debug-svg`
  script build demo Scenes through `graph`, `catalog` and `demo-data`. These development edges stay outside
  the libraries. A cycle-free, downward graph keeps every package testable on its own.
- **One upward exception**: `packages/render`, the render library, is Node code on top of the app and imports
  the frontend's headless entry (`frontend/src/headless.ts`), so a view is drawn by the app's own components
  and data readers; the frontend never imports it. `packages/render-cli` and the backend (only in its render
  job, `backend/src/render/job.ts` and `worker.ts`, bundled into `dist/render-worker.mjs`, never into
  `dist/server.mjs`) draw through it; nothing imports `render-cli`.
- **Imports go by package name** (`@gcportrait/<pkg>`) through each package's `src/index.ts` or its `testing`
  export, never through a deep or relative path into another package. `eslint.config.js` enforces the whole
  direction.
- **The backend** is Fastify 5: response contracts written once as zod schemas and handed to Fastify as JSON
  Schema; `@fastify/helmet` with a strict CSP, rate limits, request ids and pino JSON logs with a header
  allowlist; two esbuild bundles (`server.mjs` and `render-worker.mjs`); a distroless image without
  `node_modules`.
- **The frontend** is React 19 and Vite:
  - the URL hash is the view, and IndexedDB, through a small versioned wrapper with a memory fallback, holds
    preferences, snapshots, saved views and the timeline's day cache;
  - the token lives in memory only;
  - ingest, the graph build and the layout run in workers, and the UI thread only renders; the demo generator
    runs in workers only (the data worker, and a demo worker per "Try the demo" job), and zod never loads on
    the UI thread (its codec and vocabularies come from zod-free modules);
  - the diagram is SVG drawn by React; zoom and pan use d3-zoom with `scaleExtent [0.05, 200]` for a mouse and
    a pen, and the canvas's own gesture reader for a finger within the same extent; double-click is reserved
    for drill-in; the level of detail follows the effective scale;
  - search is Fuse.js over the graph's node index;
  - the work a view sends to the renderer is proportional to the view, not to the organisation.

[docs/packages.md](docs/packages.md) explains the packages, the data flow and the terms (Snapshot, Graph,
Scene, Layout, Lens, Focus, Tick, dangling reference); each package's README is its reference.

## Quality gates, testing and CI

- **`pnpm check` before every push**: `format:check`, `lint`, `typecheck`, `test` (the unit tests of every
  package and the repository tooling, the user-docs check included), `catalog:check`, `provenance` and
  `licenses`. App work also runs `pnpm build`, `pnpm size` and `pnpm e2e`; visual work also draws the M
  fixture with `pnpm render` in both themes and looks at it.
- **The bundle budgets** (`pnpm size`, after `pnpm build`), gzipped, fonts and the fetched JSON data tables
  excluded: the UI thread 350 kB (the entry script, its static imports, the CSS `index.html` links, and a lazy
  chunk only when the first paint of `/diagram` needs it), the workers 400 kB together (every worker script
  and every chunk a worker loads). A file nothing reaches counts against the UI budget, so a gap in the
  classification only makes the check stricter. zod on the UI thread fails the check whatever the sizes. The
  UI thread is kept at or under 320 kB to leave room. Two budgets keep work that runs in workers, after the
  page is up, from competing with the first paint, while the workers still have a ceiling.
- **The performance budgets** run in the unit tests at twice their value on any machine and strictly in
  `pnpm --filter @gcportrait/<pkg> test:budget`, and a local unit run skips a missed one with the load as its
  reason while the machine is overloaded, which CI never does ([Layout and drawing
  rules](#layout-and-drawing-rules); the app's targets in the layout skill §7).
- **Tests first** for pure packages; fixtures first for catalog work; golden layouts and visual baselines for
  renderer work. The contributor-workflow skill (§4) says what each test layer covers.
- **Baselines and goldens change only on purpose**, through their update commands, with the diff explained in
  the pull request. The render goldens are compared without tolerance: if a platform rasterises an edge
  differently, the remedy is one golden per platform, never a tolerance.
- **Generated artefacts are built by their command, never edited by hand, and checked for staleness**: the
  compiled catalog (`pnpm catalog:build`), the layout's metrics table, the icon module, `docs/media/`
  (`pnpm media`, `node scripts/exports.mjs`), the guides' lens tables (`node scripts/user-docs.mjs --write`),
  `THIRD_PARTY.md`'s dependency table (`pnpm run licenses --write`), the golden files and baselines.
- **CI** (`.github/workflows/pr.yml`) runs its jobs side by side on each pull request and push to `main`:
  lint, typecheck, the unit tests in three legs, `layout-budget` (reports only), catalog-check, build with the
  size budgets, e2e in five Chromium legs (three of the desktop specs, two of the phone and tablet check and
  the `chromium-phone` and `chromium-tablet` projects), the website, provenance (with a self-test that plants
  a banned file and requires the guard to fail), licences, the dependency audit and workflows-and-shell. Each
  e2e leg is a round-robin share of its projects' tests, every k-th of their listing, run by `--test-list`
  (`pnpm --filter @gcportrait/e2e leg`), so that the slow files spread over the legs instead of landing in
  one; it fails when its run misses a test of its share. Its `required` job is the one check branch
  protection targets, green only when every other job but `layout-budget` succeeded or was skipped for a
  change of only docs and media (below), so the ruleset never changes when a job does. Every action is pinned
  by commit. The audit gate fails on high and critical advisories unless `scripts/audit-allowlist.json`
  accepts one with an expiry.
- **A change of only docs and media runs only the jobs that read them.** A first job, `changes`, compares a
  push with the commit before it and a pull request with the branch it merges into, and sorts every changed
  file as docs (`docs/**/*.md`, `.changeset/*.md`, the root's Markdown files and each top-level folder's and
  package's `README.md` and `CHANGELOG.md`), media (`docs/media/**`) or code (everything else, the skills
  included). With no code among them, the unit tests of every project but the layout and the frontend, the
  website and provenance run, licences too for docs (`THIRD_PARTY.md`) and Prettier for media (its manifests
  are JSON); typecheck, the layout and frontend unit legs, `layout-budget`, catalog-check, build, e2e, the
  audit, workflows-and-shell and ESLint are skipped, because none of them reads those files, so each could
  only repeat the result of the tree the change starts from. A comparison that cannot be made runs every job.
- **Dependabot's pull requests are never closed unread.** Each proposed update is adopted on `main` (merged,
  or applied in a commit that passes the checks) or declined with its reason in
  [docs/backlog.md](docs/backlog.md), because what Dependabot finds belongs in the tree from the start.

## Releases

- **Semantic versioning through changesets**, one fixed version for every workspace package
  (`.changeset/config.json`, `fixed`); every package is private and never published to npm. A pull request
  that changes behaviour adds a changeset with a summary written for users.
- **Per release**: `pnpm release:version` (consumes the changesets, writes the `CHANGELOG.md` files and the
  versions), commit, then tag `vX.Y.Z` on `main`. [CHANGELOG.md](CHANGELOG.md) says what each release holds.
- **`release.yml` on a tag**: `pnpm run check`, the build and the size budgets on the tag; one image for
  linux/amd64 and linux/arm64, smoke-tested, pushed to `ghcr.io/florianchrometz/gcportrait` as `X.Y.Z`, `X.Y`
  and `latest` (`latest` only for the newest release, never a pre-release), with the workflow's own
  `GITHUB_TOKEN`: no secret, no Workload Identity Federation, no registry on Google Cloud; an SPDX SBOM per
  platform; the GitHub release with notes from the `CHANGELOG.md` sections (the long form first, the installer
  line, the image's tags and digest), the deploy scripts the installer downloads and `checksums.txt`. Run by
  hand, it publishes `dev` only.
- **A pre-release tag is a trial run of its release**: a tag such as `vX.Y.Z-rc.1` publishes the image under
  its own version tag only, never `latest` or `X.Y`, creates a GitHub pre-release not marked latest, and takes
  the notes of `X.Y.Z` when no `CHANGELOG.md` has a section of its own, so the pipeline can be checked before
  the release it precedes.
- **The ghcr.io package is public**, because self-hosters' Artifact Registry pulls it without credentials.
- **The website** deploys only while the repository variable `PAGES_DEPLOY` is `true`; a tag's website job
  refuses stale `docs/media/` ([docs/website.md](docs/website.md)).
- **The first release, 1.0.0, is already versioned**: its tag needs no versioning step. Every later release
  starts from the changesets merged since.

[docs/contributing.md](docs/contributing.md) (section 9) has the one-time setup, the trial run and the steps.

## Documentation

- **Where things are written down**: the rules here; the procedures in the skills; what a user does in the
  user guides under `docs/` (listed in [docs/README.md](docs/README.md)); each package's reference in its
  README; open work in [docs/backlog.md](docs/backlog.md) and
  [docs/catalog-followups.md](docs/catalog-followups.md).
- **A document describes what is, never how it came to be**: no record of runs, machines, timings of a
  particular run, reviews, the dates of decisions or of changes, and no story of what something replaced. A
  measured figure appears only as the current value. `node scripts/user-docs.mjs` and the provenance check
  enforce it, because the repository is all a reader sees.
- **Cite rules by this file and its heading**; a guide says what to do and links the guide or section that
  explains more.
- **Markdown is hand-wrapped at 110 columns**, table rows, lines that hold a URL, fenced code, the YAML
  frontmatter and a line of one word or one HTML tag excepted, which `node scripts/user-docs.mjs` checks, and
  not formatted by Prettier; it carries the SPDX header.
- **A value the reader fills in** is written `YOUR_` and capitals as one word (`YOUR_PROJECT`), a variable of
  `COMMAND_VARIABLES` in `@gcportrait/model`, which the website turns into a field and the user-docs check
  holds the guides to; capitals without `YOUR_` stay text.
- **Each user guide opens with the long form**, and a new guide is registered in `scripts/user-docs.mjs`,
  [docs/README.md](docs/README.md) and the website's docs menu (`website/src/data/docs.ts`).
- **The root README is the project's front page on GitHub**, and its sections keep this order: what
  gcportrait is and does, with the wordmark, the badges and the hero animation; "Quick start", with the
  installer under "Self-host in 10 minutes", the "Open in Cloud Shell" and "Run on Google Cloud" buttons, and
  "Try the demo"; "Features", each feature shown with a still or an animated demo from `docs/media/` in both
  themes; "How it works", "Tech stack" and "Roadmap"; "Contributing"; "Learn more"; "Author"; and at the
  bottom "Not affiliated with Google" (the long form) and "Licence". A visitor decides on the first screen
  whether gcportrait fits and how to start, so what it does and how to run it come first and the statements
  last. `scripts/readme.test.ts` holds the order.
- **Docs, skills and this file change in the same pull request as the code** they describe.

## How to work a task

1. Start from an issue or an item of [docs/backlog.md](docs/backlog.md). A change to a rule changes this file
   in the same pull request.
2. Load the skills the work needs ([Skills](#skills)). Read the README of every package you change.
3. Work in a branch or worktree named after the topic (`gutter-lanes`, or `412-gutter-lanes` with the issue
   number).
4. Tests first for pure packages; fixtures first for catalog work; golden or visual baseline for renderer
   work.
5. Run `pnpm check`; for app work also `pnpm build`, `pnpm size` and `pnpm e2e`; for visual work `pnpm render`
   on the M fixture, looked at in both themes.
6. Write the pull request with the template: what, why, how verified (commands and their results),
   screenshots, changeset, provenance statement. Update the docs, the skills and this file in the same pull
   request, and take the item off the backlog. **A pull request is one change: small, about one feature or one
   function, with its changeset**, because a focused change is quick to review and to merge; a rewrite of a
   whole part is proposed in an issue first and then made in small steps.
7. Finish with a short, honest report: what was built, what was verified (commands and their real results,
   failures included), what was left out. A reviewer, human or agent, checks the acceptance criteria of the
   issue or backlog item, the skills' rules and this file before merging.

**Git.** `main` is the project's history: it is never force-pushed and its history is never rewritten, so
every clone and fork stays valid. Whether and where history is ever cut is the maintainer's decision alone.

## Skills

| Skill | Load when you ... |
|---|---|
| [.agents/skills/gcp-diagram-style/SKILL.md](.agents/skills/gcp-diagram-style/SKILL.md) | touch colours, zone tints, typography, icons, edges, legend, themes, export or accessibility, or need to fact-check a render |
| [.agents/skills/gcp-diagram-layout/SKILL.md](.agents/skills/gcp-diagram-layout/SKILL.md) | work on nesting, packing, routing, progressive disclosure or performance, or judge whether a diagram "looks right" |
| [.agents/skills/gcp-asset-catalog/SKILL.md](.agents/skills/gcp-asset-catalog/SKILL.md) | add or change an asset type, relation rule, lens, icon mapping, console URL, or run the coverage tool |
| [.agents/skills/cai-ingestion/SKILL.md](.agents/skills/cai-ingestion/SKILL.md) | call Cloud Asset Inventory, parse exports, handle permissions, quota projects, timeline readTime, or write demo data |
| [.agents/skills/contributor-workflow/SKILL.md](.agents/skills/contributor-workflow/SKILL.md) | start any task, prepare a PR, self-host for testing, release, or review someone else's change |

## Assistants

`AGENTS.md` and the skills under `.agents/skills/` are the one source of instructions for every assistant, so
that each works from the same rules and none is favoured.

| Tool | Reads by itself | What `pnpm agents:setup` writes |
|---|---|---|
| Claude Code | `AGENTS.md` while no `CLAUDE.md` is present; skills only from `.claude/skills/` | `CLAUDE.md` with an `@AGENTS.md` import, and a link `.claude/skills/NAME` to each skill |
| Gemini CLI | `GEMINI.md`; the skills under `.agents/skills/` | `GEMINI.md` with an `@./AGENTS.md` import |
| Codex CLI | `AGENTS.md` and the skills under `.agents/skills/` | nothing |
| Cursor | `AGENTS.md`, `.cursor/rules/*.mdc` and the skills under `.agents/skills/` | `.cursor/rules/agents.mdc`, applied in every chat |
| GitHub Copilot | `AGENTS.md`, `.github/copilot-instructions.md` and the skills under `.agents/skills/` | `.github/copilot-instructions.md` |

- **A pointer file holds no rule.** Each says in one paragraph "Read AGENTS.md and the skills under
  .agents/skills/ first; this file only points there.", with the tool's import line where it has one; it is
  git-ignored and the provenance check skips it. A rule goes here, so that no copy can drift.
- **`pnpm agents:setup` is safe to run at any time**: it never overwrites a file that exists (`--force` does,
  but never a folder, and it never writes through a link), changes nothing that is in place, links a skill
  added since and removes the link to one that is gone; `--tool claude` (gemini, codex, cursor, copilot)
  limits it to one tool. `scripts/agents-setup.mjs` names the documentation each row of the table follows.
- **The rules file is `AGENTS.md` in git as on disk.** On a case-insensitive file system (macOS, Windows) git
  does not notice a rename that changes only the case, so such a rename is made with `git mv -f`;
  `scripts/agents-setup.test.ts` fails while git tracks another spelling.

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
| Check the user guides under docs/ against the tree (commands, flags, settings; no records of runs) and every Markdown file's width (110 columns, with the exemptions of Documentation) / regenerate their lens tables after a lens change (also part of `pnpm test`) | `node scripts/user-docs.mjs` / `node scripts/user-docs.mjs --write` |
| Dependency licences (`run` is required): allowlist, deny list, the project licence's compatibility | `pnpm run licenses` (`--write` regenerates THIRD_PARTY.md, `node scripts/check-licenses.mjs --list-rules` prints the rules with reasons) |
| Dependency audit: high and critical advisories fail unless `scripts/audit-allowlist.json` accepts them with an expiry (needs the network; CI's `audit` job; docs/security.md) | `node scripts/check-audit.mjs` |
| Build, then the SPA's size budgets (UI thread 350 kB, workers 400 kB gzipped; Quality gates, testing and CI) | `pnpm build`, then `pnpm size` |
| End-to-end + accessibility | `pnpm e2e` (once per machine: `pnpm --filter @gcportrait/e2e install-browsers`; `--project chromium-phone --project chromium-tablet` for the app's flows by finger on a phone and a tablet alone) |
| One of CI's e2e legs: every K-th test of the projects' listing from the I-th, run by `--test-list`, failing when the run misses one, with the share's count and summed test time (Quality gates, testing and CI) / the share alone, as a test list | `CI=true pnpm --filter @gcportrait/e2e leg --projects "chromium-live chromium" --leg 2 --of 3` (`--projects '!chromium-live !chromium'` for every other project, `-- ARGS` for Playwright) / `... --list-only` |
| The app on phones and tablets: sideways scrolling and a page that scrolls by itself or is laid out wider than the window (every menu and panel of the View and More sheets opened, a live instance signed in, a snapshot stored), text squeezed into a narrow column, the top bar's items, the timeline bar's parts, the drawer within the canvas, 44-pixel targets, every control in sight when focused and tappable, the canvas's room, axe, at 320 to 430 and 820 CSS pixels in both themes and on phones turned sideways; and the canvas's gestures by finger at 390 × 844 (`e2e/tests/touch.spec.ts`; Product rules, the touch model; part of `pnpm e2e`) | `pnpm --filter @gcportrait/frontend mobile` |
| Add a changeset | `pnpm changeset` |
| Write the local, git-ignored pointer files that lead an assistant to AGENTS.md and the skills (Assistants) | `pnpm agents:setup` (`--tool claude`, `--force`, `--help`) |
| Validate the asset catalog and report coverage (exit 1 on any violation) | `pnpm catalog:check` (`--group <group>` / `--file <path>` for one group's or file's problems, `--verbose` for rule traces, `pnpm -s catalog:check --json` for JSON) |
| Per-group catalog coverage (owned official types, mapped by role, unmapped, missing) | `pnpm catalog:coverage` (`--group <group>`, `--json`) |
| Compile the catalog into its git-ignored module (also run by install, lint, typecheck and test) | `pnpm catalog:build` |
| Fetch the official asset-type list into a new dated snapshot and print the drift | `pnpm catalog:fetch-official` |
| Print the Scene summary of a demo organisation for a view (ingest → graph → scene) | `pnpm render-scene --fixture M --lens networking` (`--help` for focus, root, filters, detail, `--json`) |
| Generate a demo organisation / regenerate the committed demo fixtures | `pnpm --filter @gcportrait/demo-data generate --size L --out /tmp/l.ndjson` / `... fixtures` |
| Draw a demo view as the app's renderer draws it (PNG, SVG and draw.io, byte-stable; the drawing carries no non-affiliation line) | `pnpm render --fixture M --lens networking --png out.png` (`--theme dark`, `--detail`, `--svg`, `--drawio`, `--strict`, `--compare`, `--all`, `--help`; without `--png`/`--svg`/`--drawio` it writes `out/render/`) |
| Smoke-test the render API on a local build (`POST /api/render`, docs/api.md; your own token, which Google's tokeninfo must accept) | `pnpm build`, then `node backend/dist/server.mjs` and `curl -s -OJ -H "X-Gcportrait-Token: $(gcloud auth print-access-token)" --json '{"source":{"kind":"demo","size":"S"}}' http://localhost:8080/api/render` (draws the render golden's bytes) |
| Performance budgets on their own (XL ingest 1.5 s, M graph build 150 ms, layout S 10 ms / M 60 ms / L 400 ms / XL 2 s through a worker; the app's targets are in the layout skill §7) | `pnpm --filter @gcportrait/ingest test:budget` / `pnpm --filter @gcportrait/graph test:budget` / `pnpm --filter @gcportrait/layout test:budget` |
| The layout's benchmark table (medians, memo, cancellation, memory; exit 1 on a missed budget) | `pnpm --filter @gcportrait/layout bench` |
| How a layout's routes read per view (length, bends, border hugging, crossings, detours, canvas margin, overshoots; lane holders, the first pass's search work and the mode), or with `--packing` the packing rules side by side | `pnpm --filter @gcportrait/layout measure` (`--view L:overview:projects`, `--packing`, `--json`; default: M at `auto` × three lenses and L overview at `projects`) |
| Look at a layout's packing and routing (debug SVG + PNG of rects, labels and routed edges, not the renderer) | `pnpm --filter @gcportrait/layout debug-svg --fixture M --lens overview --theme both --aspects` (writes `out/layout/`) |
| Regenerate the layout's golden JSON / its Roboto metrics table (deliberately; review the diff) | `pnpm --filter @gcportrait/layout test:golden:update` / `pnpm --filter @gcportrait/layout metrics` |
| Regenerate the renderer's SVG baselines / the render goldens, PNG and draw.io (deliberately; look at the changed files) | `pnpm --filter @gcportrait/frontend test src/diagram/baselines.test.tsx -u` (the file before `-u`) / `pnpm --filter @gcportrait/render-cli test:golden:update` |
| Re-vendor Google's icons / rebuild the icon module / the contact sheet (both themes, 16 px legibility) | `pnpm --filter @gcportrait/icons vendor --verify-render` / `... build` / `... contact-sheet` (writes `out/`) |
| Compare the vendored icons with what Google Cloud provides now (new, changed, renamed and removed icons; needs the network; the weekly `icon-drift.yml` runs it) | `pnpm --filter @gcportrait/icons drift` (`--markdown FILE`, `--json FILE`, `--offline --zips DIR`) |
| Deploy your checkout to Cloud Run in a project of yours / remove it again (docs/self-host-options.md; `--dry-run` prints the changes; never against a project you do not own) | `infra/deploy.sh --project YOUR_PROJECT --region europe-west3 --build` / `infra/uninstall.sh --project YOUR_PROJECT --region europe-west3` (`--yes` without a terminal) |
| Re-check what Google's APIs answer, which the backend's error classification rests on (your own tokens on standard input; cai-ingestion skill §9) | `gcloud auth print-access-token \| scripts/probe-google-apis.sh --project YOUR_PROJECT` (`--sa`, `--only`, `--json`, `--help`) |
| Check a deployed instance from outside (Cloud Run's front end answers `/healthz` itself) | `curl -s https://YOUR_INSTANCE/api/healthz` (and `/api/config` for its settings) |
| Build and run the production image locally (needs Docker) | `pnpm docker:build`, then `pnpm docker:run` (<http://localhost:8080>) |
| Run the production build without Docker (the backend bundle serves the built SPA, as in the image) | `pnpm build`, then `pnpm --filter @gcportrait/backend start` (<http://localhost:8080>; `backend/.env` is not read, so pass `OAUTH_CLIENT_ID=…` for sign-in) |
| Shell-check the infra scripts after a change / run them offline against stand-ins | `shellcheck -x infra/*.sh` / `pnpm test:infra` |
| Build / check / serve the website (`website/`, docs/website.md) | `pnpm website:build`, then `pnpm website:check` (metadata, links, sitemap, the footer notice, the demo and its links) / `pnpm website:dev` (live) / `pnpm website:lighthouse` |
| Check the built website in real browsers: on phones (layout, the sticky header, touch targets, the names of links and buttons, axe, the animated demos' playback) / the fillable commands / the header's repository widget / the static demo | `pnpm website:mobile` / `pnpm --filter @gcportrait/website fillable` / `... stars` / `... demo` (each after `pnpm website:build`) |
| Build the static demo the website serves at `/demo/` (Modes and hosting; `pnpm website:build` runs it) | `pnpm demo:static` (`--out DIR`, `--base PATH`) |
| Regenerate the screenshots, animated demos and link-preview images from demo mode (`docs/media/`, both themes; needs Playwright's Chromium) / check them for staleness | `pnpm media` (`--only ID`, `--theme dark`) / `pnpm media --check` |
| Regenerate the website's sample exports (SVG, PNG and draw.io drawn by `pnpm render`, `docs/media/exports/`) / check them | `node scripts/exports.mjs` / `node scripts/exports.mjs --check` (`--render` also draws them again and compares) |
| Check the draw.io export against the SVG export (maxGraph in Chromium, demos S, M and L in both themes; the limits in Exports and the render API) | `pnpm e2e tests/drawio.spec.ts --project chromium` |

[docs/packages.md](docs/packages.md) maps the packages, their entry points and the data flow;
[docs/configuration.md](docs/configuration.md) lists every setting of an instance.

## Names that never appear

The strings `scripts/check-provenance.mjs` refuses never appear in any file's contents or in any file or
directory name: Google's name with its company suffix, a few project names, decision-record numbers and links,
numbered rules of this file, phrases that record how something was built rather than what it is, and work-item
ids. The check assembles them at run time or knows them only by their SHA-256 digest, so no file spells them
out. It reads every file git tracks and every other file of the tree outside the git-ignored directories:
text in any encoding, and the metadata of images and other binary files. `node scripts/check-provenance.mjs
--list-exempt` lists its rules, with the refused names and phrases as labels only; `--digest-of <phrase>`
prints the entry that adds a phrase to the refused ones. Say what a thing is or does, and cite the rule by its
heading here.
