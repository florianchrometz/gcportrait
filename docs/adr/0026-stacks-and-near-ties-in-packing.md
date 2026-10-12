<!-- SPDX-License-Identifier: MIT -->

# 0026. Stacks beside a tall zone, and near ties that keep grids from growing downwards

- **Status:** accepted (2026-10-10, as written)
- **Date:** 2026-10-10
- **Deciders:** Florian Chrometz (maintainer); proposed by the layout polish of 2026-10-10, which was to
  measure the alternatives on the fixtures and decide by ADR; accepted on the maintainer's behalf by the build
  orchestrator on 2026-10-10 under the standing instruction to make routine design calls. The maintainer may
  reopen it.
- **Related:** skill gcp-diagram-layout §1, §4, §9; ADR [0025](0025-layout-packing-rules.md), ADR
  [0027](0027-gutter-routing-rules-beyond-skill-5.md)

## Context

ADR 0025 left one finding open: a container whose two or three children differ a lot in height leaves empty
space, because skill §4 keeps sibling order and every zone row is as tall as its tallest zone, while skill §9
("huge empty zones") says to pack zones in rows by height. The visual review of 2026-10-09 saw it as large blank
areas (M at `all`, the right half of the Platform row in M networking, the lone Sandbox project under a blank
band at the root), and the review asked whether loose projects should share the last folder row. It also
asked for a near-tie rule: S load-balancing chose rows `[1, 2]` over `[2, 1]` for 2 px. Three rules were
measured on 15 demo views (S, M at `auto`; M at `all`; L at `auto`, `projects`, networking `all`; S
everything), packing only (`route: false`), with the polish's sizing (chips from text metrics) in every case, so
that only the row rule differs: **A** skill §4 sibling order (ADR 0025), **B** §9's rows by height (zones
reordered tallest first), **C** sibling order with stacks (below), **D** C plus the near-tie rule for rows.

| View | A order | B by height | C stacks | D stacks, near ties | stacked containers |
|---|---|---|---|---|---|
| S overview / networking / load-balancing | 2.15 / 1.86 / 2.00 M | 2.52 / 1.88 / 1.99 M | 2.15 / 1.75 / 2.00 M | 2.15 / 1.75 / 2.00 M | 0 / 1 / 0 |
| M overview / networking / load-balancing (`auto`) | 1.67 / 1.82 / 1.78 M | 1.72 / 1.85 / 1.83 M | 1.67 / 1.82 / 1.78 M | 1.67 / 1.82 / 1.78 M | 0 |
| M overview / networking / load-balancing (`all`) | 25.75 / 9.10 / 20.55 M | 26.08 / 9.44 / 17.82 M | 23.63 / 8.25 / 19.06 M | 20.11 / 8.25 / 19.19 M | 4 / 2 / 2 |
| L overview / networking / load-balancing (`auto`) | 7.19 / 7.48 / 7.43 M | 7.19 / 7.48 / 7.43 M | 7.19 / 7.48 / 7.43 M | 7.19 / 7.57 / 7.52 M | 0 |
| L networking `all` / overview `projects` | 36.79 / 99.62 M | 37.01 / 99.02 M | 35.52 / 94.36 M | 35.52 / 94.88 M | 12 / 7 |
| S everything | 4.90 M | 4.20 M | 5.17 M | 5.17 M | 1 |
| **All 15 views** (canvas area; mean fill of the 576 containers with ≥ 2 children; mean fill of the 129 whose zones differ at least twofold in height) | 230.1 M; 69.0 %; 73.7 % | 227.5 M; 69.1 %; 74.4 % | 219.3 M; 69.5 %; 75.8 % | **216.6 M; 69.5 %; 75.9 %** | 29 |

(`pnpm --filter @gcportrait/layout measure --packing` prints A, B and D for any view; it applies today's
near-tie rule to all three, so its A and B differ slightly from the table's, which were measured without it,
as C was.) B saves 1.1 % of the area but gives up sibling order (a folder's projects no longer read
alphabetically), and it makes S overview 17 % larger. C saves 4.7 %, most where zones differ in height (M at
`all` −7 % to −9 %, L `projects` −5 %); by construction (below) a stack never makes its own container larger,
but the container's new shape can lead its parent to another arrangement, which the packer picks for a smaller
frame, not a smaller area: S everything's canvas grows 5.5 % (4.90 → 5.17 M px²) from aspect 1.1 to 2.4, for
a frame 6 % smaller around the root's target of 1.75 (7.43 → 6.98 M px²). The near-tie rows rule (D)
saves another 1.2 % in total (M overview `all` −15 %) and puts the loose Sandbox project into the folders' row
where that frames within 2 %. For the 13 views with one loose project, sharing the last folder row frames
0.6 % (L `projects`), 0.7 % (M load-balancing `all`), 1.1 % and 1.2 % (L networking and load-balancing at
`auto`) and, with a stack, −6 % (S networking) relative to a row of its own, and D takes it there; it stays in
a row of its own where sharing frames more: 2.5 % (S load-balancing), 3.4 %–3.8 % (the three M views at
`auto`), 4.4 %–24 % elsewhere.

