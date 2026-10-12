<!-- SPDX-License-Identifier: MIT -->

# The quota-project spike: user tokens, the quota project and the service-account gate

A spike of 2026-10-10, run before the backend's Google-facing routes were built. This page records which calls
were made against Cloud Asset Inventory (CAI) and Resource Manager, and what came back. The decisions taken from it are
in [ADR 0028](../adr/0028-quota-project-and-sa-gate.md).
[scripts/spike-quota-project.sh](../../scripts/spike-quota-project.sh) re-runs the matrix with any token.

| | |
|---|---|
| Run on | 2026-10-10: user-token rows 05:38–05:52 UTC; the whole matrix again, the service-account rows and the sign-in row 06:17–06:30 UTC |
| Project | `gcportrait` (billing linked; the Cloud Asset and Resource Manager APIs were **disabled** for the first calls and enabled at 05:41 UTC) |
| Caller | the maintainer's user account, token from `gcloud auth print-access-token` (Google Cloud SDK 587.0.0); its OAuth client is the gcloud CLI's own |
| Service account | `BACKEND_SA_EMAIL`, the account `gcportrait-backend` in `gcportrait`, holding only `roles/cloudasset.viewer` on `gcportrait`; tokens minted by impersonation (section 5) |
| Tools | curl 8.7.1, jq 1.7.1, `/bin/bash` 3.2 (macOS) |
| API surface | CAI v1 discovery revision 20260926, Resource Manager v3 revision 20260917 |

Nothing here names a real organisation, another project's number or any asset. Rows that needed a project
other than `gcportrait` use placeholders: `OTHER_PROJECT` is an existing public project owned by someone else
(read-only calls, all refused or public metadata); `OLD_PROJECT` is a project of the maintainer's that is
older than 35 days and on which the service account has no role. The script prints `PROJECT_NUMBER` for
`gcportrait`'s number and `<nLEN>` (the length only) for any other number.

## 1. Findings in brief

1. **The quota project is the consumer project, and the API must be enabled there, not in the scanned
   project.** With the Cloud Asset API disabled in `gcportrait`, listing `projects/gcportrait` without a
   quota header returned 200. With `x-goog-user-project: gcportrait` it returned 403 `SERVICE_DISABLED`.
2. **Without `x-goog-user-project`, the consumer is the project that owns the token's OAuth client.** The
   "no such asset type" error names the consumer project's number. Without the header, a gcloud user token's
   consumer is an 11-digit number that is not `gcportrait`'s: the gcloud CLI's own project (row q1). With the
   header, it is `gcportrait`'s number (rows q2, f1). A service account's token without the header is
   charged to the account's own project (row s6). In production, a user token without the header would
   charge the project that holds the instance's OAuth client.
3. **Every quota-project failure carries an `ErrorInfo` reason**, and the three conditions the preflight names can
   be told apart by status and reason (section 3): the project does not exist (400 `USER_PROJECT_DENIED`);
   no `serviceusage.services.use` (403 `USER_PROJECT_DENIED`); the API is disabled (403 `SERVICE_DISABLED`).
   Service-account tokens get the same answers (rows s9, s10).
4. **Order of the checks:** the token's OAuth scopes first (the sign-in row's call b: `ACCESS_TOKEN_SCOPE_INSUFFICIENT` even
   with a good quota project), then the quota project, then the scope's IAM (row c4: with a bad quota project
   and a forbidden scope, the answer is the quota error).
5. **A scope the caller cannot list returns 403, never an empty list.** CAI's own denial is
   `PERMISSION_DENIED` with no `ErrorInfo` reason, for an organisation that is not the caller's, a project
   that does not exist, a project the caller can `get` but not list, and the service account's scopes
   without a role (rows d1–d3, s5, s8). This confirms skill §6. **The message text differs, though:** a
   project that does not exist reads "The caller does not have permission" (d2), while an existing project
   and the organisation read "Request denied by Cloud IAM. …" (d1, d3). Passed on verbatim, the message
   tells whether a project id exists. The leak is small, because project ids are global and an id that is
   taken is visible in other ways (creating a project with it fails), but it is there.
6. **Resource Manager `get` refusals carry `IAM_PERMISSION_DENIED` and the missing permission**, and there a
   project that does not exist answers exactly like a forbidden one ("or it may not exist").
