// SPDX-License-Identifier: MIT
import path from 'node:path';

import { expect, type Locator, type Page } from '@playwright/test';

import { ALL_SCOPES, stubGoogle } from '../fixtures/gis.js';
import { routeApiTo, startHarness as startBackend } from '../fixtures/harness.js';
import { checkSection, choose, environment, expectTokenNowhere, test } from '../fixtures/live.js';
import { drawnCanvas, expectNoAxeViolations, primaryNav, scratchShot } from './support.js';

/**
 * Service-account mode (AGENTS.md, Security and privacy, The service-account gate) end to end, run by the
 * `chromium-live` project against `pnpm dev`'s Vite server. Unlike the other live specs, the backend here is
 * the real one: the spec starts `backend/src/auth/sa-harness.testing.ts` as a process (it is never imported)
 * and sends the browser's `/api` requests to it, so the routes, the service-account gate and the Application
 * Default Credentials code run as they do on Cloud Run. Only Google is pretend, inside that process: its
 * metadata server (the account `gcportrait-backend@demo-host…`), tokeninfo, Resource Manager (search,
 * `testIamPermissions`, the account's own `get`) and Cloud Asset Inventory. Google's sign-in script and the
 * browser's tokeninfo are answered by fixtures/gis.ts. Everything is synthetic: organisation 30000000001,
 * folders Platform (20000000001: the person may see it, the account may list it), Finance (20000000002: the
 * person may not see it) and Shared (20000000003: its details are public), example.com.
 */

const HARNESS = path.join('src', 'auth', 'sa-harness.testing.ts');

const TOKEN = 'e2e-fake-access-token-sa-mode-3b7f';
const ACCOUNT = 'gcportrait-backend@demo-host.iam.gserviceaccount.com';
const PLATFORM = 'folders/20000000001';
const FINANCE = 'folders/20000000002';
const SHARED = 'folders/20000000003';

/** One call the pretend Google received: whose token, never the token itself. */
interface UpstreamCall {
  readonly host: string;
  readonly path: string;
  readonly method: string;
  readonly as: 'caller' | 'account' | 'other' | 'none';
  readonly quotaHeader: boolean;
}

/** One audit line of the gate. */
interface Audit {
  readonly route: string;
  readonly scope: string;
  readonly decision: 'allowed' | 'denied';
  readonly step?: string;
  readonly finding: string;
  readonly callerEmailHash: string | null;
}

type HarnessLine =
  | { readonly ready: { readonly port: number } }
  | { readonly call: UpstreamCall }
  | { readonly audit: Audit }
  | { readonly leak: string };

interface Harness {
  readonly url: string;
  /** A point in the harness's output; `calls`, `audits` and `leaks` read what came after it. */
  readonly mark: () => number;
  readonly calls: (mark: number) => UpstreamCall[];
  readonly audits: (mark: number) => Audit[];
  readonly leaks: () => string[];
  readonly stop: () => Promise<void>;
}

/** Starts the backend harness, strict exposure check on or off, and waits until it listens. */
async function startHarness(strict: boolean): Promise<Harness> {
  const backend = await startBackend<HarnessLine>(HARNESS, [
    '--caller-token',
    TOKEN,
    ...(strict ? ['--strict'] : []),
  ]);
  const after = <T>(mark: number, pick: (line: HarnessLine) => T | undefined): T[] =>
    backend.lines.slice(mark).flatMap((line) => {
      const value = pick(line);
      return value === undefined ? [] : [value];
    });
  return {
    url: backend.url,
    mark: () => backend.lines.length,
    calls: (mark) => after(mark, (line) => ('call' in line ? line.call : undefined)),
    audits: (mark) => after(mark, (line) => ('audit' in line ? line.audit : undefined)),
    leaks: () => after(0, (line) => ('leak' in line ? line.leak : undefined)),
    stop: backend.stop,
  };
}

function explainer(page: Page): Locator {
  return page.getByRole('region', { name: 'Service-account mode' });
}

/** Signs in on the Permissions page and switches to service-account mode. */
async function openInServiceAccountMode(page: Page, harness: Harness) {
  await routeApiTo(page, harness);
  const google = await stubGoogle(page, {
    tokens: [TOKEN],
    expiresIn: 3599,
    scope: ALL_SCOPES,
    silent: 'grant',
  });
  await page.goto('/permissions');
  await checkSection(page).getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(checkSection(page).getByRole('combobox', { name: 'Scope' })).toBeVisible();
  await checkSection(page).getByRole('radio', { name: 'Service account' }).click();
  await expect(checkSection(page).getByRole('combobox', { name: 'Quota project' })).toHaveCount(0);
  return google;
}

