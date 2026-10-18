// SPDX-License-Identifier: MIT
/**
 * The static demo (`pnpm demo:static`): the app as a demo build with its configuration built in
 * (api/demoConfig.ts), on a host with no backend. It asks nothing of anyone: the footer links the Impressum and the
 * privacy notice on another site, and /impressum and /privacy lead there. Its Connect page and the Permissions
 * page's note are a demo-only instance's from the first render: ConnectPage.demoOnly.test.tsx checks them for both
 * sources of the configuration.
 */
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeLibrary } from '../snapshots/testing';
import { expectNoAxeViolations } from '../test/axe';
import { STATIC_DEMO, staticDemoConfig, stubBackend, type StubbedBackend } from '../test/backend';
import { renderApp } from '../test/renderApp';

let backend: StubbedBackend;

beforeEach(() => {
  // No backend: any request fails, and the tests check that none was made.
  backend = stubBackend();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderStatic(path: string): void {
  renderApp(path, { demoConfig: staticDemoConfig(), snapshots: fakeLibrary() });
}

describe('the static demo', () => {
  it('links the source and the legal pages elsewhere from the footer', () => {
    renderStatic('/settings');
    const footer = screen.getByRole('contentinfo');
    expect(
      within(footer)
        .getAllByRole('link')
        .map((link) => [link.getAttribute('aria-label') ?? link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Florian Chrometz (personal website)', 'https://florian-chrometz.de'],
      ['Source (MIT)', STATIC_DEMO.source],
      ['Impressum (opens operator.example.com in a new tab)', STATIC_DEMO.impressum],
      ['Privacy (opens operator.example.com in a new tab)', STATIC_DEMO.privacy],
    ]);
    const legal = within(footer).getByRole('navigation', { name: 'Legal' });
    for (const link of within(legal).getAllByRole('link')) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener');
    }
    expect(backend.fetch).not.toHaveBeenCalled();
  });

  it('leads from /impressum and /privacy to the pages elsewhere', async () => {
    renderStatic('/impressum');
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Impressum' })).toBeDefined();
    expect(main.textContent).toContain('The Impressum is published on operator.example.com');
    const link = within(main).getByRole('link', {
      name: `${STATIC_DEMO.impressum} (opens operator.example.com in a new tab)`,
    });
    expect(link.getAttribute('href')).toBe(STATIC_DEMO.impressum);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
    await expectNoAxeViolations();
    expect(backend.fetch).not.toHaveBeenCalled();
  });
});
