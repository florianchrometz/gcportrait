// SPDX-License-Identifier: MIT
import * as z from 'zod';
import { RelationKindSchema } from './relation.js';
import { ZoneKindSchema } from './scene.js';

function stringRecord<Value extends z.ZodType>(valueSchema: Value) {
  return z
    .transform((input, context): Record<string, z.output<Value>> => {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        context.addIssue({ code: 'custom', message: 'Expected a plain string-keyed record' });
        return z.NEVER;
      }
      const prototype: unknown = Object.getPrototypeOf(input);
      if (prototype !== null && prototype !== Object.prototype) {
        context.addIssue({ code: 'custom', message: 'Expected a plain string-keyed record' });
        return z.NEVER;
      }
      const entries: [string, z.output<Value>][] = [];
      let invalid = false;
      for (const key of Reflect.ownKeys(input)) {
        if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
        if (typeof key !== 'string') {
          context.addIssue({ code: 'custom', message: 'Expected a string record key' });
          invalid = true;
          continue;
        }
        const result = valueSchema.safeParse((input as Record<string, unknown>)[key]);
        if (result.success) entries.push([key, result.data]);
        else {
          invalid = true;
          for (const issue of result.error.issues) {
            context.addIssue({ ...issue, path: [key, ...issue.path] });
          }
        }
      }
      return invalid ? z.NEVER : Object.fromEntries(entries);
    })
    .readonly();
}

export const PointSchema = z.strictObject({ x: z.number(), y: z.number() }).readonly();
export type Point = z.infer<typeof PointSchema>;

export const RectSchema = PointSchema.unwrap().extend({ width: z.number(), height: z.number() }).readonly();
export type Rect = z.infer<typeof RectSchema>;

/** A length per side of a rect. */
export const InsetsSchema = z
  .strictObject({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() })
  .readonly();
export type Insets = z.infer<typeof InsetsSchema>;

/**
 * How a Scene node is drawn:
 * - `zone`: an open zone with a header band and children inside its padding;
 * - `chip`: a collapsed zone, a fixed-size chip in the zone's tint;
 * - `empty`: a zone with no children in the Scene, drawn card-sized with its icon (skill §2 rule 4);
 * - `card`: a resource card.
 * Chips, empty zones and cards are solid: nothing is drawn inside them and no edge crosses them.
 */
export const RectRoleSchema = z.enum(['zone', 'chip', 'empty', 'card']);
export type RectRole = z.infer<typeof RectRoleSchema>;

export const LayoutRectSchema = RectSchema.unwrap()
  .extend({
    /** The parent zone's id; `null` for the top level (the canvas). */
    parent: z.string().nullable(),
    role: RectRoleSchema,
    /** The zone kind (zones, chips and empty zones) or `card`. */
    kind: z.union([ZoneKindSchema, z.literal('card')]),
    /** Depth from the canvas: the canvas is 0, so top-level zones and cards are 1. */
    depth: z.number(),
    /** Height of the header band at the top of an open zone; 0 for chips, empty zones and cards. */
    headerHeight: z.number(),
    /** The open zone's inner padding ring (including any uniform `ring` reservation); 0 otherwise. */
    padding: z.number(),
    /**
     * Extra padding on single sides of an open zone (the router's lane space, `GutterWidening.ringSides`), on top
     * of `padding`; absent when there is none. The children lie inside `padding` + `paddingExtra` on each side;
     * the header is unaffected (a folder's title still starts `padding` from the left).
     */
    paddingExtra: InsetsSchema.exactOptional(),
    chipCountLine: z.string().exactOptional(),
    /** True for a chip (a collapsed zone). */
    collapsed: z.boolean(),
  })
  .readonly();
export type LayoutRect = z.infer<typeof LayoutRectSchema>;

/** A side of a rect. */
export const SideSchema = z.enum(['top', 'right', 'bottom', 'left']);
export type Side = z.infer<typeof SideSchema>;

/** Where an edge meets one of its rects: a point on that rect's border and the side it lies on. */
export const EdgePortSchema = PointSchema.unwrap().extend({ side: SideSchema }).readonly();
export type EdgePort = z.infer<typeof EdgePortSchema>;

/**
 * Which ends of an edge carry an arrowhead, from the relation kind's default style (`RELATION_KINDS` in
 * `@gcportrait/model`): `both` for a double-headed (symmetric) kind such as `peers`, `none` for a kind drawn
 * with round caps (`connects`), `end` otherwise.
 */
export const EdgeHeadsSchema = z.enum(['end', 'both', 'none']);
export type EdgeHeads = z.infer<typeof EdgeHeadsSchema>;

