// SPDX-License-Identifier: MIT
/**
 * Application Default Credentials without a library (./identity.ts): the metadata server, an impersonation file, a
 * key file, the refusals (a person's credentials, other types and universes, endpoints that are not Google's), the
 * token cache, and that no message ever carries a credential. Every endpoint is a pretend one; the RSA key is made
 * here for the run and never written anywhere.
 */
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_SCOPES,
  cachedTokens,
  checkIdentityUrl,
  IdentityError,
  METADATA_BASE,
  resolveServiceAccountIdentity,
  TOKEN_ENDPOINT,
  wellKnownFile,
  type IdentityFetch,
  type ResolveIdentityOptions,
} from './identity.js';

const ACCOUNT = 'gcportrait-backend@demo-host.iam.gserviceaccount.com';
const ACCOUNT_TOKEN = 'ya29.account-token-from-adc';
const SOURCE_TOKEN = 'ya29.source-token-from-refresh';
const REFRESH_TOKEN = '1//refresh-token-secretvalue';
const CLIENT_SECRET = 'client-secret-secretvalue';
const IMPERSONATION_URL = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${ACCOUNT}:generateAccessToken`;

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string | undefined;
  readonly redirect: RequestInit['redirect'];
}

type Answerer = (call: Call) => Response | Promise<Response>;

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return text(status, JSON.stringify(body), { 'content-type': 'application/json', ...headers });
}

const FLAVOR = { 'metadata-flavor': 'Google' };

/** A pretend metadata server, token endpoint and IAM Credentials, recording every call. */
function endpoints(answer: Answerer): { readonly fetch: IdentityFetch; readonly calls: Call[] } {
  const calls: Call[] = [];
  const fetch: IdentityFetch = async (url, init) => {
    const call: Call = {
      url,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? init.body : undefined,
      redirect: init.redirect,
    };
    calls.push(call);
    return answer(call);
  };
  return { fetch, calls };
}

/** The metadata server of a Cloud Run service running as ACCOUNT. */
function metadataServer(
  tokenAnswer: () => Response = () =>
    json(200, { access_token: ACCOUNT_TOKEN, expires_in: 3599, token_type: 'Bearer' }, FLAVOR),
): Answerer {
  return (call) => {
    if (call.url === `${METADATA_BASE}/instance/service-accounts/default/email`)
      return text(200, ACCOUNT, FLAVOR);
    if (call.url === `${METADATA_BASE}/instance/service-accounts/default/token`) return tokenAnswer();
    return text(404, 'not found');
  };
}

const clock = { now: 1_800_000_000_000 };

function options(
  answer: Answerer,
  extra: Partial<ResolveIdentityOptions> & { readonly files?: Readonly<Record<string, string>> } = {},
): { readonly options: ResolveIdentityOptions; readonly calls: Call[] } {
  const { fetch, calls } = endpoints(answer);
  const { files = {}, ...rest } = extra;
  return {
    calls,
    options: {
      env: {},
      fetch,
      readFile: (file) => Promise.resolve(files[file] ?? null),
      homedir: '/home/demo',
      platform: 'linux',
      now: () => clock.now,
      sleep: () => Promise.resolve(),
      ...rest,
    },
  };
}

async function failure(promise: Promise<unknown>): Promise<IdentityError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityError);
    return error as IdentityError;
  }
  throw new Error('expected an IdentityError');
}

const signal = (): AbortSignal => new AbortController().signal;

function authorizedUser(): Record<string, string> {
  return {
    type: 'authorized_user',
    client_id: '10000000001-demo.apps.googleusercontent.com',
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
  };
}

function impersonationFile(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'impersonated_service_account',
    service_account_impersonation_url: IMPERSONATION_URL,
    delegates: [],
    source_credentials: authorizedUser(),
    ...extra,
  });
}

/** Token endpoint and IAM Credentials for an impersonation file. */
function impersonation(
  iam: (call: Call) => Response = () =>
    json(200, { accessToken: ACCOUNT_TOKEN, expireTime: new Date(clock.now + 3600_000).toISOString() }),
): Answerer {
  return (call) => {
    if (call.url === TOKEN_ENDPOINT) return json(200, { access_token: SOURCE_TOKEN, expires_in: 3599 });
    if (call.url === IMPERSONATION_URL) return iam(call);
    return text(404, 'not found');
  };
}

describe('the metadata server (Cloud Run)', () => {
  it.each(['timeout', 'transport'] as const)(
    'classifies a token request %s without leaking its error',
    async (kind) => {
      const base = options(metadataServer()).options;
      const fetch: IdentityFetch = (url, init) => {
        if (url.endsWith('/email')) return Promise.resolve(text(200, ACCOUNT, FLAVOR));
        if (kind === 'transport') return Promise.reject(new Error('private credential detail'));
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => {
              reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error('Aborted.'));
            },
            { once: true },
          );
        });
      };
      await expect(resolveServiceAccountIdentity({ ...base, fetch, timeoutMs: 20 })).rejects.toMatchObject({
        name: 'IdentityError',
        message: `no token could be minted for ${ACCOUNT}: ${kind === 'timeout' ? 'The metadata server did not answer within 0 s.' : 'The metadata server could not be reached.'}`,
      });
    },
  );

  it('accepts exactly 64 KiB despite an oversized declared length and preserves split lenient UTF-8', async () => {
    const encoder = new TextEncoder();
    const prefix = encoder.encode(`{"access_token":"${ACCOUNT_TOKEN}","ignored":"é`);
    const suffix = encoder.encode('"}');
    const padding = new Uint8Array(64 * 1024 - prefix.length - suffix.length - 1).fill(0x20);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(prefix.subarray(0, prefix.length - 1));
        controller.enqueue(prefix.subarray(prefix.length - 1));
        controller.enqueue(new Uint8Array([0xff]));
        controller.enqueue(padding);
        controller.enqueue(suffix);
        controller.close();
      },
    });
    const { options: resolveOptions } = options(
      metadataServer(
        () =>
          new Response(body, {
            headers: { ...FLAVOR, 'content-length': String(128 * 1024) },
          }),
      ),
    );
    const identity = await resolveServiceAccountIdentity(resolveOptions);
    expect(await identity.accessToken(signal())).toBe(ACCOUNT_TOKEN);
  });

  it('cancels an oversized token body and preserves the cap error if cancellation rejects', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('cancel failed')));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });
    const { options: resolveOptions } = options(
      metadataServer(() => new Response(body, { headers: FLAVOR })),
    );
    await expect(resolveServiceAccountIdentity(resolveOptions)).rejects.toMatchObject({
      name: 'IdentityError',
      message: `no token could be minted for ${ACCOUNT}: an identity endpoint answered with more than 64 KiB.`,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('without a credentials file, reads the default account and mints its token at start-up', async () => {
    const { options: resolveOptions, calls } = options(metadataServer());
    const identity = await resolveServiceAccountIdentity(resolveOptions);
    expect(identity).toMatchObject({ email: ACCOUNT, source: 'metadata-server' });
    expect(calls.map((call) => call.url)).toEqual([
      `${METADATA_BASE}/instance/service-accounts/default/email`,
      `${METADATA_BASE}/instance/service-accounts/default/token`,
    ]);
    for (const call of calls) {
      expect(call.headers.get('metadata-flavor')).toBe('Google');
      expect(call.redirect).toBe('error');
    }
    // The first token is cached: no further call.
    expect(await identity.accessToken(signal())).toBe(ACCOUNT_TOKEN);
    expect(calls).toHaveLength(2);
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it('an answer without Metadata-Flavor: Google is not the metadata server', async () => {
    const { options: resolveOptions } = options(() => text(200, ACCOUNT));
    const error = await failure(resolveServiceAccountIdentity(resolveOptions));
    expect(error.message).toMatch(/^no Application Default Credentials were found/);
  });

  it('no metadata server at all (a laptop): tried three times, then refused', async () => {
    const { options: resolveOptions, calls } = options(() => {
      throw new TypeError('getaddrinfo ENOTFOUND metadata.google.internal');
    });
    const error = await failure(resolveServiceAccountIdentity(resolveOptions));
    expect(error.message).toMatch(/no gcloud application-default credentials file, and no metadata server/);
    expect(calls).toHaveLength(3);
  });

  it('a default account that is not a service account is refused', async () => {
    const { options: resolveOptions } = options(() => text(200, 'person@example.com', FLAVOR));
    expect((await failure(resolveServiceAccountIdentity(resolveOptions))).message).toMatch(
      /not a service account/,
    );
  });

  it('a token the metadata server refuses stops start-up, naming the status only', async () => {
    const { options: resolveOptions } = options(
      metadataServer(() => json(500, { error: 'internal' }, FLAVOR)),
    );
    expect((await failure(resolveServiceAccountIdentity(resolveOptions))).message).toBe(
      `no token could be minted for ${ACCOUNT}: The metadata server refused with HTTP 500 (internal).`,
    );
  });

  it('a token answer without a usable token is refused', async () => {
    const { options: resolveOptions } = options(
      metadataServer(() => json(200, { access_token: 'has spaces; and "quotes"', expires_in: 3599 }, FLAVOR)),
    );
    expect((await failure(resolveServiceAccountIdentity(resolveOptions))).message).toMatch(
      /answered without a usable access token/,
    );
  });
});

describe('an impersonation file (gcloud auth application-default login --impersonate-service-account)', () => {
  it('mints the source token with the refresh token, then the account’s token at IAM Credentials', async () => {
    const file = '/home/demo/.config/gcloud/application_default_credentials.json';
    const { options: resolveOptions, calls } = options(impersonation(), {
      files: { [file]: impersonationFile() },
    });
    const identity = await resolveServiceAccountIdentity(resolveOptions);
    expect(identity).toMatchObject({ email: ACCOUNT, source: 'impersonation' });
    expect(await identity.accessToken(signal())).toBe(ACCOUNT_TOKEN);

    const [refresh, impersonate, ...rest] = calls;
    expect(rest).toEqual([]);
    expect(refresh?.url).toBe(TOKEN_ENDPOINT);
    expect(refresh?.method).toBe('POST');
    expect(refresh?.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(refresh?.body))).toEqual({
      grant_type: 'refresh_token',
      client_id: '10000000001-demo.apps.googleusercontent.com',
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
    });
    expect(impersonate?.url).toBe(IMPERSONATION_URL);
    expect(impersonate?.headers.get('authorization')).toBe(`Bearer ${SOURCE_TOKEN}`);
    expect(JSON.parse(impersonate?.body ?? '{}')).toEqual({ scope: [...ACCOUNT_SCOPES], lifetime: '3600s' });
  });

  it('GOOGLE_APPLICATION_CREDENTIALS wins over the well-known file, and passes delegates on', async () => {
    const { options: resolveOptions, calls } = options(impersonation(), {
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/secrets/adc.json' },
      files: {
        '/secrets/adc.json': impersonationFile({
          delegates: ['projects/-/serviceAccounts/relay@demo-host.iam.gserviceaccount.com'],
        }),
        '/home/demo/.config/gcloud/application_default_credentials.json': JSON.stringify(authorizedUser()),
      },
    });
    await resolveServiceAccountIdentity(resolveOptions);
    expect(JSON.parse(calls[1]?.body ?? '{}')).toMatchObject({
      delegates: ['projects/-/serviceAccounts/relay@demo-host.iam.gserviceaccount.com'],
    });
  });

  it('a GOOGLE_APPLICATION_CREDENTIALS that names no file is an error, never a fall-through', async () => {
    const { options: resolveOptions, calls } = options(metadataServer(), {
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/secrets/missing.json' },
    });
    expect((await failure(resolveServiceAccountIdentity(resolveOptions))).message).toBe(
      'GOOGLE_APPLICATION_CREDENTIALS names /secrets/missing.json, which does not exist.',
    );
    expect(calls).toEqual([]);
  });

  it.each([
    [
      'another host',
      'https://iamcredentials.example.org/v1/projects/-/serviceAccounts/relay@demo-host.iam.gserviceaccount.com:generateAccessToken',
    ],
    ['plain http', IMPERSONATION_URL.replace('https:', 'http:')],
    ['another method', IMPERSONATION_URL.replace(':generateAccessToken', ':signJwt')],
    ['a person', IMPERSONATION_URL.replace(ACCOUNT, 'person@example.com')],
  ])('refuses an impersonation URL to %s without calling anything', async (_label, url) => {
    const { options: resolveOptions, calls } = options(impersonation(), {
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/secrets/adc.json' },
      files: { '/secrets/adc.json': impersonationFile({ service_account_impersonation_url: url }) },
    });
    expect((await failure(resolveServiceAccountIdentity(resolveOptions))).message).toMatch(
      /must name https:\/\/iamcredentials/,
    );
    expect(calls).toEqual([]);
  });

  it('a refused impersonation says which role is missing, and never what the file holds', async () => {
    const { options: resolveOptions } = options(
      impersonation(() =>
        json(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: `no ${SOURCE_TOKEN}` } }),
      ),
      {
        env: { GOOGLE_APPLICATION_CREDENTIALS: '/secrets/adc.json' },
        files: { '/secrets/adc.json': impersonationFile() },
      },
    );
    const error = await failure(resolveServiceAccountIdentity(resolveOptions));
    expect(error.message).toBe(
      `no token could be minted for ${ACCOUNT}: IAM Credentials refused to impersonate the service account with ` +
        'HTTP 403 (PERMISSION_DENIED): the source credentials need roles/iam.serviceAccountTokenCreator on it.',
    );
    for (const secret of [REFRESH_TOKEN, CLIENT_SECRET, SOURCE_TOKEN, 'secretvalue'])
      expect(error.message).not.toContain(secret);
  });

  it('a refused refresh token names the OAuth error code only', async () => {
    const { options: resolveOptions } = options(
      () => json(400, { error: 'invalid_grant', error_description: `Bad ${REFRESH_TOKEN}` }),
      {
        env: { GOOGLE_APPLICATION_CREDENTIALS: '/secrets/adc.json' },
        files: { '/secrets/adc.json': impersonationFile() },
      },
    );
    const error = await failure(resolveServiceAccountIdentity(resolveOptions));
    expect(error.message).toBe(
      `no token could be minted for ${ACCOUNT}: Google's token endpoint refused with HTTP 400 (invalid_grant).`,
    );
  });
});

