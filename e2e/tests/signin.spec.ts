// SPDX-License-Identifier: MIT
import { expect, type Page } from '@playwright/test';

import {
  ALL_SCOPES,
  GIS_SCRIPT_URL,
  stubGoogle,
  TEST_CLIENT_ID,
  TEST_EMAIL,
  type GisStubOptions,
  type GoogleStubs,
} from '../fixtures/gis.js';
import { expectTokenNowhere, stubConfig, test } from '../fixtures/live.js';
import { expectNoAxeViolations } from './support.js';

/**
 * Google sign-in in normal mode, run by the `chromium-live` project against the normal-mode server. The
 * backend's GET /api/config, Google's sign-in script and Google's tokeninfo are all answered inside the browser
 * (fixtures/gis.ts): the stub script hands the app a fake token, so no Google window opens and nothing leaves the
 * machine. Expiry and renewal run on Playwright's clock.
 */

const HOSTED_BY = 'Hosted by Example Ltd.';

/** The instance's configuration: sign-in and service-account mode on, and a hosting line. */
const CONFIG = {
  oauthClientId: TEST_CLIENT_ID,
  saMode: true,
  backendServiceAccount: 'gcportrait-backend@example.com',
  hostedBy: HOSTED_BY,
} as const;

const FIRST = 'e2e-fake-access-token-first-6a1f';
const SECOND = 'e2e-fake-access-token-second-93c2';

const START = new Date('2026-10-10T09:00:00Z');

async function stubBackend(page: Page, config: Record<string, unknown> = CONFIG): Promise<void> {
  await stubConfig(page, config);
}

async function open(page: Page, options: Partial<GisStubOptions> = {}): Promise<GoogleStubs> {
  await stubBackend(page);
  const google = await stubGoogle(page, {
    tokens: [FIRST, SECOND],
    expiresIn: 3599,
    scope: ALL_SCOPES,
    silent: 'grant',
    ...options,
  });
  await page.goto('/');
  return google;
}

function signInCard(page: Page) {
  return page
    .getByRole('region', { name: 'Choose a source' })
    .getByRole('listitem')
    .filter({
      has: page.getByRole('heading', { name: 'Your Google Cloud environment' }),
    });
}

function accountButton(page: Page, name: string | RegExp = TEST_EMAIL) {
  return page.getByRole('banner').getByRole('button', { name, exact: typeof name === 'string' });
}

async function signIn(page: Page): Promise<void> {
  await signInCard(page).getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(accountButton(page)).toBeVisible();
}

