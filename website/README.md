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
| Check the demo in the built site in Chromium at 1440 × 900, served as GitHub Pages serves it, both themes: the Connect page, S, M and L, a drill-in, the timeline, PNG and SVG export, a reload on a deep link, every route, the 404; axe, no request elsewhere, no policy violation | `pnpm --filter @gcportrait/website demo` (`--theme dark`, `--shots DIR`, `--dist DIR`) |
| Check built pages, resources, links, metadata, installer, demo and exports ([specification](scripts/check-site.ts)) | `pnpm website:check` |
| Check phone layouts, accessibility and demo playback ([specification](scripts/mobile.ts)) | `pnpm --filter @gcportrait/website mobile` (`--only layout`, `--only playback`, `--page /docs/`, `--theme dark`, `--width 375`, `--stars 12345` with `--forks 678` and `--release v1.2.3` for GitHub's mocked answers, which a page asks for only on a build that did not find the repository not public, such as one with `WEBSITE_STAR_COUNT`) |
| Check editable command fields, Copy, storage and accessibility across browser and touch profiles ([specification](scripts/fillable.ts)) | `pnpm --filter @gcportrait/website fillable` (`--profile chromium\|firefox\|firefox-fallback\|webkit\|iphone\|pixel`, `--page /docs/permissions/`, `--shots DIR`) |
| Check the header's repository widget, live, in Chromium on `/` at 1440, 768, 390 and 320 px in both themes, GitHub's answers given by the check: the repository and its latest release asked once each after load, anonymous; the version, stars and forks shown with no layout shift, kept for the hour; a repository without a release keeping the build's version; a 404, 403, 429, 500, bad body, timeout or no network changing nothing and asking nothing more within the hour; no request with storage blocked; no request at all where the build found the repository not public (on such a build, all the check runs; on others, simulated); axe-core; `--real` asks GitHub itself once | `pnpm --filter @gcportrait/website stars` (`--count 1301`, `--forks 42`, `--release v1.0.1`, `--real`, `--shots DIR`) |
| Serve the built site | `pnpm website:preview` |
| Lighthouse on every page, light and dark, desktop and mobile (thresholds: performance 90, the rest 95) | `pnpm website:lighthouse` (`--page /docs/`, `--theme dark`, `--preset desktop`, `--mobile`) |
| Regenerate the screenshots, animated demos and link-preview images (`docs/media/`) | `pnpm media` (`--only scene:ID`, `--theme light`; `pnpm media --check` for staleness) |
| Regenerate the sample exports (`docs/media/exports/`, SVG, PNG and draw.io files of demo S and M in both themes, from `pnpm render`, with WebP previews; like every export, without an affiliation line) / check them | `node scripts/exports.mjs` / `node scripts/exports.mjs --check` (`--render`: draw again and compare byte for byte) |
| Unit tests, lint, types | `pnpm --filter @gcportrait/website test` (also `lint`, `typecheck`) |
| Type-check the `.astro` files alone: `@astrojs/check` over `tsconfig.astro.json`, failing on any diagnostic, hints such as an unused import included (`typecheck` runs it after `tsc -b`, and so does the root `pnpm typecheck`) | `pnpm --filter @gcportrait/website typecheck:astro` |

**What CI runs.** CI's `website` job (`pr.yml`, docs/contributing.md) runs `pnpm website:build` and
`pnpm website:check`, then `demo`, `mobile --only layout`, `fillable --profile chromium` and `stars`, the last
on a build made with `WEBSITE_STAR_COUNT`, `WEBSITE_FORK_COUNT` and `WEBSITE_RELEASE`. `mobile --only
playback`, the other fillable profiles and `website:lighthouse` stay local, run before a release
(docs/website.md, "Building and checking").

**Values to fill in.** In a guide's code a value the reader fills in is written `YOUR_` and capitals as one
word (`YOUR_PROJECT`, `YOUR_ORG_ID`), a variable of `COMMAND_VARIABLES` in `@gcportrait/model`; capitals
without `YOUR_` stay text (an environment variable, a usage line, a name pattern). The docs pages and the
landing page make each such token a field (below, and docs/website.md, "Fillable commands");
`pnpm website:check` and `node scripts/user-docs.mjs` fail on a token the registry does not list.

Astro 7 runs one dev server and one preview server per project and may keep it running in the background (it
says so with its process id); `pnpm --filter @gcportrait/website exec astro dev stop` (or
`astro preview stop`) stops it. The build needs no browser and works offline: its one ask outside the
repository, the repository widget's facts (the latest release, the stars, the forks), falls back to none
(below). The browser checks (`mobile`, `fillable`, `stars`) answer the pages' own requests for the live facts
themselves; Lighthouse lets each run ask GitHub. `pnpm media`, `pnpm website:lighthouse` and the phone check
need Playwright's Chromium (`pnpm --filter @gcportrait/e2e install-browsers` once); the phone check's playback
part also needs its WebKit, and the fillable-commands check its WebKit and Firefox
(`pnpm --filter @gcportrait/website exec playwright install webkit firefox` once); both read axe-core from the
e2e package. Lighthouse itself is run with `pnpm dlx` at a pinned version.

## Where the content comes from

Nothing is copied into the site by hand: each page is built from its one source at build time.

| Page | Source |
|---|---|
| `/` (landing) | `src/pages/index.astro`: the hero (with "Open in Cloud Shell" and "Run on Google Cloud" beside "Self-host", `src/components/StartLink.astro`, in a new tab) and "Three ways to use gcportrait" (self-hosted: the installer line of docs/self-host.md, `src/site.ts` `INSTALL_COMMAND`; web app: the drawer still and the demo; API: the render request of docs/api.md for demo S and the sample export it returns, `S-overview-light.png`), the features each marked with the ways it serves, numbers from the catalog; the FAQ teaser from `docs/faq.md`'s questions (the hosting, data and cost ones first); "About the author" (with the name line "Florian Chrometz & contributors", the contributors linked) and the Person structured data from `docs/author.md`; the SoftwareApplication's `featureList`, the three ways, from `src/lib/seo.ts` |
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

**Legal pages.** The site has none of its own: the maintainer keeps the Impressum and the privacy notice on
their own website, and the footer of every page links them, <https://florian-chrometz.de/legal/impressum> and
<https://florian-chrometz.de/legal/privacy-policy> (`IMPRESSUM_URL`, `PRIVACY_URL` and `LEGAL_LINKS` in `src/site.ts`;
AGENTS.md, Modes and hosting). They are external links in the footer's style, `rel="noopener"`, named
"… (external site, florian-chrometz.de)" for assistive technology with the part in brackets visually hidden,
and marked with an arrow; `pnpm website:check` requires both on every page. No secret, no `WEBSITE_LEGAL_DIR`,
no texts in the repository; `docs/legal/` keeps only the data-processing inventory the maintainer's privacy
notice is checked against (docs/website.md, "Legal pages").

