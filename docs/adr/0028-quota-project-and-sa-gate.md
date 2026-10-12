<!-- SPDX-License-Identifier: MIT -->

# 0028. Quota project and the service-account gate

- **Status:** accepted (2026-10-10, when service-account mode was built), with the amendment to section 4 below
- **Date:** 2026-10-10
- **Deciders:** Florian Chrometz (maintainer); proposed by the quota-project spike; accepted and amended when
  service-account mode was built
- **Related:** ADR [0004](0004-user-sign-in-and-service-account-mode.md); [ADR 0035](0035-decisions-inherited-from-the-implementation-plan.md)
  §4 (principle 4); skill cai-ingestion §3, §4, §6; [docs/permissions.md](../permissions.md)

## Context

The first design (ADR 0004) left two things to a spike: how Cloud Asset Inventory (CAI) calls with a user's token pick the
project that pays for them (its quota project), and how the service-account (SA) mode gate works in practice.
[docs/spikes/quota-project.md](../spikes/quota-project.md) records the calls, made with curl against a
real project on 2026-10-10, with the maintainer's user token and with a real service account that holds only
`roles/cloudasset.viewer`. [scripts/spike-quota-project.sh](../../scripts/spike-quota-project.sh) re-runs them.
What decides the design (spike finding numbers in brackets):

- The consumer is the project in `x-goog-user-project`. Without the header, it is the project that owns the
  token's OAuth client [2]:
  - for a gcloud user token, the gcloud CLI's project;
  - for a service account's token, the account's own project;
  - in production, for a user token, the project of the instance's OAuth client (the sign-in work was to confirm it).

  The Cloud Asset API must be enabled in the consumer project, not in the scanned one [1].
- Quota-project failures come back with reasons the backend can classify (`USER_PROJECT_DENIED` 400 or 403,
  `SERVICE_DISABLED` 403) [3]. Google checks the token's OAuth scopes first, then the quota project, then the
  scope's IAM [4].
- A token may name its own project as the quota project without `serviceusage.services.use` [16].
- A scope the caller cannot list is a 403 without an `ErrorInfo` reason, never an empty list [5].
- `resourcemanager.projects.get` can be granted publicly, and then service accounts have it too [7]. "The
  caller can `get` the scope", the gate as ADR 0004 first described it, is then passed by every signed-in user.
- `roles/cloudasset.viewer` holds neither `resourcemanager.*.get` nor `serviceusage.services.use`, so an
  account holding only that role gets Resource Manager's IAM denial for the scope it lists [15].
- CAI refuses a token that carries only `cloud-platform.read-only`; it needs `cloudasset` or `cloud-platform`
  [14].

## Decision

### 1. Which project pays

| Call | Mode | `x-goog-user-project` | Consumer (observed) |
|---|---|---|---|
| CAI `assets.list` (stream, preflight probe) | user | **always**, the preflight's quota project | the user's quota project (rows b, q2) |
| CAI `assets.list` | SA | **never** | the account's own project, which is the instance's project (rows s1, s6) |
| Resource Manager `get`, `search` (scope picker, preflight, gate step 1) | caller's token | **never** | the project of the instance's OAuth client, which is the instance's project (gcloud's client: row q1; the sign-in work was to confirm it with the instance's) |
| Resource Manager `get` with the account's token (gate step 2) | SA | **never** | the account's own project, by the same rule as rows s1 and s6 (row s3 got past the quota check to the IAM denial) |

In user mode, `quotaProject` is a required, schema-validated project id in every request body that leads to
a CAI call. The backend refuses such a request without it (400) and never falls back to sending no header:
that would charge every user's pulls to the instance's own project and share its rate quota among them.
Resource Manager calls stay without the header, so a user's quota project only needs the Cloud Asset API,
not the Resource Manager API as well.

### 2. Preflight order (user mode)

1. **Scope metadata.** `GET /v3/{scope}` with the caller's token. A 200 gives the display name for the
   breadcrumb. A 403 `IAM_PERMISSION_DENIED` is **not** a stop: `roles/cloudasset.viewer` does not include
   `resourcemanager.*.get`, so a user granted only that role (the command the Permissions page shows) cannot `get` the
   scope and can still list it. The preflight records a warning naming `metadata.permission`, shows ids where
   names would be, and goes on to step 2. Any other answer is handled by the table in step 2.
