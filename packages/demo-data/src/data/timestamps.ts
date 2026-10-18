// SPDX-License-Identifier: Apache-2.0
/**
 * Where each generated asset type keeps its own timestamps inside `resource.data`, and in which format. The
 * builder writes these from an asset's creation and update instants, so re-timing an asset (the history
 * moves its creation into the 35-day window, or records a change) keeps the envelope's `updateTime` and the
 * data in step.
 */

export type TimestampFormat =
  'rfc3339-micros' | 'rfc3339-millis' | 'rfc3339-seconds' | 'compute' | 'epoch-millis';

export interface TimestampField {
  readonly path: readonly string[];
  /** Which instant the field records. */
  readonly role: 'created' | 'updated';
  readonly format: TimestampFormat;
  /** Added to the instant (a build starts a few seconds after it is created). */
  readonly offsetMs?: number;
}

function field(
  path: string,
  role: TimestampField['role'],
  format: TimestampFormat,
  offsetMs?: number,
): TimestampField {
  return { path: path.split('.'), role, format, ...(offsetMs === undefined ? {} : { offsetMs }) };
}

const COMPUTE_CREATED = field('creationTimestamp', 'created', 'compute');
const K8S_CREATED = field('metadata.creationTimestamp', 'created', 'rfc3339-seconds');
const V2_TIMES = [
  field('createTime', 'created', 'rfc3339-micros'),
  field('updateTime', 'updated', 'rfc3339-micros'),
];

/** Per service, applied to every type of the service unless the type has its own entry. */
const BY_SERVICE: Readonly<Record<string, readonly TimestampField[]>> = {
  'compute.googleapis.com': [COMPUTE_CREATED],
  'k8s.io': [K8S_CREATED],
  'apps.k8s.io': [K8S_CREATED],
  'networking.k8s.io': [K8S_CREATED],
  'cloudresourcemanager.googleapis.com': [field('createTime', 'created', 'rfc3339-millis')],
  'run.googleapis.com': V2_TIMES,
  'cloudfunctions.googleapis.com': V2_TIMES,
  'eventarc.googleapis.com': V2_TIMES,
  'gkehub.googleapis.com': V2_TIMES,
  'cloudkms.googleapis.com': [field('createTime', 'created', 'rfc3339-micros')],
  'secretmanager.googleapis.com': [field('createTime', 'created', 'rfc3339-micros')],
  'sqladmin.googleapis.com': [field('createTime', 'created', 'rfc3339-millis')],
  'container.googleapis.com': [field('createTime', 'created', 'rfc3339-seconds')],
  'dns.googleapis.com': [field('creationTime', 'created', 'rfc3339-millis')],
  'storage.googleapis.com': [
    field('timeCreated', 'created', 'rfc3339-millis'),
    field('updated', 'updated', 'rfc3339-millis'),
  ],
  'bigquery.googleapis.com': [
    field('creationTime', 'created', 'epoch-millis'),
    field('lastModifiedTime', 'updated', 'epoch-millis'),
  ],
  ...Object.fromEntries(
    [
      'alloydb.googleapis.com',
      'apigateway.googleapis.com',
      'apphub.googleapis.com',
      'artifactregistry.googleapis.com',
      'backupdr.googleapis.com',
      'batch.googleapis.com',
      'certificatemanager.googleapis.com',
      'clouddeploy.googleapis.com',
      'config.googleapis.com',
      'dataplex.googleapis.com',
      'datastream.googleapis.com',
      'dlp.googleapis.com',
      'file.googleapis.com',
      'firestore.googleapis.com',
      'gkebackup.googleapis.com',
      'ids.googleapis.com',
      'logging.googleapis.com',
      'managedkafka.googleapis.com',
      'memorystore.googleapis.com',
      'metastore.googleapis.com',
      'networkconnectivity.googleapis.com',
      'networksecurity.googleapis.com',
      'networkservices.googleapis.com',
      'notebooks.googleapis.com',
      'aiplatform.googleapis.com',
      'privateca.googleapis.com',
      'servicedirectory.googleapis.com',
      'vmwareengine.googleapis.com',
      'workflows.googleapis.com',
    ].map((service) => [service, V2_TIMES]),
  ),
  'cloudbuild.googleapis.com': [field('createTime', 'created', 'rfc3339-micros')],
  'apigee.googleapis.com': [field('createdAt', 'created', 'epoch-millis')],
  'bigquerydatatransfer.googleapis.com': [field('updateTime', 'updated', 'rfc3339-micros')],
  'composer.googleapis.com': V2_TIMES,
  'dataform.googleapis.com': [field('createTime', 'created', 'rfc3339-micros')],
  'dataflow.googleapis.com': [
    field('createTime', 'created', 'rfc3339-micros'),
    field('currentStateTime', 'updated', 'rfc3339-micros'),
  ],
  'discoveryengine.googleapis.com': [field('createTime', 'created', 'rfc3339-micros')],
  'documentai.googleapis.com': [field('createTime', 'created', 'rfc3339-micros')],
  'domains.googleapis.com': [field('createTime', 'created', 'rfc3339-seconds')],
  'redis.googleapis.com': [field('createTime', 'created', 'rfc3339-micros')],
  'spanner.googleapis.com': V2_TIMES,
  'tpu.googleapis.com': [field('createTime', 'created', 'rfc3339-micros')],
  'binaryauthorization.googleapis.com': [field('updateTime', 'updated', 'rfc3339-micros')],
  'securitycenter.googleapis.com': [field('updateTime', 'updated', 'rfc3339-micros')],
  'storage.k8s.io': [K8S_CREATED],
  'batch.k8s.io': [K8S_CREATED],
  'autoscaling.k8s.io': [K8S_CREATED],
};

