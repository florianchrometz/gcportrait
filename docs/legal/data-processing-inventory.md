<!-- SPDX-License-Identifier: Apache-2.0 -->

# Data-processing inventory: gcportrait.app

**A fact sheet, not legal advice; not yet reviewed by a lawyer.**

Every processing of personal data by what the maintainer hosts ([AGENTS.md](../../AGENTS.md), "Modes and
hosting"): the website `gcportrait.app` and its demo at `gcportrait.app/demo/` (a static build of the app in
demo-only mode), both static files on one GitHub Pages site. The privacy notice, on the maintainer's website
at <https://florian-chrometz.de/legal/privacy-policy> and linked from every page of both
([README](README.md)), describes each row in plain words: what it says about the website and the demo's
delivery is rows W1 and W2, about the demo's storage in the browser row DS1, and about email row C1. The
controller is the person named in the Impressum, <https://florian-chrometz.de/legal/impressum>. Self-hosted
instances of gcportrait are not covered: whoever runs one is its operator
([self-host-options.md](../self-host-options.md#legal-pages-link-or-serve)).

Each row is checked against the code and the providers' documentation named in its last column. Last reviewed
by a lawyer: [DATE OF LEGAL REVIEW].

| ID | Operation | Personal data | Purpose | Legal basis | Who processes it | Where | Kept for | Checked against |
|---|---|---|---|---|---|---|---|---|
| W1 | Website and demo: GitHub Pages delivers a page or a file of the demo | IP address, requested URL, time, request headers (user agent, referrer) | delivering the pages; GitHub: security | Art. 6 (1) (f) GDPR | GitHub, Inc., under its own privacy statement (its role is to be confirmed); the maintainer receives no logs | GitHub's servers, also in the USA (GitHub names the EU-U.S. Data Privacy Framework and standard contractual clauses) | not stated by GitHub | GitHub Docs, "About GitHub Pages" (data collection) and the GitHub General Privacy Statement; `pnpm website:check` refuses any resource from another host |
| W2 | Website: the values a visitor types into the commands of the documentation pages | what the visitor types there, such as a Google Cloud project id, an organisation number, a region or an email address | filling them into the commands of every documentation page, on later visits too | § 25 (2) no. 2 TDDDG for the storage; nothing reaches the maintainer | nobody but the visitor | the visitor's browser (local storage, key `gcportrait.docs.variables`) | until the visitor removes them ("Clear values" on a documentation page, or the browser's site data) | `website/src/lib/fillable-page.ts` and `website/src/lib/fillable.ts` (a variable marked secret is never stored); `pnpm website:check` refuses any resource from another host |
| DS1 | Demo: storage in the visitor's browser | the generated demo organisations, saved views, preferences such as the theme, and files the visitor imports (IndexedDB database `gcportrait`); the theme (local storage `gcportrait.theme`); personal data only if an imported file contains some | the demo's function | § 25 (2) no. 2 TDDDG for the storage; nothing reaches the maintainer | nobody but the visitor | the visitor's browser | until the visitor deletes it (the Snapshots page, the browser's site data) | `frontend/src/storage/db.ts`, `frontend/src/theme/browser.ts`, `frontend/src/theme/theme.ts`; the demo's Content Security Policy (the backend's demo-only policy as a `<meta>`, `scripts/static-demo.mjs`) allows connections to the site's own host only |
| C1 | Email to the address in the Impressum and the notice | email address, name if given, the message | answering | Art. 6 (1) (f) GDPR | the maintainer; the email provider [EMAIL PROVIDER] | [EMAIL PROVIDER LOCATION] | until the conversation is over; longer only where the law requires it | the maintainer's mailbox |

## Not processed

Each item is part of what the notice promises. A change to any of them needs a new row above and a new privacy
notice.

- **No cookies by the website, and no storage but row W2**: only the documentation pages' fillable
  commands (row W2); the demo videos' player (`website/src/components/DemoVideo.astro`) and the menu buttons
  keep nothing. The demo sets no cookie.
- **No analytics, no telemetry, no tracking across sites, advertising or social-media plug-ins, and no request
  to another host**: `pnpm website:check` fails a page that loads anything from another host, or whose scripts
  ask any other host; the demo's Content Security Policy allows only its own host (and `data:` images),
  and its app has no telemetry.
- **No sign-in and no Google Cloud data in the demo**: the static demo's bundle holds no sign-in code and its
  configuration offers no OAuth client and no service-account mode (`scripts/static-demo.test.ts`,
  `frontend/src/pages/ConnectPage.staticDemo.test.tsx`).
- **No server-side storage**: neither surface has a server of its own; the part of an address after `#`, where
  the app keeps its view, never reaches GitHub's servers either.
- **No transfer by the maintainer** to anyone but the providers in the table.

## When to update

When the website or the demo change host; when the code adds a request to another host, a cookie, a storage
key or a form; when another hosted surface appears. Then update this table, the privacy notice on the
maintainer's website and, for a new provider, the scope of the Impressum there ([README](README.md)).