2. **Quota project.** Try the candidates in this order:
   - the scope itself, when it is a project;
   - the project the user picked (the SPA remembers the last pick per scope in its preferences).

   There are no other guesses, and the instance's project is never a candidate. For each candidate, the
   probe is `assets.list` on the scope with `pageSize: 1`, `contentType: RESOURCE` and the candidate in the
   header. The answer is matched on HTTP status and the `ErrorInfo` reason together:

   | Answer | Meaning | Next |
   |---|---|---|
   | 200 | quota project usable, scope listable | preflight passes |
   | 400 `USER_PROJECT_DENIED` | candidate does not exist or was deleted | next candidate |
   | 403 `USER_PROJECT_DENIED` | caller lacks `serviceusage.services.use` on it | next candidate |
   | 403 `SERVICE_DISABLED` | Cloud Asset API disabled in it | next candidate |
   | 403 `PERMISSION_DENIED` with no `ErrorInfo` | quota project fine; caller cannot list the scope (lacks `cloudasset.assets.listResource`, or the scope does not exist) | stop |
   | 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` | the token lacks the OAuth scope CAI needs (the sign-in row) | stop: sign in again |
   | 429, 5xx, timeout | transient | retry as skill §4, then "try again" |
   | **anything else**: another or an unknown reason (for example `SECURITY_POLICY_VIOLATED` from VPC Service Controls, an organisation-policy refusal), another 4xx, a non-JSON body | not understood | stop, fail closed: show the status, the reason and the upstream message |

3. **Nothing usable.** For each candidate, list which of the three conditions failed (exists,
   `serviceusage.services.use`, API enabled) with its command, and offer a project picker (from
   `projects:search`) for another candidate. If step 1 also failed, both are shown.

The backend classifies Google errors by HTTP status and `error.details[]` `ErrorInfo.reason`, never by
message text. A non-JSON body (a POST without the method override gets an HTML 404) becomes a generic error
with the status; HTML is never forwarded. A search that finds nothing answers `{}`; the scope picker treats a
missing `projects`, `folders` or `organizations` key as an empty list.

### 3. What the UI tells the user

| Case | Message (the substance; the Permissions page has the wording) | Command shown |
|---|---|---|
| quota project in use | "Requests use the quota of QP." (always visible on the Connect page's preflight panel) | — |
| `SERVICE_DISABLED` | "The Cloud Asset API is not enabled in QP. After enabling it, allow a few minutes." | `gcloud services enable cloudasset.googleapis.com --project=QP` |
| 403 `USER_PROJECT_DENIED` | "You may not use QP for API quota." | `gcloud projects add-iam-policy-binding QP --member="user:EMAIL" --role="roles/serviceusage.serviceUsageConsumer"` |
| 400 `USER_PROJECT_DENIED` | "QP does not exist or was deleted. Pick another project." | — |
| CAI 403, no reason | "You cannot list assets in SCOPE, or it does not exist." | the `roles/cloudasset.viewer` binding for the scope's kind (organisations, `resource-manager folders`, projects) |
| Resource Manager `IAM_PERMISSION_DENIED`, user mode (a warning) | "You cannot see SCOPE's details, so gcportrait shows ids instead of names." | the `roles/browser` binding for the scope's kind |
| `ACCESS_TOKEN_SCOPE_INSUFFICIENT` | "Sign in again and allow gcportrait to read Cloud Asset Inventory." | a sign-in button |
| 404 `NOT_FOUND` for a tick's `readTime` | "SCOPE did not exist on DATE." The tick is drawn as not yet existing, not as a failure. | — |
| anything else | "Google refused the request (STATUS REASON): MESSAGE" | — |

Upstream messages are passed on as skill §4 says. A CAI 403 without a reason reads differently for a project
id that does not exist (spike finding 5). That difference comes from Google's API, which any signed-in user
can call directly with their own token, so passing the message on adds nothing. In SA mode the account's
list call only runs after the gate, which a scope that does not exist never passes.

SA mode is explained on the Permissions page, with the account's email from `/api/config`:

> In service-account mode, gcportrait reads SCOPE as BACKEND_SA_EMAIL, a service account of this gcportrait
> instance (not a person's account), and the requests are charged to this instance's project. You must still
> be able to see SCOPE yourself, and anyone who can see SCOPE and sign in here can read its whole inventory
> through this account, including projects they cannot open themselves. Grant the account
> `roles/cloudasset.viewer` only, and prefer folders or projects to the whole organisation: in many
> organisations every member of the domain can see the organisation itself. If the account can read SCOPE's
> details itself, for example because they are public, service-account mode is refused for SCOPE.

Every surface places the non-affiliation statement as [ADR 0018](0018-non-affiliation-statement.md) says and says
"as of", never "live".

### 4. The service-account gate

(Amended on 2026-10-10: step 1 asks `testIamPermissions`, step 2 is optional and off by default, a pass is
remembered for up to five minutes. See "Amendment (2026-10-10)" below; where it differs from this section, the
amendment holds.)

Before every SA-mode CAI call, whether a stream or a preflight probe, the backend runs these steps in order.
Any other outcome refuses the request (403, with the step that failed) and the account's list call is not
made.

1. **Caller check.** `GET /v3/{scope}` with the caller's own token must answer 200.
2. **Exposure check.** `GET /v3/{scope}` with the account's token must answer exactly Resource Manager's IAM
   denial of that `get`:
   - HTTP 403 and `error.status` `PERMISSION_DENIED`;
   - exactly one `type.googleapis.com/google.rpc.ErrorInfo` in `error.details`, with `reason`
     `IAM_PERMISSION_DENIED` and `domain` `cloudresourcemanager.googleapis.com`;
   - `metadata.permission` equal to `resourcemanager.organizations.get`, `resourcemanager.folders.get` or
     `resourcemanager.projects.get`, matching the scope's kind.

   Everything else refuses. A 200 means the scope's `get` is public, or the account holds more than
   `roles/cloudasset.viewer` there; in either case step 1 no longer tells a member from anyone. A 403 for any
   other reason refuses too:
   - `SERVICE_DISABLED` or `USER_PROJECT_DENIED` in the instance's project;
   - `ACCESS_TOKEN_SCOPE_INSUFFICIENT`;
   - `SECURITY_POLICY_VIOLATED` from VPC Service Controls;
   - a 403 rate limit, a 403 with no `ErrorInfo`, or a body that is not JSON.

   These say nothing about the account's access to the scope. So do 404, 429, 5xx and a timeout. 429 and 5xx
   may be retried with the skill §4 backoff; if the last attempt is not the exact denial, the gate refuses.
3. **List.** `assets.list` with the account's token, without the quota header.

The scope is validated by the `@gcportrait/model` schema before step 1, and the same string is used in all
three calls. The gate cannot be configured away: `SA_MODE_ENABLED` switches SA mode off entirely, not the
gate. A pass may be memoised in memory for at most 60 s, keyed by the SHA-256 of the caller's token and the
scope; never across tokens, never on disk.

Observed with the real account (spike §5):

- `projects/gcportrait` opens the gate (gate1);
- `organizations/1` stops at step 1 (gate2);
- a project whose `get` is public stops at step 2 (gate3);
- a project the account has no role on opens the gate, and CAI then refuses the list (gate4).

The account's denial names `resourcemanager.projects.get` for a project and `resourcemanager.folders.get` for
a folder (rows s3, s7, s11). Step 2 was also run against 16 synthetic answers through a curl test double;
only the exact denial, one of the 16, opened it.

### 5. Stream details taken from the spike (the live pull)

- Every 200 carries `readTime`, which the `done` frame passes on. The latest tick sends no `readTime` (a
  future one is a 400). The oldest tick, today − 34 days at 00:00Z, stays inside the 35-day bound.
- A page without an `assets` key is an empty page.
- A 404 `NOT_FOUND` for a `readTime` becomes an `error` frame with `status: 404, code: "NOT_FOUND"`, which the
  timeline shows as "did not exist yet".
- `assetTypes` errors are surfaced verbatim. An invalid pattern and an unknown type read the same.
- `pageSize` stays 500, although the API allows 1000, so that a page stays well under the 25 MiB cap.

### 6. OAuth scopes (sign-in)

The token client requests `https://www.googleapis.com/auth/cloud-platform.read-only` **and**
`https://www.googleapis.com/auth/cloudasset`. The sign-in row (spike §6) observed, with narrowed tokens of the
service account:

