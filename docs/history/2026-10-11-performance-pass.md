<!-- SPDX-License-Identifier: MIT -->

# Performance pass, 2026-10-11

A record of the build, written on 2026-10-11 and not kept up to date since (on 2026-10-12 the build's
task and phase ids gave way to plain names and dates); what is still open is in
[../backlog.md](../backlog.md), and the targets are now the layout skill's §7.

A performance pass on demo L and XL (the collapsed defaults, the bundle budgets, the workers' memory) and a memory
check across tick switches, then a fix for whatever misses; with it the carry-overs of the walkthrough fixes (a
guard against zod on the UI thread, the lens ceiling and small views) and the timeline follow-ups the
[timeline review](2026-10-10-timeline-review.md) left open in its section 4 and its questions. Measured first,
then fixed, then measured again on the same machine with the same scripts: every table below has a "before" and
an "after" column. An independent review of that first round found the first
timeline step back from the snapshot's own day on L still over its target and ADR 0029 and several documents
out of date about where the demo generator runs; the second round (section 10) fixed both as far as it could
and measured again: its figures are in the "round 2" columns and rows. The review of round 2 found the first
step after the page has rested two minutes still over its target, and the first step on a fresh page at the
edge of it; the third round (section 11) reads and builds a timeline day from what the day before already
holds, and every target is now met with room to spare: its figures are in the "round 3" column, each with its
spread.

| | |
|---|---|
| Date | 2026-10-11 |
| Before | the tree as the pass found it: `main` at `6630bff` with the uncommitted work on the website and the user guides, none of it in `frontend/src` |
| After | the same with this pass's changes (and, in the build measured, the security review's work then in progress in the same tree: backend, the Settings page, `vite.config.ts`) |
| Round 2 | the same tree after the review of round 1, the same day: section 10's changes; measured against the round-1 build in the same session where a figure is compared |
| Round 3 | the same tree after the review of round 2, the same day: section 11's changes; measured against the round-2 build in the same session, run for run (load average 1.6 to 5.5) |
| App under test | a production demo build (`VITE_DEMO=1 vite build`) of each tree, served by a small static server that sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` (for `performance.measureUserAgentSpecificMemory()`) and `Cache-Control: no-store` |
| Browser | Chromium 156.0.8078.4 (Playwright 1.64.0's full build, new headless mode), 1280 × 800, time zone UTC, locale en-GB |
| Machine | Apple M1 (8 cores), Node 22.23.2; other agents were working on the same machine (load average 6 to 15 during the runs; 1.4 to 3 in round 2), so single runs vary by 10 to 20 %: round 2 therefore compares its build with the round-1 build in the same session, run for run |
| Data | the synthetic demo organisations S, M, L and XL and their 35-day histories; no real data |

## 1. Targets and verdicts

| What (the pass's targets) | Target | Before | After (round 1) | Round 2 | Round 3 | Verdict |
|---|---|---|---|---|---|---|
| Time to first diagram, L at the collapsed default | < 3 s | 0.62 s | 0.59 s | 0.62 s (the round-1 build in the same session: 0.60 s) | 0.61–0.67 s, median 0.62 s | met |
| Time to first diagram, XL at the collapsed default | < 8 s | 2.63 s | 2.68 s | 2.61 s | 2.54–2.63 s, median 2.56 s | met |
| Lens switch on L | < 300 ms | median 46 ms, max 103 ms | median 42 ms, max 95 ms | median 39 ms, max 84 ms | median 38 ms, max 81–92 ms (two runs) | met |
| Chip expanded on L | < 300 ms | median 80–84 ms | median 86 ms | median 77 ms, max 89 ms | 70–98 ms (two runs; the round-2 build in the same session 71–99 ms) | met |
| Search jump on L (Enter on a hit to the hit drawn, selected) | < 300 ms | 9–126 ms | 7–124 ms | 10–115 ms | 7–117 ms | met |
| Tick switch on L, a day not built yet | < 300 ms | 257–303 ms | 226–248 ms | 212–252 ms | 113–194 ms in two runs of six (the round-2 build in the same session: 210–298 ms) | met |
| The first step back from the snapshot's own day on L, on a fresh page, 1.5 s after the diagram is drawn | < 300 ms | not measured | 307–343 ms (the round-1 build, round 2's script) | 276–296 ms in 20 runs, median 288 ms; the review: 277–331 ms, 5 of 20 over 300 ms | 163–188 ms in 20 runs, median 182 ms (the round-2 build in the same session: 271–306 ms, median 290 ms, 2 of 10 over 300 ms); the review's script: 165–187 ms in 10 runs | met |
| The same first step after the page has rested two minutes | < 300 ms | 358–386 ms | 376 ms (359–360 ms in round 2's session) | 311–320 ms in 3 runs; the review: 313–317 ms | 197–205 ms in 4 runs (the round-2 build in the same session: 296 and 324 ms) | met |
| Tick switch on L, a day still kept | < 300 ms | 76–89 ms | 27–31 ms | 29–30 ms | 30–32 ms (onto days built again: 67–81 ms; the round-2 build 179–181 ms) | met |
| Worker heap after 100 switches on M, against a warm baseline after GC | within 20 % | total +9.1 %, data worker +2.2 % | total +9.6 %, data worker +2.4 % | total +9.4 %, data worker +3.0 % | total +13.9 %, data worker +7.1 %, from a baseline 3.2 MB lower (section 11.2) | met |
| Worker heap after 20 switches on L (and on to 60), against a warm baseline after GC | within 20 % | +1.6 % (60: +2.5 %) | +2.2 % (60: +2.9 %) | +2.0 % (60: +2.9 %) | +3.5 % (60: +4.9 %), from a baseline 22.6 MB lower | met |
| UI-thread long tasks (> 50 ms) while panning and zooming L and XL at the default | none sustained | none | none | none | none | met |
| Bundle budgets (ADR 0029) | UI 350 kB, workers 400 kB | 228.36 / 194.09 kB | 230.00 / 195.87 kB | 229.99 / 196.30 kB | 230.10 / 197.13 kB | met |
| No zod on the UI thread | a guard | none (by hand, since the walkthrough fixes) | `pnpm size` fails on it | the same | the same | done |

Round 1's tick-switch runs waited two minutes before their first step (section 2), so its "first step" figures
(358–386 and 376 ms) are the after-a-rest case; the review measured the first step on fresh pages soon after
the first draw (314–343 ms). Round 2 measured both cases on both builds and left the first step after minutes
of rest over the target (311–320 ms): the browser had dropped the compiled code of the day pipeline, and the
step compiled it again (section 10.2). Round 3 (section 11) does not build any day in advance (no prefetch on
the snapshot's own day, as the orchestrator decided for the timeline review's question 2); it makes the day
pipeline do far less: a day is read through `@gcportrait/ingest` only for the assets no day of its history
held before, and its Graph evaluates the catalog's rules only for those. The step's replay and ingest went
from about 75 ms to 2–15 ms, its Graph from about 95 ms to about 50 ms, and the first step now takes 163–188
ms on a fresh page and 197–205 ms after two minutes of rest. The memory criterion counts from a warm baseline,
as the orchestrator decided for the timeline review's question 15; round 3's percentages on M are higher
because its baseline is lower (section 11.2).

## 2. Method

Scripts under `out/perf/` and, for rounds 2 and 3, `out/perf-r2/` and `out/perf-r3/` (they load Playwright from
the e2e package, as the timeline review's did). `out/` is git-ignored and outside lint and format, so **the
scripts are not in the repository and the browser figures cannot be reproduced from it**: the commands below
name them as they were run here, and the bullets say what each measures, so that a later pass can write them
again. What the repository does reproduce: the budget tests (`pnpm --filter @gcportrait/graph test:budget`
prints, since round 3, a day of L's history built after the next day with and without the builder's memo; the
layout's and ingest's budgets), and the unit tests that check each change gives the same result as before
(sections 10 and 11). Round 1's `perf.mjs` looked for the timeline bar's readiness one element too deep, never
found it and went on after its 120 s timeout, so its tick switches started two minutes after the diagram was
drawn; round 2's copy (`out/perf-r2/perf.mjs`) waits for the bar itself and rests 1.5 s, and
`out/perf-r2/first.mjs` measures the first step after a rest it is given (1.5 s or 120 s). Run against each
build's static server:

```sh
cd frontend && VITE_DEMO=1 npx vite build --outDir "$TMPDIR/perf/after-dist" --emptyOutDir && cd ..
node out/perf/serve.mjs "$TMPDIR/perf/after-dist" 5293 &
node out/perf/perf.mjs http://127.0.0.1:5293 all after-all.json        # ttfd, interact, panzoom, memory
node out/perf/perf.mjs http://127.0.0.1:5293 memory2 after-memory2.json # memory with full warm-up, checkpoints
node out/perf/perf.mjs http://127.0.0.1:5293 xlticks after-xlticks.json
node out/perf/perf.mjs http://127.0.0.1:5293 heavy after-heavy.json     # L at all, XL at projects
node out/perf/stages.mjs http://127.0.0.1:5293 L 2                      # a step's stages as the page sees them
node out/perf/messages2.mjs http://127.0.0.1:5293 'snapshot=demo:L&detail=all' 'snapshot=demo:XL&detail=projects'
node out/perf/demojob.mjs http://127.0.0.1:5293                          # a diagram during "Try the demo" XL
node out/perf/nodes.mjs http://127.0.0.1:5293 'snapshot=demo:L&detail=all'
node out/perf/shots.mjs http://127.0.0.1:5293 after                     # the visual checks, both themes
# React commits per interaction: a development build (React's profiling timers), then
NODE_ENV=development VITE_DEMO=1 npx vite build --mode development --minify false --outDir "$TMPDIR/perf/after-devdist"
node out/perf/renders.mjs http://127.0.0.1:5294 M after-renders-M.json
# In Node (the data worker's handler in-process), from frontend/:
npx tsx ../out/perf/worker-bench.ts L 8 ; npx tsx ../out/perf/demo-bench.ts

