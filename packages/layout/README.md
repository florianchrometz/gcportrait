<!-- SPDX-License-Identifier: MIT -->

# @gcportrait/layout

The layout engine (its specification is the
[skill gcp-diagram-layout](../../.agents/skills/gcp-diagram-layout/SKILL.md)): a `Scene` from
`@gcportrait/model` becomes a `Layout` of absolute rectangles for every zone, chip and card and an orthogonal
path for every edge. It is gcportrait's own engine: nested zones packed bottom-up into tidy grids
that aim at a target aspect ratio (stages 1–3), then edges routed through the gaps between them, in lanes,
never across a card or a header (stages 4–5), and the invariants that check both (see "Pipeline"). A worker
protocol runs it off the UI thread, cancels superseded requests between stages and memoises the last eight
Layouts by a structural hash of the Scene ("Worker" below).

The package is a pure core (AGENTS.md, Layout and drawing rules): no DOM, no randomness, no clock (unless the
caller passes one for timings), no I/O; `src/` compiles without DOM or Node types. Text is never measured from
the DOM: widths come from a font metrics table generated at build time from the Roboto files the app
self-hosts. It imports `@gcportrait/model` only.

```ts
import { assertLayout, layoutScene } from '@gcportrait/layout';

const layout = layoutScene(scene); // demo S, lens overview, from @gcportrait/graph's buildScene
layout.rects['//cloudresourcemanager.googleapis.com/projects/10000000009'];
// { x: 996, y: 404, width: 504, height: 352, parent: '//cloudresourcemanager.googleapis.com/folders/20000000004',
//   role: 'zone', kind: 'project', depth: 4, headerHeight: 32, padding: 16, collapsed: false }
layout.arrangements.zones['//cloudresourcemanager.googleapis.com/projects/10000000009'];
// { cardColumns: 2, zoneRows: [] }: its seven cards in two columns
layout.bounds; // { x: 0, y: 0, width, height }: the canvas
layout.edges['//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/vpnTunnels/tunnel-onprem-dc1-0 -connects-> …'];
// { from, to, kind, count, merged, heads: 'none', source: { x, y, side }, target: { x, y, side },
//   points: [{ x, y }, …], elbowRadius: 6, fallback: false, bundle?: { id, end: 'source' | 'target', size } }
layout.gutters; // the gutter reservations the rects were packed with (the router's widening included)
layout.report; // { counts, routing, warnings (sorted), timings? }
assertLayout(scene, layout); // throws LayoutInvariantError in development builds when an invariant breaks
```

## Public API

| Export | What |
|---|---|
| `layoutScene(scene, options?)` | `Layout`: `rects` (one per Scene node, keyed by id, parents before children), `edges` (one routed `EdgePath` per drawn edge, keyed `<from> -<kind>-> <to>`), `chips` (ids of collapsed zones), `bounds` (the canvas), `arrangements` (how each container was packed), `gutters` (the reservations it was packed with), `report` |
| `LayoutRect` | `x`, `y`, `width`, `height`, `parent` (`null` at the top level), `role` (`zone`, `chip`, `empty`, `card`), `kind` (the zone kind or `card`), `depth` (the canvas is 0, the top level 1), `headerHeight` and `padding` (open zones; 0 otherwise), `paddingExtra?` (extra padding per side, the router's lane space; absent when none), `collapsed` |
| `EdgePath`, `EdgePort`, `EdgeHeads`, `EdgeBundle`, `Side` | a routed edge: `from`, `to`, `kind`, `count` (relations it stands for), `merged`, `heads` (`end`, `both`, `none`), `source` and `target` ports (`x`, `y`, `side`: on the rects' borders), `points` (orthogonal polyline from the source end to the target end; an end with a head stops at its tip, 2 px inside the border), `elbowRadius` (6; 0 for a straight edge; the renderer clamps it beside a head, see "Geometry"), `fallback`, `bundle` (a hub bundle's members: its `id`, the shared `end` and its `size`; absent for an edge of its own) |
| `Arrangement`, `Arrangements` | a container's packing: `cardColumns` (the card grid), `zoneRows` (zones per row, top to bottom) and `zoneStacks?` (per row, the zones of each cell: a cell of more than one is a stack; absent when every cell is one zone); `Layout.arrangements` has one for the `canvas` and one per open zone in `zones` |
| `LayoutOptions` | `sizing` (overrides of `DEFAULT_SIZING`), `targetAspect` (1.6), `rootAspect` (1.75), `aspectTolerance` (0.2), `fontMetrics` (default: the generated table), `gutters` (the gutter hook below), `arrangements` (pinned arrangements, below), `route` (false: stop after packing), `routing` (overrides of `DEFAULT_ROUTING`), `clock` (for `report.timings` only) |
| `LayoutReport` | `counts` (rects, zones, chips, empty zones, cards, Scene edges, maximum depth, organisation zones dropped, labels too long for a card or chip, zone titles capped at `zoneTitleMaxWidth`, zones widened by their header), `routing` (`RoutingReport`, below), `warnings` (sorted in code-point order), `timings?` (normalise, size, pack, route, total in ms; only with a `clock`) |
| `RoutingReport` | `mode` (the policy: `three-pass`, `single-pass`, `none`), `passes` (routing passes run: 1 to 4), `edges` (routed), `holders` (lane holders: edges routed on their own plus hub bundles; above `lateRoundsUpTo` of them two widening rounds at most), `work` (the first routing pass's search work: the A* states it settled, which decide single-pass mode and the one-round band), `duplicatesMerged`, `reciprocalMerged`, `bundles` and `bundledEdges` (hub bundles), `dropped` (an end at the canvas, or inside one chip), `fallbacks` and `failed` (0 unless something is wrong), `bends` (histogram: `bends[k]` edges with k elbows), `maxLanes`, `widened` (containers), `wideningRounds`, `squeezed` (gutter lines whose lanes did not fit; the report warns), `overlaps` (edges with a stretch no lane kept clear of another edge; 0 unless something is wrong; the report warns) |
| `GutterReservations`, `GutterWidening`, `GapWidening`, `Insets` | per container (`canvas`, or `zones[id]`): extra `horizontal` and `vertical` gap and padding `ring` (uniform), `ringSides` (per side) and `gaps` (`cardColumns[c]`, `zoneColumns[r][i]` after cell i of zone row r, `rows[k]`, `stacks[r][c][k]` below zone k of the stack in cell c of zone row r: single gaps), added to the base sizes |
| `Point`, `Rect`, `RectRole`, `StageTimings`, `LayoutCounts` | the remaining output types |
| `measureText(text, weight, size, { family?, metrics? })` | width in px of `text` in Roboto 400/500/700 (or Roboto Mono) from the metrics table |
| `subtitleRuns(subtitle)`, `TextRun` | a subtitle split into runs and their faces: addresses (IPs, CIDRs) `mono`, the rest `sans`; the layout measures subtitles this way and the SVG renderer must set them this way |
| `defaultFontMetrics()`, `parseFontMetricsTable(value)`, `fontFaceKey`, `FONT_FACE_KEYS`, `FontMetricsTable` | the table and its format |
| `DEFAULT_SIZING`, `Sizing`, `DEFAULT_ROUTING`, `Routing`, `TARGET_ASPECT`, `ROOT_ASPECT`, `ASPECT_TOLERANCE`, `TEXT_WEIGHTS`, `ZONE_TITLE_SEPARATOR`, `ZONE_KIND_RANK`, `MAX_SCENE_DEPTH` | the constants below; the SVG renderer reads the same ones so text fits the boxes and heads fit the edges |
| `cardWidth`, `headerHeightAt`, `zoneTitleSizeAt`, `zoneTitleWidth` | the sizing rules, for the renderer |
| `chipWidth`, `chipCountLine`, `CHIP_COUNT_NAMES`, `ChipText` | a chip's width from its label and count line (148–220) and the count line itself ("2 networks · 39 resources", short form "2 net · 39 res"): the one definition of its wording, which the renderer should import (the frontend still has its own copy: see "Known limits") |
| `compareCodePoints`, `compareSiblings` | the deterministic sibling order |
| `checkLayout(scene, layout, options?)`, `assertLayout(…)`, `checkEdges(…)`, `checkDeterminism(scene, options?)`, `contentBox`, `canvasContentBox`, `LayoutInvariantError` | the invariants (`checkLayout` includes `checkEdges`) |
| `packingAspects(layout, options?)` | each container's children box, its aspect, target, relative deviation and fill |
| `LayoutInputError` | a refused Scene or option: `code` (`duplicate-id`, `unknown-endpoint`, `cycle`, `collapsed-with-children`, `too-deep`, `invalid-option`) and the offending `ids` |
| `layoutSteps(scene, options?)`, `LayoutProgress`, `LayoutStage`, `ROUTE_STEP` | `layoutScene` as a generator: yields a `LayoutProgress` (`stage`: `normalise`, `size`, `pack`, `route`, `widen`; `pass`, `routed`, `edges`) after each stage and every `ROUTE_STEP` (128) edges of a routing pass, returns the Layout; drained, it is `layoutScene` byte for byte |
| `createLayoutWorkerHandler(postMessage, environment?)`, `LayoutWorkerEnvironment`, `LayoutWorkerRequest`, `LayoutWorkerResponse`, `LayoutWorkerOptions`, `LayoutCancelReason`, `LayoutWorkerErrorCode`, `LayoutWorkerErrorInfo` | the worker side of the protocol ("Worker" below); `environment`: `yieldToHost`, `clock` (for `report.timings`), `memoCapacity` (8; 0 turns the memo off) |
| `layoutClient(worker)`, `createLayoutClient(post)`, `LayoutClient`, `LayoutResult`, `LayoutRequestOptions`, `LayoutCancelledError`, `isLayoutCancelled`, `LayoutWorkerError`, `LayoutWorkerLike`, `MessageEventLike`, `AbortSignalLike` | the page side: `client.layout(scene, options?, { signal?, onProgress? })` → `Promise<LayoutResult>` (`layout`, `key`, `cached`, `id`), `cancel()`, `fail(message)`, `dispose()`, `receive(message)`, `pending` |
| `layoutKey(scene, options?)`, `structuralHash(value)`, `MAX_KEY_DEPTH`, `MAX_KEY_UNITS` | the memo key: a 64-bit structural hash (16 hex digits and the length fed), independent of object key order; `null` for a value that is not a plain-data tree |
| `LayoutMemo`, `MEMO_CAPACITY` | the least-recently-used memo the handler keeps (8 Layouts) |

## Worker

The app lays out in a dedicated worker (AGENTS.md, Layout and drawing rules; skill §7: "memoise by Scene hash;
cancel superseded requests; never block the UI thread"). `src/worker.ts` is the protocol, `src/client.ts` the
page side; both are plain functions of `postMessage`, so the same code runs in a Web Worker, a Node
`worker_threads` worker (`scripts/lib/layout-worker.ts`, used by the bench and the tests) or in-process in a
test.

**Protocol.** The page posts `{ type: 'layout', id, scene, options? }` (`options` are `LayoutOptions` without
`clock`: a function cannot cross `postMessage`) and `{ type: 'cancel', id }`. The worker answers each request
with any number of `{ type: 'progress', id, progress }` and then exactly one of `{ type: 'result', id, key,
cached, layout }`, `{ type: 'cancelled', id, reason }` (`superseded` or `cancelled`) or `{ type: 'error', id,
error: { code, message, ids } }` (`code`: a `LayoutInputError` code with the offending ids, so the UI can name
them instead of drawing half a diagram, skill §2 rule 5; `protocol` for a malformed message; `internal` for a
bug).

**Cancellation.** Every `layout` request supersedes the request before it: the worker answers the older one
`cancelled` at once and drops its layout at the next step. The layout runs as a generator (`layoutSteps`) that
stops after normalisation, sizing and packing, after every `ROUTE_STEP` (128) edges of a routing pass and
after each widening re-pack (L overview at `all`: 28 steps, the longest about 30 ms, the last and longest
edges of its single routing pass; M overview at `all`: 15 steps of at most 7 ms); before each step the handler
yields to the host's task queue (`src/host.ts`: `setImmediate` in Node, a private `MessageChannel` in a
browser, which unlike `setTimeout(0)` is not clamped to 4 ms, else `setTimeout(0)`), so a message posted
meanwhile is handled first. A superseded or cancelled request never gets a result, nor any progress after its
`cancelled`; nothing is shared between two layouts, so dropping one mid-way leaves no state behind. A burst of
requests lays out only the last (the first step waits for a yield too). A request whose memo key is the one
still being laid out (a repeated request, or one cancelled and asked for again before the next step, as React
does when it runs an effect twice) takes the running layout over instead of starting again.

**Memoisation.** The key (`layoutKey`, `src/hash.ts`) is a structural hash of the Scene's tree (`children` and
`edges`) and the options; the Scene's `metadata` (root label, lens, read time, rect count, refusals) is left
out, because the layout never reads it (`layout.test.ts` lays out a Scene with other metadata and compares),
so two timeline days whose Scenes differ only in their read time share one Layout. In the hash, equal data
hashes alike whatever the order of its objects' keys (zod lists a parsed object's keys in schema order, a
hand-built Scene in any order), arrays keep their order, and `undefined` values count as absent, as in JSON.
Two 32-bit lanes run over type tags, lengths, keys in code-unit order and text two UTF-16 units at a time, and
are avalanched and cross-mixed into 64 bits; the key is 16 hex digits and the number of units fed. No
collision among 3 000 random distinct JSON values is a test, and so are pinned values. A value that is not a
plain-data tree (a function, a cycle, more than `MAX_KEY_DEPTH` levels, more than `MAX_KEY_UNITS` units) has
no key and is laid out without the memo; the layout then refuses a Scene that is not a tree with its typed
error. The memo keeps the last `MEMO_CAPACITY` (8) Layouts, least recently used out first; a hit is answered
synchronously with the stored Layout, byte-identical to the first answer. Hashing the demo XL Scene at
`folders` (217 000 characters of JSON) takes about 0.7 ms. The worker's Layouts are structured clones on the
page; in-process (a test, or a host without workers) the handler hands out the stored object itself, which the
caller must not mutate.

