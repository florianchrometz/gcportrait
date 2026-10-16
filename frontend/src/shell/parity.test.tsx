// SPDX-License-Identifier: MIT
/**
 * Feature parity across the layouts (AGENTS.md, Product rules; ui/screen.ts): the diagram page, drawn from demo S with
 * a project selected (so the details drawer, the disclosure bar and the timeline bar are there), the Connect page
 * of a live instance signed in with Google (the account menu), the Permissions page, whose reference table is a
 * list on a phone, and the Snapshots page with snapshots stored, whose tables are a card per row on a phone, each at a
 * desktop's, a tablet's and a phone's width.
 * With every folded sheet opened and every menu, popover and dialog of the chrome opened in turn, the same controls
 * are reachable at each width, by role and accessible name, and each as often: buttons, links, fields, menu items,
 * radio buttons, sliders and the drawer's splitter. A control the desktop offers and a narrower width does not fails
 * it, and so does a second copy of one; the only controls a narrower width adds are the buttons of its folds, View
 * and More.
 *
 * What this shows is presence in the DOM and the accessibility tree only: jsdom lays nothing out, so a control that
 * is there but out of sight, under another element or off the edge of a box passes here. Whether each one is in
 * sight when it has focus and can be tapped is measured in a browser by the e2e check (`e2e/tests/mobile.spec.ts`).
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installGis, signInThroughGis, TEST_CLIENT_ID } from '../auth/testing';
import { TOKENINFO_URL } from '../auth/tokeninfo';
import { createInProcessWorkers } from '../diagram/pipeline/inProcess';
import { fakeLibrary, storedRecord } from '../snapshots/testing';
import { publicConfig, stubBackend } from '../test/backend';
import { drawn } from '../test/diagram';
import { renderApp } from '../test/renderApp';
import { installViewport, type ViewportControl } from '../test/viewport';
import { screenAt } from '../ui/screen';

const PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000002';
const ADDRESS = `/diagram#snapshot=demo:S&detail=folders&selection=${PROJECT}`;
const ROLES = [
  'button',
  'link',
  'textbox',
  'combobox',
  'searchbox',
  'checkbox',
  'radio',
  'slider',
  'separator',
  'menuitem',
  'menuitemradio',
  'menuitemcheckbox',
] as const;
/** The buttons of the folds: what a narrower width adds, and opens to reach what the desktop shows in place. */
const FOLDS = ['View', 'More'] as const;
const WIDTHS = { desktop: 1440, tablet: 820, phone: 375 } as const;

let viewport: ViewportControl | undefined;

afterEach(() => {
  viewport?.uninstall();
  viewport = undefined;
  vi.unstubAllGlobals();
});

/** The chrome's reachable controls now, by `role:name` (the drawing's own nodes left out), with their counts. */
function reachable(into: Map<string, number>, seen: Set<Element>): void {
  for (const role of ROLES) {
    screen.queryAllByRole(role, {
      name: (name, element) => {
        if (element.closest('svg') !== null || seen.has(element)) return false;
        // A separator is a control only when it takes focus (the drawer's splitter); a menu's is a line.
        if (role === 'separator' && !element.hasAttribute('tabindex')) return false;
        seen.add(element);
        const key = `${role}:${name}`;
        into.set(key, (into.get(key) ?? 0) + 1);
        return false;
      },
    });
  }
}

async function press(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
}

async function escape(): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await Promise.resolve();
  });
}

/** The diagram page of demo S with a project selected, drawn, its details read. */
async function diagramPage(): Promise<void> {
  const { container } = renderApp(ADDRESS, { diagramWorkers: createInProcessWorkers });
  await drawn(container);
  await waitFor(() => {
    expect(within(screen.getByRole('complementary', { name: 'Details' })).getByText(PROJECT)).toBeDefined();
  });
}

/** The Connect page of a live instance, signed in with Google (the account menu in the top bar). */
async function signedIn(): Promise<void> {
  const gis = installGis();
  stubBackend({
    config: publicConfig({ oauthClientId: TEST_CLIENT_ID }),
    routes: { [TOKENINFO_URL]: () => Response.json({ aud: TEST_CLIENT_ID, email: 'ada@example.com' }) },
  });
  renderApp('/', { demo: false, snapshots: fakeLibrary() });
  const button = await waitFor(() => {
    const found = screen.getByRole('button', { name: 'Sign in with Google' });
    expect(found.getAttribute('aria-disabled')).toBeNull();
    return found;
  });
  await signInThroughGis(gis, button);
  await waitFor(() => {
    expect(document.querySelector('header')?.textContent).toContain('ada@example.com');
  });
}

/** The Permissions page in demo mode, its reference of what each mode needs shown. */
async function permissionsPage(): Promise<void> {
  renderApp('/permissions');
  await screen.findByRole('region', { name: 'What each mode needs' });
}