# Round 2: the round-1 build ("base") and this one, each on its own server, measured in turns
node out/perf/serve.mjs "$TMPDIR/perf/base-dist" 5401 & node out/perf/serve.mjs "$TMPDIR/perf/final-dist" 5410 &
node out/perf-r2/first.mjs http://127.0.0.1:5410 10 L 3          # the first steps on 10 fresh pages, 1.5 s rest
node out/perf-r2/first.mjs http://127.0.0.1:5410 3 L 2 120000    # the same after two minutes of rest
node out/perf-r2/stages.mjs http://127.0.0.1:5410 L 2            # a step's stages (round 1's, with the bar fixed)
node out/perf-r2/ttfd.mjs http://127.0.0.1:5410 L 4              # time to first diagram
node out/perf-r2/perf.mjs http://127.0.0.1:5410 interact r2-interact.json   # also ttfd, xlticks, panzoom, memory2
VITE_DEMO=1 npx vite build --minify false --outDir "$TMPDIR/perf/final-nomin"   # names in the CPU profiles
node out/perf-r2/wprof.mjs http://127.0.0.1:5411 3 1500 short-   # CPU profiles of the workers and the page
node out/perf-r2/profsum.mjs out/perf-r2/prof/short-data-step1.cpuprofile 20 buildGraphWithReport,prepareView
# Node benches, bundled with esbuild from frontend/ (npx esbuild <file> --bundle --platform=node --format=esm)
#   out/perf-r2/prepared-bench.ts (prepare and finish), diff-bench.ts (a step's Scene stage), open-bench.ts

# Round 3: the round-2 build ("base") and this one in turns; out/perf-r3/ holds copies of round 2's scripts
node out/perf/serve.mjs "$TMPDIR/perf/base-dist" 5701 & node out/perf/serve.mjs "$TMPDIR/perf/final-dist" 5741 &
node out/perf-r3/first.mjs http://127.0.0.1:5741 5 L 3            # four batches of five, the base's two between them
node out/perf-r3/first.mjs http://127.0.0.1:5741 4 L 2 120000     # after two minutes of rest
node <review scratchpad>/perf-r2-review/scripts/step.mjs . http://127.0.0.1:5741 10 L 2 1500   # the review's script
node out/perf-r3/stages.mjs http://127.0.0.1:5741 L 3
node out/perf-r3/perf.mjs http://127.0.0.1:5741 interact r3-interact.json      # also ttfd, xlticks, panzoom, memory2
node out/perf-r3/perf.mjs http://127.0.0.1:5741 memxl r3-memxl-5741.json         # XL opened, then 4 + 6 switches
node out/perf-r3/wprof.mjs http://127.0.0.1:5712 1 120000 rest-                  # CPU profiles after the rest
node out/perf-r3/ptrace.mjs http://127.0.0.1:5741 3     # the page's main thread per step (a Chromium trace)
#   Node: out/perf-r3/day-bench2.ts (a replayed day's read and Graph, round 2's way against this one),
#   read-bench.ts (text against bytes, a line cache), proj-churn.ts (what changes from day to day)
```

- **Latency** is measured in the page: from the action's input event (`pointerdown` or `keydown`, its
  `timeStamp`, captured on `window`) to the first animation frame in which the expected drawing is on screen
  and no pipeline request is pending (polled with `requestAnimationFrame`, then one task later). A lens switch
  is the Lens picker's option clicked; a chip expanded is a click on a project chip of L at `folders`; a
  search jump is Enter on the best hit of `orders-db` (inside a collapsed project: a new view with its flips),
  `bastion` and `demo-web-7` (drawn: a selection and a glide), until the hit is drawn selected; a tick switch
  is `[` or `]` until the bar's current marker is on the new day and the diagram is drawn. Search results
  include the box's 120 ms debounce.
- **Time to first diagram**: a new browser context per run (nothing stored), `/diagram#snapshot=demo:<size>`
  opened, to the first frame after the canvas is marked `data-diagram-ready` (navigation start = 0). Three
  runs per size, the median.
- **Long tasks**: the Long Tasks API (`PerformanceObserver`, `longtask`) from page start; during 4 s of drag
  pans and 4 s of wheel zooms (crossing the level-of-detail thresholds), with the gaps between animation
  frames.
- **Memory**: as in the timeline review. Chromium started with `--js-flags=--expose-gc`; before each point 1.5 s
  of rest, `gc()` three times in the page and in every worker, then
  `performance.measureUserAgentSpecificMemory()` (eager) for the page and its workers (the larger worker entry
  is the data worker), CDP `Performance.getMetrics` for the UI thread's heap and `Memory.getDOMCounters`. The
  warm baseline follows a warm-up of 4 days back and 4 forward, which fills the data worker's kept days
  (`KEPT_TICK_GRAPHS`, 3) and the layout memo; a round of N switches is a sweep back and forth over 68 % of N,
  then alternation between the last two days.
