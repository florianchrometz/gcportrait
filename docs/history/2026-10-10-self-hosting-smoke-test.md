<!-- SPDX-License-Identifier: MIT -->

# Self-hosting smoke test, 2026-10-10

A record of the build, written on 2026-10-10 and not kept up to date since (on 2026-10-12 the build's
task and phase ids gave way to plain names and dates); what is still open is in
[../backlog.md](../backlog.md). It is the review of reading a real Google Cloud scope once the quota-project spike,
Google sign-in, the scope picker and permission check, the live pull and export read, service-account mode and the
deploy scripts were built: the commands with their real output, a smoke test of the backend's Google-facing routes
against the maintainer's deployed instance with a real token and a real scope, the same project checked, pulled,
drawn and exported as PNG through a local production build, the deploy timing, what then existed in the Google
Cloud project `gcportrait`, and the open items of those features' reports, deduplicated. It is candid on purpose:
**the review is not passed.** The four commands are green and the real-scope path works end to end, but two
features are not accepted (Google sign-in: no real sign-in yet; the deploy scripts: no timed deploy from scratch,
and the image publishing that the distribution decision replaced, ADR 0035), and the review agent's permission
system refused the timed deploy run (section 4).

| | |
|---|---|
| Date | 2026-10-10, 16:01 to 16:20 UTC |
| Tree | `main` at `cc430eb` plus the uncommitted self-hosting work (sign-in to the deploy scripts) |
| Deployed instance | the Cloud Run service `gcportrait` in the project `gcportrait` (europe-west3), deployed by the deploy scripts' run B: its only revision `gcportrait-00001-skp`, image `gcportrait-builds/gcportrait:20261010-144040-86aad6c-dirty` (commit `86aad6c` with that afternoon's uncommitted work); public; service-account mode on (strict exposure off) as `gcportrait-backend@gcportrait.iam.gserviceaccount.com`; the maintainer's OAuth client and `HOSTED_BY` set |
| Caller | the maintainer's own Google account: an access token from `gcloud auth print-access-token` (Google Cloud SDK 587.0.0, whose OAuth client is the gcloud CLI's own), piped into curl's standard input; never in an argument, a file, a log or this page |
| Tools | curl, jq, bash 3.2 (macOS); headless Chromium through Playwright 1.64 for section 3 |
| Data | the inventory of the project `gcportrait` only (42 assets of 9 types at the time). Nothing of it is reproduced here: the transcript shows statuses, counts and outcomes |
| Reviewer | the review agent |

## 1. Commands and their results

| Command | Result |
|---|---|
| `pnpm check` | **green** in 2 min 33 s: `format:check` clean; `lint` and `typecheck` clean; `test` 248 files, **6 753 tests** passed (after the walkthrough fixes: 6 029); `catalog:check` OK (632 of 641 official types, 1 387 rules, 0 without a fixture, 265 types without a console template); `provenance` OK (2 145 files, 1 090 SPDX headers); `licenses` OK (365 packages, `THIRD_PARTY.md` current) |
| `pnpm build` | **green** in 4.5 s: the backend bundle `dist/server.mjs` 2 705 kB with 64 npm packages inlined (their licences in `dist/licenses/`); the SPA in 0.4 s, Vite warning as before that `index-*.js` is over 500 kB minified (620 kB) |
| `pnpm size` | **green**: UI thread 208.46 of 350 kB gzipped (59.6 %; after the walkthrough fixes: 184.6), workers 188.24 of 400 kB (47.1 %; after the fixes: 184.9) |
| `pnpm e2e` | **green**: **174 passed** in 3.0 min (after the walkthrough fixes: 144), first run, no retries: 139 in demo mode (`chromium`) and 35 in normal mode (`chromium-live`: `live`, `signin`, `preflight`, `live-pull`, `sa-mode`) |
| `pnpm provenance`, `pnpm format:check` (again, after this review's documents) | OK: 2 147 files, 1 091 SPDX headers; formatting clean |

One interruption. At 16:04 UTC, after a clean `--dry-run` (section 4), the real `infra/deploy.sh --project
gcportrait --region europe-west3 --service gcportrait-fresh --build` was refused by the permission system as a
"Production Deploy", as it was twice while the deploy scripts were built. For some minutes after that every
shell command of the review agent was refused with the same reason, read-only ones included (`gcloud builds list`, `gcloud run revisions list`, a
listing of `frontend/dist`, `date`); nothing was worked around. Once commands ran again, `pnpm build`, `pnpm
size`, `pnpm e2e` and section 3 ran; the deploy was not tried again. During the review another session's `pnpm
dev` held the ports 5173 and 8080 (started 14:48 UTC): the `chromium-live` specs reused its Vite server, as the
Playwright configuration does locally, and section 3 used a port of its own.

## 2. The deployed instance, with a real token and a real scope

`gcloud auth print-access-token | smoke-api.sh https://gcportrait-HASH-ey.a.run.app`, a script kept outside the
repository that reads the token from standard input and passes it to curl as `-H @-` (section 8). 16:03:43 to
16:03:53 UTC. The transcript, with the client id, the project number and the address's hash replaced:

```text
== GET /api/config
200 2.252656s
{"oauthClientId":"CLIENT_ID","saMode":true,"saStrictExposure":false,"backendServiceAccount":"gcportrait-backend@
gcportrait.iam.gserviceaccount.com","version":"86aad6c-dirty","sourceUrl":"https://github.com/florianchrometz/gc
portrait","hostedBy":"Hosted by Florian Chrometz. Not affiliated with Google. An independent open-source side pr
oject.","demo":false}
== GET /
HTTP/2 200
content-security-policy: default-src 'self';base-uri 'self';script-src 'self' 'sha256-…' https://accounts.google
.com/gsi/client;script-src-attr 'none';style-src 'self';img-src 'self' data:;font-src 'self';connect-src 'se…
cross-origin-opener-policy: same-origin-allow-popups
referrer-policy: no-referrer
strict-transport-security: max-age=31536000; includeSubDomains
x-frame-options: DENY
content-type: text/html; charset=utf-8
== GET /healthz (from outside)
404
== POST /api/scopes/search {query: gcportrait}
200 0.946329s
{"kinds":{"project":1},"matches":[{"kind":"project","scope":"projects/gcportrait","displayName":"gcportrait"}],
"problems":[],"nextPageToken":false}
== POST /api/preflight user projects/gcportrait qp gcportrait
200 1.424961s
{"outcome":"ready","quotaProject":"gcportrait","items":[{"id":"scope-details","status":"ok","finding":"ok"},{"id"
:"quota-project","status":"ok","finding":"ok"},{"id":"cai-access","status":"ok","finding":"ok"}],"candidates":[{
"project":"gcportrait","source":"scope","result":"usable"}]}
== POST /api/preflight user projects/gcportrait, no quota project
200 1.095205s
{"outcome":"ready", … the same items …, "candidates":[{"project":"gcportrait","source":"scope","result":"usable"}]}
== POST /api/preflight sa projects/gcportrait
200 0.544844s
{"outcome":"ready","items":[{"id":"sa-caller","status":"ok","finding":"ok"},{"id":"sa-access","status":"ok","find
ing":"ok"}]}
== POST /api/preflight sa organizations/1 (gate must refuse)
403 1.042421s
{"statusCode":403,"code":"SA_GATE_CALLER_DENIED","outcome":"blocked","items":[{"id":"sa-caller","status":"missing
","finding":"denied"},{"id":"sa-access","status":"unknown","finding":"not-checked"}]}
== POST /api/assets/stream user projects/gcportrait
200 0.393742s
{"frames":{"done":1,"page":1,"progress":2},"assets":42,"distinctTypes":9,"done":{"assets":42,"readTimeSet":true},
"error":null}
== POST /api/assets/stream sa projects/gcportrait
200 0.408872s
{"frames":{"done":1,"page":1,"progress":2},"assets":42,"distinctTypes":9,"done":{"assets":42,"readTimeSet":true},
"error":null}
== POST /api/assets/stream sa organizations/1 (gate must refuse)
403 0.513976s
{"statusCode":403,"code":"SA_GATE_CALLER_DENIED"}
== POST /api/assets/stream without a token
401
{"statusCode":401,"message":"Sign in first: this request needs your Google access token."}
```

What it shows:

- **Configuration and headers** as shipped: `/api/config` names the client, the account and the short non-affiliation line
  after "Hosted by"; the CSP's `script-src` allows `'self'`, the inline theme script's hash and Google's sign-in
  script and nothing else (the line is cut above), COOP is `same-origin-allow-popups`, HSTS, `DENY` framing and
  `no-referrer` are set. The first request took 2.3 s, the
  service having scaled to zero. `/healthz` from outside is Google's own 404, as documented (self-host.md,
  Troubleshooting).
