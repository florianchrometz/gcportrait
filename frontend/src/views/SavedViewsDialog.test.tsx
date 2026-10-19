// SPDX-License-Identifier: Apache-2.0
/**
 * The Saved views dialog: save the view on screen under a name (into IndexedDB, here fake-indexeddb),
 * list, apply (the hash), rename and delete; saved views survive a new app (a reload); the dialog passes axe. The
 * view is the URL hash, not the drawing, so no diagram is drawn (no workers). The Copy link button: CopyLink.test.tsx.
 */
import 'fake-indexeddb/auto';

import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from '../test/axe';
import { useFreshIndexedDb } from '../test/indexedDb';
import { WHOLE_APP_TIMEOUT } from '../test/renderApp';
import controls from '../ui/controls.module.css';
import { createSavedViewStore } from './savedViewStore';
import { inTopBar, renderControls } from './testing/controls';

// The app's database, given a test's time to open (TEST_OPEN_TIMEOUT_MS): the whole app rendered under StrictMode
// on a loaded machine can hold the opening back past the app's own timeout, which would keep the views in memory.
const { database } = useFreshIndexedDb();
/** IndexedDB answers asynchronously; under a loaded test run that can take more than the default second. */
const SLOW = { timeout: 10_000 } as const;

async function openDialog(): Promise<HTMLElement> {
  await userEvent.click(inTopBar().getByRole('button', { name: 'Saved views' }));
  return screen.getByRole('dialog', { name: 'Saved views' });
}

