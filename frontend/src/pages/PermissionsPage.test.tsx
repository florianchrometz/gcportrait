// SPDX-License-Identifier: MIT
/**
 * The Permissions page in the whole app, live mode, with Google Identity Services, tokeninfo and the
 * backend's /api routes stood in for: sign-in on the page, the scope picker (search, a typed name, the recent
 * scopes), the quota project, the check and its checklist with copy-ready commands, service-account mode, and
 * the demo page; axe on each.
 *
 * The scope search asks the backend once typing pauses (`SEARCH_DEBOUNCE_MS`): the tests run on fake timeouts
 * that move with the real clock in 1 ms steps (`shouldAdvanceTime`, so the app's other waits and Testing
 * Library's own short ones pass as they would), jump the clock past that pause once a text is typed instead of
 * waiting it out (`pickFromSearch`), and let user-event's own pauses between keys and clicks advance it too
 * (`user`).
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent, type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicConfig } from '../api/config';
import { installGis, signInThroughGis, TEST_CLIENT_ID, type FakeGis } from '../auth/testing';
import { TOKENINFO_URL } from '../auth/tokeninfo';
import { FOOTER_NOTICE } from '../branding';
import type { PreflightAnswer } from '../preflight/api';
import { BLOCKED_ANSWER } from '../preflight/testing';
import { SEARCH_DEBOUNCE_MS } from '../scope/useScopeSearch';
import { createMemoryPreferenceStore, type PreferenceStore } from '../storage/preferences';
import { expectNoAxeViolations } from '../test/axe';
import { publicConfig, stubBackend, type BackendCall, type StubbedBackend } from '../test/backend';
import { stubClipboard } from '../test/clipboard';
import { renderApp, WHOLE_APP_TIMEOUT } from '../test/renderApp';

const TOKEN = 'secret-permissions-token';
const ACCOUNT_EMAIL = 'gcportrait-backend@demo-host.iam.gserviceaccount.com';

const CONFIG: PublicConfig = publicConfig({
  oauthClientId: TEST_CLIENT_ID,
  saMode: true,
  backendServiceAccount: ACCOUNT_EMAIL,
  hostedBy: 'Hosted by Example Ltd.',
});

const SEARCH_ANSWER = {
  scopes: [
    {
      kind: 'organization',
      scope: 'organizations/30000000001',
      id: '30000000001',
      displayName: 'example.com',
    },
    {
      kind: 'folder',
      scope: 'folders/20000000001',
      id: '20000000001',
      displayName: 'Web shop',
      parent: 'organizations/30000000001',
    },
    {
      kind: 'project',
      scope: 'projects/demo-app-1',
      id: 'demo-app-1',
      displayName: 'Demo app 1',
      parent: 'folders/20000000001',
    },
  ],
  problems: [],
};

interface Live {
  readonly gis: FakeGis;
  readonly backend: StubbedBackend;
}

/**
 * A live instance with `config`, Google's tokeninfo naming ada@example.com, GIS on the page, and the scope search and
 * the check answering only a request with the token in gcportrait's own header (Authorization stays empty for
 * IAP).
 */
function live(
  preflight: (body: unknown) => Response = () => Response.json(BLOCKED_ANSWER),
  config: PublicConfig = CONFIG,
): Live {
  const withToken =
    (answer: (call: BackendCall) => Response) =>
    (call: BackendCall): Response =>
      call.headers.get('x-gcportrait-token') !== TOKEN || call.headers.has('authorization')
        ? Response.json({ message: 'no token' }, { status: 401 })
        : answer(call);
  const gis = installGis();
  const backend = stubBackend({
    config,
    routes: {
      [TOKENINFO_URL]: () => Response.json({ aud: TEST_CLIENT_ID, email: 'ada@example.com' }),
      '/api/scopes/search': withToken(() => Response.json(SEARCH_ANSWER)),
      '/api/preflight': withToken((call) => preflight(call.body)),
    },
  });
  return { gis, backend };
}