- **React commits**: a development build with a stand-in for React DevTools' hook, which walks each committed
  fiber tree and counts the components that rendered (skipping subtrees that bailed out, DevTools' own rule).

## 3. Time to first diagram (1280 × 800, collapsed default)

| Organisation | Assets | Drawn (of all rects) | Before (median, range) | After (median, range) | SVG elements before → after | Long tasks before the first frame |
|---|---|---|---|---|---|---|
| S | 96 | 55 of 55 (`all`) | 227 ms (226–289) | 214 ms (213–248) | 1 110 → 999 | none / none |
| M | 952 | 38 of 369 (`folders`) | 281 ms (278–437) | 262 ms (261–263) | 719 → 611 | none / none |
| L | 6 382 | 164 of 2 497 (`folders`) | 617 ms (615–630) | 591 ms (584–598) | 2 630 → 1 913 | none / none |
| XL | 51 242 | 494 of 10 479 (`folders`) | 2 626 ms (2 614–2 634) | 2 684 ms (2 442–2 776) | 7 232 → 5 216 | 1 of 77–79 ms / 1 of 61–62 ms |

Round 2 (`out/perf-r2/perf.mjs ttfd`, three runs each): S 217–272 ms (median 240), M 269–299 ms (275), L
621–642 ms (623), XL 2 598–2 646 ms (2 606), the SVG element counts unchanged. Measured in turns with the
round-1 build in the same session, L took 593–634 ms against 592–624 ms and M 267–358 ms against 269–282 ms:
round 2 changed nothing before the first diagram (the open view it builds after a Scene answer is built while
the page lays the diagram out).

XL's first diagram is mostly the data worker generating the organisation's 35-day history (about 1.3 s in
Node) and reading it through ingest (about 0.9 s); the long task is React drawing it. Beyond the defaults (for
information; no target): L at `all` drew in 1.10 → 1.09 s with its longest task 314–317 → 255–258 ms (31 052 →
22 166 SVG elements), XL at `projects` in 4.01 → 3.79 s with its longest task 977–989 → 719–743 ms (95 916 →
63 987 elements).

## 4. Interaction latency on demo L

### 4.1 The four interactions

| Interaction | Before (2 runs: median, max) | After (median, max) |
|---|---|---|
| Lens switch (Overview → Networking → Compute → Overview, twice) | 45.6 / 46.5 ms, 85.7 / 102.9 ms | 42.2 ms, 95.2 ms |
| Chip expanded (three project chips) | 79.5 / 84.0 ms, 84.0 / 84.3 ms | 86.1 ms, 94.5 ms |
| Chip collapsed again (Back) | 44.6 / 70.4 ms | 51.1 ms |
| Search results listed (with the 120 ms debounce) | 146.4 / 144.3 ms | 145.2 ms |
| Search jump: `orders-db` (opens its project), `bastion`, `demo-web-7` | 123 / 126, 11 / 9, 10 / 9 ms | 124, 13, 7 ms |
| Tick back onto a day not built (6 steps from 8 October) | 358, 303, 282, 273, 273, 280 / 386, 295, 292, 280, 258, 267 ms | 376, 248, 241, 232, 226, 237 ms |
| Tick forward onto a kept day, then onto days built again | 85, 79, 233, 228, 228, 89 / 84, 77, 230, 236, 225, 78 ms | 30, 31, 198, 194, 184, 27 ms |

Round 2 (`out/perf-r2/perf.mjs interact`, one run; its ticks start 1.5 s after the diagram is drawn, on a page
that has switched lenses, expanded chips and searched before, so the day pipeline's code is warm): lens
switches median 38.8 ms, max 84.3 ms; chips expanded 76.8, 74.7 and 89.3 ms, collapsed again 26–40 ms; search
results listed in 140–155 ms; search jumps 114.8, 9.8 and 10.4 ms; ticks back onto days not built 267, 229,
230, 252, 216 and 212 ms; forward onto kept days 29 and 30 ms, onto days built again 180, 173 and 182 ms, and
onto the snapshot's own day 29 ms.

### 4.2 Where a step's time goes

A step's stages as the page sees them (`stages.mjs`: the data worker's progress messages and answer, the
layout worker's result, the canvas marked drawn), from the key press, in ms:

| Step | Request posted | Replay and ingest | Graph | Scene and diff | Layout | Drawn |
|---|---|---|---|---|---|---|
| Before, 1st (8 → 7 Oct) | 5 | 75 | 97 | 93 | 52 | 346 |
| After, 1st | 4 | 73 | 105 | 81 | 56 | 347 |
| Before, 2nd (7 → 6 Oct) | 6 | 81 | 86 | 72 | 47 | 313 |
| After, 2nd | 3 | 69 | 91 | 44 | 49 | 271 |
| Round 2, 1st (two runs) | 4–6 | 68–84 | 92–98 | 34–35 | 48–57 | 273–290 |
| Round 2, 2nd | 2 | 70–88 | 92–96 | 27–30 | 41–42 | 242–268 |
| Round 3, 1st (two runs) | 8–11 | 1–2 | 49–53 | 35–39 | 46–57 | 175–186 |
| Round 3, 2nd | 2–4 | 6–15 | 46–60 | 27–29 | 39–46 | 148–154 |

The Scene memo (section 6.2) takes the second and later steps' "Scene and diff" from about 72 to 44 ms; the
first step still builds the snapshot's own day's open view, which no step built before. Replay and Graph are
about 175 ms of every new day, in `@gcportrait/ingest` (its line reader and the UTF-8 length of each line, the
largest self-time in a Node profile), the catalog's rule engine (its IP check validates through zod; one
Artifact Registry pattern) and `@gcportrait/graph`'s build (about 45 ms of its own on L); none of the first
two is this pass's to change, and the budget for the graph build (M under 150 ms) holds at 15.9 ms. A
neighbour day prepared at idle would hide it, but it holds the data worker while it runs (about 2 s on XL),
and the orchestrator decided against prefetching while on the snapshot's day. Round 1 left the first step at
about 350–380 ms after a rest; round 2 (section 10) builds the snapshot's own day's open view right after its
Scene answer and finishes every open view from the drawn view's preparation, which takes "Scene and diff" to
27–35 ms on every step, and compares the days' update times as text first. Round 3 (section 11) reads a day
through `@gcportrait/ingest` only for the assets no day of its history held before and has the Graph builder
evaluate the catalog's rules only for those, which takes "Replay and ingest" to 1–15 ms and "Graph" to about
50 ms, without building any day before it is asked for.

### 4.3 XL (no target; the timeline review's question 8)

| XL tick switch | Before | After |
|---|---|---|
| Back onto days not built (3 steps from 8 October) | 2 248, 2 039, 2 000 ms | 1 920, 1 676, 1 657 ms |
| Forward onto kept days | 594, 597, 595 ms | 119, 93, 95 ms |
| Round 2: back onto days not built, forward onto kept days | | 1 584, 1 802, 1 502 ms; 69, 46, 43 ms |
| Round 3: back onto days not built, forward onto kept days | | 749, 724, 711 ms; 80, 46, 44 ms |

In Node (the data handler in-process, `worker-bench.ts`) an XL step onto a kept day now takes 77–104 ms, and
one onto a new day about 2.7–3.0 s (its replay, ingest and Graph; the machine was busier than for the browser
runs).

## 5. UI thread while panning and zooming

| View | Gesture | Long tasks before | after | Frame gaps over 50 ms before | after | p95 gap before / after |
|---|---|---|---|---|---|---|
| L, default (164 rects) | 4 s of drag pans | 0 | 0 | 0 of 243 | 0 of 243 | 16.7 / 16.7 ms |
| L, default | 4 s of wheel zooms | 0 | 0 | 0 of 240 | 0 of 243 | 16.7 / 16.7 ms |
| XL, default (494 rects) | drag pans | 0 | 0 | 0 of 259 | 0 of 247 | 16.7 / 16.7 ms |
| XL, default | wheel zooms | 0 | 0 | 0 of 243 | 0 of 242 | 16.7 / 16.7 ms |
| L at `all` (2 497 rects; no target) | drag pans | 1 (69 ms) | 0 | 46 of 117 | 54 of 115 | 83 / 100 ms |
| L at `all` | wheel zooms | 10 (longest 65 ms) | 3 (longest 58 ms) | 1 of 186 | 0 of 199 | 33 / 33 ms |

Round 2 (`out/perf-r2/perf.mjs panzoom`): the L and XL defaults again without a long task and with no frame gap
over 50 ms (XL's longest gap 33 ms); L at `all` 0 long tasks while panning (51 of 120 gaps over 50 ms, p95 100
ms) and 6 while zooming (the longest 88 ms; round 1: 3, 58 ms). Round 2 changed no drawing code; that view has
no target.

The defaults pan and zoom at 60 frames a second with no long task. L at `all` pans at about 29 frames a second
in both builds: a Chromium trace of 3 s of panning spends 1.2 s painting, 0.9 s building the compositor's
layers and 0.6 s in style and layout forced by the pointer's handlers, for 22 000 drawn SVG elements; the
elements this task removed were never painted (hidden), so they changed zooming (fewer to restyle when the
level of detail changes: 10 long tasks to 3) but not panning. Panning a view that large smoothly would need
the drawing moved as one composited layer during a drag; that is a renderer change beyond this pass.

## 6. What was changed and why

### 6.1 The data worker answers for the day named (timeline review, section 4.3 item 1)

Every request that follows a Scene names the day on screen (`day: { tick }`, `DayRef` in
`frontend/src/diagram/pipeline/protocol.ts`: the Scene answer's `source.tick`, `selectDrawnDay` in
`state/hooks.ts`): `choices`, `details`, `reveal`, and the queries of `search` and `locate`. The worker reads
that day's Graph (`graphAt`, as `changes` already did) instead of whichever day it drew last, and the page
keeps the answers by snapshot and day: the drawer's details (already by day), the Focus and Filters pickers'
choices (by snapshot only before), the search results (by snapshot and text before). A selection made while
the next day is prepared, playback, or search typed on 17 September now answer for the day on screen.

### 6.2 Scenes kept per Graph (the review's question 8: memoise the compared day's and the open views)

`pipeline/sceneMemo.ts` keeps, per Graph (a `WeakMap`, so a day the worker drops takes its Scenes with it),
the last six views built: the drawn view, the same view under the level `auto` picked (the scene builder makes
the same Scene and report for it, which a test checks on demo M), and the open view the diff counts chips
with. The diff (`diff/tickDiff.ts`) builds through it. Stepping on, the earlier day's views are the ones built
the step before, so a step builds two Scenes instead of four, and a step back onto a kept day builds none. The
data worker's heap after warm-up grew by about 1.3 MB on L (section 7).

### 6.3 "Try the demo" in a worker of its own (from the walkthrough fixes: the XL demo generation blocked Scene requests)

The demo job ran in the data worker, which answers one request at a time: an XL job (history generated 1.3 s,
read 0.9 s, compressed about 2 s, in Node) held every Scene request behind it, and its history stayed in the
data worker's memory. It now runs in a fifth role of the worker script (`pipeline/demoRole.ts`), started for
the job and terminated when it settles (`createBrowserDemoJob`, used by `main.tsx`). Measured: on the Connect
page "Try the demo" with XL, then the diagram page's link to demo M 0.35 s into the job: demo M drawn 2 388 /
2 350 ms after the click before, 236 / 232 ms after (`demojob.mjs`). The cost: opening demo XL right after its
job generates its history once more in the data worker (about 1.3 s), which the shared worker had reused.

### 6.4 Large answers as transferred bytes

A Scene answer or Layout of more than 1 000 rects is posted as its JSON in UTF-8 with the buffer transferred
(`pipeline/transfer.ts`, the data and layout roles of `diagram.worker.ts`), and the page decodes it before its
client reads it (`workers.ts`). Measured as the time the app's own `message` listener takes for the largest
answer (`messages2.mjs`, median of three):

| View | Data answer before → after | Layout answer before → after |
|---|---|---|
| L at `all` (2 497 rects; 2.0 MB Scene, 3.5 MB Layout as JSON) | 6.0 → 3.5 ms | 17.5 → 7.7 ms |
| XL at `projects` (7 838 rects; 6.7 MB, 11.4 MB) | 16.0 → 10.4 ms | 41.9 → 28.3 ms |
| L, default (164 rects; not encoded) | 2.4 → 2.3 ms | 1.2 → 1.1 ms |

The round trip is lossless for these answers but for fields whose value is `undefined` (an icon's `category`),
which JSON leaves out and which read the same (`transfer.test.ts`).

### 6.5 SVG element counts in dim mode

The interactive canvas drew a hidden traced copy of every line (since the selection trace), hidden until the painter showed it: in
dim mode (above 30 lines) that is three elements per line on top of the line itself. It now draws one hidden
prototype per relation kind, and the painter clones it for the lines it traces (`TracedPrototype` in
`Drawing.tsx`, `tracedCopy` in `painter.ts`) and takes the clones out again; a static drawing (exports,
baselines, `pnpm render`) is unchanged, and none of the 32 SVG baselines changed for it (six changed for the
organisation numbers only, section 6.8). Counts: L default 2 630 → 1 913, XL default 7 232 → 5 216, L at `all`
31 052 → 22 166, XL at `projects` 95 916 → 63 987. A selection's trace (demo M, compute lens at `all`, the web
group manager with 7 traced lines) is the same PNG, byte for byte, before and after, in both themes
(`shots.mjs`).

### 6.6 Checked, not changed

- **Layout memo hit rate.** Across 100 switches on demo M the memo answered 52 of 100 layouts before and after
  (over 200 switches 108 of 200, 54 %); on L 58 of 60 switches, whose rounds are mostly alternation. A day
  with changes cannot hit (its Scene carries its ghosts and markers, and stepping back compares with another
  day than stepping forward); a larger memo would not change that.
- **Re-render storms.** None. On demo M, per interaction (development build, the hook in section 2): opening 9
  commits; a tick switch 8–10; a chip expanded 8; a lens switch 9; typing a search 5 (the drawing not
  rendered); a hover over 30 points, a drag pan, 10 wheel steps and a fit: no commit at all. The drawing
  renders once per new diagram. After the change the drawing renders 42 `TracedLine` components fewer per
  diagram on M (they are prototypes now).
- **Catalog data loaded once.** Only the data worker fetches the compiled catalog (619 kB, 113 kB gzipped) and
  the icon table, once for its life; the snapshot, import and the new demo worker load neither (checked in the
  build's chunks).

### 6.7 The carry-overs of the walkthrough fixes

- **No zod on the UI thread, guarded.** `scripts/check-bundle-size.mjs` searches every UI-thread JavaScript
  file (initial, lazy, unclassified) for zod's minified signatures (`._zod`, `"$Zod…"` constructor names,
  `"ZodError"`, zod 3's type names) and fails with the files and signatures it found; the workers may bundle
  zod. Five tests in `scripts/check-bundle-size.test.ts`. On the real build it finds zod in the workers'
  `rules` chunk only.
- **Small views open whole.** `autoDetailLevel` (`@gcportrait/graph`) returns `all` for a view of at most 100
  rects before the lens ceiling applies, so demo S's Networking opens at `all` (40 rects; it opened at
  `networks` since the walkthrough fixes). The composition oracle, the graph's detail tests, the render-scene test, the Lens
  picker's test, the layout skill §6, the graph README and `docs/lenses-and-filters.md` (one transcript line:
  the security lens on a perimeter of demo M, 56 rects, now `auto → all`) say the same.

