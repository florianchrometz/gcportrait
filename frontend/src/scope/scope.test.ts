// @vitest-environment node
// SPDX-License-Identifier: MIT
import { NumericIdSchema, ProjectRefSchema } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { readSearchAnswer } from './api';
import {
  MAX_QUOTA_PROJECTS,
  MAX_RECENT_SCOPES,
  parseQuotaProjects,
  parseRecentScopes,
  withQuotaProject,
  withRecent,
} from './recent';
import { typedChoice } from './ScopePicker';
import {
  describeScope,
  isProjectRef,
  NUMBER_PATTERN,
  parseScopeName,
  PROJECT_REF_PATTERN,
  scopeNameProblem,
  type ScopeChoice,
} from './scopeName';

const SAMPLES = [
  '',
  '0',
  '1',
  '0123',
  '123',
  '30000000001',
  '-1',
  '1.5',
  'demo-app-1',
  'Demo-App',
  'demo app',
  'example.com:demo',
  '-demo',
  'demo_app',
  'demo/app',
  'ä',
  '1e5',
  ' 12',
];

describe('the scope name patterns', () => {
  it.each(SAMPLES)('agree with @gcportrait/model’s schemas on %j', (sample) => {
    expect(NUMBER_PATTERN.test(sample)).toBe(NumericIdSchema.safeParse(sample).success);
    expect(PROJECT_REF_PATTERN.test(sample)).toBe(ProjectRefSchema.safeParse(sample).success);
  });
});

describe('parseScopeName', () => {
  it.each([
    ['organizations/30000000001', 'organization', '30000000001'],
    ['folders/20000000001', 'folder', '20000000001'],
    ['projects/demo-app-1', 'project', 'demo-app-1'],
    ['projects/10000000001', 'project', '10000000001'],
    ['  projects/demo-app-1  ', 'project', 'demo-app-1'],
  ] as const)('reads %j', (text, kind, id) => {
    expect(parseScopeName(text)).toEqual({ kind, id, scope: text.trim() });
  });

  it.each([
    '',
    'demo-app-1',
    'projects/',
    'projects/Demo',
    'organizations/abc',
    'folders/0',
    'billingAccounts/1',
    'projects/a/b',
  ])('refuses %j', (text) => {
    expect(parseScopeName(text)).toBeNull();
  });

  it('explains what is wrong with text that starts like a scope name', () => {
    expect(scopeNameProblem('web')).toBeNull();
    expect(scopeNameProblem('projects/demo-app-1')).toBeNull();
    expect(scopeNameProblem('organizations/')).toBe('Type the organisation number after the slash.');
    expect(scopeNameProblem('organizations/example')).toBe(
      'An organisation id is a number, such as organizations/123456789012.',
    );
    expect(scopeNameProblem('folders/x')).toBe('A folder id is a number, such as folders/123456789012.');
    expect(scopeNameProblem('projects/My Project')).toMatch(/^A project id has lower-case letters/);
    expect(scopeNameProblem('billing/1')).toBe('A scope is organizations/ID, folders/ID or projects/ID.');
  });

  it('describes a choice by its name and display name', () => {
    expect(describeScope({ scope: 'projects/demo-app-1', displayName: 'Demo app 1' })).toBe(
      'Demo app 1 (projects/demo-app-1)',
    );
    expect(describeScope({ scope: 'projects/demo-app-1' })).toBe('projects/demo-app-1');
  });

  it('takes project ids and numbers as quota projects', () => {
    expect(isProjectRef('demo-quota-1')).toBe(true);
    expect(isProjectRef('projects/demo')).toBe(false);
    expect(isProjectRef('')).toBe(false);
  });
});

describe('typedChoice', () => {
  const ALL = ['organization', 'folder', 'project'] as const;
  it('offers a typed scope name of an allowed kind', () => {
    expect(typedChoice('folders/20000000001', ALL)).toMatchObject({ kind: 'folder' });
    expect(typedChoice('folders/20000000001', ['project'])).toBeNull();
    expect(typedChoice('demo-app-1', ALL)).toBeNull();
  });
  it('takes a bare project id in a project-only picker', () => {
    expect(typedChoice('demo-quota-1', ['project'])).toEqual({
      kind: 'project',
      scope: 'projects/demo-quota-1',
      id: 'demo-quota-1',
    });
    expect(typedChoice('Demo Quota', ['project'])).toBeNull();
  });
});

const choice = (index: number): ScopeChoice => ({
  kind: 'project',
  scope: `projects/demo-app-${String(index)}`,
  id: `demo-app-${String(index)}`,
});

