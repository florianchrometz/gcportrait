// SPDX-License-Identifier: MIT
/**
 * Stage 2: sizing (skill gcp-diagram-layout §3, skill gcp-diagram-style §3–§4).
 *
 * - Cards: fixed height; width = padding + icon + padding + the wider of title and subtitle + padding, rounded
 *   up to whole px and clamped to the card width range. A subtitle is measured run by run (`subtitleRuns`):
 *   addresses (IPs, CIDRs) in Roboto Mono, everything else in Roboto (style §3); the renderer sets the same
 *   runs in the same faces.
 * - Chips (collapsed zones): fixed height; width from the label and the count line (`chipWidth`, chips.ts)
 *   within the chip width range, like a card's.
 * - Empty zones: card-sized, measured like a card from their label and subtitle.
 * - Chips and empty zones that are siblings then share the widest of their widths (`shareSolidWidths`).
 * - Open zones: header height by depth, padding (wider for projects at the top level, plus any ring the
 *   router reserves), and the narrowest width the header needs for its icon, title, subtitle (measured run by
 *   run like a card's) and badges, the title capped at `zoneTitleMaxWidth` (the renderer ellipsises a longer
 *   one). Their final size comes from packing (stage 3).
 */
import { TEXT_WEIGHTS, ZONE_TITLE_SEPARATOR, type Sizing } from './constants.js';
import { chipWidth } from './chips.js';
import { measureText, type FontFamily, type FontMetricsTable, type FontWeight } from './metrics.js';
import type { LayoutNode } from './normalise.js';

export interface SizingContext {
  readonly sizing: Sizing;
  readonly metrics: FontMetricsTable;
  /** Extra padding ring the router reserves in a zone (by id): on all sides, and per side on top. */
  readonly ringOf: (id: string) => number;
  readonly sidesOf: (id: string) => { top: number; right: number; bottom: number; left: number };
}

export interface SizingCounts {
  /** Cards, empty zones and chips whose text is wider than their widest box. */
  truncatedLabels: number;
  /** Open zones whose title is wider than `zoneTitleMaxWidth`. */
  cappedTitles: number;
}

