<!-- SPDX-License-Identifier: Apache-2.0 -->

# AGENTS.md: the frontend

These rules add to the root AGENTS.md, which applies here too.

## Phones, tablets and desktops

- **The layouts fold the same components, never copies of them.**
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
    it comes down) and back, and a directed camera move keeps its node clear of everything floating over the
    canvas (the drawer, a sheet, the disclosure bar, its notice), while the overview fit at rest frames the
    whole canvas; what floats over the
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
    Connect page's permission reference), is a list on a phone, each command as wide as the page; and a table
    whose row a reader would have to scroll sideways to read (the Snapshots page's) is a list of cards on a
    phone, one per row, its cells as labelled lines.

- Below the desktop's breakpoint `--control-height` grows to `--touch-target`, implementing the shared
  target-size contract in [AGENTS.md](../AGENTS.md), "Style and accessibility", which also holds the safe-area
  rule.

- **Breakpoints in rem, from one place.** A stylesheet asks for a width only with the layouts' media queries,
  written in rem as `MEDIA` in `frontend/src/ui/screen.ts` has them (media queries cannot read custom
  properties; `--breakpoint-tablet` and `--breakpoint-desktop` in `tokens.css` name the widths), and for a
  part's own room only with `CONTAINER`'s container queries, in rem too (a phone's canvas too short for the
  disclosure bar above the half-height sheet, a phone's diagram area too short for the timeline bar and the
  sheet together); `frontend/src/ui/screen.test.ts` refuses any other, so the layouts follow the reader's
  text size and every part folds at the same widths.

- **The touch model.** The canvas reads a finger
  from its pointer events (`pointerType` `touch`, `frontend/src/diagram/touch.ts`) and leaves a mouse and a
  pen their own input (their drag and the wheel, the click, the double-click that drills in, the right-click
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

- A node's menu and drill-in have no touch gesture, because a long press is where people look for what a
  thing is and a double tap where they look for zoom; the details drawer carries both.

- `frontend/src/shell/parity.test.tsx` fails on a control the desktop offers and a narrower width lacks
  (in the DOM and the accessibility tree), and `pnpm --filter @gcportrait/frontend mobile` runs the touch
  spec and measures the phone and tablet layouts in a browser, including that every control is in sight when
  focused and can be tapped.

[README.md](README.md), "Layouts (`src/ui/screen.ts`)" and "Diagram renderer", describe the folds and
gestures. The widths and feature-parity contract are in [AGENTS.md](../AGENTS.md), "Product rules".

## Diagram and themes

- **Light and dark themes** for the app and the diagrams, following the system setting with a manual override
  (`system`, `light`, `dark`) stored in IndexedDB and applied before the first paint, so no page flashes in
  the wrong theme.

- **Google's colour semantics win; the values are adjusted.** Where Google's architecture-diagram conventions
  and WCAG conflict, what a tint means stays and its value changes until contrast passes, so the diagrams read
  as Google Cloud-style and stay readable.

- **CSS modules with Material-3-style design tokens** (colour roles, type scale, elevation) and the app's own
  small, headless, accessible primitives for menus, dialogs and sliders; no component library.

- **The selection trace**: a click on a resource keeps its path to the root and its connections traced, in a
  bolder colour, until the selection changes; "Open in Cloud Console" is offered in the details drawer and
  opens the console only when the person chooses it. A highlight change only changes attributes and never
  lays out again.

- Contrast tests cover every palette pair (`frontend/src/diagram/theme/theme.test.ts`). The
  gcp-diagram-style skill holds both palettes, the tokens, the contrast pairs and the fact-check list; the
  shared accessibility contract is in [AGENTS.md](../AGENTS.md), "Style and accessibility".

## Snapshots

- **A large snapshot is drawn once the person confirms it.** Before the app draws a snapshot of more than
  `LARGE_SNAPSHOT_ASSETS` (10 000, `@gcportrait/model`) assets it asks in an alert dialog ("Draw it anyway",
  "Cancel", and "Do not ask again in this session", kept in the tab's sessionStorage only), because drawing
  that many at once is slow and heavy on memory; every way that draws a snapshot goes through the one guard
  (`frontend/src/snapshots/LargeSnapshotGuard.tsx`; [docs/modes.md](../docs/modes.md), "At a glance"), a
  snapshot the person chose to draw is not asked about again in the tab.
## Exports

- **The Export menu** saves the current view, the whole diagram or the visible part, in either theme, and
  copies PNG to the clipboard. Its button is the app row's last control, at its right edge, filled in the
  primary colour (4.5 : 1 in both themes); `e2e/tests/shell.spec.ts` holds its place. The shared formats, PNG
  behaviour, SVG contents and title block follow [AGENTS.md](../AGENTS.md), "Exports and the render API".

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
  tests/drawio.spec.ts`, maxGraph in Chromium) holds it to the SVG, within every limit of the
  gcp-diagram-style skill (§8). [README.md](README.md), "Export (`src/export/`)", describes the translator.

## The source link

- **The running app links its source.** The shell footer's "Source (Apache-2.0)" link stays on every route,
  next to the non-affiliation notice, so the people who use an instance can see where its source is and under
  which licence; Apache's licence asks for no such link either, but a reader should find the source. Its URL
  follows [AGENTS.md](../AGENTS.md), "Product rules".

## Code

- **The frontend** is React 19 and Vite:
  - IndexedDB, through a small versioned wrapper with a memory fallback, holds preferences, snapshots,
    saved views and the timeline's day cache;
  - the diagram is SVG drawn by React; the canvas pans and zooms it itself within `scaleExtent [0.05, 200]`,
    reading a mouse's and a pen's drag and the wheel from their pointer and wheel events and a finger's
    gestures from its pointer events; double-click is reserved for drill-in; the level of detail follows the
    effective scale;
  - search is Fuse.js over the graph's node index;
  - the work a view sends to the renderer is proportional to the view, not to the organisation.

The worker and zod boundaries follow [AGENTS.md](../AGENTS.md), "Architecture and code"; the view hash and
token storage follow its "Product rules" and "Security and privacy".

## Bundle budgets

- **The bundle budgets** (`pnpm size`, after `pnpm build`), gzipped, fonts and the fetched JSON data tables
  excluded: the UI thread 350 kB (the entry script, its static imports, the CSS `index.html` links, and a lazy
  chunk only when the first paint of `/diagram` needs it), the workers 400 kB together (every worker script
  and every chunk a worker loads). A file nothing reaches counts against the UI budget, so a gap in the
  classification only makes the check stricter. zod on the UI thread fails the check whatever the sizes. The
  UI thread is kept at or under 320 kB to leave room. Two budgets keep work that runs in workers, after the
  page is up, from competing with the first paint, while the workers still have a ceiling.

## Commands

| Goal | Command |
|---|---|
| The app on phones and tablets: sideways scrolling and a page that scrolls by itself or is laid out wider than the window (every menu and panel of the View and More sheets opened, a live instance signed in, a snapshot stored), text squeezed into a narrow column, the top bar's items, the timeline bar's parts, the drawer within the canvas, 44-pixel targets, every control in sight when focused and tappable, the canvas's room, axe, at 320 to 430 and 820 CSS pixels in both themes and on phones turned sideways; and the canvas's gestures by finger at 390 × 844 (`e2e/tests/touch.spec.ts`; Phones, tablets and desktops; part of `pnpm e2e`) | `pnpm --filter @gcportrait/frontend mobile` |
| Regenerate the renderer's SVG baselines (deliberately; look at the changed files) | `pnpm --filter @gcportrait/frontend test src/diagram/baselines.test.tsx -u` (the file before `-u`) |