7. **A project's `resourcemanager.projects.get` can be public, for service accounts too.** The caller could
   `get` `OTHER_PROJECT`, a project it has no role on (row g5), and so could the service account (row s4);
   `testIamPermissions` showed exactly that one permission was granted publicly. A gate that only checks "the
   caller can `get` the scope" is open to every signed-in user for such a scope. ADR 0028 adds a second check.
8. **`readTime`:**
   - a time in the future is 400 `INVALID_ARGUMENT` with a generic message;
   - more than 35 days back is 400 with the earliest allowed time in the message;
   - **a time before the scope existed is 404 `NOT_FOUND`** ("Requested entity was not found."), even inside
     the window: `gcportrait` was created at 18:50:31 UTC on 2026-10-08, 18:50:00 gave 404 and 18:52:00 gave
     200;
   - an older project answers 200 at now − 35 days + 10 minutes.
9. **`assetTypes`:**
   - a pattern that matches no supported type is 400 `INVALID_ARGUMENT`, with a message naming the consumer
     project's number;
   - an invalid RE2 pattern gives the same message, so the two cannot be told apart;
   - a supported type with no assets in the scope is 200 with `{"readTime": …}` and no `assets` key.
10. **`pageSize` goes up to 1000**, not 500; 1001 is 400 with the bounds in the message. A `pageToken` in the
    POST body continues the listing.
11. **A POST without `X-HTTP-Method-Override: GET` is a 404 with an HTML body**, not JSON.
12. **Every 200 from `assets.list` carries `readTime`**; an empty page has no `assets` key at all.
13. **No response header is useful.** Successes and errors alike carried only `content-type`, `vary`,
    `date`, `server`, `alt-svc` and the usual security headers: no `retry-after`, no `x-goog-*`. Everything
    the backend needs is in the JSON body.
14. **OAuth scopes (the sign-in row, observed):** a token with only
    `https://www.googleapis.com/auth/cloud-platform.read-only` is refused by CAI `assets.list` with 403
    `ACCESS_TOKEN_SCOPE_INSUFFICIENT`, while Resource Manager accepts it. A token with only
    `https://www.googleapis.com/auth/cloudasset` is the reverse. A token with both works for both APIs. The
    discovery document lists only `cloud-platform` and `cloudasset` for `assets.list`, and describes
    `cloudasset` as "See, edit, configure, and delete your Google Cloud Asset data": on a consent screen it
    reads as a read-write scope, although what a token can do stays bounded by the user's IAM roles.
15. **`roles/cloudasset.viewer` contains neither `resourcemanager.*.get` nor `serviceusage.services.use`**
    (`gcloud iam roles describe roles/cloudasset.viewer`). With the account's token, `testIamPermissions` on
    `gcportrait` returned only `cloudasset.assets.listResource`, and the account cannot `get` the project it
    lists (row s3).
16. **A token may name its own project as the quota project without `serviceusage.services.use`.** The
    service account listed `gcportrait` with `x-goog-user-project: gcportrait` and got 200 (row s2), although
    it holds no `serviceusage.services.use` there. Round 1 had predicted 403 here; the prediction was wrong.
    Any other project is checked: `OLD_PROJECT`, where the account has no role, gave 403
    `USER_PROJECT_DENIED` (row s9).
17. **The gate of ADR 0028 §4 behaves as designed with a real service account** (rows gate1–gate4): it
    opens for `gcportrait`; it stays closed at step 1 for a scope the caller cannot `get`, and at step 2 for a
    project whose `get` is public. For `OLD_PROJECT` it opens, and CAI then refuses the list because the
    account holds no role there: the gate decides who may ask, the customer's grant decides what can be read.
    The account cannot `get` a project it has no role on unless that `get` is public (rows s7, s4).
18. **A search that finds nothing answers `{}`**, with no `projects` key (the sign-in row's call h2, the service account's
    narrowed token, which sees no project).

## 2. How the calls were made

The token stays in a shell variable. `printf` is a shell builtin, so the header reaches curl on standard
input (`-H @-`), and the token never appears in a process list, a file or a log. Response bodies were only
looked at as summaries (counts, status, reason); no asset payload is reproduced here.

