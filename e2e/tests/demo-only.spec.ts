// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { routeApiTo, startHarness as startBackend } from '../fixtures/harness.js';
import {
  DEFAULT_SOURCE_URL,
  drawnCanvas,
  expectNoAxeViolations,
  FOOTER_NOTICE,
  primaryNav,
  recordApiRequests,
  SOURCE_LINK_TEXT,
} from './support.js';

/**
 * Demo-only mode (ADR 0032: a sign-in-free demo instance) end to end, run by the
 * `chromium-live` project against `pnpm dev`'s Vite server. The backend is the real one in demo-only mode: the spec
 * starts `backend/src/demo-only-harness.testing.ts` as a process (DEMO_ONLY=true, and LEGAL_DIR for the legal pages)
 * and sends the browser's `/api` requests to it, as sa-mode.spec.ts does. Legal texts are synthetic (agents.md
 * rule 6).
 */

const HARNESS = path.join('src', 'demo-only-harness.testing.ts');
const SELF_HOST_GUIDE = 'https://gcportrait.app/docs/self-host/';
const GOOGLE_ROUTES = ['/api/scopes/search', '/api/preflight', '/api/assets/stream', '/api/export/read'];

const IMPRESSUM = [
  '# Impressum',
  '',
  'Example Operator  ',
  'Example Street 1  ',
  '12345 Example City',
  '',
  '## Kontakt',
  '',
  'E-Mail: <mail@example.com>',
  '',
  '<script>window.injected = 1</script> <img src=x onerror="window.injected = 2">',
].join('\n');
const PRIVACY = '# Privacy notice\n\nThis demo stores nothing about you. See the [Impressum](/impressum).\n';

interface Harness {
  readonly url: string;
  /** Every URL the backend tried to reach Google with: none, in demo-only mode. */
  readonly google: () => string[];
  readonly stop: () => Promise<void>;
}

async function startHarness(legalDir?: string): Promise<Harness> {
  const backend = await startBackend<{ readonly google?: string }>(
    HARNESS,
    legalDir === undefined ? [] : ['--legal-dir', legalDir],
  );
  return {
    url: backend.url,
    google: () => backend.lines.flatMap((line) => (line.google === undefined ? [] : [line.google])),
    stop: backend.stop,
  };
}

const scratch = mkdtempSync(path.join(tmpdir(), 'gcportrait-demo-only-e2e-'));
const legalDir = path.join(scratch, 'legal');
mkdirSync(legalDir);
writeFileSync(path.join(legalDir, 'impressum.md'), IMPRESSUM);
writeFileSync(path.join(legalDir, 'privacy.md'), PRIVACY);

test.afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

