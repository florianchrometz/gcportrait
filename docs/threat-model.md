<!-- SPDX-License-Identifier: MIT -->

# Threat model

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.

What gcportrait protects, from whom, where the trust boundaries run and what holds at each of them. The
security and privacy principles it cites ("principle N") are those of [AGENTS.md](../AGENTS.md), "Security and
privacy". The checklist of the controls, with the tests and commands that hold each, is
[security.md](security.md); this document says why the controls are the ones that matter.
[permissions.md](permissions.md) describes service-account mode for the people who use it,
[self-host.md](self-host.md) and [configuration.md](configuration.md) the instance.

## 1. What there is

| Surface | What runs | Who reaches it |
|---|---|---|
| The website, `gcportrait.app` | static pages built by Astro, served by GitHub Pages | anyone; it calls no backend and holds no data |
| The demo, `gcportrait.app/demo/` | a static build of the app in demo-only mode, served by the website on GitHub Pages, no backend at all: the app and the synthetic organisations S to XL, no sign-in, no route that calls Google, no account | anyone |
| A self-hosted instance | the same image on the operator's Cloud Run (`infra/deploy.sh`): public (sign-in inside) or behind Identity-Aware Proxy (`--iap`), user mode, optionally service-account mode | the operator's users, or anyone with a Google account when it is public |
| The image | `ghcr.io/florianchrometz/gcportrait`, built and published by `.github/workflows/release.yml` on a tag | anyone who pulls it |
| A browser | the SPA: React, its workers, IndexedDB for snapshots and preferences, the token in memory | the person using it |

There is no hosted sign-in instance ([AGENTS.md](../AGENTS.md), "Modes and hosting"): no instance of the
maintainer's reads anyone's Google Cloud.

## 2. Assets

1. **The person's Google access token** (scopes `cloud-platform.read-only`, `cloudasset`, `userinfo.email`;
   [AGENTS.md](../AGENTS.md), "Security and privacy", "OAuth scopes"). Whoever holds it reads, for about an
   hour, everything the person may read in Google Cloud. The most valuable thing that ever passes through
   gcportrait.
2. **The instance's service-account token** (service-account mode): reads every scope a customer granted the
   account, for up to an hour. Lives in the backend process only.
3. **Inventory data**: the asset metadata of a scope (names, networks, addresses, configuration). Sensitive
   to its owner; it flows Google → backend → browser and is kept in the browser's IndexedDB as snapshots.
4. **Identity**: a person's email (tokeninfo, Resource Manager answers), the scopes they look at.
5. **Exports**: PNG, SVG and snapshot JSON files the person downloads; they carry the inventory.
6. **Availability** of an instance and of the demo.
7. **The supply chain**: the source, the npm dependencies, the base images, the CI workflows and the image on
   ghcr.io; and the licence obligations that travel with what is conveyed.
8. **The project's standing**: no implied affiliation with Google, the gcportrait name and icon, which the MIT
   License does not cover ([AGENTS.md](../AGENTS.md), "Non-affiliation, brand and legal").

## 3. Actors

| Actor | Can | Wants |
|---|---|---|
| A person using an instance | sign in, send any request with their own token, pick any scope | their own diagram; at worst, more than they may see |
| An anonymous visitor | reach the demo and any public instance; send any request without a valid token, or with a token for another OAuth client | data, a foothold, an outage |
| A malicious web page | run script in the person's browser in another origin, open or frame the app, send cross-site requests | the token, the inventory, actions as the person |
| A customer's administrator | grant the instance's account `roles/cloudasset.viewer` on a scope | their staff to read that scope through the instance, nobody else |
| The operator | configure, deploy and read the logs of an instance | run it; they are trusted with the instance, not with their users' tokens |
| A compromised dependency or action | run code at build time, in the image or in the browser | anything above |
| Google | answer the API calls | (trusted: the upstream, reached over TLS at fixed hosts) |

## 4. Trust boundaries

```text
                      ┌──────────────────────── browser (trusted by the person) ────────────────────────┐
                      │  SPA (same origin)   workers   IndexedDB: snapshots, preferences                 │
                      │  token in memory only ─────────────┐                                              │
                      └───────┬──────────────────────────┬─┴──────────────┬──────────────────────────────┘
              (B1) HTTPS, same origin           (B3) GIS window     (B3) tokeninfo, revoke
          X-Gcportrait-Token: TOKEN             accounts.google.com  oauth2.googleapis.com
                      │                                                   (CSP connect-src)
          ┌───────────▼───────────────────── Cloud Run front end (TLS) / IAP ─────────────────────────┐
          │  backend process (Fastify, stateless)                                                       │
          │  rate limits, caps, gate, logs without secrets; SA token in memory ── (B4) metadata server │
          └───────────┬───────────────────────────────────────────────────────────────────────────────┘
              (B2) HTTPS to four hosts only, no redirect followed, 60 s, 25 MiB
          cloudasset · cloudresourcemanager · storage · oauth2 (.googleapis.com)
```

