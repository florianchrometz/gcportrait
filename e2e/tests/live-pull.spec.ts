// SPDX-License-Identifier: Apache-2.0
import { expect, type Locator, type Page, type Route } from '@playwright/test';

import { stubGoogle, TEST_CLIENT_ID, TEST_EMAIL } from '../fixtures/gis.js';
import {
  checkSection,
  choose,
  environment,
  expectTokenNowhere,
  requireToken,
  stubConfig,
  test,
} from '../fixtures/live.js';
import { drawnCanvas, expectNoAxeViolations, exportOperation, primaryNav, scratchShot } from './support.js';

/**
 * The live pull and the export load in normal mode, run by the `chromium-live` project against the normal-mode
 * server, with the backend stubbed inside the browser: GET /api/config, the scope search and the preflight
 * (in the backend's contract), POST /api/assets/stream (the NDJSON frames of backend/src/stream/asset-list.ts) and
 * POST /api/export/read (an export's lines), and Google's sign-in script and tokeninfo (fixtures/gis.ts). The
 * streams go through the real import worker into IndexedDB, and the diagram is drawn from what was stored. Dropped
 * files of more than 10 000 assets ask before anything is stored, and Cancel stores nothing.
 * Everything is synthetic: organisation 30000000001, `demo-` projects, example.com.
 */

const TOKEN = 'e2e-fake-access-token-pull-7c3e';
const READ_TIME = '2026-10-10T08:59:58.123456Z';
const SIDECAR_READ_TIME = '2026-10-08T06:00:01Z';

const CONFIG = {
  oauthClientId: TEST_CLIENT_ID,
  hostedBy: 'Hosted by Example Ltd.',
} as const;

const ORG = {
  kind: 'organization',
  scope: 'organizations/30000000001',
  id: '30000000001',
  displayName: 'example.com',
};
const QUOTA = {
  kind: 'project',
  scope: 'projects/demo-quota-1',
  id: 'demo-quota-1',
  displayName: 'Quota',
  parent: 'organizations/30000000001',
  projectNumber: '10000000009',
};

const READY = {
  scope: ORG.scope,
  kind: 'organization',
  mode: 'user',
  outcome: 'ready',
  displayName: 'example.com',
  quotaProject: 'demo-quota-1',
  member: `user:${TEST_EMAIL}`,
  items: [
    {
      id: 'cai-access',
      status: 'ok',
      finding: 'ok',
      blocking: true,
      permission: 'cloudasset.assets.listResource',
      role: 'roles/cloudasset.viewer',
      member: `user:${TEST_EMAIL}`,
      resource: ORG.scope,
      commands: [],
    },
  ],
  candidates: [{ project: 'demo-quota-1', source: 'chosen', result: 'usable', commands: [] }],
} as const;

