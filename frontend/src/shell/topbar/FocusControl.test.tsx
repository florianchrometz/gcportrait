// SPDX-License-Identifier: Apache-2.0
/**
 * The Focus control on demo S: the Focus button and its popover, with the kind select and pickers
 * over the snapshot's projects (id and display name), Shared VPC hosts and perimeters; standalone projects
 * without a parameter; clearing; a kind left unchosen; a refused focus explained; the URL restoring the focus;
 * axe. That it is inert until a snapshot is open: App.test.tsx ("app shell").
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from '../../test/axe';
import { DRAWING_APP_TIMEOUT, WHOLE_APP_TIMEOUT } from '../../test/renderApp';
import {
  drawn,
  inTopBar,
  openUndrawable,
  renderControls,
  UNKNOWN_SNAPSHOT,
} from '../../views/testing/controls';
import { focusSummary } from './FocusControl';

function focusButton(): HTMLElement {
  return inTopBar().getByRole('button', { name: /^Focus/ });
}

function popover(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Focus' });
}

/** Opens the popover (unless open) and chooses a kind in its select. */
async function chooseKind(name: string): Promise<void> {
  if (screen.queryByRole('dialog', { name: 'Focus' }) === null) await userEvent.click(focusButton());
  await userEvent.click(within(popover()).getByRole('combobox', { name: 'Show' }));
  await userEvent.click(within(popover()).getByRole('option', { name }));
}

/** The popover's picker, once the snapshot's choices have arrived. */
async function picker(name: string): Promise<HTMLElement> {
  const input = within(popover()).getByRole('combobox', { name: `${name} to focus on` });
  await waitFor(() => {
    expect(input.getAttribute('aria-disabled')).toBeNull();
  });
  return input;
}

