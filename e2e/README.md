<!-- SPDX-License-Identifier: MIT -->

# @gcportrait/e2e

End-to-end and accessibility (axe) tests with Playwright, and the diagram's visual baselines (`baselines/`).
The tests run against the app in demo mode and normal (live) mode with stand-ins for external services,
so they need no Google Cloud access or separately running backend. They drive the app through the browser
and never import it. They run under Playwright, not Vitest.

## Running

```sh
pnpm --filter @gcportrait/e2e install-browsers   # once per machine: Playwright's Chromium
pnpm e2e                                          # from the repository root
```

The diagram's visual baselines are not Playwright screenshots (CI runs on Linux; screenshots taken on another
platform never match). They are the renderer's SVG text,
`baselines/diagram/<fixture>-<lens>-<detail>-<theme>.svg`: demo S, M and L at detail `auto` and M at `all`, ×
overview, networking and load-balancing, × light and dark (24 files). The frontend's unit tests write and
compare them (`frontend/src/diagram/baselines.test.tsx`); update them only for an intended visual change, look
at the changed SVGs, and say why in the pull request:

```sh
pnpm --filter @gcportrait/frontend test src/diagram/baselines.test.tsx -u   # the file before -u
```

`baselines/render/` holds the render goldens, `S-overview-auto-light.png` and `S-overview-auto-light.drawio`:
exactly what `pnpm render --fixture S --lens overview` writes, compared tolerance-free by the headless
renderer's tests ([`packages/render-cli`](../packages/render-cli/README.md); its README next to the file says
how to update it). A person reviews a render against the style skill's fact-check list (gcp-diagram-style §11)
and the layout skill's checks (gcp-diagram-layout §8).

[playwright.config.ts](playwright.config.ts) defines the projects and their servers, spec patterns, tags
and device settings (`projects`, `LIVE_SPECS`, `MOBILE_SPECS`, `PHONE`, `TABLET` and `VIEWPORT`). The
`mobile` project's [mobile.spec.ts](tests/mobile.spec.ts) also opens normal-mode pages for live-instance
checks; its demo base URL does not limit those checks. `pnpm --filter @gcportrait/frontend mobile` runs
that project alone, including [touch.spec.ts](tests/touch.spec.ts).

Locally the two servers are Vite dev servers, started by `scripts/built-app.ts --dev`. Each server gets a
private temporary dependency cache through `GCPORTRAIT_VITE_CACHE_DIR`: simultaneous runs of one checkout
do not share it, at the cost of cold dependency optimisation on each start. The wrapper removes only its
own directory after Vite exits, including a failed start or SIGTERM/SIGINT shutdown; SIGKILL or a host crash
can leave temporary files behind. A server reused by URL keeps its own cache, and ordinary `pnpm dev` and
`pnpm dev:demo` keep their per-mode caches. On CI
(`CI` set) they are the app as it ships: `scripts/built-app.ts` builds the frontend in its mode (`VITE_DEMO=1`
for demo mode) into a new temporary directory and serves the build with `vite preview`, which takes the dev
server's `/api` proxy from `frontend/vite.config.ts`, until Playwright stops it and the directory is removed.
Every test opens a fresh browser context, so every page load is cold; the build answers one with a few chunks
where the dev server serves every module on its own, and the suite tests the bundle that ships. The build
leaves out only what React's development build adds: StrictMode runs every effect twice under the dev server,
which a local run exercises and CI's does not (the app reads no `import.meta.env.DEV`); the frontend's unit
tests mount under StrictMode on every run (`frontend/README.md`, "Scripts"). `CI=true pnpm e2e` runs the suite
as CI does (the built servers, two retries with a trace of the first, the HTML report).

Every run starts its own two servers, on ports of its own: when Playwright's runner loads the config,
`fixtures/servers.ts` has the system pick two free ports and names the servers' URLs in `E2E_DEMO_URL` and
`E2E_LIVE_URL`, which the run's workers and the servers' commands inherit (Vite's `--port`, with the
`strictPort` of `frontend/vite.config.ts`, so a port taken meanwhile fails the start). Two runs, of one
checkout or of two, therefore never meet, and a dev server another checkout left on 5173 or 5174 (where
`pnpm dev` and `pnpm dev:demo` serve the app for people) is never tested in this checkout's place; something
that answers on a port the run picked fails the run ("is already used"). To run specs against a dev server of
your own, with its hot reload, name its URL: a local run then reuses the server that answers there, whichever
checkout started it, and starts the mode's server on that port when nothing does. CI never reuses a server.
If a picked port becomes occupied, rerun to pick new ports or stop the conflicting server. Playwright's
"set reuseExistingServer:true" advice does not apply to picked ports or CI: their refusal protects the
checkout being tested. A free-port probe cannot reserve a port until Vite starts; `strictPort` still refuses
a later collision. Playwright checks an already-used URL before starting either the server command or global
setup, so a check in either would not replace that message.
The suite's `scripts/server-advice-reporter.ts` adds the applicable advice on stderr for that refusal, leaving
Playwright's error, reports and failed exit status unchanged. An explicit `--reporter` replaces the config's
reporters and therefore omits this extra advice (`leg --list-only` uses JSON listings that start no servers).

