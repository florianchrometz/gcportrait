<!-- SPDX-License-Identifier: MIT -->

# Timeline review, 2026-10-10

A record of the build, written on 2026-10-10 and not kept up to date since (on 2026-10-12 the build's
task and phase ids gave way to plain names and dates); what is still open is in
[../backlog.md](../backlog.md). It is the review of the timeline once the timeline bar, the diff overlay and extra
ticks were built: the checks with their real output, a memory and leak check across tick switches with the layout
memo's hit rate, screenshots of the timeline bar, a compared ("diff") tick and the drawer's "What changed" in both
themes, and every finding and open question the reports and reviews of those three features left, deduplicated. The
user guide for the feature is [../timeline.md](../timeline.md); the earlier reviews of the same day are
[2026-10-10-app-walkthrough.md](2026-10-10-app-walkthrough.md) and
[2026-10-10-self-hosting-smoke-test.md](2026-10-10-self-hosting-smoke-test.md).

| | |
|---|---|
| Date | 2026-10-10 |
| Tree | `main` at `924a2b7` plus the uncommitted timeline work (the timeline bar, the diff overlay, extra ticks) and this review's changes (section 4.2) |
| App under test | the e2e suite on the Vite dev servers; the memory check and the screenshots on a **production demo build** (`VITE_DEMO=1 vite build`) served by a small static server that adds `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`, so that `performance.measureUserAgentSpecificMemory()` is available (the app needs nothing from those headers) |
| Browser | Chromium through Playwright 1.64 at 1440 × 900, time zone UTC, locale en-GB; the memory check in the full Chromium build in new headless mode (the headless shell answers `measureUserAgentSpecificMemory()` with "not available") |
| Machine | Apple M1, Node 22.23.2 |
| Data | the synthetic demo organisations S and M with their 35-day history (4 September to 8 October 2026); no real data |
| Reviewer | the review agent; every screenshot listed below was opened and looked at whole |

## 1. Commands and their results

| Command | Result |
|---|---|
| `pnpm check` | **green** in 2 min 46 s: `format:check` clean; `lint` and `typecheck` clean; `test` 273 files, **7 012 tests** passed (the self-hosting smoke test earlier that day: 6 753); `catalog:check` OK (632 of 641 official types, 1 387 rules, 0 without a fixture, 265 types without a console template); `provenance` OK (2 235 files, 1 153 SPDX headers); `licenses` OK (365 packages, `THIRD_PARTY.md` current) |
| `pnpm build` | **green** (4.6 s); Vite's usual warning that `index-*.js` is over 500 kB minified (671 kB raw) |
| `pnpm size` | **green**: UI thread 224.40 of 350 kB (64.1 %; the smoke test: 208.5), workers 194.00 of 400 kB (48.5 %; the smoke test: 188.2), gzipped (ADR 0029) |
| `pnpm e2e` | **green**: 192 passed in 3.7 min (157 in demo mode, 35 in normal mode), first run, no retries; a second full run after this review's parser fix (section 6 says why it ran) also 192 of 192 in 3.7 min |
| `pnpm e2e tests/timeline.spec.ts tests/diff.spec.ts tests/extra-ticks.spec.ts` | green: 18 passed in 32.5 s |
| `pnpm --filter @gcportrait/frontend test` | green: 135 files, 1 277 tests, after this review's fix in `import/sidecar.ts` |
| `pnpm format`, `pnpm provenance` | no file changed; provenance OK (2 254 files, 1 153 SPDX headers) after this review's files were added |
| `pnpm check`, again on the review's final tree | **green** in 2 min 49 s: the same 273 files and 7 012 tests, format, lint, typecheck, catalog, provenance and licences OK |

The first `pnpm check`, `pnpm build`, `pnpm size` and the first `pnpm e2e` ran before this review's own edits (docs, one
parser fix and its test); the rows after them ran afterwards.

## 2. Memory and leak check across tick switches

