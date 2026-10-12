<!-- SPDX-License-Identifier: MIT -->

# Visual review, 2026-10-09 and 2026-10-10

A record of the build, written on 2026-10-09 and 2026-10-10 and not kept up to date since (on 2026-10-12 the build's
task and phase ids gave way to plain names and dates); what is still
open is in [../backlog.md](../backlog.md).

The renders made once the layout engine, the icons, the SVG renderer, the render CLI and the Export menu were built,
walked item by item through the fact-check list of the
[gcp-diagram-style skill](../../.agents/skills/gcp-diagram-style/SKILL.md) (§11) and the checklist of the
[gcp-diagram-layout skill](../../.agents/skills/gcp-diagram-layout/SKILL.md) (§8). It is written for the
maintainer's visual review: what looks right, what looks wrong, and where each finding belongs. It is candid
on purpose; the invariant tests pass on every view below, so what is listed here is what tests do not catch.
The layout polish answered the layout findings on 2026-10-10: section 8 says, finding by finding, what it
changed, what it measured and what it deferred, with a new review set under `out/review-layout-polish/`.
Section 9 is the second walk over the renders, on 2026-10-10, after the layout polish and the selection trace and
console action, with screenshots of the running app and what is still open; its renders replace the first
review's under `out/review/`, and the first review's own set moved to `out/review/2026-10-09/`.

| | |
|---|---|
| Date | 2026-10-09 |
| Tree | `main` at `ce4da59` plus the uncommitted work on reverse and child-side rules (ADRs 0022–0024), the layout engine, the icons, the renderer, the render CLI and the Export menu |
| Renderer | `pnpm render` (the render CLI): the app's own SVG components, rasterised with resvg 2.6.2 and only the self-hosted Roboto and Roboto Mono faces |
| Data | the synthetic demo organisations S (96 assets), M (952) and L (6 382); no real data |
| Reviewer | the review agent; each PNG was opened whole and in full-resolution crops |

## 1. The review set

Every file is under `out/review/2026-10-09/` at the repository root (git-ignored; section 7's commands
wrote them to `out/review/`, and the second walk moved them, section 9). PNGs are 2× with a 24-unit margin
unless noted; sizes below are drawing units (the SVG's size, title block and legend bands included). Every
view was rendered with `--strict`: the layout invariants (no card overlap, children inside their parent's
padding, no edge segment through a card or a zone header, ports on borders, every node placed) held in all 22
views. Every SVG carries the short non-affiliation line twice (title block and `<desc>`; drawings no longer
carry it, ADR 0018) and uses only 10.5, 11, 13 and 15 px text.

| File | View (`auto` resolves to) | Rects / edges | Size | Notes |
|---|---|---|---|---|
| `M-overview-auto-light.png`, `-dark.png` | M, overview, `auto` → folders | 38 / 42 | 1630 × 1286 | dim mode |
| `M-networking-auto-light.png`, `-dark.png` | M, networking, `auto` → folders | 42 / 36 | 1690 × 1522 | dim mode, 2 `secures` overlays |
| `M-load-balancing-auto-light.png`, `-dark.png` | M, load-balancing, `auto` → folders | 39 / 21 | 1470 × 1238 | heads drawn, 1 overlay |
| `L-overview-projects-light.png` | L, overview, `projects` | 2 047 / 2 658 | 13 090 × 7 810 | single-pass routing; PNG lowered to 1.14× |
| `S/S-<lens>-auto-light.png` (11 lenses) | S, every lens, `auto` (S has under 100 rects, so `auto` is fully open, the same as `all`) | 26–95 / 3–97 | see below | `S/index.json` lists them |
| `extra/M-overview-all-light.png` | M, overview, `all` | 369 / 341 | 8 755 × 4 482 | added: M at `auto` shows folders and chips only; PNG at 1.83× |
| `extra/M-networking-all-light.png`, `-dark.png` | M, networking, `all` | 174 / 81 | 5 574 × 2 458 | added |
| `extra/M-load-balancing-all-light.png` | M, load-balancing, `all` | 290 / 212 | 7 048 × 4 142 | added |
| `crops/*.png` | full-resolution crops of the places named below | | | |

S per lens (rects / edges, size): overview 55 / 45, 2333 × 1326; networking 40 / 17, 1709 × 1438;
load-balancing 46 / 30, 1876 × 1406; compute 29 / 17, 1598 × 1066; serverless 28 / 11, 1701 × 1034;
kubernetes 35 / 6, 1885 × 1330; data 26 / 3, 1696 × 954; security 52 / 32, 2442 × 1510; identity 30 / 16,
1505 × 1186; operations 32 / 5, 1583 × 1194; everything 95 / 97, 2636 × 2798.

## 2. Gate commands and their results

| Command | Result |
|---|---|
| `pnpm check` | green in 1 min 35 s: format, lint, typecheck; 140 test files, 5 361 tests; `catalog:check` OK (632 of 641 types, 1 387 rules); provenance OK (1 595 files, 732 headers); licences OK (364 packages) |
| `pnpm build` | green (icons and catalog outputs unchanged; frontend and backend built) |
| `pnpm size` | green: 325.39 of 350 kB gzipped (93.0 %); the two fetched JSON tables (catalog data 112.9 kB, icon table 46.2 kB gzipped) are not counted, by the script's rule |
| `pnpm e2e` | green: 54 passed (Chromium; demo and live projects), including the export faithfulness checks (exported SVG vs the renderer's SVG in resvg: 0.0000 % of pixels differ; the app's PNG vs the CLI's PNG: 0.19 % light, 0.20 % dark, glyph anti-aliasing) |
| `pnpm --filter @gcportrait/layout test:budget` | green, 46 strict checks at load average 2.7: worker round trips S ≤ 5.3 ms (budget 10), M ≤ 35.0 ms (60), L ≤ 304.5 ms (400; L overview at `all`, single-pass), XL at `folders` ≤ 100.9 ms (2 000); memo hit 0.09–0.62 ms; worker heap +0.3 MiB after 100 XL layouts |

## 3. Verdict in brief

**What looks right.** Every render reads as a Google Cloud-style architecture diagram: tinted rounded zones
nested folder › project › VPC › subnet, white (light) or near-black (dark) cards with Google's icons, the
fills exactly the style skill's §2 tokens in both themes (sampled from the PNGs: light `#F1F3F4`, `#A8C7FA`, `#CEEAD6`,
`#FFEEBD`, `#D2E3FC`, `#F8F9FA`; dark `#2A2B2E`, `#1C3A5E`, `#303134`, `#2B2C2F`), text crisp in Roboto with
addresses in Roboto Mono, folder titles top-left and every other title centred with the id in muted text,
badges top-right, the title block with the non-affiliation line and a legend that lists only what is drawn. No edge
touches a card or crosses a header anywhere; heads sit on borders; the dense S load-balancing view keeps its
lanes apart. S at every lens is the best-looking output today (`S/S-overview-auto-light.png`,
`S/S-compute-auto-light.png`, `S/S-serverless-auto-light.png`).

**What looks wrong**, most visible first:

1. **Routing in the collapsed overviews reads as spaghetti.** At M `auto` (what the app opens at), 36–42
   dim lines detour around the canvas margins and through empty zone interiors, hug zone borders, and cross
   folders they have nothing to do with (section 5, "lanes spaced" and "grid tidy").
2. **Large empty areas.** Zones whose children differ a lot in height leave big blank regions; M networking
   at `auto` leaves about a fifth of its canvas blank, M at `all` about 2 500–3 300 × 2 000 units under the
   Platform folder, and S everything is taller than wide (section 5).
3. **`secures` overlays collide with edges and do not say whose policy they are** (section 4, item 7, and
   section 6).
4. **Chips are cut to the point of ambiguity:** two chips both read "Shared VPC ho…", and count lines lose
   their last part ("1 net · 17 sub · 6 ctr…").
5. **Dim mode removes every arrowhead** while the legend draws heads; peers and shares then differ only by
   their dash rhythm, and line ends stop 5–7 units short of their target.
6. **Product-container zones all show Google's generic cloud mark** instead of their product icon (GKE
   cluster, namespace, BigQuery dataset, DNS zone, key ring, instance groups, NCC hub), because the Scene
   never carries a zone icon (section 6).
