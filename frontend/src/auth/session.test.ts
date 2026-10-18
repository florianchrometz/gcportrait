// SPDX-License-Identifier: Apache-2.0
/**
 * The token lifecycle with a fake GIS and fake timers: sign-in, the scope and account checks, silent
 * renewal before expiry and its fallback, expiry as a clear state, rejection, sign-out with revocation, and that
 * no state the app sees ever carries the token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_LOOKUP_TIMEOUT_MS,
  createTokenSession,
  EXPIRY_MARGIN_MS,
  OAUTH_SCOPES,
  RENEW_BEFORE_MS,
  RENEWAL_GUARD_MS,
  SCOPE_CLOUD_ASSET,
  SCOPE_CLOUD_PLATFORM_READ_ONLY,
  SCOPE_EMAIL,
} from './session';
import { fakeGis, signedInSession, TEST_CLIENT_ID, tokenResponse } from './testing';
import { TokenRefusedError, type TokenInfo } from './tokeninfo';
import { anotherAccount, SIGNED_OUT_SESSION, type SessionState } from './types';

const START = Date.parse('2026-10-10T12:00:00Z');
const HOUR = 3_600_000;
const EMAIL = 'ada@example.com';

type LookUp = (accessToken: string, signal: AbortSignal) => Promise<TokenInfo>;

function setup(tokenInfo?: LookUp) {
  const gis = fakeGis();
  const states: SessionState[] = [];
  const loadGis = vi.fn(() => Promise.resolve(gis.oauth2));
  const lookUp = vi.fn<LookUp>(
    tokenInfo ?? (() => Promise.resolve({ audience: TEST_CLIENT_ID, email: EMAIL })),
  );
  const session = createTokenSession({
    clientId: TEST_CLIENT_ID,
    loadGis,
    tokenInfo: lookUp,
    onChange: (state) => states.push(state),
  });
  const last = (): SessionState => {
    const state = states.at(-1);
    if (state === undefined) throw new Error('no state yet');
    return state;
  };
  return { gis, states, loadGis, lookUp, session, last };
}

/** A tokeninfo lookup that never answers, and gives up when its signal is aborted (the timeout, a sign-out). */
const hangingLookUp: LookUp = (_token, signal) =>
  new Promise<TokenInfo>((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'));
    });
  });

