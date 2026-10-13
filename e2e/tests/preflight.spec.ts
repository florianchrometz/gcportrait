// SPDX-License-Identifier: MIT
import { expect, test, type Page } from '@playwright/test';

import { ALL_SCOPES, stubGoogle, TEST_CLIENT_ID, TEST_EMAIL } from '../fixtures/gis.js';
import { checkSection, choose, expectTokenNowhere, requireToken, stubConfig } from '../fixtures/live.js';
import { expectNoAxeViolations, scratchShot } from './support.js';

/**
 * The Permissions page in normal mode, run by the `chromium-live` project against `pnpm dev`'s Vite server.
 * Everything outside the browser is answered inside it, as a mock service worker would: the backend's GET
 * /api/config, POST /api/scopes/search and POST /api/preflight (answers shaped like the backend's contract,
 * backend/src/preflight/schemas.ts and routes/scopes.ts), and Google's sign-in script and tokeninfo
 * (fixtures/gis.ts). The spec signs in, searches and picks a scope, picks a quota project, runs the check,
 * reads the checklist and its commands, copies one, switches to service-account mode, and checks that the
 * token only ever travels in gcportrait's own X-Gcportrait-Token header to this backend, never in
 * Authorization (AGENTS.md, Security and privacy, Tokens).
 */

const ACCOUNT = 'gcportrait-backend@demo-host.iam.gserviceaccount.com';
const TOKEN = 'e2e-fake-access-token-preflight-51d0';

const CONFIG = {
  oauthClientId: TEST_CLIENT_ID,
  saMode: true,
  backendServiceAccount: ACCOUNT,
  hostedBy: 'Hosted by Example Ltd.',
} as const;

const SCOPES = [
  { kind: 'organization', scope: 'organizations/30000000001', id: '30000000001', displayName: 'example.com' },
  {
    kind: 'folder',
    scope: 'folders/20000000001',
    id: '20000000001',
    displayName: 'Web shop',
    parent: 'organizations/30000000001',
  },
  {
    kind: 'project',
    scope: 'projects/demo-web-1',
    id: 'demo-web-1',
    displayName: 'Web front end',
    parent: 'folders/20000000001',
    projectNumber: '10000000001',
  },
  {
    kind: 'project',
    scope: 'projects/demo-quota-1',
    id: 'demo-quota-1',
    displayName: 'Quota',
    parent: 'organizations/30000000001',
    projectNumber: '10000000002',
  },
] as const;

const MEMBER = `user:${TEST_EMAIL}`;
const LIST_BINDING = `gcloud resource-manager folders add-iam-policy-binding 20000000001 --member="${MEMBER}" --role="roles/cloudasset.viewer"`;

/** The user-mode answer for folders/20000000001 with demo-quota-1: quota fine, listing refused. */
const USER_ANSWER = {
  scope: 'folders/20000000001',
  kind: 'folder',
  mode: 'user',
  outcome: 'blocked',
  displayName: 'Web shop',
  quotaProject: 'demo-quota-1',
  member: MEMBER,
  items: [
    {
      id: 'scope-details',
      status: 'ok',
      finding: 'ok',
      blocking: false,
      permission: 'resourcemanager.folders.get',
      role: 'roles/browser',
      member: MEMBER,
      resource: 'folders/20000000001',
      commands: [],
    },
    {
      id: 'quota-project',
      status: 'ok',
      finding: 'ok',
      blocking: true,
      permission: 'serviceusage.services.use',
      role: 'roles/serviceusage.serviceUsageConsumer',
      member: MEMBER,
      resource: 'projects/demo-quota-1',
      commands: [],
    },
    {
      id: 'cai-access',
      status: 'missing',
      finding: 'denied',
      blocking: true,
      permission: 'cloudasset.assets.listResource',
      role: 'roles/cloudasset.viewer',
      member: MEMBER,
      resource: 'folders/20000000001',
      commands: [LIST_BINDING],
      upstream: {
        status: 403,
        code: 'PERMISSION_DENIED',
        message: 'Request denied by Cloud IAM. Missing required IAM permission on requested scope.',
      },
    },
  ],
  candidates: [{ project: 'demo-quota-1', source: 'chosen', result: 'usable', commands: [] }],
} as const;

