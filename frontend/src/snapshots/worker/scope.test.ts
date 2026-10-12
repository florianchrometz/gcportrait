// @vitest-environment node
// SPDX-License-Identifier: MIT
import type { Asset } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { inferScope } from './scope';

function asset(name: string, ancestors: string[], data: unknown = {}): Asset {
  return {
    name,
    assetType: 'compute.googleapis.com/Instance',
    ancestors,
    updateTime: '2026-10-08T00:00:00Z',
    data,
  };
}

const ORG = 'organizations/30000000001';

describe('inferScope', () => {
  it('names the organisation every ancestor list ends at, with its display name', () => {
    expect(
      inferScope([
        asset('//cloudresourcemanager.googleapis.com/organizations/30000000001', [ORG], {
          displayName: 'example.com',
        }),
        asset('//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instances/web-1', [
          'projects/10000000001',
          'folders/20000000001',
          ORG,
        ]),
      ]),
    ).toEqual({ scope: { kind: 'organization', id: '30000000001', displayName: 'example.com' }, roots: 1 });
  });

  it('takes the root most assets share, the organisation id without a display name, and counts the roots', () => {
    expect(
      inferScope([
        asset('//a.googleapis.com/x/1', ['projects/10000000001', ORG]),
        asset('//a.googleapis.com/x/2', ['projects/10000000002', ORG]),
        asset('//a.googleapis.com/x/3', ['projects/10000000003', 'organizations/30000000002']),
      ]),
    ).toEqual({ scope: { kind: 'organization', id: '30000000001' }, roots: 2 });
  });

  it('breaks a tie by the smaller root, so the answer does not depend on the order', () => {
    const a = asset('//a.googleapis.com/x/1', ['organizations/30000000002']);
    const b = asset('//a.googleapis.com/x/2', [ORG]);
    expect(inferScope([a, b])).toEqual(inferScope([b, a]));
    expect(inferScope([a, b])?.scope.id).toBe('30000000001');
  });

  it('names a project without an organisation by its project id', () => {
    expect(
      inferScope([
        asset('//cloudresourcemanager.googleapis.com/projects/10000000009', ['projects/10000000009'], {
          projectId: 'demo-lab-1',
        }),
        asset('//storage.googleapis.com/demo-bucket', ['projects/10000000009']),
      ]),
    ).toEqual({ scope: { kind: 'project', id: '10000000009', displayName: 'demo-lab-1' }, roots: 1 });
  });

  it('has no answer when no asset names an ancestor', () => {
    expect(inferScope([asset('//a.googleapis.com/x/1', [])])).toBeUndefined();
    expect(inferScope([])).toBeUndefined();
  });
});
