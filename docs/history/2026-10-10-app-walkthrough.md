<!-- SPDX-License-Identifier: MIT -->

# App walkthrough, 2026-10-10

A record of the build, written on 2026-10-10 and not kept up to date since (on 2026-10-12 the build's
task and phase ids gave way to plain names and dates); what is still open is in
[../backlog.md](../backlog.md). It is the review of the app once its features were built (the app store and top
bar, the view controls, search, the details drawer, the Snapshots page, progressive disclosure, keyboard navigation
and the axe fixes): the commands with their real output, one walk through the whole app in demo mode in both themes
(connect → demo M → lens → focus → filters → search → drawer → drill in → chips → export → snapshots page →
settings), and every open question the reports of those features left, deduplicated. It is candid on purpose: what
the specs already prove is summarised, and what a person notices on the way is listed with where it belongs. The
renders of the visual review and their checklists are in [2026-10-09-visual-review.md](2026-10-09-visual-review.md).

| | |
|---|---|
| Date | 2026-10-10 |
| Tree | `main` at `9ac3b97` plus the uncommitted work on the app's features |
| App under walk | a production build in demo mode (`VITE_DEMO=1 vite build`, served by `vite preview` on a private port), so the walk exercises the shipped bundle, the JSON data tables and the module workers, not the dev server |
| Browser | Chromium (Playwright 1.64) at 1280 × 800, the minimum desktop viewport (ADR 0011); light and dark through the operating system's colour scheme with the app on "System" |
| Data | the synthetic demo organisations S (96 assets), M (952), L (6 382) and XL (about 50 000); no real data |
| Reviewer | the review agent; every screenshot below was opened and looked at whole |

## 1. Commands and their results

| Command | Result |
|---|---|
| `pnpm check` | **green** in 2 min 16 s: `format:check` clean; `lint` and `typecheck` clean; `test` 206 files, **5 976 tests** passed (the visual review of 2026-10-09: 5 500); `catalog:check` OK (632 of 641 official types, 0 rules without fixtures, 265 types without a console template); `provenance` OK (1 910 files, 939 SPDX headers); `licenses` OK (365 packages, `THIRD_PARTY.md` current) |
| `pnpm --filter @gcportrait/frontend test` | green: 88 files, 814 tests (2026-10-09: 33 files, 338 tests) |
| `pnpm build` | **green**; Vite warns that `index-*.js` is larger than 500 kB minified (638 kB raw), which is the size budget's subject below |
| `pnpm size` | **FAILED**: 393.76 kB gzipped against the 350 kB budget, 43.76 kB over (112.5 %); the renderer's work ended at 334.9 kB |
| `pnpm e2e` | **green**: 138 passed in 2.5 min (133 in demo mode, 5 in live mode), first run, no retries |

### 1.1 The bundle budget (blocking, a decision for this review)

`pnpm size` counts every JavaScript and CSS file of the build, the workers included, so splitting chunks does
not help. Measured from a source-mapped copy of the same build (identical chunk hashes), each part compressed
alone, so the figures are indicative rather than additive:

| Chunk (gzip) | What is in it |
|---|---|
| `index` 200.3 kB (UI thread) | react-dom 62, **zod 25**, the diagram renderer 22.5, react-router 13, d3 (selection, transition, zoom, colour, interpolate) about 14, the snapshot library's page side 7, the shell and top bar 7, export 5.9, `ui/` primitives 5.8, view controls 5.4, the layout's metrics constants 5.4, the drawer 4.3, the store 2.7, search's page side 2.5 |
| `codec` 79.6 kB (data and snapshot workers) | the demo generator (`@gcportrait/demo-data` topology 58, data 4, history 4), ingest, the model's schemas |
| `dataRole` 39.7 kB | the catalog engine 9.6, **Fuse.js 7.5** (search), the scene builder 6.7, search ranking and locating about 3.5, the drawer's details 1.4, the view choices 1.6 |
| `layoutRole` 31.9 kB | the layout engine |
| `relation` 28.2 kB (workers) | **zod 25.5** and the model's schemas |
| `index.css` 9.8 kB, `role` 4.0 kB | the app's CSS; the snapshot worker (the Snapshots page) |

