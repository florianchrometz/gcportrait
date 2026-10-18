// SPDX-License-Identifier: Apache-2.0
import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

import { DEMO_URL, LIVE_URL, NAMED } from './fixtures/servers.js';

/**
 * The projects and webServer definitions below select each spec's server, tags and device settings.
 * e2e/README.md, Running, describes commands, server isolation, backend stand-ins and trace handling.
 * e2e/AGENTS.md holds the suite's rules.
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
 * its file, as scripts/leg.ts does to read which tests a run addressed and how long they took; additional
 * advice on stderr when Playwright refuses an occupied server URL.
 */
const REPORTERS: ReporterDescription[] = [
  ['list'],
  ...(isCI ? [['html', { open: 'never', outputFolder: 'playwright-report' }] as const] : []),
  ...(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ? [['json'] as const] : []),
  [
    './scripts/server-advice-reporter.ts',
    {
      servers: [
        { url: DEMO_URL, picked: !NAMED.demo },
        { url: LIVE_URL, picked: !NAMED.live },
      ].filter(({ picked }) => isCI || picked),
    },
  ],
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
    command: `node scripts/built-app.ts --mode ${mode} --port ${port} --dev`,
    timeout: 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
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
  // CI leg selection and validation: e2e/scripts/leg.ts's header (e2e/AGENTS.md, CI legs).
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