describe('a key file (service_account)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const keyFile = (extra: Record<string, unknown> = {}): string =>
    JSON.stringify({
      type: 'service_account',
      project_id: 'demo-host',
      private_key_id: 'key-1',
      private_key: privateKey,
      client_email: ACCOUNT,
      token_uri: TOKEN_ENDPOINT,
      ...extra,
    });

  it('signs a JWT-bearer assertion (RS256) and exchanges it at the token endpoint', async () => {
    const { options: resolveOptions, calls } = options(
      (call) =>
        call.url === TOKEN_ENDPOINT
          ? json(200, { access_token: ACCOUNT_TOKEN, expires_in: 3599 })
          : text(404, ''),
      {
        env: { GOOGLE_APPLICATION_CREDENTIALS: '/secrets/key.json' },
        files: { '/secrets/key.json': keyFile() },
      },
    );
    const identity = await resolveServiceAccountIdentity(resolveOptions);
    expect(identity).toMatchObject({ email: ACCOUNT, source: 'key-file' });
    const form = Object.fromEntries(new URLSearchParams(calls[0]?.body));
    expect(form.grant_type).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header, claims, signature] = (form.assertion ?? '').split('.');
    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString('utf8'))).toEqual({
      alg: 'RS256',
      typ: 'JWT',
      kid: 'key-1',
    });
    const now = Math.floor(clock.now / 1000);
    expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString('utf8'))).toEqual({
      iss: ACCOUNT,
      scope: ACCOUNT_SCOPES.join(' '),
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    });
    const verifier = createVerify('RSA-SHA256').update(`${header ?? ''}.${claims ?? ''}`);
    expect(verifier.verify(createPublicKey(publicKey), Buffer.from(signature ?? '', 'base64url'))).toBe(true);
  });

  it('refuses a token endpoint other than Google’s', async () => {
    const { options: resolveOptions, calls } = options(() => text(500, ''), {
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/secrets/key.json' },
      files: { '/secrets/key.json': keyFile({ token_uri: 'https://token.example.org/token' }) },
    });
    expect((await failure(resolveServiceAccountIdentity(resolveOptions))).message).toMatch(
      /names a token endpoint other than/,
    );
    expect(calls).toEqual([]);
  });

  it('a key that cannot sign is refused without echoing it', async () => {
    const { options: resolveOptions } = options(() => text(500, ''), {
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/secrets/key.json' },
      files: {
        '/secrets/key.json': keyFile({
          private_key: '-----BEGIN PRIVATE KEY-----\nsecretvalue\n-----END PRIVATE KEY-----\n',
        }),
      },
    });
    const error = await failure(resolveServiceAccountIdentity(resolveOptions));
    expect(error.message).toMatch(/cannot sign/);
    expect(error.message).not.toContain('secretvalue');
  });
});

