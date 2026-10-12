<!-- SPDX-License-Identifier: MIT -->

# 0029. Bundle budgets by thread: 350 kB for the UI thread, 400 kB for the workers

- **Status:** accepted; amended by the performance pass of 2026-10-11 (the demo generator in two workers, the zod
  guard), see "Amendment (2026-10-11)"
- **Date:** 2026-10-10
- **Deciders:** Florian Chrometz (maintainer); decided by the build orchestrator on the maintainer's behalf on
  2026-10-10, under the standing instruction to make routine design calls. The maintainer may reopen it.
- **Related:** [ADR 0035](0035-decisions-inherited-from-the-implementation-plan.md) §5 (work off the UI thread);
  skill gcp-diagram-layout §7; [docs/contributing.md](../contributing.md) ("Continuous integration")

## Context

The implementation plan of October 2026 set one budget: "SPA ≤ 350 kB gzipped excluding fonts". `scripts/check-bundle-size.mjs` summed every
JavaScript and CSS file of the build, so the code the module workers load (ingest, the graph and scene builder,
the catalog engine, the layout engine, search, the demo generator) counted against the same 350 kB as the code
the browser must parse before the first paint. The app's walkthrough of 2026-10-10 measured 393.76 kB: 210.05 kB on the UI thread
(200.30 kB of script, 9.75 kB of CSS) and 183.71 kB in the workers, which load after the page is up, in parallel
with it, and never block input. ADR 0035 §5 puts ingest, the graph build and the layout off the UI thread on
purpose, so the work a diagram needs grows there. The walkthrough's source maps also showed waste on both sides: zod
was bundled on the UI thread (about 25 kB gzipped) for nothing but decoding the URL hash and a few enum lists,
and the demo generator (about 69 kB) sat in a chunk the data worker and the snapshot worker both loaded
statically, also when no demo organisation was asked for.

## Decision

1. **Two budgets, gzipped, fonts and the fetched JSON data tables excluded.**
   - **UI thread: 350 kB.** The entry script, every chunk it imports statically, and the CSS `index.html` links.
     A lazily imported chunk counts here only when it is part of the first paint of `/diagram`
     (`DIAGRAM_FIRST_PAINT` in the script names those chunks; none today). Other lazy UI chunks are listed and
     count against neither budget.
   - **Workers: 400 kB in total.** Every worker script the UI thread starts and every chunk a worker loads,
     statically or on demand.
2. **`pnpm size` classifies the build by reading it.** `index.html` names the entry; each JavaScript file's own
   references name the rest (static and dynamic imports, `new Worker(…)`, Vite's preload lists). The build
   publishes neither source maps nor a manifest, and the script needs neither. A file nothing reaches counts
   against the UI budget, so a gap in the classification can only make the check stricter. It prints both
   tables and both totals with their budgets and fails when either is over.
3. **What stays off the UI thread.** The URL-hash codec in `@gcportrait/model` decodes without zod
   (`codec/normalize.ts`: plain predicates proved equal to the schemas by property tests against a zod-based
   reference); the vocabularies and the relation table the UI reads (`LENS_IDS`, `isSnapshotRef`,
   `RELATION_KINDS`, …) come from modules that import no zod. The schemas stay the definition and validate
   where it matters: worker messages, stored and imported snapshots, catalog data, tests. The demo generator
   lives only in the data worker, loaded on first use (`diagram/pipeline/demo.ts`): the data worker draws demo
   organisations and prepares them for "Try the demo"; the snapshot worker imports files and replays histories
   with `@gcportrait/demo-data`'s generator-free `history/replay.ts`. The catalog and the icon table stay
   fetched JSON tables. (Amended on 2026-10-11: "Try the demo" runs in a demo worker of its own, so the generator
   lives in two workers, never on the UI thread; see the amendment below, which holds where it differs.)
4. **Target.** The UI thread is kept at or under 320 kB so the work still to come then (sign-in, the live
   import, the timeline) has room; the performance pass revisits both budgets.

## Amendment (2026-10-11)

The performance pass of 2026-10-11 (its targets are in the gcp-diagram-layout skill §7) changed where the demo
generator runs and turned the zod check into a guard. Items 1, 2 and 4 stand as
written.

1. **The demo generator runs in workers only: the data worker and a demo worker per job.** The data worker
   still loads it on first use to draw a demo organisation (`demo:<size>`, `diagram/pipeline/demo.ts`). "Try
   the demo" no longer runs there: preparing demo XL for storage (its history generated, read and encoded)
   takes seconds, and the data worker, which answers one request at a time, held every Scene request behind it
   (found in the review of the budget split). The page now starts a demo worker for each job, a fifth role of the same worker script
   (`diagram/pipeline/demoRole.ts`, `createBrowserDemoJob` in `diagram/pipeline/workers.ts`), and terminates
   it when the job settles. It answers the data protocol's `demo` request and loads the same generator chunk,
   so the workers' budget counts the generator once. The UI thread and the snapshot worker still load no
   generator. Measured in the review: demo M opened during an XL job draws in about 0.25 s instead of 2.35 s;
   the price is that opening demo XL right after its job generates its history once more, in the data worker
   (about 1.3 s).
2. **`pnpm size` fails on zod on the UI thread.** `scripts/check-bundle-size.mjs` searches every JavaScript
   file the UI thread loads (initial, lazy and unclassified) for zod's minified signatures (`._zod`, the
   `"$Zod…"` constructor names, `"ZodError"`, zod 3's type names) and fails, naming the files, whatever the
   sizes; the workers may bundle zod. The source-map check by hand under Consequences is no longer the only
   way to find out.
3. **The budgets were revisited (item 4) and stand**: the pass's production build is 230.10 kB on the UI thread
   and 197.13 kB in the workers (gzipped), with the UI thread still under item 4's 320 kB target.

## Consequences

- The split measured the production build at **184.58 kB on the UI thread** (174.83 kB script, 9.75 kB CSS;
  from 210.05) and **184.91 kB in the workers** (from 183.71), both green; `pnpm size` prints the table per
  chunk.
- Splitting chunks now helps the UI budget: a route or a feature moved behind a dynamic import leaves the UI
  thread's initial chunks unless it is drawn on the first paint of `/diagram`, which the script has to be told.
- Moving work into a worker no longer competes with the first paint for the same budget, but the workers have a
  ceiling of their own, so a worker-side dependency still needs a reason.
- A UI-thread import of a zod schema from `@gcportrait/model` brings zod back (about 25 kB): use the zod-free
  exports there. Since the amendment `pnpm size` fails on it; to see where it comes from, build with
  `--sourcemap` into a scratch directory, never into `frontend/dist`, and attribute the bytes by source map.
- `scripts/check-bundle-size.test.ts` covers the classification (entry, static, lazy with its stylesheet,
  first-paint lazy, worker and its chunks, unclassified files) and both budgets.

## Alternatives considered

- **Raise the single budget** (to about 400 kB): keeps counting worker code against the first paint, so moving
  work off the UI thread, which ADR 0035 §5 asks for, would cost budget like adding it to the UI thread.
- **Keep 350 kB for everything and trim only**: zod and the demo generator account for about 26 and 69 kB, but
  the generator is needed in a worker, and the work still to come added worker code (the live import) and UI
  code (the timeline) alike; the budget would fail again for the wrong reason.
- **Exclude the workers entirely**: nothing would stop the worker bundles from growing without notice.