/** The service-account answer: the gate passed, the account not granted yet. */
const SA_ANSWER = {
  scope: 'folders/20000000001',
  kind: 'folder',
  mode: 'sa',
  outcome: 'blocked',
  displayName: 'Web shop',
  member: MEMBER,
  serviceAccount: ACCOUNT,
  items: [
    {
      id: 'sa-caller',
      status: 'ok',
      finding: 'ok',
      blocking: true,
      permission: 'resourcemanager.folders.get',
      role: 'roles/browser',
      member: MEMBER,
      resource: 'folders/20000000001',
      commands: [],
    },
    {
      id: 'sa-exposure',
      status: 'ok',
      finding: 'ok',
      blocking: true,
      permission: 'resourcemanager.folders.get',
      member: `serviceAccount:${ACCOUNT}`,
      resource: 'folders/20000000001',
      commands: [],
    },
    {
      id: 'sa-access',
      status: 'missing',
      finding: 'denied',
      blocking: true,
      permission: 'cloudasset.assets.listResource',
      role: 'roles/cloudasset.viewer',
      member: `serviceAccount:${ACCOUNT}`,
      resource: 'folders/20000000001',
      commands: [
        `gcloud resource-manager folders add-iam-policy-binding 20000000001 --member="serviceAccount:${ACCOUNT}" --role="roles/cloudasset.viewer"`,
      ],
      upstream: { status: 403, code: 'PERMISSION_DENIED', message: 'Request denied by Cloud IAM.' },
    },
  ],
  candidates: [],
} as const;

interface BackendLog {
  readonly searches: unknown[];
  readonly preflights: unknown[];
  /** Requests whose X-Gcportrait-Token was not this session's token, or that carried an Authorization header. */
  readonly badToken: string[];
}

/** Answers the backend inside the browser. */
async function stubBackend(page: Page): Promise<BackendLog> {
  const log: BackendLog = { searches: [], preflights: [], badToken: [] };
  const authorized = requireToken(TOKEN, log.badToken);
  await stubConfig(page, CONFIG);
  await page.route('**/api/scopes/search', async (route) => {
    const request = route.request();
    if (!authorized(request)) return route.fulfill({ status: 401, json: { message: 'Sign in first.' } });
    const body = request.postDataJSON() as { query: string; kinds?: string[] };
    log.searches.push(body);
    const text = body.query.trim().toLowerCase();
    const scopes = SCOPES.filter(
      (scope) =>
        (body.kinds === undefined || body.kinds.includes(scope.kind)) &&
        (text === '' || scope.displayName.toLowerCase().includes(text) || scope.id.includes(text)),
    );
    return route.fulfill({ json: { scopes, problems: [] } });
  });
  await page.route('**/api/preflight', async (route) => {
    const request = route.request();
    if (!authorized(request)) return route.fulfill({ status: 401, json: { message: 'Sign in first.' } });
    const body = request.postDataJSON() as { mode: string };
    log.preflights.push(body);
    return route.fulfill({ json: body.mode === 'sa' ? SA_ANSWER : USER_ANSWER });
  });
  return log;
}

async function signIn(page: Page): Promise<void> {
  await checkSection(page).getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(checkSection(page).getByRole('combobox', { name: 'Scope' })).toBeVisible();
}

async function openSignedIn(
  page: Page,
): Promise<{ log: BackendLog; google: Awaited<ReturnType<typeof stubGoogle>> }> {
  const log = await stubBackend(page);
  const google = await stubGoogle(page, {
    tokens: [TOKEN],
    expiresIn: 3599,
    scope: ALL_SCOPES,
    silent: 'grant',
  });
  await page.goto('/permissions');
  await expect(page.getByRole('heading', { level: 1, name: 'Permissions' })).toBeVisible();
  await signIn(page);
  return { log, google };
}

