// SPDX-License-Identifier: Apache-2.0
/**
 * The backend in service-account mode against a pretend Google, for e2e/tests/sa-mode.spec.ts (never imported
 * by the app, so neither bundle carries it). The spec starts it as a process and sends the browser's `/api`
 * requests to it, so the real routes, the real gate (./gate.ts) and the real Application Default Credentials
 * code (./identity.ts, its metadata-server path) run end to end; only Google is pretend:
 *
 * - the metadata server: the account `gcportrait-backend@demo-host.iam.gserviceaccount.com` and its token;
 * - OAuth2 tokeninfo: the caller's token (`--caller-token`) belongs to `ada@example.com`;
 * - Resource Manager: search over a synthetic organisation; `testIamPermissions` grants the caller the `get` of
 *   folders 20000000001 (Platform) and 20000000003 (Shared), never of 20000000002 (Finance); the account's own
 *   `get` is Resource Manager's IAM denial for Platform and a 200 (public) for Shared;
 * - Cloud Asset Inventory: the account may list Platform (one page of a synthetic organisation); anything else is
 *   CAI's 403.
 *
 * It prints JSON lines on stdout: `{"ready":{"port":N}}` once listening, `{"call":{…}}` per call to the pretend
 * Google (host, path, method, whose token, whether a quota header was sent: never a token), `{"audit":{…}}` per
 * audit line of the gate, and `{"leak":"…"}` if a log line ever carried a token or the caller's email.
 * Arguments: `--caller-token TOKEN` (required), `--strict` (SA_MODE_STRICT_EXPOSURE=true). Everything is
 * synthetic (AGENTS.md, Security and privacy, principle 6): organisation 30000000001, `demo-` projects,
 * numbers below 100000000000, example.com.
 */
import { Writable } from 'node:stream';

import { parseConfig } from '../config.js';
import { buildServer } from '../server.js';
import { METADATA_BASE, resolveServiceAccountIdentity, type IdentityFetch } from './identity.js';

const ACCOUNT_EMAIL = 'gcportrait-backend@demo-host.iam.gserviceaccount.com';
const ACCOUNT_TOKEN = 'e2e-fake-account-token-from-adc';
const CALLER_EMAIL = 'ada@example.com';
const CLIENT_ID = '12345678901-e2eclient.apps.googleusercontent.com';
const READ_TIME = '2026-10-10T09:00:00.123456Z';
const CRM = '//cloudresourcemanager.googleapis.com';

