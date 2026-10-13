// SPDX-License-Identifier: MIT
/**
 * `POST /api/scopes/search` over HTTP against a pretend Resource Manager: the queries sent for what the person
 * typed, the mapping of the three kinds, pagination across them, partial and total failures, and the refusals.
 */
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { answers, fakeGoogle, type FakeGoogle, type Handler } from '../preflight/google.testing.js';
import { startTestServer } from '../server.testing.js';
import { CALLER_TOKEN, jsonResponse, type RecordedCall } from '../upstream/google.testing.js';
import {
  decodePageToken,
  encodePageToken,
  matchesText,
  ScopeSearchResponseSchema,
  searchTerms,
  upstreamQuery,
  type ScopeSearchResponse,
} from './scopes.js';

const ORGANIZATIONS = [
  { name: 'organizations/30000000001', displayName: 'example.com', state: 'ACTIVE' },
  { name: 'organizations/30000000002', displayName: 'example.org', state: 'ACTIVE' },
];
const FOLDERS = [
  {
    name: 'folders/20000000001',
    parent: 'organizations/30000000001',
    displayName: 'Web shop',
    state: 'ACTIVE',
  },
];
const PROJECTS = [
  {
    name: 'projects/10000000001',
    parent: 'folders/20000000001',
    projectId: 'demo-web-1',
    displayName: 'Web front end',
    state: 'ACTIVE',
  },
  // No display name: the id stands in.
  {
    name: 'projects/10000000002',
    parent: 'organizations/30000000001',
    projectId: 'demo-web-2',
    state: 'ACTIVE',
  },
];

function kindOf(call: RecordedCall): string {
  return call.url.pathname.replace('/v3/', '').replace(':search', '');
}

/** Resource Manager search: each kind's list, or a handler per kind. */
function searchBy(table: Readonly<Record<string, (call: RecordedCall) => Response>>): Handler {
  return (call) => table[kindOf(call)]?.(call);
}

const ALL = searchBy({
  organizations: () => jsonResponse(200, { organizations: ORGANIZATIONS }),
  folders: () => jsonResponse(200, { folders: FOLDERS }),
  projects: () => jsonResponse(200, { projects: PROJECTS }),
});

async function start(search: Handler = ALL): Promise<{ app: FastifyInstance; google: FakeGoogle }> {
  const google = fakeGoogle({ search });
  const { app } = await startTestServer({ fetch: google.fetch });
  return { app, google };
}

function search(app: FastifyInstance, body: unknown) {
  return app.inject({
    method: 'POST',
    url: '/api/scopes/search',
    headers: { authorization: `Bearer ${CALLER_TOKEN}` },
    payload: body as Record<string, unknown>,
  });
}

function parsed(response: { json: () => unknown }): ScopeSearchResponse {
  return ScopeSearchResponseSchema.parse(response.json());
}