- `cloud-platform.read-only` alone: CAI answers 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT`, Resource Manager
  accepts it;
- `cloudasset` alone: the reverse;
- both together: both APIs work.

Scope checks are on the token, not the identity, so user tokens are expected to behave the same; the
sign-in work was to confirm it with the instance's own client.

Sign-in also requests `https://www.googleapis.com/auth/userinfo.email`, a non-sensitive scope, so that Google's
tokeninfo names the account the app's account menu shows; a grant without it still works, without the
address. A grant without both Cloud scopes (granular consent lets a person leave one out) is revoked at once
and the person is asked to sign in again and allow both (frontend/README.md, "Sign-in").

`cloudasset` is not a read-only scope by its description. Google's discovery document describes it as "See,
edit, configure, and delete your Google Cloud Asset data", and that is roughly what the consent screen will
show. What a token can do stays bounded by the user's own IAM roles, and gcportrait only calls `assets.list`
with it. The Connect page says this before sign-in. For an OAuth verification, should an operator need one (the
maintainer hosts no sign-in instance, [ADR 0035](0035-decisions-inherited-from-the-implementation-plan.md) §2):

- the consent screen and the verification request name and justify both scopes;
- whether Google classes `cloudasset` as sensitive or restricted was not checked here, and it is checked
  when the consent screen is configured;
