// SPDX-License-Identifier: MIT
/**
 * A GKE workload in a Shared VPC service project: a regional private cluster on a host subnet with secondary
 * ranges, node pools (and, where the profile asks for it, the managed instance groups, templates and VMs GKE
 * creates for them, with matching Kubernetes Node objects), a fleet membership, namespaces with deployments,
 * replica sets, pods and services, and an ingress with the external load balancer the ingress controller
 * creates. Pods carry a predecessor factory: the history restarts them.
 */
import type { AddInput, OrgBuilder } from '../builder/builder.js';
import type { GenAsset } from '../builder/types.js';
import { podSuffix, templateHash, uuid } from '../core/ids.js';
import { CidrPool, HostPool, hostAt } from '../core/ip.js';
import type { JsonObject } from '../core/json.js';
import { at, type Rng } from '../core/rng.js';
import { addInstanceTemplate, addManagedInstanceGroup } from './compute.js';
import { hostFor, type OrgContext } from './context.js';
import { uuidFrom } from './fabric.js';
import { has } from './features.js';
import {
  addCompute,
  addProject,
  addProjectAsset,
  addServiceAccount,
  fullName,
  standardLabels,
  type ContainerCtx,
  type ProjectCtx,
} from './kit.js';
import { addManagedZone, addSubnet, type HostNetwork, type SubnetRef } from './network.js';
import { addFilestore } from './stores.js';
import { title, webDomain } from './web.js';
import {
  GKE_NODE_IMAGE,
  GKE_VERSION,
  MACHINE_TYPES,
  MICROSERVICES,
  NAMESPACES,
  nth,
  type Env,
  type Region,
} from './vocabulary.js';

export interface GkeProfile {
  readonly nodePools: number;
  /** Node locations of the regional cluster. */
  readonly zones: number;
  readonly nodesPerZone: number;
  readonly namespaces: number;
  readonly deploymentsPerNamespace: number;
  readonly replicas: number;
  /** The instance groups, templates, VMs and Kubernetes Node objects behind the node pools. */
  readonly nodeVms: boolean;
  /** `default` and `kube-system` with kube-dns and a per-node logging DaemonSet. */
  readonly systemWorkloads: boolean;
  /** The external load balancer the GKE ingress controller creates. */
  readonly ingressLb: boolean;
  readonly membership: boolean;
  /** The firewall rules GKE creates for the cluster in the host project. */
  readonly firewallRules: boolean;
  /**
   * Kubernetes service accounts (feature `kubernetes`): `workload` gives every workload namespace one bound to
   * a Google service account through Workload Identity; `all` also lists each namespace's `default` account.
   */
  readonly serviceAccounts: 'none' | 'workload' | 'all';
}

const POOLS: readonly string[] = ['default-pool', 'apps-pool', 'batch-pool', 'highmem-pool'];

interface Node {
  readonly name: string;
  readonly zone: string;
  readonly ip: string;
  /** The node's slice of the pod range; its pods take their addresses from it. */
  readonly podCidr: string;
  readonly pods: HostPool;
}

interface Cluster {
  readonly project: ProjectCtx;
  readonly name: string;
  readonly full: string;
  readonly region: Region;
  readonly createdAt: number;
  readonly podBlocks: CidrPool;
  readonly serviceHosts: HostPool;
  readonly nodes: Node[];
  readonly rng: Rng;
}

