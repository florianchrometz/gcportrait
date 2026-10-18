// SPDX-License-Identifier: Apache-2.0
/**
 * Service-account admission, memo and audit (backend/AGENTS.md, The service-account gate;
 * AGENTS.md, Security and privacy, principle 4). Every check uses the same parsed scope.
 *
 * The caller check uses testIamPermissions, not the caller's GET; only a pass may obtain account
 * credentials, then run the optional exposure check ({@link isExactGetDenial}). Routes call
 * {@link ServiceAccountGate.check} before each CAI call as the account, including each page.
 * Memo bounds and audit policy are in the rule; refusal invalidation and audit-level handling are
 * beside their methods below (backend/README.md, "Service-account mode").
 */
import { createHash } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import { tokenKeyOf } from '../stream/caller.js';
import {
  callGoogle,
  getScope,
  isScopeInsufficient,
  isTransientOutcome,
  isUnauthenticated,
  RESOURCE_MANAGER_URL,
  soleReason,
  summaryOf,
  tokenFacts,
  type GoogleCallContext,
  type GoogleOutcome,
  type TokenFacts,
  type UpstreamSummary,
} from '../upstream/google.js';
import { isRecord } from '../upstream/json.js';
import { SCOPE_COLLECTIONS, scopePath, type ParsedScope } from '../upstream/scope.js';
import type { ServiceAccountIdentity } from './identity.js';

/** The longest a pass is remembered: five minutes. */
export const GATE_MEMO_MAX_MS = 5 * 60_000;
/** The most passes remembered at once; the oldest go first. */
export const GATE_MEMO_MAX_ENTRIES = 10_000;

/** The permission the gate asks for, and Resource Manager names when it refuses the `get` of a scope of this kind. */
export function getPermissionOf(scope: ParsedScope): string {
  return `resourcemanager.${SCOPE_COLLECTIONS[scope.kind]}.get`;
}

/**
 * Whether an answer is exactly Resource Manager's IAM denial of `get` on the scope (the exposure check): HTTP
 * 403, `error.status` `PERMISSION_DENIED`, exactly one ErrorInfo, with reason `IAM_PERMISSION_DENIED`, domain
 * `cloudresourcemanager.googleapis.com` and `metadata.permission` the `get` permission of the scope's kind.
 */
export function isExactGetDenial(outcome: GoogleOutcome, scope: ParsedScope): boolean {
  if (outcome.kind !== 'answer' || outcome.httpStatus !== 403) return false;
  const error = outcome.error;
  if (error?.json !== true || error.status !== 'PERMISSION_DENIED' || error.infos.length !== 1) return false;
  const [info] = error.infos;
  return (
    info !== undefined &&
    info.reason === 'IAM_PERMISSION_DENIED' &&
    info.domain === 'cloudresourcemanager.googleapis.com' &&
    info.metadata.permission === getPermissionOf(scope)
  );
}

/** The SHA-256 (hex) of an email, lower-cased and trimmed: the audit line's pseudonym for the caller. */
export function emailHashOf(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}

/** The gate's steps, in order. */
export type GateStep = 'caller' | 'credentials' | 'exposure';

/**
 * What a step came to:
 * - `ok`: passed;
 * - `denied`: the caller does not hold the scope's `get` permission (`caller`);
 * - `exposed`: the account can `get` the scope itself (`exposure`, strict mode);
 * - `unauthenticated`: Google did not accept the caller's token at all;
 * - `sign-in`: the caller's token lacks the OAuth scope Resource Manager needs;
 * - `transient`: 429, 5xx or no answer after the retries;
 * - `unexpected`: an answer the gate does not understand (it fails closed);
 * - `no-credentials`: the instance could not get its own account's token (`credentials`).
 */
export type GateFinding =
  'ok' | 'denied' | 'exposed' | 'unauthenticated' | 'sign-in' | 'transient' | 'unexpected' | 'no-credentials';

