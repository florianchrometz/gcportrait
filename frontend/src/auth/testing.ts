// SPDX-License-Identifier: MIT
/**
 * A stand-in for Google Identity Services in the unit tests: records what the app asks for and lets the test
 * answer as Google would (a token, an OAuth error, a blocked or closed window); the page's `window.google` for the
 * whole-app tests; sign-in controls that hand out a token; and a signed-in session. Imported by tests only.
 */
import { act, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { expect, onTestFinished } from 'vitest';

import { NO_AUTH, type AuthControls } from './context';
import type {
  GisClientError,
  GisOAuth2,
  GisRevokeResponse,
  GisTokenClientConfig,
  GisTokenRequest,
  GisTokenResponse,
} from './gis';
import { OAUTH_SCOPES } from './session';
import { SIGNED_OUT_SESSION, type SessionState } from './types';

export const TEST_CLIENT_ID = '12345678901-testclient.apps.googleusercontent.com';

/** Every scope gcportrait asks for, as Google lists a full grant. */
export const ALL_SCOPES = OAUTH_SCOPES.join(' ');

export interface FakeGis {
  /** `google.accounts.oauth2` for the session (or `{ accounts: { oauth2 } }` on `window.google`). */
  readonly oauth2: GisOAuth2;
  /** The token client's configuration, once the app made one. */
  readonly config: () => GisTokenClientConfig | null;
  /** Every `requestAccessToken` call, in order. */
  readonly requests: GisTokenRequest[];
  /** Every token revoked. */
  readonly revoked: string[];
  /** How the next revocations answer. */
  revokeAnswer: GisRevokeResponse;
  /** Google hands out a token (or an OAuth error) to the callback. */
  readonly respond: (response: GisTokenResponse) => void;
  /** GIS reports a window problem (`popup_failed_to_open`, `popup_closed`). */
  readonly fail: (type: string) => void;
}

export function fakeGis(): FakeGis {
  let config: GisTokenClientConfig | null = null;
  const fake: FakeGis = {
    oauth2: {
      initTokenClient: (next) => {
        config = next;
        return {
          requestAccessToken: (request) => {
            fake.requests.push(request ?? {});
          },
        };
      },
      revoke: (token, done) => {
        fake.revoked.push(token);
        done?.(fake.revokeAnswer);
      },
    },
    config: () => config,
    requests: [],
    revoked: [],
    revokeAnswer: { successful: true },
    respond: (response) => {
      if (config === null) throw new Error('No token client yet.');
      config.callback(response);
    },
    fail: (type) => {
      if (config === null) throw new Error('No token client yet.');
      const error: GisClientError = { type, message: type };
      config.error_callback(error);
    },
  };
  return fake;
}

/** A successful token answer, as GIS passes it to the callback. */
export function tokenResponse(
  accessToken: string,
  overrides: Partial<GisTokenResponse> = {},
): GisTokenResponse {
  return {
    access_token: accessToken,
    expires_in: 3599,
    scope: ALL_SCOPES,
    token_type: 'Bearer',
    ...overrides,
  };
}

type GoogleHost = { google?: unknown };

/** A fake GIS installed as the page's `window.google` (as Google's script leaves it), removed after the test. */
export function installGis(): FakeGis {
  const gis = fakeGis();
  (window as GoogleHost).google = { accounts: { oauth2: gis.oauth2 } };
  onTestFinished(() => {
    delete (window as GoogleHost).google;
  });
  return gis;
}

/** Presses a "Sign in with Google" `button` and answers GIS's token request with `accessToken`. */
export async function signInThroughGis(
  gis: FakeGis,
  button: HTMLElement,
  accessToken = 'secret-token-1',
): Promise<void> {
  const asked = gis.requests.length;
  await userEvent.click(button);
  await waitFor(() => {
    expect(gis.requests).toHaveLength(asked + 1);
  });
  await act(async () => {
    gis.respond(tokenResponse(accessToken));
    await Promise.resolve();
  });
}

/** A synthetic access token (agents.md, Data and graph semantics). */
export const TEST_TOKEN = 'ya29.synthetic-test-token';

/** Sign-in controls that hand out `token` (none: signed out) and record what the backend refused. */
export function testAuth(
  token: string | null = TEST_TOKEN,
): AuthControls & { readonly rejectedTokens: string[] } {
  const rejectedTokens: string[] = [];
  return {
    ...NO_AUTH,
    accessToken: () => token,
    rejected: (value) => {
      rejectedTokens.push(value);
    },
    rejectedTokens,
  };
}

/** The session of ada@example.com, signed in for the next hour. */
export function signedInSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    ...SIGNED_OUT_SESSION,
    status: 'signed-in',
    expiresAt: Date.now() + 3_600_000,
    account: { email: 'ada@example.com' },
    ...overrides,
  };
}