describe('credentials service-account mode does not read', () => {
  it.each([
    [
      'a person’s credentials (authorized_user)',
      JSON.stringify(authorizedUser()),
      /a person's credentials \(authorized_user\).*--impersonate-service-account=BACKEND_SA_EMAIL/,
    ],
    [
      'workload identity federation (external_account)',
      JSON.stringify({ type: 'external_account', audience: 'x' }),
      /type external_account, which this build does not read/,
    ],
    [
      'another universe',
      impersonationFile({ universe_domain: 'example.org' }),
      /universe example\.org are not supported/,
    ],
    ['not JSON', 'not json at all', /is not a Google credentials file/],
    [
      'an incomplete impersonation file',
      JSON.stringify({ type: 'impersonated_service_account' }),
      /not a complete impersonated-service-account file/,
    ],
    [
      'a file over 64 KiB',
      JSON.stringify({ type: 'service_account', padding: 'x'.repeat(70_000) }),
      /larger than 64 KiB/,
    ],
  ])('%s', async (_label, content, message) => {
    const { options: resolveOptions, calls } = options(metadataServer(), {
      files: { '/home/demo/.config/gcloud/application_default_credentials.json': content },
    });
    const error = await failure(resolveServiceAccountIdentity(resolveOptions));
    expect(error.message).toMatch(message);
    for (const secret of [REFRESH_TOKEN, CLIENT_SECRET]) expect(error.message).not.toContain(secret);
    // A file that exists decides: the metadata server is not asked instead.
    expect(calls).toEqual([]);
  });
});

