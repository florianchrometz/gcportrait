// SPDX-License-Identifier: MIT
import { expect, test, type Page } from '@playwright/test';

import { FORK_SOURCE_URL as CONFIGURED_SOURCE_URL, stubConfig } from '../fixtures/live.js';
import {
  DEFAULT_SOURCE_URL,
  expectFooterLinkStyle,
  expectNoAxeViolations,
  expectShellFooter,
  FOOTER_NOTICE,
  MAINTAINER_LINK_NAME,
  ROUTES,
  scratchShot,
  SOURCE_LINK_TEXT,
} from './support.js';

/**
 * Live (non-demo) mode, run by the `chromium-live` project against `pnpm dev` without VITE_DEMO. The only
 * backend call the shell makes, GET /api/config, is answered inside the browser, so no backend has to run
 * and the Vite proxy is never reached. The footer's source link follows the configured `sourceUrl`
 * (CONFIGURED_SOURCE_URL, the operator's SOURCE_URL: a fork elsewhere), and its legal links follow `legal`.
 */

/** Synthetic pages elsewhere, as an operator's LEGAL_IMPRESSUM_URL and LEGAL_PRIVACY_URL. */
const LINKED_IMPRESSUM = 'https://legal.example.com/impressum';
const LINKED_PRIVACY = 'https://legal.example.com/privacy-policy';

const READY_TEXT =
  'Backend version 0.0.0-e2e. Google sign-in is not configured; service-account mode is off.';
const UNAVAILABLE_TEXT = 'The backend did not answer. Sign-in and live import need it; the demo does not.';

/** The backend status line; other live regions on the page (the demo card's) are not it. */
function backendStatus(page: Page) {
  return page.getByRole('region', { name: 'Backend' }).getByRole('status');
}

async function stubBackend(page: Page, answer: 'ready' | 'down'): Promise<void> {
  if (answer === 'ready') await stubConfig(page);
  else await page.route('**/api/config', (route) => route.abort('connectionrefused'));
}

type LegalPages = {
  readonly impressum: boolean;
  readonly privacy: boolean;
  readonly impressumUrl: string | null;
  readonly privacyUrl: string | null;
};

/** Answers GET /api/config with an instance that publishes these legal pages (and the default source link). */
async function stubLegal(page: Page, legal: LegalPages): Promise<void> {
  await stubConfig(page, { sourceUrl: DEFAULT_SOURCE_URL, legal });
}

/**
 * The footer of a live instance that publishes legal pages: the non-affiliation notice and the source link exactly
 * as on every route (support.ts, `expectShellFooter`), then the legal links' text.
 */
async function expectFooterThenLegal(page: Page, legal: string): Promise<void> {
  const footer = page.getByRole('contentinfo');
  await expect(footer).toBeInViewport();
  await expect(footer.getByText(FOOTER_NOTICE, { exact: true })).toBeVisible();
  await expect(footer.getByRole('link', { name: MAINTAINER_LINK_NAME, exact: true })).toBeVisible();
  await expect(footer.getByRole('link', { name: SOURCE_LINK_TEXT, exact: true })).toHaveAttribute(
    'href',
    DEFAULT_SOURCE_URL,
  );
  await expect(footer).toHaveText(`${FOOTER_NOTICE}${SOURCE_LINK_TEXT}${legal}`);
}

test('the Connect page offers every source and reports the backend', async ({ page }) => {
  await stubBackend(page, 'ready');
  await page.goto('/');
  await expect(page.getByTestId('demo-badge')).toHaveCount(0);
  const sources = page.getByRole('region', { name: 'Choose a source' });
  await expect(sources.getByRole('button')).toHaveText([
    'Sign in with Google',
    'Try the demo',
    // The export card's panel, last and across the row: files, Cloud Storage and the optional operation.json.
    'Choose files…',
    'Read from Cloud Storage',
    'Add operation.json…',
  ]);
  await expect(backendStatus(page)).toHaveText(READY_TEXT);
  await expectShellFooter(page, CONFIGURED_SOURCE_URL);
});

for (const { path, heading } of ROUTES) {
  test(`${path} links the footer's source link to the backend's sourceUrl`, async ({ page }) => {
    await stubBackend(page, 'ready');
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeAttached();
    await expectShellFooter(page, CONFIGURED_SOURCE_URL);
  });
}