/** A small synthetic organisation in the `assets.list` shape: two projects, a network, instances. */
function organisation(): Record<string, unknown>[] {
  const crm = '//cloudresourcemanager.googleapis.com';
  const ancestors = (project?: string): string[] => [
    ...(project === undefined ? [] : [`projects/${project}`]),
    'folders/20000000001',
    'organizations/30000000001',
  ];
  const asset = (
    name: string,
    assetType: string,
    data: Record<string, unknown>,
    ancestry: string[],
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    name,
    assetType,
    resource: { version: 'v1', data, ...extra },
    ancestors: ancestry,
    updateTime: '2026-10-07T18:22:41.123456Z',
  });
  const assets = [
    asset(
      `${crm}/organizations/30000000001`,
      'cloudresourcemanager.googleapis.com/Organization',
      { displayName: 'example.com' },
      ['organizations/30000000001'],
    ),
    asset(
      `${crm}/folders/20000000001`,
      'cloudresourcemanager.googleapis.com/Folder',
      { displayName: 'Platform' },
      ['folders/20000000001', 'organizations/30000000001'],
      {
        parent: `${crm}/organizations/30000000001`,
      },
    ),
  ];
  for (const [number, id] of [
    ['10000000001', 'demo-net-1'],
    ['10000000002', 'demo-app-1'],
  ] as const)
    assets.push(
      asset(
        `${crm}/projects/${number}`,
        'cloudresourcemanager.googleapis.com/Project',
        { projectId: id, projectNumber: number, name: id },
        ancestors(number),
        {
          parent: `${crm}/folders/20000000001`,
        },
      ),
    );
  const network = '//compute.googleapis.com/projects/demo-net-1/global/networks/core';
  assets.push(
    asset(network, 'compute.googleapis.com/Network', { name: 'core' }, ancestors('10000000001'), {
      parent: `${crm}/projects/10000000001`,
    }),
  );
  for (let index = 1; index <= 12; index += 1)
    assets.push(
      asset(
        `//compute.googleapis.com/projects/demo-app-1/zones/europe-west3-a/instances/web-${String(index)}`,
        'compute.googleapis.com/Instance',
        {
          name: `web-${String(index)}`,
          status: 'RUNNING',
          networkInterfaces: [
            {
              network: 'https://www.googleapis.com/compute/v1/projects/demo-net-1/global/networks/core',
              networkIP: `10.0.0.${String(index + 10)}`,
            },
          ],
        },
        ancestors('10000000002'),
        { parent: `${crm}/projects/10000000002`, location: 'europe-west3-a' },
      ),
    );
  return assets;
}

const ASSETS = organisation();

/** The backend's frames for the organisation, in pages of five, ending with `end`. */
function frames(
  end: Record<string, unknown> = { t: 'done', assets: ASSETS.length, readTime: READ_TIME },
): string {
  const lines: unknown[] = [{ t: 'progress', pages: 0, assets: 0 }];
  for (let start = 0, pages = 1; start < ASSETS.length; start += 5, pages += 1) {
    lines.push({ t: 'page', assets: ASSETS.slice(start, start + 5) });
    lines.push({ t: 'progress', pages, assets: Math.min(ASSETS.length, start + 5) });
  }
  lines.push(end);
  return lines.map((line) => `${JSON.stringify(line)}\n`).join('');
}

/** The organisation as `exportAssets` writes it: one asset per line, snake_case envelope keys. */
function exportLines(): string {
  return ASSETS.map(({ assetType, updateTime, ...rest }) =>
    JSON.stringify({ ...rest, asset_type: assetType, update_time: updateTime }),
  ).join('\n');
}

/**
 * The organisation with `buckets` more storage buckets in demo-app-1, as `exportAssets` writes it: an export of more
 * than `LARGE_SNAPSHOT_ASSETS` (10 000) assets when `buckets` is 10 000.
 */
function largeExportLines(buckets: number): string {
  const lines = [exportLines()];
  for (let index = 1; index <= buckets; index += 1)
    lines.push(
      JSON.stringify({
        name: `//storage.googleapis.com/demo-bucket-${String(index)}`,
        asset_type: 'storage.googleapis.com/Bucket',
        resource: {
          version: 'v1',
          data: { name: `demo-bucket-${String(index)}` },
          parent: '//cloudresourcemanager.googleapis.com/projects/10000000002',
          location: 'europe-west3',
        },
        ancestors: ['projects/10000000002', 'folders/20000000001', 'organizations/30000000001'],
        update_time: '2026-10-07T18:22:41.123456Z',
      }),
    );
  return lines.join('\n');
}

/** The export's operation.json, which names its read time. */
const OPERATION = exportOperation(ORG.scope, SIDECAR_READ_TIME);

interface BackendLog {
  readonly streams: unknown[];
  readonly exports: unknown[];
  /** Requests whose X-Gcportrait-Token was not the session's token, or that carried an Authorization header. */
  readonly badToken: string[];
}

interface Answers {
  readonly stream?: (route: Route) => Promise<void>;
}

