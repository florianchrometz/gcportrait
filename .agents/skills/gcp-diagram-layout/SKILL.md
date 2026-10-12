---
name: gcp-diagram-layout
description: Layout rules for gcportrait diagrams — nesting order, containment decisions (unknown types included), zone/card sizing, grid packing, gutters, orthogonal routing invariants, progressive disclosure, the layout budgets and the app's performance targets — and how to verify a layout is correct.
---
<!-- SPDX-License-Identifier: MIT -->

# gcportrait diagram layout

Load this for any work in `packages/layout`, `packages/graph` (Scene building) or the renderer, and when
judging whether a diagram "looks right". The engine is a clean-room implementation (ADR 0006); this file is
the specification. `packages/graph` builds the containment forest, the Scene, detail levels, chips and bundles
described below on the full asset catalog (its README is the reference); `packages/layout` packs and routes
(its README is the reference; ADRs 0025 to 0027 record the rules beyond this file); the renderer
(`frontend/src/diagram/`, with the selection trace) draws the result. The Scene and ViewSpec types they consume
are in `@gcportrait/model`.

## 1. What a correct diagram looks like

- The organisation is the canvas. Folders are large grey zones, projects are blue zones inside them, VPCs green
  inside projects, subnets yellow inside VPCs, resources are cards inside the deepest container they belong to.
- Children of a zone form a tidy grid that is wider than tall (target aspect 1.6, root 1.75). Rows are
  left-aligned; cards in a row share a baseline; zones in a row share their top edge, except that short
  siblings may stack one above the other beside a taller one (§4, ADR 0026).
- Arrows are orthogonal, run through the gaps between boxes, never over a card or through a zone header, and
  attach to the border of their target. Parallel arrows in the same gap are spaced in lanes, never overlapping.
- Nothing jiggles: the same input always yields the same picture, and expanding one zone moves its siblings
  but does not reflow unrelated parts of the diagram more than necessary.
- Big orgs open collapsed: projects as chips with counts; one click opens a chip in place.

## 2. Nesting order and containment

Outermost first: Organization › Folder* › Project › [Region/Zone virtual] › VPC Network › Subnetwork › resource.
Product-specific inner containers: GKE Cluster › Namespace › workload; BigQuery Dataset › Table/Model/Routine;
KMS KeyRing › CryptoKey; AlloyDB Cluster › Instance; Spanner Instance › Database; Bigtable Instance ›
Cluster/Table; Dataplex Lake › Zone › Asset; Apigee Organization › Environment/Instance; VMware Private Cloud ›
Cluster; Dataform Repository › Workspace/ReleaseConfig; Service Directory Namespace › Service › Endpoint.
App Hub Application › Service/Workload is a logical grouping, not a network or product boundary: today it nests
in its project as a product container, and the application focus view and drill-in use it. The intent is to
draw applications in a logical lens only; that is not built yet (`docs/catalog-followups.md` §1.5).

Decision rules (applied in `packages/graph`, consumed by layout):
1. One `attaches` target that is a subnet → nest in the subnet. One VPC target and no subnet → nest in the VPC.
   Several or none → stay in the project; draw the `attaches` edges.
2. Never nest across projects. Shared VPC: resource stays in its service project; a `shares` edge joins the two
   project zones; the host subnet gets a "shared with N" badge.
3. Virtual Region/Zone containers only when the view enables them; they group by `location` directly under
   the project and do not interrupt VPC/subnet nesting (a subnet is regional, a VPC global; resources inside a
   subnet are already regional).
4. A container with no children in the current Scene is drawn as a card-sized zone with its icon, unless a
   filter hides empty containers.
5. Cycles cannot occur; if the graph builder reports one, the layout refuses the Scene and the UI shows an
   error with the offending ids (never a half-drawn diagram).
