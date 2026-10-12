// SPDX-License-Identifier: MIT
/**
 * The backend's own identity for service-account mode (ADR 0004; ADR 0028 §1 and its amendment of 2026-10-10):
 * Application Default Credentials (ADC), resolved once at start-up by main.ts when `SA_MODE_ENABLED=true`.
 *
 * Without a client library, on purpose (backend/README.md, "Service-account mode"): on Cloud Run, ADC is one GET to
 * the metadata server, and the few other forms a developer needs locally are one or two POSTs each. A library
 * would bring its own HTTP stack, environment switches and debug logging into the one process that holds the
 * tokens; this module calls exactly the fixed endpoints below, each checked before it is called, with a timeout,
 * no redirect followed, and nothing logged. The order is ADC's own:
 *
 * 1. the file `GOOGLE_APPLICATION_CREDENTIALS` names (a missing or unreadable file is an error, never skipped);
 * 2. gcloud's well-known file (`$CLOUDSDK_CONFIG` or `~/.config/gcloud`, `%APPDATA%\gcloud` on Windows,
 *    `application_default_credentials.json`), written by `gcloud auth application-default login`;
 * 3. the metadata server (Cloud Run, Compute Engine, GKE): `http://metadata.google.internal`.
 *
 * Credential files of three types are read:
 * - `impersonated_service_account` (from `gcloud auth application-default login
 *   --impersonate-service-account=EMAIL`, the way to run service-account mode on a laptop): its source credentials
 *   (`authorized_user` or `service_account`) mint a token at `oauth2.googleapis.com`, which IAM Credentials
 *   (`iamcredentials.googleapis.com`) exchanges for the account's token;
 * - `service_account` (a key file; discouraged, but supported): a signed JWT exchanged at `oauth2.googleapis.com`;
 * - `authorized_user` alone is refused: that is a person, and service-account mode reads as a service account.
 *   `external_account` (workload identity federation) and other universes than `googleapis.com` are refused too.
 *
 * These endpoints are not the upstream allowlist of ../upstream/allowlist.ts (the four hosts the backend calls on a
 * caller's behalf, docs/security.md §1), and they do not widen it: nothing a request carries reaches them, they are
 * fixed here, and the token they hand out is the backend's own. Tokens live in memory only (one per process,
 * refreshed before it expires), never on disk, in a log line, an error message or an answer to the browser.
 */
import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

/** Where the identity came from (logged once at start-up; never the credentials themselves). */
export type IdentitySource = 'metadata-server' | 'impersonation' | 'key-file';

/**
 * The instance's service account for service-account mode: its email (what customers grant
 * `roles/cloudasset.viewer` to, published in /api/config) and its access tokens.
 */
export interface ServiceAccountIdentity {
  readonly email: string;
  readonly source: IdentitySource;
  /** A current access token: cached, refreshed before it expires. Never logged, never sent to the browser. */
  readonly accessToken: (signal: AbortSignal) => Promise<string>;
}

/** Why no identity could be resolved or no token minted. The message never carries a credential. */
export class IdentityError extends Error {
  override readonly name = 'IdentityError';
}

/** The `fetch` the identity calls its fixed endpoints with; tests pass a mock. */
export type IdentityFetch = (url: string, init: RequestInit) => Promise<Response>;