async function stubBackend(page: Page, answers: Answers = {}): Promise<BackendLog> {
  const log: BackendLog = { streams: [], exports: [], badToken: [] };
  const authorized = requireToken(TOKEN, log.badToken);
  await stubConfig(page, CONFIG);
  await page.route('**/api/scopes/search', async (route) => {
    if (!authorized(route.request()))
      return route.fulfill({ status: 401, json: { message: 'Sign in first.' } });
    const body = route.request().postDataJSON() as { kinds?: string[] };
    const scopes = [ORG, QUOTA].filter(
      (scope) => body.kinds === undefined || body.kinds.includes(scope.kind),
    );
    return route.fulfill({ json: { scopes, problems: [] } });
  });
  await page.route('**/api/preflight', async (route) => {
    if (!authorized(route.request()))
      return route.fulfill({ status: 401, json: { message: 'Sign in first.' } });
    return route.fulfill({ json: READY });
  });
  await page.route('**/api/assets/stream', async (route) => {
    if (!authorized(route.request()))
      return route.fulfill({ status: 401, json: { message: 'Sign in first.' } });
    log.streams.push(route.request().postDataJSON());
    if (answers.stream !== undefined) return answers.stream(route);
    return route.fulfill({ contentType: 'application/x-ndjson; charset=utf-8', body: frames() });
  });
  await page.route('**/api/export/read', async (route) => {
    if (!authorized(route.request()))
      return route.fulfill({ status: 401, json: { message: 'Sign in first.' } });
    log.exports.push(route.request().postDataJSON());
    const body = exportLines();
    return route.fulfill({
      contentType: 'application/x-ndjson; charset=utf-8',
      headers: {
        'x-gcportrait-export-objects': '1',
        'x-gcportrait-export-bytes': String(Buffer.byteLength(body)),
      },
      body,
    });
  });
  return log;
}

async function stubSignIn(page: Page): Promise<Awaited<ReturnType<typeof stubGoogle>>> {
  return stubGoogle(page, { tokens: [TOKEN] });
}

/** Signs in on the Connect page, picks the organisation and the quota project, and runs the check. */
async function checkedScope(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await choose(page, 'Scope', 'example', /example\.com/);
  await choose(page, 'Quota project', 'quota', /Quota/);
  await checkSection(page).getByRole('button', { name: 'Check permissions' }).click();
  await expect(
    checkSection(page)
      .getByText('Ready: everything gcportrait needs to read this scope is in place.')
      .first(),
  ).toBeVisible();
}

