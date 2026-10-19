<!-- SPDX-License-Identifier: Apache-2.0 -->

# @gcportrait/website

The website at <https://gcportrait.app>: a static [Astro](https://astro.build) site for GitHub Pages that presents
gcportrait as Google Cloud architecture diagrams you use three ways, self-hosted in your own Google Cloud
project, as a web app and through an API that returns any view as SVG, PNG or a draw.io file, each with its
proof; shows the features with generated screenshots and animated demos; renders the user guides from `docs/`;
publishes the asset catalog's coverage; and presents the author. Its "Changelog" links go to the repository's
releases page on GitHub (`RELEASES_URL` in `src/site.ts`), which the release workflow writes from the
commits since the previous release tag; the site keeps no copy. It serves the sign-in-free demo itself,
at <https://gcportrait.app/demo/>: a static build of the app in demo-only mode that its build places there
(below), and links to the self-hosting guide. [docs/website.md](../docs/website.md) is the maintainer's guide:
the demo, deploying, DNS, the legal pages.

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.

## Commands

From the repository root:

| Goal | Command |
|---|---|
| Develop with live reload (<http://localhost:4321>) | `pnpm website:dev` |
| Build into `website/dist` (also part of `pnpm build`), with the demo in `website/dist/demo/` (below) | `pnpm website:build` (`WEBSITE_DEMO_DIST=dist/demo` to copy a demo built before instead of building it) |
| Build the static demo alone, into `dist/demo/` at the root | `pnpm demo:static` |
| Check the static demo in the built site in Chromium ([specification](scripts/demo.ts)) | `pnpm --filter @gcportrait/website demo` (`--theme dark`, `--shots DIR`, `--dist DIR`) |
| Check built pages, resources, links, metadata, installer, demo and exports ([specification](scripts/check-site.ts)) | `pnpm website:check` |
| Check phone layouts, accessibility and demo playback ([specification](scripts/mobile.ts)) | `pnpm --filter @gcportrait/website mobile` (`--only layout`, `--only playback`, `--page /docs/`, `--theme dark`, `--width 375`) |
| Check editable command fields, Copy, storage and accessibility across browser and touch profiles ([specification](scripts/fillable.ts)) | `pnpm --filter @gcportrait/website fillable` (`--profile chromium\|firefox\|firefox-fallback\|webkit\|iphone\|pixel`, `--page /docs/permissions/`, `--shots DIR`) |
| Serve the built site | `pnpm website:preview` |
| Lighthouse on every page, light and dark, desktop and mobile ([specification](scripts/lighthouse.ts)) | `pnpm website:lighthouse` (`--page /docs/`, `--theme dark`, `--preset desktop`, `--mobile`) |
| Regenerate the screenshots, animated demos and link-preview images (`docs/media/`) | `pnpm media` (`--only scene:ID`, `--theme light`; `pnpm media --check` for staleness) |
| Regenerate the sample exports (`docs/media/exports/`, SVG, PNG and draw.io files of demo S and M in both themes, from `pnpm render`, with WebP previews; like every export, without an affiliation line) / check them | `node scripts/exports.mjs` / `node scripts/exports.mjs --check` (`--render`: draw again and compare byte for byte) |
| Unit tests, lint, types | `pnpm --filter @gcportrait/website test` (also `lint`, `typecheck`) |
| Type-check the `.astro` files alone: `@astrojs/check` over `tsconfig.astro.json`, failing on any diagnostic, hints such as an unused import included (`typecheck` runs it after `tsc -b`, and so does the root `pnpm typecheck`) | `pnpm --filter @gcportrait/website typecheck:astro` |

**What CI runs.** CI's `website` job (`pr.yml`, docs/contributing.md) runs `pnpm website:build` and
`pnpm website:check`, then `demo`, `mobile --only layout` and `fillable --profile chromium`. `mobile --only
playback`, the other fillable profiles and `website:lighthouse` stay local, run before a release
(docs/website.md, "Building and checking").

**Values to fill in.** In a guide's code a value the reader fills in is written `YOUR_` and capitals as one
word (`YOUR_PROJECT`, `YOUR_ORG_ID`), a variable of `COMMAND_VARIABLES` in `@gcportrait/model`; capitals
without `YOUR_` stay text (an environment variable, a usage line, a name pattern). The docs pages and the
landing page make each such token a field (below, and docs/website.md, "Fillable commands");
`pnpm website:check` and `node scripts/user-docs.mjs` fail on a token the registry does not list.

Astro 7 runs one dev server and one preview server per project and may keep it running in the background (it
says so with its process id); `pnpm --filter @gcportrait/website exec astro dev stop` (or
`astro preview stop`) stops it. The build needs no browser and works offline, making no requests outside the
repository. The browser checks (`mobile`, `fillable`) run entirely against the local preview server.
`pnpm media`, `pnpm website:lighthouse` and the phone check need Playwright's Chromium (`pnpm --filter
@gcportrait/e2e install-browsers` once); the phone check's playback part also needs its WebKit, and the
fillable-commands check its WebKit and Firefox (`pnpm --filter @gcportrait/website exec playwright install
webkit firefox` once); both read axe-core from the e2e package. Lighthouse itself is run with `pnpm dlx` at a
pinned version.

## Where the content comes from

Nothing is copied into the site by hand: each page is built from its one source at build time.

| Page | Source |
|---|---|
| `/` (landing) | `src/pages/index.astro`: the hero and "Three ways to use gcportrait" (self-hosted: the installer line of docs/self-host.md, `src/site.ts` `INSTALL_COMMAND`; web app: the drawer still and the demo; API: the render request of docs/api.md for demo S and the sample export it returns, `S-overview-light.png`), the features each marked with the ways it serves, numbers from the catalog; the FAQ teaser from `docs/faq.md`'s questions (the hosting, data and cost ones first); "About the author" (with the name line "Florian Chrometz & contributors", the contributors linked) and the Person structured data from `docs/author.md`; the SoftwareApplication's `featureList`, the three ways, from `src/lib/seo.ts` |
| `/docs/<slug>/` | the guides under `docs/` listed in `src/data/docs.ts` (`DOC_PAGES`), rendered by `src/lib/markdown.ts` |
| `/exports/` | the sample exports in `docs/media/exports/` and their `manifest.json`, written by `node scripts/exports.mjs` (`src/lib/exports.ts`); the landing page's "Sample exports" section shows demo S's and M's overviews from them |
| `/coverage/` | `@gcportrait/catalog` (the compiled catalog) and its `dist/coverage.json`, which `pnpm catalog:build` writes |
| `/contributing/`, `/licence/` | `src/pages/*.astro`, linking to the repository's guides, `LICENSE`, `brand/LICENSE.md` and `THIRD_PARTY.md` |
| the footer's Impressum and Privacy links | `src/site.ts` (`LEGAL_LINKS`): pages of the maintainer's website, not of this site (below) |
| the footer notice, "Not affiliated with Google / Google Cloud. gcportrait is an independent open-source project by Florian Chrometz." | `src/site.ts` (`FOOTER_NOTICE`, the name linked to `MAINTAINER_URL`), equal to the app's footer (`src/site.test.ts`); besides it, only the landing page's author section names the maintainer, and only that section carries the long-form statement (`docs/author.md`'s closing paragraph; AGENTS.md, Non-affiliation, brand and legal) |
| `/favicon.svg`, the logo | `brand/icon.svg` at the repository root (below) |
| `/install.sh`, the one-line installer | `infra/install.sh` at the repository root, copied by the build as it is; `robots.txt` keeps it out of search, and `pnpm website:check` compares it byte for byte (docs/website.md, "The installer") |
| screenshots, demos (WebM, with the GIF of the same scene as the fallback), link previews | `docs/media/`, written by `pnpm media` (`scripts/media.mjs`; the list with alt texts is `src/data/media.json`); the landing page's "Light and dark" block shows the hero still's light and dark WebPs side by side |

**Docs.** Every top-level `docs/*.md` is either a page (`DOC_PAGES`) or listed in `NOT_ON_SITE` with the
reason; a unit test fails for a new guide that is neither. Links between guides become links between pages
(`self-host-options.md#custom-domain` → `/docs/self-host-options/#custom-domain`, the anchors are GitHub's),
links to other repository files go to GitHub, raw HTML in a guide is dropped, and an image from another host
becomes its alt text (the site loads nothing from elsewhere). A guide that does not exist yet is left out of
the build with a warning.

**docs/author.md.** YAML front matter, then the section's text in Markdown: its first paragraph is also the
Person's description, and its closing paragraph is the long-form non-affiliation statement. The landing page
puts the name line above the text, "Florian Chrometz & contributors", with "contributors" linked to the
repository's contributors on GitHub (`CONTRIBUTORS_URL` in `src/lib/author.ts`, from `REPOSITORY_URL`).

```markdown
---
name: Florian Chrometz              # required
url: https://florian-chrometz.de    # required, https
jobTitle: …                         # optional
sameAs:                             # optional: profile pages; anything that is not an https URL is left out
  - https://github.com/florianchrometz
---
<!-- SPDX-License-Identifier: Apache-2.0 -->

# About the author

One or two paragraphs.
```

**Legal pages.** The site links the maintainer's external Impressum and privacy notice from every page's
footer (`IMPRESSUM_URL`, `PRIVACY_URL` and `LEGAL_LINKS` in `src/site.ts`; AGENTS.md, Modes and hosting;
[docs/website.md](../docs/website.md#legal-pages)). The repository holds no legal pages of its own;
`docs/legal/` maintains the data-processing inventory checked against the privacy notice.

**Favicon and logo.** `brand/icon.svg` at the repository root ([brand/README.md](../brand/README.md)) defines
the mark. `astro.config.ts` copies it to `dist/favicon.svg`, and `src/components/Logo.astro` renders it at
build time using `src/lib/brand.ts`. `src/lib/brand.test.ts` pins the drawing and checks consistency across
the site and app ([docs/website.md](../docs/website.md#favicon-and-logo)).

**Placeholders and strict builds.** Write a value still to be filled in as capitals in square brackets
(`[FULL NAME]`), or in double braces or angle brackets; `TODO`, `TBD` and `PLACEHOLDER` count too
(`src/lib/placeholders.ts`). A strict build (`WEBSITE_STRICT=1`, which the deploy jobs set) fails when a guide
of the docs menu or a generated medium is missing, or when `docs/author.md` holds a placeholder; a normal
build warns and goes on.

**The demo.** `/demo/` is the app itself in static demo-only mode (`pnpm demo:static`,
`scripts/static-demo.mjs`), built or copied into `dist/demo/` by `astro.config.ts` (`WEBSITE_DEMO_DIST`).
`DEMO_URL` in `src/site.ts` is `/demo/`. Site checks validate its routes and headers
(`scripts/check-site.ts`), while browser execution is tested by `scripts/demo.ts`
([docs/website.md](../docs/website.md#the-demo)).

## How it is built

- Astro, static output, one directory per page with a trailing slash (what GitHub Pages serves without
  redirects); `public/CNAME` holds `gcportrait.app`. No image service (sharp's libvips is LGPL, which the
  licence policy denies, so `pnpm-workspace.yaml` never installs it): the media are generated at their final
  sizes and used as they are, imported from `docs/media/` so each is published once under a content-hashed
  name. HTML compression is off because Astro 7's compressor drops the space between a line of text and a link
  on the next line; `pnpm website:check` guards against that.
- Phones and desktops from one layout (docs/website.md, "Mobile"): the grids fall to one column by themselves
  (`auto-fit`), and below 48rem the header shows the wordmark and a Menu button over "Try the demo" and the
  GitHub link, the docs menu and a guide's contents fold away behind buttons (below 52rem), links and buttons
  that are not inline text are at least 44 × 44 pixels, and wide tables and code scroll inside their own box
  (a table shows a shaded edge where there is more). The pictures' `sizes` name the width they are shown at,
  so a phone takes the 720-pixel WebP at 2× and the 1440 one at 3×.
- Fillable commands on the docs pages and the landing page
  ([docs/website.md](../docs/website.md#fillable-commands)): `src/lib/markdown.ts` renders registered
  `YOUR_…` tokens in code blocks and inline code as editable fields with Copy bars.
  `src/components/Variables.astro` provides the companion panel and live region. `src/lib/fillable-page.ts`
  (with DOM-free helpers in `src/lib/fillable.ts`) synchronises field values across the page, manages keyboard
  interaction, and persists non-secret values in `localStorage` (`gcportrait.docs.variables`).
  Browser-specific DOM workarounds (including WebKit caret retention and `plaintext-only` detection) are
  documented in `src/lib/fillable-page.ts`.
- The header stays at the top of the window while the page scrolls (`position: sticky`;
  [docs/website.md](../docs/website.md#mobile)). Its height is measured by `src/layouts/Base.astro` and
  written to `--header-block` and root `scroll-padding-top` so focused targets and anchor jumps never land
  under the header.
- Every link to the demo opens it in a new tab (`target="_blank"`, `rel="noopener"`) and says so to assistive
  technology (" (opens in a new tab)", visually hidden): the demo is the app, a page of its own with no way
  back to the site. The pages write it with `src/components/DemoLink.astro`; a guide's link to
  `https://gcportrait.app/demo/…` gets the same from `src/lib/markdown.ts`. `pnpm website:check` refuses any
  link to the demo without both.
- Small scripts. On every page (`src/layouts/Base.astro`, inlined by Astro): header height measurement and
  panel toggle states (`aria-expanded`). On pages with an animated demo (`src/components/DemoVideo.astro`):
  themed WebM playback with GIF fallback and pause controls. The site runs no analytics and sends
  no data to third parties ([docs/website.md](../docs/website.md#analytics)).
- Guides are rendered by `src/lib/markdown.ts`: raw HTML is dropped, and a link keeps its target
  only for http, https, mailto or a path (a `javascript:` or `data:` link becomes plain text). What may scroll
  sideways is keyboard-focusable (WCAG 2.1.1): every code block (`tabindex="0"`), and every table through its
  `.table-scroll` box. A code block written in a page itself either has `tabindex="0"` too or wraps its lines
  (`class="wrap"`); `pnpm website:check` refuses any other. An empty header cell becomes a data cell, and a
  table cell holding a command keeps a readable width (`cell-command`).
- The header's GitHub link (top right, next to "Try the demo") is a static link to the repository
  (`src/components/Header.astro`), linking to the repository on GitHub with `rel="noopener"` and keeping a
  44×44px touch target on mobile ([docs/website.md](../docs/website.md#mobile)).
- Light and dark follow `prefers-color-scheme`, with the app's palette values (`src/styles/global.css`;
  `src/styles/contrast.test.ts` checks every text pair at 4.5 : 1). Roboto and Roboto Mono are self-hosted
  from `@fontsource` (Latin subsets; regular, medium and mono are preloaded, so text does not shift when they
  arrive); the build writes their OFL licences and gcportrait's `LICENSE` to `dist/licenses/`.
- Every page has its title (at most 60 characters; a guide with a longer heading has a `searchTitle` in
  `src/data/docs.ts`), description (50 to 160), canonical URL on https://gcportrait.app, OpenGraph and Twitter
  card tags with its own 1200×630 image, and JSON-LD (`src/lib/seo.ts`): WebSite on every page,
  SoftwareApplication, SoftwareSourceCode and Person on the landing page, TechArticle and BreadcrumbList on
  the guides. The structured data names the author as a Person on the landing page (a guide's TechArticle
  refers to it by its id) and never an Organization, and no metadata carries the non-affiliation statement
  (AGENTS.md, Non-affiliation, brand and legal). `sitemap.xml` and `robots.txt` are generated. The 404 page,
  served at every unknown address, is `noindex` and names no canonical URL.
- The `.astro` files are type-checked by `@astrojs/check`, the checker of `astro check`
  (`scripts/astro-check.ts`, the `typecheck:astro` script, which `typecheck` and the root `pnpm typecheck` run
  after `tsc -b`): their frontmatter, expressions and scripts, under `tsconfig.astro.json`, which holds the
  `.astro` files and `src/env.d.ts`; the `.ts` files stay with `tsconfig.json` and `tsc -b`. ESLint does not
  read `.astro` files, so every diagnostic fails the check, the hints that stand in for its rules included (a
  declaration never read, a deprecated API, an `await` without effect, a promise chain an async function
  would replace). Their logic lives in typed modules under `src/lib/`, which `tsc -b` and ESLint check, and
  an exception to a rule belongs there, with its disable comment's reason. The script calls the checker
  itself, not through `astro check`, which offers to install a checker it cannot load and otherwise exits 0
  with nothing checked; here a checker that cannot be loaded fails the check, naming the missing module.
  Should that module be one an earlier install of the tree left out as an optional package for another
  platform, a later `pnpm install` keeps it out: remove `node_modules` at the repository root and run `pnpm
  install` again.

## Layout

```
astro.config.ts        site, output, the licence files, the favicon (brand/icon.svg, copied), the installer
                       (infra/install.sh, copied to /install.sh), the SPDX-comment
                       clean-up after the build, and the demo at /demo/ (built by pnpm demo:static, or copied)
public/                CNAME (the favicon and the installer are copied by the build from brand/ and infra/)
scripts/               check-site.ts (pnpm website:check), lighthouse.ts (pnpm website:lighthouse), mobile.ts (the
                       phone check), fillable.ts (the fillable-commands check in three engines and on two phones),
                       demo.ts (the demo's check in a browser), astro-check.ts (the .astro files'
                       type check, over tsconfig.astro.json), browser.ts (axe-core and other helpers the browser
                       checks share), serve.ts (the built site served as GitHub Pages serves it:
                       byte ranges, `x.html` for `x`, the trailing-slash redirect)
src/site.ts            the fixed facts: hosts, the demo, repository, image, the footer notice and the long form (equal
                       to the app's)
src/data/              docs.ts (the docs menu, with /exports/ after the Export guide), media.json (the generated
                       media, read by scripts/media.mjs too)
src/lib/               markdown, docs, coverage, author, placeholders, brand (the mark of brand/icon.svg
                       for the logo, and the favicon-and-logo comparison), media, exports (the sample
                       exports), seo, sitemap, fillable and
                       fillable-page (the fillable commands of the docs pages and the landing page)
src/components/        Header (sticky, with the GitHub link), Footer, Logo, DemoLink (a link to the demo, in a
                       new tab), ThemedPicture, DemoVideo, Variables, ExportCard (a sample export: both themes'
                       previews with their download and open links)
src/layouts/           Base (head, header, footer), Docs
src/pages/             index, docs/index, docs/[slug], exports, coverage, contributing, licence, 404,
                       sitemap.xml, robots.txt
```
