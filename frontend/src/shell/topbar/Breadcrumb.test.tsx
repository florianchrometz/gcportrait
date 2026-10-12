// SPDX-License-Identifier: MIT
/**
 * The scope breadcrumb with the drill-in trail on demo S: the scope alone at the organisation; the
 * containers above a drill-in root down to the root (`aria-current="location"`), each a button that drills out
 * to it; the scope drills out of the root; a refused root says so; axe.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from '../../test/axe';
import { drawn, inTopBar, renderControls } from '../../views/testing/controls';

const FOLDER = '//cloudresourcemanager.googleapis.com/folders/';

function scope(): HTMLElement {
  return inTopBar().getByRole('navigation', { name: 'Scope' });
}

async function crumbs(count: number): Promise<HTMLElement[]> {
  return waitFor(
    () => {
      const items = within(scope()).getAllByRole('listitem');
      expect(items).toHaveLength(count);
      return items;
    },
    { timeout: 20_000 },
  );
}

describe('the scope breadcrumb', () => {
  it('shows "No scope loaded" without a diagram, and the scope alone at the organisation', async () => {
    const app = renderControls('/diagram', { workers: false });
    expect(scope().textContent).toBe('No scope loaded');
    app.unmount();
    const drawnApp = renderControls('/diagram#snapshot=demo:S');
    await drawn(drawnApp.container);
    await waitFor(() => {
      expect(scope().textContent).toBe('example.com');
    });
    expect(within(scope()).queryByRole('button')).toBeNull();
  }, 30_000);

  it('runs the trail from the scope to the drill-in root, and each crumb drills out to its container', async () => {
    const app = renderControls(`/diagram#snapshot=demo:S&root=${FOLDER}20000000004`);
    await drawn(app.container);
    const items = await crumbs(4);
    expect(items.map((item) => item.textContent)).toEqual([
      'example.com',
      'Workloads',
      'Retail',
      'Production',
    ]);
    expect(items[3]?.getAttribute('aria-current')).toBe('location');
    expect(within(items[3] ?? scope()).queryByRole('button')).toBeNull();
    await expectNoAxeViolations(scope());

    await userEvent.click(within(scope()).getByRole('button', { name: 'Retail' }));
    expect(app.hash()).toBe(`snapshot=demo:S&root=${FOLDER}20000000003`);
    expect((await crumbs(3)).map((item) => item.textContent)).toEqual(['example.com', 'Workloads', 'Retail']);

    await userEvent.click(within(scope()).getByRole('button', { name: 'example.com' }));
    expect(app.hash()).toBe('snapshot=demo:S');
    await crumbs(1);
  }, 40_000);

  it('follows a drill-in from the node menu', async () => {
    const app = renderControls('/diagram#snapshot=demo:S&lens=networking&detail=all');
    const svg = await drawn(app.container);
    const project = svg.querySelector<SVGGElement>('.dg-zone[aria-label^="Project: "]');
    if (project === null) throw new Error('no project zone');
    project.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Details' }));
    expect(app.hash()).toContain(`root=${project.getAttribute('data-id') ?? ''}`);
    const items = await crumbs(3);
    expect(items[0]?.textContent).toBe('example.com');
    expect(items[2]?.getAttribute('aria-current')).toBe('location');
  }, 40_000);

  it('says when the root is not found, and the scope still drills out of it', async () => {
    const app = renderControls(`/diagram#snapshot=demo:S&root=${FOLDER}99999999999`);
    await drawn(app.container);
    const items = await crumbs(2);
    await waitFor(() => {
      expect(items[1]?.textContent).toBe('99999999999 (not found)');
    });
    await userEvent.click(within(scope()).getByRole('button', { name: 'example.com' }));
    expect(app.hash()).toBe('snapshot=demo:S');
  }, 40_000);
});
