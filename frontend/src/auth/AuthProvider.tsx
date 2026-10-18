// SPDX-License-Identifier: Apache-2.0
/**
 * Live mode's sign-in, mounted once inside the app store (App.tsx). On start it asks the backend for
 * its public configuration (GET /api/config) and puts the answer into the store's `connect.backend`; when the
 * answer names an OAuth client it creates the token session (session.ts), whose every state goes to
 * `connect.session`. The controls go to the page through `AuthContext` (`useAuth()`). Google's script is not
 * loaded here: only the first press of "Sign in with Google" loads it.
 *
 * A demo build (`pnpm dev:demo`, `pnpm demo:static`; api/demoConfig.ts) asks nothing: its built-in configuration,
 * a demo-only instance's, goes into `connect.backend` at once, and there is no sign-in. The permission check
 * (`connect.preflight`; "Pull now" relies on it) answered for one account: it is cleared on a sign-out and when
 * another account than the last one signs in (after an expiry or a sign-out), whichever page is open.
 */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

import { fetchPublicConfig, type PublicConfig } from '../api/config';
import { useAppMode } from '../mode';
import { IDLE_PREFLIGHT } from '../preflight/state';
import { useAppStore } from '../state';
import { AuthContext, NO_AUTH, type AuthControls } from './context';
import { loadGis, type GisOAuth2 } from './gis';
import { createTokenSession, type TokenSession } from './session';
import { fetchTokenInfo, type TokenInfo } from './tokeninfo';
import { anotherAccount, UNAVAILABLE_SESSION, type SessionAccount } from './types';

/** What the provider talks to; tests replace any of it. */
export interface AuthDependencies {
  readonly fetchConfig: (signal: AbortSignal) => Promise<PublicConfig | null>;
  readonly loadGis: () => Promise<GisOAuth2>;
  readonly tokenInfo: (accessToken: string, signal: AbortSignal) => Promise<TokenInfo>;
}

/**
 * Whether this is the static demo's bundle (VITE_STATIC_DEMO=1; api/demoConfig.ts). Written out as a comparison of
 * the variable Vite replaces at build time, so the static bundle's build sees a constant and leaves Google's sign-in
 * script, tokeninfo and /api/config out of it (`pnpm website:check` looks for their hosts).
 */
const STATIC_BUNDLE = import.meta.env.VITE_STATIC_DEMO === '1';

/** The static demo has nothing to talk to: never called there (the effect below returns first). */
const NOTHING: AuthDependencies = {
  fetchConfig: () => Promise.resolve(null),
  loadGis: () => Promise.reject(new Error('The static demo has no sign-in.')),
  tokenInfo: () => Promise.reject(new Error('The static demo has no sign-in.')),
};

const BROWSER: AuthDependencies = STATIC_BUNDLE
  ? NOTHING
  : { fetchConfig: fetchPublicConfig, loadGis: () => loadGis(), tokenInfo: fetchTokenInfo };

function controlsOf(session: TokenSession): AuthControls {
  return {
    signIn: session.signIn,
    renew: session.renew,
    signOut: session.signOut,
    accessToken: session.accessToken,
    rejected: session.rejected,
  };
}

export function AuthProvider({
  children,
  dependencies,
}: {
  readonly children: ReactNode;
  readonly dependencies?: Partial<AuthDependencies>;
}): ReactElement {
  const { demoConfig } = useAppMode();
  const store = useAppStore();
  const [controls, setControls] = useState<AuthControls>(NO_AUTH);
  const fetchConfig = dependencies?.fetchConfig ?? BROWSER.fetchConfig;
  const gis = dependencies?.loadGis ?? BROWSER.loadGis;
  const tokenInfo = dependencies?.tokenInfo ?? BROWSER.tokenInfo;

  useEffect(() => {
    if (STATIC_BUNDLE || demoConfig !== null) {
      store.updateConnect((connect) => ({
        ...connect,
        backend: demoConfig === null ? { status: 'unavailable' } : { status: 'ready', config: demoConfig },
        session: UNAVAILABLE_SESSION,
        mode: 'user',
      }));
      return;
    }
    const controller = new AbortController();
    let session: TokenSession | null = null;
    store.updateConnect((connect) => ({ ...connect, backend: { status: 'loading' } }));
    void fetchConfig(controller.signal).then((config) => {
      if (controller.signal.aborted) return;
      if (config === null) {
        store.updateConnect((connect) => ({
          ...connect,
          backend: { status: 'unavailable' },
          session: UNAVAILABLE_SESSION,
          mode: 'user',
        }));
        return;
      }
      store.updateConnect((connect) => ({
        ...connect,
        backend: { status: 'ready', config },
        mode: config.saMode ? connect.mode : 'user',
      }));
      if (config.oauthClientId === null) return;
      /** The account last signed in, kept through a sign-out: a check that settles after it is still theirs. */
      let lastAccount: SessionAccount | null = null;
      const created = createTokenSession({
        clientId: config.oauthClientId,
        loadGis: gis,
        tokenInfo,
        onChange: (state) => {
          const last = lastAccount;
          if (state.status === 'signed-in') lastAccount = state.account;
          store.updateConnect((connect) => ({
            ...connect,
            session: state,
            preflight:
              state.status === 'signed-out' || anotherAccount(last, connect.session, state)
                ? IDLE_PREFLIGHT
                : connect.preflight,
          }));
        },
      });
      session = created;
      store.updateConnect((connect) => ({ ...connect, session: created.state() }));
      setControls(controlsOf(created));
    });
    return () => {
      controller.abort();
      session?.dispose();
      setControls(NO_AUTH);
      store.updateConnect((connect) => ({ ...connect, session: UNAVAILABLE_SESSION }));
    };
  }, [demoConfig, store, fetchConfig, gis, tokenInfo]);

  return <AuthContext value={controls}>{children}</AuthContext>;
}
