---
name: cai-ingestion
description: Facts and rules for getting data into gcportrait from Google Cloud Asset Inventory — list and export APIs, limits, asset JSON shape, roles and permissions, quota project, timeline readTime math, retries, gotchas — plus the realism rules for synthetic demo data and the official documentation links.
---
<!-- SPDX-License-Identifier: MIT -->

# Cloud Asset Inventory ingestion

The rules this handbook applies are in [AGENTS.md](../../../AGENTS.md) ("Security and privacy", "Data and
graph semantics" and "Product rules") and [backend/AGENTS.md](../../../backend/AGENTS.md) ("Hardening",
"Quota project and the permission check" and "The service-account gate"); this file holds the facts about
Google's APIs and the procedures built on them.

Load this for any work in `backend/` routes that call Google APIs, in `packages/ingest`, in
`packages/demo-data`, on the permissions preflight, or on the timeline. The links to Google's documentation
are in §8, and what the APIs answer in practice is in §9. The backend's Google API routes are
`/api/scopes/search` and `/api/preflight` (the scope picker and the permission check), `/api/assets/stream`
and `/api/export/read` (the live pull and the export read; the frames and caps of §4, backend/README.md "Live
pull and export read"); service-account mode and its gate live in `backend/src/auth/` (backend/README.md
"Service-account mode", docs/permissions.md). `packages/ingest` reads both NDJSON spellings described below
into the `Asset` and `Snapshot` schemas of `@gcportrait/model`, and `packages/demo-data` (with a generator
case per catalog group) writes either spelling; their READMEs are the reference.

## 1. The APIs we use

| Call | Method and path | Why |
|---|---|---|
| List assets | `POST https://cloudasset.googleapis.com/v1/{scope}/assets` with header `X-HTTP-Method-Override: GET` and a JSON body (`GET` with query params hits URL-length limits) | live pull, timeline ticks |
| Export assets | `POST https://cloudasset.googleapis.com/v1/{scope}:exportAssets` → long-running operation; `GET .../v1/{operation.name}` to poll | user-run exports we can read; we do not start exports from the hosted backend in v1 |
| Asset history | `GET https://cloudasset.googleapis.com/v1/{scope}:batchGetAssetsHistory` | not used for the timeline (≤ 100 names per call); candidate for a per-asset "history" drawer tab later |
| Scope search | `GET https://cloudresourcemanager.googleapis.com/v3/{organizations,folders,projects}:search` with query parameters (`query`, `pageSize`, `pageToken`); a search that finds nothing answers `{}` | scope picker |
| Scope get | `GET https://cloudresourcemanager.googleapis.com/v3/{organizations,folders,projects}/{id}` | preflight; the SA-mode gate's optional exposure check (the account's own `get`) |
| Test permissions | `POST https://cloudresourcemanager.googleapis.com/v3/{organizations,folders,projects}/{id}:testIamPermissions` with `{"permissions":[…]}` (no permission needed to call it; a scope the caller may not see, or that does not exist, answers `{}`) | the SA-mode gate's caller check |
| GCS object read | `GET https://storage.googleapis.com/storage/v1/b/{bucket}/o/{object}?alt=media` | reading an export the user points at |

Scope formats: `organizations/123`, `folders/456`, `projects/my-id` or `projects/789`.

### List assets parameters and limits
- `contentType`: we always use `RESOURCE`. Others: `IAM_POLICY`, `ORG_POLICY`, `ACCESS_POLICY`,
  `OS_INVENTORY`, `RELATIONSHIP` (needs Security Command Center Premium/Enterprise). Omitting it returns only
  names, times and ancestry.
- `readTime`: RFC 3339, optional, **no more than 35 days in the past**; omitted = now.
- `assetTypes[]`: RE2 patterns (`compute.googleapis.com/.*`); a pattern matching nothing → `INVALID_ARGUMENT`.
  Omitted = all types.
- `pageSize` up to 1000 (the backend asks for 500, so a page stays well under its 25 MiB cap);
  `pageToken` from `nextPageToken`.
- Listing is synchronous and can hit quota on very large inventories; the export path is the fallback.