export interface GateStepResult {
  readonly step: GateStep;
  readonly finding: GateFinding;
  /** What Google answered, for a step that asked Google and did not pass. */
  readonly upstream?: UpstreamSummary;
}

/** Who asked, as far as tokeninfo says. The email is for the preflight's commands only: never logged or kept. */
export interface GateCaller {
  readonly email?: string;
  readonly emailHash: string | null;
}

export interface GatePass {
  readonly allowed: true;
  /** Whether the memo answered (no Google call was made for the caller). */
  readonly cached: boolean;
  /** The account's access token, for exactly the CAI call this pass was asked for. */
  readonly token: string;
  readonly caller: GateCaller;
  /** The steps run (empty when the memo answered, but for the account's token). */
  readonly steps: readonly GateStepResult[];
}

export interface GateRefusal {
  readonly allowed: false;
  /** The step that refused. */
  readonly step: GateStep;
  readonly finding: Exclude<GateFinding, 'ok'>;
  /** 401 (sign in again), 403 (refused) or 503 (try again). */
  readonly status: 401 | 403 | 503;
  /** A stable code for the API: `SA_GATE_CALLER_DENIED`, `SA_GATE_EXPOSED`, … */
  readonly code: string;
  /** What happened and what to do, for a person. */
  readonly message: string;
  readonly retryable: boolean;
  readonly upstream?: UpstreamSummary;
  readonly caller: GateCaller;
  readonly steps: readonly GateStepResult[];
}

export type GateDecision = GatePass | GateRefusal;

/** The routes that take `mode: "sa"`, named on the audit line. */
export type GatedRoute = 'assets.stream' | 'preflight' | 'render';

export interface GateRequest {
  /** The validated scope; every URL of the gate's calls is built from this same value. */
  readonly scope: ParsedScope;
  readonly callerToken: string;
  /** The incoming request's Google call context (its client, abort signal, request id and logger). */
  readonly context: GoogleCallContext;
  readonly route: GatedRoute;
  /** Check afresh, without asking the memo (the preflight); a pass is still remembered. */
  readonly fresh?: boolean;
}

export interface ServiceAccountGateOptions {
  readonly identity: ServiceAccountIdentity;
  /** `SA_MODE_STRICT_EXPOSURE`: run the `exposure` check. */
  readonly strictExposure: boolean;
  /** How long a pass is remembered; clamped to {@link GATE_MEMO_MAX_MS}. */
  readonly memoMs?: number;
  readonly memoMaxEntries?: number;
  /** The memo's clock (tests). */
  readonly now?: () => number;
}

interface MemoEntry {
  readonly expiresAt: number;
  readonly emailHash: string | null;
}

/**
 * Remembered passes, keyed by the SHA-256 of the caller's token and the scope. Bounded: when full, expired
 * entries go first, then the oldest.
 */
class GateMemo {
  readonly #entries = new Map<string, MemoEntry>();
  readonly #maxEntries: number;

  constructor(maxEntries: number) {
    this.#maxEntries = Math.max(1, maxEntries);
  }

  get(key: string, now: number): MemoEntry | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= now) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, entry: MemoEntry, now: number): void {
    this.#entries.delete(key);
    if (this.#entries.size >= this.#maxEntries) {
      for (const [stale, value] of this.#entries) if (value.expiresAt <= now) this.#entries.delete(stale);
      for (const oldest of this.#entries.keys()) {
        if (this.#entries.size < this.#maxEntries) break;
        this.#entries.delete(oldest);
      }
    }
    this.#entries.set(key, entry);
  }

  /** Forgets a pass: a refusal for the same token and scope ends it at once. */
  delete(key: string): void {
    this.#entries.delete(key);
  }

  get size(): number {
    return this.#entries.size;
  }
}

/**
 * The logger for the audit line: the request's own, at least as verbose as `info`. The line is written at `info`
 * (it records a decision, not a problem), and an operator who sets `LOG_LEVEL=warn` or `error` to quiet the
 * request lines still gets every decision; only `silent` turns it off, as it turns off everything.
 */
export function auditLoggerOf(log: FastifyBaseLogger): FastifyBaseLogger {
  return QUIETER_THAN_INFO.has(log.level) ? log.child({}, { level: 'info' }) : log;
}

/** The pino levels that would drop an `info` line; `silent` is not among them on purpose. */
const QUIETER_THAN_INFO: ReadonlySet<string> = new Set(['warn', 'error', 'fatal']);

/** Resource Manager v3 `testIamPermissions` on the scope with one permission (`caller`). Never a quota header. */
export function testScopePermission(
  context: GoogleCallContext,
  scope: ParsedScope,
  token: string,
  permission: string,
): Promise<GoogleOutcome> {
  return callGoogle(context, {
    operation: `resourcemanager.${SCOPE_COLLECTIONS[scope.kind]}.testIamPermissions`,
    method: 'POST',
    url: `${RESOURCE_MANAGER_URL}/${scopePath(scope)}:testIamPermissions`,
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ permissions: [permission] }),
  });
}