async function check(page: Page, search: string, option: RegExp): Promise<void> {
  await choose(page, 'Scope', search, option);
  await checkSection(page).getByRole('button', { name: 'Check permissions' }).click();
}

const READY = 'Ready: everything gcportrait needs to read this scope is in place.';
const NOT_READY = 'Not ready yet: what is missing is listed below, with commands that grant it.';

test.describe('service-account mode, default gate (caller check only)', () => {
  let harness: Harness;
  test.beforeAll(async () => {
    harness = await startHarness(false);
  });
  test.afterAll(async () => {
    expect(harness.leaks()).toEqual([]);
    await harness.stop();
  });

  test('reads a scope the person can see as the account, through the gate, and draws it', async ({
    page,
  }) => {
    const mark = harness.mark();
    const google = await openInServiceAccountMode(page, harness);
    // The section reads the account from /api/config: the identity the backend resolved through its metadata server.
    await expect(explainer(page).getByText(ACCOUNT).first()).toBeVisible();
    await expect(explainer(page).getByText(/everyone who can sign in here passes the gate/)).toBeVisible();
    await expect(explainer(page).getByText(/This instance also checks/)).toHaveCount(0);

    await check(page, 'Platform', /Platform/);
    await expect(checkSection(page).getByText(READY).first()).toBeVisible();
    await expect(
      checkSection(page).getByText(
        `You can see ${PLATFORM} yourself, so the service account may read it for you.`,
      ),
    ).toBeVisible();
    await expect(
      checkSection(page).getByText(`The service account can list the assets in ${PLATFORM}.`),
    ).toBeVisible();

    await primaryNav(page).getByRole('link', { name: 'Connect' }).click();
    const pull = environment(page).getByRole('button', { name: 'Pull now' });
    await expect(pull).not.toHaveAttribute('aria-disabled');
    await pull.click();
    await expect(page).toHaveURL(/\/diagram#snapshot=[0-9A-HJKMNP-TV-Z]{26}$/, { timeout: 60_000 });
    const svg = await drawnCanvas(page);
    await expect(
      svg
        .locator('text')
        .filter({ hasText: /^api-1$/ })
        .first(),
    ).toBeAttached();

    const calls = harness.calls(mark);
    // The gate asked Resource Manager with the person's own token, for exactly this scope, twice: the check and the
    // pull's first page (a pass is remembered for later pages, of which there are none here).
    expect(calls.filter((call) => call.path.endsWith(':testIamPermissions'))).toEqual([
      {
        host: 'cloudresourcemanager.googleapis.com',
        path: `/v3/${PLATFORM}:testIamPermissions`,
        method: 'POST',
        as: 'caller',
        quotaHeader: false,
      },
    ]);
    // Cloud Asset Inventory only ever as the account, and never with a quota header: the account's own project pays.
    const listed = calls.filter((call) => call.host === 'cloudasset.googleapis.com');
    expect(listed.length).toBe(2);
    expect(listed.every((call) => call.as === 'account' && !call.quotaHeader)).toBe(true);
    // Without the strict exposure check the account asks Resource Manager nothing.
    expect(
      calls.filter((call) => call.host === 'cloudresourcemanager.googleapis.com' && call.as === 'account'),
    ).toEqual([]);
    expect(harness.audits(mark).map((audit) => [audit.route, audit.scope, audit.decision])).toEqual([
      ['preflight', PLATFORM, 'allowed'],
      ['assets.stream', PLATFORM, 'allowed'],
    ]);
    expect(harness.audits(mark).every((audit) => /^[0-9a-f]{64}$/.test(audit.callerEmailHash ?? ''))).toBe(
      true,
    );

    // The token went to the backend in X-Gcportrait-Token only: never a URL, the page, a log or storage.
    await expectTokenNowhere(page, google, [TOKEN]);
  });

  test('refuses a scope the person cannot see: the check says why, Pull now stays off, and the backend refuses a direct request', async ({
    page,
    request,
  }) => {
    const mark = harness.mark();
    await openInServiceAccountMode(page, harness);
    await check(page, 'Finance', /Finance/);
    await expect(checkSection(page).getByText(NOT_READY).first()).toBeVisible();
    await expect(
      checkSection(page).getByText(
        `You cannot see ${FINANCE} yourself, so service-account mode is refused for it.`,
      ),
    ).toBeVisible();
    await expect(
      checkSection(page).getByText(
        'gcloud resource-manager folders add-iam-policy-binding 20000000002 --member="user:ada@example.com" --role="roles/browser"',
      ),
    ).toBeVisible();
    await expect(checkSection(page).getByRole('alert')).toHaveCount(0);

    await primaryNav(page).getByRole('link', { name: 'Connect' }).click();
    await expect(environment(page).getByRole('button', { name: 'Pull now' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // Without the app in the way, the backend refuses the stream all the same: with the token in the app's
    // own header (as behind IAP) and in Authorization (the non-IAP path for scripts) alike (AGENTS.md,
    // Security and privacy, Tokens).
    for (const headers of [{ 'x-gcportrait-token': TOKEN }, { authorization: `Bearer ${TOKEN}` }]) {
      const direct = await request.post(`${harness.url}/api/assets/stream`, {
        headers,
        data: { scope: FINANCE, contentType: 'RESOURCE', mode: 'sa' },
      });
      expect(direct.status()).toBe(403);
      expect(await direct.json()).toMatchObject({ code: 'SA_GATE_CALLER_DENIED' });
    }

    // Nothing was asked as the account, and Cloud Asset Inventory was never called.
    const calls = harness.calls(mark);
    expect(calls.filter((call) => call.as === 'account')).toEqual([]);
    expect(calls.filter((call) => call.host === 'cloudasset.googleapis.com')).toEqual([]);
    expect(
      harness.audits(mark).map((audit) => [audit.route, audit.scope, audit.decision, audit.finding]),
    ).toEqual([
      ['preflight', FINANCE, 'denied', 'denied'],
      ['assets.stream', FINANCE, 'denied', 'denied'],
      ['assets.stream', FINANCE, 'denied', 'denied'],
    ]);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe reports no violations on a refused service-account check (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openInServiceAccountMode(page, harness);
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await check(page, 'Finance', /Finance/);
      await expect(checkSection(page).getByText(NOT_READY).first()).toBeVisible();
      await expectNoAxeViolations(page);
      await scratchShot(checkSection(page), 'sa-mode', `refused-${scheme}`);
      await scratchShot(explainer(page), 'sa-mode', `explainer-${scheme}`);
    });
  }
});

test.describe('service-account mode with SA_MODE_STRICT_EXPOSURE=true', () => {
  let harness: Harness;
  test.beforeAll(async () => {
    harness = await startHarness(true);
  });
  test.afterAll(async () => {
    expect(harness.leaks()).toEqual([]);
    await harness.stop();
  });

  test('refuses a scope whose details the account can see on its own, and passes one it cannot', async ({
    page,
  }) => {
    const mark = harness.mark();
    await openInServiceAccountMode(page, harness);
    await expect(
      explainer(page).getByText(
        /This instance also checks that the service account cannot see the scope’s details/,
      ),
    ).toBeVisible();

    await check(page, 'Shared', /Shared/);
    await expect(checkSection(page).getByText(NOT_READY).first()).toBeVisible();
    await expect(
      checkSection(page).getByText(
        `The service account can read ${SHARED}’s details itself, for example because they are public, so service-account mode is refused for ${SHARED}.`,
      ),
    ).toBeVisible();
    const refused = harness.calls(mark);
    expect(refused.filter((call) => call.as === 'account')).toEqual([
      {
        host: 'cloudresourcemanager.googleapis.com',
        path: `/v3/${SHARED}`,
        method: 'GET',
        as: 'account',
        quotaHeader: false,
      },
    ]);
    expect(refused.filter((call) => call.host === 'cloudasset.googleapis.com')).toEqual([]);

    const next = harness.mark();
    await checkSection(page)
      .getByRole('button', { name: /^Clear scope/ })
      .click();
    await check(page, 'Platform', /Platform/);
    await expect(checkSection(page).getByText(READY).first()).toBeVisible();
    await expect(
      checkSection(page).getByText(
        `The service account cannot read ${PLATFORM}’s details on its own, as it should be.`,
      ),
    ).toBeVisible();
    expect(
      harness
        .calls(next)
        // The scope picker's searches and tokeninfo aside: the gate's calls, then the account's probe.
        .filter((call) => call.host !== 'oauth2.googleapis.com' && !call.path.endsWith(':search'))
        .map((call) => `${call.method} ${call.path} as ${call.as}`),
    ).toEqual([
      `POST /v3/${PLATFORM}:testIamPermissions as caller`,
      `GET /v3/${PLATFORM} as account`,
      `POST /v1/${PLATFORM}/assets as account`,
    ]);
  });
});
