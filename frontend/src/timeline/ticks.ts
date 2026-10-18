// SPDX-License-Identifier: Apache-2.0
/**
 * The timeline's ticks (AGENTS.md, Product rules; skill cai-ingestion §5): `today` at 00:00 UTC and the 34
 * days before it, oldest first. A tick's read time is `YYYY-MM-DDT00:00:00Z`; the latest tick of a live scope uses
 * "now" instead (`readTime: null`), so it is never in the future and shows the scope as it is. Ticks are labelled in
 * the viewer's local date: the label is the local date of the instant the tick shows.
 *
 * Pure: `today` (and, for a live scope, `now`) come from the caller. The app passes its own clock's day; a stored
 * history passes its last day (`DemoHistory.today`), so a demo organisation's timeline is the same on every day.
 */

/** Daily ticks on the timeline: today and the 34 days before it (CAI reads at most 35 days back). */
export const TIMELINE_DAYS = 35;

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The UTC calendar day (`YYYY-MM-DD`) of an instant in milliseconds since the epoch. */
export function utcDayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whether `value` is a real calendar day written `YYYY-MM-DD` (what a ViewSpec's `tick` holds). */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && utcDayOf(ms) === value;
}

/** The start of a day, 00:00 UTC, in milliseconds since the epoch. */
export function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** The read time of a day's tick: `YYYY-MM-DDT00:00:00Z`. */
export function dayReadTime(day: string): string {
  return `${day}T00:00:00Z`;
}

/** The day `days` days after `day` (before it when negative). */
export function addDays(day: string, days: number): string {
  return utcDayOf(dayStart(day) + days * DAY_MS);
}

/** The UTC day a read time (RFC 3339) falls on; null when it is not a time. */
export function dayOfReadTime(readTime: string): string | null {
  const ms = Date.parse(readTime);
  return Number.isFinite(ms) ? utcDayOf(ms) : null;
}

export interface TimelineTick {
  /** 0 for the oldest tick, `TIMELINE_DAYS - 1` for the latest. */
  readonly index: number;
  /** The UTC day, `YYYY-MM-DD`: what a ViewSpec's `tick` names. */
  readonly day: string;
  /** The read time to ask Cloud Asset Inventory for; null: now (the latest tick of a live scope). */
  readonly readTime: string | null;
  /** The instant the tick shows, in milliseconds since the epoch: its label is this instant's local date. */
  readonly at: number;
}

/**
 * The 35 ticks ending `today`, oldest first. With `now` (a live scope) the latest tick reads at "now": its
 * `readTime` is null and its `at` is `now` (never before the day's start). Without it (a stored history) every tick
 * reads at its day's 00:00 UTC.
 */
export function timelineTicks(today: string, now?: number): readonly TimelineTick[] {
  const ticks: TimelineTick[] = [];
  for (let index = 0; index < TIMELINE_DAYS; index += 1) {
    const day = addDays(today, index - (TIMELINE_DAYS - 1));
    const latest = index === TIMELINE_DAYS - 1;
    ticks.push(
      latest && now !== undefined
        ? { index, day, readTime: null, at: Math.max(now, dayStart(day)) }
        : { index, day, readTime: dayReadTime(day), at: dayStart(day) },
    );
  }
  return ticks;
}

/** The ticks of the days a stored history holds (oldest first, as `DemoHistory.ticks` lists them). */
export function historyTicks(days: readonly string[]): readonly TimelineTick[] {
  return days.map((day, index) => ({ index, day, readTime: dayReadTime(day), at: dayStart(day) }));
}

/** The index of `day` among `ticks`, or -1. */
export function indexOfDay(ticks: readonly TimelineTick[], day: string | null | undefined): number {
  if (day === null || day === undefined) return -1;
  return ticks.findIndex((tick) => tick.day === day);
}

/** How labels are written: the viewer's locale and time zone unless a test fixes them. */
export interface LabelOptions {
  readonly locale?: string;
  readonly timeZone?: string;
}

/** The forms of a tick's label. */
const LABEL_FIELDS = {
  label: { day: 'numeric', month: 'short' },
  title: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  minute: {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

/**
 * The formatters made so far, one per form, locale and time zone: the timeline bar labels its 35 days twice
 * in every render, and making a new `Intl.DateTimeFormat` for each label took about 12 ms of the UI thread per
 * timeline step on demo L. A formatter made without a locale or a time zone keeps the viewer's as they were when it
 * was made, so those are part of the key (`viewerDefaults`).
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

/** The viewer's locale and time zone as last looked up; null once the code that looked them up has run. */
let viewerDefaults: string | null = null;

/**
 * The viewer's locale and time zone, looked up once per run of code (a render labels its days with one lookup) and
 * again in the next: a zone or language the viewer changes while the page is open shows in the next render.
 */
function defaultsKey(): string {
  if (viewerDefaults === null) {
    const { locale, timeZone } = new Intl.DateTimeFormat().resolvedOptions();
    viewerDefaults = `${locale}\u0000${timeZone}`;
    queueMicrotask(() => {
      viewerDefaults = null;
    });
  }
  return viewerDefaults;
}

function formatterFor(options: LabelOptions, form: keyof typeof LABEL_FIELDS): Intl.DateTimeFormat {
  const defaults = options.locale === undefined || options.timeZone === undefined ? defaultsKey() : '';
  const key = `${form}\u0000${options.locale ?? ''}\u0000${options.timeZone ?? ''}\u0000${defaults}`;
  let formatter = formatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(options.locale, {
      ...LABEL_FIELDS[form],
      ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** A tick's short label in the viewer's local date: "8 Oct" (en-GB), "Oct 8" (en-US). */
export function tickLabel(tick: Pick<TimelineTick, 'at'>, options: LabelOptions = {}): string {
  return formatterFor(options, 'label').format(tick.at);
}

/** A tick's full label in the viewer's local date: "Thursday 8 October 2026" (en-GB). */
export function tickTitle(tick: Pick<TimelineTick, 'at'>, options: LabelOptions = {}): string {
  return formatterFor(options, 'title').format(tick.at);
}

/** The parts of an instant in the viewer's time zone (or the one a test fixes), as digits. */
function localParts(at: number, options: LabelOptions): Readonly<Record<string, string>> {
  const parts = formatterFor({ ...options, locale: 'en-GB' }, 'minute').formatToParts(at);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** "2026-10-05 14:30" (with `seconds`, "2026-10-05 14:30:00"): an instant in the viewer's local time. */
export function localMinute(at: number, options: LabelOptions = {}, seconds = false): string {
  const part = localParts(at, options);
  const time = `${part['hour'] ?? ''}:${part['minute'] ?? ''}${seconds ? `:${part['second'] ?? ''}` : ''}`;
  return `${part['year'] ?? ''}-${part['month'] ?? ''}-${part['day'] ?? ''} ${time}`;
}
