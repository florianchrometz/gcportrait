// SPDX-License-Identifier: Apache-2.0
/**
 * A Shared VPC host project: the VPC network (emitted last, because it lists its subnets and peerings), the
 * subnets workloads ask for, firewall rules, routes, Cloud Routers with Cloud NAT, private services access
 * (reserved range + Service Networking connection), Serverless VPC Access connectors and private DNS.
 */
import type { OrgBuilder } from '../builder/builder.js';
import { ON_PREM_DNS, ON_PREM_RANGE } from '../builder/builder.js';
import { HostPool, hostAt } from '../core/ip.js';
import type { JsonObject } from '../core/json.js';
import type { RecordSpec } from './context.js';
import {
  COMPUTE_API,
  addCompute,
  addProject,
  addProjectAsset,
  computeSelfLink,
  fullName,
  type ContainerCtx,
  type ProjectCtx,
} from './kit.js';
import { ENV_DISPLAY, type Env, type Region } from './vocabulary.js';

export interface SubnetRef {
  readonly name: string;
  readonly region: Region;
  readonly selfLink: string;
  /** `projects/<host id>/regions/<region>/subnetworks/<name>`. */
  readonly path: string;
  readonly cidr: string;
  readonly hosts: HostPool;
  readonly createdAt: number;
}

export interface RouterCtx {
  readonly name: string;
  readonly region: Region;
  readonly selfLink: string;
  readonly createdAt: number;
  readonly asn: number;
  readonly nats: JsonObject[];
  readonly interfaces: JsonObject[];
  readonly bgpPeers: JsonObject[];
}

export interface ConnectorCtx {
  /** `projects/<host id>/locations/<region>/connectors/<name>`. */
  readonly path: string;
  readonly connectedProjects: string[];
}

export interface PrivateServicesAccess {
  readonly rangeName: string;
  readonly cidr: string;
  readonly hosts: HostPool;
  readonly createdAt: number;
}

export interface HostNetwork {
  readonly project: ProjectCtx;
  readonly env: Env;
  readonly name: string;
  readonly selfLink: string;
  readonly full: string;
  /** `projects/<host id>/global/networks/<name>`. */
  readonly path: string;
  readonly createdAt: number;
  readonly regions: readonly Region[];
  readonly subnets: SubnetRef[];
  readonly peerings: JsonObject[];
  /** By router name. */
  readonly routers: Map<string, RouterCtx>;
  readonly connectors: Map<string, ConnectorCtx>;
  readonly psa: PrivateServicesAccess;
  /** Records of the private zone `<env>.internal.example.org.`. */
  readonly privateRecords: RecordSpec[];
  readonly privateZone: string;
}

export interface HostOptions {
  readonly regions: readonly Region[];
  readonly firewallExtras: boolean;
  readonly natInEveryRegion: boolean;
  readonly dnsRecords: boolean;
  readonly forwardingZone: boolean;
}

