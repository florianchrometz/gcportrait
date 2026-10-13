// SPDX-License-Identifier: MIT
/**
 * The words of the permission check (docs/permissions.md): a title per
 * checklist item, a sentence per finding, a sentence per quota-project result and the overall outcome. The backend
 * sends codes and commands only; everything a person reads is here, once.
 */
import type {
  CandidateResult,
  Finding,
  PreflightAnswer,
  PreflightItem,
  PreflightItemId,
  PreflightOutcome,
  QuotaCandidate,
  UpstreamSummary,
} from './api';

export const ITEM_TITLES: Readonly<Record<PreflightItemId, string>> = {
  'scope-details': 'See the scope’s details',
  'quota-project': 'A quota project for Cloud Asset Inventory',
  'cai-access': 'List the scope’s assets',
  'sa-caller': 'You can see the scope yourself',
  'sa-exposure': 'The service account cannot see the scope’s details on its own',
  'sa-access': 'The service account can list the scope’s assets',
};

export const STATUS_LABELS: Readonly<Record<PreflightItem['status'], string>> = {
  ok: 'OK',
  missing: 'Missing',
  unknown: 'Unknown',
};

/** Google's answer in one line: "403 PERMISSION_DENIED SECURITY_POLICY_VIOLATED". */
export function upstreamLabel(upstream: UpstreamSummary): string {
  const status = upstream.status === 0 ? 'no answer' : String(upstream.status);
  return [status, upstream.code, upstream.reason]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');
}

/** Any other refusal: "Google refused the request (STATUS REASON): MESSAGE". */
export function refusal(upstream: UpstreamSummary | undefined): string {
  if (upstream === undefined) return 'Google refused the request.';
  if (upstream.status === 0) return `Google did not answer (${upstream.message ?? upstreamLabel(upstream)}).`;
  const message = upstream.message === undefined ? '' : `: ${upstream.message}`;
  return `Google refused the request (${upstreamLabel(upstream)})${message}`;
}

const SIGN_IN_AGAIN = 'Sign in again and allow gcportrait to read Cloud Asset Inventory.';
const TRY_AGAIN = 'Google did not answer in time, even after a few tries. Try again in a moment.';
const NOT_CHECKED = 'Not checked: a check before it stopped first.';

/** The sentence for one checklist item. */
export function explainItem(
  item: PreflightItem,
  answer: Pick<PreflightAnswer, 'scope' | 'quotaProject'>,
): string {
  const scope = answer.scope;
  const shared: Partial<Record<Finding, string>> = {
    'sign-in': SIGN_IN_AGAIN,
    transient: TRY_AGAIN,
    unexpected: refusal(item.upstream),
    'not-checked': NOT_CHECKED,
    'no-credentials': 'This gcportrait instance has no service-account credentials to check with.',
  };
  const own: Readonly<Record<PreflightItemId, Partial<Record<Finding, string>>>> = {
    'scope-details': {
      ok: `You can see ${scope}’s details, so the diagram shows names.`,
      denied: `You cannot see ${scope}’s details, so gcportrait shows ids instead of names. Reading its assets still works.`,
    },
    'quota-project': {
      ok: `Requests use the quota of ${answer.quotaProject ?? 'your project'}.`,
      'no-candidate':
        'Pick a project to pay for the Cloud Asset Inventory requests: one where the Cloud Asset API is enabled and ' +
        'you hold serviceusage.services.use (in roles/serviceusage.serviceUsageConsumer).',
      unusable:
        'None of the projects tried can pay for the requests. Fix one of them as shown, or pick another project.',
    },
    'cai-access': {
      ok: `You can list the assets in ${scope}.`,
      denied: `You cannot list assets in ${scope}, or it does not exist.`,
      'not-checked':
        'Not checked yet: Google checks the quota project first. If listing is refused once that works, this is the ' +
        'grant you need.',
    },
    'sa-caller': {
      ok: `You can see ${scope} yourself, so the service account may read it for you.`,
      denied: `You cannot see ${scope} yourself, so service-account mode is refused for it.`,
    },
    'sa-exposure': {
      ok: `The service account cannot read ${scope}’s details on its own, as it should be.`,
      exposed:
        `The service account can read ${scope}’s details itself, for example because they are public, so ` +
        `service-account mode is refused for ${scope}.`,
    },
    'sa-access': {
      ok: `The service account can list the assets in ${scope}.`,
      denied: `The service account cannot list assets in ${scope}. Grant it roles/cloudasset.viewer there.`,
    },
  };
  return own[item.id][item.finding] ?? shared[item.finding] ?? refusal(item.upstream);
}

/** The sentence for one quota project tried. */
export function explainCandidate(candidate: QuotaCandidate): string {
  const project = candidate.project;
  const words: Readonly<Record<CandidateResult, string>> = {
    usable: `${project} can pay for the requests.`,
    'not-found': `${project} does not exist or was deleted. Pick another project.`,
    'no-permission': `You may not use ${project} for API quota.`,
    'api-disabled': `The Cloud Asset API is not enabled in ${project}. After enabling it, allow a few minutes.`,
    'sign-in': SIGN_IN_AGAIN,
    transient: TRY_AGAIN,
    unexpected: refusal(candidate.upstream),
  };
  return words[candidate.result];
}

export const CANDIDATE_SOURCES: Readonly<Record<QuotaCandidate['source'], string>> = {
  scope: 'the scope itself',
  chosen: 'your pick',
};

/** The headline of a finished check. */
export function outcomeHeadline(outcome: PreflightOutcome): string {
  switch (outcome) {
    case 'ready':
      return 'Ready: everything gcportrait needs to read this scope is in place.';
    case 'blocked':
      return 'Not ready yet: what is missing is listed below, with commands that grant it.';
    case 'sign-in':
      return SIGN_IN_AGAIN;
    case 'retry':
      return 'Google did not answer every check. Try again in a moment.';
  }
}

/** The placeholder the backend puts where it does not know the caller's email. */
export const EMAIL_PLACEHOLDER = 'YOUR_EMAIL';

/**
 * Service-account mode in the words of docs/permissions.md §3, for the scope named (or "a scope") and the instance's
 * account (or a placeholder when the instance publishes none). The last paragraph follows the instance's gate: with
 * the strict exposure check (`saStrictExposure` in /api/config) a scope the account can see on its own is refused;
 * without it (the default) a scope whose details are public is open to everyone who signs in.
 */
export function serviceAccountParagraphs(
  scope: string | null,
  account: string | null,
  strictExposure = false,
): readonly string[] {
  const target = scope ?? 'a scope';
  const who = account ?? 'this instance’s service account';
  return [
    `In service-account mode, gcportrait reads ${target} as ${who}, a service account of this gcportrait instance ` +
      '(not a person’s account), and the requests are charged to this instance’s project.',
    `You must still be able to see ${target} yourself, and anyone who can see ${target} and sign in here can read ` +
      'its whole inventory through this account, including projects they cannot open themselves.',
    'Grant the account roles/cloudasset.viewer only, and prefer folders or projects to the whole organisation: in ' +
      'many organisations every member of the domain can see the organisation itself.',
    strictExposure
      ? `If the account can read ${target}’s details itself, for example because they are public, service-account ` +
        `mode is refused for ${target}.`
      : `If ${target}’s details are public, everyone who can sign in here passes the gate for ${target}: grant the ` +
        'account only on scopes whose details are not public.',
  ];
}