test('the Permissions page checks a scope and lists what to grant, with commands to copy', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { log, google } = await openSignedIn(page);

  await choose(page, 'Scope', 'web', /Web shop/);
  await expect(checkSection(page).getByText('Web shop (folders/20000000001)')).toBeVisible();
  // An organisation or folder needs a quota project: pick one from the search.
  await choose(page, 'Quota project', 'quota', /Quota/);
  await checkSection(page).getByRole('button', { name: 'Check permissions' }).click();

  const headline = checkSection(page).getByText(
    'Not ready yet: what is missing is listed below, with commands that grant it.',
    { exact: true },
  );
  await expect(headline.first()).toBeVisible();
  expect(log.preflights).toEqual([
    { scope: 'folders/20000000001', mode: 'user', quotaProject: 'demo-quota-1' },
  ]);
  expect(log.searches).toContainEqual({ query: 'quota', kinds: ['project'] });

  const listing = checkSection(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'List the scope’s assets' }) });
  await expect(listing.getByText(/Missing$/)).toBeVisible();
  await expect(
    listing.getByText('You cannot list assets in folders/20000000001, or it does not exist.'),
  ).toBeVisible();
  await expect(listing.getByText(LIST_BINDING)).toBeVisible();
  await expect(
    checkSection(page).getByText('Requests use the quota of demo-quota-1.', { exact: true }),
  ).toBeVisible();

  await listing
    .getByRole('button', { name: 'Copy the command that grants roles/cloudasset.viewer on 20000000001' })
    .click();
  await expect(listing.getByText('Copied.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LIST_BINDING);

  // The token went to this backend in X-Gcportrait-Token only: never in Authorization, a URL, the page
  // or any storage.
  expect(log.badToken).toEqual([]);
  await expectTokenNowhere(page, google, [TOKEN]);
});

test('service-account mode checks through the gate and explains it with the account', async ({ page }) => {
  const { log } = await openSignedIn(page);
  await checkSection(page).getByRole('radio', { name: 'Service account' }).click();
  await expect(checkSection(page).getByRole('combobox', { name: 'Quota project' })).toHaveCount(0);
  await choose(page, 'Scope', 'folders/20000000001', /Use folders\/20000000001/);
  await checkSection(page).getByRole('button', { name: 'Check permissions' }).click();
  await expect(
    checkSection(page).getByText(
      'The service account cannot list assets in folders/20000000001. Grant it roles/cloudasset.viewer there.',
    ),
  ).toBeVisible();
  expect(log.preflights).toEqual([{ scope: 'folders/20000000001', mode: 'sa' }]);
  const explainer = page.getByRole('region', { name: 'Service-account mode' });
  await expect(explainer.getByText(ACCOUNT).first()).toBeVisible();
  await expect(explainer.getByText(/^The gate\./)).toBeVisible();
  await expect(explainer.getByText(/reads folders\/20000000001 as gcportrait-backend@/)).toBeVisible();
});

test('a typed scope name is checked as typed; a mistyped one gets a hint; recent scopes survive a reload', async ({
  page,
}) => {
  const { log } = await openSignedIn(page);
  const field = checkSection(page).getByRole('combobox', { name: 'Scope' });
  await field.fill('projects/Not Valid');
  await expect(
    checkSection(page).getByText(/^A project id has lower-case letters, digits and hyphens/),
  ).toBeVisible();
  await choose(page, 'Scope', 'projects/demo-web-1', /Use projects\/demo-web-1/);
  await checkSection(page).getByRole('button', { name: 'Check permissions' }).click();
  await expect.poll(() => log.preflights).toEqual([{ scope: 'projects/demo-web-1', mode: 'user' }]);

  // The token lives in memory only: a reload signs out, the recent scopes (IndexedDB) stay.
  await page.reload();
  await signIn(page);
  await checkSection(page).getByRole('combobox', { name: 'Scope' }).click();
  const recent = page.getByRole('group', { name: 'Recent' });
  await expect(recent.getByRole('option', { name: 'demo-web-1' })).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('axe reports no violations on the Permissions page, signed out and with a checklist', async ({
      page,
    }) => {
      await stubBackend(page);
      await stubGoogle(page, { tokens: [TOKEN], expiresIn: 3599, scope: ALL_SCOPES, silent: 'grant' });
      await page.goto('/permissions');
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await expect(checkSection(page).getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
      await expectNoAxeViolations(page);

      await signIn(page);
      await choose(page, 'Scope', 'web', /Web shop/);
      await choose(page, 'Quota project', 'quota', /Quota/);
      await checkSection(page).getByRole('button', { name: 'Check permissions' }).click();
      await expect(checkSection(page).getByRole('heading', { name: 'Quota projects tried' })).toBeVisible();
      await expectNoAxeViolations(page);
      // For a person to look at (git-ignored): the checklist, and the guidance below it.
      await scratchShot(checkSection(page), 'preflight', `check-${scheme}`);
      await scratchShot(
        checkSection(page)
          .getByRole('listitem')
          .filter({ has: page.getByRole('heading', { name: 'List the scope’s assets' }) }),
        'preflight',
        `missing-row-${scheme}`,
      );
      await scratchShot(
        page.getByRole('region', { name: 'Service-account mode' }),
        'preflight',
        `service-account-${scheme}`,
      );
    });
  });
}
