// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The view controls' small rules: the lens switch's detail rule (lensDetail.ts), the focus kinds and
 * their parameter (focusForm.ts), the breadcrumb's trail (trail.ts) and the saved-view summaries
 * (describeView.ts).
 */
import { decodeViewSpec, encodeViewSpec, normalizeViewSpec, type DetailLevel } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import type { ContainerInfo, ViewChoices } from './choices';
import { describeViewHash, suggestViewName } from './describeView';
import { focusOf, focusOptions, focusParamOf, focusValue, focusValueLabel, FOCUS_KINDS } from './focusForm';
import { detailFollowsLens, viewWithLens, type LensDefaults } from './lensDetail';
import { trailOf } from './trail';

const DEFAULTS: LensDefaults = {
  overview: 'auto',
  networking: 'networks',
  'load-balancing': 'all',
  compute: 'networks',
  identity: 'projects',
};

describe('the lens switch', () => {
  it('opens every lens at auto while the level follows the lens: auto stops at the lens default', () => {
    const spec = normalizeViewSpec({ snapshot: 'demo:M' });
    expect(detailFollowsLens(spec, DEFAULTS)).toBe(true);
    const networking = normalizeViewSpec(viewWithLens(spec, 'networking', DEFAULTS));
    expect(networking).toMatchObject({ lens: 'networking', detail: 'auto' });
    // It still follows: on to load balancing, then back to the overview.
    const lb = normalizeViewSpec(viewWithLens(networking, 'load-balancing', DEFAULTS));
    expect(lb.detail).toBe('auto');
    expect(normalizeViewSpec(viewWithLens(lb, 'overview', DEFAULTS)).detail).toBe('auto');
  });

  it('keeps a level the person chose against the lens’s default', () => {
    const spec = normalizeViewSpec({ snapshot: 'demo:M', lens: 'networking', detail: 'projects' });
    expect(detailFollowsLens(spec, DEFAULTS)).toBe(false);
    expect(normalizeViewSpec(viewWithLens(spec, 'compute', DEFAULTS))).toMatchObject({
      lens: 'compute',
      detail: 'projects',
    });
  });

  it('keeps the level while the lens list is unknown, and keeps everything else of the view', () => {
    const spec = normalizeViewSpec({
      snapshot: 'demo:M',
      root: '//cloudresourcemanager.googleapis.com/folders/20000000005',
      filters: { hideEmptyProjects: true },
      focus: { kind: 'project', params: { project: 'demo-web-1' } },
      detail: 'networks',
    });
    expect(normalizeViewSpec(viewWithLens(spec, 'networking', {}))).toEqual({ ...spec, lens: 'networking' });
    const auto = normalizeViewSpec({ ...spec, detail: 'auto' });
    expect(normalizeViewSpec(viewWithLens(auto, 'networking', {}))).toEqual({ ...auto, lens: 'networking' });
    const switched = normalizeViewSpec(viewWithLens(auto, 'networking', DEFAULTS));
    expect(switched).toEqual({ ...auto, lens: 'networking' });
    // The hash says it all: the switched view round-trips.
    expect(decodeViewSpec(encodeViewSpec(switched))).toEqual(switched);
  });

  it('counts the lens’s own default level as following it, as a link may hold it', () => {
    const chosen = normalizeViewSpec({ snapshot: 'demo:M', lens: 'networking', detail: 'networks' });
    expect(detailFollowsLens(chosen, DEFAULTS)).toBe(true);
    const next: DetailLevel = 'auto';
    expect(normalizeViewSpec(viewWithLens(chosen, 'identity', DEFAULTS)).detail).toBe(next);
    expect(normalizeViewSpec(viewWithLens(chosen, 'everything', DEFAULTS)).detail).toBe('auto');
  });
});

const CHOICES: ViewChoices = {
  snapshot: {
    ref: 'demo:M',
    scope: 'example.com',
    scopeKind: 'organization',
    readTime: '2026-10-08T00:00:00Z',
    readTimeEstimated: false,
    source: 'demo',
    assets: 952,
  },
  organization: '//cloudresourcemanager.googleapis.com/organizations/30000000001',
  projects: [
    {
      node: '//cloudresourcemanager.googleapis.com/projects/10000000003',
      id: 'demo-web-1',
      number: '10000000003',
      name: 'Web storefront (prod)',
      path: 'Workloads › Retail',
    },
  ],
  hosts: [
    {
      node: '//cloudresourcemanager.googleapis.com/projects/10000000001',
      id: 'demo-net-1',
      number: '10000000001',
      name: 'Shared VPC host',
      path: '',
      services: 1,
    },
  ],
  perimeters: [{ node: '//acm/p/servicePerimeters/data_perimeter', label: 'data_perimeter', detail: 'x' }],
  applications: [
    { node: '//apphub/applications/storefront', label: 'Storefront', detail: 'App Hub application' },
  ],
  folders: [],
  regions: ['europe-west3'],
  containers: {},
  types: [],
};