/** The tables of the Snapshots page: what it stores, and the timeline of the one scope both snapshots belong to. */
const SNAPSHOT_TABLES = [
  'Snapshots stored in this browser',
  'Timeline of example.com (Organisation 30000000001) kept in this browser',
] as const;

/**
 * The Snapshots page with a demo organisation (a snapshot with a history) and an export (an extra tick) stored: a row
 * of each in its stored snapshots' table and in their scope's timeline.
 */
async function snapshotsPage(): Promise<void> {
  renderApp('/snapshots', {
    snapshots: fakeLibrary({
      records: [
        storedRecord('demo:M', { detail: 'demo:M', historyTicks: 35, savedAt: '2026-10-10T11:00:00Z' }),
        storedRecord('01J9Z3K5Q8XW2V4N6P7R8S9T0A', {
          source: 'export',
          detail: 'export.json',
          estimatedReadTime: true,
          readTime: '2026-10-07T18:22:41Z',
          savedAt: '2026-10-10T12:00:00Z',
        }),
      ],
    }),
  });
  await screen.findByRole('button', { name: /^Delete the extra tick / });
}

/** Each row of the Snapshots page's tables as its facts, `header: cell`, read from its table or from its card. */
function snapshotRows(): string[][][] {
  return SNAPSHOT_TABLES.map((name) => {
    const table = screen.queryByRole('table', { name });
    if (table !== null) {
      const headers = within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent);
      return within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) =>
          [...row.querySelectorAll('th, td')]
            .slice(0, -1)
            .map((cell, index) => `${headers[index] ?? '?'}: ${cell.textContent}`),
        );
    }
    return within(screen.getByRole('list', { name }))
      .getAllByRole('listitem')
      .map((card) => {
        const terms = within(card).getAllByRole('term');
        const definitions = within(card).getAllByRole('definition');
        return terms.map((term, index) => `${term.textContent}: ${definitions[index]?.textContent ?? '?'}`);
      });
  });
}