7. **L at `projects` (single-pass routing) draws bars of squeezed lines** along folder borders.
8. **Text from the catalog and graph:** "1 instances", cards and zones with the same name side by side,
   generated names that truncate to the same prefix.
9. **Dark theme:** the subnet outline `#FDD663` is the same amber as the hover path, so card-sized subnets
   look highlighted.

None of these is a regression against an accepted acceptance criterion; items 1, 2, 4 and 7 are the layout
polish's scope, item 3 is renderer work (the layout polish or the selection trace), items 5 and 9 need a style decision, items 6 and 8 belong to
`packages/graph` and the catalog.

## 4. Style skill §11, item by item

1. **Icons unmodified, no recolouring on dark?** Yes. Colour marks (Cloud Run, Cloud SQL, Cloud Storage,
   Compute Engine chip, BigQuery, Private services access, connectors) sit on the light plate in dark only
   (`crops/M-networking-all-dark-vpc.png`); two-tone legacy icons have no plate and are legible on the dark
   card; own drawings (organisation, folder, service account, generic resource) look the same in both themes.
   `packages/icons` tests compare every vendored file with its manifest hash. Two observations: every product
   container zone header draws the generic cloud mark (section 6, first row; `S/S-overview-auto-light.png`
   shows five: `retail-prod`, `analytics`, `internal-prod`, `api-mig`, `web-mig`); and every Kubernetes object
   gets the full-colour GKE mark, so the kubernetes lens shows six identical icons in a row
   (`S/S-kubernetes-auto-light.png`). The Cloud Armor and Cloud Domains marks are pale on white (Google drew
   them in `#669DF6` + `#AECBFA` only; documented exemption in `packages/icons`): `web-armor` in
   `S/S-load-balancing-auto-light.png`, `workloads-baseline` in `M-load-balancing-auto-light.png`.
2. **Zone tints exactly the tokens, right stroke widths?** Fills: yes, both themes (sampled, section 3).
   Strokes: 1.5 px for projects, VPCs, subnets and cards, 1 px for folders and product containers, as the style
   skill's §4 says. The stroke **colours** depart from §2 on purpose and still need the maintainer's sign-off: folder,
   product-container and region outlines and `edge.dim` are `#5F6368` in light (skill `#9AA0A6`, `#DADCE0`,
   `#BDC1C6`) and `#9AA0A6` in dark (skill `#5F6368`), because the skill's values fail the §10 contrast pairs
   (`frontend/README.md`, "Diagram theme and contrast"). In light the VPC and subnet outlines (`#A8DAB5`,
   `#FDE293`) are all but invisible (`crops/M-networking-all-light-vpc.png`); that is the skill's own
   decorative-stroke exemption. In dark the subnet outline `#FDD663` equals `accent.path`, so a card-sized
   subnet looks hovered (`crops/M-networking-all-dark-vpc.png`).
3. **Folder titles top-left, all others centred, with halos?** Yes in every render. Card-sized empty zones
   (an empty project such as "CI and operations", a subnet, a dataset) set their title left like a card,
   which is the card-sized-zone convention. Halos are in the SVG (`paint-order` stroke in the zone fill);
   where an edge runs right under a title (below) the halo does its job.
4. **Edges orthogonal, rounded elbows, heads on borders, no card crossing?** Yes; `--strict` confirms no
   segment crosses a card or a header in any view, and the crops confirm heads on borders with the elbow
   clamped before a head (`crops/M-load-balancing-auto-light-head-retailweb-4x.png`,
   `crops/M-load-balancing-auto-light-head-host-4x.png`, `crops/S-data-auto-light-vpc-head-3x.png`). Three
   blemishes: (a) facing ports on two chips stacked in one column are not aligned, so the peering line between
   them makes an S-shaped jog: 6 units in M overview, 18 units in M networking, between "Partner exchange"
   and "Shared VPC host (Production)" (`crops/M-overview-auto-light-networking.png`,
   `crops/M-networking-auto-light-hostchip.png`); (b) a hub bundle draws its members as coincident paths, 13
   of them along `y = 254` out of the Shared VPC host chip in M overview, and the anti-aliased edges add up so
   the trunk reads heavier than a single line and then forks left and right at its first corner
   (`crops/M-overview-auto-light-sharedvpc-trunk.png`); (c) routes often run in the padding band directly
   under a zone title or along a zone border, which reads like an underline or a doubled border
   (`crops/S-networking-auto-light-vpc-header.png`; the line along the Platform folder's left border in
   `crops/M-overview-auto-light-networking.png`).
5. **Dash patterns and heads per kind; peers dashed and double-headed?** Yes where heads are drawn:
   `S/S-compute-auto-light.png` and `S/S-networking-auto-light.png` show the vpc-partner ↔ vpc-shared-prod
   peering dashed with both heads; `memberOf` and `runsAs` dotted with open heads
   (`S/S-load-balancing-auto-light.png`, `S/S-identity-auto-light.png`); `shares` dashed `8 4`. In dim mode
   (every M view at `auto` except load-balancing, S overview and everything, all of L) no line has a head,
   so a peering is a dashed `6 5` line and a Shared VPC link a dashed `8 4` line, which few readers will tell
   apart.
6. **Dim mode above 30 edges, focused edges cased and on top?** Dim mode engages exactly above 30 drawn lines
   (M overview 42 and networking 36 dim; M load-balancing 21 and S load-balancing 30 do not). The focused
   copies cannot be seen in a static render; `e2e/tests/diagram.spec.ts` ("hover paints the ancestor chain
   and focuses the edges") passes. Known from the renderer's review: focused copies are painted under the `secures`
   overlays. In dim mode a line stops where a head would begin, 5–7 units short of its target, although no
   head is drawn: three lines end at `x = 666`–`668` against the vpc-shared-prod border at `x = 661` in
   `S/S-overview-auto-light.svg`.
7. **Legend lists only what is present, inside the SVG, survives export?** Yes: the M overview legend has no
   "Resource" row (no cards are drawn), M load-balancing has no "dim" row, S kubernetes lists only attaches,
   routes and memberOf. The collapsed-zone sample is project-tinted like the chips. The e2e export tests
   check the legend in exported SVG and PNG. Two disagreements with the drawing: in dim mode the legend's
   samples have heads and the lines do not; and the `secures` sample is a hazard-striped box, while the
   drawing's overlays are not linked to the policy card that causes them (section 6).
8. **Title block with scope, lens, readTime and the short non-affiliation line?** Yes in all 22 renders:
   "example.com", "<Lens> lens · read 2026-10-08T00:00:00+00:00", and "gcportrait · Not affiliated with Google.
   An independent open-source side project." (the line as revised on 2026-10-10; the renders of 2026-10-09
   carried the earlier wording, ADR 0018). The CLI writes the read time at UTC on purpose; the app
   writes the viewer's offset.