- self-hosters add both scopes to their own client ([docs/self-host.md](../self-host.md)).

This amends the single scope named in ADR 0004. The amendment takes effect when this ADR is
accepted.

## Amendment (2026-10-10)

Accepted with these changes to section 4, made when service-account mode was built
(`backend/src/auth/gate.ts`, `backend/src/auth/identity.ts`; the user guide is
[docs/permissions.md](../permissions.md)). Sections 1 to 3, 5 and 6 stand as written.

1. **Step 1 asks for the permission, not for the document.** The caller check is Resource Manager v3
   `testIamPermissions` on the scope, with the caller's own token and without a quota header, asking for
   `resourcemanager.organizations.get`, `resourcemanager.folders.get` or `resourcemanager.projects.get` as the
   scope's kind says. The gate passes only when the returned `permissions` contain exactly that permission. A
   200 without it is a denial: measured on 2026-10-10, Google answers `{}` for an organisation the caller may
   not see and for a project id that does not exist, and the permission for a project the caller may see.
   Every other answer refuses (fail closed): 401, the OAuth-scope refusal, 404, a 403 of any other reason, a
   body that is not JSON, and 429, 5xx or no answer after the retries. A `GET` of the scope that answers 200
   is no longer the test. A permission granted publicly still counts as the caller's (spike finding 7:
   `testIamPermissions` returned the public `get` of `OTHER_PROJECT`), so step 1 alone does not tell a member
   from anyone for a scope whose `get` is public. That is what step 2 is for.
2. **Step 2, the exposure check, is optional: `SA_MODE_STRICT_EXPOSURE=true`, off by default.** When on, it is
   section 4's step 2 unchanged (the account's own `GET` must be exactly Resource Manager's IAM denial of that
   `get`). It is off by default because it refuses service-account mode on every scope where a customer
   granted the account more than `roles/cloudasset.viewer` (Viewer, say), which then looks exposed. With it
   off, a scope whose `get` is public passes step 1 for every signed-in user, and if the account was granted
   `roles/cloudasset.viewer` there, anyone who can sign in to the instance can read that scope's inventory.
   The Permissions page (from `saStrictExposure` in `/api/config`) and docs/permissions.md say so, and tell
   customers to grant the account only on scopes whose details are not public; operators who cannot rule that
   out turn the strict check on.
