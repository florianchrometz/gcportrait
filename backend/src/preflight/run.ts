// SPDX-License-Identifier: MIT
/**
 * The permission preflight (docs/permissions.md; ADR 0028 §2 and §4; skill cai-ingestion §3): which of
 * the grants a pull of one scope needs are in place, checked against Google with the caller's token, answered as
 * a checklist with copy-ready commands.
 *
 * **User mode** (ADR 0028 §2), in this order:
 * 1. Resource Manager `GET {scope}`: a 200 gives the display name; 403 `IAM_PERMISSION_DENIED` is only a warning
 *    (`roles/cloudasset.viewer` does not include `resourcemanager.*.get`, and a user holding only that role can
 *    still list); any other answer stops, as in step 2's table.
 * 2. The quota project: CAI `assets.list` with `pageSize: 1` and `x-goog-user-project`, for the scope itself when
 *    it is a project, then the project the person picked; never any other guess, never the instance's project.
 *    Each answer is matched on HTTP status and `ErrorInfo` reason together ({@link classifyProbe}); an answer the
 *    table does not know stops the preflight and fails closed.
 *
 * **Service-account mode** (ADR 0028 §4 and its amendment): the gate of ../auth/gate.ts, checked afresh (the
 * caller's `testIamPermissions` for the scope's `get`; with `SA_MODE_STRICT_EXPOSURE`, the account's `get` must be
 * exactly Resource Manager's IAM denial), and only after a pass the account's own probe, without a quota header.
 * The gate is never skipped and never configured away: without a pass, the account makes no CAI call, and the
 * result carries the gate's refusal, which the route answers as 403, 401 or 503 with the checklist in the body.
 *
 * Google's `tokeninfo` runs next to the first check: its email (when the token carries one) fills `--member`, and a
 * token it calls invalid ends the preflight with 401 (the person signs in again).
 */
import {
  getPermissionOf,
  type GateFinding,
  type GateRefusal,
  type GateStep,
  type GateStepResult,
  type ServiceAccountGate,
} from '../auth/gate.js';
import {
  getScope,
  isRecord,
  isScopeInsufficient,
  isTransientOutcome,
  isUnauthenticated,
  probeAssets,
  soleReason,
  summaryOf,
  tokenFacts,
  type GoogleCallContext,
  type GoogleOutcome,
} from '../upstream/google.js';
import { QuotaProjectSchema, type ParsedScope } from '../upstream/scope.js';
import {
  BROWSER,
  callerMember,
  CLOUD_ASSET_VIEWER,
  enableCloudAsset,
  LIST_PERMISSION,
  memberFor,
  QUOTA_PERMISSION,
  quotaBinding,
  scopeBinding,
  SERVICE_USAGE_CONSUMER,
} from './commands.js';
import type {
  CandidateResult,
  Finding,
  PreflightItem,
  PreflightMode,
  PreflightOutcome,
  PreflightResponse,
  QuotaCandidate,
} from './schemas.js';

export interface PreflightInput {
  readonly scope: ParsedScope;
  readonly mode: PreflightMode;
  readonly quotaProject?: string;
  /** The caller's bearer token, forwarded verbatim. */
  readonly token: string;
}

export interface PreflightDependencies {
  readonly context: GoogleCallContext;
  /** Service-account mode's gate (../auth/gate.ts), or null when this instance has no identity for it. */
  readonly gate: ServiceAccountGate | null;
  /** The account email the instance publishes (`/api/config`), for the commands. */
  readonly serviceAccountEmail: string | null;
}

/**
 * The checklist, or `unauthenticated` when Google did not accept the caller's token at all (the route's 401). In
 * service-account mode a checklist whose gate did not pass carries the gate's `refusal` (the route's 403 or 503).
 */
export type PreflightResult =
  | { readonly kind: 'checklist'; readonly response: PreflightResponse; readonly refusal?: GateRefusal }
  | { readonly kind: 'unauthenticated' };

/** The scope's display name from a Resource Manager `get` answer (a project falls back to its id). */
export function displayNameOf(outcome: GoogleOutcome): string | undefined {
  if (outcome.kind !== 'answer' || outcome.httpStatus !== 200 || !isRecord(outcome.body)) return undefined;
  const { displayName, projectId } = outcome.body;
  if (typeof displayName === 'string' && displayName.trim() !== '') return displayName;
  return typeof projectId === 'string' ? projectId : undefined;
}

/**
 * A project's id from its Resource Manager `get` answer (a scope given as a number resolves to its id). It goes
 * into `x-goog-user-project` and into the commands, so it must pass the same rule as a quota project the caller
 * names (QuotaProjectSchema); anything else is ignored and the scope's own id is used.
 */
