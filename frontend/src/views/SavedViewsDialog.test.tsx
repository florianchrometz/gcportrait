// SPDX-License-Identifier: MIT
/**
 * The Saved views dialog: save the view on screen under a name (into IndexedDB, here fake-indexeddb),
 * list, apply (the hash), rename and delete; saved views survive a new app (a reload); the dialog passes axe. The
 * view is the URL hash, not the drawing, so no diagram is drawn (no workers). The Copy link button: CopyLink.test.tsx.
 */
import 'fake-indexeddb/auto';

import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { openDatabase } from '../storage/db';
import { expectNoAxeViolations } from '../test/axe';
import { useFreshIndexedDb } from '../test/indexedDb';
import { createSavedViewStore } from './savedViewStore';
import { inTopBar, renderControls } from './testing/controls';

useFreshIndexedDb();
/** IndexedDB answers asynchronously; under a loaded test run that can take more than the default second. */
const SLOW = { timeout: 10_000 } as const;

async function openDialog(): Promise<HTMLElement> {
  await userEvent.click(inTopBar().getByRole('button', { name: 'Saved views' }));
  return screen.getByRole('dialog', { name: 'Saved views' });
}

describe('saved views', () => {
  it('saves the view, applies, renames and deletes it, and keeps it for the next visit', async () => {
    const savedViews = createSavedViewStore(openDatabase());
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
      savedViews: createSavedViewStore(openDatabase()),
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
  }, 40_000);

  it('updates a view saved again under the same name', async () => {
    const app = renderControls('/diagram#snapshot=demo:S&detail=projects', { workers: false });
    const dialog = await openDialog();
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Mine{Enter}');
    await within(dialog).findByText(/^Saved “Mine”\./, {}, SLOW);
    await userEvent.type(name, '{Enter}');
    await waitFor(async () => {
      expect(await app.savedViews.list()).toHaveLength(1);
    });
    await within(dialog).findByText(/^Updated “Mine”\./, {}, SLOW);
  }, 30_000);
});
