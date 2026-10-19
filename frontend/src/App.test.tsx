// SPDX-License-Identifier: Apache-2.0
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FOOTER_NOTICE,
  FOOTER_NOTICE_LEAD,
  MAINTAINER_LINK_LABEL,
  MAINTAINER_NAME,
  MAINTAINER_URL,
  NON_AFFILIATION_LONG,
  TAGLINE,
  WORDMARK,
} from './branding';
import { DEFAULT_SOURCE_URL, SOURCE_LINK_TEXT } from './source';
import { createMemoryPreferenceStore } from './storage/preferences';
import { publicConfig, stubBackend } from './test/backend';
import { expectInertButFocusable } from './test/inert';
import { currentLocation, renderApp } from './test/renderApp';

/** Every route with the level-1 heading its page shows. */
const ROUTES = [
  ['/', 'Connect'],
  ['/diagram', 'Diagram'],
  ['/snapshots', 'Snapshots'],
  ['/settings', 'Settings'],
  ['/no-such-page', 'Page not found'],
] as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('routing', () => {
  it.each(ROUTES)('renders %s inside the app shell', (path, heading) => {
    renderApp(path);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeDefined();
    expect(within(screen.getByRole('banner')).getByRole('link', { name: WORDMARK })).toBeDefined();
    expect(screen.getByRole('main')).toBeDefined();
  });

  it('redirects /permissions to /', () => {
    const { container } = renderApp('/permissions');
    expect(screen.getByRole('heading', { level: 1, name: 'Connect' })).toBeDefined();
    expect(currentLocation(container)).toBe('/');
  });

  it('marks the current page in the primary navigation', () => {
    renderApp('/settings');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Connect' }).getAttribute('aria-current')).toBeNull();
  });

  it('navigates with the primary navigation', async () => {
    const { container } = renderApp('/');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Settings' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeDefined();
    expect(currentLocation(container)).toBe('/settings');
  });

  it('sets the document title per page', () => {
    renderApp('/snapshots');
    expect(document.title).toBe(`Snapshots · ${WORDMARK}`);
  });
});