```sh
TOKEN="$(gcloud auth print-access-token)"

# assets.list (skill §1): POST with the method override and a JSON body.
{
  printf 'Authorization: Bearer %s\n' "$TOKEN"
  printf 'x-goog-user-project: %s\n' QUOTA_PROJECT   # leave this line out for row a
  printf 'X-HTTP-Method-Override: GET\n'
} | curl -sS -X POST -H @- -H 'Content-Type: application/json' \
      --data-raw '{"contentType":"RESOURCE","pageSize":5}' \
      https://cloudasset.googleapis.com/v1/SCOPE/assets

# Resource Manager v3 get (preflight and gate) and search (scope picker): GET, no body.
printf 'Authorization: Bearer %s\n' "$TOKEN" | curl -sS -H @- \
  https://cloudresourcemanager.googleapis.com/v3/SCOPE
printf 'Authorization: Bearer %s\n' "$TOKEN" | curl -sS -H @- \
  'https://cloudresourcemanager.googleapis.com/v3/projects:search?pageSize=500'

# Which permissions a caller holds on a project (rows g5 and s3).
printf 'Authorization: Bearer %s\n' "$TOKEN" | curl -sS -X POST -H @- -H 'Content-Type: application/json' \
  --data-raw '{"permissions":["resourcemanager.projects.get","resourcemanager.projects.getIamPolicy",
    "cloudasset.assets.listResource","serviceusage.services.use"]}' \
  https://cloudresourcemanager.googleapis.com/v3/projects/OTHER_PROJECT:testIamPermissions

unset TOKEN
```

`SCOPE` is `organizations/ID`, `folders/ID` or `projects/ID_OR_NUMBER`. The body of each row is the one
above plus the members named in the table. The script sends exactly these requests. The 06:17 UTC run was:

```sh
{
  gcloud auth print-access-token
  gcloud auth print-access-token --impersonate-service-account=BACKEND_SA_EMAIL
} | scripts/spike-quota-project.sh --project PROJECT_ID --other-project OTHER_PROJECT \
      --old-project OLD_PROJECT --read-time 2026-10-08T18:50:00Z --sa
```

Without `--sa` the script reads one token and runs the user rows only. `--disabled-quota-project` adds row
c2 for a project where the API is still disabled, `--only` picks rows by id prefix, and `--json` prints one
object per row. `--help` lists every option.

## 3. The matrix (user token)

`QP` is the quota project sent in `x-goog-user-project`: `gcportrait` unless the row says otherwise. HTTP 4xx
rows show the error `status` and, where present, the `ErrorInfo` `reason`. The 06:17 UTC run repeated every
row of the "After" table with the same HTTP status, error status and reason.

### Before the APIs were enabled (05:40 UTC)

| Row | Call | HTTP | Status / reason | Observed |
|---|---|---|---|---|
| a′ | list `projects/gcportrait`, no header | 200 | — | 5 assets, `nextPageToken`, `readTime`. The scanned project's API state does not matter. |
| c2 | list `projects/gcportrait`, QP `gcportrait` (API disabled there) | 403 | `PERMISSION_DENIED` / `SERVICE_DISABLED` | "Cloud Asset API has not been used in project gcportrait before or it is disabled. Enable it by visiting … then retry. If you enabled this API recently, wait a few minutes …". `metadata`: `consumer: projects/gcportrait`, `service: cloudasset.googleapis.com`, `serviceTitle`, `activationUrl`, `containerInfo`. Also `LocalizedMessage` and `Help` details. |
| g2′ | Resource Manager get `projects/gcportrait`, QP `gcportrait` (API disabled there) | 403 | `PERMISSION_DENIED` / `SERVICE_DISABLED` | Same shape, `service: cloudresourcemanager.googleapis.com`. |
| g1′ | get `projects/gcportrait`, no header | 200 | — | `name`, `projectId`, `state`, `parent`, … |
| h1′ | `projects:search`, no header | 200 | — | every project the account can see, one page |
| c1′ | list, QP `gcportrait-s1-nonexistent-q` | 400 | `INVALID_ARGUMENT` / `USER_PROJECT_DENIED` | "Project 'projects/gcportrait-s1-nonexistent-q' not found or deleted." |

`gcloud services enable cloudasset.googleapis.com cloudresourcemanager.googleapis.com --project gcportrait`
finished in 5 seconds. The next call, about five minutes later, already succeeded with the header.

