<!-- SPDX-License-Identifier: MIT -->

# 0027. Gutter routing rules beyond skill §5: port lines, border hugging, lane holders, hub bundles

- **Status:** accepted (2026-10-10; rule 4 as revised by the second polish round the same day: single-pass
  mode by the first pass's search work, with a one-round band, instead of a lane-holder count)
- **Date:** 2026-10-10
- **Deciders:** Florian Chrometz (maintainer); proposed by the layout polish of 2026-10-10; rule 4 revised by
  its second round; accepted on the maintainer's behalf by the build orchestrator on 2026-10-10 under the
  standing instruction to make routine design calls. The maintainer may reopen it.
- **Related:** skill gcp-diagram-layout §5, §7, §8; ADR [0006](0006-clean-room-layout-engine.md), ADR
  [0026](0026-stacks-and-near-ties-in-packing.md)

## Context

Skill §5 specifies routing as a shortest path over the gutter centre-lines with cost = length + 40 per bend +
200 per lane already used, three passes, and one pass above 1 500 edges. The router as first built already
went beyond it (hub bundles, per-gap widening, a second widening round, 6 px facing-port stubs, `secures`
routed as lines) without an ADR. The top finding of the visual review of 2026-10-09 was the collapsed overviews (M at
`auto`): dim lines detoured around the canvas margins, hugged zone borders and crossed folders they had
nothing to do with, and L at `projects` (skill §8's check view, 2 658 edges) fell into single-pass mode and
drew bars of squeezed lines. The debug renders showed why: a chip at the end of a row can only reach its
container's padding ring (the stub's gutter), so every route out of a nested chip turned along the ring
(a doubled border, an underline under a title) before it found a gap that leaves the zone; 200 per lane made
the busy corridor between two folders dearer than a detour around the canvas; and the many `shares` and
`attaches` edges into one Shared VPC host were bundled (13 per trunk), so the edge count overstated the work.

## Decision

1. **Port lines.** Where a rect's port faces a side nothing stands beside (last of its row, first of its row,
   or in the last row for a bottom port), a line runs from the stub's gutter straight out through every zone
   it is the last of, to the first gap beside one (or the canvas margin): one piece per container, so the
   route's scope applies. Only its edge (or, at a hub bundle's shared port, the bundle) may run along it, on
   lane 0, so a route leaves a nested chip in one straight run; others may cross it. None on a top side, none
   for a port inside a containing zone, and none where a gutter line runs alongside it, another port's stub
   runs on it, or another port line meets it at nearly the same coordinate. `src/portlines.ts`.
