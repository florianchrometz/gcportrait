// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * Colour helpers for the icon checks: parsing the colour values icon files use, WCAG relative luminance and
 * contrast ratio, and the test that tells Google's two-tone blue console icons from the multi-colour and grey
 * marks (style skill §2: colour marks sit on a light plate on dark canvases; two-tone blue icons need none).
 */

/** Named colours that occur in the icon sets. */
const NAMED = /** @type {Record<string, string>} */ ({ white: '#ffffff', black: '#000000' });

/**
 * @param {string} value `#rgb`, `#rrggbb`, `white` or `black`
 * @returns {[number, number, number]} channels 0–255
 */
export function parseColour(value) {
  const text = (NAMED[value.trim().toLowerCase()] ?? value.trim()).toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short !== null) {
    return /** @type {[number, number, number]} */ (
      [1, 2, 3].map((i) => Number.parseInt(`${String(short[i])}${String(short[i])}`, 16))
    );
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(text);
  if (long === null) throw new Error(`unsupported colour value "${value}"`);
  return /** @type {[number, number, number]} */ ([1, 2, 3].map((i) => Number.parseInt(String(long[i]), 16)));
}

/**
 * WCAG 2.2 relative luminance.
 * @param {[number, number, number]} rgb
 * @returns {number}
 */
export function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/**
 * WCAG 2.2 contrast ratio of two colours.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(parseColour(a));
  const lb = relativeLuminance(parseColour(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The colour `fg` at `alpha` composited over `bg`, as `#rrggbb`.
 * @param {string} fg
 * @param {number} alpha
 * @param {string} bg
 * @returns {string}
 */
export function composite(fg, alpha, bg) {
  const top = parseColour(fg);
  const bottom = parseColour(bg);
  return `#${top
    .map((channel, i) => Math.round(alpha * channel + (1 - alpha) * (bottom[i] ?? 0)))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Whether a colour belongs to the blue family of Google's two-tone console icons (hue 200°–240°, clearly
 * saturated) or is white, which those icons use for cut-outs.
 * @param {string} value
 * @returns {boolean}
 */
export function isTwoToneBlue(value) {
  const [r, g, b] = parseColour(value).map((channel) => channel / 255);
  const max = Math.max(r ?? 0, g ?? 0, b ?? 0);
  const min = Math.min(r ?? 0, g ?? 0, b ?? 0);
  if (min === 1) return true;
  const delta = max - min;
  if (delta === 0) return false;
  const saturation = delta / (1 - Math.abs(max + min - 1));
  let hue;
  if (max === r) hue = 60 * ((((g ?? 0) - (b ?? 0)) / delta) % 6);
  else if (max === g) hue = 60 * (((b ?? 0) - (r ?? 0)) / delta + 2);
  else hue = 60 * (((r ?? 0) - (g ?? 0)) / delta + 4);
  if (hue < 0) hue += 360;
  return hue >= 200 && hue <= 240 && saturation >= 0.5;
}