**Mounting it in the frontend.** The worker module is a few lines; Vite bundles it, with
`@gcportrait/layout` and the metrics table, through its `?worker` import:

```ts
// frontend/src/diagram/layout.worker.ts
/// <reference lib="webworker" />
import { createLayoutWorkerHandler } from '@gcportrait/layout';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const handle = createLayoutWorkerHandler((message) => scope.postMessage(message), {
  clock: () => performance.now(), // optional: report.timings for diagnostics
});
scope.addEventListener('message', (event) => handle(event.data));
```

```ts
// frontend/src/diagram/useLayout.ts (sketch)
import LayoutWorker from './layout.worker.ts?worker';
import { isLayoutCancelled, layoutClient } from '@gcportrait/layout';

const client = layoutClient(new LayoutWorker()); // one client per worker, created once

useEffect(() => {
  const controller = new AbortController();
  client
    .layout(scene, undefined, { signal: controller.signal, onProgress: setProgress })
    .then(({ layout }) => setLayout(layout))
    .catch((error: unknown) => {
      if (!isLayoutCancelled(error)) setError(error); // LayoutWorkerError: code and ids
    });
  return () => controller.abort();
}, [scene]);
```

Each request supersedes the one before it (the client rejects the older promise at once with
`LayoutCancelledError`, `reason: 'superseded'`), so the abort in the cleanup matters on unmount; under React's
development double effects the aborted request and its repeat share one layout (above). `client.dispose()`
cancels the pending request and detaches the listener; terminating the worker is the caller's
(`client.fail(message)` rejects what is pending if it dies). One client per worker: the worker supersedes by
arrival, whoever posted. The frontend's tsconfig references `packages/layout`.

## Pipeline

1. **Forest normalisation** (`src/normalise.ts`). The Scene is validated first, so a refused Scene is refused
   before any work (skill §2 rule 5: an error with the offending ids, never a half-drawn diagram): unique ids,
   every edge end present, a real tree (a node object that contains itself is a `cycle`), chips without
   children, and at most `MAX_SCENE_DEPTH` (256) levels of nesting (`too-deep`, naming the top-level node and
   the node past the limit: a real Scene is about a dozen levels deep, and the limit keeps every recursive
   stage far from the call stack). A Resource Manager organisation zone at the top level is unwrapped, because
   the canvas is the organisation (the Scene normally omits it; edges that end at one are counted in a
   warning; the dropped ids are sorted, so the report does not depend on the Scene's order). Each node gets
   its depth from the canvas (the canvas, the organisation, is 0: root folders and loose projects are 1;
   header height, title size and the renderer's nested tint at depth ≥ 3 follow from it) and its role: an open
   `zone`, a `chip` (a collapsed zone), an `empty` zone (no children in the Scene, drawn card-sized with its
   icon, skill §2 rule
   4) or a `card`. Every child list is sorted: zones before cards; zones by kind rank (folder, project, VPC,
   subnet, region, product container, bundle), so folders rank before projects at the root; then by label in
   code-point order (locale-independent); then by id.
2. **Sizing** (`src/size.ts`). Cards and empty zones: height 44; width = 10 + icon 24 + 10 + the wider of the
   title (13 px, 700) and the subtitle (10.5 px, 400) + 10, rounded up to whole px and clamped to 148–220
   (longer text is ellipsised by the renderer and counted in `truncatedLabels`). Subtitles are measured run by
   run (`subtitleRuns`): the subtitle's facts are joined by `' · '`, and a fact that is an address (an IPv4 or
   IPv6 address or CIDR range in its standard text form, or a comma-separated list of them) is set in Roboto
   Mono, everything else in Roboto (style §3); versions (`3.1.2`), times (`12:30`) and `host:port` are not
   addresses. Chips (`src/chips.ts`): height 44; width = 10 + the 16 px ⊞ glyph + 8 + the wider of
   the label (13 px, 700) and the count line (10.5 px, 400) + 10, rounded up and clamped to 148–220; the count
   line is measured in its full form ("1 network · 4 subnets · 2 containers") when that fits a 220 px chip,
   else in its short form ("1 net · 4 sub · 2 ctr"), as the renderer draws it (`chipCountLine`). Sibling chips
   and empty zones then share the widest of their widths, as the cards of a column do, so rows of them line up
   and the packer never prefers a ragged grid for a few pixels. Open zones: header 40 up to depth 2 and 32
   below, padding 24 for projects at the top level and 16 otherwise (plus any reserved ring), and the
   narrowest width the header needs: icon, title (15 px at depth 1, 13 px deeper, 500), then `' · '` and the
   zone's subtitle (same size, 400, in runs like a card's), the two together counted at most
   `zoneTitleMaxWidth` (660 px, three card widths: the renderer ellipsises a longer title, the full label
   stays in the Scene for its tooltip and accessible name, and `counts.cappedTitles` counts them), and the
   badge pills (10.5 px, 400, 6 px padding, 4 px apart, 12 px after the title). Folder titles sit at the left;
   every other title is centred, so the badge block is reserved on both sides.