### After (05:46–05:52 UTC, repeated 06:17 UTC)

| Row | Call | HTTP | Status / reason | Observed |
|---|---|---|---|---|
| t1 | tokeninfo (caller token) | 200 | — | scopes include `cloud-platform` (plus openid, email, `appengine.admin`, `compute`, `sqlservice.login`, `accounts.reauth`) |
| a | list `projects/gcportrait`, **no header** | 200 | — | 5 assets, 4 types, `nextPageToken`, `readTime` |
| o1 | POST without `X-HTTP-Method-Override` | 404 | (HTML) | 1 586-byte HTML error page |
| b | list `projects/gcportrait`, QP `gcportrait` | 200 | — | same as a |
| c1 | list, QP `gcportrait-s1-missing` (does not exist) | 400 | `INVALID_ARGUMENT` / `USER_PROJECT_DENIED` | "Project 'projects/gcportrait-s1-missing' not found or deleted." `consumer` names it. |
| c3 | list, QP `OTHER_PROJECT` (exists, caller lacks `serviceusage.services.use`) | 403 | `PERMISSION_DENIED` / `USER_PROJECT_DENIED` | "Caller does not have required permission to use project OTHER_PROJECT. Grant the caller the roles/serviceusage.serviceUsageConsumer role, or a custom role with the serviceusage.services.use permission, by visiting … and then retry. Propagation of the new permission may take a few minutes." |
| c4 | list `organizations/1`, QP `gcportrait-s1-missing` | 400 | `INVALID_ARGUMENT` / `USER_PROJECT_DENIED` | the quota error wins over the scope's IAM check |
| q1 | f1 without the header (06:17 only) | 400 | `INVALID_ARGUMENT` / none | the message names consumer `<n11>`: not `gcportrait`, the gcloud CLI's project |
| q2 | f1 with QP `gcportrait` (06:17 only) | 400 | `INVALID_ARGUMENT` / none | the message names consumer `PROJECT_NUMBER` |
| d1 | list `organizations/1` | 403 | `PERMISSION_DENIED` / none | "Request denied by Cloud IAM. Missing required IAM permission on requested scope. For required permissions, please refer to https://cloud.google.com/asset-inventory/docs/roles-permissions." |
| d2 | list `projects/gcportrait-s1-missing` (does not exist) | 403 | `PERMISSION_DENIED` / none | "The caller does not have permission": a different message from d1 and d3 (finding 5) |
| d3 | list `projects/OTHER_PROJECT` (caller can `get` it, row g5) | 403 | `PERMISSION_DENIED` / none | as d1: the skill §6 case, a 403 on the first page and not an empty list |
| e1 | `readTime` now − 1 day | 200 | — | assets as of then |
| e2 | `readTime` now − 35 days + 10 min (before `gcportrait` existed) | 404 | `NOT_FOUND` / none | "Requested entity was not found." |
| e3 | `readTime` now − 36 days | 400 | `INVALID_ARGUMENT` / none | "Requested time must be later than UTC time 2026-09-05T05:51:27+00:00" (now − 35 days) |
| e4 | `readTime` now + 1 hour | 400 | `INVALID_ARGUMENT` / none | "Request contains an invalid argument." |
| e5 | `OLD_PROJECT`, `readTime` now − 35 days + 10 min | 200 | — | assets as of then |
| e6 | `OLD_PROJECT`, `readTime` now − 34 days | 200 | — | assets as of then |
| e7 | `readTime` 2026-10-08T18:50:00Z, and 00:00:00Z (before creation at 18:50:31) | 404 | `NOT_FOUND` / none | as e2; 18:52:00Z, 19:00:00Z and 2026-10-09T00:00:00Z gave 200 |
| f1 | `assetTypes: ["nonexistent.googleapis.com/Nothing"]` | 400 | `INVALID_ARGUMENT` / none | "No RESOURCE found that matches asset type nonexistent.googleapis.com/Nothing for consumer project: \<n\>. For a list of supported content types and asset types, see …" |
| f2 | `assetTypes: ["compute.googleapis.com/Instance"]` (none in the project) | 200 | — | `{"readTime": "…"}`: no `assets` key, no `nextPageToken` |
| f3 | `assetTypes: ["compute.googleapis.com/("]` (invalid RE2) | 400 | `INVALID_ARGUMENT` / none | same message as f1 |
| p1 | `pageSize: 500` | 200 | — | all 28 assets, no `nextPageToken` |
| p2 | `pageSize: 1000` | 200 | — | as p1 |
| p3 | `pageSize: 1001` | 400 | `INVALID_ARGUMENT` / none | "The specified page_size 1001 in request is out of boundary for ListAssets API: [1, 1000]." |
| p4 | `pageSize: 1`, then the `nextPageToken` as `pageToken` in the body | 200 | — | the second page |
| g1 | get `projects/gcportrait`, no header | 200 | — | the project |
| g2 | get `projects/gcportrait`, QP `gcportrait` | 200 | — | the project |
| g3 | get `organizations/1` | 403 | `PERMISSION_DENIED` / `IAM_PERMISSION_DENIED` | "Permission 'resourcemanager.organizations.get' denied on resource '//cloudresourcemanager.googleapis.com/organizations/1' (or it may not exist). …"; `metadata.permission` names it; `domain: cloudresourcemanager.googleapis.com` |
| g4 | get `projects/gcportrait-s1-missing` | 403 | `PERMISSION_DENIED` / `IAM_PERMISSION_DENIED` | as g3 with `resourcemanager.projects.get` |
| g5 | get `projects/OTHER_PROJECT` (no role on it) | 200 | — | the project. `testIamPermissions` with four permissions returned only `resourcemanager.projects.get`: it is granted publicly. |
| h1 | `projects:search` | 200 | — | every visible project in one page of 500 |
| h2 | `projects:search?query=id:gcportrait` | 200 | — | 1 project |
| h3 | `folders:search` | 200 | — | the visible folders |
| h4 | `organizations:search` | 200 | — | the one organisation |