describe('the query sent to Resource Manager', () => {
  it('splits the text into at most five safe terms', () => {
    expect(searchTerms('  web  shop ')).toEqual({ terms: ['web', 'shop'], complete: true });
    expect(searchTerms('demo-web_1.x')).toEqual({ terms: ['demo-web_1.x'], complete: true });
    expect(searchTerms('name:"x" OR (y)')).toEqual({ terms: ['name', 'x', 'OR', 'y'], complete: false });
    expect(searchTerms('Müller')).toEqual({ terms: ['M', 'ller'], complete: false });
    expect(searchTerms('a b c d e f').terms).toHaveLength(5);
    expect(searchTerms('a b c d e f').complete).toBe(false);
    expect(searchTerms('')).toEqual({ terms: [], complete: true });
  });

  it('is a substring match per term, for active folders and projects; organisations take none', () => {
    expect(upstreamQuery('project', ['web', 'shop'])).toBe(
      'state:ACTIVE AND (name:*web* OR id:*web*) AND (name:*shop* OR id:*shop*)',
    );
    expect(upstreamQuery('folder', ['web'])).toBe('state:ACTIVE AND displayName:*web*');
    expect(upstreamQuery('folder', [])).toBe('state:ACTIVE');
    expect(upstreamQuery('organization', ['web'])).toBeUndefined();
  });

  it('matches locally by every word, case-insensitively, in the name or the id', () => {
    expect(matchesText('EXAMPLE', { displayName: 'example.com', id: '1' })).toBe(true);
    expect(matchesText('3000 com', { displayName: 'example.com', id: '30000000001' })).toBe(true);
    expect(matchesText('müller', { displayName: 'Müller GmbH', id: '1' })).toBe(true);
    expect(matchesText('other', { displayName: 'example.com', id: '1' })).toBe(false);
  });

  it('round-trips its page token and refuses anything it did not write', () => {
    const token = encodePageToken({ project: 'abc123', folder: 'def=' });
    expect(token).toBeDefined();
    expect(decodePageToken(token ?? '')).toEqual({ folder: 'def=', project: 'abc123' });
    expect(encodePageToken({})).toBeUndefined();
    for (const bad of [
      'not base64 at all!',
      Buffer.from('[]').toString('base64url'),
      Buffer.from('{}').toString('base64url'),
      Buffer.from('{"billing":"x"}').toString('base64url'),
      Buffer.from('{"project":"a&query=evil"}').toString('base64url'),
      Buffer.from(`{"project":"${'x'.repeat(3000)}"}`).toString('base64url'),
      Buffer.from('{"project":42}').toString('base64url'),
    ])
      expect(decodePageToken(bad), bad).toBeNull();
  });
});