describe('saved views', () => {
  it(
    'saves the view, applies, renames and deletes it, and keeps it for the next visit',
    WHOLE_APP_TIMEOUT,
    async () => {
      const savedViews = createSavedViewStore(database());
      const app = renderControls('/diagram#snapshot=demo:S&lens=networking&detail=all', {
        savedViews,
        workers: false,
      });
      let dialog = await openDialog();
      const name = within(dialog).getByRole('textbox', { name: 'Name' });
      // Focus starts in the name field, with a name suggested from the view.
      expect(document.activeElement).toBe(name);
      expect((name as HTMLInputElement).value).toBe('Networking lens · all detail');
      await userEvent.clear(name);
      await userEvent.type(name, 'Prod networks{Enter}');
      await within(dialog).findByText('Saved “Prod networks”.', {}, SLOW);
      const row = await within(dialog).findByRole('listitem', {}, SLOW);
      expect(row.textContent).toContain('Demo organisation S (small) · Networking lens · all detail');
      await expectNoAxeViolations();

      // Rename: Enter keeps the new name, focus goes back to the row's Rename button.
      await userEvent.click(within(dialog).getByRole('button', { name: 'Rename Prod networks' }));
      const field = within(dialog).getByRole('textbox', { name: 'New name for Prod networks' });
      expect(document.activeElement).toBe(field);
      await userEvent.clear(field);
      await userEvent.type(field, 'Networks{Enter}');
      await within(dialog).findByText('Renamed “Prod networks” to “Networks”.', {}, SLOW);
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Rename Networks' }));
      // Escape while renaming ends the renaming, not the dialog.
      await userEvent.click(within(dialog).getByRole('button', { name: 'Rename Networks' }));
      await userEvent.keyboard('{Escape}');
      expect(screen.getByRole('dialog', { name: 'Saved views' })).toBe(dialog);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

      // Elsewhere, then apply: the hash is the saved one.
      await userEvent.click(inTopBar().getByRole('link', { name: 'Settings' }));
      expect(app.location()).toBe('/settings');
      dialog = await openDialog();
      await userEvent.click(await within(dialog).findByRole('button', { name: 'Apply Networks' }, SLOW));
      expect(app.location()).toBe('/diagram#snapshot=demo:S&lens=networking&detail=all');
      expect(screen.queryByRole('dialog')).toBeNull();
      app.unmount();

      // A new app over the same database (a reload) lists it; Delete removes it.
      const later = renderControls('/settings', {
        savedViews: createSavedViewStore(database()),
        workers: false,
      });
      dialog = await openDialog();
      await userEvent.click(await within(dialog).findByRole('button', { name: 'Delete Networks' }, SLOW));
      await within(dialog).findByText('No saved views yet.', {}, SLOW);
      expect(within(dialog).getByRole('status').textContent).toBe('Deleted “Networks”.');
      // Away from a diagram there is nothing to save.
      expect(
        within(dialog).getByRole('button', { name: 'Save current view' }).getAttribute('aria-disabled'),
      ).toBe('true');
      later.unmount();
    },
  );

  it(
    'deletes a view at once with the destructive control, says which, and moves focus on',
    WHOLE_APP_TIMEOUT,
    async () => {
      // A saved view is a name over a link, saved again in a moment from the same view: Delete asks nothing.
      const app = renderControls('/diagram#snapshot=demo:S&detail=projects', { workers: false });
      const dialog = await openDialog();
      const name = within(dialog).getByRole('textbox', { name: 'Name' });
      for (const view of ['First', 'Second', 'Third']) {
        await userEvent.clear(name);
        await userEvent.type(name, `${view}{Enter}`);
        await within(dialog).findByText(new RegExp(`^Saved “${view}”\\.`), {}, SLOW);
      }
      await waitFor(() => {
        expect(within(dialog).getAllByRole('listitem')).toHaveLength(3);
      }, SLOW);

      // Every Delete wears the destructive variant on the control (ui/controls.module.css); the rest do not.
      for (const view of ['First', 'Second', 'Third']) {
        const remove = within(dialog).getByRole('button', { name: `Delete ${view}` });
        expect(remove.classList).toContain(controls.control);
        expect(remove.classList).toContain(controls.danger);
        for (const other of [`Apply ${view}`, `Rename ${view}`]) {
          expect(within(dialog).getByRole('button', { name: other }).classList).not.toContain(
            controls.danger,
          );
        }
      }
      expect(within(dialog).getByRole('button', { name: 'Save current view' }).classList).not.toContain(
        controls.danger,
      );

      // Newest first: Third, Second, First. Deleting the middle one asks nothing, says so in the status line
      // and focuses the row that takes its place.
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete Second' }));
      await waitFor(() => {
        expect(within(dialog).getByRole('status').textContent).toBe('Deleted “Second”.');
      }, SLOW);
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(screen.getAllByRole('dialog')).toEqual([dialog]);
      expect(within(dialog).queryByRole('button', { name: 'Delete Second' })).toBeNull();
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Apply First' }));
      expect(await app.savedViews.list()).toHaveLength(2);

      // The last row: focus goes to the row above it.
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete First' }));
      await waitFor(() => {
        expect(within(dialog).getByRole('status').textContent).toBe('Deleted “First”.');
      }, SLOW);
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Apply Third' }));

      // The only row: focus goes to the name field, and the list says it is empty.
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete Third' }));
      await within(dialog).findByText('No saved views yet.', {}, SLOW);
      expect(within(dialog).getByRole('status').textContent).toBe('Deleted “Third”.');
      expect(document.activeElement).toBe(name);
      expect(await app.savedViews.list()).toHaveLength(0);
    },
  );

  it('updates a view saved again under the same name', WHOLE_APP_TIMEOUT, async () => {
    const app = renderControls('/diagram#snapshot=demo:S&detail=projects', { workers: false });
    const dialog = await openDialog();
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Mine{Enter}');
    await within(dialog).findByText(/^Saved “Mine”\./, {}, SLOW);
    await userEvent.type(name, '{Enter}');
    await waitFor(async () => {
      expect(await app.savedViews.list()).toHaveLength(1);
    }, SLOW);
    await within(dialog).findByText(/^Updated “Mine”\./, {}, SLOW);
  });

  it(
    'shows a status message and keeps the edit field open when renaming to an existing view name',
    WHOLE_APP_TIMEOUT,
    async () => {
      renderControls('/diagram#snapshot=demo:S&detail=projects', { workers: false });
      const dialog = await openDialog();
      const name = within(dialog).getByRole('textbox', { name: 'Name' });

      // Save two views: First and Second
      await userEvent.clear(name);
      await userEvent.type(name, 'First{Enter}');
      await within(dialog).findByText(/^Saved “First”\./, {}, SLOW);

      await userEvent.clear(name);
      await userEvent.type(name, 'Second{Enter}');
      await within(dialog).findByText(/^Saved “Second”\./, {}, SLOW);

      // Try renaming First to Second (duplicate)
      await userEvent.click(within(dialog).getByRole('button', { name: 'Rename First' }));
      const field = within(dialog).getByRole('textbox', { name: 'New name for First' });
      await userEvent.clear(field);
      await userEvent.type(field, 'Second{Enter}');

      // An inline validation message appears on the status line
      await within(dialog).findByText('A saved view named “Second” already exists.', {}, SLOW);
      // The edit field is still present and focused
      expect(document.activeElement).toBe(field);

      // Renaming to an empty name gives a prompt message and stays focused
      await userEvent.clear(field);
      await userEvent.type(field, '{Enter}');
      await within(dialog).findByText('Give the view a name first.', {}, SLOW);
      expect(document.activeElement).toBe(field);

      // Correcting the name to an unused name succeeds
      await userEvent.type(field, 'Unique name{Enter}');
      await within(dialog).findByText('Renamed “First” to “Unique name”.', {}, SLOW);
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Rename Unique name' }));

      await expectNoAxeViolations();
    },
  );
});