## 4. Error bodies the backend will classify

All JSON errors share one envelope:
`{"error": {"code", "message", "status", "details": [...]}}`. Each entry in `details` has an `@type`.
`type.googleapis.com/google.rpc.ErrorInfo` carries `reason`, `domain` and `metadata`. A
`SERVICE_DISABLED` or `USER_PROJECT_DENIED` answer also has `google.rpc.LocalizedMessage` and
`google.rpc.Help` (a console link). Shortened:

```json
{"error": {"code": 403, "status": "PERMISSION_DENIED",
  "message": "Cloud Asset API has not been used in project QP before or it is disabled. …",
  "details": [{"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "SERVICE_DISABLED",
    "domain": "googleapis.com",
    "metadata": {"consumer": "projects/QP", "service": "cloudasset.googleapis.com",
      "activationUrl": "https://console.developers.google.com/apis/api/…/overview?project=QP"}}]}}
{"error": {"code": 403, "status": "PERMISSION_DENIED",
  "message": "Caller does not have required permission to use project QP. …",
  "details": [{"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "USER_PROJECT_DENIED",
    "domain": "googleapis.com",
    "metadata": {"consumer": "projects/QP", "service": "cloudasset.googleapis.com"}}]}}
{"error": {"code": 403, "status": "PERMISSION_DENIED",
  "message": "Request denied by Cloud IAM. Missing required IAM permission on requested scope. …"}}
{"error": {"code": 403, "status": "PERMISSION_DENIED",
  "message": "Permission 'resourcemanager.projects.get' denied on resource
    '//cloudresourcemanager.googleapis.com/projects/ID' (or it may not exist). …",
  "details": [{"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "IAM_PERMISSION_DENIED",
    "domain": "cloudresourcemanager.googleapis.com",
    "metadata": {"permission": "resourcemanager.projects.get"}}]}}
{"error": {"code": 403, "status": "PERMISSION_DENIED",
  "message": "Request had insufficient authentication scopes.",
  "details": [{"@type": "type.googleapis.com/google.rpc.ErrorInfo",
    "reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "domain": "googleapis.com",
    "metadata": {"method": "google.cloud.asset.v1.AssetService.ListAssets",
      "service": "cloudasset.googleapis.com"}}]}}
```

The permission message and the activation link are wrapped or shortened here; the backend never parses
either.

## 5. Service-account rows

The account and its grants in `gcportrait`:

