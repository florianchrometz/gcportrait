// SPDX-License-Identifier: Apache-2.0
/**
 * The token lifecycle of user mode (AGENTS.md, Security and privacy, principle 2): Google Identity Services' token
 * client, an access token held in this closure only (never in the store, storage, a URL or a log), renewed
 * silently before it ends, dropped when it ends, revoked on sign-out.
 *
 * - **Sign in** (`signIn`, from a click): load GIS, ask for a token with the account chooser; check the granted
 *   scopes (with granular consent a person may leave one out); ask Google's tokeninfo for the account's email
 *   and that the token was issued to this instance's client; then `signed-in` until `expiresAt`. Pressing again
 *   while Google's window is open asks again: GIS reuses its window, or opens a new one when the first was lost.
 *   When tokeninfo does not answer, the session goes on without the email: a renewal (asked with the account as
 *   the hint) keeps the address known before, a sign-in shows none, because the person may have picked another
 *   account in Google's window.
 * - **Silent renewal**: `RENEW_BEFORE_MS` before the end (half the lifetime for a short one) the session asks
 *   again with `prompt: 'none'` and the account as a hint. GIS answers every request through a window of its
 *   own, which browsers block when no click started it (unless pop-ups are allowed for the site), so this
 *   usually fails; then renewal is `needed` and the account menu offers "Stay signed in" (`renew`, from a
 *   click, which may open the window). A silent request that GIS never answers is given up after
 *   `RENEWAL_GUARD_MS`.
 * - **Expiry**: `EXPIRY_MARGIN_MS` before the end (a request in flight must not outlive its token) the token is
 *   dropped and the session is `expired`: a clear state that names the account and offers a new sign-in.
 *   `accessToken()` also checks the clock itself, because timers in a background tab may fire late. A token
 *   Google refuses earlier (`rejected`) expires the session at once.
 * - **Sign out**: the token is forgotten at once and revoked through GIS (`google.accounts.oauth2.revoke`).
 * - **Tokens that are not used** are revoked when they arrive after a sign-out (or while their account lookup
 *   ran) and when tokeninfo says they were issued to another client. A late renewal answer while the person is
 *   still signed in (or expired) is only dropped: revoking it would end the person's whole grant to this client,
 *   the current token included, and it ends by itself within the hour.
 *
 * Every dependency is passed in, so the unit tests drive it with a fake GIS and fake timers.
 */
import {
  GisLoadError,
  type GisClientError,
  type GisOAuth2,
  type GisTokenClient,
  type GisTokenRequest,
  type GisTokenResponse,
} from './gis';
import { TokenRefusedError, type TokenInfo } from './tokeninfo';
import { SIGNED_OUT_SESSION, type SessionProblem, type SessionState } from './types';

/** Resource Manager accepts it, Cloud Asset Inventory does not (AGENTS.md, Security and privacy, OAuth scopes). */
export const SCOPE_CLOUD_PLATFORM_READ_ONLY = 'https://www.googleapis.com/auth/cloud-platform.read-only';
/** Cloud Asset Inventory accepts it, Resource Manager does not. */
export const SCOPE_CLOUD_ASSET = 'https://www.googleapis.com/auth/cloudasset';
/** The account's email address, which tokeninfo then reports: the account menu shows it. */
export const SCOPE_EMAIL = 'https://www.googleapis.com/auth/userinfo.email';

/** What the token client asks for. */
export const OAUTH_SCOPES = [SCOPE_CLOUD_PLATFORM_READ_ONLY, SCOPE_CLOUD_ASSET, SCOPE_EMAIL] as const;
/** Without these two the token is of no use to gcportrait (the email is optional). */
export const REQUIRED_SCOPES = [SCOPE_CLOUD_PLATFORM_READ_ONLY, SCOPE_CLOUD_ASSET] as const;

/** A silent renewal starts this long before the token ends (at most half its lifetime). */
export const RENEW_BEFORE_MS = 5 * 60_000;
/** The token is dropped this long before it ends (at most a quarter of its lifetime). */
export const EXPIRY_MARGIN_MS = 60_000;
/** A silent renewal GIS has not answered after this long counts as failed. */
export const RENEWAL_GUARD_MS = 2 * 60_000;
/** How long the account lookup (tokeninfo) may take before the session goes on without the email. */
export const ACCOUNT_LOOKUP_TIMEOUT_MS = 10_000;

