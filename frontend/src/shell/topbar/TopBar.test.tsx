// SPDX-License-Identifier: MIT
/**
 * The top bar composes one control group per file: the order below is its tab order, the Export menu last; the
 * working popups (Snapshot, Lens) share the store's one-open-popup state; axe finds nothing with either open. The
 * brand mark beside the wordmark is brand/icon.svg as the build writes it, under the build's base path (its size:
 * TopBar.css.test.ts). Narrower than a desktop, the rows fold into the View and More sheets (shell/parity.test.tsx
 * holds every control to every width).
 */
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeLibrary } from '../../snapshots/testing';
import { expectNoAxeViolations } from '../../test/axe';
import { staticDemoConfig, stubBackend } from '../../test/backend';
import { renderApp } from '../../test/renderApp';
import { installViewport, type ViewportControl } from '../../test/viewport';

/** The banner's tab stops, by role and name (none inside a closed sheet). */
function tabStops(banner: HTMLElement): string[] {
  return [...banner.querySelectorAll<HTMLElement>('a[href], button, input')]
    .filter((element) => element.tabIndex >= 0 && element.closest('[hidden]') === null)
    .map((element) => {
      const role = element.getAttribute('role') ?? element.tagName.toLowerCase();
      const name =
        element.getAttribute('aria-label') ??
        (element.getAttribute('aria-labelledby') === null
          ? element.textContent.replace('▾', '').trim()
          : document.getElementById(element.getAttribute('aria-labelledby') ?? '')?.textContent);
      return `${role}:${name ?? ''}`;
    });
}

describe('TopBar', () => {
  it('composes the control groups in their tab order', () => {
    renderApp('/diagram#snapshot=demo:S');
    expect(tabStops(screen.getByRole('banner'))).toEqual([
      'a:gcportrait',
      'a:Connect',
      'a:Diagram',
      'a:Snapshots',
      'a:Permissions',
      'a:Settings',
      'button:Snapshot',
      'button:Saved views',
      'button:Copy link',
      'button:Theme',
      'button:Export',
      'combobox:Lens',
      'button:Focus',
      'button:Filters',
      'radio:Auto',
      'combobox:',
    ]);
    expect(within(screen.getByRole('banner')).getByRole('combobox', { name: 'Search assets' })).toBeDefined();
  });

  it('keeps one popup open at a time, and passes axe with the Lens picker or the Snapshot menu open', async () => {
    renderApp('/diagram#snapshot=demo:S');
    const banner = screen.getByRole('banner');
    const lens = within(banner).getByRole('combobox', { name: 'Lens' });
    await userEvent.click(lens);
    expect(lens.getAttribute('aria-expanded')).toBe('true');
    await expectNoAxeViolations();
    await userEvent.click(within(banner).getByRole('button', { name: 'Snapshot' }));
    expect(screen.getByRole('menu', { name: 'Snapshot' })).toBeDefined();
    expect(lens.getAttribute('aria-expanded')).toBe('false');
    expect(
      within(screen.getByRole('menu', { name: 'Snapshot' }))
        .getAllByRole('menuitemradio')
        .map((item) => item.getAttribute('aria-checked')),
    ).toEqual(['true', 'false', 'false']);
    await expectNoAxeViolations();
  });

  it('ends the app row with the Export menu, after the theme and the account', () => {
    renderApp('/diagram#snapshot=demo:S');
    const banner = screen.getByRole('banner');
    const exportButton = within(banner).getByRole('button', { name: 'Export' });
    // The menu's anchor is the last of the app row's actions, and the actions end the row.
    const actions = exportButton.closest('div')?.parentElement;
    expect(actions?.lastElementChild?.contains(exportButton)).toBe(true);
    expect(actions?.parentElement?.lastElementChild).toBe(actions);
  });

  it.each(['/diagram', '/settings'])('passes axe at rest on %s', async (path) => {
    renderApp(path);
    await expectNoAxeViolations();
  });
});

describe('the brand mark', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** The mark in the banner's home link, which keeps the wordmark as its name. */
  function mark(): HTMLElement {
    const home = within(screen.getByRole('banner')).getByRole('link', { name: 'gcportrait' });
    return within(home).getByTestId('brand-mark');
  }

  it('is brand/icon.svg as an instance serves it, from the root, decorative', async () => {
    renderApp('/');
    const image = mark();
    expect(image.tagName).toBe('IMG');
    expect(image.getAttribute('src')).toBe('/favicon.svg');
    expect(image.getAttribute('alt')).toBe('');
    await expectNoAxeViolations();
  });

  it('comes from the build’s base path in the static demo, /demo/', () => {
    vi.stubEnv('BASE_URL', '/demo/');
    stubBackend();
    renderApp('/settings', { demo: false, staticConfig: staticDemoConfig(), snapshots: fakeLibrary() });
    expect(mark().getAttribute('src')).toBe('/demo/favicon.svg');
  });
});

describe('the top bar narrower than a desktop', () => {
  let viewport: ViewportControl | undefined;

  afterEach(() => {
    viewport?.uninstall();
    viewport = undefined;
  });

  it('on a tablet keeps two rows, the view row’s controls in View and the app row’s in More', async () => {
    viewport = installViewport(820);
    renderApp('/diagram#snapshot=demo:S');
    const banner = screen.getByRole('banner');
    expect(tabStops(banner)).toEqual(['a:gcportrait', 'button:More', 'button:View']);
    expect(within(banner).getByTestId('demo-badge').closest('[role="dialog"]')).toBeNull();
    await userEvent.click(within(banner).getByRole('button', { name: 'View' }));
    const view = within(banner).getByRole('dialog', { name: 'View' });
    expect(within(view).getByRole('combobox', { name: 'Lens' })).toBeDefined();
    expect(within(view).getByRole('combobox', { name: 'Search assets' })).toBeDefined();
    expect(within(view).queryByRole('navigation', { name: 'Scope' })).toBeNull();
    await expectNoAxeViolations();
  });

  it('on a phone is one row: the mark, the breadcrumb, View and More, the demo badge in More', async () => {
    viewport = installViewport(375);
    renderApp('/diagram#snapshot=demo:S');
    const banner = screen.getByRole('banner');
    // The home link keeps the wordmark as its name, for assistive technology only.
    expect(within(banner).getByRole('link', { name: 'gcportrait' })).toBeDefined();
    expect(banner.children).toHaveLength(1);
    expect(within(banner).getByRole('navigation', { name: 'Scope' })).toBeDefined();
    expect(tabStops(banner)).toEqual(['a:gcportrait', 'button:View', 'button:More']);
    await userEvent.click(within(banner).getByRole('button', { name: 'More' }));
    const more = within(banner).getByRole('dialog', { name: 'More' });
    expect(within(more).getByTestId('demo-badge')).toBeDefined();
    expect(within(more).getByRole('navigation', { name: 'Primary' })).toBeDefined();
    expect(within(more).getByRole('button', { name: 'Export' })).toBeDefined();
    await expectNoAxeViolations();
  });

  it('closes a sheet on a new page, and keeps one sheet open at a time', async () => {
    viewport = installViewport(375);
    renderApp('/diagram#snapshot=demo:S');
    const banner = screen.getByRole('banner');
    await userEvent.click(within(banner).getByRole('button', { name: 'View' }));
    await userEvent.click(within(banner).getByRole('button', { name: 'More' }));
    expect(within(banner).getByRole('button', { name: 'View' }).getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(within(banner).getByRole('link', { name: 'Settings' }));
    expect(within(banner).getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeDefined();
  });
});
