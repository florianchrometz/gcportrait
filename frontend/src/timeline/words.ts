// SPDX-License-Identifier: MIT
/**
 * The timeline bar's words: what the slider says for a day (its `aria-valuetext`), what a marker's
 * tooltip says, and the readout beside the slider (the state of the view's day: on screen, loading with the read's
 * progress, failed with Google's message, waiting, or why it cannot be read). Labels are the viewer's local dates
 * (ticks.ts); tests fix the locale and the time zone. An extra tick is said by its label, "export 2026-10-05
 * 14:30" (extraTicks.ts), with where its read time came from and, for one placed at the present, why. A read's
 * progress names the day short ("Reading 30 Sept: 12 pages · …") so its size and time fit the readout's two lines;
 * the readout also says when the snapshot was read after the timeline's last day, when a day or an extra tick could
 * not be drawn, when an extra tick is no longer stored, and when one is older than the timeline.
 */
import type { ImportFailure, ImportProgress } from '../import/progress';
import { progressCounters } from '../import/progress';
import { extraTickLabel, isExtraTickId, READ_TIME_SOURCE_WORDS, type ExtraTick } from './extraTicks';
import type { MarkerState, TimelineModel } from './model';
import { tickLabel, tickTitle, type LabelOptions } from './ticks';

/** A marker state in words. */
export const STATE_WORDS: Readonly<Record<MarkerState, string>> = {
  current: 'on screen',
  loading: 'loading',
  cached: 'ready',
  error: 'could not be read',
  unknown: 'not read yet',
};

/** The model's extra ticks. */
function extrasOf(model: TimelineModel): readonly ExtraTick[] {
  return model.ticks.flatMap((tick) => (tick.extra === undefined ? [] : [tick.extra]));
}

/** An extra tick's label among the model's: "export 2026-10-05 14:30", "pull 2026-10-05 14:30 (estimated)". */
export function extraLabel(model: TimelineModel, extra: ExtraTick, labels: LabelOptions = {}): string {
  return extraTickLabel(extra, extrasOf(model), labels);
}

/** "export 2026-10-05 14:30, extra tick, read time from the export's operation.json". */
function extraWords(model: TimelineModel, extra: ExtraTick, labels: LabelOptions): string {
  const copies = extra.copies > 1 ? `, ${String(extra.copies)} copies stored` : '';
  const placed = extra.future ? ', placed at the present' : '';
  const source = READ_TIME_SOURCE_WORDS[extra.readTimeSource];
  return `${extraLabel(model, extra, labels)}, extra tick, ${source}${copies}${placed}`;
}

/** The slider's text for tick `index`: "Thursday 17 September 2026, ready". */
export function valueText(model: TimelineModel, index: number, labels: LabelOptions = {}): string {
  const tick = model.ticks[index];
  if (tick === undefined) return '';
  const state = model.states[index] ?? 'unknown';
  if (tick.extra !== undefined) return `${extraWords(model, tick.extra, labels)}, ${STATE_WORDS[state]}`;
  const own = index === model.own ? ', the snapshot itself' : '';
  const now = tick.readTime === null ? ', now' : '';
  return `${tickTitle(tick, labels)}${now}${own}, ${STATE_WORDS[state]}`;
}

/** A marker's tooltip: "17 Sep: ready", "export 2026-10-05 14:30: ready". */
export function markerTitle(model: TimelineModel, index: number, labels: LabelOptions = {}): string {
  const tick = model.ticks[index];
  if (tick === undefined) return '';
  const name = tick.extra === undefined ? tickLabel(tick, labels) : extraLabel(model, tick.extra, labels);
  return `${name}: ${STATE_WORDS[model.states[index] ?? 'unknown']}`;
}

/** What the readout says, and whether "Try again" goes with it. */
export interface Readout {
  readonly text: string;
  readonly retry: boolean;
  /** More than the readout has room for (its tooltip: where an extra tick's read time came from). */
  readonly detail?: string;
}

