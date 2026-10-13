// SPDX-License-Identifier: MIT
/**
 * Sizing constants at scale 1 (skill gcp-diagram-layout §3, skill gcp-diagram-style §3 and §4). They are
 * theme-independent: both themes draw the same geometry. `LayoutOptions.sizing` may override any of them; the
 * defaults below are the specification and the README's constants table must match them.
 */

export interface Sizing {
  /** Card height; cards in a row share a baseline because they share this height. */
  readonly cardHeight: number;
  /** Card width range: the width comes from the label and subtitle metrics within these bounds. */
  readonly cardMinWidth: number;
  readonly cardMaxWidth: number;
  /** The card's icon (square) and the inner padding around icon and text (left, between, right). */
  readonly cardIcon: number;
  readonly cardPadding: number;
  /**
   * A collapsed zone's chip: height, and the width range its width comes from (its label and count line from
   * the metrics table, like a card's: `chipWidth`), and its ⊞ glyph and the gap after it, which take the place
   * of a card's icon.
   */
  readonly chipHeight: number;
  readonly chipMinWidth: number;
  readonly chipMaxWidth: number;
  readonly chipGlyph: number;
  readonly chipGlyphGap: number;
  /** Zone header height: `headerHeight` up to `shallowHeaderMaxDepth`, `deepHeaderHeight` below. */
  readonly headerHeight: number;
  readonly deepHeaderHeight: number;
  readonly shallowHeaderMaxDepth: number;
  /** Zone padding (the inner ring between a zone's border or header and its children). */
  readonly zonePadding: number;
  /** Padding of a project zone at the top level of the canvas. */
  readonly rootProjectPadding: number;
  /** Gap between horizontally adjacent siblings (column gap) and between rows (row gap), before lanes. */
  readonly gapHorizontal: number;
  readonly gapVertical: number;
  /** Margin between the canvas edge and the top-level children. */
  readonly canvasMargin: number;
  /** Zone header: the header icon, the space between icon and title, between title and the badges. */
  readonly headerIcon: number;
  readonly headerIconGap: number;
  readonly headerBadgeGap: number;
  /** A badge pill: horizontal text padding inside the pill and the space between two pills. */
  readonly badgePaddingX: number;
  readonly badgeSpacing: number;
  /** Text sizes (px at scale 1). */
  readonly cardTitleSize: number;
  readonly cardSubtitleSize: number;
  /**
   * Zone titles: `zoneTitleSize` up to `largeTitleMaxDepth`, `deepZoneTitleSize` below (depth counts from the
   * canvas, the organisation, at 0: root folders and loose projects are depth 1).
   */
  readonly zoneTitleSize: number;
  readonly deepZoneTitleSize: number;
  readonly largeTitleMaxDepth: number;
  /**
   * The widest a zone's title (its label and, after the middle dot, its subtitle) may make the zone: a longer
   * title is ellipsised by the renderer (the full label stays in the Scene for tooltips and the accessible
   * name), so a pathological label cannot widen a zone without bound. Three card widths (3 × 220).
   */
  readonly zoneTitleMaxWidth: number;
  readonly badgeTextSize: number;
}

export const DEFAULT_SIZING: Sizing = Object.freeze({
  cardHeight: 44,
  cardMinWidth: 148,
  cardMaxWidth: 220,
  cardIcon: 24,
  cardPadding: 10,
  chipHeight: 44,
  chipMinWidth: 148,
  chipMaxWidth: 220,
  chipGlyph: 16,
  chipGlyphGap: 8,
  headerHeight: 40,
  deepHeaderHeight: 32,
  shallowHeaderMaxDepth: 2,
  zonePadding: 16,
  rootProjectPadding: 24,
  gapHorizontal: 24,
  gapVertical: 20,
  canvasMargin: 24,
  headerIcon: 24,
  headerIconGap: 8,
  headerBadgeGap: 12,
  badgePaddingX: 6,
  badgeSpacing: 4,
  cardTitleSize: 13,
  cardSubtitleSize: 10.5,
  zoneTitleSize: 15,
  deepZoneTitleSize: 13,
  largeTitleMaxDepth: 1,
  zoneTitleMaxWidth: 660,
  badgeTextSize: 10.5,
});

/**
 * Routing constants at scale 1 (skill gcp-diagram-layout §3 and §5, skill gcp-diagram-style §5). Like the
 * sizing they are theme-independent; `LayoutOptions.routing` may override any of them.
 */
