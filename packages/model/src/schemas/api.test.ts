// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import {
  LegalPagesSchema,
  LegalTextsSchema,
  PreflightItemSchema,
  PreflightResponseSchema,
  PublicConfigSchema,
  QuotaCandidateSchema,
  ScopeSearchResponseSchema,
  type PreflightResponse,
  type PublicConfig,
  type ScopeSearchResponse,
} from './api.js';
import {
  PREFLIGHT_FINDINGS,
  PREFLIGHT_ITEM_IDS,
  PREFLIGHT_ITEM_STATUSES,
  PREFLIGHT_MODES,
  PREFLIGHT_OUTCOMES,
  QUOTA_CANDIDATE_RESULTS,
  QUOTA_CANDIDATE_SOURCES,
} from './api-vocabulary.js';

const CONFIG: PublicConfig = {
  oauthClientId: 'client-1.apps.example.com',
  saMode: true,
  saStrictExposure: false,
  backendServiceAccount: 'gcportrait-backend@demo-host.iam.gserviceaccount.com',
  version: '1.0.0',
  sourceUrl: 'https://example.com/gcportrait',
  hostedBy: 'Hosted by Example.',
  demo: false,
  demoOnly: false,
  legal: { impressum: true, privacy: false, impressumUrl: null, privacyUrl: 'https://example.org/privacy' },
  render: { maxAssets: 50_000, maxPixels: 64_000_000, maxBodyBytes: 52_428_800, timeoutMs: 120_000 },
};

describe('GET /api/config', () => {
  it('accepts what an instance answers, and a demo-only one without OAuth client, account or render API', () => {
    expect(PublicConfigSchema.parse(CONFIG)).toEqual(CONFIG);
    const demoOnly: PublicConfig = {
      ...CONFIG,
      oauthClientId: null,
      saMode: false,
      backendServiceAccount: null,
      hostedBy: null,
      demoOnly: true,
      legal: { impressum: false, privacy: false, impressumUrl: null, privacyUrl: null },
      render: null,
    };
    expect(PublicConfigSchema.parse(demoOnly)).toEqual(demoOnly);
  });

  it.each(['saStrictExposure', 'hostedBy', 'demoOnly', 'legal', 'render', 'sourceUrl'] as const)(
    'requires %s, which every instance sends',
    (field) => {
      const rest = Object.fromEntries(Object.entries(CONFIG).filter(([key]) => key !== field));
      expect(PublicConfigSchema.safeParse(rest).success).toBe(false);
    },
  );

  it('refuses a demo flag that is not false and a render limit that is not an integer', () => {
    expect(PublicConfigSchema.safeParse({ ...CONFIG, demo: true }).success).toBe(false);
    expect(
      PublicConfigSchema.safeParse({ ...CONFIG, render: { ...CONFIG.render, timeoutMs: 1.5 } }).success,
    ).toBe(false);
  });

  it('names both legal pages, each served, linked or neither', () => {
    expect(LegalPagesSchema.safeParse({ impressum: false, privacy: false }).success).toBe(false);
    expect(
      LegalPagesSchema.safeParse({ impressum: false, privacy: false, impressumUrl: 1, privacyUrl: null })
        .success,
    ).toBe(false);
  });
});

describe('GET /api/legal', () => {
  it('holds the Markdown of each page, or null for a page the instance does not serve', () => {
    expect(LegalTextsSchema.parse({ impressum: '# Impressum', privacy: null })).toEqual({
      impressum: '# Impressum',
      privacy: null,
    });
    expect(LegalTextsSchema.safeParse({ impressum: '# Impressum' }).success).toBe(false);
  });
});

describe('POST /api/preflight', () => {
  const ANSWER: PreflightResponse = {
    scope: 'projects/demo-app-1',
    kind: 'project',
    mode: 'user',
    outcome: 'blocked',
    displayName: 'Demo app 1',
    member: 'user:ada@example.com',
    items: [
      {
        id: 'cai-access',
        status: 'missing',
        finding: 'denied',
        blocking: true,
        permission: 'cloudasset.assets.listResource',
        role: 'roles/cloudasset.viewer',
        member: 'user:ada@example.com',
        resource: 'projects/demo-app-1',
        commands: ['gcloud projects add-iam-policy-binding demo-app-1 --member="user:ada@example.com"'],
        upstream: { status: 403, code: 'PERMISSION_DENIED' },
      },
    ],
    candidates: [{ project: 'demo-app-1', source: 'scope', result: 'usable', commands: [] }],
  };

  it('accepts what the backend answers, and refuses an unknown finding', () => {
    expect(PreflightResponseSchema.parse(ANSWER)).toEqual(ANSWER);
    const [item] = ANSWER.items;
    expect(
      PreflightResponseSchema.safeParse({ ...ANSWER, items: [{ ...item, finding: 'nope' }] }).success,
    ).toBe(false);
  });

  it('builds its closed lists from the zod-free tuples', () => {
    expect(PreflightItemSchema.shape.id.options).toEqual([...PREFLIGHT_ITEM_IDS]);
    expect(PreflightItemSchema.shape.status.options).toEqual([...PREFLIGHT_ITEM_STATUSES]);
    expect(PreflightItemSchema.shape.finding.options).toEqual([...PREFLIGHT_FINDINGS]);
    expect(QuotaCandidateSchema.shape.source.options).toEqual([...QUOTA_CANDIDATE_SOURCES]);
    expect(QuotaCandidateSchema.shape.result.options).toEqual([...QUOTA_CANDIDATE_RESULTS]);
    expect(PreflightResponseSchema.shape.mode.options).toEqual([...PREFLIGHT_MODES]);
    expect(PreflightResponseSchema.shape.outcome.options).toEqual([...PREFLIGHT_OUTCOMES]);
  });
});

describe('POST /api/scopes/search', () => {
  it('accepts a page of results with a failed kind, and refuses a problem without Google’s answer', () => {
    const answer: ScopeSearchResponse = {
      scopes: [
        {
          kind: 'project',
          scope: 'projects/demo-web-1',
          id: 'demo-web-1',
          displayName: 'Web',
          parent: 'folders/20000000001',
          projectNumber: '10000000001',
        },
      ],
      nextPageToken: 'eyJmb2xkZXIiOiJhYmMifQ',
      problems: [{ kind: 'folder', upstream: { status: 0 } }],
    };
    expect(ScopeSearchResponseSchema.parse(answer)).toEqual(answer);
    expect(ScopeSearchResponseSchema.safeParse({ ...answer, problems: [{ kind: 'folder' }] }).success).toBe(
      false,
    );
  });
});
