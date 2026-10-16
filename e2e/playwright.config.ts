// SPDX-License-Identifier: MIT
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the SPA's Vite dev server; no backend and no Google Cloud access needed.
 *
 * - `chromium` runs every spec except the live ones against demo mode (`pnpm dev:demo`, port 5174).
 * - `chromium-live` runs live.spec.ts, signin.spec.ts, preflight.spec.ts, live-pull.spec.ts, permissions-variables.spec.ts,
 *   sa-mode.spec.ts and demo-only.spec.ts against normal mode (`pnpm dev`'s Vite server, port 5173). Their backend calls
 *   (GET /api/config, and the scope search and the preflight) and Google's (the sign-in script, tokeninfo) are
 *   answered inside the browser by the specs (fixtures/live.ts, fixtures/gis.ts);
 *   sa-mode.spec.ts instead sends the backend calls to the real backend, started by the spec with a pretend Google
 *   (backend/src/auth/sa-harness.testing.ts); demo-only.spec.ts to the real backend in demo-only mode
 *   (backend/src/demo-only-harness.testing.ts); both through fixtures/harness.ts.
 *
 * - `mobile` runs mobile.spec.ts and touch.spec.ts against demo mode: the phone and tablet layouts (AGENTS.md, Product
 *   rules) and the canvas's touch gestures, in Chromium emulating a touch device at the sizes the specs set (`pnpm
 *   --filter @gcportrait/frontend mobile` runs it alone).
 * - `chromium-phone` and `chromium-tablet` run the tests tagged `@phone` and `@tablet` against demo mode, in Chromium
 *   emulating a touch device at 390 × 844 (an iPhone 13's window, the phone's layout) and 820 × 1180 (an iPad Air's,
 *   the tablet's): handheld.spec.ts, the app's flows by finger. `chromium` leaves the tagged tests out.
 *
 * Locally a server that is already running on either port is reused; CI always starts fresh ones. Chromium
 * only for now; the desktop's functional specs at a window of 1440 × 900.
 */
const DEMO_URL = 'http://localhost:5174';
const LIVE_URL = 'http://localhost:5173';
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

function devServer(script: 'dev' | 'dev:demo', url: string) {
  return {
    command: `pnpm --filter @gcportrait/frontend run ${script}`,
    url,
    reuseExistingServer: !isCI,
    timeout: 60_000,
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
  reporter: isCI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    viewport: VIEWPORT,
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  // `--shard` splits the projects it runs by test count in this order, which CI's e2e legs rely on
  // (.github/workflows/pr.yml): the quick live tests before the desktop's, the handheld ones before mobile's
  // heavy ones, so each shard of a leg gets a share of the slow tests.
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
  webServer: [devServer('dev:demo', DEMO_URL), devServer('dev', LIVE_URL)],
});