function checkSection(): HTMLElement {
  return screen.getByRole('region', { name: 'Check a scope' });
}

async function signIn(gis: FakeGis): Promise<void> {
  const button = await waitFor(() => {
    const found = within(checkSection()).getByRole('button', { name: 'Sign in with Google' });
    expect(found.getAttribute('aria-disabled')).toBeNull();
    return found;
  });
  await signInThroughGis(gis, button, TOKEN);
  await within(checkSection()).findByRole('combobox', { name: 'Scope' });
}

async function openSignedIn(
  preferences: PreferenceStore = createMemoryPreferenceStore(),
  preflight?: (body: unknown) => Response,
) {
  const { gis, backend } = live(preflight);
  const view = renderApp('/permissions', { demoConfig: null, preferences });
  await signIn(gis);
  return { backend, bodies: backend.bodies, view };
}

/** The person at the keyboard and the pointer, on the test's fake clock (set up for each test). */
let user: UserEvent;

async function pickFromSearch(text: string, option: RegExp): Promise<void> {
  const field = within(checkSection()).getByRole('combobox', { name: 'Scope' });
  await user.click(field);
  await user.type(field, text);
  // The search goes out once typing pauses.
  await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS));
  const choice = await screen.findByRole('option', { name: option }, { timeout: 2000 });
  await user.click(choice);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true, advanceTimeDelta: 1 });
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the Permissions page, signed out', WHOLE_APP_TIMEOUT, () => {
  it('offers sign-in, the reference with placeholders, the service account and the gate, and the short non-affiliation line', async () => {
    live();
    renderApp('/permissions', { demoConfig: null });
    await within(checkSection()).findByRole('button', { name: 'Sign in with Google' });
    const reference = screen.getByRole('region', { name: 'What each mode needs' });
    // Signed out, nothing is known: the variables are empty fields (their tokens as placeholders) to fill in place.
    const [binding] = within(reference)
      .getAllByRole('button', {
        name: 'Copy the command that grants roles/cloudasset.viewer on YOUR_ORG_ID (reference)',
      })
      .map((button) => button.parentElement);
    expect(binding?.querySelector('code')?.textContent).toBe(
      'gcloud organizations add-iam-policy-binding  --member="user:" --role="roles/cloudasset.viewer"',
    );
    for (const name of ['Organisation number', 'Your e-mail']) {
      const fields = within(reference).getAllByRole('textbox', { name });
      expect(fields.map((field) => (field as HTMLInputElement).value).every((value) => value === '')).toBe(
        true,
      );
    }
    const sa = screen.getByRole('region', { name: 'Service-account mode' });
    await within(sa).findByText(ACCOUNT_EMAIL);
    expect(within(sa).getByText(/The gate\./)).toBeDefined();
    expect(within(sa).getByText(/Grant the account roles\/cloudasset.viewer only/)).toBeDefined();
    // The non-affiliation statement is the footer's alone (footers and long-form texts); the page has none.
    expect(screen.getByRole('main').textContent).not.toMatch(/affiliated/i);
    expect(screen.getByRole('contentinfo').textContent).toContain(FOOTER_NOTICE);
    await expectNoAxeViolations();
  });
});