9. **Both themes rendered and the contrast test green?** M × three lenses in both themes, M networking at
   `all` in both; `frontend/src/diagram/theme/theme.test.ts` is green inside `pnpm check`. Dark geometry is
   identical to light. Dark reads well; the one dark-only problem is the subnet outline (item 2).
10. **Nothing below 10.5 px at scale 1; LOD thresholds respected?** Yes: the SVGs contain only 10.5, 11, 13
    and 15 px. But several views open below the LOD thresholds, so their text is hidden at first sight: at a
    1280 × 800 canvas, M networking at `auto` fits at 0.53 (subtitles hide below 0.55), S everything at 0.29
    and M at `all` at 0.15–0.23 (labels hide below 0.35), L at `projects` at 0.10. The app's canvas is
    smaller than the viewport (top bar, timeline), so the real fit is lower still.
11. **Exported SVG identical in a browser and Inkscape; PNG on the theme background?** Browser and resvg:
    yes (e2e, section 2). Inkscape and Illustrator: not verified; neither is installed on the build machine.
    PNGs: theme canvas colour and a 24-unit margin in every review PNG; large views are lowered to fit the
    16 384 px side limit (L at `projects` 1.14×, M overview at `all` 1.83×) and stay readable.
12. **Timeline markers only with an active tick; removed ghosts dashed at 50 %?** Not applicable yet: the
    timeline was not built yet, and no render shows a tick.

## 5. Layout skill §8 checklist, item by item

- **Grid tidy and wider than tall.** Mixed. Card grids are tidy everywhere (S Retail web, the M Shared VPC
  host). Zone rows are not: each row packs left to right with its own widths, so columns drift by up to
  about 35 units (Retail › Production in `crops/M-networking-auto-light-retail.png`; the subnet rows in
  `crops/M-networking-all-dark-vpc.png`). Aspects: M overview 1.27, M networking 1.11, M load-balancing 1.19
  at `auto`, so barely wider than tall; S everything 0.94 (taller than wide: Workloads sits under Platform,
  with a blank column to its right); M networking at `all` 2.27 (too wide). Empty areas: M networking at
  `auto` leaves the whole right half of the Platform row blank (about 1 000 × 500 units, a fifth of the
  canvas), M overview and load-balancing at `all` leave about 2 500–3 300 × 2 000 units blank under the
  Platform folder, the Shared VPC host project in S networking leaves about 400 × 500 units right of its
  VPC, and the Retail folders at `auto` leave space under their short Non-production folders. Each top-level
  canvas puts the lone Sandbox project in a row of its own. This is the "2–3 children of very different
  heights" item of the layout polish and the layout skill's §9 "huge empty zones" symptom.
- **No card touched by an edge.** Holds in all 22 views (`--strict`), confirmed in every crop.
- **No edge through a header.** Holds (`--strict`). Lines do run directly below titles, in the header's
  padding band (`crops/S-networking-auto-light-vpc-header.png`), which is allowed and reads as an underline.
- **Lanes spaced.** Holds in every three-pass view: parallel lines keep 8 units, e.g. the S load-balancing
  wire harness (`crops/S-load-balancing-auto-light-retailweb.png`). It fails in single-pass mode: L overview
  at `projects` (2 658 edges, above the 1 500-edge threshold) draws bars of 6–10 lines inside about 10 units
  along the Workloads folder's left border and between the Analytics and Payments folders
  (`crops/L-overview-projects-light-bar-v.png`, `crops/L-overview-projects-light-bar-h.png`). The skill's own
  §8 view (`--fixture L --detail projects`) is therefore the one that fails this item. Beyond spacing, the
  collapsed M views show long detours: in `M-overview-auto-light.png` the Platform management chip's edges
  run down under the whole Workloads folder and back; in `M-networking-auto-light.png` several edges from the
  Networking folder run out to the right edge of the canvas (about 1 650 units across) before coming back to
  Retail; in `M-load-balancing-auto-light.png` the edge between Retail web (prod) and Platform management runs
  along the bottom of the Workloads `secures` overlay.
- **Heads on borders.** Holds (item 4 above, with crops).
- **Peers double-headed.** Holds where heads are drawn; in dim mode no edge has heads (item 5 above).
- **Chips show counts.** Yes, but at the fixed 148-unit chip width the labels and count lines are cut: two
  chips in M's Networking folder both read "Shared VPC ho…", and "1 net · 17 sub · 6 ctr…", "1 net · 4 sub ·
  2 ctr ·…" lose their resource counts (`crops/M-overview-auto-light-networking.png`). In L at `projects`,
  seven chips read "gke-analytics-s…" (`crops/L-overview-projects-light-project.png`). The layout polish was to
  size chips from text metrics (148–220).
- **Nothing overlaps the legend or title block.** Holds: both sit in bands outside the layout bounds.
- **The whole diagram fits the viewport at the auto level.** Only at a scale where text partly hides: M
  overview 0.62 and load-balancing 0.65 show labels and subtitles, M networking 0.53 hides subtitles, S
  everything 0.29 hides labels (S never collapses, being under 100 rects). See the style skill's §11 item 10.

## 6. Other findings and where they belong

