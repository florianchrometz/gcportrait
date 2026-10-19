<!-- SPDX-License-Identifier: Apache-2.0 -->

# The website: gcportrait.app

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.

The website at <https://gcportrait.app> presents gcportrait as Google Cloud architecture diagrams you use
three ways: self-hosted in your own Google Cloud project, as a web app, and through an API that returns any
view as SVG, PNG or draw.io without the app. Its landing page gives each way its proof (the installer line
that deploys it, a still of the app and the demo, a render request with the sample export it returns), shows
the features with screenshots and animated demos of the demo organisations, and presents the author, with
the Person structured data; the site also renders the user guides of this folder and publishes the asset
catalog's coverage ([website/AGENTS.md](../website/AGENTS.md), "The site"). It serves the sign-in-free demo
itself, at the address <https://gcportrait.app/demo/>: a static build of the app in demo-only mode ([The demo](#the-demo)), and
links to the self-hosting guide. Everything is hosted on GitHub: one GitHub Pages site for the website and the
demo, the images on ghcr.io, releases and CI on GitHub Actions. The site is the `website/` package, a static
Astro build for GitHub Pages; [website/README.md](../website/README.md) describes its code. This guide is for
the maintainer: building it, its generated media, the demo, deploying it, the DNS records and the legal pages.
What changed in each version is not a page of the site: its "Changelog" links, in the header's menu and the
footer, go to the repository's [releases page](https://github.com/florianchrometz/gcportrait/releases), which
the release workflow writes from the commits since the previous release tag (`scripts/release-notes.mjs`);
the repository's `CHANGELOG.md` stays the hand-written summary of a release.