export function addGkeProject(
  ctx: OrgContext,
  folder: ContainerCtx,
  team: string,
  env: Env,
  region: Region,
): ProjectCtx {
  const { b, profile } = ctx;
  const gke = profile.gke;
  const host = hostFor(ctx, env);
  const project = addProject(b, folder, {
    role: 'gke',
    displayName: `${title(team)} platform (${env})`,
    env,
    region,
    team,
  });
  const rng = b.rng.fork(`gke:${project.id}`);
  const clusterName = `${team}-${env}`;
  const clusterHash = rng.hex(8);
  const zones = region.zones.slice(0, gke.zones);
  const totalNodes = gke.nodePools * zones.length * gke.nodesPerZone;
  const podPrefix = 24 - Math.ceil(Math.log2(Math.max(4, totalNodes * 2)));
  const podRange = b.addresses.pods.allocate(podPrefix);
  const serviceRange = b.addresses.services.allocate(22);
  const subnet = addSubnet(b, host, {
    region,
    name: `${project.id}-gke-${region.name}`,
    prefix: 22,
    secondary: [
      { rangeName: `pods-${clusterName}`, ipCidrRange: podRange },
      { rangeName: `services-${clusterName}`, ipCidrRange: serviceRange },
    ],
  });
  const nodesAccount = addServiceAccount(b, project, 'gke-nodes', 'GKE node pools');
  const k8sCases = has(profile, 'kubernetes');
  const workloadAccount =
    k8sCases && gke.serviceAccounts !== 'none' && env === 'prod'
      ? addServiceAccount(b, project, 'gke-workloads', 'Kubernetes workloads (Workload Identity)')
      : undefined;
  const bootDiskKey = k8sCases ? ctx.keys.key(region.name, 'gke') : undefined;
  // Binary Authorization: the project policy requires the security project's attestor (feature `security`).
  const securityProject = ctx.keys.project;
  const attestor =
    has(profile, 'security') && securityProject !== undefined && env === 'prod'
      ? `projects/${securityProject.number}/attestors/build-verified`
      : undefined;
  const masterRange = b.addresses.controlPlanes.allocate(28);
  const publicEndpoint = ctx.once('gke-public-endpoint') ? b.addresses.external.next() : undefined;
  const clusterPath = `projects/${project.id}/locations/${region.name}/clusters/${clusterName}`;
  const full = fullName('container.googleapis.com', clusterPath);
  const createdAt = b.createdAt(full, subnet.createdAt);
  const cluster: Cluster = {
    project,
    name: clusterName,
    full,
    region,
    createdAt,
    podBlocks: new CidrPool(podRange, 'node pod range'),
    serviceHosts: new HostPool(serviceRange, 10),
    nodes: [],
    rng,
  };
  const nodeTag = `gke-${clusterName}-${clusterHash}-node`;
  const membershipPath = `projects/${project.number}/locations/global/memberships/${clusterName}`;
  if (gke.membership) {
    addProjectAsset(b, project, {
      assetType: 'gkehub.googleapis.com/Membership',
      name: fullName('gkehub.googleapis.com', membershipPath),
      location: 'global',
      after: createdAt,
      data: {
        name: membershipPath,
        endpoint: {
          gkeCluster: { resourceLink: full },
          kubernetesMetadata: { kubernetesApiServerVersion: `v${GKE_VERSION}` },
        },
        state: { code: 'READY' },
        uniqueId: uuid(rng),
        authority: {
          issuer: `https://container.googleapis.com/v1/${clusterPath}`,
          workloadIdentityPool: `${project.id}.svc.id.goog`,
          identityProvider: `https://container.googleapis.com/v1/${clusterPath}`,
        },
        monitoringConfig: { projectId: project.id, location: region.name, cluster: clusterName },
      },
    });
  }

  const pools: JsonObject[] = [];
  for (let p = 0; p < gke.nodePools; p++) {
    const pool = nth(POOLS, p);
    const poolHash = rng.hex(8);
    const groupUrls: string[] = [];
    const baseName = `gke-${clusterName}-${pool.replace('-pool', '')}-${poolHash}`;
    if (gke.nodeVms) {
      const template = addInstanceTemplate(b, project, {
        name: baseName,
        machineType: MACHINE_TYPES.gke,
        network: host.selfLink,
        subnetwork: subnet.selfLink,
        serviceAccount: nodesAccount.email,
        tags: [nodeTag],
        labels: {
          'goog-gke-node': '',
          'goog-k8s-cluster-name': clusterName,
          'goog-k8s-node-pool-name': pool,
        },
        image: GKE_NODE_IMAGE,
        diskSizeGb: 100,
        after: createdAt,
      });
      for (const zone of zones) {
        const mig = addManagedInstanceGroup(b, project, {
          name: `${baseName}-grp`,
          zone,
          baseInstanceName: baseName,
          template,
          size: gke.nodesPerZone,
          machineType: MACHINE_TYPES.gke,
          nic: { network: host.selfLink, subnetwork: subnet.selfLink },
          nextIp: () => subnet.hosts.next(),
          serviceAccount: nodesAccount.email,
          tags: [nodeTag],
          labels: {
            'goog-gke-node': '',
            'goog-k8s-cluster-name': clusterName,
            'goog-k8s-node-pool-name': pool,
          },
          namedPorts: [],
          image: GKE_NODE_IMAGE,
          imageLicense: 'https://www.googleapis.com/compute/v1/projects/cos-cloud/global/licenses/cos',
          diskSizeGb: 100,
          rng: rng.fork(`${pool}/${zone}`),
          pinned: true,
        });
        groupUrls.push(mig.manager.selfLink);
        for (const vm of mig.instances) {
          const node = newNode(cluster, vm.instance.name, zone, vm.ip);
          cluster.nodes.push(node);
          addK8s(
            b,
            cluster,
            'k8s.io/Node',
            `k8s/nodes/${node.name}`,
            {
              apiVersion: 'v1',
              kind: 'Node',
              metadata: {
                name: node.name,
                uid: uuid(rng),
                labels: {
                  'cloud.google.com/gke-nodepool': pool,
                  'cloud.google.com/machine-family': 'e2',
                  'kubernetes.io/hostname': node.name,
                  'node.kubernetes.io/instance-type': MACHINE_TYPES.gke,
                  'topology.kubernetes.io/region': region.name,
                  'topology.kubernetes.io/zone': zone,
                },
              },
              spec: { providerID: `gce://${project.id}/${zone}/${node.name}`, podCIDR: node.podCidr },
              status: {
                addresses: [
                  { type: 'InternalIP', address: node.ip },
                  { type: 'Hostname', address: node.name },
                ],
                nodeInfo: {
                  kubeletVersion: `v${GKE_VERSION}`,
                  osImage: 'Container-Optimized OS from Google',
                  containerRuntimeVersion: 'containerd://2.0.4',
                },
              },
            },
            vm.instance.asset.createdAt,
            { pinned: true },
          );
        }
      }
    } else {
      for (const zone of zones) {
        for (let n = 0; n < gke.nodesPerZone; n++) {
          cluster.nodes.push(
            newNode(
              cluster,
              `${baseName}-${rng.chars('abcdefghijklmnopqrstuvwxyz0123456789', 4)}`,
              zone,
              subnet.hosts.next(),
            ),
          );
        }
      }
    }
    const poolPath = `${clusterPath}/nodePools/${pool}`;
    const poolData: JsonObject = {
      name: pool,
      config: {
        machineType: MACHINE_TYPES.gke,
        diskSizeGb: 100,
        diskType: 'pd-balanced',
        imageType: 'COS_CONTAINERD',
        serviceAccount: nodesAccount.email,
        oauthScopes: ['https://www.googleapis.com/auth/cloud-platform'],
        workloadMetadataConfig: { mode: 'GKE_METADATA' },
        shieldedInstanceConfig: { enableSecureBoot: true, enableIntegrityMonitoring: true },
        ...(bootDiskKey === undefined ? {} : { bootDiskKmsKey: bootDiskKey }),
      },
      initialNodeCount: gke.nodesPerZone,
      autoscaling: {
        enabled: true,
        minNodeCount: 1,
        maxNodeCount: gke.nodesPerZone * 3,
        locationPolicy: 'BALANCED',
      },
      management: { autoUpgrade: true, autoRepair: true },
      locations: zones,
      version: GKE_VERSION,
      instanceGroupUrls: groupUrls,
      networkConfig: { podRange: `pods-${clusterName}`, podIpv4CidrBlock: podRange },
      status: 'RUNNING',
      podIpv4CidrSize: 24,
      selfLink: `https://container.googleapis.com/v1/${poolPath}`,
    };
    pools.push(poolData);
    addProjectAsset(b, project, {
      assetType: 'container.googleapis.com/NodePool',
      name: fullName('container.googleapis.com', poolPath),
      parent: full,
      location: region.name,
      after: createdAt,
      data: poolData,
    });
  }

  const kmsKey = ctx.keys.key(region.name, 'gke');
  addProjectAsset(b, project, {
    assetType: 'container.googleapis.com/Cluster',
    name: full,
    location: region.name,
    after: subnet.createdAt,
    data: {
      name: clusterName,
      description: `${title(team)} ${env} workloads`,
      selfLink: `https://container.googleapis.com/v1/${clusterPath}`,
      location: region.name,
      locations: zones,
      network: host.name,
      subnetwork: subnet.name,
      networkConfig: {
        network: `projects/${host.project.id}/global/networks/${host.name}`,
        subnetwork: subnet.path,
        datapathProvider: 'ADVANCED_DATAPATH',
        defaultSnatStatus: { disabled: false },
      },
      ipAllocationPolicy: {
        useIpAliases: true,
        clusterSecondaryRangeName: `pods-${clusterName}`,
        servicesSecondaryRangeName: `services-${clusterName}`,
        clusterIpv4CidrBlock: podRange,
        servicesIpv4CidrBlock: serviceRange,
        stackType: 'IPV4',
      },
      clusterIpv4Cidr: podRange,
      servicesIpv4Cidr: serviceRange,
      endpoint: publicEndpoint ?? hostAt(masterRange, 2),
      privateClusterConfig: {
        enablePrivateNodes: true,
        enablePrivateEndpoint: publicEndpoint === undefined,
        masterIpv4CidrBlock: masterRange,
        privateEndpoint: hostAt(masterRange, 2),
        ...(publicEndpoint === undefined ? {} : { publicEndpoint }),
      },
      masterAuthorizedNetworksConfig: {
        enabled: true,
        cidrBlocks: [{ displayName: 'corp', cidrBlock: '172.16.0.0/16' }],
      },
      nodeConfig: {
        machineType: MACHINE_TYPES.gke,
        serviceAccount: nodesAccount.email,
        imageType: 'COS_CONTAINERD',
        ...(bootDiskKey === undefined ? {} : { bootDiskKmsKey: bootDiskKey }),
      },
      nodePools: pools,
      ...(gke.membership
        ? { fleet: { project: project.ref, membership: fullName('gkehub.googleapis.com', membershipPath) } }
        : {}),
      databaseEncryption:
        kmsKey === undefined ? { state: 'DECRYPTED' } : { state: 'ENCRYPTED', keyName: kmsKey },
      ...(k8sCases && env === 'prod'
        ? { dnsConfig: { clusterDns: 'CLOUD_DNS', clusterDnsScope: 'CLUSTER_SCOPE' } }
        : {}),
      ...(attestor === undefined
        ? {}
        : { binaryAuthorization: { evaluationMode: 'PROJECT_SINGLETON_POLICY_ENFORCE' } }),
      workloadIdentityConfig: { workloadPool: `${project.id}.svc.id.goog` },
      releaseChannel: { channel: 'REGULAR' },
      currentMasterVersion: GKE_VERSION,
      currentNodeVersion: GKE_VERSION,
      initialClusterVersion: '1.30.5-gke.1014001',
      status: 'RUNNING',
      loggingService: 'logging.googleapis.com/kubernetes',
      monitoringService: 'monitoring.googleapis.com/kubernetes',
      resourceLabels: standardLabels(project),
      id: rng.hex(32),
      autopilot: { enabled: false },
    },
    traits: { pinned: true },
  });
  if (gke.firewallRules)
    addClusterFirewallRules(
      b,
      host,
      clusterName,
      clusterHash,
      nodeTag,
      podRange,
      masterRange,
      subnet,
      createdAt,
    );

  // Namespaces and workloads.
  const namespaces: string[] = [];
  if (gke.systemWorkloads) namespaces.push('default', 'kube-system');
  for (let n = 0; n < gke.namespaces; n++) namespaces.push(nth(NAMESPACES, n));
  for (const ns of namespaces) {
    addK8s(
      b,
      cluster,
      'k8s.io/Namespace',
      `k8s/namespaces/${ns}`,
      {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: { name: ns, uid: uuid(rng), labels: { 'kubernetes.io/metadata.name': ns } },
        spec: { finalizers: ['kubernetes'] },
        status: { phase: 'Active' },
      },
      createdAt,
    );
  }
  // Kubernetes service accounts: one per workload namespace, bound to a Google service account through
  // Workload Identity, and (with `all`) every namespace's `default` account, which starts hidden.
  const workloadNamespaces = new Set(Array.from({ length: gke.namespaces }, (_, n) => nth(NAMESPACES, n)));
  if (workloadAccount !== undefined) {
    for (const ns of namespaces) {
      const accounts = [
        ...(gke.serviceAccounts === 'all' ? ['default'] : []),
        ...(workloadNamespaces.has(ns) ? [`${ns}-workloads`] : []),
      ];
      for (const account of accounts) {
        const path = `k8s/namespaces/${ns}/serviceaccounts/${account}`;
        addK8s(
          b,
          cluster,
          'k8s.io/ServiceAccount',
          path,
          {
            apiVersion: 'v1',
            kind: 'ServiceAccount',
            metadata: {
              name: account,
              namespace: ns,
              uid: uuidFrom(b, `${full}/${path}`),
              ...(account === 'default'
                ? {}
                : { annotations: { 'iam.gke.io/gcp-service-account': workloadAccount.email } }),
            },
          },
          createdAt,
        );
      }
    }
  }
  if (gke.systemWorkloads) {
    addWorkload(b, cluster, 'kube-system', 'kube-dns', 2, `gke.gcr.io/k8s-dns-kube-dns:1.26.0-gke.4`, 53);
    if (gke.nodeVms) addLoggingDaemonSet(b, cluster);
  }
  const frontends: { ns: string; service: string }[] = [];
  for (let n = 0; n < gke.namespaces; n++) {
    const ns = nth(NAMESPACES, n);
    for (let d = 0; d < gke.deploymentsPerNamespace; d++) {
      const app = nth(MICROSERVICES, n * gke.deploymentsPerNamespace + d);
      addWorkload(
        b,
        cluster,
        ns,
        app,
        gke.replicas,
        `${region.name}-docker.pkg.dev/${project.id}/apps/${app}:1.${String(rng.int(0, 9))}.${String(rng.int(0, 20))}`,
        8080,
        workloadAccount === undefined ? app : `${ns}-workloads`,
      );
      if (d === 0) frontends.push({ ns, service: app });
    }
  }
  const front = frontends[0];
  if (front !== undefined)
    addIngress(ctx, cluster, host, subnet, front.ns, front.service, clusterHash, team, env, zones);
  if (k8sCases) {
    const kmsKeyVersion = ctx.keys.keyVersion(region.name, 'gke');
    if (front !== undefined && ctx.once('k8s-stateful')) {
      const image = `${region.name}-docker.pkg.dev/${project.id}/apps`;
      addStatefulChain(
        b,
        cluster,
        front.ns,
        image,
        bootDiskKey,
        kmsKeyVersion,
        workloadAccount === undefined ? undefined : `${front.ns}-workloads`,
      );
      addScheduledWork(b, cluster, front.ns, front.service, image);
    }
    // Cloud DNS for GKE with cluster scope (production clusters): a private zone for cluster.local.
    if (env === 'prod')
      addManagedZone(b, project, `gke-${clusterName}-${clusterHash}-dns`, 'cluster.local.', {
        description: `Private zone for GKE cluster "${clusterName}" with cluster suffix "cluster.local."`,
        visibility: 'private',
        privateVisibilityConfig: {
          kind: 'dns#managedZonePrivateVisibilityConfig',
          gkeClusters: [
            { kind: 'dns#managedZonePrivateVisibilityConfigGKECluster', gkeClusterName: clusterPath },
          ],
        },
      });
    if (env === 'prod') {
      const plan = `projects/${project.id}/locations/${region.name}/backupPlans/${clusterName}-daily`;
      addProjectAsset(b, project, {
        assetType: 'gkebackup.googleapis.com/BackupPlan',
        name: fullName('gkebackup.googleapis.com', plan),
        location: region.name,
        after: createdAt,
        data: {
          name: plan,
          uid: uuidFrom(b, plan),
          cluster: clusterPath,
          retentionPolicy: { backupRetainDays: 30, backupDeleteLockDays: 7 },
          backupSchedule: { cronSchedule: '0 3 * * *' },
          backupConfig: {
            allNamespaces: true,
            includeVolumeData: true,
            includeSecrets: true,
            ...(kmsKey === undefined ? {} : { encryptionKey: { gcpKmsEncryptionKey: kmsKey } }),
          },
          protectedPodCount: cluster.nodes.length * 3,
          state: 'READY',
          rpoRiskLevel: 1,
        },
      });
    }
  }
  if (attestor !== undefined) {
    addProjectAsset(b, project, {
      assetType: 'binaryauthorization.googleapis.com/Policy',
      name: fullName('binaryauthorization.googleapis.com', `projects/${project.number}/policy`),
      location: 'global',
      after: createdAt,
      data: {
        name: `projects/${project.number}/policy`,
        description: 'Only images built and attested by the delivery pipeline',
        globalPolicyEvaluationMode: 'ENABLE',
        admissionWhitelistPatterns: [{ namePattern: 'gke.gcr.io/*' }],
        defaultAdmissionRule: {
          evaluationMode: env === 'prod' ? 'REQUIRE_ATTESTATION' : 'ALWAYS_ALLOW',
          enforcementMode: 'ENFORCED_BLOCK_AND_AUDIT_LOG',
          ...(env === 'prod' ? { requireAttestationsBy: [attestor] } : {}),
        },
      },
    });
  }
  if (has(profile, 'data') && ctx.once(`filestore:${env}`)) addFilestore(ctx, project, region, host);
  ctx.inventory.clusters.push({ project, region, path: clusterPath, name: clusterName });
  return project;
}