export function projectIdOf(outcome: GoogleOutcome): string | undefined {
  if (outcome.kind !== 'answer' || outcome.httpStatus !== 200 || !isRecord(outcome.body)) return undefined;
  const parsed = QuotaProjectSchema.safeParse(outcome.body.projectId);
  return parsed.success ? parsed.data : undefined;
}

/** A Resource Manager `get` of the scope (user step 1, gate step 1), as a finding. */
export function classifyGet(outcome: GoogleOutcome): Finding {
  if (outcome.kind === 'answer' && outcome.httpStatus === 200) return 'ok';
  if (
    outcome.kind === 'answer' &&
    outcome.httpStatus === 403 &&
    soleReason(outcome) === 'IAM_PERMISSION_DENIED'
  ) {
    return 'denied';
  }
  if (isScopeInsufficient(outcome)) return 'sign-in';
  if (isTransientOutcome(outcome)) return 'transient';
  return 'unexpected';
}

/** What a user-mode probe says (ADR 0028 §2 step 2's table). */
export type ProbeVerdict =
  /** 200: the quota project is usable and the scope is listable. */
  | 'listable'
  /** 403 `PERMISSION_DENIED` without an ErrorInfo: the quota project is usable, the scope is not listable. */
  | 'scope-denied'
  | 'not-found'
  | 'no-permission'
  | 'api-disabled'
  | 'sign-in'
  | 'unauthenticated'
  | 'transient'
  | 'unexpected';