- **B1, browser ↔ backend.** Everything that crosses it is untrusted input to the backend: every header, the
  path, the query and the JSON body. The backend accepts four JSON routes that call Google, two public JSON
  routes (`/api/config`, `/api/legal`), the health checks and static files. Behind it is the operator's Cloud
  Run service, reached through Google's front end (or IAP).
- **B2, backend ↔ Google APIs.** The backend sends the person's token (or its own account's) to exactly four
  hosts and treats every answer as untrusted data: a capped size, a time limit, a parsed error envelope,
  never an HTML page passed on, never a redirect followed.
- **B3, browser ↔ Google directly.** Google Identity Services' window issues the token; the browser asks
  Google's tokeninfo who the token belongs to and for which client, and revokes it on sign-out. Nothing else
  of Google's is reachable from the page (the CSP's `connect-src`).
- **B4, backend ↔ its identity.** The metadata server (on Cloud Run) or a credentials file (on a laptop) hands
  the backend its own token; nothing a request carries reaches those endpoints (`checkIdentityUrl`).
- **B5, the build and release path.** npm packages, base images and GitHub Actions run with the repository's
  rights; the release workflow can push the image.

## 5. The token path

1. The person presses "Sign in with Google". The SPA loads GIS's script (the one external script the CSP
   allows), and Google's own window issues an access token, handed back to the page by `postMessage` (hence
   `Cross-Origin-Opener-Policy: same-origin-allow-popups` on instances with sign-in).
2. The token lives in the page's memory only: never in storage, a cookie, the URL or the hash
   (frontend/README.md, "Sign-in"). The page asks tokeninfo (a POST, the token in the body) whose token it is
   and for which OAuth client, and revokes one whose audience is not the instance's client.
3. Each API call carries it as `X-Gcportrait-Token` (a header Identity-Aware Proxy leaves alone) over HTTPS to
   the page's own origin. No cookie exists, so a cross-site page cannot make the browser send it (no CSRF),
   and without CORS headers no other origin can read an answer.
4. The backend reads it (`stream/caller.ts`: `X-Gcportrait-Token`, else `Authorization: Bearer`, RFC 6750
   syntax, at most 4 KiB), keys its rate limits, stream slots and gate memo on its SHA-256, and forwards it as
   `Authorization: Bearer` to the four hosts only (tokeninfo in a form body). It is never stored, never put in
   a URL, and never logged at any level: the request logger keeps an allowlist of harmless headers and redacts
   every other value, query strings and bodies are never logged.
5. Sign-out forgets it and revokes it with Google.

