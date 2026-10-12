// SPDX-License-Identifier: MIT
/**
 * The drawer's "What changed" section in the app, in jsdom with the real data and layout handlers
 * in-process, on demo organisation S stepped from 7 to 8 September with `]`: the markers and their legend rows are
 * drawn; a click on the removed bucket's ghost selects the project it lies in, whose section lists the bucket as
 * removed inside it; its jump link selects the removed bucket (its update time on the 7th, no details of the 8th);
 * the changed project shows both update times and the field that differs, and its added subscription's link
 * selects it; the next step compares with the 8th; a diagram compared with nothing has no section; axe.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { dayLabel } from '../diagram/diff/words';
import { createInProcessWorkers } from '../diagram/pipeline/inProcess';
import { viewerOffsetMinutes } from '../diagram/titleBlock';
import { expectNoAxeViolations } from '../test/axe';
import { drawn, timelineReady } from '../test/diagram';
import { currentLocation, renderApp } from '../test/renderApp';

const SCRATCH_BUCKET = '//storage.googleapis.com/demo-data-1-scratch-1';
const DEBUG_SUBSCRIPTION = '//pubsub.googleapis.com/projects/demo-svc-1/subscriptions/debug-2';
const SERVICES_PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000009';
const DATA_PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000010';

/** "since 2026-09-07", at this machine's offset (the app names days at the viewer's offset). */
function since(day: string): string {
  const readTime = `${day}T00:00:00Z`;
  return `since ${dayLabel({ readTime }, viewerOffsetMinutes(readTime))}`;
}

function drawer(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Details' });
}

async function section(): Promise<HTMLElement> {
  return waitFor(
    () => {
      const found = within(drawer()).getByTestId('what-changed');
      if (found.querySelector('[data-status]') === null) throw new Error('not answered yet');
      return found;
    },
    { timeout: 20_000 },
  );
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
}

/** Opens demo S on 7 September and steps to the 8th, which is then compared with the 7th. */
async function steppedToTheEighth(): Promise<{ container: HTMLElement; svg: SVGSVGElement }> {
  const { container } = renderApp('/diagram#snapshot=demo:S&tick=2026-09-07', {
    diagramWorkers: createInProcessWorkers,
  });
  await timelineReady(container);
  fireEvent.keyDown(document.body, { key: ']' });
  expect(currentLocation(container)).toBe('/diagram#snapshot=demo:S&tick=2026-09-08');
  const svg = await drawn(container, `.dg-ghost[data-ghost="${SCRATCH_BUCKET}"]`);
  return { container, svg };
}

describe('the drawer’s “What changed” section', () => {
  it('lists what was removed inside a project, and its link selects the removed node', async () => {
    const { container, svg } = await steppedToTheEighth();
    // The markers and their legend rows are drawn.
    expect(svg.querySelector(`.dg-added-lines [data-added="${DEBUG_SUBSCRIPTION}"]`)).not.toBeNull();
    expect(svg.querySelector(`.dg-changed[data-changed="${SERVICES_PROJECT}"]`)).not.toBeNull();
    const legend = svg.querySelector('.dg-legend')?.textContent ?? '';
    for (const kind of ['added', 'removed', 'changed'])
      expect(legend).toContain(`${kind} ${since('2026-09-07')}`);

    // A click on the ghost is a click on the project it lies in.
    await click(svg.querySelector(`.dg-ghost[data-ghost="${SCRATCH_BUCKET}"] text`) ?? svg);
    expect(currentLocation(container)).toContain(`selection=${DATA_PROJECT}`);
    let part = await section();
    expect(part.querySelector('h3')?.textContent).toBe(`What changed ${since('2026-09-07')}`);
    expect(within(part).getByText(`Not changed itself ${since('2026-09-07')}.`)).toBeDefined();
    const removed = part.querySelector('[data-inside="removed"]');
    expect(removed?.querySelector('h4')?.textContent).toBe('Removed inside (1)');
    await click(within(removed as HTMLElement).getByRole('button', { name: 'demo-data-1-scratch-1' }));
    expect(currentLocation(container)).toContain(`selection=${SCRATCH_BUCKET}`);

    // The removed bucket: as the 7th had it.
    await waitFor(() => {
      expect(within(drawer()).getByRole('heading', { level: 2 }).textContent).toBe('demo-data-1-scratch-1');
    });
    part = await section();
    expect(part.querySelector('[data-status]')?.textContent).toBe(
      `Removed ${since('2026-09-07')}: it is not in this day’s data.`,
    );
    const terms = [...part.querySelectorAll('dt')].map((term) => term.textContent);
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatch(/^2026-09-0[67]$/);
    await waitFor(() => {
      expect(within(drawer()).getByText(/^Not an asset of this day: it was removed since/)).toBeDefined();
    });
    await expectNoAxeViolations(drawer());
  }, 60_000);

  it('shows a changed project’s update times and field, and what was added inside it', async () => {
    const { container, svg } = await steppedToTheEighth();
    await click(svg.querySelector(`[data-id="${SERVICES_PROJECT}"] .dg-body`) ?? svg);
    expect(currentLocation(container)).toContain(`selection=${SERVICES_PROJECT}`);
    const part = await section();
    expect(part.querySelector('[data-status]')?.textContent).toBe(
      `Changed ${since('2026-09-07')}: its update time moved.`,
    );
    const times = [...part.querySelectorAll('dd code')].map((code) => code.textContent);
    expect(times).toHaveLength(2);
    expect(times[0]).not.toBe(times[1]);
    const field = part.querySelector('[data-fields] li');
    expect(field?.querySelector('code')?.textContent).toBe('labels.cost-center');
    expect(field?.textContent).toContain('→');
    const added = part.querySelector('[data-inside="added"]') as HTMLElement;
    await click(within(added).getByRole('button', { name: 'debug-2' }));
    expect(currentLocation(container)).toContain(`selection=${DEBUG_SUBSCRIPTION}`);
    await waitFor(() => {
      expect(within(drawer()).getByTestId('what-changed').querySelector('[data-status]')?.textContent).toBe(
        `Added ${since('2026-09-07')}.`,
      );
    });

    // One day on, the diagram is compared with the 8th, and so is the section.
    fireEvent.keyDown(document.body, { key: ']' });
    await waitFor(
      () => {
        expect(within(drawer()).getByTestId('what-changed').querySelector('h3')?.textContent).toBe(
          `What changed ${since('2026-09-08')}`,
        );
      },
      { timeout: 20_000 },
    );
    await waitFor(() => {
      expect(within(drawer()).getByTestId('what-changed').querySelector('[data-status]')?.textContent).toBe(
        `Not changed itself ${since('2026-09-08')}.`,
      );
    });
  }, 60_000);

  it('is absent while the diagram was compared with nothing (a link opened on a day)', async () => {
    const { container } = renderApp(
      `/diagram#snapshot=demo:S&tick=2026-09-08&selection=${encodeURIComponent(SERVICES_PROJECT)}`,
      { diagramWorkers: createInProcessWorkers },
    );
    await drawn(container, '.dg-nodes');
    await waitFor(() => {
      expect(within(drawer()).getByRole('heading', { level: 3, name: /^Relations/ })).toBeDefined();
    });
    expect(within(drawer()).queryByTestId('what-changed')).toBeNull();
    expect(container.querySelector('.dg-ghosts, .dg-diff')).toBeNull();
  }, 60_000);
});