| Finding | Evidence | Belongs to |
|---|---|---|
| Every product-container zone header shows Google's generic cloud mark. `packages/graph/src/views/emit.ts` emits zones without `icon`, so the renderer falls back to `ZONE_MARKS['product-container']` (`cloud_generic`), although the catalog has icons for these types. | `S/S-overview-auto-light.svg` uses `#dg-icon-cloud_generic` 5 times; `S/S-kubernetes-auto-light.png`, `S/S-security-auto-light.png` (key ring), `crops/L-overview-projects-light-platform.png` (NCC hub, DNS zone, datasets) | graph (emit the container type's icon), small |
| `secures` overlays sit in the routing gutter, 6 units outside their target, and are painted over the lines: lines cross them or run on them and merge with the hazard-tape casing in light; in dark the canvas-coloured core cuts a gap into crossing lines. | `crops/M-load-balancing-auto-light-overlay-bottom.png`, `crops/M-load-balancing-auto-light-workloads-left.png`, `crops/M-load-balancing-auto-dark-overlay-bottom.png`, `crops/M-networking-auto-light-hostchip.png`, `crops/S-load-balancing-auto-light-retailweb.png` | renderer (paint overlays before the lines, or on or inside the target border) |
| An overlay does not say which policy causes it: `workloads-baseline` (Cloud Armor) sits alone at the top of `M-load-balancing-auto-light.png` while its overlay rings Workloads; `data_perimeter` sits in the access-policy zone of `S/S-security-auto-light.png` while two projects carry its overlay. | as named | style decision (label the overlay, or draw a faint link on hover) |
| The light `pathCasing` (ink) makes every `secures` overlay a black-and-amber hazard band, the most prominent element in M networking. | `M-networking-auto-light.png` | style decision (the renderer's review suggested a muted casing) |
| Dim-mode line ends stop 5–7 units short of their target. | `S/S-overview-auto-light.svg` (above) | renderer |
| "api-mig · 1 instances" (instance-group zone subtitle). | `S/S-overview-auto-light.png`, `S/S-load-balancing-auto-light.png`, `S/S-compute-auto-light.png` | catalog template (plural) |
| Same name twice side by side: the `web-mig` manager card beside the `web-mig` instance-group zone; disks named like their VMs (`api-bejw` disk and VM). | `S/S-load-balancing-auto-light.png`, `S/S-security-auto-light.png` | catalog labels (type word in the subtitle, or a decision to accept) |
| GKE-generated names truncate to the same prefix: four cards read "k8s1-68430c93-shop-fron…". | `crops/L-overview-projects-light-project.png` | renderer (middle ellipsis) or catalog label templates |
| The kubernetes lens draws Compute disks, managed instance groups and forwarding rules of Retail web. | `S/S-kubernetes-auto-light.png` | catalog lens curation (check intent) |
| The `secures` overlay of M networking surrounds a collapsed chip ("Shared VPC host (Production)"); the chip's edges run through the overlay ring. | `crops/M-networking-auto-light-hostchip.png` | renderer, with the overlay row above |

## 7. Reproduce

```sh
for lens in overview networking load-balancing; do for theme in light dark; do
  pnpm render --fixture M --lens $lens --theme $theme --strict \
    --png out/review/M-$lens-auto-$theme.png --svg out/review/M-$lens-auto-$theme.svg
done; done
pnpm render --fixture L --lens overview --detail projects --strict \
  --png out/review/L-overview-projects-light.png --svg out/review/L-overview-projects-light.svg
pnpm render --all --out out/review/S --fixtures S --themes light --formats png,svg --strict
pnpm render --fixture M --lens networking --detail all --theme dark \
  --png out/review/extra/M-networking-all-dark.png   # likewise overview, load-balancing at all, light
```

The output is byte-stable, so a re-run on the same tree gives the same files. The crops were cut from these
PNGs at full resolution (no rescaling except the `-3x`/`-4x` files, which are enlarged for reading).

## 8. The layout polish (2026-10-10)

The layout polish changed the layout engine only (`packages/layout`, one shared constant in
`@gcportrait/model`); the renderer, the catalog and the graph's Scene are as they were, apart from changes
other tasks made in parallel. Its decisions are [ADR 0026](../adr/0026-stacks-and-near-ties-in-packing.md)
(packing) and [ADR 0027](../adr/0027-gutter-routing-rules-beyond-skill-5.md) (routing). The new review set is
under `out/review-layout-polish/` (git-ignored), made with section 7's commands into that directory: M × overview,
networking and load-balancing at `auto` and L overview at `projects`, each in both themes; every view rendered
with `--strict` (invariants hold), every SVG carries the short non-affiliation line twice and only 10.5, 11,
13 and 15 px text. The route figures below come from `pnpm --filter @gcportrait/layout measure` (`src/testing/quality.ts`),
before (`main` at `9229dd2`) and after; "in the canvas margin" counts the routes with a stretch outside the
box around the top-level rects, and "past both ends" the routes whose farthest point lies more than 1 000 px
outside the box around their two ports.

| Finding (section 3) | The layout polish | Evidence |
|---|---|---|
| 1. Routing in the collapsed overviews reads as spaghetti | **Improved, not solved.** Port lines take a route straight out of a nested chip instead of along its zones' padding rings; running along a zone's border inside its padding band costs 1.5 × its length, but at most 320 px more over the whole side, and the canvas margin 2 ×, while every gap costs its length (the first version of the layout polish also charged a gap beside one child only, and the review of that round found 26 routes in L at `projects` going down past their target into the canvas margin and back up a parallel line; the second charged every ring side 1.5 × its whole length, and the review of that round found 140 routes there running more than 1 000 px past both of their ends, dropping up to 2 528 px to a row gap and climbing back to avoid running 9 000 px along Workloads' ring top); lane pressure is 50 instead of 200, so the corridor between two folders beats a detour around one (ADR 0027). Routes in the canvas margin: M overview 0 → 0, M networking 29 → 1 (96 px, from the firewall endpoint card at the top left round Platform's header), M load-balancing 1 → 1 (a 56 px `secures` line), L at `projects` 0 → 0; over 16 views 1 263 → 13, at most 368 px each (the policy cards' lines from the card row above the folders, 56–368 px, and three lines between project chips in L networking at `auto`, 224–312 px, that round the bottom-left corner of Workloads onto its ring bottom, which the cap makes cheaper than the busy row gap they took without it). Routes more than 1 000 px past both ends: 0 in the M views at `auto` except the invisible Cloud Armor `secures` line in M load-balancing (1 048 px), 0 in L at `projects`; over 16 views 723 → 165, 141 of them in the two single-pass L views at `all`. Bends fall 12 %–19 % and border hugging 13 %–62 % in the three M overviews (M overview: length 25 714 → 22 325 px, bends 271 → 223, hugging 12 705 → 7 661 px; networking 27 961 → 21 869, 213 → 187, 17 880 → 6 840; load-balancing 11 935 → 12 432, 141 → 114, 5 837 → 5 074). Crossings rise (103 → 153, 75 → 122, 17 → 34): routes leave chips straight and cross the corridor between Platform and Workloads, which now carries the many `shares` and `attaches` edges into the two Shared VPC hosts as a bus of parallel lanes. Still visible: in M overview the `attaches` route from Payments services (nonprod) to Shared VPC host (Non-prod) runs about 930 units along the Platform and Workloads ring tops, under their headers (the shortest path, but it reads as an underline); in M networking the route from Retail web (prod) to the Shared VPC host leaves downwards and runs about 550 units under Workloads. | `M-*-auto-*.png` |
| 2. Large empty areas | **Partly.** Stacks set short siblings one above the other beside a tall one, only where that fits inside the plain arrangement's box: −4.7 % canvas area over 15 views, −7 % to −9 % in M at `all`, −15 % in M overview at `all` with the near-tie rule; skill §9's "rows by height" was measured and rejected (−1.1 %, loses sibling order). The blank areas in the M overviews at `auto` (under Platform, beside Workloads; right of Retail) stay: filling them needs a later sibling under an earlier one, which sibling order forbids (deferred, ADR 0026). | ADR 0026 table |
| 4. Chips cut to the point of ambiguity | **Fixed.** Chips take their width from their label and count line (148–220 px), siblings sharing the widest: "Shared VPC host (Non-prod…" and "Shared VPC host (Production)" are told apart, count lines keep their resource counts ("1 net · 17 sub · 6 ctr · 18 res"). Wider chips make the canvases larger (M overview 1630 × 1286 → 1815 × 1450 drawing units), so the views fit a 1280 × 800 canvas at 0.55 (overview), 0.55 (networking) and 0.58 (load-balancing) instead of 0.62, 0.53 and 0.65: subtitles hide below 0.55. In the running app the canvas is smaller than the window, and the layout polish's review measured the M views opening at 0.40–0.43 at 1280 × 800 with the subtitles (and so the full count lines) hidden; not addressed (the renderer's level of detail decides). | `M-overview-auto-light.png` |
| 7. L at `projects` draws bars of squeezed lines | **Fixed.** Single-pass mode counts lane holders (an edge on its own, a hub bundle once): L at `projects` has 2 658 edges but 1 234 holders and now routes in three passes (threshold 1 250), widening its gutters: 3 squeezed lines instead of 583, no stretch without a clear lane (9 before), lanes 8 px apart along the Workloads border, no route in the canvas margin (the bus between Platform and Workloads runs straight down the gap beside Workloads) and none more than 1 000 px past both of its ends (the farthest, 994 px, run up from a top-row project to Workloads' ring top, the only gutter across Workloads above its folders; 7 lanes run there under its header). It takes 298.8 ms through the worker (budget 400 ms), and its canvas grows 27 % (13 090 × 7 548 → 13 673 × 9 228 layout units). Detours (routes more than twice their ports' distance) 91 → 94 of 2 658, short routes inside projects (`packages/layout/README.md`, "Known limits"). | `L-overview-projects-*.png` |
| 3, 5, 6, 8, 9 | Not layout work; untouched by the layout polish (renderer, style decisions, graph and catalog). | |

Section 4's item 4 blemishes: (a) facing ports on two stacked chips still sit on slot grids 6 px apart (a
peering between them jogs by 6 units); (b) a hub bundle's members still coincide along the trunk (the
renderer's job to draw once); (c) routes along a zone border inside its padding are now charged and fewer
(above), except along a long side, where the cap lets a route run when it is the shortest way (L at
`projects`: Workloads' ring top). Section 5's layout checklist on the new set: grid tidy and wider than tall,
yes (aspects 1.25, 1.29, 1.23; the folders' 2 × 2 chip grids are 3.8–4.1 wide, as no tidy arrangement of four
wide chips reaches the band); no card touched by an edge and no edge through a header, yes (`--strict`); lanes
spaced, yes in every view including L at `projects`; heads on borders and peers double-headed, as before;
chips show counts, yes, in full where they fit; nothing overlaps the legend or title block, yes; the whole
diagram fits the viewport at `auto` only at 0.55–0.58 (above). The remaining open items of section 4 to 6
belong to the renderer, the style skill, the graph and the catalog as listed there; the layout polish's own deferrals (lane
order to avoid crossings at a corridor's ends, one trunk for a host's two kinds, which needs a style decision
because the two kinds are drawn differently, the blank area beside a later tall sibling, the frontend's copy
of the chip count line, the `secures` line from a lone card in the root's card row that runs to the canvas
edge and back, and the routes that run far past their ends where the only gaps in their scope lie far away)
are in `packages/layout/README.md`, "Known limits".