/** The metadata server's base URL (plain HTTP to a link-local address inside the platform, by design). */
export const METADATA_BASE = 'http://metadata.google.internal/computeMetadata/v1';
/** OAuth 2.0 token endpoint: refresh-token and JWT-bearer grants. */
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
/** IAM Credentials `generateAccessToken`, the only URL form an impersonation file may name. */
const IMPERSONATION_URL =
  /^https:\/\/iamcredentials\.googleapis\.com\/v1\/projects\/-\/serviceAccounts\/([^/:?#\s]+):generateAccessToken$/;

/**
 * The OAuth scopes of the account's own tokens where the backend chooses them (impersonation, key file): read-only
 * Google Cloud plus Cloud Asset Inventory, which the quota-project spike's sign-in row measured as enough for both
 * APIs the account calls (CAI `assets.list`, and Resource Manager `get` for the strict exposure check). The metadata
 * server's token keeps the platform's default scope; the account's IAM roles bound what either can do.
 */
export const ACCOUNT_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform.read-only',
  'https://www.googleapis.com/auth/cloudasset',
] as const;

/** The scope a source credential needs to call IAM Credentials. */
const IMPERSONATION_SOURCE_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** One identity request may take this long (the metadata server answers in milliseconds). */
export const DEFAULT_IDENTITY_TIMEOUT_MS = 10_000;
/** The metadata server's first answer at start-up: a few tries, as it can lag a cold container briefly. */
const METADATA_PROBE_ATTEMPTS = 3;
const METADATA_PROBE_DELAY_MS = 500;
/** Largest credential file read. */
const MAX_CREDENTIAL_FILE_BYTES = 64 * 1024;
/** Largest answer read from an identity endpoint. */
const MAX_ANSWER_BYTES = 64 * 1024;
/** Refresh a token this long before it expires (at most half its lifetime). */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** A token still valid for this long is used when a refresh fails. */
const FALLBACK_MIN_REMAINING_MS = 30_000;
/** Requested lifetime of impersonated and key-file tokens. */
const TOKEN_LIFETIME_SECONDS = 3600;

const CREDENTIALS_FILE = 'application_default_credentials.json';

/** RFC 6750 `b64token`, at most 4 KiB: a token that can go into an Authorization header as it is. */
const BEARER_TOKEN = /^[A-Za-z0-9._~+/-]{1,4096}=*$/;
/** A service account's address: `NAME@PROJECT.iam.gserviceaccount.com`, `N-compute@developer.gserviceaccount.com`. */
const SERVICE_ACCOUNT_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.gserviceaccount\.com$/;

export interface ResolveIdentityOptions {
  /** Usually `process.env`: `GOOGLE_APPLICATION_CREDENTIALS`, `CLOUDSDK_CONFIG`, `APPDATA` are read. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch?: IdentityFetch;
  /** Reads a credential file; null when it does not exist. */
  readonly readFile?: (file: string) => Promise<string | null>;
  readonly homedir?: string;
  readonly platform?: NodeJS.Platform;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
}

interface Dependencies {
  readonly fetch: IdentityFetch;
  readonly now: () => number;
  readonly timeoutMs: number;
}

/** A token and how long it lives. */
export interface MintedToken {
  readonly token: string;
  readonly lifetimeMs: number;
}

/** Mints a fresh token for the identity. */
export type Mint = (signal: AbortSignal) => Promise<MintedToken>;

// ---------------------------------------------------------------------------------------------------------------
// Requests to the fixed endpoints

/** Throws unless `url` is one of the identity's fixed endpoints. */
export function checkIdentityUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new IdentityError('an identity endpoint is not a URL.');
  }
  const metadata =
    parsed.protocol === 'http:' &&
    parsed.host === 'metadata.google.internal' &&
    parsed.pathname.startsWith('/computeMetadata/v1/');
  if (metadata || url === TOKEN_ENDPOINT || IMPERSONATION_URL.test(url)) return;
  throw new IdentityError(`the identity never calls ${parsed.protocol}//${parsed.host}.`);
}

/** Reads a body up to `MAX_ANSWER_BYTES`. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader() as
    | {
        read(): Promise<{ done: true; value?: undefined } | { done: false; value: Uint8Array }>;
        cancel(): Promise<void>;
      }
    | undefined;
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ANSWER_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new IdentityError('an identity endpoint answered with more than 64 KiB.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

/** One request to a fixed endpoint, with a timeout; the caller's signal also stops it. */
async function send(
  dependencies: Dependencies,
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
  what: string,
  signal?: AbortSignal,
): Promise<Answer> {
  checkIdentityUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, dependencies.timeoutMs);
  const onAbort = (): void => {
    controller.abort();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await dependencies.fetch(url, {
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      redirect: 'error',
      signal: controller.signal,
    });
    return { status: response.status, headers: response.headers, text: await readCapped(response) };
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    if (signal?.aborted === true)
      throw signal.reason instanceof Error ? signal.reason : new Error('Aborted.');
    throw new IdentityError(
      controller.signal.aborted
        ? `${what} did not answer within ${String(Math.round(dependencies.timeoutMs / 1000))} s.`
        : `${what} could not be reached.`,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The OAuth error code of a failed token request (`invalid_grant`, …), never its description or the body. */
function oauthErrorOf(text: string): string {
  const body = parseJson(text);
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const { error } = body;
    if (typeof error === 'string' && /^[a-z_]{1,64}$/.test(error)) return ` (${error})`;
    if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'string')
      return /^[A-Z_]{1,64}$/.test(error.status) ? ` (${error.status})` : '';
  }
  return '';
}

