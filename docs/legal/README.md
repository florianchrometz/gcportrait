<!-- SPDX-License-Identifier: MIT -->

# What the deployments process

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.

**A fact sheet, not legal advice.** Nothing in this folder is legal advice, and none of it has been reviewed by a
lawyer yet.

The maintainer runs no service: no sign-in instance, no accounts, nothing to agree to. There are two hosted
surfaces ([ADR 0032](../adr/0032-hosted-surfaces-and-domains.md), [ADR
0035](../adr/0035-decisions-inherited-from-the-implementation-plan.md) §2), the website `gcportrait.app`
(GitHub Pages) and the sign-in-free demo, described below as `demo.gcportrait.app` (Cloud Run, demo-only mode)
and since 2026-10-11 a static build at `gcportrait.app/demo/` on the same GitHub Pages site
([ADR 0034](../adr/0034-static-demo-on-pages.md); this folder still has to follow, [docs/backlog.md](../backlog.md)), and neither processes
personal data by design: no sign-in, no cookies, no analytics, no server-side storage. What remains are the hosting
providers' request logs, a short-lived counter against overload, the header's repository widget and what the two keep
in the visitor's own browser. Both still need an Impressum, and a privacy notice for those logs.

## Where the legal texts live

On the operator's own website, never in this repository (ADR 0032 as amended on 2026-10-11; the drafts that were
here are removed). For the maintainer's two surfaces:

| Page | Address | Linked from |
|---|---|---|
| Impressum | <https://florian-chrometz.de/legal/impressum> | the footer of every page of `gcportrait.app` (`website/src/site.ts`, checked by `pnpm website:check`); the demo through `infra/deploy.sh --impressum-url` |
| Privacy notice | <https://florian-chrometz.de/legal/privacy-policy> | the same, through `--privacy-url` |

The demo takes both links with every deploy (`LEGAL_IMPRESSUM_URL`, `LEGAL_PRIVACY_URL`, which the backend reports
in `/api/config`; deploy.sh is declarative, so a redeploy without them drops them), and serves no texts of its own:

```sh
infra/deploy.sh --project YOUR_PROJECT --region europe-west1 --demo-only --domain demo.gcportrait.app \
  --impressum-url https://florian-chrometz.de/legal/impressum \
  --privacy-url https://florian-chrometz.de/legal/privacy-policy
```

The app's footer links both pages, each in a new tab, as `/api/config` reports them (the static demo has them
built in). There are no terms of use: there is no account and no
service to agree to.

Self-hosted instances are not covered here: whoever runs one is its operator, and links their own pages or serves
their own texts ([self-host-options.md, "Legal pages: link or serve"](../self-host-options.md#legal-pages-link-or-serve); if they
enable sign-in, also ["If you enable sign-in"](../self-host-options.md#if-you-enable-sign-in)).

## What the maintainer's privacy notice covers

The facts the page at <https://florian-chrometz.de/legal/privacy-policy> must state, each checked against the code in the
[data-processing inventory](data-processing-inventory.md) (row IDs in brackets):

- **The website is on GitHub Pages.** GitHub, Inc. delivers every page and processes the visitor's IP address, the
  requested URL, the time and the request headers (user agent, referrer) in its own logs, under its own privacy
  statement, also in the USA; the maintainer receives none of them (W1).
- **The website's header asks GitHub for the repository's facts.** Once a page has loaded, the visitor's browser
  asks `api.github.com` for the repository's public star and fork counts and its latest release's version (two
  requests made together), at most once an hour per tab, anonymously (no cookie, no referrer); GitHub receives the IP
  address, the user agent and the site's origin with each. The browser keeps the time and the facts in session storage
  for the hour. While the repository is not public the browser does not ask at all (W3).
- **The demo runs on Cloud Run in `europe-west1`.** Google writes a request log entry for every request (IP address,
  full URL, time, status, user agent, referrer) into Cloud Logging in the maintainer's Google Cloud project, as a
  processor; the default retention is 30 days. The demo's own log lines carry no IP address and no query string
  (R1, R2). Against overload it counts requests per IP address in memory for a minute, never written anywhere (R3).
- **No cookies, no analytics, no sign-in.** Neither site sets a cookie or loads anything from another host for
  analytics, tracking or advertising; the demo has no sign-in and reads no Google Cloud data.
- **What stays in the visitor's browser.** The values typed into the website's commands (local storage,
  `gcportrait.docs.variables`, W2); the demo's theme (local storage, `gcportrait.theme`) and its generated demo
  organisations, saved views and imported files (IndexedDB); nothing of it reaches the maintainer (R4).
- **Email**, if the page names an address: what is sent, kept until the conversation is over (C1).
- The usual parts of a notice: the controller (the person the Impressum names), the legal bases the inventory names,
  the visitor's rights, and the supervisory authority.

## Files

| File | What it is |
|---|---|
| [data-processing-inventory.md](data-processing-inventory.md) | One table of every processing operation of the two sites (purpose, legal basis, who, where, how long, and the code or documentation each row was checked against), what is not processed, and when to update it. The privacy notice is checked against it. |

**Keep it true.** The inventory's [When to update](data-processing-inventory.md#when-to-update) lists the changes
that need a new row and a new privacy notice: another host or region, other log settings, a cookie, a storage key, a
logged header, a form, a request to another host, a third hosted site. The values still open in the inventory (the
log bucket's location and retention as set in the maintainer's project, the email provider, the date of a legal
review) are written in square-bracketed capitals; `gcloud logging buckets list --project=YOUR_PROJECT` shows the
first two.
