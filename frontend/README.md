<!-- SPDX-License-Identifier: Apache-2.0 -->

# @gcportrait/frontend

The gcportrait single-page app: React 19, Vite and TypeScript (strict), for phones, tablets and desktops
(three layouts, every control at every width: section "Layouts"), light and dark themes, everything the user
loads kept in the browser's IndexedDB (AGENTS.md, Product rules; frontend/AGENTS.md, Code). It may import the
shared `@gcportrait/*` packages through their entry points but never the backend. One workspace imports it:
the render library ([`@gcportrait/render`](../packages/render/README.md)), behind both `pnpm render` and the
backend's `POST /api/render`, reaches the diagram's SVG components and the app's own data readers through
`src/headless.ts`, the package's only entry point (`exports` in `package.json`), which the app itself never
imports, so `react-dom/server` stays out of the bundle. The backend bundles that path into its render worker
(`backend/dist/render-worker.mjs`), never into the server.

The app is built around one store (`src/state/`: one source of truth for the view, the snapshot, the pipeline,
the selection and the page's own UI state), a top bar with one file per control group (`src/shell/topbar/`)
and headless accessible primitives (`src/ui/`). On them sit the diagram renderer (`src/diagram/`), the view
controls (`src/views/`), search (`src/search/`), the details drawer (`src/drawer/`), the demo entry and the
Snapshots page (`src/snapshots/`), progressive disclosure (`src/diagram/disclosure/`), the keyboard model
(`src/keyboard/`, `src/diagram/keyboard/`), the timeline (`src/timeline/`), Google sign-in (`src/auth/`: the
Connect page's sign-in card and mode selector, the top bar's account menu and the store's `connect` slice),
the live pull and the export load (`src/import/`: "Pull now" and the Connect page's export card, with a role
of its own in the worker script) and the Export menu (`src/export/`), each in its section below. The bundle is
budgeted by thread (frontend/AGENTS.md, Bundle budgets), with no zod on the UI thread and the demo
generator only in workers (AGENTS.md, Architecture and code); section "Performance" says how the app stays
fast on demo L and XL, and the accessibility rules it follows (the keyboard map, accessible names, focus
rings, colour never alone, axe on every page) are the gcp-diagram-style skill's §13.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` (root) | Vite on <http://localhost:5173> plus the backend on :8080; Vite proxies `/api` to the backend. |
| `pnpm dev:demo` (root) | Vite only, as a demo build (`VITE_DEMO=1`), on <http://localhost:5174>. No proxy, no backend calls, a demo-only instance's configuration built in. |
| `pnpm --filter @gcportrait/frontend build` | Production bundle in `dist/` (served by the backend in the production image). No source maps; includes the font licences (below). |
| `pnpm --filter @gcportrait/frontend preview` | Serves `dist/` locally (no backend, no CSP). |
| `pnpm demo:static` (root) | The static demo (section "Static demo" below): this package's build with `VITE_STATIC_DEMO=1`, for `/demo/`, into the repository's `dist/demo/`. |
| `pnpm --filter @gcportrait/frontend test` | Unit tests (Vitest, jsdom, Testing Library, fake-indexeddb). Every render mounts under React's StrictMode, as `main.tsx` mounts the app in development (`src/test/setup.ts`): each component renders twice, and on mount each effect runs, cleans up and runs again, so an effect without its clean-up fails here; a test that counts requests counts the ones the app kept, not the one a clean-up calls off (`src/test/requests.ts`). The e2e suite on CI runs a build, where StrictMode does nothing, so these tests are where the double mount is checked. The fast-check properties run under the seed rule of `@gcportrait/model/testing` (`src/test/fast-check-seed.ts`): a fresh seed on every local run, the fixed `CI_PROPERTY_SEED` on CI, and `FC_SEED=<n>` replays the seed fast-check prints with a failure. |
| `pnpm --filter @gcportrait/frontend lint` / `typecheck` | ESLint and `tsc -b` for this package. |
| `pnpm --filter @gcportrait/frontend mobile` | The phone and tablet check in Chromium: the e2e suite's `mobile` project (`e2e/tests/mobile.spec.ts`; section "Layouts"), against the e2e suite's servers (the Vite dev servers, started by the run on ports of its own; with `CI` set, a build of each mode; `e2e/README.md`). |

Demo and normal mode use different ports and separate Vite dependency caches (`node_modules/.vite` and
`node_modules/.vite-demo`), so both can run at once; the e2e suite runs both, each on a free port of its run
(`--port`; on CI a build of each mode instead, `e2e/README.md`), so a server left on 5173 or 5174 is never
the one it tests.

## Structure

```
index.html              entry document; carries the inline theme bootstrap script (the favicon link is added by the build)
vite.config.ts          ports, /api proxy (not in demo mode), build options, licence emitters, the favicon from
                        brand/icon.svg, the static demo's pages (VITE_STATIC_DEMO=1)
src/main.tsx            fonts, global CSS, BrowserRouter, the page's one IndexedDB connection and the stores over
                        it, the shared diagram workers (`sharedWorkers`), "Try the demo"'s own worker per job
src/App.tsx             providers and routes (react-router, declarative mode); the app store inside the router
src/branding.ts         WORDMARK, TAGLINE and the non-affiliation wording: FOOTER_NOTICE (with the maintainer
                        link) and NON_AFFILIATION_LONG (section "Branding and the non-affiliation notice" below)
src/routes.ts           DIAGRAM_PATH, the one route whose hash is a ViewSpec; the router's basename and an app path
                        for the build's base path (the static demo is served below /demo/)
src/state/              the app store: seven slices, the hash binding, the pipeline controller, the hooks (below)
src/auth/               Google sign-in: the token session, GIS loader, tokeninfo, the provider, the sign-in
                        card, the mode selector, `fetchWithToken` (section "Sign-in" below)
src/scope/              the scope picker: scope names, the search client, recent scopes, ScopeStep (section
                        "Scope picker and permission check" below)
src/preflight/          the permission check: its client, the checklist panel, the words, the guidance
src/commands/           fillable commands: each variable of a command a field filled in place, one value per
                        variable, kept for the tab's session (section "Fillable commands" below)
src/import/             the live pull and the export load: "Pull now", the export card, the import worker, the
                        progress reducer, the error advice (section "Live pull and export load" below)
src/diagram/            the diagram renderer and its pipeline (section "Diagram renderer" below)
src/export/             the export flow: SVG serialiser, PNG rasteriser, draw.io translator, clipboard (section
                        "Export" below)
src/headless.ts         the entry point for other workspaces (`@gcportrait/frontend`): what the render library
                        needs (renderDiagramSvg, palettes, demo loader, icons, the tagline and wordmark, the export
                        file name, the import handler, the bundle reader, the stored-document decoder and the
                        draw.io translator)
src/mode.ts             AppMode (the build-time source URL and the demo configuration built in) from VITE_DEMO,
                        VITE_STATIC_DEMO, VITE_SOURCE_URL and the static demo's variables, and its context
src/source.ts           the footer's source link: SOURCE_LINK_TEXT, DEFAULT_SOURCE_URL, URL checks
src/styles/             tokens.css (design tokens), global.css (element defaults, focus ring)
src/theme/              theme.ts (pure state + reducer), browser.ts (matchMedia, mirror, <html>),
                        ThemeProvider.tsx, useTheme.ts
src/storage/            db.ts (schema, migrations, guarded open), connection.ts (the page's one connection, opened
                        again when another tab's upgrade closes it), preferences.ts (typed preference store),
                        tickCache.ts (the timeline's live days), tickCacheChanges.ts (the tick cache's change
                        signal between the tabs)
src/shell/              AppShell (skip links, top bar, main, the route announcer, the footer with the non-affiliation notice
                        and SourceLink, "Source (Apache-2.0)"), viewHash (the Diagram link's memory of the last
                        view), parity.test.tsx (every control at every width; section "Layouts")
src/shell/topbar/       TopBar (composes only) and one file per control group (section "Top bar" below)
src/ui/                 headless accessible primitives: Menu, MenuButton, Select, Combobox, Listbox, Popover,
                        Dialog, SegmentedControl, Slider, Tooltip (section "UI primitives" below); screen.ts, the
                        layouts' breakpoints and useScreen (section "Layouts" below)
src/pages/              Connect, Diagram, Snapshots, Permissions, Settings, not found; pages/diagram/: the
                        diagram page's TimelineBar (the timeline)
src/timeline/           the timeline: tick math, cache keys, the read scheduler, playback, the bar's model,
                        the controller, the data worker's side (worker/) (section "Timeline" below)
src/drawer/             the details drawer beside the canvas, or over it on a phone or a tablet (section "Details
                        drawer" below)
src/search/             search: the index and the locator in the data worker, the reveal decision table, the
                        results hook and the reveal dialog (section "Search" below)
src/snapshots/          the snapshot library: the demo entry, the Snapshots page's parts, the IndexedDB records,
                        the `.gcportrait.json` file, the snapshot worker (section "Snapshots" below)
src/views/              the view controls' support: the snapshot's choices (data worker), the filter form, focus
                        kinds, the lens/detail rule, the breadcrumb trail, the pickers, saved views (IndexedDB)
                        and Copy link (section "View controls" below)
src/api/config.ts       GET /api/config client (live mode only: auth/AuthProvider.tsx asks once per page and puts
                        the answer into the store, where the footer's source link reads `sourceUrl` and its legal
                        links `legal`); the contract is the model's `PublicConfigSchema`, which config.test.ts
                        holds the zod-free guard to
src/api/demoConfig.ts   a demo build's configuration, built in from VITE_DEMO or VITE_STATIC_DEMO and its variables:
                        what a demo-only instance's /api/config answers (section "Demo builds" below)
src/demoOnly.ts         useDemoOnly() (the backend's DEMO_ONLY; the Connect page's demo-only variant, the
                        demo badge, the Permissions note) and useLegalPages() (`legal` in /api/config)
src/projectSite.ts      the website's address and its self-hosting guide, the demo-only Connect page's link
src/legal/              the legal pages: /impressum and /privacy from GET /api/legal, a Markdown reader that
                        never produces HTML (markdown.ts, RenderMarkdown.tsx), the footer's "Impressum · Privacy",
                        which links a served page or one published elsewhere (`legal.impressumUrl`, `privacyUrl`;
                        section "Legal links and the favicon" below)
src/test/               test setup and helpers (StrictMode for every render, renderApp, renderInPage, axe in jsdom,
                        a controllable matchMedia, a window of a given width, the backend's stand-in, the requests a
                        test counts)
```

## Routes and the URL hash

`/` Connect, `/diagram`, `/snapshots`, `/permissions`, `/settings`, `/impressum`, `/privacy`; anything else
shows a not-found page inside the shell. Below a base path (the static demo's `/demo/`, Vite's `base`), the
router's basename is that path and every route lives below it; the "Copy link" button writes the link with it
too. The URL **hash is reserved for the ViewSpec** (`@gcportrait/model`) and the router never writes it. The
app uses `BrowserRouter`, not a hash router. `shell/viewHash.tsx` remembers the last hash seen on `/diagram`,
and the Diagram navigation link restores it, so leaving the diagram for Settings and coming back keeps the
view. On `/diagram` itself the link keeps the current hash. Code changes the view only through the app store's
actions (`useDiagramActions()`, section "App state" below), which write the hash through the router, so the
router's location and this memory stay current. The skip link moves focus without touching the hash.

**A route change** ("Try the demo", a top-bar link, Back, a saved view applied from another page) moves focus
to `<main>` and announces the new page's title in a polite live region (`AppShell`), as a page load would,
so keyboard and screen-reader users start on the new page rather than on `<body>`, where the control they used
went away. A page that has put focus inside `<main>` itself keeps it; the first page of a load announces
nothing; a hash change alone (a view change on the diagram) is no route change.

## App state (`src/state/`)

One small hand-written store (`store.ts`, no state library), read in React through `useSyncExternalStore`
(`hooks.ts`) and bound to the router by `AppStateProvider` (inside the router, in `App.tsx`). It has exactly
seven slices (`slices.ts`):

| Slice | Holds | Source of truth | Written by |
|---|---|---|---|
| `view` | `hash` (as in the address bar, `''` away from `/diagram`), `spec` (`decodeViewSpec(hash)`), `onDiagram` | the URL hash on `/diagram` | the router (`syncLocation`), the view actions (`writeView`) |
| `snapshot` | `ref` (the view's `snapshot`), `status` (`none`, `loading`, `ready`, `error`), the loading `stage` (`generate`, `ingest`, `graph`), `source` (scope, read time, asset count), `error`, `available` (what the Snapshot menu offers: the demo organisations S, M, L, then every stored snapshot, written by `snapshots/SnapshotLibraryProvider.tsx`; any `demo:` size, XL included, opens from the hash) | the data worker's answers | the pipeline controller |
| `pipeline` | `key` (the view's scene key), `result` (`{ key, answer: SceneAnswer, layout }`), `pending` (`{ ref, stage }`), `error` (message and the node ids a refused layout named), `canvas` (the diagram page's measured size, null off the page), `viewport` (the size the result was asked at), `requests` | the two workers | the pipeline controller |
| `selection` | `selected` and `highlighted` (the view's `selection` and `highlight`), `hovered` (the node under the pointer) | the hash; the canvas for `hovered` | derived with the view; `setHovered` |
| `ui` | `drawerOpen`, `searchOpen`, `popover` (the one open top-bar popup: `'lens'`, `'snapshot'`, …), `sheet` (the top bar's open fold on a phone or a tablet, `'view'` or `'more'`; never open with the drawer: opening one sets `drawerOpen` false, `apart`), `jump` (a pending camera glide `{ id, seq, mode? }`) | the page only; **never in the hash** | `updateUi`, `usePopover`, `useSheet`, `actions.jumpTo` |
| `connect` | `backend` (GET /api/config: `demo`, `loading`, `ready` with the config, `unavailable`), `session` (the sign-in: status, account email, expiry, renewal, problem; **never the token**), `mode` (`user` or `sa`); `scope`, `quotaProject` and `preflight` (the last check's request and answer) | `auth/AuthProvider.tsx`, the token session, the mode selector; the scope picker and the permission check | `updateConnect` |
| `timeline` | `ref` (the view's snapshot), `info` (its timeline from the data worker: a stored `history`, or a `live` scope), `today` and `now` (the timeline's last day; a live scope's from the app's clock), a live scope's day `status` (`loading`, `cached`, `error`) and `failures`, the read's `progress`, `blocked` (why days cannot be read), `playback`, `interval`; `extras` (the extra ticks: the scope's stored exports and pulls, null until known) and `playExtras`; the view's `tick` itself stays in the hash | the data worker's Scene answer; the tick cache; the reads; the snapshot library's listing (`extras`) | the timeline controller (`timeline/controller.ts`) and playback, through `updateTimeline`; `extras` by the snapshot library's binding (`bindExtraTicks`); reset when the snapshot changes (the interval and `playExtras` kept) |

**The hash is the source of truth of the view.** The provider feeds every router location to `syncLocation`
(in a layout effect, before paint): on `/diagram` the `view` slice becomes the hash and its decoding, so
unknown keys are ignored and a malformed value falls back to its default field by field; elsewhere it is the
default view. A view change goes out through `writeView`: the new ViewSpec is encoded with `encodeViewSpec`,
the slice mirrors that hash at once (two writes in one handler build on each other) and the navigator
(react-router's `navigate`, keeping the query string on the same route) puts it into the URL; when the router
reports the same hash back nothing changes. A hash the store only read is never rewritten (unknown keys stay
in the address bar until the next write drops them). Nothing outside the `view` slice ever reaches the hash.

**Actions** (`useDiagramActions()`, one object for the life of the app; `ViewActions` in `store.ts`). Feature
code changes the view only through them, never through the router, the workers or the renderer. Discrete
changes push a history entry (Back undoes them); continuous ones replace it; every action takes `{ history }`
to override (a filter slider being dragged: `replace`):

| Action | History | What it does |
|---|---|---|
| `setLens(lens)` | push | another lens; the detail level is kept |
| `setFocus(focus \| null)` | push | a focus view (`{ kind, params }`) or none |
| `setDetail(level)` | push | a detail level |
| `setFilters(patch \| fn)` | push | merges filter fields, or maps the current filters |
| `drillIn(root \| null)` | push | re-roots the view (null: the organisation); drops the selection |
| `flip(zoneId)` | push | toggles the zone's flip (`flipIdOf` of `@gcportrait/graph`) |
| `expandAll()` | push | "Expand all": opens the shallowest collapsed tier of the diagram on screen (section "Progressive disclosure"); pressed while another view's drawing is on screen, it waits for the view's own |
| `collapseAll()` | push | "Collapse all": closes every zone opened by hand, and goes back to `auto` when the level in use is deeper; never opens anything; waits as `expandAll` does |
| `setSnapshot(ref)` | push | opens a snapshot on `/diagram`, keeping lens and detail (`snapshotView`) |
| `setView(fn)` | push | any other change (the timeline's tick, a saved view) |
| `select(id \| null)` | replace | the selection; selecting opens the drawer (`ui.drawerOpen`) and closes an open sheet (a search result picked in View) |
| `highlight(id \| null)` | replace | a node id or search text |
| `jumpTo(id, { mode? })` | none | asks the renderer for a camera glide to the node (`ui.jump`): centred (default), or with `mode: 'reveal'` (the details drawer) only panned into view |
| `stepTick(-1 \| 1)` | push | one day back or forward: the timeline keys `[` and `]` (`keyboard/TimelineKeys.tsx`) and the bar's step buttons; writes `tick` (the snapshot's own day as no tick) and answers whether it moved; when it cannot (no snapshot, the timeline not known yet, either end) the keys' status message says why (`stepTarget` of `timeline/model.ts`) |

**Hooks.** `useAppState(selector)` (a selector returns something already in the state or a primitive, never a
new object), `useView()`, `useScene()` (the `SceneAnswer` on screen: Scene, report, source, lens title, icons,
console links), `useLayout()`, `useSelection()`, `useUi()`, `usePopover(id)` (`[open, setOpen]` over
`ui.popover`, so one top-bar popup is open at a time), `useSheet(id)` (the same over `ui.sheet`, one sheet at
a time; opening one closes the drawer), `selectScope` (the breadcrumb's scope),
`useDiagramPipeline(canvasRef)` (the diagram page only).

**The pipeline** (`pipeline.ts`, run by `useDiagramPipeline` on the diagram page). Whenever the view's scene
key changes (everything but `selection` and `highlight`, so selecting never asks a worker for anything) the
controller asks the data worker for the Scene and the layout worker for its Layout; a newer request aborts the
older one (and both worker clients cancel a superseded request); the previous diagram of the same snapshot
stays on screen meanwhile; the data worker's loading stages and a snapshot that cannot be loaded go into the
`snapshot` slice. Leaving the page empties the slice. The scene key's timeline `tick` is the day that can be
drawn now (`selectSceneKey` in `viewKey.ts`, `tickToDraw` of `timeline/model.ts`): a live day not read yet
keeps the diagram on screen until it is cached; a day of a snapshot already loaded is read and built with its
stages on the canvas but never takes the `snapshot` slice back to loading. While the large-snapshot guard asks
whether to draw the view's snapshot (`useDiagramPipeline`'s `held`, section "Snapshots"), nothing is asked of
a worker.

**The measured canvas and `auto`.** The canvas element is measured synchronously before the first request and
then by a `ResizeObserver` (`measureDiagramArea` in `diagram/autoDetail.ts`): its height and the width of its
row, so the details drawer opening beside it (or over it, on a phone or a tablet) changes nothing (a selection
must never re-lay the diagram out under the node just clicked). In a 1280 × 800 window that is about 1280 ×
624 (the top bar, the timeline bar and the footer take the rest), a budget of 57 rects; until the canvas has a
size (jsdom), 1280 × 800 stands in. Each request is made at the latest measured size. A resize asks for the
view again only when its detail is `auto` and the Scene report's rect counts say the new budget would pick
another level, with a hysteresis band (`AUTO_HYSTERESIS`, 10 %): the next level opens once the budget clears
its rect count by 10 %, the current one closes once the budget falls 10 % below its own, so dragging a window
edge across a threshold does not flap. `autoLevel` restates the scene builder's rule (deepest level within the
budget; never collapse 100 rects or fewer); `autoDetail.test.ts` checks it agrees with `buildSceneWithReport`
on demo S, M and L. The render CLI keeps its own documented default viewport (1280 × 800, `--viewport`).

**The renderer's side.** `DiagramCanvas` takes three store-facing props: `jump` (a pending `jumpTo`), which it
makes as a glide (`diagram/camera.ts`: the node centred at 100 % or closer, or fitted when larger; 200 ms
eased, the search hit's glide, skill gcp-diagram-style §6; centre in a line and scale geometric; at once with
reduced motion; a pan or zoom by the person stops it; a centring jump to the node already selected pulses its
selection ring again; a `reveal` never replaces a centring jump to the same node still waiting to be drawn;
with `mode: 'reveal'` only the short pan of `revealTransform`, section "Details drawer") as soon as the node
is drawn, then reports with `onJumpDone`; `onHover`, which reports the node under the pointer; and `panels`,
which the diagram page derives from `ui.sheet` and the drawer's open state (`drawerOpen` with a selection), a
value that changes when a panel over the canvas opens or closes. A centring jump (a drill-in's, a jump
link's, a search hit's), the glide that frames a flip, the pan that follows keyboard focus and a zoom key's
step keep the node in the part of the canvas that the panels lying over it leave
in view, and clear of the disclosure bar too even at rest, where it floats over the canvas's foot and is no
fit obstacle (`jumpRoom`: the elements marked `data-canvas-overlay` or `data-canvas-jump` that lie open over
the canvas, the details drawer of a phone or a tablet along its right or lower edge with the disclosure bar's
row in the part it leaves, or the top bar's View or More sheet hanging from its top edge with the disclosure
bar on a tablet; one panel leaves the
largest part of the canvas it keeps free to its left or right, above or below it, and the drawer and the row
the largest part clear of both, whichever comes first, `largestFree`; a closed panel or one out of sight,
`visibility: hidden`, counts for nothing; and `inRoom` in `diagram/camera.ts` works the camera out for that
part as if it were the whole canvas); on a desktop nothing lies over the canvas and the room is the canvas. A
fit shows the whole
drawing in the part the panels leave too (`fitRoom`, for the elements marked `data-canvas-overlay` alone; the
whole canvas where they leave nothing to fit into, a phone's
drawer at full height, which hides the drawing): the fit a new view opens with (a new frame drawn: a drill-in,
a lens or a filter picked in the View sheet, a day whose drawing is another size, a resize that picks another
level) and `0`'s. While the camera still rests on the last fit (the person has not panned, pinched, zoomed or
jumped since; `sameCamera` in `diagram/camera.ts`, a glide on its way to the fit counting as resting on it), a
change of `panels` fits the drawing again to the part the panels leave now, in the zoom keys' short glide (at
once with reduced motion) and without a new layout, and so does the drawer's reveal after the drawer changed
its height or width (its own state, which `panels` does not carry). So a lens picked in the View sheet draws
its whole view below the sheet and the drawing fills the canvas again once the sheet closes, a node tapped at
the fit leaves the whole drawing above or beside the drawer (its reveal has nothing more to do) and the canvas
filled again once the drawer closes, and a camera the person moved stays where they put it. The canvas learns
of a panel opening or closing through this prop: the prop changes in
the same commit as the panel's `hidden`, so the refit, a layout effect, measures the panel as it now is,
before the browser paints and before the drawer's reveal asks for its pan, both of which a mutation or resize
observer would answer after. A ResizeObserver watches the marked overlays' sizes and the disclosure bar
through its stable `data-canvas-resize` marker, including across breakpoint changes that keep the same open
panel. A disclosure notice appearing or being dismissed fits the drawing to the new room under the same
resting-camera guard. A camera the person moved stays where they put it. `data-canvas-overlay` marks the
room a fit counts, and `data-canvas-jump` the room a directed move keeps clear of: the bar at rest carries
only the latter, so it never shrinks an overview fit while no node a jump, the keyboard or a flip brings into
view lies under it.

Tests: `store.test.ts`, `AppStateProvider.test.tsx`, `pipeline.test.ts`, `diagram/autoDetail.test.ts`,
`diagram/camera.test.ts` and `diagram/DiagramCanvas.camera.test.tsx`.

## Top bar (`src/shell/topbar/`)

`TopBar.tsx` only composes; each control group is its own file and talks to
the app store (never to the router or the renderer). The composition order is the tab order and the visual
order (`TopBar.test.tsx`). The app row (gcportrait's mark and the wordmark, the navigation, then Snapshot,
Saved views, Copy link, Theme, the account once someone has signed in, and last, at the bar's right edge,
Export, the bar's one filled primary button) is on every page; the view row (breadcrumb, Lens, Focus, Filters,
Detail, Search) is rendered on `/diagram` only (away from the diagram its controls could never work). A
control that cannot act yet keeps an inert state (`aria-disabled`, focusable, doing nothing): Export while
nothing is drawn, Copy link away from the diagram, Focus, Filters and Search without a snapshot.

On a phone or a tablet the same controls fold into two sheets (section "Layouts"): **More** holds the
navigation and the app row's actions, **View** the view row's controls but the breadcrumb, the search last as
a field the sheet's width (`sheets.ts` names them in the store's `ui.sheet`). A tablet keeps the two rows (the
wordmark, the demo badge and More; the breadcrumb and View); a phone has one: the mark, the breadcrumb on
`/diagram`, View and More, with the demo badge at the top of More.

| File | Control | State |
|---|---|---|
| `Breadcrumb.tsx` | the scope and the drill-in trail; each crumb drills out (`actions.drillIn`) | working |
| `LensSelect.tsx` | Lens picker (`ui/Select`, titles and descriptions; `actions.setView` with the lens/detail rule) | working |
| `FocusControl.tsx` | Focus button and popover: the focus-view select and its parameter picker (`actions.setFocus`); a focus the scene builder refused says "not applied" on the button itself, the reason on hover and in the popover | working (inert without a snapshot) |
| `FiltersControl.tsx` | Filters popover, every ViewSpec filter, active-count badge, Reset (`actions.setFilters`); the depth slider reads shallow to deep with "No limit" at its right end | working (inert without a snapshot) |
| `DetailControl.tsx` | detail segmented control (`ui/SegmentedControl`, `actions.setDetail`); Auto names the level it picked | working |
| `SearchBox.tsx` | search (`ui/Combobox` over the data worker's index; `/` focuses it; section "Search") | working (inert without a snapshot or with one that failed to load) |
| `ThemeToggle.tsx` | Theme menu (`ui/MenuButton`, radio items System, Light, Dark): the same preference as the Settings page (`useTheme`) | working |
| `ExportMenu.tsx` | Export menu, the last control of the app row: a filled primary button (`--color-primary` fill, `--color-on-primary` text; the inert state has no fill) whose menu opens leftwards from the bar's right edge (the export flow is `src/export/`) | working (inert while nothing is drawn) |
| `SnapshotMenu.tsx` | Snapshot menu (`ui/MenuButton`): the open snapshot (scope, read time, source), `snapshot.available`, `actions.setSnapshot`, the Snapshots page | working |
| `../../views/SavedViewsDialog.tsx`, `../../views/CopyLink.tsx` | "Saved views" (a `ui/Dialog`) and "Copy link" (a toast), mounted in the app row after the Snapshot menu | working |
| `sheets.ts` | the folds' ids, `VIEW_SHEET` and `MORE_SHEET` (`TopBar.tsx`; `SearchBox.tsx` opens View for `/` on a phone or a tablet) | working |
| `AccountMenu.tsx` | the account slot, before Export at the end of the app row (live mode, once someone signed in): the account's letter and a `ui/Popover` named by the email (with "(ends HH:MM)" when renewal needs a click), its panel showing how long the sign-in lasts, "Stay signed in", "Sign in again" after an expiry ("Session expired" on the button) and "Sign out"; a polite live region says when the sign-in is about to end or has ended (section "Sign-in") | working |

## Layouts (`src/ui/screen.ts`)

The app serves phones, tablets and desktops with the same controls (AGENTS.md, Product rules). `ui/screen.ts`
names the three layouts and their breakpoints, in rem: the phone up to 47.99rem (portrait and landscape), the
tablet from 48rem to 79.99rem, the desktop from 80rem (1280 px at the default text size); `useScreen()`
follows the window through `matchMedia` (a window without it, as in jsdom, is a desktop). Media queries cannot
read custom properties, so the stylesheets write the same queries out (`MEDIA`): `(max-width: 79.99rem)` for
what the phone and the tablet share, `(max-width: 47.99rem)` for the phone alone. Two container queries ask
for a part's own room instead: `CONTAINER.shortCanvas`, `(max-height: 20.24rem)`, a phone's canvas too short
for the disclosure bar above the half-height drawer, where the drawer and the bar would leave less than a
third of the canvas in view (the bar's frame over the canvas is the container), and
`CONTAINER.shortWorkspace`, `(max-height: 18.49rem)`, a phone's diagram workspace (the canvas and the timeline
bar, the window less the top bar and the footer) too short for the whole timeline bar and a canvas whose
half-height drawer holds its header's Close button whole (the workspace is the container). `ui/screen.test.ts`
refuses any other width or container query in any stylesheet and checks `--breakpoint-tablet` and
`--breakpoint-desktop` in `styles/tokens.css` against the constants. Where the folding needs the DOM to change
(a fold's button, the order of the timeline bar's parts), the component reads `useScreen()`; everything else
is CSS.

| Part | Desktop | Tablet | Phone |
|---|---|---|---|
| Top bar | the app row, and on `/diagram` the view row | the same two rows; the navigation and the app row's actions fold into More, the view row's controls but the breadcrumb into View | one row: the mark (the wordmark for assistive technology only), the breadcrumb on `/diagram`, View and More; the demo badge at the top of More |
| Breadcrumb | crumbs cut with an ellipsis | the crumbs at full width in a box that scrolls sideways (no scroll bar) and rests at its end, so the current level always shows; a swipe brings the others into view, a crumb that takes focus from the keyboard scrolls the trail until it shows whole, clear of the faded edge where they are cut (a tap or a click scrolls nothing, so it lands on the crumb it was aimed at) | as on a tablet |
| Details drawer | a column beside the canvas, 360–420 px | a panel over the canvas's right side, at most half the canvas wide; its header and details scroll together inside it | a sheet over the canvas's lower half, taken to the canvas's whole height and back by its handle (it settles at half or full; dragged down it follows the finger and fades once letting go would close it), its header and details scrolling together inside it; at full height the canvas's content is hidden |
| Timeline bar | one row; the slider and its dates sit above the bar's middle, so the day markers under the track fit in below the reach of the thumb's focus ring | the readout below the slider's line, which is as on a phone | the slider across the width on a line of its 44-pixel thumb and, below the reach of the thumb's focus ring, the day markers under its track (the bar no taller for them); the readout below, then the buttons and the playback options; on a workspace under 18.5rem tall (a phone turned sideways), while the drawer is open, one line, the slider and the step and play buttons after it, the readout and the playback options hidden until the drawer closes, so the canvas holds the half-height drawer's header |
| Disclosure bar | a panel at the canvas's bottom right | at the canvas's bottom left, at most half the canvas wide, clear of the drawer's panel; while the drawer is open, the camera keeps the drawing clear of it too, and at rest a jump, a flip and the keyboard's focus keep a node clear of it | a compact row across the canvas's foot, above the drawer's sheet while it is open (the camera then keeps the drawing in the band above it), or hidden while it is open on a canvas under 20.25rem tall (a phone turned sideways, the smallest phones upright); hidden while View or More is open |
| Pages, dialogs, footer | as they are | the pages in one column, a table too wide for it scrolling sideways in its own box (a snapshot row's actions wrap first, so the Snapshots page's tables fit a tablet); the footer's notice beside its links while it keeps 16rem, above them when narrower | less room around the pages; the Permissions page's reference a list under a heading per mode instead of a table, each command as wide as the page with its Copy button under it; dialogs nearly the window's size |

**Folds.** View and More are `ui/Popover` sheets (`sheet`), `inline` on a desktop: no button, the anchor and
the panel `display: contents`, so the controls are the rows' own flex items and the desktop's layout and tab
order are what they were. On `/diagram` the bar carries the canvas's measured height as `--canvas-height`
(`TopBar.module.css`, `.overCanvas`), so a lens or a filter chosen in the sheet shows its drawing in the part
below it. One sheet at a time (`ui.sheet`, `useSheet`) and one popup at a time (`ui.popover`), a popup opening
inside its sheet (`popup.module.css`, `.sheet`), its column the sheet's width whatever it holds, so a sheet
never scrolls sideways; a control the sheet scrolls into view by focus stops below the handle's inner half
(`scroll-padding-top`). A sheet and the details drawer are never open together (`apart` in `state/store.ts`).
Which controls fold where, what closes what, and the room the canvas keeps are frontend/AGENTS.md, "Phones,
tablets and desktops"; the camera's `clearRoom`, `fitRoom` and `panels` are section "App state".

**Touch, reach and tables.** `--control-height` grows to `--touch-target` under `(max-width: 79.99rem)`, and
the bars and the drawer pad with `env(safe-area-inset-*)` (`viewport-fit=cover` in `index.html`); the canvas
reads a finger itself (section "Diagram renderer", "Touch"). A table too wide for its page scrolls sideways in
a box of its own that is positioned (`tableWrap` in `snapshots/` and `preflight/`), as the permission check's
panel is, since `.visually-hidden` text without a positioned box around it is placed against the window,
outside the page's own scroll box, and makes the document scroll. On a phone the Permissions page's reference
is a list of commands under a heading per mode and the Snapshots page's tables a list of cards, one per row
(`preflight/PermissionsGuide.tsx`, `snapshots/RowTable.tsx`, by `useScreen()`; the same commands, columns and
buttons either way).

**Checks.** `shell/parity.test.tsx` (widths through `test/viewport.ts`, a `matchMedia` for a width) and
`e2e/tests/mobile.spec.ts`, run with `e2e/tests/touch.spec.ts` by `pnpm --filter @gcportrait/frontend mobile`
(frontend/AGENTS.md, "Phones, tablets and desktops", says what each holds).

## UI primitives (`src/ui/`)

Headless, accessible, small (no component library; frontend/AGENTS.md, Diagram and themes). Each takes the app
chrome tokens only (both themes; `ui/tokens.test.ts` fails on a raw colour or a colour token one theme lacks),
is keyboard operable and has Testing Library tests with axe (`src/test/axe.ts`: axe-core in jsdom, all rules
but colour contrast, which needs a rendering browser, one audit at a time, each waiting for the one before it,
so that a test timing out mid-audit costs the next one time, not its result; the e2e suite runs axe in
Chromium on whole pages in both themes). Those with a popup take an optional controlled `open` /
`onOpenChange` (the store's `usePopover`) and an inert `disabled` (`aria-disabled`, a hint as the title,
focusable, doing nothing).

| Primitive | Pattern | Keyboard and pointer |
|---|---|---|
| `Menu` | WAI-ARIA menu, at a point (`fixed`, kept inside the viewport) or anchored under a trigger; `menuitem` (an action or a link opening a new tab only when activated), `menuitemradio`, `menuitemcheckbox` | ↑ ↓ wrap, Home End, type-ahead, Enter Space activate (`keepOpen` items leave it open), Escape closes and the opener restores focus, Tab closes, a press outside closes |
| `MenuButton` | menu button: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls` while open | Enter Space ↓ open on the checked radio item (else the first), ↑ on the last, a click toggles; choosing or Escape gives focus back |
| `Select` | select-only combobox (`role="combobox"` button + `Listbox`), focus stays on the button, `aria-activedescendant`; options may carry a `description` (the lenses'), `listClassName` sizes the list | closed: ↑ ↓ Enter Space open on the current option, Home End, a typed character; open: ↑ ↓ (no wrap), Home End, type-ahead, Enter Space choose, Tab chooses and moves on, Escape closes |
| `Combobox` | editable combobox with a results `Listbox` (`aria-autocomplete="list"`), a polite result count (`status` replaces it); options may carry a `group` and a decorative `icon`; `inputRef`, `keyShortcuts` (`aria-keyshortcuts`), `align`, `listClassName`; `busy` (results that arrive later; the listed options are an earlier text's, greyed and never active or chosen) and `enterChoosesFirst` | ↓ opens or moves, ↑ moves (both wrap), Alt+↓ opens, Enter chooses (with `enterChoosesFirst` the first when none is active), Escape closes then clears; a click chooses without taking focus; a press on the focused input reopens the list; while `busy`, ↓ ↑ Enter are kept and apply to the options that arrive |
| `Listbox` | the listbox popup of the two comboboxes (presentational); consecutive options with one `group` name form a `role="group"` named by a heading row (APG "grouped options"); an option with a second line is named by its label and described by the line (`aria-labelledby`, `aria-describedby`), which a sized list cuts with an ellipsis (its title has it all); `busy`: `aria-busy`, options in the secondary text colour | pointer move activates, click chooses; the active option scrolls into view |
| `Popover` | button + non-modal `role="dialog"` panel (`aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`); an `adornment` after the label (the Filters count badge, the Focus summary); `sheet`: a fold of other controls, its content kept mounted (hidden) while closed, its panel marked `data-canvas-overlay` (a camera jump keeps a node clear of it, `DiagramCanvas`'s `clearRoom`), and `inline`: the same content in place without a button (section "Layouts") | focus moves in, Tab is trapped inside, Escape closes back to the button, a press outside closes; `children` may be a function of `close`; a sheet leaves an Escape its content handled alone, ignores presses while a modal dialog makes it inert, and closed with focus inside it (a pick) gives focus back to its button |
| `Dialog` | modal dialog (`aria-modal`, labelled by its title, described by `description`) at the end of `<body>`, the rest made `inert`; `alert`: an alert dialog (`role="alertdialog"`, a decision its own actions make: no Close button) with `initialFocus` on its least destructive action | focus moves in, Tab trapped, Escape, Close and the backdrop close (an alert dialog: Escape only), focus returns to the opener |
| `SegmentedControl` | radio group (`role="radiogroup"`, `role="radio"`), the checked option the one tab stop and check-marked | ← → ↑ ↓ move and choose (wrapping), Home End, click |
| `Slider` | `role="slider"` with `aria-valuetext` (the timeline's day); `marks` drawn inside the track (the timeline's markers); inert, its thumb is hollow, so the state shows by shape as well as colour; on a phone or a tablet the thumb is a 44-pixel touch box round the 16-pixel dot, which carries the focus ring; the focus ring is keyboard focus's, as on a native range input: a press (a mouse, a pen, a finger) that focuses the thumb marks it `data-pointer-focus`, which hides the ring until a key is pressed on it (any key but a shortcut with Ctrl, Alt or Meta) or focus leaves it | ← ↓ → ↑ step, Page Down / Up `bigStep`, Home End, press and drag on the track with the primary button (a mouse's left, a pen's tip, a finger), focusing the thumb without the ring, the drag following that pointer alone and ending when its primary button comes up, also while another is still held; a press of another button (right, middle, a pen's barrel or eraser) moves nothing, as on a native range input, and leaves focus where it is, as a press on an inert slider does |
| `Tooltip` | `role="tooltip"`, always in the DOM, named by the trigger's `aria-describedby` | shows on focus at once and after a resting pointer, stays while the pointer is on it, Escape and blur hide it (WCAG 1.4.13) |

`dom.ts` holds the shared pieces (focusable elements, the Tab trap, the outside-press hook, whether focus
shows its ring, the inert props, controlled open state) and `typeahead.ts` the type-ahead (next label starting
with the typed text; a repeated character cycles; forgotten after 500 ms).

`controls.module.css` is the controls' own look: `control` (the trigger and button metrics), its inert state,
and `danger`, the destructive variant every Delete button takes (`cx(controls.control, controls.danger)`: the
error colour as text and outline). The variant is a compound rule on `control`, so it outranks the control's
rule and any page's class whatever order the stylesheets are emitted in, and an inert one keeps the inert
look; `ui/tokens.test.ts` holds the rule, its 4.5 : 1 on the control's fills and that no other sheet defines a
`danger` class, and `e2e/tests/snapshots.spec.ts` reads the colours in a browser in both themes.

## Theme and token policy

- Colours, focus ring and control metrics are the app chrome tokens of
  `.agents/skills/gcp-diagram-style/SKILL.md` §9, and typography is §3, copied value for value into
  `src/styles/tokens.css` as CSS custom properties (`--color-primary`, `--color-surface`, ...,
  `--font-family-sans`, `--font-size-card-title`, ...). A new colour goes into the skill first, then into the
  tokens, in both themes. Every stylesheet of the chrome is a CSS module beside its component and uses these
  properties only, never a raw colour value, and asks for a width only with the layouts' media queries, in
  rem, at its end (section "Layouts"): `ui/tokens.test.ts` fails on a raw colour or a colour token one theme
  lacks, `ui/screen.test.ts` on any other width or container query. The diagram has a token table of its own
  (`src/diagram/theme/`, section "Diagram theme and contrast"), which the chrome's tokens never reach.
- `<html data-theme="light|dark">` selects the palette. The user's preference is `system`, `light` or `dark`;
  `system` follows `prefers-color-scheme` live (a `change` listener) and is resolved to light or dark before
  it reaches the attribute. `useTheme()` gives `{ preference, resolved, setPreference }`.
- No flash of the wrong theme: IndexedDB is the store of record but cannot be read before first paint, so
  every change is also mirrored to `localStorage["gcportrait.theme"]`. The inline script in `index.html` reads
  that mirror and sets `data-theme` before anything renders. `src/theme/bootstrap.test.ts` runs the real
  script against `resolveTheme()` for every combination, so the two cannot drift. If the mirror is missing,
  the app adopts the IndexedDB value as soon as it loads. The backend's CSP allows exactly this inline script
  by hash.
- Fonts: Roboto (400, 500, 700) and Roboto Mono (400) are self-hosted from the `@fontsource/*` npm packages
  and bundled by Vite (never inlined, never fetched from a CDN). "Google Sans" heads the stack but has no
  `@font-face`, so it is used only when installed on the viewer's system.
- Font licences: the Roboto fonts are licensed under the SIL Open Font License 1.1, which requires the
  copyright notice and the licence to travel with every redistributed copy. Because the font files are copied
  into `dist/` (and so into the production image), the build also writes each package's own `LICENSE`,
  unmodified, to `dist/licenses/roboto-LICENSE.txt` and `dist/licenses/roboto-mono-LICENSE.txt` (the
  `gcportrait:font-licences` plugin in `vite.config.ts`; the build fails if a `LICENSE` is missing). The
  backend serves them like any other file. Add a package to `BUNDLED_FONT_PACKAGES` when you bundle another
  font.
- Own licence: the build also copies gcportrait's own `LICENSE` (the Apache License 2.0, with a closing note
  on what it does not cover: the gcportrait name and icon, and the third-party material) and `NOTICE`, from
  the repository root, byte for byte, to `dist/licenses/gcportrait-LICENSE.txt` and
  `dist/licenses/gcportrait-NOTICE.txt` (the `gcportrait:own-licence` plugin), so the built app and the image
  that ships it carry them.
- Inlined packages' licences: a bundle drops the `LICENSE` files of the npm packages it inlines (React,
  fuse.js, zod, ...), while their licences ask for the notice to travel with every copy. The
  `gcportrait:inlined-licences` plugin collects the modules of every chunk, of the app and of each worker, and
  passes their package directories to `scripts/third-party-notices.mjs`. The build writes its combined app,
  server and render-worker notices to `dist/licenses/THIRD_PARTY_NOTICES.txt`, linked from Settings.
  [THIRD_PARTY.md](../THIRD_PARTY.md#what-the-licences-ask-of-a-copy) describes the notices it carries.
- Focus ring: 2 px primary with a 2 px surface gap on `:focus-visible`, drawn as box shadows plus a
  transparent outline so forced-colours mode still shows it. A slider's thumb that a press focused shows it
  from the first key pressed on it, as a native range input does, and on a phone or a tablet the ring goes
  round the thumb's 16-pixel dot, not round its 44-pixel touch box (`ui/Slider`, section "UI primitives"). The
  timeline bar keeps the ring's reach between the track's ends and the dates beside them, so the ring covers
  neither date at the first or the last day, and starts the row of day markers under the track where the ring
  ends, so it covers no marker, the current day's under the thumb included.
- Placeholder controls (the top-bar slots, the Connect page actions, the timeline slider without a snapshot)
  are marked `aria-disabled="true"`, not `disabled`: they stay in the tab order with the focus ring, are
  announced as unavailable, and do nothing when activated (the `ui/` primitives have the same inert state
  through their `disabled` prop). Section "Top bar" lists the primitive each control is built on.
- Both themes are checked by axe in the e2e suite (`e2e/tests/a11y.spec.ts`) on every page in demo mode
  (`/`, `/diagram`, `/snapshots`, `/permissions`, `/settings`, a page not found), on the diagram with demo S,
  M and L drawn (at rest, with the keyboard inside a zone, with a node's menu and the drawer open), and on the
  live-mode Connect page.

## Storage schema (IndexedDB, database `gcportrait`)

`src/storage/db.ts` wraps IndexedDB with `idb`. The schema is versioned: `MIGRATIONS[i]` upgrades version `i`
to `i + 1` inside the version-change transaction, and `DB_VERSION` is the number of migrations. Never edit a
shipped migration; append one.

| Store | Key | Value | Indexes | Used |
|---|---|---|---|---|
| `preferences` | out-of-line string key | any; validated on read by `storage/preferences.ts` | none | yes (`theme`, `diagramOverlays`, `drawerWidth`, `recentScopes`, `quotaProjects`) |
| `snapshots` | `id` (the snapshot ref: its ULID, or `demo:<size>`) | `{ id, meta: SnapshotMeta, blob, history? }` (section "Snapshots"; `meta.readTimeSource`, absent for a demo or when the snapshot names none) | `byReadTime` (meta.readTime), `bySavedAt` | yes (`src/snapshots/`) |
| `savedViews` | `id` | `{ id, name, viewSpecHash, createdAt, updatedAt }` | `byUpdatedAt` | yes (`views/savedViewStore.ts`) |
| `tickCache` | `key` (the tick's cache key, `(scope, readTime, contentType, assetTypes)`, from version 2; version 1's `[scope, readTime]` store holds no data and is replaced) | `{ key, scope, readTime, day, contentType, assetTypes?, now, actualReadTime, fetchedAt, assetCount, bytes, blob }` | `byScope` | yes (`storage/tickCache.ts`: the timeline's live days; listed and deleted by scope on the Snapshots page) |

`openDatabase()` never rejects: it resolves to `null` when IndexedDB is missing, throws (some private windows,
or a `window.indexedDB` getter that throws) or does not answer within 3 s, and the stores then keep values in
memory for the session. **One connection** (`storage/connection.ts`): `main.tsx` creates it and `App.tsx`
provides it (`DatabaseContext`); the preferences, the saved views and the snapshot library read the database
through its `database()` getter for every operation. A connection that blocks a newer schema in another tab
closes itself (or the browser terminates it), and the next read opens it again for all three at once, so none
is left on a closed connection (with an older schema than another tab's, the reopening fails and they fall
back to memory). The React-free factory is `storage/databaseConnection.ts`; `storage/connection.ts`
re-exports it alongside the page's React context. The data worker's snapshot and tick readers share one
connection through `storage/workerDatabase.ts`, separate from the page's. Each read keeps its opening Promise
as a recovery token, so a late failure cannot replace a newer opening. The readers retain their own
retry-once boundaries; resetting either reader's test connection resets their shared owner and timeout.

**Changes between tabs** (`storage/tickCacheChanges.ts`). Every change of the `tickCache` store, a day
stored (once its write stands; a write taken back tells nothing) or deleted (on the Snapshots page, or as
past the window when a newer day is stored), is posted on the `BroadcastChannel` named after the database,
`gcportrait.tickCache`, as `{ change: 'put' | 'delete', key, scope, readTime, contentType }`: the entry's
cache key and nothing else, never its assets, counts or sizes. The page has one signal (`tickCacheChanges()`):
the tick cache posts through it and the timeline controller listens through it, so a tab never hears its
own changes; its channel is open only while something listens, and a change posted meanwhile goes out on a
channel opened for that message alone. A message is checked field by field (no zod on the UI thread); a
browser without `BroadcastChannel` posts and hears nothing, and nothing else changes.

## Demo builds

`VITE_DEMO=1` (what `pnpm dev:demo` sets) and `VITE_STATIC_DEMO=1` (the static demo, section below) build
the app as a demo-only instance with no backend to ask: `src/api/demoConfig.ts` builds the answer such an
instance's `GET /api/config` would give (no OAuth client, no service-account mode, `demoOnly: true`) from
`VITE_APP_VERSION`, `VITE_SOURCE_URL`, `VITE_LEGAL_IMPRESSUM_URL` and `VITE_LEGAL_PRIVACY_URL`, and
`auth/AuthProvider.tsx` puts it into the store at once. From there the app is a demo-only instance
(`useDemoOnly()`): a "Demo mode" badge in the top bar, the Connect page with the demo, the way to one's own
project and the privacy note, the Permissions page's note, and the footer's source link from `VITE_SOURCE_URL`
(section "Source link"). No `/api` proxy and no backend call at all. The two variables exclude each other: a
build is one or the other.

Demo builds have no sign-in: the account menu is absent and Google's sign-in script is never loaded (the
static bundle leaves the code out entirely, section "Static demo"). In every mode the Snapshot menu and the
empty diagram canvas offer the demo organisations S, M and L (`#snapshot=demo:M`); they are generated in the
browser, in the data worker, and never fetched (the worker fetches only the build's data tables, below).

## Static demo

`VITE_STATIC_DEMO=1` builds the static demo (AGENTS.md, Modes and hosting): the maintainer's demo at
<https://gcportrait.app/demo/>, served by the website's GitHub Pages site. Build it with `pnpm demo:static` at
the root (`scripts/static-demo.mjs`), which sets the variables, runs this package's build and checks the
bundle; [docs/website.md, "The demo"](../docs/website.md#the-demo) is the guide.

- **Demo-only, without a backend.** The app does not ask `GET /api/config`: `src/api/demoConfig.ts` builds
  the answer a demo-only instance gives (no OAuth client, no service-account mode, `demoOnly: true`) from
  `VITE_APP_VERSION`, `VITE_SOURCE_URL`, `VITE_LEGAL_IMPRESSUM_URL` and `VITE_LEGAL_PRIVACY_URL`, and
  `auth/AuthProvider.tsx` puts it into the store at once. From there the app is a demo-only instance
  (`useDemoOnly()`), as `pnpm dev:demo` is: the Connect page with the demo, the way to one's own project and
  the privacy note, the demo badge, the Permissions note. The footer's source link and the legal links come
  from that configuration. `AuthProvider.tsx` compares `import.meta.env.VITE_STATIC_DEMO` with `'1'`
  where it is used, so the build sees a constant and leaves the sign-in code out: the static bundle has no
  Google sign-in script, no tokeninfo and no `/api/config` (`pnpm website:check` looks for their hosts).
- **Base path.** `base: '/demo/'` (another with `--base`); `main.tsx` gives the router
  `routerBasename(BASE_URL)`, and the "Copy link" button puts the base into the link (`appPath`). Assets,
  workers, the data tables and the licence links follow the base by themselves.
- **Pages.** The build (`staticDemoPages` in `vite.config.ts`, with `scripts/lib/static-demo.mjs`) writes the
  Content Security Policy into index.html as the first `<meta>` after the charset (the backend's demo-only
  policy without `frame-ancestors`, the theme bootstrap's hash computed from the written page) and
  `<meta name="referrer" content="no-referrer">`, then a copy of index.html per route (`diagram.html`,
  `snapshots.html`, `permissions.html`, `settings.html`, `impressum.html`, `privacy.html`), which a static
  host serves at the route's address.
- **Legal pages.** The footer links the configured pages elsewhere in a new tab, marked as external and named
  "Impressum (opens HOST in a new tab)" (`legal/ExternalLegalLink.tsx`; section "Legal links and the favicon"
  below); `/impressum` and `/privacy` link to them; the Connect page's privacy note does too. A live instance
  whose backend reports `LEGAL_IMPRESSUM_URL` or `LEGAL_PRIVACY_URL` links them the same way.

Tests: `src/api/demoConfig.test.ts`, `src/routes.test.ts`, `src/pages/ConnectPage.staticDemo.test.tsx`,
`src/pages/ConnectPage.demoOnly.test.tsx` and `scripts/static-demo.test.ts` at the root;
`pnpm --filter @gcportrait/website demo` drives the built demo in a browser.

## Branding and the non-affiliation notice (`src/branding.ts`)

The non-affiliation statement goes in the footer and in long-form texts only (AGENTS.md, Non-affiliation,
brand and legal), every string defined once in `src/branding.ts`:

| Constant | Text | Where |
|---|---|---|
| `TAGLINE` | gcportrait.app - Visualize your Google Cloud Infrastructure | the title block's third and last line (muted, 10.5 px), on the canvas and in every export |
| `FOOTER_NOTICE` | Not affiliated with Google / Google Cloud. gcportrait is an independent open-source project by Florian Chrometz | the shell footer on every route, next to "Source (Apache-2.0)"; the name (`MAINTAINER_NAME`) is a link to `MAINTAINER_URL`, <https://florian-chrometz.de>, in a new tab (`rel="noopener"`), named `MAINTAINER_LINK_LABEL`, "Florian Chrometz (personal website)" |
| `NON_AFFILIATION_LONG` | the long form: "gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Google. …" | the Connect page's About block (and the README, website, docs, release notes, image label and the infra scripts' `--help`, which carry it as text) |

The footer notice's first sentence appears nowhere else: not in a drawing (no title block, no `<desc>`, on the
canvas or in an export), not in a snapshot bundle, not on the Permissions page, and not in the backend's
`hostedBy` line, which the Connect page shows as "Hosted by NAME." alone and not at all without one
(`auth/labels.ts` cuts a statement at its end off).

The title block stops at the tagline on the canvas and in a static drawing alike (`DiagramSvg`: the export,
the baselines, `pnpm render`); no drawing carries the affiliation line, and `documentText`'s `<desc>` ends
with "Drawn with gcportrait.". Both footer links take the footer's text colour, underlined, and the chrome
focus ring (style skill §9); `App.test.tsx` and `e2e/tests/shell.spec.ts` check the footer on every route and
in both themes. The copies of the long form outside the app (the website, the release notes, the third-party
notices, the image label, `infra/common.sh`, the icons README) are compared with this file by their tests
(`scripts/non-affiliation-copies.test.ts`, `website/src/site.test.ts`, `packages/icons/scripts/data.test.ts`).

## Source link

gcportrait's shell footer links the source on every route, next to the non-affiliation notice
(frontend/AGENTS.md, "The source link"): a "Source (Apache-2.0)" link (`shell/SourceLink.tsx`, the text and
default in `source.ts`) that says where the source of the version in use is published and under which licence.
By default it points at the project's repository (AGENTS.md, Product rules). Exports stay as they are.

| Mode | Link target |
|---|---|
| live (`pnpm dev`, the production image) | `sourceUrl` from `GET /api/config`, the backend's `SOURCE_URL` (`backend/.env.example`), read from the store's `connect.backend` (`auth/AuthProvider.tsx` asks once per page); until the answer arrives, or when the backend does not answer or names no http(s) URL, the build-time URL below |
| demo build (`pnpm dev:demo`, no backend) | the built-in configuration's `sourceUrl`, the build-time `VITE_SOURCE_URL` |
| the static demo (`pnpm demo:static`) | the built-in configuration's `sourceUrl`, which is the build-time `VITE_SOURCE_URL` |

`VITE_SOURCE_URL` is read when Vite serves or builds the app (`VITE_SOURCE_URL=https://… pnpm dev:demo`);
unset, blank or not an http(s) URL, it falls back to `DEFAULT_SOURCE_URL`,
`https://github.com/florianchrometz/gcportrait`, the same default as the backend's `SOURCE_URL` (a test in
`backend/src/config.test.ts` fails while the two, or the e2e expectation, disagree). A fork changes both
defaults ([docs/contributing.md](../docs/contributing.md), "Releases"); whoever runs a modified version
and publishes its source can point `SOURCE_URL` (and, for a demo build, `VITE_SOURCE_URL`) there. The link
takes the footer's text colour with an underline: the primary blue on the light footer reaches only 4.3 : 1,
short of what 11 px text needs.

## Legal links and the favicon

The footer's "Impressum · Privacy" (`legal/LegalLinks.tsx`) sits after "Source (Apache-2.0)" on every route
and links what the instance publishes, as `legal` in `GET /api/config` (or a demo build's built-in
configuration, `api/demoConfig.ts`) says, page by page:

| The page is | The footer's link |
|---|---|
| a text the instance serves (`legal.impressum` / `legal.privacy` true: the backend's `LEGAL_DIR` or `LEGAL_BUNDLE`) | an app link to `/impressum` or `/privacy`, which render the text |
| published elsewhere (`legal.impressumUrl` / `legal.privacyUrl`: `LEGAL_IMPRESSUM_URL`, `LEGAL_PRIVACY_URL`, or the static demo's `VITE_LEGAL_IMPRESSUM_URL`, `VITE_LEGAL_PRIVACY_URL`; an `https://` URL without credentials, anything else links nothing) | the same words, linking that page in a new tab (`target="_blank"`, `rel="noopener"`; `legal/ExternalLegalLink.tsx`): the sign-in lives in the tab's memory only, so following the link in the same tab would end a signed-in session (the website, which has no session, keeps its own legal links in the same tab). An arrow after the text (hidden from assistive technology) and the accessible name "Impressum (opens HOST in a new tab)", the visible text first (WCAG 2.5.3); `/impressum`, `/privacy` and the demo-only Connect page's privacy note link the same way |
| neither, or a demo build (no backend) | nothing; with no page at all the footer has no "Legal" navigation |

The links take the footer's text colour, underlined, with the chrome focus ring, like the footer's other
links. Tests: `legal/LegalPage.test.tsx`, `pages/ConnectPage.staticDemo.test.tsx` and
`e2e/tests/shell.spec.ts`.

**Favicon.** The app's favicon is gcportrait's mark from its one source, `brand/icon.svg` at the repository
root ([brand/README.md](../brand/README.md)), as it is: `brandFavicon` in `vite.config.ts` writes it into
every build as `favicon.svg`, serves it there in development, and adds `<link rel="icon"
href="BASEfavicon.svg" type="image/svg+xml">` to `index.html` under the build's base path (`/favicon.svg` for
an instance, whose backend serves it under `img-src 'self'`; `/demo/favicon.svg` in the static demo). There is
no copy in the tree (no `public/` folder). One file serves both themes: its `<style>` carries the dark colours
under `prefers-color-scheme: dark`. The top bar shows the same file beside the wordmark, as an `<img>` with an
empty `alt` from `BASE_URL` (`import.meta.env.BASE_URL` + `favicon.svg`), 24 pixels square and centred on the
wordmark, with the website header's gap (0.6rem) before the name. An image's `prefers-color-scheme` follows
the `color-scheme` the theme sets on `<html>`, so the mark takes the app's theme even when it differs from the
system's. There is no PNG fallback: it would be a second, derived file to keep in step with the source, and a
PNG cannot follow the theme; a browser without SVG favicons shows its default icon. Tests: `TopBar.test.tsx`,
`TopBar.css.test.ts` and `e2e/tests/shell.spec.ts` (the served file is `brand/icon.svg` byte for byte);
`scripts/static-demo.mjs` and `pnpm website:check` check the static demo's.

## Sign-in (`src/auth/`)

User mode's Google sign-in (AGENTS.md, Security and privacy, principle 2 and Tokens): Google Identity
Services' **token client**, in the browser only. The access token is held in memory, inside the token
session's closure, and nowhere else: never in the app store, IndexedDB, localStorage, sessionStorage, a
cookie, the URL or a log. Reloading the page or closing the tab ends the session.

```
src/auth/
  types.ts            SessionState (status, account, expiresAt, renewal, problem, notice), BackendState,
                      AccessMode
  gis.ts              the typed part of `google.accounts.oauth2` gcportrait uses; `loadGis` (the script, once,
                      on demand, from https://accounts.google.com/gsi/client)
  tokeninfo.ts        `fetchTokenInfo`: Google's tokeninfo, the token in a form body (never a URL): the email
                      and the audience
  session.ts          `createTokenSession`: the token lifecycle (below), the scopes, the timing constants
  AuthProvider.tsx    asks GET /api/config once, fills the store's `connect` slice, creates the session
                      when the backend names an OAuth client, hands the controls to `AuthContext`
  context.ts          `useAuth()`: signIn, renew, signOut, accessToken, rejected (`NO_AUTH` without one)
  fetch.ts            `fetchWithToken(auth, '/api/…', init)`: the token in `X-Gcportrait-Token` (never
                      `Authorization`, which IAP takes for its own), only to this backend's `/api/` paths; a 401
                      expires the session
  SignInCard.tsx      the Connect page's "Sign in with Google" card (and its signed-in and expired states)
  ModeSelector.tsx    "Read with": your account, or this instance's service account (the gate explained)
  labels.ts           words and formats (the consent note, the hostedBy line, clock times, the avatar letter)
  testing.ts          a fake GIS for the unit tests
```

**When Google's script loads.** Only when a person presses "Sign in with Google" on an instance whose
`/api/config` names an OAuth client (`oauthClientId`); never in a demo build, never on page load, once per
page.
Without a client id, or without a backend, the button stays in place, inert, and says why. Because the first
press loads the script before Google's window can open, a browser that allows a window only right after the
click (Safari) or a slow network can block that first window; the card then says the browser blocked it, and
the next press opens it at once, the script being loaded by then. The backend's CSP allows exactly this script
and GIS's `/gsi/` endpoints, and its COOP is `same-origin-allow-popups` so that Google's sign-in window can
hand the token back ([backend/README.md](../backend/README.md), "Security and logging").

**Scopes** (`OAUTH_SCOPES` in `session.ts`): `cloud-platform.read-only` (Resource Manager accepts it, Cloud
Asset Inventory does not), `cloudasset` (the reverse) and `userinfo.email` (so that tokeninfo names the
account in the account menu); never all of `cloud-platform` (AGENTS.md, Security and privacy, OAuth scopes).
Before sign-in the card says that Google describes `cloudasset` as "See, edit, configure, and delete your
Google Cloud Asset data" and that gcportrait only lists assets with it, and shows the backend's `hostedBy`
line (who runs the instance). With granular consent a person may leave a scope out: a grant without both Cloud
scopes is revoked at once and the card asks to sign in again and allow both; one without the email only shows
"Google account".

**The token lifecycle** (`createTokenSession`; every dependency passed in, so `session.test.ts` runs it with a
fake GIS and fake timers):

| Stage | What happens | State (`connect.session`) |
|---|---|---|
| sign in (a click) | load GIS, `requestAccessToken({ prompt: 'select_account' })`; check the scopes; tokeninfo: the email, and the token's audience must be this instance's client (a token Google refuses is not used; one issued to another client is not used and is revoked; tokeninfo unreachable or slower than 10 s: go on without the email, and show none, not the address of an account signed in before, since the person may have picked another one; a renewal, which asked for that account, keeps its address). While Google's window is open the button still works: a press asks again, and GIS brings its window back (or opens a new one when the first was lost); presses before the script has loaded ask once | `signing-in` → `signed-in` (`account`, `expiresAt`) |
| silent renewal | 5 minutes before the end (half the lifetime for a short token): `requestAccessToken({ prompt: 'none', login_hint })`. GIS answers every request through a window of its own, which browsers block when no click started it (unless pop-ups are allowed for the site), so in practice the account menu usually asks for one click about once an hour. Success: the new token replaces the old. Blocked, refused, or no answer within 2 minutes: renewal `needed`, and the account menu offers "Stay signed in" (`renew()`, from a click: `prompt: ''`) | `renewal`: `renewing`, `needed`, back to `idle` |
| expiry | 1 minute before the end (a request in flight must not outlive its token), the token is dropped. `accessToken()` also checks the clock itself, because a background tab runs its timers late. A 401 from the backend (`fetchWithToken` calls `rejected(token)`) expires at once. The card and the account menu say so and offer "Sign in again" | `expired` (the account kept for the words) |
| sign out | the token is forgotten at once and revoked with `google.accounts.oauth2.revoke` (a POST to `oauth2.googleapis.com/revoke`); if Google does not confirm, a notice says the access ends by itself within the hour. An expired session has no token left to revoke | `signed-out` |

**Revoking ends the whole grant.** Google's revocation does not end one token only: it withdraws the account's
grant to this OAuth client. Other tabs of the instance signed in with the same account get a 401 on their next
request and show "Session expired", and the next sign-in shows Google's consent screen again.

**Tokens that are not used.** A token that arrives after a sign-out, or whose account lookup a sign-out cut
short, is revoked, and so is one tokeninfo says was issued to another client. A renewal answer that arrives
after the renewal was given up (signed in still, or expired) is only dropped: revoking it would end the grant,
the current token included, and it ends by itself within the hour. GIS's own errors become words on the
card: the window blocked (allow pop-ups), the window closed before the end, or Google showing an error in it
(its error page breaks the window's link to the page, so GIS reports it closed; the usual cause is an address
missing from the client's authorised JavaScript origins), access not allowed, the script not loading.

**After sign-in.** Focus moves to the Connect page's new "Read your environment" section: the mode selector
(`connect.mode`; only "your account" unless `/api/config` says `saMode`, with the service-account gate
explained in the words of [docs/permissions.md](../docs/permissions.md) and a link to the Permissions page),
then the scope (`scope/ScopeStep.tsx`, the same as on the Permissions page) and "Pull now"
(`import/PullNow.tsx`); they read the mode and the session from the store. After an expiry the section stays,
its mode selector and scope inert. The permission check (`connect.preflight`, which "Pull now" relies on)
answered for one account, so `AuthProvider` clears it on a sign-out and when another account than the one last
signed in signs in, after an expiry or a sign-out (`anotherAccount` in `types.ts`; an account whose email
Google did not say counts as another). That holds whichever page is open; `preflight/usePreflight.ts` also
cancels a check still under way when the Permissions page sees the sign-out. The scope and the quota project
picked stay.

**For code that calls the backend with the token**: read the session and the mode from
the store (`useAppState((s) => s.connect)`), and make each request with `fetchWithToken(useAuth(), '/api/…',
init)` inside the event handler or effect that needs it; never keep the token in a variable that outlives the
request, in the store or in a component's state.

Tests: `session.test.ts`, `gis.test.ts`, `tokeninfo.test.ts`, `fetch.test.ts`, `AuthProvider.test.tsx`,
`SignIn.test.tsx` and `e2e/tests/signin.spec.ts`, which also checks that the token is never in storage,
IndexedDB, cookies, the DOM, any URL or the console.

## Scope picker and permission check (`src/scope/`, `src/preflight/`)

The Permissions page (`pages/PermissionsPage.tsx`) checks a scope with the signed-in person's token
and says what is missing, with copy-ready `gcloud` commands; below it, what each mode needs (the table of
[docs/permissions.md](../docs/permissions.md), its commands' variables as fields prefilled from what the page
knows; section "Fillable commands") and service-account mode in that guide's words, with the instance's
account and the gate. Signed out it shows the sign-in card; in a demo build it says that nothing can be
checked here and keeps the guidance.

```
src/scope/
  scopeName.ts        `organizations/ID`, `folders/ID`, `projects/ID`: parse, hints for a mistyped name; the two
                      patterns repeat @gcportrait/model's (scope.test.ts checks them against its schemas; no zod
                      on the UI thread)
  api.ts              POST /api/scopes/search through fetchWithToken; the contract is the model's
                      `ScopeSearchResponseSchema`, which api.test.ts holds the zod-free guard to
  useScopeSearch.ts   250 ms after typing stops, the older request cancelled, answers kept per text
  ScopePicker.tsx     ui/Combobox over the typed name ("Use …"), the recent scopes, the search results by kind
  recent.ts           the `recentScopes` and `quotaProjects` preferences, checked on read
  useScopeTarget.ts   `connect.scope` and `connect.quotaProject`, remembering both in the preferences
  ScopeStep.tsx       the scope picker and, in user mode, the quota project picker (projects only; a bare id
                      works)
src/preflight/
  api.ts              POST /api/preflight through fetchWithToken; the contract is the model's
                      `PreflightResponseSchema` and its zod-free lists (findings, items, outcomes), which
                      api.test.ts holds the guard to
  state.ts            `connect.preflight`: idle, checking, done (with the request it answers), failed
  usePreflight.ts     runs the check for the store's scope, mode and quota project; one at a time; forgotten
                      at sign-out
  copy.ts             every sentence: item titles, findings, quota projects, outcomes
  PreflightPanel.tsx  "Check permissions", the checklist (status in words and by a mark's shape), Google's
                      answer when the check could not tell, the quota projects tried, the commands
  CommandBlock.tsx    a command, its variables as fields, with a Copy button named after what it does and where
  PermissionsGuide.tsx  the permission table (its commands in the scope's command group, with variables; the
                      Variables panel) and the service-account explainer
  testing.ts          a backend answer for the tests
```

**Picking a scope.** Search text goes to `/api/scopes/search` (the backend turns it into Resource Manager
queries); a typed `organizations/ID`, `folders/ID` or `projects/ID` is offered first as "Use …", and text that
starts like a scope name but is not one gets a hint. With the field empty, the list shows the recent scopes
and the first scopes the person can see. A choice goes to `connect.scope` and to the recent scopes, and brings
back the quota project last picked for that scope; the quota project goes to `connect.quotaProject` and is
remembered per scope. Only ids and display names are stored, never a token or an email.

**The check.** `usePreflight` sends `{ scope, mode, quotaProject? }` (the quota project in user mode only) and
keeps the answer in `connect.preflight` with the request it answers, so the Connect page and the Permissions
page show the same one; a result for another scope, mode or quota project is marked out of date. The backend's
codes become sentences in `copy.ts` only. `ScopeStep` and `PreflightPanel` are what the Connect page's "Read
your environment" section can show for its scope step.

**Service-account mode.** The "Service-account mode" section names the account from `/api/config`
(`backendServiceAccount`, the identity the backend resolved) and words the gate as the instance runs it:
`saStrictExposure` (the model's `PublicConfigSchema`, always sent) decides whether `copy.ts` and
`PermissionsGuide.tsx` say that a scope the account can see on its own is refused, or that a scope whose
details are public is open to everyone signed in; the mode selector's note follows the same field. A check the
gate refuses comes back as a 403 (or 503) whose body carries the checklist as `preflight`; `preflight/api.ts`
shows that checklist like any other answer (its outcome is never `ready`), and a 403 without one stays an
error.

Tests: `scope/scope.test.ts`, `scope/api.test.ts`, `preflight/api.test.ts`, `preflight/preflight.test.ts`,
`pages/PermissionsPage.test.tsx` and `e2e/tests/preflight.spec.ts`.

## Fillable commands (`src/commands/`)

Every command the app shows (the Permissions page's checklist and reference table, the Connect page's "How to
make an export with gcloud") names the values to fill in as tokens of the one registry the website's docs
share, `COMMAND_VARIABLES` in `@gcportrait/model` (`YOUR_ORG_ID`, `YOUR_FOLDER_ID`, `YOUR_PROJECT_ID`,
`YOUR_EMAIL`, `YOUR_SA_EMAIL`, `YOUR_QUOTA_PROJECT`, `YOUR_BUCKET`, `YOUR_OPERATION_NAME`; label, description,
synthetic example, format, secret). `preflight/CommandBlock.tsx` renders each registered token as a labelled
text box inside the code, as wide as its text, the token as its placeholder (dashed while empty, solid once
filled), and a Copy button that copies the command with the values, an unfilled one as its token. The button
is described by a note under the command ("1 value to fill"), and a polite live region says "Copied." or
"Copied, with 1 value still to fill: YOUR_BUCKET.". A value not of the variable's format is marked when its
field is left (`aria-invalid`, "Check Folder number: digits only." in the note), never refused. The
Permissions page's reference table has the Variables panel (`commands/VariablesPanel.tsx`): each of its
variables with its label, token, description and example, to fill once, and "Clear values".

| Where | What it does |
|---|---|
| `values.ts` | the rules without React: the value a variable shows, the copied text (`resolveCommand`), the notes, the facts (`commandFacts`), what sessionStorage keeps |
| `store.ts` | what was typed, one entry per variable, for the tab: `useSyncExternalStore`, sessionStorage key `gcportrait.commandVariables` |
| `useCommandVariables.ts` | the values on screen: what was typed over the facts the app store knows |
| `VariableField.tsx`, `VariablesPanel.tsx`, `Commands.module.css` | the inline field, the panel, their styles (chrome tokens; the field's border 5.74 : 1 light, 4.93 : 1 dark on the code's surface) |

**One value per variable.** Every field of a variable, in every command and in the panel, shows one value, so
filling it once fills every command; the store is the app's, so another page of the app in the same tab shows
it too. A value is what the person typed over what the app knows (`connect` in the store): the scope picked,
under its kind's variable (and `YOUR_SCOPE_ID`, `YOUR_SCOPE_KIND`), the quota project (or a project scope
itself), the signed-in account's email and the instance's service account from `/api/config` (in
service-account mode only); an email that could carry shell syntax is never a fact. An entry keeps the fact it
was typed over, so a typed value lasts while the app knows the same thing, and a new fact (another scope
picked, another account) shows again. Signed out, in demo mode and on a demo-only instance nothing is known
and the fields start empty.

**For the session, never a secret.** The entries are kept in sessionStorage, so a reload shows them again and
nothing outlives the tab; another tab starts empty. A variable marked secret in the registry is never kept
(none of the app's commands has one), entries of unknown variables or of the wrong shape are dropped on
reading, and where storage is blocked the values stay in memory. The access token is never a value
(`e2e/tests/permissions-variables.spec.ts` searches every storage for it).

Tests: `commands/values.test.ts` (which also fails when a command the app shows names an unregistered
variable or another placeholder), `commands/commands.test.tsx` and `e2e/tests/permissions-variables.spec.ts`.

## Live pull and export load (`src/import/`)

The two ways from Google Cloud into a snapshot in this browser, both on the Connect page (skill cai-ingestion
§1): "Pull now" reads the scope checked on the Permissions page or in "Read your environment" from Cloud Asset
Inventory, and the export card loads a Cloud Asset Inventory export. Both end with the diagram opened on the
new snapshot (`actions.setSnapshot`), at once, or after the notes the import left (lines left out, an
estimated read time) with "Open the diagram".

```
src/import/
  PullNow.tsx           "Pull now": inert with the reason until target.ts has a target; progress, Cancel, errors
  LoadExport.tsx        the export card: dropped files (the Snapshots page's import, `library.importFiles`,
                        with Cancel while they are read), a gs:// URI read by the backend with an optional
                        operation.json, the gcloud commands (commands.ts)
  ImportStatus.tsx      stage (live region), counters, progress bar, Cancel; the failure alert; the notes
  useImportJob.ts       one import at a time: the progress reducer, a one-second tick, Cancel, then the diagram
  run.ts                a pull or an export read from request to stored snapshot (`runLivePull`, `runExportRead`)
  target.ts             what "Pull now" pulls: scope, mode and quota project once the permission check is ready
  progress.ts           the progress reducer (pages, assets, bytes, elapsed; monotonic; frozen once ended)
  errors.ts             failures in words: Google's message verbatim, a title and advice from status, code, reason
  sidecar.ts            an export's operation.json: its read time and scope; a typed read time
  ReadTimeField.tsx     "When the export was taken (UTC, optional)": the read time typed for an export without its
                        operation.json (also on the Snapshots page's import)
  commands.ts           `gcloud asset export …`, `gcloud asset operations describe … > operation.json`
  ImportWorkerProvider.tsx  the import worker, started on first use (tests: the in-process one)
  worker/               the import role of the app's worker script: protocol, handler, role, client, browser,
                        inProcess
  testing.tsx           the components' test harness
```

**What "Pull now" pulls** (`target.ts`): the store's `connect` slice must have a signed-in session, a scope,
and a permission check (`connect.preflight`) that answered `ready` for exactly that scope, mode and quota
project. In user mode the pull uses the quota project the check found usable (required; never the instance's
project: AGENTS.md, Security and privacy); in service-account mode none. Until then the button is inert
(`aria-disabled`, focusable) and its hint says what is missing ("Choose a scope first.", "Check the
permissions again for this choice.", …), with a "Check permissions" link to the Permissions page while the
check is what is missing.

**The stream** (`run.ts`): `fetchWithToken` (src/auth) posts the body to `/api/assets/stream` or
`/api/export/read`; a refusal before the stream (the backend's JSON error) fails at once with its message. The
response body is read on the page and handed chunk by chunk to the import worker (`worker/client.ts`; a chunk
that owns its buffer is moved, not copied), which reads it with `@gcportrait/ingest` as it arrives
(`worker/handler.ts`): frames for a pull, an export's own lines for a read. The page counts the bytes; the
worker reports pages and assets; at the end it gives the snapshot its scope (the target's; for an export, the
sidecar's or the root the assets share, `snapshots/worker/scope.ts`, keeping the name the assets give the same
scope), refuses a pull that ended without its `done` frame (cut short) and an export without assets, and
prepares the record (`snapshots/worker/prepare.ts`). The library stores it (`storePrepared`, a new record
under the snapshot's new ULID; refused without IndexedDB). A count that passes `LARGE_SNAPSHOT_ASSETS` while
it streams asks the large-snapshot guard once, at that moment (`confirmLarge`, from `useImportJob`): the
stream goes on while the person decides, nothing is stored before they have answered, "Draw it anyway" lets
the diagram open without asking again and Cancel stops the read. Only the stream can tell: the permission
check reads one asset. A pull's snapshot has source `api` ("live pull", or "live pull, service account") and
the read time Google reported (`readTimeSource: api`); an export read's has source `export` with its URI, and
the sidecar's read time or an estimate. Cancel (and leaving the page) aborts the request and the read, and
tells the worker to drop the job: nothing is stored. While the snapshot is stored, the store takes the run's
signal too (`storePrepared`'s `signal` option): aborted before the write, it writes nothing; aborted while the
write is in flight, the library deletes the record after it. Either way the run ends as cancelled, "Cancelled.
Nothing was stored.", as a cancel while reading does.

**An export's read time** (from an optional sidecar, `operation.json`, or set by the person, defaulting to the
latest `updateTime`): an export that came without its operation.json may be given its read time in "When the
export was taken (UTC, optional)" (`ReadTimeField.tsx`, on the export card and on the Snapshots page's
import): `2026-10-05 14:30`, with or without seconds, `T`, `Z`, `UTC` or an offset, read as UTC
(`parseTypedReadTime`); a text that is no such time, or a time later than this computer's clock, is said under
the field (`aria-invalid`, `aria-describedby`) and the import refuses it. The snapshot then has
`readTimeSource: user` and no estimate. The operation.json's read time wins over a typed one, and a note says
so when they differ (`exportReadTime`); without either the read time is the latest asset change, marked as
estimated. A read time later than the import's clock (a sidecar from a machine whose clock ran ahead) is noted
(`futureReadTimeNote`): the timeline shows that snapshot at the present (section "Timeline", extra ticks).
Either way the snapshot is an extra tick on its scope's timeline at that time.

**Errors** (`errors.ts`): an `error` frame ends the ingest with Google's message, status and code; its
`ErrorInfo` reason is read back from the end of the stream, where the frame is (the worker keeps the last
64 KiB it was given). The title and the advice come from the status, the code and the reason, never from the
message, which is shown verbatim: a scope that cannot be listed, a quota project that cannot be used or whose
API is disabled, a token Google no longer accepts (the session then expires: `auth.rejected`), a read time
before the scope existed, a bucket that cannot be read, Google busy or slow (with "Try again"). Permission
problems link the permission check ("Check permissions", the Permissions page), whose checklist names the
missing grant and its command.

**The progress** (`progress.ts`, `ImportStatus.tsx`): "12 pages · 5,400 assets · 3.2 MB · 0:04" (for an
export: "… · 1.5 MB of 4.0 MB · …", from the backend's `x-gcportrait-export-bytes`), under a progress bar (a
share of the bytes for an export, indeterminate for a pull) and next to Cancel. Only the stage is a live
region, so a screen reader hears "Reading Cloud Asset Inventory…", not every counter.

**The worker** is the fourth role of the diagram's worker script (`WORKER_ROLES.imports`), so the build shares
ingest, the model and zod with the other roles; its code loads on first use.

Tests: `progress.test.ts`, `target.test.ts`, `sidecar.test.ts`, `commands.test.ts`, `errors.test.ts`,
`run.test.ts`, `store.test.ts`, `sidecarImport.test.ts`, `PullNow.test.tsx`, `LoadExport.test.tsx` and
`e2e/tests/live-pull.spec.ts`.

## Snapshots (`src/snapshots/`)

Snapshots live in this browser only (AGENTS.md, Security and privacy, principle 1): the Connect page's "Try
the demo" makes them, the Snapshots page lists, loads, exports, imports and deletes them, and the diagram's
data worker reads them. One object, the **snapshot library** (`library.ts`), does everything; `main.tsx`
creates it over the app's IndexedDB connection and the snapshot worker, and `SnapshotLibraryProvider` (in
`App.tsx`, inside the app store) hands it to the pages with its listing, re-read after every change.

```
src/snapshots/
  library.ts            the library: tryDemo, importFiles, storePrepared, exportFile, remove, clear,
                        estimate, list, subscribe
  repository.ts         the `snapshots` store through storage/db.ts; a demo organisation in memory (until a reload)
                        without IndexedDB or when a write fails (the quota); an import never in memory
  codec.ts              a record's documents: JSON in a Blob, gzip-compressed (CompressionStream) where possible
  bundle.ts             the `.gcportrait.json` file: name, recognition, writing (page side, no schemas)
  load.ts               the data worker's snapshot loader (diagram/pipeline/dataRole.ts): demo organisations
                        generated on the spot, every other ref read from IndexedDB; `storedSnapshotVersion`, which
                        the data worker asks before it reuses a kept Graph; a stored history (the timeline)
  labels.ts             names and formats (scope, source, UTC times, decimal sizes, the demo sizes), and the
                        rows' names, no two alike, with the copy numbers the rows show (`distinctNames`)
  SnapshotLibraryProvider.tsx  context, listing, and the Snapshot menu's `snapshot.available` in the store
  largeSnapshot.ts      the large-snapshot guard's rules: the threshold, a snapshot's size before it is drawn,
                        the question's words, "Do not ask again in this session" in sessionStorage
  LargeSnapshotGuard.tsx  the guard in React: its provider and alert dialog, `useLargeSnapshotGuard`, and the
                        diagram page's `useLargeSnapshotGate`
  DemoEntry.tsx         the Connect page's demo card: size S–XL (ui/SegmentedControl), Try the demo, progress
  SnapshotTable.tsx, ImportPanel.tsx, StorageUsage.tsx, JobStatus.tsx   the Snapshots page's parts
                        (JobStatus with Cancel for an import, also on the Connect page's export card)
  useImportSignal.ts    a file import's abort signal: one per import, aborted by its Cancel and by leaving
                        the page
  RowTable.tsx          the rows of the page's two tables from one list of columns (a card per row on a phone)
  ScopeTimelines.tsx    "Timelines by scope": what is kept of each scope's timeline, with deleting
  scopeEntries.ts       its pure part: the stored snapshots and the cached days grouped by scope, in time order
  worker/               the snapshot worker: protocol, handler (import, check, cancel), prepare.ts (a record ready to
                        store, shared with the data worker's demo job), scope.ts (an export's scope from the
                        assets' ancestors), parse.ts (bundles and histories, checked), role.ts (its role in the
                        app's worker script), client.ts, browser.ts, inProcess.ts (tests)
  testing.ts            a fake library for the page tests
```

**Try the demo.** The person picks a size (S, M, L or XL; S by default) and presses "Try the demo". A worker
started for the job (`diagram/pipeline/demoRole.ts`, so the diagram's data worker's Scene requests never wait
behind an XL job), with the demo generator (on neither the UI thread nor the snapshot worker: AGENTS.md,
Architecture and code), generates the organisation's 35-day history with `@gcportrait/demo-data` (the base and
the daily mutations, never 35 copies), reads its last day through `@gcportrait/ingest` exactly as it reads
`demo:<size>` for a diagram (`diagram/pipeline/demo.ts`, loaded on first use; `demo.test.ts` checks the two
snapshots are equal), and compresses both (`worker/prepare.ts`), answering the data protocol's `demo` request
with its progress, and ends with the job; the library (its `demo` option; `main.tsx` passes
`createBrowserDemoJob`) stores them as the record `demo:<size>` and the page opens
`/diagram#snapshot=demo:<size>` through `actions.setSnapshot`. Each stage shows in a live region with a
progress bar ("Generating demo organisation M and its 35 days of history…", "Compressing for storage…",
"Storing in this browser…"); a failure shows an alert. The diagram itself still generates demo organisations
in its data worker, so they need no storage at all.

**Large snapshots.** Drawing more than `LARGE_SNAPSHOT_ASSETS` (10 000, `@gcportrait/model`) assets at once is
slow and heavy on memory, so the app draws such a snapshot only once the person has said so
(`LargeSnapshotGuard.tsx`, in `App.tsx` inside the snapshot library's provider): an alert dialog says how many
assets it has and that the diagram still works, with "Draw it anyway", "Cancel" (focused; Escape too) and "Do
not ask again in this session" (`sessionStorage`, never `localStorage`; it takes effect with "Draw it
anyway"). A snapshot the person chose to draw is remembered for the tab's life, so a timeline step, a lens, a
filter, a flip or an export never asks again; a reload asks again unless the session setting was ticked. Each
way in asks where Cancel leaves the person as they were: "Try the demo" before it generates anything (the
size's count from `DEMO_SIZE_INFO`, or the stored copy's), the table's Load (the record's count), the Connect
page's export import once the files are read and before anything is stored (the library's `confirm`, asked
about the snapshot the import opens, the last: Cancel stores none of the files' snapshots, so the same files
dropped again ask again), a pull or a Cloud Storage read while it streams (`import/run.ts`). The Snapshots
page's import draws nothing and so does not ask. Every other way onto the diagram (a link, the Snapshot menu,
a saved view, Back and Forward) meets `useLargeSnapshotGate` on the diagram page, which holds the pipeline
(`useDiagramPipeline`'s `held`: no worker is asked for the snapshot) while the listing is read or the person
is asked; Cancel goes back (`navigate(-1)`), or, on a page opened at that link, to the Snapshots page (a
stored snapshot) or the Connect page (a demo organisation). The render API and `pnpm render` draw what they
are asked and never ask.

**The record** (`StoredSnapshot` in `storage/db.ts`): `id` is the snapshot's ref (its ULID, or `demo:<size>`);
`blob` is the model `Snapshot` as JSON, gzip-compressed (`application/gzip`; plain `application/json` where
`CompressionStream` is missing), read back only through `migrateSnapshot`; `history`, for demo organisations,
is the `DemoHistory` (`{ size, seed, today, base, ticks }`) encoded the same way, which `snapshotAt` of
`@gcportrait/demo-data` replays (`loadStoredHistory` in `load.ts`, for the timeline); `meta` is what the table
lists without reading the blobs (scope, read time, source kind, asset count, `bytes` = the stored size of
`blob` + `history`, `savedAt`, `schemaVersion`, and optionally `detail`, `estimatedReadTime`, `historyTicks`).
The optional fields need no migration. Compressed, demo M takes 0.3 MB, L 1.9 MB and XL 13.9 MB (172 MB as
JSON); generating, reading and compressing XL takes about 5 s in Node.

**The snapshot file: `.gcportrait.json`.** Export writes one format, a bundle that round-trips: one JSON
object whose `format` key comes first, so a reader recognises it from its first bytes:

```json
{"format":"gcportrait.snapshot","version":1,"exportedAt":"2026-10-10T12:00:00.000Z","generator":"gcportrait",
 "snapshot":{ …the model Snapshot… },"history":{ …the DemoHistory, when the record has one… }}
```

The reader ignores every key it does not read.

`snapshot` is read through `migrateSnapshot` (its own `schemaVersion` follows the model's migration policy),
and `history` through the model's `DemoHistorySchema`, then replayed to its last day, and it must end with
the bundle's snapshot (its last day holds the same assets, by name: `parseHistoryOf`) before anything is
stored; a bundle `version` above 1 is refused with "Update gcportrait". The file is written from the stored
blobs without parsing them on the page (`bundleParts`), after the snapshot worker has read them in full (the
`check` job: the snapshot through `migrateSnapshot`, the history through `parseHistoryOf`), so a damaged
record (one that does not decompress, is not JSON, is no valid snapshot, or carries another snapshot's
history) is refused with the reason instead of being written to a file that would not import; the table
shows "Checking …" meanwhile (a second or two for XL). It is named like the diagram's exports:
`gcportrait_<scope>_<readTime>.gcportrait.json`. An exported bundle imports back to the same snapshot and
history (`library.test.ts`, `parse.test.ts`, and the e2e spec). Raw CAI NDJSON is imported but never written:
it would lose the scope and the read time.

**Ids: a ref names one snapshot for good.** Every import is a new record under a new ULID (ingest's `ulid`; a
bundle's document `id` is rewritten to match), never the id its file carries, even when that id is free. An id
can be free because its snapshot was deleted, and every demo organisation's file carries the same
deterministic id, so keeping it would let a ref name one snapshot before a delete and another after it;
whatever is kept by ref (the data worker's Graph, the top bar's view choices, saved views, links) would then
show the wrong snapshot. So an import never replaces a stored record, and a deleted ref names nothing from
then on. The library hands the worker the stored ids (`taken` in the import request): a new id never collides
with one, and a bundle whose own id is among them (a file exported from an imported copy) gets a note saying
it is a copy of a stored snapshot, as does the second of two files with the same id in one import. A file
exported from a demo organisation imported twice makes two copies; the table tells them apart (below). The
data worker also asks the store before it reuses the Graph it kept for a stored ref (`storedSnapshotVersion`:
when the record was saved, or `missing`), so a snapshot deleted on the Snapshots page, or in another tab, is
not drawn from memory: its view says "No snapshot … is stored in this browser.", as it does after a reload.

**Import.** The Snapshots page's drop zone and its "Choose files…" button (the keyboard's way in) take any
number of files. The snapshot worker sorts them: a `.gcportrait.json` name or a bundle's first bytes make a
bundle, each its own snapshot; all other files together are one Cloud Asset Inventory export (one file, or
every file of a `uriPrefix` export), read by `ingest` with its streaming reader (progress per MiB: bytes of
the total and assets so far). An export's `operation.json` among the files (a name with "operation" ending in
`.json`, whose content is an `exportAssets` operation: `import/sidecar.ts`) is not read as lines: it gives the
snapshot its read time (`readTimeSource: export-sidecar`, not an estimate) and its scope; alone, it fails the
import. An export's scope is the root its assets' `ancestors` share (`worker/scope.ts`: an organisation, named
by its `displayName` when the export holds the Organization asset; a project without an organisation by its
id); its read time is the latest asset change, which the table labels "estimated" (skill cai-ingestion §1),
unless the lines are the backend's frames. Files whose assets name several roots (files of different exports)
are still read as one snapshot under the root most of them share, with a note saying so. Malformed lines are
left out and the first five listed; a file without any asset, a broken or newer bundle, or an invalid history
fails the import with an alert naming the file and its problems. A snapshot IndexedDB refuses (the quota) is
not stored, not even in memory (the data worker could not open it): the import says so, and fails when nothing
could be stored.

**Cancel.** While the files are read, Cancel under the progress bar ("Cancel importing", "Cancel importing
the export" on the Connect page's card; `JobStatus.tsx`) stops the import, and leaving the page does the same
(`useImportSignal.ts`): nothing is stored, the card says "Cancelled. Nothing was stored.", as a pull's
Cancel does, and focus goes back to "Choose files…". The import's signal (`importFiles`' `signal` option)
rejects it at once (`SnapshotJobCancelled`) and sends the snapshot worker one `cancel` message: the job
stops at its next step (before each file, between the chunks of an export, pausing every MiB so the message
can arrive, before encoding, before answering), and a job still queued never starts. Whatever the worker
still answers for it is dropped. The library checks the signal after each step too; aborted while it
stores, it deletes what this import had stored.

**Load, export, delete, storage.** Load puts the ref into the hash on `/diagram` (`actions.setSnapshot`); the
data worker reads a ULID from IndexedDB (`load.ts`, stage "Reading the assets"); a missing one, or a damaged
one (it does not decompress or parse, or the model cannot read it), is an error on the canvas in a sentence
for people. Export checks the record (above) and saves the bundle through `export/deliver.ts`. Delete and
"Delete all snapshots…" ask first in a `ui/Dialog`; focus then goes to the section heading. Each row's buttons
are named after the row ("Load example.com, read 2026-10-08 00:00 UTC, demo:M": scope, read time, source
detail; copies of one file also by when they were stored, then, for copies stored in the same minute, "copy
2", numbered in the order they were stored), and so are the Snapshot menu's stored entries; the Stored cell
shows that copy number too, so no two rows look alike. The Storage section sums the stored sizes, those kept
in memory apart ("2 snapshots take 1.2 MB in this browser; 1 more takes 0.3 MB in memory, until this page is
reloaded or closed.": a demo organisation IndexedDB refused), and shows the browser's own estimate,
`navigator.storage.estimate()` (the whole site's usage against its quota), when the browser answers; it asks
again three seconds after each change, because the estimate lags behind writes, and says that it can.

**Timelines by scope** (`ScopeTimelines.tsx`, `scopeEntries.ts`). Below the stored snapshots, the
page shows each scope this browser keeps something of as its timeline: a part per scope (a region named by its
heading: the scope's name, then its kind and id; a scope known only from cached days is named by those),
sorted by name, with a summary ("1 snapshot, 2 extra ticks and 5 cached days: 1.7 MB in this browser.") and a
table in time order (oldest first, as the timeline bar runs; at one instant a day, then a snapshot, then an
extra tick): its snapshots with a history ("Snapshot · Demo · 35-day history"), its exports and manual pulls,
which are the extra ticks of every timeline of that scope ("Extra tick · Export file", where its read time
came from, its detail, and how many copies were read in the same second; an estimated read time says
"estimated" under it, a typed one "entered"), and the days its timeline read from Cloud Asset Inventory into
the tick cache ("Cached day", when it was read), each with its asset count and size. An extra tick is deleted
after a confirmation ("Delete this extra tick?": it is a stored snapshot, so files exported keep it; the
timeline loses it at once), a cached day at once (the timeline reads it again when the view comes back to it),
and "Delete the cached days of …" (shown only while the scope has any) deletes the scope's whole tick cache
after a confirmation. Focus then goes to the scope's heading, or to the section's when the scope's part is
gone with its last entry, and a polite status says what was deleted. The cached days are read through the
page's IndexedDB connection (`storage/tickCache.ts`: `list`, `remove`, `removeScope`), again whenever the
listing changes. The stored snapshots table also marks a read time typed in at the import ("entered when it
was imported"), as it marks an estimate.

**Without IndexedDB** (`openDatabase()` resolves to null: some private windows) the page says so; records are
kept in memory until the page is reloaded or closed (in-app navigation keeps them), the demo organisations
work (the diagram generates them), and importing is off, because the data worker could not read an imported
snapshot; a file dropped on the drop zone is refused there, not opened by the browser (which would leave the
page and lose what is kept in memory).

**The worker.** The snapshot worker is a third role of the diagram's worker script (`WORKER_ROLES.snapshots`),
so the build shares ingest, the model and zod with the data role instead of bundling them again; its own chunk
is about 3.6 kB gzipped. It replays histories with demo-data's generator-free `history/replay.ts`, so it loads
none of the generator. It prepares records (Blobs and listing metadata, never parsed assets, so nothing big
crosses back to the page); the page writes them to IndexedDB.

**The Snapshot menu.** `SnapshotLibraryProvider` writes the menu's choices into the store's
`snapshot.available` (the demo organisations S, M and L, then every stored snapshot: a stored XL demo as "Demo
organisation XL (extra large)", any other by its row's name, "example.com, read 2026-10-07 18:22 UTC,
export.json"); the menu (`shell/topbar/SnapshotMenu.tsx`) reads only the store.

Tests: `codec.test.ts`, `labels.test.ts`, `worker/scope.test.ts`, `worker/parse.test.ts`,
`diagram/pipeline/demo.test.ts`, `worker/handler.test.ts`, `library.test.ts`, `pages/SnapshotsPage.test.tsx`,
`pages/ConnectPage.test.tsx`, `scopeEntries.test.ts`, `ScopeTimelines.test.tsx`,
`LargeSnapshotGuard.test.tsx`, `e2e/tests/large-snapshot.spec.ts` and `e2e/tests/snapshots.spec.ts`.

## Diagram renderer (`src/diagram/`)

The diagram page draws the view in the URL hash (AGENTS.md, Product rules; frontend/AGENTS.md, Code; the
gcp-diagram-style and gcp-diagram-layout skills): the hash's ViewSpec names a snapshot (a demo organisation,
`#snapshot=demo:S|M|L`,
or a stored snapshot), the **data worker** turns it into a Scene and resolves
the icons it draws, the **layout worker** lays the Scene out, and the page renders the Layout as SVG in React.
Hover, selection, keyboard focus, zoom and level of detail then only change attributes and classes of that
SVG; they never ask either worker for anything (a test counts the requests).

```
src/diagram/
  pipeline/protocol.ts     the data worker's messages (lenses with their default detail; scene for a ViewSpec and
                           a viewport; the view controls' choices for a snapshot); every request that
                           follows a Scene names the day on screen (`DayRef`)
  pipeline/dataHandler.ts  worker side: demo-data → CAI NDJSON → ingest → buildGraph (kept per snapshot)
                           → buildSceneWithReport with the compiled catalog and the viewport's rect budget;
                           the answer carries the Scene's icons, its product containers' type names (a removed
                           one's ghost named from the Graph of the day compared with) and each asset-backed
                           node's console link (the catalog's consoleLinkFor)
  pipeline/sceneMemo.ts    the Scenes a Scene request and its diff build, kept per Graph
  pipeline/historyRead.ts  a history's day through ingest, each history asset read once: a day read from its
                           difference to the day before shares the assets the days before read
  pipeline/days.ts         how a request names a day (`{ tick }`, null for the snapshot's own day)
  pipeline/transfer.ts     a Scene answer or Layout of more than 1 000 rects crosses as transferred JSON bytes
  pipeline/dataClient.ts   page side: one promise per request; a newer Scene request supersedes the older, a
                           search the search before it, a search hit's locate the one before it (a jump link's
                           locate, without offers, is never superseded)
  pipeline/diagram.worker.ts  the one worker script, started per role (data, layout, snapshots, imports,
                           demo), named by role (roles.ts); each instance imports only its role (dataRole.ts,
                           layoutRole.ts, demoRole.ts: "Try the demo" in a worker of its own)
  pipeline/workers.ts      DiagramWorkers (data + layout clients), created lazily by the app; the demo job's
                           worker
  pipeline/inProcess.ts    the same handlers connected in-process, for tests (jsdom has no workers)
  session.tsx              DiagramSessionProvider: the workers, the catalog's lens titles, the export source
                           (the pipeline itself is the app store's: src/state/pipeline.ts, section "App state")
  autoDetail.ts            detail `auto` against the measured canvas: the level rule, the hysteresis band
  camera.ts                the camera glide of `jumpTo`: the end camera and the eased steps; the keyboard's and
                           the fingers' cameras (pan, pinch, double tap)
  disclosure/              progressive disclosure: flips and levels, the store's selectors and notices,
                           the collapse button, the camera after a flip, the "N of M shown" bar (section below)
  model.ts                 Scene + Layout → what the renderer and the painter need (paint order, chains, dim,
                           the trace index, the console links)
  trace.ts                 the selection trace: path to the root, incident lines, routes/connects chain, reached
  actions.ts               a node's console action and menu items (card, context menu, the drawer's header)
  marks.ts, geometry/rings.ts  where the rings and the console action go (painter and static drawing alike; the
                           action inside the selected node)
  icons.ts, iconTable.ts   the icons a Scene draws: resolved in the data worker (iconTable.ts, the only
                           module with `@gcportrait/icons`' table), looked up and placed on the UI thread
  names.ts                 type names for accessible names ("Cloud Run service")
  Drawing.tsx              the pure SVG scene graph: zones, headers, badges, cards, chips, icons, edges and
                           their markers, secures overlays, legend, title block
  DiagramSvg.tsx, static.tsx  the drawing as a standalone SVG document / string (baselines)
  DiagramCanvas.tsx        the interactive canvas: its camera (pan and zoom by every pointer and the wheel),
                           level of detail, pointer and keyboard events
  canvasCamera.ts          the camera a canvas publishes by its <svg>: read by the export, moved by the tests
  touch.ts                 a finger's pointer events read as gestures: pan, pinch, tap, double tap, long press
  painter.ts               the selection trace, hover preview, selection, console action and focus, painted by
                           classes and attributes, and the traced lines it clones from per-kind prototypes
  geometry/edgePath.ts     orthogonal paths with rounded elbows; heads on a straight stretch
  geometry/text.ts         ellipsis fitting with the layout's Roboto metrics (never the DOM)
  legend.ts, titleBlock.ts, lod.ts, viewport.ts   legend rows, title block and read time, LOD, camera fit
  theme/tokens.ts, tokens.css, contrast.ts, styles.ts   the diagram tokens and drawing rules
  diff/                    the timeline's diff overlay: which day, the diff and ghosts (data worker), the
                           markers and their words (section "Timeline diff overlay")
  baselines.test.tsx       the SVG baselines (below)
```

**Drawing.** Every number comes from the style skill (gcp-diagram-style §2–§7) or the layout's constants
(`DEFAULT_SIZING`, `DEFAULT_ROUTING`): zones radius 10, tinted by kind (product containers `nested` from depth
3), strokes 1.5 px for projects, VPCs and subnets and 1 px otherwise, regions dashed; folder titles top-left,
every other title centred, in 15 px (depth 1) or 13 px, 500, with a 2 px halo in the zone's fill, the id after
a middle dot; badges as `surface` pills; cards 44 px, radius 8, a 24 px icon, a 13/700 title and a 10.5 px
subtitle whose addresses are set in Roboto Mono (the layout's `subtitleRuns`), text cut with an ellipsis by
the same metrics the layout sized the box with; chips in the zone's tint with the zone's header mark (14 px,
beside the label, so a chip's kind never rests on its tint alone) above a ⊞ glyph (drawn, not a font
character) beside the count line. The layout chooses the short form ("2 net · 39 res") when the full one
does not fit the widest chip's text column (220 − 44 = 176 px) and carries it in `LayoutRect.chipCountLine`;
the renderer only fits that chosen line with an ellipsis, never chooses its form again. Accessible names
keep the full counts. A product container's header shows its catalog type's icon (the Scene carries it: a GKE
cluster, a dataset, an instance group). Icons come from `@gcportrait/icons`: the data worker resolves each key
the Scene names through the package's fallback chain (`resolveIcon`) and sends the icons with the Scene, so
the 170 kB icon table never loads on the UI thread; the drawing defines each once and places it with `<use>`,
adding only position and size to the artwork's root element (`placeIconMarkup`, the package's `placeIcon`
contract, byte for byte: a test compares them). The artwork is never edited, and Google's colour marks sit on
the light plate on dark canvases. A zone without a header icon in the Scene gets its kind's mark
(`ZONE_MARKS`).

**Edges.** Stroke, dash and head per relation kind are the skill's §5 table, keyed by the default-style id the
model's `RELATION_KINDS` gives each kind (`EDGE_STYLES`), so there is no second per-kind map. Two `<marker>`s
per kind with a head and per theme, both `orient="auto"` and `userSpaceOnUse`: the end marker
(`dg-<theme>-head-<kind>`) points along the path, the start marker (`…-<kind>-start`) is drawn pointing back
(SVG 2's `auto-start-reverse` would need one, but resvg and other SVG tools do not support it). Filled
and hollow heads end the line at the head's base and put the tip where the layout ended the edge (2 px inside
the border); open heads keep the line to the tip; every head sits on a straight stretch with a 1 px lead, and
elbows are quarter circles of the layout's `elbowRadius`, at most half of a segment between two elbows. A hub
bundle's members are drawn from their shared end, so their dashes coincide, and its shared head once.
`secures` is drawn as a dashed `accent.path` overlay at 50 % 4 px inside its target's border (and a Scene
report's overlay zones as the same outline instead of a tint), laid over a canvas-coloured core and a
`pathCasing` band 1 px wider on each side (below: the light amber needs it for contrast), painted under the
lines (zones, nodes, overlays, lines), never in the gutter; each overlay carries a `<title>` naming its
policy ("secures — web-armor", "secures — 2 policies") that a pointer resting on its dashes shows (the dashes
take the pointer; a click on them selects the target), and the legend's row names the policies of all of them
(cut at a card's widest, 220 px, with an ellipsis and the full names as the row's `<title>`). Above 30
drawn lines dim mode is on: lines in `edge.dim`, 1.2 px, each with its kind's head shape at 7 × 5 in
`edge.dim` (`dimhead` markers), stopping at the head's base so the tip reaches the target's border; the
interactive canvas also has one hidden traced line per relation kind on top, from which the painter makes the
traced lines (below; a hidden copy of every line would nearly double a large view's elements).

**Legend and title block.** Both are inside the SVG: the title block in a band above the layout's canvas
(scope, "<lens> lens · read <readTime>" in ISO-8601 at the viewer's UTC offset, and the tagline in `muted`,
10.5 px; the same three lines in a standalone drawing, with no affiliation line in any drawing, section
"Branding and the non-affiliation notice"), the legend in a band below it (bottom-left, `surface` panel with a
`border` stroke, rows only for the tints, samples and relation kinds on screen, "dim = not focused" in dim
mode, and a timeline day's markers drawn, "added since 2026-09-07" and so on; the collapsed-zone sample in the
tint most of the drawn chips have, as chips take their zone's tint), so nothing in the diagram overlaps them.
The Settings page's "Show the legend and the title block on the canvas" (`diagramOverlays`, default on) hides
them on the canvas only; the standalone SVG always has them.

**Interaction.** The canvas keeps its camera itself and puts it on the drawing's group as a
`translate(x,y) scale(k)` transform (`cameraAttribute`, `viewport.ts`), within `scaleExtent [0.05, 200]`; it
publishes the camera by its `<svg>` (`canvasCamera.ts`) for the export's "current viewport" and the tests. A
mouse and a pen come as pointer events: a press of the primary button without Ctrl (with Ctrl, a Mac's
right-click) takes hold of the drawing, and once it has moved further than the click distance it is a drag,
which keeps the drawing's point it pressed under the pointer (`camera.ts`, `isDrag`, `panTransform`), takes
the pointer (`setPointerCapture`), and whose click the canvas takes on the window before anything else hears
it; while held, the browser neither drags what was pressed (the console action's link) nor selects text. The
wheel zooms about the pointer by 2 to the power of its delta: 0.002 a pixel, 0.05 a line, 1 a page, ten times
as much with Ctrl, which is how a browser sends a touchpad's pinch, so a notch of 100 px scales by 2^0.2
(`wheelZoom`, `wheelTransform`); turns less than 150 ms apart are one gesture, whose turns the canvas keeps
from the page even where the scale extent leaves them nothing to do, while a turn on its own there is the
page's (with Ctrl, the browser's zoom). A press, a drag and a turn of the wheel stop a glide on its way.
Double-click does not zoom: it is kept for drill-in (tests: `camera.test.ts`, `DiagramCanvas.test.tsx`). The
canvas moves the same camera for a finger (paragraph "Touch" below). A new view is fitted to the
canvas (never enlarged past 100 %), or on a phone or a tablet to the part of it an open sheet or drawer
leaves, which a panel opening or closing fits it to again while the camera still rests on that fit (section
"App state"); a theme change keeps the camera, and so does a selection on a desktop. Level of detail by the
effective scale sets classes on the `<svg>` (`lod.ts`): subtitles hide below 0.55, labels below 0.35, 2 px
strokes thin to 1.5 px past 2×. Hover previews the node's selection trace (below): its path to the root in
`accent.path` 3 px (path rings the painter places on each border, on a 1 px `pathCasing` band on each side;
one ring per level of the deepest chain is drawn once, hidden), its traced lines and the nodes they reach. A
click (a mouse's or a pen's press let go within 4 px of where it was pressed, `CLICK_DISTANCE` in
`viewport.ts`, which moves nothing, so the camera still rests on a fit after it; moved further, it is a drag,
which pans and selects nothing) or Enter/Space selects (on a chip it expands it instead: section "Progressive
disclosure"): the selection goes into the hash (`selection=`, history replaced), the `accent.select` ring (3
px between 2 px canvas-coloured gaps) pulses twice in a second (no animation with reduced motion), the node's
lines are traced (below), and the details drawer opens (section "Details drawer" below). Escape or Close
clears it.

**Touch.** A finger comes as pointer events of `pointerType` `touch` (frontend/AGENTS.md, "Phones, tablets
and desktops"), which `touch.ts` reads into gestures on a clock it is given and the canvas carries out,
while a mouse and a pen keep their drag and the wheel, the click, the double-click, the right-click and hover
exactly as above:

| Gesture | What it does |
|---|---|
| One finger moved past 10 px (`TAP_SLOP`) | Pans: the drawing's point it touched stays under it (`camera.ts`, `panTransform`), at the camera's scale then. Never a selection. |
| Two fingers | Pinch: the scale is their distance over that of the points they touched (within `SCALE_EXTENT`), and those points' midpoint stays under theirs, which pans with them (`pinchTransform`). Lifting one leaves the other panning; a third is ignored. |
| A tap (lifted within 10 px, before 500 ms) | What a click does: selects, clears the selection on the bare canvas, opens a chip, closes a zone by its collapse button; on the console action the browser's own click opens the link. |
| A double tap (the second tap within 300 ms of the first's lift and 24 px of where it touched) | Zooms in two times about its point (`doubleTapTransform`), as a 200 ms glide (at once with reduced motion). On a chip or a collapse button the first tap's flip stands and nothing zooms: the flip's own glide frames the zone, as after one tap. |
| A long press (500 ms within 10 px, `LONG_PRESS_MS`) | What hover shows a mouse: the trace's preview, and by the finger (above it, or below where the canvas has no room above, inside the canvas, `touchHint.module.css`) the tooltip a resting mouse would show there (a ghost's, a `secures` overlay's, a legend row's, the console action's or the collapse button's `<title>`) or else the node's accessible name; on the console action its labelled pill too (`is-held`), and the browser keeps its own menu for the link. It selects nothing and opens no menu; the next finger, a finger's pan or pinch, a mouse over the drawing or a new drawing takes it off. |

A click, a double-click or a right-click is the finger's, and changes nothing more, when it says so
(Chromium's click of a tap has `pointerType` `touch`) or comes while a finger is on the canvas or has left it
less than 500 ms ago (`TOUCH_MOUSE_MS`); the mouse events a browser makes of a tap move nothing, as the canvas
reads a mouse from its pointer events. A pan or a pinch stops a glide on its way, as a mouse's drag does; a
tap leaves it, so the glide that frames a chip the first tap of a double tap opened goes on. A finger's moves
and lifts are heard on the window, where they go once the node it pressed is redrawn mid-gesture.
Tests: `touch.test.ts`, `camera.test.ts` and `DiagramCanvas.touch.test.tsx`.

**Selection trace and console affordance.** `trace.ts` computes, from the Layout alone (no Graph), the
trace of a node: the zones on its path to the root, the lines touching it or anything inside it, the
`routes`/`connects` chain through it (downstream along `routes`, upstream against it, `connects` both ways, up
to 8 hops each way, each node visited once per direction, so loops end; only chains through the node, never
sideways), and the nodes those lines reach (a chip is a node: the layout re-targeted the ends inside it). The
painter keeps the selection's trace painted until the selection changes: path rings (`accent.path` 3 px on a
`pathCasing` band) on the zones to the root, the traced lines' copies shown (`accent.select` 3 px over a 4 px
`canvas` casing, their kind's dashes scaled to 3 px, `tracehead` markers), one path of reach rings (1.5 px
`accent.select` outside a `canvas` gap) around the reached nodes, the pulsing selection ring, the legend's
trace column ("selected", "trace", "path to root"; the panel's widths are `data-` attributes, and the frame
always has room for the column, so a selection never moves the camera) and, when the node has one, the "Open
in Cloud Console ↗" action inside it, in its top-right corner. Hover previews the same trace for the node
under the pointer (the hovered node gets a path ring too); with a selection only cards, chips and card-sized
zones preview. Everything else is pre-drawn and hidden (rings, the action, the legend column, and one
traced-line prototype per relation kind); painting sets classes and attributes (`is-path`, `is-reached`,
`is-focus`, `d`, `href`, `transform`, `display`, `tabindex`, …) and puts the traced lines on top
as clones of their kind's prototype and takes them off again, so no hover or selection asks for a Scene or a
layout (the page test counts them). Paint order: zones, nodes, overlays, lines, the path, reach and selection
rings, traced lines (so a ring's gap never hides a traced head), the focus ring, the console action, the
legend.

The console action is an SVG link (`target="_blank"`, `rel="noopener noreferrer"`) whose `href` comes from the
data worker: `consoleLinkFor` of the catalog engine, the type's `console` template (`consoleUrlFor`), or for a
type without one its project's console home ("Open project in Cloud Console ↗"); its type is the catalog
engine's `ConsoleLink`, declared there once. It sits inside the selected node, anchored at its
top-right corner (`marks.ts`: `consoleActionAnchor`, `consoleActionBox`), so it never covers another card (a
20 px pill hung 9 px under the card would lie on the card below, two rows of cards being 20 px apart): at
rest a 16 px circle around a ↗ glyph, concentric with a card's 8 px corner (2 px further in on an open zone's
10 px corner); on hover and keyboard focus the stylesheet swaps in the labelled 16 px pill where the painter
found it fits inside the node (`data-expand`, `consoleActionExpands`; an open zone keeps the circle, so the
label never covers its header). Each variant carries a `<title>` tooltip ("Open in Cloud Console ↗ (opens a
new tab)"), and the painter names the link ("Open bastion in Cloud Console (opens a new tab)"). While shown it
is a tab stop after the node (the painter sets its `tabindex`; DOM order puts it after every node), keyboard
focus fills it in the focus colour with its glyph and label in `canvas` (6.51 : 1 light on the `focus`
`#185ABC`, 7.82 dark), and Escape on it clears the selection and puts focus back on the node. `marks.test.ts`
checks, for every card, chip and card-sized zone of demo M's compute lens at `all` and `auto`, that both pills
lie inside the node and share no area with any rect but the zones around it. Nothing opens it but its
activation, and a click on it changes nothing in the app. The node menu (`actions.ts`, on `ui/Menu`) opens on
a right-click, on Shift+F10 or the context-menu key on a focused node, and on Enter on the selected node, and
selects the node: "Open in Cloud Console" (or "Open project in Cloud Console", a link item), "Copy resource
name" (the clipboard, with a status message) and, for containers (open zones and chips that stand for an
asset), "Drill in", which re-roots the view in the hash. Escape closes it and puts focus back on the node. The
drawer header takes the same action from `consoleActionOf`, or for a node the view does not draw from
`consoleAction` with the link its details carry. Cards, chips and card-sized zones are buttons named by type
and label ("Cloud Run service: orders-api"); one of them is the drawing's tab stop (roving `tabindex`, at
first the top-left solid node; the keys: paragraph "Keyboard" below), followed by the selected node's console
action and keyboard focus draws the focus ring (2 px `focus` between canvas gaps, never thinner on screen than
at 100 %); open zones are named graphics objects, product containers by their asset type when the data worker
knows it ("Compute Engine instance group: api-mig"); edges are hidden from assistive technology. Lens titles
come from the catalog's lens files through the data worker. The canvas fits the camera in a layout effect,
before the first paint, and sets `data-diagram-ready="true"` on the `<svg>` (what the tests wait for) only
once the painter and its pointer and keyboard listeners are attached, so whoever sees the flag can hover,
focus and select at once. The flag stays set while the next view is prepared, as the drawing before it stays
on the canvas until then; `data-drawing`, set in the same step, numbers the drawing: every drawing the canvas
puts up (a new view, or the same view in another theme or with other settings) takes the page's next number,
so a test that changed the view waits for another number (the e2e suite's `redrawnCanvas`), and a selection, a
hover or the camera leaves it. An export drops both. A theme or settings change re-renders the same elements,
which keep the classes and attributes the painter set: the old painter takes its marks off when it is
replaced, the new one paints the selection and the keyboard focus again, and a hover waits for the pointer's
next move.

**Known limits.** Edges are not hoverable (no count tooltip). resvg (`@resvg/resvg-js`, the layout's debug
rasteriser, and `@resvg/resvg-wasm`, the render library's) panics when an icon's nested `<svg>` lies outside a
*cropped* viewBox; the whole drawing rasterises fine, so a viewport export should crop the bitmap rather than
the viewBox. Where the layout ends an edge with a final segment shorter than its head (6 px against a 7 px
head, at L detail `projects`), the head's tip lands about 1.5 px deeper than the 2 px the skill asks for; the
layout's routing owns that segment.

**Bundle.** `pnpm size` checks the build by thread against [Bundle budgets](AGENTS.md#bundle-budgets),
which defines the limits, exclusions and first-paint classification. What keeps it within those limits:
the icons travel with the Scene (above),
so the UI thread does not carry the icon table; the UI thread ships no zod (the model's URL-hash codec and the
vocabularies it reads import none; importing a `*Schema` here would bring about 25 kB back); one worker script
serves every worker (`diagram.worker.ts`), so the modules the roles share (the model, zod, ingest) are bundled
once, with each role's code in its own chunk; the demo generator (about 69 kB) is a chunk of its own that only
the data worker loads, on first use (`pipeline/demo.ts`); and the two generated data tables the data worker
reads, the compiled asset catalog (about 600 kB) and the icon table (about 170 kB), ship as JSON files
(`assets/catalog-data-<hash>.json`, `assets/icon-table-<hash>.json`) that the worker fetches when its data
role starts (`vite.config.ts`, `dataTablesAsJson`: the catalog is data, the icons are images). JSON is cheaper
to parse than the same object literals as script and the bytes on the wire are the same. The worker is a
module worker (`worker.format: 'es'`). The dev server and the tests import the modules as they are. To see
what a chunk holds, build with source maps into a scratch directory (`vite build --sourcemap --outDir <dir>`;
never into `dist/`, which the backend serves) and attribute each chunk's bytes to its sources.

### Diagram theme and contrast

`theme/tokens.ts` holds the style skill's §2 palettes and `theme/tokens.css` the same values as `--dg-*`
custom properties under `<html data-theme>`. The drawing writes the theme's values as SVG attributes (so a
serialised SVG carries its colours); the interactive states in `diagram.css` use the custom properties. Every
value is the skill's: the folder, product-container and virtual-region outlines and `edge.dim` are each
theme's `muted` (light `#5F6368`, 3.52 : 1 on the project tint at worst; dark `#9AA0A6`, 4.07 : 1 on the
nested tint at worst; a fainter grey fails a §10 pair), the dark `zone.subnet` stroke is `#B39B4C` (4.53 : 1
on its fill, 4.55 on the VPC tint; unlike the dark `accent.path`, so card-sized subnets do not look
highlighted), and two tokens go beyond the base palette: `mutedOnTint`, secondary text (a zone's id, a
card-sized zone's subtitle) where `muted` is below 4.5 on the tint (light project 3.52: `#3C4043`, the light
`chip.text`, 6.09; dark project 4.38 and nested 4.07: `#BDC1C6`, the dark card stroke, 6.39 and 5.94), so ids
stay lighter than the title; and `pathCasing`, the band the path to the root and the `secures` overlay sit on
(light `muted` `#5F6368`, on which the amber `#F9AB00` reaches 3.13 : 1 and which reaches 3.52 on the project
tint; not `ink`, whose black-and-amber band would read as hazard tape; dark `canvas`, 11.75), as the selection
ring sits on its canvas gap: the light amber reaches only 1.13–1.93 on the light fills. `SKILL_DEPARTURES` is
empty: should a §2 value fail a §10 pair, the departure goes there with the value it replaces and its ratio
until the skill adopts one. Dark values §2 leaves out are derived: dark `edge` and `chip.text` = `ink`.

`theme/theme.test.ts` (it lives with the tokens rather than in `packages/layout`)
checks the table against the skill's §2 tables value for value (`mutedOnTint` and `pathCasing` included),
checks that each `muted` stroke is still needed (with a fainter grey in its place, a §10 pair fails), that
tokens.css matches, and then computes every §10 pair in both themes and fails on any below
its threshold:

| Pair (threshold) | Light, worst | Dark, worst |
|---|---|---|
| text on its background (4.5) | zone id on a project in `mutedOnTint` 6.09; the rest in `muted` or `ink` | ids in `mutedOnTint` on nested 5.94 |
| zone outline vs its fill, its parent and the legend panel (3) | 3.52 (a container on a project); VPC (1.22) and subnet (1.11): the skill's **decorative-stroke exemption** (§10), with its compensating checks (title on the tint 4.5, card outline inside it 3) | 4.07 (nested); VPC and subnet pass |
| card outline vs the card and every fill (3) | passes | passes |
| edge and dim edge vs every fill (3) | dim 3.52 (on a project) | dim 4.07 (on nested) |
| path to the root on its casing; `secures` (50 % over a canvas core) on its casing (3) | 3.13; 4.31 | 11.75; 3.97 |
| the casing over every fill where the amber alone is below 3 (3) | 3.52 (project) | none needed |
| traced line on its canvas casing; reach ring on its canvas gap (3); console action text on its pill, and `canvas` on its focused pill (4.5) | 4.51 | 7.82 |
| selection ring between canvas gaps (3) | 4.51 | 7.82 |
| focus ring on its canvas gaps, and over every fill it is drawn on (3) | 6.51; 3.78 (project) | 7.82; 5.10 (nested) |
| peer accent on a canvas gap (3); the timeline markers: the added outline and the ghost's outline on their canvas gap and band, the changed dot on its `pathCasing` disc, which stands out from every fill where the amber does not (3), a ghost's label on its 50 % body (4.5) | 5.02, 4.77; 3.13, 3.52 (project); 4.53 | 8.42, 6.90; 11.75; 4.57 |

The only pairs allowed below their threshold are the VPC and subnet outlines, the exemption the skill
documents. The test also lists, per theme, which fills a trace colour would be below 3 : 1 on directly (light:
`accent.select` on the project tint, the amber on every fill; dark: none), the fills its casing or gap
construction is there for.

### Visual baselines

Not screenshots: CI runs on Linux and pixels from another platform never match, but the SVG text the renderer
writes is the same everywhere. `src/diagram/baselines.test.tsx` renders demo S, M and L at detail `auto` (what
the app opens at 1280×800: S fully open, M and L at the folder level) and M at `all` (cards, subnets and dim
mode at a realistic size; S at `all` would repeat S at `auto`, which is already fully open) × the overview,
networking and load-balancing lenses × both themes as standalone SVG (read time at UTC) and compares each with
`e2e/baselines/diagram/<fixture>-<lens>-<detail>-<theme>.svg` (24 files, about 2.9 MB), plus four
selected states: demo S with the global forwarding rule `web-https-fr` selected in the load-balancing
lens and the VM `web-1mnl` in the overview lens, both themes, drawn with their trace by `DiagramSvg`'s
`selection` option (`…-selected-forwarding-rule.svg`, `…-selected-vm.svg`), and four timeline days compared
with the day before: demo S in the overview lens on 8 September after the 7th (an added subscription, a
removed bucket's ghost, a changed project's dot, the three legend rows) and on 17 September after the 16th
(the deleted reports project as a ghost zone holding the ghosts of what it held), both themes
(`…-diff-2026-09-08.svg`, `…-diff-2026-09-17.svg`, drawn from `demoDiffDiagram` in `testing/demoScenes.ts` as
the data worker draws them). It also checks that each carries the legend, the title block with the tagline, no
affiliation line and no text below 10.5 px, and draws XL at `folders` in both themes against the same checks
without keeping it as a baseline (its six files would be 2.5 MB of folder-level chips that M and L at `auto`
already cover). Update them deliberately, look at the changed files (a browser opens them; the render CLI,
`pnpm render`, rasterises them) and say why in the pull request:

```sh
pnpm --filter @gcportrait/frontend test src/diagram/baselines.test.tsx -u
```

The file comes before `-u`: Vitest's `-u` takes an optional value and would swallow a path after it (and the
run would then cover every file), and pnpm passes `--` on to Vitest, which then ignores everything after it.

**Keyboard (`keyboard/navigation.ts`, `keyboard/zoom.ts`, `src/keyboard/`).** Tab reaches the header controls,
then the drawing's one tab stop. The arrow keys move to the nearest item of the same zone in that direction
(cards, chips, card-sized zones, and the open zones inside it, which take focus on their collapse button); ↓
on an open zone goes inside it, an arrow with nothing that way carries on among the zone's neighbours and ↑
reaches the zone's header; Home and End go to the zone's first and last item. Enter or Space selects (the
drawer opens), Escape clears the selection and then returns to the zone around the item, Shift+F10 opens the
item's menu. The camera pans just enough to show the item, and first zooms in to the subtitle scale (0.55,
`lod.ts`; not the label scale, 0.35, where a card's text is about 4.5 px) when it is further out (`camera.ts`,
`keyboardTransform`; at once with reduced motion). `+` and `-` zoom one step (× 1.5) about the focused item,
which stays in the part of the canvas an open drawer (and the disclosure bar's row in the part it leaves) or
sheet leaves in view (about that part's centre from the canvas itself; section "App state", `clearRoom`), and
`0` fits the whole drawing to that part, with 16 px around it (`FIT_PADDING`) and none of it under the drawer,
the row or the sheet (`fitRoom`; the whole canvas when a
phone's drawer at full height leaves nothing to fit into, and when nothing is open), a fit the camera then
rests on as on a new view's, so the drawer or the sheet closing afterwards fits the drawing to the whole
canvas again (section "App state", `panels`). `/`
focuses search; `[` and `]` call `stepTick` (one day back and forward). A
single-key shortcut is matched by the character typed (`keyboard/shortcuts.ts`, `isShortcutKey`): Shift,
Option and AltGr may have been needed for it (`[` is Option+5 on a German Mac, AltGr+8 on a German PC), Cmd or
Ctrl alone make it the browser's. The focus ring goes around a focused card or open zone in the diagram token
`focus` (light `#185ABC`, which reaches 3.78 : 1 on the light project tint where the chrome's `primary`
reaches 2.62; dark `#8AB4F8`), 2 px between 2 px canvas gaps in drawing units at 100 % and closer and in
screen pixels further out (`marks.ts`, `focusRingPlacement`; the canvas tells the painter the scale). "Skip to
the diagram" (`keyboard/SkipToCanvas.tsx`) focuses the drawing's tab stop, or the canvas area while nothing is
drawn, without touching the hash. After "Drill in" (the node's menu, the drawer) focus waits on the `<svg>`
(`canvasFocus.ts`) and goes to the new view's tab stop once it is drawn; after a drill-out from the breadcrumb
it goes to the crumb that is now current. Live regions: search results and "N of M shown" (their own), the
loading stage (kept in the DOM while idle), the drawer's details error (`role="alert"`), the timeline keys'
message when they cannot move (a keyed remount, so a repeat is announced), the timeline bar's readout (quiet
during playback).

Browser tests: `e2e/tests/diagram.spec.ts`, `trace.spec.ts`, `console-link.spec.ts`, `keyboard.spec.ts`
(which also holds every focus indicator to 3 : 1 against its neighbours and against the unfocused screen) and
`a11y.spec.ts` (axe on every page and on demo S, M and L in both themes).

## View controls (`src/views/`)

The top bar's view controls ([docs/lenses-and-filters.md](../docs/lenses-and-filters.md); layout skill §6)
write the view into the URL hash through the store's actions and read it back from there; none keeps a copy
that could drift (a draft that is not a view yet, such as a focus kind waiting for its parameter or a picker's
typed text, lives only while its popup is open). A reload, Back, a copied link and a saved view therefore all
restore exactly what the controls show.

```
src/views/
  choices.ts          what the controls offer for a snapshot, worked out in the data worker from the Graph and the
                      catalog (`choices` request, pipeline/protocol.ts): the snapshot's facts (scope, read time
                      and whether it is estimated, source, assets), projects (id, number, display name, folders),
                      Shared VPC hosts (projects others `shares` into), perimeters (nodes whose `secures` reach
                      projects), applications (product containers, by type name then label), folders (number,
                      path), regions (zones as their region), the containers above any root, and the types
                      (every catalog type, the snapshot's unmapped ones, a `<service>/*` pattern per service,
                      present ones first). The catalog never reaches the UI thread.
  useViewChoices.ts   the hook: asked once per snapshot and data client (a cache of four), only once the snapshot
                      is drawn, so asking never makes the worker load a snapshot the view has left;
                      `useViewChoicesState` also says why there are none (the snapshot failed to load, or the
                      request did), so a picker shows the reason instead of "Loading" for good
  snapshotRef.ts      the `snapshot=` value a link holds that the codec rejected ("This link names no
                      snapshot" on the diagram page)
  filterForm.ts       the Filters popover's form ↔ `ViewSpec.filters` (lists ⇔ absent when empty, depth 0 ⇔ no
                      limit, tri-states default/show/hide ⇔ absent/true/false), the active-filter count
  focusForm.ts        the focus kinds and their one parameter each (the model's convention), the picker options
  lensDetail.ts       the lens switch's detail rule (below)
  trail.ts            the breadcrumb's crumbs: the scope, the containers above the root, the root
  PickerField.tsx     the pickers on ui/Combobox: chips with remove buttons (filters), one value (focus)
  savedViewStore.ts   saved views in IndexedDB, over the page's one connection (storage/connection.ts; memory for
                      the session when it is unavailable)
  SavedViewsDialog.tsx, CopyLink.tsx, describeView.ts   the "Saved views" dialog, "Copy link", view summaries
  testing/controls.tsx  the app with in-process workers and a location probe, for the controls' tests
```

**The lens switch's detail rule** (`lensDetail.ts`). A lens's `defaultDetail` (the catalog's
lens files) is the ceiling of `auto`: the scene builder never opens the lens deeper (`autoDetailLevel` in
`@gcportrait/graph`, the report's `detail.ceiling`), so Networking on demo M at 1280 × 800 opens at `folders`,
labelled, instead of 172 rects below the label scale. The detail level follows the lens while it is `auto` or
the current lens's own default (as a link may hold it): switching lenses then sets `auto`. Once the
person has chosen another level, it stays across lens switches. The hash holds no more than the level, so
choosing a lens's own default counts as following it; until the catalog's lens list has arrived, a switch
keeps an explicit level. The search reveal dialog's "Switch to the Everything lens" follows the same rule
(`search/locate.ts`, `applySteps`).

**The controls.** *Lens*: the eleven lenses with title and description (the list is 30 rem wide; a description
too long for it is cut, its title and the option's accessible description have it all). *Focus*: one button
("Focus", "Focus: demo-web-1") with a popover holding the focus-view select (none, single project, Shared VPC,
standalone projects, perimeter, application) and the parameter picker over the snapshot's choices; None and
Standalone projects apply at once, a kind with a parameter is written only when it is chosen, and a focus the
scene builder refused says why, in the popover and as "not applied" on the button. *Filters*: every ViewSpec
filter (three hide switches, the region, project, folder, include-type and exclude-type pickers, the depth
slider, shallow to deep with "No limit" at its right end, the region-zone and identity tri-states), a count
badge ("Filters (3 active)"), Reset; each change is a history entry (a depth drag or run of key presses within
a second is one). On a snapshot that could not be loaded the pickers say "Not available" and the popover says
why. The scene builder applies the filters after the drill-in root and the focus, so they hold under both (the
e2e suite checks it). *Detail*: auto, folders, projects, networks, all; Auto names the level it picked ("Auto
· folders"; `autoLevel`, the scene builder's rule with the lens ceiling, from the report when another level is
chosen). *Breadcrumb*: the scope, then the containers above the drill-in root and the root
(`aria-current="location"`); each crumb but the last is a button that drills out to it; a refused root says
"not found". Drilling in is `actions.drillIn`, called by the node menu's "Drill in", a double-click on a
container (`DiagramCanvas`) and the details drawer. *Snapshot menu*: the open snapshot's line ("example.com ·
read 2026-10-08 00:00 UTC · demo organisation"; an unavailable item), the snapshots on offer, and the
Snapshots page (a route change, not a view change). *Saved views*: a modal dialog that saves the view under a
name (a taken name is updated), lists the saved views newest first with a summary, and applies
(`actions.setView`), renames and deletes them; they live in the browser's `savedViews` store only. A view's
Delete is the destructive variant (`controls.danger`) and acts at once, without a confirmation, since a saved
view is a name over a link and is saved again in a moment from the same view: the status line names the view
deleted, and focus goes to the row that takes its place, the row above when it was the last, or the name field
when none is left. *Copy link*: the diagram page's URL with the view's hash to the clipboard, and a toast (a
polite status message kept in the DOM).

**Width.** On a desktop the view row fits a 1280 px window (the desktop layout's narrowest; AGENTS.md, Product
rules): the breadcrumb takes the free space without widening the row (inline-size containment, crumbs cut with
an ellipsis, the root's kept whole), the Focus summary is cut at 8 em, and the detail segments are narrower
than the primitive's default. On a phone or a tablet the controls but the breadcrumb are in the View sheet,
one under the other, the Focus and Filters panels as wide as the sheet (Filters in one column), and the
breadcrumb is cut from the left, so its current level always shows (section "Layouts"). Every popup is
keyboard operable: Escape first closes an open list or clears a picker's text, then closes the popover.

Tests: `filterForm.test.ts`, `viewRules.test.ts`, `choices.test.ts`, `savedViewStore.test.ts`, the
controls' tests next to each slot file, `SavedViewsDialog.test.tsx`, `CopyLink.test.tsx` and
`e2e/tests/controls.spec.ts`; `ui/tokens.test.ts` holds the views' stylesheets to tokens both themes define
and no raw colour, as it does the rest of the chrome.

## Progressive disclosure (`src/diagram/disclosure/`)

Skill gcp-diagram-layout §6 on the page. The detail level decides which zones start collapsed,
and a flip (`flipIdOf(zone id)` in the hash's `flips`, at most 48, oldest dropped) XORs that default for one
zone (the scene builder's step (e)). Everything below goes through the app store's actions and the URL hash;
the page keeps nothing of its own but the notice on screen.

```
src/diagram/disclosure/
  flips.ts             pure: which zones start collapsed (collapsedByDefault, with the scene builder's own level
                       table, `zoneOpensAt` from `@gcportrait/graph`; flips.test.ts checks it against
                       buildScene on demo M and L, overlays and bundles included), "Expand all"
                       (expandAllView; expandAllTarget, the view a press writes), "Collapse all"
                       (collapseAllView; collapseAllTarget), "N of M" (rectsShown), the cap
                       (flipsDroppedByCap), an auto level change (autoLevelShift)
  state.ts             selectors over the store (selectRectsShown, selectRectsTotal, selectCanExpandAll,
                       selectCanCollapseAll, selectExpandLevelName, selectUsedLevelName; primitives,
                       cached per view and result) and useDisclosureNotice
  DisclosureBar.tsx    the bar at the canvas's bottom right (on a tablet the bottom left; on a phone a compact row
                       across the canvas's foot, above the details sheet while it is open): "N of M shown",
                       Expand all, Collapse all, the notice; marked `data-canvas-overlay` while the drawer lies
                       over the canvas or a tablet's View or More sheet is open, so the camera keeps the drawing
                       clear of it
  CollapseButton.tsx   an open zone's collapse button (interactive canvas only), disclosure.css its states
  flipCamera.ts        the camera after a flip: keep the viewBox, glide 200 ms to frame the zone
  openAround.ts        in the data worker: the flips that open the chips around a node until it is drawn as
                       itself (toggle the chip's flip, rebuild, one level deeper each time); the one loop behind
                       search's locate and the drawer's jump links
```

- **Chips.** A click on a chip (or Enter or Space on a focused one) expands it: `actions.flip`, a new history
  entry. A double-click's second click flips nothing, and the double-click on a container drills in after
  undoing its first click's flip, in place (`onFlip` and `onDrillIn` with `replace`), so it leaves no flip
  behind and Back returns to the drawing before it. A chip is still selected by its menu (right-click,
  Shift+F10), and hover still previews its trace. `DiagramCanvas` does this only with its `onFlip` prop (the
  diagram page passes `actions.flip`); without it chips select as before.
- **Collapse button.** Every open zone of the interactive canvas has a button over its header icon
  (`role="button"`, "Collapse Project: demo-web-1", `data-collapse`), whose ⊟ face (a plate in `surface`
  with a `chipText` outline and glyph, the inverse of the chip's ⊞) shows while the pointer is on the zone
  and on keyboard focus, filled in the focus colour with the glyph in `canvas` (6.51 : 1 light, 7.82 dark) on
  a 2 px canvas rim. Activating it adds the inverse flip. It is no tab stop of its own: the painter makes it
  the drawing's roving tab stop when its zone is the node in question (a selected open zone, after a keyboard
  flip, or an arrow key or Escape moving to the zone), and then draws the focus ring around the zone too,
  which keeps its screen size when the plate is a few pixels. Exports and baselines never draw it
  (`DrawingOptions.collapsible`, interactive only).
- **Camera and focus.** The drawing that carries a flip made on the canvas keeps the camera (no fit: the
  viewBox stays) and glides 200 ms to the zone (`FLIP_GLIDE_MS`; at once with reduced motion): an expanded
  zone is framed like a jump (centred, at 100 % or closer, or fitted when larger), a collapsed zone's chip is
  centred at the current scale. Any other new drawing, a level change included, is fitted as before. After a
  flip from the keyboard focus follows the zone: onto its collapse button after expanding, back onto its chip
  after collapsing.
- **Expand all, Collapse all and the zones drawn empty** are `flips.ts`'s header (the level each writes, the
  flips it drops, what it leaves as it is, and a timeline day's ghosts judged by the state the earlier day
  drew a zone in): `expandAllTarget` and `collapseAllTarget` are the views a press writes. A button is inert
  when the view it would write draws what is on screen (`selectCanExpandAll`, `selectCanCollapseAll`):
  `aria-disabled`, still focusable, the reason in its tooltip.
- **"N of M shown"**: the rects drawn (zones, chips and cards; a chip once) of the rects the view holds at
  `all` (the report's count without flips, never less than N), with thousands separators, in a status region.
- **Notices** (a live region kept in the DOM, until dismissed or replaced): when a view change dropped flips
  over the cap (exactly `normalizeViewSpec`'s change: a flip added to a full list, whoever added it), naming
  the zone when it is on screen; and when the pipeline drew the same view (scene key) at another `auto` level
  because the canvas changed size.

Tests: `flips.test.ts` (with fast-check properties over random views and over demo M's timeline days),
`canvas.test.tsx`, `DisclosureBar.test.tsx`, `actions.test.ts` and `e2e/tests/disclosure.spec.ts`. Specs that
need a selection select a card or a zone, since a click on a chip expands it (`diagram.spec.ts`,
`a11y.spec.ts`).

## Details drawer (`src/drawer/`)

The right drawer of the diagram page: it opens when a node is selected (a click, or Enter on a focused
card), beside the canvas, 360–420 px wide. The canvas is measured by its row's width (section "App state"), so
opening it never lays the diagram out again; instead the drawer asks the canvas for a short **reveal pan**
(`actions.jumpTo(id, { mode: 'reveal' })`): `revealTransform` in `diagram/camera.ts` moves the camera as
little as it can, at the same scale, in `REVEAL_MS` (200 ms; at once with reduced motion), so that the node
and, as far as they fit, the nodes its selection trace reaches stay in view, 24 px from the edges; it does
nothing when they already are, and nothing while a centring jump (search) is on its way to the node. It asks
again when the selection changes and when the width changes.

On a phone or a tablet the drawer lies over the canvas instead (section "Layouts"), marked
`data-canvas-overlay`, so the reveal keeps the node in the part of the canvas it leaves in view, and a drawing
that still rests on its fit as the drawer opens (or changes its height or width) is fitted whole into that
part instead, and to the whole canvas again once the drawer closes (section "App state", `panels`): on a
tablet a panel along the canvas's right edge, at most half the canvas wide, its handle a 44-pixel strip on
that edge; on a phone a sheet over the canvas's lower half (`SHEET_HEIGHT`: half or the whole of the canvas's
height, less the strip the handle stands in), whose handle along its top edge (`ResizeHandle` with
`axis="height"`, the same name) moves freely while dragged and, let go, settles at the nearer of the two
heights, or closes the sheet when let go well below half; ↑ and End take it to full height, ↓ and Home to
half; it opens at half height each time. The sheet's `data-sheet` (`half`, `full`) lets the page's stylesheets
keep the disclosure bar above it at half height (where the bar, marked `data-canvas-overlay` while the drawer
is open, is kept clear by the reveal and the fit too) and hide the canvas's content while it covers the canvas
at full height (no focus lands out of sight). Either way the header and the details scroll together in one box
(`.content`, `display: contents` on a desktop), so nothing in the drawer reaches past its edge whatever its
height. Close and Escape close it as on a desktop, and so does the top bar's View or More sheet as it opens,
the selection kept (section "Layouts", paragraph "Folds"); a node selected opens it again, at half height on a
phone.

```
src/drawer/
  types.ts             NodeDetails, RelationGroup, DanglingEntry: what the data worker answers
  details.ts           worker side: nodeDetails(Graph, assets, project index, catalog) and groupRelations
  changes.ts           worker side: nodeChanges, what changed about a node between two days
  fieldDiff.ts         worker side: the small deep diff of `resource.data` behind "What changed"
  useWorkerAnswer.ts   page side: one data worker answer per key, a newer key aborting the older, the last 24 kept
  useNodeDetails.ts    the selected node's details, per snapshot, day drawn and node (on useWorkerAnswer)
  useNodeChanges.ts    what changed about it between the two days of a diff
  DetailsDrawer.tsx    the drawer; WhatChanged.tsx, JumpLink.tsx, CopyButton.tsx, ResizeHandle.tsx;
                       text.ts (arrows, explanations, the "What changed" lines)
```

**What it shows.** The header: the icon the canvas draws for the node (on the light plate in dark mode, as on
the canvas), the type name ("Compute Engine instance"), the display name (the `<h2>`), the product with the
catalog subtitle, Close, then **Drill in** (the primary action, for a container of the snapshot: graph role
`container`, not a builder's region) and **Open in Cloud Console ↗**: the catalog engine's `consoleLinkFor`
(the type's `console` template; a template whose variables are missing gives no resource link), worded by
`consoleAction` as on the card and in its menu; a type without a template offers "Open project in Cloud
Console ↗" (its project's console home), and an asset outside any project nothing. Then: the full resource
name with a Copy button, the asset type, the parent (the container the Graph nests it in) and the project (id
and number) as jump links, the location, the IP addresses and domains (the catalog's `ips` and `domains`
paths, each with Copy), labels (`data.labels`, GKE's `data.resourceLabels`) and tags (Compute's network tags
`data.tags.items`, or a `data.tags` list) as badges; the **relations** grouped by kind in the model's order
(`RelationKindSchema`), each headed by the legend's words (`relationLabel`): a container's children
(`contains`, the first 100 and a count), then every relation edge of the Graph it is an end of, outgoing (→)
before `peers` (↔) before incoming (←), each by label, with the target's type and, for a target sitting
directly in a VPC network (a subnet), "in <network>" (a NIC's own weak `attaches` to the network yields to the
subnet in the Graph, so that is where the network shows); the **dangling references** with their raw values
and why they name nothing (a project outside the snapshot, such as a public image project or a Google-managed
tenant; an asset not in the snapshot; an identity no asset has; a value the catalog could not read as a name);
and **Raw JSON**, a toggle that shows `resource.data` pretty-printed, with Copy. Copy results are announced in
the header's status line.

**Where it comes from.** The data worker answers two requests of its protocol (`pipeline/protocol.ts`):
`details` (a snapshot and a node id → `NodeDetails | null`, a lookup in the Graph it keeps; null for a bundle
the scene draws, which is no asset) and, for a jump link, search's `locate` without offers (a view, the day
drawn, its viewport and a node id → drawn as itself, `expand` with the view's flips that draw it, or not
drawn; section "Search"). Selecting asks for the details only, never for a Scene or a layout. The locate asks
the scene builder itself which Scene node shows the node (`report.selection.shownAs`, the chip it is collapsed
into), toggles that chip's flip and builds again until the node shows as itself
(`diagram/disclosure/openAround.ts`, about 18 ms per step on demo M), so the rule of what collapses where is
never restated; toggling a collapsed zone's flip always opens it. Without offers, no view but the one on
screen is built for a target it leaves out, and the request is independent of a search's: a jump link and a
search never cancel each other, in the page or in the worker.

**Jump links.** Every target, the parent and the project are jump links: a target already drawn is selected
(`actions.select`, history replaced); one hidden in a collapsed zone is located and the view is written with
the new flips and the selection in one step (`actions.setView`, a history entry, as a flip is); a target the
lens, a filter, the focus or the drill-in leaves out is selected anyway (its details show) and the status line
says it is not drawn in this view. A newer jump cancels the pending jump. If flips or the viewport change
while locating, the target is located again, with at most three attempts; if the view keeps changing, the
target is selected without applying stale flips. Closing the drawer, selecting another node, leaving the
page or changing the snapshot, day, lens, filters, focus, root or detail cancels the pending jump. The reveal
pan then brings the target into view once it is drawn. Drawer and search locates use the same viewport
selector (`state/pipeline.ts`, `locateViewport`): the drawn viewport, then the measured canvas, then the
fallback size.

**Keyboard and width.** Escape anywhere in the drawer and Close clear the selection and put focus back on the
node on the canvas (its card becomes the drawing's tab stop; the canvas itself when it is not drawn). The
handle on the left edge is a focusable window splitter (`role="separator"` with `aria-valuenow`): ← widens and
→ narrows by 10 px, Home and End go to 360 and 420 px, and a drag with the primary button (a mouse's left, a
pen's tip, a finger) moves the edge; the width is kept in the preferences (`drawerWidth`, clamped to 360–420
on read). A drag of either handle, this one or the phone's sheet's, follows the pointer that pressed alone (a
second finger's press on the handle starts nothing) and ends when that pointer lets go or its primary button
comes up, also while another is still held (a mouse's right button, which holds back the `pointerup`), as
letting go where its last move left the edge would end it: the width kept, the sheet settled or closed.

**What changed.** While the diagram is a timeline day compared with the day on screen before it (section
"Timeline diff overlay"), the drawer has a "What changed" section after the facts, from the data worker's
`changes` request (both days named, so the answer is the two days the canvas compares; `drawer/changes.ts`):
how the node itself changed ("Added since 2026-09-07.", "Removed …: it is not in this day’s data.", "Changed
…: its update time moved.", "Not changed itself …"), its `updateTime` on each day it exists, for a changed
asset the fields of `resource.data` that differ, each with its dotted path and short before → after values
(`fieldDiff.ts`: keys in code-point order, arrays index by index, at most 12 listed and the rest counted,
values cut at 60 characters, depth 16), and for a container what inside it, at any depth, was added, removed
or changed, each by label with a jump link (25 listed, the rest counted). A removed node's link selects it:
its ghost when the view draws one (the reveal pan brings it into view, and the drawer shows it as the earlier
day had it), otherwise the status line says the view draws no ghost of it. Without a diff there is no section.
The details are kept per day drawn as well (kept per snapshot and node alone, a step would show the day
before's details).

Tests: `drawer/fieldDiff.test.ts`, `drawer/changes.test.ts`, `drawer/WhatChanged.test.tsx`,
`drawer/console.test.ts`, `drawer/details.test.ts`, `drawer/ResizeHandle.test.tsx`,
`drawer/DetailsDrawer.test.tsx`, `diagram/camera.test.ts`, `diagram/pipeline/dataClient.test.ts`,
`dataHandler.test.ts` and `e2e/tests/drawer.spec.ts`.

## Search (`src/search/`)

The top bar's search box (a Fuse.js index; skill gcp-diagram-style §6 "Search hit" and §13) finds any node of
the view's snapshot, drawn or not, and lands on it: selected, glided to the centre of the canvas in 200 ms,
its selection ring pulsing; the collapsed zones around it flipped open first; or, when the view leaves it out,
an offer to change the view.

```
src/search/
  protocol.ts          the data worker's `search` and `locate` requests and answers (plain data)
  documents.ts         Graph → search documents (worker side): one per node but the organisation
  rank.ts              the index and the ranking: four tiers, one Fuse.js index per field over its distinct values,
                       weights, the boost, word starts, queries of several words, the typo cap
  service.ts           the worker side: one index per Graph, built on first use; icons resolved; request parsers
  locate.ts            where a node is in a view and what would show it (worker side; the scene builder decides)
  reveal.ts            the fallback decision table (pure)
  useSearchResults.ts  the page side: debounced queries that supersede each other; results grouped by kind
  useReveal.ts         choosing a result: select and jump, flips first, or the reveal dialog
  RevealDialog.tsx, ResultIcon.tsx, text.ts, search.module.css   the dialog, the result icons, the words
src/shell/topbar/SearchBox.tsx   the box (ui/Combobox); `/` focuses it
```

**The index lives in the data worker**, next to the Graph it keeps for the view's snapshot (`search` and
`locate` requests, `diagram/pipeline/protocol.ts`; a search supersedes the search before it and a chosen
result's locate (with offers) the one before it, in the page and in the worker, while the details drawer's
jump links ask `locate` without offers and are never superseded). It is built once per Graph (a `WeakMap`: a
new snapshot's Graph gets a new index), on the first request; the box sends an empty `search` when it gets
focus so the first query does not wait for it. One document per node, except the organisation, which is the
canvas: label, display name (the asset's `displayName`), last name segment, full name, IPs, domains, project
id, type name ("Compute Engine instance"), asset type, product and the names of the project and folders above
it, plus its kind (folder, project, network, container, resource), role, hidden flag, whether the default lens
draws its type, and its icon key. Answers carry the icons of their results, resolved in the worker like a
Scene's.

**Ranking** (`rank.ts`, whose header is the specification: the four tiers and their scores, `FUZZY_FIELDS`'
weights and thresholds, the typo caps, the boost and the tie-break order). Tiers never mix, so an exact id,
address, domain or project id always beats a fuzzy label; each field has its own Fuse index over its distinct
values, so a node ranks by its best field rather than by the product of several. Containers (folders,
projects, networks, clusters, instance groups, …) are boosted inside every tier, so "web" lists the instance
groups and the projects named "… web (…)" before the VMs and addresses that start with it. Ties go to nodes
drawn by default, then to the types the default lens (overview) draws, so a VM comes before its disk of the
same name, then `core` before `leaf`, then label and id. Indexing and queries run off the UI thread; each
query holds the data worker's queue (Scene requests wait behind it). The 120 ms debounce keeps typing from
queueing several. [docs/modes.md](../docs/modes.md#4-the-demo) lists the demo sizes.

**The box** (`SearchBox.tsx`, on `ui/Combobox`). `/` focuses it from anywhere but a text field (and not while
a modal dialog has made it inert); `aria-keyshortcuts="/"`. Typing lists at most 20 results, grouped by kind
in the order of each kind's best result (ARIA groups named by their heading), each with its icon (on the dark
theme Google's colour marks keep their light plate), its label, and type · project · what matched when it is
not the label (an IP, a domain, a folder above) · "hidden by default"; a polite status line says how many
nodes matched ("138 results, the first 20 listed"). ↑ ↓ move, Enter or a click chooses (Enter with no active
result chooses the first, the best: paste an address and press Enter), Escape closes the list and then clears
the text, a press on the focused box opens it again. **Only the current text's results can be chosen**: while
its answer is on its way (the debounce, then the worker), the previous text's results stay listed so the list
does not flicker, but `aria-busy`, greyed and never active or chosen (`ui/Combobox` `busy`), and the status
line is empty rather than the old count; ↓, ↑ and Enter pressed meanwhile apply to the new results when they
arrive, so typing over a text and pressing Enter at once lands on the new text's best result. The chosen
result's search text becomes the view's `highlight` (the hash; a link carries it; clearing the box removes
it), a full resource name included; while typing it is the box's own draft, for that highlight and that
snapshot. Choosing a result drops the draft, and so does any change of the highlight or of the snapshot, for
good (otherwise text typed before a choice would come back in every later view without a highlight;
`SearchBox.test.tsx` covers it). After a choice the list stays closed when focus comes back to the box (the
dialog closing) until the person types, presses a key in it or presses on it. Without a snapshot, or on a
snapshot that could not be loaded, the box is inert with a hint; away from the diagram it is not shown (the
view row is the diagram page's).

**Choosing a result** (`useReveal.ts`). The data worker locates the node in the view in the hash
(`locate.ts`): it builds the view with the node as its selection and reads `report.selection.shownAs`; while
that is a chip, it toggles the chip's flip (what a click on it does) and builds again, one level deeper each
time (`diagram/disclosure/openAround.ts`; the drawer's jump links ask the same locate without offers). Then
the decision table (`reveal.ts`):

| The node in the current view | What happens |
|---|---|
| drawn as itself | select it (drawer, pulse) and glide to it (`jumpTo`, 200 ms) |
| inside collapsed zones | switch to the view with their flips added (one history entry, the status line names the zones opened), then the same |
| outside the drill-in root or the focus | offer "Drill in to" its project (a project: its folder; "Show the whole organisation" at the top) |
| its type not in the lens | offer "Switch to the Everything lens", "Include the type …" |
| hidden by its type's role | offer "Include the type …", the Everything lens |
| hidden by its type's hidden-by-default rule | offer the Everything lens only (only `showHidden` draws those) |
| its type excluded by the filters | offer "Include the type …" (it also lifts the exclusion) |
| several of these | each offer combines the steps ("Drill in to … and switch to the Everything lens") |
| place or emptiness filters set | each offer again with "clear the filters" after it (alone when nothing else is the cause) |
| none of these, or no offer works | say why, change nothing |

Every offer is checked in the worker by building the view it proposes (flips included) and finding the node in
it; offers that would not show it are dropped. The reveal dialog (`ui/Dialog`, modal) says why in words and
lists the offers, focus on the first; choosing one switches to its view (one history entry) and lands on the
node; Close or Escape keeps the view, and focus goes back to the box. A locate answer is for the view it was
asked about: if the view changed meanwhile, before the answer or while the dialog was open (browser Back), the
node is located again in the view as it is now, and accepting an offer of the older view does that instead of
applying it. The status line's reveal message ("Opened … to show …") is emptied when the person types again.
The details drawer's own pan (`reveal` jumps) never replaces a centring jump to the same node that is still
waiting for its layout.

Tests: `rank.test.ts`, `reveal.test.ts`, `locate.test.ts`, `service.test.ts`, `text.test.ts`,
`shell/topbar/SearchBox.test.tsx`, `ui/Combobox.test.tsx`, `state/store.test.ts` and
`e2e/tests/search.spec.ts`.

**Known limits.** The search text in `highlight` is not painted on the canvas (only the chosen node is
selected). IPv6 ranges are not matched by containment. On XL a query holds the data worker for up to ~150 ms
and a locate (once per chosen result) for 0.9–1.7 s, measured in Node: the scene builder runs once per zone
opened and once per offer checked. The search-jump target of layout skill §7 is set on L; no target covers XL
yet.

## Timeline (`src/timeline/`)

The bar at the bottom of the diagram page (`pages/diagram/TimelineBar.tsx`) moves the view through the open
snapshot's last 35 days (AGENTS.md, Product rules; skill cai-ingestion §5;
[docs/timeline.md](../docs/timeline.md)). The view's day is its `tick` in the URL hash (`YYYY-MM-DD`; the
snapshot's own day is no tick; an extra tick's read time, `YYYY-MM-DDTHH:MM:SSZ`), so a timeline position is a
link like any view, and a hash with a tick opens on that day. On a desktop the bar is one row; on a tablet its
readout takes a line of its own below the slider; on a phone the slider spans the width, with the readout and
then the step and play buttons and the playback options below it (`PART_ORDER` in `TimelineBar.tsx`, which is
also the tab order; section "Layouts").

```
src/timeline/
  ticks.ts              the tick math: today@00:00Z and the 34 days before it (`today` passed in), the latest tick of
                        a live scope at "now"; labels in the viewer's local date
  cacheKey.ts           the tick cache key (scope, readTime, contentType, assetTypes?): never shared across scopes
  types.ts              TimelineInfo (what the data worker reports with each Scene: `history` or `live`)
  state.ts              the store's `timeline` slice
  model.ts              the bar's model (positions, marker states), `tickToDraw` (the scene key's tick), `stepTarget`
  scheduler.ts          which live days are read: the view's day, then its neighbours; two in flight; cancellation
  fetchTick.ts          one live day read through import/run.ts's live pull into the tick cache
  controller.ts         keeps the slice in step: the timeline from the Scene, the cached days, the debounced reads,
                        the idle prefetch, why days cannot be read
  playback.ts           playback's state machine; usePlayback.ts its timer and the interactions that stop it
  words.ts              the slider's value text, the markers' tooltips, the readout
  extraTicks.ts         the extra ticks: which stored exports and pulls are a timeline's, their ids, labels,
                        duplicates, the merge with the days, the clamp at "now", the store binding
  useTimelineController.ts  the controller over the page's IndexedDB connection, the sign-in and the import worker
  worker/               the data worker's side: source.ts (a snapshot's timeline and its days), replay.ts (a history's
                        day read as an export is), store.ts (the worker's read of the tick cache)
```

**Two kinds of timeline.** The data worker reports a snapshot's timeline with its first Scene
(`SceneSource.timeline`):

- **A stored history** (the demo organisations, generated in the data worker and kept; an imported bundle that
  carries one, read from IndexedDB): its 35 days end on the history's last day (`DemoHistory.today`, so the
  demo's timeline is the same on every day), which is the snapshot itself; every other day is replayed in the
  data worker (`snapshotAt` of `@gcportrait/demo-data`, then read as CAI NDJSON through `@gcportrait/ingest`
  with the snapshot's scope and a clock fixed at the day's read time, as `diagram/pipeline/demo.ts` reads the
  last day), so every day is available at once.
- **A live scope** (a live pull or an export without a history): the days end on the app's UTC day (the
  controller's clock, the one place "now" enters the timeline); the snapshot's own day is the snapshot; every
  other day is read from Cloud Asset Inventory at that day's 00:00 UTC (the latest day at "now": no
  `readTime`) by `POST /api/assets/stream` with `readTime` (the live pull, through the import worker), and
  stored in IndexedDB's `tickCache` under its cache key (`storage/tickCache.ts`). A latest day read at "now"
  counts as cached only while it is still the latest. Days before the window are dropped when a newer day of
  the scope is stored.

**What is drawn.** A day goes through the normal pipeline: the data worker builds its Graph (kept with the
last three days' for the loaded snapshot) and Scene, and the layout worker lays it out, whose memo leaves the
Scene's metadata out (`@gcportrait/layout`'s `layoutKey`), so two days whose Scenes differ only in their
read time share one Layout. The requests that follow a Scene (choices, details, search, locate) name
the day on screen, its `source.tick` (`selectDrawnDay` of `state/hooks.ts`), and the worker reads that day's
Graph, so a request made while the next day is being prepared still
answers for the day drawn; the page keeps their answers by day (the drawer's details, the pickers' choices,
the search results). The scene key's tick is the day that can be drawn now (`tickToDraw`): a history's day at
once; a live day once it is cached, the diagram on screen staying until then. The title block shows the day's
read time.

**Reads** (`controller.ts`, `scheduler.ts`). Never all 35: when the view rests on a live day that is not
cached for 300 ms, that day; at idle (`requestIdleCallback`), its two neighbours, the one in the direction the
view moved first; at most two reads in flight; a read the view moved away from (no longer the day or a
neighbour) is cancelled and keeps nothing, its write to the tick cache included (`fetchTick.ts`,
`storage/tickCache.ts`: the write takes the read's signal, writes nothing once it is aborted and takes back a
day whose abort lands while it is written, putting back what it replaced), so the cache holds only days a
timeline counted as read; a failed day is read again only when the view comes back to it or on "Try again";
nothing is read while the view stays where the page opened it on the snapshot's own day (a neighbour is a
whole read of the scope). Days are read only with a signed-in session whose permission check is ready for the
snapshot's scope; otherwise the readout says what is missing (a demo build reads nothing, having no sign-in;
cached days are still drawn). A read asks the tick cache for its day first: a day another tab of the browser
stored after the page
listed the cached days counts as read from there (`cached`), without a read from Google Cloud. While a live
timeline is adopted, the controller also listens to the tick cache's changes in the other tabs (section
"Storage schema", "Changes between tabs"), from before it lists the cached days: a day of its scope another
tab stored turns `cached` once the cache holds it under the day's own key and it counts (the listing's rule:
a "now" copy only while its day is the latest), and one another tab deleted turns not read, so the bar's
markers and playback, which plays cached days only, follow at once. A day this tab is reading is left to its
read; another scope's, read time's or type filter's entry is ignored; the latest change of a day wins over an
earlier one and over the listing; a dropped timeline (another snapshot, the page left) stops listening.

**The bar.** One marker per day under the slider (`ui/Slider`'s `marks`), its state shown by shape: a hollow
ring (not read yet), a filled dot (ready), a turning dashed ring (loading; it stands still with reduced
motion), a cross (failed), a larger ringed dot in the primary colour (on screen). The markers sit in a row
below the reach of the thumb's focus ring, which none of them meets; the slider's line keeps room for the row
under its track: on a phone or a tablet below the 44-pixel touch band, where a press on the row is a press on
the track too (a phone's bar takes that room from its top padding and the gap under the line, so it is no
taller for it), and on a desktop the slider and its dates sit above the bar's middle. The previous and next
buttons and `[`/`]` step one day (history entries); the slider moves the view in place (no history entry per
day). The readout (a polite status, quiet during playback, two lines at most with the rest in its tooltip)
says the day in the viewer's local date, "Reading 30 Sept: 2 pages · 900 assets · 1.2 MB · 0:03" while a
day loads (the short day, so the size and the time fit), Google's message and "Try again" when it failed, or
why it cannot be read; also that the snapshot was read after the timeline's last day (a clock
behind the snapshot), that a day or an extra tick could not be drawn (with the pipeline's reason), and that an
extra tick is no longer stored or is older than the timeline, instead of "Drawing …" for good (`words.ts`,
`words.test.ts`). **Playback** runs from the view's day (from the first day when on the last) through the
available days, one step per interval (0.5, 1 or 2 s; at least 2 s with reduced motion, and the thumb then
jumps instead of gliding), each step waiting for the day's diagram, in place in the history; it stops at the
last available day, on any press, key or wheel turn (but a press of the play button, or Enter or Space on it),
when a step cannot be drawn, or when the snapshot changes.

**Extra ticks** (exports and manual pulls appear as extra, labelled ticks;
[docs/timeline.md](../docs/timeline.md); `extraTicks.ts`). Every export (a file or a `gs://` object) and every
manual pull stored in this browser is an extra tick on the timeline of every other snapshot of its scope (same
kind and id; each demo organisation has its own, so an export of demo M is an extra tick of demo M only), on a
stored history and on a live scope alike. One read before the timeline's first day is not on the bar; a link
naming it says so:

- **Its id** is its read time to the second in UTC, `2026-10-05T14:30:00Z`: what the view's `tick` names in
  the hash (the model's `TickSchema` takes a day or such a time), so a link names it the same way in every
  browser that holds that export, and it never collides with a day. A link naming one this browser does not
  hold draws the snapshot itself and the readout says so.
- **Its place** is the instant it shows: among the days in time order (a day before an extra tick read at its
  00:00; an extra tick of today before a live scope's latest day, read at "now"); a read time later than "now"
  sits at "now" with a warning (never a tick in the future). Snapshots of the scope read in the same second
  are one tick, shown by the copy stored last (the data worker draws the same one: `pickExtra`); the open
  snapshot is never one of its own extra ticks, nor is a copy read at its own read time.
- **The bar** draws it as a diamond instead of a dot (hollow while ready when its read time is an estimate,
  its `readTimeSource`), named "export 2026-10-05 14:30" or "pull 2026-10-05 14:30 (estimated)" in the
  viewer's local time (to the second when two share a minute): in its tooltip (it takes the pointer; a press
  on it selects it), the slider's value text (with where its read time came from) and the readout ("export
  2026-10-05 14:30 · extra tick", the details in its tooltip). It is selected, stepped onto with `[` and `]`
  and drawn like a day (at once: it is stored here; nothing is read from Google Cloud, and reads of live days
  around it are cancelled), but playback goes through extra ticks only once "Play extras" is pressed (a toggle
  shown only when there are extra ticks, kept for the page's life like the speed).
- **Where they come from.** The snapshot library's binding (`bindExtraTicks`, run by `SnapshotLibraryProvider`
  with every listing) writes the open timeline's extra ticks into the slice's `extras` once the timeline is
  known; until then they are null, and a view whose tick names one is drawn as it asks and the bar waits, so a
  reload never flashes the snapshot itself. The data worker finds the stored snapshot by the tick's id each
  time a view names it (`findStoredExtra` in `snapshots/load.ts`, through the tick source), so a deleted one
  is never drawn from memory. The Snapshots page lists them per scope and deletes them (section "Snapshots",
  "Timelines by scope").

Tests: `ticks.test.ts`, `cacheKey.test.ts`, `scheduler.test.ts`, `playback.test.ts`, `model.test.ts`,
`controller.test.ts`, `storage/tickCacheChanges.test.ts`, `fetchTick.test.ts`, `storage/tickCache.test.ts`,
`worker/source.test.ts`, `worker/handler.test.ts`, `state/pipeline.test.ts`, `TimelineBar.test.tsx` and
`e2e/tests/timeline.spec.ts`; for extra ticks `extraTicks.test.ts`, `extraTicks.worker.test.ts`,
`extraTicks.bar.test.tsx` and `e2e/tests/extra-ticks.spec.ts`.

## Timeline diff overlay (`src/diagram/diff/`)

A timeline day drawn after another day of the same snapshot shows what changed between the two
([docs/timeline.md](../docs/timeline.md); skills gcp-diagram-style §6–§7 and cai-ingestion §5): **added**
nodes get an `accent.peer` outline, **removed** ones come back for that day as **ghosts** where they stood,
and **changed** ones (another `updateTime`) get a 6 px `accent.path` dot on their top-right corner. The legend
gains a row for each marker drawn, and the details drawer a "What changed" section (section "Details drawer").

```
src/diagram/diff/
  types.ts      DiffFrom (the day a Scene request asks to compare with), TickDiff (the answer: the diff, the ghosts
                with their reason, the zones they depend on as the earlier day drew them, the chips' counts),
                as they cross postMessage
  base.ts       which day a new diagram is compared with (the store's pipeline asks before each Scene request)
  tickDiff.ts   data worker: diffSnapshots of the two days, the ghosts put back into the drawn Scene, the chips' counts
  marks.ts      UI thread: which rects get which marker, the outline's path, the dot's centre
  words.ts      the legend rows, the names' additions, the ghosts' tooltips, the drawing's description
```

**Which two days.** The store's pipeline (`state/pipeline.ts`) asks `diffFrom` before each Scene request.
Another day of the snapshot on screen is compared with the day on screen, whatever moved the view (a step, the
slider, playback, Back), in either direction: stepping back, the earlier day is "compared with 2026-09-24"
rather than "since". The same day again (another lens, a filter, a flip, a resize) keeps the day the diagram
on screen was compared with, so the markers last as long as the day is on screen and the next day replaces
them ("for one tick"). Another snapshot, or nothing on screen (a link opened, a reload), is compared with
nothing: no markers. The day compared with is where the person came from, not part of the view, so it is not
in the hash: a shared link or a reload shows its day plain.

**The diff** is `diffSnapshots` of `@gcportrait/graph` between the two days' snapshots (by asset name,
independent of either's order, `updateTime` compared as an instant), worked out by the data worker with the
drawn day's Scene, where both days' Graphs are kept, and sent with it (`SceneAnswer.diff`). A day the timeline
no longer has is not compared.

**Ghosts.** A removed node is drawn as a ghost card at its last position for one tick, and with it a node
still there that the view no longer draws where it stood ("not drawn now"). The data worker builds the view on
the earlier day too and puts back into the drawn Scene what it drew and the drawn Scene does not, in its old
container, so the layout's deterministic sibling order (`@gcportrait/layout` `order.ts`) places each ghost
where it stood, nothing overlaps it, and lines route around it. What comes back, in which zone, what a ghost
holds and what a chip counts instead are `diff/tickDiff.ts`'s header, the one place those rules are written:
they are the worker's and change with it. A ghost is put into the Scene rather than overlaid at the rect the
previous Layout gave it, because the new Layout packs its container without it (that rect may hold something
else now) and the UI thread would else need the previous Layout and a rule for containers that moved.

**A ghost is no node.** The model keeps the ghosts apart (`DiagramModel.ghosts`), so nothing walks, focuses or
selects them: no `data-id`, no tab stop, no trace, no drill-in, no flip (`zonesByFlip`), not counted in "N of
M shown" (`rectsShown`). The pointer on a ghost is on the open zone it lies in (`data-in`, `nodeIdOf` in
painter.ts). Each is a named `graphics-symbol` with a `<title>` ("Removed since 2026-09-07: Cloud Storage
bucket: demo-data-1-scratch-1"; a product container's names its asset type, which the data worker takes from
the earlier day's Graph for a zone the drawn day's no longer holds: "Access Policy (Access Context Manager)
service perimeter: data_perimeter"): its body (fill and icon) at 50 %, its label and a "removed" ("not drawn
now") line in the readable grey of that body, an open zone's title placed as a zone's (a folder's top-left,
others centred) with its halo, and a dashed `accent.removed` outline (1.5 px, `5 3`) at full strength on a
`canvas` band 1 px wider on each side: at 50 % the red would reach only 2.22 : 1 (light) and 2.73 (dark) on
the canvas.
The ghost of a zone the earlier day drew as the view's overlay (a perimeter around its projects; the diff's
`earlier`) is drawn as an overlay: untinted, with its header mark and the overlay's dashed outline 4 px inside
the red one, and the legend's `secures` row names it.

**Chips.** What a collapsed zone holds is not drawn, so a chip counts the added, removed and changed nodes the
view would draw inside it, and a chip holding a change gets the changed dot, its accessible name saying how
many of each (", changes inside since 2026-09-07: 2 removed, 1 changed"). Which views those counts build is
`diff/tickDiff.ts`'s header, "Inside chips".

**Drawing** (`Drawing.tsx` with `marks.ts`; the sizes in `theme/styles.ts`): the ghosts after the nodes; then,
under the overlays and the lines, the added outlines (2 px `accent.peer` centred 8 px outside the node's
border, between 2 px `canvas` gaps, every gap drawn before any line, on the outermost node of an added subtree
only; clear of the selection ring, its gaps and the reach ring) and the changed dots (radius 3, centred on the
middle of the rounded top-right corner, on a `pathCasing` disc 1 px wider). The legend's rows ("added since
2026-09-07", "removed …", "changed …", the day at the viewer's offset as the title block's read time, so the
bar's local labels agree) appear only while their marker is drawn; the description adds "Changes since
2026-09-07: 2 added, 2 removed, 1 changed." (the whole diff). The names of added and changed nodes end ",
added since …" and ", changed since …". The markers are part of the day's drawing (they come with its Scene),
so the canvas, the export and the baselines show the same; hover and selection paint by attributes and
classes, and add only the traced lines they clone from the hidden prototypes.

**An extra tick compared with** is named by its label in every phrase ("added since export 2026-10-05 14:30"),
not by its date, which would read as the day itself: the page adds the label to the diff's `since` from
the timeline's extra ticks (`withExtraLabel` of `timeline/extraTicks.ts`; `DiagramPage.tsx`, the drawer's
"What changed").

**Contrast** (`theme/theme.test.ts`, "timeline markers on every fill", and the skill's §10): the light green
reaches 2.92 : 1 and the light red 2.78 on the project tint, so both lie on `canvas` (5.02 and 4.77); the
light amber reaches 1.13–1.93 on every fill and 3.13 on its `pathCasing` disc, which reaches 3.52 on the
project tint at worst; in dark every accent reaches 3 : 1 on every fill (4.50, the red on the nested tint, at
worst). A ghost's label reaches 4.5 : 1 on its body on every fill (card ghosts, zone ghosts on every parent,
card ghosts inside zone ghosts): 4.53 light and 4.57 dark at worst.

**Cost.** In Node, on the deletion day of the demo history (16 to 17 September, overview at `auto`): L
builds its Scene in 52 ms and the diff in 140 ms, XL in 371 ms and 1.1 s (the folder level, so both open views
are built). No budget covers the diff build alone; it is part of the timeline step on L that layout skill §7
targets. The data worker keeps the views it builds per Graph (`pipeline/sceneMemo.ts`): stepping on day by
day, the earlier day's view and open view were built the step before, so a step builds two Scenes instead of
four, and a step back to a day still kept builds none; the open view of a day drawn without a diff is built
right after its answer, and every open view is finished from the drawn view's preparation
(`sharedPreparation`, `prepareView` of `@gcportrait/graph`). A day is read through `@gcportrait/ingest` only
for the assets no day of its history held before (`pipeline/historyRead.ts`), and its Graph evaluates the
catalog's rules only for those (`BuildMemo` of `@gcportrait/graph`). The timeline step these keep fast is
measured, against layout skill §7's budget, in section "Performance".

Tests: `diff/base.test.ts`, `diff/tickDiff.test.ts`, `pipeline/dataHandler.test.ts`, `diff/marks.test.ts`,
`diff/drawing.test.tsx`, `diff/handler.test.ts`, `legend.test.ts`, `theme/theme.test.ts`, the baselines
(section "Visual baselines"), the drawer's tests (section "Details drawer") and `e2e/tests/diff.spec.ts`.

## Performance

The app-level targets and how to measure them are in the gcp-diagram-layout skill, §7
([.agents/skills/gcp-diagram-layout/SKILL.md](../.agents/skills/gcp-diagram-layout/SKILL.md)): a production
demo build (`VITE_DEMO=1 vite build`) in Chromium through Playwright and CDP at 1280 × 800. Measured that way:
the first diagram of demo S, M, L and XL at the collapsed default in 0.22, 0.28, 0.62 and 2.6 s (medians;
targets: L under 3 s, XL under 8 s); on L a lens switch (median 38 ms), a chip expanded (70–98 ms), a search
hit landed (7–117 ms) and every timeline step under 300 ms (113–194 ms onto a day not built yet; 163–188 ms on
the first step back from the snapshot's own day, on a fresh page, and 197–205 ms after the page has rested two
minutes; 30–32 ms onto a day already kept); on XL a step back onto a day not built yet 0.71–0.75 s, and
44–80 ms onto one already kept; no long task while panning or zooming the collapsed
defaults; the heap back within 20 % of a warm baseline after 100 switches on M (+13.9 %, the data worker +7.1
%) and 60 on L (+4.9 %). What keeps it there:

- **A day read from its difference** (`pipeline/historyRead.ts`): a day of a history is its base with the
  mutations replayed, so an asset no mutation touched is the same object on every day, and every history asset
  is read through `@gcportrait/ingest` once, the first time a day holds it. A day that differs little from the
  day read before is read from that difference: only the lines of the assets not read before go through
  ingest, and the day's counts are worked out as ingest works them out. The snapshot is deep-equal to ingest's
  read of the day's whole NDJSON (`historyRead.test.ts`, every day of demo S and M), its unchanged assets are
  the very objects the days before hold, and on L a day reads in a few milliseconds where a whole read takes
  about 75 ms.
- **The Graph builder's memo** (`BuildMemo` of `@gcportrait/graph`, one per data worker in
  `pipeline/dataHandler.ts`): what the builder worked out per asset object (its node and what its catalog
  rules produce) is reused while the catalog and the project index stay the same, so a day's Graph evaluates
  the rules only for the assets the day changed: about 50 ms on L instead of about 95.
- **The data worker answers for the day named**: every request that follows a Scene names the day on
  screen, so nothing reads whichever day the worker built last (section "Timeline"), and the page keeps their
  answers by day.
- **Scenes kept per Graph** (`pipeline/sceneMemo.ts`): a timeline step builds only the views of the day it
  moves to (section "Timeline diff overlay", "Cost").
- **A view prepared once** (`sharedPreparation` in `pipeline/sceneMemo.ts`, `prepareView` and
  `buildPreparedScene` of `@gcportrait/graph`): the last view's lens, focus, root, filters and scene tree are
  kept, so the open view a step's diff needs, a chip expanded or another detail level costs only the finish:
  on L 5 ms instead of 20, on XL 26 ms instead of 170 (Node).
- **The open view built after the answer** (`pipeline/dataHandler.ts`, `WARM_AFTER_MS`): a Scene drawn without
  a diff on a stored history's timeline, with a chip, has its open view built next unless a request is
  waiting, so the first step back from the snapshot's own day builds only the new day's views, like every
  later step. It reads no data and builds no other day.
- **Tick labels' formatters made once** (`timeline/ticks.ts`): one `Intl.DateTimeFormat` per form, locale and
  time zone instead of two per day of the bar per render (about 12 ms of the UI thread per timeline step on
  L); the viewer's own locale and zone are looked up once per render, so a zone changed while the page is open
  shows at once.
- **"Try the demo" in a worker of its own** (`pipeline/demoRole.ts`), started for the job and ended with it:
  an XL job (generate, read and compress its 35 days, about 4 s) never holds back the data worker's Scene
  requests, and its memory goes with the worker.
- **Large answers as transferred bytes** (`pipeline/transfer.ts`): a Scene answer or Layout of more than 1 000
  rects crosses as JSON bytes with its buffer transferred; reading XL at `projects` (an 11.4 MB Layout) takes
  the page about 42 ms as a structured clone and about 28 ms decoded. The defaults are far below the threshold
  and are structured-cloned.
- **Traced lines on demand** (`painter.ts`): the interactive drawing holds one hidden traced line per relation
  kind, which the painter clones for the lines it traces, instead of a hidden copy of every line, which saves
  27–33 % of the SVG elements on L and XL (1 913 and 5 216 elements at the default; 22 166 on L at `all`).
- **No re-render storms**: a profile of a development build (React's commit hook) counts 8 to 10 commits per
  tick switch, chip expanded or lens switch on demo M, the drawing rendered once each, and none at all for a
  hover, a pan or a zoom.
- **The data tables load once**: only the data worker fetches the compiled catalog and the icon table, once
  for its life; the demo, snapshot and import workers load neither.

Known limits: opening a demo organisation keeps what its first Graph worked out per asset for the next day (on
XL 15 MB more in the data worker at opening, and 120 MB less once three days are kept); an imported bundle's
own snapshot comes from IndexedDB, not through `historyRead.ts`, so the first step back on its timeline reads
the day whole and builds its Graph afresh (the steps after it are read from their differences); L at `all` (22
000 drawn SVG elements) pans at about 29 frames a second, bound by painting, without a long task.

## Export (`src/export/`)

The top bar's Export menu (skill gcp-diagram-style §7–§8, [docs/export.md](../docs/export.md)) saves the
diagram on screen as an SVG, a PNG or a draw.io file (`.drawio`, which diagrams.net and draw.io open as an
editable diagram) or copies the PNG to the clipboard. Its options: the whole diagram or the current viewport;
the light or the dark theme (it follows the app until the person picks one); PNG at 2× or 3×; embedded fonts
for the SVG. Files are named `gcportrait_<scope>_<lens>_<readTime>.<ext>`: the canvas's root label, the lens
id and the read time at UTC in ISO-8601 basic format, each reduced to `A–Z a–z 0–9 . -`, for example
`gcportrait_example.com_overview_20261008T000000Z.png`. While nothing is drawn the button is inert
(`aria-disabled`, still focusable).

```
src/export/
  source.ts         ExportSource: the drawn model, the viewer's UTC offset, the canvas's visible area (its size
                    through the inverse of the camera the canvas publishes) and the view's key; the diagram page
                    publishes it in the diagram session
  render.tsx        draws DiagramSvg (the component of the baselines and of the headless renderer) with React into
                    a detached element, in the export's theme, legend and title block always on
  serialize.ts      clones that live <svg> into a standalone file (below)
  fonts.ts          the embedded faces: Roboto 400/500/700 and Roboto Mono 400, latin woff2 of the fontsource
                    packages, as data: URIs, fetched from the app's origin once per session
  pngGeometry.ts    pure PNG geometry shared with the server through the headless entry point
  raster.ts         browser geometry adapter, the raster frame and font sentinels, drawing on a canvas
  deliver.ts        the temporary download link, and the clipboard (ClipboardItem)
  exportDiagram.ts  the flow: crop, prepare, serialise, rasterise, name; exportDrawioFile loads drawio/ on demand
  drawio/           the draw.io translator (below): xml.ts (a DOM-free XML reader and writer), svg.ts (presentation
                    attributes, colours, transforms, path data), label.ts (text lines as HTML labels at their
                    baselines), translate.ts (the walk, the cells, the viewport crop), model.ts (the mxfile, its
                    compression), index.ts (svgToDrawio, readDrawioFile)
src/shell/topbar/ExportMenu.tsx   the menu button and its menu (a top-bar slot)
```

**A new drawing, not a recoloured canvas.** The canvas is drawn in the app's theme, may hide the legend and
the title block (a setting), and carries the interactive scaffolding. Re-colouring it by value is ambiguous
(light `ink` is also the project stroke, the card stroke and the path casing; in dark each has its own token),
so each export renders the view once more, off-screen, in the chosen theme with both overlays (`DiagramSvg`,
the static drawing the baselines carry), and clones that `<svg>`. That drawing is standalone by construction:
every colour is an attribute of its theme (no `var()`, no `style`), it has none of the canvas's interactive
scaffolding, and its `<title>` (scope, lens) and `<desc>` (scope, lens, read time, "Drawn with gcportrait")
are `documentText`'s, the same wording the canvas carries, with no affiliation sentence; `serialize.test.tsx`
holds it to that in both themes. The serialiser refuses a drawing without the title block, takes the frame and
the overlay boxes from the plan the drawing was drawn from (planned once), and adds the crop and the encodings
below. The title block is the canvas's own (the export adds no affiliation line). Two encodings keep older
editors (Illustrator, Inkscape 0.92) drawing what browsers draw, without changing the picture: `xlink:href`
beside `href` on every `<use>`, and each haloed zone title written as a stroke-only halo copy under a
fill-only label instead of relying on `paint-order`. Icons stay inline and unaltered. Apart from these
encodings the file is the renderer's own drawing of the view: resvg draws it and the renderer's baseline of
the same view alike but for at most 0.05 % of the pixels (pixelmatch, `e2e/tests/export.spec.ts`).

**Current viewport.** The visible area of the canvas, intersected with the layout's bounds (nothing in view is
an error with a hint). The content keeps its coordinates and is clipped to the area (`clip-path`); the title
block moves into a band above it and the legend into a band below it, 24 px away, so the title block and the
legend are in the file even when they are scrolled away.

**PNG.** (frame + 2 × 24 px) × scale, rounded up; the margin is in drawing units (48 px at 2×), filled with
the theme's canvas colour, as is the canvas behind the image. A canvas is capped at 16 384 px a side and 2^27
px in all (`CANVAS_LIMITS`); a larger export is drawn at the largest two-decimal scale that fits and the
status line says so. The pure `pngGeometry.ts` core also serves the server through the headless entry point,
without importing browser font URLs. Its defaults and limits come from `@gcportrait/model`'s zod-free
vocabulary; its options and result types are inferred from the model's schemas. Both adapters use the same
whole-pixel rounding, allowing for floating-point noise at an integer boundary without producing zero pixels.
If no positive two-decimal capped scale fits, the export reports the refusal and suggests SVG, draw.io or a
narrower view. An explicit positive scale whose inverse frame cannot be represented is refused too.
The SVG goes into an `<img>` as a `data:` URL (the production CSP allows `img-src data:`;
an SVG image from one does not taint the canvas). An SVG drawn as an image cannot use the page's fonts, so the
PNG's SVG always embeds the Roboto faces; Chromium loads those asynchronously inside the image, after
`decode()` resolves, and paints text invisible until then. The PNG's SVG therefore carries one sentinel glyph
per embedded face in its top margin band; a small canvas draws only that band until every sentinel shows (at
most 5 s), then the image is drawn once and the band is painted over with the background.

**draw.io.** `exportDrawioFile(source, settings, version?)` writes the diagram as a `.drawio` file
(`application/vnd.jgraph.mxfile`) that diagrams.net opens as an editable diagram looking like the PNG. It
renders the export's drawing as the SVG export does (`render.tsx`), serialises it and translates that markup
into draw.io's cells (`drawio/translate.ts`), so the file is the picture by construction: every rect, circle,
line, path, text and icon of the drawing becomes a cell at the same place and size, with the same colours,
stroke widths, dashes (`fixDash`), corner radii (`arcSize` = 2 × `rx`, as mxGraph halves it), fonts and lines.
The structure comes from markers the diagram's components write on their groups, on the canvas too:
`data-kind="zone"` and `"node"` with `data-id`, a short index `data-n` (the rect's place in the layout) and
`data-parent` (the index of the zone it lies in; zones become nested containers with their title as their own
label, nodes groups of body, icon and one text cell inside their zone), `data-ends="12 34"` on each line's
path (the indices of the nodes at the drawn path's start and end; edges get their waypoints and their ends
fixed at the arrowheads' tips), and `data-kind="title"` and `"legend"`. Naming the ends by index keeps the
markers small: they add 4 to 7 % to an SVG, where the asset names repeated on every line would add up to a
third. Three layers keep the paint order: "Diagram", "Connections", "Title and legend". Text is HTML labels
with each run of another weight, colour or face as a span, placed so each baseline lands where the SVG's is
(label.ts says how); a zone's title and a badge's text are their cell's own label, placed by whole-pixel
`spacingLeft` and `spacingTop` (draw.io drops a fraction) on the pixel the exact place rounds to; icons are
images of their own SVG (`data:image/svg+xml,<base64>`, draw.io's form in a style); the page's background is
the theme's canvas, and `adaptiveColors="none"` keeps diagrams.net's dark interface from recolouring the
diagram. The fonts are Roboto and Roboto Mono, named with Google Fonts' stylesheet (`fontSource`), which
diagrams.net loads. A "current viewport" file keeps the cells that meet the visible area, whole, with the
crop's corner at 0,0; as a zone kept whole can reach beyond the crop, the title block goes above and the
legend below everything kept, never over it. The diagram is compressed as diagrams.net saves it (fflate's raw
deflate of the URI-encoded XML, base64): the same bytes in the browser and in Node. The page's id is a hash of
its name, the read time, the theme and the view drawn (the export source's `view`, the pipeline's scene key,
which the render library computes alike with `drawnViewKey`), so the files of several views, themes and days
keep different page ids when their pages are copied into one diagram. The translator and fflate are a chunk of
their own, loaded when the draw.io file is asked for, never part of the first paint; the render library draws
the same file from the static render (`renderDiagramSvg`) through `headless.ts`, and `exportDiagram.test.ts`
checks the two are byte for byte the same. Tests: `drawio/translate.test.ts` and `drawio/demo.test.ts`.

**Clipboard.** `navigator.clipboard.write` with a `ClipboardItem` created at once around the pending PNG, so
the click still counts as the user's gesture while the PNG is drawn; a browser without image support gets a
plain message ("Use Download PNG instead"), a refusal says so.

**The menu.** The app's MenuButton and Menu (`src/ui/`), its open state the store's one popup at a time:
options as `menuitemradio` / `menuitemcheckbox` items in labelled groups (Area, Theme, PNG resolution, SVG
file), then the four `menuitem` actions (Download SVG, Download PNG, Download draw.io (.drawio), Copy PNG; the
area and the theme apply to the three files, and the draw.io file's `agent` carries the instance's version,
which the top bar passes from GET /api/config). Options keep the menu open; an action closes it, returns focus
to the button and reports in a status line (a live region kept in the DOM while empty). Keyboard: Enter, Space
or ↓ opens on the area chosen, ↑ on the last item; ↑ ↓ Home End and type-ahead move (roving tab index); Escape
closes; Tab leaves. The check marks have empty alternative text, so an item's name is its label and its state
is `aria-checked`.

Tests: the unit tests next to each module, `e2e/tests/export.spec.ts`, and `e2e/tests/drawio.spec.ts`, which
draws the downloaded draw.io file with maxGraph and holds it to the SVG export (within the fidelity limits of
frontend/AGENTS.md, Exports, and the gcp-diagram-style skill §8).
