<!-- SPDX-License-Identifier: MIT -->

# Data-processing inventory: gcportrait.app

**A fact sheet, not legal advice; not yet reviewed by a lawyer.**

Every processing of personal data by what the maintainer hosts ([AGENTS.md](../../AGENTS.md), "Modes and
hosting"): the website `gcportrait.app` and its demo at `gcportrait.app/demo/` (a static build of the app in
demo-only mode), both static files on one GitHub Pages site. The privacy notice, on the maintainer's website
at <https://florian-chrometz.de/legal/privacy-policy> and linked from every page of both
([README](README.md)), describes each row in plain words: what it says about the website and the demo's
delivery is rows W1 to W3, about the demo's storage in the browser row DS1, and about email row C1. The
controller is the person named in the Impressum, <https://florian-chrometz.de/legal/impressum>. Self-hosted
instances of gcportrait are not covered: whoever runs one is its operator
([self-host-options.md](../self-host-options.md#legal-pages-link-or-serve)).

Each row is checked against the code and the providers' documentation named in its last column. Last reviewed
by a lawyer: [DATE OF LEGAL REVIEW].

| ID | Operation | Personal data | Purpose | Legal basis | Who processes it | Where | Kept for | Checked against |
|---|---|---|---|---|---|---|---|---|
| W1 | Website and demo: GitHub Pages delivers a page or a file of the demo | IP address, requested URL, time, request headers (user agent, referrer) | delivering the pages; GitHub: security | Art. 6 (1) (f) GDPR | GitHub, Inc., under its own privacy statement (its role is to be confirmed); the maintainer receives no logs | GitHub's servers, also in the USA (GitHub names the EU-U.S. Data Privacy Framework and standard contractual clauses) | not stated by GitHub | GitHub Docs, "About GitHub Pages" (data collection) and the GitHub General Privacy Statement; `pnpm website:check` refuses any resource from another host |
| W2 | Website: the values a visitor types into the commands of the documentation pages | what the visitor types there, such as a Google Cloud project id, an organisation number, a region or an email address | filling them into the commands of every documentation page, on later visits too | § 25 (2) no. 2 TDDDG for the storage; nothing reaches the maintainer | nobody but the visitor | the visitor's browser (local storage, key `gcportrait.docs.variables`) | until the visitor removes them ("Clear values" on a documentation page, or the browser's site data) | `website/src/lib/fillable-page.ts` and `website/src/lib/fillable.ts` (a variable marked secret is never stored); `pnpm website:check` refuses any resource from another host |
| W3 | Website: the visitor's browser asks GitHub for the repository's public facts, for the header's repository widget: two requests made together, the repository (its star and fork counts) and its latest release (its version), once the page has loaded, at most once an hour per browser tab whatever GitHub answers (facts or a failure); never where session storage is blocked, and never while the build of the site found the repository not public (GitHub answered its own request with a 404: the pages then tell the browser to ask nothing, until the next build after the repository goes public) | IP address, user agent, in Chromium-based browsers its client hints (`sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`: brand, version, mobile or not, platform), the preferred languages (`Accept-Language`), the site's origin (`https://gcportrait.app`, which a browser sends with a cross-origin request) and time, as GitHub receives them with each of the two requests; no cookie, no referrer (no page address), nothing the visitor typed. In the visitor's browser: the time of the last requests and the facts, if GitHub gave them (the version, the star count and the fork count) | showing the repository's current version, star count and fork count in the link to the repository | Art. 6 (1) (f) GDPR for the requests; § 25 (2) no. 2 TDDDG for the storage (to be confirmed: the time is kept so that the browser asks GitHub at most once an hour per tab, also after a failure, and the facts so that they can be shown without asking again) | GitHub, Inc. (`api.github.com`), under its own privacy statement (its role is to be confirmed, as for W1); the maintainer receives nothing | GitHub's servers, also in the USA (as W1); the time and the facts in the visitor's browser (session storage, key `gcportrait.repository`) | GitHub: not stated; the browser: an hour at most, and never past the tab (session storage ends with it) | `website/src/lib/star-count.ts` (`liveRepositoryFacts`: a GET of `https://api.github.com/repos/florianchrometz/gcportrait` and one of `…/releases/latest`, each with `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`; `currentRepositoryFacts`: the note written before the requests, no request where it cannot be written) and `website/src/lib/star-count-page.ts`; `pnpm website:check` allows these requests and no other host in a script; `pnpm --filter @gcportrait/website stars` answers them in a browser and checks the requests' options (no credentials, no referrer, Accept only); `pnpm --filter @gcportrait/website stars --real` checks against GitHub itself that no cookie and no referrer are sent and that after GitHub's 404 a reload within the hour asks nothing; `website/src/lib/github.ts` (`askRepositoryFacts`: a 404 or an answer marked private is `notPublic`) and `website/src/components/Header.astro` (`data-repository-not-public`), and `pnpm --filter @gcportrait/website stars` on a build made while the repository is private: no request at all |
| DS1 | Demo: storage in the visitor's browser | the generated demo organisations, saved views, preferences such as the theme, and files the visitor imports (IndexedDB database `gcportrait`); the theme (local storage `gcportrait.theme`); personal data only if an imported file contains some | the demo's function | § 25 (2) no. 2 TDDDG for the storage; nothing reaches the maintainer | nobody but the visitor | the visitor's browser | until the visitor deletes it (the Snapshots page, the browser's site data) | `frontend/src/storage/db.ts`, `frontend/src/theme/browser.ts`, `frontend/src/theme/theme.ts`; the demo's Content Security Policy (the backend's demo-only policy as a `<meta>`, `scripts/static-demo.mjs`) allows connections to the site's own host only |
| C1 | Email to the address in the Impressum and the notice | email address, name if given, the message | answering | Art. 6 (1) (f) GDPR | the maintainer; the email provider [EMAIL PROVIDER] | [EMAIL PROVIDER LOCATION] | until the conversation is over; longer only where the law requires it | the maintainer's mailbox |

## Not processed

Each item is part of what the notice promises. A change to any of them needs a new row above and a new privacy
notice.

- **No cookies by the website, and no storage but rows W2 and W3**: only the documentation pages' fillable
  commands (row W2) and the header's repository widget (row W3, session storage); the demo videos' player
  (`website/src/components/DemoVideo.astro`) and the menu buttons keep nothing. The demo sets no cookie.
- **No analytics, no telemetry, no tracking across sites, advertising or social-media plug-ins, and no request
  to another host but row W3**: `pnpm website:check` fails a page that loads anything from another host, or
  whose scripts ask any other host than `api.github.com` for the repository widget (row W3); the demo's
  Content Security Policy allows only its own host (and `data:` images), and its app has no telemetry.
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