function checkedToken(token: unknown, what: string): string {
  if (typeof token !== 'string' || !BEARER_TOKEN.test(token))
    throw new IdentityError(`${what} answered without a usable access token.`);
  return token;
}

/** `expires_in` (seconds, a number or a numeric string) as milliseconds; 5 minutes when absent or odd. */
function lifetimeOf(expiresIn: unknown): number {
  const seconds = typeof expiresIn === 'string' ? Number(expiresIn) : expiresIn;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 300_000;
}

/** A token from an OAuth 2.0 token answer (metadata server, token endpoint). */
function oauthToken(answer: Answer, what: string): MintedToken {
  if (answer.status !== 200)
    throw new IdentityError(
      `${what} refused with HTTP ${String(answer.status)}${oauthErrorOf(answer.text)}.`,
    );
  const body = parseJson(answer.text);
  if (typeof body !== 'object' || body === null)
    throw new IdentityError(`${what} answered with something that is not a token.`);
  const record = body as Record<string, unknown>;
  return { token: checkedToken(record.access_token, what), lifetimeMs: lifetimeOf(record.expires_in) };
}

// ---------------------------------------------------------------------------------------------------------------
// The ways to mint a token

function metadataHeaders(): Record<string, string> {
  return { 'metadata-flavor': 'Google' };
}

/** An answer only counts as the metadata server's when it says so (`Metadata-Flavor: Google`). */
function fromMetadataServer(answer: Answer): boolean {
  return answer.headers.get('metadata-flavor') === 'Google';
}

function metadataMint(dependencies: Dependencies): Mint {
  return async (signal) => {
    const answer = await send(
      dependencies,
      `${METADATA_BASE}/instance/service-accounts/default/token`,
      { method: 'GET', headers: metadataHeaders() },
      'The metadata server',
      signal,
    );
    if (answer.status === 200 && !fromMetadataServer(answer))
      throw new IdentityError('the metadata server answered without Metadata-Flavor: Google.');
    return oauthToken(answer, 'The metadata server');
  };
}

function base64Url(data: string | Buffer): string {
  return Buffer.from(data).toString('base64url');
}

/** A JWT-bearer assertion for a key file, signed RS256 with its private key (RFC 7523). */
export function signedAssertion(
  key: { readonly clientEmail: string; readonly privateKey: string; readonly privateKeyId?: string },
  scope: string,
  nowMs: number,
): string {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    ...(key.privateKeyId === undefined ? {} : { kid: key.privateKeyId }),
  };
  const claims = {
    iss: key.clientEmail,
    scope,
    aud: TOKEN_ENDPOINT,
    iat: issuedAt,
    exp: issuedAt + TOKEN_LIFETIME_SECONDS,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  let signature: Buffer;
  try {
    signature = createSign('RSA-SHA256').update(unsigned).sign(key.privateKey);
  } catch {
    throw new IdentityError("the key file's private key cannot sign (it is not an RSA private key in PEM).");
  }
  return `${unsigned}.${base64Url(signature)}`;
}

function formBody(fields: Readonly<Record<string, string>>): string {
  return new URLSearchParams(fields).toString();
}

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

