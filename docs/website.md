<!-- SPDX-License-Identifier: MIT -->

# The website: gcportrait.app

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.

The website at <https://gcportrait.app> presents gcportrait as Google Cloud architecture diagrams you use
three ways: self-hosted in your own Google Cloud project, as a web app, and through an API that returns any
view as SVG or PNG without the app. Its landing page gives each way its proof (the installer line that deploys
it, a still of the app and the demo, a render request with the sample export it returns), shows the features
with screenshots and animated demos of the demo organisations, and presents the author, with the Person
structured data; the site also renders the user guides of this folder and publishes the asset catalog's
coverage ([AGENTS.md](../AGENTS.md), "Modes and hosting"). It serves the sign-in-free demo itself, at the
address <https://gcportrait.app/demo/>: a static build of the app in demo-only mode ([The demo](#the-demo)), and
links to the self-hosting guide. Everything is hosted on GitHub: one GitHub Pages site for the website and the demo,
the images on ghcr.io, releases and CI on GitHub Actions. The site is the `website/` package, a static Astro
build for GitHub Pages; [website/README.md](../website/README.md) describes its code. This guide is for the
maintainer: building it, its generated media, the demo, deploying it, the DNS records and the legal pages.
What changed in each version is not a page of the site: its "Changelog" links, in the header's menu and the
footer, go to the repository's [releases page](https://github.com/florianchrometz/gcportrait/releases), which
the release workflow writes from the changesets at every tag (`scripts/release-notes.mjs`); the repository's
`CHANGELOG.md` files stay where changesets write them.

