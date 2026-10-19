// SPDX-License-Identifier: Apache-2.0
/**
 * The Filters popover on demo S: every ViewSpec filter written into the hash by its control (hide
 * switches, the region, project, folder and type pickers over the snapshot's choices, the depth slider, the
 * region-zone and identity switches), the active-filter badge, Reset, the Escape order inside a picker, the URL
 * restoring every filter, and axe with the popover open. That it is inert until a snapshot is open: App.test.tsx
 * ("app shell").
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from '../../test/axe';
import {
  drawn,
  inTopBar,
  openUndrawable,
  renderControls,
  UNKNOWN_SNAPSHOT,
} from '../../views/testing/controls';

const ALL_FILTERS =
  'snapshot=demo:S&hide=empty-projects,empty-folders,disconnected&regions=europe-west3&projects=demo-web-1' +
  '&folders=20000000004&include=run.googleapis.com/Service&exclude=compute.googleapis.com/Disk&depth=3' +
  '&show-regions=1&show-identities=0';

function filtersButton(): HTMLElement {
  return inTopBar().getByRole('button', { name: /^Filters/ });
}

async function openFilters(): Promise<HTMLElement> {
  await userEvent.click(filtersButton());
  const dialog = screen.getByRole('dialog', { name: 'Filters' });
  // The pickers wait for the snapshot's choices.
  await waitFor(() => {
    expect(
      within(dialog).getByRole('combobox', { name: 'Add to regions' }).getAttribute('aria-disabled'),
    ).toBeNull();
  });
  return dialog;
}

/** Types into a picker and chooses the result named `name`. */
async function pick(dialog: HTMLElement, field: string, text: string, name: string): Promise<void> {
  await userEvent.type(within(dialog).getByRole('combobox', { name: `Add to ${field}` }), text);
  await userEvent.click(within(dialog).getByRole('option', { name }));
}

