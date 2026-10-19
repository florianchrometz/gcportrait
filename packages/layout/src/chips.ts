// SPDX-License-Identifier: Apache-2.0
/**
 * A collapsed zone's chip (skill gcp-diagram-style §4): the ⊞ glyph, the zone's label and
 * a count line ("2 networks · 39 resources"). Its width comes from the text metrics like a card's, within
 * 148–220 px, so two chips whose labels share a long prefix ("Shared VPC host (Production)", "Shared VPC host
 * (Non-production)") stay apart and the count line keeps its last part. The count line's wording is defined
 * here once: the layout sizes the chip with it and the renderer draws it (`chipCountLine`), the full form when
 * it fits the chip and the short form ("2 net · 39 res") otherwise.
 */
import type { ChipCountKind, ChipCounts } from '@gcportrait/model';
import { TEXT_WEIGHTS, ZONE_TITLE_SEPARATOR, type Sizing } from './constants.js';
import { measureText, type FontMetricsTable } from './metrics.js';

/** Each count kind's singular and its short form, in the order a count line lists them. */
export const CHIP_COUNT_NAMES: readonly (readonly [ChipCountKind, string, string])[] = Object.freeze([
  ['folders', 'folder', 'fld'],
  ['projects', 'project', 'prj'],
  ['networks', 'network', 'net'],
  ['subnets', 'subnet', 'sub'],
  ['containers', 'container', 'ctr'],
  ['resources', 'resource', 'res'],
] as const);

/** "2 networks · 39 resources", or the short form "2 net · 39 res"; a kind with no count is left out. */
export function chipCountLine(counts: ChipCounts, short = false): string {
  return CHIP_COUNT_NAMES.flatMap(([key, singular, abbreviation]) => {
    const count = counts[key];
    if (count === undefined) return [];
    return [`${String(count)} ${short ? abbreviation : count === 1 ? singular : `${singular}s`}`];
  }).join(ZONE_TITLE_SEPARATOR);
}

/** What a chip draws in its text column: the label (13 px, 700) and the count line (10.5 px, 400). */
export interface ChipText {
  readonly width: number;
  /** The count line drawn: the full form when it fits the widest chip, else the short form. */
  readonly line: string;
  /** The label or the count line is wider than the widest chip's text column (the renderer ellipsises it). */
  readonly truncated: boolean;
}

/**
 * A chip's width: padding, the ⊞ glyph and the gap after it, the wider of the label and the count line, and
 * padding, rounded up to whole px and clamped to `chipMinWidth`–`chipMaxWidth`. The count line is measured in
 * its full form when that fits the widest chip's text column, else in its short form, as the renderer draws it.
 */
export function chipWidth(
  label: string,
  counts: ChipCounts,
  context: { readonly sizing: Sizing; readonly metrics: FontMetricsTable },
): ChipText {
  const { sizing, metrics } = context;
  const inset = 2 * sizing.cardPadding + sizing.chipGlyph + sizing.chipGlyphGap;
  const room = sizing.chipMaxWidth - inset;
  const title = measureText(label, TEXT_WEIGHTS.cardTitle, sizing.cardTitleSize, { metrics });
  const full = chipCountLine(counts);
  const fullWidth = measureText(full, TEXT_WEIGHTS.cardSubtitle, sizing.cardSubtitleSize, { metrics });
  const line = fullWidth <= room ? full : chipCountLine(counts, true);
  const lineWidth =
    line === full
      ? fullWidth
      : measureText(line, TEXT_WEIGHTS.cardSubtitle, sizing.cardSubtitleSize, { metrics });
  const natural = Math.ceil(inset + Math.max(title, lineWidth));
  return {
    width: Math.min(sizing.chipMaxWidth, Math.max(sizing.chipMinWidth, natural)),
    line,
    truncated: natural > sizing.chipMaxWidth,
  };
}
