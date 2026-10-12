// SPDX-License-Identifier: MIT
/**
 * The Connect page of a demo-only instance (the backend's DEMO_ONLY, ADR 0032), whether its
 * configuration comes from /api/config or is built in (the static demo, ADR 0034): only "Try the demo" with its four
 * sizes, the call to deploy gcportrait to one's own project, the notice that the demo processes no personal data; no
 * sign-in, no export, no backend section; and while /api/config is on its way, nothing of the live sources flashes
 * up. Also the top bar's badge and the Permissions page's note. And the Connect page of a live instance, for
 * contrast: the demo while the backend is asked, then every source.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PublicConfig } from '../api/config';
import { NON_AFFILIATION_LONG } from '../branding';
import { SELF_HOST_GUIDE_URL } from '../projectSite';
import { fakeLibrary } from '../snapshots/testing';
import { expectNoAxeViolations } from '../test/axe';
import {
  publicConfig,
  STATIC_DEMO,
  staticDemoConfig,
  stubBackend,
  type StubbedBackend,
} from '../test/backend';
import { renderApp } from '../test/renderApp';

const DEMO_ONLY: PublicConfig = publicConfig({
  saStrictExposure: false,
  version: '0.0.0-demo',
  hostedBy: null,
  demoOnly: true,
  legal: { impressum: true, privacy: true },
});

/** Where a demo-only instance's configuration comes from, and what differs between the two. */
interface ConfigSource {
  readonly name: string;
  /** Renders the app at `path`; the backend's answers wait for `release()`. */
  readonly open: (path: string) => StubbedBackend;
  /** Whether the app knows it is demo-only on the first render, before any answer. */
  readonly atOnce: boolean;
  /** The privacy notice's link: the instance's own page, or the operator's site in a new tab. */
  readonly privacy: { readonly name: string; readonly href: string; readonly external: boolean };
  /** Every request the page makes. */
  readonly requests: readonly string[];
}

