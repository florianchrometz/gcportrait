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
 * Locally a server that is already running on either port is reused; CI always starts fresh ones. Chromium
 * only for now, at a desktop viewport (desktop only, at least 1280×800; AGENTS.md, Product rules).
 */
const DEMO_URL = 'http://localhost:5174';
const LIVE_URL = 'http://localhost:5173';
const LIVE_SPECS = /(?:live|signin|preflight|live-pull|sa-mode|demo-only|permissions-variables)\.spec\.ts$/;
const VIEWPORT = { width: 1440, height: 900 };
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
  projects: [
    {
      name: 'chromium',
      testIgnore: LIVE_SPECS,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT, baseURL: DEMO_URL },
    },
    {
      name: 'chromium-live',
      testMatch: LIVE_SPECS,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT, baseURL: LIVE_URL },
    },
  ],
  webServer: [devServer('dev:demo', DEMO_URL), devServer('dev', LIVE_URL)],
});
