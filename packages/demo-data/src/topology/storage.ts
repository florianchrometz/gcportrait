// SPDX-License-Identifier: MIT
/** Cloud Storage buckets, shared by the data, web, serverless and retired-project templates. */
import type { AddInput, OrgBuilder } from '../builder/builder.js';
import type { GenAsset, Traits } from '../builder/types.js';
import type { JsonObject } from '../core/json.js';
import { fullName, projectInput, type ProjectCtx } from './kit.js';
import type { Region } from './vocabulary.js';

export interface BucketSpec {
  readonly name: string;
  readonly region: Region;
  readonly labels: JsonObject;
  /** `projects/…/cryptoKeys/…`: default customer-managed encryption key. */
  readonly kmsKey?: string;
  readonly versioning?: boolean;
  readonly storageClass?: string;
  readonly logBucket?: string;
  /** Serves a static site through a backend bucket. */
  readonly website?: boolean;
  readonly after?: number;
  readonly traits?: Traits;
}

export function bucketInput(project: ProjectCtx, spec: BucketSpec): AddInput {
  const data: JsonObject = {
    kind: 'storage#bucket',
    id: spec.name,
    name: spec.name,
    selfLink: `https://www.googleapis.com/storage/v1/b/${spec.name}`,
    projectNumber: project.number,
    location: spec.region.storageLocation,
    locationType: 'region',
    storageClass: spec.storageClass ?? 'STANDARD',
    metageneration: '1',
    etag: 'CAE=',
    iamConfiguration: {
      bucketPolicyOnly: { enabled: true },
      uniformBucketLevelAccess: { enabled: true },
      publicAccessPrevention: spec.website === true ? 'inherited' : 'enforced',
    },
    versioning: { enabled: spec.versioning ?? false },
    labels: spec.labels,
    softDeletePolicy: { retentionDurationSeconds: '604800' },
    rpo: 'DEFAULT',
    ...(spec.kmsKey === undefined ? {} : { encryption: { defaultKmsKeyName: spec.kmsKey } }),
    ...(spec.logBucket === undefined
      ? {}
      : { logging: { logBucket: spec.logBucket, logObjectPrefix: spec.name } }),
    ...(spec.website === true ? { website: { mainPageSuffix: 'index.html', notFoundPage: '404.html' } } : {}),
  };
  return projectInput(project, {
    assetType: 'storage.googleapis.com/Bucket',
    name: fullName('storage.googleapis.com', spec.name),
    location: spec.region.name,
    data,
    ...(spec.after === undefined ? {} : { after: spec.after }),
    ...(spec.traits === undefined ? {} : { traits: spec.traits }),
  });
}

export function addBucket(b: OrgBuilder, project: ProjectCtx, spec: BucketSpec): GenAsset {
  return b.add(bucketInput(project, spec));
}