```sh
# Round 1 (05:42 UTC, by the spike): the account, with no roles.
gcloud iam service-accounts create gcportrait-backend --project=PROJECT_ID \
  --display-name="gcportrait backend"
# Made by the maintainer's account at 06:09 UTC, before the 06:17 run. The first is what a customer does
# for service-account mode; the second only lets a person mint the account's token for this spike.
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:BACKEND_SA_EMAIL" --role="roles/cloudasset.viewer" --condition=None
gcloud iam service-accounts add-iam-policy-binding BACKEND_SA_EMAIL --project=PROJECT_ID \
  --member="user:CALLER_EMAIL" --role="roles/iam.serviceAccountTokenCreator"
```

The run is the command in section 2 (with `--sa`). Rows with an entry under "Predicted" were planned in
round 1; the others were added in round 2.

| Row | Call (service-account token; QP as in section 3) | Predicted | Observed |
|---|---|---|---|
| t2 | tokeninfo | — | 200; the scopes gcloud asks for (`cloud-platform`, `compute`, …), lifetime 1 hour |
| s1 | list `projects/PROJECT_ID`, no header | 200 | 200, 5 assets |
| s2 | list `projects/PROJECT_ID`, QP `PROJECT_ID` | 403 `USER_PROJECT_DENIED` | **200**, 5 assets: finding 16 |
| s3 | get `projects/PROJECT_ID` | 403 `IAM_PERMISSION_DENIED` | 403 `IAM_PERMISSION_DENIED`, `permission: resourcemanager.projects.get` |
| s4 | get `projects/OTHER_PROJECT` | 200 | 200: a public `get` includes every service account |
| s5 | list `organizations/1` | 403 | 403, no reason, "Request denied by Cloud IAM. …" |
| gate1 | caller get → SA get → SA list, `projects/PROJECT_ID` | 200 → 403 → 200 | 200 → 403 `IAM_PERMISSION_DENIED` (`resourcemanager.projects.get`) → 200, 5 assets: the gate opens |
| gate2 | caller get `organizations/1` | 403, the account is never called | 403 `IAM_PERMISSION_DENIED`; refused at step 1, the account is not called |
| gate3 | caller get → SA get, `projects/OTHER_PROJECT` | 200 → 200, list refused | 200 → 200; refused at step 2, the list is not called |
| s6 | list `projects/PROJECT_ID`, `assetTypes` matching nothing, no header | — | 400; the message names consumer `PROJECT_NUMBER`: the account's own project pays |
| s7 | get `projects/OLD_PROJECT` (no role there, `get` not public) | — | 403 `IAM_PERMISSION_DENIED`, `permission: resourcemanager.projects.get` |
| s8 | list `projects/OLD_PROJECT` | — | 403, no reason, "Request denied by Cloud IAM. …" |
| s9 | list `projects/PROJECT_ID`, QP `OLD_PROJECT` | — | 403 `USER_PROJECT_DENIED`, `consumer: projects/OLD_PROJECT` |
| s10 | list `projects/PROJECT_ID`, QP `PROJECT_ID-s1-missing` | — | 400 `USER_PROJECT_DENIED` |
| s11 | get the first folder the caller can see (06:30 UTC) | — | 403 `IAM_PERMISSION_DENIED`, `permission: resourcemanager.folders.get`: the folder form of s3, which gate step 2 relies on |
| gate4 | caller get → SA get → SA list, `projects/OLD_PROJECT` | — | 200 → 403 `IAM_PERMISSION_DENIED` → 403, no reason: the gate opens, CAI refuses because nobody granted the account a role there |

`testIamPermissions` with the account's token: on `gcportrait`, of `serviceusage.services.use`,
`serviceusage.services.get`, `cloudasset.assets.listResource` and `resourcemanager.projects.get`, only
`cloudasset.assets.listResource`; on `OLD_PROJECT`, none.

**Step 2 against answers the real APIs did not give.** Round 1's script let step 2 pass on any 403. The
script now passes it only on one `ErrorInfo` with reason `IAM_PERMISSION_DENIED`, domain
`cloudresourcemanager.googleapis.com` and `metadata.permission` equal to `resourcemanager.<kind>.get`, with
`error.status` `PERMISSION_DENIED`. A curl test double on `PATH` answered the account's `get` in 16 ways.
Only the exact IAM denial opened the gate, and exactly one CAI call was made over all 16 runs. Every one of
these answers kept it closed:

