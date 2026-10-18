// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { parseScope, QuotaProjectSchema, scopePath, ScopeNameSchema } from './scope.js';

describe('parseScope', () => {
  it.each([
    ['organizations/30000000001', 'organization', '30000000001'],
    ['folders/20000000001', 'folder', '20000000001'],
    ['projects/demo-app-1', 'project', 'demo-app-1'],
    ['projects/10000000001', 'project', '10000000001'],
    ['projects/example.com:demo-app', 'project', 'example.com:demo-app'],
  ] as const)('reads %s', (text, kind, id) => {
    expect(parseScope(text)).toEqual({ kind, id, name: text });
  });

  it.each([
    '',
    'projects',
    'projects/',
    'projects/Demo',
    'projects/demo app',
    'projects/demo/assets',
    'projects/-demo',
    'organizations/0123',
    'organizations/12a',
    'organizations/',
    'folders/1.5',
    'folders/-1',
    'billingAccounts/0X0X0X',
    'Projects/demo-app-1',
    ' projects/demo-app-1',
    'projects/demo-app-1 ',
    `projects/${'a'.repeat(101)}`,
    `organizations/${'1'.repeat(101)}`,
    // Not a project as Google names one: the host is fixed anyway, but such a call cannot succeed.
    'projects/evil.com',
    'projects/demo',
    'projects/1demo-app',
    'projects/demo-app-',
    `projects/a${'b'.repeat(30)}`,
    'projects/0123',
    'projects/example.com:',
    'projects/:demo-app',
    'projects/example:demo-app',
    'projects/example..com:demo-app',
  ])('refuses %j', (text) => {
    expect(parseScope(text)).toBeNull();
  });

  it('builds the path with the id encoded', () => {
    const scope = parseScope('projects/example.com:demo-app');
    expect(scope === null ? null : scopePath(scope)).toBe('projects/example.com%3Ademo-app');
  });

  it('validates through the body schema without echoing the value', () => {
    expect(ScopeNameSchema.parse('folders/20000000001')).toEqual({
      kind: 'folder',
      id: '20000000001',
      name: 'folders/20000000001',
    });
    const result = ScopeNameSchema.safeParse('projects/<script>');
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('<script>');
  });

  it('takes a project id or number as the quota project, nothing else', () => {
    for (const ok of ['demo-quota-1', '10000000001', 'example.com:demo'])
      expect(QuotaProjectSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      '',
      'Demo',
      'demo quota',
      'demo\r\nx: y',
      'projects/demo',
      'a'.repeat(101),
      'evil.com',
      'demo',
      'demo-quota-',
    ])
      expect(QuotaProjectSchema.safeParse(bad).success, bad).toBe(false);
  });
});
