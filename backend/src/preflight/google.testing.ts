// SPDX-License-Identifier: MIT
/**
 * A pretend Google for the preflight, scope-search and service-account gate tests (never built into dist/:
 * tsconfig.build.json leaves `*.testing.ts` out): Resource Manager v3 `get`, `search` and
 * `testIamPermissions`, Cloud Asset Inventory's `assets.list` probe and OAuth2 `tokeninfo`, as an
 * `UpstreamFetch` that records every call, on top of what every pretend Google shares
 * (../upstream/google.testing.ts). Error bodies are shaped like the ones Google gives (skill cai-ingestion
 * §9; scripts/probe-google-apis.sh asks for them), and the gate's answers are declared once, for the gate,
 * the preflight and the routes alike. The data is synthetic (agents.md, Security and privacy, principle 6:
 * `demo-` project ids, numbers below 100000000000, organisation 30000000001, example.com).
 */
import type { GateFinding } from '../auth/gate.js';
import {
  ACCOUNT_TOKEN,
  CALLER_EMAIL,
  googleError,
  htmlResponse,
  jsonResponse,
  recordCall,
  type RecordedCall,
} from '../upstream/google.testing.js';
import type { UpstreamFetch } from '../upstream/request.js';

/** Which Google API a call went to. */
export type Endpoint = 'tokeninfo' | 'get' | 'search' | 'testIam' | 'list' | 'other';

export function endpointOf(call: RecordedCall): Endpoint {
  const { host, pathname } = call.url;
  if (host === 'oauth2.googleapis.com' && pathname === '/tokeninfo') return 'tokeninfo';
  if (host === 'cloudresourcemanager.googleapis.com' && pathname.endsWith(':search')) return 'search';
  if (host === 'cloudresourcemanager.googleapis.com' && pathname.endsWith(':testIamPermissions'))
    return 'testIam';
  if (host === 'cloudresourcemanager.googleapis.com') return 'get';
  if (host === 'cloudasset.googleapis.com' && pathname.endsWith('/assets')) return 'list';
  return 'other';
}

/**
 * Google's answers (skill cai-ingestion §9), by the row of scripts/probe-google-apis.sh that asks for each,
 * as fresh `Response`s.
 */