export function createHost(b: OrgBuilder, folder: ContainerCtx, env: Env, options: HostOptions): HostNetwork {
  const primary = options.regions[0];
  if (primary === undefined) throw new Error('a host needs at least one region');
  const project = addProject(b, folder, {
    role: 'net',
    displayName: `Shared VPC host (${ENV_DISPLAY[env]})`,
    env,
    region: primary,
    team: 'network',
  });
  addProjectAsset(b, project, {
    assetType: 'compute.googleapis.com/Project',
    name: fullName('compute.googleapis.com', `projects/${project.id}`),
    location: 'global',
    data: {
      kind: 'compute#project',
      id: project.number,
      name: project.id,
      selfLink: `${COMPUTE_API}/projects/${project.id}`,
      xpnProjectStatus: 'HOST',
      defaultServiceAccount: `${project.number}-compute@developer.gserviceaccount.com`,
      defaultNetworkTier: 'PREMIUM',
      commonInstanceMetadata: { kind: 'compute#metadata', items: [{ key: 'enable-oslogin', value: 'TRUE' }] },
      vmDnsSetting: 'ZONAL_ONLY',
    },
    traits: { pinned: true },
  });

  const name = `vpc-shared-${env}`;
  const path = `projects/${project.id}/global/networks/${name}`;
  const full = fullName('compute.googleapis.com', path);
  const psaName = `psa-range-${env}`;
  const psaCidr = b.addresses.privateServices.allocate(20);
  const createdAt = b.createdAt(full, project.createdAt);
  const host: HostNetwork = {
    project,
    env,
    name,
    selfLink: computeSelfLink(project.id, `global/networks/${name}`),
    full,
    path,
    createdAt,
    regions: options.regions,
    subnets: [],
    peerings: [],
    routers: new Map(),
    connectors: new Map(),
    psa: {
      rangeName: psaName,
      cidr: psaCidr,
      hosts: new HostPool(psaCidr, 3),
      createdAt: b.createdAt(
        fullName('compute.googleapis.com', `projects/${project.id}/global/addresses/${psaName}`),
        createdAt,
      ),
    },
    privateRecords: [],
    privateZone: `${env}.internal.example.org.`,
  };

  addFirewallRules(b, host, options.firewallExtras);
  addDefaultRoute(b, host);
  addPrivateServicesAccess(b, host);
  for (const region of options.natInEveryRegion ? options.regions : [primary])
    routerFor(b, host, region, true);
  addPrivateZones(b, host, options);

  b.defer(() => {
    addCompute(b, project, {
      kind: 'Network',
      collection: 'networks',
      scope: 'global',
      name,
      createdAt: host.createdAt,
      data: {
        description: `Shared VPC for ${ENV_DISPLAY[env].toLowerCase()} workloads`,
        autoCreateSubnetworks: false,
        routingConfig: { routingMode: 'GLOBAL', bgpBestPathSelectionMode: 'LEGACY' },
        mtu: 1460,
        networkFirewallPolicyEnforcementOrder: 'AFTER_CLASSIC_FIREWALL',
        subnetworks: host.subnets.map((subnet) => subnet.selfLink),
        peerings: [...host.peerings],
      },
      traits: { pinned: true },
    });
    for (const router of host.routers.values()) emitRouter(b, host, router);
    for (const [region, connector] of host.connectors) emitConnector(b, host, region, connector);
  });
  return host;
}

export interface SubnetSpec {
  readonly region: Region;
  readonly name: string;
  readonly prefix: number;
  readonly secondary?: readonly { readonly rangeName: string; readonly ipCidrRange: string }[];
  readonly purpose?: string;
}