6. Unknown asset types (no catalog entry) render as generic cards: nested by `parent` and `ancestors` like any
   asset (into their project); labelled from `data.displayName`, else the last segment of `data.name`, else of
   the asset name; the icon by product, then by category, then the generic mark; no edges of their own (another
   type's rule may still point at one, which makes it `core`, else it is a `leaf`). `pnpm catalog:check`
   reports the official types the catalog does not map. Never drop an asset (agents.md hard rule 5).

## 3. Sizing constants (scale 1)

Depth counts from the canvas: the canvas (the organisation, or the drill-in root) is depth 0, so root folders
and loose projects are depth 1. Header height, zone title size (15 px at depth ≤ 1, 13 px deeper, style §3)
and the nested tint of product containers (depth ≥ 3, style §2) follow from it.

| Thing | Value |
|---|---|
| Card | height 44; width 148–220 from metrics; icon 24; inner padding 10 |
| Zone header | 40 (depth ≤ 2), 32 (depth ≥ 3) |
| Zone title | at most 660 px (3 × the widest card) counts towards the zone's width; a longer title is ellipsised (the full label stays in the Scene for tooltips) |
| Zone padding | 24 at root projects, 16 otherwise |
| Gap between siblings | 24 horizontal, 20 vertical, plus lane space |
| Gutter lane pitch | 8 px; gutter base width 8 px; width = lanes × 8 + 8 |
| Chip | height 44; width 148–220 from its label (13 px, 700) and count line (10.5 px; the short form "2 net · 39 res" when the full one does not fit 220 px) after a 16 px ⊞ glyph and an 8 px gap, same tint as the zone |
| Sibling chips and empty zones | share the widest of their widths, as the cards of a column do |
| Arrowhead | 9 × 7, ends 2 px inside the target border |
| Elbow radius | 6 |

Text widths come from a generated metrics table (`packages/layout/metrics/roboto.json`, per code point for
Roboto 400/500/700 at 1 px, scaled; `pnpm --filter @gcportrait/layout metrics` regenerates it); never from the
DOM.

## 4. Packing

- Bottom-up: size leaves, then pack each zone's children, then size the zone.
- Order children deterministically: zones before cards; within each, by kind rank (VPC before other
  containers), then by label (locale-independent, code-point order), then by id.
- Mixed children: cards first in a grid of `c` columns (each column as wide as its widest card), then zones in
  rows below, any number per row; a zone row's height is the tallest cell in it. A cell is one zone, or a stack
  of consecutive zones one above the other, left-aligned, beside a single zone at least as tall in its row
  (ADR 0026).
- Choose `c` and the zone rows (ADR 0025) among the arrangements whose rows are all full (no row but the last
  of its block has room for the next child, and the card grid could not take one more column) and, when any
  is, wider than tall: the one with the smallest frame wins, where a children box within 20 % of the target
  aspect is its own frame and any other box is framed by the smallest rectangle of the target's aspect around
  it; among the candidates within 2 % of the smallest frame, one whose rows do not hold more zones further
  down ranks first, then one with fewer rows (ADR 0026); ties prefer the closer aspect, then fewer rows, then
  fewer card columns. For equal boxes this is the column count whose grid is closest to the target. Small sets
  of wide boxes cannot always reach 20 % (four chips make a column or a 2 × 2 grid of aspect 3–4); the restated
  packing criterion allows for that (ADR 0025).
- Stacks (ADR 0026): an arrangement with stacked zones replaces the plain one only when its box fits inside
  the plain one's (no wider, no taller) with a smaller frame, so stacking never makes its own container larger
  (its parent, choosing by frame, may then take a larger box).
- Flat sets above 120 siblings are bundled into synthetic groups of ~24 by label prefix (shown as grey "group"
  zones with a count badge). Bundles are a Scene concept, produced by `packages/graph`, so the layout never
  invents nodes.
- The root packs folders and loose projects together; folders rank before projects. A loose project shares
  the last folder row when that frames within 2 % of a row of its own (the near-tie rule above).

## 5. Gutters and routing

The rules below are ADR 0027's (which records where they go beyond this section's first version).

- After packing, every zone has horizontal and vertical gutters between its children (and between the zones
  of a stack) and an inner ring inside its padding. Gutters of nested zones connect to the parent's gutters:
  a zone's horizontal gutters run out through its padding and border to the parent's gutter beside it, its
  vertical gutters down out of it (never up: its header), straight on through ancestors where nothing stands
  beside or below it.
- Port lines: where a rect's port faces a side nothing stands beside (last or first of its row, or in the last
  row for a bottom port), a line runs from the stub's gutter straight out through every zone it is the last
  of, to the first gap beside one. Only the port's edge (or, at a hub's shared port, the bundle) runs along
  it, on the port's own coordinate, so a route leaves a nested rect in one straight run.