describe('POST /api/scopes/search', () => {
  it('lists organisations, folders and projects with kind, scope, id, display name and parent', async () => {
    const { app, google } = await start();
    const response = await search(app, { query: '' });
    expect(response.statusCode).toBe(200);
    expect(parsed(response)).toEqual({
      scopes: [
        {
          kind: 'organization',
          scope: 'organizations/30000000001',
          id: '30000000001',
          displayName: 'example.com',
        },
        {
          kind: 'organization',
          scope: 'organizations/30000000002',
          id: '30000000002',
          displayName: 'example.org',
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
          scope: 'projects/demo-web-1',
          id: 'demo-web-1',
          displayName: 'Web front end',
          parent: 'folders/20000000001',
          projectNumber: '10000000001',
        },
        {
          kind: 'project',
          scope: 'projects/demo-web-2',
          id: 'demo-web-2',
          displayName: 'demo-web-2',
          parent: 'organizations/30000000001',
          projectNumber: '10000000002',
        },
      ],
      problems: [],
    });
    const calls = google.callsTo('search');
    expect(calls.map((call) => [call.method, kindOf(call), call.token])).toEqual([
      ['GET', 'organizations', CALLER_TOKEN],
      ['GET', 'folders', CALLER_TOKEN],
      ['GET', 'projects', CALLER_TOKEN],
    ]);
    expect(calls.every((call) => call.url.searchParams.get('pageSize') === '30')).toBe(true);
    expect(calls.every((call) => !call.headers.has('x-goog-user-project'))).toBe(true);
  });

  it('sends the typed terms to Resource Manager and filters organisations itself', async () => {
    const { app, google } = await start();
    const response = await search(app, { query: 'web' });
    const body = parsed(response);
    // Organisations matched locally ("web" is in neither); folders and projects as Resource Manager answered.
    expect(body.scopes.map((entry) => entry.scope)).toEqual([
      'folders/20000000001',
      'projects/demo-web-1',
      'projects/demo-web-2',
    ]);
    const queries = Object.fromEntries(
      google.callsTo('search').map((call) => [kindOf(call), call.url.searchParams.get('query')]),
    );
    expect(queries).toEqual({
      organizations: null,
      folders: 'state:ACTIVE AND displayName:*web*',
      projects: 'state:ACTIVE AND (name:*web* OR id:*web*)',
    });
  });

  it('matches text Resource Manager cannot query (non-ASCII letters) locally', async () => {
    const { app } = await start(
      searchBy({
        organizations: () => jsonResponse(200, {}),
        folders: () =>
          jsonResponse(200, {
            folders: [
              { name: 'folders/20000000003', displayName: 'Müller Einkauf', state: 'ACTIVE' },
              { name: 'folders/20000000004', displayName: 'Mailer', state: 'ACTIVE' },
            ],
          }),
        projects: () => jsonResponse(200, {}),
      }),
    );
    const body = parsed(await search(app, { query: 'müller' }));
    expect(body.scopes.map((entry) => entry.displayName)).toEqual(['Müller Einkauf']);
  });

  it('treats a search that finds nothing ({}) as empty lists', async () => {
    const { app } = await start(() => jsonResponse(200, {}));
    expect(parsed(await search(app, { query: 'nothing' }))).toEqual({ scopes: [], problems: [] });
  });

  it('searches only the kinds asked for', async () => {
    const { app, google } = await start();
    const body = parsed(await search(app, { query: '', kinds: ['project'] }));
    expect(body.scopes.every((entry) => entry.kind === 'project')).toBe(true);
    expect(google.callsTo('search').map(kindOf)).toEqual(['projects']);
  });

  it('skips malformed and inactive entries', async () => {
    const { app } = await start(
      searchBy({
        organizations: () =>
          jsonResponse(200, {
            organizations: [{ name: 'organizations/x', displayName: 'bad' }, { displayName: 'no name' }],
          }),
        folders: () =>
          jsonResponse(200, {
            folders: [
              { name: 'folders/20000000005', displayName: 'Going', state: 'DELETE_REQUESTED' },
              {
                name: 'folders/20000000006',
                displayName: 'Odd parent',
                parent: 'billingAccounts/1',
                state: 'ACTIVE',
              },
            ],
          }),
        projects: () =>
          jsonResponse(200, { projects: [{ name: 'projects/1', projectId: 'Bad Id' }, 'not an object'] }),
      }),
    );
    const body = parsed(await search(app, { query: '' }));
    expect(body.scopes).toEqual([
      { kind: 'folder', scope: 'folders/20000000006', id: '20000000006', displayName: 'Odd parent' },
    ]);
  });

  it('pages through every kind with one opaque token', async () => {
    const pagedProjects = (call: RecordedCall): Response => {
      const page = call.url.searchParams.get('pageToken');
      return page === null
        ? jsonResponse(200, { projects: [PROJECTS[0]], nextPageToken: 'p2' })
        : jsonResponse(200, { projects: [PROJECTS[1]] });
    };
    const { app, google } = await start(
      searchBy({
        organizations: () => jsonResponse(200, { organizations: ORGANIZATIONS }),
        folders: (call) =>
          call.url.searchParams.has('pageToken')
            ? jsonResponse(200, {})
            : jsonResponse(200, { folders: FOLDERS, nextPageToken: 'f2' }),
        projects: pagedProjects,
      }),
    );
    const first = parsed(await search(app, { query: '' }));
    expect(first.nextPageToken).toBeDefined();
    const second = parsed(await search(app, { query: '', pageToken: first.nextPageToken }));
    expect(second.scopes.map((entry) => entry.scope)).toEqual(['projects/demo-web-2']);
    expect(second.nextPageToken).toBeUndefined();
    // The second page asks only the kinds that had more, each with its own token.
    const later = google.callsTo('search').slice(3);
    expect(later.map((call) => [kindOf(call), call.url.searchParams.get('pageToken')])).toEqual([
      ['folders', 'f2'],
      ['projects', 'p2'],
    ]);
  });

  it('lists a failing kind under problems and still answers with the others', async () => {
    const { app } = await start(
      searchBy({
        organizations: () => jsonResponse(200, { organizations: ORGANIZATIONS }),
        folders: () => answers.unavailable(),
        projects: () => jsonResponse(200, { projects: PROJECTS }),
      }),
    );
    const body = parsed(await search(app, { query: '' }));
    expect(body.scopes).toHaveLength(4);
    expect(body.problems).toEqual([
      {
        kind: 'folder',
        upstream: { status: 503, code: 'UNAVAILABLE', message: 'The service is currently unavailable.' },
      },
    ]);
  });

  it('retries a transient answer once (the picker is interactive)', async () => {
    let calls = 0;
    const { app } = await start(
      searchBy({
        organizations: () => jsonResponse(200, {}),
        folders: () => jsonResponse(200, {}),
        projects: () => {
          calls += 1;
          return calls === 1 ? answers.rateLimited() : jsonResponse(200, { projects: PROJECTS });
        },
      }),
    );
    const body = parsed(await search(app, { query: '' }));
    expect(body.scopes).toHaveLength(2);
    expect(calls).toBe(2);
  });

  it('answers 403 when the token lacks Resource Manager’s OAuth scope everywhere', async () => {
    const { app } = await start(() => answers.scopeInsufficient('cloudresourcemanager.googleapis.com'));
    const response = await search(app, { query: '' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      upstream: { status: 403, reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' },
    });
  });

  it('answers 502 when no kind answered, and 401 when Google refused the token', async () => {
    const { app: down } = await start(() => answers.internal());
    expect((await search(down, { query: '' })).statusCode).toBe(502);
    const { app: refused } = await start(() => answers.unauthenticated());
    const response = await search(refused, { query: '' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('takes the token from X-Gcportrait-Token (the app, IAP or not) or Authorization: Bearer, and forwards it as a bearer token', async () => {
    const { app, google } = await start();
    const send = (headers: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/api/scopes/search', headers, payload: { query: '' } });
    // What the app sends behind Identity-Aware Proxy: its own header, IAP's assertion, no Authorization
    // (agents.md, Security and privacy, Tokens).
    const behindIap = await send({
      'x-gcportrait-token': CALLER_TOKEN,
      'x-goog-iap-jwt-assertion': 'eyJhbGciOiJFUzI1NiJ9.iap.signature',
    });
    expect(behindIap.statusCode).toBe(200);
    // The non-IAP path: a script with curl and a bearer header.
    expect((await send({ authorization: `Bearer ${CALLER_TOKEN}` })).statusCode).toBe(200);
    const searches = google.calls.filter((call) => call.url.pathname.endsWith(':search'));
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.every((call) => call.token === CALLER_TOKEN)).toBe(true);

    // Nothing else counts as the caller's token, and a malformed dedicated header is not replaced by Authorization.
    const before = google.calls.length;
    for (const headers of [
      { 'proxy-authorization': `Bearer ${CALLER_TOKEN}` },
      { 'x-gcportrait-token': `Bearer ${CALLER_TOKEN}` },
      { 'x-gcportrait-token': 'not a token', authorization: `Bearer ${CALLER_TOKEN}` },
    ]) {
      const response = await send(headers);
      expect(response.statusCode, JSON.stringify(Object.keys(headers))).toBe(401);
      expect(response.json()).toMatchObject({
        message: 'Sign in first: this request needs your Google access token.',
      });
    }
    expect(google.calls.length).toBe(before);
  });

  it('refuses invalid bodies (400) before calling Google', async () => {
    const { app, google } = await start();
    for (const body of [
      { query: 'x'.repeat(101) },
      { query: 'line\nbreak' },
      { query: '', kinds: [] },
      { query: '', kinds: ['billingAccount'] },
      { query: '', pageSize: 0 },
      { query: '', pageSize: 101 },
      { query: '', pageToken: 'garbage!' },
      { query: '', extra: 1 },
      { query: 7 },
    ]) {
      const response = await search(app, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(google.calls).toHaveLength(0);
  });
});
