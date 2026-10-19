// SPDX-License-Identifier: Apache-2.0
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderApp } from '../test/renderApp';

describe('the Settings page’s licences', () => {
  it('links gcportrait’s licence and the third-party notices the build ships', () => {
    renderApp('/settings');
    const section = screen.getByRole('region', { name: 'Licences' });
    const href = (name: string): string | null =>
      within(section).getByRole('link', { name }).getAttribute('href');
    expect(href('licence')).toBe('/licenses/gcportrait-LICENSE.txt');

    expect(href('third-party notices')).toBe('/licenses/THIRD_PARTY_NOTICES.txt');
    expect(section.textContent).toContain('gcportrait is open source under the Apache License 2.0');
    expect(section.textContent).toContain('The gcportrait name and icon are not covered by it.');
    expect(within(section).queryByRole('link', { name: 'notice' })).toBeNull();
  });

  it('offers Demo organisations on the Settings page when signed out', () => {
    renderApp('/settings');
    const demo = screen.getByRole('region', { name: 'Demo organisations' });
    expect(within(demo).getByRole('radiogroup', { name: 'Size' })).toBeDefined();
    expect(within(demo).getByRole('button', { name: 'Try the demo' })).toBeDefined();
  });
});
