// SPDX-License-Identifier: MIT
/**
 * The preflight's matrix (every checklist row of docs/permissions.md × ok/403/404/429/5xx; ADR 0028 §2 table and §4
 * gate), run against a pretend Google whose answers are shaped like the ones the quota-project spike recorded.
 */
import { describe, expect, it } from 'vitest';

import { ServiceAccountGate } from '../auth/gate.js';
import type { ServiceAccountIdentity } from '../auth/identity.js';
import {
  ACCOUNT_EMAIL,
  ACCOUNT_TOKEN,
  CALLER_EMAIL,
  CALLER_TOKEN,
  fakeAccount,
  googleError,
  jsonResponse,
  scopeOf,
  testContext,
  type RecordedCall,
} from '../upstream/google.testing.js';
import type { ParsedScope } from '../upstream/scope.js';
import {
  accountGetAnswer,
  answers,
  askedPermissions,
  CALLER_REFUSALS,
  callerAnswer,
  endpointOf,
  EXPOSURE_REFUSALS,
  fakeGoogle,
  type FakeGoogle,
  type FakeGoogleOptions,
  type Handler,
} from './google.testing.js';
import { outcomeOf, runPreflight, type PreflightResult } from './run.js';
import { PreflightResponseSchema, type PreflightItem, type PreflightResponse } from './schemas.js';

const PROJECT = scopeOf('projects/demo-app-1');
const FOLDER = scopeOf('folders/20000000001');
const ORGANIZATION = scopeOf('organizations/30000000001');

const USER = `user:${CALLER_EMAIL}`;
const ACCOUNT = `serviceAccount:${ACCOUNT_EMAIL}`;

/** Service-account mode: the instance's identity and whether the strict exposure check runs (default off). */
interface Account {
  readonly identity: ServiceAccountIdentity;
  readonly strictExposure?: boolean;
}

const strict = (identity: ServiceAccountIdentity = fakeAccount()): Account => ({
  identity,
  strictExposure: true,
});
const lenient = (identity: ServiceAccountIdentity = fakeAccount()): Account => ({ identity });

interface Run {
  readonly google: FakeGoogle;
  readonly result: PreflightResult;
}

async function run(
  options: FakeGoogleOptions,
  input: { readonly scope?: ParsedScope; readonly mode?: 'user' | 'sa'; readonly quotaProject?: string } = {},
  account: Account | null = null,
): Promise<Run> {
  const google = fakeGoogle(options);
  const gate =
    account === null
      ? null
      : new ServiceAccountGate({
          identity: account.identity,
          strictExposure: account.strictExposure ?? false,
        });
  const result = await runPreflight(
    {
      scope: input.scope ?? PROJECT,
      mode: input.mode ?? 'user',
      token: CALLER_TOKEN,
      ...(input.quotaProject === undefined ? {} : { quotaProject: input.quotaProject }),
    },
    { context: testContext(google.fetch), gate, serviceAccountEmail: ACCOUNT_EMAIL },
  );
  return { google, result };
}

function checklist(result: PreflightResult): PreflightResponse {
  if (result.kind !== 'checklist') throw new Error(`expected a checklist, got ${result.kind}`);
  // Every answer must fit the declared contract (the route serialises through it).
  return PreflightResponseSchema.parse(result.response);
}