export interface ReadoutInput {
  readonly model: TimelineModel;
  /** The read in progress for the view's day, if any. */
  readonly progress: ImportProgress | null;
  /** Why the view's day failed, if it did. */
  readonly failure: ImportFailure | null;
  /** Why live days cannot be read now, if they cannot. */
  readonly blocked: string | null;
  /**
   * The pipeline has answered the view as it is now (its result is the view's scene key's and nothing is
   * pending): a day not on screen then was not drawn, rather than not drawn yet. Absent: not known (false).
   */
  readonly settled?: boolean;
  /** Why the view's diagram could not be drawn (the pipeline's error), if it could not. */
  readonly drawError?: string | null;
  readonly labels?: LabelOptions;
}

/** The readout for the view's position. */
export function readout({
  model,
  progress,
  failure,
  blocked,
  settled = false,
  drawError = null,
  labels = {},
}: ReadoutInput): Readout {
  if (model.outside !== null) {
    const days = model.ticks.filter((tick) => tick.extra === undefined).length;
    const older = model.outsideExtra;
    return {
      text:
        older !== null
          ? `${extraTickLabel(older, [], labels)} was read before the first day of this timeline of the last ${String(days)} days; the snapshot itself is shown.`
          : isExtraTickId(model.outside)
            ? `No export or pull of this scope read at ${model.outside} is kept in this browser; the snapshot itself is shown.`
            : `${model.outside} is not on this timeline of the last ${String(days)} days; the snapshot itself is shown.`,
      retry: false,
    };
  }
  const index = model.position;
  const tick = index === null ? undefined : model.ticks[index];
  if (index === null || tick === undefined)
    return {
      text:
        model.ownBeyond === 'after'
          ? "The snapshot was read after the latest day on this timeline: later than this computer's clock says it is now."
          : 'The snapshot was read before the days on this timeline.',
      retry: false,
    };
  // The view's day was asked for and is not on screen: it could not be drawn (the canvas says why too).
  const unDrawn = settled && model.states[index] !== 'current';
  const { extra } = tick;
  if (extra !== undefined) {
    const label = extraLabel(model, extra, labels);
    if (unDrawn)
      return {
        text:
          drawError === null
            ? `${label} is no longer stored in this browser; the snapshot itself is shown.`
            : `${label} could not be drawn: ${drawError}`,
        retry: false,
      };
    if (model.states[index] !== 'current') return { text: `Drawing ${label}…`, retry: false };
    // The readout is narrow: the label and what it is; where its read time came from goes in the tooltip.
    const copies = extra.copies > 1 ? ` ${String(extra.copies)} copies are stored; the latest is shown.` : '';
    const detail = `${label}: an extra tick, ${READ_TIME_SOURCE_WORDS[extra.readTimeSource]}.${copies}`;
    return {
      text: extra.future ? `${label} · extra tick, shown at the present` : `${label} · extra tick`,
      retry: false,
      detail: extra.warning === undefined ? detail : `${detail} ${extra.warning}`,
    };
  }
  const label = tickTitle(tick, labels);
  if (unDrawn && drawError !== null && model.states[index] === 'cached')
    return { text: `${label} could not be drawn: ${drawError}`, retry: false };
  switch (model.states[index]) {
    case 'current':
      return { text: index === model.own ? `${label} · the snapshot` : label, retry: false };
    case 'loading':
      // The short day ("30 Sept"): the counters, the size and the time read so far must fit.
      return progress === null
        ? { text: `Drawing ${label}…`, retry: false }
        : { text: `Reading ${tickLabel(tick, labels)}: ${progressCounters(progress)}`, retry: false };
    case 'error':
      return {
        text:
          failure === null
            ? `${label} could not be read.`
            : [`${label}: ${failure.title}`, failure.message, failure.advice ?? ''].filter(Boolean).join(' '),
        retry: true,
      };
    case 'cached':
      return { text: `Drawing ${label}…`, retry: false };
    default:
      return blocked === null
        ? { text: `Waiting to read ${label}…`, retry: false }
        : { text: blocked, retry: false };
  }
}