3. **Packing** (`src/pack.ts`), bottom-up: every zone is packed after its children, then the canvas. A
   container's children form two blocks, each in sibling order: the **card block** on top, a grid of
   `cardColumns` columns where each column is as wide as its widest card and every card in it takes that width
   (cards in a row share a baseline); and the **zone block** below it, open zones, chips and empty zones in
   rows (`zoneRows[i]` zones in row `i`), each row left-aligned and as tall as its tallest cell, the cells
   sharing its top edge. A cell is one zone, or a **stack**: consecutive zones one above the other,
   left-aligned, beside a single zone at least as tall in its row (`zoneStacks[i]`). The candidates are every
   card column count combined with every way to break the cells into rows (k per row, and rows filled up to a
   width budget at every width a run of consecutive cells, a card grid or the widest zone takes), the cells
   being the zones themselves, or, for 3 to 24 zones, the greedy stacks under every distinct zone height. One
   of the plain candidates is chosen by four rules:
   1. **Full rows** (skill §1, "a tidy grid"): no row but the last of its block has room for the next child
      within the children box's width. This rules out a wide card strip above a narrow stack of zones and a
      narrow card column above wide zone rows (skill §9, "huge empty zones").
   2. **Wider than tall** (skill §1): only candidates on the target's side of 1 compete, unless none is.
   3. **Smallest frame**: a children box within `aspectTolerance` (20 %) of the target counts as on target and
      is its own frame; any other box is framed to the target's aspect, so it pays for the empty strip that
      would make it look like the target. The smallest frame area wins: inside the band the most compact
      arrangement, outside it the closest to the target measured in area. For grids of equal boxes this is
      skill §4's rule (the column count whose grid is closest to the target).

   4. **Near ties**: among the candidates whose frame is within 2 % (`NEAR_TIE`) of the
      smallest, one whose rows do not hold more zones further down ranks first (no inverted, ragged grid:
      `[2, 1]` over `[1, 2]`), then one with fewer rows (a loose project shares the folders' row instead of a
      row of its own under a blank band).

   Ties go to the closer aspect, then fewer rows (skill §4), then fewer card columns. Then **stacks**: an
   arrangement with stacked zones replaces the chosen one only when its box fits inside it (no wider, no
   taller) with a smaller frame, so a stack fills the height a tall sibling gives its row and never makes its
   own container larger (the parent, choosing by frame, may then take a larger box: S everything's canvas
   grows 5.5 %). A zone is as wide as its packed children plus padding, or as its header needs if that is
   wider (children stay left-aligned); its height is header + padding + children + padding. Positions are then
   made absolute top-down, the canvas content starting at the canvas margin (24).

   These are skill §4's rules; `pnpm --filter @gcportrait/layout measure --packing` measures each of them on
   15 demo views.

All sizes are whole px with the default sizing, so every rect's position and size and every gutter line and
lane are integers. Ports lie on the half-pixel grid (`PORT_STEP`) by design: a side's slots are centred on it,
and on the top or bottom of a rect of odd width (a card's or a chip's width follows its text, a zone's its
children or its header, each rounded up to whole px) the middle lies on a half pixel, which keeps the port
exactly central instead of half a pixel to one side; positions spread over a crowded side are rounded to the
same grid. The points on the straight run of a route through a port (its end or the arrowhead's tip, and the
point where it turns) share the port's coordinate and so its half pixel; every other point of a route lies on
a lane, a whole px.

**The gutter hook.** Routing widens gutters and re-packs through `LayoutOptions.gutters` instead of
re-implementing packing: per container, `horizontal` and `vertical` add lane space to every column and row gap
(and to the gap between the card and zone blocks), `ring` widens the padding ring on all four sides (for the
canvas, its margin), `ringSides` single sides of it, and `gaps` single gaps (`cardColumns[c]` after card
column c, `zoneColumns[r][i]` after cell i of zone row r, `rows[k]` below row k, counting card rows then zone
rows, `stacks[r][c][k]` below zone k of the stack in cell c of zone row r). Wider gaps change every
candidate's size, so a re-pack could choose another arrangement and move gutters between passes; to keep every
row and column (and so every gutter's identity), pass the first pass's `Layout.arrangements` as
`LayoutOptions.arrangements`. A pinned arrangement is used as given (it must fit its container's children, or
`LayoutInputError` `invalid-option`); pinning a layout's own arrangements reproduces it byte for byte. The
packer's choice of arrangement does not look at `gaps` (they are positional).

4. **Gutters** (`src/gutters.ts`). After packing, every container (the canvas and every open zone) has an
   inner ring, the centre-line of its padding below its header (for the canvas, of its margin), and gutters on
   the centre-lines of the gaps between its rows (each from ring side to ring side), between the zones of a
   stack (across the stack, running on out like a row gap where the stack is the first or last cell of its
   row) and between its columns (card columns from the ring top down to the gap below the card block;
   neighbouring cells of a zone row from the gap above the row to the gap below it). A zone's horizontal
   gutters run on out through its padding and its border to its parent's gutter on either side of it, and its
   vertical gutters that reach its ring bottom run on down out of it; never up, because above a zone is its
   header. Where nothing stands beside the zone (first or last of its row), the line goes straight on through
   the parent's padding and border as far as the parent's own lines reach, and the same downwards from a
   parent's last row: a route leaves a deeply nested zone in one straight run, not a staircase of two bends
   per level. Every line runs through free space (property-tested over random Scenes). Each line keeps its
   strip (the width of the gap or padding it is the centre-line of) and its container and gap; collinear lines
   that touch merge, keeping their pieces. Each piece also records its **hugging stretches** (`hugSpans`): a
   ring side between its zone's corners (inside the padding band; beyond them the line is an extension,
   crossing a gap or running through free space) and the whole canvas ring (`margin`). A route along a ring
   side reads as a doubled border or an underline, so the router charges its length 1.5 times (`hugFactor`),
   but at most 320 px more than its length over the whole side (`hugCap`: a side longer than 640 px pays less
   per px), and the margin twice (`marginFactor`). A gap costs its length whether a child borders it on both
   sides, one or none: below a short zone beside a tall one, the gap runs through the same free space as the
   short zone's ring sides running on down, and a dearer gap would send routes down past their target into the
   canvas margin and back up those parallel lines. Without the cap, 9 000 px along a ring top would cost
   4 500 px extra, and routes there would drop to a far row gap and climb back to avoid it.
