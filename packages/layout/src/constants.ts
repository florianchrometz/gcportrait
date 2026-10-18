// SPDX-License-Identifier: Apache-2.0
/**
 * Sizing constants at scale 1 (skill gcp-diagram-layout §3, skill gcp-diagram-style §3 and §4). They are
 * theme-independent: both themes draw the same geometry. `LayoutOptions.sizing` may override any of them; the
 * defaults below are the specification, verified against the layout skill by test/skill.test.ts.
 */

import type { Routing, Sizing } from '@gcportrait/model';

export type { Routing, Sizing } from '@gcportrait/model';

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
 * The band around the packing target ("within 20 % of target": packages/AGENTS.md, Layout and drawing rules): a
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
