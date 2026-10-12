// SPDX-License-Identifier: MIT
/**
 * The four demo sizes as data. Every size contains every topology feature at least once; the numbers below
 * only scale how many business units, environments, workload projects and resources per project there are.
 * The real asset counts are pinned in `fixtures/stats.json` and listed in the README.
 */
import type { DemoSize } from '@gcportrait/model';
import type { DataProfile } from './data.js';
import type { Feature } from './features.js';
import type { GkeProfile } from './gke.js';
import type { OperationsOptions } from './operations.js';
import type { PartnerOptions } from './partner.js';
import type { KeyPurpose } from './security.js';
import type { ServerlessProfile } from './serverless.js';
import type { Env } from './vocabulary.js';
import type { VmProfile } from './vm.js';
import type { WebProfile } from './web.js';

/** The kinds of workload project a business unit runs per environment. */
export type Archetype = 'web' | 'gke' | 'serverless' | 'data' | 'vm' | 'ml';

export interface NetworkProfile {
  /** SSH from the corporate network and a disabled egress lock-down rule. */
  readonly firewallExtras: boolean;
  readonly natInEveryRegion: boolean;
  /** Record sets in the private zones. */
  readonly dnsRecords: boolean;
  readonly forwardingZone: boolean;
  /** The public `example.org.` zone with a record per load balancer. */
  readonly publicZone: boolean;
  /** HA VPN and Interconnect on their own Cloud Router instead of the NAT router. */
  readonly separateHybridRouter: boolean;
}

export interface SecurityProfile {
  readonly regions: number;
  readonly purposes: readonly (KeyPurpose | 'shared')[];
  readonly versionsPerKey: number;
  readonly accessLevel: boolean;
}

/** Events per day of the 35-day history (fractions are spread over the days). */
export interface HistoryProfile {
  readonly changesPerDay: number;
  readonly restartsPerDay: number;
  readonly transientsPerDay: number;
  readonly growthPerDay: number;
  readonly retirementsPerDay: number;
}

export interface SizeProfile {
  readonly size: DemoSize;
  /** How many regions the business units spread over (round robin). */
  readonly regions: number;
  readonly businessUnits: number;
  /** One Shared VPC host per environment; each business unit has a folder per environment. */
  readonly environments: readonly Env[];
  readonly workloads: Readonly<Partial<Record<Env, readonly Archetype[]>>>;
  /** Workload projects that only the first business unit runs, after its `workloads` of that environment. */
  readonly leadWorkloads: Readonly<Partial<Record<Env, readonly Archetype[]>>>;
  /** The optional generator cases this size turns on (`features.ts`). */
  readonly features: readonly Feature[];
  /** Networking, Security and Operations folders under Platform. */
  readonly platformSubfolders: boolean;
  readonly network: NetworkProfile;
  readonly partner: PartnerOptions;
  readonly security: SecurityProfile;
  readonly operations: OperationsOptions;
  /** VMs in the project that the history deletes. */
  readonly retiredInstances: number;
  readonly web: WebProfile;
  readonly gke: GkeProfile;
  readonly serverless: ServerlessProfile;
  readonly data: DataProfile;
  readonly vm: VmProfile;
  readonly history: HistoryProfile;
}

const ALL_PURPOSES: readonly KeyPurpose[] = ['compute', 'storage', 'sql', 'gke', 'pubsub'];

/** Every optional case except the ones that need three environments. */
const STANDARD_FEATURES: readonly Feature[] = [
  'registries',
  'management',
  'fabric',
  'ncc',
  'edge',
  'compute',
  'kubernetes',
  'serverless',
  'data',
  'security',
];

const FULL_NETWORK: NetworkProfile = {
  firewallExtras: true,
  natInEveryRegion: true,
  dnsRecords: true,
  forwardingZone: true,
  publicZone: true,
  separateHybridRouter: true,
};