test.describe('a demo-only instance with legal texts', () => {
  let harness: Harness;
  test.beforeAll(async () => {
    harness = await startHarness(legalDir);
  });
  test.afterAll(async () => {
    expect(harness.google()).toEqual([]);
    await harness.stop();
  });

  test('the Connect page offers only the demo, the way to one’s own project and the privacy notice', async ({
    page,
  }) => {
    await routeApiTo(page, harness);
    const requests = recordApiRequests(page);
    await page.goto('/');
    const sources = page.getByRole('region', { name: 'Demo mode' });
    await expect(sources).toBeVisible();
    await expect(sources.getByRole('radiogroup', { name: 'Size' }).getByRole('radio')).toHaveText([
      'S',
      'M',
      'L',
      'XL',
    ]);
    await expect(sources.getByRole('button')).toHaveText(['Try the demo']);
    await expect(page.getByTestId('demo-badge')).toHaveText('Demo mode');
    const cta = page
      .getByRole('region', { name: 'Your own Google Cloud' })
      .getByRole('link', { name: 'Deploy gcportrait to your own Google Cloud project' });
    await expect(cta).toHaveAttribute('href', SELF_HOST_GUIDE);
    await expect(page.getByRole('region', { name: 'No personal data' })).toContainText(
      'This demo processes no personal data',
    );
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Choose a source' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Backend' })).toHaveCount(0);
    // The footer: the non-affiliation notice, the source link, then the legal pages.
    const footer = page.getByRole('contentinfo');
    await expect(footer).toHaveText(`${FOOTER_NOTICE}${SOURCE_LINK_TEXT}Impressum·Privacy`);
    await expect(footer.getByRole('link', { name: SOURCE_LINK_TEXT })).toHaveAttribute(
      'href',
      DEFAULT_SOURCE_URL,
    );
    // Only the configuration was asked for (twice in the dev server: React's StrictMode runs effects twice); Google's
    // sign-in script was never loaded.
    expect([...new Set(requests)]).toEqual(['/api/config']);
    expect(
      await page.evaluate(() => document.querySelector('script[src*="accounts.google.com"]')),
    ).toBeNull();
  });

  test('“Try the demo” draws demo organisation S, and the timeline works, with no Google route asked', async ({
    page,
  }) => {
    await routeApiTo(page, harness);
    const requests = recordApiRequests(page);
    await page.goto('/');
    await page
      .getByRole('region', { name: 'Demo mode' })
      .getByRole('button', { name: 'Try the demo' })
      .click();
    await expect(page).toHaveURL(/\/diagram#snapshot=demo:S$/, { timeout: 60_000 });
    await drawnCanvas(page);
    await page.keyboard.press('[');
    await expect(page).toHaveURL(/tick=/);
    await drawnCanvas(page);
    expect(requests.filter((request) => request !== '/api/config')).toEqual([]);
  });

  test('the routes that call Google answer the JSON 404 of an unknown route', async ({ request }) => {
    for (const route of GOOGLE_ROUTES) {
      const response = await request.post(`${harness.url}${route}`, {
        data: {},
        headers: { 'x-gcportrait-token': 'e2e-demo-only-token' },
      });
      expect(response.status(), route).toBe(404);
      expect(((await response.json()) as { message: string }).message).toBe(
        `No route for POST ${route}. This instance runs in demo-only mode: it offers no sign-in and reads nothing from Google Cloud.`,
      );
    }
    const config = (await (await request.get(`${harness.url}/api/config`)).json()) as Record<string, unknown>;
    expect(config).toMatchObject({
      oauthClientId: null,
      saMode: false,
      backendServiceAccount: null,
      demoOnly: true,
      legal: { impressum: true, privacy: true },
    });
  });

  test('the legal pages render the operator’s Markdown, and never its HTML', async ({ page }) => {
    await routeApiTo(page, harness);
    await page.goto('/settings');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Impressum' }).click();
    await expect(page).toHaveURL(/\/impressum$/);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Impressum' })).toBeVisible();
    await expect(main.getByRole('heading', { level: 2, name: 'Kontakt' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'mail@example.com' })).toHaveAttribute(
      'href',
      'mailto:mail@example.com',
    );
    await expect(main).toContainText('<script>window.injected = 1</script>');
    await expect(main.locator('script, img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as { injected?: unknown }).injected)).toBeUndefined();
    await expect(page).toHaveTitle('Impressum · gcportrait');

    await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
    await expect(main.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeVisible();
    await main.getByRole('link', { name: 'Impressum' }).click();
    await expect(page).toHaveURL(/\/impressum$/);
    await expect(primaryNav(page)).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`${scheme} theme`, () => {
      test.use({ colorScheme: scheme });

      /** Each page, and what shows once it is complete. */
      const pages: readonly (readonly [string, (page: Page) => ReturnType<Page['getByText']>])[] = [
        ['/', (page) => page.getByRole('region', { name: 'No personal data' })],
        ['/impressum', (page) => page.getByRole('main').getByRole('heading', { level: 2, name: 'Kontakt' })],
        ['/privacy', (page) => page.getByRole('main').getByText('This demo stores nothing about you.')],
        ['/permissions', (page) => page.getByText(/This instance is a demo/)],
      ];
      for (const [route, complete] of pages) {
        test(`axe reports no violations on ${route}`, async ({ page }) => {
          await routeApiTo(page, harness);
          await page.goto(route);
          await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
          await expect(page.getByTestId('demo-badge')).toBeVisible();
          await expect(complete(page)).toBeVisible();
          await expectNoAxeViolations(page);
        });
      }
    });
  }
});

test.describe('a demo-only instance without legal texts', () => {
  let harness: Harness;
  test.beforeAll(async () => {
    harness = await startHarness();
  });
  test.afterAll(async () => {
    expect(harness.google()).toEqual([]);
    await harness.stop();
  });

  test('has no legal links, and its legal pages say there is none', async ({ page }) => {
    await routeApiTo(page, harness);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Your own Google Cloud' })).toBeVisible();
    const footer = page.getByRole('contentinfo');
    await expect(footer).toHaveText(`${FOOTER_NOTICE}${SOURCE_LINK_TEXT}`);
    await expect(footer.getByRole('navigation', { name: 'Legal' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'No personal data' }).getByRole('link')).toHaveCount(0);
    await page.goto('/impressum');
    await expect(page.getByRole('main')).toContainText('This instance publishes no Impressum.');
    await expectNoAxeViolations(page);
  });
});