| Section | For |
|---|---|
| [Building and checking](#building-and-checking) | The commands, and what the checks guarantee. |
| [Mobile](#mobile) | Phones from 320 to 430 pixels: the layout, the media sizes, the demos' GIF fallback, the checks. |
| [Fillable commands](#fillable-commands) | The variables in the commands: the `YOUR_…` convention, the fields and how they are edited in place in every browser, Copy, what is kept in the browser. |
| [Generated media](#generated-media) | The screenshots, animated demos and link-preview images in `docs/media/`, and when to regenerate them. |
| [Sample exports](#sample-exports) | Real SVG, PNG and draw.io exports of the demo organisations to download or open in diagrams.net: making them, checking them, the page. |
| [GitHub repository widget](#github-repository-widget) | The header's link to the repository: the build's facts (version, stars, forks), the live refresh in the visitor's browser and what it means for privacy, the fallback. |
| [Analytics](#analytics) | The site's page views, counted with TelemetryDeck: on in the deploying build only, never in the app or the demo, Do Not Track and Global Privacy Control respected, what is sent and what is not, the switch for forks, the checks. |
| [Favicon and logo](#favicon-and-logo) | One drawing from one file, `brand/icon.svg`, for the favicon, the header's and footer's logo and the app's favicon. |
| [The installer](#the-installer) | `/install.sh`, the one-line installer: `infra/install.sh` copied by the build, its content type, kept out of search. |
| [The landing page's start buttons](#the-landing-pages-start-buttons) | "Open in Cloud Shell" and "Run on Google Cloud" beside "Self-host": where they go, the new tab, the marks. |
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
pnpm --filter @gcportrait/website stars    # the header's repository widget, live, in a browser (GitHub repository widget)
pnpm --filter @gcportrait/website analytics  # the page views in a browser, on a build with WEBSITE_ANALYTICS=1 (Analytics)
```

The build reads everything from the repository at build time: the guides listed in `website/src/data/docs.ts`
(every guide in `docs/` is either a page or listed there as not one, which a unit test enforces),
`docs/author.md`, the compiled catalog and `pnpm catalog:coverage --json`, and the media in `docs/media/`; the
one thing it asks outside the repository is the repository widget's facts on GitHub ([GitHub repository
widget](#github-repository-widget)). A deploying build also counts the site's page views
([Analytics](#analytics)); `WEBSITE_ANALYTICS=0` switches that off, `WEBSITE_ANALYTICS=1` on in any build. A
guide or a medium that is missing is left out with a warning; a **strict** build (`WEBSITE_STRICT=1`, set by
the deploy jobs) fails instead, and also fails while `docs/author.md` still holds a placeholder (`[IN
CAPITALS]`, `{{…}}`, `<…>`, `TODO`). The site has no legal pages of its own ([Legal pages](#legal-pages)). The
build also places the demo at `website/dist/demo/` ([The demo](#the-demo)): it runs `pnpm demo:static` itself,
or copies the bundle that `WEBSITE_DEMO_DIST` names (a directory relative to the repository root, built before
for `/demo/`), which is what the workflows do after building the demo as a step of its own. Order, either way:
the demo is built (or found) after Astro has written the site's pages, so `pnpm website:build` alone gives the
whole site.

`pnpm website:check` fails a page that lacks a unique title (at most 60 characters) or description (50 to 160
characters), as search results show them whole, the canonical URL on `https://gcportrait.app` (the 404 page
instead must be `noindex` and name no canonical URL), OpenGraph and Twitter card tags with a 1200×630 image,
parseable JSON-LD (never an Organization, and like every meta tag without the non-affiliation statement, which
belongs in the footer and the long-form texts, not in metadata), one level-1 heading, alt text and dimensions
on its images, a button to the Cloud Shell tutorial or the Cloud Run Button that opens in the same tab, does
not say it opens a new one or loads its mark as an image (the landing page's hero must offer both; [The
landing page's start buttons](#the-landing-pages-start-buttons)), the footer notice in the footer ("Not
affiliated with Google / Google Cloud. gcportrait is an independent open-source project by Florian Chrometz.",
the name linked to the maintainer's website; [AGENTS.md](../AGENTS.md), "Non-affiliation, brand and legal"),
the footer's links to the Impressum and the privacy notice on the maintainer's website (each once,
`rel="noopener"`, named as an external site; [Legal pages](#legal-pages)), or the header's one link to the
repository (same tab, named "gcportrait on GitHub", `data-repository` naming that repository); that loads
anything from another host (a script, stylesheet, font, image, video, audio, frame or embedded object, through
any attribute that loads, every `srcset` candidate included, or through CSS: any address on another host in a
stylesheet of the build, a `<style>` block or a `style` attribute, so `url()`, `@import`, `image-set()` and
`@font-face`); that has a script (inline, or a file of the build) asking any other host than the site itself,
except the repository widget's requests: a `fetch` of `https://api.github.com/repos/…` written out in the
script with exactly one `credentials: 'omit'` at the top level of the options written out in the call ([GitHub
repository widget](#github-repository-widget)), and the page views: TelemetryDeck's ingestion host,
`https://nom.telemetrydeck.com/`, allowed by name, as a POST without credentials, where the SDK's own request
(whose address is its target, a variable) is accepted once, in the one script that names that address
([Analytics](#analytics)); a `fetch` of an address it does not write out, options it does not write out or
that could override `credentials` (a spread, a computed key), any other host named in a script, and
`XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` and `importScripts` all fail; that runs text into a
link without a space; that has a code block the keyboard cannot reach (a `<pre>` scrolls sideways when a line
is long, so it needs `tabindex="0"`, or `class="wrap"` when it wraps its lines instead); that lacks the one
viewport tag (`width=device-width, initial-scale=1`, zooming left alone), has a table outside a focusable
`.table-scroll` box, or an inline width over 320 pixels; whose internal links and anchors do not resolve; or
that links into the repository at a file or folder the repository does not have. It also checks that the
sitemap lists exactly the pages built, `robots.txt` names it, the CNAME holds `gcportrait.app`, `/install.sh`
is `infra/install.sh` byte for byte ([The installer](#the-installer)), the font licences ship next to the
fonts (and the SDK's next to them when a script carries it), a stylesheet keeps images and videos within their
box (`img, video { max-width: 100% }`), no page is an `/impressum/` or `/privacy/` of the site's own, and the
favicon and every page's logo are the drawing of `brand/icon.svg` ([Favicon and logo](#favicon-and-logo)), and
that the landing page carries the long-form non-affiliation statement in its author section
(`docs/author.md`'s closing paragraph) and in no other section. The demo below `/demo/` is the app, not a page
of the site, so these page rules leave it out; it has rules of its own ([The demo](#the-demo)), among them
that no file of it names TelemetryDeck or the site's analytics app id, every "Try the demo" or "Open the demo"
link must point at `/demo/` and no link at a demo host, and every link to the demo, on a page, in a guide, in
the header or the footer, must open it in a new tab (`target="_blank"`, `rel="noopener"`) and say so in its
name (" (opens in a new tab)", visually hidden): the demo is the app, with no way back to the site. For the
sample exports it checks that every link of the exports section (on the landing page and `/exports/`) points
at a PNG, an SVG or a draw.io file of the build itself, a download link with its file name, that no SVG
offered carries an affiliation line ("Not affiliated with Google / Google Cloud." or any other "affiliated
with … Google" sentence) in its title block, its `<title>`, its `<desc>` or anywhere else, and none loads
anything from elsewhere, that every draw.io file reads as diagrams.net reads it (compressed), with no
affiliation line in a label and no address but Google Fonts' stylesheet, that every "Open in diagrams.net"
link is `https://app.diagrams.net/?url=` with the address of a draw.io file of the build on
`https://gcportrait.app` and opens a new tab that its name announces, and that `/exports/` offers a PNG, an
SVG, a draw.io file and a diagrams.net link of each theme ([Sample exports](#sample-exports)).
`app.diagrams.net` is a link target only: like any other host it may not serve a resource of a page; a link to
it may go anywhere there, but one that opens a file (`?url=`) must be an export's checked "Open in
diagrams.net" link.

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

- **Header** (below 48rem): the wordmark and a Menu button on the first row, "Try the demo" and the repository
  widget side by side below. The five menu links fold away behind the button, a disclosure (`aria-expanded`,
  `aria-controls`; Escape closes it); the open menu scrolls on its own where it would reach past the window's
  bottom. With facts, the widget shows the GitHub mark and the star and fork counts, and below 368 pixels the
  stars only; its name stays "gcportrait on GitHub: version …, N stars, N forks" ([GitHub repository
  widget](#github-repository-widget)).
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
  fetched only then (0.3 to 0.5 MB each; the ten GIFs, 4.0 MB, are published with the site but fetched only in
  that case). The pause button pauses either: a video stops on its frame, a GIF gives way to the poster (WCAG
  2.2.2). With reduced motion nothing plays by itself: the poster shows with a Play button. A browser that
  refuses to play by itself (iOS in Low Power Mode) gets the same: the poster and a Play button.

**Checks.** `pnpm website:check` covers what the HTML shows (the viewport tag, tables in scroll boxes, inline
widths, the media rule; [Building and checking](#building-and-checking)). `pnpm --filter @gcportrait/website
mobile` (`website/scripts/mobile.ts`) checks the rendered pages in Playwright and fails on any problem:

- **Layout** (Chromium, emulating a touch phone at 2×): every page of the sitemap and the 404 page at 320,
  375, 390 and 430 pixels, light and dark, with the folding panels closed and then open. It fails when the
  page scrolls sideways or an element reaches past the viewport outside a scrolling box, when two header items
  overlap or one leaves the screen, when the header is not at the top of the window once the page is scrolled
  to its end or an anchor jump to the page's last level-2 heading leaves it under the header, when a link or
  button that is not inline text is under 44 × 44 pixels, or when axe-core 4.13 (all non-experimental rules,
  as `e2e/` runs it) finds a violation (panels closed at every width, open at 375).
- **Playback**: the landing page on an iPhone 15 (Playwright's WebKit) and a Pixel 7 (its Chromium) with their
  device descriptors, light and dark. Each of the five demos is scrolled into view and must play (as WebM, or
  as the GIF); its button must pause it (the video's time stands still, or the GIF gives way to the poster)
  and play it again. On each device also: the GIF when `canPlayType` says no, when the WebM requests fail, and
  when they never answer (a stall); with reduced motion, nothing before the Play button is pressed. Any
  request to another host fails the run.

Both parts answer the header's repository widget themselves ([GitHub repository
widget](#github-repository-widget)), never GitHub: with a 404, as GitHub answers while the repository is
private, so nothing changes; with `--stars N` the answer is N stars, `--forks` forks (N unless given) and the
release `--release` (v1.0.0 unless given), and the layout is measured with the facts shown where they fit.

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

- **Plain text where the browser offers it.** The script sets `contenteditable="plaintext-only"` on a probe
  element and reads it back: Chromium, Safari and Firefox from 136 keep it; Firefox before 136 throws, and
  then the fields get `contenteditable="true"`, with formatting commands (Ctrl+B) and drops refused and any
  markup a browser leaves (a `<br>` in an emptied field) turned back into text. In every browser a paste is
  taken as plain text on one line (line breaks and tabs removed; `plaintext-only` alone would keep a pasted
  line break, which broke the command's line), and Enter, or a virtual keyboard's line break, leaves the
  field.
- **The token is selected, never removed by the script.** Focused while it shows its token, a field selects
  it, and the first key that edits replaces all of it, even after the caret was moved into the token with an
  arrow key or a second click (also an edit that comes without a key event, from a virtual keyboard or a
  menu). Emptied with Backspace, it shows the token as its placeholder (italic). The script never empties a
  field itself: WebKit (Safari on a Mac, every browser on an iPhone) cannot keep the caret in an inline
  editable element whose text a script removed, so what the visitor typed would go nowhere.
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

**Checks.** `pnpm website:check` fails a page whose code names a `YOUR_…` token the registry does not list; on
a page with fields, a code block that shows a token as text instead of a field, or a Variables panel that does
not list exactly the variables of the page's fields; and a docs page or a page with fields without one Copy
button per code block. `pnpm --filter @gcportrait/website fillable` (`website/scripts/fillable.ts`, about 45
s) runs the built site, `/docs/self-host/` and `/`, in six profiles: Playwright's Chromium at 1440 and 375
pixels, Firefox at 1440, Firefox with `plaintext-only` refused as before 136 (the fallback), WebKit at 1440,
and an iPhone 15 (WebKit) and a Pixel 7 (Chromium) with their device descriptors, each in both themes, the
phones pressed with taps. In every profile: before any interaction every field shows its edit mark and only
the page's first block with fields carries the hint, and a hovered field is ringed (a mouse) or a tap just
beside a field focuses it (a touch screen, its target at least 44 pixels tall); a click or tap on an unfilled
field selects its token, and a value typed after an arrow key moved the caret into it still replaces it; Enter
leaves the field; the value shows in the variable's other fields, in other blocks and inline code too, and in
the panel, and a value typed into the panel in the fields (a page where no variable has fields in two blocks
checks the fields it has and says so); rich text with a line break, copied and pasted with the keyboard,
arrives as one plain line; Copy hands the block with the values to the clipboard (Chromium reads it back with
`navigator.clipboard`; for WebKit and Firefox, which Playwright gives no clipboard permission, the text the
page passed to the Clipboard API) and the live region says "Copied"; a field is reached with Tab and a value
of the wrong format is marked and unmarked; the values come back after a reload, a variable marked secret
excepted, and Clear values empties the fields and the storage. In Chromium also: without JavaScript nothing is
editable and the code shows its tokens; the script moves no heading, code block, bar, hint or panel row when
it starts; and axe-core (unfilled, filled, panel open) at 1440 and 375 pixels in both themes. On
`/docs/getting-started/` Copy copies a block without variables as it is. `--profile` picks profiles, `--page`
pages, and `--shots DIR` saves the hint's block unedited and edited, the edited block before, while and after
typing, and the panel. Firefox and WebKit are installed once with `pnpm --filter @gcportrait/website exec
playwright install webkit firefox`; the check gives Firefox a throwaway application-data directory
(`MOZ_APP_DATA`), so it never touches a Firefox profile of the user's (where Playwright's Firefox cannot find
a profile folder of its own, it does not start without one).

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
the dark theme. A scene is played in real time with a drawn pointer and captured as fast as screenshots come
(about 30 a second), then resampled to 12 frames a second; the GIF is assembled with gifenc (one palette,
unchanged pixels transparent, repeated frames merged), the WebM with the browser's WebCodecs encoder and
Mediabunny's muxer. The Snapshots still pins the page's clock to 2026-10-08 09:30 UTC, so its "Stored" column
reads the same in every run. The list of stills, scenes and cards, with their alt texts, is
`website/src/data/media.json`; what each one does is in `scripts/media.mjs`. Only the synthetic demo
organisations are ever captured.

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

The site offers real exports to download: SVG, PNG and draw.io files of the synthetic demo organisations,
exactly as the Export menu writes them, each with its title block (the scope, the lens with the read time, the
gcportrait.app tagline) and the legend. Like every drawing, no file carries the non-affiliation line, neither
in the title block nor in the SVG's `<desc>`, which holds the scope, the lens, the read time and "Drawn with
gcportrait." only: the site states it in the footer notice of every page and in the long form in the landing
page's author section. `node scripts/exports.mjs` makes them with `pnpm render` (the app's own drawing,
rasterised with resvg at 2×, the export's default) and writes them to `docs/media/exports/`:

| Sample | View | PNG (light) | Files per theme |
|---|---|---|---|
| `S-overview` | demo S, Overview lens, detail `auto` → all | 4794 × 2812 px | PNG, SVG, draw.io, WebP previews at 480 and 960 px |
| `M-overview` | demo M, Overview lens, detail `auto` → folders | 3726 × 2996 px | the same |
| `M-shared-vpc` | demo M, Networking lens, focus on the Shared VPC `demo-net-1`, detail `auto` → projects | 4328 × 3060 px | the same |

30 files, 4.6 MiB in all, with `manifest.json`: each file's sample, demo size, lens, theme, width × height (a
draw.io file's page), bytes, SHA-256 and the command that made it (`pnpm render --fixture S --lens overview
--theme light --png docs/media/exports/S-overview-light.png --svg docs/media/exports/S-overview-light.svg
--drawio docs/media/exports/S-overview-light.drawio --drawio-unversioned`). The draw.io files are compressed
as diagrams.net saves them, 13 to 33 kB each, and their `agent` is `gcportrait` alone, without `pnpm render`'s
version (`--drawio-unversioned`, as the render golden is written), so a release, which raises that version,
leaves them as they are: demo S's light file is the render golden byte for byte. Demo L and XL are left out:
L's overview alone is an 8172 × 5284 PNG of 1.9 MB per theme, which would take the set past its 6 MiB budget.

```sh
node scripts/exports.mjs                    # about 30 s; then commit docs/media/exports/
node scripts/exports.mjs --check            # the files against the manifest (no browser)
node scripts/exports.mjs --check --render   # also renders everything again and compares byte for byte
```

The exports are kept apart from `pnpm media`: they come from the headless renderer, not from screenshots of
the demo app, so they do not touch its staleness hash or the animations, and `pnpm media --check` does not
look at them. `--check` fails when the samples, their previews or the encoder page in `scripts/exports.mjs`
changed (formatting and comments do not count), when a file's recorded command is not the one the script would
run now, when resvg or Playwright changed version, when a file is missing, edited, unlisted or not a sample,
when a draw.io file does not read as diagrams.net reads it, is not compressed, has an `agent` other than
`gcportrait` (a version there would make every release's samples stale), states an affiliation in a label or
names an address other than Google Fonts' stylesheet, when an SVG carries an affiliation line
(`EXPORT_DISCLAIMER` of `website/src/site.ts`, the footer notice's first sentence, or any other "affiliated
with … Google" sentence) in its title block, its `<title>`, its `<desc>` or anywhere else, or loads anything
from elsewhere, and when the set is over 6 MiB. The manifest records no affiliation line. A change to the
renderer, the fonts or the demo data shows only with `--render`, which draws everything again (PNGs are
byte-stable on one platform; on another, resvg's anti-aliasing may differ while the SVGs agree). Run it after
a visible change to the diagram, and regenerate when it reports a difference. The previews are encoded by
Playwright's Chromium (a canvas scaled with high-quality smoothing, then WebP at quality 0.82), as `pnpm
media` encodes its WebPs.

**On the site.** `website/src/lib/exports.ts` reads the manifest and imports the files from
`docs/media/exports/`, so the build publishes each under a content-hashed name in `_astro/` and the site loads
nothing from elsewhere. The landing page's "Sample exports" section has a card for demo S and one for demo M
(the overviews): the light and the dark preview side by side (stacked on a narrow card), each with "Download
PNG", "Download SVG" and "Download draw.io" (the `download` attribute names the file
`gcportrait-demo-<sample>-<theme>.<ext>`, the size is shown), "Open SVG", which opens the vector in the
browser, and "Open in diagrams.net", which opens the draw.io file in a new tab at
`https://app.diagrams.net/?url=` with the file's public address on `https://gcportrait.app` (diagrams.net
loads it from the site; nothing of diagrams.net is loaded by the site), under the line "Editable: open the
`.drawio` file in draw.io or diagrams.net.". The page `/exports/` (title, description, its own link-preview
image `social/exports.jpg`, in the sitemap, and in the docs menu and on `/docs/` after the Export guide) has
all three samples with larger previews, the files' dimensions and the commands. The previews are lazy-loaded
WebPs (`srcset` of 480 and 960 px). Both say that the SVGs name the Roboto font stack without embedding it, as
the Export menu writes an SVG unless its "Embed fonts" option is ticked, so where Roboto is not installed a
viewer draws the labels in another font and they may reflow (the PNGs are always drawn with Roboto), and
`/exports/` gives the measured reason demo L and XL are left out. Neither says the files carry the
non-affiliation line; `/exports/` says it is in the footer, not in the drawings, and asks that a picture not
be presented as Google's. `pnpm website:check` checks every export link ([Building and
checking](#building-and-checking)).

## GitHub repository widget

The header of every page links to the repository, at the top right next to "Try the demo": the GitHub mark,
the word "GitHub" and, when known, three facts of the repository in a small pill, each after a drawing of the
site's own: the latest release's version (a tag), the star count (a star) and the fork count (a fork). Its
accessible name says them all, "gcportrait on GitHub: version 1.0.0, 12 stars, 3 forks" (singular for one;
without a release, the version is left out). On a phone the button beside "Try the demo" shows the mark and
the counts (the word and the version stay in its name), and below 368 pixels the stars only, so it keeps its
place beside the demo button down to 320 pixels. The facts have two layers, live, as on other projects' sites,
not values that wait for a redeploy:

1. **The build's facts, at first paint.** `website/src/lib/github.ts` reads them when the site is built, with
   two requests made together: `https://api.github.com/repos/florianchrometz/gcportrait` (`stargazers_count`,
   `forks_count`) and `…/releases/latest` (`tag_name`), and writes them into every page as text. The pill is
   in the HTML, so nothing moves when the page is shown. It is as fresh as the last build; `pages.yml`
   rebuilds daily.
2. **The live facts, after the page has loaded.** A small script (`website/src/lib/star-count-page.ts`, which
   Astro builds into one small file that every page shares) waits for the `load` event and for the browser to
   be idle (`requestIdleCallback`, or a short timeout where there is none), so it never delays the first
   paint. It reads `gcportrait.repository` from the visitor's sessionStorage. If the tab asked GitHub less
   than an hour ago, it does not ask again: it shows the facts it got then, or, if it got none, leaves the
   header as the build made it. Otherwise it first notes in sessionStorage that it is asking
   (`{"facts":null,"at":…}`), then the visitor's browser asks GitHub itself: the same two GETs, made together,
   each with `Accept: application/vnd.github+json` only (no CORS preflight), `credentials: 'omit'` (no
   cookies, no HTTP authentication), no referrer, and a 4-second timeout for both. On a 200 for the repository
   with whole-number `stargazers_count` and `forks_count` it writes the counts, and the release's `tag_name`
   when that request gave one (no release yet, or any failure of it, keeps the build's version), into the
   widget and into the link's accessible name with the build's own formatter and name
   (`website/src/lib/star-count.ts`, shared by both layers), and keeps them in place of the note
   (`{"facts":{"version":"v1.0.0","stars":1301,"forks":42},"at":…}`). On anything else for the repository (a
   403, 404 or 429, another status, a body without the counts, offline, the timeout) nothing changes: the
   build's facts, or none, stay, and the note stays too, so no page of the tab asks again within the hour. The
   note is written before the requests, so a visitor who leaves the page before the answers does not cause a
   second pair of requests either. Where sessionStorage is blocked or full, so that the note cannot be
   written, the browser does not ask at all and the build's facts stay. Nothing is logged.
3. **No live facts while the repository is not public.** When GitHub answers the build's own request for the
   repository with a 404 (the repository is private, or not there yet), or with an answer marked private (to
   the workflow's token, which may read it), the build writes `data-repository-not-public` on the link and no
   facts, and the script asks nothing at all: an anonymous request from the visitor's browser would only get
   the same 404, and would still send the visitor's address to GitHub. So a site built before the repository
   goes public shows no live facts until its next build brings them (`pages.yml` rebuilds daily); a build that
   could not ask, or was refused for another reason (the rate limit, no network, a 500), leaves the browser to
   ask as above.

**No layout shift.** The script shows the live facts only where nothing else moves: every item of the header
keeps its box, the header its height, and the link its place (it may only get wider or narrower at its end,
where there is room after it). Each count keeps room for every count from 0 to 9.9k (`min-width: 3.4ch`,
centred: "1.2k" and "9.9k", the widest, are 3.4 digit widths in Roboto's tabular digits), so where the build
had facts, any live counts up to 9.9k and a version of the same length update at every width: 1.2k becoming
1.3k, and also 999 becoming 1k or v1.0.0 becoming v1.0.1. Facts that would push the demo button aside keep the
link as the build made it until the next build brings them: a count of 9.9k becoming 10k, a longer version, or
a pill where the build had none. Where the build had no facts, the pill is in the page but hidden, and the
script shows it only where there is room after the link. Change and undoing happen before the next frame is
painted, so a change taken back is never seen.

**Privacy.** The second layer means that a visitor's browser contacts `api.github.com`, GitHub's server, with
two requests (the repository, and its latest release): on the first page of a visit, and then at most once an
hour per tab, whatever GitHub answered (facts, a 404 or any other failure); sessionStorage, and with it the
note, ends with the tab. Where sessionStorage is blocked it never does, and neither while the build found the
repository not public (above). GitHub receives what a browser sends with any request: the visitor's IP
address, the user agent and, in Chromium-based browsers, its client hints (`sec-ch-ua`, `sec-ch-ua-mobile`,
`sec-ch-ua-platform`: brand, version, mobile or not, platform), the preferred languages (`Accept-Language`)
and the site's origin (`https://gcportrait.app`, sent with a cross-origin request); but no cookie, no page
address (no referrer) and nothing the visitor typed. The browser keeps the time of the requests and the facts,
if it got them (the version, the star count and the fork count), in sessionStorage under
`gcportrait.repository`. This is row W3 of the [data-processing
inventory](legal/data-processing-inventory.md), and the privacy notice on the maintainer's website ([Legal
pages](#legal-pages)) must describe it: a third party contacted by the visitor's browser, what it receives,
how often (two requests at most once an hour per tab, and not while the repository is not public), the purpose
(showing the repository's current version, star count and fork count), the legal basis, and the sessionStorage
key with what it holds and for how long. `pnpm website:check` allows exactly these requests and, besides them,
only the page views' POST to TelemetryDeck ([Analytics](#analytics)); it refuses any other host in a script,
and every resource (script, stylesheet, font, image, video, frame) from another host ([Building and
checking](#building-and-checking)).

- **Token.** With `GITHUB_TOKEN` set the build's requests are authenticated (GitHub allows 60 unauthenticated
  requests an hour per address, shared on CI runners). `pages.yml` passes the workflow's own read-only token
  to the build only when the run deploys; pull-request and local builds ask without one. The token goes to
  `api.github.com` only and is never printed, and never reaches a page: the visitor's requests are always
  anonymous, within the visitor's own 60 an hour.
- **Daily refresh.** `pages.yml` also runs every day at 04:17 UTC (`schedule`), rebuilding and redeploying
  `main` so the first layer follows. Like the deploys, the scheduled run is skipped entirely while neither
  `PAGES_DEPLOY` nor `FIREBASE_DEPLOY` is `true`. GitHub switches off the schedule of a public repository
  after 60 days without activity; Actions > Website then offers to switch it on again.
- **Fallback.** Neither layer ever fails the page. The build never fails over the facts: offline, without an
  answer within 3 seconds, on a 404 (the repository is private or not published yet), on an answer saying the
  repository is private (the workflow's token may read it), on a 403 or 429 (rate limit), or on a body without
  the counts, the build prints one line and the link shows no facts; after the 404 and the private answer the
  line also says that visitors' browsers will not ask:

  ```text
  website: GitHub repository widget: GitHub answered 404 for florianchrometz/gcportrait (not found or not public yet); the header's GitHub link shows no stars, forks or version, and visitors' browsers will not ask GitHub for them.
  ```

  A repository without a release (the release's 404) gets its counts and no version, without a line; any other
  failure of the release's request prints one line and leaves the version out. The page then makes no request
  at all while the repository is not public, so Chrome logs nothing. After any other failure of the build (the
  rate limit, no network, a 500) the browser still asks, and a failure it meets then is logged by Chrome as a
  failed request (no script can silence it); the 200s of a public repository with a release log nothing.
- **Override.** `WEBSITE_STAR_COUNT=1234 pnpm website:build` uses 1234 stars without asking GitHub at build
  time (to see the widget before the repository is public), with `WEBSITE_FORK_COUNT` as the fork count (0
  when unset) and `WEBSITE_RELEASE` as the latest release's tag (no version when unset);
  `WEBSITE_STAR_COUNT=off` builds without the requests and without facts. They concern the first layer only:
  the build learns nothing about the repository, so the visitor's browser still asks (such a build is how the
  check below runs the live widget's cases while the repository is private).
- **A fork** whose `REPOSITORY_URL` (`website/src/site.ts`) is not a github.com repository gets neither layer:
  no facts from the build and no `data-repository` on the link, so the script asks nothing.

The counts are abbreviated as GitHub's own star and fork buttons show them: exact below 1000, then thousands
with one decimal, rounded, without a trailing `.0` (`1k`, `1.2k`, `63.2k`, `1.2M`); the build and the browser
share the formatter. The version is the release's tag as it is (`v1.0.0`), read as "version 1.0.0" in the
link's name. The mark is GitHub's, unmodified and used only to link to the repository, under GitHub's logo
guidelines; the tag, the star and the fork are the site's own drawings.

**Check.** `pnpm --filter @gcportrait/website stars` (`website/scripts/stars.ts`) loads the built landing page
in Playwright's Chromium, light and dark, at 1440, 768, 390 and 320 pixels, answers GitHub's part itself and
holds the answers until the header has been measured. Always: one request for the repository and one for its
latest release, after the load event, each with `credentials: 'omit'`, no referrer and the Accept header only;
no layout shift (every box of the header compared before and after, and no entry from Chromium's layout-shift
observer once the answers are let through); nothing logged but Chrome's own line for a failed request. With
facts (`--count N`, `--forks N`, `--release TAG`; by default the build's stars plus 100, its forks plus one
and its version with the last digit changed, or 1301, 42 and v1.0.0): the facts shown wherever they are as
long as the build's or the counts are within their room (to 9.9k); the name updated; sessionStorage holding
them; a reload within the hour asking nothing and showing the kept facts, facts kept for more than an hour
asked again; at 1440 pixels also a repository without a release, which keeps the build's version. With a
failure, to both requests (a 404 at every width; a 403 with the rate limit spent, a 429, a 500, a body that is
not JSON, counts that are not numbers, answers slower than 4 seconds and no network at 1440 and 390 pixels):
the header's HTML and every box unchanged, the note without facts kept, and a reload within the hour asking
nothing. Also, at 1440 pixels: a visitor who leaves the page before the answers causes no further request from
the next page; with sessionStorage blocked, or full, the page asks nothing. axe-core after the facts and after
the 404. `--real` adds one load (light, 1440 pixels) answered by GitHub itself, with a cookie set for
`api.github.com` (`SameSite=None`) that must not be sent, and requires that a failure changes nothing and is
kept (the reload then asks GitHub nothing) and that facts show. With the repository not public to the build
(`data-repository-not-public` on the link): no request at all after the load event and on a reload, nothing
written to sessionStorage, the header's HTML and every box unchanged, no layout shift, nothing logged,
axe-core; on a build that saw GitHub's 404 (any build while the repository is private, without
`WEBSITE_STAR_COUNT`) that is all the check runs, at every width in both themes, and it says so; on any other
build it runs this case too, at 1440 and 390 pixels in both themes, with the marker added to the landing page
it serves. `--shots DIR` saves the header before and after. `pnpm --filter @gcportrait/website mobile` and
`fillable` answer the requests themselves too (a 404, or `mobile --stars N`), so no browser check spends the
machine's 60 unauthenticated requests an hour. `pnpm website:lighthouse` does not: on a build where the
browser asks, each of its runs is a fresh browser that asks GitHub twice, and past the 60 GitHub answers 403,
which Chrome logs as a failed request; on a build that saw the 404, no run asks.

## Analytics

The site counts its page views with [TelemetryDeck](https://telemetrydeck.com), through its npm SDK
(`@telemetrydeck/sdk`, MIT, pinned), which the build bundles into a file of the site's own: no script comes
from TelemetryDeck's CDN, so the rule that every resource is self-hosted holds. Only the website's own pages
count: never the app, never the demo at `/demo/` (the app's own build, which a self-hosted instance runs too:
it must never phone home) and never the docs' pictures of the app. The app id is `TELEMETRYDECK_APP_ID` in
`website/src/site.ts`, a public identifier (every page that sends carries it).

**When it is on.** `WEBSITE_ANALYTICS=1` switches it on and `WEBSITE_ANALYTICS=0` off; unset, it is on in a
deploying build only (`WEBSITE_STRICT=1`, which `pages.yml` sets when it deploys and `release.yml` for a tag)
and off in `pnpm website:dev`, local and pull-request builds and the tests (`website/src/lib/analytics.ts`,
`analyticsEnabled`; any other value fails the build). Both workflows pass the repository variable
`WEBSITE_ANALYTICS` to the build, so a fork that deploys its own site sets it to `0` (Settings > Secrets and
variables > Actions > Variables) and sends nothing, or changes the app id to its own. The build says which in
its log (`page views: on` or `off`). A build with it off carries none of its code: `website/astro.config.ts`
defines `__WEBSITE_ANALYTICS__` for the bundler, and the layout's script (`website/src/layouts/Base.astro`)
loads the page module only under it, so neither the module, the SDK nor the app id is in such a build. With it
on, the build writes the SDK's licence to `dist/licenses/telemetrydeck-sdk-LICENSE.txt`.

**When a page sends.** Only when all of these hold (`website/src/lib/analytics-page.ts`): the build has it on;
the page is served from `gcportrait.app` itself (a local preview, a browser check, a fork's host or a mirror
sends nothing); and the browser does not ask not to be tracked: Do Not Track (`navigator.doNotTrack` "1", or
the older `window.doNotTrack` and `navigator.msDoNotTrack`) and Global Privacy Control
(`navigator.globalPrivacyControl`) each stop it before anything is fetched. Then, once the page has loaded
(the module itself is fetched only after the `load` event) and the browser is idle (`requestIdleCallback`, or
a short timeout where there is none), it loads the SDK's file from the site and sends one signal. It never
delays the page and never throws: a failure (the SDK's file not loading, no network, TelemetryDeck refusing or
not answering, storage blocked) sends nothing more, and nothing is logged (Chrome logs a refused request
itself, as for any failed request).

**What is sent**, in one POST to `https://nom.telemetrydeck.com/v2/` per page load: the signal `pageView`, the
app id, the path the page declares for itself without query or fragment (`/docs/self-host/`, never `?…` or
`#…`; the 404 page reports `/404.html`, never the address typed), the SDK's name and version (`JavaScriptSDK
2.0.4`), a user identifier, which the SDK hashes with SHA-256 before it is sent, and a session identifier.
And, once the page view is on its way, a click on a link to the demo or to the repository (the header's GitHub
link and any address below it, such as the releases page or a file) sends `Outbound.demo` or
`Outbound.repository` with the same fields and the path of the page it was on; the demo opens in a new tab,
while a link to the repository leaves the page in the same tab, which can end that request before it is out.
Nothing else: no other page's address, no query string or fragment, nothing typed into the commands' fields,
no cookie. Unlike TelemetryDeck's script for websites (served from its CDN, so not usable here), the npm SDK
adds no locale, screen, browser or referrer fields of its own. TelemetryDeck receives with each request what
any server does: the IP address, the user agent (and, in Chromium-based browsers, the client hints), the
preferred languages and the site's origin as the referrer (the browser's default policy sends no path to
another host). Its privacy FAQ says it stores no IP address, uses no cookies, and estimates a country from the
first three parts of the address of its script's requests; the maintainer receives the counts, not the
requests.

**The identifiers.** The site has no accounts, and the SDK needs a user identifier and a session identifier,
so both are random values (16 bytes from `crypto.getRandomValues`, 32 hexadecimal digits each) made for the
browser tab's session and kept in its sessionStorage under `gcportrait.analytics`
(`{"user":"…","session":"…"}`), so that the pages of one visit count as one session and one visitor;
sessionStorage ends with the tab. Where sessionStorage is blocked, each page load makes new ones. Nothing is
written to localStorage and no cookie is set.

**Privacy.** This is row W4 of the [data-processing inventory](legal/data-processing-inventory.md), and the
privacy notice on the maintainer's website must describe it before a deploy with it on ([Legal
pages](#legal-pages)): the provider (TelemetryDeck), what the page sends and what TelemetryDeck receives with
the request, the purpose (counting the site's page views and which pages lead to the demo and the repository),
the legal basis, the sessionStorage key with what it holds and for how long, that Do Not Track and Global
Privacy Control stop it, and that the demo and self-hosted instances send nothing.

**Checks.** `pnpm website:check` allows TelemetryDeck's ingestion host by name (`ANALYTICS_PREFIX` in
`website/scripts/check-site.ts`) and nothing that only looks like it, requires the SDK's licence when a script
carries it, and refuses any file of the demo naming TelemetryDeck or the app id ([Building and
checking](#building-and-checking)). The unit tests hold the module's decisions (the build flag, the host, Do
Not Track, Global Privacy Control, the path without query and fragment, one page view per load, the
identifiers, the clicks, no throw on any failure) with a fake SDK, and the check's rules against the SDK's
published file. `pnpm --filter @gcportrait/website analytics` (`website/scripts/analytics.ts`) runs a build
made with `WEBSITE_ANALYTICS=1` in Chromium at its own address, `https://gcportrait.app` (the check answers
every request there from the build), and answers or refuses TelemetryDeck's host itself: one POST per page
load, after the load event, with the fields above and nothing else, no cookie sent although one is set for
that host, the same identifiers on the tab's next page, sessionStorage only; a signal for "Try the demo" and
for the header's GitHub link, none from the demo's tab; with TelemetryDeck refused, every page loads and
nothing throws; under Do Not Track, Global Privacy Control or at the build's local address, no request and the
SDK's file not even fetched.

## Favicon and logo

gcportrait's mark, the frame with the project, VPC and subnetwork zones, is drawn once, in `brand/icon.svg` at
the repository root ([brand/README.md](../brand/README.md)): one SVG of rounded rectangles whose `<style>`
holds the light colours and, under `prefers-color-scheme: dark`, the dark ones. Everything else takes it from
there:

- **The favicon** is the file as it is: `website/astro.config.ts` copies it to `dist/favicon.svg` and serves
  it at `/favicon.svg` in development; every page links it (`<link rel="icon" href="/favicon.svg"
  type="image/svg+xml">`). There is no second copy in `website/public/`.
- **The logo** in the header and the footer (`website/src/components/Logo.astro`) draws the same shapes in the
  same colours, read from the file at build time by `website/src/lib/brand.ts`: the light colours as the
  shapes' attributes, the dark ones as custom properties that the component's stylesheet applies in the dark
  theme. The file must stay that simple (rectangles, class rules setting fill, stroke and stroke width);
  anything the logo could not follow fails the build.
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

## The landing page's start buttons

The hero offers, beside "Self-host", the two ways to start without a terminal of one's own that the README's
badges offer: "Open in Cloud Shell" (the guided tutorial, `docs/cloudshell-tutorial.md`) and "Run on Google
Cloud" (the Cloud Run Button with `app.json`). The self-hosting section further down has the same two below
the installer, each with its line of explanation. Both are written by `src/components/StartLink.astro`:

- **The README's addresses.** `CLOUD_SHELL_URL` and `CLOUD_RUN_BUTTON_URL` in `src/site.ts` are the links of
  the README's badges, and `scripts/cloud-run-button.test.ts` holds them equal.
- **A new tab.** Each opens a page of Google's where a deploy runs for minutes, so the button opens a new tab
  (`target="_blank"`, `rel="noopener"`) and keeps the site open beside it; its name ends with " (opens in a
  new tab)", visually hidden, as a link to the demo does.
- **The site's own marks.** Each is a site button (`.button`) with a small drawing of the site's own, inline
  and in the text's colour in both themes: a terminal window, and a cloud with an arrow going up into it. The
  badges' images from `gstatic.com` and `deploy.cloud.run` are not used, because the site loads nothing from
  another host.
- **Phones.** The hero's buttons wrap; below 30rem each line of buttons fills the width, so every button keeps
  its 44-pixel target (`pnpm website:mobile`).

`pnpm website:check` fails a button to either address that opens in the same tab, lacks `rel="noopener"` or
the note, or shows its mark as an image, and a landing page whose hero does not offer each once. A guide's
link to either address (the README badge, rendered as its alt text) is a link in a text, not a button, and
opens like every other link of a guide.

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
  (`git describe`; the release workflow passes the tag), the footer's "Source (MIT)" link (`VITE_SOURCE_URL`,
  or the repository) and the Impressum and privacy notice on the maintainer's website, which the footer links
  in the same tab, named as an external site (the same two pages as the site's footer; a test keeps the
  defaults of the command and `website/src/site.ts` equal). The bundle carries no sign-in code at all: no
  Google sign-in script, no tokeninfo, no `/api/config`;
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

**Checks.** The command checks the bundle it wrote (`staticDemoProblems`, `scripts/lib/static-demo.mjs`):
every route copy, one policy `<meta>` before anything that loads with the page's own hash, the referrer
`<meta>`, everything the page loads under the base, the favicon, no Google sign-in host in any file. `pnpm
website:check` checks the demo in the built site the same way and more (`checkDemo` in
`website/scripts/check-site.ts`: `favicon.svg` is `brand/icon.svg`, the footer's Impressum, privacy notice and
source link are in the script, the licence files are there; every "Try the demo" link of the site points at
`/demo/`). `pnpm --filter @gcportrait/website demo` serves the built site as GitHub Pages does and drives the
demo in Chromium at 1440 × 900, in both themes: the Connect page (axe), "Try the demo" with S, M and L, a
drill-in, a day back on the timeline, a PNG and an SVG export, a reload on that deep link, a direct load of
every route, `/demo` without its slash, an unknown address (404); it fails on any request that leaves the
site's origin, any policy violation and any uncaught error (`--shots DIR` saves screenshots, `--theme dark`
one theme).

**When it changes.** The demo is the app of the commit the site is built from: `main` on every deploy of the
site, the tag on a release. In `pnpm website:dev`, `/demo/` serves the last `pnpm demo:static` bundle
(`dist/demo/`), or says to build one; the app's other routes work from there, but a reload on one of them
(`/demo/diagram`) gets Astro's 404 in development, whose trailing-slash rule answers first. The built site has
them all.

## Deploying to GitHub Pages

`.github/workflows/pages.yml` builds and checks the site on every pull request and push: first the demo (`pnpm
demo:static`), then the site with it (`pnpm website:build` with `WEBSITE_DEMO_DIST=dist/demo`), then `pnpm
website:check`. On a push to `main` it also deploys the site and the demo together, but only while the
repository variable `PAGES_DEPLOY` is `true`; until then it is a no-op for GitHub Pages. Once a deploy is
switched on, it also rebuilds and redeploys `main` every day, for the repository widget's facts ([GitHub
repository widget](#github-repository-widget)). Under the same condition `release.yml` builds the demo (its
version the tag's) and the site from each `v*` tag the same way (strict, and refusing stale media) and deploys
them; until then a release run skips its website jobs (the image and the GitHub release do not depend on
them). One-time setup, in this order:

1. **Legal pages.** The footer of every page, and the demo's, links
   <https://florian-chrometz.de/legal/impressum> and
   <https://florian-chrometz.de/legal/privacy-policy> ([Legal pages](#legal-pages)); have both online before the first
   deploy, the privacy notice mentioning TelemetryDeck: a deploy counts the site's page views
   ([Analytics](#analytics); the repository variable `WEBSITE_ANALYTICS` set to `0` switches that off). The
   workflows need no secret.
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
the privacy notice must cover, among it the GitHub Pages logs, the header's repository widget and the page
views counted with TelemetryDeck (rows W1 to W4 of the inventory).

## Lighthouse

`pnpm website:lighthouse` runs Lighthouse 13.5.0 (with `pnpm dlx`, not a dependency) on every page of the
built site, in the light and the dark theme, with Lighthouse's desktop and its mobile settings, against
`website/dist` served the way GitHub Pages serves it, and fails under performance 90 or accessibility, best
practices or SEO 95.

**axe-core.** Lighthouse's accessibility score runs only part of axe-core's rules; it does not include
`scrollable-region-focusable` (a region that scrolls sideways but cannot be reached by keyboard). `pnpm
website:check` guards that rule (every code block focusable or wrapping), and `pnpm --filter
@gcportrait/website mobile` runs axe-core with all its non-experimental rules on every page at 320, 375, 390
and 430 pixels in both themes ([Mobile](#mobile)), reading axe-core from `e2e/`'s dependency.