/**
 * A StatefulSet with its pod, the claim, the volume the CSI driver provisioned (a CMEK storage class) and the
 * persistent disk behind it.
 */
function addStatefulChain(
  b: OrgBuilder,
  cluster: Cluster,
  ns: string,
  repository: string,
  kmsKey: string | undefined,
  kmsKeyVersion: string | undefined,
  serviceAccountName: string | undefined,
): void {
  const project = cluster.project;
  const node = cluster.nodes[0];
  if (node === undefined) return;
  const storageClass = kmsKey === undefined ? 'standard-rwo' : 'standard-rwo-cmek';
  const pv = `pvc-${uuidFrom(b, `${cluster.full}/postgres-data`)}`;
  const k8sUid = (path: string): string => uuidFrom(b, `${cluster.full}/${path}`);
  addK8s(
    b,
    cluster,
    'storage.k8s.io/StorageClass',
    `k8s/storage.k8s.io/storageclasses/${storageClass}`,
    {
      apiVersion: 'storage.k8s.io/v1',
      kind: 'StorageClass',
      metadata: { name: storageClass, uid: k8sUid(storageClass) },
      provisioner: 'pd.csi.storage.gke.io',
      parameters: {
        type: 'pd-balanced',
        ...(kmsKey === undefined ? {} : { 'disk-encryption-kms-key': kmsKey }),
      },
      reclaimPolicy: 'Delete',
      volumeBindingMode: 'WaitForFirstConsumer',
      allowVolumeExpansion: true,
    },
    cluster.createdAt,
  );
  const set = 'postgres';
  const setUid = k8sUid(`statefulsets/${set}`);
  const container: JsonObject = {
    name: set,
    image: `${repository}/postgres:16.4`,
    ports: [{ containerPort: 5432, protocol: 'TCP' }],
    volumeMounts: [{ name: 'data', mountPath: '/var/lib/postgresql/data' }],
  };
  const statefulSet = addK8s(
    b,
    cluster,
    'apps.k8s.io/StatefulSet',
    `k8s/namespaces/${ns}/apps/statefulsets/${set}`,
    {
      apiVersion: 'apps/v1',
      kind: 'StatefulSet',
      metadata: { name: set, namespace: ns, uid: setUid, generation: 2, labels: { app: set } },
      spec: {
        replicas: 1,
        serviceName: set,
        selector: { matchLabels: { app: set } },
        template: {
          metadata: { labels: { app: set } },
          spec: { serviceAccountName: serviceAccountName ?? set, containers: [container] },
        },
        volumeClaimTemplates: [
          {
            metadata: { name: 'data' },
            spec: {
              accessModes: ['ReadWriteOnce'],
              storageClassName: storageClass,
              resources: { requests: { storage: '50Gi' } },
            },
          },
        ],
      },
      status: { replicas: 1, readyReplicas: 1, currentReplicas: 1, currentRevision: `${set}-6b7c9d8f5` },
    },
    cluster.createdAt,
  );
  const claim = `data-${set}-0`;
  addK8s(
    b,
    cluster,
    'k8s.io/PersistentVolumeClaim',
    `k8s/namespaces/${ns}/persistentvolumeclaims/${claim}`,
    {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: claim, namespace: ns, uid: k8sUid(claim), labels: { app: set } },
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: { requests: { storage: '50Gi' } },
        storageClassName: storageClass,
        volumeName: pv,
        volumeMode: 'Filesystem',
      },
      status: { phase: 'Bound', capacity: { storage: '50Gi' }, accessModes: ['ReadWriteOnce'] },
    },
    statefulSet.createdAt,
  );
  const disk = addCompute(b, project, {
    kind: 'Disk',
    collection: 'disks',
    scope: { zone: node.zone },
    name: pv,
    after: statefulSet.createdAt,
    data: {
      description: `{"kubernetes.io/created-for/pv/name":"${pv}","kubernetes.io/created-for/pvc/name":"${claim}","kubernetes.io/created-for/pvc/namespace":"${ns}","storage.gke.io/created-by":"pd.csi.storage.gke.io"}`,
      sizeGb: '50',
      status: 'READY',
      type: `https://www.googleapis.com/compute/v1/projects/${project.id}/zones/${node.zone}/diskTypes/pd-balanced`,
      users: [
        `https://www.googleapis.com/compute/v1/projects/${project.id}/zones/${node.zone}/instances/${node.name}`,
      ],
      labels: { 'goog-gke-volume': '', 'goog-k8s-cluster-name': cluster.name },
      physicalBlockSizeBytes: '4096',
      ...(kmsKeyVersion === undefined ? {} : { diskEncryptionKey: { kmsKeyName: kmsKeyVersion } }),
    },
  });
  addK8s(
    b,
    cluster,
    'k8s.io/PersistentVolume',
    `k8s/persistentvolumes/${pv}`,
    {
      apiVersion: 'v1',
      kind: 'PersistentVolume',
      metadata: {
        name: pv,
        uid: k8sUid(pv),
        annotations: { 'pv.kubernetes.io/provisioned-by': 'pd.csi.storage.gke.io' },
      },
      spec: {
        capacity: { storage: '50Gi' },
        csi: {
          driver: 'pd.csi.storage.gke.io',
          volumeHandle: `projects/${project.id}/zones/${node.zone}/disks/${pv}`,
          fsType: 'ext4',
        },
        accessModes: ['ReadWriteOnce'],
        persistentVolumeReclaimPolicy: 'Delete',
        storageClassName: storageClass,
        claimRef: { kind: 'PersistentVolumeClaim', namespace: ns, name: claim },
        volumeMode: 'Filesystem',
      },
      status: { phase: 'Bound' },
    },
    disk.asset.createdAt,
  );
  const pod = `${set}-0`;
  addK8s(
    b,
    cluster,
    'k8s.io/Pod',
    `k8s/namespaces/${ns}/pods/${pod}`,
    {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: pod,
        namespace: ns,
        uid: k8sUid(pod),
        labels: { app: set, 'statefulset.kubernetes.io/pod-name': pod },
        ownerReferences: [ownerReference('StatefulSet', set, setUid)],
      },
      spec: {
        nodeName: node.name,
        serviceAccountName: serviceAccountName ?? set,
        containers: [container],
        volumes: [{ name: 'data', persistentVolumeClaim: { claimName: claim } }],
        restartPolicy: 'Always',
      },
      status: { phase: 'Running', podIP: node.pods.next(), hostIP: node.ip, qosClass: 'BestEffort' },
    },
    statefulSet.createdAt,
  );
}

