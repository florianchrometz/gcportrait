// SPDX-License-Identifier: Apache-2.0
/**
 * Compute Engine building blocks shared by several templates: a VM with its boot disk, an instance template,
 * and a zonal managed instance group (manager + group + instances carrying the `created-by` metadata item).
 */
import type { OrgBuilder } from '../builder/builder.js';
import type { GenAsset, Traits } from '../builder/types.js';
import type { JsonObject } from '../core/json.js';
import type { Rng } from '../core/rng.js';
import { MINUTE_MS } from '../core/time.js';
import {
  addCompute,
  computeSelfLink,
  makeCompute,
  type ComputeRef,
  type ComputeSpec,
  type ProjectCtx,
} from './kit.js';
import { DEBIAN_FAMILY, DEBIAN_IMAGE, DEBIAN_LICENSE } from './vocabulary.js';

const MIG_SUFFIX = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Where a NIC attaches: a (possibly Shared VPC host) network and subnet, and the address it gets. */
export interface NicSpec {
  readonly network: string;
  readonly subnetwork: string;
  readonly ip: string;
  readonly natIp?: string;
}

export interface InstanceSpec {
  readonly zone: string;
  readonly name: string;
  readonly machineType: string;
  readonly nic: NicSpec;
  readonly serviceAccount?: string;
  readonly tags?: readonly string[];
  readonly labels?: JsonObject;
  /** Metadata items besides the ones a managed instance group writes. */
  readonly metadata?: readonly JsonObject[];
  readonly image?: string;
  readonly imageLicense?: string;
  readonly diskSizeGb?: number;
  /** `projects/…/cryptoKeys/…/cryptoKeyVersions/N`: the boot disk is CMEK-encrypted. */
  readonly kmsKeyVersion?: string;
  /** The managing instance group manager, as Compute writes it: `projects/<number>/zones/<z>/…`. */
  readonly createdBy?: string;
  readonly instanceTemplate?: string;
  readonly status?: 'RUNNING' | 'TERMINATED';
  /** A network appliance that routes traffic for others. */
  readonly canIpForward?: boolean;
  /** Snapshot schedules (`ResourcePolicy` self-links) attached to the boot disk. */
  readonly resourcePolicies?: readonly string[];
  readonly hostname?: string;
  readonly after?: number;
  readonly traits?: Traits;
}

export interface InstanceRefs {
  readonly instance: ComputeRef;
  readonly disk: ComputeRef;
  /** The NIC's internal address. */
  readonly ip: string;
}