- **Scope search** finds `projects/gcportrait` by its id with no problem listed.
- **Preflight, user mode, `projects/gcportrait`:** `ready`, with the scanned project itself as the usable quota
  project (ADR 0028 §2: the scope first), whether or not a quota project was picked.
- **Preflight, service-account mode:** `ready` for `projects/gcportrait` (the caller's `testIamPermissions`
  passed, then the account's own probe); for `organizations/1` the gate refuses at step 1 with 403
  `SA_GATE_CALLER_DENIED` and the account's item stays `not-checked`: nothing was asked as the account.
- **Live pull of `projects/gcportrait`:** one page, 42 assets of 9 types, a `done` frame with Google's
  `readTime`, in user mode (quota project `gcportrait`) and in service-account mode (no quota project) alike;
  the gate refuses `organizations/1` before the stream starts; no token, 401. The project held 28 assets at
  the live pull's check and 39 at service-account mode's; the growth fits what the deploy scripts created since (the service and its revision, the
  build account, repository, image and bucket; section 3 lists the types).
- The backend accepted a token issued to the gcloud CLI's client: it forwards tokens and does not compare their
  audience with its own client (the permission check's open question 5, section 7.3). The browser does compare, which is why
  section 3 answers tokeninfo itself.

Not covered by this section: the browser path (section 3), `/api/export/read` (the export read was tried on a real export through
a local backend; there is no export in the project now), and the strict exposure check (off on this instance;
service-account mode's own check verified it with a local backend).

## 3. Locally: preflight, pull, render, PNG export

The production build of section 1, served by the backend bundle as the image runs it (`node
--enable-source-maps backend/dist/server.mjs` on `127.0.0.1:8097`, so as not to disturb the other session's
`pnpm dev`; the instance's client id from the git-ignored `backend/.env`, service-account mode off, `HOSTED_BY`
set for the run), driven in headless Chromium at 1440 × 900 by a script kept outside the repository. Google's
sign-in window cannot be driven, so a stand-in for Google's sign-in script handed the app the maintainer's
gcloud token, which stayed in the driving process's memory and reached the page through a function the script
exposed; everything after the hand-over was real: the app's calls to this backend, and the backend's to Google.
16:15:21 to 16:15:25 UTC:

```text
   0.2s Permissions page
   0.3s signed in (stand-in for Google's window, real gcloud token)
   0.4s scope projects/gcportrait, quota project gcportrait
   1.7s permission check: ready
        Pull now: Reads gcportrait with your account; requests use the quota of gcportrait. The diagram
        shows the inventory as of the pull.
   1.9s Pull now pressed
   2.3s diagram route opened
   2.3s diagram drawn
        Light: Saved gcportrait_gcportrait_overview_20261010T161523Z.png (942 × 948 px).
        Dark: Saved gcportrait_gcportrait_overview_20261010T161523Z.png (942 × 948 px).
   2.8s PNG exported in both themes
        stored: gcportrait Project gcportrait 2026-10-10 16:15 UTC API pull live pull 42 4.1 kB …
        token in a URL: false; in the page: false; in storage: false; in the console: false
        other Google requests from the page (aborted): 0
        signed out; revoke calls answered by the stand-in: 1
        console errors and warnings: 0
   2.9s done
```

The backend's log of the run: 71 lines, none with the token (`ya29`), the email or the scope; both
`authorization` headers logged as `[redacted]`; one line per Google call (tokeninfo 200 in 109 ms, Resource
Manager `projects.get` 200 in 752 ms, Cloud Asset `assets.list` 200 in 487 ms) and `asset stream ended` (user
mode, 1 page, 42 assets, 0 retries, `done`, `finished`, 355 ms). The preflight answered in 1.25 s, the stream in
0.36 s. The local backend was stopped afterwards.

Looked at: the Permissions page with the checklist (`See the scope's details` ok, with the permission, the
member and the scope; the quota project and Cloud Asset items below it), the diagram on screen and both PNGs.
The overview lens draws the project `gcportrait` as a zone with two cards, the Cloud Run service `gcportrait`
(europe-west3) and the bucket `gcportrait-gcportrait-builds` (europe-west3 · standard), and a "1 hidden" chip;
"3 of 3 shown"; the legend lists Project and Resource. Both PNGs have the title block with the short non-affiliation line (later removed from exports, ADR 0018),
the theme's canvas as margin, and the icons drawn. Most of the 42 assets are enabled APIs (32 Service Usage
entries), service accounts, the build repository and its image, the revision and the billing link, which the
overview lens leaves out or hides by default; the snapshot holds all 42.
One observation for the export's owner: the title block prints the read time as an ISO timestamp with the
local offset (`read 2026-10-10T18:15:23+02:00`), not as a formatted date.

A warning for whoever repeats this with a gcloud token: the app sends every new token to Google's tokeninfo and
**revokes** one whose audience is not the instance's client (frontend/README.md, "Sign-in"). A gcloud token's
audience is the gcloud CLI's client, and revoking it also revokes the gcloud login behind it. The script
therefore answered tokeninfo inside the browser (with the instance's client as the audience and the
maintainer's address), let the stand-in answer `revoke`, and aborted any other request from the page to a Google
host (none was made).

Not covered: Google's real sign-in window and consent screen, which is Google sign-in's open acceptance ([the
quota-project spike's sign-in row](../spikes/quota-project.md#6-the-sign-in-row-is-a-cloud-platformread-only-token-enough-for-cai),
steps 3 to 5),
and the browser path on the deployed instance. The maintainer's walk with a real sign-in, which closes both:

1. `pnpm dev`, open <http://localhost:5173>, "Sign in with Google" with the maintainer's account; note the
   consent screen's wording for the three scopes.
2. Pick `projects/gcportrait` with the quota project `gcportrait`, "Check permissions" (expect "Ready"), then
   "Pull now" on the Connect page: about 42 assets, then the diagram opens.
3. Export › PNG at 2× in both themes; keep the PNGs out of the repository. Then "Sign out" in the account menu.
4. The same on the deployed instance's address, whose origin must be among the client's authorised JavaScript
   origins.

## 4. Deploy timing

| Run | What | Result |
|---|---|---|
| Review, `--dry-run` (16:04 UTC) | `infra/deploy.sh --project gcportrait --region europe-west3 --service gcportrait-fresh --build --dry-run` | **8.5 s**, nothing changed. All seven APIs already on; it would create the account `gcportrait-fresh-backend`, the repository `gcportrait-fresh-builds` with its clean-up policy, the bucket `gs://gcportrait-gcportrait-fresh-builds` (one Cloud Storage API request, label included), the build account `gcportrait-fresh-build` with its two grants, one Cloud Build run on `e2-highcpu-8`, and the service `gcportrait-fresh` (public, probes on `/healthz`) |
| Review, the real run (16:04 UTC) | the same without `--dry-run`, under `/usr/bin/time -p` | **refused** by the permission system ("Production Deploy") before it started; nothing created |
| Deploy scripts, run A (2026-10-10) | an earlier deploy.sh, from a project with billing and the Cloud Asset, Resource Manager and Storage APIs on | about one minute for the APIs, the accounts, the repository and the bucket, then stopped at the build (a missing bucket grant, since fixed) |
| Deploy scripts, run B (2026-10-10) | an earlier deploy.sh, with that grant in place | **2 min 43 s** to "deployed", 33 s of it a check of `/healthz` from outside that deploy.sh no longer makes |
| Google's record of the live revision (run B's: the same image version, settings and timeline) | read in the review (`gcloud run services describe`) | image tag `20261010-144040` (the UTC time deploy.sh's build step began) to the revision's Ready at 14:42:34 UTC: **1 min 54 s** from build to a ready revision |
| The self-hosting fixes: the orchestrator's timed run (16:39:15 UTC) | `infra/deploy.sh --project gcportrait --region europe-west3 --service gcportrait-fresh --build --oauth-client-id CLIENT_ID --source-url …`, a `curl` of `/api/config`, then `infra/uninstall.sh … --service gcportrait-fresh --yes`; the scripts of commit `8ed6f27` | **2 min 35 s** to "deployed" (155 s by the wall clock), **21 s** to uninstall, **177 s** in all; transcript in section 4.1 |

So the best evidence for the deploy scripts' acceptance ("fresh project → running instance in ≤ 10 minutes following
`docs/self-host.md`") is now one uninterrupted, timed run of the committed script (section 4.1): 2 min 35 s from
nothing of the instance to a ready, checked instance in a project whose APIs were on, plus the 13 s run A
measured for enabling them and a few minutes for the OAuth client in the console. `uninstall.sh` ran for real
in the same run (21 s, everything it created deleted, the live service untouched). `--iap` and
`--disable-apis` have still never run for real (section 7.1).

### 4.1 The timed run from scratch (the self-hosting fixes)

Run by the orchestrator on 2026-10-10 from 16:39:15 to 16:42:12 UTC on the maintainer's machine (Google Cloud
SDK 587.0.0, macOS 27.0, bash 3.2.57), with `infra/deploy.sh` and `infra/uninstall.sh` as committed in
`8ed6f27`: the run started from that working tree 36 s before the commit was made, so `git describe` (and the
image's version) reads `cc430eb-dirty`. Before the run the project `gcportrait` had billing, all seven APIs of
`--build`, the maintainer's OAuth client and the live service `gcportrait`; nothing of `gcportrait-fresh`
existed. Afterwards the project's only Cloud Run service was the live `gcportrait`, untouched. The fixes' own
changes to the two scripts came after this run; they are verified by `--dry-run` and `pnpm test:infra`
(section 9), and the next real run is the orchestrator's.

The transcript as the wrapper wrote it, with the project number (`PROJECT_NUMBER`), the address hash (`HASH`),
the OAuth client id (`CLIENT_ID`), the maintainer's account, temporary paths and the checkout path replaced; the
Docker build's own output (about 400 lines) and deploy.sh's closing hints are left out where marked. It holds no
token.

| Step | Began | Took |
|---|---|---|
| Checking the project and your gcloud session | 0m00s | 3 s |
| Enabling the Google APIs (all seven already on) | 0m03s | 1 s |
| Creating the backend's service account | 0m04s | 4 s |
| Preparing Cloud Build (repository, bucket, build account, two grants; one repeated after 15 s) | 0m08s | 28 s |
| Building the image (upload of 1 831 files, 11.2 MiB; Cloud Build 57 s on `e2-highcpu-8`) | 0m36s | 1 min 45 s |
| Deploying the Cloud Run service | 2m21s | 11 s |
| Checking the running instance (revision ready, `/api/config`, the app) | 2m32s | 3 s |
| **deployed** | **2m35s** | |
| `uninstall.sh` (service, repository with its image, bucket, both accounts) | | **21 s** |

```text
timed deploy from scratch of a throwaway service, 2026-10-10T16:39:15Z

==> Checking the project and your gcloud session (0m00s)
    gcloud account: MAINTAINER@EXAMPLE
    project: gcportrait (number PROJECT_NUMBER), region: europe-west3, service: gcportrait-fresh
    billing: enabled

==> Enabling the Google APIs the instance needs (0m03s)
    already enabled: run.googleapis.com
    already enabled: iam.googleapis.com
    already enabled: cloudasset.googleapis.com
    already enabled: cloudresourcemanager.googleapis.com
    already enabled: artifactregistry.googleapis.com
    already enabled: cloudbuild.googleapis.com
    already enabled: storage.googleapis.com

==> Creating the backend's service account (no roles) (0m04s)
    + gcloud iam service-accounts create gcportrait-fresh-backend --project=gcportrait --display-name=gcportrait\ backend\ \(gcportrait-fresh\) --description=Created\ by\ gcportrait\ infra/deploy.sh\ for\ the\ Cloud\ Run\ service\ gcportrait-fresh.
Created service account [gcportrait-fresh-backend].
Service account email: gcportrait-fresh-backend@gcportrait.iam.gserviceaccount.com
    it holds no roles on gcportrait

==> Preparing Cloud Build (repository, bucket, build account) (0m08s)
    + gcloud artifacts repositories create gcportrait-fresh-builds --project=gcportrait --location=europe-west3 --repository-format=docker --labels=managed-by=gcportrait-deploy --description=gcportrait\ images\ built\ by\ infra/deploy.sh\ --build\ for\ the\ Cloud\ Run\ service\ gcportrait-fresh
Create request issued for: [gcportrait-fresh-builds]
Waiting for operation [projects/gcportrait/locations/europe-west3/operations/1b3c0d4e-e1f6-45b3-8e30-e054dfbde378] to complete...
.....done.
Created repository [gcportrait-fresh-builds].
    + gcloud artifacts repositories set-cleanup-policies gcportrait-fresh-builds --project=gcportrait --location=europe-west3 --policy=TMP/cleanup-policy.json --no-dry-run --quiet --format=none
Updated repository [gcportrait-fresh-builds].
Dry run is disabled.
    + POST https://storage.googleapis.com/storage/v1/b\?project=gcportrait \{\"name\":\"gcportrait-gcportrait-fresh-builds\"\,\"location\":\"europe-west3\"\,\"labels\":\{\"managed-by\":\"gcportrait-deploy\"\}\,\"iamConfiguration\":\{\"uniformBucketLevelAccess\":\{\"enabled\":true\}\,\"publicAccessPrevention\":\"enforced\"\}\,\"softDeletePolicy\":\{\"retentionDurationSeconds\":\"0\"\}\,\"lifecycle\":\{\"rule\":\[\{\"action\":\{\"type\":\"Delete\"\}\,\"condition\":\{\"age\":14\}\}\]\}\}
    created gs://gcportrait-gcportrait-fresh-builds
    + gcloud iam service-accounts create gcportrait-fresh-build --project=gcportrait --display-name=gcportrait\ build\ \(gcportrait-fresh\) --description=Created\ by\ gcportrait\ infra/deploy.sh\ for\ the\ Cloud\ Run\ service\ gcportrait-fresh:\ runs\ its\ Cloud\ Build\ builds.
Created service account [gcportrait-fresh-build].
Service account email: gcportrait-fresh-build@gcportrait.iam.gserviceaccount.com
    + gcloud storage buckets add-iam-policy-binding gs://gcportrait-gcportrait-fresh-builds --member=serviceAccount:gcportrait-fresh-build@gcportrait.iam.gserviceaccount.com --role=roles/storage.admin --format=none
ERROR: (gcloud.storage.buckets.add-iam-policy-binding) HTTPError 400: Service account gcportrait-fresh-build@gcportrait.iam.gserviceaccount.com does not exist.
    Google refused this while a new account or grant propagates; trying again in 15s (attempt 2 of 6)
    + gcloud artifacts repositories add-iam-policy-binding gcportrait-fresh-builds --project=gcportrait --location=europe-west3 --member=serviceAccount:gcportrait-fresh-build@gcportrait.iam.gserviceaccount.com --role=roles/artifactregistry.writer --format=none
Updated IAM policy for repository [gcportrait-fresh-builds].

==> Building the image with Cloud Build (about a minute, plus the upload) (0m36s)
    version: cc430eb-dirty
    + gcloud builds submit CHECKOUT --project=gcportrait --region=europe-west3 --config=CHECKOUT/infra/cloudbuild.yaml --ignore-file=TMP/gcloudignore --substitutions=_IMAGE=europe-west3-docker.pkg.dev/gcportrait/gcportrait-fresh-builds/gcportrait:20261010-163951-cc430eb-dirty\,_APP_VERSION=cc430eb-dirty --service-account=projects/gcportrait/serviceAccounts/gcportrait-fresh-build@gcportrait.iam.gserviceaccount.com --gcs-source-staging-dir=gs://gcportrait-gcportrait-fresh-builds/source --gcs-log-dir=gs://gcportrait-gcportrait-fresh-builds/logs --machine-type=e2-highcpu-8
Creating temporary archive of 1831 file(s) totalling 11.2 MiB before compression.
Uploading tarball of [CHECKOUT] to [gs://gcportrait-gcportrait-fresh-builds/source/1791650391.517256-fc3fe2ad34684c2c912db556ea8d1a16.tgz]
Created [https://cloudbuild.googleapis.com/v1/projects/gcportrait/locations/europe-west3/builds/92d4f90d-ad64-4549-8189-4fdb0944c41d].
Logs are available at [ https://console.cloud.google.com/cloud-build/builds;region=europe-west3/92d4f90d-ad64-4549-8189-4fdb0944c41d?project=PROJECT_NUMBER ].
Waiting for build to complete. Polling interval: 1 second(s).
----------------------------- REMOTE BUILD OUTPUT ------------------------------
  … (the Docker build: 24 steps, the SPA and the backend bundle, the push) …
DONE
--------------------------------------------------------------------------------
ID                                    CREATE_TIME                DURATION  SOURCE                                                                                                 IMAGES                                                                                                   STATUS
92d4f90d-ad64-4549-8189-4fdb0944c41d  2026-10-10T16:39:53+00:00  57S       gs://gcportrait-gcportrait-fresh-builds/source/1791650391.517256-fc3fe2ad34684c2c912db556ea8d1a16.tgz  europe-west3-docker.pkg.dev/gcportrait/gcportrait-fresh-builds/gcportrait:20261010-163951-cc430eb-dirty  SUCCESS

==> Deploying the Cloud Run service (2m21s)
      TRUST_PROXY_HOPS: '1'
      LOG_LEVEL: 'info'
      SA_MODE_ENABLED: 'false'
      BACKEND_SA_EMAIL: 'gcportrait-fresh-backend@gcportrait.iam.gserviceaccount.com'
      OAUTH_CLIENT_ID: 'CLIENT_ID'
      SOURCE_URL: 'https://github.com/florianchrometz/gcportrait'
    + gcloud run deploy gcportrait-fresh --project=gcportrait --region=europe-west3 --image=europe-west3-docker.pkg.dev/gcportrait/gcportrait-fresh-builds/gcportrait:20261010-163951-cc430eb-dirty --service-account=gcportrait-fresh-backend@gcportrait.iam.gserviceaccount.com --env-vars-file=TMP/env.yaml --port=8080 --cpu=1 --memory=512Mi --concurrency=80 --min-instances=0 --max-instances=10 --timeout=900 --cpu-boost --ingress=all --startup-probe=httpGet.path=/healthz\,initialDelaySeconds=0\,periodSeconds=2\,timeoutSeconds=2\,failureThreshold=15 --liveness-probe=httpGet.path=/healthz\,periodSeconds=30\,timeoutSeconds=5\,failureThreshold=3 --update-labels=managed-by=gcportrait-deploy --allow-unauthenticated --quiet
Deploying container to Cloud Run service [gcportrait-fresh] in project [gcportrait] region [europe-west3]
Deploying new service...
Setting IAM Policy.............done
Creating Revision................................................................done
Routing traffic.....done
Done.
Service [gcportrait-fresh] revision [gcportrait-fresh-00001-jvx] has been deployed and is serving 100 percent of traffic.
Service URL: https://gcportrait-fresh-PROJECT_NUMBER.europe-west3.run.app

==> Checking the running instance (2m32s)
    revision gcportrait-fresh-00001-jvx is ready: its startup probe GET /healthz passed
    GET /api/config: {"oauthClientId":"CLIENT_ID","saMode":false,"saStrictExposure":false,"backendServiceAccount":"gcportrait-fresh-backend@gcportrait.iam.gserviceaccount.com","version":"cc430eb-dirty","sourceUrl":"https://github.com/florianchrometz/gcportrait","hostedBy":"Not affiliated with Google. An independent open-source side project.","demo":false}
    GET /:           the app
    warning: Google's Compute Engine default account PROJECT_NUMBER-compute@developer.gserviceaccount.com holds Editor on gcportrait (gcportrait does not use it; docs/self-host.md, "What Google adds by itself").

gcportrait is deployed in 2m35s.

    Address:          https://gcportrait-fresh-PROJECT_NUMBER.europe-west3.run.app
    Also answers on:  https://gcportrait-fresh-HASH-ey.a.run.app
    Service account:  gcportrait-fresh-backend@gcportrait.iam.gserviceaccount.com (no roles granted by deploy.sh)
    Image:            europe-west3-docker.pkg.dev/gcportrait/gcportrait-fresh-builds/gcportrait:20261010-163951-cc430eb-dirty
    Sign-in:          CLIENT_ID
    Service-account mode: off
    Access:           public; reading Google Cloud data needs a Google sign-in

… (deploy.sh's closing hints: the OAuth client's origins, service-account mode, "Later") …
deploy exit=0 after 155 s
--- /api/config ---
{"oauthClientId":"CLIENT_ID","saMode":false,"saStrictExposure":false,"backendServiceAccount":"gcportrait-fresh-backend@gcportrait.iam.gse…  (cut by the wrapper)

--- uninstall (keeping shared APIs) ---

==> Looking for what deploy.sh created in gcportrait (0m00s)
    Cloud Run service: gcportrait-fresh (europe-west3)
    Artifact Registry repository: gcportrait-fresh-builds (europe-west3), with its images
    Cloud Storage bucket: gs://gcportrait-gcportrait-fresh-builds, with its objects (uploaded sources and build logs)
    service account: gcportrait-fresh-backend@gcportrait.iam.gserviceaccount.com
    service account: gcportrait-fresh-build@gcportrait.iam.gserviceaccount.com

==> Deleting the Cloud Run service (0m08s)
    + gcloud run services delete gcportrait-fresh --project=gcportrait --region=europe-west3 --quiet
Deleting [gcportrait-fresh]...
................done.
Deleted service [gcportrait-fresh].

==> Deleting the build repository and its images (0m12s)
    + gcloud artifacts repositories delete gcportrait-fresh-builds --project=gcportrait --location=europe-west3 --quiet
Delete request issued for: [gcportrait-fresh-builds]
Waiting for operation [projects/gcportrait/locations/europe-west3/operations/054f59b5-17a6-4b68-8aaa-9dff8ffa4506] to complete...
.....done.
Deleted repository [gcportrait-fresh-builds].

==> Deleting the build bucket and its objects (0m14s)
    + gcloud storage rm --recursive gs://gcportrait-gcportrait-fresh-builds
Removing objects:

Removing gs://gcportrait-gcportrait-fresh-builds/logs/log-92d4f90d-ad64-4549-8189-4fdb0944c41d.txt#1791650494321929...
Removing gs://gcportrait-gcportrait-fresh-builds/logs/log-92d4f90d-ad64-4549-8189-4fdb0944c41d.txt-appending-1791650487818292013#1791650486860708...
Removing gs://gcportrait-gcportrait-fresh-builds/source/1791650391.517256-fc3fe2ad34684c2c912db556ea8d1a16.tgz#1791650393653149...
..........
Removing buckets:

Removing gs://gcportrait-gcportrait-fresh-builds/...
.......

==> Deleting the build service account (0m19s)
    + gcloud iam service-accounts delete gcportrait-fresh-build@gcportrait.iam.gserviceaccount.com --project=gcportrait --quiet
deleted service account [gcportrait-fresh-build@gcportrait.iam.gserviceaccount.com]

==> Deleting the backend's service account (0m20s)
    + gcloud iam service-accounts delete gcportrait-fresh-backend@gcportrait.iam.gserviceaccount.com --project=gcportrait --quiet
deleted service account [gcportrait-fresh-backend@gcportrait.iam.gserviceaccount.com]
    Grants made to it elsewhere (roles/cloudasset.viewer on a team's scope) now show as deleted:serviceAccount
    members there; their owners can remove them.

Done in 0m21s.
uninstall exit=0
gcportrait
total 177 s
```

## 5. What exists in `gcportrait` now

Read-only inventory at 16:04 UTC (`gcloud services list`, `run services list` and `describe`,
`iam service-accounts list`, `artifacts repositories list`, `storage buckets list`, `run jobs list`,
`builds triggers list`, `iam workload-identity-pools list`), with the grants as the spike and task reports
record them (the project's IAM policy was not re-read in the review).

| Resource | Made by | Notes |
|---|---|---|
| Project `gcportrait`, billing linked | the maintainer | 35 APIs on, among them the ones the spike and deploy.sh enabled (`run`, `iam`, `cloudasset`, `cloudresourcemanager`, `artifactregistry`, `cloudbuild`, `storage`), what Google enabled with them (`containerregistry`, `pubsub`, `iamcredentials`) and a new project's defaults (BigQuery, Logging, Monitoring and others). `iap` is off |
| Cloud Run service `gcportrait` (europe-west3), label `managed-by=gcportrait-deploy` | the deploy scripts' run B, 14:42 UTC | public (`allUsers` may invoke it); service-account mode on, strict exposure off; the OAuth client and `HOSTED_BY` set; image `86aad6c-dirty`, whose `SOURCE_URL` points at a repository that does not exist yet |
| Service account `gcportrait-backend@gcportrait.iam.gserviceaccount.com` | the quota-project spike, 05:42 UTC | the instance's identity; `roles/cloudasset.viewer` on the project (granted 06:09 UTC); the maintainer holds `roles/iam.serviceAccountTokenCreator` on it (06:09 UTC). Its description names the spike, so `uninstall.sh` would keep it |
| Service account `gcportrait-build@gcportrait.iam.gserviceaccount.com` | deploy.sh | Storage Admin on the build bucket, Artifact Registry Writer on the build repository, and a redundant Storage Object Admin on the bucket from the deploy scripts' round 1 (its removal was refused by the permission system) |
| Compute Engine default account `PROJECT_NUMBER-compute@developer.gserviceaccount.com`, and Google's Cloud Build account | Google, when `run` and `cloudbuild` were enabled | the default account holds Editor on the project (seen while the deploy scripts were built; deploy.sh warns); gcportrait uses neither |
| Artifact Registry repository `gcportrait-builds` (europe-west3, Docker, labelled) | deploy.sh `--build` | keeps the 5 newest images |
| Bucket `gs://gcportrait-gcportrait-builds` (labelled) | deploy.sh `--build` | uploaded sources and build logs, deleted after 14 days |
| OAuth consent screen and a Web application client | the maintainer, in the console, about 13:04 UTC | its id is in the git-ignored `backend/.env` and in the service's environment; its authorised origins and test users were not checked by any agent |

Not there: a workload identity pool, the public release repository (`gcportrait/gcportrait`), Cloud Run jobs,
Cloud Build triggers, IAP. Domain mappings were not checked (the gcloud `beta` component is not installed).
Nothing was created, changed or deleted in the review.

## 6. What the maintainer does by hand

1. **Sign in once for real** (Google sign-in's acceptance, the quota-project spike's sign-in row, steps 3 to 5)
   and walk the four steps at the end of section 3, locally and on the deployed instance; record the consent
   wording and whether Google's Data Access page lists `cloudasset` as sensitive or restricted in that row. Check the client's authorised
   JavaScript origins (`http://localhost:5173` and the instance's two addresses) and the test users in the
   console.
2. **Let the deploy run happen**: a permission rule for the review's sequence (self-host.md, "Verified on"), or
   run it yourself: deploy `gcportrait-fresh` with `--build` under `/usr/bin/time -p`, `curl` its
   `/api/config`, redeploy with `--iap`, then `uninstall.sh --yes --disable-apis`. Paste the transcript there.
   *The self-hosting fixes: the deploy, the `curl` and the uninstall ran (section 4.1, self-host.md "Verified on"); the redeploy
   with `--iap` and `--disable-apis` did not.*
3. **The hosted app's OAuth client** (the hosting decision of the time, `architecture.gcportrait.app`; dropped
   since, ADR 0035): External audience, branding without Google's names, the privacy policy, terms and Impressum
   the decision required, the three scopes with their
   justifications, a client whose only origin is the custom domain (a second client for development), then
   Google's verification (self-host.md, "For the maintainer's hosted instance").
4. **Custom domains** for the hosted app and the demo: verify `gcportrait.app` in Google Search Console and
   map the subdomains to Cloud Run (a domain mapping where the region offers one, otherwise a load balancer in
   front).
5. **Service-account mode on an organisation, optionally**: `gcloud organizations add-iam-policy-binding ORG_ID
   --member="serviceAccount:gcportrait-backend@gcportrait.iam.gserviceaccount.com"
   --role="roles/cloudasset.viewer"`. Prefer a folder or a project: on a public instance with the strict check
   off, everyone who can see the organisation and sign in could read its inventory (docs/permissions.md).
6. **Clean-ups in `gcportrait`**: remove your `roles/iam.serviceAccountTokenCreator` on `gcportrait-backend`
   once no local service-account run needs it (the command is in the quota-project spike, section 7); remove the redundant
   Storage Object Admin of `gcportrait-build` on the build bucket; decide on the default account's Editor role.
   *The self-hosting fixes: the next `deploy.sh --build` run for `gcportrait` removes that Object Admin grant
   itself, but it now stops first at `gcportrait-backend`, which the quota-project spike created (section 9).*
7. **The live instance**: it runs a dirty build with service-account mode on and a public address. Keep it as a
   test instance, put it behind IAP (once IAP and user mode are settled, section 7.1), or remove it; redeploy it
   from a clean commit once the self-hosting work is committed.

## 7. Findings, from the features' reports and this review (deduplicated)

### 7.1 Blocking: the self-hosting work is not complete

1. **Google sign-in: nobody has signed in with the real OAuth client.** Its acceptance ("the real client works when an
   OAuth client id is configured") is unconfirmed; only the maintainer can close it (section 6, item 1).
2. **The deploy scripts: no uninterrupted, timed run of the current deploy.sh from scratch; `--iap` and `uninstall.sh` never
   ran for real.** The permission system refuses deploys for agents (section 4). *The self-hosting fixes: the
   orchestrator's timed run of the committed scripts (section 4.1) closes the deploy from scratch and `uninstall.sh`;
   `--iap` and `--disable-apis` stay open.*
3. **The deploy scripts against the distribution decision** (now ADR 0035, section 2). It publishes images on
   GitHub Container Registry (multi-arch) and has deploy.sh pull them through an Artifact Registry remote
   repository in the customer's project; the deploy scripts built publishing to a public Artifact Registry repository through Workload Identity Federation, `PUBLISHED_IMAGE`
   in `infra/common.sh` pulled directly, `uninstall.sh` without a remote repository, and the docs to match
   (self-host.md "Maintainer release setup", configuration.md "Release workflow", the contributor-workflow
   skill §7, the deploy scripts' changeset). The task description still says "public AR repo via WIF", and the
   follow-up it names does not exist yet. The orchestrator amends the description and gives the change a task.
4. **deploy.sh `--build` takes over an unlabelled `SERVICE-builds` repository**: it sets the clean-up policy
   (keep 5 versions, delete the rest), grants its build account Writer and pushes, where the bucket check
   refuses. Fix the same way as the bucket, with a test in `scripts/infra.test.ts`. *The self-hosting fixes: fixed, and the same
   for the service and both accounts (section 9).*
5. **IAP and user mode** (the private topology of `docs/self-host.md`): IAP processes the `Authorization` header that carries
   the person's token unless a valid IAP token came in `Proxy-Authorization`, so behind `--iap` every `/api/*`
   call except demo mode very likely fails. Decide: move the person's token to a header IAP leaves alone
   (frontend and backend), or limit `--iap` to service-account mode and the demo, by ADR. *The self-hosting fixes: decided by
   [ADR 0031](../adr/0031-token-header-behind-iap.md): the token travels in `X-Gcportrait-Token`; not yet run
   behind a real IAP.*

### 7.2 Smaller defects, with a suggested owner

Backend (a self-hosting follow-up, or the security review):

- The gate's audit line is written at `info`, so `LOG_LEVEL=warn` or higher drops every one (service-account mode).
- A fresh refusal from the preflight does not drop a remembered pass for the same token and scope, so a pull
  can pass for up to five minutes after the check said "refused" (service-account mode).
- `SA_MODE_STRICT_EXPOSURE` with a value other than `true`/`false` leaves the opt-in off with only a warning;
  refusing to start would fail closed (service-account mode).
- The metadata server is reached by host name through DNS rather than its link-local address (service-account mode).
- Google's messages for the account's own calls reach any caller past gate step 1 and can name the instance's
  project number (the permission check, service-account mode).
- `projectIdOf(details)` from Resource Manager's answer goes unvalidated into `x-goog-user-project` and the
  commands (the permission check).
- A `gcsUri` with a lone UTF-16 surrogate answers 500 instead of 400 (the export read).
- Memory: a page is buffered whole (up to 25 MiB), four streams per token and no process-wide cap, against
  Cloud Run's 512 MiB and 80 concurrent requests set by deploy.sh (the live pull, for the deploy scripts).
- The scope and quota-project schemas accept `projects/evil.com`-like ids; the host is fixed, so it costs one
  refused call to Google, not an SSRF (the deploy scripts, for the security review).
- `HOSTED_BY`'s guard against Google's name is bypassed by look-alikes such as `G00gle` (Google sign-in).
- Two parsers of Google's error envelope remain, `upstream/google.ts` (messages cut at 1 000 characters) and
  `upstream/google-error.ts` (2 000), so the preflight and the stream may classify an answer differently; one
  should go (the permission check, the live pull). The per-token limiters and the two service-account options
  the reviews also listed are already one each in `server.ts`. Its header comment still calls it a skeleton whose
  Google-facing routes are to come.
- A refused redirect is classified as a transport failure and retried five times (the permission check); the export read's
  idle timeout also counts time the client does not read; a prefix of folder placeholders only has no page
  bound; requester-pays buckets and an `operation.json` next to a `gs://` export are not supported (all three the
  export read).

Frontend:

- A permission check in flight when the person signs out away from the Permissions page is not cancelled; its
  late result is cleared when another account signs in (Google sign-in, the permission check).
- The scope picker's hint is not linked with `aria-describedby` (`hintId` unused); `PreflightPanel` hard-codes
  two DOM ids (the permission check).
- A 12-digit example number (`1234…9012`) in `scope/scopeName.ts`, its tests and
  `PermissionsPage.test.tsx`, and in deploy.sh's error text, against agents.md rule 6 (the permission check, the deploy scripts;
  fixed in self-host.md in this review).
- A type-filtered pull would be stored like a full one (`assetTypes` not recorded), which the timeline's cache
  key needs (the live pull, for the timeline); an `operation.json` whose scope differs from the assets' relabels
  the snapshot without a warning; `ImportFailure.command` is never set (both the export read).
- The sign-in e2e runs on Vite's dev server, so no spec exercises the backend's CSP and COOP with the built
  app (section 3 did once, with no console error or warning); no test ties the backend's zod contracts to the
  frontend's zod-free guards (Google sign-in, the permission check).
- The export's title block prints the read time as `2026-10-10T18:15:23+02:00` (this review, section 3); a
  formatted date would read better. For the export's owner, not for self-hosting.

Infrastructure and docs:

- `--dry-run` does not print IAP's service-identity request; deploy.sh takes over an existing unlabelled Cloud
  Run service of the same name; its banners and `--help` lack the short non-affiliation line (the deploy scripts).
- ADR 0030 (own Cloud Build account) is proposed, and differs from self-host.md on when the Compute Engine
  default account appears (the deploy scripts).
- The licence-report code is duplicated between `backend/bundle.ts` and `frontend/vite.config.ts` (the deploy scripts).
- `.gcportrait-oauth-client.local.txt` at the root is ignored only through this clone's `.git/info/exclude`;
  the hand-off script must leave it out (Google sign-in).
- The build's description of the backend and of the permission matrix still names one OAuth scope and a gate by
  the caller's `get`; the code, ADR 0028 and docs/permissions.md use three scopes and `testIamPermissions` (Google
  sign-in, service-account mode). The cai-ingestion skill still lists Resource Manager's search as a POST; it is a
  GET (the permission check). ADR 0018's surfaces table now lists the user guides (service-account mode's
  finding, fixed in this review).

### 7.3 Decisions for the maintainer

1. Service-account mode's strict exposure check is off by default, so a scope whose `get` is public is open
   to everyone signed in if it granted the account (service-account mode). Keep the default?
2. `/api/preflight` in service-account mode answers a refused gate with 403 (or 401, 503) carrying the
   checklist, never a 200; `/api/config` gained `saStrictExposure` (service-account mode). Confirm both contracts.
3. The audit line hashes the email with plain SHA-256, which is pseudonymous; an HMAC would need a secret
   (service-account mode).
4. In service-account mode no quota header is sent, so the account's own project pays; that is the instance's
   project only when the account lives there, as deploy.sh arranges (service-account mode).
5. Should the backend check a token's audience against its own client (the permission check)? Today any Google token with the
   right scopes works, as section 2 shows.
6. The Connect page's order changed (the export card last, full width), and should it show the permission
   check inline, as the app's design lists (the live pull)?
7. ADR 0030, and the Compute Engine default account's Editor role in `gcportrait` (the deploy scripts).
8. The live instance's future (section 6, item 7), and whether Google lists `cloudasset` as sensitive or
   restricted (Google sign-in).

## 8. Reproduce

```sh
pnpm check && pnpm build && pnpm size && pnpm e2e       # section 1
infra/deploy.sh --project gcportrait --region europe-west3 --service gcportrait-fresh --build --dry-run
```

The walk of section 3, kept outside the repository: the build served by the backend bundle on a private port
with the instance's client id, then a Playwright script that reads the token from standard input and hands it
to the page through `page.exposeFunction`, answers `https://accounts.google.com/gsi/client` with a stand-in that
calls the app back with that token, answers tokeninfo with the instance's client as audience, lets the
stand-in answer `revoke`, aborts every other request to a Google host, and then presses what a person presses.

```sh
cd backend && PORT=8097 HOST=127.0.0.1 OAUTH_CLIENT_ID=… node --enable-source-maps dist/server.mjs
gcloud auth print-access-token | BASE=http://127.0.0.1:8097 CLIENT_ID=… ACCOUNT=YOU@example.com \
  OUT=/tmp/walk node smoke-ui.mjs   # Permissions › sign in › scope › check › Connect › Pull now › Export
```

The smoke test of section 2, kept outside the repository: it reads the token from standard input, sends it as
`printf 'Authorization: Bearer %s\n' "$TOKEN" | curl -H @- …` (as the quota-project spike does), writes each answer to a
temporary file deleted on exit, and prints only what jq summarises: statuses, counts, outcomes, item findings
and the service-account gate's codes.

```sh
gcloud auth print-access-token | ./smoke-api.sh https://YOUR_INSTANCE
# GET /api/config, GET / (headers), GET /healthz, then with the token:
# POST /api/scopes/search {"query":"gcportrait"}
# POST /api/preflight {"scope":"projects/gcportrait","mode":"user","quotaProject":"gcportrait"}, without the
#   quota project, {"scope":"projects/gcportrait","mode":"sa"} and {"scope":"organizations/1","mode":"sa"}
# POST /api/assets/stream for the same scope in both modes and organizations/1 in "sa"; once without a token
```

## 9. Addendum: the self-hosting fixes (2026-10-10, after the review)

What the self-hosting fixes changed for the findings of section 7 in the backend, `infra/`, the app's sign-in
client and the docs, each with its test; the other findings keep their owners. Verified, in the fixes' second
round, by `pnpm check` twice: on the shared working tree, which also held the uncommitted timeline work (green:
260 test files, 6 871 tests), and on a copy of the commit before with only the fixes' files laid over it (green:
248 files, 6 787 tests), so the fixes pass on their own as well. Also by `pnpm --filter @gcportrait/backend test`, `pnpm
test:infra`, the live e2e specs (`chromium-live`, 35 passed), `shellcheck -x infra/*.sh`, and `infra/deploy.sh
--dry-run` against `gcportrait` with the committed script and with the fixed one (the fixes' report lists every
command with its result). In the first round `pnpm check` was red on the shared tree, on the timeline work's
formatting and lint alone.

| Finding (section) | The self-hosting fixes |
|---|---|
| deploy.sh takes over an unlabelled repository (7.1 item 4) and Cloud Run service (7.2) | **Fixed.** Before it creates anything, deploy.sh checks every resource of its names that exists: the service, the backend account and, with `--build`, the build account, repository and bucket. One without its mark (the label; on an account, exactly deploy.sh's description) stops the run with each one named, the command that hands it over, and `--service`. `scripts/infra.test.ts`: each case, with and without `--dry-run`, makes no change. |
| The build account's grant on its bucket (orchestrator's first run: `FAILED_PRECONDITION … does not have access`) | `roles/storage.admin` on the one bucket was already what the committed script grants (section 4.1 shows it working); the fixes also remove the redundant `roles/storage.objectAdmin` an earlier version granted, where it finds it, and only that account's. Tested. |
| `--disable-apis` precision | The APIs deploy.sh enables were already recorded as labels; `uninstall.sh --disable-apis` now lists the project's Cloud Run services, jobs and worker pools (every region) first and keeps what another one needs, saying which workload keeps which API, and keeps everything when any of the three cannot be listed (an older gcloud without `run worker-pools`, say). Workloads outside Cloud Run, IAP on an external load balancer among them, are not looked at; `--help` and self-host.md say so. Tested for no other workload, another service, one behind IAP, another gcportrait instance, a job, a worker pool, and each listing refused. |
| `/healthz` answers Google's 404 from outside (section 2) | **`GET /api/healthz`** (the same payload, rate limited like `/api`); deploy.sh's readiness wait and the docs use it; the probes and Docker keep `/healthz`. The wait retries (seven tries, 5 s apart) only while Google's front end answers with its own page; an image that predates `/api/healthz` answers with the backend's own JSON 404, which ends the wait at once, and `/api/config` is the check there (checked read-only against the live, older `gcportrait`: `404 application/json` for `/api/healthz`, `404 text/html` for an address with no service yet). Tested for each case and for an address that never answers. |
| IAP and user mode (7.1 item 5) | **ADR 0031** (proposed): the app sends the token in `X-Gcportrait-Token`; the backend reads it first and `Authorization: Bearer` only without it, with the scheme in any letter case (RFC 7235); neither is logged. Backend, client and e2e tests. A real IAP run is still open. |
| The audit line at `info` (7.2) | **Fixed**: written at `info` whatever `LOG_LEVEL` is, short of `silent`. Tested at `warn`, `error` and `silent`. |
| A fresh refusal keeps a remembered pass (7.2) | **Fixed**: a refusal at the caller or exposure step forgets the pass for that token and scope (a missing account token does not, as before). Tested. |
| `SA_MODE_STRICT_EXPOSURE` typo leaves the check off (7.2) | **Fixed**: any value other than `true`, `false` or unset stops start-up. Tested. |
| The metadata server reached by host name (7.2) | **Kept, on purpose.** On Cloud Run the name resolves through the platform's own resolver, and the address form would turn a laptop without a metadata server from an immediate DNS failure into a 30 s wait of three connection timeouts at start-up. |
| Google's messages can name the instance's project number (7.2) | **Kept**: the number is not a secret; it is part of the instance's own address (`SERVICE-PROJECT_NUMBER.REGION.run.app`). |
| `projectIdOf` unvalidated (7.2) | **Fixed**: it must pass the quota-project schema, otherwise the scope's own id is used. Tested with a header-injection attempt among others. |
| A lone surrogate in `gcsUri` gives 500 (7.2) | **Fixed**: 400. Tested. |
| Memory: whole pages, four streams per token, no process cap (7.2) | **Not changed**: a cap needs measured page sizes (a 500-asset page is typically far below the 25 MiB limit); left to the security review's load review with a measurement. |
| `projects/evil.com`-like ids (7.2) | **Not changed**: assigned to the security review; the host is fixed, so it costs one refused call. |
| `HOSTED_BY` look-alikes (7.2) | **Not changed**: the guard catches an honest operator's slip, not a deliberate look-alike, which no list can enumerate; deploy.sh and the backend keep one rule. |
| Two parsers of Google's error envelope (7.2) | **Fixed**: one parser (`upstream/google-error.ts`), one message limit (2 000 characters); a test checks both views agree. The server's header comment is current. |
| A refused redirect retried as a transport failure (7.2) | **Fixed**: redirects are not followed (`redirect: "manual"`), so a 3xx is an answer, never retried and classified as unexpected. Tested. |
| Export read idle timeout, folder-placeholder prefixes, requester-pays, `operation.json` next to a `gs://` export (7.2) | **Not changed**: behaviour changes of the export read for the timeline or the security review, not defects with a wrong result. |
| `--dry-run` does not print IAP's service-identity request (7.2) | **Fixed**, tested. |
| Banners and `--help` without the short non-affiliation line (7.2) | **Fixed**: both scripts open every run and `--help` with it; a test keeps `infra/common.sh` and `frontend/src/branding.ts` equal. |
| A 12-digit example in deploy.sh's error text (7.2) | **Fixed** (`12345678901-abc…`), tested. |
| The build account's Storage Admin on its bucket also covers that bucket's IAM policy and deletion (the fixes' review) | **Not changed**, as the task asks for Storage Admin; noted in self-host.md ("What deploy.sh does", Build) for the security review: a custom role of Storage Object Admin plus `storage.buckets.get` would be narrower. |
| ADR 0030 against self-host.md on the Compute Engine default account (7.2) | **Not changed**: self-host.md records what was observed (the account appeared, with Editor, right after `run` and `cloudbuild` were enabled; section 4.1's warning shows it still there); ADR 0030's context sentence is the one to correct, by the orchestrator. |

One consequence for the live instance: the backend account `gcportrait-backend@gcportrait.iam.gserviceaccount.com`
was made by the quota-project spike, not deploy.sh, so `infra/deploy.sh --project gcportrait` (service `gcportrait`) now stops
at it. Its `--dry-run` says so and prints the command that hands it over (section 6, item 7).
