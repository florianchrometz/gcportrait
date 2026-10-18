// SPDX-License-Identifier: Apache-2.0
/**
 * Secret Manager secrets with their first version. Cloud Asset Inventory names secrets with the project
 * number, as `data.name` does. With the `security` cases a secret is replicated with a customer-managed key in
 * its region and publishes its events to the security project's `secret-events` topic.
 */
import type { OrgContext } from './context.js';
import { has } from './features.js';
import { addProjectAsset, fullName, standardLabels, type ProjectCtx } from './kit.js';
import type { Region } from './vocabulary.js';

/** The topic secret events go to (created by the security template). */
export function secretEventsTopic(ctx: OrgContext): string | undefined {
  const project = ctx.keys.project;
  return project === undefined || !has(ctx.profile, 'security')
    ? undefined
    : `projects/${project.id}/topics/secret-events`;
}

/** Adds a secret and its version 1; returns the secret's path `projects/<number>/secrets/<id>`. */
export function addSecret(ctx: OrgContext, project: ProjectCtx, secret: string, region: Region): string {
  const { b } = ctx;
  const path = `projects/${project.number}/secrets/${secret}`;
  const key = has(ctx.profile, 'security') ? ctx.keys.key(region.name, 'storage') : undefined;
  const topic = secretEventsTopic(ctx);
  const replica = {
    location: region.name,
    ...(key === undefined ? {} : { customerManagedEncryption: { kmsKeyName: key } }),
  };
  const asset = addProjectAsset(b, project, {
    assetType: 'secretmanager.googleapis.com/Secret',
    name: fullName('secretmanager.googleapis.com', path),
    location: 'global',
    data: {
      name: path,
      replication: { userManaged: { replicas: [replica] } },
      labels: standardLabels(project),
      etag: '"1640995200000000"',
      versionControl: {},
      ...(topic === undefined ? {} : { topics: [{ name: topic }] }),
    },
  });
  addProjectAsset(b, project, {
    assetType: 'secretmanager.googleapis.com/SecretVersion',
    name: fullName('secretmanager.googleapis.com', `${path}/versions/1`),
    parent: asset.name,
    location: 'global',
    after: asset.createdAt,
    data: {
      name: `${path}/versions/1`,
      state: 'ENABLED',
      replicationStatus: {
        userManaged: {
          replicas: [
            {
              location: region.name,
              ...(key === undefined
                ? {}
                : { customerManagedEncryption: { kmsKeyVersionName: `${key}/cryptoKeyVersions/1` } }),
            },
          ],
        },
      },
      etag: '"1640995200000001"',
    },
  });
  return path;
}

/** Adds a secret and its version 1; returns the version's path `projects/<number>/secrets/<id>/versions/1`. */
export function addSecretWithVersion(
  ctx: OrgContext,
  project: ProjectCtx,
  secret: string,
  region: Region,
): string {
  return `${addSecret(ctx, project, secret, region)}/versions/1`;
}
