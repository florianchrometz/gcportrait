// SPDX-License-Identifier: Apache-2.0
/**
 * The Snapshot menu: which snapshot is open (scope, read time, source), switching to another loaded
 * snapshot through the hash (lens and detail kept), and the Snapshots page; axe finds nothing in the top bar with
 * the menu open (the whole page with a drawn diagram: LensSelect.test.tsx, and in a browser e2e/tests/a11y.spec.ts).
 */
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { formatUtc } from '../../snapshots/labels';
import { expectNoAxeViolations } from '../../test/axe';
import { DRAWING_APP_TIMEOUT, WHOLE_APP_TIMEOUT } from '../../test/renderApp';
import { drawn, inTopBar, renderControls, topBar } from '../../views/testing/controls';
import { currentSnapshotLine, formatReadTime } from './SnapshotMenu';

describe('the Snapshot menu', () => {
  it.each([
    ['0000-01-01T00:00:00+01:00', '-000001-12-31 23:00 UTC'],
    ['9999-12-31T23:30:00-01:00', '+010000-01-01 00:30 UTC'],
  ])('formats both current snapshot sources at the UTC year boundary %s', (readTime, expected) => {
    expect(formatReadTime(readTime)).toBe(expected);
    const source = { ref: 'demo:M', scope: 'example.com', readTime, assets: 0 } as const;
    const facts = {
      ...source,
      scopeKind: 'organization',
      readTimeEstimated: false,
      source: 'export',
    } as const;
    expect(currentSnapshotLine('demo:M', facts, null)).toBe(`example.com · read ${expected} · export file`);
    expect(currentSnapshotLine('demo:M', null, source)).toBe(
      `example.com · read ${expected} · demo organisation`,
    );
  });

  it('keeps the canonical UTC formatter available under its existing export', () => {
    expect(formatReadTime).toBe(formatUtc);
  });

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

  it('says which snapshot is open, on its first item, and opens on it', DRAWING_APP_TIMEOUT, async () => {
    const app = renderControls('/diagram#snapshot=demo:S&lens=networking&detail=all&root=//x/y');
    // Found before the draw: a role query over a drawn diagram is slow.
    const bar = topBar();
    const button = within(bar).getByRole('button', { name: 'Snapshot' });
    await drawn(app.container);
    // The drawn Scene came with its source (state/pipeline.ts), so the menu says which snapshot is open at once.
    await userEvent.click(button);
    const menu = within(bar).getByRole('menu', { name: 'Snapshot' });
    const info = within(menu).getAllByRole('menuitem')[0];
    expect(info?.textContent).toBe('Open: example.com · read 2026-10-08 00:00 UTC · demo organisation');
    expect(info?.getAttribute('aria-disabled')).toBe('true');
    // The menu opens on the open snapshot.
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitemradio', { name: 'Demo organisation S (small)' }),
    );
    await expectNoAxeViolations(bar);
  });

  // The view is the hash, not the drawing: no workers, so no demo organisation is drawn or generated for the pick.
  it(
    'switches snapshots through the hash, lens and detail kept, and opens the Snapshots page',
    WHOLE_APP_TIMEOUT,
    async () => {
      const app = renderControls('/diagram#snapshot=demo:S&lens=networking&detail=all&root=//x/y', {
        workers: false,
      });
      const button = inTopBar().getByRole('button', { name: 'Snapshot' });
      await userEvent.click(button);
      const menu = screen.getByRole('menu', { name: 'Snapshot' });
      expect(
        within(menu)
          .getByRole('menuitemradio', { name: 'Demo organisation S (small)' })
          .getAttribute('aria-checked'),
      ).toBe('true');
      await userEvent.click(
        within(menu).getByRole('menuitemradio', { name: 'Demo organisation M (medium)' }),
      );
      expect(app.hash()).toBe('snapshot=demo:M&lens=networking&detail=all');

      await userEvent.click(button);
      await userEvent.click(
        within(screen.getByRole('menu', { name: 'Snapshot' })).getByRole('menuitem', {
          name: 'Snapshots page',
        }),
      );
      expect(app.location()).toBe('/snapshots');
    },
  );
});
