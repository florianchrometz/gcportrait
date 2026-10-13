// SPDX-License-Identifier: MIT
/**
 * The service-account gate (agents.md, Security and privacy, The service-account gate) against a pretend
 * Google: allowed, denied, the memo (a pass remembered, an expired one checked again, never across tokens or
 * scopes, never a refusal), strict mode's exposure check, the account's token, and the audit line. In every
 * refusal no call is made as the account.
 */
import pino from 'pino';
import { describe, expect, it } from 'vitest';

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
} from '../preflight/google.testing.js';
import { captureLogs } from '../server.testing.js';
import type { GoogleCallContext } from '../upstream/google.js';
import {
  ACCOUNT_TOKEN,
  CALLER_EMAIL,
  CALLER_TOKEN,
  fakeAccount,
  jsonResponse,
  scopeOf,
  testClient,
  type FakeAccount,
  type RecordedCall,
} from '../upstream/google.testing.js';
import {
  emailHashOf,
  GATE_MEMO_MAX_MS,
  ServiceAccountGate,
  type GateDecision,
  type GatePass,
  type GateRefusal,
  type GateRequest,
} from './gate.js';

const PROJECT = scopeOf('projects/demo-app-1');
const FOLDER = scopeOf('folders/20000000001');
const ORGANIZATION = scopeOf('organizations/30000000001');
const OTHER_TOKEN = 'ya29.another-caller-token-for-tests';

interface Setup {
  readonly google: FakeGoogle;
  readonly gate: ServiceAccountGate;
  readonly identity: FakeAccount;
  readonly clock: { now: number };
  readonly logs: () => Record<string, unknown>[];
  readonly text: () => string;
  readonly check: (overrides?: Partial<Omit<GateRequest, 'context'>>) => Promise<GateDecision>;
}

function setup(
  options: FakeGoogleOptions = {},
  gateOptions: {
    readonly strictExposure?: boolean;
    readonly memoMs?: number;
    readonly memoMaxEntries?: number;
    /** The request logger's level, as LOG_LEVEL sets it. */
    readonly logLevel?: 'info' | 'warn' | 'error' | 'silent';
  } = {},
  token: () => Promise<string> = () => Promise.resolve(ACCOUNT_TOKEN),
): Setup {
  const google = fakeGoogle(options);
  const logs = captureLogs();
  const log = pino({ level: gateOptions.logLevel ?? 'info' }, logs.stream);
  const identity = fakeAccount(token);
  const clock = { now: 1_000_000 };
  const gate = new ServiceAccountGate({
    identity,
    strictExposure: gateOptions.strictExposure ?? false,
    ...(gateOptions.memoMs === undefined ? {} : { memoMs: gateOptions.memoMs }),
    ...(gateOptions.memoMaxEntries === undefined ? {} : { memoMaxEntries: gateOptions.memoMaxEntries }),
    now: () => clock.now,
  });
  const context: GoogleCallContext = {
    client: testClient(google.fetch),
    signal: new AbortController().signal,
    requestId: 'gate-test-1',
    log,
  };
  return {
    google,
    gate,
    identity,
    clock,
    text: logs.text,
    logs: () => logs.lines().map((line) => JSON.parse(line) as Record<string, unknown>),
    check: (overrides = {}) =>
      gate.check({
        scope: PROJECT,
        callerToken: CALLER_TOKEN,
        route: 'assets.stream',
        ...overrides,
        context,
      }),
  };
}

function passed(decision: GateDecision): GatePass {
  if (!decision.allowed) throw new Error(`expected a pass, got ${decision.code}`);
  return decision;
}

function refused(decision: GateDecision): GateRefusal {
  if (decision.allowed) throw new Error('expected a refusal');
  return decision;
}

/** Audit lines only. */
function auditOf(logs: Record<string, unknown>[]): Record<string, unknown>[] {
  return logs
    .filter((line) => line.msg === 'service-account gate')
    .map((line) => line.audit as Record<string, unknown>);
}

const byToken = (call: RecordedCall): string => (call.token === ACCOUNT_TOKEN ? 'account' : 'caller');