export function addSubnet(b: OrgBuilder, host: HostNetwork, spec: SubnetSpec): SubnetRef {
  const cidr = b.addresses.subnets.allocate(spec.prefix);
  const ref = addCompute(b, host.project, {
    kind: 'Subnetwork',
    collection: 'subnetworks',
    scope: { region: spec.region.name },
    name: spec.name,
    after: host.createdAt,
    data: {
      network: host.selfLink,
      ipCidrRange: cidr,
      gatewayAddress: hostAt(cidr, 1),
      secondaryIpRanges: (spec.secondary ?? []).map((range) => ({ ...range })),
      privateIpGoogleAccess: true,
      purpose: spec.purpose ?? 'PRIVATE',
      stackType: 'IPV4_ONLY',
      fingerprint:
        b.rng
          .fork(`fp:${spec.name}`)
          .chars('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 11) + '=',
      logConfig: {
        enable: true,
        aggregationInterval: 'INTERVAL_5_SEC',
        flowSampling: 0.5,
        metadata: 'INCLUDE_ALL_METADATA',
      },
    },
  });
  const subnet: SubnetRef = {
    name: spec.name,
    region: spec.region,
    selfLink: ref.selfLink,
    path: ref.path,
    cidr,
    hosts: new HostPool(cidr, 2),
    createdAt: ref.asset.createdAt,
  };
  host.subnets.push(subnet);
  return subnet;
}

function addFirewallRules(b: OrgBuilder, host: HostNetwork, extras: boolean): void {
  const rule = (name: string, data: JsonObject): void => {
    addCompute(b, host.project, {
      kind: 'Firewall',
      collection: 'firewalls',
      scope: 'global',
      name,
      after: host.createdAt,
      data: {
        network: host.selfLink,
        priority: 1000,
        direction: 'INGRESS',
        disabled: false,
        logConfig: { enable: false },
        ...data,
      },
    });
  };
  rule(`allow-internal-${host.env}`, {
    description: 'East-west traffic inside the Shared VPC',
    sourceRanges: ['10.0.0.0/8'],
    allowed: [{ IPProtocol: 'tcp' }, { IPProtocol: 'udp' }, { IPProtocol: 'icmp' }],
  });
  rule(`allow-health-checks-${host.env}`, {
    description: 'Load balancer health checks (documentation range stands in for the prober ranges)',
    sourceRanges: ['203.0.113.224/27'],
    targetTags: ['lb-backend'],
    allowed: [{ IPProtocol: 'tcp', ports: ['80', '443', '8080'] }],
  });
  if (!extras) return;
  rule(`allow-ssh-from-corp-${host.env}`, {
    description: 'Administrative SSH from the corporate network over the hybrid links',
    sourceRanges: [ON_PREM_RANGE],
    allowed: [{ IPProtocol: 'tcp', ports: ['22'] }],
    logConfig: { enable: true, metadata: 'INCLUDE_ALL_METADATA' },
  });
  rule(`deny-egress-internet-${host.env}`, {
    description: 'Planned egress lock-down, not yet enforced',
    direction: 'EGRESS',
    priority: 65000,
    destinationRanges: ['0.0.0.0/0'],
    denied: [{ IPProtocol: 'all' }],
    disabled: true,
  });
}

function addDefaultRoute(b: OrgBuilder, host: HostNetwork): void {
  addCompute(b, host.project, {
    kind: 'Route',
    collection: 'routes',
    scope: 'global',
    name: `default-route-${b.rng.fork(`route:${host.full}`).hex(16)}`,
    after: host.createdAt,
    data: {
      description: 'Default route to the Internet.',
      network: host.selfLink,
      destRange: '0.0.0.0/0',
      priority: 1000,
      nextHopGateway: computeSelfLink(host.project.id, 'global/gateways/default-internet-gateway'),
    },
  });
}

function addPrivateServicesAccess(b: OrgBuilder, host: HostNetwork): void {
  const range = addCompute(b, host.project, {
    kind: 'GlobalAddress',
    collection: 'addresses',
    scope: 'global',
    name: host.psa.rangeName,
    createdAt: host.psa.createdAt,
    data: {
      description: 'Private services access range (Cloud SQL, Memorystore)',
      address: host.psa.cidr.split('/')[0] ?? '',
      prefixLength: Number(host.psa.cidr.split('/')[1]),
      status: 'RESERVED',
      addressType: 'INTERNAL',
      purpose: 'VPC_PEERING',
      network: host.selfLink,
      labelFingerprint: '42WmSpB8rSM=',
    },
  });
  const tenant = `${b.rng.fork(`tenant:${host.full}`).hex(14)}-tp`;
  host.peerings.push({
    name: 'servicenetworking-googleapis-com',
    network: computeSelfLink(tenant, 'global/networks/servicenetworking'),
    state: 'ACTIVE',
    stateDetails: '[2080] ACTIVE',
    autoCreateRoutes: true,
    exchangeSubnetRoutes: true,
    exportCustomRoutes: false,
    importCustomRoutes: false,
    exportSubnetRoutesWithPublicIp: false,
    importSubnetRoutesWithPublicIp: false,
    stackType: 'IPV4_ONLY',
  });
  const networkByNumber = `projects/${host.project.number}/global/networks/${host.name}`;
  addProjectAsset(b, host.project, {
    assetType: 'servicenetworking.googleapis.com/Connection',
    name: fullName(
      'servicenetworking.googleapis.com',
      `${networkByNumber}/connections/servicenetworking-googleapis-com`,
    ),
    location: 'global',
    after: range.asset.createdAt,
    data: {
      network: networkByNumber,
      reservedPeeringRanges: [host.psa.rangeName],
      peering: 'servicenetworking-googleapis-com',
      service: 'services/servicenetworking.googleapis.com',
    },
  });
}

/** A Cloud Router named `name` in `region`, created on first use. */
export function addRouter(b: OrgBuilder, host: HostNetwork, region: Region, name: string): RouterCtx {
  const existing = host.routers.get(name);
  if (existing !== undefined) return existing;
  const path = `projects/${host.project.id}/regions/${region.name}/routers/${name}`;
  const router: RouterCtx = {
    name,
    region,
    selfLink: computeSelfLink(host.project.id, `regions/${region.name}/routers/${name}`),
    createdAt: b.createdAt(fullName('compute.googleapis.com', path), host.createdAt),
    asn: 64512 + host.routers.size,
    nats: [],
    interfaces: [],
    bgpPeers: [],
  };
  host.routers.set(name, router);
  return router;
}

/** The region's main Cloud Router (`cr-<env>-<region>`), created on first use; `withNat` adds Cloud NAT. */
export function routerFor(b: OrgBuilder, host: HostNetwork, region: Region, withNat = false): RouterCtx {
  const name = `cr-${host.env}-${region.name}`;
  const existing = host.routers.get(name);
  if (existing !== undefined) return existing;
  const router = addRouter(b, host, region, name);
  if (withNat) addNat(b, host, router);
  return router;
}

function addNat(b: OrgBuilder, host: HostNetwork, router: RouterCtx): void {
  const manual = host.env === 'prod' && router.region === host.regions[0];
  const natIps: string[] = [];
  if (manual) {
    const address = addCompute(b, host.project, {
      kind: 'Address',
      collection: 'addresses',
      scope: { region: router.region.name },
      name: `nat-ip-${router.region.name}-1`,
      after: router.createdAt,
      data: {
        description: 'Static egress address for Cloud NAT (allow-listed by partners)',
        address: b.addresses.external.next(),
        status: 'IN_USE',
        addressType: 'EXTERNAL',
        networkTier: 'PREMIUM',
        users: [router.selfLink],
        labelFingerprint: '42WmSpB8rSM=',
      },
    });
    natIps.push(address.selfLink);
  }
  router.nats.push({
    name: `nat-${router.region.name}`,
    type: 'PUBLIC',
    natIpAllocateOption: manual ? 'MANUAL_ONLY' : 'AUTO_ONLY',
    natIps,
    sourceSubnetworkIpRangesToNat: 'ALL_SUBNETWORKS_ALL_IP_RANGES',
    enableEndpointIndependentMapping: false,
    minPortsPerVm: 64,
    logConfig: { enable: true, filter: 'ERRORS_ONLY' },
    endpointTypes: ['ENDPOINT_TYPE_VM'],
  });
}

function emitRouter(b: OrgBuilder, host: HostNetwork, router: RouterCtx): void {
  addCompute(b, host.project, {
    kind: 'Router',
    collection: 'routers',
    scope: { region: router.region.name },
    name: router.name,
    createdAt: router.createdAt,
    data: {
      network: host.selfLink,
      bgp: {
        asn: router.asn,
        advertiseMode: 'CUSTOM',
        advertisedGroups: ['ALL_SUBNETS'],
        keepaliveInterval: 20,
      },
      interfaces: [...router.interfaces],
      bgpPeers: [...router.bgpPeers],
      nats: [...router.nats],
      encryptedInterconnectRouter: false,
    },
  });
}

/** The region's Serverless VPC Access connector in the host project; `projectId` is recorded as connected. */
export function connectorFor(host: HostNetwork, region: Region, projectId: string): ConnectorCtx {
  let connector = host.connectors.get(region.name);
  if (connector === undefined) {
    connector = {
      path: `projects/${host.project.id}/locations/${region.name}/connectors/conn-${region.name}`,
      connectedProjects: [],
    };
    host.connectors.set(region.name, connector);
  }
  if (!connector.connectedProjects.includes(projectId)) connector.connectedProjects.push(projectId);
  return connector;
}

function emitConnector(b: OrgBuilder, host: HostNetwork, region: string, connector: ConnectorCtx): void {
  addProjectAsset(b, host.project, {
    assetType: 'vpcaccess.googleapis.com/Connector',
    name: fullName('vpcaccess.googleapis.com', connector.path),
    location: region,
    after: host.createdAt,
    data: {
      name: connector.path,
      network: host.name,
      ipCidrRange: b.addresses.connectors.allocate(28),
      state: 'READY',
      minThroughput: 200,
      maxThroughput: 300,
      minInstances: 2,
      maxInstances: 3,
      machineType: 'e2-micro',
      connectedProjects: [...connector.connectedProjects],
    },
  });
}

function addPrivateZones(b: OrgBuilder, host: HostNetwork, options: HostOptions): void {
  const zoneName = `internal-${host.env}`;
  addManagedZone(b, host.project, zoneName, host.privateZone, {
    description: `Private names for ${ENV_DISPLAY[host.env].toLowerCase()} workloads`,
    visibility: 'private',
    privateVisibilityConfig: {
      kind: 'dns#managedZonePrivateVisibilityConfig',
      networks: [{ kind: 'dns#managedZonePrivateVisibilityConfigNetwork', networkUrl: host.selfLink }],
    },
    nameServers: ['ns-gcp-private.googledomains.com.'],
  });
  if (options.forwardingZone) {
    addManagedZone(b, host.project, `corp-forwarding-${host.env}`, 'corp.example.com.', {
      description: 'Forwards the corporate domain to the on-premises resolvers',
      visibility: 'private',
      privateVisibilityConfig: {
        kind: 'dns#managedZonePrivateVisibilityConfig',
        networks: [{ kind: 'dns#managedZonePrivateVisibilityConfigNetwork', networkUrl: host.selfLink }],
      },
      forwardingConfig: {
        kind: 'dns#managedZoneForwardingConfig',
        targetNameServers: [
          { kind: 'dns#managedZoneForwardingConfigNameServerTarget', ipv4Address: ON_PREM_DNS },
        ],
      },
    });
  }
  if (options.dnsRecords) {
    b.defer(() => {
      addRecordSets(b, host.project, zoneName, host.privateRecords);
    });
  }
}

export function addManagedZone(
  b: OrgBuilder,
  project: ProjectCtx,
  zoneName: string,
  dnsName: string,
  data: JsonObject,
): void {
  addProjectAsset(b, project, {
    assetType: 'dns.googleapis.com/ManagedZone',
    name: fullName('dns.googleapis.com', `projects/${project.id}/managedZones/${zoneName}`),
    location: 'global',
    data: {
      kind: 'dns#managedZone',
      name: zoneName,
      dnsName,
      id: b.rng.fork(`zone:${project.id}/${zoneName}`).digits(19),
      dnssecConfig: { kind: 'dns#managedZoneDnsSecConfig', state: 'off' },
      cloudLoggingConfig: { kind: 'dns#managedZoneCloudLoggingConfig', enableLogging: false },
      ...data,
    },
    traits: { pinned: true },
  });
}

export function addRecordSets(
  b: OrgBuilder,
  project: ProjectCtx,
  zoneName: string,
  records: readonly RecordSpec[],
): void {
  const zone = fullName('dns.googleapis.com', `projects/${project.id}/managedZones/${zoneName}`);
  for (const record of records) {
    addProjectAsset(b, project, {
      assetType: 'dns.googleapis.com/ResourceRecordSet',
      name: `${zone}/rrsets/${record.name}/${record.type}`,
      location: 'global',
      data: {
        kind: 'dns#resourceRecordSet',
        name: record.name,
        type: record.type,
        ttl: 300,
        ...(record.routingPolicy === undefined
          ? { rrdatas: [...record.rrdatas] }
          : { routingPolicy: record.routingPolicy }),
      },
      traits: { addable: true },
    });
  }
}