test('the source link keeps the build-time URL when the backend does not answer', async ({ page }) => {
  await stubBackend(page, 'down');
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeAttached();
  await expectShellFooter(page, DEFAULT_SOURCE_URL);
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const [answer, text] of [
      ['ready', READY_TEXT],
      ['down', UNAVAILABLE_TEXT],
    ] as const) {
      test(`axe reports no violations on the live Connect page (backend ${answer})`, async ({ page }) => {
        await stubBackend(page, answer);
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
        await expect(backendStatus(page)).toHaveText(text);
        await expectNoAxeViolations(page);
      });
    }
  });
}

test.describe('the footer’s legal links, from the configuration', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`pages elsewhere (legal.impressumUrl, legal.privacyUrl): external links in a new tab, ${scheme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stubLegal(page, {
        impressum: false,
        privacy: false,
        impressumUrl: LINKED_IMPRESSUM,
        privacyUrl: LINKED_PRIVACY,
      });
      await page.goto('/settings');
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      const footer = page.getByRole('contentinfo');
      const legal = footer.getByRole('navigation', { name: 'Legal' });
      await expect(legal).toBeVisible();
      // Next to the non-affiliation notice and the source link, which stay exactly as they are.
      await expectFooterThenLegal(page, 'Impressum·Privacy');
      for (const [text, href] of [
        ['Impressum', LINKED_IMPRESSUM],
        ['Privacy', LINKED_PRIVACY],
      ] as const) {
        const name = `${text} (opens legal.example.com in a new tab)`;
        const link = legal.getByRole('link', { name, exact: true });
        await expect(link).toBeVisible();
        await expect(link).toHaveText(text);
        await expect(link).toHaveAttribute('href', href);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener');
        // The arrow after the text marks it for the eye, in the link's colour; assistive technology hears the name.
        const mark = link.locator('svg');
        await expect(mark).toBeVisible();
        await expect(mark).toHaveAttribute('aria-hidden', 'true');
        await expectFooterLinkStyle(page, link, name);
      }
      await page.locator('main').focus();
      await expectNoAxeViolations(page);
      await scratchShot(footer, 'footer', `footer-legal-${scheme}`);
    });
  }

  test('a page elsewhere opens in a new tab, and this one stays where it was', async ({ page }) => {
    await stubLegal(page, {
      impressum: false,
      privacy: false,
      impressumUrl: LINKED_IMPRESSUM,
      privacyUrl: LINKED_PRIVACY,
    });
    // The other site, answered here for every tab: nothing leaves the machine.
    await page.context().route(LINKED_IMPRESSUM, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Impressum</title><h1>Impressum</h1>',
      }),
    );
    await page.goto('/settings');
    const pages = page.context().pages().length;
    const opened = page.context().waitForEvent('page');
    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: 'Impressum (opens legal.example.com in a new tab)' })
      .click();
    const tab = await opened;
    await expect(tab).toHaveURL(LINKED_IMPRESSUM);
    await expect(tab.getByRole('heading', { level: 1, name: 'Impressum' })).toBeVisible();
    // No opener for the other site; the app's tab (and a signed-in session in its memory) is untouched.
    expect(await tab.evaluate(() => window.opener === null)).toBe(true);
    await expect(page).toHaveURL(/\/settings$/);
    expect(page.context().pages()).toHaveLength(pages + 1);
    await tab.close();
  });

  test('texts the instance serves: its own pages, as before', async ({ page }) => {
    await stubLegal(page, { impressum: true, privacy: true, impressumUrl: null, privacyUrl: null });
    await page.goto('/settings');
    const legal = page.getByRole('contentinfo').getByRole('navigation', { name: 'Legal' });
    await expect(legal.getByRole('link')).toHaveText(['Impressum', 'Privacy']);
    await expect(legal.getByRole('link', { name: 'Impressum', exact: true })).toHaveAttribute(
      'href',
      '/impressum',
    );
    await expect(legal.getByRole('link', { name: 'Privacy', exact: true })).toHaveAttribute(
      'href',
      '/privacy',
    );
    await expect(legal.locator('svg')).toHaveCount(0);
    await expectFooterThenLegal(page, 'Impressum·Privacy');
  });

  test('neither: no legal links at all', async ({ page }) => {
    await stubLegal(page, { impressum: false, privacy: false, impressumUrl: null, privacyUrl: null });
    // The Connect page reports the backend once its configuration arrived.
    await page.goto('/');
    await expect(page.getByText(/^Backend version 0\.0\.0-e2e\./)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Legal' })).toHaveCount(0);
    await expectShellFooter(page, DEFAULT_SOURCE_URL);
  });
});
