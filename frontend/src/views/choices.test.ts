// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The view choices of the demo organisations, built from the same Graph the data worker builds, and
 * checked against the scene builder: every project, host, perimeter and application the pickers offer is one
 * the matching focus accepts, and every region, folder and type the filters offer narrows the view without an
 * error. Also the data worker's `choices` answer, through the in-process workers.
 */
import { catalog } from '@gcportrait/catalog';
import { buildSceneWithReport, PROJECT_TYPE } from '@gcportrait/graph';
import { normalizeViewSpec, type DemoSize } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { createInProcessWorkers } from '../diagram/pipeline/inProcess';
import { demoGraph } from '../diagram/testing/demoScenes';
import { regionOf, typeChoices, viewChoices } from './choices';
import { focusOf, focusOptions } from './focusForm';
import { trailOf } from './trail';
import { choicesFor } from './useViewChoices';

async function choicesOf(size: DemoSize) {
  const { snapshot, graph } = await demoGraph(size);
  return { graph, choices: viewChoices(`demo:${size}`, snapshot, graph, catalog) };
}

describe('the view choices', () => {
  it('describe the snapshot', async () => {
    const { choices } = await choicesOf('M');
    expect(choices.snapshot).toEqual({
      ref: 'demo:M',
      scope: 'example.com',
      scopeKind: 'organization',
      readTime: '2026-10-08T00:00:00Z',
      readTimeEstimated: false,
      source: 'demo',
      assets: 952,
    });
    // Demo M's own organisation (one per size).
    expect(choices.organization).toBe('//cloudresourcemanager.googleapis.com/organizations/30000000002');
  });

  it.each(['S', 'M'] as const)(
    'offer every project of %s, by id with its display name and folders',
    async (size) => {
      const { graph, choices } = await choicesOf(size);
      const projects = Object.values(graph.nodes).filter((node) => node.assetType === PROJECT_TYPE);
      expect(choices.projects).toHaveLength(projects.length);
      const web = choices.projects.find((project) => project.id === 'demo-web-1');
      expect(web).toMatchObject({ number: expect.stringMatching(/^1000000000\d+$/) as string });
      expect(web?.path).toMatch(/^Workloads › Retail/);
      // Sorted by display name.
      const names = choices.projects.map((project) => project.name.toLowerCase());
      expect(names).toEqual([...names].sort());
    },
  );

  it('offer the Shared VPC hosts with their service projects, the perimeters and the applications of M', async () => {
    const { choices } = await choicesOf('M');
    expect(choices.hosts.map((host) => [host.id, host.services])).toEqual([
      ['demo-net-2', 3],
      ['demo-net-1', 13],
    ]);
    expect(choices.perimeters.map((perimeter) => perimeter.label)).toContain('data_perimeter');
    const storefront = choices.applications.find((app) => app.label === 'Storefront');
    expect(storefront).toEqual({
      node: '//apphub.googleapis.com/projects/demo-mgmt-1/locations/global/applications/storefront',
      label: 'Storefront',
      detail: 'App Hub application · demo-mgmt-1',
    });
    // No hierarchy or network layer is offered as an application.
    expect(
      choices.applications.some((app) => /\/(projects|folders|networks|subnetworks)\/[^/]+$/.test(app.node)),
    ).toBe(false);
  });

  it.each(['S', 'M'] as const)('offer only parameters the focus views of %s accept', async (size) => {
    const { graph, choices } = await choicesOf(size);
    for (const kind of ['project', 'shared-vpc', 'perimeter', 'application'] as const) {
      const options = focusOptions(kind, choices);
      expect(options.length, kind).toBeGreaterThan(0);
      for (const option of options) {
        const spec = normalizeViewSpec({ snapshot: `demo:${size}`, focus: focusOf(kind, option.value) });
        const { report } = buildSceneWithReport(graph, spec, catalog, { readTime: '2026-10-08T00:00:00Z' });
        expect(report.focus?.status, `${kind} ${option.value}`).toBe('applied');
      }
    }
  });

  it('offer the folders by number with their path, and the regions (zones as their region)', async () => {
    const { graph, choices } = await choicesOf('M');
    expect(choices.folders).toHaveLength(14);
    expect(choices.folders[0]).toEqual({
      node: '//cloudresourcemanager.googleapis.com/folders/20000000001',
      number: '20000000001',
      label: 'Platform',
      path: '',
    });
    expect(choices.folders.find((folder) => folder.number === '20000000007')?.path).toBe(
      'Workloads › Retail',
    );
    expect(choices.regions).toEqual(['eu', 'europe-west3', 'global', 'us-central1']);
    expect(regionOf('europe-west3-a')).toBe('europe-west3');
    expect(regionOf('US-Central1-AI1A')).toBe('us-central1');
    expect(regionOf('EU')).toBe('eu');
    expect(regionOf('nam4')).toBe('nam4');
    // Each region keeps something of the view (the everything lens: some regions hold only records).
    for (const region of choices.regions) {
      const filters = { regions: [region] };
      const spec = normalizeViewSpec({ snapshot: 'demo:M', lens: 'everything', detail: 'all', filters });
      const { report } = buildSceneWithReport(graph, spec, catalog, { readTime: '2026-10-08T00:00:00Z' });
      expect(report.counts.cards, region).toBeGreaterThan(0);
    }
  });

  it('offer every catalog type, the snapshot’s unmapped types and a pattern per service, present ones first', async () => {
    const { graph, choices } = await choicesOf('M');
    const types = new Set(choices.types.map((type) => type.type));
    for (const type of Object.keys(catalog.types)) expect(types.has(type), type).toBe(true);
    for (const type of Object.keys(graph.indexes.byType)) {
      if (!type.startsWith('gcportrait.')) expect(types.has(type), type).toBe(true);
    }
    expect(choices.types.find((type) => type.type === 'run.googleapis.com/Service')).toMatchObject({
      product: 'Cloud Run',
      name: 'Cloud Run service',
    });
    expect(choices.types.find((type) => type.type === 'iam.googleapis.com/*')).toMatchObject({
      product: 'Identity and Access Management',
      name: 'every iam.googleapis.com type',
    });
    const counts = choices.types.map((type) => type.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(typeChoices(graph, catalog)).toEqual(choices.types);
  });

  it('give the breadcrumb every container above a root', async () => {
    const { choices } = await choicesOf('M');
    const web = choices.projects.find((project) => project.id === 'demo-web-1');
    const crumbs = trailOf({
      scope: choices.snapshot.scope,
      root: web?.node,
      containers: choices.containers,
      organization: choices.organization,
    });
    expect(crumbs.map((crumb) => crumb.label)).toEqual([
      'example.com',
      'Workloads',
      'Retail',
      'Production',
      web?.name,
    ]);
    expect(crumbs.map((crumb) => crumb.typeName)).toEqual([
      undefined,
      'Folder',
      'Folder',
      'Folder',
      'Project',
    ]);
  });

  it('come from the data worker once per snapshot and client', async () => {
    const workers = createInProcessWorkers();
    let asked = 0;
    const choices = workers.data.choices.bind(workers.data);
    const days: Array<string | null> = [];
    workers.data.choices = (ref, day) => {
      asked += 1;
      days.push(day.tick);
      return choices(ref, day);
    };
    const first = await choicesFor(workers.data, 'demo:S');
    const again = await choicesFor(workers.data, 'demo:S');
    expect(again).toBe(first);
    expect(asked).toBe(1);
    expect(first.snapshot.ref).toBe('demo:S');
    expect(first.projects.length).toBeGreaterThan(5);
    // Another day is asked for once too, and named in the request.
    const earlier = await choicesFor(workers.data, 'demo:S', '2026-09-16');
    expect(await choicesFor(workers.data, 'demo:S', '2026-09-16')).toBe(earlier);
    expect(asked).toBe(2);
    expect(days).toEqual([null, '2026-09-16']);
    // A snapshot that cannot be loaded fails, and is asked again next time.
    await expect(choicesFor(workers.data, 'demo:XXL')).rejects.toThrow();
    workers.dispose();
  });
});
