// SPDX-License-Identifier: MIT
/**
 * The timeline bar below the canvas (docs/timeline.md): the open snapshot's 35 daily ticks, oldest left, each
 * with a marker for its state (on screen, loading, ready, failed, not read yet: shapes, not colour alone), a slider
 * (ui/Slider) over them, the previous and next day (also `[` and `]`, keyboard/TimelineKeys.tsx), playback through
 * the days that can be shown without reading Google Cloud, its speed, and a readout of the view's day: its date in
 * the viewer's local time, the read's progress and size while it loads, Google's message and "Try again" when it
 * failed, or why it cannot be read. The scope's stored exports and manual pulls are extra ticks among the days
 * (timeline/extraTicks.ts): diamonds instead of dots (hollow when their read time is estimated), labelled
 * ("export 2026-10-05 14:30") in their tooltip, the slider's value text and the readout, selectable like days, and
 * played through only once "Play extras" is pressed.
 *
 * Narrower than a desktop the same parts wrap (`PART_ORDER`): a tablet's readout goes below the slider, a phone's
 * slider spans the width with the readout and then the buttons below it. On a phone turned sideways, while the details
 * sheet is open, the bar keeps one line, the slider and the buttons after it, its readout and playback options hidden
 * until the sheet closes, so the canvas holds the sheet's header (TimelineBar.module.css, `CONTAINER.shortWorkspace`).
 *
 * The view's day is its `tick` in the URL hash (the snapshot's own day is no tick), written through the store's
 * actions only: the slider in place (continuous), the buttons as history entries. The timeline controller
 * (timeline/controller.ts) runs while the bar is mounted.
 */
import { useMemo, type CSSProperties, type ReactElement } from 'react';

import { cx } from '../../classNames';
import { selectSceneKey, useAppState, useAppStore, useDiagramActions } from '../../state';
import { dayAt, timelineModel, withTick, type TimelineModel } from '../../timeline/model';
import { PLAYBACK_INTERVALS } from '../../timeline/playback';
import { TIMELINE_DAYS, tickLabel } from '../../timeline/ticks';
import { usePlayback } from '../../timeline/usePlayback';
import { useTimelineController } from '../../timeline/useTimelineController';
import { markerTitle, readout, valueText } from '../../timeline/words';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { useScreen, type Screen } from '../../ui/screen';
import { Slider } from '../../ui/Slider';
import styles from './TimelineBar.module.css';

/**
 * The order of the bar's parts, which is its tab order: on a desktop one row (the title, the step and play buttons,
 * the slider between the first and the last day, the readout, the playback options); on a tablet the same row with the
 * readout on a line of its own below it; on a phone the slider across the whole width first, the readout under it,
 * and the buttons and options last (the title left out: the slider's name says it).
 */
const PART_ORDER: Readonly<
  Record<Screen, readonly ('title' | 'buttons' | 'track' | 'readout' | 'options')[]>
> = {
  desktop: ['title', 'buttons', 'track', 'readout', 'options'],
  tablet: ['title', 'buttons', 'track', 'options', 'readout'],
  phone: ['track', 'readout', 'buttons', 'options'],
};

const SPEEDS = PLAYBACK_INTERVALS.map((interval) => ({
  value: String(interval),
  label: `${String(interval / 1000)} s`,
}));

/** A small drawn glyph for the step and play buttons (decorative: the button carries the name). */
function Glyph({ kind }: { readonly kind: 'previous' | 'next' | 'play' | 'pause' }): ReactElement {
  const paths = {
    previous: 'M10 3 L4 8 L10 13 Z M12 3 H13.5 V13 H12 Z',
    next: 'M6 3 L12 8 L6 13 Z M2.5 3 H4 V13 H2.5 Z',
    play: 'M5 3 L13 8 L5 13 Z',
    pause: 'M4 3 H7 V13 H4 Z M9 3 H12 V13 H9 Z',
  } as const;
  return (
    <svg className={styles.glyph} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={paths[kind]} />
    </svg>
  );
}

function Markers({ model }: { readonly model: TimelineModel }): ReactElement {
  const last = Math.max(1, model.ticks.length - 1);
  return (
    <span className={styles.markers} aria-hidden="true">
      {model.ticks.map((tick, index) => (
        <span
          key={tick.day}
          className={styles.marker}
          data-state={model.states[index]}
          data-day={tick.day}
          data-kind={tick.extra === undefined ? 'day' : 'extra'}
          data-estimated={tick.extra?.readTimeSource === 'estimated' ? 'true' : undefined}
          title={markerTitle(model, index)}
          style={{ left: `${String((index / last) * 100)}%` } satisfies CSSProperties}
        />
      ))}
    </span>
  );
}