describe('the Focus control', () => {
  it('says what the focus is', () => {
    const label = (_kind: string, value: string): string => `<${value}>`;
    expect(focusSummary(undefined, null, label)).toBeNull();
    expect(focusSummary('standalone-projects', null, label)).toBe('standalone projects');
    expect(focusSummary('project', 'demo-web-1', label)).toBe('<demo-web-1>');
    expect(focusSummary('shared-vpc', null, label)).toBe('no host project chosen');
  });

  it(
    'focuses on a project picked by id or display name, and clears the focus',
    DRAWING_APP_TIMEOUT,
    async () => {
      const app = renderControls('/diagram#snapshot=demo:S');
      await drawn(app.container);
      await userEvent.click(focusButton());
      // The popover opens on its kind select.
      expect(document.activeElement).toBe(within(popover()).getByRole('combobox', { name: 'Show' }));
      await chooseKind('Single project');
      // The picker takes focus; nothing is in the hash until a project is chosen.
      const input = await picker('Project');
      expect(document.activeElement).toBe(input);
      expect(app.location()).toBe('/diagram#snapshot=demo:S');
      await expectNoAxeViolations();

      // The display name finds it too; each result shows the id and, below, the name and folders.
      await userEvent.type(input, 'retail web');
      const option = screen.getByRole('option', { name: 'demo-web-1' });
      expect(document.getElementById(option.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
        'Retail web (prod) · Workloads › Retail › Production',
      );
      await userEvent.click(option);
      expect(app.location()).toBe('/diagram#snapshot=demo:S&focus=project&focus.project=demo-web-1');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(focusButton().textContent).toContain('Focus: demo-web-1');
      expect(document.activeElement).toBe(focusButton());
      await drawn(app.container);

      await userEvent.click(focusButton());
      expect(popover().textContent).toContain('Focused on demo-web-1');
      await userEvent.click(within(popover()).getByRole('button', { name: 'Clear focus' }));
      expect(app.location()).toBe('/diagram#snapshot=demo:S');
      expect(document.activeElement).toBe(focusButton());
      expect(focusButton().textContent).toBe('Focus▾');
    },
  );

  it(
    'picks a Shared VPC host and a perimeter, applies standalone projects at once, and None clears',
    DRAWING_APP_TIMEOUT,
    async () => {
      const app = renderControls('/diagram#snapshot=demo:S');
      await drawn(app.container);
      await chooseKind('Shared VPC');
      await userEvent.type(await picker('Host project'), '{ArrowDown}');
      // Demo S has one Shared VPC host.
      expect(screen.getAllByRole('option')).toHaveLength(1);
      expect(screen.getByRole('option', { name: 'demo-net-1' }).getAttribute('aria-selected')).toBe('true');
      await userEvent.keyboard('{Enter}');
      expect(app.hash()).toBe('snapshot=demo:S&focus=shared-vpc&focus.host=demo-net-1');

      await chooseKind('Perimeter');
      await userEvent.type(await picker('Perimeter'), 'data_perimeter{ArrowDown}{Enter}');
      expect(app.hash()).toBe(
        'snapshot=demo:S&focus=perimeter&focus.perimeter=' +
          '//accesscontextmanager.googleapis.com/accessPolicies/40000000001/servicePerimeters/data_perimeter',
      );
      expect(focusButton().textContent).toContain('Focus: data_perimeter');

      await chooseKind('Standalone projects');
      expect(app.hash()).toBe('snapshot=demo:S&focus=standalone-projects');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(focusButton().textContent).toContain('Focus: standalone projects');

      await chooseKind('None');
      expect(app.hash()).toBe('snapshot=demo:S');
    },
  );

  it(
    'drops a kind left without its parameter; Escape closes the kind list before the popover',
    DRAWING_APP_TIMEOUT,
    async () => {
      const app = renderControls('/diagram#snapshot=demo:S&focus=standalone-projects');
      await drawn(app.container);
      await userEvent.click(focusButton());
      const kind = within(popover()).getByRole('combobox', { name: 'Show' });
      await userEvent.click(kind);
      await userEvent.keyboard('{Escape}');
      expect(kind.getAttribute('aria-expanded')).toBe('false');
      expect(screen.getByRole('dialog', { name: 'Focus' })).toBeDefined();

      await chooseKind('Application');
      await picker('Application');
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(app.hash()).toBe('snapshot=demo:S&focus=standalone-projects');
      expect(document.activeElement).toBe(focusButton());
      await userEvent.click(focusButton());
      expect(within(popover()).getByRole('combobox', { name: 'Show' }).textContent).toContain(
        'Standalone projects',
      );
    },
  );

  it(
    'restores the focus from the URL, and says why the scene builder refused one',
    DRAWING_APP_TIMEOUT,
    async () => {
      const app = renderControls('/diagram#snapshot=demo:S&focus=project&focus.project=demo-nope-9');
      await drawn(app.container);
      expect(focusButton().textContent).toContain('Focus: demo-nope-9');
      // The button itself says so, in words, with the reason on hover.
      await waitFor(() => {
        expect(focusButton().textContent).toContain('not applied');
      });
      const cue = within(focusButton()).getByText('not applied');
      expect(cue.getAttribute('title')).toBe('Not applied: No project "demo-nope-9" in this snapshot.');
      await userEvent.click(focusButton());
      expect(within(popover()).getByRole('combobox', { name: 'Show' }).textContent).toContain(
        'Single project',
      );
      const alert = await within(popover()).findByRole('alert');
      expect(alert.textContent).toBe('Not applied: No project "demo-nope-9" in this snapshot.');
      await expectNoAxeViolations();
    },
  );

  it(
    'says why there is nothing to pick when the snapshot could not be loaded',
    WHOLE_APP_TIMEOUT,
    async () => {
      await openUndrawable();
      await chooseKind('Single project');
      const input = within(popover()).getByRole('combobox', { name: 'Project to focus on' });
      expect(input.getAttribute('aria-disabled')).toBe('true');
      expect(input.getAttribute('placeholder')).toBe('Not available');
      expect(within(popover()).getByRole('alert').textContent).toContain(`No snapshot "${UNKNOWN_SNAPSHOT}"`);
    },
  );
});