export function classifyProbe(outcome: GoogleOutcome): ProbeVerdict {
  if (outcome.kind === 'failure') return outcome.failure === 'too-large' ? 'unexpected' : 'transient';
  const { httpStatus, error } = outcome;
  if (httpStatus === 200) return 'listable';
  if (isUnauthenticated(outcome)) return 'unauthenticated';
  if (isTransientOutcome(outcome)) return 'transient';
  const reason = soleReason(outcome);
  if (httpStatus === 400 && reason === 'USER_PROJECT_DENIED') return 'not-found';
  if (httpStatus === 403) {
    if (reason === 'USER_PROJECT_DENIED') return 'no-permission';
    if (reason === 'SERVICE_DISABLED') return 'api-disabled';
    if (reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') return 'sign-in';
    if (error?.json === true && error.status === 'PERMISSION_DENIED' && error.infos.length === 0) {
      return 'scope-denied';
    }
  }
  return 'unexpected';
}

/** The account's own probe in service-account mode (no quota header). */
export function classifyAccountProbe(outcome: GoogleOutcome): Finding {
  const verdict = classifyProbe(outcome);
  if (verdict === 'listable') return 'ok';
  if (verdict === 'scope-denied') return 'denied';
  if (verdict === 'transient') return 'transient';
  // The instance's own project or token is wrong (API disabled, scope, …): the operator's problem, passed on.
  return 'unexpected';
}

/** A gate step's finding as a checklist finding (`unauthenticated` never gets here: the route answers 401). */
function findingOfGate(finding: GateFinding): Finding {
  return finding === 'unauthenticated' ? 'sign-in' : finding;
}

const STATUS_OF: Readonly<Record<Finding, PreflightItem['status']>> = {
  ok: 'ok',
  denied: 'missing',
  exposed: 'missing',
  'no-candidate': 'missing',
  unusable: 'missing',
  'not-checked': 'unknown',
  'no-credentials': 'unknown',
  'sign-in': 'unknown',
  transient: 'unknown',
  unexpected: 'unknown',
};

/** Findings that end the checks: nothing after them is asked of Google. */
function stops(finding: Finding): boolean {
  return finding === 'sign-in' || finding === 'transient' || finding === 'unexpected';
}

function item(
  fields: Omit<PreflightItem, 'status' | 'upstream' | 'commands'> & { readonly commands: readonly string[] },
  upstream?: GoogleOutcome,
): PreflightItem {
  return {
    ...fields,
    commands: [...fields.commands],
    status: STATUS_OF[fields.finding],
    ...(upstream === undefined || fields.finding === 'ok' ? {} : { upstream: summaryOf(upstream) }),
  };
}

/** The overall outcome: sign in again, ready, try again, or blocked (ADR 0028 §2). */
export function outcomeOf(items: readonly PreflightItem[]): PreflightOutcome {
  if (items.some((entry) => entry.finding === 'sign-in')) return 'sign-in';
  if (items.every((entry) => !entry.blocking || entry.status === 'ok')) return 'ready';
  if (items.some((entry) => entry.finding === 'transient')) return 'retry';
  return 'blocked';
}

const CANDIDATE_RESULT: Readonly<Record<Exclude<ProbeVerdict, 'unauthenticated'>, CandidateResult>> = {
  listable: 'usable',
  'scope-denied': 'usable',
  'not-found': 'not-found',
  'no-permission': 'no-permission',
  'api-disabled': 'api-disabled',
  'sign-in': 'sign-in',
  transient: 'transient',
  unexpected: 'unexpected',
};

async function userPreflight(
  input: PreflightInput,
  { context }: PreflightDependencies,
): Promise<PreflightResult> {
  const { scope, token } = input;
  const [facts, details] = await Promise.all([tokenFacts(context, token), getScope(context, scope, token)]);
  if (facts.kind === 'invalid' || isUnauthenticated(details)) return { kind: 'unauthenticated' };
  const member = memberFor(facts.kind === 'valid' ? facts.email : undefined);
  const who = callerMember(member);

  const detailsFinding = classifyGet(details);
  const items: PreflightItem[] = [
    item(
      {
        id: 'scope-details',
        finding: detailsFinding,
        blocking: false,
        permission: getPermissionOf(scope),
        role: BROWSER,
        member: who,
        resource: scope.name,
        commands: detailsFinding === 'denied' ? [scopeBinding(scope, who, BROWSER)] : [],
      },
      details,
    ),
  ];
  const listingCommands = [scopeBinding(scope, who, CLOUD_ASSET_VIEWER)];
  const listing = {
    id: 'cai-access',
    blocking: true,
    permission: LIST_PERMISSION,
    role: CLOUD_ASSET_VIEWER,
    member: who,
    resource: scope.name,
  } as const;
  const quota = { id: 'quota-project', blocking: true, permission: QUOTA_PERMISSION, member: who } as const;

  const candidates: QuotaCandidate[] = [];
  let usable: {
    readonly project: string;
    readonly verdict: ProbeVerdict;
    readonly outcome: GoogleOutcome;
  } | null = null;
  let stop: { readonly finding: Finding; readonly outcome: GoogleOutcome } | null = null;

  if (stops(detailsFinding)) {
    stop = { finding: 'not-checked', outcome: details };
  } else {
    const scopeProject = scope.kind === 'project' ? (projectIdOf(details) ?? scope.id) : null;
    const tries: { readonly project: string; readonly source: QuotaCandidate['source'] }[] = [];
    if (scopeProject !== null) tries.push({ project: scopeProject, source: 'scope' });
    if (input.quotaProject !== undefined && input.quotaProject !== scopeProject) {
      tries.push({ project: input.quotaProject, source: 'chosen' });
    }
    for (const candidate of tries) {
      const outcome = await probeAssets(context, scope, token, candidate.project);
      const verdict = classifyProbe(outcome);
      if (verdict === 'unauthenticated') return { kind: 'unauthenticated' };
      const result = CANDIDATE_RESULT[verdict];
      candidates.push({
        project: candidate.project,
        source: candidate.source,
        result,
        commands:
          result === 'no-permission'
            ? [quotaBinding(candidate.project, who)]
            : result === 'api-disabled'
              ? [enableCloudAsset(candidate.project)]
              : [],
        ...(result === 'usable' ? {} : { upstream: summaryOf(outcome) }),
      });
      if (result === 'usable') {
        usable = { project: candidate.project, verdict, outcome };
        break;
      }
      if (result === 'sign-in' || result === 'transient' || result === 'unexpected') {
        stop = { finding: result, outcome };
        break;
      }
    }
  }

  if (usable !== null) {
    items.push(
      item({
        ...quota,
        finding: 'ok',
        role: SERVICE_USAGE_CONSUMER,
        resource: `projects/${usable.project}`,
        commands: [],
      }),
      item(
        {
          ...listing,
          finding: usable.verdict === 'listable' ? 'ok' : 'denied',
          commands: usable.verdict === 'listable' ? [] : listingCommands,
        },
        usable.outcome,
      ),
    );
  } else {
    const failed = candidates.at(-1);
    const quotaFinding: Finding =
      stop !== null ? stop.finding : candidates.length === 0 ? 'no-candidate' : 'unusable';
    items.push(
      item(
        {
          ...quota,
          finding: quotaFinding,
          role: SERVICE_USAGE_CONSUMER,
          resource: failed === undefined ? 'projects/QUOTA_PROJECT' : `projects/${failed.project}`,
          commands: candidates.flatMap((candidate) => candidate.commands),
        },
        stop?.finding === 'not-checked' ? undefined : stop?.outcome,
      ),
      item({ ...listing, finding: 'not-checked', commands: listingCommands }),
    );
  }

  const displayName = displayNameOf(details);
  return {
    kind: 'checklist',
    response: {
      scope: scope.name,
      kind: scope.kind,
      mode: 'user',
      outcome: outcomeOf(items),
      ...(displayName === undefined ? {} : { displayName }),
      ...(usable === null ? {} : { quotaProject: usable.project }),
      ...(member === null ? {} : { member }),
      items,
      candidates,
    },
  };
}

async function accountPreflight(
  input: PreflightInput,
  { context, gate, serviceAccountEmail }: PreflightDependencies,
): Promise<PreflightResult> {
  const { scope, token } = input;
  if (gate === null) throw new Error('The service-account preflight needs the gate.');
  // The gate, checked afresh. Nothing the account does happens before it passes.
  const decision = await gate.check({ scope, callerToken: token, context, route: 'preflight', fresh: true });
  if (!decision.allowed && decision.finding === 'unauthenticated') return { kind: 'unauthenticated' };
  const member = memberFor(decision.caller.email);
  const who = callerMember(member);
  const account = memberFor(serviceAccountEmail ?? undefined);
  const accountMember =
    account === null ? 'serviceAccount:BACKEND_SA_EMAIL' : account.replace(/^user:/, 'serviceAccount:');
  const getPermission = getPermissionOf(scope);
  const accessCommands = [scopeBinding(scope, accountMember, CLOUD_ASSET_VIEWER)];
  const stepOf = (step: GateStep): GateStepResult | undefined =>
    decision.steps.find((entry) => entry.step === step);
  const credentialsFailed = stepOf('credentials')?.finding === 'no-credentials';

  const caller = stepOf('caller');
  const callerFinding: Finding = caller === undefined ? 'not-checked' : findingOfGate(caller.finding);
  const items: PreflightItem[] = [
    {
      id: 'sa-caller',
      status: STATUS_OF[callerFinding],
      finding: callerFinding,
      blocking: true,
      permission: getPermission,
      role: BROWSER,
      member: who,
      resource: scope.name,
      commands: callerFinding === 'denied' ? [scopeBinding(scope, who, BROWSER)] : [],
      ...(caller?.upstream === undefined ? {} : { upstream: caller.upstream }),
    },
  ];
  if (gate.strictExposure) {
    const exposure = stepOf('exposure');
    const exposureFinding: Finding =
      exposure !== undefined
        ? findingOfGate(exposure.finding)
        : credentialsFailed
          ? 'no-credentials'
          : 'not-checked';
    items.push({
      id: 'sa-exposure',
      status: STATUS_OF[exposureFinding],
      finding: exposureFinding,
      blocking: true,
      permission: getPermission,
      member: accountMember,
      resource: scope.name,
      commands: [],
      ...(exposure?.upstream === undefined ? {} : { upstream: exposure.upstream }),
    });
  }
  const access = {
    id: 'sa-access',
    blocking: true,
    permission: LIST_PERMISSION,
    role: CLOUD_ASSET_VIEWER,
    member: accountMember,
    resource: scope.name,
  } as const;
  if (decision.allowed) {
    // The gate passed: now, and only now, the account's own CAI call, without a quota header.
    const probe = await probeAssets(context, scope, decision.token, null);
    const accessFinding = classifyAccountProbe(probe);
    items.push(
      item(
        { ...access, finding: accessFinding, commands: accessFinding === 'ok' ? [] : accessCommands },
        probe,
      ),
    );
  } else {
    items.push(
      item({
        ...access,
        finding: credentialsFailed ? 'no-credentials' : 'not-checked',
        commands: accessCommands,
      }),
    );
  }

  return {
    kind: 'checklist',
    response: {
      scope: scope.name,
      kind: scope.kind,
      mode: 'sa',
      outcome: outcomeOf(items),
      ...(member === null ? {} : { member }),
      ...(serviceAccountEmail === null ? {} : { serviceAccount: serviceAccountEmail }),
      items,
      candidates: [],
    },
    ...(decision.allowed ? {} : { refusal: decision }),
  };
}

/** Runs the preflight for one scope and mode. Rethrows only the caller's abort (the client went away). */
export function runPreflight(
  input: PreflightInput,
  dependencies: PreflightDependencies,
): Promise<PreflightResult> {
  return input.mode === 'user' ? userPreflight(input, dependencies) : accountPreflight(input, dependencies);
}