## 9. After polish: the second walk (2026-10-10)

The renders after the layout polish and the selection trace and console action, walked again through the style
skill's §11 list and the layout skill's §8 checklist. Tree: `main` at `9229dd2` plus the uncommitted work of both
as the orchestrator merged it, before the goldens they
changed were regenerated. Same renderer and data as above. Every PNG below was opened whole, and the places
named were opened again as full-resolution crops. Section 3's list is the yardstick: each of its nine items is
answered in 9.3.

### 9.1 The review set

Everything is under `out/review/` (git-ignored). The first review's set of 2026-10-09, which sections 1 to 7
cite, moved to `out/review/2026-10-09/` with its crops, so the file names above still resolve there. The M
views at `auto` and L at `projects` below are byte-identical to the layout polish's set in
`out/review-layout-polish/` (SVG compared with `cmp`), so section 8's figures describe them exactly; the S views
changed (the layout polish's packing and routing, the selection trace's zone icons, plurals, dim-mode heads and
overlay placement). All views were rendered with `--strict`: the invariants hold in all 18. Every SVG carries
the short non-affiliation line twice and uses only 10.5, 11, 13 and 15 px text.

| File | View | Rects / edges | Size (drawing units) | Notes |
|---|---|---|---|---|
| `M-overview-auto-light.png`, `-dark.png` | M, overview, `auto` → folders | 38 / 42 | 1815 × 1450 | dim mode |
| `M-networking-auto-light.png`, `-dark.png` | M, networking, `auto` → folders | 42 / 36 | 1861 × 1446 | dim mode, 2 `secures` overlays |
| `M-load-balancing-auto-light.png`, `-dark.png` | M, load-balancing, `auto` → folders | 39 / 21 | 1709 × 1390 | heads drawn, 1 overlay |
| `L-overview-projects-light.png` | L, overview, `projects` | 2 047 / 2 658 | 13 673 × 9 490 | three passes since the layout polish; PNG lowered to 1.01× |
| `S/S-<lens>-auto-light.png` (11 lenses, `S/index.json`) | S, every lens, `auto` (fully open) | 26–95 / 3–97 | below | |
| `trace/trace-vm-M-compute-all-{light,dark}-{fitted,zoomed}.png` | the running app (`pnpm dev:demo`, Chromium, 1440 × 900 at 2 device pixels, reduced motion), demo M, compute lens, `all`, the VM `bastion` of Retail batch VMs (prod) selected | | | the e2e suite's VM |
| `trace/trace-load-balancer-M-load-balancing-all-{light,dark}-{fitted,zoomed}.png` | the same, load-balancing lens, the global forwarding rule `web-https-fr` of Retail web (prod) selected | | | the e2e suite's rule |
| `trace/pill-partner-gw-1-M-compute-all-{light,dark}-{fitted,zoomed}.png` | the same, compute lens, the VM `partner-gw-1` selected | | | the selection trace review's pill case |
| `crops/*.png` | full-resolution crops of the places named below | | | |

S per lens (drawing units): overview 2349 × 1358, networking 1661 × 1374, load-balancing 1877 × 1454, compute
1608 × 1082, serverless 1702 × 1046, kubernetes 1898 × 1330, data 1492 × 954, security 2402 × 1522, identity
1622 × 1174, operations 1708 × 1194, everything 3726 × 2022 (2636 × 2798 on 2026-10-09: no longer taller than
wide).

The "fitted" screenshots show the view as the app fits it after the click (the drawer open on the right);
"zoomed" ones after zooming on the selected node to about scale 1 and panning it to the middle, the pointer
moved off the canvas so that no hover preview mixes in. The painter's state was read from the DOM at the same
time: the VM traces 2 lines (its disk, its subnet) and rings 4 zones to the root (Workloads, Retail,
Production, its project); the forwarding rule traces 9 lines, reaches 9 nodes and rings 4 zones.

### 9.2 Commands and their results