/** Lets promise callbacks run (the GIS load, the account lookup) without moving the clock. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

async function signIn(
  context: ReturnType<typeof setup>,
  accessToken = 'token-1',
  expiresIn = 3600,
): Promise<void> {
  context.session.signIn();
  await settle();
  context.gis.respond(tokenResponse(accessToken, { expires_in: expiresIn }));
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sign-in', () => {
  it('starts signed out and loads GIS only when someone signs in', async () => {
    const context = setup();
    expect(context.session.state().status).toBe('signed-out');
    expect(context.loadGis).not.toHaveBeenCalled();
    context.session.signIn();
    expect(context.last()).toMatchObject({ status: 'signing-in', account: null, problem: null });
    await settle();
    expect(context.loadGis).toHaveBeenCalledTimes(1);
    expect(context.gis.config()).toMatchObject({ client_id: TEST_CLIENT_ID, scope: OAUTH_SCOPES.join(' ') });
    expect(context.gis.requests).toEqual([{ prompt: 'select_account' }]);
  });

  it('asks for read-only Cloud Platform, Cloud Asset and the email address, never all of Cloud Platform', () => {
    expect(OAUTH_SCOPES).toEqual([
      'https://www.googleapis.com/auth/cloud-platform.read-only',
      'https://www.googleapis.com/auth/cloudasset',
      'https://www.googleapis.com/auth/userinfo.email',
    ]);
    expect([SCOPE_CLOUD_PLATFORM_READ_ONLY, SCOPE_CLOUD_ASSET, SCOPE_EMAIL]).toEqual([...OAUTH_SCOPES]);
  });

  it('reads the account, then holds the token in memory and never hands it to a state', async () => {
    const context = setup();
    await signIn(context);
    expect(context.lookUp).toHaveBeenCalledWith('token-1', expect.any(AbortSignal));
    expect(context.last()).toEqual({
      status: 'signed-in',
      account: { email: EMAIL },
      expiresAt: START + HOUR,
      renewal: 'idle',
      problem: null,
      notice: null,
    });
    expect(context.session.accessToken()).toBe('token-1');
    expect(JSON.stringify(context.states)).not.toContain('token-1');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('refuses a grant without both Cloud scopes, and revokes it so the next sign-in asks again', async () => {
    const context = setup();
    context.session.signIn();
    await settle();
    context.gis.respond(
      tokenResponse('token-partial', { scope: `${SCOPE_CLOUD_PLATFORM_READ_ONLY} ${SCOPE_EMAIL}` }),
    );
    await settle();
    expect(context.last()).toMatchObject({ status: 'signed-out', problem: { kind: 'scopes' } });
    expect(context.gis.revoked).toEqual(['token-partial']);
    expect(context.session.accessToken()).toBeNull();
    expect(context.lookUp).not.toHaveBeenCalled();
  });

  it('accepts a grant without the email scope and shows no address', async () => {
    const context = setup(() => Promise.resolve({ audience: TEST_CLIENT_ID, email: null }));
    context.session.signIn();
    await settle();
    context.gis.respond(
      tokenResponse('token-1', { scope: `${SCOPE_CLOUD_ASSET} ${SCOPE_CLOUD_PLATFORM_READ_ONLY}` }),
    );
    await settle();
    expect(context.last()).toMatchObject({ status: 'signed-in', account: { email: null } });
  });

  it('refuses a token issued to another client, or one Google does not accept', async () => {
    const other = setup(() =>
      Promise.resolve({ audience: 'someone-else.apps.googleusercontent.com', email: EMAIL }),
    );
    await signIn(other);
    expect(other.last()).toMatchObject({ status: 'signed-out', problem: { kind: 'account' } });
    expect(other.session.accessToken()).toBeNull();
    // Never used, and ended at once.
    expect(other.gis.revoked).toEqual(['token-1']);

    const refused = setup(() => Promise.reject(new TokenRefusedError('400')));
    await signIn(refused);
    expect(refused.last()).toMatchObject({ status: 'signed-out', problem: { kind: 'account' } });
    expect(refused.session.accessToken()).toBeNull();
  });

  it('goes on without the email when tokeninfo cannot be reached or takes too long', async () => {
    const offline = setup(() => Promise.reject(new TypeError('offline')));
    await signIn(offline);
    expect(offline.last()).toMatchObject({ status: 'signed-in', account: { email: null } });

    const slow = setup(hangingLookUp);
    slow.session.signIn();
    await settle();
    slow.gis.respond(tokenResponse('token-1'));
    await settle();
    expect(slow.last().status).toBe('signing-in');
    await vi.advanceTimersByTimeAsync(ACCOUNT_LOOKUP_TIMEOUT_MS);
    expect(slow.last()).toMatchObject({ status: 'signed-in', account: { email: null } });
    expect(slow.session.accessToken()).toBe('token-1');
  });

  it.each([
    ['popup_failed_to_open', 'popup-blocked'],
    ['popup_closed', 'popup-closed'],
    ['unknown', 'other'],
  ] as const)('says so when GIS reports %s', async (type, kind) => {
    const context = setup();
    context.session.signIn();
    await settle();
    context.gis.fail(type);
    expect(context.last()).toMatchObject({ status: 'signed-out', problem: { kind } });
  });

  it('says so when the person does not allow access', async () => {
    const context = setup();
    context.session.signIn();
    await settle();
    context.gis.respond({ error: 'access_denied' });
    expect(context.last()).toMatchObject({ status: 'signed-out', problem: { kind: 'denied' } });
  });

  it('asks again when the button is pressed while Google’s window is open', async () => {
    const context = setup();
    context.session.signIn();
    await settle();
    expect(context.gis.requests).toEqual([{ prompt: 'select_account' }]);
    const seen = context.states.length;
    // The window got lost behind others: a second press brings it back (GIS reuses it).
    context.session.signIn();
    await settle();
    expect(context.gis.requests).toEqual([{ prompt: 'select_account' }, { prompt: 'select_account' }]);
    expect(context.states).toHaveLength(seen);
    context.gis.respond(tokenResponse('token-1'));
    await settle();
    expect(context.last()).toMatchObject({ status: 'signed-in', account: { email: EMAIL } });
    expect(context.lookUp).toHaveBeenCalledTimes(1);
  });

  it('asks Google once for two presses before the script has loaded', async () => {
    const context = setup();
    context.session.signIn();
    context.session.signIn();
    await settle();
    expect(context.gis.requests).toEqual([{ prompt: 'select_account' }]);
  });

  it('waits for the account lookup instead of asking again', async () => {
    let answer: (info: TokenInfo) => void = () => undefined;
    const context = setup(
      () =>
        new Promise<TokenInfo>((resolve) => {
          answer = resolve;
        }),
    );
    context.session.signIn();
    await settle();
    context.gis.respond(tokenResponse('token-1'));
    await settle();
    expect(context.last().status).toBe('signing-in');
    context.session.signIn();
    await settle();
    expect(context.gis.requests).toHaveLength(1);
    answer({ audience: TEST_CLIENT_ID, email: EMAIL });
    await settle();
    expect(context.last()).toMatchObject({ status: 'signed-in', account: { email: EMAIL } });
    expect(context.session.accessToken()).toBe('token-1');
  });

  it('reports a script that does not load, and tries again on the next press', async () => {
    const context = setup();
    context.loadGis.mockRejectedValueOnce(new Error('blocked'));
    context.session.signIn();
    await settle();
    expect(context.last()).toMatchObject({ status: 'signed-out', problem: { kind: 'load-failed' } });
    await signIn(context);
    expect(context.last().status).toBe('signed-in');
    expect(context.loadGis).toHaveBeenCalledTimes(2);
  });
});

describe('renewal and expiry', () => {
  it('renews silently before the end, then keeps going with the new token', async () => {
    const context = setup();
    await signIn(context);
    await vi.advanceTimersByTimeAsync(HOUR - RENEW_BEFORE_MS - 1);
    expect(context.gis.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(context.gis.requests.at(-1)).toEqual({ prompt: 'none', login_hint: EMAIL });
    expect(context.last()).toMatchObject({ status: 'signed-in', renewal: 'renewing' });
    expect(context.session.accessToken()).toBe('token-1');
    context.gis.respond(tokenResponse('token-2'));
    await settle();
    expect(context.last()).toMatchObject({ status: 'signed-in', renewal: 'idle', account: { email: EMAIL } });
    expect(context.session.accessToken()).toBe('token-2');
    // The first token's end passes without an expiry.
    await vi.advanceTimersByTimeAsync(RENEW_BEFORE_MS + 1000);
    expect(context.last().status).toBe('signed-in');
    expect(context.session.accessToken()).toBe('token-2');
  });

  it('asks for a click when the silent renewal is blocked, and "Stay signed in" renews', async () => {
    const context = setup();
    await signIn(context);
    await vi.advanceTimersByTimeAsync(HOUR - RENEW_BEFORE_MS);
    context.gis.fail('popup_failed_to_open');
    expect(context.last()).toMatchObject({ status: 'signed-in', renewal: 'needed', problem: null });
    expect(context.session.accessToken()).toBe('token-1');
    context.session.renew();
    await settle();
    expect(context.gis.requests.at(-1)).toEqual({ prompt: '', login_hint: EMAIL });
    context.gis.respond(tokenResponse('token-2'));
    await settle();
    expect(context.last()).toMatchObject({ status: 'signed-in', renewal: 'idle' });
    expect(context.session.accessToken()).toBe('token-2');
  });

  it('gives up a silent renewal that GIS never answers', async () => {
    const context = setup();
    await signIn(context);
    await vi.advanceTimersByTimeAsync(HOUR - RENEW_BEFORE_MS);
    expect(context.last().renewal).toBe('renewing');
    await vi.advanceTimersByTimeAsync(RENEWAL_GUARD_MS);
    expect(context.last()).toMatchObject({ status: 'signed-in', renewal: 'needed' });
    // A late answer is not taken: the person decides with "Stay signed in". Nor is it revoked, which would end
    // the whole grant, the current token included.
    context.gis.respond(tokenResponse('token-late'));
    await settle();
    expect(context.session.accessToken()).toBe('token-1');
    expect(context.gis.revoked).toEqual([]);
  });

  it('expires a minute before the end: the token is dropped and the state says who was signed in', async () => {
    const context = setup();
    await signIn(context);
    await vi.advanceTimersByTimeAsync(HOUR - RENEW_BEFORE_MS);
    context.gis.respond({ error: 'interaction_required' });
    expect(context.last()).toMatchObject({ renewal: 'needed', problem: null });
    await vi.advanceTimersByTimeAsync(RENEW_BEFORE_MS - EXPIRY_MARGIN_MS - 1);
    expect(context.session.accessToken()).toBe('token-1');
    await vi.advanceTimersByTimeAsync(1);
    expect(context.last()).toEqual({
      status: 'expired',
      account: { email: EMAIL },
      expiresAt: null,
      renewal: 'idle',
      problem: null,
      notice: null,
    });
    expect(context.session.accessToken()).toBeNull();
  });

  it('checks the clock itself, for timers a background tab ran late', async () => {
    const context = setup();
    await signIn(context);
    vi.setSystemTime(START + HOUR);
    expect(context.session.accessToken()).toBeNull();
    expect(context.last().status).toBe('expired');
  });

  it('keeps the address through a renewal that tokeninfo does not answer', async () => {
    const context = setup();
    await signIn(context);
    context.lookUp.mockImplementationOnce(() => Promise.reject(new TypeError('offline')));
    await vi.advanceTimersByTimeAsync(HOUR - RENEW_BEFORE_MS);
    context.gis.respond(tokenResponse('token-2'));
    await settle();
    expect(context.last()).toMatchObject({ status: 'signed-in', account: { email: EMAIL } });
    expect(context.session.accessToken()).toBe('token-2');
  });

  it('shows no address for a sign-in after an expiry that tokeninfo does not answer (maybe another account)', async () => {
    const context = setup();
    await signIn(context);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(context.last()).toMatchObject({ status: 'expired', account: { email: EMAIL } });
    context.lookUp.mockImplementationOnce(() => Promise.reject(new TypeError('offline')));
    await signIn(context, 'token-2');
    expect(context.last()).toMatchObject({ status: 'signed-in', account: { email: null } });
    expect(context.session.accessToken()).toBe('token-2');
  });

  it('signs in again after an expiry, keeping the account on screen meanwhile', async () => {
    const context = setup();
    await signIn(context);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(context.last().status).toBe('expired');
    context.session.signIn();
    expect(context.last()).toMatchObject({ status: 'signing-in', account: { email: EMAIL } });
    await settle();
    context.gis.fail('popup_closed');
    expect(context.last()).toMatchObject({ status: 'expired', problem: { kind: 'popup-closed' } });
    await signIn(context, 'token-3');
    expect(context.last()).toMatchObject({ status: 'signed-in', account: { email: EMAIL } });
    expect(context.session.accessToken()).toBe('token-3');
  });

  it('times a short token by its lifetime: renewal at half, expiry a quarter early', async () => {
    const context = setup();
    await signIn(context, 'token-short', 120);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(context.gis.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(context.gis.requests).toHaveLength(2);
    context.gis.fail('popup_failed_to_open');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(context.session.accessToken()).toBe('token-short');
    await vi.advanceTimersByTimeAsync(1);
    expect(context.last().status).toBe('expired');
  });

  it('expires at once when the backend reports that Google refused the current token', async () => {
    const context = setup();
    await signIn(context);
    context.session.rejected('an-older-token');
    expect(context.last().status).toBe('signed-in');
    context.session.rejected('token-1');
    expect(context.last()).toMatchObject({ status: 'expired', problem: { kind: 'other' } });
    expect(context.session.accessToken()).toBeNull();
  });
});

describe('sign-out', () => {
  it('forgets the token at once, revokes it through GIS and stops every timer', async () => {
    const context = setup();
    await signIn(context);
    context.session.signOut();
    expect(context.last()).toMatchObject({ status: 'signed-out', account: null, notice: null });
    expect(context.session.accessToken()).toBeNull();
    expect(context.gis.revoked).toEqual(['token-1']);
    const seen = context.states.length;
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(context.states).toHaveLength(seen);
    expect(context.gis.requests).toHaveLength(1);
  });

  it('says so when Google does not confirm the revocation', async () => {
    const context = setup();
    await signIn(context);
    context.gis.revokeAnswer = { successful: false, error: 'invalid_token' };
    context.session.signOut();
    expect(context.last().status).toBe('signed-out');
    expect(context.last().notice).toMatch(/within the hour/);
  });

  it('revokes a token that arrives after the person signed out, and does not use it', async () => {
    const context = setup();
    context.session.signIn();
    await settle();
    context.session.signOut();
    context.gis.respond(tokenResponse('token-late'));
    await settle();
    expect(context.last().status).toBe('signed-out');
    expect(context.session.accessToken()).toBeNull();
    expect(context.gis.revoked).toEqual(['token-late']);
    expect(context.lookUp).not.toHaveBeenCalled();
  });

  it('revokes a token whose account lookup a sign-out cut short', async () => {
    const context = setup(hangingLookUp);
    await signIn(context);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(context.last().status).toBe('expired');
    // Signing in again after the expiry; the account menu's "Sign out" ends it while tokeninfo is asked.
    context.session.signIn();
    await settle();
    context.gis.respond(tokenResponse('token-2'));
    await settle();
    expect(context.last().status).toBe('signing-in');
    context.session.signOut();
    await settle();
    expect(context.last()).toMatchObject({ status: 'signed-out', account: null });
    expect(context.session.accessToken()).toBeNull();
    expect(context.gis.revoked).toEqual(['token-2']);
    await vi.advanceTimersByTimeAsync(ACCOUNT_LOOKUP_TIMEOUT_MS);
    expect(context.last().status).toBe('signed-out');
  });

  it('dispose stops the timers and forgets the token without revoking it', async () => {
    const context = setup();
    await signIn(context);
    const seen = context.states.length;
    context.session.dispose();
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(context.states).toHaveLength(seen);
    expect(context.session.accessToken()).toBeNull();
    expect(context.gis.revoked).toEqual([]);
  });
});

describe('anotherAccount', () => {
  const signedIn = (email: string | null): SessionState =>
    signedInSession({ account: { email }, expiresAt: START + HOUR });
  const expired = (email: string | null): SessionState => ({
    ...SIGNED_OUT_SESSION,
    status: 'expired',
    account: { email },
  });

  const signingIn: SessionState = { ...SIGNED_OUT_SESSION, status: 'signing-in' };
  const ada = { email: EMAIL };

  it('tells a sign-in of another account from the same account coming back, after an expiry', () => {
    expect(anotherAccount(ada, expired(EMAIL), signedIn('grace@example.com'))).toBe(true);
    expect(anotherAccount(ada, expired(EMAIL), signedIn(null))).toBe(true);
    expect(anotherAccount(ada, expired(EMAIL), signedIn(EMAIL))).toBe(false);
    expect(anotherAccount(ada, signedIn(EMAIL), expired(EMAIL))).toBe(false);
  });

  it('compares with the account last signed in, through a sign-out too', () => {
    // The session before a sign-in after a sign-out names no account; the last one signed in still counts.
    expect(anotherAccount(ada, signingIn, signedIn('grace@example.com'))).toBe(true);
    expect(anotherAccount(ada, signingIn, signedIn(null))).toBe(true);
    expect(anotherAccount(ada, signingIn, signedIn(EMAIL))).toBe(false);
    expect(anotherAccount({ email: null }, signingIn, signedIn(null))).toBe(true);
    // The first sign-in has no account before it.
    expect(anotherAccount(null, signingIn, signedIn(EMAIL))).toBe(false);
    expect(anotherAccount(null, SIGNED_OUT_SESSION, SIGNED_OUT_SESSION)).toBe(false);
  });

  it('keeps the account through a renewal unless Google names another', () => {
    expect(anotherAccount(ada, signedIn(EMAIL), signedIn(EMAIL))).toBe(false);
    expect(anotherAccount({ email: null }, signedIn(null), signedIn(null))).toBe(false);
    expect(anotherAccount(ada, signedIn(EMAIL), signedIn('grace@example.com'))).toBe(true);
    expect(anotherAccount({ email: null }, signedIn(null), signedIn(EMAIL))).toBe(true);
  });
});