/** The `caller` answer, as a finding: only a 200 whose `permissions` contain the permission asked for passes. */
export function classifyCallerCheck(outcome: GoogleOutcome, permission: string): GateFinding {
  if (outcome.kind === 'answer' && outcome.httpStatus === 200) {
    if (!isRecord(outcome.body)) return 'unexpected';
    const granted = outcome.body.permissions;
    if (granted === undefined) return 'denied';
    if (!Array.isArray(granted) || !granted.every((entry) => typeof entry === 'string')) return 'unexpected';
    return granted.includes(permission) ? 'ok' : 'denied';
  }
  if (isUnauthenticated(outcome)) return 'unauthenticated';
  if (isScopeInsufficient(outcome)) return 'sign-in';
  if (isTransientOutcome(outcome)) return 'transient';
  if (
    outcome.kind === 'answer' &&
    outcome.httpStatus === 403 &&
    soleReason(outcome) === 'IAM_PERMISSION_DENIED'
  )
    return 'denied';
  return 'unexpected';
}

/** The `exposure` answer, as a finding: the exact denial passes; a 200 is classified as exposed. */
export function classifyExposureCheck(outcome: GoogleOutcome, scope: ParsedScope): GateFinding {
  if (isExactGetDenial(outcome, scope)) return 'ok';
  if (outcome.kind === 'answer' && outcome.httpStatus === 200) return 'exposed';
  if (isTransientOutcome(outcome)) return 'transient';
  return 'unexpected';
}

function upstreamLabel(upstream: UpstreamSummary | undefined): string {
  if (upstream === undefined) return '';
  const parts = [
    upstream.status === 0 ? 'no answer' : String(upstream.status),
    upstream.code,
    upstream.reason,
  ];
  const label = parts.filter((part) => part !== undefined && part !== '').join(' ');
  return upstream.message === undefined ? ` (${label})` : ` (${label}): ${upstream.message}`;
}