- 200 (public);
- 403 with reason `SERVICE_DISABLED`, `USER_PROJECT_DENIED`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT`,
  `SECURITY_POLICY_VIOLATED` or `RATE_LIMIT_EXCEEDED`;
- 403 with no `ErrorInfo`;
- 403 with an HTML body;
- `IAM_PERMISSION_DENIED` naming `resourcemanager.folders.get` for a project;
- `IAM_PERMISSION_DENIED` from another domain;
- two `ErrorInfo` entries;
- a status other than `PERMISSION_DENIED`;
- 429, 500, or a transport error.

No token appeared in curl's arguments in any of those runs.

## 6. The sign-in row: is a `cloud-platform.read-only` token enough for CAI?

The gcloud user token cannot be narrowed, so the account's token was, through the IAM Credentials API:

```sh
gcloud auth print-access-token | {
  IFS= read -r T
  printf 'Authorization: Bearer %s\n' "$T" | curl -sS -X POST -H @- -H 'Content-Type: application/json' \
    --data-raw '{"scope":["https://www.googleapis.com/auth/cloud-platform.read-only"],"lifetime":"600s"}' \
    https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/BACKEND_SA_EMAIL:generateAccessToken |
    jq -r .accessToken
} | scripts/spike-quota-project.sh --project PROJECT_ID --only t1,a,b,g1,h2
```

and again with the scope list `[…/cloud-platform.read-only, …/cloudasset]` and `[…/cloudasset]`:

| Scopes in the token (t1) | a: CAI list, no QP | b: CAI list, QP `PROJECT_ID` | g1: Resource Manager get | h2: projects:search |
|---|---|---|---|---|
| `cloud-platform.read-only` | 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` | 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` | 403 `IAM_PERMISSION_DENIED` (scope accepted; the account has no `get`) | 200 `{}` |
| `cloud-platform.read-only` + `cloudasset` | 200, 5 assets | 200, 5 assets | 403 `IAM_PERMISSION_DENIED` | 200 `{}` |
| `cloudasset` | 200, 5 assets | 200, 5 assets | 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` | 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` |

The check is on the token, not on the identity, so a user token with the same scopes is expected to behave
the same; the sign-in work was to confirm it with the instance's own OAuth client.

**Sign-in (2026-10-10): not yet confirmed with a real sign-in.** The maintainer created the instance's OAuth web
client in `gcportrait` in the Cloud console (Google Auth Platform) at about 13:04 UTC; its id is in the
git-ignored `backend/.env` only. A real sign-in needs a person in Google's window. The agents that built sign-in
did not drive Google's window themselves: a headless-browser probe of the real client that would have entered no
credentials was refused by their permission system, and was not retried. The app requests both scopes, plus
`https://www.googleapis.com/auth/userinfo.email` for the account's address. What was observed instead, with
the built app served by the backend (its CSP and COOP as shipped) in headless Chromium and a placeholder
client id:

- Google's script loads under the CSP, and only after the press. Its only refusal is an inline style for
  Google's sign-in button, which the token client does not use.
- On "Sign in with Google" it opens `https://accounts.google.com/o/oauth2/v2/auth` with `response_type=token`,
  `prompt=select_account`, `include_granted_scopes=true`, `enable_granular_consent=true`,
  `redirect_uri=gis_transform` and
  `scope=https://www.googleapis.com/auth/cloud-platform.read-only https://www.googleapis.com/auth/cloudasset
  https://www.googleapis.com/auth/userinfo.email`.
- The request names the page's origin itself (`origin=http://127.0.0.1:PORT`) and carries no `Referer`
  header, so the backend's `Referrer-Policy: no-referrer` does not hide the origin Google checks against the
  client's authorised JavaScript origins.
- Google answers the placeholder client with `/signin/oauth/error`, a page that sends
  `Cross-Origin-Opener-Policy: same-origin`; GIS then reports the window as closed. The authorisation endpoint
  itself sends COOP only as `report-only`.

The same observations were made again on 2026-10-10 after the review of sign-in, with the same results.

