<!-- SPDX-License-Identifier: MIT -->

# Verification records of the user guides (moved 2026-10-12)

The sections in which the user guides recorded how and when they were checked ("Verified on …", with the commands,
their output, the timed runs and the machines), as they stood on 2026-10-12, when they were moved here: a user guide
says what to do, and `node scripts/user-docs.mjs` now keeps such records out of the guides. Kept as written and not
updated; only the relative links were adjusted to this folder, and an anchor they name in a guide may be gone. What
the records left open is in [backlog.md](../backlog.md).

## docs/getting-started.md: "4. Verified on 2026-10-11"

The local demo on macOS with Node 22.23.2 and pnpm 10.18.1, from the repository root:

```text
$ pnpm dev:demo
> gcportrait@0.0.0 dev:demo /…/gcportrait
> pnpm --filter @gcportrait/frontend run dev:demo

> @gcportrait/frontend@0.0.0 dev:demo /…/gcportrait/frontend
> VITE_DEMO=1 vite

  VITE v8.3.4  ready in 138 ms

  ➜  Local:   http://localhost:5174/
$ curl -s -o /dev/null -w 'GET / -> %{http_code}\n' http://localhost:5174/
GET / -> 200
```

The tour's steps are the ones `pnpm media` scripts on the same demo organisations for the website's animated
demos ([website.md](../website.md)), and the end-to-end suite (`pnpm e2e`) covers each of them.
The hosted demo at `gcportrait.app/demo/` is built with `pnpm demo:static` and published with the website
([website.md](../website.md#the-demo)); until the website is live, use the local demo.

## docs/modes.md: "7. Verified on 2026-10-11"

The backend's configuration of each kind of instance, from a local run of the backend from source
(`tsx src/main.ts` in `backend/`, the same entry point the image bundles) on a private port, with demo values
only (the client id is the documentation's example):

```text
$ curl -s http://localhost:18091/api/config                 # no OAuth client: demo and dropped exports only
{"oauthClientId":null,"saMode":false,"saStrictExposure":false,"backendServiceAccount":null,"version":"0.0.0",
 "sourceUrl":"https://github.com/florianchrometz/gcportrait","hostedBy":"Not affiliated with Google / Google Cloud.",
 "demo":false,"demoOnly":false,"legal":{"impressum":false,"privacy":false}}
$ curl -s http://localhost:18092/api/config                 # OAUTH_CLIENT_ID, HOSTED_BY and SOURCE_URL set
{"oauthClientId":"12345678901-abc.apps.googleusercontent.com","saMode":false,"saStrictExposure":false,
 "backendServiceAccount":null,"version":"0.0.0","sourceUrl":"https://git.example.com/gcportrait",
 "hostedBy":"Hosted by Example Ltd IT. Not affiliated with Google / Google Cloud.","demo":false,"demoOnly":false,
 "legal":{"impressum":false,"privacy":false}}
$ curl -s http://localhost:18093/api/config                 # DEMO_ONLY=true
{"oauthClientId":null,"saMode":false,"saStrictExposure":false,"backendServiceAccount":null,"version":"0.0.0",
 "sourceUrl":"https://github.com/florianchrometz/gcportrait","hostedBy":"Not affiliated with Google / Google Cloud.",
 "demo":false,"demoOnly":true,"legal":{"impressum":false,"privacy":false}}
$ curl -s http://localhost:18093/api/healthz
{"status":"ok","version":"0.0.0"}
```

(The answers are one line each; they are wrapped here. Since 2026-10-12 `hostedBy` is "Hosted by NAME." when
`HOSTED_BY` is set and `null` otherwise, without the non-affiliation line, which the footer carries; ADR 0018.)
Service-account mode needs the instance's own Google
identity, so a laptop without one refuses to start with it rather than run without the gate's account:

```text
$ SA_MODE_ENABLED=true CLOUDSDK_CONFIG=/an/empty/directory pnpm --filter @gcportrait/backend exec tsx src/main.ts
Service-account mode is on (SA_MODE_ENABLED=true), but its identity is not usable: no Application Default
Credentials were found: no GOOGLE_APPLICATION_CREDENTIALS, no gcloud application-default credentials file, and no
metadata server.
undefined
/Users/…/backend:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: tsx src/main.ts
$ DEMO_ONLY=true OAUTH_CLIENT_ID=12345678901-abc.apps.googleusercontent.com pnpm --filter @gcportrait/backend exec tsx src/main.ts
Invalid backend configuration:
  OAUTH_CLIENT_ID: must be unset with DEMO_ONLY=true (a demo-only instance offers no sign-in)
undefined
/Users/…/backend:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: tsx src/main.ts
```

Both stopped with exit code 1 (the last three lines of each are pnpm's, not the backend's). The demo's sizes
are the pinned counts of `packages/demo-data/fixtures/stats.json`, which the demo-data tests check;
`pnpm --filter @gcportrait/demo-data generate --size S --out s.ndjson` wrote the 96 assets of S. A pull in
both modes, the gate refusing a scope, and the browser path from the permission check to an exported PNG were
checked against a real project during the self-hosting review of 2026-10-10; a real export read from Cloud
Storage was checked the same day through a local backend. Nothing of that project is reproduced in the
repository.

## docs/permissions.md: "8. How this page was verified"

**2026-10-11**, on the working tree of that day (macOS 27.0, Node 22). The wording in sections 2 and 6 is the
app's own (`frontend/src/auth/labels.ts`, `frontend/src/preflight/copy.ts`), the commands are the backend's
(`backend/src/preflight/commands.ts`), and the backend's tests pin both, the whole permission matrix included:

```text
$ pnpm --filter @gcportrait/backend test
 Test Files  22 passed (22)
      Tests  588 passed (588)
```

The request rules, against a local backend run from source (`tsx src/main.ts`, service-account mode off, no
OAuth client) with a stand-in token that never reaches Google:

```text
$ curl -s -X POST http://localhost:8080/api/preflight -H 'content-type: application/json' \
    -d '{"scope":"projects/demo-web-1","mode":"user"}'
{"statusCode":401,"error":"Unauthorized","message":"Sign in first: this request needs your Google access token.","requestId":"…"}
$ curl -s -X POST http://localhost:8080/api/preflight -H 'content-type: application/json' -H 'X-Gcportrait-Token: not-a-real-token' \
    -d '{"scope":"projects/demo-web-1","mode":"sa","quotaProject":"demo-net-1"}'
{"statusCode":400,"error":"Bad Request","message":"Invalid request: quotaProject: must be left out in service-account mode, which uses this instance's own project.","requestId":"…"}
$ curl -s -X POST http://localhost:8080/api/preflight -H 'content-type: application/json' -H 'X-Gcportrait-Token: not-a-real-token' \
    -d '{"scope":"projects/demo-web-1","mode":"sa"}'
{"statusCode":403,"error":"Forbidden","message":"Service-account mode is off on this gcportrait instance.","requestId":"…"}
$ curl -s -X POST http://localhost:8080/api/preflight -H 'content-type: application/json' -H 'X-Gcportrait-Token: not-a-real-token' \
    -d '{"scope":"projects/Demo_Web","mode":"user"}'
{"statusCode":400,"error":"Bad Request","message":"Invalid request: scope: must be organizations/ID, folders/ID or projects/ID_OR_NUMBER.","requestId":"…"}
```

(The port was a private one, shown here as 8080.)

**2026-10-10**, against real Google Cloud:

- the backend's tests (the gate allowed, denied, remembered, expired, never across tokens or scopes; the
  strict check's answers; every route that takes `mode: "sa"` refusing without a passing gate; the credentials
  code), and `e2e/tests/sa-mode.spec.ts` (the real backend with a pretend Google: a scope you can see read and
  drawn through the account, a scope you cannot see refused with nothing asked as the account, the strict
  check refusing a public scope);
- once against a real project with a real service account that held only `roles/cloudasset.viewer` there,
  through the backend's own routes with a person's token: the check and the pull of that project passed the
  gate and listed it as the account, with no quota header; an organisation the person could not see and a
  project id that does not exist were refused (403 `SA_GATE_CALLER_DENIED`) without any call as the account;
  with the strict check on, the account's own `get` came back as Google's exact refusal and the project
  passed. Nothing from that run is in the repository;
- during the self-hosting review of 2026-10-10, against the maintainer's deployed instance with a real token:
  the check `ready` in both modes, and the gate refusing a made-up organisation the person could not see, with
  nothing asked as the account.

Since 2026-10-10 the backend's tests also cover where your token comes from (`X-Gcportrait-Token` first,
`Authorization: Bearer` only without it, neither ever logged), a refusal on the Permissions page ending a
remembered pass for the same sign-in and scope at once, and the audit line being written at any `LOG_LEVEL`
short of `silent`.

**Not recorded yet:** Google's real consent screen as a person sees it. The maintainer reported on 2026-10-10
that signing in through Google's real window works with a local build, but the consent screen's wording for
each scope is not written down yet ([backlog.md](../backlog.md)); the sign-in path is tested end to end against a
stand-in for Google's window (`e2e/tests/signin.spec.ts`), and the scopes were measured with narrowed tokens in
the quota-project spike. The wording
quoted in section 2 is Google's description of the `cloudasset` scope in its API discovery document, which is
roughly what the consent screen shows (ADR 0028 §6).

The quota-project and gate behaviour behind these rules was measured in the quota-project spike
([spikes/quota-project.md](../spikes/quota-project.md)) and decided in [ADR
0028](../adr/0028-quota-project-and-sa-gate.md).

## docs/lenses-and-filters.md: "9. Verified on 2026-10-11"

Checked on the working tree of 2026-10-11 (with the timeline, demo-only mode and the release pipeline built),
macOS 27.0, Node 22,
on the synthetic demo organisations only. `pnpm render-scene` builds the same Scene the app builds for a view
and prints its summary; the e2e specs drive the app in Chromium on demo M and L.

```text
$ pnpm render-scene --fixture M --lens networking
gcportrait render-scene · Not affiliated with Google / Google Cloud.
fixture    demo M: 952 assets read at 2026-10-08T00:00:00Z; catalog 0.0.0
view       lens networking · detail auto → folders (budget 73, lens ceiling networks)
rects      42 drawn; per level: folders 42, projects 97, networks 172, all 174
root       example.com (the whole scope)
focus      none
zones      38: folder 14, project 24
chips      12: project 12
cards      4 from 2 products
edges      36 standing for 45 relations: attaches 8, routes 2, uses 3, peers 2, connects 3, secures 2, shares 16
external   0 stubs · overlays 0 · held back 59 hidden
dangling   7 references of visible nodes (not drawn)
warnings   none
$ pnpm render-scene --fixture M --lens networking --detail networks
view       lens networking · detail networks
rects      172 drawn; per level: folders 42, projects 97, networks 172, all 174
zones      79: folder 14, project 24, vpc 4, subnet 22, product-container 15
chips      1: product-container 1
cards      93 from 10 products
edges      81 standing for 81 relations: attaches 16, routes 4, uses 18, peers 4, connects 19, secures 4, shares 16
$ pnpm render-scene --fixture M --lens networking --focus kind=shared-vpc,host=demo-net-1
view       lens networking · detail auto → projects (budget 73, lens ceiling networks)
focus      shared-vpc //cloudresourcemanager.googleapis.com/projects/10000000001 (14 projects)
zones      22: project 14, vpc 2, product-container 6
edges      60 standing for 62 relations: attaches 16, routes 3, uses 11, peers 2, connects 14, secures 1, shares 13
$ pnpm render-scene --fixture M --lens security --focus kind=perimeter,perimeter=data_perimeter
view       lens security · detail auto → all (budget 73, lens ceiling projects)
focus      perimeter //accesscontextmanager.googleapis.com/accessPolicies/40000000001/servicePerimeters/data_perimeter (2 projects)
external   0 stubs · overlays 1 · held back 6 hidden
$ pnpm render-scene --fixture M --lens security --focus kind=perimeter,perimeter=demo-perimeter
focus      perimeter: error unknown-perimeter: No perimeter "demo-perimeter" in this snapshot.
warnings   Focus not applied: No perimeter "demo-perimeter" in this snapshot.
$ pnpm render-scene --fixture M --lens overview --focus kind=application,application=storefront
focus      application: error ambiguous: "storefront" names 3 applications; use the full resource name.
$ pnpm render-scene --fixture M --lens overview --focus kind=standalone-projects
view       lens overview · detail auto → all (budget 73)
focus      standalone-projects (6 projects)
$ pnpm render-scene --fixture S --lens overview --focus kind=project,project=demo-web-1 --detail all
focus      project //cloudresourcemanager.googleapis.com/projects/10000000007 (1 project)
edges      22 standing for 22 relations: attaches 7, routes 9, uses 2, memberOf 3, shares 1
external   3 stubs · overlays 0 · held back 0 hidden
$ pnpm render-scene --fixture M --lens overview --root //cloudresourcemanager.googleapis.com/folders/20000000005 \
    --filter hideEmptyProjects=true --filter regions=us-central1 --filter depth=2
view       lens overview · detail auto → all (budget 73)
root       Workloads (//cloudresourcemanager.googleapis.com/folders/20000000005)
zones      18: folder 9, project 9
chips      9: project 9
```

(Every run printed the full summary and exited 0; the lines repeated from the first run are left out above. Since
2026-10-12 the summary's first line is `gcportrait render-scene` alone: no command line prints the non-affiliation
line any more, ADR 0018.)

```text
$ pnpm e2e tests/export.spec.ts tests/controls.spec.ts tests/disclosure.spec.ts tests/navigation.spec.ts
Running 31 tests using 4 workers
  ✓ the Lens picker opens a lens at auto, no deeper than its default; a chosen level stays; a reload restores both
  ✓ the detail control writes the level, names the one auto picked, and a reload restores it
  ✓ the Focus control picks a project, a host, a perimeter, an application and standalone projects; a reload restores it
  ✓ the Filters popover writes every filter, counts them, a reload restores them, and Reset clears them
  ✓ filters apply under a drill-in and under a focus (the earlier tool’s filters silently did not)
  ✓ the breadcrumb shows the drill-in trail, its crumbs drill out, a double-click drills in, and a reload restores it
  ✓ demo L: expand a project chip, see its networks as chips, expand all, and a reload keeps the flips
  ✓ the collapse button on an open zone’s header collapses it (the inverse flip); the chip expands it back
  ✓ a 49th flip drops the oldest, and the page says so until dismissed
  ✓ when the window grows, Auto may open a deeper level, and the page says why
  ✓ light theme › axe finds nothing with the Focus and Filters popovers, the Lens list and the Saved views dialog open
  ✓ dark theme › axe finds nothing with the Focus and Filters popovers, the Lens list and the Saved views dialog open
  … (the 6 other disclosure and controls specs, the 4 navigation specs, and the 9 export specs, listed in export.md)
  31 passed (2.1m)
```

(Playwright's list reporter, with the spec files, the test numbers and the times left out.)

The lens table and the type bundles in [section 2](../lenses-and-filters.md#2-lenses) are generated from the compiled catalog by
`node scripts/user-docs.mjs --write`; `node scripts/user-docs.mjs` (and `scripts/user-docs.test.ts`, part of
`pnpm test`) fails while they differ from `packages/catalog/lenses/`.

## docs/timeline.md: "10. Verified on 2026-10-11"

Checked again on the working tree of 2026-10-11 (after the performance pass of that day, its third round
included), macOS
27.0, Node 22, against the demo organisations S and M in Chromium:

```text
$ pnpm e2e tests/timeline.spec.ts tests/diff.spec.ts tests/extra-ticks.spec.ts
Running 18 tests using 4 workers
  ✓ shows the 35 days of the history, the snapshot’s own day on screen
  ✓ scrubbing to a day with changes draws that day, and the day is in the hash
  ✓ [ and ] move one day back and forward; past the last day they say why they cannot
  ✓ a link with a tick opens on that day, and a reload keeps it
  ✓ playback runs through the days to the last one, and a key press stops it
  ✓ the diagram page with the timeline passes axe in light
  ✓ the diagram page with the timeline passes axe in dark
  ✓ scrubbing to the scale-out day draws what changed since the day before, with its legend rows
  ✓ the drawer of the changed manager says what changed: both update times and the fields
  ✓ stepping back compares with the later day; another lens keeps the day’s markers
  ✓ the diff day with the drawer open passes axe in light
  ✓ the diff day with the drawer open passes axe in dark
  ✓ an imported export of the demo organisation is an extra tick: selected, drawn, linked, then deleted
  ✓ an export whose read time is later than the clock is noted at the import and sits at the present
  ✓ an export without its operation.json is an estimated extra tick; one with a typed read time is not
  ✓ playback leaves the extra ticks out until "Play extras" is pressed
  ✓ the diagram with an extra tick on screen and the Snapshots page pass axe in light
  ✓ the diagram with an extra tick on screen and the Snapshots page pass axe in dark
  18 passed (29.7s)
$ pnpm --filter @gcportrait/frontend test
 Test Files  143 passed (143)
      Tests  1329 passed (1329)
```

(Playwright's list reporter, with the spec files, the test numbers and the times left out.)

The frontend's tests include the timeline's tick math, cache key, scheduler, controller and playback, the tick
cache in fake IndexedDB, and a live day read through a pretend backend. First verified on 2026-10-10, in the
timeline review on that day's tree and in a production demo build (with screenshots in both themes and memory
measurements): the same 18 specs passed then (32.5 s), with 135 frontend test files and 1 277 tests.

No end-to-end test reads a day from Google Cloud yet: a live scope's days are covered by unit tests against a
pretend backend. A check against a real scope needs a sign-in through a real OAuth client and is still open
([backlog.md](../backlog.md), "The timeline against a real scope").

## docs/export.md: "7. Verified on 2026-10-11"

On the working tree of 2026-10-11, macOS 27.0, Node 22, with the demo organisation M only. The headless
renderer, in both themes (paths shortened to `out/`):

```text
$ pnpm render --hash 'snapshot=demo%3AM&lens=security&focus=perimeter&focus.perimeter=data_perimeter' --png out/p.png
gcportrait render · Not affiliated with Google / Google Cloud.
demo M (952 assets) · lens security · detail auto → all (budget 73) · light
layout: 56 rects, 24 edges routed (0 fallbacks, 0 failed); invariants hold
png: 3942×2148 px at 2× with a 24 px margin → out/p.png (515 271 bytes)
$ pnpm render --fixture M --lens networking --png out/m-networking-light.png --svg out/m-networking-light.svg
gcportrait render · Not affiliated with Google / Google Cloud.
demo M (952 assets) · lens networking · detail auto → folders (budget 73) · light
layout: 42 rects, 36 edges routed (0 fallbacks, 0 failed); invariants hold
svg: 1861×1446 → out/m-networking-light.svg (45 091 bytes)
png: 3818×2988 px at 2× with a 24 px margin → out/m-networking-light.png (600 202 bytes)
$ pnpm render --fixture M --lens networking --theme dark --png out/m-networking-dark.png
gcportrait render · Not affiliated with Google / Google Cloud.
demo M (952 assets) · lens networking · detail auto → folders (budget 73) · dark
layout: 42 rects, 36 edges routed (0 fallbacks, 0 failed); invariants hold
png: 3818×2988 px at 2× with a 24 px margin → out/m-networking-dark.png (587 054 bytes)
$ grep -o '<desc>[^<]*</desc>' out/m-networking-light.svg
<desc>example.com, Networking lens, read 2026-10-08T00:00:00+00:00. Drawn with gcportrait.</desc>
$ grep -o '<text[^>]*>[^<]*</text>' out/m-networking-light.svg | head -3
<text xml:space="preserve" x="24" y="-39" font-size="15" font-weight="500" fill="#202124">example.com</text>
<text xml:space="preserve" x="24" y="-21" font-size="11" font-weight="400" fill="#5F6368">Networking lens · read 2026-10-08T00:00:00+00:00</text>
<text xml:space="preserve" x="24" y="-4" font-size="10.5" font-weight="400" fill="#5F6368">gcportrait.app - Visualize your Google Cloud Infrastructure</text>
$ grep -c 'Not affiliated' out/m-networking-light.svg
0
```

Both PNGs were looked at: the title block's three lines and the legend in the light and in the dark theme (the
drawing carries no affiliation line; since 2026-10-12 neither does the banner on standard error, which is
`gcportrait render` alone, nor `index.json`, ADR 0018). The
Export menu in Chromium, in the app on demo M (part of the run listed in
[lenses-and-filters.md](../lenses-and-filters.md#9-verified-on-2026-10-11), 31 passed):

```text
$ pnpm e2e tests/export.spec.ts tests/controls.spec.ts tests/disclosure.spec.ts tests/navigation.spec.ts
  ✓ downloads the whole diagram as SVG: well-formed, titled, with the legend, no affiliation line, no CSS variables
  ✓ is inert until a diagram is drawn, then a keyboard-operable menu, accessible in both themes
exported SVG vs the renderer's SVG (both in resvg, light): 0.0000 % of pixels differ
  ✓ downloads PNGs at 2× and 3× on the theme background with a 24 px margin, in either theme
exported SVG vs the renderer's SVG (both in resvg, dark): 0.0000 % of pixels differ
  ✓ exports the current viewport: clipped to what the canvas shows, title block and legend kept
Chromium PNG vs resvg at 2×: 0.1980 % of pixels differ
  ✓ the PNG Chromium draws matches resvg drawing the exported SVG at the same scale
  ✓ says plainly when the browser cannot copy images
  ✓ copies the PNG to the clipboard
app PNG (Chromium) vs CLI PNG (resvg, light): 0.1874 % of pixels differ
  ✓ exports what the headless renderer draws for the same view (light)
app PNG (Chromium) vs CLI PNG (resvg, dark): 0.1974 % of pixels differ
  ✓ exports what the headless renderer draws for the same view (dark)
  31 passed (53.3s)
```

(Playwright's list reporter, with the spec files, the test numbers and the times left out.)

The file names and the title block's text come from `frontend/src/export/fileName.ts` and
`frontend/src/diagram/titleBlock.ts`, whose unit tests (`pnpm --filter @gcportrait/frontend test`) pin them.

The draw.io export was verified on 2026-10-12, on the working tree of that day: the Export menu's draw.io file of
demos S, M and L in both themes, drawn by mxGraph 4.2.2 (the library diagrams.net is built on) in Chromium and
compared with the SVG export of the same view, laid out by Chromium and rasterised by resvg at 1× with the 24-unit
margin; the file of demo S in the light theme is byte for byte the render golden `pnpm render` writes:

```text
$ pnpm e2e tests/drawio.spec.ts --project chromium
draw.io vs SVG, demo S light: 15 zones, 40 nodes, 45 lines, 116 text lines; 2.07 % of pixels differ; text within 0.77 px, boxes and line ends within 0.00 px, open heads 2.68 px short, block heads 1.26 px wider
draw.io vs SVG, demo S dark: 15 zones, 40 nodes, 45 lines, 116 text lines; 2.04 % of pixels differ; text within 0.77 px, boxes and line ends within 0.00 px, open heads 2.68 px short, block heads 1.26 px wider
draw.io vs SVG, demo M light: 14 zones, 24 nodes, 42 lines, 77 text lines; 2.97 % of pixels differ; text within 0.77 px, boxes and line ends within 0.00 px, open heads 0.00 px short, block heads 1.26 px wider
draw.io vs SVG, demo M dark: 14 zones, 24 nodes, 42 lines, 77 text lines; 2.49 % of pixels differ; text within 0.77 px, boxes and line ends within 0.00 px, open heads 0.00 px short, block heads 1.26 px wider
draw.io vs SVG, demo L light: 45 zones, 119 nodes, 245 lines, 298 text lines; 3.22 % of pixels differ; text within 0.77 px, boxes and line ends within 0.00 px, open heads 0.00 px short, block heads 1.26 px wider
draw.io vs SVG, demo L dark: 45 zones, 119 nodes, 245 lines, 298 text lines; 2.77 % of pixels differ; text within 0.77 px, boxes and line ends within 0.00 px, open heads 0.00 px short, block heads 1.26 px wider
  6 passed
```

(The views of M and L in the overview lens have no open head; the pixels that differ are text anti-aliasing,
diagrams.net's half-pixel snap of thin lines and its own arrowheads, [ADR 0036](../adr/0036-drawio-export-from-the-svg-drawing.md).)

## docs/faq.md: "Verified on 2026-10-11"

On the working tree of 2026-10-11, with the demo organisation M (synthetic) and the catalog's own coverage
report (all three commands re-run on 2026-10-12, when the catalog's groups took their current names; the
numbers had not changed):

```text
$ pnpm catalog:coverage
catalog:coverage: official list 2026-10-09; per group: official types owned · mapped (by role) · unmapped · missing · coverage
    hierarchy                     7 official · 7 mapped (3 container, 4 hidden) · 0 unmapped · 0 missing · 100.0 %
    networking-fabric            31 official · 31 mapped (2 container, 18 core, 1 leaf, 10 hidden) · 0 unmapped · 0 missing · 100.0 %
    …
    policy-and-runtime            7 official · 0 mapped · 7 unmapped · 0 missing · 0.0 %
        unmapped, IAM policy content only, no RESOURCE data; outside v1 ingestion: 7
    security-identity            84 official · 82 mapped (5 container, 30 core, 9 leaf, 38 hidden) · 2 unmapped · 0 missing · 97.6 %
        unmapped, client connector, shut down on 2023-12-31; the API reference documents no fields any more: 2
  types no group owns: none
$ pnpm render-scene --fixture M --lens everything --detail folders
view       lens everything · detail folders
rects      49 drawn; per level: folders 49, projects 564, networks 674, all 951
edges      100 standing for 368 relations: attaches 16, routes 2, uses 22, peers 2, connects 5, memberOf 1, encryptedBy 18, secures 9, triggers 9, shares 16
external   0 stubs · overlays 0 · held back 0 hidden
dangling   49 references of visible nodes (not drawn)
$ pnpm render-scene --fixture M --lens networking --focus kind=project,project=demo-web-1 --detail all
focus      project //cloudresourcemanager.googleapis.com/projects/10000000009 (1 project)
edges      10 standing for 10 relations: attaches 4, routes 1, uses 3, connects 1, shares 1
external   5 stubs · overlays 0 · held back 0 hidden
dangling   1 references of visible nodes (not drawn)
```

(Every command exited 0; lines the answers above do not use are left out where marked or cut.) The 641 types
are the sum of the groups' official types; 632 mapped. `pnpm render-scene` prints only the total of dangling
references; the breakdown of demo M's 49 in [What is a dangling reference?](../faq.md#what-is-a-dangling-reference) was
counted from the list of dangling references that the graph package's `buildGraphWithReport` returns for the
same snapshot. The facts about Cloud Asset Inventory (the 35-day `readTime`, the products that synchronise
every few hours) are from Google's documentation, read for the
[cai-ingestion skill](../../.agents/skills/cai-ingestion/SKILL.md) on 2026-10-08, and from the quota-project spike
([spikes/quota-project.md](../spikes/quota-project.md)) for the scopes and quota projects. The page size
of 500 assets is gcportrait's own choice, below what the API allows (`CAI_PAGE_SIZE` in
`backend/src/stream/asset-list.ts`, [ADR 0028](../adr/0028-quota-project-and-sa-gate.md) §5).

## docs/self-host.md: "Verified on"

**2026-10-11, the docs pass:** this guide re-read against the tree. Every command and flag it names
exists (`node scripts/user-docs.mjs`, which `pnpm test` runs as `scripts/user-docs.test.ts`, checks each
`pnpm` script, each `infra/deploy.sh` and `infra/uninstall.sh` flag and each `node scripts/` file in the
guides' code), and the scripts still pass their offline tests; nothing was deployed that day:

```text
$ infra/deploy.sh --help
gcportrait infra/deploy.sh - Not affiliated with Google / Google Cloud.

Usage: infra/deploy.sh --project PROJECT_ID [options]
…
$ infra/uninstall.sh --help
gcportrait infra/uninstall.sh - Not affiliated with Google / Google Cloud.

Usage: infra/uninstall.sh --project PROJECT_ID [options]
…
$ pnpm test:infra
 Test Files  1 passed (1)
      Tests  58 passed (58)
   Duration  69.01s (tests 99%)
```

Since 2026-10-12 the first line of `--help` and of every run is the script's name alone, and `--help` closes with
the long form of the non-affiliation statement (ADR 0018).

The newest real runs on Google Cloud are the ones below.

**2026-10-11, 06:15:59 to 06:16:47 UTC, the pull path (deploy.sh without `--build`):** one timed
deploy of a throwaway instance `gcportrait-p77` into project `gcportrait` (europe-west3), from a state without
the remote repository, with a public ghcr.io image of the same shape as a release (a multi-platform index
serving HTTP on 8080), because no release of gcportrait is on ghcr.io yet; then a second run with the same
flags, and uninstall.sh. The project number is redacted:

```text
$ infra/deploy.sh --project gcportrait --region europe-west3 --service gcportrait-p77 --dry-run
error: ghcr.io/florianchrometz/gcportrait has no public release yet (GitHub Container Registry refuses
anonymous access to it). Build from this checkout instead: the same command with --build.
$ infra/deploy.sh --project gcportrait --region europe-west3 --service gcportrait-p77 \
    --image ghcr.io/mendhak/http-https-echo:42 --dry-run
Dry run finished in 0m09s: nothing was changed. …
$ infra/deploy.sh --project gcportrait --region europe-west3 --service gcportrait-p77 \
    --image ghcr.io/mendhak/http-https-echo:42
==> Creating the backend's service account (no roles)
==> Preparing the pull from GitHub Container Registry (Artifact Registry remote repository)
    + gcloud artifacts repositories create ghcr … --mode=remote-repository --remote-docker-repo=https://ghcr.io …
==> Deploying the Cloud Run service
    …
    warning: https://gcportrait-p77-PROJECT_NUMBER.europe-west3.run.app/ did not serve the app
first deploy, wall clock: 48s
$ curl -s https://gcportrait-p77-PROJECT_NUMBER.europe-west3.run.app/api/healthz   # the echo image answers
{"path": "/api/healthz", …}
$ infra/deploy.sh … --image ghcr.io/mendhak/http-https-echo:42      # the same command again
==> Checking that what exists already was made by deploy.sh (0m03s)
    Cloud Run service gcportrait-p77 (europe-west3) exists, made by deploy.sh: it is updated
    service account gcportrait-p77-backend@gcportrait.iam.gserviceaccount.com exists, made by deploy.sh
    remote repository ghcr (europe-west3) of https://ghcr.io exists, made by deploy.sh
deploy exit=0 wall clock 22s
$ infra/uninstall.sh --project gcportrait --region europe-west3 --service gcportrait-p77
Deleted service [gcportrait-p77].
Deleted repository [ghcr].
deleted service account [gcportrait-p77-backend@gcportrait.iam.gserviceaccount.com]
Done in 0m15s.
```

The "did not serve the app" warning is expected: the echo image is not gcportrait. The second run first failed
on 2026-10-11 06:16 UTC because deploy.sh read the remote repository's upstream from a field Artifact Registry no
longer returns (`remoteRepositoryConfig.commonRepository.uri` replaced `dockerRepository.customRepository.uri`);
`infra/common.sh` now reads both, with the two shapes covered by `pnpm test:infra`, and the 22 s run above is
the run with that fix. The Cloud Shell tutorial has not been clicked through in Cloud Shell, which cannot be
driven from a script; its commands run against the stand-ins of `scripts/infra.test.ts`. A real release on
ghcr.io, once tagged, goes through exactly this path with `--image vX.Y.Z` or no `--image` at all.

**2026-10-10, 16:39:15 to 16:42:12 UTC:** one uninterrupted, timed deploy from scratch of a throwaway instance
`gcportrait-fresh`, next to the live `gcportrait` in the maintainer's project `gcportrait` (europe-west3), a
`curl` of its `/api/config`, and its uninstall. Google Cloud SDK 587.0.0, macOS 27.0 (bash 3.2.57). Before the
run the project had billing and all seven APIs of `--build` on (from the earlier runs below), the maintainer's
OAuth client, and nothing of `gcportrait-fresh`. The scripts were `infra/deploy.sh` and `infra/uninstall.sh`
as committed in `8ed6f27` (the run started from that working tree 36 s before the commit was made, so the
image calls itself `cc430eb-dirty`, `git describe` of the commit before). The changes that the self-hosting
fixes of 2026-10-10 made to both scripts later (the refusal to adopt what deploy.sh did not create, the wait on `/api/healthz`, the IAP request in
`--dry-run`, and `--disable-apis` keeping what other Cloud Run services, jobs and worker pools need) are
verified by `--dry-run` and `pnpm test:infra`; the next real run verifies them for real. Project number,
address hash and client id are replaced below:

```sh
infra/deploy.sh --project gcportrait --region europe-west3 --service gcportrait-fresh --build \
  --oauth-client-id CLIENT_ID --source-url https://github.com/florianchrometz/gcportrait
curl -s https://gcportrait-fresh-PROJECT_NUMBER.europe-west3.run.app/api/config
infra/uninstall.sh --project gcportrait --region europe-west3 --service gcportrait-fresh --yes
```

```text
  0m00s ==> Checking the project and your gcloud session          billing: enabled
  0m03s ==> Enabling the Google APIs the instance needs           all seven already enabled
  0m04s ==> Creating the backend's service account (no roles)    created gcportrait-fresh-backend
  0m08s ==> Preparing Cloud Build (repository, bucket, build account)
            created the repository (clean-up policy set), the bucket (one request, label included) and the
            build account; its Storage Admin grant refused once ("does not exist") and repeated after 15 s
  0m36s ==> Building the image with Cloud Build
            upload of 1831 files (11.2 MiB); Cloud Build 57 s on e2-highcpu-8: SUCCESS
  2m21s ==> Deploying the Cloud Run service                      revision gcportrait-fresh-00001-jvx serving
  2m32s ==> Checking the running instance
            revision gcportrait-fresh-00001-jvx is ready: its startup probe GET /healthz passed
            GET /api/config: {"oauthClientId":"CLIENT_ID","saMode":false,"saStrictExposure":false,
              "backendServiceAccount":"gcportrait-fresh-backend@gcportrait.iam.gserviceaccount.com",
              "version":"cc430eb-dirty","sourceUrl":"https://github.com/florianchrometz/gcportrait",
              "hostedBy":"…","demo":false}
            GET /:           the app
            warning: Google's Compute Engine default account PROJECT_NUMBER-compute@developer.gserviceaccount.com
              holds Editor on gcportrait (see "What Google adds by itself" below)
  2m35s gcportrait is deployed                                   (deploy.sh exit 0, 155 s by the wall clock)
curl /api/config                                                 the same answer
uninstall.sh (no --disable-apis: the seven APIs were on before and the live service uses them)
  0m00s ==> Looking for what deploy.sh created in gcportrait
            the service, the repository, the bucket, both accounts: all with deploy.sh's marks
  0m08s ==> Deleting the Cloud Run service
  0m12s ==> Deleting the build repository and its images
  0m14s ==> Deleting the build bucket and its objects            the source archive and two log objects
  0m19s ==> Deleting the build service account
  0m20s ==> Deleting the backend's service account
  0m21s Done                                                     (exit 0; the live gcportrait untouched)
total 177 s from the first command to the end of the uninstall
```

The `hostedBy` value is shortened to `…` above: it carried a non-affiliation line whose wording has since been
replaced. Since 2026-10-12 (ADR 0018) it is "Hosted by NAME." when `HOSTED_BY` is set and `null` otherwise: the
non-affiliation statement is the app footer's.

So from a project with billing and the APIs on to a running, checked instance took **2 min 35 s**, most of it
the upload and the build (1 min 45 s); enabling the APIs in a project that has none of them took 13 s in run A
below, and creating the OAuth client in the console (step 2) takes a few minutes more. Removing it again took
21 s. Not covered by this run: `--iap` (the redeploy with it was not part of the run) and `--disable-apis`
(nothing to disable, as the run enabled no API); both are still to run for real.

**Earlier runs**, 2026-10-10, Google Cloud CLI 587.0.0, macOS (bash 3.2), in the maintainer's project
`gcportrait`, with **earlier versions of deploy.sh** (the current one fixes what they found). The project had
billing, and the Cloud Asset Inventory, Resource Manager and Cloud Storage APIs on; nothing of deploy.sh
existed (the backend account was there from an earlier experiment and was reused, which deploy.sh no longer
does: it stops at an account it did not create, see [What deploy.sh does](../self-host.md#what-deploysh-does)):

```text
Run A (first version of deploy.sh), from the state above:
  0m00s ==> Checking the project and your gcloud session
  0m02s ==> Enabling the Google APIs the instance needs       run, iam, artifactregistry, cloudbuild: 13 s
  0m15s ==> Creating the backend's service account (no roles)  exists, reused
  0m19s ==> Preparing Cloud Build (repository, bucket, build account)
            created all three; one grant repeated after 15 s while the new account propagated
  1m00s ==> Building the image with Cloud Build
  1m03s     refused: the build account had Storage Object Admin on its bucket, but Cloud Build reads the
            bucket itself (storage.buckets.get) before it accepts a build. Fixed: deploy.sh now grants
            Storage Admin on that one bucket, the role Google documents for this case.

Run B, with that grant in place (made by hand, as deploy.sh now makes it):
  0m00s ==> Checking the project and your gcloud session
  0m02s ==> Enabling the Google APIs the instance needs        all on
  0m03s ==> Creating the backend's service account (no roles)
  0m06s ==> Preparing Cloud Build (repository, bucket, build account)   all there
  0m13s ==> Building the image with Cloud Build
            upload 1830 files (11.2 MiB) 15 s; build queued 48 s, then 49 s on e2-highcpu-8: SUCCESS
  1m54s ==> Deploying the Cloud Run service
            revision gcportrait-00001 ready 11 s after it was created; startup probe GET /healthz passed on
            the 2nd attempt, liveness probe passed
  2m10s ==> Checking the running instance
            GET /api/config  {"oauthClientId":"…","saMode":true,…,"version":"86aad6c-dirty",…,"demo":false}
            GET /            the app
  2m43s gcportrait is deployed
```

Together they took under four minutes from that state: run A's minute of enabling APIs and creating accounts,
repository and bucket, then run B's two minutes to a ready revision and a check (33 s of run B went to a check
of `/healthz` from outside, which Cloud Run's front end answers itself, see
[Troubleshooting](../self-host.md#troubleshooting); deploy.sh now waits on `/api/healthz` instead). Step 2, the OAuth client
in the console, adds a few minutes. Google's own record of run B agrees, read during the self-hosting review of 2026-10-10: the
service's only revision, `gcportrait-00001-skp`, runs the image tagged `20261010-144040-86aad6c-dirty`
(deploy.sh names the image after the UTC time its build step starts) and turned ready at 14:42:34 UTC, 1 min
54 s after the build step began.

## docs/self-host.md: "Verified on (legal pages)"

**2026-10-10, 21:52 UTC**, macOS 27.0, Node 22, a local production build (`pnpm build`) of that day's working
tree and synthetic texts (`impressum.md` with an address block and a `<mail@example.com>` link, `privacy.md`
with a link to `/impressum`): `DEMO_ONLY=true LEGAL_DIR=… PORT=18089 pnpm --filter @gcportrait/backend start`,
then (port shown as 8080):

```text
$ curl -s http://localhost:8080/api/config
{"oauthClientId":null,"saMode":false,"saStrictExposure":false,"backendServiceAccount":null,"version":"0.0.0",
 "sourceUrl":"https://github.com/florianchrometz/gcportrait","hostedBy":"Not affiliated with Google / Google Cloud.",
 "demo":false,"demoOnly":true,"legal":{"impressum":true,"privacy":true}}
$ curl -s -X POST http://localhost:8080/api/preflight
{"statusCode":404,"error":"Not Found","message":"No route for POST /api/preflight. This instance runs in
 demo-only mode: it offers no sign-in and reads nothing from Google Cloud.","requestId":"…"}
$ DEMO_ONLY=yes pnpm --filter @gcportrait/backend start
Invalid backend configuration:
  DEMO_ONLY: must be "true" or "false" (or unset, which means off)
$ DEMO_ONLY=true OAUTH_CLIENT_ID=12345678901-abc.apps.googleusercontent.com pnpm --filter @gcportrait/backend start
Invalid backend configuration:
  OAUTH_CLIENT_ID: must be unset with DEMO_ONLY=true (a demo-only instance offers no sign-in)
```

`/api/legal` returned both texts as written. A run of the same build (`node dist/server.mjs`, same
environment) held 79 MB right after start and 92 MB after 600 requests and every file of the app, well inside
the demo's 256 MiB. The Content Security Policy listed no Google host. `--demo-only`, `--domain` (the mapping,
the printed records, the DNS check, the bounded wait, the Search Console steps, a host mapped to another
service), `--legal-dir` and uninstall.sh's removal of mappings run against the stand-ins of
`scripts/infra.test.ts` (`pnpm test:infra`, 46 tests). **Not run for real yet:** `--demo-only`, `--domain` and
`--legal-dir` on Cloud Run (the agent that wrote them could not deploy; the maintainer's demo is the first
run).

**2026-10-11**, macOS 27.0, Node 22.23.2, the backend run from source (`pnpm exec tsx src/main.ts` in `backend/`, the
port shown as 8080) with links instead of texts, `DEMO_ONLY=true LEGAL_IMPRESSUM_URL=https://operator.example.com/legal/impressum
LEGAL_PRIVACY_URL=https://operator.example.com/legal/privacy`:

```text
$ curl -s http://localhost:8080/api/config
{"oauthClientId":null,"saMode":false,"saStrictExposure":false,"backendServiceAccount":null,"version":"0.0.0",
 "sourceUrl":"https://github.com/florianchrometz/gcportrait","hostedBy":"Not affiliated with Google / Google Cloud.",
 "demo":false,"demoOnly":true,"legal":{"impressum":false,"privacy":false,
 "impressumUrl":"https://operator.example.com/legal/impressum","privacyUrl":"https://operator.example.com/legal/privacy"},
 "render":null}
$ curl -s http://localhost:8080/api/legal
{"impressum":null,"privacy":null}
```

(Since 2026-10-12 `hostedBy` is `null` with `HOSTED_BY` unset, ADR 0018.) With a synthetic `impressum.md` in
`LEGAL_DIR` and `LEGAL_PRIVACY_URL` set, `legal` was `{"impressum":true,
"privacy":false,"impressumUrl":null,"privacyUrl":"https://operator.example.com/legal/privacy"}` and `/api/legal`
served the Impressum. Refused at start-up (exit code 1, nothing served):

```text
$ LEGAL_DIR=… LEGAL_IMPRESSUM_URL=https://operator.example.com/legal/impressum pnpm exec tsx src/main.ts
Invalid backend configuration:
  LEGAL_IMPRESSUM_URL: must be unset while LEGAL_DIR holds an Impressum (serve the text or link the page, not both)
$ LEGAL_PRIVACY_URL=http://operator.example.com/legal/privacy pnpm exec tsx src/main.ts
Invalid backend configuration:
  LEGAL_PRIVACY_URL: must be an https:// URL
```

`--impressum-url` and `--privacy-url` (the variables they set, the summary, a page linked and served at once, the
URLs the backend would refuse, the reminder of a demo-only deploy with neither) run against the stand-ins of
`scripts/infra.test.ts` (`pnpm test:infra`, 65 tests); not run on Cloud Run yet. The app's footer does not link the
addresses yet.

## docs/configuration.md: "Verified on"

**2026-10-11**, on the working tree of that day (macOS 27.0, Node 22, bash 3.2). `scripts/user-docs.mjs`
compares this page with the tree: every variable of the backend's zod schema and its literal default, every
flag of `infra/deploy.sh --help` and `infra/uninstall.sh --help` and the default each states, every variable
`infra/compose.yaml` reads, and every `VITE_` variable of the SPA. It runs in `pnpm test`
(`scripts/user-docs.test.ts`), so a new variable or flag fails the tests until this page lists it:

```text
$ node scripts/user-docs.mjs
user-docs: OK. 8 guides current with the tree.
```

The defaults and the start-up checks, from a local backend run from source (`tsx src/main.ts` in `backend/`)
on a private port (shown as 8080), with nothing set:

```text
$ curl -s http://localhost:8080/api/config
{"oauthClientId":null,"saMode":false,"saStrictExposure":false,"backendServiceAccount":null,"version":"0.0.0","sourceUrl":"https://github.com/florianchrometz/gcportrait","hostedBy":"Not affiliated with Google / Google Cloud.","demo":false,"demoOnly":false,"legal":{"impressum":false,"privacy":false,"impressumUrl":null,"privacyUrl":null},"render":{"maxAssets":60000,"maxPixels":67108864,"maxBodyBytes":26214400,"timeoutMs":300000}}
$ curl -s http://localhost:8080/api/healthz
{"status":"ok","version":"0.0.0"}
```

and with invalid values (exit code 1, nothing served; each variable named, no value echoed):

```text
$ SA_MODE_STRICT_EXPOSURE=yes HOSTED_BY="Google Cloud team" TRUST_PROXY_HOPS=99 SOURCE_URL="javascript:alert(1)" \
    pnpm --filter @gcportrait/backend exec tsx src/main.ts
Invalid backend configuration:
  SA_MODE_STRICT_EXPOSURE: must be "true" or "false" (or unset, which means off)
  HOSTED_BY: must not name Google: gcportrait is not affiliated with Google
  TRUST_PROXY_HOPS: Too big: expected number to be <=10
  SOURCE_URL: must be an http:// or https:// URL
undefined
/Users/…/backend:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: tsx src/main.ts
$ SA_MODE_ENABLED=maybe LOG_LEVEL=warn pnpm --filter @gcportrait/backend exec tsx src/main.ts
{"severity":"WARNING","level":40,"time":"2026-10-11T00:13:51.752Z","service":"gcportrait-backend","version":"0.0.0","message":"SA_MODE_ENABLED is neither \"true\" nor \"false\"; service-account mode stays off."}
```

(The last three lines of the first are pnpm's. The second starts, with the warning, and serves:
`/api/healthz` answered `{"status":"ok","version":"0.0.0"}`. Since 2026-10-12 `hostedBy` is `null` with nothing set,
the scripts' first line is their name alone and `--help` closes with the long form of the non-affiliation
statement; ADR 0018.) The scripts' flags, defaults and dry runs
against stand-ins for `gcloud` and `curl`:

```text
$ infra/deploy.sh --help
gcportrait infra/deploy.sh - Not affiliated with Google / Google Cloud.

Usage: infra/deploy.sh --project PROJECT_ID [options]
…
$ pnpm test:infra
 Test Files  1 passed (1)
      Tests  58 passed (58)
```

After `LEGAL_IMPRESSUM_URL`, `LEGAL_PRIVACY_URL`, `--impressum-url` and `--privacy-url` were added, later the same
day: the backend with nothing set answered `/api/config` with the line above (its `legal` now carries
`"impressumUrl":null,"privacyUrl":null`), `node scripts/user-docs.mjs` found this page current, and `pnpm test:infra`
passed 65 tests ([self-host.md, "Verified on (legal pages)"](../self-host.md#verified-on-legal-pages) has the runs with
the links set and the refusals).

The hand-over of a service the [Cloud Run Button](../configuration.md#cloud-run-button) deployed, run on 2026-10-11 against
stand-ins for `gcloud` and `curl` that log every call and give fixed answers (a service `gcportrait` without
the label; only `run` and `artifactregistry` enabled). deploy.sh enabled the missing APIs, then stopped; the
call log shows that it created, granted and deployed nothing (exit code 1):

```text
$ infra/deploy.sh --project demo-proj-1 --region europe-west3 \
    --image europe-west3-docker.pkg.dev/demo-proj-1/cloud-run-source-deploy/gcportrait:latest
gcportrait infra/deploy.sh - Not affiliated with Google / Google Cloud.

==> Checking the project and your gcloud session (0m00s)
    gcloud account: you@example.com
    project: demo-proj-1 (number 123456789012), region: europe-west3, service: gcportrait
    billing: enabled

==> Enabling the Google APIs the instance needs (0m00s)
    already enabled: run.googleapis.com
    already enabled: artifactregistry.googleapis.com
    + gcloud services enable iam.googleapis.com cloudasset.googleapis.com cloudresourcemanager.googleapis.com --project=demo-proj-1

==> Checking that what exists already was made by deploy.sh (0m00s)
    - the Cloud Run service gcportrait in europe-west3 has no managed-by=gcportrait-deploy label. To hand it over: gcloud run services update gcportrait --project=demo-proj-1 --region=europe-west3 --update-labels=managed-by=gcportrait-deploy
error: deploy.sh did not create the resources above, so it neither uses nor changes them. Deploy with another --service name (every derived name changes with it, but not the remote repository ghcr or a domain: their lines say what to do), or, only where one is meant for this instance, hand it over as shown: deploy.sh then manages it, and uninstall.sh deletes it with the instance.
This run enabled iam.googleapis.com cloudasset.googleapis.com cloudresourcemanager.googleapis.com; nothing records that yet, so uninstall.sh --disable-apis will not know. If you
give up instead of running deploy.sh again, and nothing else uses them: gcloud services disable iam.googleapis.com cloudasset.googleapis.com cloudresourcemanager.googleapis.com --project=demo-proj-1
```

An Artifact Registry image given in full with `--image` is looked up later: in a run against the same
stand-ins with an image that does not exist, deploy.sh enabled the APIs and created the backend's account
before `image … not found or not readable` stopped it, and named the APIs it had enabled the same way.

What deploy.sh did on Google Cloud, with these settings, is recorded with its transcripts in [self-host.md,
"Verified on"](../self-host.md#verified-on).

## docs/api.md: "Verified on"

**2026-10-11**, on the working tree of that day (macOS 27.0, Node 22): the backend's tests (`pnpm --filter
@gcportrait/backend test`) drive every route above against a pretend Google, and render demo S through the
real `pnpm render` and through the route to the same bytes. The image's bundle, run with `node
backend/dist/server.mjs` (Google's token check answered by a local stand-in for a synthetic token) and asked
with curl, drew demo S overview as the committed golden PNG (`e2e/baselines/render/`) and the renderer's SVG
baseline, byte for byte:

```text
$ curl -s -D - -o demo-s.png -H 'X-Gcportrait-Token: …' --json '{"source":{"kind":"demo","size":"S"}}' http://localhost:8080/api/render
HTTP/1.1 200 OK
content-disposition: attachment; filename="gcportrait_example.com_overview_20261008T000000Z.png"
content-length: 742928
x-gcportrait-view: snapshot=demo:S
x-gcportrait-detail: all
x-gcportrait-scale: 2
x-gcportrait-notice: Not affiliated with Google / Google Cloud.
content-type: image/png
$ cmp demo-s.png e2e/baselines/render/S-overview-auto-light.png && echo identical
identical
```

Since 2026-10-12 the answer has no `x-gcportrait-notice` header: the non-affiliation statement is in footers and
long-form texts only, never with an export ([ADR 0033](../adr/0033-render-api.md), amended); the other headers and the
bytes are as above. The draw.io format (2026-10-12) is verified by the backend's tests: the route answers the
render library's bytes for demo S (`application/vnd.jgraph.mxfile`, the `.drawio` export name, the instance's
version in the file's `agent`), compressed and plain, and the render golden's draw.io file is checked byte for
byte by `pnpm --filter @gcportrait/render-cli test`.

After the route's review the same bundle, with the stand-in also answering Cloud Asset Inventory 5 s late
(ignoring the request's abort), answered the error paths that review fixed: a client that left before Google's
page arrived left the instance running and the next render free; an upload still arriving after 30 s got 408;
a multipart body without a boundary, and one cut short, got 400; a pull with four streams of the token
running got 429 with `Retry-After`:

```text
$ curl -s -m 1 -H 'X-Gcportrait-Token: …' --json '{"source":{"kind":"scope","scope":"folders/…","mode":"user","quotaProject":"…"}}' http://localhost:8080/api/render
(curl gives up after 1 s; the log line says "outcome":"client-gone", /api/healthz and the next render answer 200)
$ curl -s -i --limit-rate 4k -H 'X-Gcportrait-Token: …' -F 'request={"source":{"kind":"ndjson"},"format":"svg"}' -F 'file=@export.ndjson' http://localhost:8080/api/render
HTTP/1.1 408 Request Timeout   (after 30.0 s; "code":"REQUEST_TIMEOUT", logged as "outcome":"REQUEST_TIMEOUT")
$ curl -s -i -H 'X-Gcportrait-Token: …' -H 'Content-Type: multipart/form-data' --data-binary @body.txt http://localhost:8080/api/render
HTTP/1.1 400 Bad Request   ("code":"INVALID_REQUEST"; the same for a body cut short inside its file part)
$ curl -s -i -H 'X-Gcportrait-Token: …' --json '{"source":{"kind":"scope",…}}' http://localhost:8080/api/render
HTTP/1.1 429 Too Many Requests   (retry-after: 30, "code":"STREAMS_BUSY")
```

## docs/website.md: "Verified on 2026-10-11"

The runs below are in the order they were made. All but the last block predate the move of the legal pages to the
maintainer's website ([Legal pages](../website.md#legal-pages)): those runs still built `/impressum/` and `/privacy/` from texts.
All of them predate the licence decision of 2026-10-12 (ADR 0017): `…` stands for the licence identifier they printed.

On macOS with Node 22.23.2, pnpm 10.18.1 and Playwright 1.64.0, whose Chromium (build 1248) reports itself as
HeadlessChrome/156 in the Lighthouse reports:

```text
$ pnpm media                                  # full run: 89 files, both themes
media: done.
$ pnpm media --check
media: building the app in demo mode (out/media/app)
media: docs/media is up to date (inputs fd48349f8cd6, 89 files).

$ pnpm website:build
website: legal texts: Impressum: no impressum.md in …/docs/legal; Privacy: no privacy-notice.md or privacy.md in …/docs/legal.
[build] 16 page(s) built in 1.78s
$ pnpm website:check
website:check: 16 pages OK (metadata, links, anchors, sitemap, self-hosted resources, focusable code blocks, the non-affiliation statement).

$ WEBSITE_STRICT=1 pnpm --filter @gcportrait/website build      # no legal texts: refused
website: legal texts: Impressum: no impressum.md in …/docs/legal; Privacy: no privacy-notice.md or privacy.md in …/docs/legal. A published site needs both texts, filled in (docs/website.md).
(exit 1)

$ pnpm --filter @gcportrait/website test
 Test Files  12 passed (12)
      Tests  73 passed (73)

$ WEBSITE_LEGAL_DIR=…/legal WEBSITE_STRICT=1 pnpm website:build   # example texts
[build] 18 page(s) built in 1.80s
$ pnpm website:check
website:check: 18 pages OK (metadata, links, anchors, sitemap, self-hosted resources, focusable code blocks, the non-affiliation statement).
$ pnpm website:lighthouse
68 runs (columns: performance, accessibility, best practices, SEO); reports in …/out/lighthouse
website:lighthouse: every page meets the thresholds (performance 90, the others 95).
```

The workflow steps and the Firebase Hosting emulator were run earlier the same day, before the code-block, table and
font changes, which touched neither the workflows nor `firebase.json` (so `website:check` still printed its earlier
summary line). The Firebase Hosting fallback itself, its job and its files were removed later the same day, when
everything moved to GitHub ([ADR 0034](../adr/0034-static-demo-on-pages.md)); the transcript stays as the record of
that run:

```text
# pages.yml's build job for a push to main with FIREBASE_DEPLOY=true, its steps run locally: the "Deploy or build
# only" step, then the legal-text step with the secret made by the printf command above from two example texts
pages=false
firebase=true
WEBSITE_STRICT=1
WEBSITE_LEGAL_DIR=…/runner/legal               # the texts came out byte for byte as they went in
$ pnpm run website:build                        # with that environment: strict, legal texts present
[build] 18 page(s) built in 1.84s
$ pnpm run website:check
website:check: 18 pages OK (metadata, links, anchors, sitemap, self-hosted resources, the non-affiliation statement).

# firebase-deploy's input: a directory with only website/firebase.json and .firebaserc, and that build as
# website/dist (the artifact), served by the Hosting emulator with the committed firebase.json
$ pnpm dlx firebase-tools@15.31.0 emulators:exec --only hosting --project demo-gcportrait "bash probe.sh"
✔  hosting[demo-gcportrait]: Local server: http://127.0.0.1:5050
/                  200
/impressum/        200
/privacy/          200
/docs/self-host/   200
/nope/             404
Erika Example                                   # the example Impressum's name, on /impressum/
✔  Script exited successfully (code 0)
$ cd website && pnpm dlx firebase-tools@15.31.0 emulators:start --only hosting --project demo-gcportrait
✔  hosting[demo-gcportrait]: Local server: http://127.0.0.1:5050
                                                # / 200, /impressum/ 200, /coverage/ 200, /nope/ 404
```

The header's GitHub link with its star count ([GitHub repository widget](../website.md#github-repository-widget)), later the same day:

```text
$ pnpm --filter @gcportrait/website test
 Test Files  13 passed (13)
      Tests  112 passed (112)
$ pnpm website:build                                # the repository is not public yet: GitHub answers 404
website: GitHub star count: GitHub answered 404 for florianchrometz/gcportrait (not found or not public yet); the header's GitHub link shows no count.
[build] 18 page(s) built in 1.95s
$ pnpm website:check
website:check: 18 pages OK (metadata, links, anchors, sitemap, self-hosted resources, focusable code blocks, the header's GitHub link, the non-affiliation statement).

$ WEBSITE_STAR_COUNT=1234 pnpm website:build        # the pill: every page's link is "gcportrait on GitHub (1.2k stars)"
[build] 18 page(s) built in 1.70s
$ pnpm website:check
website:check: 18 pages OK (metadata, links, anchors, sitemap, self-hosted resources, focusable code blocks, the header's GitHub link, the non-affiliation statement).
$ cd website && pnpm exec tsx scripts/lighthouse.ts --page /
desktop  light  /                               100 100 100 100
desktop  dark   /                               100 100 100 100
mobile   light  /                                97 100 100 100
mobile   dark   /                                97 100 100 100
website:lighthouse: every page meets the thresholds (performance 90, the others 95).
```

Both builds were also checked with axe-core 4.13.0 (all non-experimental rules) on `/`, `/docs/`, `/coverage/` and
`/404.html` (the build with the count also on `/docs/self-host/` and `/changelog/`), light and dark, at 1440, 400 and
320 pixels wide: no violation, no page scrolling sideways, and no request to another host. At 400 pixels the demo
button and the GitHub link sit side by side under the menu; at 320 the GitHub link moves under the demo button.

The phone pass ([Mobile](../website.md#mobile)), later the same day; WebKit installed once with
`pnpm --filter @gcportrait/website exec playwright install webkit` (WebKit 27.2, Playwright build 2370):

```text
$ pnpm --filter @gcportrait/website test
 Test Files  14 passed (14)
      Tests  122 passed (122)
$ pnpm -s website:build
website: GitHub star count: GitHub answered 404 for florianchrometz/gcportrait (not found or not public yet); the header's GitHub link shows no count.
[build] 18 page(s) built in 2.91s
$ pnpm -s website:check
website:check: 18 pages OK (metadata, links, anchors, sitemap, self-hosted resources, focusable code blocks, the header's GitHub link, the non-affiliation statement, viewport and phone widths).
$ pnpm --filter @gcportrait/website mobile          # 1 min 38 s
layout  light /                            ok
…                                                    # every page of the sitemap and /404.html, light and dark
layout  dark  /404.html                    ok
play    iPhone 15 (WebKit), light, as is: video, video, video, video, video
play    iPhone 15 (WebKit), dark, as is: video, video, video, video, video
play    iPhone 15 (WebKit), light, no WebM (canPlayType says no): gif
play    iPhone 15 (WebKit), light, WebM fails to load: gif
play    iPhone 15 (WebKit), light, WebM never arrives (stalled): gif
play    iPhone 15 (WebKit), light, reduced motion: video
play    Pixel 7 (Chromium), light, as is: video, video, video, video, video
play    Pixel 7 (Chromium), dark, as is: video, video, video, video, video
play    Pixel 7 (Chromium), light, no WebM (canPlayType says no): gif
play    Pixel 7 (Chromium), light, WebM fails to load: gif
play    Pixel 7 (Chromium), light, WebM never arrives (stalled): gif
play    Pixel 7 (Chromium), light, reduced motion: video

website mobile: OK (18 pages at 320, 375, 390, 430 px, light and dark: no sideways scrolling, no overlapping header items, 44-pixel targets, no axe violation; the demos play on the iPhone and the Pixel, pause and play again, and fall back to the GIF).
$ WEBSITE_STAR_COUNT=12345 pnpm -s website:build    # the widest header: "12.3k" in the pill
$ pnpm --filter @gcportrait/website mobile --only layout --page / --page /docs/self-host/ --page /coverage/ --page /404.html
website mobile: OK (4 pages at 320, 375, 390, 430 px, light and dark: no sideways scrolling, no overlapping header items, 44-pixel targets, no axe violation).
$ cd website && pnpm exec tsx scripts/lighthouse.ts --mobile --page / --page /docs/self-host/
mobile   light  /                                98 100 100 100
mobile   light  /docs/self-host/                 99 100 100 100
mobile   dark   /                                97 100 100 100
mobile   dark   /docs/self-host/                 99 100 100 100
website:lighthouse: every page meets the thresholds (performance 90, the others 95).
```

The checks were shown to catch what they look for: on a copy of the build with a 500-pixel-wide element, a 20-pixel
button, an image without alt text and a link laid over the header's wordmark, the layout check reported the sideways
scrolling, the element past the edge, the small target, axe's `image-alt` and the overlapping header items.

The DNS answers of [DNS records](../website.md#dns-records) were looked up earlier the same day (the first run of this guide):

```text
$ dig +short A gcportrait.app
207.207.210.107
207.207.210.229
$ dig +short CNAME www.gcportrait.app
pixie.porkbun.com.
$ dig +short A florianchrometz.github.io
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
$ dig +short AAAA florianchrometz.github.io
2606:50c0:8000::153
2606:50c0:8001::153
2606:50c0:8002::153
2606:50c0:8003::153
$ dig +short CAA gcportrait.app
$ dig +short NS gcportrait.app
curitiba.ns.porkbun.com.
fortaleza.ns.porkbun.com.
maceio.ns.porkbun.com.
salvador.ns.porkbun.com.
```

The "Light and dark" block, the sample exports and the reworked timeline scene, later the same day, on a working tree
where other work in `frontend/` and `packages/demo-data/` was not committed yet (so the media check names the bundle
and the fixtures as changed: `HEAD`'s fixtures hash to the manifest's, the working tree's `M.ndjson` does not):

```text
$ node scripts/media.mjs --only scene:timeline        # both themes; every other GIF and WebM untouched
media: scene timeline (light)
media:   captured 189 screenshots in 7.0 s
media:   GIF: 36 distinct frames, 255 colours, 0.29 MiB
media:   wrote animated/timeline-light.gif (298 KiB)
media:   wrote animated/timeline-light.webm (739 KiB)
media: scene timeline (dark)
media:   GIF: 37 distinct frames, 255 colours, 0.30 MiB
media:   wrote animated/timeline-dark.webm (729 KiB)
$ node scripts/media.mjs --only card:exports --skip-build   # composed from the committed still, no capture
media:   wrote social/exports.jpg (80 KiB)
$ pnpm media --check
media: docs/media is stale; run `pnpm media` and commit the result:
  - the demo app bundle changed (frontend/ or a package it bundles)
  - the demo fixtures changed (packages/demo-data/fixtures)

$ node scripts/exports.mjs
exports: wrote 24 files and the manifest to docs/media/exports (4.51 MiB).
$ node scripts/exports.mjs --check --render          # everything drawn again: byte for byte the same
exports: docs/media/exports is up to date (24 files, 4.51 MiB, rendered again: byte for byte the same).

$ pnpm --filter @gcportrait/website test
 Test Files  16 passed (16)
      Tests  160 passed (160)
$ pnpm -s website:build
[build] 19 page(s) built in 2.41s
$ pnpm -s website:check
website:check: 19 pages OK (metadata, links, anchors, sitemap, self-hosted resources, focusable code blocks, the header's GitHub link, the non-affiliation statement, viewport and phone widths, command variables and Copy buttons, sample exports).
$ pnpm -s website:mobile                              # 1 min 45 s
website mobile: OK (19 pages at 320, 375, 390, 430 px, light and dark: no sideways scrolling, no overlapping header items, 44-pixel targets, no axe violation; the demos play on the iPhone and the Pixel, pause and play again, and fall back to the GIF).
$ cd website && pnpm exec tsx scripts/lighthouse.ts --mobile --page / --page /exports/
mobile   light  /                                97 100 100 100
mobile   light  /exports/                       100 100 100 100
mobile   dark   /                                97 100 100 100
mobile   dark   /exports/                       100 100 100 100
$ cd website && pnpm exec tsx scripts/lighthouse.ts --preset desktop --page / --page /exports/
desktop  light  /                               100 100 100 100
desktop  light  /exports/                       100 100 100 100
desktop  dark   /                               100 100 100 100
desktop  dark   /exports/                       100 100 100 100
```

axe-core 4.13.0 (all non-experimental rules) found no violation on `/`, `/exports/`, `/docs/` and `/docs/export/` at
1440 and 375 pixels in either theme, and a browser on the built site made no request to another host. The new
sections were looked at in screenshots at 1440 and 375 pixels in both themes, and the timeline scene frame by frame
(4, 8, 14 and 25 September in both themes): each stop's markers and legend rows are on screen, and the last one's
ghosted project is the largest change of the loop.

Fillable commands edited in place in every browser, the landing page's commands made fillable, and the timeline
scene's close-ups, later the same day (the working tree again held other uncommitted work in `frontend/` and
`packages/demo-data/`, so the media check names the bundle and the fixtures, as before; the timeline item itself is
current). Firefox installed once with `pnpm --filter @gcportrait/website exec playwright install firefox` (Firefox
157, Playwright build 1555):

```text
$ pnpm --filter @gcportrait/website test
 Test Files  16 passed (16)
      Tests  170 passed (170)
$ pnpm -s website:build
[build] 19 page(s) built in 2.20s
$ pnpm -s website:check
website:check: 19 pages OK (metadata, links, anchors, sitemap, self-hosted resources, focusable code blocks, the header's GitHub link, the non-affiliation statement, viewport and phone widths, command variables and Copy buttons, sample exports).
$ pnpm --filter @gcportrait/website fillable          # 43 s; the full output is in Fillable commands
website fillable: OK (Chromium, Firefox, Firefox (no plaintext-only), WebKit, iPhone 15 (WebKit), Pixel 7 (Chromium) on /docs/self-host/ and /: …).
$ pnpm -s website:mobile --only layout --page /docs/self-host/ --page /
website mobile: OK (2 pages at 320, 375, 390, 430 px, light and dark: no sideways scrolling, no overlapping header items, 44-pixel targets, no axe violation).
$ cd website && pnpm exec tsx scripts/lighthouse.ts --mobile --page /docs/self-host/
mobile   light  /docs/self-host/                 96 100 100 100
mobile   dark   /docs/self-host/                 96 100 100 100
$ node scripts/media.mjs --only scene:timeline        # both themes; every other medium and the shared inputs untouched
media: scene timeline (light)
media:   captured 234 screenshots in 11.6 s
media:   GIF: 68 distinct frames, 255 colours, 1.27 MiB
media:   wrote animated/timeline-light.webm (1701 KiB)
media: scene timeline (dark)
media:   GIF: 70 distinct frames, 255 colours, 1.34 MiB
media:   wrote animated/timeline-dark.webm (1583 KiB)
$ pnpm -s provenance
provenance: OK. 2538 files scanned, 1296 SPDX headers (…) verified; no legacy imports, forbidden names or banned files.
```

The fields were looked at in screenshots, unedited and edited, at 1440 and 375 pixels in both themes and on the
iPhone and the Pixel, and the timeline scene frame by frame in both themes (the last day in full at the poster's
6.2 s, the reporting project's ghost up close, the legend up close at the end, no hover trace on the way).

The sample exports without the affiliation line (ADR 0018's final placement of 2026-10-11), later the same day, after
`pnpm render` had stopped drawing it; the working tree again held other uncommitted work. Every file in
`docs/media/exports/` changed (the title block is one line shorter, so each drawing is 16 units shorter and each PNG
32 pixels), and two runs of the generator gave the same 25 SHA-256 hashes:

```text
$ node scripts/exports.mjs                            # run twice; the hashes of both runs are the same
exports: wrote 24 files and the manifest to docs/media/exports (4.47 MiB).
$ grep -c 'Not affiliated' docs/media/exports/*.svg   # 0 in each of the six SVGs
$ node scripts/exports.mjs --check --render
exports: docs/media/exports is up to date (24 files, 4.47 MiB, rendered again: byte for byte the same).
$ pnpm --filter @gcportrait/website test
 Test Files  16 passed (16)
      Tests  171 passed (171)
$ pnpm -s website:build
[build] 19 page(s) built in 2.18s
$ pnpm -s website:check
website:check: 19 pages OK (metadata, links, anchors, sitemap, self-hosted resources, focusable code blocks, the header's GitHub link, the non-affiliation statement, viewport and phone widths, command variables and Copy buttons, sample exports).
$ pnpm -s website:mobile --only layout --page /exports/ --page /
website mobile: OK (2 pages at 320, 375, 390, 430 px, light and dark: no sideways scrolling, no overlapping header items, 44-pixel targets, no axe violation).
$ pnpm -s provenance
provenance: OK. 2541 files scanned, 1299 SPDX headers (…) verified; no legacy imports, forbidden names or banned files.
```

The previous SVGs, checked with the new rule, fail it (`its title block carries the affiliation line "Not affiliated
with Google / Google Cloud."`, `its <desc> states an affiliation`). `/exports/` and the landing page's teaser were
looked at in screenshots at 1440 pixels in both themes, and S's SVG opened in Chromium in both themes: the title
block's three lines end with the tagline, the `<desc>` ends with "Drawn with gcportrait.", and the long-form
statement is in the footer of both pages.

The live star count ([GitHub repository widget](../website.md#github-repository-widget)), later the same day (the working tree again held other
uncommitted work, which brought a twentieth page). The repository is still private, so GitHub answers 404 to the build
and to the browser:

```text
$ pnpm --filter @gcportrait/website test
 Test Files  17 passed (17)
      Tests  203 passed (203)
$ pnpm -s website:build
website: GitHub star count: GitHub answered 404 for florianchrometz/gcportrait (not found or not public yet); the header's GitHub link shows no count.
[build] 20 page(s) built in 5.07s
$ pnpm -s website:check
website:check: 20 pages OK (metadata, links, anchors, sitemap, self-hosted resources, scripts asking no other host but the star count's, focusable code blocks, the header's GitHub link, the non-affiliation statement, viewport and phone widths, command variables and Copy buttons, sample exports).
$ pnpm -s website:mobile --only layout --page /
website mobile: OK (1 pages at 320, 375, 390, 430 px, light and dark: no sideways scrolling, no overlapping header items, 44-pixel targets, no axe violation).
$ pnpm -s website:mobile --only layout --page / --stars 1301
website mobile: OK (1 pages at 320, 375, 390, 430 px, light and dark: no sideways scrolling, no overlapping header items, 44-pixel targets, no axe violation; GitHub's star answer mocked as 1301).
$ pnpm --filter @gcportrait/website stars --real
stars   the build's header: no count; GitHub's answer here: 1301 ("1.3k")
stars   count 1301, light, 1440 px               kept without a pill (showing "1.3k" would move the header's items); no box changed; reload: 0 request(s)
stars   404, light, 1440 px                      answered after 0.0 s; nothing changed (no count); the note kept; reload: 0 request(s)
stars   403 rate limit, light, 1440 px           answered after 0.0 s; nothing changed (no count); the note kept; reload: 0 request(s)
stars   429, light, 1440 px                      answered after 0.0 s; nothing changed (no count); the note kept; reload: 0 request(s)
stars   500, light, 1440 px                      answered after 0.0 s; nothing changed (no count); the note kept; reload: 0 request(s)
stars   200, not JSON, light, 1440 px            answered after 0.0 s; nothing changed (no count); the note kept; reload: 0 request(s)
stars   200, no number, light, 1440 px           answered after 0.0 s; nothing changed (no count); the note kept; reload: 0 request(s)
stars   slower than 4 s, light, 1440 px          failed after 3.9 s; nothing changed (no count); the note kept; reload: 0 request(s)
stars   no network, light, 1440 px               failed after 0.0 s; nothing changed (no count); the note kept; reload: 0 request(s)
stars   count 1301, light, 768 px                pill added "1.3k"; changed: GitHub link width 107.55→168.66; star pill appeared; reload: 0 request(s)
…                                                         # 390 and 320 px as at 1440 (the failures at 390 only); dark as light
stars   left before the answer, light, 1440 px   1 request(s) in the tab; the note kept
stars   sessionStorage blocked, light, 1440 px   0 request(s); nothing changed
stars   sessionStorage full, light, 1440 px      0 request(s); nothing changed
stars   GitHub itself, light, 1440 px            404, nothing changed, the note kept; reload: 0 request(s); request headers: accept, origin, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, user-agent
website stars: OK (…; GitHub itself asked once).
$ cd website && pnpm exec tsx scripts/lighthouse.ts --page /
desktop  light  /                               100 100  96 100
desktop  dark   /                               100 100  96 100
mobile   light  /                                97 100  96 100
mobile   dark   /                                97 100  96 100
website:lighthouse: every page meets the thresholds (performance 90, the others 95).

$ WEBSITE_STAR_COUNT=1234 pnpm -s website:build     # the pill at first paint: "1.2k"
$ pnpm -s website:check
website:check: 20 pages OK (…).
$ pnpm --filter @gcportrait/website stars
stars   the build's header: "1.2k"; GitHub's answer here: 1300 ("1.3k")
stars   count 1300, light, 1440 px               "1.2k" → "1.3k"; no box changed; reload: 0 request(s)
…                                                         # 768, 390 and 320 px and dark the same
website stars: OK (…).
$ pnpm --filter @gcportrait/website stars --count 2000   # another length, within the pill's room
stars   count 2000, light, 1440 px               "1.2k" → "2k"; no box changed; reload: 0 request(s)
…                                                         # 768, 390 and 320 px and dark the same
website stars: OK (…).
$ WEBSITE_STAR_COUNT=999 pnpm -s website:build
$ pnpm --filter @gcportrait/website stars --count 1000
stars   count 1000, light, 1440 px               "999" → "1k"; no box changed; reload: 0 request(s)
…                                                         # 768, 390 and 320 px and dark the same
$ pnpm --filter @gcportrait/website stars --count 12345  # past the pill's room: shown only where nothing moves
stars   count 12345, light, 1440 px              kept "999" (showing "12.3k" would move the header's items); no box changed; reload: 0 request(s)
stars   count 12345, light, 768 px               "999" → "12.3k"; changed: GitHub link width 168.59→176.61; star pill width 61.05→69.06; reload: 0 request(s)
…                                                         # 390 and 320 px as at 1440; dark as light
$ pnpm -s provenance
provenance: OK. 2577 files scanned, 1330 SPDX headers (…) verified; no legacy imports, forbidden names or banned files.
```

Lighthouse's only failing best-practices audit on `/` is "No browser errors logged to the console", for the line
"Failed to load resource: the server responded with a status of 404 ()"; the layout shift is 0 and the blocking time
0 ms in all four runs. `pnpm -s website:mobile --only playback` and `pnpm --filter @gcportrait/website fillable`
passed as before, with the star request answered by the checks. The same `stars` run on a copy of the build whose
script did not write the note (the behaviour before this round) failed with 76 problems: every failure asked again on
the reload, and with storage blocked or full the page still asked. Copies of the build with a font, a background or
an `@import` from another host in a `<style>` block, a `style` attribute or a built stylesheet, another host in an
`<img>` or `<source>` `srcset`, the star request's `credentials: 'omit'` nested in an inner object, given twice or
followed by a spread, or its address pointed at another host each failed `website:check`; the unchanged copy passed.
A page fetching `https://api.github.com/rate_limit` with `credentials: 'include'` sent the `SameSite=None` probe cookie
the `--real` check sets, and with `credentials: 'omit'` did not, so that check would see a cookie. The script inlined
into every page is 2496 bytes, 1289 gzipped. The header was looked at in screenshots before and after, at 1440, 768,
390 and 320 pixels in both themes, and the pill with 0, 12, 999, 1k, 1.2k and 9.9k in both themes.

The legal pages as links to the maintainer's website, the favicon and the logo from `brand/icon.svg`, and no star
request while the repository is not public, later the same day (the working tree again held other uncommitted work).
GitHub still answers 404 for the repository:

```text
$ pnpm --filter @gcportrait/website test
 Test Files  17 passed (17)
      Tests  215 passed (215)
$ pnpm -s website:build
website: GitHub star count: GitHub answered 404 for florianchrometz/gcportrait (not found or not public yet); the header's GitHub link shows no count, and visitors' browsers will not ask GitHub for one.
website: docs/author.md still holds placeholders: [JOB TITLE], [LINKEDIN PROFILE URL], [GITHUB PROFILE URL], [X PROFILE URL], [BIO PARAGRAPH]
[build] 18 page(s) built in 2.06s
$ pnpm -s website:check
website:check: 18 pages OK (metadata, links, anchors, sitemap, self-hosted resources, scripts asking no other host but the star count's, focusable code blocks, the header's GitHub link, the non-affiliation statement, the footer's legal links and no legal page of its own, the favicon and the logo from brand/icon.svg, viewport and phone widths, command variables and Copy buttons, sample exports).
$ cmp website/dist/favicon.svg brand/icon.svg          # the same file
$ pnpm --filter @gcportrait/website stars             # 49 s
stars   the build's header: no count, and GitHub told the build the repository is not public (data-stars-not-public): the page must ask nothing
stars   not public (the build), light, 1440 px   0 request(s), also on a reload; nothing changed; sessionStorage untouched
…                                                         # 768, 390 and 320 px, and dark, the same
website stars: OK (/ at 1440, 768, 390, 320 px, light and dark, built while GitHub answers 404: the page asks GitHub nothing, also on a reload, keeps nothing and changes nothing; nothing logged; no axe violation). The live count's other cases need a build that did not see the 404: WEBSITE_STAR_COUNT=1234 pnpm website:build.
$ cd website && pnpm exec tsx scripts/lighthouse.ts --page /
desktop  light  /                               100 100 100 100
desktop  dark   /                               100 100 100 100
mobile   light  /                                97 100 100 100
mobile   dark   /                                97 100 100 100
website:lighthouse: every page meets the thresholds (performance 90, the others 95).
$ pnpm -s website:mobile                              # 1 min 49 s
website mobile: OK (18 pages at 320, 375, 390, 430 px, light and dark: no sideways scrolling, no overlapping header items, 44-pixel targets, no axe violation; the demos play on the iPhone and the Pixel, pause and play again, and fall back to the GIF).

$ WEBSITE_STAR_COUNT=1234 pnpm -s website:build       # the browser asks: every case of the live count
$ pnpm -s website:check
website:check: 18 pages OK (…).
$ pnpm --filter @gcportrait/website stars             # 3 min 18 s, 52 cases
stars   the build's header: "1.2k"; GitHub's answer here: 1300 ("1.3k")
stars   count 1300, light, 1440 px               "1.2k" → "1.3k"; no box changed; reload: 0 request(s)
…
stars   not public (marked here), light, 1440 px 0 request(s), also on a reload; nothing changed; sessionStorage untouched
stars   not public (marked here), light, 390 px  0 request(s), also on a reload; nothing changed; sessionStorage untouched
stars   not public (marked here), dark, 1440 px  0 request(s), also on a reload; nothing changed; sessionStorage untouched
stars   not public (marked here), dark, 390 px   0 request(s), also on a reload; nothing changed; sessionStorage untouched
website stars: OK (/ at 1440, 768, 390, 320 px, light and dark: asked at most once after load, anonymous; the count shown without a layout shift, or not at all; kept for the hour; 404, 403 rate limit, 429, 500, 200, not JSON, 200, no number, slower than 4 s, no network: nothing changes and the tab asks nothing more within the hour; leaving before the answer, storage blocked or full: no further request; the repository not public to the build (marked here, at 1440 and 390 px): no request at all; nothing logged; no axe violation).
```

The footer was then looked at in screenshots at 1440 and 375 pixels in both themes, and the white space between each
label and its arrow, which the first build underlined, was taken out of the markup; the rebuilt site passed
`website:check` again and `pnpm -s website:mobile --only layout` ("18 pages at 320, 375, 390, 430 px, light and dark:
… 44-pixel targets, no axe violation"). Each legal link is 44 pixels high at 375 and its name reads "Impressum
(external site, florian-chrometz.de)" and "Privacy (external site, florian-chrometz.de)". The checks were shown to
catch what they look for: on a copy of the build with the privacy link's `rel` removed on one page, a colour of the
favicon changed, a logo with another tint and an `/impressum/` page added, `website:check` reported each of the four;
on a copy whose script ignored `data-stars-not-public`, `stars` reported the request, the fetch, the note in
sessionStorage and the request after the reload at every width. Lighthouse's best practices on `/` is 100 again: the
page makes no request that fails.

The static demo at `/demo/` ([The demo](../website.md#the-demo), ADR 0034), the same evening, on the working tree of that change
(`git describe`: `ea7ffe2-dirty`):

```text
$ pnpm demo:static
demo:static: built dist/demo for /demo/ in 1 s: version ea7ffe2-dirty, Impressum https://florian-chrometz.de/legal/impressum, privacy notice https://florian-chrometz.de/legal/privacy-policy, index.html and a copy for /diagram, /snapshots, /permissions, /settings, /impressum, /privacy, the policy <meta> checked.
$ node scripts/check-bundle-size.mjs --dist dist/demo       # the sign-in code is left out
size-budget: OK. UI thread 227.84 kB of 350.00 kB (65.1%); workers 197.15 kB of 400.00 kB (49.3%) (gzipped).
$ pnpm size                                                  # the image's app, for comparison
size-budget: OK. UI thread 230.62 kB of 350.00 kB (65.9%); workers 197.14 kB of 400.00 kB (49.3%) (gzipped).
$ grep -c "accounts.google.com\|oauth2.googleapis.com\|/api/config" dist/demo/assets/index-*.js
0
$ WEBSITE_DEMO_DIST=dist/demo pnpm website:build
[gcportrait:static-demo] the static demo from dist/demo is at /demo/
[build] 18 page(s) built in 2.45s
$ pnpm website:check
website:check: 18 pages OK (…; the demo at /demo/: its pages, policy, favicon and links).
$ pnpm --filter @gcportrait/website demo                    # 7 s
demo: light, Connect page: OK
demo: light, Try the demo S: OK
demo: light, Try the demo M: OK
demo: light, Try the demo L: OK
demo: light, drill in, timeline, export, reload: OK
demo: light, routes: OK
demo: dark, Connect page: OK
demo: dark, Try the demo M: OK
demo: dark, drill in, timeline, export, reload: OK
demo: dark, routes: OK
demo: /demo/ works from the built site served statically (light and dark: Connect page, S/M/L, drill-in, timeline, PNG and SVG export, reload on a deep link, every route, 404; axe, no CSP violation, no request elsewhere).
$ pnpm -s website:mobile --only layout                       # the demo left out: desktop-only
website mobile: OK (18 pages at 320, 375, 390, 430 px, light and dark: no sideways scrolling, no overlapping header items, 44-pixel targets, no axe violation).
```

The policy was seen at work: the first version of the browser check added axe-core as an inline `<script>`, and the
demo's policy refused it ("Executing inline script violates the following Content Security Policy directive
'script-src 'self' 'sha256-…''"), which the check reported as a violation; it now evaluates axe-core through the
browser's DevTools protocol. Screenshots of the Connect page in both themes and of demo S, M (light, dark, drilled in)
and L were looked at. `pnpm build` (which builds the demo inside the website's build), `pnpm e2e` (208 passed) and the
steps of `pnpm check` passed on the same tree.

## docs/website.md: "Lighthouse" (the scores of the runs)

The run of 2026-10-11 is below. It also covered `/impressum/` and `/privacy/`, built then from example texts: 100 in
every column; the site has no such pages since ([Legal pages](../website.md#legal-pages)).

With the first version of the live star count ([GitHub repository widget](../website.md#github-repository-widget)), each run's browser asked
GitHub for the count once the page had loaded; while the repository is private GitHub answered 404, Chrome logged it
in the console, and Lighthouse's "No browser errors logged to the console" failed: best practices 96 instead of 100.
Since the build marks a repository GitHub says is not public, the page asks nothing then, and best practices is 100
again (measured on `/`, in both themes, desktop and mobile). The
tables below were run before the live count.

Each cell: performance · accessibility · best practices · SEO.

| Page | Desktop, light | Desktop, dark | Mobile, light | Mobile, dark |
|---|---|---|---|---|
| `/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 97 · 100 · 100 · 100 | 97 · 100 · 100 · 100 |
| `/docs/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 |
| `/docs/getting-started/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 |
| `/docs/modes/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 |
| `/docs/permissions/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 99 · 100 · 100 · 100 | 99 · 100 · 100 · 100 |
| `/docs/lenses-and-filters/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 99 · 100 · 100 · 100 | 99 · 100 · 100 · 100 |
| `/docs/timeline/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 |
| `/docs/export/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 |
| `/docs/faq/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 |
| `/docs/self-host/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 99 · 100 · 100 · 100 | 99 · 100 · 100 · 100 |
| `/docs/configuration/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 99 · 100 · 100 · 100 | 99 · 100 · 100 · 100 |
| `/coverage/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 96 · 100 · 100 · 100 | 96 · 100 · 100 · 100 |
| `/changelog/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 |
| `/contributing/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 |
| `/licence/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 |

The lowest scores are performance 96 for `/coverage/` on mobile (first paint 2.0 s and largest paint 2.6 s: the
page lists all 632 types, and its HTML was served uncompressed by the local server, where GitHub Pages compresses it)
and 97 for `/` on mobile (the hero's poster frame is the largest paint, 2.6 s); everything else is 99 or more, and
accessibility, best practices and SEO are 100 on every page in both themes. This is the fourth run of the day, of
the site with focusable code blocks, the reworked tables and the preloaded fonts (before the preloads, the web fonts
arriving reflowed the tables of `/docs/configuration/`: a layout shift of 0.107 and performance 97 on desktop).

After the phone pass ([Mobile](../website.md#mobile)), on the build without a star count (the repository answers 404 today), with
`pnpm website:lighthouse --mobile --page / --page /docs/self-host/` and the same with `--preset desktop`:

| Page | Desktop, light | Desktop, dark | Mobile, light | Mobile, dark |
|---|---|---|---|---|
| `/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 98 · 100 · 100 · 100 | 97 · 100 · 100 · 100 |
| `/docs/self-host/` | 100 · 100 · 100 · 100 | 100 · 100 · 100 · 100 | 99 · 100 · 100 · 100 | 99 · 100 · 100 · 100 |

On mobile the landing page's largest paint is now the hero's lead paragraph (2.5 s under Lighthouse's throttling;
first paint 1.2 s, no layout shift, no blocking time): the shorter phone header leaves the hero's demo just below the
first screen.

## docs/website.md: dated notes, machine notes and timings

The passages of the website guide that recorded when and why something changed, what a run measured or on which
machine, removed from the guide on 2026-10-12 as written, each under the section it stood in. Where the guide keeps
an instruction from a passage, it now says it without the record.

### Mobile, its first paragraph

> The website serves phones as well as desktops (maintainer decision of 2026-10-11). The app itself

### Mobile, "Docs"

> so the guide starts on a phone's first screen. Before, the menu stayed in view while scrolling and covered
> the guide's text on phones.

### Mobile, "Desktop is almost unchanged"

> - **Desktop is almost unchanged.** Every page at 1440×900 in both themes was compared pixel by pixel with the
> build before this change (the moving demos hidden). Two things differ: the landing page's four feature stills,
> by resampling only (a mean of 6 of 255 on the changed pixels; their `sizes` now names the width they are shown
> at, 33.5rem instead of 42rem, and the browser picks the same 720 or 1440 pixel file as before), and the shaded
> scroll edge, which now also shows on the desktop tables that already overflowed their column (the modes and
> permissions guides at 1440 px, the configuration reference at 1024 px).

### Media on phones, "Stills"

> There is no 480-pixel size: a picture 340 CSS pixels wide needs 680 to 1020 device pixels on today's 2× and 3×
> phones, so a 480 file would serve only 1× screens; and a new size changes the media list, an input of the
> staleness hash, so `pnpm media --check` would stay stale until a full run, which also rewrites the GIFs and WebMs
> (about 10 MB, and not byte-reproducible). Lighthouse's mobile performance is above 90 without it.

### Mobile, "Checks"

> never GitHub: with a 404, as GitHub answers for the private repository today, so nothing changes;

### Fillable commands, its first paragraph

> then copy the command ready to run (maintainer's request of 2026-10-11). Every occurrence of a variable on a page shows
> one value: filled once, in any command or in the page's Variables panel, it is filled everywhere. A second request the
> same day, after the first version went live ("the variables should also be editable in the command itself to avoid
> having users to scroll up"), found that typing into a command did nothing in Safari and on iPhones, and that nothing
> showed the values could be edited there; both are fixed (below, "Editing in place").

### Fillable commands, "The script"

> - **The script** (`website/src/lib/fillable-page.ts`, one file of 8.4 kB, 3.1 kB gzipped, loaded only by pages with
> code) turns

### Fillable commands, "The token is selected, never removed by the script"

> Backspace, it shows the token as its placeholder (italic). The first version emptied the field on focus instead:
> WebKit (Safari on a Mac, every browser on an iPhone) cannot keep the caret in an inline editable element whose text
> a script removed, so what the visitor typed went nowhere and the values could only be set in the panel.

### Fillable commands, "Checks"

> webkit firefox`; the check gives Firefox a throwaway application-data directory (`MOZ_APP_DATA`), so it never touches
> a Firefox profile of the user's (on the maintainer's macOS 27 Playwright's Firefox does not start without it: "Could
> not find profile folder"). Run against the first version's script, the check fails on WebKit exactly as reported:
> "typing into the field of YOUR_PROJECT gave "", not "demo-gcportrait"".

### Fillable commands, after "Checks": the run of the check

```text
$ pnpm --filter @gcportrait/website fillable          # 43 s
fillable Chromium /docs/self-host/ 1440 px light                  ok
fillable Chromium /docs/self-host/ 1440 px dark                   ok
fillable Chromium /docs/self-host/ 375 px light                   ok
fillable Chromium /docs/self-host/ 375 px dark                    ok
fillable Chromium / 1440 px light                                 ok (no variable in two code blocks: YOUR_PROJECT's 2 field(s) checked)
fillable Chromium / 1440 px dark                                  ok (no variable in two code blocks: YOUR_PROJECT's 2 field(s) checked)
fillable Chromium / 375 px light                                  ok (no variable in two code blocks: YOUR_PROJECT's 2 field(s) checked)
fillable Chromium / 375 px dark                                   ok (no variable in two code blocks: YOUR_PROJECT's 2 field(s) checked)
fillable Chromium /docs/getting-started/                          ok
fillable Firefox /docs/self-host/ 1440 px light                   ok
fillable Firefox /docs/self-host/ 1440 px dark                    ok
fillable Firefox / 1440 px light                                  ok (no variable in two code blocks: YOUR_PROJECT's 2 field(s) checked)
fillable Firefox / 1440 px dark                                   ok (no variable in two code blocks: YOUR_PROJECT's 2 field(s) checked)
fillable Firefox (no plaintext-only) /docs/self-host/ 1440 px light ok
fillable Firefox (no plaintext-only) /docs/self-host/ 1440 px dark ok
fillable Firefox (no plaintext-only) / 1440 px light              ok (no variable in two code blocks: YOUR_PROJECT's 2 field(s) checked)
fillable Firefox (no plaintext-only) / 1440 px dark               ok (no variable in two code blocks: YOUR_PROJECT's 2 field(s) checked)
fillable WebKit /docs/self-host/ 1440 px light                    ok
fillable WebKit /docs/self-host/ 1440 px dark                     ok
fillable WebKit / 1440 px light                                   ok (no variable in two code blocks: YOUR_PROJECT's 2 field(s) checked)
fillable WebKit / 1440 px dark                                    ok (no variable in two code blocks: YOUR_PROJECT's 2 field(s) checked)
fillable iPhone 15 (WebKit) /docs/self-host/ device light         ok
fillable iPhone 15 (WebKit) /docs/self-host/ device dark          ok
fillable iPhone 15 (WebKit) / device light                        ok (no variable in two code blocks: YOUR_PROJECT's 2 field(s) checked)
fillable iPhone 15 (WebKit) / device dark                         ok (no variable in two code blocks: YOUR_PROJECT's 2 field(s) checked)
fillable Pixel 7 (Chromium) /docs/self-host/ device light         ok
fillable Pixel 7 (Chromium) /docs/self-host/ device dark          ok
fillable Pixel 7 (Chromium) / device light                        ok (no variable in two code blocks: YOUR_PROJECT's 2 field(s) checked)
fillable Pixel 7 (Chromium) / device dark                         ok (no variable in two code blocks: YOUR_PROJECT's 2 field(s) checked)
client script: 8441 bytes, 3128 gzipped (_astro/Variables.astro_astro_type_script_index_0_lang.Bsgl0nSl.js)
website fillable: OK (Chromium, Firefox, Firefox (no plaintext-only), WebKit, iPhone 15 (WebKit), Pixel 7 (Chromium) on /docs/self-host/ and /: edit marks and hint; tap targets; fields selected, typed over, in step with the panel and each other; pastes as plain text; Copy; format hints; storage, secrets and Clear values; no JavaScript, no shift at start, axe at 1440 and 375 px, light and dark).
```

### Generated media, the hero

> The hero shows demo S rather than demo M's overview, which the first design named for it: fitted to 1440×900, M's
> overview shows only its folders and collapsed projects (38 of 369 items, with no resource, network or product icon),
> so the hero shows the whole of the smaller demo S instead, where every zone, the Shared VPC, the title block and the
> legend are visible. The maintainer may choose otherwise (its entry in `media.json` and `scripts/media.mjs`). The
> landing page's

### Generated media, "The timeline scene" (its origin)

> **The timeline scene** (maintainer request of 2026-10-11) shows big changes

### Generated media, "The timeline scene" (the close-ups)

> up close (follow-up of the same day's review): four wheel notches

### Generated media, "The timeline scene" (its length)

> the scene is 12 s (before: 9.5 s without the
> close-ups; first: 9 s, one drag from 23 to 24 September in demo M, then a zoom onto the web group's scale-out). The
> close-ups redraw

### Generated media, "Staleness" (the bundle on Linux)

> The bundle hash is the same for every build of the same sources on one machine; whether a Linux runner
> produces the identical bundle has not been verified yet. If CI reports the bundle as changed right after a full run on
> macOS, regenerate on Linux (or in CI) instead.

### Generated media, after "Staleness" (left unfinished there)

> The fingerprints were introduced on 2026-10-11 without a full run: the manifest of the full run of that morning was
> stamped with the fingerprint of every item whose capture code had not changed since (all but the timeline scene) and
> with the new shared script hash, after checking that `scripts/media.mjs` differed from that run's only in the hashing,
> the `--only` syntax, the cards' still and the timeline scene; then the timeline scene and the `exports` card were

### Sample exports, its first paragraph (its origin)

> The site offers real exports to download (maintainer request of 2026-10-11; draw.io files since 2026-10-12, ADR
> 0036): SVG, PNG

### Sample exports, its first paragraph (the placement)

> Like every drawing since the final placement of 2026-10-11
> ([ADR 0018](../adr/0018-non-affiliation-statement.md)), no file

### Sample exports, "--check"

> the set is over 6 MiB. The manifest records no affiliation line since 2026-10-11 (it had a `disclaimer` field while
> the files carried the line). A change

### GitHub repository widget, its first paragraph

> The
> facts have two layers (decision of 2026-10-11 for the star count, extended to the forks and the version on
> 2026-10-12: live, as on other projects' sites, not values that wait for a redeploy):

### GitHub repository widget, "The live facts"

> builds into one file that every page shares, about 4.1 kB, 1.9 kB gzipped) waits

### GitHub repository widget, "Fallback"

> on a 404 (the repository is private or not published yet, which is today's answer), on an answer

### DNS records, its first paragraph

> At the registrar of `gcportrait.app` (its name servers are Porkbun's). On 2026-10-11 the apex and every subdomain
> still answer with the registrar's parking (`gcportrait.app` A `207.207.210.107` and `207.207.210.229`, a
> wildcard `*.gcportrait.app` CNAME `pixie.porkbun.com`): delete the apex parking record (an ALIAS or A record
> pointing at the parking host).

### DNS records, after the zone

> The A and AAAA addresses are the ones GitHub publishes; on 2026-10-11 `florianchrometz.github.io` resolved to
> exactly these (`dig +short A florianchrometz.github.io`, `dig +short AAAA florianchrometz.github.io`). If the
> repository moves

### DNS records, CAA

> If the zone has CAA records, one must allow
> `letsencrypt.org`; on 2026-10-11 it has none.

### DNS records, the earlier demo host

> Until 2026-10-11 the demo was planned at `demo.gcportrait.app`, a Cloud Run domain mapping with a CNAME to
> `ghs.googlehosted.com.` and Google's `google-site-verification` TXT record on the apex (ADR 0032). The demo is now the
> static build at `/demo/` (ADR 0034): if those two records exist, delete them once the Cloud Run demo is removed
> ([Deploying to GitHub Pages](../website.md#deploying-to-github-pages), step 8).

### Legal pages, its first paragraph

> their own website, and the footer of every page links them (decision of 2026-10-11, ADR 0032 as amended):

### Legal pages, its last paragraph

> Until 2026-10-11 the site built `/impressum/` and `/privacy/` from texts in a `WEBSITE_LEGAL_BUNDLE` secret; that
> secret, the `WEBSITE_LEGAL_DIR` variable, the two pages, their link-preview images and the drafts in `docs/legal/`
> are gone. A secret of that name left in the repository's settings is no longer read and can be deleted.

## docs/legal/README.md: "Verified on 2026-10-11"

On macOS with Node 22.23.2, against the working tree of the change that made the legal pages links: the website's
build has no `/impressum/` and no `/privacy/` and links both addresses above in the footer of each of its 18 pages
(`pnpm website:check`); the backend reports `LEGAL_IMPRESSUM_URL` and `LEGAL_PRIVACY_URL` in `/api/config` and refuses
a page linked and served at once (`pnpm --filter @gcportrait/backend test`); `infra/deploy.sh --impressum-url` and
`--privacy-url` were run against the stand-ins of `scripts/infra.test.ts` (`pnpm test:infra`). The transcripts are
in the [verification records](2026-10-12-guide-verification-records.md) of the website guide and of the
self-hosting guide's legal pages. Not checked: the maintainer's pages themselves and the providers' real log
settings.