describe('the Permissions page, signed in', WHOLE_APP_TIMEOUT, () => {
  it('searches scopes with the token, picks one, checks it and lists what is missing with commands', async () => {
    const { bodies, backend } = await openSignedIn();
    await pickFromSearch('demo', /Demo app 1/);
    expect(bodies('/api/scopes/search').at(-1)).toEqual({
      query: 'demo',
      kinds: ['organization', 'folder', 'project'],
    });
    expect(within(checkSection()).getByText('Demo app 1 (projects/demo-app-1)')).toBeDefined();

    await user.click(within(checkSection()).getByRole('button', { name: 'Check permissions' }));
    // Said twice: on screen, and in the live region that announces it.
    expect(
      await within(checkSection()).findAllByText(
        'Not ready yet: what is missing is listed below, with commands that grant it.',
      ),
    ).toHaveLength(2);
    expect(bodies('/api/preflight')).toEqual([{ scope: 'projects/demo-app-1', mode: 'user' }]);

    const items = within(checkSection()).getAllByRole('listitem');
    const access = items.find(
      (item) => within(item).queryByRole('heading', { name: 'List the scope’s assets' }) !== null,
    );
    if (access === undefined) throw new Error('no cai-access row');
    expect(within(access).getByText('Missing')).toBeDefined();
    expect(
      within(access).getByText('You cannot list assets in projects/demo-app-1, or it does not exist.'),
    ).toBeDefined();
    expect(within(access).getByText('403 PERMISSION_DENIED')).toBeDefined();
    expect(
      within(access).getByText(
        'gcloud projects add-iam-policy-binding demo-app-1 --member="user:ada@example.com" --role="roles/cloudasset.viewer"',
      ),
    ).toBeDefined();
    expect(
      within(checkSection()).getByText(/The Cloud Asset API is not enabled in demo-app-1/),
    ).toBeDefined();

    // The token went to this backend only, in the header, never into a URL.
    for (const url of backend.urls()) expect(url).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    await expectNoAxeViolations();
  });

  it('copies a command to the clipboard and says so', async () => {
    const writeText = stubClipboard();
    await openSignedIn();
    await pickFromSearch('demo', /Demo app 1/);
    await user.click(within(checkSection()).getByRole('button', { name: 'Check permissions' }));
    const copy = await within(checkSection()).findByRole('button', {
      name: 'Copy the command that grants roles/cloudasset.viewer on demo-app-1',
    });
    await user.click(copy);
    expect(writeText).toHaveBeenCalledWith(
      'gcloud projects add-iam-policy-binding demo-app-1 --member="user:ada@example.com" --role="roles/cloudasset.viewer"',
    );
    await within(checkSection()).findByText('Copied.');
  });

  it('takes a typed scope name, hints at a mistyped one, and remembers recent scopes', async () => {
    const preferences = createMemoryPreferenceStore();
    await openSignedIn(preferences);
    const field = within(checkSection()).getByRole('combobox', { name: 'Scope' });
    await user.type(field, 'folders/abc');
    expect(
      await within(checkSection()).findByText('A folder id is a number, such as folders/123456789012.'),
    ).toBeDefined();
    await user.clear(field);
    await user.type(field, 'organizations/30000000001');
    await user.click(await screen.findByRole('option', { name: /Use organizations\/30000000001/ }));
    expect(
      within(checkSection()).getByRole('button', { name: 'Clear scope organizations/30000000001' }),
    ).toBeDefined();
    await waitFor(async () => {
      expect((await preferences.get('recentScopes'))?.map((entry) => entry.scope)).toEqual([
        'organizations/30000000001',
      ]);
    });
    // An organisation needs a quota project: the field says so.
    expect(within(checkSection()).getByText(/A project of yours that pays for the requests/)).toBeDefined();
  });

  it('sends the quota project picked, and remembers it for the scope', async () => {
    const preferences = createMemoryPreferenceStore();
    const { bodies } = await openSignedIn(preferences);
    await pickFromSearch('web', /Web shop/);
    const quota = within(checkSection()).getByRole('combobox', { name: 'Quota project' });
    await user.type(quota, 'demo-quota-1');
    await user.click(await screen.findByRole('option', { name: /Use projects\/demo-quota-1/ }));
    await user.click(within(checkSection()).getByRole('button', { name: 'Check permissions' }));
    await waitFor(() => {
      expect(bodies('/api/preflight')).toEqual([
        { scope: 'folders/20000000001', mode: 'user', quotaProject: 'demo-quota-1' },
      ]);
    });
    await waitFor(async () => {
      expect(await preferences.get('quotaProjects')).toEqual({ 'folders/20000000001': 'demo-quota-1' });
    });
  });

  it('marks a result out of date when the scope changes', async () => {
    await openSignedIn();
    await pickFromSearch('demo', /Demo app 1/);
    await user.click(within(checkSection()).getByRole('button', { name: 'Check permissions' }));
    await within(checkSection()).findAllByText(/^Not ready yet/);
    await user.click(within(checkSection()).getByRole('button', { name: /^Clear scope/ }));
    await pickFromSearch('web', /Web shop/);
    expect(
      within(checkSection()).getByText(/This result is for another scope, mode or quota project/),
    ).toBeDefined();
  });

  it('checks in service-account mode without a quota project, and shows the account', async () => {
    const answer: PreflightAnswer = {
      scope: 'folders/20000000001',
      kind: 'folder',
      mode: 'sa',
      outcome: 'blocked',
      member: 'user:ada@example.com',
      serviceAccount: ACCOUNT_EMAIL,
      items: [
        {
          id: 'sa-caller',
          status: 'ok',
          finding: 'ok',
          blocking: true,
          permission: 'resourcemanager.folders.get',
          resource: 'folders/20000000001',
          commands: [],
        },
        {
          id: 'sa-exposure',
          status: 'missing',
          finding: 'exposed',
          blocking: true,
          permission: 'resourcemanager.folders.get',
          resource: 'folders/20000000001',
          commands: [],
        },
        {
          id: 'sa-access',
          status: 'unknown',
          finding: 'not-checked',
          blocking: true,
          permission: 'cloudasset.assets.listResource',
          resource: 'folders/20000000001',
          commands: [],
        },
      ],
      candidates: [],
    };
    const { bodies } = await openSignedIn(undefined, () => Response.json(answer));
    await user.click(within(checkSection()).getByRole('radio', { name: 'Service account' }));
    expect(within(checkSection()).queryByRole('combobox', { name: 'Quota project' })).toBeNull();
    await pickFromSearch('web', /Web shop/);
    await user.click(within(checkSection()).getByRole('button', { name: 'Check permissions' }));
    await within(checkSection()).findByText(/so service-account mode is refused for folders\/20000000001\.$/);
    expect(bodies('/api/preflight')).toEqual([{ scope: 'folders/20000000001', mode: 'sa' }]);
    await expectNoAxeViolations();
  });

  it('shows a failed check as an alert', async () => {
    await openSignedIn(undefined, () => Response.json({ message: 'Internal error.' }, { status: 500 }));
    await pickFromSearch('demo', /Demo app 1/);
    await user.click(within(checkSection()).getByRole('button', { name: 'Check permissions' }));
    const alert = await within(checkSection()).findByRole('alert');
    expect(alert.textContent).toContain('The backend could not answer (HTTP 500). Try again.');
  });
});