function itemOf(response: PreflightResponse, id: PreflightItem['id']): PreflightItem {
  const found = response.items.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no item ${id}`);
  return found;
}

/** The scope a Resource Manager or CAI call names in its path. */
function scopeOfCall(call: RecordedCall): string {
  const match = /^\/v[13]\/((?:organizations|folders|projects)\/[^/:]+)/.exec(call.url.pathname);
  return match?.[1] ?? call.url.pathname;
}

/** Answers every call to an endpoint with the same response. */
const always =
  (make: () => Response): Handler =>
  () =>
    make();

/** Answers by the quota project in `x-goog-user-project`. */
const byQuotaProject =
  (table: Readonly<Record<string, () => Response>>): Handler =>
  (call) => {
    const project = call.headers.get('x-goog-user-project') ?? '';
    return table[project]?.();
  };

const QUOTA_DENIED_TRANSIENT = [
  ['429', answers.rateLimited],
  ['500', answers.internal],
  ['503', answers.unavailable],
] as const;

describe('user mode, row "resourcemanager.*.get on the scope" (step 1, a warning only)', () => {
  it('ok: 200 gives the display name and the checks go on', async () => {
    const { google, result } = await run({});
    const response = checklist(result);
    expect(response.displayName).toBe('Demo app 1');
    expect(itemOf(response, 'scope-details')).toMatchObject({
      status: 'ok',
      finding: 'ok',
      blocking: false,
      commands: [],
    });
    expect(google.callsTo('list')).toHaveLength(1);
    expect(response.outcome).toBe('ready');
  });

  it('403 IAM_PERMISSION_DENIED: missing, with the roles/browser command, and the checks go on', async () => {
    const { google, result } = await run({
      get: always(() => answers.getDenied('resourcemanager.projects.get')),
    });
    const response = checklist(result);
    const details = itemOf(response, 'scope-details');
    expect(details).toMatchObject({
      status: 'missing',
      finding: 'denied',
      blocking: false,
      permission: 'resourcemanager.projects.get',
      role: 'roles/browser',
      commands: [
        `gcloud projects add-iam-policy-binding demo-app-1 --member="${USER}" --role="roles/browser"`,
      ],
    });
    expect(details.upstream).toMatchObject({
      status: 403,
      code: 'PERMISSION_DENIED',
      reason: 'IAM_PERMISSION_DENIED',
    });
    expect(response.displayName).toBeUndefined();
    // The warning does not block: the scope's own project is still tried as the quota project.
    expect(google.callsTo('list')).toHaveLength(1);
    expect(response.outcome).toBe('ready');
  });

  it('404: not understood, so it stops and fails closed without a CAI call', async () => {
    const { google, result } = await run({ get: always(answers.notFound) });
    const response = checklist(result);
    expect(itemOf(response, 'scope-details')).toMatchObject({ status: 'unknown', finding: 'unexpected' });
    expect(itemOf(response, 'scope-details').upstream).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(itemOf(response, 'quota-project')).toMatchObject({ status: 'unknown', finding: 'not-checked' });
    expect(itemOf(response, 'cai-access')).toMatchObject({ status: 'unknown', finding: 'not-checked' });
    expect(google.callsTo('list')).toHaveLength(0);
    expect(response.outcome).toBe('blocked');
  });

  it.each(QUOTA_DENIED_TRANSIENT)(
    '%s: retried five times, then "try again" without a CAI call',
    async (_status, make) => {
      const { google, result } = await run({ get: always(make) });
      const response = checklist(result);
      expect(itemOf(response, 'scope-details')).toMatchObject({ status: 'unknown', finding: 'transient' });
      expect(google.callsTo('get')).toHaveLength(5);
      expect(google.callsTo('list')).toHaveLength(0);
      expect(response.outcome).toBe('retry');
    },
  );

  it('401: the token is not accepted at all (the route answers 401)', async () => {
    const { result } = await run({ get: always(answers.unauthenticated) });
    expect(result).toEqual({ kind: 'unauthenticated' });
  });

  it('403 ACCESS_TOKEN_SCOPE_INSUFFICIENT: sign in again', async () => {
    const { google, result } = await run({
      get: always(() => answers.scopeInsufficient('cloudresourcemanager.googleapis.com')),
    });
    const response = checklist(result);
    expect(itemOf(response, 'scope-details')).toMatchObject({ status: 'unknown', finding: 'sign-in' });
    expect(google.callsTo('list')).toHaveLength(0);
    expect(response.outcome).toBe('sign-in');
  });

  it('never sends the quota header to Resource Manager (ADR 0028 §1)', async () => {
    const { google } = await run({}, { quotaProject: 'demo-quota-1' });
    for (const call of google.callsTo('get')) expect(call.headers.has('x-goog-user-project')).toBe(false);
  });
});

describe('user mode, row "quota project: Cloud Asset API enabled + serviceusage.services.use" (step 2)', () => {
  it('ok: the scanned project itself, sent as x-goog-user-project, with the probe of skill §1', async () => {
    const { google, result } = await run({});
    const response = checklist(result);
    expect(response.quotaProject).toBe('demo-app-1');
    expect(response.candidates).toEqual([
      { project: 'demo-app-1', source: 'scope', result: 'usable', commands: [] },
    ]);
    expect(itemOf(response, 'quota-project')).toMatchObject({
      status: 'ok',
      resource: 'projects/demo-app-1',
      permission: 'serviceusage.services.use',
    });
    const [probe] = google.callsTo('list');
    expect(probe?.url.href).toBe('https://cloudasset.googleapis.com/v1/projects/demo-app-1/assets');
    expect(probe?.method).toBe('POST');
    expect(probe?.headers.get('x-http-method-override')).toBe('GET');
    expect(probe?.headers.get('x-goog-user-project')).toBe('demo-app-1');
    expect(probe?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(probe?.body ?? '')).toEqual({ contentType: 'RESOURCE', pageSize: 1 });
  });

  it('a project scope given by number is tried under the id Resource Manager names', async () => {
    const { google, result } = await run({}, { scope: scopeOf('projects/10000000001') });
    expect(checklist(result).quotaProject).toBe('demo-app-1');
    expect(google.callsTo('list')[0]?.url.pathname).toBe('/v1/projects/10000000001/assets');
  });

  it('a project id from Resource Manager that is not a project id is never sent as a header or a command', async () => {
    for (const projectId of ['demo-app-1\r\nx-evil: 1', 'Demo App', 'demo app', '', 42, 'a'.repeat(101)]) {
      const { google, result } = await run(
        { get: always(() => jsonResponse(200, { name: 'projects/10000000001', projectId })) },
        { scope: scopeOf('projects/10000000001') },
      );
      // The scope's own number is tried instead, and nothing of the answer reaches a header.
      expect(checklist(result).quotaProject, String(projectId)).toBe('10000000001');
      const quotaHeaders = google.callsTo('list').map((call) => call.headers.get('x-goog-user-project'));
      expect(quotaHeaders, String(projectId)).toEqual(['10000000001']);
    }
  });

  it('400 USER_PROJECT_DENIED (does not exist), then the chosen project', async () => {
    const { result } = await run(
      { list: byQuotaProject({ 'demo-app-1': () => answers.quotaMissing('demo-app-1') }) },
      { quotaProject: 'demo-quota-1' },
    );
    const response = checklist(result);
    expect(
      response.candidates.map((candidate) => [candidate.project, candidate.source, candidate.result]),
    ).toEqual([
      ['demo-app-1', 'scope', 'not-found'],
      ['demo-quota-1', 'chosen', 'usable'],
    ]);
    expect(response.candidates[0]?.commands).toEqual([]);
    expect(response.candidates[0]?.upstream).toMatchObject({ status: 400, reason: 'USER_PROJECT_DENIED' });
    expect(response.quotaProject).toBe('demo-quota-1');
    expect(response.outcome).toBe('ready');
  });

  it('403 USER_PROJECT_DENIED (no serviceusage.services.use): the binding command, then the chosen project', async () => {
    const { result } = await run(
      { list: byQuotaProject({ 'demo-app-1': () => answers.quotaDenied('demo-app-1') }) },
      { quotaProject: 'demo-quota-1' },
    );
    const response = checklist(result);
    expect(response.candidates[0]).toMatchObject({
      result: 'no-permission',
      commands: [
        `gcloud projects add-iam-policy-binding demo-app-1 --member="${USER}" --role="roles/serviceusage.serviceUsageConsumer"`,
      ],
    });
    expect(response.quotaProject).toBe('demo-quota-1');
  });

  it('403 SERVICE_DISABLED (API disabled): the enable command, then the chosen project', async () => {
    const { result } = await run(
      { list: byQuotaProject({ 'demo-app-1': () => answers.serviceDisabled('demo-app-1') }) },
      { quotaProject: 'demo-quota-1' },
    );
    expect(checklist(result).candidates[0]).toMatchObject({
      result: 'api-disabled',
      commands: ['gcloud services enable cloudasset.googleapis.com --project=demo-app-1'],
    });
  });

  it('missing: every candidate fails, each with its own condition and command', async () => {
    const { google, result } = await run(
      {
        list: byQuotaProject({
          'demo-app-1': () => answers.serviceDisabled('demo-app-1'),
          'demo-quota-1': () => answers.quotaDenied('demo-quota-1'),
        }),
      },
      { quotaProject: 'demo-quota-1' },
    );
    const response = checklist(result);
    const quota = itemOf(response, 'quota-project');
    expect(quota).toMatchObject({
      status: 'missing',
      finding: 'unusable',
      resource: 'projects/demo-quota-1',
    });
    expect(quota.commands).toEqual([
      'gcloud services enable cloudasset.googleapis.com --project=demo-app-1',
      `gcloud projects add-iam-policy-binding demo-quota-1 --member="${USER}" --role="roles/serviceusage.serviceUsageConsumer"`,
    ]);
    // The scope's IAM is checked only after the quota project (spike finding 4): unknown, with its command.
    expect(itemOf(response, 'cai-access')).toMatchObject({
      status: 'unknown',
      finding: 'not-checked',
      commands: [
        `gcloud projects add-iam-policy-binding demo-app-1 --member="${USER}" --role="roles/cloudasset.viewer"`,
      ],
    });
    expect(response.quotaProject).toBeUndefined();
    expect(response.outcome).toBe('blocked');
    expect(google.callsTo('list')).toHaveLength(2);
  });

  it('an organisation or folder with no project picked has no candidate: nothing is sent to CAI', async () => {
    for (const target of [ORGANIZATION, FOLDER]) {
      const { google, result } = await run({}, { scope: target });
      const response = checklist(result);
      expect(itemOf(response, 'quota-project')).toMatchObject({
        status: 'missing',
        finding: 'no-candidate',
        commands: [],
      });
      expect(response.candidates).toEqual([]);
      expect(google.callsTo('list')).toHaveLength(0);
      expect(response.outcome).toBe('blocked');
    }
  });

  it('a folder is probed with the chosen project only; the instance’s project is never a candidate', async () => {
    const { google, result } = await run({}, { scope: FOLDER, quotaProject: 'demo-quota-1' });
    expect(checklist(result).candidates).toEqual([
      { project: 'demo-quota-1', source: 'chosen', result: 'usable', commands: [] },
    ]);
    expect(google.callsTo('list').map((call) => call.headers.get('x-goog-user-project'))).toEqual([
      'demo-quota-1',
    ]);
  });

  it('a chosen project equal to the scope is tried once', async () => {
    const { google } = await run({}, { quotaProject: 'demo-app-1' });
    expect(google.callsTo('list')).toHaveLength(1);
  });

  it.each(QUOTA_DENIED_TRANSIENT)(
    '%s: retried five times, then "try again"; the chosen project is not tried',
    async (_s, make) => {
      const { google, result } = await run({ list: always(make) }, { quotaProject: 'demo-quota-1' });
      const response = checklist(result);
      expect(itemOf(response, 'quota-project')).toMatchObject({ status: 'unknown', finding: 'transient' });
      expect(response.candidates.map((candidate) => candidate.result)).toEqual(['transient']);
      expect(google.callsTo('list')).toHaveLength(5);
      expect(response.outcome).toBe('retry');
    },
  );

  it('no answer in time or at all: "try again"', async () => {
    const { result } = await run({
      list: () => {
        throw new TypeError('fetch failed');
      },
    });
    const response = checklist(result);
    expect(itemOf(response, 'quota-project')).toMatchObject({ status: 'unknown', finding: 'transient' });
    expect(itemOf(response, 'quota-project').upstream).toMatchObject({ status: 0, code: 'TRANSPORT' });
    expect(response.outcome).toBe('retry');
  });

  const UNEXPECTED: readonly (readonly [string, () => Response])[] = [
    ['404 NOT_FOUND', answers.notFound],
    ['an HTML page', () => answers.html(404)],
    ['403 SECURITY_POLICY_VIOLATED (VPC Service Controls)', answers.securityPolicy],
    [
      '403 with two ErrorInfo entries',
      () =>
        googleError(403, 'PERMISSION_DENIED', 'Denied twice.', [
          { reason: 'USER_PROJECT_DENIED' },
          { reason: 'SERVICE_DISABLED' },
        ]),
    ],
    [
      '400 INVALID_ARGUMENT without a reason',
      () => googleError(400, 'INVALID_ARGUMENT', 'Request contains an invalid argument.'),
    ],
    ['409 ABORTED', () => googleError(409, 'ABORTED', 'Aborted.')],
  ];

  it.each(UNEXPECTED)(
    'anything else (%s): stops and fails closed, passing the status on',
    async (_label, make) => {
      const { google, result } = await run({ list: always(make) }, { quotaProject: 'demo-quota-1' });
      const response = checklist(result);
      expect(itemOf(response, 'quota-project')).toMatchObject({ status: 'unknown', finding: 'unexpected' });
      expect(itemOf(response, 'cai-access')).toMatchObject({ status: 'unknown', finding: 'not-checked' });
      expect(google.callsTo('list')).toHaveLength(1);
      expect(response.outcome).toBe('blocked');
    },
  );

  it('passes Google’s message on for a JSON answer, never an HTML page', async () => {
    const json = checklist((await run({ list: always(answers.securityPolicy) })).result);
    expect(itemOf(json, 'quota-project').upstream).toEqual({
      status: 403,
      code: 'PERMISSION_DENIED',
      reason: 'SECURITY_POLICY_VIOLATED',
      message: 'Request is prohibited by organization policy.',
    });
    const html = checklist((await run({ list: always(() => answers.html(404)) })).result);
    expect(itemOf(html, 'quota-project').upstream).toEqual({ status: 404 });
  });

  it('403 ACCESS_TOKEN_SCOPE_INSUFFICIENT on the probe: sign in again (the spike’s sign-in row)', async () => {
    const { result } = await run({ list: always(() => answers.scopeInsufficient()) });
    expect(checklist(result).outcome).toBe('sign-in');
  });

  it('401 on the probe: the token is not accepted (the route answers 401)', async () => {
    const { result } = await run({ list: always(answers.unauthenticated) });
    expect(result).toEqual({ kind: 'unauthenticated' });
  });
});

describe('user mode, row "roles/cloudasset.viewer on the scope (cloudasset.assets.listResource)"', () => {
  it('ok: 200 on the probe', async () => {
    const response = checklist((await run({})).result);
    expect(itemOf(response, 'cai-access')).toMatchObject({ status: 'ok', finding: 'ok', commands: [] });
  });

  it('an empty listing (no assets key) is still ok', async () => {
    const response = checklist((await run({ list: always(answers.emptyListing) })).result);
    expect(itemOf(response, 'cai-access').status).toBe('ok');
  });

  it.each([
    ['404', answers.notFound, 'unexpected', 'blocked', 1],
    ['429', answers.rateLimited, 'transient', 'retry', 5],
    ['500', answers.internal, 'transient', 'retry', 5],
    ['503', answers.unavailable, 'transient', 'retry', 5],
  ] as const)(
    '%s on the probe: listing not verified (the probe stopped), with its command',
    async (_status, make, finding, outcome, attempts) => {
      const { google, result } = await run({ list: always(make) });
      const response = checklist(result);
      expect(itemOf(response, 'quota-project')).toMatchObject({ status: 'unknown', finding });
      expect(itemOf(response, 'cai-access')).toMatchObject({
        status: 'unknown',
        finding: 'not-checked',
        commands: [
          `gcloud projects add-iam-policy-binding demo-app-1 --member="${USER}" --role="roles/cloudasset.viewer"`,
        ],
      });
      expect(response.outcome).toBe(outcome);
      expect(google.callsTo('list')).toHaveLength(attempts);
    },
  );

  it.each([
    [PROJECT, 'gcloud projects add-iam-policy-binding demo-app-1'],
    [FOLDER, 'gcloud resource-manager folders add-iam-policy-binding 20000000001'],
    [ORGANIZATION, 'gcloud organizations add-iam-policy-binding 30000000001'],
  ] as const)(
    '403 without an ErrorInfo (%o): missing, the quota project usable, the binding for the scope’s kind',
    async (target, group) => {
      const { result } = await run(
        { list: always(answers.listDenied) },
        { scope: target, quotaProject: 'demo-quota-1' },
      );
      const response = checklist(result);
      const access = itemOf(response, 'cai-access');
      expect(access).toMatchObject({
        status: 'missing',
        finding: 'denied',
        blocking: true,
        permission: 'cloudasset.assets.listResource',
        role: 'roles/cloudasset.viewer',
        member: USER,
        resource: target.name,
        commands: [`${group} --member="${USER}" --role="roles/cloudasset.viewer"`],
      });
      expect(access.upstream?.message).toMatch(/^Request denied by Cloud IAM/);
      expect(itemOf(response, 'quota-project')).toMatchObject({ status: 'ok' });
      expect(response.quotaProject).toBeDefined();
      expect(response.outcome).toBe('blocked');
    },
  );
});

describe('the caller’s email (tokeninfo)', () => {
  it('fills --member from tokeninfo, sent in the form body and never as a URL', async () => {
    const { google, result } = await run({ list: always(answers.listDenied) });
    expect(checklist(result).member).toBe(USER);
    const [info] = google.callsTo('tokeninfo');
    expect(info?.method).toBe('POST');
    expect(info?.url.search).toBe('');
    expect(info?.token).toBeNull();
    expect(new URLSearchParams(info?.body).get('access_token')).toBe(CALLER_TOKEN);
  });

  it('without an email in the token, the commands say YOUR_EMAIL', async () => {
    const { result } = await run({
      tokeninfo: always(() => answers.tokenInfo(null)),
      list: always(answers.listDenied),
    });
    const response = checklist(result);
    expect(response.member).toBeUndefined();
    expect(itemOf(response, 'cai-access').commands[0]).toContain('--member="user:YOUR_EMAIL"');
  });

  it('a service account’s token gets a serviceAccount: member', async () => {
    const { result } = await run({ tokeninfo: always(() => answers.tokenInfo(ACCOUNT_EMAIL)) });
    expect(checklist(result).member).toBe(ACCOUNT);
  });

  it('an email that could carry shell syntax is never put into a command', async () => {
    const { result } = await run({
      tokeninfo: always(() => answers.tokenInfo('"$(rm -rf ~)"@example.com')),
      list: always(answers.listDenied),
    });
    const response = checklist(result);
    expect(response.member).toBeUndefined();
    expect(JSON.stringify(response)).not.toContain('rm -rf');
  });

  it('tokeninfo calling the token invalid ends the preflight as unauthenticated', async () => {
    const { result } = await run({ tokeninfo: always(answers.invalidToken) });
    expect(result).toEqual({ kind: 'unauthenticated' });
  });

  it('tokeninfo not answering only leaves the email unknown', async () => {
    const { result } = await run({ tokeninfo: always(answers.unavailable) });
    expect(checklist(result).outcome).toBe('ready');
  });
});

describe('every call', () => {
  it('forwards the caller’s token verbatim, the request id, and never follows a redirect', async () => {
    const { google } = await run({ list: always(answers.listDenied) }, { quotaProject: 'demo-quota-1' });
    expect(google.calls.length).toBeGreaterThan(2);
    for (const call of google.calls) {
      expect(call.headers.get('x-request-id')).toBe('test-request-1');
      expect(call.redirect).not.toBe('follow');
      if (call.url.host !== 'oauth2.googleapis.com') expect(call.token).toBe(CALLER_TOKEN);
    }
  });
});

describe('service-account mode, row "caller still needs resourcemanager.*.get on the scope (gate step 1)"', () => {
  it('ok: the caller’s testIamPermissions opens the gate, and the account probes without a quota header', async () => {
    const identity = fakeAccount();
    const { google, result } = await run({}, { mode: 'sa' }, lenient(identity));
    if (result.kind !== 'checklist') throw new Error('expected a checklist');
    expect(result.refusal).toBeUndefined();
    const response = checklist(result);
    expect(response).toMatchObject({
      mode: 'sa',
      outcome: 'ready',
      serviceAccount: ACCOUNT_EMAIL,
      member: USER,
      candidates: [],
    });
    // Without the strict exposure check there is no exposure item, and the account never asks for the scope.
    expect(response.items.map((entry) => [entry.id, entry.status])).toEqual([
      ['sa-caller', 'ok'],
      ['sa-access', 'ok'],
    ]);
    const [tested, ...more] = google.callsTo('testIam');
    expect(more).toEqual([]);
    expect(tested?.token).toBe(CALLER_TOKEN);
    expect(tested?.method).toBe('POST');
    expect(tested?.url.pathname).toBe('/v3/projects/demo-app-1:testIamPermissions');
    expect(askedPermissions(tested as RecordedCall)).toEqual(['resourcemanager.projects.get']);
    expect(tested?.headers.has('x-goog-user-project')).toBe(false);
    expect(google.callsTo('get')).toEqual([]);
    const [probe] = google.callsTo('list');
    expect(probe?.token).toBe(ACCOUNT_TOKEN);
    expect(probe?.url.pathname).toBe('/v1/projects/demo-app-1/assets');
    expect(probe?.headers.has('x-goog-user-project')).toBe(false);
    expect(identity.accessToken).toHaveBeenCalledTimes(1);
  });

  it('with the strict exposure check, the account’s own get comes between the gate and the probe', async () => {
    const { google, result } = await run(
      {
        get: (call) =>
          call.token === ACCOUNT_TOKEN ? answers.getDenied('resourcemanager.projects.get') : undefined,
      },
      { mode: 'sa' },
      strict(),
    );
    const response = checklist(result);
    expect(response.outcome).toBe('ready');
    expect(response.items.map((entry) => [entry.id, entry.status])).toEqual([
      ['sa-caller', 'ok'],
      ['sa-exposure', 'ok'],
      ['sa-access', 'ok'],
    ]);
    expect(
      google.calls
        .filter((call) => call.url.host !== 'oauth2.googleapis.com')
        .map((call) => `${endpointOf(call)}:${call.token === ACCOUNT_TOKEN ? 'account' : 'caller'}`),
    ).toEqual(['testIam:caller', 'get:account', 'list:account']);
    // The same scope in every call (ADR 0028 §4).
    expect(
      new Set(google.calls.filter((call) => call.url.host !== 'oauth2.googleapis.com').map(scopeOfCall)),
    ).toEqual(new Set(['projects/demo-app-1']));
  });

  for (const account of [lenient, strict])
    // A token Google does not accept is no checklist at all (the 401 test below).
    it.each(CALLER_REFUSALS.filter((row) => row.finding !== 'unauthenticated'))(
      `$label: the gate stays closed and the account is never used (${account === strict ? 'strict' : 'default'})`,
      async (row) => {
        const identity = fakeAccount();
        const { google, result } = await run(
          { testIam: callerAnswer(row) },
          { mode: 'sa' },
          account(identity),
        );
        if (result.kind !== 'checklist') throw new Error('expected a checklist');
        expect(result.refusal).toMatchObject({ allowed: false, step: 'caller', status: row.status });
        const response = checklist(result);
        expect(itemOf(response, 'sa-caller')).toMatchObject({
          status: row.finding === 'denied' ? 'missing' : 'unknown',
          finding: row.finding,
        });
        if (account === strict)
          expect(itemOf(response, 'sa-exposure')).toMatchObject({
            status: 'unknown',
            finding: 'not-checked',
          });
        expect(itemOf(response, 'sa-access')).toMatchObject({ status: 'unknown', finding: 'not-checked' });
        expect(identity.accessToken).not.toHaveBeenCalled();
        expect(google.calls.some((call) => call.token === ACCOUNT_TOKEN)).toBe(false);
        expect(google.callsTo('list')).toHaveLength(0);
        expect(response.outcome).not.toBe('ready');
      },
    );

  it('a caller denied gets the roles/browser command for themselves', async () => {
    const { result } = await run(
      { testIam: always(() => answers.permissions([])) },
      { mode: 'sa', scope: FOLDER },
      lenient(),
    );
    expect(itemOf(checklist(result), 'sa-caller').commands).toEqual([
      `gcloud resource-manager folders add-iam-policy-binding 20000000001 --member="${USER}" --role="roles/browser"`,
    ]);
  });

  it('401 on step 1, or tokeninfo calling the token invalid: unauthenticated', async () => {
    expect(
      (await run({ testIam: always(answers.unauthenticated) }, { mode: 'sa' }, lenient())).result,
    ).toEqual({ kind: 'unauthenticated' });
    expect(
      (await run({ tokeninfo: always(answers.invalidToken) }, { mode: 'sa' }, lenient())).result,
    ).toEqual({ kind: 'unauthenticated' });
  });
});

describe('service-account mode, gate step 2 with SA_MODE_STRICT_EXPOSURE (the account must not get the scope)', () => {
  it.each(EXPOSURE_REFUSALS)('$label keeps the gate closed: no CAI call is made', async (row) => {
    const { google, result } = await run({ get: accountGetAnswer(row) }, { mode: 'sa' }, strict());
    if (result.kind !== 'checklist') throw new Error('expected a checklist');
    expect(result.refusal).toMatchObject({ allowed: false, step: 'exposure' });
    const response = checklist(result);
    const exposure = itemOf(response, 'sa-exposure');
    expect(exposure.status).not.toBe('ok');
    expect(exposure.finding).toBe(row.finding);
    expect(itemOf(response, 'sa-access')).toMatchObject({ status: 'unknown', finding: 'not-checked' });
    expect(google.callsTo('list')).toHaveLength(0);
    expect(response.outcome).not.toBe('ready');
  });

  it('a transport failure keeps it closed too', async () => {
    const { google, result } = await run(
      {
        get: (call) => {
          if (call.token === ACCOUNT_TOKEN) throw new TypeError('fetch failed');
          return undefined;
        },
      },
      { mode: 'sa' },
      strict(),
    );
    expect(itemOf(checklist(result), 'sa-exposure')).toMatchObject({
      status: 'unknown',
      finding: 'transient',
    });
    expect(google.callsTo('list')).toHaveLength(0);
  });

  it.each([
    [ORGANIZATION, 'resourcemanager.organizations.get'],
    [FOLDER, 'resourcemanager.folders.get'],
    [PROJECT, 'resourcemanager.projects.get'],
  ] as const)('the exact denial opens it for %o', async (target, permission) => {
    const { google, result } = await run(
      { get: (call) => (call.token === ACCOUNT_TOKEN ? answers.getDenied(permission) : undefined) },
      { mode: 'sa', scope: target },
      strict(),
    );
    expect(itemOf(checklist(result), 'sa-exposure')).toMatchObject({ status: 'ok' });
    expect(google.callsTo('list')).toHaveLength(1);
  });

  it('a public get is "exposed": missing, with no command that could fix it', async () => {
    const { result } = await run({}, { mode: 'sa' }, strict());
    expect(itemOf(checklist(result), 'sa-exposure')).toMatchObject({
      status: 'missing',
      finding: 'exposed',
      commands: [],
    });
  });

  it('without the strict check a public get does not matter: the account never asks for it', async () => {
    const { google, result } = await run({}, { mode: 'sa' }, lenient());
    const response = checklist(result);
    expect(response.items.some((entry) => entry.id === 'sa-exposure')).toBe(false);
    expect(google.callsTo('get')).toHaveLength(0);
    expect(google.callsTo('list')).toHaveLength(1);
  });

  it.each([
    ['strict', strict],
    ['default', lenient],
  ] as const)('credentials that fail: nothing is asked as the account (%s)', async (_label, account) => {
    const identity: ServiceAccountIdentity = {
      email: ACCOUNT_EMAIL,
      source: 'metadata-server',
      accessToken: () => Promise.reject(new Error('no ADC')),
    };
    const { google, result } = await run({}, { mode: 'sa' }, account(identity));
    if (result.kind !== 'checklist') throw new Error('expected a checklist');
    expect(result.refusal).toMatchObject({
      step: 'credentials',
      status: 503,
      code: 'SA_CREDENTIALS_UNAVAILABLE',
    });
    const response = checklist(result);
    expect(itemOf(response, 'sa-caller').status).toBe('ok');
    if (account === strict)
      expect(itemOf(response, 'sa-exposure')).toMatchObject({ status: 'unknown', finding: 'no-credentials' });
    expect(itemOf(response, 'sa-access')).toMatchObject({ status: 'unknown', finding: 'no-credentials' });
    expect(google.callsTo('get')).toHaveLength(0);
    expect(google.callsTo('list')).toHaveLength(0);
  });
});

describe('service-account mode, row "roles/cloudasset.viewer on the scope for BACKEND_SA_EMAIL"', () => {
  it.each([
    ['403 without an ErrorInfo', answers.listDenied, 'missing', 'denied'],
    ['404', answers.notFound, 'unknown', 'unexpected'],
    ['429', answers.rateLimited, 'unknown', 'transient'],
    ['503', answers.unavailable, 'unknown', 'transient'],
    ['500', answers.internal, 'unknown', 'transient'],
    [
      '403 SERVICE_DISABLED (the instance’s own project)',
      () => answers.serviceDisabled('demo-host'),
      'unknown',
      'unexpected',
    ],
  ] as const)('%s on the account’s probe', async (_label, make, status, finding) => {
    const { result } = await run({ list: always(make) }, { mode: 'sa' }, lenient());
    if (result.kind !== 'checklist') throw new Error('expected a checklist');
    // The gate passed: the probe's answer is a checklist item, not a refusal.
    expect(result.refusal).toBeUndefined();
    const access = itemOf(checklist(result), 'sa-access');
    expect(access).toMatchObject({ status, finding, member: ACCOUNT });
    expect(access.commands).toEqual([
      `gcloud projects add-iam-policy-binding demo-app-1 --member="${ACCOUNT}" --role="roles/cloudasset.viewer"`,
    ]);
  });

  it('the account’s token never reaches the browser', async () => {
    const { result } = await run({}, { mode: 'sa' }, lenient());
    expect(JSON.stringify(result)).not.toContain(ACCOUNT_TOKEN);
    expect(JSON.stringify(result)).not.toContain(CALLER_TOKEN);
    const refused = await run({ testIam: always(() => answers.permissions([])) }, { mode: 'sa' }, strict());
    expect(JSON.stringify(refused.result)).not.toContain(ACCOUNT_TOKEN);
    expect(JSON.stringify(refused.result)).not.toContain(CALLER_TOKEN);
  });
});

describe('outcomeOf', () => {
  const base: PreflightItem = {
    id: 'cai-access',
    status: 'ok',
    finding: 'ok',
    blocking: true,
    permission: 'p',
    resource: 'projects/demo-app-1',
    commands: [],
  };
  it('is ready when every blocking item is ok, a warning notwithstanding', () => {
    expect(
      outcomeOf([
        base,
        { ...base, id: 'scope-details', blocking: false, status: 'missing', finding: 'denied' },
      ]),
    ).toBe('ready');
  });
  it('asks to sign in before anything else', () => {
    expect(
      outcomeOf([
        { ...base, status: 'unknown', finding: 'transient' },
        { ...base, status: 'unknown', finding: 'sign-in' },
      ]),
    ).toBe('sign-in');
  });
  it('asks to try again for a transient finding, else is blocked', () => {
    expect(outcomeOf([{ ...base, status: 'unknown', finding: 'transient' }])).toBe('retry');
    expect(outcomeOf([{ ...base, status: 'missing', finding: 'denied' }])).toBe('blocked');
  });
});