export interface Routing {
  /** Distance between two neighbouring lanes in a gutter. */
  readonly lanePitch: number;
  /** A gutter holding n lanes needs n × lanePitch + gutterBase px: half the base on each side of the lanes. */
  readonly gutterBase: number;
  /** Cost of one bend of a route, in px of length. */
  readonly bendCost: number;
  /** Cost of every lane already used in a gutter segment a route runs along (pressure), per segment. */
  readonly laneCost: number;
  /** Distance between two ports on one side of a rect. */
  readonly portSpacing: number;
  /** How far ports stay from the corners of a card, chip or empty zone (their corner radius). */
  readonly portClearance: number;
  /** How far ports stay from the lower corners of an open zone (its corner radius plus a little). */
  readonly zonePortClearance: number;
  /** How far an arrowhead's tip reaches inside its target's border. */
  readonly arrowInset: number;
  /** Radius of a route's rounded elbows (the renderer draws them). */
  readonly elbowRadius: number;
  /**
   * The first routing pass's search budget, in A* states settled (`RoutingReport.work`, a deterministic measure
   * of routing time): once the first pass has settled this many, it searches the rest of its edges weighted
   * and is final, without widening gutters (single-pass mode). A view whose exact first pass stays within it
   * routes in three passes (skill §5).
   */
  readonly singlePassWork: number;
  /**
   * Above this much first-pass work (and up to `singlePassWork`), at most one widening round runs: the band
   * between the two keeps a growing view in three-pass mode with its gutters widened, at the cost of one round
   * instead of two, so that it loses a round before it loses the widening.
   */
  readonly oneRoundWork: number;
  /**
   * At most this many rounds of widening the gutters whose lanes do not fit, re-packing and re-routing (a round
   * runs only while some gutter is too narrow). The re-route lays the previous routes onto the widened gutters
   * (the same gutters, turns and lanes, which the widening made room for) and searches again only an edge whose
   * gutters no longer line up; it keeps every lane inside its gutter where it can. One round is the
   * three passes (route, widen and re-pack, re-route); the second and third widen what the re-route before
   * still needed where the re-pack made two gutters meet that did not before (a third because port lines and
   * stacks move more gutters in a re-pack). Large layouts stop after two (`lateRoundsUpTo`).
   */
  readonly wideningRounds: number;
  /**
   * Above this many lane holders, at most two widening rounds run whatever `wideningRounds` says: a round lays
   * every route again, which on a very large layout costs a large share of its budget.
   */
  readonly lateRoundsUpTo: number;
  /**
   * Edges of one kind that meet one rect at the same end (all as targets, or all as sources) are bundled from
   * this many on: those facing one side share a port there and lanes towards it (a hub's trunk).
   */
  readonly bundleMin: number;
  /** Cell size of the coarse grid the fallback router searches when no gutter path exists. */
  readonly fallbackGrid: number;
  /**
   * What a route pays per px along a zone's border inside its padding band (a ring side between the zone's
   * corners), relative to 1 for every gap and every line through free space: such a stretch reads as a doubled
   * border or an underline, so routes take the gaps between the zones where they can (skill §5). A gap with a
   * child on one side only is not charged more: it runs through the same free space as the lines parallel to it
   * there, and a dearer gap would send routes the long way round to reach them.
   */
  readonly hugFactor: number;
  /**
   * The most a route pays above its length for running along the whole of one ring side (px): on a side longer
   * than `hugCap / (hugFactor − 1)` the surcharge per px falls in proportion, so no route goes more than about
   * `hugCap / 2` out of its way and back to avoid a long border. Without the cap 9 000 px along a ring top
   * would cost 4 500 px extra, and routes would drop 2 000 px to a row gap and climb back to avoid it.
   */
  readonly hugCap: number;
  /**
   * What a route pays per px in the canvas margin (the canvas's ring), relative to 1: the margin is the gutter
   * beside the outermost zones, needed only to reach a side of one that faces the canvas edge, so routes do
   * not run round the diagram through it.
   */
  readonly marginFactor: number;
}

export const DEFAULT_ROUTING: Routing = Object.freeze({
  lanePitch: 8,
  gutterBase: 8,
  bendCost: 40,
  laneCost: 50,
  portSpacing: 12,
  portClearance: 8,
  zonePortClearance: 12,
  arrowInset: 2,
  elbowRadius: 6,
  singlePassWork: 420_000,
  oneRoundWork: 340_000,
  wideningRounds: 3,
  lateRoundsUpTo: 500,
  bundleMin: 3,
  fallbackGrid: 8,
  hugFactor: 1.5,
  hugCap: 320,
  marginFactor: 2,
});

/** Font weights of each text role (Roboto 400/500/700; skill gcp-diagram-style §3). */
export const TEXT_WEIGHTS = Object.freeze({
  cardTitle: 700,
  /** Addresses (IPs, CIDRs) in Roboto Mono, the rest in Roboto: see `subtitleRuns`. */
  cardSubtitle: 400,
  zoneTitle: 500,
  /** The subtitle (id or fact) after the middle dot in a zone title, in `muted`; runs as in `subtitleRuns`. */
  zoneTitleId: 400,
  badge: 400,
} as const);

/** What separates a zone's display name from its id in the header ("Retail web (prod) · demo-web-1"). */
export const ZONE_TITLE_SEPARATOR = ' · ';

/** Packing targets (skill gcp-diagram-layout §1, §4): children grids wider than tall. */
export const TARGET_ASPECT = 1.6;
export const ROOT_ASPECT = 1.75;

/**
 * The band around the packing target ("within 20 % of target": agents.md, Layout and drawing rules): a
 * children box within this relative deviation of the target needs no empty frame, so among those the most
 * compact arrangement wins (src/pack.ts).
 */
export const ASPECT_TOLERANCE = 0.2;

/**
 * The deepest nesting the layout accepts, counted in Scene levels from the top (a top-level node is level 1).
 * A real Scene stays far below it (an organisation, at most ten levels of folders, a project, a region, a VPC,
 * a subnet and a few product containers); the limit keeps every recursive stage far from the engine's call
 * stack, so an absurd Scene is refused with a typed error (`too-deep`) instead of a stack overflow.
 */
export const MAX_SCENE_DEPTH = 256;

/**
 * Sibling order among zones (skill gcp-diagram-layout §4: zones before cards, then kind rank with the VPC
 * before other containers, then label, then id): declared once in `@gcportrait/model`, where `packages/graph`
 * reads it too; re-exported here for the renderer and the tests.
 */
export { ZONE_KIND_RANK } from '@gcportrait/model';