| Command | Result |
|---|---|
| `pnpm run format:check` | green (7 s) |
| `pnpm run lint` | green (28 s) |
| `pnpm run typecheck` | green (4 s) |
| `pnpm run test` | **red**: 149 files, 5 482 tests, 19 failed in 4 files, every one a golden that the layout polish and the selection trace changed on purpose: `frontend/src/diagram/baselines.test.tsx` 12 of 15 (S overview and networking, all of M at `auto` and `all`, all of L at `auto`, and the selected-VM baseline), `render-cli` `test/render.test.ts` 3 (the CLI's SVG against the same stale baselines), `test/golden.test.ts` 1 (the render golden PNG), `test/cli.test.ts` 3 (the stale baseline bytes and the pinned S overview size). The layout's golden JSON passes (regenerated with the layout polish). Everything else passes, the contrast tests (`theme.test.ts`) included |
| `pnpm catalog:check` | green: 632 of 641 types, 1 387 rules, every rule with a fixture; "types without a console template: 261" |
| `pnpm provenance` | green: 1 626 files, 758 SPDX headers |
| `pnpm run licenses` | green: 364 packages |
| `pnpm build` | green |
| `pnpm size` | green: 334.39 of 350 kB gzipped (95.5 %; 325.39 on 2026-10-09); catalog data (113.0 kB gzipped) and icon table (46.2 kB) fetched as JSON, not counted by design |
| `pnpm e2e` | **red**: 59 passed, 2 failed: `export.spec.ts` "exports what the headless renderer draws for the same view" in light and dark, which compares the app's exported SVG with the committed `S-overview-auto-<theme>.svg` baseline (drawn 2349 × 1358, baseline 2333 × 1342). The trace, console-link, diagram and a11y specs pass |
| `pnpm --filter @gcportrait/layout test:budget` | green, 48 strict checks at load 2.7–4.3 through the worker: S ≤ 5.85 ms, M ≤ 36.9 ms (M overview at `all`), L ≤ 299.3 ms (L overview at `projects`, three passes), XL at `folders` ≤ 102.9 ms; memo hit 0.09–0.63 ms; heap +0.3 MiB after 100 XL layouts |
| `pnpm --filter @gcportrait/layout measure` | the same figures as section 8 for the four views it prints at the default: M overview 42 edges, 223 bends, 153 crossings, 0 margin routes; M networking 187 bends, 1 margin route (96 px); M load-balancing 1 margin route (56 px), 1 route past 1 000 px (1 048 px, the invisible Cloud Armor `secures` line); L at `projects` 3 squeezed lines, 0 margin routes, worst overshoot 994 px |

The red is one fix, outside this review's paths and left to the merge on purpose (another task was changing the
renderer at the same time): regenerate the three goldens and the CLI test's pinned S overview size (drawing
2349 × 1358, PNG 4794 × 2812) with the commands in `agents.md`, look at the changed files, and run `pnpm
check` and `pnpm e2e` again.

**Green, with the console-action follow-up (2026-10-10).** The follow-up (the console action inside the card,
single-pass mode by search work) regenerated the goldens with the documented commands (`pnpm --filter
@gcportrait/layout test:golden:update`, `pnpm --filter @gcportrait/frontend test src/diagram/baselines.test.tsx
-u`, `pnpm --filter @gcportrait/render-cli test:golden:update`) and pinned the CLI test's S overview size to
the new drawing (2349 × 1358, PNG 4794 × 2812). What moved, reviewed file by file: the layout's 13 golden
JSON files gained the report's new `work` field and nothing else (rects, arrangements and routes identical to
the layout polish's); the 28 SVG baselines differ from the stale ones only in geometry (the layout polish's arrangements and routes:
rects moved or resized, line paths; no text, colour or class changed), and every regenerated M and S file is
byte-identical to the second walk's `pnpm render` output in section 9.1, so the follow-up's renderer changes move no baseline
(the console action is drawn on the interactive canvas only, and no demo `secures` label reaches the new
legend cap); the render golden PNG equals `out/review/S/S-overview-auto-light.png`. The results on the
finished tree:

| Command | Result |
|---|---|
| `pnpm check` | green: format, lint, typecheck; `test` 151 files, 5 500 tests; `catalog:check` OK (632 of 641 types, 1 387 rules; "types without a console template: 265", four list-page templates now fall back); provenance OK (1 630 files, 760 SPDX headers); licences OK (364 packages) |
| `pnpm build` | green |
| `pnpm size` | green: 334.93 of 350 kB gzipped (95.7 %) |
| `pnpm e2e` | green: 64 passed (the two export-faithfulness tests included; new: the console action as a tab stop, `partner-gw-1` in both themes) |
| `pnpm --filter @gcportrait/layout test:budget` | green, 48 strict checks at load 4.0–6.7: S ≤ 6.4 ms, M ≤ 37.6 ms, L ≤ 305.5 ms (L overview at `projects`), XL at `folders` ≤ 105.0 ms; L overview at `all` 254.4 ms through the worker (its single-pass first pass now searches exactly up to the work budget, ADR 0027 rule 4) |
| `pnpm --filter @gcportrait/layout measure` (the 16 views) | 13 routes in the canvas margin (2 048 px), as after the layout polish; 189 routes more than 1 000 px past both ends (165 after the layout polish; the 24 more are in the two single-pass L views at `all`); L at `projects`: 290 252 states of search work, three passes, 3 squeezed lines |