function instanceSpecs(
  project: ProjectCtx,
  spec: InstanceSpec,
): { disk: ComputeSpec; instance: ComputeSpec } {
  const zone = { zone: spec.zone };
  const diskSelfLink = computeSelfLink(project.id, `zones/${spec.zone}/disks/${spec.name}`);
  const instanceSelfLink = computeSelfLink(project.id, `zones/${spec.zone}/instances/${spec.name}`);
  const sizeGb = String(spec.diskSizeGb ?? 20);
  const labels = spec.labels ?? {};
  const metadata: JsonObject[] = [
    ...(spec.instanceTemplate === undefined
      ? []
      : [{ key: 'instance-template', value: spec.instanceTemplate }]),
    ...(spec.createdBy === undefined ? [] : [{ key: 'created-by', value: spec.createdBy }]),
    ...(spec.metadata ?? []),
  ];
  const disk = {
    kind: 'Disk',
    collection: 'disks',
    scope: zone,
    name: spec.name,
    ...(spec.after === undefined ? {} : { after: spec.after }),
    ...(spec.traits?.pinned === true ? { traits: { pinned: true } } : {}),
    data: {
      sizeGb,
      status: 'READY',
      sourceImage: spec.image ?? DEBIAN_IMAGE,
      type: computeSelfLink(project.id, `zones/${spec.zone}/diskTypes/pd-balanced`),
      licenses: [spec.imageLicense ?? DEBIAN_LICENSE],
      users: [instanceSelfLink],
      labels,
      physicalBlockSizeBytes: '4096',
      architecture: 'X86_64',
      ...(spec.resourcePolicies === undefined ? {} : { resourcePolicies: [...spec.resourcePolicies] }),
      ...(spec.kmsKeyVersion === undefined ? {} : { diskEncryptionKey: { kmsKeyName: spec.kmsKeyVersion } }),
    },
  };
  const accessConfigs: JsonObject[] =
    spec.nic.natIp === undefined
      ? []
      : [
          {
            kind: 'compute#accessConfig',
            type: 'ONE_TO_ONE_NAT',
            name: 'External NAT',
            natIP: spec.nic.natIp,
            networkTier: 'PREMIUM',
          },
        ];
  const instance = {
    kind: 'Instance',
    collection: 'instances',
    scope: zone,
    name: spec.name,
    ...(spec.after === undefined ? {} : { after: spec.after }),
    ...(spec.traits === undefined ? {} : { traits: spec.traits }),
    data: {
      machineType: computeSelfLink(project.id, `zones/${spec.zone}/machineTypes/${spec.machineType}`),
      status: spec.status ?? 'RUNNING',
      canIpForward: spec.canIpForward ?? false,
      ...(spec.hostname === undefined ? {} : { hostname: spec.hostname }),
      tags: { items: [...(spec.tags ?? [])] },
      networkInterfaces: [
        {
          kind: 'compute#networkInterface',
          name: 'nic0',
          network: spec.nic.network,
          subnetwork: spec.nic.subnetwork,
          networkIP: spec.nic.ip,
          stackType: 'IPV4_ONLY',
          accessConfigs,
        },
      ],
      disks: [
        {
          kind: 'compute#attachedDisk',
          type: 'PERSISTENT',
          mode: 'READ_WRITE',
          source: diskSelfLink,
          deviceName: 'persistent-disk-0',
          index: 0,
          boot: true,
          autoDelete: true,
          interface: 'SCSI',
          diskSizeGb: sizeGb,
          ...(spec.kmsKeyVersion === undefined
            ? {}
            : { diskEncryptionKey: { kmsKeyName: spec.kmsKeyVersion } }),
        },
      ],
      metadata: { kind: 'compute#metadata', items: metadata },
      serviceAccounts:
        spec.serviceAccount === undefined
          ? []
          : [{ email: spec.serviceAccount, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }],
      scheduling: {
        onHostMaintenance: 'MIGRATE',
        automaticRestart: true,
        preemptible: false,
        provisioningModel: 'STANDARD',
      },
      shieldedInstanceConfig: { enableSecureBoot: true, enableVtpm: true, enableIntegrityMonitoring: true },
      cpuPlatform: 'Intel Broadwell',
      labels,
      deletionProtection: false,
      startRestricted: false,
    },
  };
  return { disk, instance };
}

export function addInstance(b: OrgBuilder, project: ProjectCtx, spec: InstanceSpec): InstanceRefs {
  const specs = instanceSpecs(project, spec);
  const instance = addCompute(b, project, specs.instance);
  const disk = addCompute(b, project, { ...specs.disk, createdAt: instance.asset.createdAt - MINUTE_MS });
  return { instance, disk, ip: spec.nic.ip };
}

/** The VM and its disk created at `at`, not added to the organisation. */
export function makeInstance(b: OrgBuilder, project: ProjectCtx, spec: InstanceSpec, at: number): GenAsset[] {
  const specs = instanceSpecs(project, spec);
  return [makeCompute(b, project, specs.instance, at).asset, makeCompute(b, project, specs.disk, at).asset];
}

export interface TemplateSpec {
  readonly name: string;
  readonly machineType: string;
  readonly network: string;
  readonly subnetwork: string;
  readonly serviceAccount: string;
  readonly tags: readonly string[];
  readonly labels: JsonObject;
  readonly image?: string;
  readonly diskSizeGb?: number;
  readonly kmsKey?: string;
  readonly startupScript?: string;
  readonly after?: number;
}

export interface TemplateRef extends ComputeRef {
  /** As written into instance metadata: `projects/<number>/global/instanceTemplates/<name>`. */
  readonly byNumber: string;
}