/**
 * A hub's bundle (skill gcp-diagram-layout §5, ports): the edges of one kind that meet one rect at the same end
 * (all as targets, or all as sources) and from the same side, sharing that end's port and their lanes towards it.
 */
export const EdgeBundleSchema = z
  .strictObject({
    /**
     * Unique per bundle: `<rect id> <-<kind>- * (<side>)` for a shared target, `<rect id> -<kind>-> * (<side>)` for
     * a shared source (`<side>, inside` for a port on the inside of a zone that contains the other ends; a `#2`, …
     * suffix in the rare case of two bundles of one kind on one side).
     */
    id: z.string(),
    /** The end the members share. */
    end: z.enum(['source', 'target']),
    /** How many edges the bundle holds. */
    size: z.number(),
  })
  .readonly();
export type EdgeBundle = z.infer<typeof EdgeBundleSchema>;

/**
 * A routed edge (stage 5): an orthogonal polyline through the gutters. `points` run from the source end to
 * the target end; an end with an arrowhead stops at the head's tip, `Routing.arrowInset` (2 px) inside the
 * rect's border, an end without one at its port. Every segment is horizontal or vertical; the renderer rounds
 * each elbow with `elbowRadius`, at most half the shorter of its two segments and, next to an arrowhead, at
 * most what the end segment leaves beside the head (the end segment can be as short as the gutter allows,
 * e.g. 10 px in a 16 px padding ring, shorter than a 9 px head plus the radius): the head sits on a straight
 * stretch.
 */
export const EdgePathSchema = z
  .strictObject({
    from: z.string(),
    to: z.string(),
    kind: RelationKindSchema,
    /** How many Scene relations the edge stands for (merged duplicates, re-targeted ends); at least 1. */
    count: z.number(),
    /** Whether the Scene marked an end re-targeted to a chip or the layout merged several Scene edges into it. */
    merged: z.boolean(),
    heads: EdgeHeadsSchema,
    /** The port on the border of `from`'s rect. */
    source: EdgePortSchema,
    /** The port on the border of `to`'s rect. */
    target: EdgePortSchema,
    points: z.array(PointSchema).readonly(),
    /** Radius of the rounded elbows; 0 when the path is straight. */
    elbowRadius: z.number(),
    /** True when no gutter path existed and the coarse-grid fallback routed the edge (should never happen). */
    fallback: z.boolean(),
    /**
     * The hub bundle the edge belongs to; absent for an edge of its own. Its members share the port at the
     * bundle's end (`end`), and lanes towards it: where their points coincide they are one trunk, so the renderer
     * draws a member's dashes from that shared end (the dash patterns then coincide along the trunk) and its
     * shared arrowhead once.
     */
    bundle: EdgeBundleSchema.exactOptional(),
  })
  .readonly();
export type EdgePath = z.infer<typeof EdgePathSchema>;

export const StageTimingsSchema = z
  .strictObject({
    normalise: z.number(),
    /** Stage 2 of the first pass. */
    size: z.number(),
    /** Stage 3 of the first pass. */
    pack: z.number(),
    /** Stages 4–5: gutter networks, routing, and the widening re-pack between the passes. */
    route: z.number(),
    total: z.number(),
  })
  .readonly();
export type StageTimings = z.infer<typeof StageTimingsSchema>;

export const LayoutCountsSchema = z
  .strictObject({
    /** Every rect: zones, chips, empty zones and cards. */
    rects: z.number(),
    zones: z.number(),
    chips: z.number(),
    emptyZones: z.number(),
    cards: z.number(),
    /** Edges in the Scene (before merging; `report.routing` says what became of them). */
    edges: z.number(),
    /** The deepest rect's depth (0 for an empty canvas). */
    maxDepth: z.number(),
    /** Organisation zones unwrapped because the canvas is the organisation (normally 0: the Scene omits it). */
    organisationZonesDropped: z.number(),
    /**
     * Cards, empty zones and chips whose text is wider than their widest box (the renderer ellipsises it).
     */
    truncatedLabels: z.number(),
    /**
     * Open zones whose title is wider than `Sizing.zoneTitleMaxWidth`: the zone is no wider for it and the
     * renderer ellipsises the title (the full label stays in the Scene).
     */
    cappedTitles: z.number(),
    /** Open zones made wider than their children by their header (title, id and badges). */
    headerWidened: z.number(),
  })
  .readonly();
export type LayoutCounts = z.infer<typeof LayoutCountsSchema>;

