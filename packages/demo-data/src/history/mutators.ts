// SPDX-License-Identifier: MIT
/**
 * The everyday changes the history applies: one plausible field change per asset type (a disk resize, a new
 * Cloud Run revision, a firewall rule that gains a source range, …). `forward` receives the asset's data and
 * the change instant and returns the new data; the planner writes the new update time. Types without an entry
 * never change in the daily churn.
 */
import type { GenAsset } from '../builder/types.js';
import { getPath, isJsonObject, setPath, updatePath, type JsonObject, type JsonValue } from '../core/json.js';

export interface Mutator {
  /** Dotted paths inside `data` that the change touches. */
  readonly fields: readonly string[];
  readonly forward: (data: JsonObject, at: number) => JsonObject;
}

function numeric(value: JsonValue | undefined, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

function asObject(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {};
}

function label(path: readonly string[], key: string, value: string): Mutator {
  return {
    fields: [[...path, key].join('.')],
    forward: (data) => setPath(data, path, { ...asObject(getPath(data, path)), [key]: value }),
  };
}

function bumpVersionTag(image: JsonValue | undefined): string {
  const text = typeof image === 'string' ? image : '';
  const match = /^(.*):(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (match === null) return `${text}-1`;
  return `${match[1] ?? ''}:${match[2] ?? '0'}.${match[3] ?? '0'}.${String(Number(match[4]) + 1)}`;
}

/** Mutators by asset type; a function so that the change can depend on the current data. */
const MUTATORS: Readonly<Record<string, (asset: GenAsset) => Mutator | undefined>> = {
  'compute.googleapis.com/Disk': () => ({
    fields: ['sizeGb'],
    forward: (data) => updatePath(data, ['sizeGb'], (v) => String(numeric(v, 20) * 2)),
  }),
  'compute.googleapis.com/Instance': () => label(['labels'], 'patch-group', 'wave-2'),
  'compute.googleapis.com/Firewall': (asset) =>
    Array.isArray(asset.data['sourceRanges'])
      ? {
          fields: ['sourceRanges'],
          forward: (data) =>
            updatePath(data, ['sourceRanges'], (v) => [...(Array.isArray(v) ? v : []), '172.16.32.0/20']),
        }
      : undefined,
  'compute.googleapis.com/Subnetwork': () => ({
    fields: ['logConfig.flowSampling'],
    forward: (data) => setPath(data, ['logConfig', 'flowSampling'], 1),
  }),
  'compute.googleapis.com/BackendService': () => ({
    fields: ['timeoutSec'],
    forward: (data) => updatePath(data, ['timeoutSec'], (v) => numeric(v, 30) * 2),
  }),
  'compute.googleapis.com/SecurityPolicy': () => ({
    fields: ['rules'],
    forward: (data) =>
      updatePath(data, ['rules'], (v) => [
        ...(Array.isArray(v) ? v : []),
        {
          kind: 'compute#securityPolicyRule',
          description: 'Throttle abusive clients',
          priority: 2000,
          action: 'throttle',
          match: { versionedExpr: 'SRC_IPS_V1', config: { srcIpRanges: ['*'] } },
          rateLimitOptions: {
            conformAction: 'allow',
            exceedAction: 'deny(429)',
            rateLimitThreshold: { count: 600, intervalSec: 60 },
          },
          preview: false,
        },
      ]),
  }),
  'storage.googleapis.com/Bucket': () => ({
    fields: ['versioning.enabled', 'metageneration'],
    forward: (data) =>
      updatePath(
        updatePath(data, ['versioning', 'enabled'], (v) => v !== true),
        ['metageneration'],
        (v) => String(numeric(v, 1) + 1),
      ),
  }),
  'bigquery.googleapis.com/Table': (asset) =>
    asset.data['type'] === 'TABLE'
      ? {
          fields: ['numRows', 'numBytes'],
          forward: (data) =>
            updatePath(
              updatePath(data, ['numRows'], (v) => String(Math.round(numeric(v, 0) * 1.05) + 1000)),
              ['numBytes'],
              (v) => String(Math.round(numeric(v, 0) * 1.05) + 200_000),
            ),
        }
      : undefined,
  'bigquery.googleapis.com/Dataset': () => label(['labels'], 'data-classification', 'confidential'),
  'run.googleapis.com/Service': () => ({
    fields: ['generation', 'template.containers', 'latestReadyRevision', 'latestCreatedRevision'],
    forward: (data) => {
      const generation = numeric(data['generation'], 1) + 1;
      const revision = typeof data['latestReadyRevision'] === 'string' ? data['latestReadyRevision'] : '';
      const next = revision.replace(
        /-(\d{5})-([a-z0-9]{3})$/,
        (_, __, hash: string) => `-${String(generation).padStart(5, '0')}-${hash}`,
      );
      const containers = getPath(data, ['template', 'containers']);
      const updated = Array.isArray(containers)
        ? containers.map((c, i) =>
            i === 0 && isJsonObject(c) ? { ...c, image: bumpVersionTag(c['image']) } : c,
          )
        : [];
      return {
        ...setPath(data, ['template', 'containers'], updated),
        generation: String(generation),
        observedGeneration: String(generation),
        latestReadyRevision: next,
        latestCreatedRevision: next,
      };
    },
  }),
  'sqladmin.googleapis.com/Instance': () => ({
    fields: ['settings.settingsVersion', 'settings.dataDiskSizeGb'],
    forward: (data) =>
      updatePath(
        updatePath(data, ['settings', 'settingsVersion'], (v) => String(numeric(v, 1) + 1)),
        ['settings', 'dataDiskSizeGb'],
        (v) => String(numeric(v, 100) + 50),
      ),
  }),
  'pubsub.googleapis.com/Subscription': () => ({
    fields: ['ackDeadlineSeconds'],
    forward: (data) => updatePath(data, ['ackDeadlineSeconds'], (v) => (numeric(v, 10) >= 60 ? 30 : 60)),
  }),
  'pubsub.googleapis.com/Topic': () => ({
    fields: ['messageRetentionDuration'],
    forward: (data) => setPath(data, ['messageRetentionDuration'], '1209600s'),
  }),
  'apps.k8s.io/Deployment': () => ({
    fields: [
      'metadata.generation',
      "metadata.annotations['deployment.kubernetes.io/revision']",
      'status.observedGeneration',
    ],
    forward: (data) => {
      const generation = numeric(getPath(data, ['metadata', 'generation']), 1) + 1;
      const withMeta = setPath(
        setPath(data, ['metadata', 'generation'], generation),
        ['metadata', 'annotations', 'deployment.kubernetes.io/revision'],
        String(generation),
      );
      return setPath(withMeta, ['status', 'observedGeneration'], generation);
    },
  }),
  'container.googleapis.com/NodePool': () => ({
    fields: ['autoscaling.maxNodeCount'],
    forward: (data) => updatePath(data, ['autoscaling', 'maxNodeCount'], (v) => numeric(v, 3) + 2),
  }),
  'cloudresourcemanager.googleapis.com/Project': () => label(['labels'], 'cost-center', 'cc-2042'),
  'iam.googleapis.com/ServiceAccount': () => ({
    fields: ['description'],
    forward: (data) => setPath(data, ['description'], 'Reviewed in the quarterly access review'),
  }),
  'dns.googleapis.com/ResourceRecordSet': () => ({
    fields: ['ttl'],
    forward: (data) => updatePath(data, ['ttl'], (v) => (numeric(v, 300) === 60 ? 300 : 60)),
  }),
  'secretmanager.googleapis.com/Secret': () => label(['labels'], 'rotation', 'quarterly'),
  'cloudfunctions.googleapis.com/Function': () => ({
    fields: ['serviceConfig.availableMemory'],
    forward: (data) => setPath(data, ['serviceConfig', 'availableMemory'], '512M'),
  }),
  // The optional generator cases (features.ts).
  'compute.googleapis.com/FirewallPolicy': () => ({
    fields: ['rules', 'ruleTupleCount'],
    forward: (data) =>
      updatePath(
        updatePath(data, ['rules'], (v) => [
          ...(Array.isArray(v) ? v : []),
          {
            kind: 'compute#firewallPolicyRule',
            priority: 3000,
            direction: 'INGRESS',
            action: 'deny',
            description: 'Block a scanning range seen in the IDS alerts',
            match: { srcIpRanges: ['203.0.113.128/28'], layer4Configs: [{ ipProtocol: 'all' }] },
            enableLogging: true,
            ruleTupleCount: 2,
          },
        ]),
        ['ruleTupleCount'],
        (v) => numeric(v, 0) + 2,
      ),
  }),
  'compute.googleapis.com/Reservation': () => ({
    fields: ['specificReservation.count'],
    forward: (data) => updatePath(data, ['specificReservation', 'count'], (v) => String(numeric(v, 2) + 1)),
  }),
  'redis.googleapis.com/Instance': () => ({
    fields: ['memorySizeGb'],
    forward: (data) => updatePath(data, ['memorySizeGb'], (v) => numeric(v, 5) * 2),
  }),
  'memorystore.googleapis.com/Instance': () => ({
    fields: ['shardCount'],
    forward: (data) => updatePath(data, ['shardCount'], (v) => numeric(v, 3) + 1),
  }),
  'alloydb.googleapis.com/Instance': () => ({
    fields: ['machineConfig.cpuCount'],
    forward: (data) => updatePath(data, ['machineConfig', 'cpuCount'], (v) => numeric(v, 4) * 2),
  }),
  'spanner.googleapis.com/Instance': () => ({
    fields: ['processingUnits'],
    forward: (data) => updatePath(data, ['processingUnits'], (v) => numeric(v, 1000) + 500),
  }),
  'bigtableadmin.googleapis.com/Cluster': () => ({
    fields: ['serveNodes'],
    forward: (data) => updatePath(data, ['serveNodes'], (v) => numeric(v, 3) + 1),
  }),
  'file.googleapis.com/Instance': () => ({
    fields: ['fileShares'],
    forward: (data) =>
      updatePath(data, ['fileShares'], (v) =>
        (Array.isArray(v) ? v : []).map((share, i) =>
          i === 0 && isJsonObject(share)
            ? { ...share, capacityGb: String(numeric(share['capacityGb'], 1024) + 512) }
            : share,
        ),
      ),
  }),
  'workflows.googleapis.com/Workflow': () => ({
    fields: ['revisionId'],
    forward: (data) =>
      updatePath(data, ['revisionId'], (v) => {
        const text = typeof v === 'string' ? v : '000001-abc';
        const revision = Number(text.slice(0, 6)) + 1;
        return `${String(revision).padStart(6, '0')}${text.slice(6)}`;
      }),
  }),
  'artifactregistry.googleapis.com/Repository': () => ({
    fields: ['sizeBytes'],
    forward: (data) => updatePath(data, ['sizeBytes'], (v) => String(numeric(v, 0) + 268_435_456)),
  }),
  'cloudbuild.googleapis.com/BuildTrigger': () => ({
    fields: ['build.timeout'],
    forward: (data) => setPath(data, ['build', 'timeout'], '1800s'),
  }),
  'logging.googleapis.com/LogBucket': () => ({
    fields: ['retentionDays'],
    forward: (data) => updatePath(data, ['retentionDays'], (v) => numeric(v, 30) + 30),
  }),
  'monitoring.googleapis.com/AlertPolicy': () => label(['userLabels'], 'runbook', 'reviewed'),
  'dns.googleapis.com/Policy': () => ({
    fields: ['enableLogging'],
    forward: (data) => updatePath(data, ['enableLogging'], (v) => v !== true),
  }),
  'composer.googleapis.com/Environment': () => ({
    fields: ['config.softwareConfig.imageVersion'],
    forward: (data) =>
      setPath(data, ['config', 'softwareConfig', 'imageVersion'], 'composer-2.10.1-airflow-2.10.2'),
  }),
  'aiplatform.googleapis.com/Endpoint': () => label(['labels'], 'traffic-split', 'canary-10'),
  'networkconnectivity.googleapis.com/Spoke': () => label(['labels'], 'reviewed', 'q4'),
  'k8s.io/ServiceAccount': () => label(['metadata', 'labels'], 'team-owned', 'true'),
};

export function mutatorFor(asset: GenAsset): Mutator | undefined {
  return MUTATORS[asset.assetType]?.(asset);
}
