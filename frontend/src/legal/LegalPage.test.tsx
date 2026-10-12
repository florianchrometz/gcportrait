// SPDX-License-Identifier: MIT
/**
 * The legal pages in the whole app: the footer's "Impressum · Privacy" shown only for what the backend
 * publishes, /impressum and /privacy rendering its Markdown without any HTML, and the states without a text.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LegalPages, PublicConfig } from '../api/config';
import { fakeLibrary } from '../snapshots/testing';
import { expectNoAxeViolations } from '../test/axe';
import { publicConfig, stubBackend, type StubbedBackend } from '../test/backend';
import { currentLocation, renderApp } from '../test/renderApp';

/** Synthetic texts only (agents.md rule 6). */
const IMPRESSUM = [
  '# Impressum',
  '',
  'Angaben gemäß § 5 DDG:  ',
  'Example Operator  ',
  'Example Street 1',
  '',
  '## Kontakt',
  '',
  '- E-Mail: <mail@example.com>',
  '- Web: [example.com](https://example.com/)',
  '',
  '<script>window.injected = true</script> <b>not bold</b> [bad](javascript:void0)',
].join('\n');
const PRIVACY = 'This demo stores nothing about you.\n\n# Hosting\n\nSee the [Impressum](/impressum).';

function config(legal: PublicConfig['legal'], demoOnly = false): PublicConfig {
  return publicConfig({ demoOnly, ...(legal === undefined ? {} : { legal }) });
}

/** A live instance answering `answer` on /api/config and `texts` on /api/legal (`'down'`: no answer). */
function backend(
  answer: PublicConfig,
  texts: unknown = { impressum: IMPRESSUM, privacy: PRIVACY },
): StubbedBackend {
  return stubBackend({
    config: answer,
    routes: {
      '/api/legal': () =>
        texts === 'down' ? Promise.reject(new TypeError('offline')) : Response.json(texts),
    },
  });
}

function footer(): HTMLElement {
  return screen.getByRole('contentinfo');
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { injected?: unknown }).injected;
});