**Method** (`out/timeline-review/memory.mjs`, git-ignored, not part of the suite). The production demo build opens
`#snapshot=demo:M` (overview lens, `auto`, which settles at `folders`: 38 of 369 shown) on its own day, 8 October.
Each *switch* is a key press (`[` or `]`) followed by a wait until the bar's current marker is on the new day and
the diagram is marked ready; every step is a real tick change with its diff against the day before. One round of
100 switches is a sweep of 34 days back to 4 September and 34 forward again (68), then 32 switches between 7 and 8
October, ending on 8 October. Before each measurement: 1.5 s of rest, then `gc()` three times in the page and in
both workers (Chromium started with `--js-flags=--expose-gc`), then `performance.measureUserAgentSpecificMemory()`
(eager, so it measures at once) for the page and its dedicated workers together, plus CDP `Performance.getMetrics`
(the UI thread's used JS heap) and `Memory.getDOMCounters`. The two workers run the same script, so the API's
breakdown names both by the same URL; the larger entry is taken to be the data worker (it holds the history and the
Graphs; the layout worker holds Layouts).

| Point (always back on 8 October) | Total | UI thread | Data worker | Layout worker | DOM nodes / listeners |
|---|---|---|---|---|---|
| after opening (cold baseline) | 16.55 MB | 5.30 MB | 8.77 MB | 1.64 MB | 1 652 / 224 |
| after a warm-up of 8 switches (warm baseline) | 22.84 MB | 6.69 MB | 13.40 MB | 1.90 MB | 1 698 / 224 |
| after 100 switches | 24.89 MB | 7.79 MB | 13.70 MB | 2.43 MB | 1 878 / 224 |
| after 200 switches | 25.38 MB | 8.14 MB | 13.76 MB | 2.45 MB | 1 878 / 224 |
| after 300 switches | 25.57 MB | 8.24 MB | 13.80 MB | 2.46 MB | 1 878 / 224 |
| after 400 switches | 25.61 MB | 8.31 MB | 13.80 MB | 2.47 MB | 1 878 / 224 |

(Totals include about 0.7–1.0 MB the API does not attribute. The rows come from two runs, `memory-warm.json` and
`memory-long.json` in `out/timeline-review/`, which agree within 0.1 MB; a run without the warm-up, `memory-cold.json`,
measured 16.55 MB after opening and 24.77 MB after 100 switches, and a last run after the scripts moved,
`memory-check.json`, 22.89 MB warm and 24.83 MB after 100 switches.)

**Result.**

- **Against the page as first opened, the 20 % criterion is not met:** 24.77 MB after 100 switches is 49.7 % above
  the cold baseline of 16.55 MB.
- **Against a warm baseline it is met:** 24.89 MB is 9.0 % above the 22.84 MB measured after 8 switches. In the
  400-switch run the heap ends 12.6 % above that run's warm baseline (25.61 against 22.75 MB).
- **There is no leak.** Each further 100 switches adds less: +0.47, +0.19, +0.04 MB. DOM nodes and listeners stay at
  the same count from 100 to 400 switches. No console error or warning appeared in any run.

The step from cold to warm is what the timeline keeps by design, all of it bounded:

- the data worker keeps the Graphs of the last three days drawn (the timeline bar's design): +4.6 MB within the first 8 switches, and
  flat after that;
- the layout worker's memo keeps the last eight Layouts (`MEMO_CAPACITY`): +0.8 MB;
- the UI thread grows by compiled code. A CDP heap snapshot diff of the UI thread
  (`out/timeline-review/heapdiff.mjs`) between the warm baseline and 100 switches later: 11.37 → 12.89 MB of self
  sizes, of which **1.16 MB is V8 code**. The rest is the browser's own bounded buffers (performance entries,
  navigation history entries, the debugger's network records). No application object type is among the growing
  entries.

The DOM holds 180 nodes more than at the warm baseline (226 more than at opening), the same count from 100 to 400
switches: bounded, not a growth.

**Layout memo hit rate.** It is counted from the layout worker's `result` messages (`cached: true`) by an init
script that wraps `window.Worker`:

| Phase | Layout results | From the memo | Hit rate |
|---|---|---|---|
| first 100 switches after opening | 100 | 49 | 49 % |
| ↳ the 34-day sweep there and back (68) | 68 | 17 | 25 % |
| ↳ alternating 7 ↔ 8 October (32) | 32 | 32 | 100 % |
| each later round of 100 (rounds 2 to 4) | 100 | 56 | 56 % |
| ↳ the sweep / the alternation | 68 / 32 | 24 / 32 | 35 % / 100 % |
| all 400 switches after the warm-up | 400 | 220 | 55 % |

Every switch asks the data worker for a new Scene (409 Scenes for 409 switches). The memo answers whenever the
Scene repeats:

- **Alternation:** each day compared with the other, the same pair of Scenes from the second pair on.
- **Sweep:** a day whose view looks the same as one still in the memo (no visible change at `folders` and no
  marker). The memo's key leaves the Scene's metadata (`readTime` among it) out, so such days share a Layout (by the timeline bar's design).

A sweep day that *has* changes cannot hit: its Scene carries its ghosts and markers, and stepping back compares it
with a different day than stepping forward.

**Switch time** (key press to the new day's diagram ready, demo M overview at `folders`, production build): median
88 ms, 90th percentile 91 ms, slowest 110–119 ms, over 100 to 400 switches per run.

## 3. Screenshots

All under `e2e/.scratch/timeline-review/` (git-ignored), from the production demo build at 1440 × 900, taken by
`out/timeline-review/screens.mjs`; axe (all non-experimental rules) ran on the page at each step: **0 violations
in all eight checks** (four steps × two themes). No console error or warning appeared.

| File | What it shows (light and dark alike unless noted) |
|---|---|
| `bar-own-day-{light,dark}.png` | The bar on demo M's own day: "Timeline", the previous/play/next buttons (next inert with a dashed outline), "4 Sept" and "8 Oct" at the ends, the slider at the end, 35 markers under the track (34 filled dots: ready; the last a larger ringed dot in the primary colour: on screen), the readout "Thursday, 8 October 2026 · the snapshot", Speed 0.5 s / ✓ 1 s / 2 s. It fits on one row in both themes. |
| `bar-2026-09-17-{light,dark}.png`, `page-2026-09-17-{light,dark}.png` | 17 September, reached by `]` from the 16th (overview at `folders`): the decommissioned "Reporting" project, deleted that day, is a ghost chip with a dashed red outline in its old place in Workloads. Chips with changes inside carry the amber dot: Logistics services (nonprod), Shared VPC host (Production), Payments services (prod), Retail analytics (prod), Retail batch VMs (prod); their names say what is inside (", changes inside since 2026-09-16: 1 removed"), so a chip with only a removal inside also shows the amber dot (section 4.3, item 6). The ghost's name is "No longer in this view since 2026-09-16: Project: Reporting (decommissioned) …" (question 9). "38 of 374 shown". The legend has "removed since 2026-09-16" and "changed since 2026-09-16". The thumb sits at day 14 of 35, and the readout says "Thursday, 17 September 2026". |
| `diff-2026-09-24-{light,dark}.png` | A diff tick: compute lens at `all`, 24 September reached by `]` from the 23rd (the web group's scale-out), the whole diagram fitted. At this scale the markers are hard to make out, as the diff overlay's review said. |
| `diff-closeup-{light,dark}.png` | The same tick zoomed into project demo-web-1 (pointer moved off the canvas). The test VM and its disk deleted that day are ghosts where they stood: body and icon at half strength, "removed" under the name, dashed red outline on a canvas band. The two new VMs' disks (web-f9fq, web-l5j2) are outlined in green, 8 px out between canvas gaps. The group manager `web-mig` ("target size 4") has the amber dot on its top-right corner. Lines route around the ghosts, and nothing overlaps them. In dark, the outline is the light green, the ghost's outline the light red and the icon plate is faded with the body. Everything reads in both themes. |
| `diff-legend-{light,dark}.png` | The legend of that tick, zoomed in: the zone tints, the relation kinds present, and the rows "added since 2026-09-23" (a green-ringed card), "removed since 2026-09-23" (a dashed red card) and "changed since 2026-09-23" (a card with the amber dot). |
| `drawer-page-{light,dark}.png`, `drawer-what-changed-{light,dark}.png` | The manager selected on that tick. The selection trace runs to the root and the drawer is open. Its **What changed since 2026-09-23** section says "Changed since 2026-09-23: its update time moved." It gives `updateTime` on both days (2026-07-15T21:36:26.720816Z → 2026-09-23T13:55:05.722816Z) and "Fields of resource.data that differ (2)": `targetSize 2 → 4`, `versions[0].targetSize.calculated 2 → 4`. A new VM's drawer says "Added since 2026-09-23." with its one update time. |

Also checked in this review, outside the timeline: the interactive title block still carries the short
non-affiliation line ("Not affiliated with Google. An independent open-source side project."), and so does the
footer. The placement revised on 2026-10-10 (title block tagline, new footer wording) is not in the app yet
(section 4.4).

## 4. Findings

### 4.1 Blocking

None. Every command is green. The memory criterion is met against a warm baseline and not against the cold
one; section 2 explains why that is not a leak, and the decision is the maintainer's (question 15).

### 4.2 Fixed in this review (small and obvious)

| What | Where |
|---|---|
| A typed read time accepted impossible UTC offsets (−12:01 to −14:59, +14:01 to +14:59), against its own comment ("from −12:00 to +14:00"); found by the extra ticks' review | `frontend/src/import/sidecar.ts` (`parseTypedReadTime`), five cases more in `sidecar.test.ts` |
| The ViewSpec's description gave `tick` as `YYYY-MM-DD` only; the ingestion skill's §5 did not mention extra-tick ids (the extra ticks' report) | the build's ViewSpec description, `.agents/skills/cai-ingestion/SKILL.md` §5 |
| `e2e/README.md` listed neither `timeline.spec.ts` (the timeline bar) nor `diff.spec.ts` (the diff overlay) (the diff overlay's review) | `e2e/README.md` |
| `docs/contributing.md` still listed, under "Not available yet", the diff overlay and the top-bar Theme menu (shipped earlier that day) | `docs/contributing.md` §8 |
| The root README said a hosted sign-in app was planned at `architecture.gcportrait.app`; the hosting decision's last revision drops it (ADRs 0032, 0035) | `README.md` ("Self-host") |
| `docs/README.md` had the `self-host.md` and `configuration.md` rows merged on one line, so the table lost a row | `docs/README.md` |

### 4.3 Open defects, deduplicated, with a suggested owner

These come from the reports and reviews. Items 1 to 5 change what a person sees, and are best fixed together in
one timeline follow-up before more work builds on the timeline.

1. **Follow-up requests do not name the day drawn** (the reviews of the timeline bar and the diff overlay; seen in the browser in both). The
   data worker answers `details`, `choices`, `search`, `locate` and `reveal` from the day its last Scene drew. The
   page caches them by day (`useNodeDetails`, since the diff overlay), by snapshot only (`useViewChoices`: the Focus and
   Filters pickers keep the first day's projects and regions on every day), or by snapshot and text
   (`useSearchResults`). A selection made while the next day is still being prepared stores that day's details
   under the current day's key. Repro on XL with the web-mig autoscaler: `recommendedSize` 8 instead of 4. Fix:
   name the drawn tick in each request, resolve it through `graphAt` in the worker as `changes` already does, and
   key every page cache by day.
2. **The readout is cut at 300 px** (the timeline bar's review). A read's progress text ("Reading Wednesday, 30 September 2026:
   12 pages · 4 800 assets · 3.2 MB · 0:05" needs about 466 px) loses its size and elapsed time, and Google's error
   message is cut too. The timeline's design asks for progress and size in the bar. Use the short day label while loading, or
   give the readout more room.
3. **The readout says the wrong thing for a snapshot read after the timeline's last day** (the timeline bar's review: a clock that
   ran ahead, or a future export). It says "The snapshot was read before the days on this timeline.", no marker is
   current, and the thumb sits on the latest day. `timeline/words.ts` `readout()` needs a case for "after".
4. **An extra tick that cannot be drawn leaves the bar stuck** (the extra ticks' review). A damaged stored blob, or one deleted
   in another tab, keeps the marker "cached" and the readout at "Drawing export 2026-10-05 14:30…" for good, while
   the canvas says what went wrong.
5. **A removed node that stays selected gets a wrong drawer note** (the diff overlay's review). After stepping on, the drawer of
   a deleted VM says "Not an asset of the snapshot: the diagram draws this zone to group what is inside it." The
   hash keeps the selection, so a link shows the same. A ghost selected through a drawer link also gets no ring or
   trace on the canvas, because it has no `data-id`.
6. **Diff marker details** (the diff overlay's review):
   - Code reading suggests nested added outlines when the layout parent is a virtual zone (regions, bundles) inside
     an added container; the skill says "outermost node only". The demo histories cannot show it.
   - A chip whose only inside changes are removals gets the amber "changed" dot.
   - The SVG `<desc>` counts the whole snapshot's diff, not what the view draws.
   - The console-action circle covers half of a selected changed node's dot.
   - The slider's focus ring covers the top of the current marker.
7. **Playback and reads** (the reviews of the timeline bar and extra ticks, code reading):
   - Pressing Speed while playing stops playback (it counts as an interaction), so the reducer's "interval while
     playing" path is never reached.
   - The worker's `TickSource.resolve` uses a cached "now" copy whatever its flag, so a re-read latest day is not
     drawn until the view moves.
   - Moving onto an extra tick cancels a live neighbour's read in flight (`controller.ts` `moved()`).
   - The readout's polite live region speaks on every progress action of a read.
8. **Wording** (the extra ticks' report and review):
   - The step buttons are still named "Previous day" and "Next day" though they also step onto extra ticks.
   - "Timelines by scope" counts stored copies, not ticks ("5 extra ticks" where the bar shows 3 diamonds), and does
     not mark which copy is shown.
   - "Delete the cached days of …" leaves the scope's extra ticks; `docs/timeline.md` §4 now says so.
9. **Cost on large organisations** (the diff overlay's report and review; for the performance pass). A step at the folder level on XL builds the
   earlier day's view and the open views for the chips' counts: the diff took 1.1 s in the author's measurement and
   0.6–0.7 s in the reviewer's (both in Node), on top of the Scene's 0.2–0.4 s. No budget covers it.
10. **Coverage gaps** (the timeline bar, extra ticks):
    - No end-to-end test reads a live day from `/api/assets/stream` or turns a manual pull into an extra tick in
      live mode. Both are unit-tested against pretend backends.
    - "Today" does not roll over at midnight while the page stays open (documented in `docs/timeline.md` §9).
11. **Scope beyond the owned paths** (all three reviews). The three features changed shared files: the store, the
    pipeline, the data worker's protocol and handler, `db.ts`, `ui/Slider.tsx`, `@gcportrait/layout`'s `layoutKey`,
    which now leaves all Scene metadata out (the timeline bar's review checked that the layout reads none of it), and the
    model's `TickSchema`. Each was declared and reviewed; nothing to undo.

### 4.4 Seen in this review, outside the timeline

- **The non-affiliation placement (2026-10-10).** The revised placement is not implemented, and no task owns it
  yet. It asks for the interactive title block tagline `gcportrait.app - Visualize your Google Cloud
  Infrastructure`, the footer `Not affiliated with Google / Google Cloud. gcportrait is an independent open-source
  project by Florian Chrometz` with the name linked, and the exported title block's line `Not affiliated with
  Google / Google Cloud.`. The app still shows the short form in the canvas title block and the footer, and
  `e2e/tests/support.ts` expects it. This review leaves the wording untouched, as instructed.
- **The hosting decision's last revision and `docs/self-host.md`.** The self-host guide still has a section "For
  the maintainer's hosted instance" (its OAuth client and verification), and the docs index describes it so. The
  decision now rules out a hosted sign-in app. The change belongs with the distribution follow-up that the
  self-hosting smoke test already asked for (images on ghcr.io), not with the timeline; this review only corrected
  the root README's sentence.
- **The demo organisations share one organisation number** (`organizations/30000000001`). An export of demo M is
  therefore an extra tick on demo S's, L's and XL's timelines (the extra ticks' review). That is correct under the same-scope
  rule but may confuse people in demo mode (question 13).

## 5. Open questions for the maintainer (from the three features' reports and this review, deduplicated)

1. **A live snapshot's own day.** The timeline bar shows the snapshot itself there, read at its real read time, not that day's
   00:00 UTC, and writes a hash naming that day back as no tick. Is that the intended meaning of "default =
   snapshot.readTime" in the ViewSpec?
2. **No prefetch on open.** Nothing is read while the page stays on the snapshot's own day, because each neighbour
   is a full read of the scope. Once the view rests on any day, its neighbours are prefetched at idle. Acceptable
   against the design's "prefetch the two neighbouring ticks at idle"?
3. **The Snapshot menu's "Open:" line and the view choices** describe the day on screen (its read time), not the
   snapshot as stored. Keep, or pin them to the stored snapshot?
4. **The layout memo key** now leaves out all Scene metadata (root label, lens, read time, rect count, refusals),
   not only the read time. The layout reads none of it, and a test proves it. OK?
5. **Local-date labels west of UTC.** In America/Los_Angeles, `tick=2026-09-30` reads "Tuesday, September 29,
   2026", which is skill §5's rule but confusing next to the hash. Keep the local date, or label the UTC day?
6. **The legend's diff rows.** The diff overlay shows only the rows of markers actually drawn (style skill §7), so a day with only
   changes shows only "changed". Or all three whenever a day is compared?
7. **The compared-with day in the link.** It is transient, so a reload or a shared link shows the day without
   markers. Put it in the ViewSpec (a codec field and an ADR)?
8. **The XL per-step cost** (about 1.1 s at the folder level): accept, or memoise the earlier day's and the open
   views' Scenes in the data worker (in the performance pass)?
9. **Wording for a project marked for deletion:** a ghost with "not drawn now" and the tooltip "No longer in this
   view since …". OK?
10. **Naming an extra tick in the diff wording.** "since 2026-10-05" reads the same for the 5 October day and an
    export of 14:30 that day. Use the extra tick's label ("since export 2026-10-05 14:30")?
11. **An export read at exactly the open snapshot's read time** counts as the snapshot itself, not as an extra tick
    (in practice only a real export taken at 00:00:00 on the demo's day). Acceptable?
12. **Extra ticks older than the 35-day window** stay on the bar (first), since stored exports are not limited by
    Cloud Asset Inventory's window. Or hide them?
13. **The demo organisations' shared organisation number.** Give each demo size its own number, so their extra
    ticks stay apart? That changes the demo fixtures and goldens.
14. **The step buttons' names** with extra ticks: rename "Previous day" and "Next day" to "Previous tick" and "Next
    tick" (or "Earlier" and "Later")? The e2e specs use the current names.
15. **The memory criterion's baseline.** Count "within 20 % of the baseline" from the heap after a warm-up (+9.0 %,
    met), or from the page as first opened (+49.7 %, not met, the bounded caches of section 2)? If the latter, the performance pass
    could keep fewer days' Graphs in the data worker (each M Graph is about 2.3 MB).

## 6. Reproduce

```sh
# The commands (section 1)
pnpm check && pnpm build && pnpm size
pnpm e2e --output "$TMPDIR/e2e"      # a private output folder, so a concurrent run's clean-up cannot interfere
# (Passing `--` before spec files, as in `pnpm e2e -- tests/x.spec.ts`, makes Playwright run the whole suite:
#  that is how the second full run of section 1 happened. Name the files without it.)
pnpm e2e tests/timeline.spec.ts tests/diff.spec.ts tests/extra-ticks.spec.ts

# The memory check and the screenshots: a production demo build on a cross-origin-isolated static server
cd frontend && VITE_DEMO=1 npx vite build --outDir "$TMPDIR/demo-dist" --emptyOutDir && cd ..
node out/timeline-review/serve.mjs "$TMPDIR/demo-dist" 5199 &   # sets COOP/COEP; SPA fallback to index.html
node out/timeline-review/memory.mjs http://127.0.0.1:5199 4 4 memory-long.json   # 4 rounds of 100, warm-up 4 days
node out/timeline-review/memory.mjs http://127.0.0.1:5199 2 0 memory-cold.json   # no warm-up
node out/timeline-review/heapdiff.mjs http://127.0.0.1:5199
node out/timeline-review/screens.mjs http://127.0.0.1:5199              # writes e2e/.scratch/timeline-review/
```

The scripts and the measurements are kept under `out/timeline-review/` (git-ignored, and outside `eslint .` and `prettier
--check .`, which do read `e2e/.scratch/`), not in the suite; they load Playwright and axe from the e2e package. The
memory script needs Playwright's full Chromium build (`channel: 'chromium'`). The static server, `serve.mjs`, is
about 40 lines of Node `http` that adds the two headers. After this review's edits, `pnpm --filter
@gcportrait/frontend test`, the three timeline specs, `pnpm format`, `prettier --check .`, `eslint .` and `pnpm
provenance` were run again (section 1); the orchestrator runs the full `pnpm check` and `pnpm e2e` on the final tree.
