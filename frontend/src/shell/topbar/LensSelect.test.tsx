// SPDX-License-Identifier: MIT
/**
 * The Lens picker: the catalog's eleven lenses with title and description; a switch writes the hash,
 * applying the new lens's default detail level while the level follows the lens, and keeping a level the person
 * chose; the hash round-trips (a new app from the written URL shows the same lens and level).
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from '../../test/axe';
import { DRAWING_APP_TIMEOUT } from '../../test/renderApp';
import { drawn, inTopBar, renderControls } from '../../views/testing/controls';

async function openLenses(): Promise<HTMLElement> {
  const lens = inTopBar().getByRole('combobox', { name: 'Lens' });
  // The catalog's titles and descriptions have arrived from the data worker (the closed list is hidden, so it is
  // found through the combobox's aria-controls rather than by its name).
  await waitFor(() => {
    const list = document.getElementById(lens.getAttribute('aria-controls') ?? '');
    expect(list?.querySelector('[role="option"][aria-describedby]')).not.toBeNull();
  });
  await userEvent.click(lens);
  return screen.getByRole('listbox', { name: 'Lens' });
}

describe('the Lens picker', () => {
  it(
    'lists the eleven lenses with their titles and descriptions, and passes axe open',
    DRAWING_APP_TIMEOUT,
    async () => {
      const app = renderControls('/diagram#snapshot=demo:S');
      await drawn(app.container);
      const list = await openLenses();
      const options = within(list).getAllByRole('option');
      expect(options).toHaveLength(11);
      const networking = within(list).getByRole('option', { name: 'Networking' });
      expect(networking.getAttribute('aria-selected')).toBe('false');
      const description = document.getElementById(networking.getAttribute('aria-describedby') ?? '');
      expect(description?.textContent).toMatch(/^VPC networks, subnets, routing/);
      await expectNoAxeViolations();
    },
  );

  it(
    'opens a lens at auto while the level follows the lens; a view of at most 100 rects opens whole',
    DRAWING_APP_TIMEOUT,
    async () => {
      const app = renderControls('/diagram#snapshot=demo:S');
      await drawn(app.container);
      await userEvent.click(within(await openLenses()).getByRole('option', { name: 'Networking' }));
      expect(app.location()).toBe('/diagram#snapshot=demo:S&lens=networking');
      const detail = inTopBar().getByRole('radiogroup', { name: 'Detail' });
      // Networking opens at most at networks, but all of S's 40 rects fit in 100, so auto opens it whole.
      await waitFor(() => {
        expect(within(detail).getByRole('radio', { name: 'Auto · all' }).getAttribute('aria-checked')).toBe(
          'true',
        );
      });
      // Back to the overview: auto again, and all of S fits.
      await userEvent.click(within(await openLenses()).getByRole('option', { name: 'Overview' }));
      expect(app.location()).toBe('/diagram#snapshot=demo:S');
      await waitFor(() => {
        expect(within(detail).getByRole('radio', { name: 'Auto · all' }).getAttribute('aria-checked')).toBe(
          'true',
        );
      });
    },
  );

  it('keeps a level the person chose, and the URL restores lens and level', DRAWING_APP_TIMEOUT, async () => {
    const app = renderControls('/diagram#snapshot=demo:S&detail=projects');
    await drawn(app.container);
    await userEvent.click(within(await openLenses()).getByRole('option', { name: 'Load balancing' }));
    const url = app.location();
    expect(url).toBe('/diagram#snapshot=demo:S&lens=load-balancing&detail=projects');
    app.unmount();

    const reopened = renderControls(url);
    expect(inTopBar().getByRole('combobox', { name: 'Lens' }).textContent).toContain('Load balancing');
    const detail = inTopBar().getByRole('radiogroup', { name: 'Detail' });
    expect(within(detail).getByRole('radio', { name: 'Projects' }).getAttribute('aria-checked')).toBe('true');
    reopened.unmount();
  });
});