/** A nightly CronJob with its last Job (hidden) and a HorizontalPodAutoscaler on a deployment. */
function addScheduledWork(
  b: OrgBuilder,
  cluster: Cluster,
  ns: string,
  deployment: string,
  repository: string,
): void {
  const cron = 'nightly-report';
  const cronUid = uuidFrom(b, `${cluster.full}/cronjobs/${cron}`);
  const jobSpec: JsonObject = {
    template: {
      spec: {
        containers: [{ name: cron, image: `${repository}/report-builder:3.1.0`, args: ['--yesterday'] }],
        restartPolicy: 'OnFailure',
      },
    },
    backoffLimit: 2,
  };
  const cronJob = addK8s(
    b,
    cluster,
    'batch.k8s.io/CronJob',
    `k8s/namespaces/${ns}/batch/cronjobs/${cron}`,
    {
      apiVersion: 'batch/v1',
      kind: 'CronJob',
      metadata: { name: cron, namespace: ns, uid: cronUid },
      spec: {
        schedule: '0 2 * * *',
        concurrencyPolicy: 'Forbid',
        successfulJobsHistoryLimit: 1,
        jobTemplate: { spec: jobSpec },
      },
      status: {
        lastScheduleTime: new Date(b.windowStart - 22 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      },
    },
    cluster.createdAt,
  );
  const job = `${cron}-${String(Math.floor((b.windowStart - 22 * 3_600_000) / 60_000))}`;
  addK8s(
    b,
    cluster,
    'batch.k8s.io/Job',
    `k8s/namespaces/${ns}/batch/jobs/${job}`,
    {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: job,
        namespace: ns,
        uid: uuidFrom(b, `${cluster.full}/jobs/${job}`),
        ownerReferences: [
          {
            apiVersion: 'batch/v1',
            kind: 'CronJob',
            name: cron,
            uid: cronUid,
            controller: true,
            blockOwnerDeletion: true,
          },
        ],
      },
      spec: jobSpec,
      status: {
        succeeded: 1,
        completionTime: new Date(b.windowStart - 21 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      },
    },
    cronJob.createdAt,
  );
  addK8s(
    b,
    cluster,
    'autoscaling.k8s.io/HorizontalPodAutoscaler',
    `k8s/namespaces/${ns}/autoscaling/horizontalpodautoscalers/${deployment}`,
    {
      apiVersion: 'autoscaling/v2',
      kind: 'HorizontalPodAutoscaler',
      metadata: { name: deployment, namespace: ns, uid: uuidFrom(b, `${cluster.full}/hpa/${deployment}`) },
      spec: {
        scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: deployment },
        minReplicas: 2,
        maxReplicas: 10,
        metrics: [
          {
            type: 'Resource',
            resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } },
          },
        ],
      },
      status: { currentReplicas: 2, desiredReplicas: 2 },
    },
    cluster.createdAt,
  );
}