describe('recent scopes and quota projects (preferences)', () => {
  it('keeps the newest first, without repeats, at most eight', () => {
    let list: readonly ScopeChoice[] = [];
    for (let index = 1; index <= 10; index += 1) list = withRecent(list, choice(index));
    expect(list).toHaveLength(MAX_RECENT_SCOPES);
    expect(list[0]?.scope).toBe('projects/demo-app-10');
    list = withRecent(list, choice(5));
    expect(list[0]?.scope).toBe('projects/demo-app-5');
    expect(list.filter((entry) => entry.scope === 'projects/demo-app-5')).toHaveLength(1);
  });

  it('reads back only valid entries', () => {
    expect(parseRecentScopes('nope')).toBeUndefined();
    expect(
      parseRecentScopes([
        { kind: 'project', scope: 'projects/demo-app-1', id: 'demo-app-1', displayName: 'Demo app 1' },
        { scope: 'projects/demo-app-1' },
        { scope: 'projects/Bad Id' },
        { scope: 'folders/20000000001', parent: 'javascript:alert(1)' },
        42,
      ]),
    ).toEqual([
      { kind: 'project', scope: 'projects/demo-app-1', id: 'demo-app-1', displayName: 'Demo app 1' },
      { kind: 'folder', scope: 'folders/20000000001', id: '20000000001' },
    ]);
  });

  it('remembers a quota project per scope, and forgets it on request', () => {
    let map = withQuotaProject({}, 'organizations/30000000001', 'demo-quota-1');
    map = withQuotaProject(map, 'folders/20000000001', 'demo-quota-2');
    expect(map).toEqual({
      'organizations/30000000001': 'demo-quota-1',
      'folders/20000000001': 'demo-quota-2',
    });
    expect(withQuotaProject(map, 'folders/20000000001', null)).toEqual({
      'organizations/30000000001': 'demo-quota-1',
    });
    expect(
      parseQuotaProjects({
        'projects/demo-app-1': 'demo-quota-1',
        nonsense: 'x',
        'folders/1': 'Bad',
        'folders/2': 3,
      }),
    ).toEqual({ 'projects/demo-app-1': 'demo-quota-1' });
    let big: Readonly<Record<string, string>> = {};
    for (let index = 1; index <= MAX_QUOTA_PROJECTS + 5; index += 1) {
      big = withQuotaProject(big, `folders/${String(index)}`, 'demo-quota-1');
    }
    expect(Object.keys(big)).toHaveLength(MAX_QUOTA_PROJECTS);
  });
});

describe('the search answer', () => {
  it('reads the backend’s answer and drops results whose scope name it does not read', () => {
    expect(
      readSearchAnswer({
        scopes: [
          {
            kind: 'organization',
            scope: 'organizations/30000000001',
            id: '30000000001',
            displayName: 'example.com',
          },
          {
            kind: 'project',
            scope: 'projects/demo-web-1',
            id: 'demo-web-1',
            displayName: 'Web',
            parent: 'folders/20000000001',
            projectNumber: '10000000001',
          },
          { kind: 'project', scope: 'folders/20000000001', id: 'x', displayName: 'kind mismatch' },
          { kind: 'project', scope: 'projects/Bad', id: 'Bad', displayName: 'bad id' },
        ],
        nextPageToken: 'abc',
        problems: [{ kind: 'folder', upstream: { status: 503, code: 'UNAVAILABLE' } }],
      }),
    ).toEqual({
      kind: 'ok',
      scopes: [
        {
          kind: 'organization',
          scope: 'organizations/30000000001',
          id: '30000000001',
          displayName: 'example.com',
        },
        {
          kind: 'project',
          scope: 'projects/demo-web-1',
          id: 'demo-web-1',
          displayName: 'Web',
          parent: 'folders/20000000001',
        },
      ],
      nextPageToken: 'abc',
      problems: [{ kind: 'folder', upstream: { status: 503, code: 'UNAVAILABLE' } }],
    });
  });

  it('refuses an answer that does not fit the contract', () => {
    const answer = { scopes: [], problems: [] };
    expect(readSearchAnswer(answer)).toEqual({ kind: 'ok', scopes: [], problems: [] });
    expect(readSearchAnswer({ scopes: 'x' })).toBeNull();
    expect(readSearchAnswer({ ...answer, scopes: ['nonsense'] })).toBeNull();
    expect(readSearchAnswer({ ...answer, problems: [{ kind: 'x' }] })).toBeNull();
  });
});