export const answers = {
  /** g1: the scope's metadata. */
  project: (projectId = 'demo-app-1', displayName = 'Demo app 1'): Response =>
    jsonResponse(200, {
      name: 'projects/10000000001',
      parent: 'folders/20000000001',
      projectId,
      state: 'ACTIVE',
      displayName,
    }),
  folder: (displayName = 'Production'): Response =>
    jsonResponse(200, {
      name: 'folders/20000000001',
      parent: 'organizations/30000000001',
      displayName,
      state: 'ACTIVE',
    }),
  organization: (): Response =>
    jsonResponse(200, { name: 'organizations/30000000001', displayName: 'example.com', state: 'ACTIVE' }),
  /** a, b: a listing page (here: pageSize 1). */
  listed: (): Response =>
    jsonResponse(200, {
      assets: [
        {
          name: '//cloudresourcemanager.googleapis.com/projects/10000000001',
          assetType: 'cloudresourcemanager.googleapis.com/Project',
        },
      ],
      readTime: '2026-10-10T06:00:00.123456Z',
      nextPageToken: 'next',
    }),
  /**
   * `testIamPermissions`: the permissions the caller holds of those asked for. Google answers `{}` when it holds
   * none, for a scope it may not see and for one that does not exist alike.
   */
  permissions: (granted: readonly string[]): Response =>
    jsonResponse(200, granted.length === 0 ? {} : { permissions: granted }),
  /** f2: a listing with nothing in it. */
  emptyListing: (): Response => jsonResponse(200, { readTime: '2026-10-10T06:00:00.123456Z' }),
  /** g3, g4, s3, s7, s11: Resource Manager's IAM denial of `get`. */
  getDenied: (permission: string): Response =>
    googleError(
      403,
      'PERMISSION_DENIED',
      `Permission '${permission}' denied on resource (or it may not exist).`,
      [
        {
          reason: 'IAM_PERMISSION_DENIED',
          domain: 'cloudresourcemanager.googleapis.com',
          metadata: { permission },
        },
      ],
    ),
  /** d1–d3: CAI's own denial, no ErrorInfo. */
  listDenied: (): Response =>
    googleError(
      403,
      'PERMISSION_DENIED',
      'Request denied by Cloud IAM. Missing required IAM permission on requested scope.',
    ),
  /** c2: the Cloud Asset API is disabled in the quota project. */
  serviceDisabled: (project: string): Response =>
    googleError(
      403,
      'PERMISSION_DENIED',
      `Cloud Asset API has not been used in project ${project} before or it is disabled.`,
      [
        {
          reason: 'SERVICE_DISABLED',
          domain: 'googleapis.com',
          metadata: { consumer: `projects/${project}`, service: 'cloudasset.googleapis.com' },
        },
      ],
    ),
  /** c3: no `serviceusage.services.use` on the quota project. */
  quotaDenied: (project: string): Response =>
    googleError(
      403,
      'PERMISSION_DENIED',
      `Caller does not have required permission to use project ${project}.`,
      [
        {
          reason: 'USER_PROJECT_DENIED',
          domain: 'googleapis.com',
          metadata: { consumer: `projects/${project}`, service: 'cloudasset.googleapis.com' },
        },
      ],
    ),
  /** c1: the quota project does not exist. */
  quotaMissing: (project: string): Response =>
    googleError(400, 'INVALID_ARGUMENT', `Project 'projects/${project}' not found or deleted.`, [
      {
        reason: 'USER_PROJECT_DENIED',
        domain: 'googleapis.com',
        metadata: { consumer: `projects/${project}` },
      },
    ]),
  /** The sign-in row's call b: the token lacks the OAuth scope. */
  scopeInsufficient: (service = 'cloudasset.googleapis.com'): Response =>
    googleError(403, 'PERMISSION_DENIED', 'Request had insufficient authentication scopes.', [
      { reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', domain: 'googleapis.com', metadata: { service } },
    ]),
  /** An expired or garbage token. */
  unauthenticated: (): Response =>
    googleError(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.', [
      { reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED', metadata: { service: 'cloudasset.googleapis.com' } },
    ]),
  notFound: (): Response => googleError(404, 'NOT_FOUND', 'Requested entity was not found.'),
  rateLimited: (): Response =>
    googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded.', [
      { reason: 'RATE_LIMIT_EXCEEDED', domain: 'googleapis.com' },
    ]),
  unavailable: (): Response => googleError(503, 'UNAVAILABLE', 'The service is currently unavailable.'),
  internal: (): Response => googleError(500, 'INTERNAL', 'Internal error encountered.'),
  /** VPC Service Controls. */
  securityPolicy: (): Response =>
    googleError(403, 'PERMISSION_DENIED', 'Request is prohibited by organization policy.', [
      { reason: 'SECURITY_POLICY_VIOLATED', domain: 'googleapis.com' },
    ]),
  /** o1: Google's HTML error page. */
  html: htmlResponse,
  /** tokeninfo for a token with the email scope; and without. */
  tokenInfo: (email: string | null = CALLER_EMAIL): Response =>
    jsonResponse(200, {
      azp: '10000000001-demo.apps.googleusercontent.com',
      aud: '10000000001-demo.apps.googleusercontent.com',
      scope:
        'https://www.googleapis.com/auth/cloud-platform.read-only https://www.googleapis.com/auth/cloudasset',
      expires_in: '3599',
      ...(email === null ? {} : { email, email_verified: 'true' }),
    }),
  invalidToken: (): Response =>
    jsonResponse(400, { error: 'invalid_token', error_description: 'Invalid Value' }),
} as const;

