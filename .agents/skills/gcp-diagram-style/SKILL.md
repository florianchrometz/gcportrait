---
name: gcp-diagram-style
description: Visual rules for gcportrait diagrams and app chrome — zone tints, stroke widths, typography, official icons, edge styles, legend, light and dark themes, WCAG 2.2 contrast checks, export rules, accessibility (keyboard, names, focus, axe) — and a fact-check list to review any render.
---
<!-- SPDX-License-Identifier: MIT -->

# gcportrait diagram style

The rules this handbook applies are in [AGENTS.md](../../../AGENTS.md) ("Style and accessibility", "Exports
and the render API" and "Non-affiliation, brand and legal"); this file holds the palettes, the sizes and the
checklists that carry them out.

Load this before changing anything a user can see in a diagram or exporting one, and when reviewing a render.
Rules here win over personal taste. Where Google's architecture-diagram conventions and WCAG conflict, keep
Google's colour *semantics* (what a tint means) and adjust *values* until contrast passes.

## 1. Principles

1. A gcportrait diagram looks like a Google Cloud architecture diagram: official product icons, tinted rounded
   zones with a title, white (light) or near-black (dark) resource cards, ink-coloured orthogonal arrows. The
   diagrams are Google Cloud-*style*; the project is independent and not affiliated with Google, and the app
   and website footers and the long-form texts say so, never a drawing or an export
   (AGENTS.md, "Non-affiliation, brand and legal"; §7).
2. Colour means **containment type**, never status. The only non-containment colours are the four accents
   (selection, ancestor path, domain peer, timeline change) and they are overlays, not fills.
3. Icons are never recoloured, stretched, outlined or redrawn. If an official icon is illegible at 16 px, draw
   a separate *own* glyph in the two-tone palette and mark it as ours. The icons are Google trademarks, used
   under Google's icon usage terms; `packages/icons/README.md` carries the long-form statement.
4. Everything readable at 100 % zoom must stay readable in both themes; the contrast tests are the gate.
5. The legend is part of the SVG so exports carry it.

## 2. Palette

### Light (maintainer-validated values, contrast-checked)

| Token | Use | Value |
|---|---|---|
| `canvas` | page / organisation | `#FFFFFF` |
| `ink` | text, card stroke, edges | `#202124` |
| `muted` | secondary text | `#5F6368` |
| `border` | hairlines (legend panel, badges) | `#DADCE0` |
| `surface` | app surfaces, "other container" fill (depth < 3) | `#F8F9FA` |
| `zone.folder` | folder fill / stroke | `#F1F3F4` / `#5F6368` |
| `zone.project` | project fill / stroke | `#A8C7FA` / `#202124` |
| `zone.vpc` | VPC network fill / stroke | `#CEEAD6` / `#A8DAB5` |
| `zone.subnet` | subnetwork fill / stroke | `#FFEEBD` / `#FDE293` |
| `zone.nested` | product containers at depth ≥ 3 (cluster, namespace, dataset, keyring, ...) | `#D2E3FC` / `#5F6368` |
| `zone.other` | product containers at depth < 3 | `#F8F9FA` / `#5F6368` |
| `zone.region` | virtual region/zone container (dashed, no fill) | stroke `#5F6368` |
| `card` | resource card fill / stroke | `#FFFFFF` / `#202124` |
| `edge` | default edge | `#202124` |
| `edge.dim` | unfocused edge in dim mode | `#5F6368` |
| `accent.select` | selected node | `#1A73E8` |
| `accent.path` | ancestor chain | `#F9AB00` |
| `accent.peer` | domain / related peer | `#188038` |
| `accent.removed` | timeline removed ghost | `#D93025` |
| `chip.text` | collapsed-zone chip text | `#3C4043` |
| `mutedOnTint` | secondary text (a zone's id, a card-sized zone's subtitle) where `muted` is below 4.5 : 1 on the tint | `#3C4043` |
| `pathCasing` | the band under the path to the root and the `secures` overlay | `#5F6368` |

### Dark (contrast-checked by the same tests)

| Token | Value |
|---|---|
| `canvas` | `#1F1F1F` |
| `ink` (text, strokes, edges) | `#E8EAED` |
| `muted` | `#9AA0A6` |
| `border` | `#5F6368` |
| `surface` | `#303134` |
| `zone.folder` | `#2A2B2E` / `#9AA0A6` |
| `zone.project` | `#1C3A5E` / `#8AB4F8` |
| `zone.vpc` | `#1E3A2A` / `#81C995` |
| `zone.subnet` | `#3D3419` / `#B39B4C` |
| `zone.nested` | `#2D3F55` / `#9AA0A6` |
| `zone.other` | `#303134` / `#9AA0A6` |
| `zone.region` (dashed, no fill) | stroke `#9AA0A6` |
| `card` | `#2B2C2F` / `#BDC1C6` |
| `edge.dim` | `#9AA0A6` |
| `accent.select` / `accent.path` / `accent.peer` / `accent.removed` | `#8AB4F8` / `#FDD663` / `#81C995` / `#F28B82` |
| `mutedOnTint` | `#BDC1C6` |
| `pathCasing` | `#1F1F1F` |

Rules for dark: official colour icons sit on a small light plate (`#FFFFFF` at 92 % opacity, radius 4) so the
artwork stays as designed; two-tone legacy icons (`#4285F4` + `#AECBFA`) need no plate.

Both tables hold the values the renderer draws (`frontend/src/diagram/theme/tokens.ts` checks them value for
value). The grey outlines and the dim edge are each theme's `muted`, the one grey that reaches 3 : 1 on every
tint; §10 gives each token its contrast figure.

## 3. Typography

- Labels: `"Google Sans", "Google Sans Text", Roboto, system-ui, sans-serif`. Google Sans is used only when
  the viewer's system has it; ship Roboto (self-hosted woff2, 400/500/700). Do not fetch fonts from a CDN at
  runtime in the SPA (CSP, offline demo). The app bundles Roboto and Roboto Mono from the `@fontsource`
  packages (OFL-1.1, accepted for these two only; AGENTS.md, "Licence and dependencies") and ships their
  licences in `dist/licenses/`.
- Identifiers, IPs, CIDRs: `"Roboto Mono", ui-monospace, monospace`.
- Sizes at scale 1: zone title 15 px (depth 0–1) / 13 px (deeper), 500 weight; card title 13 px 700; card
  subtitle 10.5 px 400; chip count line 10.5 px; legend 11 px. Nothing below 10.5 px.
- Level of detail: subtitles hide below 0.55 effective scale, labels below 0.35; icons stay.
- Zone titles get a 2 px halo in the zone fill colour so they stay readable over edges.

## 4. Zones and cards

- Zones: radius 10, padding 16 (24 for projects at the root), header 40 px (32 px at depth ≥ 3). Folder
  titles top-left; every other zone title centred. Title text = display name, with the id in `muted` after a
  middle dot when it differs.
- Stroke widths: folders, virtual regions (dashed `4 3`) and product containers (`zone.other`, `zone.nested`)
  1 px; projects, VPC networks and subnetworks 1.5 px; cards 1.5 px (`zoneStroke` and `CARD_STROKE_WIDTH` in
  `frontend/src/diagram/theme/styles.ts`). Chips and card-sized zones keep their zone's stroke.
- Cards: height 44, width 148–220 from text metrics, radius 8, 24 px icon left, title + subtitle right.
  Subtitle shows the single most useful fact (IP, region, machine type, tier) chosen by the catalog entry.
- Collapsed chips: same tint as the zone, 1 px stroke, the zone's header mark (14 px) beside the label and a
  `⊞` glyph beside the count line ("2 networks · 39 resources"), so a chip's kind is never shown by its tint
  alone (WCAG 1.4.1).
- Badges (tags, "shared with N projects", counts of hidden children): 10.5 px pill in `surface` with `muted`
  text, top-right of the zone header.

## 5. Edges

| Relation kind | Stroke | Dash | Head |
|---|---|---|---|
| `routes`, `uses`, `triggers` | ink 2 px | none | filled 9×7 |
| `attaches` (when drawn) | ink 1.5 px | none | filled 7×5 |
| `peers` | ink 2 px | 6 5 | filled both ends |
| `connects` | ink 2 px | none | none, round caps |
| `memberOf`, `runsAs`, `encryptedBy` | ink 1.2 px | 1 3 | open 7×5 |
| `replicates` | ink 2 px | none | hollow 9×7 |
| `shares` | ink 1.5 px | 8 4 | filled 7×5 |
| `secures` | drawn as a dashed overlay zone (`accent.path` at 50 %, dashed 6 4, 2 px, on a `pathCasing` band 1 px each side over a `canvas` core) 4 px inside the target's border, not a line | | |

- Edges are orthogonal with 6 px rounded elbows; arrowheads end 2 px inside the target border; never on a
  header.
- Above 30 drawn edges, dim mode: every line in `edge.dim`, 1.2 px, keeps its kind's head *shape* at 7×5 in
  `edge.dim` (filled, hollow or open; both ends for `peers`), and the line stops at the head's base so the tip
  reaches the target border as in normal mode: the legend's head samples stay true, and peers (double-headed)
  and shares (one head) differ by more than their dash rhythm. The traced lines (§6) are redrawn on top.
- `secures` overlays are painted under the lines (zones, nodes, overlays, then lines) and inside the target's
  border, never in the gutter the lines run in. Each names its policy: a `<title>` on the overlay ("secures —
  web-armor"; "secures — policies in <chip>" when the policy sits in a collapsed zone; "secures — N policies"
  for several), shown when the pointer rests on its dashes, and the legend row says the same for all overlays.
- Zoomed past 2×, strokes thin to 1.5 px.

## 6. Highlight states

- Select: the **selection trace** stays painted until the selection changes (ids, not elements, carry it, so
  it survives pan, zoom, a theme change and a new layout of the same view):
  - *Path to the root:* every zone around the node up to the top level (the canvas is the organisation) gets
    an `accent.path` 3 px ring on its border, on a `pathCasing` band 1 px each side (light `muted` #5F6368,
    which reaches 3 : 1 on every light fill and the amber 3.13 : 1 on it; dark `canvas`).
  - *Traced lines:* every line touching the node or anything inside it, plus the `routes` and `connects` chain
    through the node, followed transitively downstream (along `routes`) and upstream (against it) up to 8 hops
    each way, cycle-safe; `connects` is followed both ways. Only chains *through* the node count: a backend
    service reaches back to its forwarding rules and on to its backends, never sideways to the other backends
    of its URL map. Each traced line is redrawn on top in `accent.select` 3 px over a `canvas` casing 4 px on
    each side, its kind's dash rhythm scaled to 3 px (`1 3` at 1.2 px → `2.5 7.5`: dotted kinds stay dotted,
    `peers` `9 7.5`, `shares` `16 8`), its heads in `accent.select`. An end inside a collapsed zone is its
    chip, so the chain runs on through chips. In dim mode the trace is the focused set.
  - *Reached nodes:* the far ends of the traced lines get a 1.5 px `accent.select` ring outside a 2 px
    `canvas` gap.
  - *The node:* an `accent.select` 3 px ring between 2 px `canvas` gaps with a 1 s two-step pulse (none with
    reduced motion); its "Open in Cloud Console ↗" action ("Open project in Cloud Console ↗" for a type
    without a console template) opens the page in a new tab only when activated; the drawer opens. The action
    sits inside the node, in its top-right corner over the border: at rest a 16 px circle around an
    `accent.select` ↗ glyph (1.5 px) with a 1 px `accent.select` outline on `canvas`, concentric with a card's
    8 px corner (an open zone's: 2 px further in); on hover, keyboard focus and a long press it grows
    leftwards into a 16 px pill with its label in `accent.select` 11 px/500 where that pill fits inside the
    node (an open zone keeps the circle, so the label never covers its header); its tooltip and accessible
    name say what it opens. It never reaches outside the node, so it never covers a neighbour (two rows of
    cards are 20 px apart). It is a tab stop after the node while the node is selected (Escape there clears
    the selection and returns focus to the node); keyboard focus fills it in `primary` with its glyph and
    label in `canvas`. The node's menu offers the same link.
  - *Legend:* a column "selected", "trace", "path to root" while a node is selected.
  - Paint order: zones, nodes, `secures` overlays, lines, the path, reach and selection rings, the traced
    lines (so no ring's gap hides a traced head), the focus ring, the console action, the legend.
- Hover previews the same trace transiently without changing the selection; the hovered node also gets a path
  ring (its path starts there). With a selection, only cards, chips and card-sized zones preview, so resting
  the pointer on an open zone never hides the selection's trace. On a touch screen a long press is the hover:
  the same preview, with the tooltip there (or else the node's name) in a chrome tooltip's look above the
  finger, inside the canvas, until the next touch (AGENTS.md, Product rules, the touch model).
- Search hit: as select plus a 200 ms glide to centre; collapsed ancestors expand first.
- Domain/related peers: `accent.peer` outline; the direct edge between peers turns `accent.peer` and dashed.
- Timeline: added → `accent.peer` outline for one tick; removed → ghost card (dashed `accent.removed`, 50 %
  opacity) for one tick; changed → 6 px `accent.path` dot top-right. Legend gains the three markers.
  As drawn: the outline 2 px, centred 8 px outside the node, between 2 px `canvas` gaps (the selection
  ring's construction), on the outermost node of an added subtree only; the ghost's *body* (fill and icon) at
  50 %, its label in the readable grey of that body, its dashed outline (1.5 px, `5 3`) at full strength on a
  `canvas` band 1 px wider each side (at 50 % the red is below 3 : 1 on the canvas); the ghost of a zone the
  earlier day drew as the view's overlay (a perimeter around its projects) untinted, as the overlay was, with
  the overlay's dashed outline (§5) 4 px inside the red one and the legend's `secures` row; the dot centred on
  the rounded top-right corner on a `pathCasing` disc 1 px wider; a chip holding a change gets the dot. Each
  legend row only while its marker is drawn ("added since 2026-09-07"; "compared with" when the day compared
  with is later).

## 7. Legend and title block

Inside the SVG, bottom-left, `surface` panel with `border` stroke. Rows only for what is on screen: zone tints
present, "Resource" card sample, each relation kind present, the `secures` row named by its policy (§5),
"dim = not focused" when active (a dimmed line with its 7×5 head), the selection trace's column while a node
is selected (§6), timeline markers when a tick is active. Title block top-left: scope display name (15 px/500,
`ink`), lens and `readTime` in ISO-8601 with the viewer's timezone offset (11 px, `muted`), then the tagline
"gcportrait.app - Visualize your Google Cloud Infrastructure" (10.5 px/400, `muted`; `TAGLINE` in
`frontend/src/branding.ts`). The title block stops there, on the interactive canvas and in every export alike
(SVG, PNG, `pnpm render`, the render API, the layout's debug renders): no drawing carries the non-affiliation
statement, neither in the title block nor in the SVG's `<desc>`, which holds neutral metadata only (scope,
lens, read time, "Drawn with gcportrait."). The statement lives in the app footer and the website footer and
in the long form (AGENTS.md, "Non-affiliation, brand and legal"). Legend and title block are hidden from the
interactive canvas when the user disables them in settings, but always included in exports.

## 8. Export rules

- SVG: resolve every CSS variable to an attribute; inline icons (already inline); include `<title>` and
  `<desc>` with scope, lens, readTime; fonts via a `font-family` stack (no @font-face embedding by default; an
  "embed fonts" option exists and adds the Roboto subset as data URIs).
- PNG: 2× default, 3× option, theme background filled, 24 px margin.
- Whole diagram or current viewport; file name `gcportrait_<scope>_<lens>_<readTime>.<ext>`.
- Clipboard copy for PNG.

## 9. App chrome tokens (Material-3-style, minimal)

Light: `primary #1A73E8`, `on-primary #FFFFFF`, `surface #FFFFFF`, `surface-container #F8F9FA`,
`on-surface #202124`, `on-surface-variant #5F6368`, `outline #DADCE0`, `error #D93025`.
Dark: `primary #8AB4F8`, `on-primary #062E6F`, `surface #1F1F1F`, `surface-container #303134`,
`on-surface #E8EAED`, `on-surface-variant #9AA0A6`, `outline #5F6368`, `error #F28B82`.
Focus ring: 2 px `primary` with 2 px `surface` gap. Controls 32 px tall, 8 px radius, 13 px text; on a phone
or a tablet (narrower than 80rem) 44 px tall, and every other target at least 44 × 44 px (`--touch-target`). A
segmented control there wraps its segments onto rows that fill its width, divided by 1 px gaps in `outline`
(never a segment's own border, which would stand alone at the start of a wrapped row), and clips them to its
rounded corners, so its focused segment carries the ring inside its edge: 2 px `primary`, then the 2 px
`surface` gap. On the diagram canvas the ring is the diagram token `focus` with 2 px `canvas` gaps, kept at
least 2 px on screen at any zoom: dark `#8AB4F8` (the dark `primary`), light `focus #185ABC` (Google Blue
800), because the light `primary` reaches only 2.62 : 1 against the light project tint a focused card's ring
lies on and `#185ABC` reaches 3.78 there and more on every other fill (the focused console action and collapse
plate use it too). Implemented as CSS custom properties in `frontend/src/styles/tokens.css`; a new colour goes
into this skill first, then into the tokens, in both themes.

## 10. WCAG 2.2 checks (automated in `frontend/src/diagram/theme/theme.test.ts`)

Contrast ratio = (L1 + 0.05) / (L2 + 0.05) with relative luminance per WCAG. Thresholds:

| Pair | Minimum | Criterion |
|---|---|---|
| text on its background (card title/subtitle, zone title on tint, legend, chrome) | 4.5 : 1 (3 : 1 if ≥ 18.66 px bold) | 1.4.3 |
| zone stroke vs. zone fill and vs. parent fill | 3 : 1 | 1.4.11 |
| card stroke vs. card fill and vs. containing zone fill | 3 : 1 | 1.4.11 |
| edge colour vs. every zone fill it can cross | 3 : 1 | 1.4.11 |
| accent strokes vs. the fills they sit on (or the casing or gap of their construction: traced lines on their `canvas` casing, reach and selection rings on their `canvas` gaps, the path to the root on its `pathCasing` band, which itself reaches 3 : 1 on every fill where the amber alone does not) | 3 : 1 | 1.4.11 |
| console action text on its pill; on its focused pill (`canvas` on `focus`) | 4.5 : 1 | 1.4.3 |
| focus ring vs. adjacent colours, and the canvas ring vs. every fill it is drawn over | 3 : 1 | 2.4.13 |

What the tokens below reach, and what the nearest alternative would reach (which is why it is not used):

| Token | Light | Dark |
|---|---|---|
| `zone.folder`, `zone.other`, `zone.nested`, `zone.region` strokes | `#5F6368` (`muted`): 3.52 : 1 on the project tint at worst (a container or a region on a project), 5.44 on the folder fill; `#9AA0A6` would reach 2.37 on the folder fill, 2.50 on `other`, 2.03 on `nested`, 1.54 on a project, and the region's `#DADCE0` 1.25 on a project | `#9AA0A6` (`muted`): 4.07 : 1 on the nested tint at worst; `#5F6368` would reach 2.34 on the folder fill, 2.15 on `other`, 1.78 on `nested`, 1.91 for a region on a project |
| `edge.dim` | `#5F6368`: 3.52 : 1 on the project tint at worst, 6.05 on the canvas; `#BDC1C6` would reach 1.81 on the canvas, 1.05 on a project | `#9AA0A6`: 4.07 : 1 on the nested tint at worst, 6.24 on the canvas; `#5F6368` would reach 2.72 on the canvas, 1.78 on `nested` |
| `zone.subnet` stroke | `#FDE293` (decorative, below) | `#B39B4C`: 4.53 : 1 on its fill, 4.55 on the VPC tint, and 1.94 against the path accent's amber `#FDD663`, so a subnet never looks highlighted |
| `mutedOnTint` | `#3C4043` (the `chip.text` grey): 6.09 : 1 on the project tint, where `muted` reaches 3.52 | `#BDC1C6` (the card stroke): 6.39 on the project tint and 5.94 on `nested`, where `muted` reaches 4.38 and 4.07 |
| `pathCasing` | `#5F6368` (`muted`): the amber `#F9AB00` reaches 3.13 : 1 on it (1.13–1.93 on the light fills), and it reaches 3.52 on the project tint at worst; `ink` would read as hazard tape | `#1F1F1F` (`canvas`): the amber reaches 11.75 : 1 on it |
| console action | text on its pill 4.51 : 1; `canvas` on its focused `focus` pill 6.51 | 7.82; 7.82 |
| timeline markers | `accent.peer` 5.02 and `accent.removed` 4.77 on their `canvas` gap and band (2.92 and 2.78 on the project tint alone); `accent.path` 3.13 on its `pathCasing` disc; a ghost's label 4.53 on its body at worst | 8.42, 6.90; 11.75; 4.57 |

Secondary text uses `muted` where it reaches 4.5 : 1 and `mutedOnTint` where it does not (the light project
tint; the dark project and nested tints), so an id stays lighter than its title.

Known tension: `zone.subnet` stroke `#FDE293` on `#FFEEBD` is below 3 : 1. The test marks this pair as
"decorative stroke" and requires the subnet **title text** and the **card stroke** inside it to pass instead;
the subnet border is a 1.5 px hairline whose meaning is carried by the fill and the title. Do not "fix" this
by darkening the subnet fill; that breaks the Google look. The same exemption applies to `zone.vpc`. In dark
both pass; the dark subnet stroke is `#B39B4C` (4.53 : 1 on its fill), not the accent amber `#FDD663`, so a
subnet never looks highlighted.

Non-colour cues: every edge kind differs by dash or head, every zone kind by title position, header mark or
badge (a chip by its zone's header mark), timeline changes by outline/ghost/dot, so colour-blind viewers lose
nothing.

## 11. Fact-check list for a render (use for review)

1. Is every icon an unmodified official glyph or a listed own drawing? No recolouring on dark?
2. Are zone tints exactly the tokens above, with the right stroke widths?
3. Do folder titles sit top-left and all other titles centred, with halos?
4. Are all edges orthogonal, with rounded elbows, heads on borders (never headers), no crossing of cards?
5. Are dash patterns and heads correct per relation kind? Peering double-headed and dashed?
6. Dim mode engaged above 30 edges, dimmed lines with 7×5 heads reaching their target? Traced lines cased,
   on top, heads in `accent.select`, dotted kinds still dotted; the path to the root ringed; `secures`
   overlays inside their targets; the console action inside the selected node, never over a neighbour?
7. Legend lists only what is present, is inside the SVG, and survives export?
8. Title block present with scope, lens, readTime and the tagline, the same three lines on the canvas and in
   an export, and no non-affiliation line in it or in `<desc>` (the footer carries the notice, §7)?
9. Both themes rendered and the contrast test green?
10. Nothing below 10.5 px at scale 1; LOD thresholds respected?
11. Exported SVG opens in a browser and in Inkscape with identical geometry; PNG has the theme background?
12. Timeline markers only when a tick is active; removed ghosts dashed at 50 %?

## 12. Anti-patterns

- Status colouring of cards (red for "unhealthy") — not a gcportrait concept.
- Gradients, drop shadows on zones, 3-D effects.
- Per-product zone colours (every product gets a different tint) — tints encode container *kind* only.
- Diagonal or curved edges.
- HTML overlays for anything that must appear in an export.

## 13. Accessibility

Every page, the diagram included, meets WCAG 2.2 AA in both themes and at every width, the phone's, the
tablet's and the desktop's (AGENTS.md, "Style and accessibility").

- **Keyboard.** Tab moves through the header controls in reading order; on the canvas the arrow keys, Home
  and End move focus between the cards of a zone; Enter opens the details drawer for the focused card; `/`
  focuses search; `[` and `]` step the timeline one day back and forward. Every action a pointer can take has
  a keyboard path (the console action is a tab stop after its selected node, §6).
- **Names.** Every card, chip and zone has an accessible name made of its type and its label ("Cloud Run
  service" and the service's name).
- **Focus.** Focus rings reach 3 : 1 against what they are drawn over, at any zoom (§9, §10).
- **Colour never carries meaning alone**: edge kinds differ by dash or head, zone kinds by title position,
  header mark or badge, timeline changes by outline, ghost or dot (§10, "Non-colour cues").
- **Touch.** On the canvas a finger pans, pinches, taps to select, double-taps to zoom in and long-presses for
  what hover shows (AGENTS.md, Product rules, the touch model); a node's menu and drill-in are in the details
  drawer.
- **Motion** follows the reduced-motion setting (no selection pulse).
- **Checked by** the e2e suite (`e2e/tests/a11y.spec.ts`): axe reports zero violations on every page in both
  themes, and on the diagram also with the keyboard inside a zone and with a node's menu and the drawer open;
  `e2e/tests/mobile.spec.ts` at phone and tablet widths, with the top bar's sheets and the drawer open,
  together with 44-pixel targets; `e2e/tests/touch.spec.ts` the canvas's gestures by finger on a phone. The
  frontend README describes the keyboard model per module.