5. **Routing** (`src/edges.ts`, `src/ports.ts`, `src/portlines.ts`, `src/network.ts`, `src/occupancy.ts`,
   `src/route.ts`, `src/fallback.ts`; skill §5).
   - *Merging.* Scene edges are resolved to the rects they are drawn between: an end inside a collapsed zone
     goes to its (outermost) chip, as the Scene builder already does; an edge with an end at a dropped
     organisation zone, or with both ends at one rect, is dropped and counted. A symmetric kind
     (`direction: 'both'` in the model's `RELATION_KINDS`: `peers`) has its ends ordered, so reciprocal
     peerings become one double-headed edge; edges with the same (from, to, kind) collapse, their counts
     summed. Arrowheads come from the kind's default style: `both` for `dashed-double-headed`, `none` for
     `solid-round-caps` (`connects`), `end` otherwise.
   - *Bundles (hubs).* A rect that many edges of one kind meet at the same end (a Shared VPC host project that
     a hundred service projects share from and attach to; a load balancer that thirty backends use) cannot
     give each its own port 12 px apart (a 148 px chip's side holds 28) nor its gutters a lane per edge. So
     the edges of one kind meeting one rect at one end (all as targets, or all as sources) are bundled from
     `bundleMin` (3) on: they share one port, on the side most of them face, and the router lets them share
     lanes, so they join into one trunk towards it (a tree, drawn with one head). On a side that more ports
     face than it holds, the edges of one kind facing it are bundled from two on. An edge belongs to at most
     one bundle (the larger group of its two ends). `Layout.edges[…].bundle` names the bundle; `checkEdges`
     checks that its members share the port. One bundle per kind: a Shared VPC host with `shares` and
     `attaches` edges has two trunks.
   - *Ports.* An end leaves its rect on the side facing the other end (the axis on which the rects are further
     apart); never on an open zone's top (its header): left or right instead, below the header by the greatest
     of half the zone's padding, half `portClearance` and the half pixel ports are rounded to (`PORT_STEP`),
     so that none sits on the header's lower edge whatever the constants. A side too short for its corner
     clearance (`portClearance`, `zonePortClearance`) keeps one slot, its middle: on an open zone's left or
     right side, the middle of the stretch below the header. When an open zone contains the other end, its
     port is on the inside of its border, on the side nearest that end, and the inner end leaves on the same
     side. Ports on a side are `portSpacing` (12 px) apart (a bundle's port counts once), nearest the middle,
     ordered by where their other ends lie, clear of the corners; on a top or left side the slot grid is
     shifted by half a spacing, so two rects facing each other across a gutter never put ports at the same
     coordinate. On an open zone, ports keep out of the band of every gutter that passes through that side of
     its border (its own and its descendants'), so a stub never runs along a gutter's lanes. Ports that do not
     fit a side move to the neighbouring sides, then to the opposite side; only when every side is full do
     they share a side more closely. From the port a stub runs straight out to the gutter on that side (or,
     facing inwards, to the zone's own ring). An edge with both ends at one rect (inside one chip) is not
     drawn and counts in `dropped`; the Scene never holds an edge from a node to itself.
   - *Port lines*. Where a port faces a side nothing stands beside (the rect is the last or first
     of its row, or in the last row for a bottom port), the stub's gutter is its container's padding ring, and
     the space beyond it is free up to the container's border and on through every zone the rect's zone is the
     last of. A port line runs straight through that space, from the stub's gutter to the first gap beside one
     (or the canvas margin), one piece per container crossed. Only its edge (or, at a hub's shared port, the
     bundle's members) may run along it, on lane 0, the port's own coordinate, so a route leaves a nested chip
     in one straight run instead of turning along its zones' rings; other routes may cross it. A route may
     start along its source's port line (no turn onto the ring, so starting along the ring costs a bend there)
     and end along its target's. None on a top side, none for an inward port, none where a gutter line
     runs alongside it (within its lanes' reach and a pitch), another port's stub runs on it, or another port
     line meets it at nearly the same coordinate, and none of no length: without padding a zone's ring lies on
     its border, and without a gap beside the zone so does the gutter the line would end at, so the stub's own
     gutter is the way out (a single point leads nowhere). The router knows a port run by its line, whose
     pieces name the holder it belongs to, not by the segments the run covers, so a run along a port line is
     held on lane 0 even where it covers none (`runEnds` in `src/route.ts`).
   - *Graph.* Gutter lines are the segments, their intersections and the stubs' attach points the nodes
     (typed arrays). A segment's lane cost is `laneCost` spread over the gutter it belongs to, in proportion
     to length, so running the length of one gutter costs 50 per lane already in it, however many other
     gutters cross or join it. Each segment records its strip (the narrowest gutter width covering it) and the
     stable keys of its gutter pieces (container and gap).
   - *Search.* Each edge is an A* shortest path from its source's attach point to its target's, cost = length
     (1.5 × along a ring side, at most 320 more over the side; 2 × in the canvas margin) + 40 per bend + 50
     per other holder's lane already used in each gutter (pressure); a bundle's member pays no pressure for
     its own bundle's lanes and 0.9 of the length where its bundle already runs, so it joins the trunk. A
     state is a node and the axis the route arrived along; a step runs along either line through the node (the
     other one costing a bend) to the next intersection. The heuristic (distance, scaled by the cheapest
     length factor, plus the bends still needed) is consistent; ties go to the state nearer the goal, then the
     lower state number. A route uses only the gutters of the containers it has to cross (those holding either
     end, up to the innermost container holding both), so it never cuts through an unrelated zone and its
     search stays small; failing that (never seen), every gutter; failing that, the fallback. Edges are routed
     shortest first, then in id order.
   - *Lanes.* A route is a sequence of runs along gutter lines. A run takes a lane that is free (or its own
     holder's) in every segment it covers, preferring its bundle's lane there, and that keeps the drawing
     clear: the run itself, the elbow's reach into the gutter it turns onto (an elbow sits on that gutter's
     lane, past the end of the run's own line when the lane lies beyond the centre-line, the T-junction case)
     and the stub at either end must not run alongside another holder's segment closer than the lane pitch (8
     px; two stubs from facing ports: half the port spacing, 6 px, as close as the shifted slot grids put
     them). The first run is checked from its source port's coordinate along the run's own line and the last
     up to its target port's, where the route's points turn into the stubs. An index of every segment drawn so
     far, in absolute coordinates, answers those questions (`src/occupancy.ts`). Whether a lane keeps clear
     depends on the neighbouring runs' lanes, so a route's lanes are found together, lowest first, by a
     depth-first search over its runs (at most 200 candidates; then lane by lane, and a run that finds no
     clear lane is counted in `overlaps`). Lane k sits `laneSlot(k)` pitches from the line's centre-line,
     alternately either side (0, +1, −1, +2, …), so the busiest stretch of a line does not push its quiet
     stretches' lanes aside: n lanes need n × 8 + 8 px of gutter (one pitch more for an even n, keeping the
     outer lanes 8 px from the boxes).
   - *Passes.* Route (search every edge); widen every gutter whose lanes do not fit (its own gap, or its side
     of its container's ring, through the gutter hook) and re-pack with the arrangements pinned; re-route: the
     three passes. A laid route whose old lanes are all still free, fitting and clear keeps them without
     preparing its other preferences (what the lane search would find first). The re-route lays each route
     onto the widened gutters: every edge keeps its ports' sides, its bundle and its place in the order, and
     its route keeps its gutter pieces (keyed by container and gap, which the pinned re-pack keeps), its turns
     and its lanes, which is exactly what the widening made room for. Only an edge whose gutters no longer
     line up (a line it ran straight along has come apart, or two lines it turned between no longer meet,
     because the re-pack moved them) is searched again, keeping to its old corridor (1.5 × the length outside
     it) and lanes; in the re-route a full gutter is closed to the search and a lane must fit its gutter, and
     a route that does not fit is searched again avoiding the segments that did not (twice at most). Where the
     re-pack made two gutters meet that did not before, a few lanes can still not fit; further rounds
     (`wideningRounds`, 3 in all; 2 above `lateRoundsUpTo`, 500 lane holders, where a round costs too much of
     the budget) widen those and lay the routes once more. **Single-pass mode is decided by the first pass's
     search work**: the first pass searches exactly and counts the A* states it settles
     (`report.routing.work`; deterministic, and most of the routing time); once it has settled
     `singlePassWork` (420 000) it searches the rest of its edges weighted (the estimate ×
     `SINGLE_PASS_WEIGHT`, 1.5: each route costs at most 1.5 × the cheapest) and its route is final (no
     widening; lanes that do not fit are squeezed closer, `report.routing.squeezed`, with a warning). Above
     `oneRoundWork` (340 000) and below that, one widening round at most (the band: a view whose work grows
     loses a round before it loses the widening, and stays within its budget). L overview at `projects` (2 658
     edges, 1 234 lane holders, 290 252 states) routes in three passes with two rounds, 17 % below the band
     and 45 % below single-pass; L overview at `networks` and `all` and L load-balancing at `all` (exact first
     passes of 548 033, 827 309 and 520 348 states) stay single-pass. A count of lane holders would not
     measure cost: L load-balancing at `networks` (1 239 holders) costs about as much as L at `projects`
     (1 234), and at `all` (1 281) almost twice.
   - *Geometry.* Points: source port (or the head's tip, for `both`), stub end on the first run's lane, one
     elbow per change of run, stub start on the last run's lane, target port or the head's tip `arrowInset`
     (2 px) inside the border (at most the zone's padding deep in an open zone; at the border for a port on
     the inside of a containing zone). `elbowRadius` (6) tells the renderer to round each elbow, to at most
     half the shorter adjacent segment and, next to a head, to at most what the end segment leaves beside the
     head: a lane can be 8 px from the box, so an end segment can be 10 px, shorter than a 9 px head plus the
     radius, and the head must sit on a straight stretch (the debug renderer does this). A bundle's members
     coincide along their trunk: draw each from the bundle's end so that dashes coincide, and the shared head
     once.
   - *Fallback.* When no gutter path exists, A* over a coarse grid (`fallbackGrid`, 8 px, plus the ports' own
     coordinates) avoiding every card, chip, empty zone and header; counted in `report.routing.fallbacks` with
     a warning. If even that fails (only possible with gaps under 8 px), a plain orthogonal line, counted in
     `failed` with a warning. The demo organisations and every property test need neither.

**Interpretations** (where the skill's text left a choice; each is the reading the tests and renders support):
"a cost per lane already used in a segment" charges a lane once per gutter run end to end, not once per piece
a crossing splits off (that reading made long detours cheaper than any busy corridor), and counts holders (a
bundle's members share a lane), at 50 (lanes widen their gutter, so a busy corridor between two folders is
cheaper than a detour around one); the "three passes" are route, widen and re-pack, re-route, where the
re-route lays the routes onto the widened gutters, and a second widen-and-lay round runs only where lanes
still do not fit (so up to three routing passes, only the first a full search); "parallel arrows in the same
gap are spaced in lanes, never overlapping" holds for the drawn geometry, elbows and stubs included, and a
hub's edges of one kind are not parallel arrows but one trunk (a bundle); per-gap and per-side widening extend
the packer's uniform hook, so one busy gap does not widen every gap of its container; lane slots alternate
around the centre-line (a gutter with an even number of lanes is one pitch wider than lanes × 8 + 8); a route
stays within the containers it has to cross; `secures` edges are routed as lines like every other kind (the
style skill draws them as an overlay; the renderer decides); the first pass's search work decides single-pass
mode (420 000 settled states, with a one-round band above 340 000), because neither the number of edges nor
the number of lane holders says what routing costs.

## Constants (scale 1)

The defaults of `DEFAULT_SIZING` and the other constants; they match skill gcp-diagram-layout §3 and skill
gcp-diagram-style §3–§4, and `LayoutOptions.sizing` may override any of them.

| Thing | Value | Constant |
|---|---|---|
| Card | height 44; width 148–220 from metrics; icon 24; inner padding 10 | `cardHeight`, `cardMinWidth`, `cardMaxWidth`, `cardIcon`, `cardPadding` |
| Chip | height 44; width 148–220 from its label and count line after a 16 px glyph and an 8 px gap; sibling chips and empty zones share the widest width | `chipHeight`, `chipMinWidth`, `chipMaxWidth`, `chipGlyph`, `chipGlyphGap` |
| Empty zone | card-sized: height 44, width 148–220 from its label and subtitle | (card constants) |
| Zone header | 40 (depth ≤ 2), 32 (depth ≥ 3) | `headerHeight`, `deepHeaderHeight`, `shallowHeaderMaxDepth` |
| Zone padding | 24 at root projects, 16 otherwise | `rootProjectPadding`, `zonePadding` |
| Gap between siblings | 24 horizontal, 20 vertical, plus lane space (`gutters`) | `gapHorizontal`, `gapVertical` |
| Canvas margin | 24 | `canvasMargin` |
| Packing target | 1.6; 1.75 at the root; on target within 20 %; near ties within 2 %; stacks for 3–24 zones | `TARGET_ASPECT`, `ROOT_ASPECT`, `ASPECT_TOLERANCE`, `NEAR_TIE`, `STACK_LIMIT` (`src/pack.ts`) |
| Card title / subtitle | 13 px 700 / 10.5 px 400 (addresses in Roboto Mono) | `cardTitleSize`, `cardSubtitleSize`, `TEXT_WEIGHTS` |
| Zone title | 15 px (depth 1) / 13 px (deeper), 500; subtitle after `' · '` at 400; at most 660 px counts towards the zone's width | `zoneTitleSize`, `deepZoneTitleSize`, `largeTitleMaxDepth`, `ZONE_TITLE_SEPARATOR`, `zoneTitleMaxWidth` |
| Zone header icon | 24, 8 px before the title | `headerIcon`, `headerIconGap` |
| Badges | 10.5 px 400 pills, 6 px text padding, 4 px apart, 12 px after the title | `badgeTextSize`, `badgePaddingX`, `badgeSpacing`, `headerBadgeGap` |

Routing (`DEFAULT_ROUTING`, `LayoutOptions.routing`; skill §3 and §5, style §5):

| Thing | Value | Constant |
|---|---|---|
| Lane pitch; gutter base (n lanes need n × 8 + 8) | 8; 8 | `lanePitch`, `gutterBase` |
| Cost per bend; per lane already used in a gutter; length factor along a ring side inside its padding band, and the most it adds over one side; in the canvas margin | 40; 50; 1.5, 320; 2 | `bendCost`, `laneCost`, `hugFactor`, `hugCap`, `marginFactor` |
| Port spacing; clear of a card's corners; of a zone's lower corners | 12; 8; 12 | `portSpacing`, `portClearance`, `zonePortClearance` |
| Arrowhead tip inside the border; elbow radius | 2; 6 | `arrowInset`, `elbowRadius` |
| First-pass search work (A* states settled) at which the rest of the pass is searched weighted and final (single-pass mode); above which one widening round at most; widening rounds at most; two at most above this many lane holders | 420 000; 340 000; 3; 500 | `singlePassWork`, `oneRoundWork`, `wideningRounds`, `lateRoundsUpTo` |
| Edges of one kind at one rect's end bundled from | 3 | `bundleMin` |
| Fallback grid cell | 8 | `fallbackGrid` |

Worker (`src/steps.ts`, `src/memo.ts`, `src/hash.ts`): a routing pass stops every `ROUTE_STEP` (128) edges;
the memo keeps `MEMO_CAPACITY` (8) Layouts; a memo key walks at most `MAX_KEY_DEPTH` (528) levels and
`MAX_KEY_UNITS` (2^27) code units.

Internal tuning (`src/route.ts`): a bundle's member pays 0.9 of the length where its bundle runs
(`BUNDLE_LENGTH`), a re-searched edge 1.5 × outside its old corridor (`STRAY`), a route that does not fit is
searched again twice at most (`RETRIES`), a route's lanes are searched over 200 candidates at most
(`LANE_SEARCH`), single-pass mode weights the search estimate by 1.5 (`SINGLE_PASS_WEIGHT`). The arrowhead's
size (9 × 7, 7 × 5 by kind) is the renderer's: the layout only ends the path at the tip.

## Text metrics

`metrics/roboto.json` holds, for Roboto 400, 500 and 700 and Roboto Mono 400, the advance width of every code
point the self-hosted font files cover (897 for Roboto, 832 for Roboto Mono), in font units at 1 px
(`advance / unitsPerEm` px per px of font size), as runs of consecutive code points; plus ascent, descent and
line gap, and a fallback: the plain (kerning-free) average advance of printable ASCII. `measureText` sums the
advances of the text's code points without kerning, so a width is an upper bound of what a browser draws with
kerning; a code point the table does not list counts as zero (format and zero-width characters, such as the
zero-width joiner), as one em (East Asian wide and fullwidth characters and emoji, which Roboto does not
cover) or as the fallback. Code points are counted one by one: an emoji sequence drawn as one glyph (a ZWJ
sequence such as 👩‍💻, or 👍🏽 with a skin-tone modifier) counts one em per visible component (2 em for both
examples), a safe overestimate.

The generator, `scripts/generate-metrics.ts` (`pnpm --filter @gcportrait/layout metrics`), reads the WOFF
files of `@fontsource/roboto` and `@fontsource/roboto-mono` as installed in `frontend/` with `opentype.js`
(MIT, a dev dependency). The fontsource packages split each face into unicode-range subsets; a subset only
contributes the code points inside its own range, and where ranges overlap the subset a browser checks first
(the one declared last) wins. The table records the package versions it was read from. `test/metrics.test.ts`
regenerates it and fails when the committed table differs, and `scripts/generate-metrics.test.ts` runs
`metrics --check`, which fails when the committed file is not byte for byte what the generator writes; after
upgrading a font package run the generator and commit the result (`--check` only reports).

## Determinism

The same Scene and options always give a byte-identical Layout (`JSON.stringify`), whatever the order of the
Scene's children and edges:

- every child list is sorted by the total sibling order above (ids are unique);
- the packer visits its candidates in a fixed order and breaks every tie by a fixed rule (closer aspect,
  fewer rows, fewer card columns, then the candidate met first);
- no `Map` or `Set` is iterated to produce output in an order that depends on input order; `rects` and
  `arrangements.zones` are written in pre-order over the sorted tree into prototype-free records, so ids such
  as `__proto__` are ordinary keys (JavaScript would list an id that looks like an array index, such as `"7"`,
  first; Scene ids are resource names and never do); `edges` in (from, to, kind) code-point order;
- edges are merged and sorted before routing, routed in a fixed order (shortest first, then id), and every
  search breaks ties by a fixed rule, so the order of the Scene's edges does not matter;
- no randomness, no clock (timings only from a caller's clock, so `report.timings` is absent unless one is
  passed), no locale-dependent comparison, no DOM;
- text widths come only from the metrics table; floating-point sums are rounded up to whole px before they
  become sizes.

`checkDeterminism(scene)` lays a Scene out twice and once more with every child list and the edges reversed,
and compares the JSON (routing included).

## Invariants

`checkLayout(scene, layout, options?)` returns every violation (`assertLayout` throws them as a
`LayoutInvariantError`), computed from the Scene and the Layout alone:

1. no two solid rects (cards, chips, empty zones) overlap anywhere, and no two siblings overlap;
2. every child rect lies inside its parent's padding, below the header; top-level rects inside the canvas
   margin;
3. every Scene node has exactly one rect (the dropped organisation zone none), with the right parent, depth,
   role and kind, card and chip sizes within the constants, and the header height and padding of its depth;
4. the bounding box is finite and contains every rect, `chips` lists exactly the chip rects, and
   `arrangements` holds one arrangement for the canvas and each open zone, fitting its children;
5. (`checkDeterminism`) two runs and a reordered Scene give byte-identical JSON;
6. (`checkEdges`, part of `checkLayout`) one routed edge per distinct drawable (from, to, kind) of the Scene,
   with the summed count and the heads of its kind; at least two finite points and only horizontal and
   vertical segments; every port on its rect's border, on the side it names, never on an open zone's header
   (its top, or beside the header); each end at its port or at its head's tip, with the port on the end
   segment; no segment through the interior of a card, chip, empty zone or zone header (a head's tip only
   inside its own target); and a hub bundle's members share one port at the bundle's end, and the bundle
   counts them all.

The geometry is checked against `Layout.gutters` (the reservations it was packed with: the caller's plus the
router's), so `checkLayout` needs no knowledge of the routing. Full rows (packing rule 1) are checked by the
tests from the rects alone (`src/testing/rows.ts`), on the packing without routing (`route: false`): the
router pins the arrangement and widens gaps, after which a row may have room for its next child.

## Golden layouts

`test/golden.test.ts` builds the demo organisations through `@gcportrait/graph` with the real catalog (dev
dependencies, allowed for `packages/layout/test/**` and `packages/layout/scripts/**` only in
`eslint.config.js`) and compares each Layout, rects and routed edges, with its committed JSON in
`test/golden/`: S and M × overview, networking and load-balancing at detail `auto` (what the app opens at
1280×800; M opens at `folders`, mostly chips), and M × the same lenses at detail `all` (every zone open). Each
must also satisfy the invariants (edges included), route every edge through the gutters (no fallback), keep
its packing's arrangement, fill its rows (packing without routing), be deterministic, and keep its edges
apart (skill §8, "lanes spaced"; `src/testing/spacing.ts`, which reads only the points and ports): no lane
squeezed, no run without a clear lane, no two edges (a bundle's members count as one) alongside each other
closer than the lane pitch (8 px), no two stubs closer than half the port spacing (6 px), no two ports on a
side closer than the port spacing (12 px). At detail `auto` the routing may at most double the packed canvas's
area, and the canvas stays wider than tall. The L organisation is compared by summary
(`test/golden/L-*.summary.json`: counts, the routing report with its bends histogram, bundles, passes and
fallback count 0, the canvas and the packed canvas, growth, spacing) for networking at `auto` and `all` and
for overview and load-balancing at `auto`, with the same checks, because its layout JSON would be several
megabytes; L overview and load-balancing at `all` (single-pass: their first passes reach `singlePassWork`) by
the invariants; L overview at `projects` (skill §8's check view: 2 658 edges, 1 234 lane holders, 290 252
states of search work) must route in three passes with two rounds, with no stretch lacking a clear lane, at
most five squeezed lines (three today), no route in the canvas margin and none more than 1 000 px past both
of its ends; its work must stay 15 % below `oneRoundWork` and 40 % below `singlePassWork`,
and it must stay in three passes with a tenth of its edges dropped or a tenth more added (every tenth edge
again the other way round: 380 776 states, one round, in the band). M networking at `all`
checks the third widening round, which keeps its last lane inside its gutter. The figures (`--silent=false`
prints the table):

| Case | Overlaps | Closest lanes | Ports < 12 px | Squeezed lines | Bundles | Passes | Growth (routed / packed area) |
|---|---|---|---|---|---|---|---|
| S overview / networking / load-balancing | 0 | 8 px | 0 | 0 | 7 / 4 / 2 | 2 | 1.20 / 1.05 / 1.12 |
| M overview / networking / load-balancing | 0 | 8 px | 0 | 0 | 5 / 3 / 3 | 2 | 1.29 / 1.21 / 1.08 |
| M overview / networking / load-balancing, `all` | 0 | 8 px | 0 | 0 | 47 / 7 / 19 | 3 / 4 / 3 | 1.47 / 1.28 / 1.32 |
| L overview / networking / load-balancing | 0 | 8 px | 0 | 0 | 9 / 7 / 4 | 4 / 3 / 3 | 1.30 / 1.33 / 1.12 |
| L networking, `all` | 0 | 8 px | 0 | 0 | 30 | 2 | 1.41 |

How the routes read (`pnpm --filter @gcportrait/layout measure`, `src/testing/quality.ts`): M overview at
`auto` 22 325 px of edges with 223 bends, 7 661 px along a single border, 153 crossings, nothing in the canvas
margin and no route more than 270 px past both of its ends; M networking 21 869 / 187 / 6 840 / 122, one edge
with 96 px in the margin, at most 254 px past its ends; M load-balancing 12 432 / 114 / 5 074 / 34, one edge
with 56 px in the margin, the Cloud Armor `secures` line 1 048 px past its ends (see Known limits); L overview
at `projects` 1 392 568 / 13 417 / 638 637 / 8 075, nothing in the margin and no route more than 1 000 px past
both of its ends, the farthest 994 px (`test/golden.test.ts` checks both).

**Updating the goldens is a deliberate act.** A change to sizing, ordering, packing, the metrics table, the
catalog, the graph's Scene builder or the demo data changes them. Look at the change first (`pnpm --filter
@gcportrait/layout debug-svg --fixture M --lens overview --aspects`, before and after), then run
`pnpm --filter @gcportrait/layout test:golden:update`, review the JSON diff, and say why in the pull request.
When a graph or catalog change and a layout change land separately, whichever lands second regenerates them.

**Packing aspect and fill.** The golden test checks every container with at least four children against
the packing criterion (AGENTS.md, Layout and drawing rules):

- its children box must leave at most 60 % empty (fill ≥ 40 %; skill §9);
- it must be within 20 % of its target, unless an independent oracle (`src/testing/oracle.ts`, brute force
  over the arrangements skill §4 allows: every card column count × every split of the zones into rows) shows
  that no arrangement with full rows reaches 20 % (*unreachable*), or that every such arrangement takes more
  area than the chosen one framed to the target (*costlier*); the oracle also confirms that the packer's
  choice needs the smallest frame of all tidy arrangements, within the 2 % near-tie margin (the
  oracle enumerates plain rows only, and stacks only ever take less).

The packing figures are the packing's alone (`route: false`); routing pins the arrangement and only widens
gaps. The figures (`--silent=false` prints the table and every container outside 20 %, with the best fill any
arrangement within 20 % would have, full rows or not):

| Case | Rects | ≥ 4 children | Within 20 % | Unreachable | Costlier | Mean deviation | Worst | Lowest fill | Mean fill |
|---|---|---|---|---|---|---|---|---|---|
| S overview | 55 | 6 | 3 | 3 | 0 | 16.3 % | 33.9 % | 61.9 % | 70.2 % |
| S networking | 40 | 5 | 2 | 3 | 0 | 44.4 % | 143.1 % | 59.3 % | 71.5 % |
| S load-balancing | 46 | 4 | 2 | 2 | 0 | 32.3 % | 68.6 % | 48.5 % | 64.8 % |
| M overview | 38 | 3 | 0 | 3 | 0 | 115.9 % | 143.1 % | 72.8 % | 75.4 % |
| M networking | 42 | 4 | 1 | 3 | 0 | 94.9 % | 154.6 % | 72.8 % | 75.1 % |
| M load-balancing | 39 | 4 | 1 | 3 | 0 | 89.6 % | 143.1 % | 71.6 % | 74.5 % |
| M overview, all | 369 | 25 | 12 | 13 | 0 | 22.6 % | 101.4 % | 47.7 % | 63.3 % |
| M networking, all | 174 | 13 | 6 | 7 | 0 | 36.3 % | 68.6 % | 48.5 % | 65.6 % |
| M load-balancing, all | 290 | 23 | 11 | 12 | 0 | 29.6 % | 111.2 % | 53.9 % | 63.5 % |
| **All** |  | **87** | **38** | **49** | **0** |  |  |  |  |

Of the 49 unreachable containers, 37 have no arrangement within 20 % at all, full rows or not; the other 12
reach it only with a row left short (four chips as 2 + 1 + 1, for example). The containers outside 20 % are
small sets of wide boxes: a card or chip is 3.4 to 5 times as wide as it is tall, so four chips form a column
under 1 or a 2 × 2 grid of aspect 3 to 4 and nothing in between; chips take their width from their label and
count line (up to 220 px), so the M folders' 2 × 2 chip grids reach 3.8 to 4.1 (2.96 with 148 px chips). The
packer takes the 2 × 2 grid (wider than tall, skill §1). None is *costlier*.

The 40 % fill floor is a check on the demo organisations, not a guarantee. Over 1 500 random Scenes
(`arbitraryScene`, fast-check seed 987654; 21 921 containers with four or more children) the median fill is
64.8 %, the 1st percentile 44.5 % and the lowest 36.6 %; 6 containers fill less than 40 % (the zone title cap
holds an 80-character header to 660 px, which could otherwise widen a zone to about 1 300 px), each with one
child far wider than the rest, which sets the box's width whatever the arrangement. 67.9 % of those containers
are within 20 % of their target.

## Debug renders

`scripts/debug-svg.ts` (`pnpm --filter @gcportrait/layout debug-svg --fixture S|M|L --lens overview [--detail
all] [--theme light|dark|both] [--aspects] [--no-png] [--out DIR]`) writes
`out/layout/<fixture>-<lens>-<detail>-<theme>.svg` and a PNG. The PNG is rasterised with `@resvg/resvg-js`, a
dev dependency, from the Roboto and Roboto Mono files unwrapped from WOFF to TrueType by
`scripts/lib/woff.ts`; the Latin subsets are loaded first, because the rasteriser resolves a family to the
first file that carries its name. The render shows tinted zones with their header text and badges, chips,
empty zones, cards with their labels, and the routed edges in ink: stroke width, dash and arrowhead per
relation kind (skill gcp-diagram-style §5: 2 px with a filled 9 × 7 head for `routes`, `uses`, `triggers`;
dashed and double-headed `peers`; round-capped `connects` without heads; dotted `memberOf` with an open head;
…), elbows rounded with the edge's `elbowRadius` and kept off the straight stretch a head needs, a hub
bundle's members drawn from their shared end (their dashes coincide along the trunk) with the shared head
once: what the SVG renderer has to do too. Subtitles are set in the runs of `subtitleRuns`, the icon slot is a
dashed square (a 16 px one on a chip, its ⊞ glyph, followed by the count line the layout sized it with,
`chipCountLine`). With `--aspects` it adds each container's children box with its aspect, target, child count
and fill. It exists to look at the packing and the routing; it is not the SVG renderer or `pnpm render`: no
icons, no legend, no dim mode. Like every drawing it carries no affiliation line, and neither do its banner
and those of the other tools, which name the command only (AGENTS.md, Non-affiliation, brand and legal). Zone
strokes follow skill gcp-diagram-style §4 (1 px for folders, regions, product containers and groups; 1.5 px
for projects, VPC networks and subnets). A relative `--out` is taken from the directory the command was
started in (`INIT_CWD`, which pnpm sets), not from the package directory pnpm runs the script in.

## Known limits

- **Single-pass mode.** Where the first pass's search work reaches `singlePassWork` (L overview at `networks`
  and `all`, L load-balancing at `all`: exact first passes of 520 348 to 827 309 states) the rest of it is
  searched weighted and its route is final: no widening, so a gutter with more lanes than its base width holds
  squeezes them (`report.routing.squeezed`, 487 to 928 lines in those views; the report warns), and some runs
  find no clear lane (`overlaps`, 7 to 74). Ports stay 12 px apart and hubs are bundled. Three passes there
  would cost about 320–500 ms in-process, past the budget through the worker. L overview at `projects` routes
  in three passes but stops after two widening rounds (above `lateRoundsUpTo`): three lines stay squeezed. Its
  work is 17 % below the one-round band and 45 % below single-pass; a tenth more edges like its own put it
  into the band (one round, 18 squeezed lines), about a fifth more into single-pass mode. The thresholds are
  calibrated on the demo L views; a view of a very different shape (say, many short edges with long widening
  rounds) can need other values.
- **Detours.** A route cannot enter a zone from above (its header), and a bundle's port is on the side most of
  its members face, so a member coming from another side goes round its hub; a port line out of a chip in its
  zone's last row can take a route down and under the folder before it turns (M networking at `auto`: Retail
  web (prod) to the Shared VPC host runs about 550 px under Workloads). 19 of the 743 routes of S, M and L at
  `auto` are longer than twice the distance between their ports, the worst 5.6 times. L overview at `projects`
  has 94 such routes of 2 658, short routes inside projects round a card or two.
- **Long borders and far gaps.** Across a wide zone the only gutters in a route's scope are its ring top under
  its header and the gaps between its rows of children. With `hugCap` a route runs along a long ring side when
  that is the shortest way (L at `projects`: about 7 lanes along Workloads' ring top under its header, the
  farthest 994 px past its ends), and a quiet long ring side can draw routes away from a busy gap (L
  networking at `auto`: three lines between project chips come down the blank area under Platform and round
  the bottom-left corner of Workloads onto its ring bottom). Where the gaps themselves lie far away, a route
  runs past its ends to reach them: 189 routes of the 16 views `measure` was run on go more than 1 000 px past
  both of their ends, 165 of them in the two single-pass L views at `all` (102 and 63; they search their
  shortest edges exactly up to the single-pass budget, and those routes take longer ways where the weighted
  search took shorter, squeezed ones); 18 of the 19 in L networking at `all` already do (by 800–1 228 px) on a
  length-only route over the packed gutters, before the widening stretches them; one in M networking at `all`
  is a `shares` route the re-route searches again with its gutters full and sends 1 119 px past its source
  (132 px in the first pass).
- **The canvas margin.** A route needs it mostly to reach the side of an outermost rect that faces the canvas
  edge. It costs twice its length, so no route runs round the diagram through it; but rounding an outermost
  rect's corner through it can cost less than a busy gap, since the per-side cap on border hugging (`hugCap`)
  makes a quiet long ring side cheap. 13 routes of the 16 views `measure` covers use it (2 048 px together):
  the firewall endpoint's `uses` and the firewall policy's `secures` lines from the card row above the folders
  in the networking views (96–368 px), the Cloud Armor `secures` line in each load-balancing view (56 px), a
  `shares` bundle member in M networking at `all` (88 px), and the three lines in L networking at `auto` that
  round the corner of Workloads (224–312 px).
- **`secures` from a lone card in the root's card row.** The card block has no gutter beside its last column,
  so the card's right stub runs to the canvas ring and the route comes back along the gap below the card row:
  the Cloud Armor line runs 1 048 px past its ends in M load-balancing at `auto` and 14 039 px in L
  load-balancing at `all`. The renderer draws `secures` as overlays, so the line is not seen, but it holds
  lanes. A gutter beside a card block's last column would fix it; it moves every golden, so it waits.
- **Crossings.** A route leaves a chip straight along its port line and crosses the corridors it would
  otherwise run along: the M overviews at `auto` have 34–153 crossings. Lanes are assigned lowest-free in
  routing order, not in an order that avoids crossings at a corridor's ends.
- **Two trunks per Shared VPC host.** A host's `shares` and `attaches` edges are two bundles (one per kind),
  so the collapsed overviews draw two parallel trunks into it. Deliberately: the kinds are drawn differently
  (`shares` dashed 8 4, `attaches` solid; style §4), and a member's dashes are drawn from the bundle's end so
  that they coincide along its trunk; a trunk shared by two kinds would lay a solid and a dashed line on top
  of each other and lose the dashed one. One trunk per host would need the renderer to draw a mixed trunk (two
  lanes, or one style), a style-skill decision.
- **The chip count line is defined twice.** `chipCountLine` here sizes the chip; the frontend's renderer still
  has its own copy of the wording (`frontend/src/diagram/Drawing.tsx`), with the same output; it should import
  this one.
- **Empty space beside a tall sibling that comes later.** Stacks keep sibling order, so the blank area under a
  short folder beside a much taller one (M at `auto`: under Platform, beside Workloads) stays; filling it
  needs a later sibling stacked under an earlier one (an open item of
  [docs/backlog.md](../../docs/backlog.md)).
- **Busy fully open views.** L networking at `all` (684 rects, 346 edges) still carries 48 lanes in its
  busiest gutter, and its routing grows the packed canvas 1.33-fold.
- **Stubs from facing ports.** Ports on two rects facing each other across a gutter sit on slot grids half a
  port spacing apart, so their stubs can run 6 px apart where they overlap; lanes keep 8 px.
- **Cancellation waits for the current step.** A superseded layout stops at its next step, so a newer request
  waits for the step in progress: at most about 30 ms on the demo organisations (L overview at `all`; stages
  1–3 of the largest view take about 7 ms together, unbroken). `ROUTE_STEP` trades that against the cost of a
  yield and a progress message per step (in Node the worker adds about 0.5 ms to S overview, 6 steps,
  posting and the key included; a browser's `MessageChannel` yield has not been measured here).
- **One client per worker.** The worker supersedes by arrival, so two clients sharing one worker would cancel
  each other's requests.
- **Rare runs without a clear lane, crowded rects.** In random Scenes with dense edges (fast-check seed 42,
  290 layouts with edges) 5 have a run that no lane keeps clear of another edge (counted in
  `report.routing.overlaps`, with a warning), 1 a squeezed lane, and 4 a rect met by more edges of different
  kinds than its sides hold, whose ports then share a side more closely. The demo organisations have none of
  these outside single-pass mode.

## Performance

Budgets (skill §7): S < 10 ms, M < 60 ms, L < 400 ms, XL (about 51 000 assets, collapsed by
default) < 2 s in a worker. The harness is `scripts/lib/bench.ts`; it measures:

- **In-process** (`test/performance.test.ts`): the layout's own timings (`report.timings`: normalise, size,
  pack, route with its widening passes) on the test's thread.
- **Through a worker** (`test/worker.test.ts`, and the bench): a real `worker_threads` worker running the
  package's handler, timed from `client.layout()` to the resolved promise on the page's thread (posting the
  Scene, the memo key, the layout in steps with a yield before each, its progress messages, the Layout's way
  back). The measuring worker keeps no memo, so every run lays out.
- **Cases**: S, M and L × overview, networking and load-balancing at detail `auto` (what the app opens at
  1280×800) and `all` (every zone open; skill §7 exempts only XL, "collapsed defaults", from laying out
  everything); L overview at `projects` (skill §8's check view, in three passes); XL × the same lenses at
  `folders` (collapsed; `auto` picks `folders` for XL too). Medians of 10 runs after 3 warm-up runs. XL is
  built through `@gcportrait/demo-data` and `@gcportrait/graph` like the others (a few seconds, not timed).
- **Memo**: a repeated request answered from the memo, in-process (the protocol's own cost: the key and the
  lookup) and through the worker; byte-identical to the first answer.
- **Cancellation**: an L overview `all` layout superseded after its first routing step by an S request: the
  L request never resolves, the worker posts nothing more for it, and the S answer arrives long before the L
  layout would have finished.
- **Memory**: the worker's heap after a full garbage collection, before and after 100 XL layouts (each a memo
  miss, its first top-level label given another suffix of digits of one width, as scrubbing through timeline
  days whose Scenes differ produces, with the memo of 8 full both times): it must not grow by 16 MiB or more.

**The machine.** The budgets, and the typical figures below, describe a quiet M1-class machine: a laptop or
desktop whose cores are as fast as an M1's, one core per layout and no other load. On it L overview at `all`
takes about two thirds of its 400 ms through the worker. The budgets do not scale with the machine that
measures them, since a budget that moved with it would no longer say what the app promises. A shared
GitHub-hosted runner (2 to 4 vCPUs, other jobs on the same host) is slower single-threaded and varies from run
to run, so its strict figures are expected above the budgets by a margin. `bench` prints the machine it runs
on as its second line (Node, platform, CPU model, cores, load average), so a figure quoted anywhere carries
its machine.

**Two limits, as in `@gcportrait/ingest` and `@gcportrait/graph`.** A wall-clock budget means something only
on a machine that is not busy with other work. `pnpm test` (and the blocking CI `unit` job) runs the budget
tests in parallel with every other test file and asserts a regression ceiling of 2 × the budget (25 XL
layouts for the memory check); `pnpm --filter @gcportrait/layout test:budget`
(`GCPORTRAIT_LAYOUT_BUDGET=strict`) runs the two budget files alone, one after the other, and asserts the
budgets themselves (100 XL layouts). Both measure by the rule of `@gcportrait/model/testing` that
`@gcportrait/ingest`, `@gcportrait/graph` and `@gcportrait/demo-data` time their work by too. A case over its
limit is measured again after a 250 ms pause, at most 5 batches (`BATCHES`) and only while another batch fits
in 95 % of the test's timeout (`measureBatches`: under heavy load five L batches outlast it, and a timed-out
test shows no figure), and its best batch's median counts; every batch's median is printed. In-process and
through the worker alike, a batch that would run past that 95 % (slower than the one before it, the machine
having got busier, or a first batch that slow) stops there (`measureRuns`) and counts as a miss, so that the
case still reports its figures and is skipped or fails as below instead of timing out. Under a local
`pnpm test` a case still over its ceiling after the last batch is skipped, with its figures and the load as
the reason (and a `skipped:` line on standard error names the case, since the reporter does not;
`skipIfOverloaded`), while the machine's one-minute load average is above 1.5 per core (`OVERLOAD_PER_CORE`,
`overloadReason`): four times oversubscribed, a small layout reads several times its quiet figure at its best
of five batches, so the ceiling would measure the machine. On CI (`CI` set, `onCi`)
the ceiling is the budget check that blocks, so it never skips, and neither does `test:budget`. The worker
test builds every demo Scene before it measures anything, so its small cases do not start while the other test
files are at their busiest (a small layout's round trip reads up to four times its quiet figure then). The
memo-hit limit (1 ms for S, M and L at `auto`) and the memory limit are the same in both. Under coverage
instrumentation (`LAYOUT_COVERAGE`) each case is laid out once and the time limits are not checked
(`budgetPlan`). `pnpm --filter @gcportrait/layout bench` prints the whole table (`--fixtures`, `--runs`,
`--warm-up`, `--memory`; exit 1 when a budget is missed or the heap grew).

**In CI** the strict run is the `layout-budget` job of `.github/workflows/pr.yml`, **non-blocking**
(`continue-on-error`): it prints the runner's CPU and the bench table into the job summary, with a note that
the budgets describe a quiet M1-class machine and that the runner's figures are expected above them, and
raises a warning when a budget is missed. A blocking strict job on that runner would fail for reasons outside
the change and be re-run until green; the 2 × ceiling in the blocking `unit` job catches real regressions on
any runner. Run `test:budget` locally for every layout change and quote its figures in the pull request, with
the machine `bench` names. Removing `continue-on-error` and adding the job to `required` makes it blocking,
e.g. on a larger or self-hosted runner.

Typical figures of `test:budget` (strict) on a quiet M1-class machine (`bench` prints the same table for the
machine it runs on):

| Case | Rects | Edges | Mode (passes) | In-process | Worker round trip | In the worker | Budget |
|---|---|---|---|---|---|---|---|
| S overview `auto` / `all` | 55 | 45 | three-pass (2) | 4.7 / 4.3 ms | 6.4 / 5.4 ms | 5.6 / 4.8 ms | 10 ms |
| S networking `auto` / `all` | 40 | 17 | three-pass (2) | 2.2 / 1.7 ms | 3.0 / 2.6 ms | 2.5 / 2.3 ms | 10 ms |
| S load-balancing `auto` / `all` | 46 | 30 | three-pass (2) | 2.5 / 2.4 ms | 3.4 / 3.5 ms | 3.0 / 2.9 ms | 10 ms |
| M overview `auto` / `all` | 38 / 369 | 42 / 341 | three-pass (2 / 3) | 4.9 / 32.2 ms | 4.6 / 37.6 ms | 3.9 / 34.1 ms | 60 ms |
| M networking `auto` / `all` | 42 / 174 | 36 / 81 | three-pass (2 / 4) | 2.4 / 13.9 ms | 3.5 / 16.3 ms | 3.1 / 15.0 ms | 60 ms |
| M load-balancing `auto` / `all` | 39 / 290 | 21 / 212 | three-pass (2 / 3) | 1.6 / 22.3 ms | 2.6 / 25.2 ms | 2.2 / 22.7 ms | 60 ms |
| L overview `auto` / `all` | 164 / 2 497 | 245 / 2 971 | three-pass (4) / single-pass | 39.2 / 204.9 ms | 42.0 / 254.4 ms | 39.5 / 221.8 ms | 400 ms |
| L overview `projects` | 2 047 | 2 658 | three-pass (3) | 242.8 ms | 305.5 ms | 277.7 ms | 400 ms |
| L networking `auto` / `all` | 168 / 684 | 172 / 346 | three-pass (3 / 2) | 23.4 / 44.9 ms | 26.4 / 50.9 ms | 24.5 / 46.2 ms | 400 ms |
| L load-balancing `auto` / `all` | 165 / 2 207 | 135 / 2 168 | three-pass (3) / single-pass | 15.0 / 142.6 ms | 16.7 / 179.7 ms | 15.1 / 154.1 ms | 400 ms |
| XL overview `folders` | 494 | 678 | three-pass (3) |  | 105.0 ms | 98.0 ms | 2 s |
| XL networking `folders` | 498 | 473 | three-pass (3) |  | 71.8 ms | 66.4 ms | 2 s |
| XL load-balancing `folders` | 495 | 366 | three-pass (2) |  | 42.5 ms | 37.8 ms | 2 s |

A memo hit takes 0.11 ms (S), 0.09 ms (M), 0.22 ms (L) and 0.62 ms (XL) in-process, and 0.55 ms round trip
through the worker for M; a superseded L overview `all` layout (about 240 ms uncancelled) stops after 4 steps
and the S request behind it is answered in about 6 ms; the worker heap grows by about 0.3 MiB over 100 XL
layouts (21.2 to 21.5 MiB). The worker adds about 0.5 ms to a small layout (posting, the key, the yields
between steps and the progress messages) and about 10 %–30 % to the largest (mostly the structured clone of a
2 000-rect Layout back to the page). L overview at `projects` is the closest to its budget: its three passes
take about 120, 75 and 50 ms, with about 20 ms for each widening re-pack between them (the first searches
every edge; the other two lay the routes onto the widened gutters and search again only those whose gutters no
longer line up), so it stops after two widening rounds (`lateRoundsUpTo`). The single-pass views search their
shortest edges exactly until the first pass has settled `singlePassWork` states, then the rest weighted: L
overview at `all` takes about 205 ms in-process and L load-balancing at `all` about 143 ms, both well inside
the budget through the worker.

Stages 1–3 take at most 7 ms (L at `all`); the rest is routing, mostly the A* searches of the first pass:
the re-route lays the routes onto the widened gutters and searches only the few whose gutters no longer line
up (11 of 341 in M overview at `all`). Choosing a container's arrangement looks at n card column counts × at
most 2m + n zone splits, for n cards and m zones; building the splits costs O(m²) budgets × O(m) each, and
above `RUN_BUDGET_LIMIT` (120) zones, where the Scene builder bundles siblings anyway, only the runs starting
at the first zone give budgets. A container of 2000 cards and 2000 empty zones takes about 90 ms to pack and
fills 60 % of its box. Beyond the budgets, XL at `projects` (7 838 rects, 10 652 edges, single-pass) lays out
in about 0.8 s in-process.

**In the app.** On a production demo build in Chromium at 1280 × 800 (the method and the app-level targets:
skill §7): the layout of a timeline step on L at `auto` takes about 45–55 ms of the step from key press to
diagram, and a memo hit makes it vanish: across 100 switches on demo M the memo answered 52 of 100 layouts
(100 % when alternating two days; a day with changes cannot hit, since its Scene carries its ghosts and
markers), and stepping back and forth on L answers the kept days from it. The app's mount of the worker
(`frontend/src/diagram/pipeline/`) posts a Layout of more than 1 000 rects as transferred JSON bytes instead
of a structured clone (L at `all`, 3.5 MB; XL at `projects`, 11.4 MB: 41.9 ms to read on the UI thread as a
clone, 28.3 ms decoded), and the layout client receives the decoded message.

## Tests

```sh
pnpm --filter @gcportrait/layout test                    # unit, property, golden, metrics, worker; budgets at 2 ×
pnpm --filter @gcportrait/layout test -- --coverage      # with V8 coverage (thresholds 98/95/100/98)
pnpm --filter @gcportrait/layout test:budget             # the strict budgets alone, printing their figures
pnpm --filter @gcportrait/layout bench                   # the harness: medians, memo, cancellation, memory
pnpm --filter @gcportrait/layout test:golden:update      # rewrite test/golden/ (see "Golden layouts")
pnpm --filter @gcportrait/layout metrics                 # regenerate metrics/roboto.json
pnpm --filter @gcportrait/layout measure                 # route quality per view (--packing: packing rules)
pnpm --filter @gcportrait/layout explore                 # the random properties 1 000 times each (FC_SEED)
```

`lint`, `typecheck`, `test`, `test:budget`, `test:golden:update`, `debug-svg`, `bench` and `measure` compile
the catalog first (`pre…` hooks, as in `packages/graph`), because the demo Scenes come from the compiled
catalog and a stale one would silently change them.

- `src/*.test.ts`: each stage's rules and errors (the depth limit up to 20 000 levels, the packer against the
  brute-force oracle `src/testing/oracle.ts` over random sizes, each packing rule on a worked example, pinned
  arrangements, per-gap and per-side widening), the options, the invariant checks (each violation planted,
  edges included), the metrics table and `measureText`, `subtitleRuns`, the code-point order, and large mixed
  containers (15 + 8, 40 + 10, 2000 + 2000 cards and zones) within 20 % at more than 50 % fill; chips from
  their label and count line (`src/chips.test.ts`), sibling chips and empty zones sharing a width, the zone
  title cap, the depth convention with and without an organisation zone, stacks (taken only inside the plain
  box, never alone or beside stacks only, placed and widened), near ties, sorted warnings. Routing: merging
  (duplicates, reciprocal peers, chip re-targeting, dropped edges), the gutter lines (rings, gaps, strips, gap
  references, extensions, merging), the routing graph (intersections, attach points, pressure per gutter,
  owners, strips and piece keys per segment), the occupancy index (clearances, stubs, holders, long segments,
  removal), ports (sides, slots, the shifted grid, bundles by size and by crowding, the majority side,
  spilling to the neighbouring and the opposite sides, zone bands, below the header with no padding and no
  corner clearance, inward ports, keeping the previous pass's plan), port lines (`src/portlines.test.ts`: out
  through every zone a chip is the last of, one piece per container, none where a neighbour stands beside,
  none of no length, a straight exit, with no padding and no gaps a route that keeps out of its zone's
  header, and on a line of no length `runEnds`: a run along its own port line a port run though it covers no
  segment, a run across a port's gutter line starting or ending at the port's coordinate along its own line),
  stack gaps and hugging stretches in the gutters and the network (with each hugging segment's side
  length), the length factors (`hugFactors`: a ring side capped per side, the margin), the router (straight
  edges, heads and tips, zone ends, lanes 8 px apart, widening, hub bundles sharing one trunk and head, one
  bundle per kind, the re-route laying routes onto widened gutters, scope (order independence: the property
  test), no U-turn through the margin beside a tall folder nor down to a far row gap below a row of tall
  sub-folders, single-pass mode by the first pass's search work and the one-round band on a synthetic
  2 000-edge Scene (the work counted the same on every run and in any edge order, the weighted rest after the
  budget, the budget reached but not passed) and its warning), the bundle invariant, the fallback (around
  obstacles, giving up, in a layout), the heap and the geometry helpers, and the route-quality helper
  (`src/testing/quality.test.ts`: length, bends, hugging, crossings, detours, the canvas margin and
  overshoots). `src/constants.test.ts` pins the tuning constants the layout skill and this README state as
  numbers (near ties, the routing work budgets, the memo's size, the title cap).
- `src/layout.property.test.ts`: fast-check over random Scene trees (depth up to 8, up to 300 nodes, random
  kinds, chips, empty zones, badges, odd labels and ids such as `__proto__`, up to 200 random edges of every
  head style between any two nodes, a zone and its own descendant included, sometimes inside an organisation
  zone) and random sizing, gutters, aspect targets, tolerances and routing constants (bundle threshold
  included): the invariants hold (edges included, never needing the fallback), wherever the report shows no
  squeezed lane and no run without a clear lane no two edges run alongside each other closer than the lane
  pitch (nor two stubs closer than half the port spacing), every row of the packing is full, the layout is
  deterministic and independent of the order of children and edges, pinned arrangements survive widened
  gutters, single-pass mode and the fallback router keep the invariants, and the generated Scenes pass
  `SceneSchema`. The routing constants' sizing draws 0 for half of its gaps and paddings, the corner where a
  zone's ring, its border and the gap beside it coincide.
  `src/gutters.test.ts` checks over random Scenes that every gutter line runs through free space.
  Seeds (`test/fast-check-seed.ts`, by the rule of `@gcportrait/model/testing`): each run draws a fresh one,
  but on CI (`CI` set) every property runs under the fixed `CI_PROPERTY_SEED`, so the blocking `unit (layout)`
  leg draws the same inputs on every push, and `FC_SEED=<n>` replays the seed fast-check prints with a
  failure. `explore` runs every property of these two files 1 000 times (`FC_RUNS`); CI's non-blocking
  `layout-budget` job runs it under a seed from the run id and names the seed, and a failure's path and
  counterexample, in its summary.
- The worker: `src/steps.test.ts` (drained steps equal `layoutScene` over random Scenes; the
  steps after each stage, every `ROUTE_STEP` edges and each pass; errors from the first step; two layouts
  interleaved, one dropped mid-way), `src/hash.test.ts` (pinned keys; independent of key order in every object
  of a Scene and over random JSON with shuffled keys; no collision among 3 000 distinct random values; lengths
  and tags keep `["ab","c"]`, `["a","bc"]`, `1` and `"1"` apart; no key for functions, cycles, too deep or
  too large values), `src/memo.test.ts` (LRU order, capacity 0), `src/host.test.ts` (each yield resumes only
  after the host's queued task), `src/worker.test.ts` (on a host the test drives step by step: one terminal
  answer per request; a superseded or cancelled request never gets a result nor progress after `cancelled`; a
  burst lays out only the last; the same key takes the running layout over, also after a cancel; memo hits
  answered at once with the same object; eviction of the ninth; errors with codes and ids; malformed
  messages; a host that cannot post), `src/client.test.ts` (promises against the real handler: superseded,
  aborted, cancelled and disposed requests reject with `LayoutCancelledError` and never resolve, even when a
  result arrives later; memo hits; worker errors; `layoutClient` on a Web Worker-like object).
- `test/golden.test.ts` (with the oracle in `src/testing/oracle.ts`), `test/metrics.test.ts`,
  `test/performance.test.ts`, `test/worker.test.ts` (budgets, memo, cancellation and memory through a real
  worker): see above.
- `scripts/*.test.ts`: the metrics command (`--check`) and its font helpers (`scripts/lib/fonts.test.ts`:
  unicode ranges, WOFF unwrapping), the debug renderer (both themes, no affiliation line in the drawing, SVG
  and PNG output), the bench (its banner, which names the command only, a short S run, its usage and argument
  errors) and the measure command (routing and packing figures, JSON, its usage and argument errors). The
  rule by which an overloaded machine skips a missed ceiling is tested where it lives, in `@gcportrait/model`
  (`src/testing/budget.test.ts`).