The row stays open until the maintainer has signed in once with that client
([docs/self-host.md](../self-host.md), "OAuth client"). Then record here: the consent screen's wording for
each scope, whether Google's Data Access page lists `cloudasset` as sensitive or restricted, whether a user
token from the client with these scopes lists assets (rows a, b) and gets Resource Manager (rows g1, h2),
and, for ADR 0028 §1, which consumer a header-less Resource Manager call names (row q1 with the instance's
token). The check takes a few minutes:

1. Create the client as in docs/self-host.md, with `http://localhost:5173` among its authorised JavaScript
   origins and yourself as a test user. The client was created on 2026-10-10; its origins and test users,
   which the console shows, were not checked by the agents.
2. Put `OAUTH_CLIENT_ID=…` into `backend/.env` (done), run `pnpm dev` and open <http://localhost:5173>.
3. Press "Sign in with Google": note the consent screen's wording for each of the three scopes, and that the
   account menu then names your address (tokeninfo answered, and the token's audience is the client).
4. Type a few letters into the scope picker (row h2: the search answers), then pick `projects/PROJECT_ID`
   with `PROJECT_ID` as the quota project and run the permission check: its Resource Manager item answers row
   g1, its Cloud Asset probe row b. "Pull now" on the Connect page then lists the assets with the user's
   token. Row a (no quota header) and row q1 are not calls the app makes; they need the token outside the
   app, so leave them to `scripts/spike-quota-project.sh` if they are still wanted.
5. "Sign out" in the account menu: no "did not confirm" notice means Google accepted the revocation.

Expect one more thing if the tab stays open for most of an hour: GIS answers every token request through a
window of its own, and a browser blocks a window that no click opened, so the silent renewal five minutes
before the end will usually fail and the account menu offers "Stay signed in" (one click). That is the
designed fallback, not a fault.

## 7. Cloud changes

| When (UTC) | Change | By | In |
|---|---|---|---|
| 2026-10-10 05:41 | enabled `cloudasset.googleapis.com` and `cloudresourcemanager.googleapis.com` | the spike | `gcportrait` |
| 2026-10-10 05:42 | created the service account `gcportrait-backend` (display name "gcportrait backend"), with no roles | the spike | `gcportrait` |
| 2026-10-10 06:09 | granted `roles/cloudasset.viewer` on the project to the account (no condition) | the maintainer's account | `gcportrait` |
| 2026-10-10 06:09 | granted the maintainer `roles/iam.serviceAccountTokenCreator` on the account | the maintainer's account | `gcportrait` |
| 2026-10-10 about 13:04 | created the instance's OAuth client (Web application) in Google Auth Platform, for the sign-in row and sign-in | the maintainer, in the console | `gcportrait` |

The 06:17 run changed nothing. It minted short-lived tokens for the account: 1 hour by gcloud, 10 minutes
through the IAM Credentials API. They were held in shell pipes only. Every other call was a read. When the
service-account work no longer needs to mint the account's token, the second grant can go:

```sh
gcloud iam service-accounts remove-iam-policy-binding BACKEND_SA_EMAIL --project=PROJECT_ID \
  --member="user:CALLER_EMAIL" --role="roles/iam.serviceAccountTokenCreator"
```

## 8. What this means for the rest of the repository

- [ADR 0028](../adr/0028-quota-project-and-sa-gate.md) decides:
  - when the backend sends the quota header;
  - the preflight order and its messages;
  - the gate, with its strict exposure check;
  - the OAuth scopes.

  It adds the "service account must not be able to `get` the scope" check to the gate of ADR 0004.
- **Skill `cai-ingestion` corrections, for its owner:**
  - §1 "Scope search" is a GET with query parameters (`query`, `pageSize`, `pageToken`), not a POST, and an
    empty result is `{}`;
  - §1 `pageSize` goes up to 1000 (500 stays the backend's choice);
  - §3: the check order (OAuth scope, quota project, scope IAM) and the reasons are as in section 3 above;
    a token's own project needs no `serviceusage.services.use`; the gate gains the exposure check;
  - §5/§6: a tick before the scope existed answers 404 `NOT_FOUND`, and a future `readTime` is 400;
  - §6: `assetTypes` regex errors and "no such type" read the same.
- **ADR 0004 names `cloud-platform.read-only` as the app's only OAuth scope**; the sign-in row shows CAI
  refuses it, so the app also needs `cloudasset` (ADR 0028 §6).