### Export facts
- Output is newline-delimited JSON, one asset per line, with the same fields as list results but the protobuf
  spelling of the envelope keys: `asset_type`, `update_time`, `resource.discovery_document_uri` and
  `resource.discovery_name` (snake_case), where `assets.list` returns `assetType`, `updateTime`,
  `resource.discoveryDocumentUri` and `resource.discoveryName` (camelCase). `name`, `ancestors`,
  `resource.version`, `resource.parent`, `resource.location` and `resource.data` are spelled the same in both,
  and `data` is the resource's own API JSON either way. `@gcportrait/ingest` accepts both spellings, also
  mixed in one input, and rejects a line whose two spellings of one field disagree.
- `outputConfig.gcsDestination.uri` (one object) or `uriPrefix` (one subfolder per asset type; the subfolders
  must not pre-exist). Temporary files may appear during the export.
- A new export to the same destination is rejected while a previous one runs or within 15 minutes.
- Buckets with CMEK or a retention policy are not supported as destinations.
- `readTime` is in the operation metadata, not in the file. Users who want a timeline tick from an export
  should save the operation JSON next to it; otherwise gcportrait uses the max `updateTime` and says so.

## 2. Asset JSON shape (RESOURCE content type)

```json
{
  "name": "//compute.googleapis.com/projects/demo-net/regions/europe-west3/subnetworks/app",
  "assetType": "compute.googleapis.com/Subnetwork",
  "resource": {
    "version": "v1",
    "discoveryDocumentUri": "https://www.googleapis.com/discovery/v1/apis/compute/v1/rest",
    "discoveryName": "Subnetwork",
    "parent": "//cloudresourcemanager.googleapis.com/projects/10000000001",
    "data": { "name": "app", "network": "https://www.googleapis.com/compute/v1/projects/demo-net/global/networks/core", "ipCidrRange": "10.10.0.0/20", "region": "https://www.googleapis.com/compute/v1/projects/demo-net/regions/europe-west3" },
    "location": "europe-west3"
  },
  "ancestors": ["projects/10000000001", "folders/20000000001", "organizations/30000000001"],
  "updateTime": "2026-10-07T18:22:41.123456Z"
}
```

- This is the `assets.list` (camelCase) spelling; an export file writes the same asset with snake_case
  envelope keys (see "Export facts" above).
- `ancestors` starts with the closest ancestor and ends at the root.
- `resource.parent` is the immediate parent in the IAM hierarchy (a project for most assets; a cluster for k8s
  objects; the org for org-level assets).
- `resource.data` is the API resource with some sensitive fields removed; never assume a field is present.
- Project **numbers** appear in `parent`/`ancestors`; project **ids** appear in Compute self-links and many
  `name` paths. Resolve via `cloudresourcemanager.googleapis.com/Project` assets (`data.projectId`,
  `data.projectNumber` / `name`).

## 3. Permissions

| Need | Permission | Typical role | Where |
|---|---|---|---|
| list resources | `cloudasset.assets.listResource` (granular `cloudasset.assets.list*` can restrict types) | `roles/cloudasset.viewer` | on the scope (org/folder/project) |
| export resources | `cloudasset.assets.exportResource` | `roles/cloudasset.viewer` | on the scope |
| any CAI call | `serviceusage.services.use` | `roles/serviceusage.serviceUsageConsumer` | on the **quota project** |
| scope picker / gate | `resourcemanager.{organizations,folders,projects}.get` and `.list`/`search` | `roles/browser` or `roles/viewer` | on the scope |
| read an export | `storage.objects.get` | `roles/storage.objectViewer` | on the bucket |

Quota project: user-credential calls to CAI need a project where the caller holds `serviceusage.services.use`
and where `cloudasset.googleapis.com` is enabled. We send `x-goog-user-project: <quota project>`. Preflight
order: the scanned project (project scope) → the user's chosen project → error with the three conditions
listed. Service-account mode sends no quota header: the account's own project pays (backend/AGENTS.md,
"Quota project and the permission check"), which deploy.sh makes the instance's project.

Service-account mode gate: the backend checks the caller before every CAI call it makes as the account. Its
steps, its memo and its audit line are the rules of backend/AGENTS.md, "The service-account
gate"; §9 has the answers of Google's APIs they rest on.

`gcloud` snippets shown by the permissions page (fill from preflight results):

