// SPDX-License-Identifier: MIT
/**
 * A deterministic synthetic Cloud Asset Inventory export for the performance budget: one organisation,
 * folders, projects and a realistic mix of asset types with realistic line sizes (Compute instances around
 * 2.5 KB, GKE pods around 3.5 KB, BigQuery tables with schemas, small service accounts and topics; about
 * 1.7 KB per line on average). Synthetic values only: organisation 30000000001, folders and projects below
 * 100000000000, `example.com` / `example.org`, private IP ranges.
 */
import { exportShape } from '../src/testing/helpers.js';

const ORG = 'organizations/30000000001';
const CRM = '//cloudresourcemanager.googleapis.com/';
const SELF = 'https://www.googleapis.com/compute/v1/projects/';
const REGIONS = ['europe-west3', 'europe-west1', 'us-central1', 'asia-northeast1'] as const;
const WORDS = [
  'shop',
  'billing',
  'search',
  'orders',
  'ledger',
  'catalog',
  'auth',
  'media',
  'events',
  'reports',
];

/** Mulberry-style 32-bit generator: deterministic, good enough for shaping test data. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
}

interface Project {
  readonly number: string;
  readonly id: string;
  readonly folder: string;
  readonly ancestors: readonly string[];
}

type Maker = (
  project: Project,
  n: number,
  pick: <T>(items: readonly T[]) => T,
  int: (max: number) => number,
) => unknown;

function asset(
  name: string,
  assetType: string,
  project: Project,
  data: unknown,
  location: string,
  updateTime: string,
  discovery: string,
) {
  return {
    name,
    assetType,
    resource: {
      version: 'v1',
      discoveryDocumentUri: discovery,
      discoveryName: assetType.split('/')[1],
      parent: `${CRM}projects/${project.number}`,
      data,
      location,
    },
    ancestors: project.ancestors,
    updateTime,
  };
}

const COMPUTE = 'https://www.googleapis.com/discovery/v1/apis/compute/v1/rest';
const time = (n: number) =>
  `2026-10-0${String(1 + (n % 7))}T${String(10 + (n % 13)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:${String((n * 7) % 60).padStart(2, '0')}.${String(n % 1000000).padStart(6, '0')}Z`;
const ip = (a: number, n: number) => `10.${String(a)}.${String((n >> 8) & 255)}.${String(n & 255)}`;

const makers: readonly (readonly [weight: number, make: Maker])[] = [
  [
    15,
    (p, n, pick, int) => {
      const region = pick(REGIONS);
      const zone = `${region}-${pick(['a', 'b', 'c'])}`;
      const name = `${pick(WORDS)}-vm-${String(n)}`;
      return asset(
        `//compute.googleapis.com/projects/${p.id}/zones/${zone}/instances/${name}`,
        'compute.googleapis.com/Instance',
        p,
        {
          canIpForward: false,
          cpuPlatform: 'Intel Cascade Lake',
          creationTimestamp: '2025-06-01T10:00:00.000-07:00',
          deletionProtection: false,
          description: `Worker ${String(n)} for the ${pick(WORDS)} service`,
          disks: [
            {
              autoDelete: true,
              boot: true,
              deviceName: name,
              diskSizeGb: String(10 * (1 + int(10))),
              guestOsFeatures: [
                { type: 'UEFI_COMPATIBLE' },
                { type: 'VIRTIO_SCSI_MULTIQUEUE' },
                { type: 'GVNIC' },
              ],
              index: 0,
              interface: 'SCSI',
              licenses: [`${SELF}demo-images-1/global/licenses/base-os`],
              mode: 'READ_WRITE',
              source: `${SELF}${p.id}/zones/${zone}/disks/${name}`,
              type: 'PERSISTENT',
            },
          ],
          id: String(5000000000000000000 + n),
          labels: { app: pick(WORDS), env: pick(['prod', 'staging', 'dev']), team: pick(WORDS) },
          machineType: `${SELF}${p.id}/zones/${zone}/machineTypes/${pick(['e2-medium', 'n2-standard-4', 'c3-standard-8'])}`,
          metadata: {
            fingerprint: 'c3ludGhldGljMg==',
            items: [
              {
                key: 'created-by',
                value: `projects/${p.number}/zones/${zone}/instanceGroupManagers/${pick(WORDS)}-mig`,
              },
              { key: 'enable-oslogin', value: 'TRUE' },
              {
                key: 'startup-script',
                value: '#!/bin/bash\necho "starting"\nsystemctl restart app.service\n',
              },
            ],
          },
          name,
          networkInterfaces: [
            {
              fingerprint: 'c3ludGhldGljMw==',
              name: 'nic0',
              network: `${SELF}demo-host-1/global/networks/shared`,
              networkIP: ip(10, n),
              stackType: 'IPV4_ONLY',
              subnetwork: `${SELF}demo-host-1/regions/${region}/subnetworks/${pick(WORDS)}`,
            },
          ],
          scheduling: {
            automaticRestart: true,
            onHostMaintenance: 'MIGRATE',
            preemptible: false,
            provisioningModel: 'STANDARD',
          },
          selfLink: `${SELF}${p.id}/zones/${zone}/instances/${name}`,
          serviceAccounts: [
            {
              email: `${pick(WORDS)}-runtime@example.com`,
              scopes: ['https://www.googleapis.com/auth/cloud-platform'],
            },
          ],
          shieldedInstanceConfig: {
            enableIntegrityMonitoring: true,
            enableSecureBoot: true,
            enableVtpm: true,
          },
          status: pick(['RUNNING', 'RUNNING', 'RUNNING', 'TERMINATED']),
          tags: { fingerprint: 'c3ludGhldGljNA==', items: ['web', 'allow-health-checks'] },
          zone: `${SELF}${p.id}/zones/${zone}`,
        },
        zone,
        time(n),
        COMPUTE,
      );
    },
  ],
  [
    15,
    (p, n, pick, int) => {
      const zone = `${pick(REGIONS)}-b`;
      const name = `${pick(WORDS)}-disk-${String(n)}`;
      return asset(
        `//compute.googleapis.com/projects/${p.id}/zones/${zone}/disks/${name}`,
        'compute.googleapis.com/Disk',
        p,
        {
          creationTimestamp: '2025-06-01T10:00:00.000-07:00',
          id: String(5100000000000000000 + n),
          labels: { app: pick(WORDS) },
          licenses: [`${SELF}demo-images-1/global/licenses/base-os`],
          name,
          physicalBlockSizeBytes: '4096',
          selfLink: `${SELF}${p.id}/zones/${zone}/disks/${name}`,
          sizeGb: String(10 * (1 + int(50))),
          sourceImage: `${SELF}demo-images-1/global/images/base-os-v20260901`,
          status: 'READY',
          type: `${SELF}${p.id}/zones/${zone}/diskTypes/pd-balanced`,
          users: [`${SELF}${p.id}/zones/${zone}/instances/${pick(WORDS)}-vm-${String(n)}`],
          zone: `${SELF}${p.id}/zones/${zone}`,
        },
        zone,
        time(n),
        COMPUTE,
      );
    },
  ],
  [
    12,
    (p, n, pick, int) => {
      const region = pick(REGIONS);
      const app = pick(WORDS);
      const name = `${app}-7d9f8c6b5-${String(n)}`;
      const container = (index: number) => ({
        image: `${region}-docker.example.org/${p.id}/${app}/server:1.${String(int(20))}.${String(index)}`,
        imagePullPolicy: 'IfNotPresent',
        name: index === 0 ? app : `sidecar-${String(index)}`,
        ports: [{ containerPort: 8080 + index, protocol: 'TCP' }],
        resources: { limits: { cpu: '1', memory: '512Mi' }, requests: { cpu: '250m', memory: '256Mi' } },
        env: [
          { name: 'APP_ENV', value: 'production' },
          { name: 'TOPIC', value: `projects/${p.id}/topics/${app}` },
          { name: 'LOG_LEVEL', value: 'info' },
        ],
        volumeMounts: [
          {
            mountPath: '/var/run/secrets/kubernetes.io/serviceaccount',
            name: 'kube-api-access',
            readOnly: true,
          },
        ],
      });
      return asset(
        `//container.googleapis.com/projects/${p.id}/locations/${region}/clusters/apps/k8s/namespaces/${app}/pods/${name}`,
        'k8s.io/Pod',
        p,
        {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: {
            creationTimestamp: '2026-10-01T00:00:00Z',
            generateName: `${app}-7d9f8c6b5-`,
            labels: { app, 'pod-template-hash': '7d9f8c6b5' },
            name,
            namespace: app,
            ownerReferences: [
              {
                apiVersion: 'apps/v1',
                blockOwnerDeletion: true,
                controller: true,
                kind: 'ReplicaSet',
                name: `${app}-7d9f8c6b5`,
                uid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
              },
            ],
            uid: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
          },
          spec: {
            containers: [container(0), container(1)],
            dnsPolicy: 'ClusterFirst',
            nodeName: `gke-apps-default-pool-${String(n % 97)}`,
            restartPolicy: 'Always',
            serviceAccountName: app,
            terminationGracePeriodSeconds: 30,
          },
          status: {
            conditions: ['Initialized', 'Ready', 'ContainersReady', 'PodScheduled'].map((type) => ({
              lastTransitionTime: '2026-10-01T00:00:05Z',
              status: 'True',
              type,
            })),
            hostIP: ip(10, n),
            phase: 'Running',
            podIP: ip(64, n),
            qosClass: 'Burstable',
            startTime: '2026-10-01T00:00:00Z',
          },
        },
        region,
        time(n),
        'https://container.googleapis.com/$discovery/rest?version=v1',
      );
    },
  ],
  [
    8,
    (p, n, pick) => {
      const region = pick(REGIONS);
      const app = pick(WORDS);
      return asset(
        `//container.googleapis.com/projects/${p.id}/locations/${region}/clusters/apps/k8s/namespaces/${app}/services/${app}-${String(n)}`,
        'k8s.io/Service',
        p,
        {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: {
            creationTimestamp: '2026-09-01T00:00:00Z',
            labels: { app },
            name: `${app}-${String(n)}`,
            namespace: app,
            uid: `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`,
          },
          spec: {
            clusterIP: ip(68, n),
            ports: [{ name: 'http', port: 80, protocol: 'TCP', targetPort: 8080 }],
            selector: { app },
            sessionAffinity: 'None',
            type: 'ClusterIP',
          },
          status: { loadBalancer: {} },
        },
        region,
        time(n),
        'https://container.googleapis.com/$discovery/rest?version=v1',
      );
    },
  ],
  [
    8,
    (p, n, pick) => {
      const region = pick(REGIONS);
      return asset(
        `//compute.googleapis.com/projects/${p.id}/global/firewalls/allow-${String(n)}`,
        'compute.googleapis.com/Firewall',
        p,
        {
          allowed: [{ IPProtocol: 'tcp', ports: ['80', '443', '8080'] }],
          creationTimestamp: '2024-03-04T01:06:00.000-07:00',
          description: `Allow ${pick(WORDS)} traffic in ${region}`,
          direction: 'INGRESS',
          disabled: false,
          id: String(5200000000000000000 + n),
          name: `allow-${String(n)}`,
          network: `${SELF}${p.id}/global/networks/default`,
          priority: 1000,
          selfLink: `${SELF}${p.id}/global/firewalls/allow-${String(n)}`,
          sourceRanges: ['10.0.0.0/8', '172.16.0.0/12'],
          targetTags: ['web'],
        },
        'global',
        time(n),
        COMPUTE,
      );
    },
  ],
  [
    8,
    (p, n, pick) =>
      asset(
        `//iam.googleapis.com/projects/${p.id}/serviceAccounts/${String(40000000000 + n)}`,
        'iam.googleapis.com/ServiceAccount',
        p,
        {
          displayName: `${pick(WORDS)} runtime`,
          email: `${pick(WORDS)}-${String(n)}@example.com`,
          name: `projects/${p.id}/serviceAccounts/${pick(WORDS)}-${String(n)}@example.com`,
          oauth2ClientId: String(40000000000 + n),
          projectId: p.id,
          uniqueId: String(40000000000 + n),
        },
        'global',
        time(n),
        'https://iam.googleapis.com/$discovery/rest',
      ),
  ],
  [
    8,
    (p, n, pick) => {
      const region = pick(REGIONS);
      return asset(
        `//storage.googleapis.com/${p.id}-${pick(WORDS)}-${String(n)}`,
        'storage.googleapis.com/Bucket',
        p,
        {
          iamConfiguration: {
            publicAccessPrevention: 'enforced',
            uniformBucketLevelAccess: { enabled: true },
          },
          id: `${p.id}-bucket-${String(n)}`,
          labels: { app: pick(WORDS) },
          lifecycle: { rule: [{ action: { type: 'Delete' }, condition: { age: 365 } }] },
          location: region.toUpperCase(),
          locationType: 'region',
          name: `${p.id}-bucket-${String(n)}`,
          projectNumber: p.number,
          softDeletePolicy: { effectiveTime: '2025-01-01T00:00:00Z', retentionDurationSeconds: '604800' },
          storageClass: 'STANDARD',
          timeCreated: '2025-05-20T08:00:00.000Z',
          updated: '2026-09-01T00:00:00.000Z',
          versioning: { enabled: true },
        },
        region,
        time(n),
        'https://www.googleapis.com/discovery/v1/apis/storage/v1/rest',
      );
    },
  ],
  [
    10,
    (p, n, pick, int) => {
      const dataset = pick(WORDS);
      const fields = Array.from({ length: 8 + int(16) }, (_, index) => ({
        description: `Column ${String(index)} of the ${dataset} table`,
        mode: index === 0 ? 'REQUIRED' : 'NULLABLE',
        name: `${pick(WORDS)}_${String(index)}`,
        type: pick(['STRING', 'INTEGER', 'TIMESTAMP', 'NUMERIC', 'BOOLEAN']),
      }));
      return asset(
        `//bigquery.googleapis.com/projects/${p.id}/datasets/${dataset}/tables/t_${String(n)}`,
        'bigquery.googleapis.com/Table',
        p,
        {
          creationTime: '1759276800000',
          id: `${p.id}:${dataset}.t_${String(n)}`,
          kind: 'bigquery#table',
          lastModifiedTime: '1759363200000',
          location: 'EU',
          numBytes: String(int(1e9)),
          numRows: String(int(1e7)),
          schema: { fields },
          tableReference: { datasetId: dataset, projectId: p.id, tableId: `t_${String(n)}` },
          type: 'TABLE',
        },
        'eu',
        time(n),
        'https://bigquery.googleapis.com/discovery/v1/apis/bigquery/v2/rest',
      );
    },
  ],
  [
    8,
    (p, n, pick) =>
      asset(
        `//pubsub.googleapis.com/projects/${p.id}/topics/${pick(WORDS)}-${String(n)}`,
        'pubsub.googleapis.com/Topic',
        p,
        {
          labels: { app: pick(WORDS) },
          messageStoragePolicy: { allowedPersistenceRegions: ['europe-west3'] },
          name: `projects/${p.id}/topics/${pick(WORDS)}-${String(n)}`,
        },
        'global',
        time(n),
        'https://pubsub.googleapis.com/$discovery/rest',
      ),
  ],
  [
    4,
    (p, n, pick) => {
      const region = pick(REGIONS);
      const app = pick(WORDS);
      return asset(
        `//run.googleapis.com/projects/${p.id}/locations/${region}/services/${app}-${String(n)}`,
        'run.googleapis.com/Service',
        p,
        {
          apiVersion: 'serving.knative.dev/v1',
          kind: 'Service',
          metadata: {
            annotations: { 'run.googleapis.com/ingress': 'internal-and-cloud-load-balancing' },
            name: `${app}-${String(n)}`,
            namespace: p.number,
          },
          spec: {
            template: {
              metadata: {
                annotations: {
                  'run.googleapis.com/vpc-access-connector': `projects/demo-host-1/locations/${region}/connectors/serverless`,
                },
              },
              spec: {
                containerConcurrency: 80,
                containers: [
                  {
                    image: `${region}-docker.example.org/${p.id}/${app}/server:2.0.${String(n % 50)}`,
                    ports: [{ containerPort: 8080, name: 'http1' }],
                    resources: { limits: { cpu: '1', memory: '512Mi' } },
                  },
                ],
                serviceAccountName: `${app}-runtime@example.com`,
                timeoutSeconds: 300,
              },
            },
            traffic: [{ latestRevision: true, percent: 100 }],
          },
          status: { url: `https://${app}-${String(n)}.example.org` },
        },
        region,
        time(n),
        'https://run.googleapis.com/$discovery/rest',
      );
    },
  ],
  [
    4,
    (p, n, pick) => {
      const region = pick(REGIONS);
      return asset(
        `//cloudkms.googleapis.com/projects/${p.id}/locations/${region}/keyRings/app/cryptoKeys/k-${String(n)}`,
        'cloudkms.googleapis.com/CryptoKey',
        p,
        {
          createTime: '2025-05-01T00:00:00Z',
          name: `projects/${p.id}/locations/${region}/keyRings/app/cryptoKeys/k-${String(n)}`,
          primary: {
            algorithm: 'GOOGLE_SYMMETRIC_ENCRYPTION',
            name: `projects/${p.id}/locations/${region}/keyRings/app/cryptoKeys/k-${String(n)}/cryptoKeyVersions/1`,
            state: 'ENABLED',
          },
          purpose: 'ENCRYPT_DECRYPT',
          rotationPeriod: '7776000s',
        },
        region,
        time(n),
        'https://cloudkms.googleapis.com/$discovery/rest?version=v1',
      );
    },
  ],
];

/**
 * `count` NDJSON lines (each ending in LF): the organisation, folders, one Project asset per 1 000 assets,
 * then a weighted mix of the asset types above. `export` (the default) writes the snake_case envelope keys of
 * an `exportAssets` file; `list` writes the camelCase `assets.list` shape.
 */