const SOURCES: readonly ConfigSource[] = [
  {
    name: 'answered by /api/config',
    open: (path) => {
      const backend = stubBackend({ config: DEMO_ONLY, held: true });
      renderApp(path, { demo: false, snapshots: fakeLibrary() });
      return backend;
    },
    atOnce: false,
    privacy: { name: 'privacy notice', href: '/privacy', external: false },
    requests: ['/api/config'],
  },
  {
    name: 'built in (the static demo)',
    open: (path) => {
      const backend = stubBackend();
      renderApp(path, { demo: false, staticConfig: staticDemoConfig(), snapshots: fakeLibrary() });
      return backend;
    },
    // A demo-only instance from the first render, without asking anything.
    atOnce: true,
    privacy: {
      name: 'privacy notice (opens operator.example.com in a new tab)',
      href: STATIC_DEMO.privacy,
      external: true,
    },
    requests: [],
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Connect page of a demo-only instance', () => {
  it.each(SOURCES)(
    'offers only the demo, the way to one’s own project and the privacy notice ($name)',
    async (source) => {
      const backend = source.open('/');
      // Before any answer: the demo only, nothing of the live sources.
      expect(
        screen.getByRole('region', { name: source.atOnce ? 'Demo mode' : 'Choose a source' }),
      ).toBeDefined();
      expect(screen.getByRole('button', { name: 'Try the demo' })).toBeDefined();
      expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Cloud Asset Inventory export' })).toBeNull();
      backend.release();

      const sources = await screen.findByRole('region', { name: 'Demo mode' });
      expect(within(sources).getAllByRole('listitem')).toHaveLength(1);
      expect(within(sources).getByRole('heading', { name: 'Demo organisations' })).toBeDefined();
      expect(
        within(within(sources).getByRole('radiogroup', { name: 'Size' }))
          .getAllByRole('radio')
          .map((radio) => radio.textContent),
      ).toEqual(['S', 'M', 'L', 'XL']);
      expect(
        within(sources).getByRole('button', { name: 'Try the demo' }).getAttribute('aria-disabled'),
      ).toBeNull();

      const selfHost = screen.getByRole('region', { name: 'Your own Google Cloud' });
      const cta = within(selfHost).getByRole('link', {
        name: 'Deploy gcportrait to your own Google Cloud project',
      });
      expect(cta.getAttribute('href')).toBe(SELF_HOST_GUIDE_URL);
      expect(SELF_HOST_GUIDE_URL).toBe('https://gcportrait.app/docs/self-host/');
      expect(selfHost.textContent).toContain('one-line installer');

      const privacy = screen.getByRole('region', { name: 'No personal data' });
      expect(privacy.textContent).toContain('This demo processes no personal data');
      const link = within(privacy).getByRole('link', { name: source.privacy.name });
      expect(link.getAttribute('href')).toBe(source.privacy.href);
      if (source.privacy.external) {
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener');
      }

      // No sign-in, no export, no environment, no backend section; the About block with the non-affiliation
      // long form stays.
      expect(screen.queryByRole('region', { name: 'Choose a source' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Choose files…' })).toBeNull();
      expect(screen.queryByRole('region', { name: 'Backend' })).toBeNull();
      expect(screen.queryByRole('region', { name: 'Read your environment' })).toBeNull();
      expect(
        within(screen.getByRole('region', { name: 'About' })).getByText(NON_AFFILIATION_LONG),
      ).toBeDefined();
      expect(screen.getByTestId('demo-badge').textContent).toBe('Demo mode');
      expect(backend.urls()).toEqual(source.requests);
      await expectNoAxeViolations();
    },
  );

  it('leaves the privacy link out when the instance publishes no privacy notice', async () => {
    stubBackend({ config: { ...DEMO_ONLY, legal: { impressum: false, privacy: false } } });
    renderApp('/', { demo: false, snapshots: fakeLibrary() });
    const privacy = await screen.findByRole('region', { name: 'No personal data' });
    expect(within(privacy).queryByRole('link')).toBeNull();
  });

  it.each(SOURCES)(
    'says on the Permissions page that nothing can be checked here ($name)',
    async (source) => {
      const backend = source.open('/permissions');
      const note = /This instance is a demo: its organisations are made up in this browser/;
      // The static demo says so on the first render; with /api/config, once it has answered.
      if (source.atOnce) expect(screen.getByText(note)).toBeDefined();
      backend.release();
      expect(await screen.findByText(note)).toBeDefined();
      expect(screen.queryByRole('region', { name: 'Check a scope' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
      expect(backend.urls()).toEqual(source.requests);
      await expectNoAxeViolations();
    },
  );
});

describe('the Connect page of a live instance', () => {
  it('shows the demo while the backend is asked, then every source', async () => {
    const backend = stubBackend({
      config: { ...DEMO_ONLY, demoOnly: false, legal: { impressum: false, privacy: false } },
      held: true,
    });
    renderApp('/', { demo: false, snapshots: fakeLibrary() });
    const sources = screen.getByRole('region', { name: 'Choose a source' });
    expect(within(sources).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Your own Google Cloud' })).toBeNull();
    // The demo card works before the backend answers: its sizes are offered and "Try the demo" is live.
    expect(within(sources).getByRole('radiogroup', { name: 'Size' })).toBeDefined();
    expect(
      within(sources).getByRole('button', { name: 'Try the demo' }).getAttribute('aria-disabled'),
    ).toBeNull();
    backend.release();
    await waitFor(() => {
      expect(
        within(sources)
          .getAllByRole('heading', { level: 3 })
          .map((heading) => heading.textContent),
      ).toEqual(['Your Google Cloud environment', 'Demo organisations', 'Cloud Asset Inventory export']);
    });
    expect(
      within(sources)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([
      'Sign in with Google',
      'Try the demo',
      // The export card's panel, last and across the row (import/LoadExport.tsx): files, Cloud Storage and the
      // optional sidecar.
      'Choose files…',
      'Read from Cloud Storage',
      'Add operation.json…',
      // The Copy buttons of the gcloud commands, in the folded "How to make an export with gcloud" (jsdom lists them).
      'Copy',
      'Copy',
      'Copy',
    ]);
    // The demo card works here too, with its sizes.
    expect(within(sources).getByRole('radiogroup', { name: 'Size' })).toBeDefined();
    expect(
      within(sources).getByRole('button', { name: 'Try the demo' }).getAttribute('aria-disabled'),
    ).toBeNull();
    expect(screen.queryByRole('region', { name: 'Your own Google Cloud' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'No personal data' })).toBeNull();
    expect(screen.queryByTestId('demo-badge')).toBeNull();
  });
});