export function TimelineBar(): ReactElement {
  const retry = useTimelineController();
  const actions = useDiagramActions();
  const spec = useAppState((state) => state.view.spec);
  const timeline = useAppState((state) => state.timeline);
  const onScreen = useAppState((state) => state.pipeline.result?.answer.source ?? null);
  const playExtras = useAppState((state) => state.timeline.playExtras);
  const store = useAppStore();
  const pending = useAppState((state) => state.pipeline.pending !== null);
  // The pipeline has answered the view as it is now, and why it could not draw it, for the readout.
  const settled = useAppState(
    (state) =>
      state.pipeline.pending === null &&
      state.pipeline.key === selectSceneKey(state) &&
      (state.pipeline.error !== null || state.pipeline.result?.key === state.pipeline.key),
  );
  const drawError = useAppState((state) =>
    state.pipeline.pending === null ? (state.pipeline.error?.message ?? null) : null,
  );
  const failed = useAppState((state) => state.snapshot.status === 'error');
  const model = useMemo(
    () => timelineModel({ spec, timeline, onScreen, pending }),
    [spec, timeline, onScreen, pending],
  );
  const playback = usePlayback(model);
  const screen = useScreen();

  const position = model === null ? null : (model.position ?? model.own);
  const max = (model?.ticks.length ?? TIMELINE_DAYS) - 1;
  // A snapshot read before the timeline's first day sits at its start, one read after its last at its end.
  const value = position ?? (model?.ownBeyond === 'before' ? 0 : max);
  const first = model?.ticks[0];
  const last = model?.ticks[model.ticks.length - 1];
  const notReady =
    spec.snapshot === ''
      ? 'Open a snapshot to use the timeline.'
      : model !== null
        ? null
        : failed
          ? 'The snapshot could not be opened, so it has no timeline.'
          : 'Loading the timeline…';

  const positionDay = model === null || position === null ? null : (model.ticks[position]?.day ?? null);
  const said =
    model === null
      ? { text: notReady ?? '', retry: false }
      : readout({
          model,
          progress:
            timeline.progress !== null && timeline.progress.day === positionDay
              ? timeline.progress.progress
              : null,
          failure: positionDay === null ? null : (timeline.failures[positionDay] ?? null),
          blocked: timeline.blocked,
          settled,
          drawError,
        });

  const atStart = model === null || position === 0;
  const atEnd = model === null || position === max;
  const moveTo = (index: number): void => {
    if (model === null) return;
    const day = dayAt(model, index);
    if (day === undefined) return;
    // The slider moves continuously: in place (history `replace`), not one history entry per day.
    actions.setView((current) => withTick(current, day), { history: 'replace' });
  };

  // The bar's parts, in the order of the layout (see above): keyed, so a part moves with its state when the order
  // changes.
  const parts: Readonly<Record<'title' | 'buttons' | 'track' | 'readout' | 'options', ReactElement>> = {
    // The bar's visible name; the slider keeps its own (visually hidden here), so it reads as a date range.
    title: (
      <span key="title" className={styles.title} aria-hidden="true">
        Timeline
      </span>
    ),
    buttons: (
      <div key="buttons" className={styles.buttons}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Previous day"
          title="Previous day ( [ )"
          aria-keyshortcuts="["
          aria-disabled={atStart ? 'true' : undefined}
          onClick={() => {
            if (!atStart) actions.stepTick(-1);
          }}
        >
          <Glyph kind="previous" />
        </button>
        <button
          ref={playback.buttonRef}
          type="button"
          className={styles.iconButton}
          aria-label={playback.playing ? 'Pause playback' : 'Play through the days'}
          title={playback.playing ? 'Pause playback' : (playback.unavailable ?? 'Play through the days')}
          aria-pressed={playback.playing}
          aria-disabled={
            !playback.playing && (model === null || playback.unavailable !== null) ? 'true' : undefined
          }
          onClick={playback.toggle}
        >
          <Glyph kind={playback.playing ? 'pause' : 'play'} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Next day"
          title="Next day ( ] )"
          aria-keyshortcuts="]"
          aria-disabled={atEnd ? 'true' : undefined}
          onClick={() => {
            if (!atEnd) actions.stepTick(1);
          }}
        >
          <Glyph kind="next" />
        </button>
      </div>
    ),
    track: (
      <div key="track" className={styles.track}>
        <span className={styles.edge} aria-hidden="true">
          {first === undefined ? '' : tickLabel(first)}
        </span>
        <Slider
          label="Timeline"
          className={cx(styles.slider)}
          min={0}
          max={max}
          value={value}
          onChange={moveTo}
          valueText={(index) => (model === null ? (notReady ?? '') : valueText(model, index))}
          disabled={notReady ?? false}
          marks={model === null ? null : <Markers model={model} />}
        />
        <span className={styles.edge} aria-hidden="true">
          {last === undefined ? '' : tickLabel(last)}
        </span>
      </div>
    ),
    readout: (
      <div key="readout" className={styles.readoutRow}>
        <p
          className={styles.readout}
          role="status"
          aria-live={playback.playing ? 'off' : 'polite'}
          title={said.detail ?? said.text}
          data-testid="timeline-readout"
        >
          {said.text}
        </p>
        {said.retry && positionDay !== null ? (
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              retry(positionDay);
            }}
          >
            Try again
          </button>
        ) : null}
      </div>
    ),
    options: (
      <div key="options" className={styles.options}>
        {model?.ticks.some((tick) => tick.extra !== undefined) !== true ? null : (
          <button
            type="button"
            className={styles.textButton}
            aria-pressed={playExtras}
            title={
              playExtras
                ? 'Playback goes through the extra ticks (exports and pulls) too'
                : 'Playback skips the extra ticks (exports and pulls); press to include them'
            }
            onClick={() => {
              store.updateTimeline((current) => ({ ...current, playExtras: !current.playExtras }));
            }}
          >
            Play extras
          </button>
        )}
        <SegmentedControl
          label="Speed"
          options={SPEEDS}
          value={String(timeline.interval)}
          onChange={(next) => {
            const chosen = PLAYBACK_INTERVALS.find((interval) => String(interval) === next);
            if (chosen !== undefined) playback.setInterval(chosen);
          }}
        />
      </div>
    ),
  };

  return (
    <section
      className={cx(styles.timeline, playback.playing && styles.playing)}
      aria-label="Timeline"
      data-ready={model === null ? 'false' : 'true'}
    >
      {PART_ORDER[screen].map((part) => parts[part])}
    </section>
  );
}
