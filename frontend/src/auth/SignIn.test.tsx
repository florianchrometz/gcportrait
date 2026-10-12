// SPDX-License-Identifier: MIT
/**
 * Sign-in in the whole app, live mode, with GIS and Google's tokeninfo stood in for: the Connect page's
 * card, the top bar's account menu, the mode selector, expiry, sign-out, a press that brings a lost Google window
 * back, and a page that never loads Google's script unless someone presses "Sign in with Google".
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PublicConfig } from '../api/config';
import { fakeLibrary } from '../snapshots/testing';
import { expectNoAxeViolations } from '../test/axe';
import { publicConfig, stubBackend, type StubbedBackend } from '../test/backend';
import { renderApp } from '../test/renderApp';
import { GIS_SCRIPT_URL } from './gis';
import { hostedByLine } from './labels';
import { installGis, signInThroughGis, TEST_CLIENT_ID, tokenResponse, type FakeGis } from './testing';
import { TOKENINFO_URL } from './tokeninfo';

type GoogleHost = { google?: unknown };

const CONFIG: PublicConfig = publicConfig({
  oauthClientId: TEST_CLIENT_ID,
  saMode: true,
  backendServiceAccount: 'gcportrait-backend@example.com',
  hostedBy: 'Hosted by Example Ltd.',
});

/** A live instance with `config`, Google's tokeninfo naming ada@example.com, and GIS on the page. */
function live(config: PublicConfig = CONFIG): { gis: FakeGis; backend: StubbedBackend } {
  const gis = installGis();
  const backend = stubBackend({
    config,
    routes: { [TOKENINFO_URL]: () => Response.json({ aud: TEST_CLIENT_ID, email: 'ada@example.com' }) },
  });
  return { gis, backend };
}

function sourceCard(): HTMLElement {
  const region = screen.getByRole('region', { name: 'Choose a source' });
  const card = within(region).getByRole('heading', { name: 'Your Google Cloud environment' }).closest('li');
  if (card === null) throw new Error('the sign-in card');
  return card;
}

/** The card's "Sign in with Google" once the backend has answered and the button works. */
async function signInButton(): Promise<HTMLElement> {
  return waitFor(() => {
    const button = within(sourceCard()).getByRole('button', { name: 'Sign in with Google' });
    expect(button.getAttribute('aria-disabled')).toBeNull();
    return button;
  });
}