function exportCard(page: Page): Locator {
  return page
    .getByRole('region', { name: 'Choose a source' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Cloud Asset Inventory export' }) });
}

test('Pull now streams the checked scope into a snapshot and opens the diagram', async ({ page }) => {
  const log = await stubBackend(page);
  const google = await stubSignIn(page);
  await checkedScope(page);
  const pull = environment(page).getByRole('button', { name: 'Pull now' });
  await expect(pull).not.toHaveAttribute('aria-disabled');
  await expect(
    environment(page).getByText(
      /^Reads example\.com with your account; requests use the quota of demo-quota-1\./,
    ),
  ).toBeVisible();
  await pull.click();

  await expect(page).toHaveURL(/\/diagram#snapshot=[0-9A-HJKMNP-TV-Z]{26}$/, { timeout: 60_000 });
  const svg = await drawnCanvas(page);
  await expect(
    svg
      .locator('text')
      .filter({ hasText: /^web-1$/ })
      .first(),
  ).toBeAttached();
  expect(log.streams).toEqual([
    {
      scope: 'organizations/30000000001',
      contentType: 'RESOURCE',
      mode: 'user',
      quotaProject: 'demo-quota-1',
    },
  ]);

  // Stored as an API pull, read time as Google reported it.
  await primaryNav(page).getByRole('link', { name: 'Snapshots' }).click();
  const table = page.getByRole('table', { name: 'Snapshots stored in this browser' });
  const row = table.getByRole('row').filter({ hasText: 'API pull' });
  await expect(row).toContainText('2026-10-10 08:59 UTC');
  await expect(row).toContainText('live pull');
  await expect(row).toContainText(String(ASSETS.length));

  // The token went only to this backend, in X-Gcportrait-Token (AGENTS.md, Security and privacy, Tokens):
  // never in Authorization, a URL, the page or any storage.
  expect(log.badToken).toEqual([]);
  await expectTokenNowhere(page, google, [TOKEN]);
});

test('Pull now shows what Google refused and links the permission check; nothing is stored', async ({
  page,
}) => {
  const message = 'Request denied by Cloud IAM. Missing required IAM permission on requested scope.';
  await stubBackend(page, {
    stream: (route) =>
      route.fulfill({
        contentType: 'application/x-ndjson',
        body: frames({ t: 'error', message, status: 403, code: 'PERMISSION_DENIED' }),
      }),
  });
  await stubSignIn(page);
  await checkedScope(page);
  await environment(page).getByRole('button', { name: 'Pull now' }).click();
  const alert = environment(page).getByRole('alert');
  await expect(alert).toContainText('You cannot list assets in example.com, or it does not exist.');
  await expect(alert).toContainText(message);
  await expect(page).toHaveURL(/\/$/);
  await alert.getByRole('link', { name: 'Check permissions' }).click();
  await expect(page).toHaveURL(/\/#permissions-check$/);
  await expect(checkSection(page)).toBeVisible();
});

test('Cancel stops a pull that is still waiting, and stores nothing', async ({ page }) => {
  let release: (() => void) | null = null;
  await stubBackend(page, {
    stream: async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ body: frames() }).catch(() => undefined);
    },
  });
  await stubSignIn(page);
  await checkedScope(page);
  await environment(page).getByRole('button', { name: 'Pull now' }).click();
  // The pull's stage is a polite live region of its own (the scope pickers above have theirs).
  await expect(
    environment(page).getByRole('status').filter({ hasText: 'Asking Cloud Asset Inventory…' }),
  ).toBeVisible();
  await expect(
    environment(page).getByRole('progressbar', { name: 'Pulling from Cloud Asset Inventory' }),
  ).toBeVisible();
  await environment(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(
    environment(page).getByRole('status').filter({ hasText: 'Cancelled. Nothing was stored.' }),
  ).toBeVisible();
  (release as (() => void) | null)?.();
  await primaryNav(page).getByRole('link', { name: 'Snapshots' }).click();
  await expect(page.getByText(/^No snapshots are stored in this browser yet./)).toBeVisible();
});

test('Load export reads dropped files with their operation.json, then opens the diagram', async ({
  page,
}) => {
  await stubBackend(page);
  await page.goto('/');
  await exportCard(page)
    .getByTestId('export-files')
    .setInputFiles([
      { name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(exportLines()) },
      { name: 'operation.json', mimeType: 'application/json', buffer: Buffer.from(OPERATION) },
    ]);
  await expect(page).toHaveURL(/\/diagram#snapshot=[0-9A-HJKMNP-TV-Z]{26}$/, { timeout: 60_000 });
  await drawnCanvas(page);
  await primaryNav(page).getByRole('link', { name: 'Snapshots' }).click();
  const row = page
    .getByRole('table', { name: 'Snapshots stored in this browser' })
    .getByRole('row')
    .filter({ hasText: 'export.json' });
  // The sidecar's read time, not an estimate from the latest change.
  await expect(row).toContainText('2026-10-08 06:00 UTC');
  await expect(row).not.toContainText('estimated');
});

test('Load export asks before it stores dropped files of more than 10 000 assets: Cancel stores nothing', async ({
  page,
}) => {
  await stubBackend(page);
  await page.goto('/');
  const files = [
    { name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(largeExportLines(10_000)) },
    { name: 'operation.json', mimeType: 'application/json', buffer: Buffer.from(OPERATION) },
  ];
  const question = page.getByRole('alertdialog', { name: 'Draw a large snapshot?' });
  await exportCard(page).getByTestId('export-files').setInputFiles(files);
  await expect(question).toBeVisible({ timeout: 60_000 });
  await expect(question).toHaveAccessibleDescription(/^This snapshot has 10,\d{3} assets\. /);
  await question.getByRole('button', { name: 'Cancel' }).click();
  await expect(question).toBeHidden();
  await expect(
    exportCard(page).getByRole('status').filter({ hasText: 'Cancelled. Nothing was stored.' }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  await primaryNav(page).getByRole('link', { name: 'Snapshots' }).click();
  await expect(page.getByText(/^No snapshots are stored in this browser yet./)).toBeVisible();

  // The same files again ask again; "Draw it anyway" stores them once and opens the diagram without asking again.
  await primaryNav(page).getByRole('link', { name: 'Connect' }).click();
  await exportCard(page).getByTestId('export-files').setInputFiles(files);
  await expect(question).toBeVisible({ timeout: 60_000 });
  await question.getByRole('button', { name: 'Draw it anyway' }).click();
  await expect(page).toHaveURL(/\/diagram#snapshot=[0-9A-HJKMNP-TV-Z]{26}$/, { timeout: 60_000 });
  await drawnCanvas(page);
  await expect(question).toHaveCount(0);
  await primaryNav(page).getByRole('link', { name: 'Snapshots' }).click();
  await expect(
    page
      .getByRole('table', { name: 'Snapshots stored in this browser' })
      .getByRole('row')
      .filter({ hasText: 'export.json' }),
  ).toHaveCount(1);
});

test('Load export reads a gs:// export through the backend, signed in', async ({ page }) => {
  const log = await stubBackend(page);
  await stubSignIn(page);
  await page.goto('/');
  const card = exportCard(page);
  await expect(card.getByRole('button', { name: 'Read from Cloud Storage' })).toHaveAttribute(
    'title',
    'Sign in with Google first',
  );
  await page
    .getByRole('region', { name: 'Choose a source' })
    .getByRole('button', { name: 'Sign in with Google' })
    .click();
  await card.getByLabel('Or read it from Cloud Storage').fill('gs://demo-exports/2026-10-08/export.json');
  await card.getByRole('button', { name: 'Read from Cloud Storage' }).click();
  // Without a sidecar the read time is an estimate, so the notes come first.
  await expect(card.getByText(/^The export does not say when it was taken/)).toBeVisible({ timeout: 60_000 });
  await card.getByRole('button', { name: 'Open the diagram' }).click();
  await expect(page).toHaveURL(/\/diagram#snapshot=[0-9A-HJKMNP-TV-Z]{26}$/);
  await drawnCanvas(page);
  expect(log.exports).toEqual([{ gcsUri: 'gs://demo-exports/2026-10-08/export.json' }]);
  expect(log.badToken).toEqual([]);
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('axe reports no violations on the Connect page with the export panel, and with a failed pull', async ({
      page,
    }) => {
      await stubBackend(page, {
        stream: (route) =>
          route.fulfill({
            body: frames({ t: 'error', message: 'Busy.', status: 503, code: 'UNAVAILABLE', retryable: true }),
          }),
      });
      await stubSignIn(page);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await exportCard(page).getByText('How to make an export with gcloud').click();
      // The command's variables are fields to fill in place (preflight/CommandBlock.tsx).
      await expect(exportCard(page).getByRole('textbox', { name: 'Organisation number' })).toBeVisible();
      await expectNoAxeViolations(page);
      await scratchShot(exportCard(page), 'live-pull', `export-card-${scheme}`);
      await scratchShot(page, 'live-pull', `connect-${scheme}`, { fullPage: true });

      await checkedScope(page);
      await environment(page).getByRole('button', { name: 'Pull now' }).click();
      await expect(environment(page).getByRole('button', { name: 'Try again' })).toBeVisible();
      await expectNoAxeViolations(page);
      await scratchShot(environment(page), 'live-pull', `pull-failed-${scheme}`);
    });
  });
}