Two observations for the decision. zod is bundled twice, once for the UI thread and once for the workers
(about 25 kB each): the workers are a separate build, so the two cannot share a chunk, and the UI thread uses
zod only for `normalizeViewSpec` (the hash codec) and a few `XSchema.options` / `safeParse` calls
(`RelationKindSchema`, `LensIdSchema`, `SnapshotRefSchema`, `ViewSpecSchema`). The growth since the renderer
(about 59 kB) is the features: the snapshot library, the view controls, the drawer, the primitives, search
and Fuse. Options: an ADR that raises the budget (sign-in, the live import and the timeline were still to come),
or separate budgets for the UI thread and the workers, and independently a zod-free hash codec in
`@gcportrait/model` that takes about 25 kB off the UI thread.

## 2. The walk

Each stop ran axe (all non-experimental rules, best practices included) on the whole page and checked that
the footer carries the short non-affiliation line. Result for every stop in both themes: **axe 0 violations,
the footer line present, no console error or warning and no page error.** Screenshots are under
`e2e/.scratch/app-walkthrough/` (git-ignored), named `<theme>-<stop>.png`.

| # | Stop | What happened (light and dark alike unless noted) | Screenshots |
|---|---|---|---|
| 1 | Connect `/` | The demo card (sizes S to XL as a segmented control, a description per size, "Try the demo"), the About panel with the long non-affiliation statement. The top bar's view row is shown inert beside "No scope loaded" (Lens, Focus, Filters, Detail and Search dashed) | `01-connect` |
| 2 | Try the demo, size M | Stored and drawn 0.3 s after the click; opens at `Auto · folders`, "38 of 369 shown"; focus falls to `<body>` after the route change | `02-demo-M` |
| 3 | Lens → Networking | The list shows the 11 lenses with their descriptions (cut with an ellipsis at 1280 px); the lens's default detail applies (`detail=networks`, "172 of 174 shown"), so the fitted view is drawn below the label scale | `03-lens-open`, `03-lens-networking` |
| 4 | Focus → Shared VPC, host "prod" → `demo-net-1` | The picker lists both hosts with their service-project counts; the button reads "Focus: demo-net-1"; the host and its 13 service projects are drawn, "115 of 117 shown" | `04-focus-picker`, `04-focus-shared-vpc` |
| 5 | Filters: empty projects, region `europe-west3` | Two-column popover, chip for the region, badge "Filters 2", "65 of 67 shown" under the focus; Escape closes it back to the button | `05-filters-open`, `05-filters-applied` |
| 6 | `/`, "orders-db", Enter | 16 results grouped by kind with icons; Enter on the best result (a Cloud SQL instance the Networking lens does not draw) opens "orders-db is not in this view" with the reason and two offers, the first focused; "Switch to the Everything lens" lands on it: selected, centred, drawer open, hash `lens=everything&detail=networks&selection=…&highlight=orders-db` | `06-search-results`, `06-search-reveal-dialog`, `06-search-landed` |
| 7 | Drawer | Header (icon, type, name, product line, Close, "Open in Cloud Console ↗"), facts (name with Copy, type, parent and project as jump links, location, two IPs with Copy), "Relations (7)" grouped by kind in the legend's wording, Raw JSON toggle; 16 tab stops | `07-drawer`, `07-drawer-raw-json` |
| 8 | Project jump, "Drill in" | The Project fact selects "Retail services (prod)" (labels as badges, "Relations (44)"); Drill in re-roots the view (`root=…/projects/10000000011`), the breadcrumb shows the five-level trail, focus moves to the new view's first item ("Firestore database: (default)") | `08-project-selected`, `08-drilled-in` |
| 9 | Chips | Back to the organisation at Auto: 22 chips; a click on "Partner exchange" expands it in place (39 of 369) and glides to it at 100 %; Expand all opens the projects level (295 of 369, its tooltip names the next level); Collapse all returns to 38 | `09-chip-expanded`, `09-expand-all` |
| 10 | Export (overview at Auto) | The menu (area, theme preselected to the app's, PNG resolution, embed fonts, Download SVG / PNG, Copy PNG); the SVG (`gcportrait_example.com_overview_20261008T000000Z.svg`, 46 kB) carries the short non-affiliation line in its title block (removed from exports later, ADR 0018); the PNG at 2× (0.8 MB) is the whole diagram with its title block and legend on the theme's canvas | `10-export-menu`, `export.svg`, `export.png` |
| 11 | Snapshots page | One row for the stored demo M (952 assets, 303 kB, 35-day history) with Load, Export, Delete; the import drop zone; "1 snapshot takes 303 kB in this browser" and the browser's estimate | `11-snapshots` |
| 12 | Settings | Theme (System, Light, Dark) and the legend/title-block switch | `12-settings` |
| 13 | Permissions, then Diagram again | The Permissions placeholder text (the page itself came with the scope picker); the Diagram link restores the last view's hash (`#snapshot=demo:M`) | `13-permissions`, `13-diagram-again` |

Opening each demo size from its link in the same build (`light-size-<S|M|L|XL>.png`): drawn after 0.28 s (S,
55 of 55), 0.29 s (M, 38 of 369), 0.88 s (L, 164 of 2 497) and 2.9 s (XL, 494 of 10 479 at `folders`, the
level `auto` falls back to); a first search answered in about 0.2 s on every size (0.3 s on XL).

## 3. Findings

### 3.1 Blocking

1. **`pnpm size` fails** (section 1.1): 393.76 of 350 kB gzipped. Not fixable in the review without a
   decision; nothing else is red.

### 3.2 Seen in the walk, not in any report

1. **The search box shows a stale text** (`frontend/src/shell/topbar/SearchBox.tsx`, search). After a result is
   chosen, every later view without a `highlight` shows the text typed before the choice: the inert box on
   `/snapshots`, `/permissions` and `/settings` reads "orders-db", and so does the box on
   `/diagram#snapshot=demo:M` reached by a new link (`09-chip-expanded`, `12-settings`). The draft
   `{ text, base: '' }` is kept after the choice, and `value` shows it again whenever the highlight returns to
   `''`. Fix: drop the draft when a result is chosen and when the snapshot changes, with a SearchBox test.
2. **The reveal dialog's lens switch skips the lens/detail rule** (search, with the view controls' `views/lensDetail.ts`).
   "Switch to the Everything lens" from the Networking lens at its default (`networks`) keeps
   `detail=networks` ("674 of 951 shown"), where the Lens picker would have applied Everything's default
   (`auto`). Probably deliberate (the target must stay drawn), but it is a second rule for one switch.