2. **Border hugging costs more, capped per side; the canvas margin costs most.** A ring side between its
   zone's corners (inside the padding band, along the border) costs `hugFactor` (1.5) × its length, but at most
   `hugCap` (320 px) more than its length over the whole side: on a side longer than 640 px the surcharge per px
   falls in proportion (Workloads' 12 024 px ring top in L at `projects` costs 1.027 × per px). The canvas's
   ring, its margin, costs `marginFactor` (2) ×, uncapped. Every gap costs its length, whether a child borders it on both sides, on one
   or on none, and so does every line through free space (a ring side's extension beyond its zone's corners, a
   port line). Two defects shaped this rule, both of one kind: a line dearer per px than another one running
   parallel to it sends routes the long way round to reach the cheaper one.
   - The first version also charged a gap's stretches with a child on one side only at 1.5 ×. Below a short zone
     beside a tall one that made the gap dearer than the short zone's ring sides, which run on down through the
     same free space beside it, and in L at `projects` 26 routes went down past their target into the canvas
     margin, across, and up to 7 900 px along such a line to rejoin the gap they had left (the polish's review,
     1).
   - The second version charged every ring side 1.5 × its whole length. Across a wide zone the only gutters in
     a route's scope are the zone's ring top under its header and the gaps between its rows of children, so
     avoiding 9 000 px of a ring top (4 500 px of surcharge) paid for a drop of 2 000 px to a row gap and the climb
     back: in L at `projects` 140 drawn routes ran more than 1 000 px past both of their ends and 69 more than 2
     000 px, the worst 2 528 px (`invoice-mailer` → `vpc-shared-dev`: 15 798 px for a Manhattan distance of 10
     678; the polish's review, round 2).

   With the cap, avoiding a border is worth at most `hugCap`, so a route goes at most about 160 px out of its way
   and back (plus two bends) to avoid one: it still takes the gap beside a short ring side (M's folders keep
   their routes off the ring tops under their titles: the M views at `auto` route exactly as without the cap),
   and runs along a long one when that is the shortest way. The margin is mostly used to reach the side of an
   outermost rect that faces the canvas edge; the cap also lets a route round an outermost rect's corner
   through it onto a quiet long ring side when the gap it would otherwise take is busy (the three lines in L
   networking at `auto`, under Consequences). `src/testing/quality.ts` measures both
   defects: `margin`/`marginEdges` (routes in the canvas margin) and `overshoots`/`worstOvershoot` (how far a
   route runs past both of its ends, the farthest of its points outside the box around its two ports).
   `src/route.test.ts` keeps a small case of each (a short folder beside a tall one; a wide folder whose row of
   tall sub-folders lies between a route and the only row gap), the second asserting that the uncapped rule
   would drop below the row; `test/golden.test.ts` checks that no route of L at `projects` enters the margin or
   runs more than 1 000 px past both of its ends.
3. **Lane pressure is 50 per lane already in a gutter** (was 200), still spread over the gutter's length:
   lanes widen their gutter, so a busy corridor between two folders is cheaper than a detour around one.
4. **Single-pass mode is decided by the first pass's search work** (the second polish round; the first counted lane holders, below).
   The first pass searches exactly and counts the A* states it settles (`report.routing.work`: deterministic,
   and a measure of routing time, as the first pass's search is most of it). Once it has settled
   `singlePassWork` = 420 000 states it searches the rest of its edges with the weighted estimate (× 1.5,
   `SINGLE_PASS_WEIGHT`: each route costs at most 1.5 × the cheapest) and is final: single-pass mode, no
   widening. Between `oneRoundWork` = 340 000 and that, a band: three-pass mode with one widening round at
   most, so a view whose routing work grows loses one round before it loses the widening, and stays within its
   budget (a round on an L-sized view costs 60–120 ms). The band is the form of hysteresis a stateless layout
   can have (it keeps no memory of an earlier decision): no single threshold separates "widened" from
   "squeezed", and the thresholds sit far from the views near them.

   | View | Edges / lane holders | Exact first-pass work | Mode |
   |---|---|---|---|
   | L overview `projects` | 2 658 / 1 234 | 290 252 | three-pass, 2 rounds (17 % below the band, 45 % below single-pass) |
   | L load-balancing `networks` / `projects` | 1 861 / 1 239; 1 858 / 1 129 | 281 267; 159 553 | three-pass |
   | L load-balancing `all` | 2 168 / 1 281 | 520 348 | single-pass (switches at 420 000; 448 131 in all) |
   | L overview `networks` / `all` | 2 665 / 1 357; 2 971 / 1 434 | 548 033; 827 309 | single-pass (458 195; 549 200 in all) |
   | XL × three lenses at `folders` | 366–678 / 6–18 | 65 200–161 768 | three-pass |

   Counts do not measure the cost. The first round's threshold, 1 250 holders, left L at `projects` 16 holders to spare,
   while L load-balancing at `networks` (1 239 holders) costs about as much and at `all` (1 281) almost twice
   as much; and a tenth more edges like L at `projects`'s own (every tenth edge again the other way round) add
   about a third to its work (380 776 states): under the holder count that change flipped it into single-pass
   mode (1 382 holders), now it lands in the band and lays out in 253 ms in-process with one round, against
   246 ms for the view itself with two (`test/golden.test.ts` checks both directions and the margins). The
   band is what lets the single-pass budget sit that high: a view near it with two rounds would not fit the
   400 ms budget through the worker (L overview at `networks`, forced into three passes, took 404 ms
   in-process with two rounds and 350 ms with one; L load-balancing at `all` 321 and 258 ms).

   The single-pass views now search their shortest edges exactly up to the budget before switching, which
   costs time and buys routes (runs without a clear lane: at most 74, against up to 276 when they were
   searched weighted from the first edge; squeezed lines 487–928, as before): with `test:budget` (strict, 48
   of 48 passed, load average 4–6.7) L overview at `all` takes 254.4 ms through the worker (214.1 after the first round)
   and 204.9 ms in-process (165.2), L load-balancing at `all` 179.7 ms (131.0) and 142.6 ms (102.8); L
   overview at `projects`, unchanged in mode and routes, 305.5 ms through the worker (298.8). Over the 16
   views `measure` covers, 189 routes run more than 1 000 px past both of their ends (165 after the first round): 102 and
   63 in the two single-pass L views at `all` (98 and 43), whose exactly searched routes take longer ways
   where the weighted search took shorter, squeezed ones; the other 14 views route exactly as before.

5. **Passes.** Route; then up to `wideningRounds` = 3 rounds (2 above `lateRoundsUpTo` = 500 holders) of
   widening the gaps and ring sides whose lanes do not fit (per gap, through the gutter hook), re-packing with
   the arrangements pinned, and laying every route onto the widened gutters (same pieces, turns and lanes;
   re-searched only where gutters no longer line up). A round runs only while some lane does not fit.
6. **Hub bundles** (already built with the first router, recorded here): the edges of one kind that meet one rect at the
   same end are bundled from `bundleMin` (3), and on a side that more ports face than it holds from two: one
   shared port and one trunk with one head, members paying 0.9 of the length where the trunk runs; one bundle
   per kind, so a hub with `shares` and `attaches` edges has two trunks.
7. **Facing ports** sit on slot grids half a port spacing apart, so stubs of rects facing each other across a
   gap may run 6 px apart (lanes keep 8 px); a run along a port line keeps a stub's clearance.
8. **`secures`** edges are routed as lines like every other kind; the renderer draws them as overlays. **Self
   edges** (both ends at one rect after re-targeting into a chip) are not drawn and are counted in
   `report.routing.dropped`; the Scene never holds an edge from a node to itself.
9. `report.warnings` are sorted in code-point order, so a Scene whose children or edges come in another order
   gives a byte-identical Layout, report included.

## Consequences

Measured with `scripts/measure.ts`'s quality metrics (`src/testing/quality.ts`: total edge length, bends,
length along a single border, crossings, the length in the canvas margin outside the box around the top-level
rects with the number of edges that have any, a bundle's coinciding trunk counted once, and the routes that run
more than 1 000 px past both of their ends with the worst such distance) on the layout before the polish (`main` at
`9229dd2`, measured with the same metrics) and after it (with the polish's sizing and packing too):

| View | Length | Bends | Border hugging | Crossings | Canvas margin (edges / px) | Overshoots (worst) | Canvas |
|---|---|---|---|---|---|---|---|
| M overview `auto` | 25 714 → 22 325 | 271 → 223 | 12 705 → 7 661 | 103 → 153 | 0 / 0 → 0 / 0 | 0 (294) → 0 (270) | 1630 × 1024 → 1815 × 1188 |
| M networking `auto` | 27 961 → 21 869 | 213 → 187 | 17 880 → 6 840 | 75 → 122 | 29 / 4 492 → 1 / 96 | 0 (367) → 0 (254) | 1690 × 1260 → 1861 × 1184 |
| M load-balancing `auto` | 11 935 → 12 432 | 141 → 114 | 5 837 → 5 074 | 17 → 34 | 1 / 56 → 1 / 56 | 0 (836) → 1 (1 048) | 1470 × 976 → 1709 × 1128 |
| L overview `projects` | 1 203 073 → 1 392 568 | 15 113 → 13 417 | 443 681 → 638 637 | 7 360 → 8 075 | 0 / 0 → 0 / 0 | 0 (816) → 0 (994) | 13090 × 7548 → 13673 × 9228 |

Over 16 views (S, M and L at `auto`, M and L at `all`, L at `projects`): length 9.11 → 8.45 M px, bends
59 711 → 57 894, border hugging 4.76 → 3.92 M px, routes in the canvas margin 1 263 → 13 (458 732 → 2 048 px;
L overview at `auto` had 237 and L load-balancing at `all` 743), detours (more than twice, and 200 px longer
than, their ports' distance) 427 → 360, routes more than 1 000 px past both of their ends 723 → 165 and drawn
routes more than 2 000 px past them 196 → 0, crossings 51 264 → 58 587. Bends fall 12 %–19 % and border hugging
13 %–62 % in the M overviews, length by up to 22 %. Crossings rise (routes leave chips straight and cross the
corridors they used to run along), and the canvases grow with the wider chips (ADR 0026).

Against the second version of rule 2 (no cap) the routes past 1 000 px fall from 397 to 165 and the drawn ones
past 2 000 px from 69 to 0, but border hugging rises from 3.49 to 3.92 M px: routes that ran in a busy gap now
take a quiet long ring side, whose surcharge the cap makes small (M overview at `all` 106 136 → 139 635, L
networking at `all` 205 824 → 276 773; the M views at `auto` route exactly as before). 13 routes are left in
the canvas margin (2 048 px): the firewall endpoint's `uses` lines and the firewall policy's `secures` lines
in the networking views (96–368 px), the Cloud Armor `secures` line in each load-balancing view (56 px), one
`shares` bundle member in M networking at `all` (88 px), and in L networking at `auto` three lines between
project chips (224–312 px) that come down the blank area under Platform and round the bottom-left corner of
Workloads through the margin onto Workloads' ring bottom, which the cap makes cheaper than the busy row gap
they took without it (none there in the second version; 3 with 2 648 px before the polish). Of the 165 routes past 1
000 px, 141 are in the two L views at `all` that route in one pass with the weighted search (98 and 43,
against 302 and 416 before); 19 in L networking at `all` (3 before), 18 of which already run 800–1 228 px past
their ends on a length-only first route over the packed gutters (no pressure, hugging or margin cost: a wide
zone's ring top or a row gap far away is the only gutter across it in the route's scope), which the widening
then stretches; 1 in M overview at `all` (1 009 px on the length-only route); 1 in M networking at `all`, a
`shares` route that the re-route searches again with the gutters it took full and sends 1 119 px past its
source before it turns back (132 px in the first pass; the capacity rule under "still open"); and the
`secures` lines of M and L load-balancing at `auto` and M load-balancing at `all` (one more is among L
load-balancing's 43). A `secures` route from a lone card in the root's card row (Cloud Armor in the
load-balancing views) runs its stub to the canvas ring on the right, because the card block has no gutter
beside its last column, and comes back along the gap below the card row: 1 048 px past its ends in M
load-balancing at `auto`, 14 039 px in L load-balancing at `all`. The renderer draws `secures` as overlays, so
these lines are not seen, but they hold lanes; a gutter beside a card block's last column (src/gutters.ts)
would fix it and moves every golden, so it is left open.

L at `projects` now widens its gutters: 3 squeezed lines instead of 583 and no stretch without a clear lane (9
before), at the cost of a 27 % larger canvas and more length and hugging (the widened rings carry the lanes,
and Workloads' ring top under its header carries the routes across Workloads above its folders, as before
the polish). Its farthest routes, under 1 000 px, run up from a project in the top row of folders to that ring top;
its detours (94 against 91) are short routes inside projects round a card or two. The strict budgets hold
through the worker (load average about 3.3–3.9): L overview `projects` 298.8 ms round trip (272.9 ms in the
worker, 236.8 ms in-process), L overview `all` single-pass 214.1 ms, XL overview `folders` 102.3 ms.
`test/golden.test.ts` keeps every golden view free of squeezed lines and overlaps (M networking at `all` needs
the third round) and checks L at `projects` in three passes, with no route in the canvas margin and none more
than 1 000 px past both of its ends; `test/performance.test.ts` and `test/worker.test.ts` time L at `projects`.

Still open: lanes are assigned lowest-free in routing order, not in an order that avoids crossings at a
corridor's ends; edges into a chip in the last row may leave it downwards along a port line and swing under
the folder (M networking at `auto`: about 550 px under Workloads); the re-route's capacity rule can send a
re-searched bundle round a full padding ring. The `shares` and `attaches` trunks into one host run as two
parallel trunks on purpose: the kinds are drawn differently (`shares` dashed, `attaches` solid; style skill
§4) and a member's dashes are drawn from the bundle's end so that they coincide along the trunk, so one trunk
for both kinds would lay a solid line over a dashed one; one trunk per host needs a style decision for a mixed
trunk first.

## Alternatives considered

- **Charging a gap beside one child only as hugging** (this ADR's first version): the 26 U-turns through the
  margin in L at `projects` described under rule 2, 62 routes in the margin over the 16 views, 355 detours.
- **Charging every ring side 1.5 × its whole length** (the second version, without `hugCap`): the 140 routes
  in L at `projects` more than 1 000 px past both of their ends described under rule 2 (69 more than 2 000 px);
  over the 16 views 397 past 1 000 px and 69 drawn routes past 2 000 px, length 8.33 M px, border hugging
  3.49 M px, crossings 59 651. The M views at `auto` route identically with and without the cap.
- **A cap of 120–800 px**: L at `projects` has no route past 1 000 px with any of them. 240 and below let
  routes into the M folders' ring tops under their titles (border hugging in M overview at `auto` 9 206 at
  240, 9 550 at 120, against 7 661); 320–800 change nothing in the M views at `auto` and leave 164–170 routes
  past 1 000 px over the 16 views. 320 (the full 1.5 × up to a 640 px side) has the fewest crossings of them
  (58 587; 60 789 at 400) and no drawn route past 2 000 px (one at 400, 2 024 px in L networking at `all`).
- **A cap per run along a border instead of per side** (not built): the surcharge would depend on how far the
  route has already run along the border, which a search state of node and axis does not hold; adding it
  multiplies the states, and L at `projects` has no budget for that. Per side, the cost stays a property of
  the segment: a route along part of a long side pays that part's share of `hugCap`.
- **A floor under the capped rate** (at least 0.1 or 0.2 per px above the length on any ring side): 11 and 35
  routes in L at `projects` past 1 000 px again, for 1 %–2 % less border hugging over the 16 views.
- **A lower factor without a cap** (`hugFactor` 1.2): 39 routes in L at `projects` past 1 000 px, 236 over
  the 16 views; border hugging in M overview at `auto` 9 448.
- **Charging everything but a gap between two children** (free space at 1.5 × too, so no 1 × line runs
  parallel to a 1.5 × one either): no margin U-turns, 92 detours in L at `projects`, but routes into the M
  folders run along the folders' ring tops under their titles (border hugging in M overview at `auto` 9 706
  against 7 661), and more bends and crossings in the 14 views that route in three passes.
- **No hugging cost at all** (`hugFactor` 1): 3 routes in L at `projects` past 1 000 px, but routes run inside
  the zones' padding rings again (border hugging in M overview and networking at `auto` 9 743 and 9 849, in L at
  `projects` 691 153) and 195 routes past 1 000 px over the 16 views.
- **The canvas margin at 1.5 × like a ring side**: 17 routes in the margin over the 16 views, 8 of them in L
  networking at `all` running round the top of Platform and down the left margin for up to 1 000 px.
- **A cap on lane pressure** (pressure counted for at most 4 or 8 lanes in a gutter): 163 and 170 routes past
  1 000 px over the 16 views, no fewer; the long ones in L networking at `all` are not pressure-driven.
- **The canvas margin at 3 × to 6 ×**: L networking at `auto` keeps one or two routes in the margin (168–480
  px), the other views change little; 2 × stays.

- **Lower pressure alone** (`laneCost` 0–100 without port lines): 4 %–16 % shorter routes in the M overviews
  but hardly fewer bends (265 instead of 271); the turn along the ring stays.
- **A detour factor** for length outside the box around both ends: no consistent gain, more crossings.
- **A higher bend cost** (60–120): fewer bends in some views, longer routes in others.
- **Three widening rounds everywhere**: L at `projects` 330–370 ms in-process, too close to its budget through
  the worker.
- **Weighted search in three-pass mode too**: 10 %–20 % faster, but routes up to 1.2 × the cheapest where
  readability matters most.