function addK8s(
  b: OrgBuilder,
  cluster: Cluster,
  assetType: string,
  path: string,
  data: JsonObject,
  after: number,
  traits?: { readonly pinned?: boolean; readonly predecessor?: (createdAt: number, rng: Rng) => GenAsset },
): GenAsset {
  return b.add(k8sInput(cluster, assetType, path, data, after, traits));
}

function k8sInput(
  cluster: Cluster,
  assetType: string,
  path: string,
  data: JsonObject,
  after: number,
  traits?: { readonly pinned?: boolean; readonly predecessor?: (createdAt: number, rng: Rng) => GenAsset },
): AddInput {
  return {
    assetType,
    name: `${cluster.full}/${path}`,
    parent: cluster.full,
    ancestors: cluster.project.ancestors,
    location: cluster.region.name,
    data,
    after,
    ...(traits === undefined ? {} : { traits }),
  };
}

function ownerReference(kind: string, name: string, uid: string): JsonObject {
  return { apiVersion: 'apps/v1', kind, name, uid, controller: true, blockOwnerDeletion: true };
}

/** A Deployment with its current ReplicaSet, its pods and a ClusterIP Service. */
function addWorkload(
  b: OrgBuilder,
  cluster: Cluster,
  ns: string,
  app: string,
  replicas: number,
  image: string,
  port: number,
  serviceAccountName: string = app,
): void {
  const rng = cluster.rng;
  const deploymentUid = uuid(rng);
  const revision = String(rng.int(2, 30));
  const hash = templateHash(rng);
  const replicaSet = `${app}-${hash}`;
  const replicaSetUid = uuid(rng);
  const container: JsonObject = {
    name: app,
    image,
    ports: [{ containerPort: port, protocol: 'TCP' }],
    resources: { requests: { cpu: '250m', memory: '256Mi' }, limits: { memory: '512Mi' } },
  };
  const deployment = addK8s(
    b,
    cluster,
    'apps.k8s.io/Deployment',
    `k8s/namespaces/${ns}/apps/deployments/${app}`,
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: app,
        namespace: ns,
        uid: deploymentUid,
        generation: Number(revision),
        labels: { app },
        annotations: { 'deployment.kubernetes.io/revision': revision },
      },
      spec: {
        replicas,
        selector: { matchLabels: { app } },
        template: {
          metadata: { labels: { app } },
          spec: { serviceAccountName, containers: [container] },
        },
        strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' } },
        revisionHistoryLimit: 10,
      },
      status: {
        observedGeneration: Number(revision),
        replicas,
        updatedReplicas: replicas,
        readyReplicas: replicas,
        availableReplicas: replicas,
      },
    },
    cluster.createdAt,
  );
  const rs = addK8s(
    b,
    cluster,
    'apps.k8s.io/ReplicaSet',
    `k8s/namespaces/${ns}/apps/replicasets/${replicaSet}`,
    {
      apiVersion: 'apps/v1',
      kind: 'ReplicaSet',
      metadata: {
        name: replicaSet,
        namespace: ns,
        uid: replicaSetUid,
        labels: { app, 'pod-template-hash': hash },
        annotations: {
          'deployment.kubernetes.io/revision': revision,
          'deployment.kubernetes.io/desired-replicas': String(replicas),
          'deployment.kubernetes.io/max-replicas': String(replicas + 1),
        },
        ownerReferences: [ownerReference('Deployment', app, deploymentUid)],
      },
      spec: { replicas, selector: { matchLabels: { app, 'pod-template-hash': hash } } },
      status: {
        replicas,
        fullyLabeledReplicas: replicas,
        readyReplicas: replicas,
        availableReplicas: replicas,
      },
    },
    deployment.createdAt,
  );
  for (let r = 0; r < replicas; r++) {
    addPod(
      b,
      cluster,
      ns,
      app,
      replicaSet,
      replicaSetUid,
      hash,
      container,
      rs.createdAt,
      true,
      'ReplicaSet',
      serviceAccountName,
    );
  }
  addK8s(
    b,
    cluster,
    'k8s.io/Service',
    `k8s/namespaces/${ns}/services/${app}`,
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: app,
        namespace: ns,
        uid: uuid(rng),
        labels: { app },
        annotations: { 'cloud.google.com/neg': '{"ingress":true}' },
      },
      spec: {
        type: 'ClusterIP',
        clusterIP: cluster.serviceHosts.next(),
        ports: [{ name: 'http', port: 80, targetPort: port, protocol: 'TCP' }],
        selector: { app },
        sessionAffinity: 'None',
        ipFamilies: ['IPv4'],
        ipFamilyPolicy: 'SingleStack',
      },
      status: { loadBalancer: {} },
    },
    deployment.createdAt,
  );
}