3. **A lens's default detail outranks the viewport budget.** Networking and Compute open at `networks`,
   Load balancing and Kubernetes at `all`; on demo M at 1280 × 800 Networking draws 172 rects against a
   budget of 57, fitted below the scale where labels are drawn (0.35), so the first sight of the lens is an
   unlabelled texture until the person zooms (`03-lens-networking`). The rule follows the catalog's
   `defaultDetail` as the view controls documented; whether the default should be a ceiling for `auto` is the maintainer's
   call.
4. **Selecting a large container traces everything inside it.** The jump to "Retail services (prod)" paints
   every line touching anything inside the project, so the whole canvas turns into traced lines with their
   casings (`08-project-selected`). That is the selection trace's rule ("lines touching it or anything inside it"); for a
   project with 44 relations it no longer tells anything apart.
5. **The view row is shown inert on every other page.** Lens, Focus, Filters, Detail and Search sit dashed
   beside "No scope loaded" on Connect, Snapshots, Permissions and Settings (`01-connect`, `11-snapshots`):
   correct and accessible, but noise on pages where they can never work.
6. **The depth slider reads backwards.** Its leftmost position is "No limit"; one step right is depth 1, the
   strictest (`05-filters-open`).

### 3.3 Confirmed from the reports

- The top bar's **Theme** control is still an inert placeholder (dashed "Theme ▾"); the app's design puts a
  theme toggle in the top bar and no feature owned it. The Settings page switches the theme.