describe('allowed', () => {
  it('passes when the caller’s testIamPermissions returns the scope’s get permission, and hands out the account’s token', async () => {
    const { google, identity, check } = setup();
    const decision = passed(await check());
    expect(decision).toMatchObject({
      allowed: true,
      cached: false,
      token: ACCOUNT_TOKEN,
      caller: { email: CALLER_EMAIL, emailHash: emailHashOf(CALLER_EMAIL) },
    });
    expect(decision.steps.map((step) => [step.step, step.finding])).toEqual([
      ['caller', 'ok'],
      ['credentials', 'ok'],
    ]);
    const [tested, ...rest] = google.callsTo('testIam');
    expect(rest).toEqual([]);
    expect(tested).toMatchObject({ method: 'POST', token: CALLER_TOKEN });
    expect(tested?.url.href).toBe(
      'https://cloudresourcemanager.googleapis.com/v3/projects/demo-app-1:testIamPermissions',
    );
    expect(askedPermissions(tested as RecordedCall)).toEqual(['resourcemanager.projects.get']);
    expect(tested?.headers.has('x-goog-user-project')).toBe(false);
    // tokeninfo gets the token in its body, never in the URL.
    const [info] = google.callsTo('tokeninfo');
    expect(info?.url.search).toBe('');
    expect(info?.body).toBe(`access_token=${encodeURIComponent(CALLER_TOKEN)}`);
    // Without strict mode, nothing at all is asked as the account; the gate only takes its token.
    expect(google.calls.filter((call) => call.token === ACCOUNT_TOKEN)).toEqual([]);
    expect(identity.accessToken).toHaveBeenCalledTimes(1);
  });

  it.each([
    [ORGANIZATION, 'resourcemanager.organizations.get', '/v3/organizations/30000000001:testIamPermissions'],
    [FOLDER, 'resourcemanager.folders.get', '/v3/folders/20000000001:testIamPermissions'],
    [PROJECT, 'resourcemanager.projects.get', '/v3/projects/demo-app-1:testIamPermissions'],
  ] as const)('asks for the get permission of the scope’s kind: %o', async (target, permission, pathname) => {
    const { google, check } = setup();
    passed(await check({ scope: target }));
    const [tested] = google.callsTo('testIam');
    expect(tested?.url.pathname).toBe(pathname);
    expect(askedPermissions(tested as RecordedCall)).toEqual([permission]);
  });

  it('a project id with a domain prefix is percent-encoded in the one path every call uses', async () => {
    const { google, check } = setup({}, { strictExposure: true });
    const target = scopeOf('projects/example.com:demo-app-1');
    await check({ scope: target });
    const paths = google.calls
      .filter((call) => call.url.host !== 'oauth2.googleapis.com')
      .map((call) => call.url.pathname);
    expect(paths).toEqual([
      '/v3/projects/example.com%3Ademo-app-1:testIamPermissions',
      '/v3/projects/example.com%3Ademo-app-1',
    ]);
  });
});

describe('denied', () => {
  for (const strictExposure of [false, true])
    it.each(CALLER_REFUSALS)(
      `$label refuses, and nothing is asked as the account (strict ${String(strictExposure)})`,
      async (row) => {
        const { finding, status, code } = row;
        const { google, identity, gate, check } = setup({ testIam: callerAnswer(row) }, { strictExposure });
        const decision = refused(await check());
        expect(decision).toMatchObject({ allowed: false, step: 'caller', finding, status, code });
        expect(decision.retryable).toBe(status === 503);
        expect(identity.accessToken).not.toHaveBeenCalled();
        expect(google.calls.filter((call) => call.token === ACCOUNT_TOKEN)).toEqual([]);
        expect(google.callsTo('list')).toEqual([]);
        expect(google.callsTo('get')).toEqual([]);
        // A refusal is never remembered.
        expect(gate.memoSize).toBe(0);
        expect(JSON.stringify(decision)).not.toContain(CALLER_TOKEN);
      },
    );

  it('a transport failure on step 1 is transient (503), and closed', async () => {
    const { identity, check } = setup({
      testIam: () => {
        throw new TypeError('fetch failed');
      },
    });
    expect(refused(await check())).toMatchObject({ step: 'caller', finding: 'transient', status: 503 });
    expect(identity.accessToken).not.toHaveBeenCalled();
  });

  it('tokeninfo calling the token invalid refuses as unauthenticated, even next to a 200', async () => {
    const { identity, check } = setup({ tokeninfo: () => answers.invalidToken() });
    expect(refused(await check())).toMatchObject({ finding: 'unauthenticated', status: 401 });
    expect(identity.accessToken).not.toHaveBeenCalled();
  });

  it('says what to do, naming the scope and the permission, never the token', async () => {
    const { check } = setup({ testIam: () => answers.permissions([]) });
    const decision = refused(await check({ scope: FOLDER }));
    expect(decision.message).toBe(
      'You cannot see folders/20000000001 yourself (you do not hold resourcemanager.folders.get there), so ' +
        'gcportrait does not read it with its service account.',
    );
  });

  it('passes Google’s answer on for one it does not understand', async () => {
    const { check } = setup({ testIam: () => answers.securityPolicy() });
    const decision = refused(await check());
    expect(decision.upstream).toEqual({
      status: 403,
      code: 'PERMISSION_DENIED',
      reason: 'SECURITY_POLICY_VIOLATED',
      message: 'Request is prohibited by organization policy.',
    });
    expect(decision.message).toMatch(
      /^Google answered the service-account check in a way gcportrait does not understand \(403 PERMISSION_DENIED SECURITY_POLICY_VIOLATED\): Request is prohibited/,
    );
  });
});

