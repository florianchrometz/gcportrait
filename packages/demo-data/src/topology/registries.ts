// SPDX-License-Identifier: MIT
/**
 * Artifact Registry repositories (feature `registries`). Instead of every template declaring the repositories
 * its images come from, one pass at the end reads every image path the organisation's assets name
 * (`<region>-docker.pkg.dev/<project>/<repository>/…`: Cloud Run containers, Kubernetes workloads, Cloud Run
 * functions, builds, Vertex AI models, …) and creates each repository once, in its project, a little before
 * the first asset that pulls from it. Production repositories are CMEK-encrypted; `gcf-artifacts` carries the
 * clean-up policy Cloud Run functions sets up.
 */
import { HOUR_MS, MINUTE_MS } from '../core/time.js';
import type { OrgContext } from './context.js';
import { fullName, projectInput, standardLabels, type ProjectCtx } from './kit.js';

/** `<location>-docker.pkg.dev/<project>/<repository>`, as image paths spell a Docker repository. */
const IMAGE = /([a-z]+-[a-z]+[0-9]+)-docker\.pkg\.dev\/([a-z][a-z0-9-]+)\/([a-z0-9][a-z0-9.-]*)/g;

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  apps: 'Application images',
  images: 'Images built by Cloud Build',
  'gcf-artifacts':
    'This repository is created and used by Cloud Functions for storing function docker images.',
  models: 'Model serving containers',
};

interface Wanted {
  readonly project: ProjectCtx;
  readonly location: string;
  readonly repository: string;
  firstUse: number;
}

export function addRegistries(ctx: OrgContext): void {
  const { b } = ctx;
  // Registered last, so it runs after every other deferred template has added its assets.
  b.defer(() => {
    const wanted = new Map<string, Wanted>();
    for (const asset of b.added()) {
      if (asset.assetType.startsWith('artifactregistry.googleapis.com/')) continue;
      for (const match of JSON.stringify(asset.data).matchAll(IMAGE)) {
        const [, location = '', projectId = '', repository = ''] = match;
        const project = b.projects.get(projectId);
        if (project === undefined) continue;
        const key = `${projectId}/${location}/${repository}`;
        const known = wanted.get(key);
        if (known === undefined)
          wanted.set(key, { project, location, repository, firstUse: asset.createdAt });
        else known.firstUse = Math.min(known.firstUse, asset.createdAt);
      }
    }
    for (const key of [...wanted.keys()].sort()) {
      const want = wanted.get(key);
      if (want === undefined) continue;
      const { project, location, repository } = want;
      const path = `projects/${project.id}/locations/${location}/repositories/${repository}`;
      const kmsKey = project.env === 'prod' ? ctx.keys.key(location, 'storage') : undefined;
      const managed = repository === 'gcf-artifacts';
      b.add({
        ...projectInput(project, {
          assetType: 'artifactregistry.googleapis.com/Repository',
          name: fullName('artifactregistry.googleapis.com', path),
          location,
          data: {
            name: path,
            format: 'DOCKER',
            description: DESCRIPTIONS[repository] ?? `${repository} images`,
            labels: managed ? { 'goog-managed-by': 'cloudfunctions' } : standardLabels(project),
            mode: 'STANDARD_REPOSITORY',
            registryUri: `${location}-docker.pkg.dev/${project.id}/${repository}`,
            sizeBytes: String(b.rng.fork(`ar-size:${path}`).int(200, 9000) * 1_048_576),
            vulnerabilityScanningConfig: {
              enablementConfig: 'INHERITED',
              enablementState: 'SCANNING_ACTIVE',
            },
            dockerConfig: { immutableTags: false },
            ...(managed
              ? {
                  cleanupPolicies: {
                    'delete-old': {
                      id: 'delete-old',
                      action: 'DELETE',
                      condition: { tagState: 'ANY', olderThan: '2592000s' },
                    },
                  },
                }
              : {}),
            ...(kmsKey === undefined || managed ? {} : { kmsKeyName: kmsKey }),
          },
        }),
        createdAt: Math.max(project.createdAt + MINUTE_MS, want.firstUse - HOUR_MS),
      });
    }
  });
}