export interface TokenSessionOptions {
  /** The instance's OAuth web client id (`oauthClientId` in /api/config). */
  readonly clientId: string;
  /** Loads GIS (gis.ts `loadGis`); called on the first sign-in, never before. */
  readonly loadGis: () => Promise<GisOAuth2>;
  /** Google's tokeninfo for a token (tokeninfo.ts `fetchTokenInfo`). */
  readonly tokenInfo: (accessToken: string, signal: AbortSignal) => Promise<TokenInfo>;
  /** Receives every new state (the app store's `connect.session`). Never receives the token. */
  readonly onChange: (state: SessionState) => void;
  /** The clock (`Date.now`); fake timers replace it in tests. */
  readonly now?: () => number;
}

export interface TokenSession {
  readonly state: () => SessionState;
  /**
   * Opens Google's sign-in window, or brings it back when it is already open. Call it from a click: a browser
   * blocks the window otherwise.
   */
  readonly signIn: () => void;
  /** Asks for a fresh token for the signed-in account ("Stay signed in"). Call it from a click. */
  readonly renew: () => void;
  /** Forgets the token and revokes it through GIS. */
  readonly signOut: () => void;
  /** The access token while it is usable, else null. Hand it only to the backend, through `fetchWithToken`. */
  readonly accessToken: () => string | null;
  /** Google (through the backend) refused this token: the session expires, if it is still the current token. */
  readonly rejected: (accessToken: string) => void;
  /** Stops the timers and forgets the token (the app is going away); does not revoke. */
  readonly dispose: () => void;
}

type Request = 'sign-in' | 'renew' | 'silent';

const PROBLEMS = {
  popupBlocked: {
    kind: 'popup-blocked',
    message:
      'Your browser blocked Google’s sign-in window. Allow pop-ups for this site, then press the button again.',
  },
  popupClosed: {
    kind: 'popup-closed',
    message:
      'Google’s sign-in window was closed before the sign-in finished, or Google showed an error in it (for ' +
      'example when this address is not among the OAuth client’s authorised JavaScript origins).',
  },
  denied: {
    kind: 'denied',
    message: 'You did not allow gcportrait to read your Google Cloud data, so you are not signed in.',
  },
  scopes: {
    kind: 'scopes',
    message:
      'gcportrait needs both permissions Google asked about: to view your Google Cloud data and your Cloud ' +
      'Asset Inventory data. Sign in again and allow both.',
  },
  account: {
    kind: 'account',
    message:
      'Google did not confirm that this sign-in belongs to this gcportrait instance, so it was not used.',
  },
  rejected: {
    kind: 'other',
    message: 'Google no longer accepts this session (it may have been revoked). Sign in again to continue.',
  },
} as const satisfies Record<string, SessionProblem>;

const REVOKE_NOTICE =
  'Signed out. Google did not confirm that it revoked gcportrait’s access; the access ends by itself within the hour.';

function oauthProblem(error: string): SessionProblem {
  if (error === 'access_denied') return PROBLEMS.denied;
  return { kind: 'other', message: `Google did not complete the sign-in (${error}).` };
}

function clientProblem(error: GisClientError): SessionProblem {
  if (error.type === 'popup_failed_to_open') return PROBLEMS.popupBlocked;
  if (error.type === 'popup_closed') return PROBLEMS.popupClosed;
  return { kind: 'other', message: `Google’s sign-in did not finish (${error.type ?? 'unknown'}).` };
}