describe('cached', () => {
  it('remembers a pass: the same token and scope ask Google nothing more, and still get the account’s token', async () => {
    const { google, identity, check } = setup();
    passed(await check());
    const before = google.calls.length;
    const again = passed(await check());
    expect(again.cached).toBe(true);
    expect(again.steps).toEqual([]);
    expect(again.caller).toEqual({ emailHash: emailHashOf(CALLER_EMAIL) });
    expect(google.calls.length).toBe(before);
    expect(identity.accessToken).toHaveBeenCalledTimes(2);
  });

  it('a fresh check (the preflight) asks Google again, and still remembers its pass', async () => {
    const { google, check } = setup();
    passed(await check({ route: 'preflight', fresh: true }));
    passed(await check({ route: 'preflight', fresh: true }));
    expect(google.callsTo('testIam')).toHaveLength(2);
    expect(passed(await check()).cached).toBe(true);
  });

  it('never remembers a refusal: a later grant passes at once', async () => {
    let granted = false;
    const { google, check } = setup({
      testIam: (call) => answers.permissions(granted ? askedPermissions(call) : []),
    });
    refused(await check());
    granted = true;
    expect(passed(await check()).cached).toBe(false);
    expect(google.callsTo('testIam')).toHaveLength(2);
  });

  it('a fresh refusal forgets the pass remembered for that token and scope, and only that one', async () => {
    let granted = true;
    const { google, gate, check } = setup({
      testIam: (call) => answers.permissions(granted ? askedPermissions(call) : []),
    });
    passed(await check());
    passed(await check({ scope: FOLDER }));
    passed(await check({ callerToken: OTHER_TOKEN }));
    expect(gate.memoSize).toBe(3);
    // The grant is gone; the preflight checks afresh and says so.
    granted = false;
    expect(refused(await check({ route: 'preflight', fresh: true })).code).toBe('SA_GATE_CALLER_DENIED');
    expect(gate.memoSize).toBe(2);
    // The next pull of that scope with that token asks Google again instead of riding the old pass.
    const before = google.callsTo('testIam').length;
    expect(refused(await check()).code).toBe('SA_GATE_CALLER_DENIED');
    expect(google.callsTo('testIam')).toHaveLength(before + 1);
    // Other scopes and other tokens keep theirs.
    expect(passed(await check({ scope: FOLDER })).cached).toBe(true);
    expect(passed(await check({ callerToken: OTHER_TOKEN })).cached).toBe(true);
  });

  it('a refusal of the strict exposure check forgets the pass too', async () => {
    let exposed = false;
    const { gate, check } = setup(
      { get: () => (exposed ? answers.project() : answers.getDenied('resourcemanager.projects.get')) },
      { strictExposure: true },
    );
    passed(await check());
    expect(gate.memoSize).toBe(1);
    exposed = true;
    expect(refused(await check({ route: 'preflight', fresh: true })).code).toBe('SA_GATE_EXPOSED');
    expect(gate.memoSize).toBe(0);
  });

  it('a pass for which the account’s token is unavailable is refused (503), and the memo stays', async () => {
    let fail = false;
    const { gate, check } = setup({}, {}, () =>
      fail ? Promise.reject(new Error('metadata server gone')) : Promise.resolve(ACCOUNT_TOKEN),
    );
    passed(await check());
    fail = true;
    expect(refused(await check())).toMatchObject({
      step: 'credentials',
      finding: 'no-credentials',
      status: 503,
      code: 'SA_CREDENTIALS_UNAVAILABLE',
      retryable: true,
    });
    expect(gate.memoSize).toBe(1);
  });
});

