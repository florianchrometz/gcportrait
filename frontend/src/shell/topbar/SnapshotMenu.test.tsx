// SPDX-License-Identifier: MIT
/**
 * The Snapshot menu: which snapshot is open (scope, read time, source), switching to another loaded
 * snapshot through the hash (lens and detail kept), and the Snapshots page.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from '../../test/axe';
import { drawn, inTopBar, renderControls } from '../../views/testing/controls';
import { currentSnapshotLine, formatReadTime } from './SnapshotMenu';

describe('the Snapshot menu', () => {
  it('words the open snapshot from its facts, or from the drawn diagram until they arrive', () => {
    expect(formatReadTime('2026-10-08T02:30:00+02:00')).toBe('2026-10-08 00:30 UTC');
    expect(formatReadTime('soon')).toBe('soon');
    const facts = {
      ref: 'demo:M',
      scope: 'example.com',
      scopeKind: 'organization',
      readTime: '2026-10-08T00:00:00Z',
      readTimeEstimated: true,
      source: 'export',
      assets: 3,
    } as const;
    expect(currentSnapshotLine('demo:M', facts, null)).toBe(
      'example.com · read 2026-10-08 00:00 UTC (estimated) · export file',
    );
    const source = {
      ref: 'demo:M',
      scope: 'example.com',
      readTime: '2026-10-08T00:00:00Z',
      assets: 3,
    } as const;
    expect(currentSnapshotLine('demo:M', null, source)).toBe(
      'example.com · read 2026-10-08 00:00 UTC · demo organisation',
    );
    expect(currentSnapshotLine('demo:S', facts, source)).toBeNull();
    expect(currentSnapshotLine('', facts, source)).toBeNull();
  });

  it('says which snapshot is open, switches snapshots through the hash, and opens the Snapshots page', async () => {
    const app = renderControls('/diagram#snapshot=demo:S&lens=networking&detail=all&root=//x/y');
    await drawn(app.container);
    const button = inTopBar().getByRole('button', { name: 'Snapshot' });
    await waitFor(async () => {
      await userEvent.click(button);
      const info = within(screen.getByRole('menu', { name: 'Snapshot' })).getAllByRole('menuitem')[0];
      expect(info?.textContent).toBe('Open: example.com · read 2026-10-08 00:00 UTC · demo organisation');
      await userEvent.keyboard('{Escape}');
    });
    await userEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'Snapshot' });
    const info = within(menu).getAllByRole('menuitem')[0];
    expect(info?.getAttribute('aria-disabled')).toBe('true');
    // The menu opens on the open snapshot.
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitemradio', { name: 'Demo organisation S (small)' }),
    );
    await expectNoAxeViolations();
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Demo organisation M (medium)' }));
    expect(app.hash()).toBe('snapshot=demo:M&lens=networking&detail=all');

    await userEvent.click(button);
    await userEvent.click(
      within(screen.getByRole('menu', { name: 'Snapshot' })).getByRole('menuitem', {
        name: 'Snapshots page',
      }),
    );
    expect(app.location()).toBe('/snapshots');
  }, 40_000);
});
