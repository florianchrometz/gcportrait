// SPDX-License-Identifier: MIT
import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

import { DEMO_URL, LIVE_URL, NAMED } from './fixtures/servers.js';

/**
 * End-to-end tests run against the SPA in two servers, one in demo mode and one in normal mode, each on a free port the
 * run picks for itself (fixtures/servers.ts); no backend and no Google Cloud access needed. Locally they are the Vite dev
 * servers (`pnpm dev:demo`, and `pnpm dev`'s Vite server). On CI (`CI` set, so `CI=true` runs what CI runs) they are the
 * app as it ships, a build of each mode served by `vite preview` with the same `/api` proxy
 * (scripts/built-app.ts): every test opens a fresh browser context, so every page load is cold, and against the build
 * it fetches a few chunks instead of every module; the suite also tests the bundle that ships. The build leaves out
 * only what React's development build adds: StrictMode runs every effect twice under the dev server and not in the
 * build (the app reads no `import.meta.env.DEV`).
 *
 * - `chromium` runs every spec except the live ones against demo mode.
 * - `chromium-live` runs live.spec.ts, signin.spec.ts, preflight.spec.ts, live-pull.spec.ts, permissions-variables.spec.ts,
 *   sa-mode.spec.ts and demo-only.spec.ts against normal mode. Their backend calls (GET /api/config, and the scope
 *   search and the preflight) and Google's (the sign-in script, tokeninfo) are
 *   answered inside the browser by the specs (fixtures/live.ts, fixtures/gis.ts);
 *   sa-mode.spec.ts instead sends the backend calls to the real backend, started by the spec with a pretend Google
 *   (backend/src/auth/sa-harness.testing.ts); demo-only.spec.ts to the real backend in demo-only mode
 *   (backend/src/demo-only-harness.testing.ts); both through fixtures/harness.ts. No backend listens behind the
 *   server's `/api` proxy (port 8080): every spec that opens the server takes its `test` from fixtures/live.ts, which
 *   answers an `/api` request no route of the test answers with a 503 and fails the test, so the proxy is never
 *   reached and prints no error into the run's output.
 *
 * - `mobile` runs mobile.spec.ts and touch.spec.ts against demo mode, and a live instance's pages against normal mode:
 *   the phone and tablet layouts (AGENTS.md, Product rules) and the canvas's touch gestures, in Chromium emulating a
 *   touch device at the sizes the specs set (`pnpm --filter @gcportrait/frontend mobile` runs it alone).
 * - `chromium-phone` and `chromium-tablet` run the tests tagged `@phone` and `@tablet` against demo mode, in Chromium
 *   emulating a touch device at 390 × 844 (an iPhone 13's window, the phone's layout) and 820 × 1180 (an iPad Air's,
 *   the tablet's): handheld.spec.ts, the app's flows by finger. `chromium` leaves the tagged tests out.
 *
 * Every run starts its own two servers, so two runs (of one checkout or of two) never meet, and a server another
 * checkout left running is never tested in this one's place: something that answers on a port the run picked fails the
 * run. Only a server whose URL a person named (E2E_DEMO_URL, E2E_LIVE_URL) is reused, and only locally; CI always
 * starts fresh ones. Chromium only for now; the desktop's functional specs at a window of 1440 × 900.
 *
 * A failed test leaves its trace in test-results/. A local run records one for every test and keeps a failed test's
 * (`retain-on-failure`); on CI, which retries a failed test twice, only a test's first retry records one
 * (`on-first-retry`): a trace holds a snapshot of the page at every action, the diagram's large SVG included, so a
 * test that passes at once records none, and a test that failed has the trace of its first retry.
 */
const LIVE_SPECS = /(?:live|signin|preflight|live-pull|sa-mode|demo-only|permissions-variables)\.spec\.ts$/;
const MOBILE_SPECS = /(?:mobile|touch)\.spec\.ts$/;
/** The tags of the tests a phone and a tablet run; the desktop's project runs neither. */
const PHONE_TAG = /@phone\b/;
const TABLET_TAG = /@tablet\b/;
const HANDHELD_TAGS = /@(?:phone|tablet)\b/;
const VIEWPORT = { width: 1440, height: 900 };
/** A touch device at a phone's size and at a tablet's (AGENTS.md, Product rules: under 48rem, and 48 to 79.99rem). */
const PHONE = {
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
} as const;
const TABLET = {
  viewport: { width: 820, height: 1180 },
  screen: { width: 820, height: 1180 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
} as const;
const isCI = process.env.CI !== undefined && process.env.CI !== '';
/**
 * The list on the terminal, the HTML report on CI, and Playwright's JSON report when PLAYWRIGHT_JSON_OUTPUT_FILE names
 * its file, as scripts/leg.ts does to read which tests a run addressed and how long they took.
 */
const REPORTERS: ReporterDescription[] = [
  ['list'],
  ...(isCI ? [['html', { open: 'never', outputFolder: 'playwright-report' }] as const] : []),
  ...(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ? [['json'] as const] : []),
];

/**
 * The server of one mode at `url`'s port: on CI the build served by `vite preview` (scripts/built-app.ts, which builds
 * first and removes the build once SIGTERM has stopped the preview), locally the mode's Vite dev server. Both keep
 * frontend/vite.config.ts's `strictPort`, so a port taken since the run picked it fails the start. A local run reuses
 * a server that answers at `url` only when a person `named` it.
 */
function server(mode: 'demo' | 'normal', url: string, named: boolean) {
  const port = new URL(url).port;
  const local = {
    command: `pnpm --filter @gcportrait/frontend run ${mode === 'demo' ? 'dev:demo' : 'dev'} --port ${port}`,
    timeout: 60_000,
  } as const;
  const built = {
    command: `node scripts/built-app.ts --mode ${mode} --port ${port}`,
    timeout: 120_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  } as const;
  return {
    ...(isCI ? built : local),
    url,
    reuseExistingServer: !isCI && named,
    stdout: 'ignore',
    stderr: 'pipe',
  } as const;
}

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: REPORTERS,
  use: {
    viewport: VIEWPORT,
    colorScheme: 'light',
    trace: isCI ? 'on-first-retry' : 'retain-on-failure',
  },
  // CI's e2e legs (.github/workflows/pr.yml) each run every k-th test of their projects' JSON listing
  // (scripts/leg.ts), file after file in the order these projects reach them, so that no leg gets a slow file
  // whole.
  projects: [
    {
      name: 'chromium-live',
      testMatch: LIVE_SPECS,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT, baseURL: LIVE_URL },
    },
    {
      name: 'chromium',
      testIgnore: [LIVE_SPECS, MOBILE_SPECS],
      grepInvert: HANDHELD_TAGS,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT, baseURL: DEMO_URL },
    },
    {
      name: 'chromium-phone',
      testIgnore: [LIVE_SPECS, MOBILE_SPECS],
      grep: PHONE_TAG,
      use: { ...devices['Desktop Chrome'], ...PHONE, baseURL: DEMO_URL },
    },
    {
      name: 'chromium-tablet',
      testIgnore: [LIVE_SPECS, MOBILE_SPECS],
      grep: TABLET_TAG,
      use: { ...devices['Desktop Chrome'], ...TABLET, baseURL: DEMO_URL },
    },
    {
      name: 'mobile',
      testMatch: MOBILE_SPECS,
      use: { ...devices['Desktop Chrome'], baseURL: DEMO_URL },
    },
  ],
  webServer: [server('demo', DEMO_URL, NAMED.demo), server('normal', LIVE_URL, NAMED.live)],
});