describe('the Filters popover', () => {
  it('says why the pickers list nothing when the snapshot could not be loaded, never "Loading"', async () => {
    await openUndrawable();
    await userEvent.click(filtersButton());
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent.startsWith(`No snapshot "${UNKNOWN_SNAPSHOT}" is `)).toBe(true);
    expect(alert.textContent).toContain('Its regions, projects, folders and types cannot be listed.');
    for (const name of ['regions', 'projects', 'folders', 'include types', 'exclude types']) {
      const input = within(dialog).getByRole('combobox', { name: `Add to ${name}` });
      expect(input.getAttribute('placeholder')).toBe('Not available');
      expect(input.getAttribute('aria-disabled')).toBe('true');
    }
    await expectNoAxeViolations();
  }, 40_000);

  // This test and the next run axe over the page with demo S drawn, which takes about 6 s of the test's 11 s
  // on a machine at load 2.5 per core and three or four times that once every core is busy several times
  // over: 90 s rather than the others' 40.
  it('writes each switch and the depth into the hash, counts them on the badge, and resets', async () => {
    const app = renderControls('/diagram#snapshot=demo:S');
    await drawn(app.container);
    const dialog = await openFilters();
    await expectNoAxeViolations();

    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Empty projects' }));
    expect(app.hash()).toBe('snapshot=demo:S&hide=empty-projects');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Empty folders' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Disconnected resources' }));
    expect(app.hash()).toBe('snapshot=demo:S&hide=empty-projects,empty-folders,disconnected');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Empty folders' }));
    expect(app.hash()).toBe('snapshot=demo:S&hide=empty-projects,disconnected');

    // Shallow to deep, left to right, "No limit" at the right end.
    const depth = within(dialog).getByRole('slider', { name: 'Depth' });
    expect(depth.getAttribute('aria-valuetext')).toBe('No limit');
    expect(depth.getAttribute('aria-valuenow')).toBe(depth.getAttribute('aria-valuemax'));
    depth.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(app.hash()).toBe('snapshot=demo:S&hide=empty-projects,disconnected&depth=12');
    await userEvent.keyboard('{Home}{ArrowRight}');
    expect(app.hash()).toBe('snapshot=demo:S&hide=empty-projects,disconnected&depth=2');
    expect(depth.getAttribute('aria-valuetext')).toBe('2 levels below the root');
    await userEvent.keyboard('{End}');
    expect(app.hash()).toBe('snapshot=demo:S&hide=empty-projects,disconnected');
    expect(depth.getAttribute('aria-valuetext')).toBe('No limit');
    await userEvent.keyboard('{Home}{ArrowRight}');
    expect(app.hash()).toBe('snapshot=demo:S&hide=empty-projects,disconnected&depth=2');

    const zones = within(dialog).getByRole('radiogroup', { name: 'Region zones' });
    await userEvent.click(within(zones).getByRole('radio', { name: 'Show' }));
    const identities = within(dialog).getByRole('radiogroup', { name: 'Identities' });
    await userEvent.click(within(identities).getByRole('radio', { name: 'Hide' }));
    expect(app.hash()).toBe(
      'snapshot=demo:S&hide=empty-projects,disconnected&depth=2&show-regions=1&show-identities=0',
    );

    expect(filtersButton().textContent).toContain('5');
    expect(inTopBar().getByRole('button', { name: 'Filters (5 active)' })).toBe(filtersButton());
    expect(within(dialog).getByText('5 active').getAttribute('role')).toBe('status');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset filters' }));
    expect(app.hash()).toBe('snapshot=demo:S');
    expect(inTopBar().getByRole('button', { name: 'Filters' })).toBe(filtersButton());
  }, 90_000);

  it('picks regions, projects, folders and types from the snapshot, and removes them', async () => {
    const app = renderControls('/diagram#snapshot=demo:S');
    await drawn(app.container);
    const dialog = await openFilters();

    await pick(dialog, 'regions', 'europe', 'europe-west3');
    expect(app.hash()).toBe('snapshot=demo:S&regions=europe-west3');
    // Projects by display name, folders by name (written by number), types by product and by identifier.
    await pick(dialog, 'projects', 'retail web', 'demo-web-1');
    await pick(dialog, 'folders', 'production', 'Production');
    await pick(dialog, 'include types', 'cloud run service', 'run.googleapis.com/Service');
    await pick(dialog, 'exclude types', 'compute.googleapis.com/disk', 'compute.googleapis.com/Disk');
    expect(app.hash()).toBe(
      'snapshot=demo:S&regions=europe-west3&projects=demo-web-1&folders=20000000004' +
        '&include=run.googleapis.com/Service&exclude=compute.googleapis.com/Disk',
    );
    // A chosen value is offered no more.
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Add to regions' }), 'europe');
    expect(within(dialog).queryByRole('option', { name: 'europe-west3' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await expectNoAxeViolations();

    const chosen = within(dialog).getByRole('list', { name: 'Projects chosen' });
    expect(within(chosen).getByRole('listitem').textContent).toContain('demo-web-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove demo-web-1 from projects' }));
    expect(app.hash()).not.toContain('projects=');
    expect(document.activeElement).toBe(within(dialog).getByRole('combobox', { name: 'Add to projects' }));
  }, 90_000);

  it('lets Escape close the results, then clear the text, then close the popover', async () => {
    const app = renderControls('/diagram#snapshot=demo:S');
    await drawn(app.container);
    const dialog = await openFilters();
    const input = within(dialog).getByRole('combobox', { name: 'Add to regions' });
    await userEvent.type(input, 'eu');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await userEvent.keyboard('{Escape}');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBe(dialog);
    await userEvent.keyboard('{Escape}');
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBe(dialog);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(filtersButton());
  }, 40_000);

  it('restores every filter from the URL', async () => {
    const app = renderControls(`/diagram#${ALL_FILTERS}`);
    await drawn(app.container);
    expect(inTopBar().getByRole('button', { name: 'Filters (11 active)' })).toBeDefined();
    const dialog = await openFilters();
    for (const name of ['Empty projects', 'Empty folders', 'Disconnected resources']) {
      expect(within(dialog).getByRole<HTMLInputElement>('checkbox', { name }).checked).toBe(true);
    }
    const chips = (list: string): string[] =>
      within(within(dialog).getByRole('list', { name: `${list} chosen` }))
        .getAllByRole('listitem')
        .map((item) => item.textContent.replace('×', ''));
    expect(chips('Regions')).toEqual(['europe-west3']);
    expect(chips('Projects')).toEqual(['demo-web-1']);
    expect(chips('Folders')).toEqual(['Production']);
    expect(chips('Include types')).toEqual(['run.googleapis.com/Service']);
    expect(chips('Exclude types')).toEqual(['compute.googleapis.com/Disk']);
    expect(within(dialog).getByRole('slider', { name: 'Depth' }).getAttribute('aria-valuenow')).toBe('3');
    const zones = within(dialog).getByRole('radiogroup', { name: 'Region zones' });
    expect(within(zones).getByRole('radio', { name: 'Show' }).getAttribute('aria-checked')).toBe('true');
    const identities = within(dialog).getByRole('radiogroup', { name: 'Identities' });
    expect(within(identities).getByRole('radio', { name: 'Hide' }).getAttribute('aria-checked')).toBe('true');
    expect(app.hash()).toBe(ALL_FILTERS);
  }, 40_000);
});