The follow-up's review set is under `out/review-console-action/` (git-ignored): `pnpm render --strict` of M × overview,
networking and load-balancing at `auto` in both themes and S overview light (all byte-identical to the
baselines; invariants hold; the short non-affiliation line twice in each SVG; only 10.5, 11, 13 and 15 px text), and the
console action on `partner-gw-1` in demo M's compute lens at `all` (`pill-partner-gw-1-M-compute-all-<theme>.png`
at rest and `-hover.png` labelled, written by `e2e/tests/console-link.spec.ts` to `out/e2e/console-pill/`):
the 16 px circle sits in the card's top-right corner and, labelled on hover, stays inside the card, clear of
`partner-gw-2` in both themes (the e2e test asserts it against every card's box). The labelled pill covers the
card's title while the pointer rests on it.

### 9.3 Verdict in brief

Section 3's list, item by item:

1. **Spaghetti in the collapsed overviews: improved, not solved.** No route leaves through the canvas margin
   in M overview, and one 96-unit route does in M networking; routes leave chips in one straight run. What is
   left reads as a bus rather than a tangle, but a dense one: in M overview at `auto` about ten lines run down
   the gap between Platform and Workloads and then through Retail › Production's row gaps, eight of them in
   the gap above Retail services and Retail web (`M-overview-auto-light.png`, lower middle), and crossings
   rose (section 8).
2. **Large empty areas: partly.** S everything is now wider than tall, and stacks shrank the M `all` canvases.
   Still blank (measured from the SVGs' zone rects): under Platform in every M view at `auto` (600–700 ×
   430–550 units) and right of Retail (480–510 × 450–570), with Sandbox alone in the last row; in L at
   `projects` the whole column under Platform (about 1 400 × 7 850 units of a 13 673-wide canvas); right of
   `vpc-shared-prod` inside the S Shared VPC host (about 360 × 520 in `S/S-networking-auto-light.png`).
   Sibling order forbids the fix ADR 0026 deferred.
3. **`secures` overlays: fixed.** They sit 4 units inside their target, under the lines, and the legend names
   the policy ("secures — org-baseline", "— workloads-baseline", "— web-armor", "— 2 policies", "— 3
   policies"); lines cross them cleanly in both themes (`crops/M-networking-auto-light-workloads-left.png`,
   `crops/M-load-balancing-auto-light-workloads-left.png` and their `-dark` twins). The light casing is muted,
   so the overlays no longer read as hazard tape.
4. **Chips cut to ambiguity: fixed.** "Shared VPC host (Non-prod…" and "Shared VPC host (Production)" are told
   apart; count lines keep their resource counts in the short form. "Retail machine learning (pro…" is still
   cut at the 220-unit cap.
5. **Dim mode without heads: fixed.** Every dimmed line keeps its kind's head at 7 × 5 and reaches its target
   (42 `dimhead` markers in S overview, 1 442 in L at `projects`; none on 2026-10-09); the legend's dim sample
   has one too. Peerings are double-headed again in dim mode.
6. **Generic cloud marks on product containers: fixed.** S overview draws no `cloud_generic` mark (5 on
   2026-10-09), L at `projects` none (47): GKE clusters and namespaces, instance groups, datasets, DNS zones, NCC
   hubs, key rings and access policies show their product's icon.
7. **Squeezed bars in L at `projects`: fixed.** Lanes are 8 units apart: a bus of about ten lines beside the
   blank column under Platform (`crops/L-overview-projects-light-bus-left.png`), about six in the row gap
   below the first folder row (`crops/L-overview-projects-light-rowgap.png`). About seven lanes now run along
   Workloads' ring top just below its title (`crops/L-overview-projects-light-platform-ringtop.png`): clear of
   the text, but they read as a thick underline across the whole folder.
8. **Text from the catalog and graph: partly.** "1 instances" is gone (no singular count with a plural noun in
   any of the 18 SVGs; "api-mig · 1 instance", "frontend-9f2mxf9rth · 2 replicas"). Same names side by side
   stay (`bastion` disk and VM in `trace/trace-vm-M-compute-all-light-zoomed.png`, `partner-gw-1` disk and VM,
   `api-bejw` in S compute), and so do generated names that truncate to one prefix in L
   ("ke-media-prod-apps-f7a…").
9. **Dark subnet outline looking hovered: fixed.** The dark subnet stroke is the muted gold `#B39B4C`; next to
   the bright `#FDD663` path rings it is plainly a different colour
   (`trace/pill-partner-gw-1-M-compute-all-dark-zoomed.png`: the selected VM's subnet carries both).

New with the selection trace and console action, most visible first:

1. **The console pill covers the card below.** With `partner-gw-1` selected, "Open in Cloud Console ↗" lies on
   `partner-gw-2`'s top border in both themes and, in dark, on the top of its icon plate
   (`trace/pill-partner-gw-1-M-compute-all-light-zoomed.png`, `-dark-zoomed.png`): the pill needs 29 units
   under the card and the row gap gives 20. With the VM `bastion` and the rule `web-https-fr` it sits in the
   gap, over the lines there. No baseline draws the pill.
2. **The trace is hard to find at the fitted scale.** At M `all` the app fits at about 0.2; the traced lines
   read as thin white casings with a hairline of blue in light and nearly vanish in dark
   (`trace/trace-load-balancer-M-load-balancing-all-dark-fitted.png`); the amber path rings carry the
   selection at that scale. The pill is a sliver there, as it does not scale with the zoom. The drawer opens
   over the right quarter of the canvas without moving the camera, so a node selected on the right side ends
   under it.
3. **Traced lines in parallel fuse.** Where several traced lines share a gutter, their 4-unit canvas casings
   merge into one white band with blue lines in it
   (`trace/trace-load-balancer-M-load-balancing-all-light-zoomed.png`, the column right of `web-https-fr`);
   readable, heavy. A traced line that leaves through the gutter under a reached card frames that card
   together with its reach ring (`bastion`'s disk).

### 9.4 Style skill §11, item by item, on the new set

1. **Icons unmodified, no recolouring on dark?** Yes; the `@gcportrait/icons` manifest tests pass in `pnpm
   test`. Colour marks sit on the light plate in dark (Cloud Run, Apigee, Compute Engine in
   `trace/trace-load-balancer-M-load-balancing-all-dark-zoomed.png`). Product containers now carry their own
   marks (9.3, item 6). Still as on 2026-10-09: every Kubernetes object gets the full-colour GKE mark, so the
   kubernetes lens shows a column of identical icons (`S/S-kubernetes-auto-light.png`), and the Cloud Armor
   mark is pale on white (`web-armor`, `workloads-baseline`).
2. **Zone tints exactly the tokens, right stroke widths?** Fills: yes; the SVGs write `#F1F3F4`, `#A8C7FA`,
   `#CEEAD6`, `#FFEEBD`, `#D2E3FC`, `#F8F9FA` in light and `#2A2B2E`, `#1C3A5E`, `#303134`, `#2B2C2F` in dark
   as attributes. Strokes: the selection trace moved two values into the skill (dark subnet `#B39B4C`, light `pathCasing`
   `#5F6368`); the departures for folder, product-container and region outlines and `edge.dim` (`#5F6368`
   light, `#9AA0A6` dark) still wait for the maintainer. Light VPC and subnet outlines stay all but invisible
   (the decorative-stroke exemption).
3. **Folder titles top-left, others centred, with halos?** Yes in every render; card-sized zones set their
   title left like a card.
4. **Orthogonal, rounded elbows, heads on borders, no card crossed?** Yes; `--strict` in all 18 views. The
   three blemishes of section 4 remain: (a) the 6-unit jog between facing ports of stacked chips; (b) hub
   bundle members drawn as coincident paths; (c) underline routes: M overview's line along the Platform and
   Workloads ring tops (y ≈ 187 in `M-overview-auto-light.png`), the seven lanes under Workloads' title in L
   at `projects`, and lines in a project's padding between its title and its first card row
   (`crops/L-overview-projects-light-bus-left.png`, "Media batch VMs (dev)"). Long ways round: in S overview
   five lines between Retail web (prod) and the Shared VPC host leave Workloads at the bottom and run 860 to
   1 240 units along the root row gap just below it (y = 1018 against Workloads' bottom at 1008) before
   climbing into Platform (`S/S-overview-auto-light.png`, bottom); the `shares` route from Retail web (prod)
   in M networking still runs about 550 units under Workloads (section 8).
5. **Dash patterns and heads per kind; peering dashed and double-headed?** Yes, and in dim mode too now (the
   heads at 7 × 5): peering `6 5` with two heads (`S/S-compute-auto-light.png`, between `vpc-partner` and
   `vpc-shared-prod`), `memberOf` and `runsAs` dotted with open heads (`S/S-identity-auto-light.png`),
   `shares` `8 4`, `connects` without heads.
6. **Dim mode above 30 edges; traced lines cased, on top, heads in `accent.select`; path ringed; overlays
   inside?** Dim mode exactly above 30 (M overview 42 and networking 36 dim, M load-balancing 21 and S
   load-balancing 30 not). In the zoomed screenshots the traced lines are drawn on top in `accent.select` 3 px
   over a canvas casing with blue heads that end on the target's border, the path to the root is ringed in
   amber on its casing band on every zone up to the top-level folder (four rings for `bastion`, five for
   `partner-gw-1`: folder, folder, project, VPC, subnet, as concentric amber frames), reached nodes have a
   thin blue ring, and the overlays sit inside `web-api-bes` and `web-static`. Weak spots: 9.3 items 2 and 3,
   and the heavy dotted traced lines the selection trace's review saw on `memberOf` (not in this set: the two traces here
   are solid kinds).
7. **Legend lists only what is present, inside the SVG, survives export?** Yes; the `secures` row names its
   policies, the trace column ("selected", "trace", "path to root") appears only while something is selected
   (the fitted screenshots), and the e2e export tests that check the legend pass.
8. **Title block with scope, lens, readTime and the short non-affiliation line?** Yes in all 18 renders and in the app.
9. **Both themes, contrast test green?** M × three lenses and every trace screenshot in both themes, dark
   geometry identical to light; `frontend/src/diagram/theme/theme.test.ts` passes.
10. **Nothing below 10.5 px; LOD respected?** Text sizes yes. LOD: at a 1280 × 800 window the app's canvas is
    1280 × 624, and it fits M overview at 0.41, networking 0.41, load-balancing 0.43 and S overview 0.44, so
    subtitles and chip count lines are hidden at first sight, and S everything at 0.29 and L overview at
    `auto` at 0.23, so labels are hidden too (measured from the canvas's transform). The CLI's `auto` level
    assumes the whole 1280 × 800, where the renders would fit at 0.55–0.58; the app's canvas is smaller. Not
    addressed in this work.
11. **Exported SVG identical in a browser and Inkscape; PNG on the theme background?** Browser against resvg:
    red until the baseline is regenerated (9.2); the export itself draws the new size. Inkscape and
    Illustrator not verified (not installed). PNGs: theme canvas and a 24-unit margin in every review PNG; L
    at `projects` lowered to 1.01× for the 16 384 px limit.
12. **Timeline markers?** Not applicable until the timeline is built.

### 9.5 Layout skill §8 checklist, on the new set

- **Grid tidy and wider than tall.** Yes for the canvases (layout box from `measure`: M overview 1815 × 1188,
  networking 1861 × 1184, load-balancing 1709 × 1128, L at `projects` 13 673 × 9 228; S everything 3726 × 2022
  drawing units). The blank areas of 9.3 item 2 remain.
- **No card touched by an edge, no edge through a header.** Holds in all 18 views (`--strict`).
- **Lanes spaced.** Holds, L at `projects` included (3 squeezed lines left, `measure`).
- **Heads on borders.** Holds, dim mode included.
- **Peers double-headed.** Holds, dim mode included.
- **Chips show counts.** Yes, in full or in the short form; in the app they hide below 0.55 (9.4 item 10).
- **Nothing overlaps the legend or title block.** Holds in every render. In the app, the console pill overlaps
  the next card (9.3, new item 1); that is the renderer's placement, not the layout's.
- **The whole diagram fits the viewport at the auto level.** Only at a scale that hides subtitles (M, S) or
  labels (S everything, L) (9.4 item 10).

### 9.6 Still open, and where it belongs

Deduplicated from section 8, the reviews of the layout polish and the selection trace and this walk; none is a
regression against an accepted criterion.

| Finding | Evidence | Belongs to |
|---|---|---|
| Goldens stale: 12 SVG baselines, the render golden PNG, the CLI's pinned S size; e2e export faithfulness reads the same baseline | 9.2 | the merge (three update commands) |
| Console pill overlaps the card below (needs 29 units, the row gap gives 20); no baseline pins its placement; it does not scale with zoom | `trace/pill-partner-gw-1-*-zoomed.png` | renderer (`marks.ts`, `geometry/rings.ts`) |
| The trace is weak at the fitted scale; traced casings fuse in shared gutters; dotted traced kinds read heavy (the selection trace's review) | `trace/*-fitted.png`, `trace/trace-load-balancer-*-zoomed.png` | style decision, renderer |
| The drawer covers the right quarter of the canvas without moving the camera | `trace/*-fitted.png` | the details drawer |
| The app fits the M views at 0.41–0.44, hiding subtitles and count lines | 9.4 item 10 | renderer (LOD) or progressive disclosure |
| Blank areas under Platform, right of Retail, the lone Sandbox row, the L column under Platform | 9.3 item 2 | layout, ADR 0026 (deferred) |
| Underline routes along long ring tops (M overview, L at `projects`) and in project padding; long ways round in root row gaps (S overview, M networking) | 9.4 item 4 | layout (ADR 0027 trade-off) |
| Margin routes in L networking at `auto` (three lines round Workloads' bottom-left corner) | section 8, ADR 0027 | layout |
| The `secures` line from a lone card in the root's card row runs to the canvas edge and back (invisible, holds lanes) | ADR 0027 | layout (a gutter beside the last card column) |
| Single-pass threshold margin is thin (L at `projects` 1 234 holders against 1 250) | `measure` | layout, maintainer (ADR 0027) |
| Zone badges are not capped in width; the legend's `secures` row and the title block's scope line have no length cap | the reviews of the layout polish and the selection trace | renderer |
| Second declarations: the chip count line (layout and `Drawing.tsx`), `ConsoleLink` (catalog and `frontend/src/diagram/model.ts`), `ZONE_MARKS` | [packages.md](../packages.md), section 5 | frontend |
| A selection inside a chip after a lens or detail change shows nothing (`selection.shownAs` unused) | the selection trace's review | renderer |
| Four console templates link to list pages, not the resource (App Hub Service, Workload, ServiceProjectAttachment; Hub Membership); 261 types without a template | `catalog:check` | catalog |
| "{{data.shardCount}} shards" still unpluralised in `redis.googleapis.com.yaml` | the selection trace's review | catalog |
| The current-choice check mark in `ViewControls.module.css` has no fallback for browsers without CSS alt text | the selection trace's review | frontend |
| No axe run with the node menu open (0 violations by hand in the selection trace's review) | the selection trace's review | e2e (`a11y.spec.ts`) |
| Identical GKE marks on every Kubernetes object; the kubernetes lens draws disks, MIGs and forwarding rules; same names side by side; truncated generated names | 9.3 item 8, 9.4 item 1 | icons, catalog (lens, labels) |
| Palette departures for outlines and `edge.dim` | 9.4 item 2 | maintainer (style skill) |
| Inkscape and Illustrator not verified | 9.4 item 11 | an Export menu follow-up |

Closed by the console-action follow-up (2026-10-10): the stale goldens (9.2, green); the console pill over the card below (now inside
the selected node's top-right corner, a tab stop after it; still in drawing units, so it shrinks with the zoom);
the single-pass threshold's thin margin (single-pass mode is decided by the first pass's search work, with a
one-round band: ADR 0027 rule 4); the uncapped legend `secures` row (cut at 220 px, full name in its
`<title>`; zone badges and the title block's scope line are still uncapped); the second `ConsoleLink`
declaration; the four list-page console templates (they fall back to the project); the bare "shards" count;
the palette departures (adopted in the style skill §2 and §10, ADRs 0026 and 0027 accepted). Traced dotted
kinds keep their dash rhythm (a test pins `2.5 7.5`), and with a selection only cards, chips and card-sized
zones preview on hover, as the selection trace built it. The rest of the table stands.

### 9.7 Reproduce

```sh
# section 7's commands into out/review/, then the app screenshots (pnpm dev:demo running on :5174):
pnpm render --fixture L --lens overview --detail projects --strict \
  --png out/review/L-overview-projects-light.png --svg out/review/L-overview-projects-light.svg
pnpm render --all --out out/review/S --fixtures S --themes light --formats png,svg --strict
pnpm --filter @gcportrait/layout measure
pnpm --filter @gcportrait/layout test:budget
```

The trace screenshots come from a Playwright script outside the repository that opens each view, clicks the
node by its `data-id`, moves the pointer off the canvas, screenshots, then zooms with the wheel until the card
is about 170 px wide and pans it to the middle; `e2e/tests/trace.spec.ts` asserts the same traces.