export const SIZE_PROFILES: Readonly<Record<DemoSize, SizeProfile>> = {
  S: {
    size: 'S',
    regions: 1,
    businessUnits: 1,
    environments: ['prod'],
    workloads: { prod: ['web', 'gke', 'serverless', 'data'] },
    leadWorkloads: {},
    features: [],
    platformSubfolders: false,
    network: {
      firewallExtras: false,
      natInEveryRegion: false,
      dnsRecords: false,
      forwardingZone: false,
      publicZone: false,
      separateHybridRouter: false,
    },
    partner: { instances: 0, firewall: false },
    security: { regions: 1, purposes: ['shared'], versionsPerKey: 1, accessLevel: false },
    operations: { builds: 2, enabledServices: 1 },
    retiredInstances: 1,
    web: {
      instances: 1,
      scaleOutBy: 1,
      autoscaler: false,
      staticSite: false,
      httpRedirect: false,
      sslPolicy: false,
      internalInstances: 1,
    },
    gke: {
      nodePools: 1,
      zones: 1,
      nodesPerZone: 2,
      namespaces: 1,
      deploymentsPerNamespace: 1,
      replicas: 2,
      nodeVms: false,
      systemWorkloads: false,
      ingressLb: false,
      membership: false,
      firewallRules: false,
      serviceAccounts: 'none',
    },
    serverless: {
      runServices: 1,
      functions: 1,
      topics: 1,
      sqlInstances: 1,
      secrets: false,
      directVpcEgress: false,
      archiveSubscriptions: false,
    },
    data: { buckets: 1, datasets: 1, tablesPerDataset: 1, externalTables: 1, views: false },
    vm: { instances: 0 },
    history: {
      changesPerDay: 1,
      restartsPerDay: 0.5,
      transientsPerDay: 0.3,
      growthPerDay: 0.1,
      retirementsPerDay: 0.1,
    },
  },
  M: {
    size: 'M',
    regions: 2,
    businessUnits: 3,
    environments: ['prod', 'nonprod'],
    workloads: { prod: ['web', 'gke', 'serverless', 'data'], nonprod: ['serverless'] },
    leadWorkloads: { prod: ['vm', 'ml'] },
    features: STANDARD_FEATURES,
    platformSubfolders: true,
    network: FULL_NETWORK,
    partner: { instances: 2, firewall: true },
    security: { regions: 2, purposes: ALL_PURPOSES, versionsPerKey: 2, accessLevel: true },
    operations: { builds: 12, enabledServices: 6 },
    retiredInstances: 2,
    web: {
      instances: 2,
      scaleOutBy: 2,
      autoscaler: true,
      staticSite: true,
      httpRedirect: true,
      sslPolicy: true,
      internalInstances: 1,
    },
    gke: {
      nodePools: 1,
      zones: 2,
      nodesPerZone: 1,
      namespaces: 2,
      deploymentsPerNamespace: 2,
      replicas: 2,
      nodeVms: true,
      systemWorkloads: true,
      ingressLb: true,
      membership: true,
      firewallRules: true,
      serviceAccounts: 'all',
    },
    serverless: {
      runServices: 2,
      functions: 1,
      topics: 2,
      sqlInstances: 1,
      secrets: true,
      directVpcEgress: true,
      archiveSubscriptions: true,
    },
    data: { buckets: 2, datasets: 2, tablesPerDataset: 3, externalTables: 1, views: true },
    vm: { instances: 3 },
    history: {
      changesPerDay: 5,
      restartsPerDay: 3,
      transientsPerDay: 1,
      growthPerDay: 0.6,
      retirementsPerDay: 0.5,
    },
  },
  L: {
    size: 'L',
    regions: 3,
    businessUnits: 10,
    environments: ['prod', 'staging', 'dev'],
    workloads: {
      prod: ['web', 'gke', 'serverless', 'data', 'vm'],
      staging: ['web', 'gke', 'serverless'],
      dev: ['web', 'serverless', 'vm'],
    },
    leadWorkloads: { prod: ['ml'] },
    features: [...STANDARD_FEATURES, 'large'],
    platformSubfolders: true,
    network: FULL_NETWORK,
    partner: { instances: 3, firewall: true },
    security: { regions: 3, purposes: ALL_PURPOSES, versionsPerKey: 3, accessLevel: true },
    operations: { builds: 40, enabledServices: 8 },
    retiredInstances: 3,
    web: {
      instances: 2,
      scaleOutBy: 3,
      autoscaler: true,
      staticSite: true,
      httpRedirect: true,
      sslPolicy: true,
      internalInstances: 2,
    },
    gke: {
      nodePools: 2,
      zones: 3,
      nodesPerZone: 1,
      namespaces: 4,
      deploymentsPerNamespace: 3,
      replicas: 2,
      nodeVms: true,
      systemWorkloads: true,
      ingressLb: true,
      membership: true,
      firewallRules: true,
      serviceAccounts: 'workload',
    },
    serverless: {
      runServices: 4,
      functions: 2,
      topics: 3,
      sqlInstances: 2,
      secrets: true,
      directVpcEgress: true,
      archiveSubscriptions: true,
    },
    data: { buckets: 3, datasets: 3, tablesPerDataset: 6, externalTables: 2, views: true },
    vm: { instances: 6 },
    history: {
      changesPerDay: 40,
      restartsPerDay: 30,
      transientsPerDay: 6,
      growthPerDay: 4,
      retirementsPerDay: 3,
    },
  },
  XL: {
    size: 'XL',
    regions: 4,
    businessUnits: 30,
    environments: ['prod', 'staging', 'dev'],
    workloads: {
      prod: ['web', 'gke', 'serverless', 'data', 'vm'],
      staging: ['web', 'gke', 'serverless', 'data'],
      dev: ['gke', 'serverless', 'vm'],
    },
    leadWorkloads: { prod: ['ml'] },
    features: [...STANDARD_FEATURES, 'large'],
    platformSubfolders: true,
    network: FULL_NETWORK,
    partner: { instances: 4, firewall: true },
    security: { regions: 4, purposes: ALL_PURPOSES, versionsPerKey: 4, accessLevel: true },
    operations: { builds: 120, enabledServices: 8 },
    retiredInstances: 4,
    web: {
      instances: 4,
      scaleOutBy: 4,
      autoscaler: true,
      staticSite: true,
      httpRedirect: true,
      sslPolicy: true,
      internalInstances: 2,
    },
    gke: {
      nodePools: 3,
      zones: 3,
      nodesPerZone: 2,
      namespaces: 8,
      deploymentsPerNamespace: 6,
      replicas: 3,
      nodeVms: true,
      systemWorkloads: true,
      ingressLb: true,
      membership: true,
      firewallRules: true,
      serviceAccounts: 'workload',
    },
    serverless: {
      runServices: 6,
      functions: 3,
      topics: 4,
      sqlInstances: 2,
      secrets: true,
      directVpcEgress: true,
      archiveSubscriptions: true,
    },
    data: { buckets: 4, datasets: 4, tablesPerDataset: 12, externalTables: 3, views: true },
    vm: { instances: 10 },
    history: {
      changesPerDay: 250,
      restartsPerDay: 250,
      transientsPerDay: 30,
      growthPerDay: 25,
      retirementsPerDay: 20,
    },
  },
};