3. **Order.** Step 1, with tokeninfo next to it (for the audit line and the memo's lifetime); then the
   account's token; then step 2 when strict; then the CAI call. Nothing is asked as the account, and no
   account token is requested, before step 1 passes.
4. **Memo: at most five minutes** (section 4 said 60 s): in memory, keyed by the SHA-256 of the caller's token
   and the scope, never past the caller's token's own expiry (tokeninfo's `expires_in`), never a refusal, at
   most 10 000 passes (the oldest go first). The permission check (`/api/preflight`) always checks afresh and
   stores its pass for the pull that follows. A token revoked, or a grant removed, inside those five minutes
   can still pass through the memo until it runs out.
5. **One gate for every route that takes `mode: "sa"`** (`/api/preflight` and `/api/assets/stream`), before
   every CAI call as the account, each page of a stream included. Its refusals are 403 (denied, exposed, an
   answer not understood, the OAuth scope missing), 401 (Google did not accept the caller's token) or 503 (no
   answer in time, or the account's token unavailable), with a `code`; the permission check's 403 and 503
   carry its checklist as `preflight`, so a refused check is never a 200. Routes that take no mode refuse a
   `mode` field (400).
6. **Audit.** Every decision writes one log line, `service-account gate`: the route, the scope, the SHA-256 of
   the caller's lower-cased email (null when the token carries none), allowed or denied with the step and the
   finding, whether the memo answered, and whether strict mode is on. Never the token, never the email. This
   is the one log line that names a scope, on purpose.
7. **The account's identity** is Application Default Credentials, read without a client library: the metadata
   server on Cloud Run; locally an `impersonated_service_account` file (from `gcloud auth application-default
   login --impersonate-service-account`) or a key file. A person's own credentials (`authorized_user`) are
   refused. It is resolved at start-up, which stops with a message when it fails; `/api/config` publishes its
   email, and a `BACKEND_SA_EMAIL` that names another account stops start-up. The quota project is unchanged
   (section 1): no header, the account's own project pays.

Observed on 2026-10-10, through the backend's own routes, against the spike's project and account (which holds
only `roles/cloudasset.viewer` there) with the maintainer's token: the permission check and the pull of that
project passed the gate and listed it as the account without a quota header; `organizations/1` and a project
id that does not exist were refused with 403 `SA_GATE_CALLER_DENIED`, and nothing was asked as the account;
with the strict check on, the account's `get` came back as the exact denial and the project passed. No token
or email reached a log line.

## Consequences

- **Observed, apart from two points left to sign-in:** the instance's own OAuth client paying for header-less
  Resource Manager calls, and the scope behaviour of user tokens from that client. Any later run of the
  script that differs from spike §3, §5 or §6 reopens this ADR.
- **Sign-in:**
  - request both scopes, with the consent-screen note of section 6;
  - verify the two points above with the instance's client.
- **The preflight and the Permissions page:**
  - the preflight order of section 2, including step 1 as a warning and the fail-closed default row;
  - the Permissions page texts of section 3, including the SA-mode warning;
  - unit tests per row of the section 2 table, with recorded bodies shaped like spike §4.
- **The live pull:** a required `quotaProject` in user mode; the stream rules of section 5.
- **Service-account mode** (done, as amended above; its tests also cover the memo, token-hash isolation, the routes and an e2e
  run): the three-step gate of section 4, with tests that:
  - fail step 1 (403, 404, 5xx, timeout);
  - fail step 2 with a 200 (a public `get`);
  - fail step 2 with every answer that is not the exact denial: the 15 refusing synthetic cases of spike §5,
    plus a 404;
  - open the gate on the exact denial, for an organisation, a folder and a project.

  In every failing test, no CAI call may be made.
- **The deployment scripts:**
  - `deploy.sh` enables `cloudasset.googleapis.com` and `cloudresourcemanager.googleapis.com` in the
    instance's project;
  - it creates the backend account there with **no** project roles: not `serviceUsageConsumer`, and nothing
    that includes `resourcemanager.*.get`;
  - the self-host guide tells customers to grant `roles/cloudasset.viewer` only, and to prefer folders or
    projects to the organisation (next point).
- **Organisation scope is wide open to the customer's own domain.** Step 1 at `organizations/ID` passes for
  every user who can `get` the organisation. Google grants `roles/resourcemanager.projectCreator`, which
  includes `resourcemanager.organizations.get`, to the whole domain by default when an organisation is
  created. With the account granted at the organisation, any such user who can sign in to the instance can
  read the whole inventory, including projects they cannot open. This follows from the caller check that ADR 0004
  designed, not from the exposure check. The SA-mode text in section 3 and the self-host guide say so. A stricter rule for
  organisations is an open question for the maintainer ([docs/backlog.md](../backlog.md)).
- **Follow-up:** the corrections listed in spike §8, made once this ADR was accepted: the `cai-ingestion` skill
  (§1 search is a GET; `pageSize` up to 1000; §3, §5 and §6), and the exposure check, the scopes and step 1 as
  a warning wherever the design was written down.
- **Cost:** SA mode costs two extra Resource Manager GETs per CAI request, or fewer with the memo.
- **Spike leftovers in `gcportrait`:** the backend account keeps `roles/cloudasset.viewer` on the project for
  the service-account and deployment work. The maintainer's `roles/iam.serviceAccountTokenCreator` on it can be removed when no longer
  needed (spike §7).

## Alternatives considered

- **No quota header in user mode** (the instance's project pays). Rejected:
  - one rate quota shared by every user of the hosted instance;
  - costs and abuse land on the operator;
  - the instance's client-project attribution is not yet verified.
- **Quota header in SA mode, set to the account's project.** It works without an extra role (row s2), but
  only while the configured value equals the account's own project. Any other value needs
  `roles/serviceusage.serviceUsageConsumer` there (row s9), and without the header the same project pays
  anyway (rows s1, s6). Rejected as a setting that can only go wrong.
- **Gate by the caller's `get` alone**, as ADR 0004 first described it. Rejected: a public `get` opens it to
  everyone (rows g5, s4, gate3).
- **Exposure check passing on any 403**, as round 1 of this spike drafted it. Rejected: a 403 that has
  nothing to do with the account's access opened the gate in a test double.
- **Gate by a stronger caller permission** (`getIamPolicy`, or a CAI permission). Rejected:
  - `getIamPolicy` is in `roles/browser` too, and may be just as public;
  - requiring a CAI permission makes SA mode pointless.
- **OAuth scope `cloud-platform`** instead of `cloud-platform.read-only` plus `cloudasset`. Rejected: it
  grants read-write access to every Google Cloud API the user can reach, far beyond what gcportrait calls.
