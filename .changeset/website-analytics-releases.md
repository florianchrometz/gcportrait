---
'@gcportrait/website': minor
'@gcportrait/render-cli': minor
---

The website counts its page views with TelemetryDeck, through its npm SDK bundled into the site's own files: on its own pages only (never the app, never the demo at `/demo/`, never a self-hosted instance), only in the deploying build (`WEBSITE_ANALYTICS=0` switches it off, for a fork), only on `gcportrait.app`, and never when the browser sends Do Not Track or Global Privacy Control. Each page load sends one signal with the page's path (no query, no fragment) and random identifiers kept in session storage for the tab, the user's hashed; a click on a link to the demo or the repository sends one more; no cookie, nothing in local storage. The site's changelog page is gone: its "Changelog" links, in the menu and the footer, go to the repository's releases page, which the release workflow writes from the changesets at every tag. `pnpm render --drawio-unversioned` writes a draw.io file whose `agent` carries no version, as the website's sample exports now do, so a release no longer makes them stale.