```sh
gcloud organizations add-iam-policy-binding ORG_ID --member="user:EMAIL" --role="roles/cloudasset.viewer"
gcloud services enable cloudasset.googleapis.com --project=QUOTA_PROJECT
gcloud projects add-iam-policy-binding QUOTA_PROJECT --member="user:EMAIL" --role="roles/serviceusage.serviceUsageConsumer"
gcloud organizations add-iam-policy-binding ORG_ID --member="serviceAccount:BACKEND_SA" --role="roles/cloudasset.viewer"
gcloud asset export --organization=ORG_ID --content-type=resource --output-path=gs://BUCKET/export.json
```

## 4. Backend behaviour

- Tokens follow AGENTS.md, "Security and privacy", "Tokens"; the host allowlist and logs follow
  backend/AGENTS.md, "Hardening" (`LOGGED_HEADERS` in `backend/src/logging.ts`).
- Retries: 429 and 5xx → exponential backoff with jitter (base 500 ms, ×2, max 8 s, 5 attempts). 400/403/404
  are surfaced to the UI with the upstream message (they are actionable).
- Streaming: emit NDJSON frames `{"t":"page","assets":[...]}`, `{"t":"progress","pages":n,"assets":m}`,
  `{"t":"done","assets":m,"readTime":"..."}`, `{"t":"error",...}`. The browser parses frame by frame. The
  error frame carries `message` (Google's, verbatim), `status` (Google's HTTP status), `code` (Google's
  canonical status), `reason` (the `ErrorInfo` reason, when there is one) and `retryable`; an export read
  (`/api/export/read`) streams the export's own lines and uses only the error frame.
- Caps: 60 s upstream timeout per page, 25 MiB per page, 4 concurrent streams per token hash, and a
  process-wide budget of 64 MiB of page bytes held at once (`backend/src/stream/page-budget.ts`), each page
  counted until its frame is written out to the client; a client that does not take each 1 MiB piece within
  60 s (it stopped, or reads more slowly than about 17 KiB/s) is disconnected
  (`backend/src/stream/ndjson.ts`). A page is never parsed: `backend/src/stream/list-page.ts` scans its bytes
  into the `page` frame outside the JavaScript heap (docs/security.md, "Response caps and memory").

## 5. Timeline math

- Ticks: `today@00:00Z` and the 34 previous days. A tick's `readTime` is `YYYY-MM-DDT00:00:00Z`; the latest
  tick uses "now" so it is never in the future. Label ticks in the viewer's local date.
- Cache: read days live in IndexedDB, in the `tickCache` store, keyed `(scope, readTime, contentType,
  assetTypes?)`. Never reuse a cache entry across scopes.
- Diff between ticks A→B: added = names in B not in A; removed = names in A not in B; changed = same name,
  different `updateTime`. Pure function, no API calls.
- Do not prefetch all 35 ticks: read a tick when the view rests on it, then its two neighbours at idle, at
  most two reads in flight; cancel the read of a day the view moved away from (no longer the day or a
  neighbour). Read nothing while the page stays on the snapshot's own day.