describe('where the well-known file is', () => {
  it('follows CLOUDSDK_CONFIG, then the home directory, and APPDATA on Windows', () => {
    expect(wellKnownFile({ CLOUDSDK_CONFIG: '/etc/gcloud' }, 'linux', '/home/demo')).toBe(
      path.join('/etc/gcloud', 'application_default_credentials.json'),
    );
    expect(wellKnownFile({}, 'darwin', '/Users/demo')).toBe(
      path.join('/Users/demo', '.config', 'gcloud', 'application_default_credentials.json'),
    );
    expect(wellKnownFile({ APPDATA: 'C:\\Users\\demo\\AppData\\Roaming' }, 'win32', 'C:\\Users\\demo')).toBe(
      path.join('C:\\Users\\demo\\AppData\\Roaming', 'gcloud', 'application_default_credentials.json'),
    );
    expect(wellKnownFile({}, 'win32', 'C:\\Users\\demo')).toBeNull();
    expect(wellKnownFile({}, 'linux', '')).toBeNull();
  });
});

describe('the endpoints the identity may call', () => {
  it('are exactly the metadata server, Google’s token endpoint and IAM Credentials generateAccessToken', () => {
    for (const url of [
      `${METADATA_BASE}/instance/service-accounts/default/token`,
      TOKEN_ENDPOINT,
      IMPERSONATION_URL,
    ])
      expect(() => {
        checkIdentityUrl(url);
      }).not.toThrow();
    for (const url of [
      'https://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      'http://metadata.google.internal:8080/computeMetadata/v1/instance',
      'http://metadata.example.org/computeMetadata/v1/instance',
      'http://169.254.169.254/computeMetadata/v1/instance',
      'https://oauth2.googleapis.com/tokeninfo',
      'https://oauth2.googleapis.com/token?x=1',
      'https://cloudasset.googleapis.com/v1/projects/demo/assets',
      'not a url',
    ])
      expect(() => {
        checkIdentityUrl(url);
      }, url).toThrow(IdentityError);
  });
});