/** The refusal for a step's finding: status, code and the sentence a person reads. */
function refusalOf(
  step: GateStep,
  finding: Exclude<GateFinding, 'ok'>,
  scope: ParsedScope,
  upstream: UpstreamSummary | undefined,
): Pick<GateRefusal, 'status' | 'code' | 'message' | 'retryable'> {
  const permission = getPermissionOf(scope);
  switch (finding) {
    case 'unauthenticated':
      return {
        status: 401,
        code: 'UNAUTHENTICATED',
        message: 'Google did not accept your sign-in. Sign in again.',
        retryable: false,
      };
    case 'denied':
      return {
        status: 403,
        code: 'SA_GATE_CALLER_DENIED',
        message:
          `You cannot see ${scope.name} yourself (you do not hold ${permission} there), so gcportrait does not ` +
          'read it with its service account.',
        retryable: false,
      };
    case 'exposed':
      return {
        status: 403,
        code: 'SA_GATE_EXPOSED',
        message:
          `This instance's service account can see ${scope.name}'s details on its own, for example because they ` +
          `are public, so service-account mode is refused for ${scope.name} (strict exposure check).`,
        retryable: false,
      };
    case 'sign-in':
      return {
        status: 403,
        code: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
        message: 'Sign in again and allow gcportrait to read your Google Cloud resources.',
        retryable: false,
      };
    case 'transient':
      return {
        status: 503,
        code: 'SA_GATE_UNAVAILABLE',
        message: `Google did not answer the service-account check in time${upstreamLabel(upstream)}. Try again in a moment.`,
        retryable: true,
      };
    case 'no-credentials':
      return {
        status: 503,
        code: 'SA_CREDENTIALS_UNAVAILABLE',
        message:
          "This gcportrait instance could not get its service account's access token. Try again later; if it " +
          'goes on, tell whoever runs the instance.',
        retryable: true,
      };
    case 'unexpected':
      return {
        status: 403,
        code: step === 'exposure' ? 'SA_GATE_EXPOSURE_UNEXPECTED' : 'SA_GATE_UNEXPECTED',
        message:
          `Google answered the service-account check in a way gcportrait does not understand${upstreamLabel(upstream)}` +
          `, so service-account mode is refused for ${scope.name}.`,
        retryable: false,
      };
  }
}

/** The service-account gate of one server: the account, strict mode or not, and the memo of passes. */
export class ServiceAccountGate {
  readonly strictExposure: boolean;
  readonly #identity: ServiceAccountIdentity;
  readonly #memo: GateMemo;
  readonly #memoMs: number;
  readonly #now: () => number;

  constructor(options: ServiceAccountGateOptions) {
    this.#identity = options.identity;
    this.strictExposure = options.strictExposure;
    this.#memoMs = Math.max(0, Math.min(options.memoMs ?? GATE_MEMO_MAX_MS, GATE_MEMO_MAX_MS));
    this.#memo = new GateMemo(options.memoMaxEntries ?? GATE_MEMO_MAX_ENTRIES);
    this.#now = options.now ?? Date.now;
  }

  /** The account customers grant `roles/cloudasset.viewer` to. */
  get email(): string {
    return this.#identity.email;
  }

  /** How many passes are remembered (tests). */
  get memoSize(): number {
    return this.#memo.size;
  }