describe('the footer', () => {
  /** A footer link: its accessible name, its address, and whether it leads to another site. */
  type Link = readonly [name: string, href: string, external: boolean];
  const ELSEWHERE = 'https://operator.example.com/legal/';

  it.each<[string, LegalPages, readonly Link[]]>([
    [
      'the pages the instance serves, when both are published',
      { impressum: true, privacy: true },
      [
        ['Impressum', '/impressum', false],
        ['Privacy', '/privacy', false],
      ],
    ],
    [
      'pages published elsewhere (LEGAL_IMPRESSUM_URL, LEGAL_PRIVACY_URL), in a new tab, marked as external',
      {
        impressum: false,
        privacy: false,
        impressumUrl: `${ELSEWHERE}impressum`,
        privacyUrl: `${ELSEWHERE}privacy-policy`,
      },
      [
        ['Impressum (opens operator.example.com in a new tab)', `${ELSEWHERE}impressum`, true],
        ['Privacy (opens operator.example.com in a new tab)', `${ELSEWHERE}privacy-policy`, true],
      ],
    ],
    [
      'a page published elsewhere next to one served by the instance',
      { impressum: false, privacy: true, impressumUrl: `${ELSEWHERE}impressum`, privacyUrl: null },
      [
        ['Impressum (opens operator.example.com in a new tab)', `${ELSEWHERE}impressum`, true],
        ['Privacy', '/privacy', false],
      ],
    ],
  ])(
    'links %s, as "Impressum · Privacy" after the non-affiliation notice and the source link',
    async (_case, legal, links) => {
      const fetch = backend(config(legal));
      renderApp('/settings', { demo: false, snapshots: fakeLibrary() });
      const nav = await within(footer()).findByRole('navigation', { name: 'Legal' });
      const found = within(nav).getAllByRole('link');
      expect(
        found.map((link) => [link.getAttribute('aria-label') ?? link.textContent, link.getAttribute('href')]),
      ).toEqual(links.map(([name, href]) => [name, href]));
      for (const [index, link] of found.entries()) {
        const mark = link.querySelector('svg');
        if (links[index]?.[2] === true) {
          // A new tab, so that a signed-in session in this one (in memory only) survives; no opener for the other site.
          expect(link.getAttribute('target')).toBe('_blank');
          expect(link.getAttribute('rel')).toBe('noopener');
          // The arrow marks it for the eye; assistive technology hears the site and the new tab in the name instead.
          expect(mark?.getAttribute('aria-hidden')).toBe('true');
          expect(mark?.getAttribute('focusable')).toBe('false');
        } else {
          expect(mark).toBeNull();
        }
      }
      // The visible text is the name's beginning (WCAG 2.5.3), the same words for a served page and one elsewhere.
      expect(nav.textContent).toBe('Impressum·Privacy');
      expect(footer().textContent).toMatch(/Florian ChrometzSource \(MIT\)Impressum·Privacy$/);
      // The texts themselves are fetched only on the pages.
      expect(fetch.urls()).toEqual(['/api/config']);
      await expectNoAxeViolations();
    },
  );

  it('links only the page that exists, and nothing without texts, an older backend, an address that is not https, or a backend that is down', async () => {
    backend(config({ impressum: false, privacy: true }));
    const first = renderApp('/', { demo: false, snapshots: fakeLibrary() });
    const legal = await within(footer()).findByRole('navigation', { name: 'Legal' });
    expect(
      within(legal)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Privacy']);
    first.unmount();

    for (const answer of [
      config({ impressum: false, privacy: false }),
      config(undefined),
      config({
        impressum: false,
        privacy: false,
        impressumUrl: 'javascript:alert(1)',
        privacyUrl: 'http://x.example.com/',
      }),
    ]) {
      backend(answer);
      const view = renderApp('/', { demo: false, snapshots: fakeLibrary() });
      await screen.findByText(/Backend version 0\.0\.0-test/);
      expect(within(footer()).queryByRole('navigation', { name: 'Legal' })).toBeNull();
      view.unmount();
    }
    stubBackend();
    renderApp('/', { demo: false, snapshots: fakeLibrary() });
    await screen.findByText(/The backend did not answer/);
    expect(within(footer()).queryByRole('navigation', { name: 'Legal' })).toBeNull();
  });

  it('has no legal links in the build-time demo mode, which never asks a backend', () => {
    const fetch = backend(config({ impressum: true, privacy: true }));
    renderApp('/', { demo: true, snapshots: fakeLibrary() });
    expect(within(footer()).queryByRole('navigation', { name: 'Legal' })).toBeNull();
    expect(fetch.fetch).not.toHaveBeenCalled();
  });
});

describe('/impressum and /privacy', () => {
  it('renders the Markdown, its first heading as the page title, and no HTML from the text', async () => {
    const fetch = backend(config({ impressum: true, privacy: true }, true));
    const { container } = renderApp('/impressum', { demo: false, snapshots: fakeLibrary() });
    const main = screen.getByRole('main');
    expect(await within(main).findByRole('heading', { level: 1, name: 'Impressum' })).toBeDefined();
    expect(document.title).toBe('Impressum · gcportrait');
    expect(within(main).getByRole('heading', { level: 2, name: 'Kontakt' })).toBeDefined();
    // Hard line breaks of an address.
    expect(main.querySelectorAll('p br')).toHaveLength(2);
    expect(within(main).getByRole('link', { name: 'mail@example.com' }).getAttribute('href')).toBe(
      'mailto:mail@example.com',
    );
    expect(within(main).getByRole('link', { name: 'example.com' }).getAttribute('href')).toBe(
      'https://example.com/',
    );
    // Raw HTML shows as its characters; nothing ran, nothing was made an element; the unsafe link lost its target.
    expect(main.textContent).toContain('<script>window.injected = true</script> <b>not bold</b> bad');
    expect(main.querySelector('script, b')).toBeNull();
    expect(within(main).queryByRole('link', { name: 'bad' })).toBeNull();
    expect((window as { injected?: unknown }).injected).toBeUndefined();
    expect(fetch.urls()).toEqual(['/api/config', '/api/legal']);
    await expectNoAxeViolations();

    // A text without a heading of its own gets the page's name; its headings move one level down. Its link to
    // /impressum stays in the app.
    await userEvent.click(within(footer()).getByRole('link', { name: 'Privacy' }));
    expect(await within(main).findByRole('heading', { level: 1, name: 'Privacy notice' })).toBeDefined();
    expect(within(main).getByRole('heading', { level: 2, name: 'Hosting' })).toBeDefined();
    expect(within(main).getByText('This demo stores nothing about you.')).toBeDefined();
    await userEvent.click(within(main).getByRole('link', { name: 'Impressum' }));
    await waitFor(() => {
      expect(currentLocation(container)).toBe('/impressum');
    });
    await expectNoAxeViolations();
  });

  it('says so when the instance publishes no such page, and fetches nothing', async () => {
    const fetch = backend(config({ impressum: false, privacy: false }));
    renderApp('/privacy', { demo: false, snapshots: fakeLibrary() });
    expect(await screen.findByText(/This instance publishes no privacy notice\./)).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeDefined();
    expect(fetch.urls()).toEqual(['/api/config']);
    await expectNoAxeViolations();
  });

  it('says so in the build-time demo mode too', () => {
    renderApp('/impressum', { demo: true, snapshots: fakeLibrary() });
    expect(screen.getByText(/This instance publishes no Impressum\./)).toBeDefined();
  });

  it('offers another try when the text could not be loaded', async () => {
    const fetch = backend(config({ impressum: true, privacy: false }), 'down');
    renderApp('/impressum', { demo: false, snapshots: fakeLibrary() });
    expect((await screen.findByRole('alert')).textContent).toBe('The text could not be loaded.');
    await expectNoAxeViolations();
    backend(config({ impressum: true, privacy: false }));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Kontakt' })).toBeDefined();
    expect(fetch.urls()).toEqual(['/api/config', '/api/legal']);
  });
});