export function syntheticExport(count: number, seed = 1, style: 'export' | 'list' = 'export'): string {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const int = (max: number) => Math.floor(next() * max);
  const projectCount = Math.max(1, Math.ceil(count / 1000));
  const folders = Array.from({ length: Math.max(1, Math.ceil(projectCount / 10)) }, (_, index) =>
    String(20000000100 + index),
  );
  const projects: Project[] = Array.from({ length: projectCount }, (_, index) => {
    const folder = folders[index % folders.length] ?? '20000000100';
    const number = String(10000000100 + index);
    return {
      number,
      id: `demo-p-${String(index)}`,
      folder,
      ancestors: [`projects/${number}`, `folders/${folder}`, ORG],
    };
  });
  const lines: string[] = [];
  const push = (value: unknown) =>
    lines.push(JSON.stringify(style === 'export' ? exportShape(value as Record<string, unknown>) : value));
  push({
    name: `${CRM}${ORG}`,
    assetType: 'cloudresourcemanager.googleapis.com/Organization',
    resource: {
      version: 'v1',
      discoveryName: 'Organization',
      data: { displayName: 'example.com', lifecycleState: 'ACTIVE', name: ORG },
      location: 'global',
    },
    ancestors: [ORG],
    updateTime: time(0),
  });
  for (const folder of folders) {
    if (lines.length >= count) break;
    push({
      name: `${CRM}folders/${folder}`,
      assetType: 'cloudresourcemanager.googleapis.com/Folder',
      resource: {
        version: 'v2',
        discoveryName: 'Folder',
        parent: `${CRM}${ORG}`,
        data: {
          displayName: `Folder ${folder}`,
          lifecycleState: 'ACTIVE',
          name: `folders/${folder}`,
          parent: ORG,
        },
        location: 'global',
      },
      ancestors: [`folders/${folder}`, ORG],
      updateTime: time(1),
    });
  }
  for (const project of projects) {
    if (lines.length >= count) break;
    push({
      name: `${CRM}projects/${project.number}`,
      assetType: 'cloudresourcemanager.googleapis.com/Project',
      resource: {
        version: 'v1',
        discoveryName: 'Project',
        parent: `${CRM}folders/${project.folder}`,
        data: {
          lifecycleState: 'ACTIVE',
          name: project.id,
          parent: { id: project.folder, type: 'folder' },
          projectId: project.id,
          projectNumber: project.number,
        },
        location: 'global',
      },
      ancestors: project.ancestors,
      updateTime: time(2),
    });
  }
  const totalWeight = makers.reduce((sum, [weight]) => sum + weight, 0);
  for (let n = lines.length; n < count; n += 1) {
    let roll = next() * totalWeight;
    let make = makers[0]?.[1];
    for (const [weight, maker] of makers) {
      make = maker;
      roll -= weight;
      if (roll < 0) break;
    }
    if (make === undefined) throw new Error('no asset makers');
    push(make(projects[n % projects.length] as Project, n, pick, int));
  }
  return `${lines.join('\n')}\n`;
}
