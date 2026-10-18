// SPDX-License-Identifier: MIT
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeLibrary } from '../snapshots/testing';
import { SnapshotJobError } from '../snapshots/worker/client';
import { expectNoAxeViolations } from '../test/axe';
import { currentLocation, renderApp } from '../test/renderApp';

/** The demo card of the Connect page in demo mode (a live instance's: ConnectPage.demoOnly.test.tsx). */
function demoCard(): HTMLElement {
  const region = screen.getByRole('region', { name: 'Demo mode' });
  const heading = within(region).getByRole('heading', { name: 'Demo organisations' });
  const card = heading.closest('li');
  if (card === null) throw new Error('the demo card');
  return card;
}

describe('Try the demo', () => {
  it('offers the four sizes, S first, and describes the chosen one', async () => {
    renderApp('/', { snapshots: fakeLibrary() });
    const card = demoCard();
    const sizes = within(card).getByRole('radiogroup', { name: 'Size' });
    expect(
      within(sizes)
        .getAllByRole('radio')
        .map((radio) => [radio.textContent, radio.getAttribute('aria-checked')]),
    ).toEqual([
      ['S', 'true'],
      ['M', 'false'],
      ['L', 'false'],
      ['XL', 'false'],
    ]);
    const button = within(card).getByRole('button', { name: 'Try the demo' });
    expect(button.getAttribute('aria-disabled')).toBeNull();
    const description = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('Demo organisation S (small): about 100 assets, 1 business unit.');
    await userEvent.click(within(sizes).getByRole('radio', { name: 'XL' }));
    expect(within(card).getByText(/Demo organisation XL \(extra large\): about 50,000 assets/)).toBeDefined();
    await expectNoAxeViolations();
  });

  it('generates the chosen size with progress, then opens it on the diagram', async () => {
    const snapshots = fakeLibrary();
    const { container } = renderApp('/', { snapshots });
    const card = demoCard();
    await userEvent.click(within(card).getByRole('radio', { name: 'M' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Try the demo' }));
    expect(snapshots.calls).toEqual(['tryDemo M']);
    const status = within(card).getByRole('status');
    expect(status.textContent).toBe('Starting with demo organisation M…');
    act(() => {
      snapshots.pending()?.onProgress?.({ stage: 'generate' });
    });
    expect(status.textContent).toBe('Generating demo organisation M and its 35 days of history…');
    expect(within(card).getByRole('progressbar', { name: 'Preparing the demo organisation' })).toBeDefined();
    expect(within(card).getByRole('button', { name: 'Try the demo' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(within(card).getByRole('radiogroup', { name: 'Size' }).getAttribute('aria-disabled')).toBe('true');
    await expectNoAxeViolations();
    act(() => {
      snapshots.pending()?.onProgress?.({ stage: 'store' });
    });
    expect(status.textContent).toBe('Storing in this browser…');
    await act(() => snapshots.answer({ ok: { ref: 'demo:M', persisted: true } }));
    await waitFor(() => {
      expect(currentLocation(container)).toBe('/diagram#snapshot=demo:M');
    });
  });

  it('a second click while it runs starts nothing', async () => {
    const snapshots = fakeLibrary();
    renderApp('/', { snapshots });
    const button = within(demoCard()).getByRole('button', { name: 'Try the demo' });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(snapshots.calls).toEqual(['tryDemo S']);
  });

  it('says what went wrong and stays on the page', async () => {
    const snapshots = fakeLibrary();
    const { container } = renderApp('/', { snapshots });
    const card = demoCard();
    await userEvent.click(within(card).getByRole('button', { name: 'Try the demo' }));
    await act(() => snapshots.answer({ error: new SnapshotJobError('The worker failed.', ['detail one']) }));
    const alert = await within(card).findByRole('alert');
    expect(alert.textContent).toBe(
      'The demo organisation could not be prepared.The worker failed.detail one',
    );
    expect(currentLocation(container)).toBe('/');
    expect(
      within(card).getByRole('button', { name: 'Try the demo' }).getAttribute('aria-disabled'),
    ).toBeNull();
    await expectNoAxeViolations();
  });
});
