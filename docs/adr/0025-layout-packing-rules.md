<!-- SPDX-License-Identifier: MIT -->

# 0025. Layout packing rules (full rows, wider than tall, smallest frame) and the restated packing criterion

- **Status:** accepted (2026-10-09, as written: even rows are kept over the two extra in-band containers)
- **Date:** 2026-10-09
- **Deciders:** Florian Chrometz (maintainer); accepted on the maintainer's behalf by the build orchestrator
  under the standing instruction to make routine design calls, because the first packing criterion, set in the
  implementation plan of October 2026, was shown to be unreachable by two independent oracles. The maintainer
  may reopen it.
- **Related:** skill gcp-diagram-layout §1, §4, §9; ADR [0006](0006-clean-room-layout-engine.md), ADR
  [0026](0026-stacks-and-near-ties-in-packing.md)

## Context

Skill §4 picks, for each zone, "the column count `c` that minimises `|aspect(c) − target|`" (target 1.6, 1.75
at the root), cards first, zones in rows below, each zone row as tall as its tallest zone. The packing stage's
acceptance asked for "packing aspect within 20 % of target", read as "every zone with ≥ 4 children". Cards and
chips are 44 px high and 148–220 px wide, so a small set has only a few, far-apart aspects: four 148 × 44
chips make a 0.63 column or a 2.96 2 × 2 grid, and nothing within 1.28–1.92. On the golden layouts (demo S
and M × overview, networking, load-balancing; M also with every zone open) 87 containers have four or more
children: 34 have no arrangement within 20 % at all, 12 more only with a row left short. The literal §4 rule
puts 34 of 87 in the band; the first packing round, which chased the band, drew wide card strips above narrow
zone stacks at 19–26 % fill (skill §9, "huge empty zones"). Two independent brute-force oracles (the golden
test's and the packing reviewer's) agree on these numbers.

## Decision

- **Shape (skill §4, unchanged in spirit).** A container's children keep their sibling order and form a card
  grid of `c` columns (each column as wide as its widest card) above zone rows: consecutive zones, any number
  per row, left-aligned, each row as tall as its tallest zone. The zone rows are chosen independently of `c`
  (skill §9: "re-evaluate columns").
- **Choice.** Among every `c` × every split of the zones into rows:
  1. *Full rows* (skill §1, "a tidy grid"): no row but the last of its block has room for the next child
     within the box's width, and the card grid could not take one more column within it.
  2. *Wider than tall* (skill §1): only boxes on the target's side of 1 compete, unless there are none.
  3. *Smallest frame*: a box within 20 % of the target is its own frame; any other box is framed by the
     smallest rectangle of the target's aspect around it. The smallest frame area wins; ties go to the closer
     aspect, then fewer rows (skill §4), then fewer card columns. For grids of equal boxes this is §4's rule,
     with closeness measured in area.
- **Skill §4** replaces its "Choose the column count `c` …" bullet with the rules above.
- **The packing criterion** becomes: S/M golden layouts; every container with ≥ 4 children is within 20 % of its
  target aspect, unless no arrangement with full rows reaches 20 %, or every one that does needs more area
  than the chosen arrangement framed to the target (shown by a brute-force oracle in the golden test); and
  none of them fills less than 40 % of its children box on the demo fixtures.
- **For gutter routing**, `Layout.arrangements` records each container's choice and `LayoutOptions.arrangements` pins
  it, so re-packing with wider gutters keeps every row and column.

## Consequences

- On the goldens: 39 of 87 containers within 20 %, 46 that cannot be (34 with no arrangement in the band at
  all), 2 that could at 5.2 % and 14.4 % more area; every checked container fills at least 47.8 %. Stages 1–3
  take about 0.3 ms for S and 1 ms for M with every zone open.
- `packages/layout/test/golden.test.ts` (with `src/testing/oracle.ts`) enforces the restated criterion;
  `src/testing/rows.ts` and the property tests enforce full rows.
- The 40 % floor is a fixture check, not a guarantee: over 1 500 random Scenes the lowest fill was 32.8 %,
  always a container with one child far wider than the rest.
- Decided with the acceptance, and implemented by the layout polish of 2026-10-10 (ADRs 0026 and 0027):
  chips take their width from text metrics like cards (148–220 px) instead of a fixed 148 px, so that labels
  such as two "Shared VPC h…" chips can be told apart; depth counts the canvas (the organisation) as 0, so
  root folders and loose projects are depth 1 and the 40/32 px header and 15/13 px title thresholds follow
  from that; `MAX_SCENE_DEPTH` stays 256; zone header labels get a cap (truncate with an ellipsis above a
  documented width) so a pathological label cannot widen a zone without bound. Still open: containers with
  two or three children of very different heights leave empty space (skill §9 "pack zones in rows by
  height" would break §4's sibling order); the layout polish measured the alternatives on the fixtures and
  proposed [ADR 0026](0026-stacks-and-near-ties-in-packing.md).

## Alternatives considered

- **Skill §4 as written** (one `c`, `|aspect − target|`): 34 of 87 in the band, and nothing in it stops a
  wide card strip above a narrow stack of zones.
- **The band first, then the smallest frame**: 41 of 87 in the band, lowest fill 47.2 %, but the two
  containers that join it lose their even rows (a VPC's six empty subnets and DNS zones go from 2 + 2 + 2 to
  2 + 3 + 1, a folder's six projects to 1 + 2 + 2 + 1) for 14.4 % and 5.2 % more area.
- **§4's `|aspect − target|` over the full-row arrangements**: 41 of 87, lowest fill 40.3 %, canvases 6 %
  larger in total.
- **Padding boxes or stretching cards to reach the band**: meets the number with empty space only.