**Favicon and logo.** One drawing, one file: `brand/icon.svg` at the repository root (brand/README.md). The
build copies it to `dist/favicon.svg` as it is (and the development server serves it there;
`astro.config.ts`), and `src/components/Logo.astro` draws the same shapes in the same colours, read from it at
build time (`src/lib/brand.ts`: the light colours as attributes, the dark ones as custom properties its
stylesheet applies in the dark theme). The app's favicon is the same file (`frontend/vite.config.ts` writes it
into every build of the app, the demo's included). `src/lib/brand.test.ts` checks that the favicon and the
logo are the same drawing (and the README's wordmarks and the link-preview images' mark too);
`pnpm website:check` checks the build.

**Placeholders and strict builds.** Write a value still to be filled in as capitals in square brackets
(`[FULL NAME]`), or in double braces or angle brackets; `TODO`, `TBD` and `PLACEHOLDER` count too
(`src/lib/placeholders.ts`). A strict build (`WEBSITE_STRICT=1`, which the deploy jobs set) fails when a guide
of the docs menu or a generated medium is missing, or when `docs/author.md` holds a placeholder; a normal
build warns and goes on.

**The demo.** `/demo/` is the app itself, not an Astro page: a static build in demo-only mode
(`pnpm demo:static`, `scripts/static-demo.mjs` at the root; docs/website.md, "The demo"). After Astro has
written the site, `astro.config.ts` (`staticDemo`) runs that command with `--out dist/demo` and the footer's
legal links (`IMPRESSUM_URL`, `PRIVACY_URL`), or copies the bundle `WEBSITE_DEMO_DIST` names (relative to the
repository root, built for `/demo/`; the workflows build the demo as a step of its own first), so
`pnpm website:build` alone gives the whole site. `DEMO_URL` in `src/site.ts` is `/demo/`: every "Try the demo"
link points there, and the sitemap lists it (but none of the app's other routes). The page checks leave it out
(it is the app, not a page of the site), and so do the phone and Lighthouse checks; `checkDemo` in
`scripts/check-site.ts` and `scripts/demo.ts` check it instead, and the app's own phone and tablet check
(`pnpm --filter @gcportrait/frontend mobile`) its layouts. `pnpm website:dev` serves the last
`pnpm demo:static` bundle at `/demo/` (its start page and files: Astro's trailing-slash rule answers a reload
on `/demo/diagram` with a 404 in development; the built site has every route). `scripts/serve.ts` answers
`/demo/diagram` with `demo/diagram.html` and redirects a folder's address to its trailing slash, as GitHub
Pages does.

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
- Fillable commands on the docs pages and the landing page (docs/website.md, "Fillable commands"):
  `src/lib/markdown.ts` renders each registered `YOUR_…` token in a guide's code as `span.var[data-var]`, each
  code block in a box under a bar with a Copy button, and the page's first block with fields under a hint line
  ("Edit a highlighted value in any command; every command on this page follows."); the landing page's
  commands go through the same functions (`renderCommandBlock`, `renderInlineCode`).
  `src/components/Variables.astro` adds the Variables panel (label, token, description, example and an input
  per variable of the page; folded below 52rem) and a live region; its script, `src/lib/fillable-page.ts` with
  the DOM-free parts in `src/lib/fillable.ts` (8.4 kB, 3.1 kB gzipped, its own file loaded only by pages with
  code), makes the tokens inline text boxes, keeps every field of a variable and its input on one value,
  copies a block with the values (an unfilled one as its token), marks a value of the wrong format when its
  field is left, and keeps the values of variables that are not secret in `localStorage`
  (`gcportrait.docs.variables`, one JSON object, shared by every page with fields; "Clear values" removes it).
  Without JavaScript the code shows its tokens, and the noscript style hides the bars, the hint, the inputs
  (`data-var-js`) and the fields' edit mark. The bars and the hint hold their height from the start, so
  nothing moves when the script runs.

  **Why the fields are the tokens' own spans, made editable, and not `<input>`s:** the field's text stays the
  command's text, so a command selected and copied by hand carries the values (an input's value is not part of
  a selection), the code keeps its layout from the first paint (an input would be swapped in and sized by
  script), and a long command wraps or scrolls as before. To work in every browser the script feature-detects
  `contenteditable="plaintext-only"` (set on a probe, read back: Chromium, Safari and Firefox from 136) and
  falls back to `contenteditable="true"` with formatting and drops refused and leftover markup turned back
  into text; it takes every paste as plain text on one line, and Enter leaves the field. It never empties a
  focused field: a field that shows its token selects it, and the first key that edits replaces all of it:
  emptying a field on focus would lose the caret in WebKit, so on a Mac's Safari and on every iPhone typing
  into a command would do nothing. Before anyone touches them the fields read as editable: tinted, underlined,
  ending in a pencil (the edit mark, drawn by `global.css` with a mask, the site's own drawing), ringed on
  hover or press; on a touch screen each has a transparent 44-pixel-tall tap target (`.var-target`), over the
  code's text and under every field.
- The header stays at the top of the window while the page scrolls (`position: sticky`; its background reaches
  under a phone's status bar where the page is drawn there, the safe-area inset). Its height is kept in
  `--header-block` (`global.css` estimates it per width; the script of `src/layouts/Base.astro` measures it),
  and the root's `scroll-padding-top` follows it, so an anchor jump, the skip link's target or a focused
  element never lands under the header; headings keep another 1rem (`scroll-margin-top`). The docs menu sits
  below it and scrolls on its own where it is taller than the window; the skip link shows above it.
  `pnpm --filter @gcportrait/website mobile` checks that the header stays at the top when a page is scrolled
  to its end and that an anchor's heading lands below it.
- Every link to the demo opens it in a new tab (`target="_blank"`, `rel="noopener"`) and says so to assistive
  technology (" (opens in a new tab)", visually hidden): the demo is the app, a page of its own with no way
  back to the site. The pages write it with `src/components/DemoLink.astro`; a guide's link to
  `https://gcportrait.app/demo/…` gets the same from `src/lib/markdown.ts`. `pnpm website:check` refuses any
  link to the demo without both.
- Small scripts. On every page (`src/layouts/Base.astro`, inlined by Astro, about 0.7 kB): the header's height
  for the scroll padding (above); the folding buttons flip `aria-expanded`, Escape closes; without JavaScript
  every panel is shown and the buttons are not (a noscript style). On pages with an animated demo
  (`src/components/DemoVideo.astro`, about 2.6 kB, 1.2 kB gzipped): the poster in the visitor's theme, its
  WebM played over it, muted and inline, while it is on screen, one demo's file fetched at a time; where the
  WebM cannot play (`canPlayType`, an error, or a stall before any data) the GIF of the same scene and theme,
  fetched only then. Each demo has a pause button in its corner once it plays (WCAG 2.2.2: the demos loop for
  longer than five seconds; a paused GIF gives way to the poster); a demo the visitor paused stays paused.
  With reduced motion nothing plays by itself: the poster shows with a Play button. On every page, too, the
  header's repository widget (below), in a file of its own that every page shares (about 4.1 kB, 1.9 kB
  gzipped). The site counts no page views and sends nothing to a third party (docs/website.md, "Analytics").
- Guides are rendered by `src/lib/markdown.ts`: raw HTML is dropped, and a link keeps its target
  only for http, https, mailto or a path (a `javascript:` or `data:` link becomes plain text). What may scroll
  sideways is keyboard-focusable (WCAG 2.1.1): every code block (`tabindex="0"`), and every table through its
  `.table-scroll` box. A code block written in a page itself either has `tabindex="0"` too or wraps its lines
  (`class="wrap"`); `pnpm website:check` refuses any other. An empty header cell becomes a data cell, and a
  table cell holding a command keeps a readable width (`cell-command`).
- The header's GitHub link (top right, next to "Try the demo") is the repository widget: the GitHub mark,
  unmodified and used only as a link to the repository under GitHub's logo guidelines, the word "GitHub", and
  the repository's latest release (its tag, `v1.0.0`), star count and fork count in one pill, each after a
  drawing of the site's own, in two layers (docs/website.md, "GitHub repository widget"). Its name says them
  all: "gcportrait on GitHub: version 1.0.0, 12 stars, 3 forks". On a phone it shows the mark and the counts,
  below 368 pixels the stars only. First, `src/lib/github.ts` reads the facts from GitHub's REST API once per
  build, the repository (`stargazers_count`, `forks_count`) and `…/releases/latest` (`tag_name`) together
  (with `GITHUB_TOKEN` when set, 3 s timeout), and the pages carry them as text, so they are there at first
  paint. Offline, rate-limited, or while the repository is private (a 404), the build prints one warning line
  and the link shows no facts (the pill is in the page, hidden; after the 404, or an answer marked private,
  there is no pill and the link carries `data-repository-not-public`, below); a repository without a release
  gets its counts and no version; it never fails. `WEBSITE_STAR_COUNT=1234` (with `WEBSITE_FORK_COUNT=56` and
  `WEBSITE_RELEASE=v1.0.0`, else 0 forks and no version) uses fixed facts and `WEBSITE_STAR_COUNT=off` none,
  both without the build's requests; a `REPOSITORY_URL` (`src/site.ts`) that is not a github.com repository,
  as in a fork hosted elsewhere, gives no facts, one warning, and no `data-repository`. pages.yml rebuilds
  daily, but only once a deploy is switched on. Second, once the page has loaded and the browser is idle, the
  widget's script (`src/lib/star-count-page.ts` via `src/components/Header.astro`) asks GitHub at most once an
  hour per tab: if sessionStorage (`gcportrait.repository`) says the tab asked less than an hour ago, it uses
  the facts it got then, or shows nothing new after a failure; otherwise it notes the requests there first (no
  note possible, storage blocked: no request), asks `https://api.github.com/repos/<owner>/<name>` and
  `…/releases/latest` itself, together (anonymous: `credentials: 'omit'`, no referrer, Accept only, 4 s
  timeout; `currentRepositoryFacts` and `liveRepositoryFacts` in `src/lib/star-count.ts`) and keeps the facts
  in place of the note. It writes them with the build's own formatter into the pill and the link's name (a
  version GitHub did not give now keeps the build's), but only where nothing else in the header moves (each
  count keeps room for any count to 9.9k, so where the build had facts such counts always fit, and so does a
  version of the same length); on any failure nothing changes, and nothing is logged. Where the build's own
  request found the repository not public (`data-repository-not-public`), the script asks nothing at all: the
  visitor's browser would only get the same 404 (and send its address to GitHub for nothing), so a site built
  while the repository is not public shows no live facts until the next build after it is. Otherwise a
  visitor's browser contacts GitHub: row W3 of docs/legal/data-processing-inventory.md, which the privacy
  notice on the maintainer's website must cover.
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
                       stars.ts (the repository widget's live check), demo.ts (the demo's check in a browser),
                       astro-check.ts (the .astro files'
                       type check, over tsconfig.astro.json), browser.ts (axe-core, GitHub's mocked answers and
                       other helpers the browser checks share), serve.ts (the built site served as GitHub Pages
                       serves it: byte ranges, `x.html` for `x`, the trailing-slash redirect)
src/site.ts            the fixed facts: hosts, the demo, repository, image, the footer notice and the long form (equal
                       to the app's)
src/data/              docs.ts (the docs menu, with /exports/ after the Export guide), media.json (the generated
                       media, read by scripts/media.mjs too)
src/lib/               markdown, docs, coverage, author, placeholders, brand (the mark of brand/icon.svg
                       for the logo, and the favicon-and-logo comparison), media, exports (the sample
                       exports), seo, sitemap, github (the build's repository facts), star-count and star-count-page
                       (the formatter and the name both layers share, and the live facts in the visitor's browser),
                       fillable and
                       fillable-page (the fillable commands of the docs pages and the landing page)
src/components/        Header (sticky, with the repository widget), Footer, Logo, DemoLink (a link to the demo, in a
                       new tab), StartLink (the "Open in Cloud Shell" and "Run on Google Cloud" buttons, in a new
                       tab), ThemedPicture, DemoVideo, Variables, ExportCard (a sample export: both themes'
                       previews with their download and open links)
src/layouts/           Base (head, header, footer), Docs
src/pages/             index, docs/index, docs/[slug], exports, coverage, contributing, licence, 404,
                       sitemap.xml, robots.txt
```
