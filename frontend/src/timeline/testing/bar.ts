// SPDX-License-Identifier: MIT
/**
 * The timeline bar (pages/diagram/TimelineBar.tsx) in the app, with the data and layout handlers in-process: the page
 * opened on a hash once the diagram is drawn and the bar knows its days, and the day the bar shows on screen.
 */
import { waitFor } from '@testing-library/react';
import { expect } from 'vitest';

import { createInProcessWorkers } from '../../diagram/pipeline/inProcess';
import type { DiagramWorkers } from '../../diagram/pipeline/workers';
import type { SnapshotLibrary } from '../../snapshots/library';
import { DRAW_TIMEOUT, timelineReady } from '../../test/diagram';
import { renderApp, type AppRender } from '../../test/renderApp';

/** Opens `/diagram#<hash>` and waits for the bar (and, given `selector`, an element of it matching that). */
export async function openTimeline(
  hash: string,
  options: {
    readonly workers?: () => DiagramWorkers;
    readonly snapshots?: SnapshotLibrary;
    readonly selector?: string;
  } = {},
): Promise<AppRender & { readonly bar: HTMLElement }> {
  const view = renderApp(`/diagram#${hash}`, {
    diagramWorkers: options.workers ?? (() => createInProcessWorkers()),
    ...(options.snapshots === undefined ? {} : { snapshots: options.snapshots }),
  });
  const bar = await timelineReady(view.container, options.selector);
  return { ...view, bar };
}

/** The day of the marker that shows the day on screen. */
export function currentDay(bar: HTMLElement): string | undefined {
  return bar.querySelector<HTMLElement>('[data-state="current"]')?.dataset['day'];
}

/** Waits until the bar shows `day` on screen (drawn, not only asked for). */
export async function shownDay(bar: HTMLElement, day: string): Promise<void> {
  await waitFor(
    () => {
      expect(currentDay(bar)).toBe(day);
    },
    { timeout: DRAW_TIMEOUT },
  );
}