/** `expires_in` in milliseconds, or null when Google sent none that makes sense. */
function lifetimeOf(response: GisTokenResponse): number | null {
  const seconds = Number(response.expires_in);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

function grantsRequiredScopes(response: GisTokenResponse): boolean {
  const granted = new Set((response.scope ?? '').split(/\s+/));
  return REQUIRED_SCOPES.every((scope) => granted.has(scope));
}

export function createTokenSession(options: TokenSessionOptions): TokenSession {
  // Read at each call, so fake clocks installed later (tests, Playwright's clock) are honoured.
  const now = options.now ?? (() => Date.now());
  let state: SessionState = SIGNED_OUT_SESSION;
  let token: string | null = null;
  /** The token is handed out until this time (its end minus the margin). */
  let usableUntil = 0;
  let gis: GisOAuth2 | null = null;
  let client: GisTokenClient | null = null;
  let pending: Request | null = null;
  /** Bumped by every request: only the latest one goes on to GIS once the script has loaded. */
  let requests = 0;
  /** Bumped by sign-out and dispose: answers to anything asked before are ignored. */
  let generation = 0;
  let lookup: AbortController | null = null;
  let disposed = false;
  let renewTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let guardTimer: ReturnType<typeof setTimeout> | undefined;

  const publish = (next: SessionState): void => {
    state = next;
    if (!disposed) options.onChange(next);
  };

  const clearTimers = (): void => {
    clearTimeout(renewTimer);
    clearTimeout(expiryTimer);
    clearTimeout(guardTimer);
  };

  /** Ends a token gcportrait will not use; GIS posts it to Google's revocation endpoint. */
  const revoke = (accessToken: string): void => {
    gis?.revoke(accessToken);
  };

  const hint = (): GisTokenRequest => {
    const email = state.account?.email ?? null;
    return email === null ? {} : { login_hint: email };
  };

  /** A request did not bring a token. */
  const failed = (request: Request, problem: SessionProblem | null): void => {
    if (request === 'sign-in') {
      publish({
        ...SIGNED_OUT_SESSION,
        status: state.account === null ? 'signed-out' : 'expired',
        account: state.account,
        problem,
      });
    } else if (token !== null) {
      publish({ ...state, renewal: 'needed', problem: request === 'silent' ? null : problem });
    } else if (state.status === 'expired' && request === 'renew') {
      publish({ ...state, problem });
    }
  };

  const expire = (problem: SessionProblem | null): void => {
    token = null;
    usableUntil = 0;
    clearTimers();
    // A silent renewal is given up; a renewal the person started may still bring them back in.
    if (pending === 'silent') pending = null;
    publish({ ...SIGNED_OUT_SESSION, status: 'expired', account: state.account, problem });
  };

  const silentRenew = (): void => {
    if (disposed || state.status !== 'signed-in' || pending !== null) return;
    pending = 'silent';
    publish({ ...state, renewal: 'renewing' });
    guardTimer = setTimeout(() => {
      if (pending !== 'silent') return;
      pending = null;
      failed('silent', null);
    }, RENEWAL_GUARD_MS);
    request('silent', { prompt: 'none', ...hint() });
  };

  const accept = (
    answered: Request,
    accessToken: string,
    expiresAt: number,
    lifetime: number,
    email: string | null,
  ): void => {
    token = accessToken;
    const margin = Math.min(EXPIRY_MARGIN_MS, lifetime / 4);
    const lead = Math.min(RENEW_BEFORE_MS, lifetime / 2);
    usableUntil = expiresAt - margin;
    clearTimers();
    renewTimer = setTimeout(silentRenew, Math.max(0, expiresAt - lead - now()));
    expiryTimer = setTimeout(
      () => {
        expire(null);
      },
      Math.max(0, usableUntil - now()),
    );
    // Without the email (tokeninfo unreachable), a renewal keeps the one known from before: it asked for that
    // account. A sign-in does not: the person may have picked another account, whose address is then unknown.
    const known = answered === 'sign-in' ? null : (state.account?.email ?? null);
    publish({
      ...SIGNED_OUT_SESSION,
      status: 'signed-in',
      account: { email: email ?? known },
      expiresAt,
    });
  };

  const onToken = (response: GisTokenResponse): void => {
    const answered = pending;
    if (disposed) return;
    if (answered === null) {
      // Nobody asked for it any more. After a sign-out it is revoked; otherwise (a renewal given up) dropped.
      const late = response.access_token;
      if (state.status === 'signed-out' && late !== undefined && late !== '') revoke(late);
      return;
    }
    pending = null;
    clearTimeout(guardTimer);
    const accessToken = response.access_token;
    if (response.error !== undefined || accessToken === undefined || accessToken === '') {
      failed(answered, oauthProblem(response.error ?? 'no token'));
      return;
    }
    if (!grantsRequiredScopes(response)) {
      // The grant is no use without both scopes: revoke it, so the next sign-in asks for both again.
      revoke(accessToken);
      failed(answered, PROBLEMS.scopes);
      return;
    }
    const lifetime = lifetimeOf(response);
    if (lifetime === null) {
      failed(answered, { kind: 'other', message: 'Google’s answer did not say how long the sign-in lasts.' });
      return;
    }
    const expiresAt = now() + lifetime;
    const ticket = generation;
    lookup?.abort();
    const controller = new AbortController();
    lookup = controller;
    const timeout = setTimeout(() => {
      controller.abort();
    }, ACCOUNT_LOOKUP_TIMEOUT_MS);
    /** Whether the lookup's answer still counts. A token the person signed out of meanwhile is revoked. */
    const current = (): boolean => {
      clearTimeout(timeout);
      if (disposed) return false;
      if (ticket !== generation) {
        revoke(accessToken);
        return false;
      }
      // A newer token's lookup replaced this one: that token goes on, this one is dropped (not revoked: it is
      // part of the same grant, and revoking it would end the newer token too).
      if (lookup !== controller) return false;
      lookup = null;
      return true;
    };
    options.tokenInfo(accessToken, controller.signal).then(
      (info) => {
        if (!current()) return;
        if (info.audience !== null && info.audience !== options.clientId) {
          // Not this instance's token: never used, and ended at once.
          revoke(accessToken);
          failed(answered, PROBLEMS.account);
          return;
        }
        accept(answered, accessToken, expiresAt, lifetime, info.email);
      },
      (error: unknown) => {
        if (!current()) return;
        if (error instanceof TokenRefusedError) {
          failed(answered, PROBLEMS.account);
          return;
        }
        // Unreachable or slow: the token came straight from GIS for this client; go on without the email.
        accept(answered, accessToken, expiresAt, lifetime, null);
      },
    );
  };

  const onClientError = (error: GisClientError): void => {
    const answered = pending;
    if (answered === null || disposed) return;
    pending = null;
    clearTimeout(guardTimer);
    failed(answered, clientProblem(error));
  };

  function request(kind: Request, tokenRequest: GisTokenRequest): void {
    const ticket = generation;
    requests += 1;
    const asked = requests;
    // Only the latest request goes on (a second press before the script has loaded asks once).
    const wanted = (): boolean =>
      asked === requests && ticket === generation && !disposed && pending === kind;
    options
      .loadGis()
      .then((loaded) => {
        if (!wanted()) return;
        gis = loaded;
        client ??= loaded.initTokenClient({
          client_id: options.clientId,
          scope: OAUTH_SCOPES.join(' '),
          callback: onToken,
          error_callback: onClientError,
        });
        client.requestAccessToken(tokenRequest);
      })
      .catch((error: unknown) => {
        if (!wanted()) return;
        pending = null;
        clearTimeout(guardTimer);
        const message =
          error instanceof GisLoadError ? error.message : 'Google’s sign-in could not be started.';
        failed(kind, { kind: 'load-failed', message });
      });
  }

  return {
    state: () => state,
    signIn() {
      if (disposed || state.status === 'signed-in') return;
      // Signing in with the window open: ask again (GIS brings its window back). While the account is being
      // read (the window has answered), the press waits for that.
      if (state.status === 'signing-in' && pending !== 'sign-in') return;
      pending = 'sign-in';
      if (state.status !== 'signing-in') {
        publish({ ...SIGNED_OUT_SESSION, status: 'signing-in', account: state.account });
      }
      request('sign-in', { prompt: 'select_account' });
    },
    renew() {
      if (disposed || state.status !== 'signed-in') return;
      clearTimeout(guardTimer);
      pending = 'renew';
      publish({ ...state, renewal: 'renewing', problem: null });
      request('renew', { prompt: '', ...hint() });
    },
    signOut() {
      generation += 1;
      lookup?.abort();
      lookup = null;
      pending = null;
      clearTimers();
      const held = token;
      token = null;
      usableUntil = 0;
      publish(SIGNED_OUT_SESSION);
      if (held === null || gis === null) return;
      gis.revoke(held, (response) => {
        if (disposed || response.successful === true || state.status !== 'signed-out') return;
        publish({ ...state, notice: REVOKE_NOTICE });
      });
    },
    accessToken() {
      if (token === null) return null;
      if (now() >= usableUntil) {
        expire(null);
        return null;
      }
      return token;
    },
    rejected(accessToken) {
      if (token !== null && accessToken === token) expire(PROBLEMS.rejected);
    },
    dispose() {
      disposed = true;
      generation += 1;
      lookup?.abort();
      lookup = null;
      pending = null;
      clearTimers();
      token = null;
    },
  };
}