/** Every control of the page `open` shows at `width`, every fold, menu, popover and dialog of the chrome opened once. */
async function controlsAt(width: number, open: () => Promise<void>): Promise<Map<string, number>> {
  cleanup();
  viewport?.uninstall();
  viewport = installViewport(width);
  await open();
  const banner = screen.getByRole('banner');
  const found = new Map<string, number>();
  const seen = new Set<Element>();
  // The popups of the chrome shown now, each opened and closed again (a fold stays open around them).
  const openPopups = async (): Promise<void> => {
    const openers = [
      ...document.querySelectorAll<HTMLElement>('[aria-haspopup="menu"], [aria-haspopup="dialog"]'),
    ].filter(
      (opener) =>
        opener.closest('svg, [hidden]') === null &&
        opener.getAttribute('aria-disabled') !== 'true' &&
        !FOLDS.some((name) => opener.textContent.replace('▾', '').trim() === name),
    );
    for (const opener of openers) {
      await press(opener);
      reachable(found, seen);
      await escape();
    }
  };
  reachable(found, seen);
  const folds = FOLDS.map((name) => within(banner).queryByRole('button', { name })).filter(
    (fold) => fold !== null,
  );
  if (folds.length === 0) await openPopups();
  // One sheet at a time: each opened, its controls and their popups seen, then closed with Escape.
  for (const fold of folds) {
    await press(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    reachable(found, seen);
    await openPopups();
    await escape();
    expect(fold.getAttribute('aria-expanded')).toBe('false');
  }
  return found;
}

/** Fails on a control of the desktop that `layout` lacks or has another number of, and on one it adds but a fold. */
function expectParity(
  desktop: ReadonlyMap<string, number>,
  narrow: ReadonlyMap<string, number>,
  layout: string,
  folds: readonly string[],
): void {
  const missing = [...desktop.keys()].filter((key) => !narrow.has(key));
  expect(missing, `${layout}: missing`).toEqual([]);
  const counts = [...desktop].filter(([key, count]) => narrow.get(key) !== count);
  expect(
    counts.map(([key, count]) => `${key} ×${String(count)} → ×${String(narrow.get(key) ?? 0)}`),
    `${layout}: counts`,
  ).toEqual([]);
  const added = [...narrow.keys()].filter((key) => !desktop.has(key));
  expect(added.sort(), `${layout}: added`).toEqual(folds.map((name) => `button:${name}`).sort());
}

describe('feature parity across the layouts', () => {
  it('maps the widths to their layouts', () => {
    expect(screenAt(WIDTHS.desktop)).toBe('desktop');
    expect(screenAt(WIDTHS.tablet)).toBe('tablet');
    expect(screenAt(WIDTHS.phone)).toBe('phone');
  });

  it('offers every control of the diagram page’s desktop at a tablet’s and a phone’s width, once each, behind View and More', async () => {
    const desktop = await controlsAt(WIDTHS.desktop, diagramPage);
    // What the desktop offers: the view row's and the app row's controls, a menu's items, the drawer's splitter.
    expect([...desktop.keys()]).toEqual(
      expect.arrayContaining([
        'combobox:Lens',
        'combobox:Search assets',
        'button:Snapshot',
        'button:Export',
        'menuitemradio:System',
        'link:Settings',
        'separator:Resize the details drawer',
        'button:Expand all',
        'slider:Timeline',
        'button:Close',
      ]),
    );
    expect(desktop.has('button:View')).toBe(false);
    expect(desktop.has('button:More')).toBe(false);
    for (const layout of ['tablet', 'phone'] as const) {
      expectParity(desktop, await controlsAt(WIDTHS[layout], diagramPage), layout, FOLDS);
    }
  }, 120_000);

  it('offers the account menu of a signed-in live instance at every width, behind More', async () => {
    const desktop = await controlsAt(WIDTHS.desktop, signedIn);
    expect([...desktop.keys()]).toEqual(
      expect.arrayContaining(['button:ada@example.com', 'button:Sign out']),
    );
    for (const layout of ['tablet', 'phone'] as const) {
      expectParity(desktop, await controlsAt(WIDTHS[layout], signedIn), layout, ['More']);
    }
  }, 60_000);

  it('offers every command of the Permissions page’s reference at every width: a table on a tablet and a desktop, a list under a heading per mode on a phone', async () => {
    const desktop = await controlsAt(WIDTHS.desktop, permissionsPage);
    expect([...desktop.keys()]).toEqual(
      expect.arrayContaining([
        'button:Copy the command that grants roles/cloudasset.viewer on YOUR_ORG_ID (reference)',
        'button:Copy the command that enables the Cloud Asset API in YOUR_QUOTA_PROJECT (reference)',
        'button:Copy the command that exports the scope’s assets to Cloud Storage (reference)',
        'textbox:Organisation number',
        'textbox:Your e-mail',
      ]),
    );
    for (const layout of ['tablet', 'phone'] as const) {
      expectParity(desktop, await controlsAt(WIDTHS[layout], permissionsPage), layout, ['More']);
      const reference = screen.getByRole('region', { name: 'What each mode needs' });
      const table = within(reference).queryByRole('table', {
        name: 'What each way of reading Cloud Asset Inventory needs',
      });
      const modes = within(reference)
        .queryAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent);
      if (layout === 'phone') {
        expect(table).toBeNull();
        expect(modes).toEqual(['Variables', 'Your account', 'Service account', 'Export file']);
      } else {
        expect(table).not.toBeNull();
        expect(modes).toEqual(['Variables']);
      }
    }
  }, 60_000);

  it('offers every button of the Snapshots page’s rows at every width: tables on a tablet and a desktop, a card per row with the same facts on a phone', async () => {
    const desktop = await controlsAt(WIDTHS.desktop, snapshotsPage);
    const label = 'example.com, read 2026-10-08 00:00 UTC, demo:M';
    expect([...desktop.keys()]).toEqual(
      expect.arrayContaining([
        `button:Load ${label}`,
        `button:Export ${label}`,
        `button:Delete ${label}`,
        'button:Delete the extra tick example.com, read 2026-10-07 18:22 UTC, export.json',
        'button:Delete all snapshots…',
      ]),
    );
    const rows = snapshotRows();
    expect(rows.map((table) => table.length)).toEqual([2, 2]);
    expect(rows[0]?.[1]).toEqual([
      'Scope: example.comOrganisation 30000000001',
      'Read: 2026-10-08 00:00 UTC',
      'Source: Demodemo:M · 35-day history',
      'Assets: 952',
      'Size: 123 kB',
      'Stored: 2026-10-10 11:00 UTC',
    ]);
    for (const layout of ['tablet', 'phone'] as const) {
      expectParity(desktop, await controlsAt(WIDTHS[layout], snapshotsPage), layout, ['More']);
      const tables = SNAPSHOT_TABLES.map((name) => screen.queryByRole('table', { name }));
      const lists = SNAPSHOT_TABLES.map((name) => screen.queryByRole('list', { name }));
      if (layout === 'phone') {
        expect(tables).toEqual([null, null]);
        expect(lists.every((list) => list !== null)).toBe(true);
      } else {
        expect(tables.every((table) => table !== null)).toBe(true);
        expect(lists).toEqual([null, null]);
      }
      // The same facts under the same words, a row's or a card's.
      expect(snapshotRows(), layout).toEqual(rows);
    }
  }, 60_000);
});