/** One stretch of a subtitle and the face it is set in. */
export interface TextRun {
  readonly text: string;
  readonly family: FontFamily;
}

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
/** A dotted-quad IPv4 address. */
const IPV4 = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`);
const IPV4_PREFIX = /^(?:3[0-2]|[12]?\d)$/;
const IPV6_PREFIX = /^(?:12[0-8]|1[01]\d|[1-9]?\d)$/;
const HEX_GROUP = /^[0-9A-Fa-f]{1,4}$/;

/** An IPv6 address in RFC 4291 text form: eight hex groups, or fewer around one `::`, maybe ending in IPv4. */
function isIpv6(address: string): boolean {
  const halves = address.split('::');
  if (halves.length > 2) return false;
  const groups = halves.flatMap((half) => (half === '' ? [] : half.split(':')));
  const last = groups[groups.length - 1];
  const tail = last !== undefined && IPV4.test(last) ? 2 : 0;
  const hex = tail === 0 ? groups : groups.slice(0, -1);
  if (!hex.every((group) => HEX_GROUP.test(group))) return false;
  const count = hex.length + tail;
  return halves.length === 2 ? count <= 7 : count === 8;
}

/** One address: an IPv4 or IPv6 address, or a CIDR range of either. */
function isAddress(text: string): boolean {
  const slash = text.indexOf('/');
  const address = slash < 0 ? text : text.slice(0, slash);
  const prefix = slash < 0 ? undefined : text.slice(slash + 1);
  if (IPV4.test(address)) return prefix === undefined || IPV4_PREFIX.test(prefix);
  return isIpv6(address) && (prefix === undefined || IPV6_PREFIX.test(prefix));
}

/**
 * A fact that is an address (style §3: IPs and CIDRs in Roboto Mono): one IPv4 or IPv6 address or CIDR
 * range, or a comma-separated list of them. Versions ("3.1.2"), times ("12:30") and ids are not addresses.
 */
function isAddressFact(fact: string): boolean {
  return fact.split(/, ?/).every(isAddress);
}

/**
 * A subtitle (a card's, or a zone's after its title) as runs in their faces (style §3: IPs and CIDRs in Roboto
 * Mono, other facts in Roboto): the subtitle's facts are joined by `ZONE_TITLE_SEPARATOR`; a fact that is an
 * address is a `mono` run, every other fact and the separators are `sans` runs. Adjacent runs of one face are
 * merged. The layout measures subtitles this way and the SVG renderer sets them this way, so the text fits
 * its box.
 */
export function subtitleRuns(subtitle: string): TextRun[] {
  const runs: TextRun[] = [];
  const push = (text: string, family: FontFamily): void => {
    if (text === '') return;
    const last = runs[runs.length - 1];
    if (last !== undefined && last.family === family)
      runs[runs.length - 1] = { text: last.text + text, family };
    else runs.push({ text, family });
  };
  subtitle.split(ZONE_TITLE_SEPARATOR).forEach((fact, index) => {
    if (index > 0) push(ZONE_TITLE_SEPARATOR, 'sans');
    push(fact, isAddressFact(fact) ? 'mono' : 'sans');
  });
  return runs;
}

/** The width of text runs, each in its face. */
function runsWidth(
  runs: readonly TextRun[],
  weight: FontWeight,
  size: number,
  metrics: FontMetricsTable,
): number {
  return runs.reduce(
    (sum, run) => sum + measureText(run.text, weight, size, { metrics, family: run.family }),
    0,
  );
}

/** The natural width of a card-like box (card or empty zone) for its texts, and whether it was clamped. */
export function cardWidth(
  label: string,
  subtitle: string | undefined,
  context: Pick<SizingContext, 'sizing' | 'metrics'>,
): { width: number; truncated: boolean } {
  const { sizing, metrics } = context;
  const title = measureText(label, TEXT_WEIGHTS.cardTitle, sizing.cardTitleSize, { metrics });
  const sub =
    subtitle === undefined
      ? 0
      : runsWidth(subtitleRuns(subtitle), TEXT_WEIGHTS.cardSubtitle, sizing.cardSubtitleSize, metrics);
  const natural = Math.ceil(3 * sizing.cardPadding + sizing.cardIcon + Math.max(title, sub));
  return {
    width: Math.min(sizing.cardMaxWidth, Math.max(sizing.cardMinWidth, natural)),
    truncated: natural > sizing.cardMaxWidth,
  };
}

/** Header height of an open zone at `depth` (the canvas is depth 0, root folders and loose projects 1). */
export function headerHeightAt(depth: number, sizing: Sizing): number {
  return depth <= sizing.shallowHeaderMaxDepth ? sizing.headerHeight : sizing.deepHeaderHeight;
}

/** Zone title font size at `depth` (the canvas is depth 0, root folders and loose projects 1). */
export function zoneTitleSizeAt(depth: number, sizing: Sizing): number {
  return depth <= sizing.largeTitleMaxDepth ? sizing.zoneTitleSize : sizing.deepZoneTitleSize;
}

/** Base padding of an open zone (before any ring the router reserves). */
export function basePaddingOf(node: Pick<LayoutNode, 'kind' | 'depth'>, sizing: Sizing): number {
  return node.kind === 'project' && node.depth === 1 ? sizing.rootProjectPadding : sizing.zonePadding;
}

/** The width of an open zone's title (label, then `' · '` and the subtitle) before the cap. */
export function zoneTitleWidth(
  node: Pick<LayoutNode, 'label' | 'subtitle' | 'depth'>,
  context: Pick<SizingContext, 'sizing' | 'metrics'>,
): number {
  const { sizing, metrics } = context;
  const size = zoneTitleSizeAt(node.depth, sizing);
  let title = measureText(node.label, TEXT_WEIGHTS.zoneTitle, size, { metrics });
  if (node.subtitle !== undefined) {
    title += runsWidth(
      subtitleRuns(`${ZONE_TITLE_SEPARATOR}${node.subtitle}`),
      TEXT_WEIGHTS.zoneTitleId,
      size,
      metrics,
    );
  }
  return title;
}

/**
 * The narrowest width an open zone's header needs. Folder titles sit top-left: padding, icon, title, badges,
 * padding. Every other title is centred, so the icon-and-title group needs the badge block's width free on
 * both sides. The title counts at most `zoneTitleMaxWidth` (the renderer ellipsises a longer one).
 */
export function headerMinWidth(node: LayoutNode, padding: number, context: SizingContext): number {
  const { sizing, metrics } = context;
  const title = Math.min(zoneTitleWidth(node, context), sizing.zoneTitleMaxWidth);
  const group = sizing.headerIcon + sizing.headerIconGap + title;
  let badges = 0;
  node.badges.forEach((badge, index) => {
    badges +=
      measureText(badge, TEXT_WEIGHTS.badge, sizing.badgeTextSize, { metrics }) + 2 * sizing.badgePaddingX;
    if (index > 0) badges += sizing.badgeSpacing;
  });
  const badgeBlock = badges === 0 ? 0 : sizing.headerBadgeGap + badges;
  const width =
    node.kind === 'folder' ? 2 * padding + group + badgeBlock : group + 2 * (padding + badgeBlock);
  return Math.ceil(width);
}

/** Sizes every node: leaves completely, open zones' header, padding and minimum width. */
export function sizeNodes(order: readonly LayoutNode[], context: SizingContext): SizingCounts {
  const { sizing } = context;
  const counts: SizingCounts = { truncatedLabels: 0, cappedTitles: 0 };
  for (const node of order) {
    switch (node.role) {
      case 'card':
      case 'empty': {
        const { width, truncated } = cardWidth(node.label, node.subtitle, context);
        node.width = width;
        node.height = sizing.cardHeight;
        if (truncated) counts.truncatedLabels += 1;
        break;
      }
      case 'chip': {
        const chip = chipWidth(node.label, node.counts ?? {}, context);
        node.width = chip.width;
        node.height = sizing.chipHeight;
        if (chip.truncated) counts.truncatedLabels += 1;
        break;
      }
      case 'zone': {
        node.headerHeight = headerHeightAt(node.depth, sizing);
        node.padding = basePaddingOf(node, sizing) + context.ringOf(node.id);
        node.extra = context.sidesOf(node.id);
        node.minWidth = headerMinWidth(node, node.padding, context);
        if (zoneTitleWidth(node, context) > sizing.zoneTitleMaxWidth) counts.cappedTitles += 1;
        break;
      }
    }
  }
  shareSolidWidths(order);
  return counts;
}

/** Chips and empty zones: the zones drawn card-sized, which nothing is drawn inside. */
export function isSolidZone(node: Pick<LayoutNode, 'role'>): boolean {
  return node.role === 'chip' || node.role === 'empty';
}

/**
 * Chips and empty zones that are siblings take the width of the widest of them, as cards in a column take
 * their column's widest width (ADR 0026): rows of them line up in tidy columns, and the packer, which
 * compares rows by width, never prefers a ragged grid only because one label is a few px shorter.
 */
function shareSolidWidths(order: readonly LayoutNode[]): void {
  const widest = new Map<LayoutNode | null, number>();
  for (const node of order) {
    if (!isSolidZone(node)) continue;
    widest.set(node.parent, Math.max(widest.get(node.parent) ?? 0, node.width));
  }
  for (const node of order) {
    if (isSolidZone(node)) node.width = widest.get(node.parent) ?? node.width;
  }
}