describe('the token cache', () => {
  it('shares one mint between concurrent callers and refreshes five minutes before expiry', async () => {
    let now = 0;
    let minted = 0;
    const mint = vi.fn(() => {
      minted += 1;
      return Promise.resolve({ token: `token-${String(minted)}`, lifetimeMs: 3600_000 });
    });
    const tokens = cachedTokens(mint, () => now);
    expect(await Promise.all([tokens(signal()), tokens(signal()), tokens(signal())])).toEqual([
      'token-1',
      'token-1',
      'token-1',
    ]);
    expect(mint).toHaveBeenCalledTimes(1);
    now = 3600_000 - 5 * 60_000 - 1;
    expect(await tokens(signal())).toBe('token-1');
    now += 1;
    expect(await tokens(signal())).toBe('token-2');
  });

  it('a short-lived token is refreshed at half its lifetime', async () => {
    let now = 0;
    let minted = 0;
    const tokens = cachedTokens(
      () => {
        minted += 1;
        return Promise.resolve({ token: `token-${String(minted)}`, lifetimeMs: 120_000 });
      },
      () => now,
    );
    await tokens(signal());
    now = 59_999;
    expect(await tokens(signal())).toBe('token-1');
    now = 60_000;
    expect(await tokens(signal())).toBe('token-2');
  });

  it('when a refresh fails, keeps using a token with 30 s or more left; after that, fails', async () => {
    let now = 0;
    let fail = false;
    const tokens = cachedTokens(
      () =>
        fail
          ? Promise.reject(new IdentityError('down'))
          : Promise.resolve({ token: 'token-1', lifetimeMs: 3600_000 }),
      () => now,
    );
    await tokens(signal());
    fail = true;
    now = 3600_000 - 30_000;
    expect(await tokens(signal())).toBe('token-1');
    now += 1;
    await expect(tokens(signal())).rejects.toThrow('down');
  });

  it('a caller that goes away stops waiting; the refresh goes on for the others', async () => {
    let release: (value: { token: string; lifetimeMs: number }) => void = () => undefined;
    const tokens = cachedTokens(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      () => 0,
    );
    const leaving = new AbortController();
    const first = tokens(leaving.signal);
    const second = tokens(signal());
    const reason = new Error('client gone');
    leaving.abort(reason);
    await expect(first).rejects.toBe(reason);
    release({ token: 'token-1', lifetimeMs: 3600_000 });
    expect(await second).toBe('token-1');
  });
});
