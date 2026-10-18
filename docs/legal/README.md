<!-- SPDX-License-Identifier: MIT -->

# What the deployments process

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.

**A fact sheet, not legal advice.** Nothing in this folder is legal advice, and none of it has been reviewed
by a lawyer yet.

The maintainer runs no service: no sign-in instance, no accounts, nothing to agree to
([AGENTS.md](../../AGENTS.md), "Modes and hosting"). The hosted surfaces are the website `gcportrait.app` and
its sign-in-free demo at `gcportrait.app/demo/`, a static build of the app in demo-only mode, both served by
one GitHub Pages site, and neither processes personal data by design: no sign-in, no cookies, no server of its
own, no server-side storage, and no analytics. What remains are the hosting provider's request logs, the
header's repository widget and what the pages keep in the visitor's own browser. The site still needs an
Impressum, and a privacy notice for those.

## Where the legal texts live

On the operator's own website, never in this repository. For the maintainer's site and its demo:

| Page | Address | Linked from |
|---|---|---|
| Impressum | <https://florian-chrometz.de/legal/impressum> | the footer of every page of `gcportrait.app` (`website/src/site.ts`, checked by `pnpm website:check`) and of the demo (built in by `pnpm demo:static`, `--impressum-url`) |
| Privacy notice | <https://florian-chrometz.de/legal/privacy-policy> | the same (`--privacy-url`) |

The demo's footer links both pages, each in a new tab; their addresses are built into it (the maintainer's
pages by default), and it serves no texts of its own. There are no terms of use: there is no account and no
service to agree to.

Self-hosted instances are not covered here: whoever runs one is its operator, and links their own pages or
serves their own texts ([self-host-options.md, "Legal pages: link or
serve"](../self-host-options.md#legal-pages-link-or-serve); if they enable sign-in, also ["If you enable
sign-in"](../self-host-options.md#if-you-enable-sign-in)).

## What the maintainer's privacy notice covers

The facts the page at <https://florian-chrometz.de/legal/privacy-policy> must state, each checked against the
code in the [data-processing inventory](data-processing-inventory.md) (row IDs in brackets):

- **The website and its demo are on GitHub Pages.** GitHub, Inc. delivers every page and every file of the
  demo and processes the visitor's IP address, the requested URL, the time and the request headers (user
  agent, referrer) in its own logs, under its own privacy statement, also in the USA; the maintainer receives
  none of them (W1).
- **The website's header asks GitHub for the repository's facts.** Once a page has loaded, the visitor's
  browser asks `api.github.com` for the repository's public star and fork counts and its latest release's
  version (two requests made together), at most once an hour per tab, anonymously (no cookie, no referrer);
  GitHub receives the IP address, the user agent and the site's origin with each. The browser keeps the time
  and the facts in session storage for the hour. While the repository is not public the browser does not ask
  at all (W3).
- **The website counts no page views and sends nothing to a third party.** It loads nothing from another host
  but the repository facts above (W3), sets no measurement cookie, and keeps no identifier for analytics. The
  demo and self-hosted instances send nothing either.
- **The demo has no server.** It is files GitHub Pages delivers (W1); it runs in the visitor's browser, reads
  no Google Cloud data and asks no other host.
- **No cookies, no tracking, no sign-in.** Neither site sets a cookie or loads anything from another host;
  there is no analytics, no tracking across sites, no advertising and no profile; the demo has no sign-in,
  reads no Google Cloud data and sends no analytics.
- **What stays in the visitor's browser.** The values typed into the website's commands (local storage,
  `gcportrait.docs.variables`, W2); the repository widget's facts (session storage, `gcportrait.repository`,
  W3); the demo's theme (local
  storage, `gcportrait.theme`) and its generated demo organisations, saved views and imported files
  (IndexedDB); nothing of it reaches the maintainer (DS1).
- **Email**, if the page names an address: what is sent, kept until the conversation is over (C1).
- The usual parts of a notice: the controller (the person the Impressum names), the legal bases the inventory
  names, the visitor's rights, and the supervisory authority.

## Files

| File | What it is |
|---|---|
| [data-processing-inventory.md](data-processing-inventory.md) | One table of every processing operation of the site and its demo (purpose, legal basis, who, where, how long, and the code or documentation each row was checked against), what is not processed, and when to update it. The privacy notice is checked against it. |

**Keep it true.** The inventory's [When to update](data-processing-inventory.md#when-to-update) lists the
changes that need a new row and a new privacy notice: another host, a cookie, a storage key, a form, a request
to another host, another hosted surface. The values still open in the inventory (the email provider and its
location, the date of a legal review) are written in square-bracketed capitals.