const ORGANIZATION = { name: 'organizations/30000000001', displayName: 'example.com', state: 'ACTIVE' };
const FOLDERS = [
  { name: 'folders/20000000001', displayName: 'Platform', parent: ORGANIZATION.name, state: 'ACTIVE' },
  { name: 'folders/20000000002', displayName: 'Finance', parent: ORGANIZATION.name, state: 'ACTIVE' },
  { name: 'folders/20000000003', displayName: 'Shared', parent: ORGANIZATION.name, state: 'ACTIVE' },
];
/** The scopes whose `get` the caller holds. */
const CALLER_MAY_SEE = new Set(['folders/20000000001', 'folders/20000000003']);
/** The scope whose `get` is public, so the account can read it too. */
const PUBLIC_SCOPE = 'folders/20000000003';
/** The scope the account was granted `roles/cloudasset.viewer` on. */
const GRANTED_SCOPE = 'folders/20000000001';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requiredArgument(name: string): string {
  const value = argument(name);
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

const callerToken = requiredArgument('--caller-token');
const strict = process.argv.includes('--strict');

function emit(line: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
}

/** The synthetic organisation under Platform, in the `assets.list` shape. */
function platformAssets(): Record<string, unknown>[] {
  const asset = (
    name: string,
    assetType: string,
    data: Record<string, unknown>,
    ancestors: string[],
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    name,
    assetType,
    resource: { version: 'v1', data, ...extra },
    ancestors,
    updateTime: '2026-10-09T18:22:41.123456Z',
  });
  const under = (project?: string): string[] => [
    ...(project === undefined ? [] : [`projects/${project}`]),
    'folders/20000000001',
    'organizations/30000000001',
  ];
  const assets = [
    asset(
      `${CRM}/folders/20000000001`,
      'cloudresourcemanager.googleapis.com/Folder',
      { displayName: 'Platform' },
      under(),
      { parent: `${CRM}/organizations/30000000001` },
    ),
  ];
  for (const [number, id] of [
    ['10000000011', 'demo-net-1'],
    ['10000000012', 'demo-app-1'],
  ] as const)
    assets.push(
      asset(
        `${CRM}/projects/${number}`,
        'cloudresourcemanager.googleapis.com/Project',
        { projectId: id, projectNumber: number, name: id },
        under(number),
        { parent: `${CRM}/folders/20000000001` },
      ),
    );
  assets.push(
    asset(
      '//compute.googleapis.com/projects/demo-net-1/global/networks/core',
      'compute.googleapis.com/Network',
      { name: 'core' },
      under('10000000011'),
      { parent: `${CRM}/projects/10000000011` },
    ),
  );
  for (let index = 1; index <= 6; index += 1)
    assets.push(
      asset(
        `//compute.googleapis.com/projects/demo-app-1/zones/europe-west3-a/instances/api-${String(index)}`,
        'compute.googleapis.com/Instance',
        {
          name: `api-${String(index)}`,
          status: 'RUNNING',
          networkInterfaces: [
            {
              network: 'https://www.googleapis.com/compute/v1/projects/demo-net-1/global/networks/core',
              networkIP: `10.1.0.${String(index + 10)}`,
            },
          ],
        },
        under('10000000012'),
        { parent: `${CRM}/projects/10000000012`, location: 'europe-west3-a' },
      ),
    );
  return assets;
}

/** Whose token a call carries. */
function bearerOf(headers: Headers): 'caller' | 'account' | 'other' | 'none' {
  const value = headers.get('authorization');
  if (value === null) return 'none';
  if (value === `Bearer ${callerToken}`) return 'caller';
  if (value === `Bearer ${ACCOUNT_TOKEN}`) return 'account';
  return 'other';
}

const iamDenial = (permission: string): Response =>
  json(403, {
    error: {
      code: 403,
      status: 'PERMISSION_DENIED',
      message: `Permission '${permission}' denied on resource (or it may not exist).`,
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'IAM_PERMISSION_DENIED',
          domain: 'cloudresourcemanager.googleapis.com',
          metadata: { permission },
        },
      ],
    },
  });

/** The pretend Google APIs the backend calls through its allowlisted client. */
function pretendGoogle(url: string, init: RequestInit): Promise<Response> {
  return Promise.resolve(answer(url, init));
}