function keyFileMint(dependencies: Dependencies, key: ServiceAccountKey, scope: string): Mint {
  return async (signal) => {
    const assertion = signedAssertion(
      {
        clientEmail: key.client_email,
        privateKey: key.private_key,
        ...(key.private_key_id === undefined ? {} : { privateKeyId: key.private_key_id }),
      },
      scope,
      dependencies.now(),
    );
    const answer = await send(
      dependencies,
      TOKEN_ENDPOINT,
      {
        method: 'POST',
        headers: FORM,
        body: formBody({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      },
      "Google's token endpoint",
      signal,
    );
    return oauthToken(answer, "Google's token endpoint");
  };
}

function refreshTokenMint(dependencies: Dependencies, user: AuthorizedUser): Mint {
  return async (signal) => {
    const answer = await send(
      dependencies,
      TOKEN_ENDPOINT,
      {
        method: 'POST',
        headers: FORM,
        body: formBody({
          grant_type: 'refresh_token',
          client_id: user.client_id,
          client_secret: user.client_secret,
          refresh_token: user.refresh_token,
        }),
      },
      "Google's token endpoint",
      signal,
    );
    return oauthToken(answer, "Google's token endpoint");
  };
}

function impersonationMint(
  dependencies: Dependencies,
  url: string,
  delegates: readonly string[],
  source: Mint,
): Mint {
  return async (signal) => {
    const { token: sourceToken } = await source(signal);
    const answer = await send(
      dependencies,
      url,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${sourceToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: ACCOUNT_SCOPES,
          lifetime: `${String(TOKEN_LIFETIME_SECONDS)}s`,
          ...(delegates.length === 0 ? {} : { delegates }),
        }),
      },
      'IAM Credentials',
      signal,
    );
    if (answer.status !== 200)
      throw new IdentityError(
        `IAM Credentials refused to impersonate the service account with HTTP ${String(answer.status)}` +
          `${oauthErrorOf(answer.text)}: the source credentials need roles/iam.serviceAccountTokenCreator on it.`,
      );
    const body = parseJson(answer.text);
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const token = checkedToken(record.accessToken, 'IAM Credentials');
    const expires = typeof record.expireTime === 'string' ? Date.parse(record.expireTime) : Number.NaN;
    const lifetimeMs = Number.isFinite(expires) ? expires - dependencies.now() : 300_000;
    return { token, lifetimeMs: lifetimeMs > 0 ? lifetimeMs : 300_000 };
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The token cache

/**
 * One token per process, minted on first use and refreshed `REFRESH_MARGIN_MS` before it expires. Concurrent
 * callers share one refresh; a caller that goes away stops waiting, not the refresh. If a refresh fails while the
 * old token still has 30 s or more, the old token is used.
 */
export function cachedTokens(mint: Mint, now: () => number): (signal: AbortSignal) => Promise<string> {
  let current: { readonly token: string; readonly refreshAt: number; readonly expiresAt: number } | null =
    null;
  let pending: Promise<string> | null = null;

  const refresh = async (): Promise<string> => {
    const started = now();
    try {
      const minted = await mint(new AbortController().signal);
      const margin = Math.min(REFRESH_MARGIN_MS, minted.lifetimeMs / 2);
      current = {
        token: minted.token,
        refreshAt: started + minted.lifetimeMs - margin,
        expiresAt: started + minted.lifetimeMs,
      };
      return minted.token;
    } catch (error) {
      if (current !== null && current.expiresAt - now() >= FALLBACK_MIN_REMAINING_MS) return current.token;
      throw error;
    }
  };

  return (signal) => {
    if (current !== null && now() < current.refreshAt) return Promise.resolve(current.token);
    pending ??= refresh().finally(() => {
      pending = null;
    });
    const shared = pending;
    if (signal.aborted) return Promise.reject(signal.reason as Error);
    return new Promise<string>((resolve, reject) => {
      const onAbort = (): void => {
        reject(signal.reason as Error);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      shared.then(
        (token) => {
          signal.removeEventListener('abort', onAbort);
          resolve(token);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error instanceof Error ? error : new IdentityError('No token.'));
        },
      );
    });
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Credential files

const UniverseSchema = z.string().optional();

const AuthorizedUserSchema = z.object({
  type: z.literal('authorized_user'),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  refresh_token: z.string().min(1),
  universe_domain: UniverseSchema,
});
type AuthorizedUser = z.infer<typeof AuthorizedUserSchema>;

const ServiceAccountKeySchema = z.object({
  type: z.literal('service_account'),
  client_email: z.string().regex(SERVICE_ACCOUNT_EMAIL),
  private_key: z.string().min(1),
  private_key_id: z.string().optional(),
  token_uri: z.string().optional(),
  universe_domain: UniverseSchema,
});
type ServiceAccountKey = z.infer<typeof ServiceAccountKeySchema>;

const ImpersonatedSchema = z.object({
  type: z.literal('impersonated_service_account'),
  service_account_impersonation_url: z.string(),
  delegates: z.array(z.string().regex(/^[\w.@:/-]{1,300}$/)).optional(),
  source_credentials: z.discriminatedUnion('type', [AuthorizedUserSchema, ServiceAccountKeySchema]),
  universe_domain: UniverseSchema,
});

const TypeSchema = z.object({ type: z.string() });

/** The service account an IAM Credentials `generateAccessToken` URL names, or null when it is not one. */
function impersonatedEmailOf(url: string): string | null {
  const encoded = IMPERSONATION_URL.exec(url)?.[1];
  if (encoded === undefined) return null;
  let email: string;
  try {
    email = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  return SERVICE_ACCOUNT_EMAIL.test(email) ? email : null;
}

function checkUniverse(universe: string | undefined): void {
  if (universe !== undefined && universe !== 'googleapis.com')
    throw new IdentityError(`credentials for the universe ${universe} are not supported.`);
}

/** Reads a file, or null when it does not exist. */
async function readOptionalFile(file: string): Promise<string | null> {
  try {
    const text = await readFile(file, 'utf8');
    return text;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return null;
    throw new IdentityError(`the credentials file ${file} cannot be read.`);
  }
}

/** gcloud's well-known ADC file for this environment, or null when there is no home to look in. */
export function wellKnownFile(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  homedir: string,
): string | null {
  const configDirectory = env.CLOUDSDK_CONFIG?.trim();
  if (configDirectory !== undefined && configDirectory !== '')
    return path.join(configDirectory, CREDENTIALS_FILE);
  if (platform === 'win32') {
    const appData = env.APPDATA?.trim();
    return appData === undefined || appData === '' ? null : path.join(appData, 'gcloud', CREDENTIALS_FILE);
  }
  return homedir === '' ? null : path.join(homedir, '.config', 'gcloud', CREDENTIALS_FILE);
}

/** The identity a credential file describes. `where` names the file in messages (never its contents). */
function identityFromFile(text: string, where: string, dependencies: Dependencies): ResolvedIdentity {
  if (Buffer.byteLength(text, 'utf8') > MAX_CREDENTIAL_FILE_BYTES)
    throw new IdentityError(`${where} is larger than 64 KiB.`);
  const parsed = parseJson(text);
  const typed = TypeSchema.safeParse(parsed);
  if (!typed.success) throw new IdentityError(`${where} is not a Google credentials file.`);
  switch (typed.data.type) {
    case 'service_account': {
      const key = ServiceAccountKeySchema.safeParse(parsed);
      if (!key.success) throw new IdentityError(`${where} is not a complete service-account key file.`);
      checkUniverse(key.data.universe_domain);
      if (key.data.token_uri !== undefined && key.data.token_uri !== TOKEN_ENDPOINT)
        throw new IdentityError(`${where} names a token endpoint other than ${TOKEN_ENDPOINT}.`);
      return {
        email: key.data.client_email,
        source: 'key-file',
        mint: keyFileMint(dependencies, key.data, ACCOUNT_SCOPES.join(' ')),
      };
    }
    case 'impersonated_service_account': {
      const file = ImpersonatedSchema.safeParse(parsed);
      if (!file.success)
        throw new IdentityError(`${where} is not a complete impersonated-service-account file.`);
      checkUniverse(file.data.universe_domain);
      const url = file.data.service_account_impersonation_url;
      const email = impersonatedEmailOf(url);
      if (email === null)
        throw new IdentityError(
          `${where} must name https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/EMAIL:generateAccessToken.`,
        );
      const sourceCredentials = file.data.source_credentials;
      checkUniverse(sourceCredentials.universe_domain);
      if (
        sourceCredentials.type === 'service_account' &&
        sourceCredentials.token_uri !== undefined &&
        sourceCredentials.token_uri !== TOKEN_ENDPOINT
      )
        throw new IdentityError(`${where} names a token endpoint other than ${TOKEN_ENDPOINT}.`);
      const source =
        sourceCredentials.type === 'authorized_user'
          ? refreshTokenMint(dependencies, sourceCredentials)
          : keyFileMint(dependencies, sourceCredentials, IMPERSONATION_SOURCE_SCOPE);
      return {
        email,
        source: 'impersonation',
        mint: impersonationMint(dependencies, url, file.data.delegates ?? [], source),
      };
    }
    case 'authorized_user':
      throw new IdentityError(
        `${where} holds a person's credentials (authorized_user), and service-account mode reads as a service ` +
          'account. On your machine, run `gcloud auth application-default login ' +
          '--impersonate-service-account=BACKEND_SA_EMAIL`; on Cloud Run, the service account the service runs as ' +
          'is used.',
      );
    default:
      throw new IdentityError(
        `${where} has credentials of type ${typed.data.type.replace(/[^\w-]/g, '?').slice(0, 40)}, which this ` +
          'build does not read (it reads the metadata server, impersonated_service_account and service_account).',
      );
  }
}

interface ResolvedIdentity {
  readonly email: string;
  readonly source: IdentitySource;
  readonly mint: Mint;
}

/** The metadata server's account, or null when there is no metadata server. */
async function metadataIdentity(
  dependencies: Dependencies,
  sleep: (ms: number) => Promise<void>,
): Promise<ResolvedIdentity | null> {
  let answer: Answer | null = null;
  for (let attempt = 1; attempt <= METADATA_PROBE_ATTEMPTS; attempt += 1) {
    try {
      answer = await send(
        { ...dependencies, timeoutMs: Math.min(dependencies.timeoutMs, 3000) },
        `${METADATA_BASE}/instance/service-accounts/default/email`,
        { method: 'GET', headers: metadataHeaders() },
        'The metadata server',
      );
      if (answer.status < 500) break;
    } catch {
      answer = null;
    }
    if (attempt < METADATA_PROBE_ATTEMPTS) await sleep(METADATA_PROBE_DELAY_MS);
  }
  if (answer === null || !fromMetadataServer(answer)) return null;
  if (answer.status !== 200)
    throw new IdentityError(`the metadata server has no service account (HTTP ${String(answer.status)}).`);
  const email = answer.text.trim();
  if (!SERVICE_ACCOUNT_EMAIL.test(email))
    throw new IdentityError("the metadata server's default account is not a service account address.");
  return { email, source: 'metadata-server', mint: metadataMint(dependencies) };
}

/**
 * Resolves Application Default Credentials into the instance's service-account identity and mints a first token,
 * so a broken setup fails at start-up rather than on the first request. Throws {@link IdentityError}.
 */
export async function resolveServiceAccountIdentity(
  options: ResolveIdentityOptions,
): Promise<ServiceAccountIdentity> {
  const dependencies: Dependencies = {
    fetch: options.fetch ?? ((url, init) => fetch(url, init)),
    now: options.now ?? Date.now,
    timeoutMs: options.timeoutMs ?? DEFAULT_IDENTITY_TIMEOUT_MS,
  };
  const read = options.readFile ?? readOptionalFile;
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));

  let resolved: ResolvedIdentity | null;
  const named = options.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (named !== undefined && named !== '') {
    const text = await read(named);
    if (text === null)
      throw new IdentityError(`GOOGLE_APPLICATION_CREDENTIALS names ${named}, which does not exist.`);
    resolved = identityFromFile(text, `GOOGLE_APPLICATION_CREDENTIALS (${named})`, dependencies);
  } else {
    const file = wellKnownFile(
      options.env,
      options.platform ?? process.platform,
      options.homedir ?? os.homedir(),
    );
    const text = file === null ? null : await read(file);
    if (file !== null && text !== null) resolved = identityFromFile(text, file, dependencies);
    else resolved = await metadataIdentity(dependencies, sleep);
  }
  if (resolved === null)
    throw new IdentityError(
      'no Application Default Credentials were found: no GOOGLE_APPLICATION_CREDENTIALS, no gcloud ' +
        'application-default credentials file, and no metadata server.',
    );

  const accessToken = cachedTokens(resolved.mint, dependencies.now);
  try {
    await accessToken(new AbortController().signal);
  } catch (error) {
    throw error instanceof IdentityError
      ? new IdentityError(`no token could be minted for ${resolved.email}: ${error.message}`)
      : error;
  }
  return Object.freeze({ email: resolved.email, source: resolved.source, accessToken });
}
