// SPDX-License-Identifier: MIT
import type { ConsoleMessage, Page, Request } from '@playwright/test';

/**
 * A stand-in for Google Identity Services and Google's tokeninfo, for the sign-in spec. The app loads
 * `https://accounts.google.com/gsi/client` when someone presses "Sign in with Google"; the spec answers that
 * request with the script below, which defines `google.accounts.oauth2` and hands the app's callback a fake
 * token, without any window or network. Tokeninfo is answered the same way. Nothing reaches Google.
 */

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
export const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
export const TEST_CLIENT_ID = '12345678901-e2eclient.apps.googleusercontent.com';
export const TEST_EMAIL = 'ada@example.com';

export const ALL_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform.read-only',
  'https://www.googleapis.com/auth/cloudasset',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export interface GisStubOptions {
  /** The tokens handed out, one per request (the last one repeats). Fake values, easy to search for. */
  readonly tokens: readonly string[];
  /** `expires_in` of every token, in seconds; by default 3599, the hour Google grants. */
  readonly expiresIn?: number;
  /** The scopes granted; by default ALL_SCOPES. */
  readonly scope?: string;
  /**
   * A silent request (`prompt: 'none'`): granted (the default), or refused as a browser blocks a window nobody
   * clicked for.
   */
  readonly silent?: 'grant' | 'blocked';
}

/** What the stub saw, in `window.__gisStub`. */
export interface GisStubLog {
  readonly clientId: string | null;
  readonly scope: string | null;
  readonly requests: { readonly prompt?: string; readonly login_hint?: string }[];
  readonly revoked: string[];
}

/**
 * The stub script's body. It runs in the browser, so it is self-contained: Playwright serialises it with
 * `toString()`, as it does for `page.addInitScript`.
 */
function gisClientStub(options: Required<GisStubOptions>): void {
  interface TokenClientConfig {
    readonly client_id: string;
    readonly scope: string;
    readonly callback: (response: object) => void;
    readonly error_callback: (error: object) => void;
  }
  const log = {
    clientId: null as string | null,
    scope: null as string | null,
    requests: [] as { prompt?: string; login_hint?: string }[],
    revoked: [] as string[],
  };
  let issued = 0;
  const host = window as unknown as { __gisStub: typeof log; google: unknown };
  host.__gisStub = log;
  host.google = {
    accounts: {
      oauth2: {
        initTokenClient(config: TokenClientConfig) {
          log.clientId = config.client_id;
          log.scope = config.scope;
          return {
            requestAccessToken(request?: { prompt?: string; login_hint?: string }) {
              log.requests.push({ ...request });
              setTimeout(() => {
                if (request?.prompt === 'none' && options.silent === 'blocked') {
                  config.error_callback({
                    type: 'popup_failed_to_open',
                    message: 'Failed to open popup window',
                  });
                  return;
                }
                const token = options.tokens[Math.min(issued, options.tokens.length - 1)];
                issued += 1;
                config.callback({
                  access_token: token,
                  expires_in: options.expiresIn,
                  scope: options.scope,
                  token_type: 'Bearer',
                });
              }, 20);
            },
          };
        },
        revoke(token: string, done?: (response: object) => void) {
          log.revoked.push(token);
          setTimeout(() => done?.({ successful: true }), 10);
        },
      },
    },
  };
}

export interface GoogleStubs {
  /** Requests for Google's script. */
  readonly scriptLoads: () => number;
  /** The bodies tokeninfo received. */
  readonly tokenInfoBodies: () => readonly string[];
  /** Every URL the page requested, for "the token is never in a URL". */
  readonly urls: () => readonly string[];
  /** Every console message and uncaught error of the page, for "the token is never in a log". */
  readonly console: () => readonly string[];
  /** What the stub saw. */
  readonly log: () => Promise<GisStubLog>;
}

/** Answers Google's script and tokeninfo inside the browser, and records what the page asked. */
export async function stubGoogle(page: Page, given: GisStubOptions): Promise<GoogleStubs> {
  const options: Required<GisStubOptions> = { expiresIn: 3599, scope: ALL_SCOPES, silent: 'grant', ...given };
  let scriptLoads = 0;
  const tokenInfoBodies: string[] = [];
  const urls: string[] = [];
  const logged: string[] = [];
  page.on('request', (request: Request) => {
    urls.push(request.url());
  });
  page.on('console', (message: ConsoleMessage) => {
    logged.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error: Error) => {
    logged.push(`pageerror: ${error.message}\n${error.stack ?? ''}`);
  });
  await page.route(GIS_SCRIPT_URL, async (route) => {
    scriptLoads += 1;
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: `(${gisClientStub.toString()})(${JSON.stringify(options)});`,
    });
  });
  await page.route(TOKENINFO_URL, async (route) => {
    tokenInfoBodies.push(route.request().postData() ?? '');
    await route.fulfill({
      json: {
        aud: TEST_CLIENT_ID,
        azp: TEST_CLIENT_ID,
        email: TEST_EMAIL,
        scope: options.scope,
        expires_in: '3599',
      },
    });
  });
  return {
    scriptLoads: () => scriptLoads,
    tokenInfoBodies: () => tokenInfoBodies,
    urls: () => urls,
    console: () => logged,
    log: () => page.evaluate(() => (window as unknown as { __gisStub: GisStubLog }).__gisStub),
  };
}

/**
 * Everything this page keeps where a token must never be: the address, cookies, localStorage, sessionStorage
 * and every record of every IndexedDB database (blobs read as text), as one string to search.
 */
export function storedEverywhere(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const parts: string[] = [window.location.href, document.cookie];
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) ?? '';
        parts.push(key, storage.getItem(key) ?? '');
      }
    }
    const request = <T>(call: IDBRequest<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        call.onsuccess = () => {
          resolve(call.result);
        };
        call.onerror = () => {
          reject(call.error ?? new Error('IndexedDB request failed'));
        };
      });
    for (const info of await indexedDB.databases()) {
      if (info.name === undefined) continue;
      const db = await request(indexedDB.open(info.name));
      for (const name of Array.from(db.objectStoreNames)) {
        const store = db.transaction(name).objectStore(name);
        const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
        parts.push(JSON.stringify(keys));
        for (const value of values) {
          const blobs: Blob[] = [];
          parts.push(
            JSON.stringify(value, (_key, item: unknown) => {
              if (item instanceof Blob) {
                blobs.push(item);
                return '[blob]';
              }
              return item;
            }),
          );
          for (const blob of blobs) parts.push(await blob.text());
        }
      }
      db.close();
    }
    return parts.join('\n');
  });
}