### 6.8 The timeline follow-ups (timeline review, section 4 and its questions, as the orchestrator decided them)

| Item | What changed |
|---|---|
| 4.3 item 1, follow-up requests name the day | section 6.1 |
| 4.3 item 2, the readout cut at 300 px | the readout wraps to two lines (16 px each, in the 48 px bar) and ends in an ellipsis after that, the whole text in its tooltip and its status; a read's progress names the day short ("Reading 30 Sept: 12 pages · 4,800 assets · 3.2 MB · 0:05"), which now fits whole (screenshots in section 8) |
| 4.3 item 3, a snapshot read after the timeline's last day | the readout says "The snapshot was read after the latest day on this timeline: later than this computer's clock says it is now." (it said "before"); a snapshot read before the first day puts the thumb at the start, not the end (`TimelineModel.ownBeyond`) |
| 4.3 item 4, an extra tick that cannot be drawn | once the pipeline has answered the view, the readout says "export … could not be drawn: <reason>", or "export … is no longer stored in this browser; the snapshot itself is shown.", instead of "Drawing export …" for good; a day whose diagram failed says why too |
| question 8 (the review's 9): the XL per-step diff cost | section 6.2 |
| question 10 (the review's 11): an extra tick in the diff wording | the legend, the names, the description and the drawer's "What changed" say "since export 2026-10-05 14:30", not "since 2026-10-05" (`DiffDay.label`, added on the page from the timeline's extra ticks: `withExtraLabel`) |
| question 12 (the review's 13): extra ticks older than the 35 days | not on the bar (`mergeTicks` leaves out one read before the first day's 00:00); a link naming one says "export … was read before the first day of this timeline of the last 35 days; the snapshot itself is shown."; "Play extras" shows only while an extra tick is on the bar |
| question 13 (the review's 14): one organisation per demo size | S `30000000001` (as before), M `30000000002`, L `30000000003`, XL `30000000004` (`DEMO_ORGANIZATION_IDS` of `@gcportrait/demo-data`, which replaces `DEMO_ORGANIZATION_ID`); the synthetic-data guard of `@gcportrait/model/testing` accepts the four |
| questions 1, 2, 5, 6, 7, 15 | decided as implemented (the snapshot's own day is the snapshot, no prefetch while on it, local-date labels, legend rows only for drawn markers, the compared day not in the hash for now, the warm-baseline memory criterion) |

Not addressed here, and still open from that review: section 4.3, items 5 (a removed node that stays selected gets the
"zone" note; a ghost has no ring), 6 (diff marker details), 7 (playback and reads: Speed stops playback, the
cached "now", a neighbour's read cancelled by an extra tick, the live region's chatter), 8 (wording of the
step buttons and "Timelines by scope") and 10 (coverage gaps).

**The regenerated goldens and fixtures** (the demo organisation numbers, deliberately):
`packages/demo-data/fixtures/M.ndjson` (every line: the organisation number in `ancestors` and org-level
names; and the update time of the 7 organisation-level assets whose generated timestamps hash their names: the
organisation, its audit sink, its firewall endpoint, security profile and group, and the Security Command
Center export and notification); `S.ndjson` and `stats.json` unchanged.
`packages/layout/test/golden/M-networking.json` and `M-networking-all.json`: the organisation's id, nothing
else (checked by replacing the number back and comparing byte for byte). Six SVG baselines in
`e2e/baselines/diagram/` (`M-networking-{auto,all}-{light,dark}.svg`, `L-networking-auto-{light,dark}.svg`):
the organisation's id in `data-id`s, nothing else (the same check). The render golden PNG is unchanged.

## 7. Memory and leak check

| Point | Before: total, data worker, layout worker, UI heap | After: total, data worker, layout worker, UI heap |
|---|---|---|
| M, after opening (cold) | 16.55, 8.78, 1.64, 5.48 MB | 16.63, 8.82, 1.64, 5.47 MB |
| M, warm baseline (8 switches) | 22.83, 13.41, 1.91, 7.00 MB | 23.97, 13.70, 1.91, 7.71 MB |
| M, after 100 switches | 24.90 (+9.1 %), 13.70 (+2.2 %), 2.44, 8.33 MB | 26.27 (+9.6 %), 14.03 (+2.4 %), 2.44, 9.29 MB |
| M, after 200 switches | 25.38 (+11.2 %), 13.80, 2.48, 8.73 MB | 26.63 (+11.1 %), 14.11, 2.49, 9.67 MB |
| L, after opening (cold) | 34.39, 24.07, 1.99, 6.96 MB | 34.04, 24.15, 2.00, 6.73 MB |
| L, warm baseline (8 switches) | 67.32, 53.18, 3.03, 9.89 MB | 69.91, 54.45, 3.03, 11.23 MB |
| L, after 20 switches | 68.38 (+1.6 %), 53.31, 3.48, 10.38 MB | 71.42 (+2.2 %), 54.61, 3.49, 12.11 MB |
| L, after 40 switches | 68.72 (+2.1 %), 53.35, 3.50, 10.59 MB | 71.68 (+2.5 %), 54.65, 3.50, 12.34 MB |
| L, after 60 switches | 68.97 (+2.5 %), 53.35, 3.50, 10.85 MB | 71.91 (+2.9 %), 54.66, 3.51, 12.60 MB |

(Totals include what the API does not attribute. DOM nodes after 100 switches on M: 1 878 before, 1 770 after;
on L 5 856 and 5 139; event listeners 226 throughout.) No leak in either build: each further round adds less,
and the workers stay flat. After the change the warm baselines are about 1.1 MB (M) and 2.6 MB (L) higher: the
data worker's Scene memo (0.3 and 1.3 MB) and, on the UI thread, the view choices now kept per day (up to
six). A first run with only 2 days of warm-up on L (`after-all.json`) measured +22.6 % after 20 switches
(before: +20.0 %): its "warm" baseline held two of the three kept days; the table's runs warm up with four.
The switch time on M: median 86 ms in both builds (p90 90 ms). On L the slowest switches (p90 about 300 ms,
max about 820 ms in both builds) are the first ones after each measurement: three forced garbage collections
in a worker after 1.5 s of rest can drop compiled code, which the next step compiles again; nothing a person
does forces that.

Round 2 (`out/perf-r2/perf.mjs memory2`, the same procedure):

| Point | Round 2: total, data worker, layout worker, UI heap |
|---|---|
| M, after opening (cold) | 16.79, 8.98, 1.64, 5.47 MB |
| M, warm baseline (8 switches) | 24.10, 13.82, 1.91, 7.72 MB |
| M, after 100 switches | 26.37 (+9.4 %), 14.23 (+3.0 %), 2.44, 9.29 MB |
| M, after 200 switches | 26.95 (+11.8 %), 14.30, 2.49, 9.67 MB |
| L, after opening (cold) | 35.04, 25.15, 2.00, 6.73 MB |
| L, warm baseline (8 switches) | 70.69, 55.23, 3.03, 11.23 MB |
| L, after 20 switches | 72.07 (+2.0 %), 55.42, 3.48, 12.08 MB |
| L, after 40 switches | 72.38 (+2.4 %), 55.46, 3.50, 12.35 MB |
| L, after 60 switches | 72.73 (+2.9 %), 55.51, 3.50, 12.56 MB |

Still no leak. The data worker holds about 1 MB more on L than in round 1 (cold 25.15 against 24.15 MB, warm
55.23 against 54.45 MB): the open view built after the first answer, which a first step used to build, and the
last view's preparation, which the Scene memo keeps (section 10.1).

## 8. Screenshots (renders)

`out/perf/shots/` (git-ignored), from the production demo builds, 1280 × 800, both themes, each opened and
looked at:

| File | What it shows |
|---|---|
| `before-trace-{light,dark}.png`, `after-trace-{light,dark}.png` | Demo M, compute lens at `all`, the web group manager selected: its path rings, 7 traced lines in `accent.select` over their casings, the reach rings; the before and after files are byte-identical in each theme |
| `before-readout-progress-{light,dark}.png` | The bar with a read's progress in the readout: "Reading 30 Sept: 12 pages · 4,800 assets · 3.2 MB …", the elapsed time cut |
| `after-readout-progress-{light,dark}.png` | The same text on two lines, whole, beside the slider and before Speed; the bar keeps its height |
| `before-readout-error-{light,dark}.png`, `after-readout-error-{light,dark}.png` | A long Google message: one line cut before, two lines and an ellipsis after (the whole text in the tooltip and the status) |

The texts were put into the readout element by the script (a live read cannot run in demo mode); the layout
and the clamp are the stylesheet's. Rounds 2 and 3 changed nothing on screen (the labels their kept formatters
write are the same text; a day's snapshot and Graph are deep-equal to round 1's), so they took no new
screenshots.

## 9. Commands and their results

| Command | Result |
|---|---|
| `pnpm --filter @gcportrait/frontend test` (`npx vitest run` in `frontend/`) | green: 142 files, 1 319 tests |
| `pnpm --filter @gcportrait/graph test` / `@gcportrait/layout` / `@gcportrait/demo-data` / `@gcportrait/model` | green: 2 346 / 442 / 57 / 569 tests |
| `pnpm --filter @gcportrait/layout test:budget` | green: 48 of 48 strict budgets (S ≤ 6.1 ms, M ≤ 37.4 ms, L overview at `projects` 279.6 ms, XL at `folders` ≤ 101.7 ms through the worker; worker heap +0.3 MiB over 100 XL layouts) |
| `pnpm --filter @gcportrait/graph test:budget` | green: M built in 15.9 ms (median of 10), L 106.2 ms |
| `pnpm --filter @gcportrait/render-cli test` | green: 68 tests, the render golden unchanged |
| `npx vitest run --project tooling scripts/check-bundle-size.test.ts` | green: 18 tests |
| `node scripts/check-bundle-size.mjs --dist <after build>` | OK: UI thread 230.00 of 350 kB, workers 195.87 of 400 kB; "No zod on the UI thread (ADR 0029)." |
| `node scripts/user-docs.mjs` | OK: 8 guides current with the tree |
| `npx tsc -b` (root) | clean |
| `eslint` on every changed workspace and file | clean |
| `pnpm e2e <specs>` (every spec file, in three runs, on the Vite dev servers) | 86 of 87, then 68 of 68, then 61 of 61 passed; the first run failed one test, `diagram.spec.ts`'s hover check, which compared the drawing's markup during a hover and now leaves out the traced lines the painter puts on top (fixed, passed in the second run) |
| `pnpm format`, `pnpm provenance` | no file changed; provenance OK (2 476 files, 1 265 SPDX headers) |

The orchestrator runs the full `pnpm check`, `pnpm build`, `pnpm size` and `pnpm e2e` on the final tree.

## 10. Round 2: after the review of round 1

The review (2026-10-11) re-measured round 1 independently and found two blocking issues: the first timeline
step back from the snapshot's own day on L over 300 ms on fresh pages (314–343 ms) while the report said the
acceptance was met, and ADR 0029, its index, `docs/packages.md`, several comments and an e2e spec still saying
that the demo generator runs only in the data worker. It also listed minor ones: this review's commands table
split in two, the scripts not in the repository, figures that disagreed between documents, stale wording about
the traced lines, the timeline guide's transcript, no bar-level test of an extra tick that cannot be drawn,
lines over the hand wrap.

### 10.1 What changed

- **The open view built right after a Scene answer** (`frontend/src/diagram/pipeline/dataHandler.ts`,
  `WARM_AFTER_MS`: 0, a timer task, so a request already received goes first). A Scene drawn without a diff on
  a stored history's timeline, with a chip, has the view with every zone open built next, the view the next
  step's diff counts chips with: the review's suggestion. It reads no data and builds no other day; on L it
  takes about 5 ms, while the page lays the diagram out. The first step then builds only the new day's views,
  as every later step does. Two tests in `dataHandler.test.ts` (the step builds two views, not three; a newer
  Scene drops the job).
- **A view prepared once, finished many times** (`prepareView`, `buildPreparedScene`, `preparedViewKey` of
  `@gcportrait/graph`; `sharedPreparation` in `frontend/src/diagram/pipeline/sceneMemo.ts`). Steps (a)–(d),
  the scene tree and its badges do not depend on the detail level, the flips, the `depth` filter, the
  selection or the highlight; the scene builder now does them in `prepareView`, and the data worker keeps the
  last preparation, so the open view of a step and a chip expanded cost only the finish. The overview at
  `auto` on each demo organisation's own day, medians of nine in Node (`out/perf-r2/prepared-bench.ts`):

  | Organisation | From scratch | Prepare | Finish at `auto` | Finish with every zone open |
  |---|---|---|---|---|
  | M | 3.3 ms | 2.7 ms | 0.7 ms | 0.9 ms |
  | L | 17.4 ms | 14.1 ms | 3.3 ms | 5.1 ms |
  | XL | 171.8 ms | 141.6 ms | 15.5 ms | 25.5 ms |

  `buildSceneWithReport` is the two parts in a row, so every Scene, golden and baseline is unchanged (the
  layout's golden JSONs, the 32 SVG baselines and the render golden PNG pass as they are); a property test in
  `test/views/scene.property.test.ts` checks that a view finished from another view's preparation is the view
  built from scratch, and two tests what the key leaves out and that another lens is refused. In the browser:
  chips expanded on L median 77 ms (86 ms in round 1); on XL a step onto a day not built 1.50–1.80 s
  (1.66–1.92 s) and one onto a kept day 43–69 ms (93–119 ms).
- **The diff compares update times as text first** (`diffSnapshots` of `@gcportrait/graph`): the same text is
  the same instant, so only the times that differ as text are parsed, and only the three result lists are
  sorted. A step on L in Node (`out/perf-r2/diff-bench.ts`, two runs of four steps each): `diffSnapshots`
  5.8–11.6 → 1.3–4.5 ms, the whole `tickDiff` 12.7–15.5 → 7.9–10.7 ms. The diff's tests (order independence,
  antisymmetry, spellings of one instant, repeated names) pass unchanged.
- **The tick labels' formatters made once** (`frontend/src/timeline/ticks.ts`). The timeline bar made two
  `Intl.DateTimeFormat` per day per render; a CPU profile of the page put 11.6–13.2 ms of a step's UI-thread
  time in that one function (`out/perf-r2/wprof.mjs`). With one formatter per form, locale and time zone the
  page posts a later step's Scene request 2 ms after the key instead of 3–7 ms, and the page's busy time in a
  step went from 33–40 to 20–32 ms. (A formatter without a time zone keeps the viewer's zone as it was when it
  was made.)
- **Tests of the readout's new cases at the bar** (`frontend/src/timeline/extraTicks.bar.test.tsx`): a link
  naming an export the library still lists but the data worker no longer finds says it is no longer stored and
  shows the snapshot itself; stepping onto an export that cannot be read says it could not be drawn, with the
  reason (the timeline review's section 4.3, item 4, covered before only by `words.test.ts` with hand-built input).
- **Documents**: ADR 0029 amended (its amendment of 2026-10-11: the generator in the data worker and in a
  demo worker per job, the zod guard, the budgets revisited) and its row in the ADR index; `docs/packages.md`
  (the worker script's five roles, the bundle-budget note); the comments of `demo.ts`, `demo.test.ts`,
  `snapshots/library.ts`, the snapshot worker's `handler.ts`, `prepare.ts`, `protocol.ts` and `role.ts`,
  `DemoEntry.tsx`, `workers.ts`, `diagram.worker.ts`, `roles.ts` and `e2e/tests/snapshots.spec.ts`;
  `Drawing.tsx`'s header and `frontend/README.md` on the traced lines the painter clones, and the layout
  skill's §9 hover rule with that one exception; the figures that disagreed (reading XL's `projects` Layout
  41.9 → 28.3 ms everywhere, 27–33 % fewer elements, 8–10 React commits); the README lines over the hand wrap
  in `packages/catalog`, `packages/model` and `packages/demo-data`; the timeline guide's transcript
  (`docs/timeline.md`, run again on this tree); this section and the round-2 columns above; and a row for this
  review in `docs/README.md`. Not edited, being the orchestrator's: the build's own description of the `auto`
  ceiling, which still lacked the 100-rect exception (the layout skill §6 has it).

### 10.2 The first step back from the snapshot's own day

In turns on the two builds in the same session (`out/perf-r2/first.mjs`, demo L, a new context per run):

| Build | The first step, 1.5 s after the first draw | The first step after two minutes of rest | The next steps |
|---|---|---|---|
| Round 1 | 307–343 ms (batches of five: medians 324–338 ms) | 359, 360 ms | 249–282 ms |
| Round 2 | 276–296 ms (20 runs, median 288 ms) | 311, 317, 320 ms | 242–268 ms |

What is left shows in CPU profiles of the data and layout workers (`out/perf-r2/wprof.mjs` on an unminified
build of round 2, three steps on a fresh page, then two after two minutes of rest), in ms:

| Step | Replay (`historySnapshot`) | Ingest | Graph build | View preparation | Diff | GC | Layout |
|---|---|---|---|---|---|---|---|
| 1st, 1.5 s after the first draw | 18.9 | 55.9 | 94.7 | 21.6 | 8.6 | 7.6 | 46.7 |
| 2nd | 18.1 | 52.1 | 66.0 | 15.1 | 7.3 | 6.4 | 37.6 |
| 3rd | 17.8 | 52.9 | 61.1 | 14.0 | 7.0 | 21.7 | 37.7 |
| 1st after two minutes of rest | 21.7 | 61.9 | 118.1 | 26.1 | 9.5 | 24.0 | 53.4 |
| 2nd after it | 19.8 | 58.8 | 94.9 | 16.5 | 8.6 | 8.8 | 51.2 |

The day pipeline's code runs for the second time on the first step (once at the opening, for the snapshot
itself), and V8 compiles it fully only then: from the second step on, `buildGraphWithReport` and its callees
run as one optimised function (the profiles stop attributing time to the callees). After minutes of rest the
browser has dropped compiled code, so the first step pays that again and more. Two attempts that were not
kept:

- A throwaway Graph build of a 1 500-asset sample at idle, to have V8 compile the build before the first step:
  the first step 269–309 ms against 269–316 ms without it (four runs each, in turns), within the spread.
- The replayed day read as UTF-8 bytes instead of text (ingest splits bytes faster): 63 against 70 ms per L
  day in Node, but in Chromium XL's first diagram took 2.54–2.69 s against 2.47–2.50 s with text.

Round 2 concluded that only a day built before it is asked for would hide the rest (its replay, ingest and
Graph: about 150 ms on L, 1.5 s on XL, in the data worker), which is the prefetch the orchestrator decided
against (the timeline review's question 2), and left the first step after minutes of rest over the target
(311–320 ms). Round 3 (section 11) found the other way: most of that work was the same on both days, and is
now done once per history asset, so the step has far less code to run whether or not the browser kept it
compiled (197–205 ms after two minutes of rest).

### 10.3 Commands and their results (round 2)

| Command | Result |
|---|---|
| `pnpm --filter @gcportrait/frontend test` | green: 142 files, 1 324 tests |
| `pnpm --filter @gcportrait/graph test` | green: 14 files, 2 350 tests |
| `pnpm --filter @gcportrait/graph test:budget` | green: M built in 18.0 ms (median of 10; budget 150 ms), L 108.3 ms |
| `pnpm --filter @gcportrait/layout test` | green: 35 files, 442 tests (the golden JSONs unchanged) |
| `pnpm --filter @gcportrait/layout test:budget` | green: 48 of 48 strict budgets (L overview at `projects` 241.1 ms; worker heap +0.3 MiB over 100 XL layouts) |
| `pnpm --filter @gcportrait/ingest test:budget` | green |
| `pnpm --filter @gcportrait/render-cli test` | green: 7 files, 68 tests (the render golden unchanged) |
| `npx vitest run --project tooling scripts/check-bundle-size.test.ts scripts/user-docs.test.ts` | green: 2 files, 29 tests |
| `node scripts/check-bundle-size.mjs --dist <production build>` / `--dist <demo build>` | OK: UI thread 229.99 / 230.00 of 350 kB, workers 196.30 of 400 kB; "No zod on the UI thread (ADR 0029)." |
| `node scripts/user-docs.mjs` | OK: 8 guides current with the tree |
| `npx tsc -b` (root) | clean |
| `npx eslint` on the changed directories and files | clean |
| `pnpm e2e tests/timeline.spec.ts tests/diff.spec.ts tests/extra-ticks.spec.ts` | 18 of 18 passed (28.4 s) |
| `pnpm e2e` on the snapshots, diagram, search, disclosure, trace, drawer, controls and demo-only specs | 73 of 73 passed (1.4 min) |
| `pnpm format`, `pnpm provenance` | no file changed; provenance OK (2 481 files, 1 270 SPDX headers) |

The orchestrator runs the full `pnpm check`, `pnpm build`, `pnpm size` and `pnpm e2e` on the final tree.

## 11. Round 3: after the review of round 2

The review of round 2 (2026-10-11) measured it again on its own build and found two blocking issues: the first
step back from the snapshot's own day on L after two minutes of rest took 313–317 ms (target: under 300 ms),
and the first step on a fresh page was at the edge of the target rather than under it (277–331 ms in 20 runs
of round 2's `first.mjs`, 5 of them over 300 ms; 276–297 ms with the review's own frame-accurate script),
which section 1 and `frontend/README.md` called met. Its minor issues: a state-changing `git checkout` in
round 2 (round 3 ran none), the graph README's diff figure against section 10.1, the scripts not in the
repository, prose over the 110-column wrap here and in ADR 0029's amendment, the open-view job's cost claim,
the changeset's patch level for `@gcportrait/graph` despite new exports, the tick labels' formatters keeping
the time zone they were made in, a stray line break in `docs/packages.md`; and two left open: the build's description of the `auto` ceiling
(the orchestrator's file) and L at `all` while zooming (no target).

Round 3 builds no day before it is asked for (no prefetch on the snapshot's own day, as decided): it makes a
step do less.

### 11.1 What changed

- **A day read from its difference** (`frontend/src/diagram/pipeline/historyRead.ts`; `demo.ts` and
  `timeline/worker/replay.ts` read through it). A day of a history is its base with the daily mutations
  replayed (`snapshotAt`), so an asset no mutation touched is the same object on every day: on demo L 31 to 97
  of about 6 400 objects differ from one day to the next, and the project index never changes
  (`out/perf-r3/proj-churn.ts`). Ingest reads each line on its own, so the same object always reads as the same
  Asset. Every history asset is now read through `@gcportrait/ingest` once, the first time a day holds it, and
  every later day's snapshot holds that Asset. The first day read, and any day that differs in more than a
  quarter of its assets from the day read before, is read whole; any other day from its difference: only the
  lines of the assets no day read before go through ingest, with the day's options, and the day's counts are
  worked out as ingest works them out (`count`, `byType` in code-point order, `bytes` as the day before's less
  the lines it lost plus the lines it gained). Tests (`historyRead.test.ts`): every day of demo S and M,
  stepping back from the last and jumping about, deep-equal to ingest's read of the day's whole NDJSON
  (`stats.bytes` included); the lines ingest is given (the whole day, then the day before's new assets only,
  then none); a line ingest refuses (the day is read whole and shares nothing).
- **The Graph builder's memo** (`BuildMemo` in `packages/graph/src/memo.ts`, `BuildOptions.memo`). What steps
  2, 4 and 5 work out per asset (its node, and what its relation, `nestsIn` and `contains` rules produce
  through the catalog's engine) depends on the asset, its catalog entry and the snapshot's project index only;
  the memo keeps it by asset object while the catalog object and the project index's content stay the same.
  The data worker builds every Graph with one memo (`dataHandler.ts`), so a day's Graph evaluates the
  catalog's rules only for the assets the day changed. Tests: a property test (`src/build.property.test.ts`,
  150 random organisations) builds an organisation and two later days (assets kept as the same objects,
  changed, removed, projects given another id so that the index changes) with one memo and compares every
  build with a build without one, also under another catalog object; `src/memo.test.ts` checks that an
  unchanged asset's node is the very object built before, a changed one's is not, and that another catalog or
  project index starts afresh. `pnpm --filter @gcportrait/graph test:budget` prints a day of L's history built
  after the next day with and without the memo.
- **The tick labels follow the viewer's zone** (`frontend/src/timeline/ticks.ts`; the review's minor issue):
  the kept formatters are keyed by the viewer's locale and time zone too, looked up once per run of code (one
  `Intl.DateTimeFormat` per render), so a zone changed while the page is open shows in the next render. A test
  changes `TZ` between two labels.
- **Tried, not kept**: the replayed day as UTF-8 bytes again (first steps 238–272 ms against 232–255 ms with
  text, in turns, on the build with the memo but before the difference read); keeping each asset's NDJSON line
  between days (15 ms a step, for 9.6 MB of text per day of L, about 80 MB on XL, kept for the page's life).
- **Documents**: the graph README (the memo in the API table and under "Performance"; the diff figure now as
  in section 10.1, 1.3–4.5 ms instead of 5.8–11.6 ms), the frontend README (its "Performance" section and the
  timeline's "Cost" paragraph with round 3's figures and spreads), `docs/packages.md` (the stray line break;
  rows for `BuildMemo` and the two-part Scene build of round 2), `docs/timeline.md` (its "Cost" limit and the
  transcript, run again), ADR 0029's amendment (its figures now this round's) and this document wrapped at
  110 columns, as is the prose this pass added to the frontend, layout, catalog and demo-data READMEs and the
  layout skill, the changeset
  (`@gcportrait/graph` a minor change: `BuildMemo`, `prepareView`, `buildPreparedScene` and `preparedViewKey`
  are new exports), and the comment on the open-view job's cost (`WARM_AFTER_MS`: when another view's
  preparation is kept, it prepares afresh, about 17 ms on L and 150–170 ms on XL in Node, and a request
  arriving meanwhile waits).

### 11.2 Measured

In turns with the round-2 build in the same session, as in section 2 (the same machine and browser; load
average 1.6 to 5.5). The rested runs used a byte-identical copy of the round-3 build on another port.

| Case | Round 2 build | Round 3 build |
|---|---|---|
| First step back from the snapshot's own day on L, fresh page, 1.5 s after the first draw (`first.mjs`) | 271–306 ms in 10 runs, median 290 ms, 2 over 300 ms | 163–188 ms in 20 runs, median 182 ms |
| The same with the review's frame-accurate script (`step.mjs`, 10 runs) | (the review: 276–297 ms; 272–305 ms waiting one frame more) | 165–187 ms, median 178 ms; second steps 151–161 ms |
| The same after two minutes of rest (`first.mjs … 120000`) | 296, 324 ms | 197, 199, 203, 205 ms |
| The later steps of the fresh-page runs | 238–269 ms | 122–220 ms, most 143–167 ms |
| Steps back onto days not built, after the other interactions (`perf.mjs interact`, two runs for round 3) | 210–298 ms | 113–194 ms |
| Steps forward onto days built again / onto kept days | 179–181 ms / 26–31 ms | 67–81 ms / 30–32 ms |
| XL: steps onto days not built / onto kept days (`xlticks`) | 1.50–1.80 s / 43–69 ms (round 2's session) | 711–749 ms / 44–80 ms |

Time to first diagram (three runs each): S 219–240 ms, M 280–284 ms, L 605–672 ms (median 621 ms), XL
2.54–2.63 s (median 2.56 s), as in round 2: the first read and Graph do what they did, and keep their
per-asset results. Lens switches median 38 ms (max 81–92 ms), chips expanded 70–98 ms (the round-2 build in
the same session 71–99 ms), search jumps 7–117 ms. Panning and zooming the L and XL defaults: no long task and
no frame gap over 50 ms; L at `all` (no target): no long task while panning (54 of 113 frame gaps over 50 ms),
5 while zooming (the longest 79 ms), as in round 2.

A step's stages (section 4.2): the first step's "Replay and ingest" 1–2 ms (round 2: 68–84 ms), its Graph
49–53 ms (92–98 ms), "Scene and diff" 35–39 ms, the layout 46–57 ms, drawn at 175–186 ms. In Node
(`out/perf-r3/day-bench2.ts`, the data worker's read and Graph of each day stepping back from L's own day):
read 92–103 → 5–8 ms, Graph 112–145 → 56–68 ms; on XL read 0.83–0.93 s → 54–66 ms, Graph 0.98–1.09 s →
0.49–0.52 s. The budget test prints a day of L built after the next day in 53.2 ms with the memo and 118.5 ms
without (median of five).

Memory (`perf.mjs memory2`, the procedure of section 2; XL with `memxl`: opened, 4 switches, 6 more), in MB,
total / data worker:

| Point | Round 2 build | Round 3 build |
|---|---|---|
| M, after opening (cold) | 16.73 / 8.98 | 17.02 / 9.20 |
| M, warm baseline (8 switches) | 24.06 / 13.82 | 20.91 / 10.77 |
| M, after 100 switches | 26.34 (+9.5 %) / 14.22 (+2.9 %) | 23.81 (+13.9 %) / 11.54 (+7.1 %) |
| M, after 200 switches | 26.91 (+11.8 %) / 14.30 | 24.29 (+16.2 %) / 11.65 |
| L, after opening (cold) | 35.07 / 25.18 | 36.83 / 26.84 |
| L, warm baseline (8 switches) | 70.62 / 55.25 | 48.07 / 32.68 |
| L, after 20 switches | 72.12 (+2.1 %) / 55.44 | 49.74 (+3.5 %) / 33.08 |
| L, after 60 switches | 72.78 (+3.1 %) / 55.52 | 50.42 (+4.9 %) / 33.15 |
| XL, after opening (cold) | 168.58 / 153.09 | 183.90 / 168.29 |
| XL, after 4 switches | 338.41 / 312.88 | 218.84 / 193.40 |
| XL, after 6 more | 338.91 / 312.98 | 219.43 / 193.50 |

No leak: each further round adds less (the data worker +0.11 MB on M from 100 to 200 switches, +0.07 MB on L
from 20 to 60). The days the data worker keeps now share their assets and nodes, so the warm baselines are
lower (M 3.2 MB, L 22.6 MB, XL 119.6 MB). M's percentages are higher because their base is: the data worker
keeps, for each history asset a day has held, the Asset read for it and what the builder worked out for it,
which grows with the days visited up to the history's size (about 0.8 MB on M over 100 switches), and the page
and the layout worker grow as in round 2; M's total after 100 switches is 2.5 MB below round 2's. The cost is
at opening, where the first Graph's per-asset results are kept for the next day: L +1.7 MB, XL +15.2 MB in the
data worker.

Bundles: UI thread 230.10 kB of 350 kB, workers 197.13 kB of 400 kB (+0.83 kB: the memo and the difference
read; the demo build 230.11 / 197.13 kB), "No zod on the UI thread (ADR 0029)."

Left open: the build's description of the `auto` ceiling still lacks the exception for views of at most 100
rects (the orchestrator's file; the layout skill §6 has it); L at `all` (no target) pans at about 29 frames a second, bound by painting (section
5), which a composited pan layer would change (a renderer task); the timeline review's section 4.3, items 5–8 and 10
(section 6.8); the measurement scripts under `out/` (git-ignored; the budget tests reproduce the Node figure);
round 1's questions on the view choices fetched per day and on demo XL's history generated twice right after
its "Try the demo" job. A stored history's own snapshot (an imported bundle) is decoded from IndexedDB, not
read through `historyRead.ts`, so its first step back reads the day whole and builds its Graph afresh, as in
round 2; from the next step on its days are read from their differences too. The demo organisations, which the
targets are measured on, read their own day through it.

### 11.3 Commands and their results (round 3)

| Command | Result |
|---|---|
| `pnpm --filter @gcportrait/graph test` | green: 15 files, 2 354 tests (the memo's property and unit tests among them) |
| `pnpm --filter @gcportrait/graph test:budget` | green: M built in 18.2 ms (median of 10; budget 150 ms), L 126.2 ms; a day of L after the next day 53.2 ms with the memo, 118.5 ms without |
| `pnpm --filter @gcportrait/frontend test` | green: 143 files, 1 329 tests |
| `pnpm --filter @gcportrait/layout test` / `test:budget` | green: 35 files, 442 tests (the golden JSONs unchanged) / 48 of 48 strict budgets (L overview at `projects` 224.4 ms, 279.7 ms through the worker; worker heap +0.3 MiB over 100 XL layouts) |
| `pnpm --filter @gcportrait/ingest test:budget` | green: best of three 926 ms (budget 1 500 ms) |
| `pnpm --filter @gcportrait/render-cli test` | green: 7 files, 68 tests (the render golden unchanged) |
| `npx vitest run --project tooling scripts/check-bundle-size.test.ts scripts/user-docs.test.ts` | green: 2 files, 32 tests |
| `node scripts/check-bundle-size.mjs --dist <production build>` / `--dist <demo build>` | OK: UI thread 230.10 / 230.11 of 350 kB, workers 197.13 of 400 kB; "No zod on the UI thread (ADR 0029)." |
| `node scripts/user-docs.mjs` | OK: 8 guides current with the tree |
| `npx tsc -b` (root) | clean |
| `npx eslint frontend/src/diagram frontend/src/timeline packages/graph/src packages/graph/test --max-warnings=0` | clean |
| `pnpm e2e tests/timeline.spec.ts tests/diff.spec.ts tests/extra-ticks.spec.ts` | 18 of 18 passed (29.1 s, and 29.7 s for the timeline guide's transcript) |
| `pnpm e2e` on the snapshots, diagram, search, disclosure, trace, drawer, controls and demo-only specs | 73 of 73 passed (1.4 min) |
| `pnpm format`, `pnpm provenance` | the formatter changed four of this round's test files (line breaks); provenance OK (2 494 files, 1 283 SPDX headers) |

The orchestrator runs the full `pnpm check`, `pnpm build`, `pnpm size` and `pnpm e2e` on the final tree.