describe('the focus kinds', () => {
  it('names the one parameter of each kind (the model’s convention)', () => {
    expect(FOCUS_KINDS.map((kind) => kind.value)).toEqual([
      'none',
      'project',
      'shared-vpc',
      'standalone-projects',
      'perimeter',
      'application',
    ]);
    expect(focusParamOf('project')?.name).toBe('project');
    expect(focusParamOf('shared-vpc')?.name).toBe('host');
    expect(focusParamOf('standalone-projects')).toBeNull();
    expect(focusParamOf('perimeter')?.name).toBe('perimeter');
    expect(focusParamOf('application')?.name).toBe('application');
  });

  it('builds a focus and reads its value back through the hash', () => {
    const focus = focusOf('shared-vpc', 'demo-net-1');
    expect(focus).toEqual({ kind: 'shared-vpc', params: { host: 'demo-net-1' } });
    const hash = encodeViewSpec({ snapshot: 'demo:M', focus });
    expect(hash).toBe('snapshot=demo:M&focus=shared-vpc&focus.host=demo-net-1');
    expect(focusValue(decodeViewSpec(hash).focus)).toBe('demo-net-1');
    expect(focusOf('standalone-projects', 'ignored')).toEqual({ kind: 'standalone-projects', params: {} });
    expect(focusValue({ kind: 'project', params: {} })).toBeNull();
    expect(focusValue(undefined)).toBeNull();
  });

  it('offers the snapshot’s projects with id and display name, its hosts, perimeters and applications', () => {
    expect(focusOptions('project', CHOICES)).toEqual([
      { value: 'demo-web-1', label: 'demo-web-1', description: 'Web storefront (prod) · Workloads › Retail' },
    ]);
    expect(focusOptions('shared-vpc', CHOICES)[0]).toMatchObject({
      value: 'demo-net-1',
      description: 'Shared VPC host · 1 service project',
    });
    expect(focusOptions('perimeter', CHOICES)[0]?.value).toBe('//acm/p/servicePerimeters/data_perimeter');
    expect(focusOptions('application', CHOICES)[0]?.label).toBe('Storefront');
    expect(focusOptions('standalone-projects', CHOICES)).toEqual([]);
  });

  it('shows a value by its id or label, and by its last segment before the choices arrive', () => {
    expect(focusValueLabel('project', '10000000003', CHOICES)).toBe('demo-web-1');
    expect(focusValueLabel('application', '//apphub/applications/storefront', CHOICES)).toBe('Storefront');
    expect(focusValueLabel('application', '//apphub/applications/storefront', null)).toBe('storefront');
    expect(focusValueLabel('project', 'demo-x', null)).toBe('demo-x');
  });
});

describe('the breadcrumb trail', () => {
  const ORG = '//cloudresourcemanager.googleapis.com/organizations/30000000001';
  const WORKLOADS = '//cloudresourcemanager.googleapis.com/folders/20000000005';
  const RETAIL = '//cloudresourcemanager.googleapis.com/folders/20000000006';
  const WEB = '//cloudresourcemanager.googleapis.com/projects/10000000003';
  const containers: Record<string, ContainerInfo> = {
    [ORG]: { label: 'example.com', parent: null, typeName: 'Organisation' },
    [WORKLOADS]: { label: 'Workloads', parent: ORG, typeName: 'Folder' },
    [RETAIL]: { label: 'Retail', parent: WORKLOADS, typeName: 'Folder' },
    [WEB]: { label: 'Web storefront (prod)', parent: RETAIL, typeName: 'Project' },
  };

  it('is the scope alone without a root', () => {
    expect(trailOf({ scope: 'example.com', root: undefined, containers, organization: ORG })).toEqual([
      { id: null, label: 'example.com' },
    ]);
    expect(trailOf({ scope: 'example.com', root: ORG, containers, organization: ORG })).toHaveLength(1);
  });

  it('runs from the scope through the containers above the root to the root', () => {
    expect(trailOf({ scope: 'example.com', root: WEB, containers, organization: ORG })).toEqual([
      { id: null, label: 'example.com' },
      { id: WORKLOADS, label: 'Workloads', typeName: 'Folder' },
      { id: RETAIL, label: 'Retail', typeName: 'Folder' },
      { id: WEB, label: 'Web storefront (prod)', typeName: 'Project' },
    ]);
  });

  it('shows the root alone (by the Scene’s label, else its id’s last segment) before the containers arrive', () => {
    expect(
      trailOf({ scope: 'example.com', root: WEB, containers: null, organization: null, rootLabel: 'Web' }),
    ).toEqual([
      { id: null, label: 'example.com' },
      { id: WEB, label: 'Web' },
    ]);
    expect(trailOf({ scope: 'example.com', root: '//x/y/z', containers, organization: ORG }).at(-1)).toEqual({
      id: '//x/y/z',
      label: 'z',
    });
  });

  it('stops at a cycle rather than looping', () => {
    const looped: Record<string, ContainerInfo> = {
      a: { label: 'A', parent: 'b', typeName: 'Folder' },
      b: { label: 'B', parent: 'a', typeName: 'Folder' },
    };
    expect(
      trailOf({ scope: 's', root: 'a', containers: looped, organization: null }).map((c) => c.label),
    ).toEqual(['s', 'B', 'A']);
  });
});

describe('saved-view summaries', () => {
  const words = {
    snapshot: (ref: string) => (ref === 'demo:M' ? 'Demo organisation M (medium)' : ref),
    lens: (id: string) => (id === 'networking' ? 'Networking' : id),
  };

  it('says what a view shows', () => {
    const hash = encodeViewSpec({
      snapshot: 'demo:M',
      lens: 'networking',
      detail: 'projects',
      focus: { kind: 'project', params: { project: 'demo-web-1' } },
      root: '//cloudresourcemanager.googleapis.com/folders/20000000005',
      filters: { hideEmptyProjects: true, regions: ['europe-west3'] },
    });
    expect(describeViewHash(hash, words)).toBe(
      'Demo organisation M (medium) · Networking lens · projects detail · focus single project demo-web-1 · ' +
        'in 20000000005 · 2 filters',
    );
    expect(suggestViewName(decodeViewSpec(hash), words)).toBe(
      'Networking lens · projects detail · focus single project demo-web-1 · in 20000000005 · 2 filters',
    );
    expect(describeViewHash('', words)).toBe('no snapshot · overview lens');
  });
});