- Routing graph: gutter centre-lines (segments) and their intersections (nodes). Each edge is routed as a
  shortest path with cost = length + 40 per bend + 50 per lane already assigned in a gutter (pressure, spread
  over the gutter's length); a stretch along a zone's border inside its padding band (a ring side between the
  zone's corners) costs 1.5 × its length but at most 320 more than its length over the whole side (a side
  longer than 640 px pays less per px), and one in the canvas margin 2 ×. A gap costs its length whether a
  child borders it on both sides, one or none, and so does a line through free space: no line may cost more
  per px than one running parallel to it through the same free space, and avoiding a border may be worth no
  more than a short way round, or routes go round (through the margin, or down to a row gap far away and back)
  to reach the cheaper line. A route uses only the gutters of the containers it has to cross.
- Lanes: each segment tracks used lanes; an edge takes the lowest free lane that keeps 8 px clear of other
  routes; the gutter width grows to fit. Passes: route; then up to three rounds (two above 500 lane holders:
  an edge on its own, or a hub bundle once) of widening the gaps whose lanes do not fit and re-packing with the
  arrangements pinned, then laying every route onto the widened gutters (re-searched only where gutters no
  longer line up); a round runs only while some lane does not fit. The first pass's search work (the A* states
  it settles) decides single-pass mode: once it reaches 420 000 the rest of the pass is searched weighted
  (each route at most 1.5 × the cheapest) and it is final; above 340 000 one widening round at most, a band
  so that a view loses a round before it loses the widening (ADR 0027).
- Ports: an edge leaves/enters a rect at the side facing the other endpoint, at a port slot spaced 12 px along
  that side, never on a zone header; top and left sides use a grid shifted by half a spacing, so stubs of rects
  facing each other across a gap may run 6 px apart. Edges to a zone target end at its border; edges to a
  collapsed zone are re-targeted to its chip; an edge with both ends in one chip is not drawn (counted).
- Hub bundles: the edges of one kind that meet one rect at the same end are bundled from 3 (from 2 on a crowded
  side): one shared port, one trunk, one head; one bundle per kind.
- Merging: reciprocal `peers` edges become one double-headed edge; identical (from, to, kind) edges collapse
  with a count label on hover. `secures` edges are routed as lines; the renderer draws them as overlays.
- Fallback: when no gutter path exists (should not happen), A* over a coarse grid avoiding card rects, with
  a warning in dev and a counter in the layout report.

Invariants (asserted in dev and tests):
1. No two cards overlap. 2. Every child rect lies inside its parent's padding. 3. No edge segment intersects a
card rect or a zone header rect. 4. Every Scene node has a rect. 5. Running twice gives byte-identical output.
6. All ports lie on their rect's border. 7. Bounding box is finite and ≥ the content.

## 6. Progressive disclosure

- Detail levels: `folders` (only folders + project chips), `projects` (projects open, networks as chips),
  `networks` (VPC/subnet open, product containers as chips), `all`.
- `auto` picks the deepest level whose rect count ≤ budget = viewport px² / 14000, clamped to [24, 250], and
  it never opens deeper than the lens's `defaultDetail`, its ceiling (`autoDetailLevel` in
  `@gcportrait/graph`, the report's `detail.ceiling`): a lens opens readable at any size; but any Scene with
  ≤ 100 rects renders fully, whatever the ceiling. An explicit level is not capped. A lens switch sets `auto` while the level follows the
  lens (`frontend/src/views/lensDetail.ts`).
- Flips (per-zone overrides) XOR the level default and live in the URL hash (max 48, oldest dropped).
- Expanding a zone keeps the viewBox fixed and glides the camera 200 ms to frame the zone; changing the level
  re-fits the whole diagram.
- "Expand all" opens the shallowest collapsed tier; "N of M shown" counts rects.

## 7. Performance budgets and targets

The layout's budgets, through a worker, enforced by `pnpm --filter @gcportrait/layout test:budget` (CI's
`layout-budget` job reports a strict miss):