describe('non-affiliation statement', () => {
  it('uses the canonical wording', () => {
    expect(TAGLINE).toBe('gcportrait.app - Visualize your Google Cloud Infrastructure');
    expect(FOOTER_NOTICE).toBe(
      'Not affiliated with Google / Google Cloud. gcportrait is an independent open-source project by Florian Chrometz',
    );
    expect(NON_AFFILIATION_LONG).toBe(
      'gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and ' +
        'is not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product ' +
        "icons are trademarks of Google and are used under Google's icon usage terms.",
    );
    // The maintainer is named in the footer only, never in the long form.
    expect(NON_AFFILIATION_LONG).not.toContain(MAINTAINER_NAME);
    // The footer renders the notice as its lead and the maintainer's name as a link.
    expect(`${FOOTER_NOTICE_LEAD}${MAINTAINER_NAME}`).toBe(FOOTER_NOTICE);
    expect(MAINTAINER_URL).toBe('https://florian-chrometz.de');
    expect(MAINTAINER_LINK_LABEL).toBe('Florian Chrometz (personal website)');
  });

  it.each(ROUTES)('shows the notice with the linked name in the shell footer on %s', (path) => {
    renderApp(path);
    const footer = screen.getByRole('contentinfo');
    const link = within(footer).getByRole<HTMLAnchorElement>('link', { name: MAINTAINER_LINK_LABEL });
    expect(link.textContent).toBe(MAINTAINER_NAME);
    expect(link.getAttribute('href')).toBe(MAINTAINER_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
    const notice = link.parentElement;
    expect(notice?.tagName).toBe('P');
    expect(notice?.textContent).toBe(FOOTER_NOTICE);
    expect(footer.textContent).toBe(`${FOOTER_NOTICE}${SOURCE_LINK_TEXT}`);
    expect(screen.getByRole('main').contains(footer)).toBe(false);
  });

  it('keeps the footer outside the diagram canvas', () => {
    renderApp('/diagram');
    const canvas = screen.getByRole('region', { name: 'Diagram canvas' });
    expect(canvas.contains(screen.getByRole('contentinfo'))).toBe(false);
  });

  it('shows the long form in the About block of the Connect page', () => {
    renderApp('/');
    const about = screen.getByRole('region', { name: 'About' });
    expect(within(about).getByText(NON_AFFILIATION_LONG)).toBeDefined();
  });
});

/** A live-mode backend answering GET /api/config with the given source URL. */
function backendWithSource(sourceUrl: unknown): ReturnType<typeof stubBackend> {
  return stubBackend({ config: { ...publicConfig({ version: '1.2.3' }), sourceUrl } });
}

describe('the footer’s source link', () => {
  const sourceLink = () =>
    within(screen.getByRole('contentinfo')).getByRole<HTMLAnchorElement>('link', { name: SOURCE_LINK_TEXT });

  it('links to the canonical text', () => {
    expect(SOURCE_LINK_TEXT).toBe('Source (Apache-2.0)');
    expect(DEFAULT_SOURCE_URL).toBe('https://github.com/florianchrometz/gcportrait');
  });

  it.each(ROUTES)('shows the link next to the notice on %s, to the build-time URL in demo mode', (path) => {
    renderApp(path);
    const link = sourceLink();
    expect(link.getAttribute('href')).toBe(DEFAULT_SOURCE_URL);
    expect(link.previousElementSibling?.textContent).toBe(FOOTER_NOTICE);
    expect(screen.getByRole('main').contains(link)).toBe(false);
  });

  it('uses the configured build-time URL (VITE_SOURCE_URL) in demo mode without calling the backend', () => {
    const backend = stubBackend();
    for (const [path] of ROUTES) {
      const page = renderApp(path, { sourceUrl: 'https://git.example.org/demo/gcportrait' });
      expect(sourceLink().getAttribute('href')).toBe('https://git.example.org/demo/gcportrait');
      page.unmount();
    }
    expect(backend.fetch).not.toHaveBeenCalled();
  });

  it.each(ROUTES)('links to the backend’s sourceUrl in live mode on %s', async (path) => {
    const backend = backendWithSource('https://git.example.org/team/gcportrait-fork');
    renderApp(path, { demoConfig: null });
    await waitFor(() => {
      expect(sourceLink().getAttribute('href')).toBe('https://git.example.org/team/gcportrait-fork');
    });
    expect(backend.urls()).toContain('/api/config');
  });

  it('keeps the build-time URL in live mode when the backend does not answer', async () => {
    const backend = stubBackend();
    renderApp('/settings', { demoConfig: null, sourceUrl: 'https://git.example.org/build/gcportrait' });
    await waitFor(() => {
      expect(backend.fetch).toHaveBeenCalled();
    });
    expect(sourceLink().getAttribute('href')).toBe('https://git.example.org/build/gcportrait');
  });

  it.each([['javascript:alert(1)'], ['ftp://example.com/src'], [42]])(
    'ignores a sourceUrl of %j from the backend',
    async (sourceUrl) => {
      const backend = backendWithSource(sourceUrl);
      renderApp('/settings', { demoConfig: null });
      await waitFor(() => {
        expect(backend.fetch).toHaveBeenCalled();
      });
      // Let the answer settle; the link must not change.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sourceLink().getAttribute('href')).toBe(DEFAULT_SOURCE_URL);
    },
  );
});

describe('ViewSpec hash', () => {
  const hash = '#lens=networking&root=folders%2F123';

  it('is left untouched on the diagram route', () => {
    const { container } = renderApp(`/diagram${hash}`);
    expect(currentLocation(container)).toBe(`/diagram${hash}`);
  });

  it('survives a visit to another page and back through the navigation', async () => {
    const { container } = renderApp(`/diagram${hash}`);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Settings' }));
    expect(currentLocation(container)).toBe('/settings');
    await userEvent.click(within(nav).getByRole('link', { name: 'Diagram' }));
    expect(currentLocation(container)).toBe(`/diagram${hash}`);
  });

  it('is kept when the Diagram link is used on the diagram page itself', async () => {
    const { container } = renderApp(`/diagram${hash}`);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Diagram' }));
    expect(currentLocation(container)).toBe(`/diagram${hash}`);
  });

  it('is not touched by the skip link', async () => {
    const { container } = renderApp(`/diagram${hash}`);
    await userEvent.click(screen.getByRole('link', { name: 'Skip to content' }));
    expect(document.activeElement).toBe(screen.getByRole('main'));
    expect(currentLocation(container)).toBe(`/diagram${hash}`);
  });
});

describe('app shell', () => {
  it('renders the view controls: labelled, inert ones keyboard users can reach, and the working ones', () => {
    renderApp('/diagram');
    const banner = screen.getByRole('banner');
    // Focus and Filters work once a snapshot is open; Export once a diagram is drawn.
    for (const name of ['Export', 'Focus', 'Filters']) {
      expectInertButFocusable(within(banner).getByRole('button', { name }));
    }
    // The Theme menu works everywhere.
    expect(within(banner).getByRole('button', { name: 'Theme' }).getAttribute('aria-disabled')).toBeNull();
    const detail = within(banner).getByRole('radiogroup', { name: 'Detail' });
    expect(within(detail).getByRole('radio', { name: 'Auto' }).getAttribute('aria-checked')).toBe('true');
    // The Snapshot menu and, on the diagram page, the Lens picker work.
    const snapshot = within(banner).getByRole('button', { name: 'Snapshot' });
    expect(snapshot.getAttribute('aria-disabled')).toBeNull();
    expect(snapshot.getAttribute('aria-haspopup')).toBe('menu');
    const lens = within(banner).getByRole('combobox', { name: 'Lens' });
    expect(lens.getAttribute('aria-disabled')).toBeNull();
    expect(lens.textContent).toContain('Overview');
    expect(lens.getAttribute('aria-expanded')).toBe('false');
    const search = within(banner).getByRole<HTMLInputElement>('combobox', { name: 'Search assets' });
    expectInertButFocusable(search);
    expect(search.readOnly).toBe(true);
    expect(within(banner).getByRole('navigation', { name: 'Scope' })).toBeDefined();
  });

  it('shows the view row on the diagram page only', () => {
    for (const path of ['/', '/snapshots', '/permissions', '/settings']) {
      const page = renderApp(path);
      const banner = screen.getByRole('banner');
      expect(within(banner).queryByRole('combobox', { name: 'Lens' })).toBeNull();
      expect(within(banner).queryByRole('navigation', { name: 'Scope' })).toBeNull();
      expect(within(banner).queryByRole('button', { name: 'Filters' })).toBeNull();
      expect(within(banner).queryByRole('combobox', { name: 'Search assets' })).toBeNull();
      page.unmount();
    }
  });

  it('moves focus to the page and announces it after a route change', async () => {
    renderApp('/');
    const announcer = screen.getByTestId('route-announcer');
    expect(announcer.getAttribute('role')).toBe('status');
    // The first page is a page load: nothing to announce, focus stays where the browser put it.
    expect(announcer.textContent).toBe('');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Settings' }));
    expect(document.activeElement).toBe(screen.getByRole('main'));
    expect(announcer.textContent).toBe(`Settings · ${WORDMARK}`);
    await userEvent.click(within(nav).getByRole('link', { name: 'Snapshots' }));
    expect(document.activeElement).toBe(screen.getByRole('main'));
    expect(announcer.textContent).toBe(`Snapshots · ${WORDMARK}`);
  });

  it('reaches the controls with Tab; the placeholders do nothing when activated', async () => {
    const { container } = renderApp('/diagram');
    const banner = screen.getByRole('banner');
    within(banner).getByRole('link', { name: 'Settings' }).focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(within(banner).getByRole('button', { name: 'Snapshot' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(within(banner).getByRole('button', { name: 'Saved views' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(within(banner).getByRole('button', { name: 'Copy link' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(within(banner).getByRole('button', { name: 'Theme' }));
    await userEvent.tab();
    const exportButton = within(banner).getByRole('button', { name: 'Export' });
    expect(document.activeElement).toBe(exportButton);
    await userEvent.keyboard('{Enter}');
    // Focus and Filters wait for a snapshot: a click opens nothing.
    for (const name of ['Focus', 'Filters']) {
      await userEvent.click(within(banner).getByRole('button', { name }));
      expect(screen.queryByRole('dialog'), name).toBeNull();
    }
    await userEvent.type(within(banner).getByRole('combobox', { name: 'Search assets' }), 'vpc{Enter}');
    expect(currentLocation(container)).toBe('/diagram');
    expect(within(banner).getByRole<HTMLInputElement>('combobox', { name: 'Search assets' }).value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the details drawer closed by default', () => {
    renderApp('/diagram');
    expect(screen.queryByRole('complementary')).toBeNull();
    const drawer = document.querySelector<HTMLElement>('aside[aria-label="Details"]');
    expect(drawer?.hidden).toBe(true);
  });

  it('shows the timeline bar below the canvas, focusable but fixed while no snapshot is open', async () => {
    renderApp('/diagram');
    const timeline = screen.getByRole('region', { name: 'Timeline' });
    const slider = within(timeline).getByRole('slider', { name: 'Timeline' });
    expectInertButFocusable(slider);
    expect(within(timeline).getByRole('status').textContent).toBe('Open a snapshot to use the timeline.');
    const before = slider.getAttribute('aria-valuenow');
    slider.focus();
    await userEvent.keyboard('{ArrowLeft}{Home}');
    expect(slider.getAttribute('aria-valuenow')).toBe(before);
  });
});

describe('a demo build', () => {
  it('shows the demo badge and offers only "Try the demo"', () => {
    renderApp('/', {});
    expect(within(screen.getByRole('banner')).getByText('Demo mode')).toBeDefined();
    const sources = screen.getByRole('region', { name: 'Demo mode' });
    const buttons = within(sources).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Try the demo']);
    // It works (pages/ConnectPage.test.tsx covers it).
    expect(
      within(sources).getByRole('button', { name: 'Try the demo' }).getAttribute('aria-disabled'),
    ).toBeNull();
  });
});

describe('live mode', () => {
  // The sources a live instance offers: pages/ConnectPage.demoOnly.test.tsx, "the Connect page of a live instance".
  it('reports the backend', async () => {
    backendWithSource(DEFAULT_SOURCE_URL);
    renderApp('/', { demoConfig: null });
    expect(screen.queryByText('Demo mode')).toBeNull();
    expect(
      await screen.findByText(/Backend version 1\.2\.3\. Google sign-in is not configured/),
    ).toBeDefined();
  });

  it('says so when the backend does not answer', async () => {
    stubBackend();
    renderApp('/', { demoConfig: null });
    expect(await screen.findByText(/The backend did not answer/)).toBeDefined();
  });
});

describe('settings', () => {
  it('switches the theme with the radio group and saves the choice', async () => {
    const preferences = createMemoryPreferenceStore();
    renderApp('/settings', { preferences });
    const group = screen.getByRole('group', { name: 'Theme' });
    expect(within(group).getByRole<HTMLInputElement>('radio', { name: 'System' }).checked).toBe(true);
    await userEvent.click(within(group).getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(await preferences.get('theme')).toBe('dark');
    await userEvent.click(within(group).getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(await preferences.get('theme')).toBe('light');
  });

  it('switches the same preference from the top bar’s Theme menu', async () => {
    const preferences = createMemoryPreferenceStore();
    renderApp('/settings', { preferences });
    const banner = screen.getByRole('banner');
    const button = within(banner).getByRole('button', { name: 'Theme' });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    await userEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'Theme' });
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => `${item.textContent}:${item.getAttribute('aria-checked') ?? ''}`),
    ).toEqual(['System:true', 'Light:false', 'Dark:false']);
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(await preferences.get('theme')).toBe('dark');
    // Focus goes back to the button; the Settings page shows the same choice.
    expect(document.activeElement).toBe(button);
    const group = screen.getByRole('group', { name: 'Theme' });
    expect(within(group).getByRole<HTMLInputElement>('radio', { name: 'Dark' }).checked).toBe(true);
    // And the other way round: Settings to the menu.
    await userEvent.click(within(group).getByRole('radio', { name: 'System' }));
    await userEvent.click(button);
    expect(
      within(screen.getByRole('menu', { name: 'Theme' }))
        .getByRole('menuitemradio', { name: 'System' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    await userEvent.keyboard('{Escape}');
  });
});
