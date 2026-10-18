// SPDX-License-Identifier: Apache-2.0
/**
 * Composes one organisation from the templates as the size profile prescribes: the folder tree, one Shared
 * VPC host per environment, hybrid connectivity, the peered partner VPC, the security, operations, sandbox
 * (empty) and retired projects, then per business unit and environment the workload projects, and finally the
 * perimeter and the public DNS zone. The optional cases of `features.ts` (M and larger) add the platform
 * management project, the networking fabric, Network Connectivity Center and the security and edge platform
 * before the workload projects, and the Artifact Registry repositories last.
 */
import { DEMO_ORGANIZATION_IDS } from '../constants.js';
import type { OrgBuilder } from '../builder/builder.js';
import { DAY_MS } from '../core/time.js';
import type { OrgContext } from './context.js';
import { addLargeHybrid, addNetworkConnectivityCenter } from './connectivity.js';
import { addDataProject } from './data.js';
import { addOrganisationArmor, addSecureWebProxy } from './edge.js';
import { addFabric } from './fabric.js';
import { has } from './features.js';
import { addGkeProject } from './gke.js';
import { addHybridConnectivity } from './hybrid.js';
import {
  addFolder,
  addOrganization,
  addProject,
  makeCompute,
  type ContainerCtx,
  type ProjectCtx,
} from './kit.js';
import { addRetiredProject } from './retired.js';
import { addManagement, createManagementProject } from './management.js';
import { addMlProject } from './ml.js';
import { addManagedZone, addRecordSets, createHost, type HostNetwork } from './network.js';
import { addOperationsProject } from './operations.js';
import { addPartnerNetwork } from './partner.js';
import type { Archetype, SizeProfile } from './profiles.js';
import { addRegistries } from './registries.js';
import { addPerimeter, addSecurityProject } from './security.js';
import { addServerlessProject } from './serverless.js';
import { addSecurityExtras } from './trust.js';
import { addVmProject } from './vm.js';
import { BUSINESS_UNITS, ENV_DISPLAY, REGIONS, nth, type Env, type Region } from './vocabulary.js';
import { addWebProject, title } from './web.js';

type WorkloadTemplate = (
  ctx: OrgContext,
  folder: ContainerCtx,
  team: string,
  env: Env,
  region: Region,
) => ProjectCtx;

/** Which template builds which kind of workload project. */
const WORKLOAD_TEMPLATES: Readonly<Record<Archetype, WorkloadTemplate>> = {
  web: addWebProject,
  gke: addGkeProject,
  serverless: addServerlessProject,
  data: addDataProject,
  vm: addVmProject,
  ml: addMlProject,
};

