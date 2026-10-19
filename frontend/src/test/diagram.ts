// SPDX-License-Identifier: Apache-2.0
/**
 * Waits for the app's diagram in the whole-app tests (in-process workers): a drawn, interactive canvas, optionally
 * holding a given element, and the timeline bar once the snapshot's timeline is known.
 */
import { waitFor, within } from '@testing-library/react';

/** How long a first in-process draw of a demo organisation may take on a loaded machine. */
export const DRAW_TIMEOUT = 20_000;

const DRAWN = 'svg.dg-canvas[data-diagram-ready="true"]';

/** Waits until the diagram is drawn and interactive (and, given `selector`, holds an element matching it). */
export async function drawn(container: HTMLElement, selector?: string): Promise<SVGSVGElement> {
  return waitFor(
    () => {
      const svg = container.querySelector<SVGSVGElement>(DRAWN);
      if (svg === null) throw new Error('not drawn yet');
      if (selector !== undefined && svg.querySelector(selector) === null)
        throw new Error(`no ${selector} yet`);
      return svg;
    },
    { timeout: DRAW_TIMEOUT },
  );
}

/**
 * Waits until the diagram is drawn and the timeline bar knows the snapshot's days (and, given `selector`, holds an
 * element matching it); returns the bar.
 */
export async function timelineReady(container: HTMLElement, selector?: string): Promise<HTMLElement> {
  // Found once: the bar is there before anything is drawn, and a role query over a drawn diagram is slow.
  const bar = within(container).getByRole('region', { name: 'Timeline' });
  await waitFor(
    () => {
      if (container.querySelector(DRAWN) === null || bar.dataset['ready'] !== 'true')
        throw new Error('not ready');
      if (selector !== undefined && bar.querySelector(selector) === null)
        throw new Error(`no ${selector} yet`);
    },
    { timeout: DRAW_TIMEOUT },
  );
  return bar;
}