/**
 * What stages 4–5 did. `mode` is the policy: `three-pass` (route; widen the gutters whose lanes do not fit and
 * re-pack; re-route, keeping lanes inside the widened gutters: the second and third passes run only when some
 * gutter is too narrow, see `passes`), `single-pass` (the first pass's search work reached
 * `Routing.singlePassWork`: the rest of it was searched weighted, one routing pass, no widening), or `none`
 * (nothing to route, or `LayoutOptions.route` is false).
 */
export const RoutingReportSchema = z
  .strictObject({
    mode: z.enum(['none', 'single-pass', 'three-pass']),
    /** Routing passes run: 1, or 2 when a widening round re-packed and re-routed (more only with `wideningRounds`). */
    passes: z.number(),
    /** Routed edges: `Layout.edges`. */
    edges: z.number(),
    /**
     * Lane holders: the edges routed on their own plus the hub bundles (whose members share lanes). Above
     * `Routing.lateRoundsUpTo` of them at most two widening rounds run.
     */
    holders: z.number(),
    /**
     * The first routing pass's search work: the A* states it settled. Single-pass mode starts where it reaches
     * `Routing.singlePassWork`; above `Routing.oneRoundWork` one widening round runs at most (skill §5).
     */
    work: z.number(),
    /**
     * Scene edges folded into another one with the same ends and kind (their count is added to it), the second
     * edge of a reciprocal pair included.
     */
    duplicatesMerged: z.number(),
    /** Reciprocal pairs of a symmetric kind (`peers`) merged into one double-headed edge. */
    reciprocalMerged: z.number(),
    /** Hub bundles (edges sharing a port and lanes, `EdgePath.bundle`) and the edges in them. */
    bundles: z.number(),
    bundledEdges: z.number(),
    /** Scene edges not drawn: an end at a dropped organisation zone (the canvas), or both ends in one chip. */
    dropped: z.number(),
    /** Edges the coarse-grid fallback routed because no gutter path existed (0 unless something is wrong). */
    fallbacks: z.number(),
    /** Edges not even the fallback could route (drawn as a plain orthogonal line; 0 unless something is wrong). */
    failed: z.number(),
    /** Edges by number of bends: `bends[k]` edges have k elbows. */
    bends: z.array(z.number()).readonly(),
    /** The most lanes any gutter line carries (the highest lane used + 1). */
    maxLanes: z.number(),
    /** Containers (the canvas or open zones) whose gutters the widening passes made wider. */
    widened: z.number(),
    /**
     * Widen-and-re-route rounds run after the first route (0: nothing needed widening, or single-pass mode):
     * the three passes (route, widen and re-pack, re-route) are one round (`Routing.wideningRounds`, default 1,
     * at most).
     */
    wideningRounds: z.number(),
    /** Gutter lines whose lanes did not fit their width in the final pass and were squeezed closer. */
    squeezed: z.number(),
    /**
     * Edges with a stretch that runs alongside another edge (closer than the lane pitch) because no lane was clear
     * there; 0 unless something is wrong. Members of one bundle share lanes and do not count.
     */
    overlaps: z.number(),
  })
  .readonly();
export type RoutingReport = z.infer<typeof RoutingReportSchema>;

export const LayoutReportSchema = z
  .strictObject({
    /** Milliseconds per stage, present only when `LayoutOptions.clock` is given (the layout reads no clock). */
    timings: StageTimingsSchema.exactOptional(),
    counts: LayoutCountsSchema,
    routing: RoutingReportSchema,
    /**
     * Human-readable notes about the input, sorted in code-point order (so reordering the Scene's children or
     * edges gives a byte-identical report).
     */
    warnings: z.array(z.string()).readonly(),
  })
  .readonly();
export type LayoutReport = z.infer<typeof LayoutReportSchema>;

/**
 * How a container's children are packed (stage 3): the card grid on top and the zone rows below it. A Layout
 * reports every container's arrangement, and `LayoutOptions.arrangements` can pin one (gutter routing's
 * re-pack).
 */
export const ArrangementSchema = z
  .strictObject({
    /** Columns of the card grid; 0 when the container holds no cards. */
    cardColumns: z.number(),
    /** How many zones (open zones, chips, empty zones) each zone row holds, top to bottom; [] without zones. */
    zoneRows: z.array(z.number()).readonly(),
    /**
     * The stacks of each zone row (skill §4): `zoneStacks[r]` lists, left to right, how many consecutive zones
     * each cell of row r sets one above the other (summing to `zoneRows[r]`). Absent when every cell holds one
     * zone (plain rows).
     */
    zoneStacks: z.array(z.array(z.number()).readonly()).readonly().exactOptional(),
  })
  .readonly();
export type Arrangement = z.infer<typeof ArrangementSchema>;