describe('expired cache', () => {
  it('checks again once five minutes have passed', async () => {
    const { google, clock, check } = setup({ tokeninfo: () => jsonResponse(200, { email: CALLER_EMAIL }) });
    passed(await check());
    clock.now += GATE_MEMO_MAX_MS - 1;
    expect(passed(await check()).cached).toBe(true);
    clock.now += 1;
    expect(passed(await check()).cached).toBe(false);
    expect(google.callsTo('testIam')).toHaveLength(2);
  });

  it('never remembers past the caller’s token’s own expiry (tokeninfo expires_in)', async () => {
    const { clock, check } = setup({
      tokeninfo: () => jsonResponse(200, { email: CALLER_EMAIL, expires_in: '90' }),
    });
    passed(await check());
    clock.now += 89_000;
    expect(passed(await check()).cached).toBe(true);
    clock.now += 1_000;
    expect(passed(await check()).cached).toBe(false);
  });

  it('a token about to expire is not remembered at all', async () => {
    const { gate, check } = setup({
      tokeninfo: () => jsonResponse(200, { email: CALLER_EMAIL, expires_in: '0' }),
    });
    passed(await check());
    expect(gate.memoSize).toBe(0);
    expect(passed(await check()).cached).toBe(false);
  });

  it('a configured memo longer than five minutes is cut to five', async () => {
    const { clock, check } = setup({}, { memoMs: 60 * 60_000 });
    passed(await check());
    clock.now += GATE_MEMO_MAX_MS;
    expect(passed(await check()).cached).toBe(false);
  });

  it('memo 0 remembers nothing', async () => {
    const { gate, check } = setup({}, { memoMs: 0 });
    passed(await check());
    expect(gate.memoSize).toBe(0);
  });

  it('is bounded: when full, the oldest pass goes first', async () => {
    const { google, gate, check } = setup({}, { memoMaxEntries: 2 });
    passed(await check({ scope: PROJECT }));
    passed(await check({ scope: FOLDER }));
    passed(await check({ scope: ORGANIZATION }));
    expect(gate.memoSize).toBe(2);
    expect(passed(await check({ scope: ORGANIZATION })).cached).toBe(true);
    expect(passed(await check({ scope: FOLDER })).cached).toBe(true);
    expect(passed(await check({ scope: PROJECT })).cached).toBe(false);
    expect(google.callsTo('testIam')).toHaveLength(4);
  });
});

describe('token hash isolation', () => {
  it('a pass for one token is never another token’s, for the same scope', async () => {
    const { google, check } = setup({
      testIam: (call) => answers.permissions(call.token === CALLER_TOKEN ? askedPermissions(call) : []),
    });
    passed(await check({ callerToken: CALLER_TOKEN }));
    const other = refused(await check({ callerToken: OTHER_TOKEN }));
    expect(other.finding).toBe('denied');
    expect(google.callsTo('testIam').map((call) => call.token)).toEqual([CALLER_TOKEN, OTHER_TOKEN]);
  });

  it('a pass for one scope is never another scope’s, for the same token', async () => {
    const { google, check } = setup({
      testIam: (call) =>
        answers.permissions(call.url.pathname.startsWith('/v3/projects/') ? askedPermissions(call) : []),
    });
    passed(await check({ scope: PROJECT }));
    expect(refused(await check({ scope: FOLDER })).finding).toBe('denied');
    expect(passed(await check({ scope: PROJECT })).cached).toBe(true);
    expect(google.callsTo('testIam')).toHaveLength(2);
  });

  it('keeps one entry per token and scope, and neither the token nor the email reaches a log line', async () => {
    const { gate, text, check } = setup();
    passed(await check());
    passed(await check());
    passed(await check({ callerToken: OTHER_TOKEN }));
    expect(gate.memoSize).toBe(2);
    for (const secret of [CALLER_TOKEN, OTHER_TOKEN, ACCOUNT_TOKEN, CALLER_EMAIL])
      expect(text()).not.toContain(secret);
  });
});

describe('strict exposure check (SA_MODE_STRICT_EXPOSURE=true)', () => {
  it('opens on exactly Resource Manager’s IAM denial of the account’s own get, then hands out the token', async () => {
    const { google, check } = setup(
      {
        get: (call) =>
          call.token === ACCOUNT_TOKEN ? answers.getDenied('resourcemanager.projects.get') : undefined,
      },
      { strictExposure: true },
    );
    const decision = passed(await check());
    expect(decision.steps.map((step) => [step.step, step.finding])).toEqual([
      ['caller', 'ok'],
      ['credentials', 'ok'],
      ['exposure', 'ok'],
    ]);
    expect(
      google.calls
        .filter((call) => call.url.host !== 'oauth2.googleapis.com')
        .map((call) => `${endpointOf(call)}:${byToken(call)}`),
    ).toEqual(['testIam:caller', 'get:account']);
  });

  it.each(EXPOSURE_REFUSALS)('$label refuses ($status $code), and no CAI call follows', async (row) => {
    const { google, gate, check } = setup({ get: accountGetAnswer(row) }, { strictExposure: true });
    const decision = refused(await check());
    expect(decision).toMatchObject({
      step: 'exposure',
      finding: row.finding,
      status: row.status,
      code: row.code,
    });
    expect(google.callsTo('list')).toEqual([]);
    expect(gate.memoSize).toBe(0);
    expect(JSON.stringify(decision)).not.toContain(ACCOUNT_TOKEN);
  });

  it('off (the default), a public get does not matter and the account asks Resource Manager nothing', async () => {
    const { google, check } = setup();
    passed(await check());
    expect(google.callsTo('get')).toEqual([]);
  });
});

