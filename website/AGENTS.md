<!-- SPDX-License-Identifier: MIT -->

# AGENTS.md: the website

These rules add to the root AGENTS.md, which applies here too.

## The site

- **The website explains gcportrait and is built to be found.** It presents the project and its features with
  screenshots and animated demos of the demo organisations, and renders the user guides. Every page has a
  unique title (at most 60 characters) and description (50 to 160), as search results show them whole, a
  canonical URL on `https://gcportrait.app`, OpenGraph and Twitter card tags with a 1200 × 630 image,
  parseable JSON-LD and an entry in the sitemap; the JSON-LD never names an Organization, so that nothing
  reads as Google's. The landing page presents the maintainer in an author section with links and Person
  structured data ([docs/author.md](../docs/author.md)). People find a tool through search and link previews,
  and judge an open-source project by who stands behind it. `pnpm website:check` enforces all of it
  ([docs/website.md](../docs/website.md)).

- The "Open in Cloud Shell" tutorial and "Run on Google Cloud" button sit beside "Self-host" on the
  website's landing page, where they open a new tab that their name announces and draw a mark of the site's
  own (the site loads nothing from another host). Their other placements follow
  [AGENTS.md](../AGENTS.md), "Modes and hosting".

The metadata's non-affiliation rule is in [AGENTS.md](../AGENTS.md), "Non-affiliation, brand and legal".

## The static demo

The shared static-demo build, configuration, route copies and policies follow [AGENTS.md](../AGENTS.md),
"Modes and hosting".

- **Every link to the demo on the website opens a new tab**, wherever it is (a page, a guide, the header, the
  footer), with `rel="noopener"`, and says so in its name ("opens in a new tab", visually hidden): the demo is
  the app, with no way back to the page it was opened from. `pnpm website:check` enforces it.

## Analytics

Page views are counted with TelemetryDeck, through its npm SDK
bundled into the site (no script from a CDN): only in a deploying build (the repository variable
`WEBSITE_ANALYTICS`, which a fork sets to `0`), only when served from `gcportrait.app` itself, never when
the browser sends Do Not Track or Global Privacy Control, without a cookie and without query strings or
fragments. A count of visits is all the maintainer needs, and the privacy notice describes exactly that
([docs/website.md](../docs/website.md), "Analytics").

The permission to count the website's page views, and the app's and demo's no-telemetry contract, are in
[AGENTS.md](../AGENTS.md), "Modes and hosting".

## Commands

| Goal | Command |
|---|---|
| Build / check / serve the website (`website/`, docs/website.md) | `pnpm website:build`, then `pnpm website:check` (metadata, links, sitemap, the footer notice, the demo and its links) / `pnpm website:dev` (live) / `pnpm website:lighthouse` |
| Check the built website in real browsers: on phones (layout, the sticky header, touch targets, the names of links and buttons, axe, the animated demos' playback) / the fillable commands / the header's repository widget / the static demo | `pnpm website:mobile` / `pnpm --filter @gcportrait/website fillable` / `... stars` / `... demo` (each after `pnpm website:build`) |
| Build the static demo the website serves at `/demo/` (AGENTS.md, Modes and hosting; `pnpm website:build` runs it) | `pnpm demo:static` (`--out DIR`, `--base PATH`) |