function podInput(
  cluster: Cluster,
  ns: string,
  app: string,
  replicaSet: string,
  replicaSetUid: string,
  hash: string,
  container: JsonObject,
  after: number,
  rng: Rng,
  ownerKind = 'ReplicaSet',
  serviceAccountName = app,
): AddInput {
  const name = `${replicaSet}-${podSuffix(rng)}`;
  const node = at(cluster.nodes, rng.int(0, cluster.nodes.length - 1));
  return k8sInput(
    cluster,
    'k8s.io/Pod',
    `k8s/namespaces/${ns}/pods/${name}`,
    {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name,
        namespace: ns,
        uid: uuid(rng),
        labels: {
          app,
          ...(ownerKind === 'ReplicaSet'
            ? { 'pod-template-hash': hash }
            : { 'controller-revision-hash': hash }),
        },
        ownerReferences: [ownerReference(ownerKind, replicaSet, replicaSetUid)],
      },
      spec: {
        nodeName: node.name,
        serviceAccountName,
        containers: [container],
        restartPolicy: 'Always',
      },
      status: {
        phase: 'Running',
        podIP: node.pods.next(),
        hostIP: node.ip,
        qosClass: 'Burstable',
        conditions: [{ type: 'Ready', status: 'True' }],
      },
    },
    after,
  );
}