describe('audit line', () => {
  it('one per decision: route, scope, the caller’s email hash, allowed or denied; never the token or the email', async () => {
    let granted = true;
    const { logs, text, check } = setup({
      testIam: (call) => answers.permissions(granted ? askedPermissions(call) : []),
    });
    passed(await check({ route: 'preflight', fresh: true }));
    passed(await check());
    granted = false;
    refused(await check({ scope: FOLDER }));
    const audit = auditOf(logs());
    expect(audit).toEqual([
      {
        event: 'sa-gate',
        route: 'preflight',
        scope: 'projects/demo-app-1',
        callerEmailHash: emailHashOf(CALLER_EMAIL),
        decision: 'allowed',
        finding: 'ok',
        cached: false,
        strictExposure: false,
      },
      {
        event: 'sa-gate',
        route: 'assets.stream',
        scope: 'projects/demo-app-1',
        callerEmailHash: emailHashOf(CALLER_EMAIL),
        decision: 'allowed',
        finding: 'ok',
        cached: true,
        strictExposure: false,
      },
      {
        event: 'sa-gate',
        route: 'assets.stream',
        scope: 'folders/20000000001',
        callerEmailHash: emailHashOf(CALLER_EMAIL),
        decision: 'denied',
        step: 'caller',
        finding: 'denied',
        cached: false,
        strictExposure: false,
      },
    ]);
    for (const secret of [CALLER_TOKEN, ACCOUNT_TOKEN, CALLER_EMAIL, 'ya29'])
      expect(text()).not.toContain(secret);
  });

  it('is written at info even when LOG_LEVEL is warn or error, and only silent drops it', async () => {
    for (const logLevel of ['warn', 'error'] as const) {
      const { logs, check } = setup({}, { logLevel });
      passed(await check());
      const lines = logs();
      // The gate's decision, and nothing else at info: the request's own lines stay quiet.
      expect(auditOf(lines)).toHaveLength(1);
      expect(lines.every((line) => line.msg === 'service-account gate')).toBe(true);
      expect(lines[0]).toMatchObject({ level: 30 });
    }
    const quiet = setup({}, { logLevel: 'silent' });
    passed(await quiet.check());
    expect(quiet.logs()).toEqual([]);
  });

  it('names no one when the token carries no email', async () => {
    const { logs, check } = setup({ tokeninfo: () => answers.tokenInfo(null) });
    const decision = passed(await check());
    expect(decision.caller).toEqual({ emailHash: null });
    expect(auditOf(logs())[0]).toMatchObject({ callerEmailHash: null, decision: 'allowed' });
  });

  it('hashes the email lower-cased and trimmed (SHA-256, hex)', () => {
    expect(emailHashOf(' Person@Example.com ')).toBe(emailHashOf('person@example.com'));
    expect(emailHashOf('person@example.com')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the caller going away', () => {
  it('rethrows the abort, and remembers nothing', async () => {
    const google = fakeGoogle({ testIam: () => new Promise<Response>(() => undefined) });
    const controller = new AbortController();
    const identity = fakeAccount();
    const gate = new ServiceAccountGate({ identity, strictExposure: false });
    const pending = gate.check({
      scope: PROJECT,
      callerToken: CALLER_TOKEN,
      route: 'assets.stream',
      context: {
        client: testClient((url, init) => {
          const answered = google.fetch(url, init);
          return new Promise<Response>((resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(init.signal?.reason as Error);
            });
            void answered.then(resolve, reject);
          });
        }),
        signal: controller.signal,
        requestId: 'gate-test-abort',
        log: pino({ level: 'silent' }),
      },
    });
    controller.abort(new Error('The client went away.'));
    await expect(pending).rejects.toThrow('The client went away.');
    expect(gate.memoSize).toBe(0);
    expect(identity.accessToken).not.toHaveBeenCalled();
  });
});
