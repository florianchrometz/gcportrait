// SPDX-License-Identifier: MIT
/**
 * The disclosure bar on the diagram page, end to end in jsdom with the real data and layout handlers in-process
 * (demo M at the 1280 × 800 fallback canvas: the folder level): "N of M shown" follows the drawing, a chip opens
 * by a click, "Expand all" opens the next level and "Collapse all" goes back to the default, all through the URL
 * hash; an unavailable action stays focusable and says why; the 48-flip cap is told in a live region until
 * dismissed (on demo S at the folder level: one chip is all it needs; flips.test.ts counts the cap itself); axe
 * finds nothing. While the details drawer lies over the canvas (a phone's sheet, a tablet's panel) the bar is marked
 * as a panel over it, which a camera jump and a fit keep the drawing clear of; on a desktop, or with the drawer closed,
 * it is not.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from '../../test/axe';
import { drawn } from '../../test/diagram';
import { currentLocation, renderApp } from '../../test/renderApp';
import { installViewport } from '../../test/viewport';
import { createInProcessWorkers } from '../pipeline/inProcess';
import { shownText } from './DisclosureBar';

async function shows(text: string): Promise<void> {
  await waitFor(
    () => {
      expect(screen.getByRole('group', { name: 'Expand and collapse' }).textContent).toContain(text);
    },
    { timeout: 20_000 },
  );
}

const bar = (): HTMLElement => screen.getByRole('group', { name: 'Expand and collapse' });

describe('the disclosure bar', () => {
  it('counts what is drawn, opens a chip, expands all and collapses all through the hash', async () => {
    const { container } = renderApp('/diagram#snapshot=demo:M', { diagramWorkers: createInProcessWorkers });
    let svg = await drawn(container);
    await shows('38 of 369 shown');
    const expand = within(bar()).getByRole('button', { name: 'Expand all' });
    const collapse = within(bar()).getByRole('button', { name: 'Collapse all' });
    expect(expand.getAttribute('aria-disabled')).toBeNull();
    // Nothing opened by hand at the automatic level: inert but focusable, and its tooltip says why.
    expect(collapse.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(collapse.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Nothing opened by hand at the Folders level',
    );
    await expectNoAxeViolations(container);

    const chip = svg.querySelector<SVGGElement>('.dg-chip');
    const id = chip?.getAttribute('data-id') ?? '';
    await act(async () => {
      fireEvent.click(chip ?? svg);
      await Promise.resolve();
    });
    expect(currentLocation(container)).toMatch(/flips=\w+/);
    await waitFor(
      () => {
        expect(container.querySelector(`.dg-zone[data-id="${id}"]`)).not.toBeNull();
      },
      { timeout: 20_000 },
    );
    expect(bar().textContent).not.toContain('38 of 369 shown');
    expect(collapse.getAttribute('aria-disabled')).toBeNull();

    await act(async () => {
      fireEvent.click(expand);
      await Promise.resolve();
    });
    expect(currentLocation(container)).toContain('detail=projects');
    await waitFor(
      () => {
        expect(bar().textContent).toMatch(/^\d{3} of 369 shown/);
      },
      { timeout: 20_000 },
    );

    await act(async () => {
      fireEvent.click(collapse);
      await Promise.resolve();
    });
    expect(currentLocation(container)).toBe('/diagram#snapshot=demo:M');
    await shows('38 of 369 shown');
    svg = await drawn(container);
    expect(svg.querySelector(`.dg-chip[data-id="${id}"]`)).not.toBeNull();
  }, 60_000);

  it('tells, until dismissed, that a flip over the cap sent the oldest back to its default', async () => {
    const flips = Array.from({ length: 48 }, (_, index) => `t${String(index)}`).join(',');
    const { container } = renderApp(`/diagram#snapshot=demo:S&detail=folders&flips=${flips}`, {
      diagramWorkers: createInProcessWorkers,
    });
    const svg = await drawn(container, '.dg-chip');
    await shows(' shown');
    const chip = svg.querySelector<SVGGElement>('.dg-chip');
    await act(async () => {
      fireEvent.click(chip ?? svg);
      await Promise.resolve();
    });
    const notice = await screen.findByText(
      'At most 48 zones keep an expand or collapse made by hand: the oldest is back to the detail level’s default.',
    );
    expect(notice.closest('[role="status"]')).not.toBeNull();
    expect(currentLocation(container)).not.toContain('t0,');
    await expectNoAxeViolations(container);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/At most 48 zones/)).toBeNull();
  }, 60_000);

  it('is a panel over the canvas while the details drawer lies over it, on a phone and a tablet only', async () => {
    const project = '//cloudresourcemanager.googleapis.com/projects/10000000002';
    const marked = (): boolean => bar().closest('[data-canvas-overlay]') !== null;
    for (const [width, over] of [
      [375, true],
      [820, true],
      [1280, false],
    ] as const) {
      const viewport = installViewport(width);
      try {
        const { container, unmount } = renderApp(
          `/diagram#snapshot=demo:S&detail=folders&selection=${project}`,
          { diagramWorkers: createInProcessWorkers },
        );
        await drawn(container);
        await shows(' shown');
        const details = screen.getByRole('complementary', { name: 'Details' });
        expect(details.hidden).toBe(false);
        expect(marked(), `${String(width)} px, the drawer open`).toBe(over);
        fireEvent.click(within(details).getByRole('button', { name: 'Close' }));
        expect(details.hidden).toBe(true);
        expect(marked(), `${String(width)} px, the drawer closed`).toBe(false);
        unmount();
      } finally {
        viewport.uninstall();
      }
    }
  }, 60_000);

  it('marks the bar for the directed moves at rest, and as a panel over the canvas while it is one', async () => {
    const viewport = installViewport(1280);
    try {
      const { container } = renderApp('/diagram#snapshot=demo:S', {
        diagramWorkers: createInProcessWorkers,
      });
      await drawn(container);
      await shows(' shown');
      // At rest the bar floats over the canvas's foot: a jump and the keyboard focus keep clear of it, a fit does not.
      const panel = bar().parentElement;
      if (panel === null) throw new Error('no bar');
      expect(panel.hasAttribute('data-canvas-jump')).toBe(true);
      expect(panel.hasAttribute('data-canvas-overlay')).toBe(false);
      expect(panel.hasAttribute('data-canvas-resize')).toBe(true);
    } finally {
      viewport.uninstall();
    }
  }, 60_000);

  it('writes the count with thousands separators', () => {
    expect(shownText(164, 2497)).toBe('164 of 2,497 shown');
  });

  it.each(['View', 'More'] as const)(
    'counts the bar in the camera room while a tablet’s %s sheet is open',
    async (name) => {
      const viewport = installViewport(820);
      try {
        const { container } = renderApp('/diagram#snapshot=demo:S', {
          diagramWorkers: createInProcessWorkers,
        });
        await drawn(container);
        await shows(' shown');
        expect(bar().closest('[data-canvas-overlay]')).toBeNull();
        const button = within(screen.getByRole('banner')).getByRole('button', { name });
        fireEvent.click(button);
        expect(bar().closest('[data-canvas-overlay]')).not.toBeNull();
        fireEvent.click(button);
        expect(bar().closest('[data-canvas-overlay]')).toBeNull();
      } finally {
        viewport.uninstall();
      }
    },
    60_000,
  );
});