| Section | For |
|---|---|
| [Building and checking](#building-and-checking) | The commands, and what the checks guarantee. |
| [Mobile](#mobile) | Phones from 320 to 430 pixels: the layout, the media sizes, the demos' GIF fallback, the checks. |
| [Fillable commands](#fillable-commands) | The variables in the commands: the `YOUR_…` convention, the fields and how they are edited in place in every browser, Copy, what is kept in the browser. |
| [Generated media](#generated-media) | The screenshots, animated demos and link-preview images in `docs/media/`, and when to regenerate them. |
| [Sample exports](#sample-exports) | Real SVG, PNG and draw.io exports of the demo organisations to download or open in diagrams.net: making them, checking them, the page. |
| [GitHub repository link](#github-repository-link) | The header's link to the repository: the mark, accessible name and touch targets. |
| [Analytics](#analytics) | The site counts nothing: no page views, no third party, no measurement cookie; it makes no cross-host requests. |
| [Favicon and logo](#favicon-and-logo) | One drawing from one file, `brand/icon.svg`, for the favicon, the header's and footer's logo and the app's favicon. |
| [The installer](#the-installer) | `/install.sh`, the one-line installer: `infra/install.sh` copied by the build, its content type, kept out of search. |
| [The demo](#the-demo) | The static build of the app at `/demo/`: what it holds, how it is built and checked, the routes, its Content Security Policy and what a static host cannot send. |
| [Deploying to GitHub Pages](#deploying-to-github-pages) | The one-time setup, then every push to `main`. |
| [DNS records](#dns-records) | The exact records for `gcportrait.app` and `www.gcportrait.app`: nothing else, the demo included. |
| [Legal pages](#legal-pages) | The footer's links to the Impressum and the privacy notice on the maintainer's website, on the site and in the demo. |
| [Lighthouse](#lighthouse) | Every page in both themes, desktop and mobile, against the thresholds; axe-core's rules beside it. |

## Building and checking

```sh
pnpm website:dev          # live reload on http://localhost:4321 (/demo/ serves the last pnpm demo:static)
pnpm demo:static          # the static demo alone, in dist/demo/ (The demo)
pnpm website:build        # website/dist with the demo in website/dist/demo/ (also part of pnpm build)
pnpm website:check        # metadata, links, sitemap, self-hosted resources, code blocks, the GitHub link, the footer notice, phones, the demo and its links
pnpm --filter @gcportrait/website demo     # the demo in the built site, served as GitHub Pages serves it, in a browser
pnpm website:lighthouse   # Lighthouse on every page, light and dark, desktop and mobile
pnpm --filter @gcportrait/website mobile   # every page on phones in a browser, the sticky header, and the demos' playback (Mobile)
pnpm --filter @gcportrait/website fillable # the fillable commands in Chromium, Firefox, WebKit and on phones (Fillable commands)
pnpm --filter @gcportrait/website typecheck  # the site's TypeScript: tsc -b over the .ts files, then astro check over the .astro files
```

The build reads everything from the repository at build time: the guides listed in `website/src/data/docs.ts`
(every guide in `docs/` is either a page or listed there as not one, which a unit test enforces),
`docs/author.md`, the compiled catalog and `dist/coverage.json`, the features' copy in
`website/src/data/features.json` (the README's feature cells repeat it, and `scripts/readme.test.ts` compares
them), and the media in `docs/media/`; it makes no network requests outside the repository, counts no
page views and sends nothing to another host ([Analytics](#analytics)). A guide or a medium that is missing
is left out with a warning; a **strict** build (`WEBSITE_STRICT=1`, set by the deploy jobs) fails instead,
and also fails while `docs/author.md` still holds a placeholder (`[IN CAPITALS]`, `{{…}}`, `<…>`, `TODO`).
The site has no legal pages of its own ([Legal pages](#legal-pages)). The build also places the demo at
`website/dist/demo/` ([The demo](#the-demo)): it runs `pnpm demo:static` itself, or copies the bundle that
`WEBSITE_DEMO_DIST` names (a directory relative to the repository root, built before for `/demo/`), which is
what the workflows do after building the demo as a step of its own. Order, either way: the demo is built (or
found) after Astro has written the site's pages, so `pnpm website:build` alone gives the whole site.

**What CI runs.** CI's `website` job ([pr.yml](../.github/workflows/pr.yml), docs/contributing.md) runs the
build and `website:check`, then `mobile --only layout`, `demo` and `fillable --profile chromium`: the checks
that need nothing but the Chromium the job installs. Three parts stay local, run before a release:
`mobile --only playback`'s iPhone in WebKit (Playwright's WebKit on Linux plays media through GStreamer, not
the iPhone's stack, so its result would not say what the check is for), `fillable`'s Firefox, WebKit and phone
profiles (three more browsers to install and drive, and no pull request would wait for them), and
`website:lighthouse` (Lighthouse 13.5.0 through `pnpm dlx`, and 72 runs: 18 pages in both themes at the
desktop and the phone setting, about 15 minutes).

The site's TypeScript is checked without a build: `pnpm --filter @gcportrait/website typecheck` runs `tsc -b`
over the `.ts` files (`website/tsconfig.json`), then `typecheck:astro`, which checks the `.astro` files'
frontmatter, expressions and scripts with `@astrojs/check`, the checker of `astro check`
(`website/scripts/astro-check.ts`, over `website/tsconfig.astro.json`). The root `pnpm typecheck`, which `pnpm
check` and CI's `typecheck` job run, runs `typecheck:astro` after its own `tsc -b`. ESLint does not read
`.astro` files, so every diagnostic fails the check, hints included: a declaration never read, a deprecated
API, an `await` without effect. [website/README.md](../website/README.md) says why the script calls the
checker itself and what to do when it cannot load the checker.

After `pnpm website:build`, run `pnpm website:check` to validate the built pages, local resources, links,
metadata, accessibility markup, installer, demo and sample exports against the site's requirements; the
header of [website/scripts/check-site.ts](../website/scripts/check-site.ts) is the full check specification.
The command reports every problem and exits with status 1 on failure. It checks the built files, not browser
interaction: use the browser commands above for rendered layout, gestures and behavior.

The guides are rendered so that nothing the keyboard cannot scroll is left (WCAG 2.1.1): every code block is
focusable, and every table sits in a focusable box that scrolls on its own. A table's empty header cell
becomes a data cell, and a cell holding a command keeps a readable width (the table scrolls instead). Long
words and, on a narrow screen, inline code wrap rather than push the page sideways.

## Mobile

The website serves phones as well as desktops, and so does the app, the demo at `/demo/` included (AGENTS.md,
"Product rules"). The site's phone and Lighthouse checks leave the demo out (the sitemap lists it): the app
has its own phone and tablet check (`pnpm --filter @gcportrait/frontend mobile`). Every page works from 320 to
430 CSS pixels wide in both themes without sideways scrolling, and the animated demos play on phones too.

**Layout.** One stylesheet and no device detection: the grids use `auto-fit` columns and fall to one column by
themselves, and the breakpoints are in rem (48rem for the header, the footer and the touch targets, 49rem
where the landing page's features become two columns, 52rem for the docs layout, 30rem for rows of buttons).

- **Header** (below 48rem): the wordmark and a Menu button on the first row, "Try the demo" and the GitHub
  link side by side below. The five menu links fold away behind the button, a disclosure (`aria-expanded`,
  `aria-controls`; Escape closes it); the open menu scrolls on its own where it would reach past the window's
  bottom. The GitHub link shows the mark and the word "GitHub", and below 368 pixels the mark only; its
  accessible name stays "gcportrait on GitHub" ([GitHub repository link](#github-repository-link)).
- **Sticky header** (every width): the header stays at the top of the window while the page scrolls
  (`position: sticky`, its background reaching under the status bar where the page is drawn there: the
  safe-area inset). A script in `website/src/layouts/Base.astro` keeps its height in `--header-block` (with an
  estimate per width in `global.css` until it runs), and the root's `scroll-padding-top` follows it, so an
  anchor jump, the skip link's target or a focused element never lands under the header; headings keep another
  1rem (`scroll-margin-top`). The docs menu sits below the header and scrolls on its own when it is taller
  than the window. The skip link shows above the header.
- **Docs** (below 52rem): the docs menu and a guide's "On this page" fold away behind full-width buttons above
  the guide, so the guide starts on a phone's first screen.
- **Without JavaScript** every folded panel is shown and the buttons are not (a `noscript` style in the page
  head).
- **Touch targets**: below 48rem every link and button that is not inline text is at least 44 × 44 CSS pixels
  (the menu, the footer, the docs menu and contents, the breadcrumb, the cards, the FAQ list, the coverage
  page's products). Inline links in running text keep their size.
- **Wide content** scrolls inside its own box, never the page: tables in a focusable box with a shaded edge on
  each side that has more to show, code blocks focusable as before. The landing page's command blocks wrap on
  wider screens and keep their lines and scroll on a phone, where a command broken at a hyphen would read as
  two.

**Media on phones.**

- **Stills** are WebP at 720 and 1440 pixels. Their `sizes` names the width they are shown at (the page less
  its side padding on a phone, half the page from 49rem), so a phone at 2× takes the 720 file and one at 3×
  the 1440 file. There is no 480-pixel size: a picture 340 CSS pixels wide needs 680 to 1020 device pixels on
  2× and 3× phones, so a 480 file would serve only 1× screens; and a new size changes the media list, an input
  of the staleness hash, so `pnpm media --check` stays stale until a full run, which also rewrites the GIFs
  and WebMs.
- **Posters** are one 1200-pixel WebP per scene and theme. Only the landing page's first demo is loaded
  eagerly (above the fold on a desktop, at the fold on a phone); the others load lazily.
- **Playback**: muted, inline (`playsinline`), looping, only while on screen. Downloads are queued: the next
  demo's file starts when the one before it has data or has left the screen; a demo that scrolls away does not
  abort a download already running, so a fast scroll past several demos can still have a few files in flight
  at once. Where WebM (VP9) cannot play, because `canPlayType('video/webm; codecs="vp9"')` says no, the video
  reports an error, or it stalls before any data arrives, the GIF of the same scene and theme takes its place,
  fetched only then. The GIFs are published with the site but fetched only in that case; their current sizes
  are in `docs/media/manifest.json`. The pause button pauses either: a video stops on its frame, a GIF gives
  way to the poster (WCAG
  2.2.2). With reduced motion nothing plays by itself: the poster shows with a Play button. A browser that
  refuses to play by itself (iOS in Low Power Mode) gets the same: the poster and a Play button.

**Checks.** After building the site, `pnpm --filter @gcportrait/website mobile` checks phone layouts,
accessibility and animated-demo playback in both themes; the header of
[website/scripts/mobile.ts](../website/scripts/mobile.ts) defines its scenarios and failure conditions.
Use `--only layout` or `--only playback` to run one part. CI runs the layout part
([Building and checking](#building-and-checking)); playback stays a local check before a release, since
WebKit on Linux is not Safari's media stack. The static-file check is separate
([Building and checking](#building-and-checking)); the app's own phone and tablet check covers `/demo/`.


```sh
pnpm website:build
pnpm --filter @gcportrait/website exec playwright install webkit   # once per machine, for the playback part
pnpm --filter @gcportrait/website mobile                            # about 1.5 minutes; --only layout|playback
pnpm website:lighthouse --mobile --page / --page /docs/self-host/
```

## Fillable commands

The guides' commands have values to fill in (a project id, an organisation number, a region, an OAuth client
id), and the docs pages and the landing page let the reader fill each one in place instead of editing the
whole command, then copy the command ready to run. Every occurrence of a variable on a page shows one value:
filled once, in any command or in the page's Variables panel, it is filled everywhere ("Editing in place",
below).

**Convention.** In a guide's code, a code block or inline code, a value to fill in is written `YOUR_` and
capitals as one word: `YOUR_PROJECT`, `YOUR_ORG_ID`, `YOUR_REGION`. It reads as a placeholder on GitHub and in
a terminal, and it is a plain word to a shell, so a command copied unfilled still runs and fails with a clear
message (no Google Cloud id is in capitals); `<…>` would be a redirection. Capitals without `YOUR_` stay text:
an environment variable (`OAUTH_CLIENT_ID`), a script's usage line (`--project PROJECT_ID`), a name pattern
(`SERVICE-backend@PROJECT…`), a redacted part of a recorded run. Inline code that is nothing but one token
names the variable in a sentence ("the commands show `YOUR_EMAIL`") and stays text too. docs/contributing.md
states the rule; the Cloud Shell tutorial, which is not on the site, keeps Cloud Shell's own `{{project-id}}`.

**One registry.** `COMMAND_VARIABLES` in `@gcportrait/model`
(`packages/model/src/schemas/command-variables.ts`) lists every variable with its label, a description, a
synthetic example, its format as a regular expression with the format in words, and whether it is a secret;
the app's command blocks take theirs from it too. A new variable is a new row there. `node
scripts/user-docs.mjs` (and so `pnpm test`) fails on a `YOUR_…` token in the code of a `docs/*.md` or
`docs/legal/*.md` file that the registry does not list, and the registry's own test checks that every example
matches its format and is synthetic.

**On the page.**

- **The build** (`website/src/lib/markdown.ts`) renders each registered token in a guide's code as `<span
  class="var" data-var="YOUR_…">YOUR_…</span>` and puts each code block in a box under a bar with its Copy
  button (hidden until the script runs). The page's first code block with fields carries one line above its
  bar: "Edit a highlighted value in any command; every command on this page follows." The **Variables panel**
  (`website/src/components/Variables.astro`), under "On this page", lists the variables of the page's fields
  in the order they first appear: label, token, description, example and an input; its first sentence says the
  same as the hint. Below 52rem it folds away behind a "Variables (N)" button, like the docs menu.
- **The landing page**'s commands (the installer line in the self-hosted card and in the self-host section,
  the render API request and the service-account grant) and the inline code under the installer go through the
  same functions (`renderCommandBlock`, `renderInlineCode` in `markdown.ts`), so they have the same fields,
  Copy bars, hint and script; their Variables panel follows the grant command, and the values are the docs
  pages' (one storage key).
- **The script** (`website/src/lib/fillable-page.ts`, one small file, loaded only by pages with code) turns
  each token into a field: an inline text box as wide as its text (`contenteditable`, `role="textbox"`, named
  by the variable's label, described by the panel's description), see "Editing in place" below. Typing into a
  field or the panel's input updates every field of that variable at once. A value that does not match the
  variable's format is marked when the field is left (a wavy underline, `aria-invalid`, the format in the
  panel and in the code block's bar), never refused. **Copy** copies the block with the values, an unfilled
  variable as its token; the bar says how many values the block still needs ("2 values to fill", the button's
  description), and a live region says "Copied", with the tokens left unfilled. A command selected and copied
  by hand has the values too: they are the field's text.
- **Kept in the browser.** The values of variables that are not secret are kept in the visitor's
  `localStorage`, under one key, `gcportrait.docs.variables` (a JSON object of name and value), on their
  device only: every page with fields and every tab of the site fills them in, and nothing is sent anywhere.
  **Clear values** in the panel removes the key. A secret (the registry's `secret`; no variable of the site is
  one) is never stored. Where storage is blocked the page works and keeps nothing. The [data-processing
  inventory](legal/data-processing-inventory.md) lists it as row W2, and the privacy notice on the
  maintainer's website must say so ([Legal pages](#legal-pages)).
- **Without JavaScript** the code shows its tokens as text, the bars, the hint and the panel's inputs are
  hidden (the `noscript` style in the page head hides what carries `data-var-js`, and the fields' edit mark),
  and the panel lists the variables with their descriptions and examples.
- **Nothing moves when the script starts**: the bars and the hint are in the page from the start at their full
  height, the panel's inputs are already shown, and the edit mark is drawn by the stylesheet from the first
  paint. Values kept from an earlier visit replace the tokens once the script runs; in a code block that
  changes no height (its lines do not wrap), in inline code it may wrap a line differently.

**Editing in place.** A field is the token's own `<span>`, made editable, not an `<input>` put in its place:
its text stays the command's text, so a command selected and copied by hand carries the values, the code keeps
its layout (an input would be swapped in when the script starts and sized by script), and a long command still
wraps or scrolls as before. What makes it work in every browser:

- **Plain text where the browser offers it.** The script uses `contenteditable="plaintext-only"` when
  supported (Chromium, Safari, Firefox from 136) and falls back to `contenteditable="true"` with formatting
  commands and drag-and-drop markup refused; pastings are sanitised to single-line plain text.
- **The token is selected, never removed by the script.** Focused while showing its token, a field selects
  it so the first keystroke replaces it. The script avoids emptying an inline editable element on focus to
  preserve the caret in WebKit browsers (`website/src/lib/fillable-page.ts`).
- **A target for a finger.** On a touch screen (`pointer: coarse`) each field has a transparent box 44 pixels
  tall around it (`.var-target`, added by the script, absolutely placed so no line moves), layered over the
  code's text and under every field: a tap a little above or below a field reaches it, a tap on a neighbouring
  field still reaches that one. With a mouse there is none, so selecting the code's text works as before.
- **Readable as editable before anyone touches it**, in both themes: the field is tinted (blue while it shows
  the token, green once filled) with a dashed underline (solid once filled), and ends in a pencil, the edit
  mark (the site's own drawing, in the underline's colour); hovered or pressed it is ringed in that colour;
  the hint line above the page's first block with fields and the panel's first sentence say what the
  highlighting means. The colours are `--color-var-*`, `--color-text` and `--color-error` in `global.css`,
  checked by `contrast.test.ts`: a field's text at 4.5 : 1 on both tints (a field takes the body colour, also
  in muted small print), the underline, the pencil and the ring at 3 : 1 on the tints and on every background
  code sits on.

**Checks.** After building the site, `pnpm website:check` checks the registered placeholders, fields, Copy
bars and Variables panels ([Building and checking](#building-and-checking)).
`pnpm --filter @gcportrait/website fillable` checks editing, synchronisation, copying, storage and
accessibility in desktop and touch browser profiles, in both themes. The
[script header](../website/scripts/fillable.ts) defines the profiles, scenarios and failure conditions.
CI runs the Chromium profile ([Building and checking](#building-and-checking)).
Use `--profile` to pick profiles, `--page` to pick pages, and `--shots DIR` to save inspection images of the
hint, editing states and panel. Firefox and WebKit are installed once with
`pnpm --filter @gcportrait/website exec playwright install webkit firefox`; the check gives Firefox a
throwaway application-data directory (`MOZ_APP_DATA`), so it never touches a Firefox profile of the user's
(where Playwright's Firefox cannot find a profile folder of its own, it does not start without one).

## Generated media

`pnpm media` (`scripts/media.mjs`) captures the app in demo mode and writes `docs/media/`:

| Files | What | Used by |
|---|---|---|
| `stills/<id>-<theme>.png` | 1440×900 screenshots: the whole of demo S in the Overview lens, the Networking lens, the selection trace of a load balancer, the details drawer, a timeline day compared with the day before, the Export menu, the Snapshots page | README, GitHub |
| `web/<id>-<theme>-<width>.webp` | the same at 1440 and 720 pixels wide | the website |
| `animated/<id>-<theme>.gif` | demos of 6 to 12.5 s per loop (the scene and a half-second hold on its last frame) at 1200 px and 12 frames a second, at most 3 MiB: hover and click to trace, switching lenses, drilling in and expanding, stepping through the timeline, searching an IP address | README, GitHub; the website where a browser cannot play the WebM ([Mobile](#mobile)) |
| `animated/<id>-<theme>.webm`, `animated/<id>-<theme>-poster.webp` | the same demos as VP9 video with a poster frame | the website (`<video>` that plays only on screen, with a pause button; with reduced motion only after a press of its Play button) |
| `social/<page>.jpg` | one 1200×630 link-preview image per page | the website's OpenGraph and Twitter tags |
| `manifest.json` | each file's hash, size and dimensions with its item's capture fingerprint, and the hash of what all of them were made from | `pnpm media --check`, the website |

How: a production build of the app in demo mode (`out/media/app`, git-ignored) is served by `vite preview` and
driven by Playwright's Chromium at 1440×900, in UTC with British English dates, once in the light and once in
the dark theme. Each still is taken after a repaint of the whole page (its root's background turned to another
colour for two frames and back): on the way to a still the browser repaints the page in parts, and an
anti-aliased edge that the rectangle of such a part cuts through comes out a few levels different from the
same edge drawn whole, so without it a still's bytes would follow the timing of the frames (on the timeline
still, the lower edge of the slider thumb's focus ring runs through the day markers). A scene is played in
real time with a drawn pointer and captured as fast as screenshots come (about 30 a second), then resampled
to 12 frames a second; the GIF is assembled with gifenc (one palette, unchanged pixels transparent, repeated
frames merged), the WebM with the browser's WebCodecs encoder and
Mediabunny's muxer. The Snapshots still pins the page's clock to 2026-10-08 09:30 UTC, so its "Stored" column
reads the same in every run, and scrolls the page until its import area shows whole under the stored snapshots
and the timelines. The trace still selects a forwarding rule and then fits the camera to its trace beside the
details drawer. The drawer still selects the bastion VM and fits the camera to the VM's project beside the
drawer, its disk and the project's other machines around it: its trace also reaches a subnetwork across the
organisation, too far off to fit with every card readable. The timeline still moves the timeline from 23 to
24 September, the web group's scale-out, and fits the camera to the group's project, Retail web: its added
machines and disks, the removed machine's ghost and the changed instance group manager. The canvas keeps the
23rd's drawing, ready, while the 24th's is prepared, so the still waits for the 24th's marker to turn current
and for a ready drawing whose number (`data-drawing`) differs from the one read before the move. The list of
stills, scenes and cards, with their alt texts, is `website/src/data/media.json`; what each one does is in
`scripts/media.mjs`. The README's pictures carry the same alt texts, and `scripts/readme.test.ts` fails when
one differs from the website's. Only the synthetic demo organisations are ever captured.

The hero shows the whole of demo S, where every zone, the Shared VPC, the title block and the legend are
visible: fitted to 1440×900, demo M's overview shows only its folders and collapsed projects (38 of 369 items,
with no resource, network or product icon). Its entry in `media.json` and `scripts/media.mjs` sets the view.
The landing page's "Light and dark" feature shows the same still twice, its light and its dark WebPs side by
side (stacked below 40rem), each labelled, and both in either site theme: it takes the files as they are and
needs no medium of its own.

**The timeline scene** shows big changes rather than one day's few. The days of a 35-day history with the
largest differences are in demo S's Workloads folder, drawn as the app opens it there (the Overview lens,
detail `auto` → all, every card readable at 1440×900): the scene opens on 4 September and presses the track at
8, 14 and 25 September, each day drawn compared with the one before it (`tick` and `root` in the view; the
comparison base is the day you came from, so a jump covers every change in between). 8 September outlines a
new Pub/Sub subscription and dots three changed resources; 14 September outlines the next subscription and
shows the first as a ghost; 25 September, eleven days at once, shows the decommissioned reporting project with
its bucket, network, subnetwork and VM as ghosts, a second VM in the web group outlined, two more ghosts and
seven amber dots (1 added, 7 removed, 7 changed markers), with the legend rows "added / removed / changed
since 2026-09-14". Fitted to the canvas, that last day is too small to read for someone who sees it for the
first time, so the scene then shows it up close: four wheel notches (×1.75) onto the ghost of the reporting
project, so "Reporting (decommissioned) · not drawn now" and its removed bucket, network, subnetwork and VM
can be read, a hold, back out, and four notches onto the legend, whose "added / removed / changed since" rows
end the loop. Each zoom is about a point chosen so the enlarged box stays on the canvas, and the pointer
travels only through empty canvas (down the ghost's column, along the legend's row), so no card or zone lights
up with its hover trace on the way. The first two stops hold 1.1 s, the last day 0.6 s before the close-ups
(its full view is the poster, at 6.2 s), each close-up about 1.1 s plus the GIF's half-second loop hold on the
legend; the scene is 12 s. The close-ups redraw the whole frame, so its WebMs are about 1.6 MiB, twice the
other demos', and its GIFs about 1.3 MiB. Demo M's busiest days are mostly pod churn, which the Overview lens
does not draw, and its whole organisation fitted to the canvas shows only collapsed projects.

**Staleness.** The manifest records two kinds of input. The shared inputs concern every file: a hash of the
demo app's bundle, the demo fixtures (`packages/demo-data/fixtures`), the script (`scripts/media.mjs` with
every still's and scene's own capture code cut out, `scripts/lib/media-core.mjs`, and the settings of the
media list without its lists of stills, scenes and cards), and the versions of Playwright, gifenc, Mediabunny,
pngjs and `@fontsource/roboto` (the link-preview cards' font). With each file it records its item's
fingerprint: for a still its capture function, for a scene its `prepare` and `play` functions, its length and
its poster's moment, for a card its heading and its still's fingerprint. Comment lines count nowhere, and
neither do titles and alt texts: they change no pixel. `pnpm media --check` builds the demo app (a few
seconds, no browser) and compares; it names what changed, and for an item whose capture changed the command
that makes it again (`pnpm media --only scene:timeline`). The website workflow runs it on every pull request
and push and leaves a warning when the media are stale (it does not fail the run: regenerating takes a browser
and adds a few megabytes to the history, so it is done on purpose); the release workflow's website job, which
runs while `PAGES_DEPLOY` is `true`, fails on stale media, so a release never publishes them. Regenerate
before a release, or after a visible change to the app:

```sh
pnpm --filter @gcportrait/e2e install-browsers   # once per machine: Playwright's Chromium
pnpm media                                        # about 3 minutes; then commit docs/media/
pnpm media --only scene:timeline                  # one item, both themes (still:ID, scene:ID, card:ID; a bare ID
                                                  # names every kind with that id)
pnpm media --only trace --theme dark              # one theme while working on it
```

A partial run (`--only`, `--theme`) keeps the shared inputs of the last full run and records the fingerprint
of each file it writes. So after a change to one item's capture, running that item in both themes makes
`--check` agree again, and every other GIF and WebM stays byte for byte as it was (a full run rewrites about
12 MB of GIF and WebM, and the animations are not byte-reproducible); a change to a shared input stays stale
until a full run. A card is composed from its still as committed unless the same run captured that still anew,
so `--only card:ID` needs no capture. The bundle hash is the same for every build of the same sources on one
machine; a Linux runner may produce another bundle. If CI reports the bundle as changed right after a full run
on macOS, regenerate on Linux (or in CI) instead.

## Sample exports

The site offers SVG, PNG and draw.io exports of the synthetic demo organisations in both themes, with WebP
previews. [scripts/exports.mjs](../scripts/exports.mjs) draws them with `pnpm render` and writes the files
and `manifest.json` to `docs/media/exports/`. Its `SAMPLES` list defines the views:

| Sample | View |
|---|---|
| `S-overview` | Demo S, Overview lens |
| `M-overview` | Demo M, Overview lens |
| `M-shared-vpc` | Demo M, Networking lens, focused on the Shared VPC `demo-net-1` |

To change the set, edit `SAMPLES`, regenerate, inspect both themes and commit the outputs. The script's
`renderArgs` and `ENCODER_PAGE` define rendering and preview encoding; `BUDGET_BYTES` caps the whole set.
L and XL are omitted to keep within that budget. The manifest records each file's dimensions, size,
SHA-256 and generating command, rather than relying on a second list of those figures here. Install
Playwright's Chromium before generating previews (`pnpm --filter @gcportrait/e2e install-browsers`).

```sh
node scripts/exports.mjs                    # generate, inspect, then commit docs/media/exports/
node scripts/exports.mjs --check            # the files against the manifest (no browser)
node scripts/exports.mjs --check --render   # also renders everything again and compares byte for byte
```

These headless exports are independent of the demo screenshots and animations: `pnpm media --check` does
not check them. The export script's `--check` validates generator inputs, files and manifest; its
`problemsOf` function is the check reference. After changing the renderer, fonts or demo data, run
`--check --render` to draw again and compare bytes, then regenerate and inspect any intended differences.
The pinned WebAssembly rasteriser computes the same PNG pixels on every platform
([packages/render-cli/README.md](../packages/render-cli/README.md#known-limits), "Platforms"); WebP previews
are encoded separately by Chromium. The script uses `--drawio-unversioned`, so changing the release version
alone does not stale the samples.

The landing page offers the overviews and the Shared VPC draw.io feature; `/exports/` offers the full set
with dimensions and commands. The site's code map is in
[website/README.md](../website/README.md#where-the-content-comes-from); export-link and file checks are
specified in [website/scripts/check-site.ts](../website/scripts/check-site.ts), which verifies served sample
exports byte-identical to `docs/media/exports/manifest.json` by SHA-256 digest and byte size. Generator
inputs, files and manifest are validated by `scripts/exports.mjs --check` for non-affiliation, external
hosts, scripts, title block tagline and compression. Files follow [AGENTS.md](../AGENTS.md), "Exports and
the render API" and "Non-affiliation, brand and legal".

The sample SVGs name Roboto without embedding it: a viewer without Roboto may substitute a font and reflow
labels. PNGs are drawn with Roboto. "Open in diagrams.net" opens the site's draw.io file in a new tab;
diagrams.net is a link target, not a resource loaded by the website.

When changing a sample's title or summary in `SAMPLES`, keep any README preview's alt text in step;
[scripts/readme.test.ts](../scripts/readme.test.ts) checks that it matches the sample.

## GitHub repository link

The header of every page links to the repository, at the top right next to "Try the demo": the GitHub mark
and the word "GitHub". Its accessible name is `gcportrait on GitHub` (`aria-label`). On a phone the button
beside "Try the demo" shows the mark and the word "GitHub", and below 368 pixels the mark only
(`.github-word`), keeping its place beside the demo button down to 320 pixels while preserving a 44 × 44 CSS
pixel touch target (`min-width: 44px; min-height: 44px`). The link opens the repository with
`rel="noopener"`.

The link is completely static: it makes no requests to GitHub, requires no token, and loads no live facts or
scripts in the visitor's browser. The mark is GitHub's, unmodified and used only to link to the repository,
under GitHub's logo guidelines.

## Analytics

The website counts nothing and sends nothing to a third party: no page views, no error reports, no
measurement cookie, and it makes no cross-host requests. The demo at `/demo/` and every self-hosted instance
send nothing anywhere either, because they are the app ([AGENTS.md](../AGENTS.md), "Modes and hosting").

**Checks.** `pnpm website:check` refuses any cross-host request or script naming or fetching another host,
and every file of the demo naming a Google sign-in host ([Building and checking](#building-and-checking)). No
build flag, variable or licence file exists for analytics, because there is none.

## Favicon and logo

gcportrait's mark is drawn once, in `brand/icon.svg` at the repository root
([brand/README.md](../brand/README.md) defines its geometry and rules). Everything else takes it from there:

- **The favicon** is the file as it is: `website/astro.config.ts` copies it to `dist/favicon.svg` and serves
  it at `/favicon.svg` in development; every page links it (`<link rel="icon" href="/favicon.svg"
  type="image/svg+xml">`). There is no second copy in `website/public/`.
- **The logo** in the header and the footer (`website/src/components/Logo.astro`) renders the mark using
  shapes and colours read from `brand/icon.svg` at build time by `website/src/lib/brand.ts`.
- **The app's favicon** is the same file: `frontend/vite.config.ts` writes it into every build of the app as
  `favicon.svg` (and serves it in development) and links it from `index.html` under the build's base path, so
  the image, `pnpm dev` and the demo at `/demo/` show the mark too (`/demo/favicon.svg`, which `pnpm
  website:check` compares with `brand/icon.svg`).

`website/src/lib/brand.test.ts` pins the drawing, reads
the logo the component writes back into a drawing and compares it with the favicon's, shape by shape and
colour by colour in both themes, and checks that the README's wordmarks (`docs/media/brand/`) and the mark on
the link-preview images (`scripts/media.mjs`) draw the same. `pnpm website:check` compares the built
`favicon.svg` with `brand/icon.svg` byte for byte and every page's logo with it ([Building and
checking](#building-and-checking)).

## The installer

The self-hosting quick start is one line, `curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project
YOUR_PROJECT` ([self-host-options.md, "The installer"](self-host-options.md#the-installer)). The site serves
that script:

- **One source.** `/install.sh` is `infra/install.sh` from the repository as it is: `website/astro.config.ts`
  copies it into the build (`dist/install.sh`) and serves it at `/install.sh` in development. There is no copy
  in `website/public/` (a test refuses one), so the served script is always the one `pnpm test:infra` ran.
- **Its content type.** curl does not look at the type, and `bash -s` reads the bytes. GitHub Pages sends a
  `.sh` file as `application/x-sh` (its types come from the mime-db list), which a browser offers as a
  download; `text/x-shellscript` or `text/plain` would show it as text. Pages cannot be told to send another
  type, so `pnpm website:check` accepts all three and checks the one the preview server
  (`website/scripts/serve.ts`, which serves the build as Pages does) sends.
- **Not a page.** The sitemap lists pages only, so not the script, and `robots.txt` keeps it out of search
  results (`Disallow: /install.sh`).

`pnpm website:check` fails when the built `install.sh` differs from `infra/install.sh` by one byte, when the
type is none of the three, when the sitemap lists it or when `robots.txt` lets it in. A change to the
installer reaches people with the next deploy of the site; the deploy scripts it downloads come from the
release it names.

## The demo

The demo at <https://gcportrait.app/demo/> is the app itself, built in demo-only mode for a static host: no
sign-in, nothing read from Google Cloud, the synthetic organisations S to XL generated in the visitor's
browser and kept there. The same GitHub Pages site serves it, so it needs no server, no project, no secret and
no DNS record of its own. A self-hoster who wants a sign-in-free instance of their own uses the image's
demo-only mode instead ([self-host-options.md, "Demo-only
instance"](self-host-options.md#demo-only-instance)).

```sh
pnpm demo:static          # dist/demo/: the bundle for /demo/ (about 1 s after a first build)
pnpm demo:static --out DIR --base /demo/ --impressum-url URL --privacy-url URL --app-version V
```

**What the bundle holds.** `scripts/static-demo.mjs` runs the frontend's Vite build with `VITE_STATIC_DEMO=1`:

- the app below the base `/demo/`: content-hashed assets, the theme bootstrap (the one inline script), the
  brand icon as `favicon.svg`, the licence files in `licenses/`;
- its configuration built in instead of `GET /api/config`: what a demo-only instance answers, plus the version
  (`git describe`; the release workflow passes the tag), the footer's "Source (Apache-2.0)" link
  (`VITE_SOURCE_URL`, or the repository) and the Impressum and privacy notice on the maintainer's website,
  which the app's footer links in a new tab with `rel="noopener"` so the in-memory session is preserved (on
  the static website, `Footer.astro` links them in the same tab; a test keeps the defaults of the command and
  `website/src/site.ts` equal). The bundle carries no sign-in code at all: no Google sign-in script, no
  tokeninfo, no `/api/config`;
- `index.html` and a byte-for-byte copy of it for each route of the app: `diagram.html`, `snapshots.html`,
  `permissions.html`, `settings.html`, `impressum.html`, `privacy.html`.

**Routes on a static host.** The app routes by path, and the URL hash is the diagram's view, so hash routing
is not an option. GitHub Pages serves `/demo/diagram` from `demo/diagram.html` without a redirect (and `/demo`
with a redirect to `/demo/`), so a reload or a shared link on any route boots the app there with its view
(`/demo/diagram#snapshot=demo:M&…`). GitHub Pages uses only the site's top-level `404.html`, so an unknown
address below `/demo/` gets the website's 404 page, with status 404 and a "Try the demo" link.
`/demo/impressum` and `/demo/privacy` show a link to the page on the maintainer's website. (GitHub's
documentation does not describe the `.html` lookup; community reports and the site's own preview server,
`website/scripts/serve.ts`, which mirrors it, do. Confirm it on the first deploy: open
<https://gcportrait.app/demo/settings> directly and reload it.)

**Content Security Policy.** A static host sends no headers of the site's own, so the policy is a `<meta>`,
the first element after `<meta charset>`, which the build computes from the page it writes:

```text
default-src 'self'; base-uri 'self'; script-src 'self' 'sha256-…'; script-src-attr 'none'; style-src 'self';
img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self';
object-src 'none'; form-action 'self'
```

It is the backend's demo-only policy (`cspDirectives(hashes, { google: false })` in `backend/src/security.ts`;
a test compares the two) without `frame-ancestors 'none'`, which browsers ignore in a `<meta>`; the hash is
the theme bootstrap's. `<meta name="referrer" content="no-referrer">` follows it, as the backend's
`Referrer-Policy`. What a static host cannot give the demo, compared with a demo-only instance of the image:
`frame-ancestors` and X-Frame-Options (another site could frame the demo; it has no sign-in and nothing to
lose), Cross-Origin-Opener- and -Embedder-Policy (the page is not cross-origin isolated; nothing in it needs
that), Permissions-Policy (the app uses no device feature), Cross-Origin-Resource-Policy, and `nosniff` unless
GitHub Pages sends it. HTTPS is enforced by Pages and by `.app`'s HSTS preload. The workers start from
`/demo/assets/` (`worker-src 'self'`); a `<meta>` policy does not reach inside them, and they load only the
bundle's own files.

**Checks.** `pnpm demo:static` builds only; it does not independently validate standalone bundles or custom
bases. The hosted `/demo/` bundle is validated by `pnpm website:check` after the website build, in every CI
path that builds the site. Its `checkDemo` (`website/scripts/check-site.ts`) checks every route copy, one
policy `<meta>` before anything that loads with the page's own hash, the referrer `<meta>`, everything the
page loads under `/demo/`, no Google sign-in host, `favicon.svg` equal to `brand/icon.svg`,
the footer's Impressum, privacy notice and source link, and the licence files. The site check also requires
every "Try the demo" link to point at `/demo/`; it is not a validator for arbitrary bases or standalone
bundles.

`pnpm --filter @gcportrait/website demo` serves the built site as GitHub Pages does and drives the demo in
Playwright's Chromium at 1440 × 900 in both themes. The header of
[website/scripts/demo.ts](../website/scripts/demo.ts) defines the scenario progression, drawing
synchronization, export assertions, and failure reporting. CI's `website` job runs it after the build
([Building and checking](#building-and-checking)). Use `--theme dark` to restrict to a single theme,
`--shots DIR` to save screenshots, and `--dist DIR` to test an alternative build directory.

**When it changes.** The demo is the app of the commit the site is built from: `main` on every deploy of the
site, the tag on a release. In `pnpm website:dev`, `/demo/` serves the last `pnpm demo:static` bundle
(`dist/demo/`), or says to build one; the app's other routes work from there, but a reload on one of them
(`/demo/diagram`) gets Astro's 404 in development, whose trailing-slash rule answers first. The built site has
them all.

## Deploying to GitHub Pages

`.github/workflows/website.yml` builds and checks the site, once, for both workflows that deploy it: first the
demo (`pnpm demo:static`), then the site with it (`pnpm website:build` with `WEBSITE_DEMO_DIST=dist/demo`),
then `pnpm website:check`. `pages.yml` calls it on every push to `main`, and deploys the site together with
the demo, but only while the repository variable `PAGES_DEPLOY` is `true`; until then that run is a no-op for
GitHub Pages. A pull request runs CI's `website` job instead (`pr.yml`), which builds and checks the site
without the demo and deploys nothing. Under the same condition `release.yml` calls the same build from each
`v*` tag (the demo's version the tag's, strict, and refusing stale media) and deploys them; until then a
release run skips its website jobs (the image and the GitHub release do not depend on them). One-time setup,
in this order:

1. **Legal pages.** The footer of every page, and the demo's, links
   <https://florian-chrometz.de/legal/impressum> and
   <https://florian-chrometz.de/legal/privacy-policy> ([Legal pages](#legal-pages)); have both online before the first
   deploy. The workflows need no secret.
2. **Pages source.** Repository Settings > Pages > Build and deployment > Source: "GitHub Actions".
3. **Environment.** Settings > Environments > `github-pages` (created by step 2): under "Deployment branches
   and tags", allow `main` and the tag pattern `v*`.
4. **Verify the domain** (protects it from being claimed by another GitHub account): your GitHub account's
   Settings > Pages > Verified domains > Add a domain > `gcportrait.app`. GitHub shows a TXT record; create it
   ([DNS records](#dns-records)), then press Verify.
5. **DNS.** Create the A, AAAA and CNAME records below and remove the registrar's parking records.
6. **Custom domain.** Repository Settings > Pages > Custom domain: `gcportrait.app`, Save. GitHub checks the
   DNS records and requests a certificate (Let's Encrypt), usually within an hour of the records being public
   (DNS changes themselves can take up to a day to spread). Then tick "Enforce HTTPS". `.app` is on the
   browsers' HSTS preload list, so the site is unreachable over plain HTTP: until the certificate exists,
   browsers show an error, not the site.
7. **Switch it on.** Settings > Secrets and variables > Actions > Variables: `PAGES_DEPLOY` = `true`. The next
   push to `main` (or Actions > Website > Run workflow on `main`) deploys.
8. **The demo.** Open <https://gcportrait.app/demo/>, try a size, then open
   <https://gcportrait.app/demo/settings> directly and reload a diagram ([The demo](#the-demo)).

A deployment through GitHub Actions takes its custom domain from the Pages settings (step 6), not from a file;
`website/public/CNAME` (`gcportrait.app`) is kept in the build anyway, for a
branch-based deployment and as a check (`pnpm website:check` fails if it names another host). With the apex as
the custom domain and the `www` record in place, GitHub redirects `www.gcportrait.app` to `gcportrait.app`.

## DNS records

At the registrar of `gcportrait.app` (its name servers are Porkbun's). Until the records below are in place,
the apex and every subdomain answer with the registrar's parking (A records of the apex pointing at the
parking host, and a wildcard `*.gcportrait.app` CNAME `pixie.porkbun.com`): delete the apex parking record (an
ALIAS or A record pointing at the parking host). An explicit record for a name takes precedence over the
wildcard, so the wildcard may stay for other names, but no name the site uses may depend on it. These are all
the records: the apex's A and AAAA records, the `www` CNAME and GitHub's verification TXT record. The demo is
a path of the site (`/demo/`), not a host, so it needs none.

```text
; the apex: GitHub Pages' addresses (docs.github.com, "Managing a custom domain for your GitHub Pages site")
gcportrait.app.            3600  IN  A      185.199.108.153
gcportrait.app.            3600  IN  A      185.199.109.153
gcportrait.app.            3600  IN  A      185.199.110.153
gcportrait.app.            3600  IN  A      185.199.111.153
gcportrait.app.            3600  IN  AAAA   2606:50c0:8000::153
gcportrait.app.            3600  IN  AAAA   2606:50c0:8001::153
gcportrait.app.            3600  IN  AAAA   2606:50c0:8002::153
gcportrait.app.            3600  IN  AAAA   2606:50c0:8003::153
; www: the GitHub Pages host of the repository's owner
www.gcportrait.app.        3600  IN  CNAME  florianchrometz.github.io.
; the domain verification of step 4; GitHub shows the value
_github-pages-challenge-florianchrometz.gcportrait.app.  3600  IN  TXT  "VALUE-GITHUB-SHOWS"
```

The A and AAAA addresses are the ones GitHub publishes; `dig +short A florianchrometz.github.io` and `dig
+short AAAA florianchrometz.github.io` show the ones it answers with. If the repository moves to an
organisation, the `www` CNAME points at `ORGANISATION.github.io.` instead, and the verification record's name
carries the organisation's name. If the zone has CAA records, one must allow `letsencrypt.org`.

Check from anywhere once the records are in place:

```sh
dig +short A gcportrait.app          # the four 185.199.x.153 addresses
dig +short AAAA gcportrait.app       # the four 2606:50c0:800x::153 addresses
dig +short CNAME www.gcportrait.app  # florianchrometz.github.io.
curl -sI https://gcportrait.app/ | head -1   # HTTP/2 200, once the certificate exists
```

## Legal pages

The site has no Impressum and no privacy notice of its own: the maintainer runs no service and keeps both
texts on their own website, and the footer of every page links them ([AGENTS.md](../AGENTS.md), "Modes and
hosting"):

| Link | Address |
|---|---|
| Impressum | <https://florian-chrometz.de/legal/impressum> |
| Privacy | <https://florian-chrometz.de/legal/privacy-policy> |

The addresses are `IMPRESSUM_URL` and `PRIVACY_URL` in `website/src/site.ts` (`LEGAL_LINKS`), the only place
to change them. In the footer's "Legal" column, in both themes and on phones as 44-pixel-high targets like the
footer's other links, each opens in the same tab with `rel="noopener"`, and is named as an external site for
assistive technology ("Impressum (external site, florian-chrometz.de)", the part in brackets visually hidden)
and marked with a small arrow. `pnpm website:check` fails a page whose footer lacks either link, has one
twice, without `rel="noopener"` or without the external-site name, and fails the build if it holds an
`/impressum/` or `/privacy/` page of its own. The demo links the same two pages from its footer the same way
(the same tab, `rel="noopener"`, an arrow, named "Impressum (external site, florian-chrometz.de)" and "Privacy
(…)" for assistive technology), and from `/demo/impressum` and `/demo/privacy` (built in by `pnpm
demo:static`, whose defaults a test keeps equal to `src/site.ts`'s; a self-hosted instance links its own with
`infra/deploy.sh --impressum-url` and `--privacy-url`), and [docs/legal/README.md](legal/README.md) lists what
the privacy notice must cover, among it the GitHub Pages logs (rows W1 and W2 of the inventory).

## Lighthouse

`pnpm website:lighthouse` runs Lighthouse on every page of the built site across themes and presets against
`website/dist` served the way GitHub Pages serves it. The header of
[website/scripts/lighthouse.ts](../website/scripts/lighthouse.ts) specifies score thresholds (performance 90,
accessibility, best practices and SEO 95) and execution options (`--theme`, `--preset`, `--page`,
`--mobile`).

**axe-core.** Lighthouse's accessibility score runs only part of axe-core's rules; it does not include
`scrollable-region-focusable` (a region that scrolls sideways but cannot be reached by keyboard). `pnpm
website:check` guards that rule (every code block focusable or wrapping), and `pnpm --filter
@gcportrait/website mobile` runs axe-core with all its non-experimental rules on every page at 320, 375, 390
and 430 pixels in both themes ([Mobile](#mobile)), reading axe-core from `e2e/`'s dependency.

**Local, not in CI.** The run is 72 Lighthouse reports (18 pages, both themes, the desktop and the phone
setting) and downloads Lighthouse through `pnpm dlx`: about 15 minutes, more than a pull request should wait
for, and its performance score belongs on a quiet machine rather than a shared runner
([Building and checking](#building-and-checking)).
