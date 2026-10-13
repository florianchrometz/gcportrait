// SPDX-License-Identifier: MIT
/**
 * The title block (skill gcp-diagram-style §7): top-left inside the SVG, so exports carry it. It names the scope
 * and the lens, gives the data's read time in ISO-8601 with the viewer's UTC offset, and ends with the tagline
 * in `muted` at 10.5 px. The same three lines on the interactive canvas and in every export: the
 * non-affiliation statement is in the app footer only, never in a drawing (AGENTS.md, Non-affiliation, brand and
 * legal).
 */
import { measureText } from '@gcportrait/layout';

import { TAGLINE } from '../branding';

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/**
 * An RFC 3339 instant written in ISO-8601 at a UTC offset in minutes (east positive, e.g. 120 for CEST,
 * -300 for EST, 330 for IST): `2026-10-08T02:00:00+02:00`. A value that is not a timestamp comes back as is.
 */
export function formatReadTime(readTime: string, offsetMinutes: number): string {
  const instant = Date.parse(readTime);
  if (Number.isNaN(instant) || !Number.isFinite(offsetMinutes)) return readTime;
  const offset = Math.trunc(offsetMinutes);
  const local = new Date(instant + offset * 60_000);
  const sign = offset < 0 ? '-' : '+';
  const magnitude = Math.abs(offset);
  return (
    `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(magnitude / 60))}:${pad(magnitude % 60)}`
  );
}

/** The viewer's UTC offset at an instant, in minutes east of UTC (what `formatReadTime` takes). */
export function viewerOffsetMinutes(readTime: string): number {
  const instant = Date.parse(readTime);
  const offset = -new Date(Number.isNaN(instant) ? 0 : instant).getTimezoneOffset();
  return offset === 0 ? 0 : offset;
}

export interface TitleBlockLine {
  readonly text: string;
  readonly size: number;
  readonly weight: 400 | 500 | 700;
  readonly tone: 'ink' | 'muted';
  /** Baseline, from the block's top. */
  readonly baseline: number;
}

export interface TitleBlock {
  /** The scope line, the lens and read-time line, and the tagline (the last line, canvas and exports alike). */
  readonly scope: TitleBlockLine;
  readonly meta: TitleBlockLine;
  readonly tagline: TitleBlockLine;
  readonly width: number;
  readonly height: number;
}

export const TITLE_SEPARATOR = ' · ';

/** From the last baseline to the block's bottom: the descenders of 10.5 px text. */
const DESCENT = 4;

/** The title block's text and metrics, the same for the canvas and a standalone file. */
export function titleBlock(
  scope: string,
  lensTitle: string,
  readTime: string,
  offsetMinutes: number,
): TitleBlock {
  const scopeLine: TitleBlockLine = { text: scope, size: 15, weight: 500, tone: 'ink', baseline: 15 };
  const meta: TitleBlockLine = {
    text: `${lensTitle} lens${TITLE_SEPARATOR}read ${formatReadTime(readTime, offsetMinutes)}`,
    size: 11,
    weight: 400,
    tone: 'muted',
    baseline: 33,
  };
  const tagline: TitleBlockLine = { text: TAGLINE, size: 10.5, weight: 400, tone: 'muted', baseline: 50 };
  const lines = [scopeLine, meta, tagline];
  const width = Math.ceil(Math.max(...lines.map((line) => measureText(line.text, line.weight, line.size))));
  return { scope: scopeLine, meta, tagline, width, height: tagline.baseline + DESCENT };
}