function addPod(
  b: OrgBuilder,
  cluster: Cluster,
  ns: string,
  app: string,
  replicaSet: string,
  replicaSetUid: string,
  hash: string,
  container: JsonObject,
  after: number,
  restartable: boolean,
  ownerKind = 'ReplicaSet',
  serviceAccountName = app,
): void {
  const input = podInput(
    cluster,
    ns,
    app,
    replicaSet,
    replicaSetUid,
    hash,
    container,
    after,
    cluster.rng,
    ownerKind,
    serviceAccountName,
  );
  b.add({
    ...input,
    ...(restartable
      ? {
          traits: {
            predecessor: (createdAt: number, rng: Rng) =>
              b.make(
                podInput(
                  cluster,
                  ns,
                  app,
                  replicaSet,
                  replicaSetUid,
                  hash,
                  container,
                  after,
                  rng,
                  ownerKind,
                  serviceAccountName,
                ),
                createdAt,
              ),
          },
        }
      : {}),
  });
}

function addLoggingDaemonSet(b: OrgBuilder, cluster: Cluster): void {
  const rng = cluster.rng;
  const name = 'fluentbit-gke';
  const uid = uuid(rng);
  const hash = rng.chars('bcdfghjklmnpqrstvwxz2456789', 10);
  const count = cluster.nodes.length;
  addK8s(
    b,
    cluster,
    'apps.k8s.io/DaemonSet',
    `k8s/namespaces/kube-system/apps/daemonsets/${name}`,
    {
      apiVersion: 'apps/v1',
      kind: 'DaemonSet',
      metadata: {
        name,
        namespace: 'kube-system',
        uid,
        labels: { 'k8s-app': name, 'addonmanager.kubernetes.io/mode': 'Reconcile' },
      },
      spec: { selector: { matchLabels: { 'k8s-app': name } } },
      status: {
        desiredNumberScheduled: count,
        currentNumberScheduled: count,
        numberReady: count,
        numberAvailable: count,
      },
    },
    cluster.createdAt,
  );
  const container: JsonObject = { name: 'fluentbit', image: 'gke.gcr.io/fluent-bit:v1.8.12-gke.40' };
  for (const node of cluster.nodes) {
    const podName = `${name}-${podSuffix(rng)}`;
    b.add(
      k8sInput(
        cluster,
        'k8s.io/Pod',
        `k8s/namespaces/kube-system/pods/${podName}`,
        {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: {
            name: podName,
            namespace: 'kube-system',
            uid: uuid(rng),
            labels: { 'k8s-app': name, 'controller-revision-hash': hash },
            ownerReferences: [ownerReference('DaemonSet', name, uid)],
          },
          spec: { nodeName: node.name, containers: [container], restartPolicy: 'Always', hostNetwork: true },
          status: { phase: 'Running', podIP: node.ip, hostIP: node.ip, qosClass: 'Burstable' },
        },
        cluster.createdAt,
      ),
    );
  }
}

function addClusterFirewallRules(
  b: OrgBuilder,
  host: HostNetwork,
  cluster: string,
  hash: string,
  nodeTag: string,
  podRange: string,
  masterRange: string,
  subnet: SubnetRef,
  after: number,
): void {
  const rules: readonly [string, JsonObject][] = [
    [
      'all',
      {
        sourceRanges: [podRange],
        allowed: [
          { IPProtocol: 'tcp' },
          { IPProtocol: 'udp' },
          { IPProtocol: 'icmp' },
          { IPProtocol: 'esp' },
          { IPProtocol: 'ah' },
          { IPProtocol: 'sctp' },
        ],
      },
    ],
    ['master', { sourceRanges: [masterRange], allowed: [{ IPProtocol: 'tcp', ports: ['10250', '443'] }] }],
    [
      'vms',
      {
        sourceRanges: [subnet.cidr],
        allowed: [
          { IPProtocol: 'tcp', ports: ['1-65535'] },
          { IPProtocol: 'udp', ports: ['1-65535'] },
          { IPProtocol: 'icmp' },
        ],
      },
    ],
  ];
  for (const [suffix, data] of rules) {
    addCompute(b, host.project, {
      kind: 'Firewall',
      collection: 'firewalls',
      scope: 'global',
      name: `gke-${cluster}-${hash}-${suffix}`,
      after,
      data: {
        network: host.selfLink,
        priority: 1000,
        direction: 'INGRESS',
        disabled: false,
        targetTags: [nodeTag],
        logConfig: { enable: false },
        ...data,
      },
    });
  }
}