/** The permissions a `testIamPermissions` call asked for. */
export function askedPermissions(call: RecordedCall): string[] {
  try {
    const body = JSON.parse(call.body ?? '{}') as { permissions?: unknown };
    return Array.isArray(body.permissions)
      ? body.permissions.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Answers one call; `undefined` falls through to the default for its endpoint. */
export type Handler = (call: RecordedCall, index: number) => Response | Promise<Response> | undefined;

export interface FakeGoogleOptions {
  readonly tokeninfo?: Handler;
  readonly get?: Handler;
  readonly list?: Handler;
  readonly search?: Handler;
  /** `testIamPermissions`; by default every permission asked for is granted. */
  readonly testIam?: Handler;
  /** Anything else (a call that should never happen). */
  readonly other?: Handler;
}

export interface FakeGoogle {
  readonly fetch: UpstreamFetch;
  readonly calls: RecordedCall[];
  /** The calls to one endpoint, in order. */
  readonly callsTo: (endpoint: Endpoint) => RecordedCall[];
}

/** A pretend Google; each endpoint answers 200 unless a handler says otherwise. */
export function fakeGoogle(options: FakeGoogleOptions = {}): FakeGoogle {
  const calls: RecordedCall[] = [];
  const fetch: UpstreamFetch = async (url, init) => {
    const call = recordCall(calls, url, init);
    const index = calls.length - 1;
    const endpoint = endpointOf(call);
    const handler = options[endpoint];
    const answered = await handler?.(call, index);
    if (answered !== undefined) return answered;
    switch (endpoint) {
      case 'tokeninfo':
        return answers.tokenInfo();
      case 'get':
        return call.url.pathname.includes('/folders/')
          ? answers.folder()
          : call.url.pathname.includes('/organizations/')
            ? answers.organization()
            : answers.project();
      case 'list':
        return call.method === 'POST' && call.headers.get('x-http-method-override') === 'GET'
          ? answers.listed()
          : answers.html(404);
      case 'search':
        return jsonResponse(200, {});
      case 'testIam':
        return answers.permissions(askedPermissions(call));
      case 'other':
        return answers.html(404);
    }
  };
  return { fetch, calls, callsTo: (endpoint) => calls.filter((call) => endpointOf(call) === endpoint) };
}

/**
 * The `get` permission of the scope a Resource Manager call names (`/v3/folders/N:testIamPermissions` →
 * `resourcemanager.folders.get`): the one the gate asks the caller for, and the one Google names when it refuses the
 * account's own `get`.
 */
export function getPermissionOfCall(call: RecordedCall): string {
  const collection = /^\/v3\/(organizations|folders|projects)\//.exec(call.url.pathname)?.[1];
  if (collection === undefined) throw new Error(`not a call about a scope: ${call.url.pathname}`);
  return `resourcemanager.${collection}.get`;
}

/** The `get` permission of another kind of scope than `permission`'s. */
function otherKindOf(permission: string): string {
  return permission === 'resourcemanager.folders.get'
    ? 'resourcemanager.projects.get'
    : 'resourcemanager.folders.get';
}

/** One of Google's answers to a step of the service-account gate, and what the gate makes of it. */
export interface GateAnswer {
  readonly label: string;
  /** Google's answer; `permission` is the `get` permission of the scope the call is about. */
  readonly answer: (permission: string) => Response;
  /** What the gate finds in it (auth/gate.ts). */
  readonly finding: GateFinding;
  /** The status and code its refusal answers with. */
  readonly status: 401 | 403 | 503;
  readonly code: string;
}

/**
 * Every answer to the caller's `testIamPermissions` (gate step 1) that keeps the gate closed: the gate's own tests,
 * the preflight's checklist and the routes over HTTP each run them (as synthetic cases).
 */
export const CALLER_REFUSALS: readonly GateAnswer[] = [
  {
    label: '200 {} (no permission held, or no such scope)',
    answer: () => answers.permissions([]),
    finding: 'denied',
    status: 403,
    code: 'SA_GATE_CALLER_DENIED',
  },
  {
    label: '200 with another permission only',
    answer: (permission) => answers.permissions([`${permission}IamPolicy`]),
    finding: 'denied',
    status: 403,
    code: 'SA_GATE_CALLER_DENIED',
  },
  {
    label: '200 naming the get permission of another kind of scope',
    answer: (permission) => answers.permissions([otherKindOf(permission)]),
    finding: 'denied',
    status: 403,
    code: 'SA_GATE_CALLER_DENIED',
  },
  {
    label: '403 IAM_PERMISSION_DENIED',
    answer: (permission) => answers.getDenied(permission),
    finding: 'denied',
    status: 403,
    code: 'SA_GATE_CALLER_DENIED',
  },
  {
    label: '200 whose permissions are not a list',
    answer: (permission) => jsonResponse(200, { permissions: permission }),
    finding: 'unexpected',
    status: 403,
    code: 'SA_GATE_UNEXPECTED',
  },
  {
    label: 'a 200 that is not JSON',
    answer: () => answers.html(200),
    finding: 'unexpected',
    status: 403,
    code: 'SA_GATE_UNEXPECTED',
  },
  {
    label: '404',
    answer: () => answers.notFound(),
    finding: 'unexpected',
    status: 403,
    code: 'SA_GATE_UNEXPECTED',
  },
  {
    label: '400',
    answer: () => jsonResponse(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Bad.' } }),
    finding: 'unexpected',
    status: 403,
    code: 'SA_GATE_UNEXPECTED',
  },
  {
    label: '403 SECURITY_POLICY_VIOLATED (VPC Service Controls)',
    answer: () => answers.securityPolicy(),
    finding: 'unexpected',
    status: 403,
    code: 'SA_GATE_UNEXPECTED',
  },
  {
    label: '403 with an HTML body',
    answer: () => answers.html(403),
    finding: 'unexpected',
    status: 403,
    code: 'SA_GATE_UNEXPECTED',
  },
  {
    label: '403 ACCESS_TOKEN_SCOPE_INSUFFICIENT',
    answer: () => answers.scopeInsufficient('cloudresourcemanager.googleapis.com'),
    finding: 'sign-in',
    status: 403,
    code: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  },
  {
    label: '401',
    answer: () => answers.unauthenticated(),
    finding: 'unauthenticated',
    status: 401,
    code: 'UNAUTHENTICATED',
  },
  {
    label: '429 (after the retries)',
    answer: () => answers.rateLimited(),
    finding: 'transient',
    status: 503,
    code: 'SA_GATE_UNAVAILABLE',
  },
  {
    label: '500 (after the retries)',
    answer: () => answers.internal(),
    finding: 'transient',
    status: 503,
    code: 'SA_GATE_UNAVAILABLE',
  },
  {
    label: '503 (after the retries)',
    answer: () => answers.unavailable(),
    finding: 'transient',
    status: 503,
    code: 'SA_GATE_UNAVAILABLE',
  },
];

/** An IAM denial of the account's own `get` naming `permission`, in `domain`, with these ErrorInfo entries. */
function iamDenial(status: string, permission: string, domains: readonly string[]): Response {
  return googleError(
    403,
    status,
    'Denied.',
    domains.map((domain) => ({ reason: 'IAM_PERMISSION_DENIED', domain, metadata: { permission } })),
  );
}

const exposure = (
  label: string,
  answer: (permission: string) => Response,
  finding: 'exposed' | 'unexpected' | 'transient',
): GateAnswer => ({
  label,
  answer,
  finding,
  status: finding === 'transient' ? 503 : 403,
  code:
    finding === 'exposed'
      ? 'SA_GATE_EXPOSED'
      : finding === 'transient'
        ? 'SA_GATE_UNAVAILABLE'
        : 'SA_GATE_EXPOSURE_UNEXPECTED',
});

/**
 * Every answer to the account's own `get` of the scope (gate step 2 with SA_MODE_STRICT_EXPOSURE) that keeps the
 * gate closed: only Resource Manager's exact IAM denial of the scope's `get` opens it.
 */
export const EXPOSURE_REFUSALS: readonly GateAnswer[] = [
  exposure('200 (a public get, or more than cloudasset.viewer)', () => answers.project(), 'exposed'),
  exposure('403 SERVICE_DISABLED', () => answers.serviceDisabled('demo-host'), 'unexpected'),
  exposure('403 USER_PROJECT_DENIED', () => answers.quotaDenied('demo-host'), 'unexpected'),
  exposure(
    '403 ACCESS_TOKEN_SCOPE_INSUFFICIENT',
    () => answers.scopeInsufficient('cloudresourcemanager.googleapis.com'),
    'unexpected',
  ),
  exposure('403 SECURITY_POLICY_VIOLATED', () => answers.securityPolicy(), 'unexpected'),
  exposure(
    '403 RATE_LIMIT_EXCEEDED',
    () =>
      googleError(403, 'PERMISSION_DENIED', 'Rate limited.', [
        { reason: 'RATE_LIMIT_EXCEEDED', domain: 'googleapis.com' },
      ]),
    'unexpected',
  ),
  exposure('403 with no ErrorInfo', () => answers.listDenied(), 'unexpected'),
  exposure('403 with an HTML body', () => answers.html(403), 'unexpected'),
  exposure(
    'IAM_PERMISSION_DENIED naming the get permission of another kind of scope',
    (permission) => answers.getDenied(otherKindOf(permission)),
    'unexpected',
  ),
  exposure(
    'IAM_PERMISSION_DENIED from another domain',
    (permission) => iamDenial('PERMISSION_DENIED', permission, ['iam.googleapis.com']),
    'unexpected',
  ),
  exposure(
    'two ErrorInfo entries',
    (permission) =>
      iamDenial('PERMISSION_DENIED', permission, [
        'cloudresourcemanager.googleapis.com',
        'cloudresourcemanager.googleapis.com',
      ]),
    'unexpected',
  ),
  exposure(
    'a status other than PERMISSION_DENIED',
    (permission) => iamDenial('FAILED_PRECONDITION', permission, ['cloudresourcemanager.googleapis.com']),
    'unexpected',
  ),
  exposure('404', () => answers.notFound(), 'unexpected'),
  exposure('429', () => answers.rateLimited(), 'transient'),
  exposure('500', () => answers.internal(), 'transient'),
];

/** A `testIam` handler that gives `row`'s answer to the caller's check. */
export function callerAnswer(row: GateAnswer): Handler {
  return (call) => row.answer(getPermissionOfCall(call));
}

/** A `get` handler that gives `row`'s answer to the account's own `get`, and the default to the caller's. */
export function accountGetAnswer(row: GateAnswer): Handler {
  return (call) => (call.token === ACCOUNT_TOKEN ? row.answer(getPermissionOfCall(call)) : undefined);
}