  /**
   * Runs the gate for one CAI call as the account. Rethrows only the caller's abort (the client went away); every
   * other failure is a refusal.
   */
  async check(request: GateRequest): Promise<GateDecision> {
    const { scope, callerToken, context } = request;
    const key = `${tokenKeyOf(callerToken)} ${scope.name}`;

    const remembered = request.fresh === true ? undefined : this.#memo.get(key, this.#now());
    if (remembered !== undefined) {
      const caller: GateCaller = { emailHash: remembered.emailHash };
      const token = await this.#accountToken(context);
      if (token === null)
        return this.#refuse(request, key, caller, [], 'credentials', 'no-credentials', true);
      this.#audit(request, caller, 'allowed', { finding: 'ok', cached: true });
      return { allowed: true, cached: true, token, caller, steps: [] };
    }

    // The caller check, with tokeninfo next to it for the audit line's email hash and the memo's lifetime.
    const permission = getPermissionOf(scope);
    const [facts, tested] = await Promise.all([
      tokenFacts(context, callerToken),
      testScopePermission(context, scope, callerToken, permission),
    ]);
    const caller = callerOf(facts);
    const steps: GateStepResult[] = [];
    const callerFinding: GateFinding =
      facts.kind === 'invalid' ? 'unauthenticated' : classifyCallerCheck(tested, permission);
    steps.push(
      facts.kind === 'invalid'
        ? { step: 'caller', finding: callerFinding }
        : stepResult('caller', callerFinding, tested),
    );
    if (callerFinding !== 'ok')
      return this.#refuse(request, key, caller, steps, 'caller', callerFinding, false);

    // Credentials: the account's own token. Nothing has been asked as the account before this point.
    const token = await this.#accountToken(context);
    if (token === null) {
      steps.push({ step: 'credentials', finding: 'no-credentials' });
      return this.#refuse(request, key, caller, steps, 'credentials', 'no-credentials', false);
    }
    steps.push({ step: 'credentials', finding: 'ok' });

    // Exposure (strict mode only): the account must not be able to read the scope's details itself.
    if (this.strictExposure) {
      const exposed = await getScope(context, scope, token);
      const exposureFinding = classifyExposureCheck(exposed, scope);
      steps.push(stepResult('exposure', exposureFinding, exposed));
      if (exposureFinding !== 'ok')
        return this.#refuse(request, key, caller, steps, 'exposure', exposureFinding, false);
    }

    const lifetimeMs =
      facts.kind === 'valid' && facts.expiresIn !== undefined
        ? Math.min(this.#memoMs, facts.expiresIn * 1000)
        : this.#memoMs;
    if (lifetimeMs > 0)
      this.#memo.set(key, { expiresAt: this.#now() + lifetimeMs, emailHash: caller.emailHash }, this.#now());
    this.#audit(request, caller, 'allowed', { finding: 'ok', cached: false });
    return { allowed: true, cached: false, token, caller, steps };
  }

  /** The account's token, or null when the identity cannot give one (logged without detail). */
  async #accountToken(context: GoogleCallContext): Promise<string | null> {
    try {
      return await this.#identity.accessToken(context.signal);
    } catch (error) {
      if (context.signal.aborted) throw error;
      context.log.warn(
        { serviceAccount: { source: this.#identity.source } },
        'service-account token unavailable',
      );
      return null;
    }
  }

  /**
   * A refusal. A refusal about the caller or the scope (`caller` or `exposure`) also forgets any pass remembered
   * for this token and scope: a check that now says "refused" (the preflight checks afresh) must not leave an
   * earlier pass open for the next pull. The account's own token being unavailable (`credentials`) says nothing
   * about the caller, so a pass stays.
   */
  #refuse(
    request: GateRequest,
    key: string,
    caller: GateCaller,
    steps: readonly GateStepResult[],
    step: GateStep,
    finding: Exclude<GateFinding, 'ok'>,
    cached: boolean,
  ): GateRefusal {
    if (step !== 'credentials') this.#memo.delete(key);
    const upstream = steps.find((entry) => entry.step === step)?.upstream;
    this.#audit(request, caller, 'denied', { step, finding, cached });
    return {
      allowed: false,
      step,
      finding,
      ...refusalOf(step, finding, request.scope, upstream),
      ...(upstream === undefined ? {} : { upstream }),
      caller,
      steps,
    };
  }

  /**
   * The audit line: route, scope, the caller's email hash, the decision. Never the token or the email. Written
   * at `info` whatever `LOG_LEVEL` says, short of `silent` ({@link auditLoggerOf}).
   */
  #audit(
    request: GateRequest,
    caller: GateCaller,
    decision: 'allowed' | 'denied',
    details: { readonly step?: GateStep; readonly finding: GateFinding; readonly cached: boolean },
  ): void {
    auditLoggerOf(request.context.log).info(
      {
        audit: {
          event: 'sa-gate',
          route: request.route,
          scope: request.scope.name,
          callerEmailHash: caller.emailHash,
          decision,
          ...details,
          strictExposure: this.strictExposure,
        },
      },
      'service-account gate',
    );
  }
}

function callerOf(facts: TokenFacts): GateCaller {
  if (facts.kind !== 'valid' || facts.email === undefined) return { emailHash: null };
  return { email: facts.email, emailHash: emailHashOf(facts.email) };
}

/** A step's result; Google's answer goes with it only when it was an error, never with a pass or a 200. */
function stepResult(step: GateStep, finding: GateFinding, outcome: GoogleOutcome): GateStepResult {
  const answered200 = outcome.kind === 'answer' && outcome.httpStatus === 200;
  return finding === 'ok' || answered200
    ? { step, finding }
    : { step, finding, upstream: summaryOf(outcome) };
}
