// SPDX-License-Identifier: MIT
/**
 * Text that fits its box. Widths come from the layout's generated Roboto metrics table (`measureText`), never
 * from the DOM, so a label is cut with an ellipsis in exactly the place the layout expects, the same in a test,
 * in the headless renderer and in the browser.
 */
import {
  measureText,
  subtitleRuns,
  type FontFamily,
  type FontWeight,
  type TextRun,
} from '@gcportrait/layout';

export const ELLIPSIS = '…';

/** The width of runs, each in its face. */
export function runsWidth(runs: readonly TextRun[], weight: FontWeight, size: number): number {
  return runs.reduce((sum, run) => sum + measureText(run.text, weight, size, { family: run.family }), 0);
}

/** `text` cut at a code point boundary with an ellipsis so that it fits `width`; unchanged when it fits. */
export function fitText(
  text: string,
  weight: FontWeight,
  size: number,
  width: number,
  family: FontFamily = 'sans',
): string {
  const measure = (value: string): number => measureText(value, weight, size, { family });
  if (measure(text) <= width) return text;
  const chars = Array.from(text);
  // Binary search for the longest prefix that fits with the ellipsis.
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(chars.slice(0, middle).join('').trimEnd() + ELLIPSIS) <= width) low = middle;
    else high = middle - 1;
  }
  const prefix = chars.slice(0, low).join('').trimEnd();
  return prefix === '' && measure(ELLIPSIS) > width ? '' : prefix + ELLIPSIS;
}

/**
 * Runs cut to fit `width`: whole runs while they fit, then the first run that does not fit cut with an
 * ellipsis (in its own face), and nothing after it.
 */
export function fitRuns(
  runs: readonly TextRun[],
  weight: FontWeight,
  size: number,
  width: number,
): TextRun[] {
  const out: TextRun[] = [];
  let used = 0;
  for (const run of runs) {
    const runWidth = measureText(run.text, weight, size, { family: run.family });
    if (used + runWidth <= width) {
      out.push(run);
      used += runWidth;
      continue;
    }
    const cut = fitText(run.text, weight, size, width - used, run.family);
    if (cut !== '') out.push({ text: cut, family: run.family });
    break;
  }
  return out;
}

/** A subtitle as runs (addresses in Roboto Mono, the rest in Roboto: `subtitleRuns`), fitted to `width`. */
export function fitSubtitle(subtitle: string, weight: FontWeight, size: number, width: number): TextRun[] {
  return fitRuns(subtitleRuns(subtitle), weight, size, width);
}