/** One arrangement per container: the canvas, and every open zone by id (in paint order). */
export const ArrangementsSchema = z
  .strictObject({ canvas: ArrangementSchema, zones: stringRecord(ArrangementSchema) })
  .readonly();
export type Arrangements = z.infer<typeof ArrangementsSchema>;

/** Extra width of single gaps of one container. */
export const GapWideningSchema = z
  .strictObject({
    /** `cardColumns[c]`: the gap between card columns c and c + 1. */
    cardColumns: z.array(z.number()).readonly().exactOptional(),
    /**
     * `zoneColumns[r][i]`: the gap between cells i and i + 1 of zone row r (a cell is one zone, or a stack of
     * zones: `Arrangement.zoneStacks`).
     */
    zoneColumns: z.array(z.array(z.number()).readonly()).readonly().exactOptional(),
    /** `stacks[r][c][k]`: the gap below zone k of the stack in cell c of zone row r. */
    stacks: z
      .array(z.array(z.array(z.number()).readonly()).readonly())
      .readonly()
      .exactOptional(),
    /**
     * `rows[k]`: the gap below row k, counting the card rows first and then the zone rows (so with R card rows,
     * `rows[R − 1]` is the gap between the card block and the zone block).
     */
    rows: z.array(z.number()).readonly().exactOptional(),
  })
  .readonly();
export type GapWidening = z.infer<typeof GapWideningSchema>;

/** Extra space the router reserves for edge lanes in one container, added to the base sizes. */
export const GutterWideningSchema = z
  .strictObject({
    /** Added to every column gap of the container's children. */
    horizontal: z.number().exactOptional(),
    /** Added to every row gap of the container's children (and to the gap between cards and zones). */
    vertical: z.number().exactOptional(),
    /** Added to the container's padding ring on all four sides (for the canvas: to its margin). */
    ring: z.number().exactOptional(),
    /** Added to single sides of the padding ring (for the canvas: of its margin), on top of `ring`. */
    ringSides: InsetsSchema.unwrap().exactPartial().readonly().exactOptional(),
    /**
     * Added to single gaps, on top of `horizontal` and `vertical` (the router widens only the gaps whose lanes do
     * not fit). Positional, so meant with a pinned arrangement; extras beyond the arrangement's gaps are
     * ignored, and the packer's choice of arrangement does not look at them.
     */
    gaps: GapWideningSchema.exactOptional(),
  })
  .readonly();
export type GutterWidening = z.infer<typeof GutterWideningSchema>;

/**
 * The hook through which gutter routing widens gutters and re-packs without re-implementing packing:
 * per container, extra lane space on top of the base gaps and padding: uniform (every column gap, every row
 * gap, the whole ring) or per gap (`gaps`). Wider gaps change the candidates' sizes, so a re-pack may
 * choose another arrangement; pass the first pass's `Layout.arrangements` as `LayoutOptions.arrangements` to
 * keep every row and column (and so every gutter's identity) across passes.
 */
export const GutterReservationsSchema = z
  .strictObject({
    canvas: GutterWideningSchema.exactOptional(),
    zones: stringRecord(GutterWideningSchema).exactOptional(),
  })
  .readonly();
export type GutterReservations = z.infer<typeof GutterReservationsSchema>;

export const LayoutSchema = z
  .strictObject({
    /**
     * One rect per Scene node, keyed by node id, in paint order: pre-order over the sorted tree, so a parent
     * always comes before its children.
     */
    rects: stringRecord(LayoutRectSchema),
    /**
     * Routed edges keyed by edge id (`<from> -<kind>-> <to>`), sorted by from, to and kind in code-point order.
     * One per distinct (from, to, kind) after merging; a symmetric kind's ends are ordered (`from` < `to`).
     */
    edges: stringRecord(EdgePathSchema),
    /** Ids of the zones drawn as chips (their rects are in `rects`), in paint order. */
    chips: z.array(z.string()).readonly(),
    /** The canvas: every rect lies inside it, `canvasMargin` (plus any reserved ring) from its edge. */
    bounds: RectSchema,
    /** How each container's children were packed. */
    arrangements: ArrangementsSchema,
    /**
     * The gutter reservations the rects were packed with: the caller's (`LayoutOptions.gutters`) plus the lane
     * space the widening pass added, per container with any (zones in paint order).
     */
    gutters: GutterReservationsSchema,
    report: LayoutReportSchema,
  })
  .readonly();
export type Layout = z.infer<typeof LayoutSchema>;