- A tick whose `readTime` lies before the scope existed answers 404 `NOT_FOUND` ("Requested entity was not
  found."), even inside the 35-day window: the timeline draws it as "did not exist yet", not as a failure. A
  future `readTime` is 400 `INVALID_ARGUMENT`, which is why the latest tick sends none.
- Extra ticks: every stored export or manual pull of the same scope is an extra tick on the timeline, placed
  at its read time; its id (the ViewSpec's `tick`) is that read time to the second in UTC,
  `YYYY-MM-DDTHH:MM:SSZ`, so it never collides with a day. A read time later than "now" is shown at "now",
  never in the future.

## 6. Gotchas

- `compute.googleapis.com/Address|BackendService|Disk|ForwardingRule` in list/export are regional/zonal only;
  global variants are separate types.
- Kubernetes object types exist only for GKE clusters; their `name` contains the cluster path.
- Several products synchronise CAI every ~7 hours (Cloud SQL, Secret Manager, Dataflow, Logging, Vertex AI,
  Workflows, NGFW, OS Config, …); IAM data can be up to 7 days stale. Say "as of" on screen, never "live".
- `location` may be missing (API keys, App Engine).
- Deleted assets are simply absent from a later snapshot; there is no tombstone in RESOURCE content.
- Pages are not sorted; never rely on order for diffs.
- A scope the caller can `get` but cannot list CAI for returns 403 on the first page, not an empty list.

## 7. Synthetic demo data rules (`packages/demo-data`)

- Deterministic from a seed; sizes S(≈80) M(≈600) L(≈6 000) XL(≈50 000) assets as targets (with the default
  seed counts in docs/modes.md §4, checked against fixtures/stats.json; M carries the catalog groups'
  generator cases, see the demo-data README); 35 days of history as per-day mutation lists on top of the base.
- Realistic topology: 2–3 folder levels; a shared-VPC host with 3+ service projects; two peered VPCs; one HA
  VPN + one Interconnect attachment; an external HTTPS LB chain (forwarding rule → proxy → URL map → backend
  services → NEGs/instance groups → MIG instances with `created-by`); an internal LB; GKE cluster with
  namespaces, deployments, services, ingress; Cloud Run services with a VPC connector and Cloud SQL via
  private services access; Pub/Sub + Eventarc + Functions; BigQuery datasets with external tables on buckets;
  KMS keys used by disks/buckets/SQL; service accounts used by everything; a perimeter around two projects;
  one empty project; one project with only hidden-tier assets.
- Names: one org per demo size (S `30000000001`, M `…02`, L `…03`, XL `…04`), folders `2000000000x`,
  projects `demo-<role>-<n>` with numbers `1000000000x`,
  emails `*@example.com`, domains `*.example.org`, IPs from `10.0.0.0/8`, `172.16.0.0/12`, `203.0.113.0/24`.
- Every asset must validate against the `Asset` schema and against its catalog fixture shape (same fields).

## 8. References

Google's documentation (check a page again before relying on a limit it states):

- Supported asset types: <https://docs.cloud.google.com/asset-inventory/docs/supported-asset-types>
- List assets (REST, `readTime` ≤ 35 days back, RE2 `assetTypes`):
  <https://docs.cloud.google.com/asset-inventory/docs/list-assets>
- Export to Cloud Storage (`uri` or `uriPrefix`, a 15-minute lockout on the same destination):
  <https://docs.cloud.google.com/asset-inventory/docs/export-cloud-storage>
- The `exportAssets` method:
  <https://docs.cloud.google.com/asset-inventory/docs/reference/rest/v1/TopLevel/exportAssets>
- `batchGetAssetsHistory` (≤ 100 names, 35 days):
  <https://docs.cloud.google.com/asset-inventory/docs/reference/rest/v1/TopLevel/batchGetAssetsHistory>
- The Asset resource (`name`, `assetType`, `resource.{parent,data,location}`, `ancestors`, `updateTime`):
  <https://docs.cloud.google.com/asset-inventory/docs/reference/rest/v1/Asset>
- Roles and permissions (`roles/cloudasset.viewer`, `cloudasset.assets.listResource`,
  `serviceusage.services.use`): <https://docs.cloud.google.com/asset-inventory/docs/roles-permissions>
- Content types and the 35-day history: <https://docs.cloud.google.com/asset-inventory/docs/overview>
- The official icons (core products, categories, the older symbols): <https://cloud.google.com/icons>
- Architecture Center (reference diagrams, a style reference only, never a data source):
  <https://docs.cloud.google.com/architecture>
- WCAG 2.2: <https://www.w3.org/TR/WCAG22/>

## 9. What Google's APIs answer

Observed with a user token and with a service account that holds only `roles/cloudasset.viewer`; the backend's
classification (backend/AGENTS.md, "Quota project and the permission check") and its tests'
recorded answers (`backend/src/upstream/google.testing.ts`, `backend/src/preflight/google.testing.ts`) rest on
these. Check them again with real calls before changing what the backend relies on: `gcloud auth
print-access-token | scripts/probe-google-apis.sh --project YOUR_PROJECT` runs the call matrix with the tokens
you pipe in (`--sa` adds the service account's rows; `--help` lists the rest).

**The quota project.**

- The consumer of a CAI call is the project in `x-goog-user-project`. Without the header it is the project
  that owns the token's OAuth client: for a gcloud user token the gcloud CLI's own project, for a service
  account's token the account's own project, and so, for a user token the app holds, the project of the
  instance's OAuth client (to be confirmed with a real sign-in; docs/backlog.md).
- The Cloud Asset API must be enabled in the consumer project, not in the scanned one.
- A token may name its own project as the quota project without `serviceusage.services.use`; any other project
  is checked.
- Google checks the token's OAuth scopes first, then the quota project, then the scope's IAM: with a bad quota
  project and a forbidden scope, the answer is the quota error.

**Errors.** Every JSON error shares one envelope, `{"error": {"code", "message", "status", "details":
[...]}}`; `type.googleapis.com/google.rpc.ErrorInfo` carries `reason`, `domain` and `metadata`. Classify by
status and reason, never by message text:

| Answer | Meaning |
|---|---|
| 400 `INVALID_ARGUMENT` / `USER_PROJECT_DENIED` | the quota project does not exist or was deleted |
| 403 `PERMISSION_DENIED` / `USER_PROJECT_DENIED` | the caller lacks `serviceusage.services.use` on the quota project |
| 403 `PERMISSION_DENIED` / `SERVICE_DISABLED` | the Cloud Asset API is disabled in the quota project (`metadata.activationUrl` links the console) |
| 403 `PERMISSION_DENIED`, no `ErrorInfo` | CAI: the caller cannot list the scope, or it does not exist; never an empty list |
| 403 `PERMISSION_DENIED` / `IAM_PERMISSION_DENIED`, domain `cloudresourcemanager.googleapis.com` | Resource Manager: `metadata.permission` names the `get` that was denied; a scope that does not exist answers the same ("or it may not exist") |
| 403 `PERMISSION_DENIED` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT` | the token lacks the OAuth scope the API needs |
| 404 `NOT_FOUND` | a `readTime` before the scope existed |
| 400 `INVALID_ARGUMENT`, no reason | a future `readTime`; one more than 35 days back (the message names the earliest allowed time); a `pageSize` above 1000; an `assetTypes` pattern that matches no supported type, or an invalid RE2 pattern (the two read the same) |
| 404 with an HTML body | a POST to `assets.list` without `X-HTTP-Method-Override: GET`: never forward it |

CAI's own denial reads differently for a project id that does not exist ("The caller does not have
permission") and for one that exists ("Request denied by Cloud IAM. …"), so a message passed on verbatim tells
whether an id exists; the id is visible in other ways too (creating a project with it fails). No response
header is useful: neither successes nor errors carry `retry-after` or `x-goog-*`; everything is in the JSON
body.

**Listing.**

- Every 200 from `assets.list` carries `readTime`; a page without an `assets` key is an empty page, and a
  supported type with no assets in the scope answers `{"readTime": …}` alone.
- `pageSize` goes up to 1000; a `pageToken` in the POST body continues the listing.

**Permissions and roles.**

- `roles/cloudasset.viewer` holds neither `resourcemanager.*.get` nor `serviceusage.services.use`: an account
  with only that role lists a scope it cannot `get` (Resource Manager answers the IAM denial).
- `resourcemanager.projects.get` can be granted publicly, and then every signed-in user and every service
  account has it; `testIamPermissions` returns such a public permission as the caller's. This is why the
  service-account gate has its optional exposure check.
- `testIamPermissions` needs no permission to call; a scope the caller may not see, or one that does not
  exist, answers `{}`.

**OAuth scopes.** CAI `assets.list` refuses a token with only `cloud-platform.read-only` (403
`ACCESS_TOKEN_SCOPE_INSUFFICIENT`) while Resource Manager accepts it; a token with only `cloudasset` is the
reverse; a token with both works for both APIs. The check is on the token's scopes, not the identity. Google's
discovery document describes `cloudasset` as "See, edit, configure, and delete your Google Cloud Asset data",
and the consent screen reads that way, although what a token can do stays bounded by the person's IAM roles
and gcportrait only lists assets with it.

**The service-account gate, against real answers.** With an account that holds only `roles/cloudasset.viewer`
on a project, the account's own `get` of that project is exactly Resource Manager's IAM denial naming
`resourcemanager.projects.get` (`resourcemanager.folders.get` for a folder), so the strict exposure check
passes it; on a project whose `get` is public the account's `get` answers 200 and the strict check refuses. On
a project where nobody granted the account a role, the caller's check can pass and CAI then refuses the list:
the gate decides who may ask, the customer's grant decides what can be read.