export function addInstanceTemplate(b: OrgBuilder, project: ProjectCtx, spec: TemplateSpec): TemplateRef {
  const ref = addCompute(b, project, {
    kind: 'InstanceTemplate',
    collection: 'instanceTemplates',
    scope: 'global',
    name: spec.name,
    ...(spec.after === undefined ? {} : { after: spec.after }),
    data: {
      description: '',
      properties: {
        machineType: spec.machineType,
        canIpForward: false,
        tags: { items: [...spec.tags] },
        networkInterfaces: [
          {
            kind: 'compute#networkInterface',
            name: 'nic0',
            network: spec.network,
            subnetwork: spec.subnetwork,
            stackType: 'IPV4_ONLY',
          },
        ],
        disks: [
          {
            kind: 'compute#attachedDisk',
            type: 'PERSISTENT',
            mode: 'READ_WRITE',
            deviceName: 'persistent-disk-0',
            boot: true,
            autoDelete: true,
            initializeParams: {
              sourceImage: spec.image ?? DEBIAN_FAMILY,
              diskSizeGb: String(spec.diskSizeGb ?? 20),
              diskType: 'pd-balanced',
            },
            ...(spec.kmsKey === undefined ? {} : { diskEncryptionKey: { kmsKeyName: spec.kmsKey } }),
          },
        ],
        metadata: {
          kind: 'compute#metadata',
          items:
            spec.startupScript === undefined ? [] : [{ key: 'startup-script', value: spec.startupScript }],
        },
        serviceAccounts: [
          { email: spec.serviceAccount, scopes: ['https://www.googleapis.com/auth/cloud-platform'] },
        ],
        scheduling: { onHostMaintenance: 'MIGRATE', automaticRestart: true, preemptible: false },
        shieldedInstanceConfig: { enableSecureBoot: true, enableVtpm: true, enableIntegrityMonitoring: true },
        labels: spec.labels,
      },
    },
  });
  return { ...ref, byNumber: `projects/${project.number}/global/instanceTemplates/${spec.name}` };
}

export interface MigSpec {
  readonly name: string;
  readonly zone: string;
  readonly baseInstanceName: string;
  readonly template: TemplateRef;
  readonly size: number;
  readonly machineType: string;
  readonly nic: Omit<NicSpec, 'ip'>;
  /** Hands out the instances' internal addresses. */
  readonly nextIp: () => string;
  readonly serviceAccount: string;
  readonly tags: readonly string[];
  readonly labels: JsonObject;
  readonly namedPorts: readonly JsonObject[];
  readonly healthCheck?: string;
  readonly kmsKeyVersion?: string;
  readonly image?: string;
  readonly imageLicense?: string;
  readonly diskSizeGb?: number;
  readonly autoscaler?: { readonly min: number; readonly max: number };
  /** A second version that runs a share of the group (a canary rollout). */
  readonly canary?: { readonly template: TemplateRef; readonly percent: number };
  readonly rng: Rng;
  /** The group's manager, group and autoscaler belong to a special event. */
  readonly pinned?: boolean;
}

export interface MigRefs {
  readonly manager: ComputeRef;
  readonly group: ComputeRef;
  readonly autoscaler: ComputeRef | undefined;
  readonly instances: readonly InstanceRefs[];
  /** `count` more instances (with disks) created at `at`, as a scale-out would. Not added. */
  readonly makeInstances: (count: number, at: number) => GenAsset[];
}

