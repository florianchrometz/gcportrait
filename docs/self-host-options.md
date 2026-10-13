<!-- SPDX-License-Identifier: MIT -->

# Self-hosting options

Everything the [self-hosting guide](self-host.md) leaves at its default, and how to run, check and remove an
instance. Each option says what it is for, its flag, its default and gives an example; none of them is needed
for a working instance. [configuration.md](configuration.md) is the reference of every flag and environment
variable, [modes.md](modes.md) says what an instance offers its users, and [permissions.md](permissions.md)
what they need to read a scope.

| Section | For |
|---|---|
| [Running the commands on this page](#running-the-commands-on-this-page) | Where to run them, and how a flag reaches deploy.sh. |
| [The installer](#the-installer) | What `install.sh` downloads and checks before it runs anything, its own options, its limits. |
| [Region and service name](#region-and-service-name) | Another region; several instances in one project. |
| [Memory, instances and logs](#memory-instances-and-logs) | Memory per instance, the most instances, the log level. |
| [Who runs the instance](#who-runs-the-instance) | The "Hosted by" line people see before they sign in. |
| [The OAuth client in detail](#the-oauth-client-in-detail) | Every console screen of "Sign in with Google", sign-in errors, and what enabling sign-in makes you responsible for. |
| [Private instance: Identity-Aware Proxy](#private-instance-identity-aware-proxy) | Only listed people can open the instance. |
| [Service-account mode](#service-account-mode) | A team grants the instance's account read access once, instead of every person. |
| [Demo-only instance](#demo-only-instance) | A public, sign-in-free demo of your own with the demo organisations only. |
| [Custom domain](#custom-domain) | Your own host name, with a Google-managed certificate, and the DNS records to create. |
| [Legal pages: link or serve](#legal-pages-link-or-serve) | An Impressum and a privacy notice: links to your own pages, or texts the instance serves. |
| [The render API](#the-render-api) | Turning `POST /api/render` off, or changing its limits. |
| [Updating, pinning and rolling back](#updating-pinning-and-rolling-back) | Image tags, releases, Cloud Run's revisions. |
| [Building from source](#building-from-source) | The "Run on Google Cloud" button, `--build` from a clone, the image on your machine. |
| [What deploy.sh does](#what-deploysh-does) | Every API, account, role and resource it touches, what it never does, and the roles you need to run it. |
| [Uninstall in detail](#uninstall-in-detail) | What uninstall.sh deletes and keeps, and `--disable-apis`. |
| [Costs](#costs), [Logs](#logs), [Troubleshooting](#troubleshooting) | |

## Running the commands on this page

The commands below name the scripts as `infra/deploy.sh` and `infra/uninstall.sh`: run them in the folder the
installer kept (`cd gcportrait-vX.Y.Z`), or as `gcportrait-vX.Y.Z/infra/deploy.sh` from where you ran the
installer (in a clone of the repository, from its root). Without `--image`, deploy.sh deploys the newest
release, so a release you pinned with the installer's `--version` stays pinned only when these commands carry
`--image vX.Y.Z`, as the "Redeploy with the same settings" line deploy.sh prints at its end does.

Every deploy.sh flag also works on the installer line, which passes it on and deploys the newest release, for
example `curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project YOUR_PROJECT --region
europe-west1`. deploy.sh is declarative: each run sets the service to what its flags say, and a flag left out
gets its default, so keep the flags of your instance on every run and add the new one. `--dry-run` prints
every change without making it.

The `gcloud` commands on this page use the defaults, the service `gcportrait` in `europe-west3`: if you
deployed with `--service` or `--region`, put yours in their place.

## The installer

`https://gcportrait.app/install.sh` is [`infra/install.sh`](../infra/install.sh), served by the website as it
is in the repository. It prints each step as it goes:

1. It checks for curl, tar, `sha256sum` or `shasum`, and gcloud, and names the one that is missing.
2. It finds the newest release with GitHub's API, or, when the API refuses (it allows 60 requests an hour
   without a token), from where `github.com/florianchrometz/gcportrait/releases/latest` leads. `--version
   vX.Y.Z` names a release instead.
3. It downloads the release's `gcportrait-deploy-vX.Y.Z.tar.gz`, the deploy scripts (`infra/deploy.sh`,
   `common.sh`, `uninstall.sh`, `install.sh` and `README.md`, and `VERSION` with the tag), and its
   `checksums.txt`.
4. It checks the archive's SHA-256 against `checksums.txt` before it unpacks anything. When a download fails,
   the list does not name the archive or the checksum differs, it stops: nothing is unpacked or run.
5. It keeps the scripts in `gcportrait-vX.Y.Z` in the current directory. A folder that holds the same release
   already is used as it is; one with other files is left alone, and the scripts go to `gcportrait-vX.Y.Z-2`.
6. It runs `gcportrait-vX.Y.Z/infra/deploy.sh --image vX.Y.Z` with every other argument, so the instance runs
   the release the scripts came from. Its exit status is deploy.sh's.

| Option | Default | What it does |
|---|---|---|
| `--version TAG` | the newest release | Deploys that release, such as `v1.2.3`: its deploy scripts and its image. |
| `--dir PATH` | `gcportrait-TAG` in the current directory | Keeps the scripts there: a new or empty directory, or one that holds the same release. |

Every flag of deploy.sh passes through; `--image` replaces the release's own image, and `--build` is refused,
as it builds the image from a clone of the source ([Building from source](#building-from-source)).

Its limits: it needs a published release that carries the deploy archive and `checksums.txt`, and stops before
anything runs when the release lacks either. In a browser, `https://gcportrait.app/install.sh` downloads as a
file instead of showing, because GitHub Pages serves it as a shell script; curl reads it either way. To read
the script before you run it, download it first:

```sh
curl -fsSL https://gcportrait.app/install.sh -o install.sh
bash install.sh --project YOUR_PROJECT --dry-run
```

## Region and service name

The region decides where the service runs, and with `--build` where the image is built and kept; the service
name decides every name deploy.sh derives (the account, the build repository and bucket), so several instances
can share a project.

| Flag | Default | |
|---|---|---|
| `--region REGION` | `europe-west3` | Any Cloud Run region; a [custom domain](#custom-domain) needs one with domain mappings. |
| `--service NAME` | `gcportrait` (`gcportrait-demo` with `--demo-only`) | At most 22 characters: lowercase letters, digits, dashes. |

```sh
infra/deploy.sh --project YOUR_PROJECT --region europe-west1 --service gcportrait-eu
```

uninstall.sh needs the same `--region` and `--service` to find the instance again.

## Memory, instances and logs

| Flag | Default | |
|---|---|---|
| `--memory SIZE` | `2Gi` (`256Mi` with `--demo-only`) | Memory of each instance, `512Mi` to `4Gi`. The render API's defaults fit 2 GiB; on less, turn it off or lower its limits ([The render API](#the-render-api)). |
| `--max-instances N` | `10` (`2` with `--demo-only`) | The most Cloud Run instances at once, 1 to 999. A low number caps what a public instance can cost. |
| `--log-level LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` ([Logs](#logs)). |

```sh
infra/deploy.sh --project YOUR_PROJECT --memory 1Gi --max-instances 3 --no-render-api
```

The other Cloud Run settings (1 CPU, 80 concurrent requests, the 900 s request timeout, the probes) are fixed;
[configuration.md](configuration.md#infradeploysh) lists them.

## Who runs the instance

`--hosted-by "NAME"` (default: unset) shows who runs the instance before people sign in, as "Hosted by NAME.":
your team's or company's name, plain text on one line, at most 80 characters, without `<` or `>`, never naming
Google. deploy.sh checks it as the backend does before it deploys. Add it to the command you deploy with, as
any other flag.

## The OAuth client in detail

"Sign in with Google" uses Google Identity Services' token client in the browser. It needs an OAuth 2.0 client
of the type **Web application**, created in the Google Cloud project that runs your instance, and nothing
else:

- **Only the client id is used.** It is public: the backend reports it in `GET /api/config` and the browser
  hands it to Google. The client secret is never used; do not copy it anywhere.
- **Authorised JavaScript origins** must list every address people open the instance at.
- **No redirect URI.** The token client never redirects: Google's sign-in window hands the token back to the
  page that opened it. Leave "Authorised redirect URIs" empty.
- **Three scopes**, which the app requests when someone signs in:
  `https://www.googleapis.com/auth/cloud-platform.read-only` (Resource Manager: the scope picker, the
  preflight and the service-account gate), `https://www.googleapis.com/auth/cloudasset` (Cloud Asset Inventory
  refuses a token without it or `cloud-platform`) and
  `https://www.googleapis.com/auth/userinfo.email` (the account menu shows the email address).

Google offers no command-line or API way to create this kind of client, so it is the one console step. In the
Google Cloud console the consent screen and the clients live under **Google Auth Platform**; menu names change
from time to time, the settings do not.

### For your own instance (a company, a team, yourself)

1. Open the [Google Cloud console](https://console.cloud.google.com/) and select the project that runs
   gcportrait (the one with the Cloud Run service). deploy.sh prints the direct link,
   `https://console.cloud.google.com/auth/clients?project=YOUR_PROJECT`.
2. Open **Google Auth Platform** (search for it, or **APIs & Services** › **OAuth consent screen**). If the
   project has no consent screen yet, choose **Get started**:
   - **App information.** App name: `gcportrait`, or a name of your own that does not contain "Google". User
     support email: an address of yours.
   - **Audience.** **Internal** when only accounts of your own Google Workspace or Cloud Identity organisation
     will sign in (the project must belong to that organisation; Google does not review Internal apps).
     **External** otherwise; it starts in testing, where only the test users you list (up to 100) can sign in.
   - **Contact information.** An address Google can write to about the app.
   - Accept the Google API Services User Data Policy and choose **Create**.
3. **Data Access** › **Add or remove scopes** › **Manually add scopes**: paste the three scopes above, one per
   line, choose **Add to table**, then **Update** and **Save**. The page lists which of them Google treats as
   sensitive or restricted.
4. **Clients** › **Create client**:
   - Application type: **Web application**. Name: for example `gcportrait web`.
   - **Authorised JavaScript origins** › **Add URI**, once per address, as scheme and host (and port, when
     there is one), with no path and no trailing slash:
     - the Cloud Run address deploy.sh printed, `https://SERVICE-PROJECT_NUMBER.REGION.run.app`, for example
       `https://gcportrait-123456789012.europe-west3.run.app` (Cloud Run also answers on an older
       `https://SERVICE-HASH-REGION_CODE.a.run.app` address, which deploy.sh prints as "Also answers on"; add
       it too if people use it);
     - your own domain, if you map one to the service ([Custom domain](#custom-domain)), for example
       `https://gcportrait.example.com`;
     - for development only: `http://localhost:5173` (`pnpm dev`) and `http://localhost:8080` (the backend
       serving a build, or [the image run locally](#run-the-image-locally)). Google allows plain `http` for
       `localhost` only.
   - **Authorised redirect URIs**: none.
   - Choose **Create** and copy the **Client ID**, `PROJECT_NUMBER-RANDOM.apps.googleusercontent.com`.
     Close the dialog without downloading the secret.
5. Give the client id to the instance: run deploy.sh again with your flags plus `--oauth-client-id`, and
   `--hosted-by "NAME"` if you want to show who runs it ([Who runs the instance](#who-runs-the-instance)):

   ```sh
   infra/deploy.sh --project YOUR_PROJECT --oauth-client-id YOUR_OAUTH_CLIENT_ID
   ```

   For local development put both into `backend/.env` (see `backend/.env.example`).
6. Check: the instance's address with `/api/config` added names the client id, and the Connect page's "Sign in
   with Google" is no longer marked "not configured". Sign in once: Google's window lists the three
   permissions, and afterwards the account menu at the top right shows your email address.

**If sign-in fails at once.** When the app says Google's window "was closed before the sign-in finished, or
Google showed an error in it", look at Google's window: an error such as `origin_mismatch` or
`redirect_uri_mismatch` means the address in your browser's address bar is not among the client's authorised
JavaScript origins (compare scheme, host and port exactly; changes can take a few minutes to apply), and
`invalid_client` means `OAUTH_CLIENT_ID` does not name a client of this project. When the app says the browser
blocked Google's window, allow pop-ups for the instance's address.

**Signing out.** "Sign out" revokes gcportrait's access with Google, and Google's revocation withdraws the
account's whole grant to the instance's OAuth client, not just one token: other tabs signed in with the same
account end their session at their next request ("Session expired"), and the next sign-in shows Google's
consent screen again.

There is no hosted sign-in instance of gcportrait: the project hosts its website and a sign-in-free demo, and
whoever wants to read their own Google Cloud runs their own instance with their own OAuth client, as above.

### If you enable sign-in

You are the operator of your instance, not the gcportrait project. With an OAuth client, people sign in to it
with their Google accounts: their tokens pass through your backend to Google, the assets they read stream
through it to their browsers, Cloud Run's request log records their IP addresses ([Logs](#logs)), and in
service-account mode an audit line records a hash of each caller's email
([Service-account mode](#service-account-mode)). Whatever notices and obligations come with offering that to
others are yours. What Google asks of you depends on the audience of the consent screen
([Manage App Audience](https://support.google.com/cloud/answer/15549945)):

- **Internal**: only accounts of your own Google Workspace or Cloud Identity organisation can sign in, and the
  app needs no verification by Google: its page on [sensitive scope
  verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
  lists use only within your organisation among the cases that need none.
- **External**: in testing, only the test users you list (up to 100) can sign in. To let any Google account
  sign in, you publish the app to production, and because gcportrait asks for scopes Google treats as
  sensitive (the Data Access page marks them), Google's verification applies: until it is complete, people see
  the [unverified app](https://support.google.com/cloud/answer/7454865) screen and the app is limited to 100
  new users. Verification asks, among other things, for a privacy policy that is hosted on the domain of the
  app's home page, is linked from the consent screen and says how the app accesses, uses, stores and shares
  Google user data ([verification requirements](https://support.google.com/cloud/answer/13464321)).

The project offers no such privacy policy: [docs/legal/](legal/README.md) lists only what the project's
website and sign-in-free demo process, which is no Google user data. Check Google's pages above before you
rely on them: they change from time to time.

## Private instance: Identity-Aware Proxy

Optional. By default the service is public, which is safe in the sense that reading any Google Cloud data
still needs a person's own sign-in and roles. `--iap` (default: off) makes it private instead: Cloud Run's
built-in Identity-Aware Proxy (IAP) lets only the principals of `--iap-members` (`user:`, `group:`,
`serviceAccount:` or `domain:`; default: your own gcloud account) open it, and signs them in with Google
before the app loads.

```sh
infra/deploy.sh --project YOUR_PROJECT --iap --iap-members user:ana@example.com,group:cloud-team@example.com
```

deploy.sh enables the IAP API, creates IAP's service agent, allows it to invoke the service, and grants each
principal `roles/iap.httpsResourceAccessor` on the service. People still sign in to the app itself to read
Google Cloud data with their own roles (user mode), or use [service-account mode](#service-account-mode)
inside.

- **Principals are added, never removed**, so a redeploy cannot lock anyone out by accident. To remove one:
  `gcloud iap web remove-iam-policy-binding --project=YOUR_PROJECT --resource-type=cloud-run
  --service=gcportrait --region=europe-west3 --member=user:ana@example.com
  --role=roles/iap.httpsResourceAccessor`.
- IAP's Google-managed sign-in lets in accounts of the project's own organisation; for accounts outside it,
  IAP needs an OAuth client of your own (see Google's IAP documentation for Cloud Run).
- A redeploy without `--iap` makes the service public again.
- **User mode behind IAP** is designed to work:
  IAP treats the `Authorization` header as the place for its own credential, so the app never puts the
  person's Google token there: every `/api/*` call carries it in a header of gcportrait's own,
  `X-Gcportrait-Token`, a header IAP has no use for and is meant to pass on as sent. IAP's cookie decides who
  may open the instance; the token and the person's own IAM roles decide what they may read. The backend still
  accepts `Authorization: Bearer TOKEN` from a request without `X-Gcportrait-Token`, the path for scripts
  against a public instance (behind IAP, such a script needs IAP's own credentials as well, see Google's IAP
  documentation on programmatic access). Neither header is ever logged, and the token header is not a cookie:
  the browser neither stores it nor sends it by itself.
- Try `--iap` with `--dry-run` first, which prints every step of it, the IAP service-identity request
  included. If, behind IAP, every API call answers 401 "Invalid IAP credentials", the app's requests still
  carry an `Authorization` header, as builds before the token header did: redeploy a current release.

## Service-account mode

In user mode (the default) every person reads what their own Google account may read. In service-account mode
a team grants the instance's backend account read access to a scope once, and people who can see that scope
and sign in to the instance read it through the account. Deploy with `--sa-mode` (default: off); a scope's
owner then grants the account `roles/cloudasset.viewer` on that scope, and nothing more. deploy.sh prints the
account as "Service account" (`gcportrait-backend@` and the project's id), the app's Permissions page shows it
too, and [permissions.md, "The grant"](permissions.md#the-grant) has the commands for an organisation, a
folder and a project.

```sh
infra/deploy.sh --project YOUR_PROJECT --oauth-client-id YOUR_OAUTH_CLIENT_ID --sa-mode
```

- **The gate.** Before every call as the account, the backend checks that the signed-in person can `get` the
  scope with their own token; there is no setting that skips it ([permissions.md, "The
  gate"](permissions.md#the-gate)). `--sa-strict-exposure` also refuses a scope whose details
  the account can read itself (a public `get`, or more roles than `cloudasset.viewer`): see backend/README.md,
  "Service-account mode".
- **Prefer folders and projects to the organisation.** Anyone who can see the scope and sign in can read its
  whole inventory through the account, including projects they cannot open themselves; in many organisations
  every member of the domain can see the organisation itself. Grant `roles/cloudasset.viewer` only: a role
  with `resourcemanager.*.get` (Browser, Viewer) on the scope makes the strict exposure check refuse it.
- The account's calls are charged to the instance's project, which is why deploy.sh enables the Cloud Asset
  and Resource Manager APIs there; the account needs no role in its own project for that.
- On a laptop, service-account mode needs the account's credentials through Application Default Credentials;
  see backend/README.md. The [local image](#run-the-image-locally) runs without it.

## Demo-only instance

A demo-only instance lets people try gcportrait without signing in and without any Google Cloud data: the app
with its synthetic demo organisations S, M, L and XL (generated in each visitor's browser and kept there), the
timeline, search and export, and nothing else. This is for your own instance, for example to show gcportrait
inside your company with your own legal pages ([Legal pages: link or serve](#legal-pages-link-or-serve)). The
project's own demo at <https://gcportrait.app/demo/> is not one: it is a static build of the app with the same
behaviour, served by the website's GitHub Pages site without any server (`pnpm demo:static`, [website.md, "The
demo"](website.md#the-demo)). A
static build of your own, for any static host, works the same way: `pnpm demo:static --base /PATH/
--impressum-url URL --privacy-url URL` writes it to `dist/demo/`; it has no response headers, so its Content
Security Policy is a `<meta>` without `frame-ancestors`, and it is not cross-origin isolated.

`--demo-only` (default: off):

```sh
infra/deploy.sh --project YOUR_PROJECT --region europe-west1 --demo-only
```

What it changes:

- **The backend** runs with `DEMO_ONLY=true`. `/api/config` reports `"demoOnly":true`, no OAuth client, no
  service-account mode and no account. The four routes that call Google (`/api/scopes/search`,
  `/api/preflight`, `/api/assets/stream`, `/api/export/read`) are not registered, so they answer a JSON 404
  like any unknown route; the rate limits, the health checks, `/api/config`, `/api/legal` and the app stay.
  The Content Security Policy allows no Google host. An `OAUTH_CLIENT_ID` or `SA_MODE_ENABLED=true` next to
  `DEMO_ONLY=true` stops start-up.
- **The app** shows a Connect page with only "Try the demo" (S to XL), a link "Deploy gcportrait to your own
  Google Cloud project" to the self-hosting guide on `gcportrait.app`, and a note that the demo processes no
  personal data; the top bar carries the "Demo mode" badge.
- **deploy.sh** names the service `gcportrait-demo` unless you pass `--service`, enables only the `run`, `iam`
  and `artifactregistry` APIs, gives the service its own account with no role (as for any instance; it
  publishes it nowhere), and sets 256 MiB, 60 s per request and at most 2 instances (`--max-instances`
  overrides it). The service is public. It refuses `--oauth-client-id`, `--sa-mode` and `--iap` together with
  `--demo-only`.

Check it from outside (its address with `/api/config` added says `"demoOnly":true`), and remove it with
`infra/uninstall.sh --project YOUR_PROJECT --region europe-west1 --service gcportrait-demo`. Without Cloud
Run, build the app once with `pnpm build`, then run `DEMO_ONLY=true pnpm --filter @gcportrait/backend start`
and open <http://localhost:8080>; with compose, put `DEMO_ONLY=true` into `infra/.env`. For a demo on your
laptop without any backend there is also `pnpm dev:demo` (the build-time demo mode), and for one on a static
host the static build above. A public demo usually needs an Impressum and a privacy notice: [Legal pages: link
or serve](#legal-pages-link-or-serve) (deploy.sh's next steps say how when a demo-only deploy has neither).

## Custom domain

`--domain HOST` (default: unset) serves the instance at a host name of yours as well, with a certificate
Google manages, through a Cloud Run domain mapping:

```sh
infra/deploy.sh --project YOUR_PROJECT --region europe-west1 --demo-only --domain demo.example.com
```

1. **A region with domain mappings.** Cloud Run offers them in `asia-east1`, `asia-northeast1`,
   `asia-southeast1`, `europe-north1`, `europe-west1`, `europe-west4`, `us-central1`, `us-east1`, `us-east4`
   and `us-west1` (Google's list), not in `europe-west3`; deploy.sh refuses `--domain`
   elsewhere before it changes anything. Google calls domain mappings a Preview, "not production-ready",
   because of latency.
2. **Verify the domain** in Google Search Console with the account gcloud uses:
   `gcloud domains verify example.com` opens Search Console; choose the Domain property and create the TXT
   record it shows at your DNS provider. `gcloud domains list-user-verified` lists it once Google has seen the
   record. Verifying `example.com` covers every name under it. Until then deploy.sh deploys the service, skips
   the mapping and prints these steps.
3. **Run deploy.sh with `--domain`.** It creates the mapping and prints the DNS record Google asks for, in
   zone-file form and as most DNS providers ask for it, for a subdomain typically
   `demo.example.com.  3600  IN  CNAME  ghs.googlehosted.com.` (name `demo` in the zone `example.com`).
   Create it. deploy.sh looks the record up in public DNS (Google Public DNS over HTTPS); once it is there,
   Google provisions the certificate, usually within 15 minutes and up to 24 hours. deploy.sh waits for it at
   most ten times 30 s and says where things stand; nothing more needs to run. Check later with
   `curl -sI https://demo.example.com/api/healthz`, with your host name.
4. **Sign-in instances:** add `https://` and your host name to the OAuth client's authorised JavaScript
   origins (deploy.sh lists it among the origins).

When the host is mapped to another service, deploy.sh stops before it creates or deploys anything (the APIs
it needs may be enabled by then; it names those it enabled and the command that disables them) and prints the
command that frees the host. The mapping stays when you redeploy without `--domain`; `infra/uninstall.sh`
deletes every mapping that routes to the service it deletes. The DNS records are yours to remove.

**A region without domain mappings**, or a production instance: put a global external Application Load
Balancer with a serverless network endpoint group and a Google-managed certificate in front of the service
(Google's guide "Set up a global external Application Load Balancer with Cloud Run"). deploy.sh does not
automate it. Its forwarding rule alone costs about $18 a month ($0.025 an hour), which is why deploy.sh offers
a domain mapping in a region that has them instead.

## Legal pages: link or serve

Whoever runs a public instance may have to name themselves and say what happens with personal data (in
Germany, an Impressum and a privacy notice; even a sign-in-free demo's hosting keeps request logs with
visitors' IP addresses). gcportrait offers two ways, for each page on its own (default: neither):

- **Link pages you publish elsewhere**, such as on your own website, with `--impressum-url` and
  `--privacy-url` (`LEGAL_IMPRESSUM_URL`, `LEGAL_PRIVACY_URL`). Each must be an `https://` URL without a user
  name or password, at most 2048 characters; deploy.sh checks that as the backend does. The backend reports
  them in `/api/config`, as `legal.impressumUrl` and `legal.privacyUrl` (null when unset), and the app's
  footer links them as "Impressum · Privacy" (each in the same tab, marked as a link to another site; the
  Connect page of a demo-only instance links the privacy notice too, and `/impressum` and `/privacy` lead
  there).
- **Serve texts** you keep outside the repository, with `--legal-dir`: the instance shows them at `/impressum`
  and `/privacy`, linked as "Impressum · Privacy" in the footer of every page, next to the non-affiliation
  notice and the source link (below).

```sh
infra/deploy.sh --project YOUR_PROJECT --region europe-west1 --demo-only \
  --impressum-url https://example.com/legal/impressum --privacy-url https://example.com/legal/privacy
```

A page is linked or served, not both: deploy.sh refuses `--impressum-url` next to an `impressum.md` in
`--legal-dir` (and `--privacy-url` next to a `privacy.md`) before it changes anything, and the backend refuses
to start with `LEGAL_IMPRESSUM_URL` while `LEGAL_DIR` or `LEGAL_BUNDLE` holds an Impressum (likewise for the
privacy notice). Linking one page and serving the other is fine. `/api/config`'s `legal.impressum` and
`legal.privacy` stay `true` only for a page the instance serves.

The project's own website and its demo at `gcportrait.app/demo/` take the first way and link the maintainer's
pages; the repository holds no legal texts, and [docs/legal/](legal/README.md) lists what those two surfaces
process. A self-hosted instance is its operator's: link your own pages or serve your own texts, never the
maintainer's.

**Serving texts:**

1. Write `impressum.md` and/or `privacy.md` (UTF-8 Markdown) in a directory of their own, for example
   `~/gcportrait-legal/`. Either one alone is fine; the footer links only what exists.
2. Deploy with `--legal-dir ~/gcportrait-legal` (any instance, demo-only or not). deploy.sh checks the texts
   as the backend does (UTF-8, no control characters, not blank, at most 11 KiB each) and sets them as one
   environment variable, `LEGAL_BUNDLE`. deploy.sh is declarative: a redeploy without `--legal-dir` removes
   them (and a redeploy without `--impressum-url` or `--privacy-url` removes those links).
3. Without deploy.sh, point `LEGAL_DIR` at the directory: after `pnpm build`,
   `LEGAL_DIR=~/gcportrait-legal pnpm --filter @gcportrait/backend start`, then
   `curl -s http://localhost:8080/api/legal` shows both texts. In a container, mount the directory read-only
   and set `LEGAL_DIR` to its path. Links work the same way: `LEGAL_IMPRESSUM_URL=https://… pnpm --filter
   @gcportrait/backend start`.

The app renders a small part of Markdown and never any HTML: headings (`#` to `######`, or a line of `=` or
`-` under the text), paragraphs, bullet and numbered lists, `**bold**`, `*italic*`, `` `code` ``, links to
`https:`, `http:`, `mailto:` addresses or paths on the instance (`[Privacy](/privacy)`), `<https://…>` and
`<name@example.com>`, and lines `---`. A line ends inside a paragraph only with two spaces or a backslash at
its end (as in an address block); otherwise lines join into one paragraph. HTML shows as its characters, and a
link to anything else (`javascript:`, `data:`) keeps only its text. A text that starts with `# Title` gives
the page its title; otherwise the page is called "Impressum" or "Privacy notice".

## The render API

An instance draws any view as SVG, PNG or a draw.io file on the server, for scripts: `POST /api/render`
([api.md](api.md#post-apirender)). It is on by default (a demo-only instance never has it).

| Flag | Default | |
|---|---|---|
| `--no-render-api` | off (the API is on) | Leaves the route out, for an instance where nobody needs it or one with less memory. |
| `--render-env NAME=VALUE` | the backend's defaults | Changes one of its limits, `RENDER_MAX_ASSETS`, `RENDER_MAX_PIXELS`, `RENDER_TIMEOUT_MS` or `RENDER_MAX_BODY_BYTES` ([configuration.md](configuration.md#backend-environment)); repeatable, once per name. |

```sh
infra/deploy.sh --project YOUR_PROJECT --render-env RENDER_MAX_PIXELS=134217728 --memory 4Gi
```

A render keeps the instance's one CPU busy while it runs and needs memory for its PNG, which is why the
largest PNGs want `--memory 4Gi`. Any Google account's token passes the render route's token check for the
demo and file sources, so on a public instance keep `--max-instances` low or put [Identity-Aware
Proxy](#private-instance-identity-aware-proxy) in front.

## Updating, pinning and rolling back

- **A newer release**: run the installer line again with your flags. It keeps the new release's scripts in
  their own folder, beside the old ones, and deploys its image; `--version vX.Y.Z` names a release.
- **Released images** are published to GitHub Container Registry, `ghcr.io/florianchrometz/gcportrait`, on
  every release, for `linux/amd64` and `linux/arm64`, with the release's version (`1.2.3` for tag `v1.2.3`),
  `MAJOR.MINOR`, and `latest` for the newest release. deploy.sh pulls them through the [remote
  repository](#what-deploysh-does) `ghcr` in your project. `--image v1.2.3` and `--image 1.2.3` both deploy
  that release (deploy.sh drops the `v` of a release tag), `--image 1.2` the newest patch of 1.2 at the time
  of the deploy, `--image ghcr.io/OWNER/NAME:TAG` any public ghcr.io image (a fork's) through the same remote
  repository, and any other full image reference, a digest included, is deployed as it is. Cloud Run records
  the image digest of each revision, so a revision keeps running the exact image it was deployed with even
  when a tag moves. A tag that moved within the last hour may still give the image before (the remote
  repository looks tags up again once an hour), so name the version when you update.
- **Rolling back**: run the installer line again with `--version` and the older release (or deploy.sh with
  `--image` and its tag). Cloud Run also keeps the earlier revisions: `gcloud run revisions list
  --service=gcportrait --project=YOUR_PROJECT --region=europe-west3` lists them, and the console's **Manage
  traffic** on the service's **Revisions** tab sends all traffic back to one of them.

The releases and what changed in each are on the [releases
page](https://github.com/florianchrometz/gcportrait/releases), which the release workflow writes from the
changesets at every tag.

## Building from source

The installer deploys a released image and needs no source. To deploy an image built from the source, a fork's
or a modified version, use the button below or a clone of the repository.

### Run on Google Cloud

[![Run on Google Cloud](https://deploy.cloud.run/button.svg)](https://deploy.cloud.run/?git_repo=https://github.com/florianchrometz/gcportrait.git&revision=main)
**Built from source, in the browser.** Google's [Cloud Run
Button](https://github.com/GoogleCloudPlatform/cloud-run-button) opens Cloud Shell, clones this repository and
follows `app.json` at its root:

1. You choose a project (one with billing) and a region.
2. It asks for two variables. `OAUTH_CLIENT_ID`: keep `none` until you have created the OAuth client (the
   button does not accept an empty answer). `SA_MODE_ENABLED`: keep `false` (below).
3. It builds `infra/Dockerfile` in Cloud Shell with `docker build` (the `prebuild` hook; the same build Cloud
   Build runs for `deploy.sh --build`), pushes the image to the Artifact Registry repository
   `cloud-run-source-deploy` in the region, and deploys the public service `gcportrait`: 1 CPU, 2 GiB, 80
   concurrent requests, port 8080.
4. Its `postcreate` hook, [`infra/cloud-run-button.sh`](../infra/cloud-run-button.sh), adds what the button
   cannot set: `TRUST_PROXY_HOPS=1`, the 900 s request timeout, startup CPU boost, the `/healthz` probes and
   at most 10 instances (`app.json` asks for that limit too, but the button writes it under a misspelt
   annotation key, which Cloud Run does not apply); it removes `OAUTH_CLIENT_ID` when it is `none`, and prints
   the OAuth client steps with the origin to add and the command that gives the service the client id, with
   the region you chose (here `europe-west3`): `gcloud run services update gcportrait --project=YOUR_PROJECT
   --region=europe-west3 --update-env-vars=OAUTH_CLIENT_ID=YOUR_OAUTH_CLIENT_ID`.

Its limits, next to deploy.sh:

- **It builds from source in Cloud Shell**, on every click, which takes several minutes on Cloud Shell's small
  machine. It never deploys a released image; the installer does that without building anything.
- **The service runs as the project's Compute Engine default service account**, not an account of its own. In
  user mode that does not matter (every call uses the signed-in person's token). Service-account mode would
  read as that account, which other workloads of the project may share and which may hold Editor on the
  project: use `deploy.sh --sa-mode` for that.
- **Nothing else is set**: no Identity-Aware Proxy, custom domain, legal pages, `HOSTED_BY` or `SOURCE_URL`,
  and no `managed-by` label.
- **deploy.sh and uninstall.sh leave the service alone**, because deploy.sh did not create it. To manage it
  with them, run deploy.sh with the same project and region: it enables whichever of the APIs it needs are
  still off, then stops before it creates or deploys anything and prints the one command that hands the
  service over; after that it moves the service to an account of its own and keeps it up to date, and
  uninstall.sh removes it. To remove it instead: `gcloud run services delete gcportrait --project=YOUR_PROJECT
  --region=europe-west3` (with the region you chose), and its image from `cloud-run-source-deploy`.
- **A second click updates the service** with a new build, and keeps the settings the hook added. It asks only
  for variables the service does not have yet, so it asks for `OAUTH_CLIENT_ID` again until you have given the
  service a client id (the hook removed the `none` placeholder): answer with the client id. The `postcreate`
  hook does not run again, so a `none` given then stays set and sign-in fails; remove it with `gcloud run
  services update gcportrait --project=YOUR_PROJECT --region=europe-west3 --remove-env-vars=OAUTH_CLIENT_ID`.

### From a clone of the repository

For contributors, forks and modified versions. A clone has the same `infra/deploy.sh`, and `--build` (default:
off) builds the checkout with Cloud Build in your project and deploys that image instead of a release:

```sh
git clone https://github.com/florianchrometz/gcportrait.git
cd gcportrait
infra/deploy.sh --project YOUR_PROJECT --build
```

`--build-machine TYPE` (default: `e2-highcpu-8`) picks Cloud Build's machine. The version the instance reports
(`/healthz`) is `git describe` of the checkout, and the "Redeploy with the same settings" line deploy.sh
prints deploys the image just built with `--image`, without building again. [contributing.md](contributing.md)
sets up a clone for working on gcportrait.

**The source link of a modified version.** gcportrait is licensed under the MIT License, which asks nothing of
an instance you run, modified or not. The app's footer still links its source as "Source (MIT)", to this
project's repository by default; if you publish the source of your version, pass `--source-url` (default: this
repository) with where it is, so the link leads there. A modified version you present to others needs its own
name and icon: the gcportrait name and icon are not covered by the MIT License
([brand/LICENSE.md](../brand/LICENSE.md)).

### Run the image locally

With Docker (or a compatible runtime) on your machine, the released image runs on `linux/amd64` and
`linux/arm64` alike, without a clone:

```sh
docker run --rm --publish 127.0.0.1:8080:8080 ghcr.io/florianchrometz/gcportrait:latest
```

Then open <http://localhost:8080>. Demo mode works as is. For sign-in, add `--env OAUTH_CLIENT_ID=...` (and
`--env HOSTED_BY=...`) and list `http://localhost:8080` among the client's authorised JavaScript origins.

In a clone of the repository, `pnpm docker:build` builds an image of your checkout for your machine's platform
and `pnpm docker:run` runs it with `infra/compose.yaml`, which binds to 127.0.0.1 only and runs the container
read-only, without capabilities; put `OAUTH_CLIENT_ID=...` into `infra/.env` there, which git ignores.

The image: a build stage on `node:22-bookworm-slim` installs the workspace from the lockfile, builds the SPA
and bundles the backend with esbuild into one ESM file (`backend/bundle.ts`, which explains why); the runtime
stage is `gcr.io/distroless/nodejs22-debian12` running as the non-root user 65532, with no shell, no package
manager and no `node_modules`. Both bases are pinned by digest in `infra/Dockerfile`. The image's
`HEALTHCHECK` has Node fetch `/healthz` (there is no curl); Cloud Run ignores it and uses deploy.sh's probes,
which reach the container directly. From outside a Cloud Run service, check `/api/healthz` instead (the same
answer): Cloud Run's front end answers `/healthz` itself.

## What deploy.sh does

`infra/deploy.sh --help` lists every flag; [configuration.md](configuration.md) has the defaults. Every change
it makes is printed as it runs (`+ gcloud ...`), and `--dry-run` prints them without making them. It is safe
to run again at any time, also after it stopped halfway.

| Step | What | Why |
|---|---|---|
| APIs | enables `run`, `iam`, `cloudasset`, `cloudresourcemanager` and `artifactregistry` (`.googleapis.com`); with `--build` also `cloudbuild` and `storage`; with `--iap` also `iap` | Cloud Asset Inventory and Resource Manager are charged to this project for the instance's own calls and for header-less Resource Manager calls made with a person's token through this project's OAuth client ([permissions.md, "Which account, and who pays"](permissions.md#which-account-and-who-pays)). The APIs it had to enable are recorded as `gcportrait-api-NAME=enabled` labels on the service and, with `--build`, on the build repository, which exists minutes earlier. A run that stops before either exists names the APIs it enabled. |
| What exists | before it creates anything, it checks that whatever exists of its names (the service, the backend account; with `--build` the build account, repository and bucket) carries its mark: the `managed-by=gcportrait-deploy` label, or on an account exactly the description deploy.sh writes | deploy.sh never adopts or changes what it did not create. A resource of one of its names without the mark stops the run before anything is created, granted, uploaded or deployed; the message names each one, the command that hands it over if it is meant for this instance (deploy.sh then manages it, and uninstall.sh deletes it with the instance), and `--service`, which changes every derived name. |
| Backend account | `SERVICE-backend@PROJECT.iam.gserviceaccount.com` | The service's identity, and the account a team grants in [service-account mode](#service-account-mode). deploy.sh grants it **no role at all**, on nothing: not on this project, not on any organisation or folder. It reports any role it finds on the project, granted by someone else. |
| Image (without `--build`) | once per project and region, an Artifact Registry remote repository `ghcr` (Docker, upstream `https://ghcr.io`, labelled `managed-by=gcportrait-deploy`), shared by every instance in the region; the service runs `REGION-docker.pkg.dev/PROJECT/ghcr/florianchrometz/gcportrait:TAG` from it | Cloud Run can run a public ghcr.io image directly, but Google recommends an Artifact Registry remote repository for availability (Cloud Run's "Deploying container images"): Artifact Registry fetches an image from ghcr.io the first time it is asked for it and keeps it, so a redeploy or a new instance does not depend on ghcr.io. It looks a tag up again once its cached answer is an hour old, so a tag that just moved (`latest` right after a release) can still give the image before for up to an hour; `--image vX.Y.Z` is exact. Public images need no credentials. Before it changes anything, deploy.sh asks ghcr.io anonymously whether the image exists, so an unknown tag or a package that is not public stops the run at once. An existing repository named `ghcr` is used only when it is a remote repository of ghcr.io; one that deploy.sh did not create is pulled through and never changed or deleted, and a repository of that name of any other kind stops the run. `--image ghcr.io/OWNER/NAME:TAG` (a fork's image) goes through the same repository. |
| Build (`--build`) | a Docker repository `SERVICE-builds` in the region (keeps the 5 newest images), a private regional bucket `gs://PROJECT-SERVICE-builds` (the uploaded source and the build logs, deleted after 14 days; created with its label in one request to the Cloud Storage API), a build account `SERVICE-build@...` with Storage Admin on that bucket and Artifact Registry Writer on that repository and nothing else, and one Cloud Build run of `infra/cloudbuild.yaml` | A build account of its own instead of the project's Compute Engine default account, which would need the Compute Engine API and, in projects without the secure-by-default organisation policies, holds Editor on the whole project. Storage Admin, on the one bucket only, is the role Google documents for a build account that keeps its logs in a bucket of the user's: Cloud Build reads the bucket itself before it accepts a build (with Storage Object Admin alone it refuses: `FAILED_PRECONDITION: invalid bucket ... does not have access`). On that bucket it also lets the build account change the bucket's IAM policy or delete the bucket; a narrower custom role (Storage Object Admin plus `storage.buckets.get`) is open ([security.md](security.md), O5). Bucket names are global, so an existing bucket of that name is used only when it belongs to this project and carries deploy.sh's label. The upload leaves out git-ignored files, `docs/`, and anything local that may hold a credential (env files, `*.local.*` notes, keys: the same patterns as `.dockerignore`). |
| Cloud Run | the service `SERVICE` (default `gcportrait`) from the image, as the backend account: 1 CPU, 2 GiB (`--memory`), 80 concurrent requests, 0 to 10 instances, 900 s request timeout, startup CPU boost, startup and liveness probes on `GET /healthz`, labelled `managed-by=gcportrait-deploy` | Scales to zero when nobody uses it. The environment it sets is in [configuration.md](configuration.md#environment-on-cloud-run): `TRUST_PROXY_HOPS=1`, `LOG_LEVEL`, `SA_MODE_ENABLED`, `BACKEND_SA_EMAIL`, and `OAUTH_CLIENT_ID`, `HOSTED_BY`, `SOURCE_URL` when given. |
| Access | public (`allUsers` may invoke the service), or with `--iap` Identity-Aware Proxy and the listed principals | Public is safe in the sense of [AGENTS.md](../AGENTS.md), "Security and privacy": reading any Google Cloud data still needs the person's own sign-in and their own IAM roles. |
| Check | the newest revision is ready (its startup probe `GET /healthz` passed); without IAP it also waits for `GET /api/healthz` on the new address (up to seven tries, 5 s apart, while Google's front end still answers with its own page), then checks `GET /api/config` and `GET /`, and says in one line that the instance answers, with its version (`--verbose` shows each answer). | Proves the instance answers before the script says so. Cloud Run's front end keeps paths ending in `z` for itself, so `/healthz` answers only inside the container (the probes, Docker); from outside it returns Google's 404, and `/api/healthz` gives the same answer. |

It **never** grants a role on an organisation, a folder or another project, never creates a service-account
key, never stores a token or a secret (the OAuth client's secret is not used anywhere), and never uses or
changes resources it did not create, except to read them (the row "What exists" above).

### What Google adds by itself

Enabling the Cloud Run and Cloud Build APIs makes Google create default service accounts in the project, as
for any project that uses those products: the Compute Engine default account
`PROJECT_NUMBER-compute@developer.gserviceaccount.com` and the legacy Cloud Build account
`PROJECT_NUMBER@cloudbuild.gserviceaccount.com`, with their default roles, and it enables a few APIs those two
depend on (Container Registry, Pub/Sub, IAM Credentials). In an organisation that does not enforce
`iam.automaticIamGrantsForDefaultServiceAccounts`, the Compute Engine account gets **Editor** on the project
as soon as these APIs are enabled; deploy.sh warns when it finds that grant. gcportrait uses neither account.
If your organisation does not enforce that policy, consider removing that grant or enforcing the policy;
uninstall.sh leaves these accounts alone, because Google, not deploy.sh, created them.

### Permissions to run deploy.sh

Owner of the project is enough. Without Owner, these roles on the project:
`roles/serviceusage.serviceUsageAdmin` (APIs), `roles/iam.serviceAccountAdmin` and
`roles/iam.serviceAccountUser` (create the accounts, deploy as them), `roles/run.admin` (the service and its
invoker policy), `roles/iam.securityReviewer` (read the project's policy for the report),
`roles/artifactregistry.admin` (the remote repository of released images, once per region, or with `--build`
the build repository), with `--build` also `roles/storage.admin` and `roles/cloudbuild.builds.editor`, with
`--iap` `roles/iap.admin`. deploy.sh also uses `curl` (macOS, Linux and Cloud Shell have it): to ask ghcr.io
whether a released image exists (without curl it skips that check), and with `--build` or `--iap`, where it is
required.

## Uninstall in detail

```sh
infra/uninstall.sh --project YOUR_PROJECT --region europe-west3      # asks you to type the service name
```

It deletes exactly what deploy.sh created, found by its marks: the Cloud Run service with the
`managed-by=gcportrait-deploy` label (its invoker and IAP bindings go with it, and so do the [domain
mappings](#custom-domain) that route to it), the build repository and bucket with the same label (images,
uploaded sources and logs included), and the backend and build accounts whose description deploy.sh wrote. The
remote repository `ghcr` of released images, with the same label, is shared by the instances of its region and
goes with the last one: uninstall.sh deletes it only when no other Cloud Run service or job of the project
deploys from it, and keeps it when it cannot list them. Anything of the same name without the mark is reported
and kept, for example an account you created yourself before the first deploy. `--dry-run` lists what it would
delete; `--yes` skips the question (needed without a terminal).

The APIs stay enabled unless you add `--disable-apis`: other workloads in the project may use them by now.
With it, uninstall.sh disables the APIs deploy.sh recorded as enabled by itself (on the service and on the
build repository), one by one, but first lists the project's Cloud Run services, jobs and worker pools in
every region and keeps what any other one still needs: `run`, `iam`, `artifactregistry`, `cloudbuild` and
`storage` while any other service, job or worker pool exists, `iap` while a service has IAP on, and every API
of an instance while another gcportrait instance (labelled `managed-by=gcportrait-deploy`) exists; it says
which workload keeps which API. When any of the three cannot be listed (an older gcloud without
`run worker-pools`, say), it keeps them all. An API that another enabled API depends on is kept too. Google's
check for recent use is skipped, and workloads outside Cloud Run are not looked at: GKE, Compute Engine (a VM
calling Cloud Asset Inventory, say), App Engine, first-generation Cloud Functions, and IAP in front of an
external load balancer (which leaves no mark on the services behind it). Those are yours to think of before
you pass `--disable-apis`. A run that stopped before either existed printed the APIs it enabled and the
`gcloud services disable` command for them; use that if you give up instead of running deploy.sh again.

After deleting the backend account, any grant made to it elsewhere (a team's `roles/cloudasset.viewer`) shows
as a `deleted:serviceAccount:...` member until its owner removes it. The OAuth client and its consent screen
are yours to delete in the console (Google Auth Platform › Clients).

## Costs

Idle, the instance costs nothing but storage: Cloud Run scales to zero (min instances 0); without `--build`,
the remote repository keeps every released image it pulled (until uninstall.sh deletes it with the last
instance); with `--build`, Artifact Registry keeps up to five images and the build bucket holds the last 14
days of uploads and logs. In use, Cloud Run bills per request-second at 1 CPU and 2 GiB; a pull of a large
organisation streams for a few minutes, and a render through the API ([api.md](api.md#post-apirender)) keeps
the instance busy for a few seconds (`--no-render-api` turns it off, `--memory` lowers the memory with it).
Each `--build` is one Cloud Build run of a few minutes on an `e2-highcpu-8` machine (`--build-machine` picks
another). Cloud Asset Inventory and Resource Manager calls are free of charge within their quotas. Check the
current prices on Google's pricing pages.

## Logs

The backend writes JSON lines for Cloud Logging (pino; backend/README.md): for each request the path, with any
query string replaced by `?[redacted]`, and the request headers, of which only a short allowlist keeps its
values (every credential, cookie and identity header shows as `[redacted]`), with a request id. No request or
response body is logged. Cloud Run also keeps its own request log (`run.googleapis.com/requests`), which
records each request's full URL, query string included. The app never puts a token in a URL, and the backend
refuses a token sent that way with 401, but a client that sends one anyway leaves it in Google's request log;
keep access to the project's logs as narrow as access to the project. `--log-level` sets how much the backend
writes ([Memory, instances and logs](#memory-instances-and-logs)).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `the Google Cloud CLI (gcloud) is not installed`, or another tool | The installer names the one that is missing; [install the Google Cloud CLI](https://cloud.google.com/sdk/docs/install), or use [Cloud Shell](https://shell.cloud.google.com/), which has every tool. |
| `gcportrait has no release yet, so there is nothing to install` | The repository the installer reads publishes no release: build from a clone with `--build` ([From a clone of the repository](#from-a-clone-of-the-repository)). |
| `could not download …` or `could not find the newest release` | GitHub did not answer, or the release named with `--version` does not exist. Check the connection and the tag (the repository's releases list them). |
| `the SHA-256 of the downloaded … is …, but checksums.txt … says …` | The archive is not the release's (a proxy that changes downloads, or a damaged file). Nothing was unpacked or run; try again on another connection. |
| `release … has no checksums.txt` | The release carries no checksums to check the deploy scripts against, so the installer runs nothing. Name another release with `--version`. |
| `gcloud has no active account` | `gcloud auth login`, then run the same line again. |
| `billing is not enabled` | Link a billing account to the project (console › Billing). |
| `ghcr.io/... has no public release yet` | The image's package refuses anonymous access: for a fork's image, make its package public, or build with `--build`. |
| `ghcr.io/... has no image TAG` | No release with that tag. Pick one from the repository's releases (`--version vX.Y.Z` with the installer). |
| `ghcr.io/OWNER/NAME does not exist or is not public` | A `--image ghcr.io/...` that Artifact Registry cannot pull without credentials. Check the name, or make the package public. |
| `the Artifact Registry repository ghcr in REGION is not a remote repository of https://ghcr.io` | A repository of that name already exists in the region for something else. Deploy in another `--region`, or with `--build`. |
| The deploy of a released image fails although ghcr.io has it, in a project inside a VPC Service Controls perimeter | Inside a perimeter, Artifact Registry denies remote repositories access to upstream sources outside it by default. Allow it for the region: `gcloud artifacts vpcsc-config allow --project=YOUR_PROJECT --location=europe-west3`. |
| `image ... not found or not readable` | An Artifact Registry image given in full with `--image` does not exist, or you may not read it. |
| Cloud Build: `FAILED_PRECONDITION: invalid bucket ...; service account ... does not have access to the bucket` | The build account cannot read its bucket. deploy.sh grants it Storage Admin on that bucket and repeats a refusal like this for about two minutes while the new grant propagates. If it persists, check the bucket's IAM policy (`gcloud storage buckets get-iam-policy gs://YOUR_PROJECT-gcportrait-builds`). |
| Cloud Build: `PERMISSION_DENIED: The caller does not have permission` | Also repeated for about two minutes. If it persists, check that you may act as `SERVICE-build@...` (`roles/iam.serviceAccountUser`) and start builds (`roles/cloudbuild.builds.editor`), and that no organisation policy restricts Cloud Build. |
| `https://.../healthz` answers with Google's own 404 page | Expected on Cloud Run: its front end keeps paths ending in `z` for itself. The probes reach `/healthz` inside the container; from outside, use `/api/healthz`, which answers the same. |
| `deploy.sh did not create the resources above, so it neither uses nor changes them` | A service, account, repository or bucket of one of deploy.sh's names exists without its mark (listed above the message, each with the command that hands it over). Deploy with another `--service` name, or hand over only what is meant for this instance: deploy.sh then manages it, and uninstall.sh deletes it with the instance. Another `--service` name does not rename the remote repository `ghcr` or free a domain: their lines say what to do (another `--region` or `--build`; the command that frees the domain). |
| `the bucket gs://PROJECT-SERVICE-builds exists but belongs to another project` (or a 409 when it is created) | Bucket names are global, and someone else has this one. Deploy with another `--service` name, which changes every derived name. |
| Cloud Build: quota exceeded for the machine type | `--build-machine e2-standard-2` (slower), or ask for quota. |
| `the service is not public (allUsers is not an invoker)` | The organisation restricts IAM members to its domain (`iam.allowedPolicyMemberDomains`). Use `--iap`, or ask for a policy exception for the project. |
| The new revision does not become ready | `gcloud run services logs read gcportrait --project=YOUR_PROJECT --region=europe-west3`: an invalid variable stops the backend with a message naming it (never its value). |
| Sign-in window shows `origin_mismatch` | The address in the browser is not among the OAuth client's origins; see [The OAuth client in detail](#the-oauth-client-in-detail). |
| deploy.sh stopped halfway | Run the same command again; every step checks what exists first. |