Aspect and fill per rule (`measure --packing`, which applies the near-tie rule to every rule, so its A and B
areas, 231.8 and 229.7 M px² in all, differ slightly from the table's), over the 576 containers with two or
more children in the 15 views:

| Rule | Canvas area | Mean fill | Mean deviation from the target aspect | Within 20 % of the target |
|---|---|---|---|---|
| A order | 231.8 M px² | 69.0 % | 29.2 % | 290 (50.3 %) |
| B by height | 229.7 M px² | 69.1 % | 27.6 % | 327 (56.8 %) |
| D stacks, near ties | 216.5 M px² | 69.5 % | 28.9 % | 293 (50.9 %) |

B reaches the 20 % band more often, almost all of it in L `projects` (134 against 115 of 161) and L networking
`all` (52 against 43 of 104), where sorting projects by height makes rows of similar heights; D keeps sibling
order, takes the least area and has about A's aspects (one container more within the band in M networking
and load-balancing at `all`, L networking `all` and L `projects`, one fewer in M overview at `all`).

## Decision

- **Stacks.** A zone row may set consecutive zones one above the other, left-aligned, in one cell (a stack),
  when the stack stands beside a single zone at least as tall in its row: short siblings fill the height a
  tall one gives the row. Sibling order is kept (read column by column within a row). The cells are formed
  greedily under every distinct zone height as the limit (3 to 24 zones in a container; larger sets are chips
  of one height). An arrangement with stacks replaces the plain one only when its box is no wider and no
  taller than the plain choice's and its frame is smaller, so a stack never makes its own container larger
  (its parent may then pick another arrangement, as in S everything above). `Arrangement.zoneStacks` records
  the cells per row; the gutters run a horizontal line between the zones of a stack (`GapRef` `stack`),
  widened like any gap (`GapWidening.stacks`).
- **Near ties.** Among the tidy, oriented candidates whose frame is within 2 % of the smallest (`NEAR_TIE`),
  one whose rows do not hold more zones further down (not inverted) ranks first, then one with fewer rows;
  then ADR 0025's order (frame, closeness to the target, fewer rows, fewer card columns).
- **Rows by height (B) is not adopted**, and loose projects get no rule of their own: they share the last
  folder row exactly when the near-tie rule or a stack says so.
- **Chips and empty zones that are siblings share the widest of their widths** (the polish's first item: chips take their
  width from text metrics like cards, 148–220 px), as cards in a column share theirs: with chips of slightly
  different widths the packer would otherwise prefer ragged grids by a few pixels.
- Skill gcp-diagram-layout §1, §4 and §9 say so.

## Consequences

- On the golden views (S and M at `auto`, M at `all`): 38 of 87 containers with four or more children within
  20 % of their target (39 before), 49 that cannot be (46), none costlier (2), lowest fill 47.7 % (47.8 %).
  The three M overviews at `auto` keep the Sandbox row of their own (3.4 %–3.8 % more frame to share the row);
  the gap above that lone row costs a route its length like any other gap (ADR 0027).
- The golden test's oracle (`src/testing/oracle.ts`) enumerates plain rows only; the golden test accepts the packer's
  choice within `NEAR_TIE` of the smallest tidy frame, and stacks only ever take less. `src/testing/rows.ts`
  reads stacks back from the rects (a zone starting inside its row's band sits in it).
- Wide metric chips make four-chip folders 2 × 2 grids of aspect 3.8–4.1 (148 px chips gave 2.96); no tidy
  arrangement of four chips reaches the 20 % band, as before.
- Still open, deferred: the blank area under a short folder beside a much taller one at the root (M at
  `auto`: under Platform beside Workloads) needs zones out of sibling order (a later sibling stacked under an
  earlier short one), which `Arrangement` cannot express; the polish's measurement found no rule that keeps sibling
  order and fills it.

## Alternatives considered

- **B, rows by height** (skill §9 as written): −1.1 % area, but sibling order is lost and S overview grows
  17 %.
- **C without the dominance condition** (any stacked arrangement with a smaller frame; measured earlier in
  the polish, before sibling chips shared their widths): −2.3 % in total, but three of the 15 views grew (S overview
  +17 %, S everything +10 %), because a container that stacks becomes wider and its parent packs worse.
- **Stacks beside any taller cell, a stack included**: two stacks of equal height side by side are two rows in
  disguise, and a reader (and `src/testing/rows.ts`) cannot tell them from rows that are not full.
- **Near ties by inversion only** (the review's wording): leaves every lone loose project in a row of its own even
  where sharing the row frames 0.6 % more.
