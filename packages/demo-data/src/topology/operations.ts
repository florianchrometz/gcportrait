// SPDX-License-Identifier: MIT
/**
 * The CI and operations project. It holds only hidden-tier assets (Cloud Build builds and enabled-service
 * records), so the diagram shows it as an empty project with a hidden-asset badge. Builds arrive during the
 * history window. With the platform management project (feature `management`) the builds run there instead,
 * next to their triggers, and this project keeps only the enabled services.
 */
import type { OrgBuilder } from '../builder/builder.js';
import { uuid } from '../core/ids.js';
import { addProject, addProjectAsset, fullName, type ContainerCtx, type ProjectCtx } from './kit.js';
import type { Region } from './vocabulary.js';

export interface OperationsOptions {
  readonly builds: number;
  readonly enabledServices: number;
}

const SERVICES: readonly (readonly [string, string])[] = [
  ['cloudbuild.googleapis.com', 'Cloud Build API'],
  ['artifactregistry.googleapis.com', 'Artifact Registry API'],
  ['logging.googleapis.com', 'Cloud Logging API'],
  ['monitoring.googleapis.com', 'Cloud Monitoring API'],
  ['iam.googleapis.com', 'Identity and Access Management (IAM) API'],
  ['secretmanager.googleapis.com', 'Secret Manager API'],
  ['storage.googleapis.com', 'Cloud Storage API'],
  ['cloudresourcemanager.googleapis.com', 'Cloud Resource Manager API'],
];

export const APPS: readonly string[] = [
  'storefront',
  'orders-api',
  'billing-api',
  'catalog',
  'search',
  'notifier',
];

/** Where builds run and what they use; by default the project's own bucket, images and default account. */
export interface BuildSettings {
  /** The project whose `images` repository the builds push to. */
  readonly imageProject: string;
  readonly serviceAccount: string;
  /** `projects/<number>/locations/<region>/workerPools/<name>`: builds run in this private pool's region. */
  readonly pool?: string;
  /** Trigger ids, assigned round robin. */
  readonly triggers?: readonly string[];
}

/** `count` Cloud Build builds of the platform's applications (the first one predates the window). */
export function addBuilds(
  b: OrgBuilder,
  project: ProjectCtx,
  region: Region,
  count: number,
  settings: BuildSettings = {
    imageProject: project.id,
    serviceAccount: `projects/${project.id}/serviceAccounts/${project.number}-compute@developer.gserviceaccount.com`,
  },
): void {
  const rng = b.rng.fork(`ops:${project.id}`);
  const location = settings.pool === undefined ? 'global' : region.name;
  for (let i = 0; i < count; i++) {
    const id = uuid(rng);
    const app = rng.pick(APPS);
    const sha = rng.hex(7);
    const image = `${region.name}-docker.pkg.dev/${settings.imageProject}/images/${app}:${sha}`;
    const trigger = settings.triggers?.[i % settings.triggers.length];
    addProjectAsset(b, project, {
      assetType: 'cloudbuild.googleapis.com/Build',
      name: fullName(
        'cloudbuild.googleapis.com',
        `projects/${project.number}/locations/${location}/builds/${id}`,
      ),
      location,
      data: {
        name: `projects/${project.number}/locations/${location}/builds/${id}`,
        id,
        projectId: project.id,
        status: rng.chance(0.85) ? 'SUCCESS' : 'FAILURE',
        source: {
          storageSource: {
            bucket: `${project.id}_cloudbuild`,
            object: `source/${rng.digits(10)}.${rng.hex(8)}.tgz`,
            generation: rng.digits(16),
          },
        },
        steps: [
          { name: 'gcr.io/cloud-builders/docker', args: ['build', '-t', image, '.'], status: 'SUCCESS' },
          { name: 'gcr.io/cloud-builders/docker', args: ['push', image], status: 'SUCCESS' },
        ],
        images: [image],
        logsBucket: `gs://${project.number}.cloudbuild-logs.googleusercontent.com`,
        serviceAccount: settings.serviceAccount,
        options:
          settings.pool === undefined
            ? { logging: 'LEGACY', machineType: 'E2_HIGHCPU_8' }
            : { logging: 'CLOUD_LOGGING_ONLY', pool: { name: settings.pool } },
        timeout: '600s',
        queueTtl: '3600s',
        tags: [`app-${app}`],
        substitutions: { SHORT_SHA: sha, BRANCH_NAME: 'main', REPO_NAME: app },
        ...(trigger === undefined ? {} : { buildTriggerId: trigger }),
      },
      // The first build predates the window; later ones may have run inside it.
      ...(i === 0 ? {} : { traits: { addable: true } }),
    });
  }
}

export function addOperationsProject(
  b: OrgBuilder,
  folder: ContainerCtx,
  region: Region,
  options: OperationsOptions,
): void {
  const project = addProject(b, folder, {
    role: 'ops',
    displayName: 'CI and operations',
    env: 'prod',
    region,
    team: 'platform',
  });
  addBuilds(b, project, region, options.builds);
  for (const [service, title] of SERVICES.slice(0, options.enabledServices)) {
    addProjectAsset(b, project, {
      assetType: 'serviceusage.googleapis.com/Service',
      name: fullName('serviceusage.googleapis.com', `projects/${project.number}/services/${service}`),
      location: 'global',
      data: {
        name: `projects/${project.number}/services/${service}`,
        parent: `projects/${project.number}`,
        state: 'ENABLED',
        config: { name: service, title },
      },
    });
  }
}