| Fixture | Assets | Budget |
|---|---|---|
| S | ≈ 80 | < 10 ms |
| M | ≈ 600 | < 60 ms |
| L | ≈ 6 000 | < 400 ms |
| XL | ≈ 50 000 (collapsed defaults) | < 2 s |

Memoise by Scene hash; cancel superseded requests; never block the UI thread. The pipeline around it has its
own budgets: ingest of XL < 1.5 s and the graph build of M < 150 ms (`test:budget` in `packages/ingest` and
`packages/graph`), and the bundles of ADR 0029 (`pnpm size`).

The app's targets, measured in the browser on a production demo build (`VITE_DEMO=1`) in Chromium at
1280 × 800, with `performance.measureUserAgentSpecificMemory()` behind COOP and COEP for the heap:

| What | Target |
|---|---|
| Time to the first diagram at the collapsed default | L < 3 s, XL < 8 s |
| Lens switch, chip expanded, search jump (Enter on a hit to the hit drawn and selected), timeline step to a day not built yet, on L | < 300 ms each |
| Worker heap after 100 timeline switches on M, against a warm baseline after garbage collection | within 20 % |
| UI-thread long tasks (> 50 ms) while panning and zooming L and XL at the default | none sustained |

All were met on 2026-10-11 (XL's first diagram about 2.6 s); the open performance items are in
`docs/backlog.md`. A change to the diagram pipeline, the workers or the timeline's data path measures these
again, before and after, on the same machine.

## 8. How to verify

1. `pnpm --filter @gcportrait/layout test` — invariants, determinism, golden JSON for fixtures × lenses,
   property tests (fast-check: random trees + edges never violate invariants).
2. `pnpm render --fixture M --lens networking --png out.png` and `--theme dark`; open the PNG and walk the
   checklist below. Do the same for `--lens load-balancing` (dense edges) and `--fixture L --detail projects`.
3. Compare against the renderer's SVG baselines in `e2e/baselines/diagram/` and the render golden PNG in
   `e2e/baselines/render/`; a diff needs a reason in the PR (the update commands are in `agents.md`).
4. For a routing or packing change, `pnpm --filter @gcportrait/layout measure` prints each view's total edge
   length, bends, border-hugging length, detours, crossings, the routes in the canvas margin and the routes
   that run more than 1 000 px past both of their ends (overshoots; `src/testing/quality.ts`; `--view
   L:overview:projects` and the other views, not only M), and `measure --packing` the canvas area, fill and
   aspect of each packing rule (ADR 0026): compare before and after.

Checklist: grid tidy and wider than tall; no card touched by an edge; no edge through a header; lanes spaced;
heads on borders; peers double-headed; chips show counts; nothing overlaps the legend or title block; the
whole diagram fits the viewport at the auto level.

## 9. Failure modes and the intended fix

| Symptom | Likely cause | Fix |
|---|---|---|
| Edge crosses a card | routing fell back to A* or port on wrong side | check gutter connectivity through padding rings; port side choice |
| Spaghetti in one gutter | pressure not applied or single-pass mode | verify lane accounting and pass count (`report.routing.work` against `singlePassWork`: single-pass mode is decided by the first pass's search work) |
| Lines run along zone borders or around the canvas, or drop far past both ends and come back | no port line out of the rect; border hugging not charged; a line dearer than its parallel through the same free space (routes U-turn through the margin to reach the cheaper one); or a long border charged in proportion to its whole length (routes drop to a far row gap and climb back) | check the port lines (`src/portlines.ts`), `hugFactor`, `hugCap` and `marginFactor`; compare `pnpm --filter @gcportrait/layout measure` (margin edges and px, overshoots) before and after |
| Layout flickers on hover | hover triggered re-layout | hover must mutate attributes only (one exception: the painter clones a traced line from its relation kind's hidden prototype and removes it again; never a re-render or re-layout) |
| Different picture per run | iteration over a Map/Set with unstable order, or `Math.random` | sort deterministically; no randomness in layout |
| Huge empty zones | aspect target applied to zone-only rows; short siblings beside a tall one | stack short siblings beside the tall one (ADR 0026; rows by height would break §4's order), re-evaluate columns |
| Tiny text soup at root for a big org | auto level too deep | check budget math and rect counting (chips count as 1) |