test('signs in with Google, keeps the token in memory only, and signs out with a revocation', async ({
  page,
}) => {
  const google = await open(page);
  await expect(page.getByRole('region', { name: 'Backend' }).getByRole('status')).toHaveText(
    'Backend version 0.0.0-e2e. Google sign-in is configured; service-account mode is on.',
  );
  // Google's script is loaded on the press only.
  expect(google.scriptLoads()).toBe(0);
  await expect(page.locator(`script[src="${GIS_SCRIPT_URL}"]`)).toHaveCount(0);
  const card = signInCard(page);
  await expect(card.getByText(HOSTED_BY, { exact: true })).toBeVisible();
  await expect(
    card.getByText(/Google will ask you to let gcportrait view your Google Cloud data/),
  ).toBeVisible();

  await signIn(page);
  expect(google.scriptLoads()).toBe(1);
  const log = await google.log();
  expect(log.clientId).toBe(TEST_CLIENT_ID);
  expect(log.scope).toBe(ALL_SCOPES);
  expect(log.requests).toEqual([{ prompt: 'select_account' }]);
  // Tokeninfo got the token in its body, not in its address.
  expect(google.tokenInfoBodies()).toEqual([`access_token=${FIRST}`]);

  await expect(card.getByText(`Signed in as ${TEST_EMAIL}.`, { exact: true })).toBeVisible();
  const environment = page.getByRole('heading', { name: 'Read your environment' });
  await expect(environment).toBeFocused();
  await expect(page.getByRole('radiogroup', { name: 'Read with' }).getByRole('radio')).toHaveText([
    'Your account',
    'Service account',
  ]);
  // The scope and "Pull now" follow in this section; their own specs cover them.
  await expectTokenNowhere(page, google, [FIRST]);
  // The console check above listens: a line the page logs is seen.
  await page.evaluate(() => {
    console.info('e2e console probe');
  });
  await expect.poll(() => google.console()).toContain('info: e2e console probe');

  // A reload forgets the session: nothing was stored to bring it back.
  await page.reload();
  await expect(signInCard(page).getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(accountButton(page)).toHaveCount(0);
  await signIn(page);

  await accountButton(page).click();
  const panel = page.getByRole('dialog', { name: 'Account' });
  await expect(panel.getByText(/^Signed in with Google until \d\d:\d\d/)).toBeVisible();
  await panel.getByRole('button', { name: 'Sign out' }).click();
  await expect(accountButton(page)).toHaveCount(0);
  await expect(signInCard(page).getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Read your environment' })).toHaveCount(0);
  // The reload loaded the stub afresh, so the second sign-in got the first token again.
  expect((await google.log()).revoked).toEqual([FIRST]);
  await expectTokenNowhere(page, google, [FIRST, SECOND]);
});

test('renews the token silently before it ends', async ({ page }) => {
  await page.clock.install({ time: START });
  const google = await open(page);
  await signIn(page);
  await page.clock.fastForward('55:30');
  await expect
    .poll(async () => (await google.log()).requests)
    .toEqual([{ prompt: 'select_account' }, { prompt: 'none', login_hint: TEST_EMAIL }]);
  await expect
    .poll(() => google.tokenInfoBodies())
    .toEqual([`access_token=${FIRST}`, `access_token=${SECOND}`]);
  // Past the first token's end: still signed in, on the second.
  await page.clock.fastForward('10:00');
  await expect(accountButton(page)).toBeVisible();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Session expired' })).toHaveCount(0);
  await expectTokenNowhere(page, google, [FIRST, SECOND]);
});

test('asks for a click when the silent renewal is blocked, and "Stay signed in" renews', async ({ page }) => {
  await page.clock.install({ time: START });
  const google = await open(page, { silent: 'blocked' });
  await signIn(page);
  await page.clock.fastForward('55:30');
  const needed = accountButton(page, /^ada@example\.com\s*\(ends \d\d:\d\d\)$/);
  await expect(needed).toBeVisible();
  await needed.click();
  const panel = page.getByRole('dialog', { name: 'Account' });
  await expect(panel.getByText(/Stay signed in to keep reading your environment/)).toBeVisible();
  await panel.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(accountButton(page)).toBeVisible();
  expect((await google.log()).requests).toEqual([
    { prompt: 'select_account' },
    { prompt: 'none', login_hint: TEST_EMAIL },
    { prompt: '', login_hint: TEST_EMAIL },
  ]);
  await expectTokenNowhere(page, google, [FIRST, SECOND]);
});

test('expires clearly when the renewal cannot run, and signs in again', async ({ page }) => {
  await page.clock.install({ time: START });
  const google = await open(page, { silent: 'blocked' });
  await signIn(page);
  await page.clock.fastForward('55:30');
  await expect(accountButton(page, /\(ends \d\d:\d\d\)$/)).toBeVisible();
  await page.clock.fastForward('05:00');
  const expired = page.getByRole('banner').getByRole('button', { name: 'Session expired' });
  await expect(expired).toBeVisible();
  const card = signInCard(page);
  await expect(card.getByText(`Your Google sign-in as ${TEST_EMAIL} ended.`, { exact: false })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Read with' })).toHaveAttribute('aria-disabled', 'true');
  await expectTokenNowhere(page, google, [FIRST]);

  await expired.click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Sign in again' }).click();
  await expect(accountButton(page)).toBeVisible();
  await expect(expired).toHaveCount(0);
  await expectTokenNowhere(page, google, [FIRST, SECOND]);
});

test('without an OAuth client, sign-in stays inert and Google’s script is never loaded', async ({ page }) => {
  await stubBackend(page, { ...CONFIG, oauthClientId: null });
  const google = await stubGoogle(page, {
    tokens: [FIRST],
    expiresIn: 3599,
    scope: ALL_SCOPES,
    silent: 'grant',
  });
  await page.goto('/');
  const button = signInCard(page).getByRole('button', { name: 'Sign in with Google' });
  await expect(
    signInCard(page).getByText('Google sign-in is not configured on this instance.'),
  ).toBeVisible();
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  // An inert button counts as disabled for Playwright's click, so the press is forced.
  await button.click({ force: true });
  await expect(page.locator(`script[src="${GIS_SCRIPT_URL}"]`)).toHaveCount(0);
  expect(google.scriptLoads()).toBe(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('axe reports no violations signed in, with the account menu open', async ({ page }) => {
      await open(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await signIn(page);
      await page.getByRole('radio', { name: 'Service account' }).click();
      await expectNoAxeViolations(page);
      await accountButton(page).click();
      await expect(page.getByRole('dialog', { name: 'Account' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}