- **Expanding a chip zooms to 100 %** on the zone from the overview (progressive disclosure's open question 3), so the context
  around it is gone (`09-chip-expanded`).
- **The "N of M shown" bar floats over the diagram** and the fit keeps no room for it: with the drawer open it
  covers part of `web-https-fr` (`06-search-landed`; progressive disclosure's review).
- **The breadcrumb at 1280 px** cuts a five-level trail to "exa… › W… › R… › Pr… › Retail services (prod)"
  (`08-drilled-in`; the view controls' review).
- **Focus after "Try the demo"** falls to `<body>` (the Snapshots page, keyboard navigation).
- **XL** has no checked radio in the Snapshot menu (the Snapshots page); its overview at `folders` is 494 rects at
  1280 × 800.
- **The dark theme's dialog scrim lightens** the page behind it (`06-search-reveal-dialog`; the top bar's review).
- The L and XL overviews at `folders` show the Shared VPC `shares` lines as thick grey bands along the left
  and between the folder rows (`light-size-L`, `light-size-XL`): a layout matter, see the visual review.

### 3.4 What works

Every stop above passed axe in both themes, kept the footer line, logged nothing to the console, and wrote its
state into the hash (the walk did not reload each step; `controls.spec.ts` and `navigation.spec.ts` prove that
a reload, Back and a copied link restore it). Keyboard operation was not walked by hand again:
`keyboard.spec.ts` drives the same path without a pointer event and checks every focus indicator at 3 : 1,
including pixel by pixel on demo L zoomed out, and passed in the review's e2e run.

### 3.5 Defects the reviews reported and the features left open

Re-checked in this review in the production demo build (still present):

- A snapshot that cannot be loaded (`#snapshot=01ARZ3NDEKTSV4RRFFQ69G5FAV`) leaves Focus and Filters enabled,
  and their pickers say "Loading the snapshot…" for good (the view controls' review).
- A malformed snapshot ref (`#snapshot=demo:Q`) shows "Nothing to draw yet" with no error, and the bad value
  stays in the hash (the reviews of the top bar and keyboard navigation).
- A refused focus (`focus.project=no-such`) draws the whole organisation; the button reads "Focus: no-such"
  and the reason shows only inside the popover (the view controls' review).

Reported by the reviews and not re-checked here:

- Search: on XL a reveal that lands while the person types a new query mixes the two texts ("bastionders-db");
  the reveal dialog keeps the old view's reason after Back (search).
- Drawer: a slow reveal answer (XL) can reopen the drawer after Close, or land on the first of two quick
  jumps; focus drops to `<body>` after a jump link; an unknown selection id gets the scene-bundle wording;
  only `contains` is capped (1 030 `encryptedBy` rows on XL); the resize handle's focus ring is clipped
  (the drawer).
- View controls: renaming a saved view can create two views of one name; a double-click on a chip leaves a
  stray flip in the hash before drilling in (the view controls).
- Disclosure: Expand all and Collapse all read the drawing on screen even while a newer one is pending; Expand
  all can rewrite the hash without opening anything; a mouse click on a collapse button leaves focus on
  `<body>` (progressive disclosure).
- A `jumpTo` for a node that is never drawn stays pending and may glide later, unasked (the app store).
- Another tab deleting the open snapshot leaves the old drawing behind the error card, and the Snapshots
  listing does not refresh across tabs (the Snapshots page).
- When the `window.indexedDB` getter itself throws, `storage/db.ts` raises uncaught page errors (the reviews of every
  feature; the realistic cases, no IndexedDB or a failing `open()`, are handled).
- The top bar's report noted that the frontend README's "S opens fully at 1280 × 800" is stale; that does not hold: S at `auto` is
  55 rects, under the 100-rect floor, and opens fully (checked with `pnpm render-scene --fixture S`).

## 4. Open questions for the maintainer (from the features' reports, deduplicated)

Decisions:

1. **Bundle budget** (the top bar, the view controls, search, the Snapshots page): raise it by ADR, split it by thread, or trim (section 1.1).
2. **History**: lens, drill-in and snapshot changes push a history entry; selection and highlight replace it
   (the app store). A drawer jump to a drawn target replaces, one that opens chips pushes (the drawer's review). Intended?
3. **The `auto` budget includes the drawer's column**, so opening the drawer never re-lays out; a view opened
   with a selection in the hash gets the full-width budget (the app store).
4. **Focus layout**: Focus is one popover button holding the kind and its parameter, to fit 1280 px (the view controls).
5. **Applications and perimeters by structure**: the Application picker offers every product container
   (about 100 on demo M), and the Perimeter picker a BigQuery reservation assignment through a catalog
   `secures` rule. Should the catalog gain an App Hub application flag and narrow `secures`? (the view controls)
6. **Navigation exceptions**: the Snapshot menu's "Snapshots page" uses the router directly (the view controls).
7. **Escape and Close clear the selection** rather than only hiding the drawer (the drawer); and should Escape on a
   selected item clear the selection and return to the zone in one press? (keyboard navigation)
8. **Console link fallback**: when a type has no template or a variable is missing, the drawer shows "Open
   project in Cloud Console ↗" (as the app's design asks) rather than nothing (the drawer).
9. **A NIC's own `attaches` to its network** is folded into the subnet row ("in <network>") (the drawer).
10. **Snapshot ids**: every import gets a new id, so a link naming an exported snapshot's id does not open the
    re-imported copy; the review suggests keeping a free id except the shared demo id (the Snapshots page).
11. **Collapse all** also returns to `auto` when the level in use is deeper, and it reopens zones closed by
    hand (progressive disclosure).
12. **Expand all / Collapse all in the Detail control** as well as on the canvas bar? (progressive disclosure)
13. **Expanding a chip frames it at 100 %**; keep the current scale when the zone already fits? (progressive disclosure)
14. **Canvas focus colour**: light `#185ABC`, a shade darker than the chrome's `#1A73E8`, so the ring reaches
    3 : 1 on the project tint (keyboard navigation).
15. **Chip kind cue**: the zone's 14 px header mark beside the label and ⊞ beside the count line (option a),
    or the kind word on the count line (option b)? (keyboard navigation)
16. **Keyboard zoom floor**: a keyboard move zooms in to 0.35 (labels drawn, text about 4.5 px); 0.55, where
    subtitles show, or closer? (keyboard navigation)
17. **Route-change focus**: move focus to `<main>` (or the canvas) after "Try the demo" and other route
    changes? (the Snapshots page, keyboard navigation)
18. **Search ranking**: the container boost lists instance groups before VMs for "compute instance" (search).
19. **Theme toggle**: build the top-bar theme menu (the app's design) or drop it in favour of Settings? (this review)
20. **Lens default detail versus the budget** (section 3.2, item 3).
21. **Glide and jump rules** changed by search in shared files: the centring glide went from 450 to 200 ms
    (style skill §6 "Search hit"), and a `reveal` jump never replaces a pending centring jump to the same node
    (search).
22. **axe-core is MPL-2.0**, outside the MIT/BSD/Apache/ISC list the build's briefs named, though the repository's
    licence guard allows it; keep it as the frontend's devDependency for the jsdom axe tests? (the top bar)

Engineering follow-ups that need an owner rather than a decision:

1. **One chip-opening loop**: `search/locate.ts` (`locate`) and `drawer/reveal.ts` (`reveal`) implement the
   same toggle-and-rebuild loop over the scene builder (search, the drawer).
2. **Second statements of package rules**: `diagram/disclosure/flips.ts` and `diagram/autoDetail.ts` restate
   the scene builder's level table and the `group:` bundle prefix; `snapshots/labels.ts` restates demo-data's
   size profiles; the drawer reads labels and tags from fixed data paths. Each has a drift test; exporting the
   rule from its package would remove the copy (the Snapshots page, progressive disclosure).
3. **The worker-side budgets**: a search on XL holds the data worker for up to about 150 ms and a locate for
   0.9–1.7 s; should a budget cover them? (search)
4. **Shared IndexedDB connection** for saved views, the snapshot library and preferences, so a schema upgrade
   in another tab does not leave one of them on a closed connection (the view controls, the Snapshots page).
5. **The data worker's per-request store read** before reusing a kept Graph (about 1 ms) or an explicit
   invalidate message (the Snapshots page); and `@gcportrait/ingest`'s new public `ulid` export (the same).
6. **Stale texts** in code comments: `shell/topbar/TopBar.tsx` (says only Snapshot, Lens and Export work),
   `views/SavedViewsDialog.tsx` (names `views/savedViews.ts`), `storage/db.ts` (lists only two stores as
   used), `diagram/disclosure/disclosure.css` and `diagram/diagram.css` (the light focus contrast before
   `#185ABC`).

## 5. Reproduce

```sh
pnpm check && pnpm build; pnpm size; pnpm e2e           # section 1 (pnpm size fails at 393.76 kB)
pnpm --filter @gcportrait/frontend test                  # 88 files, 814 tests
# The walk: a demo-mode production build on a private port, then a Playwright script (kept outside the
# repository, not part of the suite) that drives the stops of section 2 and writes e2e/.scratch/app-walkthrough/.
cd frontend && VITE_DEMO=1 pnpm exec vite build --outDir /tmp/gcportrait-demo --emptyOutDir
VITE_DEMO=1 pnpm exec vite preview --outDir /tmp/gcportrait-demo --port 5198 --strictPort
```

The e2e specs that cover each stop: `snapshots.spec.ts` (1, 2, 11), `controls.spec.ts` (3 to 5, 8, Copy link
and saved views), `search.spec.ts` (6), `drawer.spec.ts` (7, 8), `disclosure.spec.ts` (9), `export.spec.ts`
(10), `keyboard.spec.ts` (the whole path without a pointer), `a11y.spec.ts` and `theme.spec.ts` (12, every
page).

## 6. After the walkthrough fixes (2026-10-10)

The walkthrough fixes worked through this document's findings and the bundle decision of section 1.1. Everything
below was run on `main` at `d7a8fe4` plus the uncommitted fixes, on the same machine as the walk.

### 6.1 Commands and their results

| Command | Result |
|---|---|
| `pnpm check` | **green**: `format:check` clean; `lint` and `typecheck` clean; `test` 211 files, **6 029 tests** passed (the walk: 5 976); `catalog:check` OK; `provenance` OK (1 985 files, 954 SPDX headers); `licenses` OK (365 packages, `THIRD_PARTY.md` current) |
| `pnpm --filter @gcportrait/frontend test` | green: 91 files, 831 tests |
| `pnpm --filter @gcportrait/model test -- --coverage` | green: 561 tests, 100 % statements, branches, functions and lines (schemas and codec held to 100 %) |
| `pnpm build` | **green**; Vite still warns that `index-*.js` is larger than 500 kB minified (547 kB raw) |
| `pnpm size` | **green** under ADR 0029: **UI thread 184.60 of 350 kB** (52.7 %), **workers 184.91 of 400 kB** (46.2 %) |
| `pnpm e2e` | **green**: 144 of 144 (the walk: 138; six new in `walkthrough.spec.ts`). Of the two runs before it, the first failed only `controls.spec.ts`'s Lens test, which still expected the old lens/detail rule (updated); the second failed `theme.spec.ts` once under load: it reloaded before IndexedDB had stored the theme just chosen (the first half of that test already waited for the write; the second half now does too). 40 runs of `theme.spec.ts` alone passed before the change |
| `pnpm exec playwright test` diagram, controls, search and keyboard specs, twice | 53 of 53, then 53 of 53 (no flake) |

### 6.2 The bundle, before and after (ADR 0029)

`pnpm size` now sorts the build by thread and budgets each (section 1.1's decision): the UI thread's initial
chunks 350 kB (a lazy chunk only when it is part of the first paint of `/diagram`; none is), the workers 400 kB.
Measured on the production build, each file gzipped on its own:

| Chunk | Thread | Before (raw / gzip) | After (raw / gzip) | What changed |
|---|---|---|---|---|
| `index-*.js` | UI | 638.07 / **200.30** kB | 546.74 / **174.85** kB | no zod (−25.4 kB gzipped): the hash codec decodes with plain predicates (`@gcportrait/model` `codec/normalize.ts`), and the Lens picker, the legend, the renderer and the snapshot library read the zod-free vocabularies (`LENS_IDS`, `RELATION_KIND_IDS`, `isSnapshotRef`, …) and `RELATION_KINDS` from modules without zod |
| `index-*.css` | UI | 56.84 / 9.75 kB | 56.43 / 9.75 kB | the placeholder styles went with the placeholders |
| `codec-*.js` | workers | 263.65 / 79.63 kB | 113.03 / 31.52 kB | now zod and the model's schemas only (they were the `relation` chunk); the demo generator and ingest left it |
| `relation-*.js` | workers | 103.28 / 28.19 kB | (gone) | merged into `codec` |
| `demo-*.js` | workers | (in `codec`) | 233.42 / 69.14 kB | the demo generator, loaded only by the data worker and only on first use (`diagram/pipeline/demo.ts`) |
| `prepare-*.js` | workers | (in `codec`) | 16.19 / 6.03 kB | ingest, demo-data's generator-free `history/replay.ts` and the record encoder, shared by the snapshot worker and the demo job |
| `view-spec-*.js` | workers | (in `relation`) | 3.67 / 1.69 kB | the ViewSpec schemas the data and snapshot workers validate messages with |
| `dataRole-*.js` | workers | 120.61 / 39.65 kB | 121.14 / 39.82 kB | the `demo` request; the shared chip-opening loop |
| `layoutRole-*.js` | workers | 90.21 / 31.88 kB | 92.56 / 32.73 kB | no longer imports zod at all (it took the `relation` chunk for the model's relation table) |
| `role-*.js` | workers | 10.19 / 3.96 kB | 8.95 / 3.58 kB | the snapshot worker: no demo job any more |
| `diagram.worker-*.js`, `zone-order-*.js` | workers | 0.28, 0.12 kB | 0.28, 0.12 kB | unchanged |
| **UI thread** | | **210.05 kB** | **184.60 kB** | −25.45 kB; the target of ≤ 320 kB leaves 135 kB for sign-in, the live import and the timeline |
| **Workers** | | **183.71 kB** | **184.91 kB** | +1.20 kB; the snapshot worker no longer loads the generator, and the data worker loads it only for a demo organisation |
| All | | 393.76 kB | 369.51 kB | |

Attributed from a source-mapped copy of the same build (`vite build --sourcemap` into a scratch directory), the
UI chunk is now react-dom 63.7 kB, the diagram renderer 23.1, react-router 13.3, d3 about 14, the layout's text
metrics and client 8.1, the snapshot library's page side 7.1, the shell and top bar 7.1, the view controls 6.0,
export 6.0, `ui/` 5.9, the drawer 4.4, and the model's codec, vocabularies and relation table 3.2 (no zod, no
demo-data). What is left could only be deferred, not dropped: the export pipeline (about 6 kB) could load on the
first export, and the Snapshots, Settings and Permissions pages could become lazy routes; neither is needed now.

### 6.3 The findings

| Finding | What the fixes did |
|---|---|
| Sections 1.1 and 3.1, the bundle budget | Split by thread (ADR 0029, accepted), `scripts/check-bundle-size.mjs` classifies the build from `index.html` and each file's own imports and worker references, the budget rules and `docs/contributing.md` updated; trimmed as in 6.2 |
| 3.2, item 1: stale search text | `SearchBox.tsx` drops the draft when a result is chosen and on any change of the highlight or the snapshot; `SearchBox.test.tsx` reproduces the walkthrough's case (a choice, then a saved view without a highlight; then another snapshot) and failed on the old code |
| 3.2, item 2: the reveal dialog's lens switch | `search/locate.ts` applies `views/lensDetail.ts`'s rule to the "Switch to the Everything lens" offer (`locate.test.ts`) |
| 3.2, item 3: a lens's default detail outranks the budget | The default is now the **ceiling** of `auto`: the scene builder never opens deeper (`autoDetailLevel`, `autoCeiling`, the report's `detail.ceiling`); a lens switch sets `auto` while the level follows the lens; an explicit level still wins. Networking on demo M at 1280 × 800 opens at `Auto · folders`, 42 of 174 rects, labelled (`e2e/.scratch/walkthrough-fixes/networking-M-1280x800-{light,dark}.png`) |
| 3.2, item 4: selecting a large container traces everything inside | not changed: the selection trace's rule, a design question for the maintainer (section 4) |
| 3.2, item 5: the view row off the diagram | The view row is rendered on `/diagram` only; its placeholder branches and `shell/Placeholders.tsx` are gone |
| 3.2, item 6: the depth slider reads backwards | Shallow to deep, left to right, "No limit" at the right end (`filterForm.ts` `depthSliderValue`, `depthFromSlider`) |
| 3.3, the top bar's Theme control | A real menu (System, Light, Dark), the Settings page's preference (`ThemeToggle.tsx`; `e2e/.scratch/walkthrough-fixes/theme-menu-open-{light,dark}.png`) |
| 3.3, focus after "Try the demo" | Every route change moves focus to `<main>` (unless the page put it inside) and announces the page's title in a polite live region (`AppShell.tsx`) |
| 3.5, a snapshot that cannot be loaded | The Filters and Focus pickers say "Not available" and the popovers say why (`useViewChoicesState`), never "Loading" for good |
| 3.5, a malformed snapshot ref | "This link names no snapshot" with the rejected value (`views/snapshotRef.ts`); the demo links stay offered |
| 3.5, a refused focus | The Focus button says "not applied" (in words, named "Focus: no-such, not applied"), the reason on hover and in the popover |
| 4, question 15, the chip kind cue | Option (a), as keyboard navigation built it: the zone's 14 px header mark beside the chip's label, ⊞ beside the count line |
| 4, question 16, the keyboard zoom floor | 0.55, the subtitle scale (`KEYBOARD_MIN_SCALE`) |
| 4, question 17, route-change focus | as above |
| 4, question 19, the theme toggle | built, as above |
| 4, question 20, lens default versus the budget | as 3.2, item 3 |
| 4, follow-up 1, one chip-opening loop | `diagram/disclosure/openAround.ts`, used by search's locate and the drawer's reveal |
| 4, follow-up 2, second statements of package rules | `@gcportrait/graph` exports its level table (`ZONE_OPENS_AT`, `zoneOpensAt`), the `auto` rule and `BUNDLE_ID_PREFIX`; `flips.ts` and `autoDetail.ts` read them. Still restated, with drift tests: `snapshots/labels.ts` (demo-data's size profiles) and the drawer's fixed label paths |
| 4, follow-up 4, a shared IndexedDB connection | `storage/connection.ts`: one connection for the preferences, the saved views and the snapshot library, opened again after another tab's upgrade closes it; `openDatabase()` also survives a `window.indexedDB` getter that throws (section 3.5's uncaught page errors) |
| 4, follow-up 6, stale comments | `TopBar.tsx`, `SavedViewsDialog.tsx`, `storage/db.ts`, `disclosure.css` and `diagram.css` (the light focus colour reaches 3.78 : 1 on the project tint and 6.51 on its rim) |

Not addressed by the fixes and still open, each with its owner: the remaining decisions of section 4 (history entries,
the drawer's column in the `auto` budget, the focus layout, applications and perimeters by structure, the
navigation exceptions, Escape on a selection, the console fallback, NIC folding, snapshot ids, Collapse all
reopening closed zones, Expand/Collapse all in the Detail control, framing an expanded chip at 100 %, the canvas
focus colour, search ranking, the glide rules, axe-core's licence), the worker-side budgets (follow-up 3), the
data worker's per-request store read (follow-up 5), section 3.3's floating "N of M shown" bar, the breadcrumb's
truncation, XL's Snapshot menu radio, the dark scrim and the L/XL `shares` bands, and the review defects of
section 3.5 not re-checked here (search's mixed texts on XL, the drawer's slow reveals and focus after a jump
link, the saved-view rename, the stray flip of a double-click, Expand all reading a stale drawing, a pending
`jumpTo`, another tab deleting the open snapshot).