describe('the Permissions page, service-account mode', WHOLE_APP_TIMEOUT, () => {
  function section(): HTMLElement {
    return screen.getByRole('region', { name: 'Service-account mode' });
  }

  it('reads the account’s email from /api/config and words the gate as this instance runs it (default)', async () => {
    live();
    renderApp('/permissions', { demoConfig: null });
    await within(section()).findByText(ACCOUNT_EMAIL);
    expect(
      within(section()).getByText(/everyone who can sign in here passes the gate for a scope/),
    ).toBeDefined();
    const gate = within(section())
      .getByText(/The gate\./)
      .closest('p');
    expect(gate?.textContent).toMatch(/resourcemanager\.folders\.get/);
    expect(gate?.textContent).toMatch(
      /remembered for at most five minutes, for your sign-in and that scope only/,
    );
    expect(gate?.textContent).not.toMatch(/cannot see the scope’s details on its own/);
    expect(within(section()).queryByText(/service-account mode is refused/)).toBeNull();
    await expectNoAxeViolations();
  });

  it('says so when the instance runs the strict exposure check', async () => {
    live(undefined, { ...CONFIG, saStrictExposure: true });
    renderApp('/permissions', { demoConfig: null });
    await within(section()).findByText(ACCOUNT_EMAIL);
    expect(
      within(section()).getByText(
        /This instance also checks that the service account cannot see the scope’s details/,
      ),
    ).toBeDefined();
    expect(within(section()).getByText(/service-account mode is refused for a scope\.$/)).toBeDefined();
  });

  it('names no account when the instance does not offer the mode', async () => {
    live(undefined, { ...CONFIG, saMode: false, saStrictExposure: true });
    renderApp('/permissions', { demoConfig: null });
    await within(section()).findByText(/This instance does not offer service-account mode/);
    expect(within(section()).queryByText(ACCOUNT_EMAIL)).toBeNull();
    expect(within(section()).queryByText(/This instance also checks/)).toBeNull();
  });

  it('shows the checklist of a check the gate refused (403), not an error', async () => {
    const refused: PreflightAnswer = {
      scope: 'folders/20000000001',
      kind: 'folder',
      mode: 'sa',
      outcome: 'blocked',
      member: 'user:ada@example.com',
      serviceAccount: ACCOUNT_EMAIL,
      items: [
        {
          id: 'sa-caller',
          status: 'missing',
          finding: 'denied',
          blocking: true,
          permission: 'resourcemanager.folders.get',
          role: 'roles/browser',
          member: 'user:ada@example.com',
          resource: 'folders/20000000001',
          commands: [
            'gcloud resource-manager folders add-iam-policy-binding 20000000001 --member="user:ada@example.com" --role="roles/browser"',
          ],
        },
        {
          id: 'sa-access',
          status: 'unknown',
          finding: 'not-checked',
          blocking: true,
          permission: 'cloudasset.assets.listResource',
          resource: 'folders/20000000001',
          commands: [],
        },
      ],
      candidates: [],
    };
    await openSignedIn(undefined, () =>
      Response.json(
        {
          statusCode: 403,
          error: 'Forbidden',
          message: 'You cannot see folders/20000000001 yourself.',
          requestId: 'req-1',
          code: 'SA_GATE_CALLER_DENIED',
          preflight: refused,
        },
        { status: 403 },
      ),
    );
    await user.click(within(checkSection()).getByRole('radio', { name: 'Service account' }));
    await pickFromSearch('web', /Web shop/);
    await user.click(within(checkSection()).getByRole('button', { name: 'Check permissions' }));
    await within(checkSection()).findByText(
      'You cannot see folders/20000000001 yourself, so service-account mode is refused for it.',
    );
    expect(
      within(checkSection()).getByText(
        'gcloud resource-manager folders add-iam-policy-binding 20000000001 --member="user:ada@example.com" --role="roles/browser"',
      ),
    ).toBeDefined();
    expect(within(checkSection()).queryByRole('alert')).toBeNull();
  });

  it('a 403 without a checklist is still an error with the backend’s message', async () => {
    await openSignedIn(undefined, () =>
      Response.json(
        {
          statusCode: 403,
          error: 'Forbidden',
          message: 'Service-account mode is off on this gcportrait instance.',
          requestId: 'r',
        },
        { status: 403 },
      ),
    );
    await pickFromSearch('demo', /Demo app 1/);
    await user.click(within(checkSection()).getByRole('button', { name: 'Check permissions' }));
    const alert = await within(checkSection()).findByRole('alert');
    expect(alert.textContent).toContain('Service-account mode is off on this gcportrait instance.');
  });
});

describe('the Permissions page', WHOLE_APP_TIMEOUT, () => {
  it('says in demo mode that nothing can be checked here, and keeps the guidance', async () => {
    const { fetch } = stubBackend();
    renderApp('/permissions', {});
    expect(screen.getByText(/This instance is a demo/)).toBeDefined();
    expect(screen.queryByRole('region', { name: 'Check a scope' })).toBeNull();
    expect(screen.getByRole('region', { name: 'What each mode needs' })).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
    await expectNoAxeViolations();
  });
});