/** Per type, replacing the service entry. */
const BY_TYPE: Readonly<Record<string, readonly TimestampField[]>> = {
  'cloudresourcemanager.googleapis.com/Organization': [field('creationTime', 'created', 'rfc3339-millis')],
  'compute.googleapis.com/Instance': [
    COMPUTE_CREATED,
    field('lastStartTimestamp', 'created', 'compute', 41_000),
  ],
  'compute.googleapis.com/Disk': [COMPUTE_CREATED, field('lastAttachTimestamp', 'created', 'compute', 9_000)],
  'k8s.io/Pod': [K8S_CREATED, field('status.startTime', 'created', 'rfc3339-seconds')],
  'cloudkms.googleapis.com/CryptoKeyVersion': [
    field('createTime', 'created', 'rfc3339-micros'),
    field('generateTime', 'created', 'rfc3339-micros', 120),
  ],
  'cloudbuild.googleapis.com/Build': [
    field('createTime', 'created', 'rfc3339-micros'),
    field('startTime', 'created', 'rfc3339-micros', 4_200),
    field('finishTime', 'created', 'rfc3339-micros', 96_000),
  ],
  'container.googleapis.com/NodePool': [],
  'pubsub.googleapis.com/Topic': [],
  'pubsub.googleapis.com/Subscription': [],
  'pubsub.googleapis.com/Schema': [field('revisionCreateTime', 'updated', 'rfc3339-micros')],
  'cloudbuild.googleapis.com/WorkerPool': V2_TIMES,
  'cloudbuild.googleapis.com/Connection': V2_TIMES,
  'logging.googleapis.com/LogSink': [
    field('createTime', 'created', 'rfc3339-seconds'),
    field('updateTime', 'updated', 'rfc3339-seconds'),
  ],
  'sqladmin.googleapis.com/Backup': [field('backupInterval.startTime', 'created', 'rfc3339-millis')],
  'bigqueryreservation.googleapis.com/Reservation': [
    field('creationTime', 'created', 'rfc3339-seconds'),
    field('updateTime', 'updated', 'rfc3339-seconds'),
  ],
  'run.googleapis.com/Execution': [
    field('createTime', 'created', 'rfc3339-micros'),
    field('startTime', 'created', 'rfc3339-micros', 3_000),
  ],
  'workflows.googleapis.com/Workflow': [
    ...V2_TIMES,
    field('revisionCreateTime', 'updated', 'rfc3339-micros'),
  ],
  'monitoring.googleapis.com/AlertPolicy': [
    field('creationRecord.mutateTime', 'created', 'rfc3339-micros'),
    field('mutationRecord.mutateTime', 'updated', 'rfc3339-micros'),
  ],
  'monitoring.googleapis.com/NotificationChannel': [
    field('creationRecord.mutateTime', 'created', 'rfc3339-micros'),
  ],
};

export function timestampFields(assetType: string): readonly TimestampField[] {
  const own = BY_TYPE[assetType];
  if (own !== undefined) return own;
  const service = assetType.slice(0, assetType.indexOf('/'));
  return BY_SERVICE[service] ?? [];
}