/** The ingress object and, when the profile asks for it, the load balancer the ingress controller builds. */
function addIngress(
  ctx: OrgContext,
  cluster: Cluster,
  host: HostNetwork,
  subnet: SubnetRef,
  ns: string,
  service: string,
  clusterHash: string,
  team: string,
  env: Env,
  zones: readonly string[],
): void {
  const { b } = ctx;
  const rng = cluster.rng;
  const project = cluster.project;
  const ingress = 'storefront';
  const domain = `shop.${webDomain(team, env)}`;
  const uid = rng.hex(8);
  const annotations: Record<string, string> = {
    'kubernetes.io/ingress.class': 'gce',
    'networking.gke.io/managed-certificates': `${ingress}-cert`,
  };
  let ip: string | undefined;
  if (ctx.profile.gke.ingressLb) {
    ip = b.addresses.external.next();
    const neg = `k8s1-${clusterHash}-${ns}-${service}-80-${uid}`;
    const negLinks: string[] = [];
    for (const zone of zones) {
      negLinks.push(
        addCompute(b, project, {
          kind: 'NetworkEndpointGroup',
          collection: 'networkEndpointGroups',
          scope: { zone },
          name: neg,
          after: cluster.createdAt,
          data: {
            description: `{"cluster-uid":"${clusterHash}","namespace":"${ns}","service-name":"${service}","port":"80"}`,
            networkEndpointType: 'GCE_VM_IP_PORT',
            network: host.selfLink,
            subnetwork: subnet.selfLink,
            defaultPort: 8080,
            size: Math.max(1, Math.round(ctx.profile.gke.replicas / zones.length)),
          },
        }).selfLink,
      );
    }
    const healthCheck = addCompute(b, project, {
      kind: 'HealthCheck',
      collection: 'healthChecks',
      scope: 'global',
      name: neg,
      after: cluster.createdAt,
      data: {
        checkIntervalSec: 15,
        timeoutSec: 15,
        unhealthyThreshold: 2,
        healthyThreshold: 1,
        type: 'HTTP',
        httpHealthCheck: { port: 8080, requestPath: '/healthz', proxyHeader: 'NONE' },
      },
    });
    const backend = addCompute(b, project, {
      kind: 'BackendService',
      collection: 'backendServices',
      scope: 'global',
      name: neg,
      after: healthCheck.asset.createdAt,
      data: {
        backends: negLinks.map((group) => ({
          group,
          balancingMode: 'RATE',
          maxRatePerEndpoint: 100,
          capacityScaler: 1,
        })),
        healthChecks: [healthCheck.selfLink],
        protocol: 'HTTP',
        port: 80,
        portName: 'port80',
        loadBalancingScheme: 'EXTERNAL',
        timeoutSec: 30,
        sessionAffinity: 'NONE',
        connectionDraining: { drainingTimeoutSec: 0 },
      },
    });
    const urlMap = addCompute(b, project, {
      kind: 'UrlMap',
      collection: 'urlMaps',
      scope: 'global',
      name: `k8s2-um-${clusterHash}-${ns}-${ingress}-${uid}`,
      after: backend.asset.createdAt,
      data: {
        defaultService: backend.selfLink,
        hostRules: [{ hosts: [domain], pathMatcher: 'host1' }],
        pathMatchers: [{ name: 'host1', defaultService: backend.selfLink }],
      },
    });
    const certificate = addCompute(b, project, {
      kind: 'SslCertificate',
      collection: 'sslCertificates',
      scope: 'global',
      name: `mcrt-${uuid(rng)}`,
      after: cluster.createdAt,
      data: {
        type: 'MANAGED',
        managed: { domains: [domain], status: 'ACTIVE', domainStatus: { [domain]: 'ACTIVE' } },
        subjectAlternativeNames: [domain],
        expireTime: '2026-12-21T04:00:00.000-08:00',
      },
    });
    const proxy = addCompute(b, project, {
      kind: 'TargetHttpsProxy',
      collection: 'targetHttpsProxies',
      scope: 'global',
      name: `k8s2-ts-${clusterHash}-${ns}-${ingress}-${uid}`,
      after: urlMap.asset.createdAt,
      data: { urlMap: urlMap.selfLink, sslCertificates: [certificate.selfLink], quicOverride: 'NONE' },
    });
    const rule = `k8s2-fs-${clusterHash}-${ns}-${ingress}-${uid}`;
    addCompute(b, project, {
      kind: 'GlobalForwardingRule',
      collection: 'forwardingRules',
      scope: 'global',
      name: rule,
      after: proxy.asset.createdAt,
      data: {
        IPAddress: ip,
        IPProtocol: 'TCP',
        portRange: '443-443',
        target: proxy.selfLink,
        loadBalancingScheme: 'EXTERNAL',
        networkTier: 'PREMIUM',
      },
    });
    annotations['ingress.kubernetes.io/https-forwarding-rule'] = rule;
    annotations['ingress.kubernetes.io/https-target-proxy'] = proxy.name;
    annotations['ingress.kubernetes.io/url-map'] = urlMap.name;
    annotations['ingress.kubernetes.io/ssl-cert'] = certificate.name;
    annotations['ingress.kubernetes.io/backends'] = JSON.stringify({ [neg]: 'HEALTHY' });
    ctx.publicRecords.push({ name: `${domain}.`, type: 'A', rrdatas: [ip] });
  }
  addK8s(
    b,
    cluster,
    'networking.k8s.io/Ingress',
    `k8s/namespaces/${ns}/networking.k8s.io/ingresses/${ingress}`,
    {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: { name: ingress, namespace: ns, uid: uuid(rng), annotations },
      spec: {
        rules: [
          {
            host: domain,
            http: {
              paths: [
                {
                  path: '/',
                  pathType: 'Prefix',
                  backend: { service: { name: service, port: { number: 80 } } },
                },
              ],
            },
          },
        ],
      },
      status: { loadBalancer: ip === undefined ? {} : { ingress: [{ ip }] } },
    },
    cluster.createdAt,
  );
}

function newNode(cluster: Cluster, name: string, zone: string, ip: string): Node {
  const podCidr = cluster.podBlocks.allocate(24);
  return { name, zone, ip, podCidr, pods: new HostPool(podCidr, 2) };
}