/**
 * The stage a layout has just completed: `normalise` (stage 1), `size` and `pack` (stages 2–3 of
 * the first placement), `route` (a stretch of a routing pass: `routed` of `edges` so far), `widen` (a widening
 * re-pack between two routing passes, before the pass it is numbered for).
 */
export const LayoutStageSchema = z.enum(['normalise', 'size', 'pack', 'route', 'widen']);
export type LayoutStage = z.infer<typeof LayoutStageSchema>;

/**
 * How far a layout has got: what `layoutSteps` yields between its stages and what the layout worker posts as
 * `progress`. The worker checks for cancellation at every step.
 */
export const LayoutProgressSchema = z
  .strictObject({
    stage: LayoutStageSchema,
    /** The routing pass (1 to 3) for `route` and `widen`; 0 before routing. */
    pass: z.number(),
    /** Edges routed so far in this pass (`route`); 0 otherwise. */
    routed: z.number(),
    /** Edges to route after merging; 0 before routing. */
    edges: z.number(),
  })
  .readonly();
export type LayoutProgress = z.infer<typeof LayoutProgressSchema>;

/** What a layout request resolves to. */
export const LayoutResultSchema = z
  .strictObject({
    id: z.number(),
    /** The request's memo key in the worker (null: none, not memoised). */
    key: z.string().nullable(),
    /** Answered from the worker's memo. */
    cached: z.boolean(),
    layout: LayoutSchema,
  })
  .readonly();
export type LayoutResult = z.infer<typeof LayoutResultSchema>;

export const LayoutInputErrorCodeSchema = z.enum([
  /** Two Scene nodes share an id (or one node object appears twice in the tree). */
  'duplicate-id',
  /** An edge names a node that is not in the Scene. */
  'unknown-endpoint',
  /** A node object contains itself: the tree is not a tree. */
  'cycle',
  /** A collapsed zone (a chip) still has children in the Scene. */
  'collapsed-with-children',
  /** The Scene nests deeper than `MAX_SCENE_DEPTH` levels. */
  'too-deep',
  /** A layout option is not a finite, non-negative number, or a range is inverted. */
  'invalid-option',
]);
export type LayoutInputErrorCode = z.infer<typeof LayoutInputErrorCodeSchema>;

/**
 * What went wrong: a `LayoutInputError` code (the Scene or an option was refused; `ids` names the offending
 * nodes or options, skill §2 rule 5), `protocol` (a malformed message) or `internal` (an unexpected exception:
 * a bug).
 */
export const LayoutWorkerErrorCodeSchema = z.enum([
  ...LayoutInputErrorCodeSchema.options,
  'protocol',
  'internal',
]);
export type LayoutWorkerErrorCode = z.infer<typeof LayoutWorkerErrorCodeSchema>;

export const LayoutWorkerErrorInfoSchema = z
  .strictObject({
    code: LayoutWorkerErrorCodeSchema,
    message: z.string(),
    ids: z.array(z.string()).readonly(),
  })
  .readonly();
export type LayoutWorkerErrorInfo = z.infer<typeof LayoutWorkerErrorInfoSchema>;

/** Why a request was cancelled: a later request arrived, or the page cancelled it. */
export const LayoutCancelReasonSchema = z.enum(['superseded', 'cancelled']);
export type LayoutCancelReason = z.infer<typeof LayoutCancelReasonSchema>;

/** Why a request did not resolve: a newer request, the worker or `cancel()`, or the caller's signal. */
export const LayoutCancelledReasonSchema = z.enum([...LayoutCancelReasonSchema.options, 'aborted']);
export type LayoutCancelledReason = z.infer<typeof LayoutCancelledReasonSchema>;

const layoutResultShape = LayoutResultSchema.unwrap().shape;

/** Worker → page. After `result`, `cancelled` or `error` the request is over. */
export const LayoutWorkerResponseSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('progress'), id: z.number(), progress: LayoutProgressSchema }),
    z.strictObject({
      type: z.literal('result'),
      id: layoutResultShape.id,
      /** The request's memo key (null: the request had none and was not memoised). */
      key: layoutResultShape.key,
      /** Answered from the memo, without laying out. */
      cached: layoutResultShape.cached,
      layout: layoutResultShape.layout,
    }),
    z.strictObject({ type: z.literal('cancelled'), id: z.number(), reason: LayoutCancelReasonSchema }),
    /** `id` is null when the message did not carry a usable id. */
    z.strictObject({
      type: z.literal('error'),
      id: z.number().nullable(),
      error: LayoutWorkerErrorInfoSchema,
    }),
  ])
  .readonly();
export type LayoutWorkerResponse = z.infer<typeof LayoutWorkerResponseSchema>;