What could still take it: script running in the page itself (an XSS in the app, a malicious dependency in the
bundle, a browser extension). The CSP (no inline script but the hashed theme bootstrap, `script-src` limited
to the origin and GIS's one script, `object-src 'none'`, no frames) and the absence of HTML from data
(`dangerouslySetInnerHTML` only for the vendored icons; legal pages rendered from Markdown without HTML;
exported SVG written by the DOM serializer) are the defences; a compromised dependency is the supply-chain
risk of section 8.

## 6. Service-account mode and its gate

The risk is a confused deputy: an instance's account that a customer granted `roles/cloudasset.viewer` on
`organizations/X` must not read X for every person who can sign in to that instance. The gate
([AGENTS.md](../AGENTS.md), "Security and privacy", "The service-account gate"; `backend/src/auth/gate.ts`)
asks Resource Manager's `testIamPermissions` with the **caller's** token for the scope's `get` permission
before every call as the account, every page of a stream included; a pass is remembered for at most five
minutes per token hash and scope, never past the token's expiry, never a refusal. Nothing is asked as the
account before the caller's own check has passed. Each decision writes one audit line (the scope, a SHA-256 of
the caller's email, the decision), whatever `LOG_LEVEL` says short of `silent`.

What remains, and is documented for the people who grant access ([permissions.md](permissions.md)): a scope
whose `get` is public passes the gate for everyone signed in, unless the operator turns on
`SA_MODE_STRICT_EXPOSURE` (off by default, because it refuses every scope where the account holds more than
`roles/cloudasset.viewer`); and the backend accepts any valid Google token, not only those issued to its own
OAuth client (the maintainer's open question, security.md section 12, O1).

## 7. Demo mode, the demo instance and exports

- **Demo mode** (the SPA's synthetic organisations): no backend call reads data, no token exists, the data is
  generated in a worker from a seed; nothing in it is anyone's.
- **A demo-only instance** (self-hosted with `--demo-only`): the four routes that call Google are not
  registered at all; the CSP allows no Google source; the page is cross-origin isolated (COOP `same-origin`,
  COEP `require-corp`); the backend has no account and no OAuth client (start-up refuses them with
  `DEMO_ONLY=true`). Its threats are availability (rate limit per address, Cloud Run's instance cap) and the
  integrity of what it serves (the image and the legal texts the operator sets).
- **Exports**: PNG, SVG and snapshot JSON are made in the browser and downloaded only when the person asks;
  nothing is uploaded anywhere (principle 5). They carry the inventory, so whoever receives one learns what it
  shows; the export menu and the title block say what is drawn. An exported SVG holds no script.

## 8. Threats and controls

| # | Threat (boundary) | Control | Residual |
|---|---|---|---|
| T1 | The backend used as an open proxy or for SSRF (B1→B2) | four hosts matched exactly on the parsed URL, https, default port, no user info; URLs built only from validated scopes, quota projects and bucket names; redirects never followed | none known |
| T2 | A token in a log, a URL or storage (B1, B2) | header allowlist in the logger, query strings and bodies never logged, pino redaction as a second line, tokeninfo by POST; checked at `LOG_LEVEL=trace` | the operator's own proxies and IAP logs are theirs |
| T3 | Another person's scope read through the account (B1, SA mode) | the gate before every call as the account, by the caller's own permission | scopes with a public `get` (strict check off by default); any valid Google token is accepted |
| T4 | Script injection in the page (B1, B3) | CSP without `unsafe-inline` (hash for the bootstrap), GIS's script only, no frames, `nosniff`, no HTML from data | a compromised dependency in the bundle (T9) |
| T5 | Clickjacking, cross-window attacks (B1) | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, COOP (`same-origin-allow-popups`; `same-origin` on demo-only), CORP `same-origin` | none known |
| T6 | Cross-site requests acting as the person (B1) | no cookies or ambient credentials; the token is a header the page sets; no CORS | none |
| T7 | Exhausting an instance: request floods, slow senders, slow or stalled readers, memory (B1, B2) | 600 requests a minute per address, per-token limits per route, four streams per token, 64 KiB bodies, 30 s for headers and for a body, 25 MiB per page and a 64 MiB page budget per process with pages never parsed, each page counted until its frame is written out to the client, a stream cut off when its client does not take a 1 MiB piece within 60 s (it stopped, or reads more slowly than about 17 KiB/s), Cloud Run's concurrency 80 and instance cap | anyone with Google accounts can still use a public instance's capacity (rate limits are per address and per token, in memory per instance); clients that stop reading can hold most of the page budget until the stall limit cuts them off, so that meanwhile other large pages end with a retryable `INSTANCE_BUSY` (security.md section 12, O11); IAP closes it for private instances |
| T8 | Upstream answers that harm the app (B2) | size and time caps, JSON-only error messages cut at 2 000 characters, a page frame checked before it is sent, no redirect | Google's own message text reaches the person who asked (by design: it is actionable) |
| T9 | A compromised or vulnerable dependency, base image or action (B5) | licence and audit gates in CI (`pnpm audit`, high and critical fail), Dependabot, the lockfile installed frozen, base images pinned by digest, SBOMs and smoke tests on release, a bundled server with no `node_modules` in the image | no minimum release age on dependency updates (security.md section 12, O6) |
| T10 | A container escape or tampering on the host (operator) | distroless runtime, non-root user 65532, nothing in `/app` writable, read-only root filesystem where the runtime offers it | Cloud Run gives no read-only option; the process writes nothing |
| T11 | Licence obligations not met for what is conveyed (B5) | `THIRD_PARTY_NOTICES.txt` in every build and image, linked from the app; `pnpm run licenses` | none known |
| T12 | Exhausting an instance through the render API, `POST /api/render` (B1) | on by default except demo-only, off with `RENDER_API=false` (`deploy.sh --no-render-api`); one render per instance (`RENDER_BUSY`) and 10 a minute per token, each in a fresh worker with a 1 GiB heap that is terminated however the render ends; `RENDER_MAX_ASSETS`, `RENDER_MAX_PIXELS`, `RENDER_TIMEOUT_MS`, `RENDER_MAX_BODY_BYTES`; a pull through the stream slots and the page budget (T7); an upload within the 30 s body deadline (408) and readable (400), never a 500; a page Google answers after the client left is never handed to the stopped job; every retryable refusal with `Retry-After` | any Google account's token passes the token check for the `demo`, `ndjson` and `bundle` sources, so a public instance's CPU can be kept busy by many accounts (one render at a time per instance; `--max-instances` bounds the bill); a large render on one vCPU can run close to `RENDER_TIMEOUT_MS` (demo XL at detail `all`, scale 3, needs about 1.4 GiB and minutes of CPU; api.md); IAP closes it |

## 9. Assumptions and what is out of scope

- Google's APIs, Google Identity Services and Cloud Run's front end behave as documented; TLS to them holds.
- The person's browser and its extensions are theirs to trust. gcportrait does not defend against script
  the person installed.
- The operator controls their Google Cloud project, the instance's configuration and its logs; IAP's access
  list is theirs to keep.
- `TRUST_PROXY_HOPS=1` (deploy.sh) assumes exactly Cloud Run's front end in front of the container. Another
  proxy in front (an external load balancer) needs another value, or the rate limit may key on the proxy's
  address instead of the client's. It is not yet checked on a deployed instance (security.md section 12, O3).
- The website is static and holds no data; its hosting (GitHub Pages) and DNS are outside this model.