async function signIn(gis: FakeGis): Promise<void> {
  await signInThroughGis(gis, await signInButton());
  await screen.findByRole('button', { name: 'ada@example.com' });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('who runs the instance (hostedByLine)', () => {
  it('is the backend’s "Hosted by" line alone, or nothing; an older backend’s short line is cut off', () => {
    const config = (hostedBy: string | null): PublicConfig => ({ ...CONFIG, hostedBy });
    // An older backend that sends no `hostedBy` at all.
    const older: PublicConfig = Object.fromEntries(
      Object.entries(CONFIG).filter(([key]) => key !== 'hostedBy'),
    ) as PublicConfig;
    expect(hostedByLine(config('Hosted by Example Ltd.'))).toBe('Hosted by Example Ltd.');
    expect(hostedByLine(config(null))).toBeNull();
    expect(hostedByLine(older)).toBeNull();
    expect(hostedByLine(null)).toBeNull();
    // What backends before 2026-10-12 sent (ADR 0018 then put the short line here; now only the footers carry it).
    expect(hostedByLine(config('Hosted by Example Ltd. Not affiliated with Google / Google Cloud.'))).toBe(
      'Hosted by Example Ltd.',
    );
    expect(hostedByLine(config('Not affiliated with Google / Google Cloud.'))).toBeNull();
  });
});

describe('sign-in on the Connect page', () => {
  it('signs in, names the account in the top bar and moves on to reading the environment', async () => {
    const { gis, backend } = live();
    renderApp('/', { demo: false, snapshots: fakeLibrary() });
    // The card arrives with the backend's answer (until then the Connect page shows the demo only).
    const card = await waitFor(sourceCard);
    expect(await within(card).findByText(CONFIG.hostedBy ?? '')).toBeDefined();
    expect(
      within(card).getByText(/Google will ask you to let gcportrait view your Google Cloud data/),
    ).toBeDefined();
    await signIn(gis);
    expect(gis.config()?.client_id).toBe(TEST_CLIENT_ID);
    expect(within(card).getByText(/Signed in as/).textContent).toBe('Signed in as ada@example.com.');
    const heading = screen.getByRole('heading', { name: 'Read your environment' });
    expect(document.activeElement).toBe(heading);
    const modes = screen.getByRole('radiogroup', { name: 'Read with' });
    expect(
      within(modes)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Your account', 'Service account']);
    // The scope and "Pull now" follow in the same section; their own tests cover them.
    await expectNoAxeViolations();
    // One configuration request per page: the footer's source link reads the same answer from the store.
    expect(backend.urls().filter((url) => url === '/api/config')).toHaveLength(1);
  });

  it('explains the service-account gate when that mode is chosen', async () => {
    const { gis } = live();
    renderApp('/', { demo: false, snapshots: fakeLibrary() });
    await signIn(gis);
    await userEvent.click(screen.getByRole('radio', { name: 'Service account' }));
    expect(screen.getByRole('radio', { name: 'Service account' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('gcportrait-backend@example.com')).toBeDefined();
    expect(screen.getByText(/before every read the backend checks that with your own sign-in/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'How service-account mode works' }).getAttribute('href')).toBe(
      '/permissions',
    );
    await expectNoAxeViolations();
  });

  it('offers only the own account when the backend has no service-account mode', async () => {
    const { gis } = live({ ...CONFIG, saMode: false, backendServiceAccount: null });
    renderApp('/', { demo: false, snapshots: fakeLibrary() });
    await signIn(gis);
    expect(screen.queryByRole('radiogroup', { name: 'Read with' })).toBeNull();
    expect(screen.getByText(/This instance does not offer service-account mode/)).toBeDefined();
  });

  it('signs out from the account menu: revokes the token and offers sign-in again', async () => {
    const { gis } = live();
    renderApp('/', { demo: false, snapshots: fakeLibrary() });
    await signIn(gis);
    const banner = screen.getByRole('banner');
    await userEvent.click(within(banner).getByRole('button', { name: 'ada@example.com' }));
    const panel = screen.getByRole('dialog', { name: 'Account' });
    expect(within(panel).getByText(/Signed in with Google until \d\d:\d\d/)).toBeDefined();
    await expectNoAxeViolations();
    await userEvent.click(within(panel).getByRole('button', { name: 'Sign out' }));
    expect(gis.revoked).toEqual(['secret-token-1']);
    expect(within(banner).queryByRole('button', { name: 'ada@example.com' })).toBeNull();
    expect(within(sourceCard()).getByRole('button', { name: 'Sign in with Google' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Read your environment' })).toBeNull();
    expect(document.activeElement?.id).toBe('main');
  });

  it('signs out from the card and puts focus on "Sign in with Google"', async () => {
    const { gis } = live();
    renderApp('/', { demo: false, snapshots: fakeLibrary() });
    await signIn(gis);
    await userEvent.click(within(sourceCard()).getByRole('button', { name: 'Sign out' }));
    expect(gis.revoked).toEqual(['secret-token-1']);
    expect(document.activeElement).toBe(
      within(sourceCard()).getByRole('button', { name: 'Sign in with Google' }),
    );
  });

  it('shows a refused sign-in as an alert next to the button', async () => {
    const { gis } = live();
    renderApp('/', { demo: false, snapshots: fakeLibrary() });
    await userEvent.click(await signInButton());
    await waitFor(() => {
      expect(gis.requests).toHaveLength(1);
    });
    act(() => {
      gis.fail('popup_failed_to_open');
    });
    const alert = within(sourceCard()).getByRole('alert');
    expect(alert.textContent).toMatch(/blocked Google’s sign-in window/);
    await expectNoAxeViolations();
  });

  it('asks Google again when the button is pressed while its window is open', async () => {
    const { gis } = live();
    renderApp('/', { demo: false, snapshots: fakeLibrary() });
    await userEvent.click(await signInButton());
    await waitFor(() => {
      expect(gis.requests).toHaveLength(1);
    });
    expect(within(sourceCard()).getByRole('status').textContent).toBe(
      'Waiting for Google’s sign-in window… If you cannot find it, press the button again.',
    );
    // The window got lost behind others: the button still works, and GIS brings its window back.
    await userEvent.click(await signInButton());
    await waitFor(() => {
      expect(gis.requests).toEqual([{ prompt: 'select_account' }, { prompt: 'select_account' }]);
    });
    await act(async () => {
      gis.respond(tokenResponse('secret-token-1'));
      await Promise.resolve();
    });
    await screen.findByRole('button', { name: 'ada@example.com' });
    await expectNoAxeViolations();
  });

  it('never loads Google’s script without a press, and keeps the button inert without an OAuth client', async () => {
    live({ ...CONFIG, oauthClientId: null });
    delete (window as GoogleHost).google;
    renderApp('/', { demo: false, snapshots: fakeLibrary() });
    await screen.findByText(
      'Backend version 0.0.0-test. Google sign-in is not configured; service-account mode is on.',
    );
    const button = within(sourceCard()).getByRole('button', { name: 'Sign in with Google' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(
      within(sourceCard()).getByText('Google sign-in is not configured on this instance.'),
    ).toBeDefined();
    await userEvent.click(button);
    expect(document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`)).toBeNull();
    await expectNoAxeViolations();
  });
});

describe('expiry', () => {
  it('says the sign-in ended, in the top bar and on the page, and signs in again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { gis } = live();
    renderApp('/', { demo: false, snapshots: fakeLibrary() });
    await signIn(gis);
    // The silent renewal is blocked (as a browser does without a click): the menu offers "Stay signed in".
    await act(async () => {
      await vi.advanceTimersByTimeAsync(56 * 60_000);
    });
    act(() => {
      gis.fail('popup_failed_to_open');
    });
    const banner = screen.getByRole('banner');
    const menuButton = within(banner).getByRole('button', {
      name: /^ada@example\.com\s*\(ends \d\d:\d\d\)$/,
    });
    const said = (): string[] =>
      within(banner)
        .getAllByRole('status')
        .map((status) => status.textContent);
    expect(said()).toContainEqual(expect.stringMatching(/ends at \d\d:\d\d\. Open the account menu/));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(menuButton.isConnected).toBe(true);
    expect(within(banner).getByRole('button', { name: 'Session expired' })).toBeDefined();
    expect(said()).toContain('Your Google sign-in ended. Sign in again to continue.');
    const card = sourceCard();
    expect(within(card).getByText(/Your Google sign-in as/).textContent).toMatch(/ada@example\.com ended/);
    expect(screen.getByRole('radiogroup', { name: 'Read with' }).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(within(card).getByRole('button', { name: 'Sign in again' }), {
      advanceTimers: vi.advanceTimersByTime,
    });
    await waitFor(() => {
      expect(gis.requests.at(-1)).toEqual({ prompt: 'select_account' });
    });
    await act(async () => {
      gis.respond(tokenResponse('secret-token-2'));
      await Promise.resolve();
    });
    await within(banner).findByRole('button', { name: 'ada@example.com' });
  });
});
