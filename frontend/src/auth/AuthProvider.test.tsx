// SPDX-License-Identifier: MIT
/**
 * The provider's part of the sign-in: it fills the store's `connect` slice from the backend and the
 * session, and it clears the permission check (`connect.preflight`) that answered for one account on a
 * sign-out and when another account signs in, whichever page is open (no Permissions page is mounted here).
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import type { PublicConfig } from '../api/config';
import { AppModeContext } from '../mode';
import type { PreflightState } from '../preflight/state';
import { DEFAULT_SOURCE_URL } from '../source';
import { AppStateProvider, useAppStore, type AppStore } from '../state';
import { publicConfig } from '../test/backend';
import { AuthProvider } from './AuthProvider';
import { useAuth, type AuthControls } from './context';
import { RENEW_BEFORE_MS } from './session';
import { fakeGis, TEST_CLIENT_ID, tokenResponse } from './testing';
import type { TokenInfo } from './tokeninfo';

const CONFIG: PublicConfig = publicConfig({ oauthClientId: TEST_CLIENT_ID });

const CHECKED: PreflightState = {
  status: 'failed',
  request: { scope: 'projects/demo-web-1', mode: 'user' },
  message: 'The quota project cannot pay for the requests.',
};

const HOUR = 3_600_000;

/** `emails`: what tokeninfo says for each token (no entry: no email); `offline`: tokens it does not answer for. */
function mount(emails: Readonly<Record<string, string>>, offline: readonly string[] = []) {
  const gis = fakeGis();
  let store: AppStore | null = null;
  let auth: AuthControls | null = null;
  function Probe() {
    store = useAppStore();
    auth = useAuth();
    return null;
  }
  render(
    <MemoryRouter initialEntries={['/']}>
      <AppModeContext value={{ demo: false, sourceUrl: DEFAULT_SOURCE_URL }}>
        <AppStateProvider>
          <AuthProvider
            dependencies={{
              fetchConfig: () => Promise.resolve(CONFIG),
              loadGis: () => Promise.resolve(gis.oauth2),
              tokenInfo: (token): Promise<TokenInfo> =>
                offline.includes(token)
                  ? Promise.reject(new TypeError('offline'))
                  : Promise.resolve({ audience: TEST_CLIENT_ID, email: emails[token] ?? null }),
            }}
          >
            <Probe />
          </AuthProvider>
        </AppStateProvider>
      </AppModeContext>
    </MemoryRouter>,
  );
  const connect = () => {
    if (store === null) throw new Error('no store');
    return store.getState().connect;
  };
  const controls = (): AuthControls => {
    if (auth === null) throw new Error('no auth');
    return auth;
  };
  const signIn = async (token: string): Promise<void> => {
    act(() => {
      controls().signIn();
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => {
      gis.respond(tokenResponse(token));
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
  };
  const signOut = (): void => {
    act(() => {
      controls().signOut();
    });
  };
  /** A check that settles now (also one that was still under way when the person signed out). */
  const check = (): void => {
    act(() => {
      store?.updateConnect((current) => ({ ...current, preflight: CHECKED }));
    });
  };
  return { gis, connect, signIn, signOut, check };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AuthProvider', () => {
  it('puts the backend and the session into the store, never the token', async () => {
    const app = mount({ 'token-1': 'ada@example.com' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(app.connect().backend).toEqual({ status: 'ready', config: CONFIG });
    expect(app.connect().session.status).toBe('signed-out');
    await app.signIn('token-1');
    expect(app.connect().session).toMatchObject({
      status: 'signed-in',
      account: { email: 'ada@example.com' },
    });
    expect(JSON.stringify(app.connect())).not.toContain('token-1');
  });

  it('clears the permission check when another account signs in after an expiry', async () => {
    const app = mount({ 'token-1': 'ada@example.com', 'token-2': 'grace@example.com' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    await app.signIn('token-1');
    app.check();
    await act(() => vi.advanceTimersByTimeAsync(HOUR));
    expect(app.connect().session.status).toBe('expired');
    // The same person may come back: the check stays on screen meanwhile.
    expect(app.connect().preflight).toEqual(CHECKED);
    await app.signIn('token-2');
    expect(app.connect().session).toMatchObject({
      status: 'signed-in',
      account: { email: 'grace@example.com' },
    });
    expect(app.connect().preflight).toEqual({ status: 'idle' });
  });

  it('clears the permission check on a sign-out', async () => {
    const app = mount({ 'token-1': 'ada@example.com' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    await app.signIn('token-1');
    app.check();
    app.signOut();
    expect(app.connect().session.status).toBe('signed-out');
    expect(app.connect().preflight).toEqual({ status: 'idle' });
  });

  it('clears a check that settled after a sign-out when another account signs in', async () => {
    const app = mount({ 'token-1': 'ada@example.com', 'token-2': 'grace@example.com' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    await app.signIn('token-1');
    app.signOut();
    // Ada's check, started on the Permissions page and left there, settles after her sign-out.
    app.check();
    await app.signIn('token-2');
    expect(app.connect().session).toMatchObject({
      status: 'signed-in',
      account: { email: 'grace@example.com' },
    });
    expect(app.connect().preflight).toEqual({ status: 'idle' });
  });

  it('clears the check for a sign-in after an expiry whose account tokeninfo does not name', async () => {
    const app = mount({ 'token-1': 'ada@example.com', 'token-2': 'grace@example.com' }, ['token-2']);
    await act(() => vi.advanceTimersByTimeAsync(0));
    await app.signIn('token-1');
    app.check();
    await act(() => vi.advanceTimersByTimeAsync(HOUR));
    await app.signIn('token-2');
    // Not Ada's address for what may be another account's token.
    expect(app.connect().session).toMatchObject({ status: 'signed-in', account: { email: null } });
    expect(app.connect().preflight).toEqual({ status: 'idle' });
  });

  it('keeps the permission check through a renewal', async () => {
    const app = mount({ 'token-1': 'ada@example.com', 'token-2': 'ada@example.com' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    await app.signIn('token-1');
    app.check();
    await act(() => vi.advanceTimersByTimeAsync(HOUR - RENEW_BEFORE_MS));
    expect(app.connect().session.renewal).toBe('renewing');
    act(() => {
      app.gis.respond(tokenResponse('token-2'));
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(app.connect().session).toMatchObject({ status: 'signed-in', renewal: 'idle' });
    expect(app.connect().preflight).toEqual(CHECKED);
  });

  it('keeps the permission check when the same account signs in again', async () => {
    const app = mount({ 'token-1': 'ada@example.com', 'token-2': 'ada@example.com' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    await app.signIn('token-1');
    app.check();
    await act(() => vi.advanceTimersByTimeAsync(HOUR));
    await app.signIn('token-2');
    expect(app.connect().session).toMatchObject({
      status: 'signed-in',
      account: { email: 'ada@example.com' },
    });
    expect(app.connect().preflight).toEqual(CHECKED);
  });
});
