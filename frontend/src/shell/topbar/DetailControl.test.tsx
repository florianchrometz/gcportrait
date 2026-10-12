// SPDX-License-Identifier: MIT
/**
 * The detail control: a radio group of auto / folders / projects / networks / all; Auto names the
 * level it picked for the canvas; a click or the arrow keys write the level into the hash, and the URL restores
 * it; not shown away from the diagram page.
 */
import type { SceneDetail } from '@gcportrait/model';
import { waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from '../../test/axe';
import { drawn, inTopBar, renderControls } from '../../views/testing/controls';
import { autoPick, detailOptions } from './DetailControl';

function detail(): HTMLElement {
  return inTopBar().getByRole('radiogroup', { name: 'Detail' });
}

describe('the detail control', () => {
  it('names the level auto picked: the one used, or the one it would pick', () => {
    const report: SceneDetail = {
      requested: 'auto',
      used: 'projects',
      budget: 73,
      ceiling: 'all',
      rectCounts: { folders: 20, projects: 60, networks: 120, all: 400 },
    };
    expect(autoPick(report)).toBe('projects');
    expect(autoPick({ ...report, requested: 'all', used: 'all' })).toBe('projects');
    expect(autoPick({ ...report, requested: 'all', used: 'all', budget: 150 })).toBe('networks');
    // Never deeper than the lens's default.
    expect(autoPick({ ...report, requested: 'all', used: 'all', budget: 150, ceiling: 'projects' })).toBe(
      'projects',
    );
    expect(autoPick(undefined)).toBeNull();
    expect(detailOptions('folders').map((option) => option.label)).toEqual([
      'Auto · folders',
      'Folders',
      'Projects',
      'Networks',
      'All',
    ]);
    expect(detailOptions(null)[0]?.label).toBe('Auto');
  });

  it('shows the level auto picked on the drawn diagram, and writes a chosen level into the hash', async () => {
    const app = renderControls('/diagram#snapshot=demo:S');
    await drawn(app.container);
    // Demo S has fewer than 100 rects: auto never collapses it.
    await waitFor(() => {
      expect(within(detail()).getByRole('radio', { name: 'Auto · all' }).getAttribute('aria-checked')).toBe(
        'true',
      );
    });
    await userEvent.click(within(detail()).getByRole('radio', { name: 'Projects' }));
    expect(app.location()).toBe('/diagram#snapshot=demo:S&detail=projects');
    // Arrow keys move and choose; the checked radio is the one tab stop.
    await userEvent.keyboard('{ArrowRight}');
    expect(app.location()).toBe('/diagram#snapshot=demo:S&detail=networks');
    expect(document.activeElement).toBe(within(detail()).getByRole('radio', { name: 'Networks' }));
    await userEvent.keyboard('{Home}');
    expect(app.location()).toBe('/diagram#snapshot=demo:S');
    await expectNoAxeViolations();
  }, 30_000);

  it('restores the level from the URL, and is not shown away from the diagram page', () => {
    const app = renderControls('/diagram#snapshot=demo:S&detail=networks', { workers: false });
    expect(within(detail()).getByRole('radio', { name: 'Networks' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    app.unmount();
    renderControls('/settings', { workers: false });
    expect(inTopBar().queryByRole('radiogroup', { name: 'Detail' })).toBeNull();
  });
});
