// SPDX-License-Identifier: MIT
/**
 * WCAG 2.2 contrast (skill gcp-diagram-style §10): relative luminance of an sRGB colour and the ratio
 * (L1 + 0.05) / (L2 + 0.05) of the lighter to the darker. Pure; used by the theme tests and by the one rendering
 * rule that depends on it (`readableOn`).
 */

const HEX = /^#([0-9a-f]{6})$/i;

/** The channels of a `#RRGGBB` colour, 0–255. */
export function parseHex(colour: string): readonly [number, number, number] {
  const match = HEX.exec(colour);
  if (match?.[1] === undefined) throw new Error(`not a #RRGGBB colour: ${colour}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(colour: string): number {
  const [r, g, b] = parseHex(colour);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The WCAG contrast ratio of two `#RRGGBB` colours, 1 to 21, whatever their order. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * `colour` at opacity `alpha` over `background` (an sRGB blend, as a browser composites it), as `#RRGGBB`: what a
 * translucent fill looks like on what it lies on (the timeline's ghosts at 50 %).
 */
export function blendOver(colour: string, alpha: number, background: string): string {
  const top = parseHex(colour);
  const bottom = parseHex(background);
  const channel = (index: 0 | 1 | 2): string =>
    Math.round(top[index] * alpha + bottom[index] * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`.toUpperCase();
}

/** WCAG 1.4.3 for normal text: 4.5 : 1. */
export const TEXT_CONTRAST = 4.5;

/**
 * The first of `candidates` that reaches `minimum` on `background`, else the most contrasting one. The renderer
 * sets secondary text (a zone's id after the middle dot, a card-sized zone's subtitle) in `muted` where `muted`
 * is readable on the tint and in `mutedOnTint` where it is not (light projects; dark projects and nested
 * containers; tokens.ts).
 */
export function readableOn(
  background: string,
  candidates: readonly string[],
  minimum = TEXT_CONTRAST,
): string {
  let best = candidates[0];
  if (best === undefined) throw new Error('readableOn needs at least one candidate colour');
  let bestRatio = 0;
  for (const colour of candidates) {
    const ratio = contrastRatio(colour, background);
    if (ratio >= minimum) return colour;
    if (ratio > bestRatio) {
      best = colour;
      bestRatio = ratio;
    }
  }
  return best;
}