export function buildOrganization(b: OrgBuilder, profile: SizeProfile): void {
  const regions = REGIONS.slice(0, profile.regions);
  const primary = regions[0];
  if (primary === undefined) throw new Error('a profile needs at least one region');
  const org = addOrganization(b, DEMO_ORGANIZATION_IDS[profile.size], b.windowStart - 4 * 365 * DAY_MS);
  const platform = addFolder(b, org, 'Platform');
  const networking = profile.platformSubfolders ? addFolder(b, platform, 'Networking') : platform;
  const security = profile.platformSubfolders ? addFolder(b, platform, 'Security') : platform;
  const operations = profile.platformSubfolders ? addFolder(b, platform, 'Operations') : platform;
  const workloads = addFolder(b, org, 'Workloads');

  const hosts = new Map<Env, HostNetwork>();
  for (const env of profile.environments) {
    const host = createHost(b, networking, env, {
      regions,
      firewallExtras: profile.network.firewallExtras,
      natInEveryRegion: profile.network.natInEveryRegion,
      dnsRecords: profile.network.dnsRecords,
      forwardingZone: profile.network.forwardingZone,
    });
    hosts.set(env, host);
    addDebugFirewallFactory(b, host);
  }
  const prodHost = hosts.values().next().value;
  if (prodHost === undefined) throw new Error('a profile needs at least one environment');
  const hybrid = addHybridConnectivity(b, prodHost, profile.network.separateHybridRouter);
  const partner = addPartnerNetwork(b, networking, prodHost, profile.partner);
  const keys = addSecurityProject(b, security, {
    regions: REGIONS.slice(0, profile.security.regions),
    purposes: profile.security.purposes,
    versionsPerKey: profile.security.versionsPerKey,
  });
  const management = has(profile, 'management') ? createManagementProject(b, operations, primary) : undefined;
  // With the management project the builds run there, next to their triggers.
  addOperationsProject(b, operations, primary, {
    ...profile.operations,
    builds: management === undefined ? profile.operations.builds : 0,
  });
  addProject(b, org, {
    role: 'sandbox',
    displayName: 'Sandbox',
    env: 'dev',
    region: primary,
    team: 'platform',
  });
  addRetiredProject(b, workloads, primary, profile.retiredInstances);

  const once = new Set<string>();
  const ctx: OrgContext = {
    b,
    profile,
    org,
    hosts,
    keys,
    partner,
    publicRecords: [],
    perimeterCandidates: { serverless: [], data: [] },
    inventory: { web: [], clusters: [], serverless: [], data: [], vms: [] },
    fabric: new Map(),
    management,
    folders: { workloads },
    once: (key) => {
      if (once.has(key)) return false;
      once.add(key);
      return true;
    },
  };
  if (management !== undefined) addManagement(ctx, management, profile.operations.builds);
  if (has(profile, 'fabric')) addFabric(ctx, hybrid);
  if (has(profile, 'ncc')) addNetworkConnectivityCenter(ctx, hybrid);
  if (has(profile, 'large')) {
    addLargeHybrid(ctx, hybrid);
    for (const host of hosts.values()) addSecureWebProxy(ctx, host);
  }
  if (has(profile, 'edge')) addOrganisationArmor(ctx);
  if (has(profile, 'security')) addSecurityExtras(ctx);
  for (let u = 0; u < profile.businessUnits; u++) {
    const team = nth(BUSINESS_UNITS, u);
    const region = regions[u % regions.length] ?? primary;
    const unit = addFolder(b, workloads, title(team));
    for (const env of profile.environments) {
      const folder = addFolder(b, unit, ENV_DISPLAY[env]);
      const archetypes = [
        ...(profile.workloads[env] ?? []),
        ...(u === 0 ? (profile.leadWorkloads[env] ?? []) : []),
      ];
      for (const archetype of archetypes) WORKLOAD_TEMPLATES[archetype](ctx, folder, team, env, region);
    }
  }

  const protectedProjects = [ctx.perimeterCandidates.serverless[0], ctx.perimeterCandidates.data[0]].filter(
    (p): p is ProjectCtx => p !== undefined,
  );
  const bridged = ctx.perimeterCandidates.data.slice(0, 2);
  addPerimeter(
    b,
    org,
    protectedProjects,
    profile.security.accessLevel,
    has(profile, 'large') ? { networks: [prodHost.full], bridge: bridged } : undefined,
  );
  if (profile.network.publicZone) {
    addManagedZone(b, prodHost.project, 'example-org', 'example.org.', {
      description: 'Public names of the storefronts',
      visibility: 'public',
      nameServers: [
        'ns-cloud-a1.googledomains.com.',
        'ns-cloud-a2.googledomains.com.',
        'ns-cloud-a3.googledomains.com.',
        'ns-cloud-a4.googledomains.com.',
      ],
    });
    b.defer(() => {
      addRecordSets(b, prodHost.project, 'example-org', ctx.publicRecords);
    });
  }
  // Last: every image path is known once the other deferred templates have run.
  if (has(profile, 'registries')) addRegistries(ctx);
}

/** Short-lived "allow debugging" firewall rules on a host network. */
function addDebugFirewallFactory(b: OrgBuilder, host: HostNetwork): void {
  b.ephemerals.push({
    kind: 'debug-firewall',
    weight: 1,
    notBefore: host.createdAt,
    make: (createdAt, serial) => [
      makeCompute(
        b,
        host.project,
        {
          kind: 'Firewall',
          collection: 'firewalls',
          scope: 'global',
          name: `allow-debug-${String(serial)}`,
          data: {
            description: 'Temporary access for an incident investigation',
            network: host.selfLink,
            priority: 900,
            direction: 'INGRESS',
            disabled: false,
            sourceRanges: ['172.16.0.0/16'],
            targetTags: ['debug'],
            allowed: [{ IPProtocol: 'tcp', ports: ['8443'] }],
            logConfig: { enable: true, metadata: 'INCLUDE_ALL_METADATA' },
          },
        },
        createdAt,
      ).asset,
    ],
  });
}
