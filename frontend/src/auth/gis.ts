// SPDX-License-Identifier: MIT
/**
 * Google Identity Services (GIS), the token model: the few calls gcportrait makes, typed, and the loader of
 * Google's client script. The script is loaded only when a person presses "Sign in with Google" on an instance
 * that names an OAuth client (never in demo mode, never on page load), and only once per page.
 *
 * The backend's Content Security Policy allows exactly this script (`script-src`) and GIS's endpoints
 * (`connect-src`), and its Cross-Origin-Opener-Policy is `same-origin-allow-popups` so that the Google window
 * this script opens can hand the token back (backend/src/security.ts).
 */

/** Google's client library for the token model. */
export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

/** How long the script may take to load before sign-in reports a problem. */
export const GIS_LOAD_TIMEOUT_MS = 20_000;

/** What the token client hands to its callback: a token, or an OAuth error. */
export interface GisTokenResponse {
  readonly access_token?: string;
  /** Seconds; GIS passes a number, the OAuth wire format a string. */
  readonly expires_in?: number | string;
  /** The scopes granted, space-separated. With granular consent the person may have left some out. */
  readonly scope?: string;
  readonly token_type?: string;
  readonly error?: string;
  readonly error_description?: string;
}

/** What GIS hands to `error_callback`: the Google window could not open, was closed, or something else. */
export interface GisClientError {
  readonly type?: string;
  readonly message?: string;
}

export interface GisTokenClientConfig {
  readonly client_id: string;
  /** Space-separated. */
  readonly scope: string;
  readonly callback: (response: GisTokenResponse) => void;
  readonly error_callback: (error: GisClientError) => void;
}

/** Per request: `prompt` (`''`, `'none'`, `'consent'`, `'select_account'`) and the account to suggest. */
export interface GisTokenRequest {
  readonly prompt?: string;
  readonly login_hint?: string;
}

export interface GisTokenClient {
  readonly requestAccessToken: (request?: GisTokenRequest) => void;
}

export interface GisRevokeResponse {
  readonly successful?: boolean;
  readonly error?: string;
  readonly error_description?: string;
}

/** `google.accounts.oauth2`: the part of GIS gcportrait uses. */
export interface GisOAuth2 {
  readonly initTokenClient: (config: GisTokenClientConfig) => GisTokenClient;
  readonly revoke: (accessToken: string, done?: (response: GisRevokeResponse) => void) => void;
}

/** Raised when Google's script could not be loaded (offline, blocked by an extension, or too slow). */
export class GisLoadError extends Error {
  override readonly name = 'GisLoadError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

/** `google.accounts.oauth2` on `scope` (a window), when the script has defined it; otherwise null. */
export function readGis(scope: unknown): GisOAuth2 | null {
  if (!isRecord(scope)) return null;
  const google = scope.google;
  if (!isRecord(google)) return null;
  const accounts = google.accounts;
  if (!isRecord(accounts)) return null;
  const oauth2 = accounts.oauth2;
  if (!isRecord(oauth2)) return null;
  const { initTokenClient, revoke } = oauth2;
  if (typeof initTokenClient !== 'function' || typeof revoke !== 'function') return null;
  return {
    initTokenClient: (config) => {
      const client: unknown = initTokenClient.call(oauth2, config);
      const request = isRecord(client) ? client.requestAccessToken : undefined;
      if (typeof request !== 'function')
        throw new GisLoadError('Google’s sign-in script returned no token client.');
      return {
        requestAccessToken: (options) => {
          request.call(client, options);
        },
      };
    },
    revoke: (accessToken, done) => {
      revoke.call(oauth2, accessToken, done);
    },
  };
}

const loads = new WeakMap<Document, Promise<GisOAuth2>>();

/**
 * Loads Google's client script into `document` once and resolves with `google.accounts.oauth2`. A script that is
 * already there (a second click, or a test's stand-in) is used as it is. A failed load removes its script element
 * and forgets the attempt, so the next press of "Sign in" tries again.
 */
export function loadGis(
  document: Document = window.document,
  timeoutMs: number = GIS_LOAD_TIMEOUT_MS,
): Promise<GisOAuth2> {
  const present = readGis(document.defaultView);
  if (present !== null) return Promise.resolve(present);
  const pending = loads.get(document);
  if (pending !== undefined) return pending;

  const load = new Promise<GisOAuth2>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = (message: string): void => {
      clearTimeout(timer);
      script.remove();
      loads.delete(document);
      reject(new GisLoadError(message));
    };
    const timer = setTimeout(() => {
      fail('Google’s sign-in script did not load in time.');
    }, timeoutMs);
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.addEventListener('load', () => {
      const gis = readGis(document.defaultView);
      if (gis === null) {
        fail('Google’s sign-in script loaded but did not set itself up.');
        return;
      }
      clearTimeout(timer);
      // From now on the page itself has GIS (readGis above); the pending load is no longer needed.
      loads.delete(document);
      resolve(gis);
    });
    script.addEventListener('error', () => {
      fail('Google’s sign-in script could not be loaded.');
    });
    document.head.append(script);
  });
  loads.set(document, load);
  return load;
}