export function addManagedInstanceGroup(b: OrgBuilder, project: ProjectCtx, spec: MigSpec): MigRefs {
  const managerPath = `zones/${spec.zone}/instanceGroupManagers/${spec.name}`;
  const createdBy = `projects/${project.number}/${managerPath}`;
  const instanceSpec = (name: string, after?: number): InstanceSpec => ({
    zone: spec.zone,
    name,
    machineType: spec.machineType,
    nic: { ...spec.nic, ip: spec.nextIp() },
    serviceAccount: spec.serviceAccount,
    tags: spec.tags,
    labels: spec.labels,
    createdBy,
    instanceTemplate: spec.template.byNumber,
    ...(spec.kmsKeyVersion === undefined ? {} : { kmsKeyVersion: spec.kmsKeyVersion }),
    ...(spec.image === undefined ? {} : { image: spec.image }),
    ...(spec.imageLicense === undefined ? {} : { imageLicense: spec.imageLicense }),
    ...(spec.diskSizeGb === undefined ? {} : { diskSizeGb: spec.diskSizeGb }),
    ...(after === undefined ? {} : { after }),
  });
  const instanceName = (): string => `${spec.baseInstanceName}-${spec.rng.chars(MIG_SUFFIX, 4)}`;
  const traits: Traits | undefined = spec.pinned === true ? { pinned: true } : undefined;

  const group = addCompute(b, project, {
    kind: 'InstanceGroup',
    collection: 'instanceGroups',
    scope: { zone: spec.zone },
    name: spec.name,
    after: spec.template.asset.createdAt,
    ...(traits === undefined ? {} : { traits }),
    data: {
      description: `This instance group is controlled by Instance Group Manager '${spec.name}'. To modify instances in this group, use the Instance Group Manager API: https://cloud.google.com/compute/docs/reference/latest/instanceGroupManagers`,
      namedPorts: [...spec.namedPorts],
      network: spec.nic.network,
      subnetwork: spec.nic.subnetwork,
      size: spec.size,
      fingerprint: '42WmSpB8rSM=',
    },
  });
  const managerSelfLink = computeSelfLink(project.id, managerPath);
  const autoscalerName = `${spec.name}-autoscaler`;
  const manager = addCompute(b, project, {
    kind: 'InstanceGroupManager',
    collection: 'instanceGroupManagers',
    scope: { zone: spec.zone },
    name: spec.name,
    createdAt: group.asset.createdAt,
    ...(traits === undefined ? {} : { traits }),
    data: {
      baseInstanceName: spec.baseInstanceName,
      instanceTemplate: spec.template.selfLink,
      versions:
        spec.canary === undefined
          ? [{ instanceTemplate: spec.template.selfLink, targetSize: { calculated: spec.size } }]
          : [
              { name: 'stable', instanceTemplate: spec.template.selfLink },
              {
                name: 'canary',
                instanceTemplate: spec.canary.template.selfLink,
                targetSize: {
                  percent: spec.canary.percent,
                  calculated: Math.ceil((spec.size * spec.canary.percent) / 100),
                },
              },
            ],
      instanceGroup: group.selfLink,
      targetSize: spec.size,
      namedPorts: [...spec.namedPorts],
      currentActions: {
        none: spec.size,
        creating: 0,
        recreating: 0,
        deleting: 0,
        abandoning: 0,
        restarting: 0,
        refreshing: 0,
        verifying: 0,
      },
      status: {
        isStable: true,
        versionTarget: { isReached: true },
        ...(spec.autoscaler === undefined
          ? {}
          : { autoscaler: computeSelfLink(project.id, `zones/${spec.zone}/autoscalers/${autoscalerName}`) }),
      },
      autoHealingPolicies:
        spec.healthCheck === undefined ? [] : [{ healthCheck: spec.healthCheck, initialDelaySec: 300 }],
      updatePolicy: {
        type: 'PROACTIVE',
        minimalAction: 'REPLACE',
        maxSurge: { fixed: 3, calculated: 3 },
        maxUnavailable: { fixed: 0, calculated: 0 },
        replacementMethod: 'SUBSTITUTE',
      },
      listManagedInstancesResults: 'PAGELESS',
      fingerprint: 'SmPq2WWfXcI=',
    },
  });
  const autoscaler =
    spec.autoscaler === undefined
      ? undefined
      : addCompute(b, project, {
          kind: 'Autoscaler',
          collection: 'autoscalers',
          scope: { zone: spec.zone },
          name: autoscalerName,
          after: manager.asset.createdAt,
          ...(traits === undefined ? {} : { traits }),
          data: {
            target: managerSelfLink,
            autoscalingPolicy: {
              minNumReplicas: spec.autoscaler.min,
              maxNumReplicas: spec.autoscaler.max,
              coolDownPeriodSec: 60,
              cpuUtilization: { utilizationTarget: 0.6, predictiveMethod: 'NONE' },
              mode: 'ON',
            },
            status: 'ACTIVE',
            recommendedSize: spec.size,
          },
        });
  const instances: InstanceRefs[] = [];
  for (let i = 0; i < spec.size; i++) {
    instances.push(addInstance(b, project, instanceSpec(instanceName(), manager.asset.createdAt)));
  }
  return {
    manager,
    group,
    autoscaler,
    instances,
    makeInstances: (count, at) => {
      const out: GenAsset[] = [];
      for (let i = 0; i < count; i++) out.push(...makeInstance(b, project, instanceSpec(instanceName()), at));
      return out;
    },
  };
}