function answer(url: string, init: RequestInit): Response {
  const parsed = new URL(url);
  const headers = new Headers(init.headers);
  const as = bearerOf(headers);
  const body = typeof init.body === 'string' ? init.body : '';
  emit({
    call: {
      host: parsed.host,
      path: parsed.pathname,
      method: init.method ?? 'GET',
      as,
      quotaHeader: headers.has('x-goog-user-project'),
    },
  });
  if (parsed.host === 'oauth2.googleapis.com' && parsed.pathname === '/tokeninfo') {
    const token = new URLSearchParams(body).get('access_token');
    return token === callerToken
      ? json(200, { aud: CLIENT_ID, azp: CLIENT_ID, email: CALLER_EMAIL, expires_in: '3599' })
      : json(400, { error: 'invalid_token' });
  }
  if (parsed.host === 'cloudresourcemanager.googleapis.com') {
    const path = parsed.pathname.replace(/^\/v3\//, '');
    if (path === 'organizations:search')
      return json(200, as === 'caller' ? { organizations: [ORGANIZATION] } : {});
    if (path === 'folders:search') return json(200, as === 'caller' ? { folders: FOLDERS } : {});
    if (path === 'projects:search') return json(200, {});
    const tested = /^((?:organizations|folders|projects)\/[^:]+):testIamPermissions$/.exec(path);
    if (tested !== null) {
      const asked = (JSON.parse(body === '' ? '{}' : body) as { permissions?: string[] }).permissions ?? [];
      const granted = as === 'caller' && CALLER_MAY_SEE.has(tested[1] ?? '');
      return json(200, granted ? { permissions: asked } : {});
    }
    const kind = /^(organizations|folders|projects)\//.exec(path)?.[1] ?? 'projects';
    if (as === 'account')
      return path === PUBLIC_SCOPE
        ? json(
            200,
            FOLDERS.find((folder) => folder.name === path),
          )
        : iamDenial(`resourcemanager.${kind}.get`);
    const folder = FOLDERS.find((entry) => entry.name === path);
    return as === 'caller' && folder !== undefined && CALLER_MAY_SEE.has(path)
      ? json(200, folder)
      : iamDenial(`resourcemanager.${kind}.get`);
  }
  if (parsed.host === 'cloudasset.googleapis.com' && parsed.pathname.endsWith('/assets')) {
    const scope = parsed.pathname.replace(/^\/v1\//, '').replace(/\/assets$/, '');
    if (as === 'account' && scope === GRANTED_SCOPE && headers.get('x-http-method-override') === 'GET')
      return json(200, { assets: platformAssets(), readTime: READ_TIME });
    return json(403, {
      error: {
        code: 403,
        status: 'PERMISSION_DENIED',
        message: 'Request denied by Cloud IAM. Missing required IAM permission on requested scope.',
      },
    });
  }
  return new Response('<!DOCTYPE html><html><body>Not found</body></html>', {
    status: 404,
    headers: { 'content-type': 'text/html' },
  });
}

/** The metadata server of a Cloud Run service running as the account. */
const metadataServer: IdentityFetch = (url) => {
  const flavor = { 'metadata-flavor': 'Google' };
  if (url === `${METADATA_BASE}/instance/service-accounts/default/email`)
    return Promise.resolve(new Response(ACCOUNT_EMAIL, { status: 200, headers: flavor }));
  if (url === `${METADATA_BASE}/instance/service-accounts/default/token`)
    return Promise.resolve(
      new Response(JSON.stringify({ access_token: ACCOUNT_TOKEN, expires_in: 3599, token_type: 'Bearer' }), {
        status: 200,
        headers: { ...flavor, 'content-type': 'application/json' },
      }),
    );
  return Promise.resolve(new Response('not found', { status: 404, headers: flavor }));
};

/** Forwards the gate's audit lines, and reports any log line that carries a secret. */
const logSink = new Writable({
  write(chunk: Buffer, _encoding, callback) {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim() === '') continue;
      for (const secret of [callerToken, ACCOUNT_TOKEN, CALLER_EMAIL])
        if (line.includes(secret)) emit({ leak: secret === CALLER_EMAIL ? 'email' : 'token' });
      if (line.includes('"service-account gate"'))
        emit({ audit: (JSON.parse(line) as { audit: unknown }).audit });
    }
    callback();
  },
});

const identity = await resolveServiceAccountIdentity({
  env: {},
  fetch: metadataServer,
  readFile: () => Promise.resolve(null),
});
const app = await buildServer(
  parseConfig({
    SA_MODE_ENABLED: 'true',
    SA_MODE_STRICT_EXPOSURE: strict ? 'true' : 'false',
    OAUTH_CLIENT_ID: CLIENT_ID,
    HOSTED_BY: 'Example Ltd.',
    SOURCE_URL: 'https://git.example.org/team/gcportrait-fork',
    APP_VERSION: '0.0.0-e2e',
    STATIC_DIR: '/nonexistent-gcportrait-dist',
    LOG_LEVEL: 'info',
  }),
  { serviceAccount: identity, logDestination: logSink, upstream: { fetch: pretendGoogle } },
);
const address = await app.listen({ host: '127.0.0.1', port: 0 });
emit({ ready: { port: Number(new URL(address).port) } });

const stop = (): void => {
  void app.close().finally(() => process.exit(0));
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