```sh
E2E_DEMO_URL=http://localhost:5174 pnpm e2e tests/keyboard.spec.ts --project chromium   # your pnpm dev:demo
```

The live project needs no running backend: its specs answer `GET /api/config` inside the browser
(`fixtures/live.ts`), and the signed-in ones also answer Google's sign-in script and tokeninfo
(`fixtures/gis.ts`), so nothing reaches Google. `sa-mode.spec.ts` and `demo-only.spec.ts` start the backend
itself (`fixtures/harness.ts`), the first with a pretend Google inside it, so nothing reaches Google there
either. The normal-mode server proxies `/api` to a backend on port 8080 that the suite never starts, so
every spec that opens it (the live specs, and `mobile.spec.ts` for a live instance's pages) takes its `test`
from `fixtures/live.ts`: an `/api` request to that server that none of the test's own routes answers gets a
503 in the browser that names it, and fails the test at its end. The proxy is never reached, and the run's
output carries no proxy error. Helpers the specs share are in `tests/support.ts` (among them the drawn
canvas's selector `DRAWN_CANVAS`, `viewParam` for a value of the view in the address, `demoCaiExport` for a
demo organisation as a Cloud Asset Inventory export, generated once per worker, and `exportOperation` for an
export's `operation.json`), `tests/handheldSupport.ts` (for `mobile.spec.ts` and `handheld.spec.ts`: the
44-pixel target, where the tablet's layout starts, and the top bar's View and More folds),
`tests/touchSupport.ts` (for `touch.spec.ts` and `mobile.spec.ts`: `Fingers`, drags, pinches and
presses through the DevTools Protocol, which Playwright's taps cannot do),
`tests/timelineSupport.ts`, `tests/consoleSupport.ts`, `tests/permissionsSupport.ts`,
[tests/exportSupport.ts](tests/exportSupport.ts) and [tests/drawioSupport.ts](tests/drawioSupport.ts).
`stubGoogle` (`fixtures/gis.ts`) hands out a test's tokens for an hour with every scope sign-in asks for
unless the test says otherwise. Chromium only for now; the functional specs at a desktop window of 1440×900,
`mobile.spec.ts` at phone and tablet sizes, `touch.spec.ts` at a phone's and `handheld.spec.ts` at the phone's
and the tablet's projects' sizes; light colour scheme unless a test asks for dark.
`pnpm e2e --project chromium-phone --project chromium-tablet` runs the two handheld projects alone.

The header of [scripts/leg.ts](scripts/leg.ts) describes the round-robin selection, exact-share checks and
timing summaries. The policy is [e2e/AGENTS.md](AGENTS.md), "CI legs"; the jobs follow
[.github/AGENTS.md](../.github/AGENTS.md), "CI". Run a leg locally, print its share or pass options to
Playwright:

```sh
CI=true pnpm --filter @gcportrait/e2e leg --projects "chromium-live chromium" --leg 2 --of 3   # e2e (desktop 2/3)
CI=true pnpm --filter @gcportrait/e2e leg --projects '!chromium-live !chromium' --leg 1 --of 2   # e2e (phones and tablets 1/2)
pnpm --filter @gcportrait/e2e leg --projects "chromium-live chromium" --leg 2 --of 3 --list-only > /tmp/leg.txt
pnpm --filter @gcportrait/e2e exec playwright test --test-list /tmp/leg.txt   # the same share, by hand
pnpm --filter @gcportrait/e2e leg --projects "chromium-phone chromium-tablet" --leg 1 --of 2 -- --headed
```

The script's header and `--help` explain `--list-only` output and validation, project negation and
forwarded arguments. Options that filter the share cause the leg's exact-share check to fail.

Wait for the state a step needs, never for a time. The helper JSDoc explains which wait to use:
[tests/support.ts](tests/support.ts) for `openDiagram`, `drawnCanvas`, `drawingOf`, `redrawnCanvas` and
`cameraSettled`; [tests/timelineSupport.ts](tests/timelineSupport.ts) for `expectDrawn`; and
[tests/controls.spec.ts](tests/controls.spec.ts) for `pipelineIdle` after a series of view changes.

## Specs

This is an index; each linked spec's headers and assertions describe its coverage. The Demo column names
the build mode: yes uses the demo server, no the normal-mode server, and both uses each. Normal-mode
tests use browser stand-ins or backend harnesses as described under Running; the demo-only instance uses
the normal-mode build.

| Spec | Demo | Area |
|---|---|---|
| [shell](tests/shell.spec.ts) | yes | Shell, branding and navigation |
| [theme](tests/theme.spec.ts) | yes | Theme choice and restoration |
| [navigation](tests/navigation.spec.ts) | yes | View links and browser history |
| [a11y](tests/a11y.spec.ts) | yes | Page and diagram accessibility |
| [keyboard](tests/keyboard.spec.ts) | yes | Keyboard navigation and focus |
| [diagram](tests/diagram.spec.ts) | yes | Drawing and pointer interaction |
| [trace](tests/trace.spec.ts) | yes | Selection and hover traces |
| [console-link](tests/console-link.spec.ts) | yes | Cloud Console links |
| [controls](tests/controls.spec.ts) | yes | View controls and saved views |
| [drawer](tests/drawer.spec.ts) | yes | Details, jumps and drill-in |
| [disclosure](tests/disclosure.spec.ts) | yes | Expand and collapse |
| [search](tests/search.spec.ts) | yes | Search and reveal |
| [export](tests/export.spec.ts) | yes | SVG and PNG exports |
| [drawio](tests/drawio.spec.ts) | yes | draw.io fidelity |
| [large-snapshot](tests/large-snapshot.spec.ts) | yes | Large-snapshot confirmation |
| [snapshots](tests/snapshots.spec.ts) | yes | Snapshot storage and files |
| [timeline](tests/timeline.spec.ts) | yes | Day selection and playback |
| [diff](tests/diff.spec.ts) | yes | Changes between days |
| [extra-ticks](tests/extra-ticks.spec.ts) | yes | Imported timeline ticks |
| [live](tests/live.spec.ts) | no | Configuration and legal links |
| [permissions-variables](tests/permissions-variables.spec.ts) | no | Command fields |
| [permissions-variables-demo](tests/permissions-variables-demo.spec.ts) | yes | Command fields |
| [signin](tests/signin.spec.ts) | no | Sign-in and token lifecycle |
| [preflight](tests/preflight.spec.ts) | no | Scope and permission checks |
| [live-pull](tests/live-pull.spec.ts) | no | Pulls and export imports |
| [sa-mode](tests/sa-mode.spec.ts) | no | Service-account gate |
| [demo-only](tests/demo-only.spec.ts) | no | Demo-only backend mode |
| [mobile](tests/mobile.spec.ts) | both | Phone and tablet layout |
| [touch](tests/touch.spec.ts) | yes | Canvas touch gestures |
| [handheld](tests/handheld.spec.ts) | yes | App flows by finger |
| [minimum-viewport](tests/minimum-viewport.spec.ts) | yes | Smallest desktop layout |

Test output goes to `test-results/` (and `playwright-report/` on CI). Both are git-ignored. A failed test
leaves its trace in `test-results/` (`pnpm --filter @gcportrait/e2e exec playwright show-trace FILE` opens
it). A local run records a trace for every test and keeps a failed test's (`retain-on-failure`). On CI only a
test's first retry records one (`on-first-retry`), as a trace holds a snapshot of the page at every action: a
test that passes at once records none, and a test that failed has the trace of its first retry.

Export downloads, resvg and maxGraph renders, and diff images go to `out/export/e2e/` (git-ignored;
`OUT_DIR` in [tests/exportSupport.ts](tests/exportSupport.ts)).

Screenshots for a person to look at, which no test compares, are taken only when asked for: with
`E2E_SHOTS=1` (`E2E_SHOTS=1 pnpm e2e tests/theme.spec.ts`), `scratchShot` in `tests/support.ts` saves them
under `e2e/.scratch/` (git-ignored) once the web fonts have loaded; without it, as on CI, it leaves the page
alone.
