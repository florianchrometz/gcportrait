// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { OrgBuilder } from '../builder/builder.js';
import { addProjectAsset } from './kit.js';
import { buildOrganization } from './organization.js';
import { SIZE_PROFILES } from './profiles.js';

function repositoriesFor(location: string) {
  const builder = new OrgBuilder(1, Date.parse('2026-09-04T00:00:00Z'));
  buildOrganization(builder, SIZE_PROFILES.M);
  const project = [...builder.projects.values()].find((candidate) => candidate.env === 'dev');
  if (project === undefined) throw new Error('Expected a synthetic development project.');
  const repository = 'location-check';
  const path = `projects/${project.id}/locations/europe-west3/services/${repository}`;
  addProjectAsset(builder, project, {
    assetType: 'run.googleapis.com/Service',
    name: `//run.googleapis.com/${path}`,
    location: 'europe-west3',
    data: {
      name: path,
      template: {
        containers: [{ image: `${location}-docker.pkg.dev/${project.id}/${repository}/web:v1` }],
      },
    },
  });
  const repositories = builder
    .finish()
    .assets.filter(
      (asset) =>
        asset.assetType === 'artifactregistry.googleapis.com/Repository' &&
        asset.name.endsWith(`/repositories/${repository}`),
    );
  return { project, repository, repositories };
}

describe('Artifact Registry image locations', () => {
  it.each([
    'europe-west3',
    'us-central1',
    'northamerica-northeast1',
    'u-france-east1',
    'u-germany-northeast1',
  ])('preserves the complete region %s in the deferred registry pass', (location) => {
    const { project, repository, repositories } = repositoriesFor(location);
    expect(repositories).toHaveLength(1);
    expect(repositories[0]).toMatchObject({
      name: `//artifactregistry.googleapis.com/projects/${project.id}/locations/${location}/repositories/${repository}`,
      location,
      data: {
        name: `projects/${project.id}/locations/${location}/repositories/${repository}`,
        registryUri: `${location}-docker.pkg.dev/${project.id}/${repository}`,
      },
    });
  });

  it.each([
    'invalid-europe-west3',
    '123europe-west3',
    'UPPER-europe-west3',
    '_europe-west3',
    'invalid.europe-west3',
    'europe-west3-b',
    'u-france-east1-a',
    'global',
    'us',
    'not-a-region',
  ])('ignores the non-region host location %s without accepting a suffix', (location) => {
    expect(repositoriesFor(location).repositories).toEqual([]);
  });
});
