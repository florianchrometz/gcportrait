<!-- SPDX-License-Identifier: Apache-2.0 -->

# Configuration reference

Every setting of a gcportrait instance, its default and who sets it. [self-host.md](self-host.md) is the guide
and [self-host-options.md](self-host-options.md) explains each option with an example; this page is the
reference. Nothing configured here is a secret, and no credential is ever configured through the environment:
the backend uses the caller's own token, or in service-account mode its own Application Default Credentials
(on Cloud Run: the service's identity). A test keeps the tables below equal to the backend's schema, the
scripts' `--help` and the build's variables (`node scripts/user-docs.mjs`).

| Section | |
|---|---|
| [Backend environment](#backend-environment) | The variables the service reads at start-up (`backend/src/config.ts`). |
| [Service-account credentials](#service-account-credentials) | What Application Default Credentials read, in service-account mode only. |
| [Environment on Cloud Run](#environment-on-cloud-run) | What `infra/deploy.sh` sets them to. |
| [infra/install.sh](#infrainstallsh) | The one-line installer's own flags; it passes every other one to deploy.sh. |
| [infra/deploy.sh](#infradeploysh) | Its flags and the Cloud Run settings it applies. |
| [infra/uninstall.sh](#infrauninstallsh) | Its flags. |
| [Names and labels](#names-and-labels) | The resources deploy.sh creates, and how uninstall.sh recognises them. |
| [The image](#the-image) | Build arguments, environment, files, user, port, health. |
| [Local runs with compose](#local-runs-with-compose) | `infra/compose.yaml`'s variables. |
| [Cloud Run Button](#cloud-run-button) | What `app.json` asks for and what its hook sets. |
| [Release workflow](#release-workflow) | What `release.yml` publishes; it needs no secret and no variable. |
| [SPA build](#spa-build) | Build-time variables of the frontend. |

## Backend environment

Parsed once at start-up with zod (`backend/src/config.ts`; `backend/.env.example` documents each for local
development). Blank counts as unset. An invalid value stops start-up with a message that names the variable,
never its value.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | TCP port to listen on. Cloud Run sets it (8080). |
| `HOST` | `0.0.0.0` | Interface to bind. `pnpm dev` uses `localhost`. |
| `LOG_LEVEL` | `info` | pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. |
| `LOG_FORMAT` | `json` | `json` (one object per line with `severity` and `message`, for Cloud Logging) or `pretty` (development only; needs the pino-pretty dev dependency, which the image does not have). |
| `OAUTH_CLIENT_ID` | unset | Public OAuth web client id for "Sign in with Google". Unset: sign-in shows as not configured; demo mode and export files still work. Letters, digits, dots, dashes, underscores. [self-host-options.md, "The OAuth client in detail"](self-host-options.md#the-oauth-client-in-detail). |
| `SA_MODE_ENABLED` | `false` | Exactly `true` enables service-account mode; any other value leaves it off (a value other than `true`/`false` is a start-up warning). With it on, start-up resolves the instance's Application Default Credentials and stops if they are not usable. |
| `SA_MODE_STRICT_EXPOSURE` | `false` | `true` adds the exposure check to the service-account gate: a scope whose details the account can read itself is refused (backend/README.md, "Service-account mode"). Any value other than `true`, `false` or unset stops start-up, so a typo never leaves the check off unnoticed. |
| `SA_MODE_AUDIT_KEY` | unset | Secret key for HMAC-SHA256 caller email hashing in the service-account gate's audit log lines (backend/AGENTS.md, "The service-account gate"). When unset, plain SHA-256 is used. Plain text on one line without control characters. |
| `SA_MODE_CALLERS` | unset | Comma- or whitespace-separated list of allowed caller email addresses or domains for organisation scopes in service-account mode (e.g. `alice@example.com, example.com, @example.org`). When unset or empty, organisation scopes are refused. Folders and projects do not require this setting. |
| `BACKEND_SA_EMAIL` | unset | The account customers grant `roles/cloudasset.viewer` to, shown on the Permissions page (`backendServiceAccount` in `/api/config`). With service-account mode on it must be the account the credentials resolve to, which fills it in when unset. |
| `HOSTED_BY` | unset | Who runs the instance, shown before sign-in as "Hosted by NAME." (`hostedBy` in `/api/config`, `null` when unset). Plain text on one line, at most 80 characters, without `<` or `>`, never naming Google. |
| `STATIC_DIR` | `../frontend/dist` from the backend package | The built SPA; served when it contains `index.html`. The image sets `/app/frontend/dist`. |
| `TRUST_PROXY_HOPS` | `0` | Reverse-proxy hops whose `X-Forwarded-For` is trusted for the client address (rate limiting). `1` behind Cloud Run's front end; `0` wherever clients can reach the process directly. |
| `APP_VERSION` | `version` of `backend/package.json` | Reported by `/healthz` and `/api/config`; at most 64 characters. The image sets it at build time. |
| `SOURCE_URL` | `https://github.com/florianchrometz/gcportrait` | Where the source of the running version is published, an `http(s)` URL; the app's footer links to it as "Source (Apache-2.0)", a courtesy to the people who use the instance (the Apache License 2.0 does not ask for it). If you run a modified version and publish its source, you can point it there. |
| `DEMO_ONLY` | `false` | `true`: a sign-in-free demo ([self-host-options.md, "Demo-only instance"](self-host-options.md#demo-only-instance)): `/api/config` reports `demoOnly: true`, the four routes that call Google are not registered (JSON 404), the CSP allows no Google host, the page is cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`; [security.md](security.md)), and the Connect page offers the demo organisations only. With it, `OAUTH_CLIENT_ID` and `SA_MODE_ENABLED=true` stop start-up. Any value other than `true`, `false` or unset stops start-up. |
| `LEGAL_DIR` | unset | A directory holding `impressum.md` and/or `privacy.md` (UTF-8 Markdown, at most 64 KiB each, no control characters), served at `/api/legal` and shown at `/impressum` and `/privacy`, linked from the footer ([self-host-options.md, "Legal pages: link or serve"](self-host-options.md#legal-pages-link-or-serve)). Relative to the working directory. Read once at start-up; a missing directory, neither file, or an unusable text stops start-up. |
| `LEGAL_BUNDLE` | unset | The same texts as one JSON object of base64 strings, `{"impressum":"…","privacy":"…"}` (either key may be left out); `deploy.sh --legal-dir` writes it. Set this or `LEGAL_DIR`, not both. |
| `LEGAL_IMPRESSUM_URL` | unset | The address of an Impressum you publish elsewhere, such as on your own website, instead of serving its text: an `https://` URL without a user name or password, at most 2048 characters. Reported in `/api/config` as `legal.impressumUrl` (null when unset); the app's footer links it, in the same tab and marked as a link to another site. Set together with an `impressum.md` in `LEGAL_DIR` or `LEGAL_BUNDLE`, it stops start-up: a page is linked or served, not both. |
| `LEGAL_PRIVACY_URL` | unset | The same for the privacy notice: `legal.privacyUrl` in `/api/config`; not together with a `privacy.md` in `LEGAL_DIR` or `LEGAL_BUNDLE`. |
| `RENDER_API` | `true` | `POST /api/render`, SVG, PNG and draw.io drawn on the server ([api.md](api.md#post-apirender)). `false` leaves the route out (JSON 404). A demo-only instance never has it, and `true` with `DEMO_ONLY=true` stops start-up. Any value other than `true`, `false` or unset stops start-up. |
| `RENDER_MAX_ASSETS` | `60000` | Assets per render, 1 to 1 000 000, for every source. Demo sizes are listed in [modes.md](modes.md#4-the-demo). More: `422 TOO_MANY_ASSETS`; a pull stops as soon as it passes the limit. |
| `RENDER_MAX_PIXELS` | `67108864` | Pixels per PNG, 1 000 000 to 134 217 728 (2^27, the app's export limit). A larger PNG is drawn at the largest two-decimal scale that fits, named in `x-gcportrait-scale`. The rasteriser takes about 10 bytes per pixel while it draws: the default fits 2 GiB, 2^27 wants `--memory 4Gi`. |
| `RENDER_TIMEOUT_MS` | `300000` | From the start of a render (its pull or upload included) to the first byte of the answer, 10 000 to 3 600 000 ms. Then `503 RENDER_TIMEOUT`. Keep it below the platform's request timeout (Cloud Run: 900 s; deploy.sh refuses more than 840 000). |
| `RENDER_MAX_BODY_BYTES` | `26214400` | The uploaded file of a render, 1 MiB to 1 GiB. More: `413 BODY_TOO_LARGE`. Cloud Run takes at most 32 MiB per HTTP/1 request, and every upload must arrive within the 30 s body deadline: read larger exports with a `scope` source instead. |

The backend's fixed limits (rate limits per client address and per token hash, four concurrent streams per
token, 60 s and 25 MiB per upstream page, 1 GiB per export read; for renders one at a time per instance, ten a
minute per token, a scale of at most 3 and 16 384 px a side, and a 1 GiB heap for the render worker) are not
configurable; backend/README.md and [api.md](api.md#limits) list them.

**Memory.** A full instance needs about 300 MiB with its page budget full, plus, while a render runs, the
render worker's heap (at most 1 GiB) and about 10 bytes per PNG pixel up to `RENDER_MAX_PIXELS`. With the
defaults that fits 2 GiB, deploy.sh's default; on less, set `RENDER_API=false` or lower `RENDER_MAX_PIXELS`. A
render keeps the instance's one CPU busy for its duration (a few seconds for demo XL's overview), so other
requests on that instance wait meanwhile; further renders get `429 RENDER_BUSY` until Cloud Run adds an
instance (up to `--max-instances`).

**Locally.** `pnpm dev` starts the backend with `HOST=localhost` and `LOG_FORMAT=pretty` and reads
`backend/.env` when it exists (`backend/.env.example` documents each variable; none is needed for the demo).
After `pnpm build`, `pnpm --filter @gcportrait/backend start` runs the bundle the image runs, and reads the
environment only, not `backend/.env`.

## Service-account credentials

With `SA_MODE_ENABLED=true` the backend resolves its own identity at start-up, without a client library
(`backend/src/auth/identity.ts`), and stops with a message when it finds none it can use. These variables are
not part of the schema above; they are read only for this:

| Variable | Effect |
|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | a credentials file to use: an `impersonated_service_account` file (`gcloud auth application-default login --impersonate-service-account=YOUR_SA_EMAIL`) or a service-account key file. A person's own `authorized_user` credentials are refused. |
| `CLOUDSDK_CONFIG` | without the variable above: gcloud's configuration directory, where the application-default credentials file is looked for (default `~/.config/gcloud`) |
| `APPDATA` | the same on Windows (`%APPDATA%\gcloud`) |

Without a file, the metadata server answers: on Cloud Run, the service's own account. [permissions.md, "For
the instance's operator"](permissions.md#for-the-instances-operator) explains the mode.

## Environment on Cloud Run

`infra/deploy.sh` writes the service's whole environment on every run (`--env-vars-file`), so a variable set
by hand in the console is replaced at the next deploy; give it to deploy.sh as a flag instead.

| Variable | Set to |
|---|---|
| `TRUST_PROXY_HOPS` | `1` (requests always arrive through Cloud Run's front end) |
| `LOG_LEVEL` | `--log-level`, default `info` |
| `SA_MODE_ENABLED` | `true` with `--sa-mode`, else `false` |
| `SA_MODE_STRICT_EXPOSURE` | `true` with `--sa-strict-exposure`, else unset |
| `BACKEND_SA_EMAIL` | the backend account, `SERVICE-backend@PROJECT.iam.gserviceaccount.com`; unset with `--demo-only` |
| `DEMO_ONLY` | `true` with `--demo-only`, else unset |
| `LEGAL_BUNDLE` | built from `--legal-dir` (the texts' base64), else unset |
| `LEGAL_IMPRESSUM_URL`, `LEGAL_PRIVACY_URL` | `--impressum-url`, `--privacy-url`, else unset |
| `OAUTH_CLIENT_ID` | `--oauth-client-id`, else unset |
| `HOSTED_BY` | `--hosted-by`, else unset |
| `SOURCE_URL` | `--source-url`, else unset (the default above) |
| `RENDER_API` | `false` with `--no-render-api`, else unset (on; off with `--demo-only`) |
| `RENDER_MAX_ASSETS`, `RENDER_MAX_PIXELS`, `RENDER_TIMEOUT_MS`, `RENDER_MAX_BODY_BYTES` | `--render-env NAME=VALUE`, else unset (the defaults above) |
| `PORT` | 8080, by Cloud Run |
| `STATIC_DIR`, `APP_VERSION`, `NODE_ENV` | from the image |

## infra/install.sh

`curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project PROJECT_ID [flags]`, or `bash install.sh
--project PROJECT_ID [flags]` with the file downloaded first. It downloads the deploy scripts of a release
(`gcportrait-deploy-vX.Y.Z.tar.gz`), checks their SHA-256 against the release's `checksums.txt` before it
unpacks or runs anything, and runs their `infra/deploy.sh --image vX.Y.Z` with every flag below it does not
know ([self-host-options.md, "The installer"](self-host-options.md#the-installer)). Exit status: deploy.sh's,
or 1 when the installer refuses (a missing tool, a bad flag, `--build`, a download or a checksum that fails).

| Flag | Default | Effect |
|---|---|---|
| `--version TAG` | the newest release | The release to deploy, such as `v1.2.3` (`1.2.3` works too): its deploy scripts, and `--image TAG` for deploy.sh. The newest is GitHub's "latest" release, never a pre-release, found with the GitHub API or, when the API refuses, the redirect of `github.com/florianchrometz/gcportrait/releases/latest`. |
| `--dir PATH` | gcportrait-TAG in the current directory | Where the scripts are kept: a new or empty directory, or one that holds the same release already. Without it, `gcportrait-TAG-2` and so on when `gcportrait-TAG` holds other files. |
| `-h`, `--help` | | Usage. |

Needs curl, tar, `sha256sum` or `shasum`, and the Google Cloud CLI, each checked first. `--image` given to the
installer goes to deploy.sh in place of the release's own image; `--build` is refused (it needs a clone).

## infra/deploy.sh

`infra/deploy.sh --project PROJECT_ID [flags]`: `--project` is the only flag it needs. Declarative: each run
sets the service to what its flags say, and a flag left out gets its default. A run ends with the next steps
(open the address; create the OAuth client, with the console link and the origins; redeploy with
`--oauth-client-id`, the exact command), then the instance's settings and a command that repeats the current
setup; after `--build`, that command deploys the image just built with `--image` instead of building again.
The commands name the script by its path from the current directory (`gcportrait-vX.Y.Z/infra/deploy.sh` where
the installer kept it).

| Flag | Default | Effect |
|---|---|---|
| `--project ID` | required | The project to deploy into; billing must be enabled. |
| `--region REGION` | `europe-west3` | Region of the service and, with `--build`, of the build, repository and bucket. |
| `--service NAME` | `gcportrait` | Cloud Run service name, at most 22 characters (lowercase letters, digits, dashes). The other names derive from it (below), so several instances can share a project. |
| `--image TAG\|IMAGE` | `latest` of the published image | A tag deploys `ghcr.io/florianchrometz/gcportrait:TAG` (`PUBLISHED_IMAGE` in `infra/common.sh`), pulled through the Artifact Registry remote repository `ghcr` in the region, which deploy.sh creates once per project and region (`REGION-docker.pkg.dev/PROJECT/ghcr/florianchrometz/gcportrait:TAG`). A release's git tag works as well: `v1.2.3` deploys the image tag `1.2.3` and `v1.2` the tag `1.2`, as release.yml publishes them; `dev` is the maintainer's pre-release build. `ghcr.io/OWNER/NAME[:TAG\|@sha256:…]` pulls any public ghcr.io image the same way. Any other value with a `/` is used as a full image reference (tag or digest). A ghcr.io image is looked up on ghcr.io (with `curl`) before anything is changed; an Artifact Registry image is looked up with gcloud before anything is deployed (after the APIs are enabled and the backend's account is created). Excludes `--build`. |
| `--build` | off | Builds the checkout around the script with Cloud Build in the project and deploys that image. Needs a clone of the repository (the release's scripts from the installer refuse it) and `curl` (the build bucket is created through the Cloud Storage API). |
| `--build-machine TYPE` | `e2-highcpu-8` | Cloud Build machine type for `--build`. |
| `--oauth-client-id ID` | unset | `OAUTH_CLIENT_ID`. |
| `--hosted-by TEXT` | unset | `HOSTED_BY`; checked against the backend's rules before deploying. |
| `--iap` | off | Identity-Aware Proxy in front of the service instead of public access; a redeploy without it makes the service public again. Needs `curl`. User mode behind it is designed to work: the app sends the person's token in `X-Gcportrait-Token` ([self-host-options.md](self-host-options.md#private-instance-identity-aware-proxy)); try it with `--dry-run` first. |
| `--iap-members LIST` | your gcloud account | Comma-separated `user:`, `group:`, `serviceAccount:` or `domain:` principals granted `roles/iap.httpsResourceAccessor`; repeatable; added, never removed. Needs `--iap`. |
| `--sa-mode` | off | `SA_MODE_ENABLED=true`. |
| `--sa-strict-exposure` | off | `SA_MODE_STRICT_EXPOSURE=true`; needs `--sa-mode`. |
| `--log-level LEVEL` | `info` | `LOG_LEVEL`. |
| `--source-url URL` | unset | `SOURCE_URL`. |
| `--max-instances N` | `10` (`2` with `--demo-only`) | Upper bound of Cloud Run instances (1 to 999). |
| `--memory SIZE` | `2Gi` (`256Mi` with `--demo-only`) | Memory of each instance, `512Mi` to `4Gi` (Cloud Run's limit with one CPU). The render API's defaults fit 2 GiB; `RENDER_MAX_PIXELS=134217728` wants `4Gi` ([Memory](#backend-environment)). |
| `--no-render-api` | off | `RENDER_API=false`: no `POST /api/render`. Excludes `--render-env` and `--demo-only` (which has no render API anyway). |
| `--render-env NAME=VALUE` | unset | One of `RENDER_MAX_ASSETS`, `RENDER_MAX_PIXELS`, `RENDER_TIMEOUT_MS` (at most 840 000, below the 900 s request timeout) or `RENDER_MAX_BODY_BYTES`, checked against the backend's ranges before deploying. Repeatable, once per name. |
| `--demo-only` | off | `DEMO_ONLY=true`: a public demo without sign-in. Service name `gcportrait-demo` unless `--service` is given; only the `run`, `iam` and `artifactregistry` APIs; 256 MiB and 60 s per request instead of 2 GiB and 900 s; no render API. Excludes `--oauth-client-id`, `--sa-mode`, `--sa-strict-exposure`, `--iap`, `--no-render-api` and `--render-env`. |
| `--domain HOST` | unset | A Cloud Run domain mapping of `HOST` to the service with a Google-managed certificate, created through the Cloud Run Admin API (`curl`; no `gcloud beta` needed). Only in `asia-east1`, `asia-northeast1`, `asia-southeast1`, `europe-north1`, `europe-west1`, `europe-west4`, `us-central1`, `us-east1`, `us-east4`, `us-west1` (`DOMAIN_MAPPING_REGIONS` in `infra/common.sh`). Prints the DNS records, checks them in public DNS and waits for the certificate at most ten times 30 s. Kept on a redeploy without it. Excludes `--iap`. |
| `--impressum-url URL` | unset | `LEGAL_IMPRESSUM_URL`: link the Impressum on your own site instead of serving a text; an `https://` URL, checked as the backend checks it (deploy.sh also wants a host of letters, digits, dots and dashes, and no white space). Refused next to an `impressum.md` in `--legal-dir`. |
| `--privacy-url URL` | unset | `LEGAL_PRIVACY_URL`, likewise; refused next to a `privacy.md` in `--legal-dir`. |
| `--legal-dir PATH` | unset | `LEGAL_BUNDLE` from `PATH/impressum.md` and/or `PATH/privacy.md`, checked as the backend checks them, at most 11 KiB each (both travel in one environment variable). |
| `--dry-run` | off | Prints every change (`+ gcloud ...`) without making it; read-only queries still run. |
| `--verbose` | off | Also prints what the check of the running instance saw: the ready revision and the answers of `/api/healthz`, `/api/config` and `/`. Without it, one line says that the instance answers, with its version. |
| `-h`, `--help` | | Usage. |

**Fixed Cloud Run settings** (change them with `gcloud run services update` only if you accept that the next
deploy.sh run resets them): container port 8080, 1 CPU, memory from `--memory` (2 GiB; 256 MiB with
`--demo-only`), concurrency 80, min instances 0, request timeout 900 s (60 s with `--demo-only`), startup CPU
boost, ingress `all`, startup probe `GET /healthz` every 2 s (up to 15 failures), liveness probe `GET
/healthz` every 30 s (3 failures), service account = the backend account, label
`managed-by=gcportrait-deploy`. The probes reach the container directly; from outside, Cloud Run's front end
answers `/healthz` itself (it keeps paths ending in `z`), so deploy.sh's own check waits on `GET
/api/healthz`, which answers the same.

**APIs it enables when they are off**: `run`, `iam`, `cloudasset`, `cloudresourcemanager`, `artifactregistry`
(with `--demo-only` only `run`, `iam`, `artifactregistry`); with `--build` `cloudbuild` and `storage`; with
`--iap` `iap` (all `.googleapis.com`). Each one it enabled is recorded as the label
`gcportrait-api-NAME=enabled` on the service and, with `--build`, on the build repository.

**Retries.** deploy.sh repeats a call only when Google refuses it the way it does for a minute or two after a
service account or a grant is new: a grant naming an account that "does not exist" yet (up to 6 tries, 15 s
apart), a Cloud Build submission refused before a build exists (`PERMISSION_DENIED`, or `FAILED_PRECONDITION`
for the bucket; up to 5 tries, 30 s apart), a deploy that cannot see the new backend account yet (up to 4
tries, 20 s apart). A build that ran and failed, or a revision that does not start, ends the run at once.

## infra/uninstall.sh

`infra/uninstall.sh --project PROJECT_ID [flags]`

| Flag | Default | Effect |
|---|---|---|
| `--project ID` | required | The project the instance runs in. |
| `--region REGION` | `europe-west3` | Its region. |
| `--service NAME` | `gcportrait` | Its service name (the other names derive from it, as for deploy.sh). |
| `--disable-apis` | off | Also disables the APIs recorded on the service and the build repository as enabled by deploy.sh, one at a time, through the Service Usage API without disabling dependent APIs (one that another enabled API depends on is kept). Google's check for recent use is skipped (`checkIfServiceHasUsage: SKIP`), so pass it only when nothing else in the project uses those APIs. |
| `--yes` | off | No confirmation prompt; required without a terminal. |
| `--dry-run` | off | Lists what it would delete and prints the commands; deletes nothing. |
| `-h`, `--help` | | Usage. |

## Names and labels

For `--project PROJECT`, `--region REGION` and `--service SERVICE` (`infra/common.sh`, `derive_names`):

| Resource | Name | Marked by | Created |
|---|---|---|---|
| Cloud Run service | `SERVICE` in `REGION` | label `managed-by=gcportrait-deploy` | always |
| Backend service account | `SERVICE-backend@PROJECT.iam.gserviceaccount.com` | description starting "Created by gcportrait infra/deploy.sh for the Cloud Run service SERVICE" | unless it exists |
| Build service account | `SERVICE-build@PROJECT.iam.gserviceaccount.com` | the same description form | `--build` |
| Docker repository | `REGION-docker.pkg.dev/PROJECT/SERVICE-builds`, cleanup policy: keep the 5 newest | label `managed-by=gcportrait-deploy` (and the `gcportrait-api-NAME=enabled` labels) | `--build` |
| Build bucket | `gs://PROJECT-SERVICE-builds` in `REGION`: uniform access, public access prevention, no soft delete, objects deleted after 14 days | label `managed-by=gcportrait-deploy`, set in the same request that creates the bucket; bucket names are global, so deploy.sh uses an existing one, and uninstall.sh deletes it, only when it also belongs to `PROJECT` | `--build` |
| Images | `REGION-docker.pkg.dev/PROJECT/SERVICE-builds/gcportrait:UTCDATE-UTCTIME-VERSION` | in the repository | each `--build` |
| Remote repository | `REGION-docker.pkg.dev/PROJECT/ghcr` (`REMOTE_REPO`), a Docker remote repository of `https://ghcr.io` (`REMOTE_UPSTREAM`), one per project and region, shared by the instances there; it keeps every image it fetched | label `managed-by=gcportrait-deploy`; an unlabelled remote repository of ghcr.io of that name is used but never changed or deleted. uninstall.sh deletes a labelled one only when no other Cloud Run service or job of the project has an image from it | without `--build`, or `--image` with a release tag or a `ghcr.io/...` image, when it does not exist yet |
| Domain mapping | `HOST` in `REGION`, routing to `SERVICE` | the service it routes to (uninstall.sh deletes the mappings to the service it deletes) | `--domain` |

IAM bindings deploy.sh adds, all on resources it created: the build account gets `roles/storage.admin` on the
bucket (the role Google documents for a build account with logs in a bucket of the user's; Cloud Build reads
the bucket itself before it accepts a build) and `roles/artifactregistry.writer` on the repository; `allUsers`
(public) or the IAP service agent (`--iap`) gets `roles/run.invoker` on the service; each `--iap-members`
principal gets `roles/iap.httpsResourceAccessor` on the service. Nothing at project level or above.

## The image

`infra/Dockerfile`, built from the repository root (`.dockerignore` keeps the context to the workspace
sources).

| | |
|---|---|
| Build arguments | `APP_VERSION` (default `dev`; the release workflow passes the tag, or `dev-SHA` when run by hand, `deploy.sh --build` the output of `git describe`, the Cloud Run Button's hook `git describe --tags --always`) |
| Base images | `node:22.23.3-bookworm-slim` (build stage) and `gcr.io/distroless/nodejs22-debian12:nonroot` (runtime), both pinned by digest on literal `FROM` lines, which Dependabot keeps up to date (`.github/dependabot.yml`) |
| Environment | `NODE_ENV=production`, `PORT=8080`, `STATIC_DIR=/app/frontend/dist`, `APP_VERSION` from the build argument |
| Files | `/app/backend/dist/server.mjs` (the backend and its npm dependencies bundled by `backend/bundle.ts`), its source map, `/app/backend/dist/render-worker.mjs` and its map (the render API's worker, started per render: [api.md](api.md#post-apirender)), `/app/backend/dist/render-assets/` (resvg's WebAssembly module and the Roboto faces it draws with, with their licences), `/app/backend/dist/licenses/server-dependencies.txt`, `/app/backend/package.json`, `/app/frontend/dist/` (the SPA with its `licenses/`, `THIRD_PARTY_NOTICES.txt` among them: every third-party package in the app and the server with its notices, served at `/licenses/THIRD_PARTY_NOTICES.txt`; the build fails without it), `/app/LICENSE` (Apache-2.0, with its note on the gcportrait name and icon), `/app/NOTICE`, `/app/brand/LICENSE.md`, `/app/THIRD_PARTY.md` |
| Command | `node --enable-source-maps /app/backend/dist/server.mjs` (the base image's entrypoint is node) |
| User | `65532:65532` (the base image's `nonroot`); nothing in `/app` is writable, so the container runs with a read-only root filesystem |
| Port | 8080 |
| Health | `HEALTHCHECK`: Node fetches `http://127.0.0.1:$PORT/healthz` every 30 s (Docker, compose). Cloud Run ignores it and uses deploy.sh's startup and liveness probes on the same path, which reach the container directly; from outside a Cloud Run service, `/healthz` gets the front end's own 404, so check `/api/healthz` there. |
| Labels | `org.opencontainers.image.title=gcportrait`, `.description` = the long form of the non-affiliation statement, `.licenses=Apache-2.0`, `.version` = `APP_VERSION`; the release workflow adds source, revision and creation time |

## Local runs with compose

`infra/compose.yaml` (`pnpm docker:build`, then `pnpm docker:run`). Compose reads these from the shell or from
`infra/.env` (git-ignored):

| Variable | Default | Effect |
|---|---|---|
| `GCPORTRAIT_IMAGE` | `gcportrait:local` | The image to run (`pnpm docker:build` builds this tag). |
| `GCPORTRAIT_PORT` | `8080` | Host port, bound to 127.0.0.1 only. |
| `OAUTH_CLIENT_ID`, `HOSTED_BY`, `SOURCE_URL`, `DEMO_ONLY`, `LOG_LEVEL` | unset, `info` | Passed to the backend as above. |
| `RENDER_API`, `RENDER_MAX_ASSETS`, `RENDER_MAX_PIXELS`, `RENDER_TIMEOUT_MS`, `RENDER_MAX_BODY_BYTES` | unset | Passed to the backend as above: the render API is on, with its default limits. |

Fixed: `SA_MODE_ENABLED=false` (the container has no service-account identity), `TRUST_PROXY_HOPS=0`,
read-only root filesystem, all capabilities dropped, `no-new-privileges`.

## Cloud Run Button

The "Run on Google Cloud" button ([self-host-options.md, "Run on Google
Cloud"](self-host-options.md#run-on-google-cloud)) reads `app.json` at the repository root. It asks for two
variables and deploys with fixed options; its `postcreate` hook, `infra/cloud-run-button.sh`, then adds what
the button cannot set.

| Item | Value |
|---|---|
| Asked: `OAUTH_CLIENT_ID` | default `none` (the button does not accept an empty answer); the hook removes it while it is `none` |
| Asked: `SA_MODE_ENABLED` | default `false` |
| Options of `app.json` | public (`allow-unauthenticated`), 1 CPU, 2 GiB (the render API's default limits fit it), port 8080, 80 concurrent requests, at most 10 instances; the image is built from `infra/Dockerfile` in Cloud Shell (`prebuild` hook, `APP_VERSION` from `git describe --tags --always`) |
| Set by the hook | `TRUST_PROXY_HOPS=1`, request timeout 900 s, startup CPU boost, at most 10 instances (the button's own setting does not apply), the startup and liveness probes on `GET /healthz` |
| The hook reads | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_REGION`, `K_SERVICE`, `SERVICE_URL` (the button sets them), and `OAUTH_CLIENT_ID` |

The service runs as the project's Compute Engine default service account and carries no `managed-by` label, so
deploy.sh and uninstall.sh leave it alone. Run against the same project and region, deploy.sh first enables
whichever of the APIs it needs are still off (the hook enables none), then stops before it creates or deploys
anything. It prints the `gcloud run services update … --update-labels=managed-by=gcportrait-deploy` command
that hands the service over and, when it enabled APIs, the `gcloud services disable …` command for them in
case you give up instead. Once you have run the hand-over command yourself, deploy.sh manages the service
([self-host-options.md, "Run on Google Cloud"](self-host-options.md#run-on-google-cloud)).

## Release workflow

`.github/workflows/release.yml` on `v*` tags, and by hand (workflow_dispatch) for a `dev` image. It needs no
secret and no repository variable: the workflow's own `GITHUB_TOKEN` (`packages: write` for the image,
`contents: write` for the release) does everything. [contributing.md, "9.
Releases"](contributing.md#9-releases) has the one-time step (making the package public).

| Item | Value |
|---|---|
| Image | `ghcr.io/OWNER/gcportrait` (`OWNER` the repository's owner, lowercase), `linux/amd64` and `linux/arm64`; equal to `PUBLISHED_IMAGE` in `infra/common.sh` for the project's own repository |
| Tags | `X.Y.Z`, `X.Y`, and `latest` when the tag is the newest release (the highest `vX.Y.Z` tag; never a pre-release); a pre-release such as `v1.0.0-rc.1` gets its own version tag only (`1.0.0-rc.1`); `dev` when run by hand |
| Checks before the push | each platform's image is started: `/healthz` reports the version (the tag, or `dev-SHA`), `/api/config` and the SPA answer |
| After the push | an anonymous pull check (fails a tag release while the package is not public), one SPDX SBOM per platform (Syft, pinned by version and SHA-256 in the workflow) |
| GitHub release | `vX.Y.Z` with notes from `scripts/release-notes.mjs` (the version's `## X.Y.Z` section of `CHANGELOG.md`, else the commits since the previous release tag, with the long non-affiliation statement, the installer line, the image's tags and digest); tags only. A pre-release tag makes a GitHub pre-release, not marked latest, and takes the section of `X.Y.Z` when it has none of its own |
| Release assets | the SBOMs; `gcportrait-deploy-vX.Y.Z.tar.gz`, the deploy scripts `infra/install.sh` downloads (`VERSION` and `infra/` with `deploy.sh`, `common.sh`, `uninstall.sh`, `install.sh`, `README.md`); `checksums.txt`, the SHA-256 of every other asset (`scripts/release-assets.sh` writes the last two) |

## SPA build

Read by Vite when the frontend is built (`frontend/README.md`); the image builds the SPA without them.

| Variable | Default | Effect |
|---|---|---|
| `VITE_DEMO` | unset | `1` serves the app as a demo build: a demo-only instance's configuration built in, no backend calls; `pnpm dev:demo` sets it. |
| `VITE_SOURCE_URL` | `https://github.com/florianchrometz/gcportrait` | The footer's source link when no backend answers (a demo build); the image's app takes `SOURCE_URL` from `/api/config`. |
| `VITE_STATIC_DEMO` | unset | `1` builds the static demo: the same demo build, its configuration built in instead of `/api/config`, below `/demo/`, for a static host ([website.md, "The demo"](website.md#the-demo)). `pnpm demo:static` sets it with the three below; not together with `VITE_DEMO`. |
| `VITE_APP_VERSION` | `git describe` (by `pnpm demo:static`) | The static demo's version (`--app-version`). |
| `VITE_LEGAL_IMPRESSUM_URL` | the maintainer's Impressum (by `pnpm demo:static`) | The Impressum the static demo's footer links (`--impressum-url`; an `https://` URL, anything else links nothing), as `LEGAL_IMPRESSUM_URL` does for an instance. |
| `VITE_LEGAL_PRIVACY_URL` | the maintainer's privacy notice (by `pnpm demo:static`) | The same for the privacy notice (`--privacy-url`). |
