// SPDX-License-Identifier: Apache-2.0
/**
 * The networking fabric around each Shared VPC host (feature `fabric`): the subnet routes Compute Engine
 * creates for every subnet, a global network firewall policy, a Cloud DNS server policy and response policy,
 * Private Service Connect for Google APIs, a subnet for Private Service Connect endpoints and an internal
 * range for the GKE pod ranges. The production host also gets the organisation's hierarchical firewall policy
 * with Cloud NGFW Enterprise (security profiles, a firewall endpoint and its association), Cloud IDS, a network
 * appliance with two static routes (one over the HA VPN), a network attachment for PSC interfaces, the NAT
 * subnet of the Private Service Connect producers, a DNS peering zone into the partner VPC, Service Directory
 * with its DNS zone, and the Cloud Domains registration of `example.org`.
 */
import type { OrgBuilder } from '../builder/builder.js';
import { uuid } from '../core/ids.js';
import { HostPool } from '../core/ip.js';
import type { JsonObject } from '../core/json.js';
import { DAY_MS } from '../core/time.js';
import { addInstance } from './compute.js';
import { prodHost, type OrgContext } from './context.js';
import type { HybridLinks } from './hybrid.js';
import {
  addCompute,
  addProjectAsset,
  addServiceAccount,
  fullName,
  standardLabels,
  type ProjectCtx,
} from './kit.js';
import { addManagedZone, addSubnet, type HostNetwork, type SubnetRef } from './network.js';
import { ENV_DISPLAY, type Region } from './vocabulary.js';

const NETWORK_SECURITY = 'networksecurity.googleapis.com';

/** The organisation's security profile group (its number is the demo size's). */
function profileGroupOf(ctx: OrgContext): string {
  return `${ctx.org.ref}/locations/global/securityProfileGroups/inspect-web`;
}

/** A network attachment that producers (Vertex AI agents, …) connect PSC interfaces to. */
export interface NetworkAttachmentCtx {
  /** `projects/<host id>/regions/<region>/networkAttachments/<name>`. */
  readonly path: string;
  readonly selfLink: string;
  readonly region: Region;
  readonly subnet: SubnetRef;
  /** The producer projects connected so far, with the address each interface got. */
  readonly consumers: { readonly project: ProjectCtx; readonly ip: string }[];
}

/** What the fabric added to one host, for the workload templates. */
export interface HostFabric {
  readonly host: HostNetwork;
  readonly production: boolean;
  /** A subnet that Private Service Connect consumer endpoints take their addresses from. */
  readonly endpoints: SubnetRef;
  /** Production only: the NAT subnet of Private Service Connect service attachments. */
  readonly pscNat: SubnetRef | undefined;
  /** Production only. */
  readonly attachment: NetworkAttachmentCtx | undefined;
  /** The internal address of the Private Service Connect endpoint for Google APIs. */
  readonly googleApis: string;
}

export function fabricFor(ctx: OrgContext, host: HostNetwork): HostFabric | undefined {
  return ctx.fabric.get(host.env);
}

/** The fabric of every host, and the organisation-level network security of production. */
export function addFabric(ctx: OrgContext, hybrid: HybridLinks): void {
  const production = prodHost(ctx);
  const googleApis = new HostPool('10.255.255.0/24', 200);
  for (const [env, host] of ctx.hosts) {
    const fabric = addHostFabric(ctx, host, host === production, googleApis.next());
    ctx.fabric.set(env, fabric);
    if (fabric.production) addProductionFabric(ctx, fabric, hybrid);
  }
  addOrganisationNetworkSecurity(ctx, production);
}

function addHostFabric(
  ctx: OrgContext,
  host: HostNetwork,
  production: boolean,
  googleApis: string,
): HostFabric {
  const { b } = ctx;
  const region = host.regions[0];
  if (region === undefined) throw new Error('the host has no region');
  const project = host.project;
  const endpoints = addSubnet(b, host, { region, name: `psc-endpoints-${host.env}`, prefix: 24 });
  const pscNat = production
    ? addSubnet(b, host, {
        region,
        name: `psc-nat-${region.name}`,
        prefix: 26,
        purpose: 'PRIVATE_SERVICE_CONNECT',
      })
    : undefined;
  const attachmentSubnet = production
    ? addSubnet(b, host, { region, name: `psc-interfaces-${region.name}`, prefix: 28 })
    : undefined;
  const attachment: NetworkAttachmentCtx | undefined =
    attachmentSubnet === undefined
      ? undefined
      : {
          path: `projects/${project.id}/regions/${region.name}/networkAttachments/agents-${region.name}`,
          selfLink: `https://www.googleapis.com/compute/v1/projects/${project.id}/regions/${region.name}/networkAttachments/agents-${region.name}`,
          region,
          subnet: attachmentSubnet,
          consumers: [],
        };

  // Private Service Connect for Google APIs: a global internal address and the endpoint that uses it.
  const pscRule = `pscapis${host.env}`;
  const pscRuleLink = `https://www.googleapis.com/compute/v1/projects/${project.id}/global/forwardingRules/${pscRule}`;
  const address = addCompute(b, project, {
    kind: 'GlobalAddress',
    collection: 'addresses',
    scope: 'global',
    name: 'psc-googleapis',
    after: host.createdAt,
    data: {
      description: 'Private Service Connect endpoint for all Google APIs',
      address: googleApis,
      status: 'IN_USE',
      addressType: 'INTERNAL',
      purpose: 'PRIVATE_SERVICE_CONNECT',
      network: host.selfLink,
      users: [pscRuleLink],
      labelFingerprint: '42WmSpB8rSM=',
    },
  });
  addCompute(b, project, {
    kind: 'GlobalForwardingRule',
    collection: 'forwardingRules',
    scope: 'global',
    name: pscRule,
    after: address.asset.createdAt,
    data: {
      IPAddress: googleApis,
      target: 'all-apis',
      network: host.selfLink,
      loadBalancingScheme: '',
      pscConnectionId: b.rng.fork(`psc:${pscRule}`).digits(17),
      pscConnectionStatus: 'ACCEPTED',
      labelFingerprint: '42WmSpB8rSM=',
      fingerprint: 'oK2yQ8f2v1E=',
    },
  });

  // Cloud DNS: a server policy (inbound forwarding for on-premises clients) and a response policy.
  const rng = b.rng.fork(`dns-policy:${project.id}`);
  addProjectAsset(b, project, {
    assetType: 'dns.googleapis.com/Policy',
    name: fullName('dns.googleapis.com', `projects/${project.id}/policies/${rng.digits(19)}`),
    location: 'global',
    after: host.createdAt,
    data: {
      kind: 'dns#policy',
      id: rng.digits(19),
      name: `inbound-${host.env}`,
      description: `Inbound forwarding and query logging for the ${ENV_DISPLAY[host.env].toLowerCase()} Shared VPC`,
      enableInboundForwarding: true,
      enableLogging: production,
      networks: [{ kind: 'dns#policyNetwork', networkUrl: host.selfLink }],
      ...(production
        ? {
            alternativeNameServerConfig: {
              kind: 'dns#policyAlternativeNameServerConfig',
              targetNameServers: [
                {
                  kind: 'dns#policyAlternativeNameServerConfigTargetNameServer',
                  ipv4Address: '172.16.0.53',
                  forwardingPath: 'private',
                },
              ],
            },
          }
        : {}),
    },
  });
  const rpz = `rpz-${host.env}`;
  const rpzPath = `projects/${project.number}/locations/global/responsePolicies/${rpz}`;
  const response = addProjectAsset(b, project, {
    assetType: 'dns.googleapis.com/ResponsePolicy',
    name: fullName('dns.googleapis.com', rpzPath),
    location: 'global',
    after: host.createdAt,
    data: {
      kind: 'dns#responsePolicy',
      id: rng.digits(19),
      responsePolicyName: rpz,
      description: 'Google APIs through Private Service Connect; corporate names bypass the policy',
      networks: [{ kind: 'dns#responsePolicyNetwork', networkUrl: host.selfLink }],
      labels: { env: host.env },
    },
  });
  const rules: readonly [string, JsonObject][] = [
    [
      'googleapis',
      {
        dnsName: '*.googleapis.com.',
        localData: {
          localDatas: [
            {
              kind: 'dns#resourceRecordSet',
              name: '*.googleapis.com.',
              type: 'A',
              ttl: 300,
              rrdatas: [googleApis],
            },
          ],
        },
      },
    ],
    ['corp-bypass', { dnsName: 'corp.example.com.', behavior: 'bypassResponsePolicy' }],
  ];
  for (const [ruleName, rule] of rules) {
    addProjectAsset(b, project, {
      assetType: 'dns.googleapis.com/ResponsePolicyRule',
      name: fullName('dns.googleapis.com', `${rpzPath}/rules/${ruleName}`),
      location: 'global',
      after: response.createdAt,
      data: { kind: 'dns#responsePolicyRule', ruleName, ...rule },
    });
  }

  // The GKE pod ranges of this host are reserved as an internal range.
  addProjectAsset(b, project, {
    assetType: 'networkconnectivity.googleapis.com/InternalRange',
    name: fullName(
      'networkconnectivity.googleapis.com',
      `projects/${project.number}/locations/global/internalRanges/gke-pods-${host.env}`,
    ),
    location: 'global',
    after: host.createdAt,
    data: {
      name: `projects/${project.number}/locations/global/internalRanges/gke-pods-${host.env}`,
      description: 'Reserved for the GKE pod ranges of the service projects',
      labels: { env: host.env },
      ipCidrRange: '10.128.0.0/10',
      network: host.selfLink,
      usage: 'FOR_VPC',
      peering: 'FOR_SELF',
      prefixLength: 10,
      overlaps: ['OVERLAP_EXISTING_SUBNET_RANGE'],
      immutable: false,
    },
  });

  // Emitted at the end, when every subnet and every service project exists.
  b.defer(() => {
    for (const subnet of host.subnets) {
      addCompute(b, project, {
        kind: 'Route',
        collection: 'routes',
        scope: 'global',
        name: `default-route-${b.rng.fork(`route:${subnet.selfLink}`).hex(16)}`,
        after: subnet.createdAt,
        data: {
          description: `Default local route to the subnetwork ${subnet.cidr}.`,
          network: host.selfLink,
          destRange: subnet.cidr,
          priority: 0,
          nextHopNetwork: host.selfLink,
          routeType: 'SUBNET',
        },
      });
    }
    addNetworkFirewallPolicy(ctx, host);
    if (attachment !== undefined) emitNetworkAttachment(b, host, attachment);
  });
  return {
    host,
    production,
    endpoints,
    pscNat,
    attachment,
    googleApis,
  };
}

/** A global network firewall policy that admits health checks to the load-balanced service accounts. */
function addNetworkFirewallPolicy(ctx: OrgContext, host: HostNetwork): void {
  const accounts = ctx.inventory.web
    .filter((web) => web.project.env === host.env)
    .map((web) => web.serviceAccount);
  const rules: JsonObject[] = [
    {
      kind: 'compute#firewallPolicyRule',
      priority: 1000,
      direction: 'INGRESS',
      action: 'allow',
      description: 'Load balancer health checks to the web tiers',
      match: {
        srcIpRanges: ['203.0.113.224/27'],
        layer4Configs: [{ ipProtocol: 'tcp', ports: ['80', '443', '8080'] }],
      },
      ...(accounts.length === 0 ? { targetResources: [host.selfLink] } : { targetServiceAccounts: accounts }),
      enableLogging: false,
      ruleTupleCount: 4,
    },
    {
      kind: 'compute#firewallPolicyRule',
      priority: 2000,
      direction: 'INGRESS',
      action: 'allow',
      description: 'Identity-Aware Proxy TCP forwarding (documentation range)',
      match: { srcIpRanges: ['203.0.113.192/27'], layer4Configs: [{ ipProtocol: 'tcp', ports: ['22'] }] },
      targetResources: [host.selfLink],
      enableLogging: true,
      ruleTupleCount: 3,
    },
    {
      kind: 'compute#firewallPolicyRule',
      priority: 2147483644,
      direction: 'INGRESS',
      action: 'goto_next',
      match: { srcIpRanges: ['0.0.0.0/0'], layer4Configs: [{ ipProtocol: 'all' }] },
      ruleTupleCount: 2,
    },
  ];
  const name = `fw-policy-${host.env}`;
  addCompute(ctx.b, host.project, {
    kind: 'FirewallPolicy',
    collection: 'firewallPolicies',
    scope: 'global',
    name,
    after: host.createdAt,
    data: {
      description: `Network firewall policy of the ${ENV_DISPLAY[host.env].toLowerCase()} Shared VPC`,
      ruleTupleCount: 9,
      associations: [{ name: `${name}-${host.name}`, attachmentTarget: host.selfLink }],
      rules,
      fingerprint: 'dW1gr3HMmpk=',
    },
  });
}

function emitNetworkAttachment(b: OrgBuilder, host: HostNetwork, attachment: NetworkAttachmentCtx): void {
  const latest = Math.max(
    attachment.subnet.createdAt,
    ...attachment.consumers.map((c) => c.project.createdAt),
  );
  addCompute(b, host.project, {
    kind: 'NetworkAttachment',
    collection: 'networkAttachments',
    scope: { region: attachment.region.name },
    name: attachment.path.slice(attachment.path.lastIndexOf('/') + 1),
    after: latest,
    data: {
      description: 'Private Service Connect interfaces of managed agents and pipelines',
      connectionPreference: 'ACCEPT_MANUAL',
      subnetworks: [attachment.subnet.selfLink],
      network: host.selfLink,
      producerAcceptLists: attachment.consumers.map((c) => c.project.id),
      connectionEndpoints: attachment.consumers.map((consumer) => ({
        status: 'ACCEPTED',
        projectIdOrNum: consumer.project.number,
        subnetwork: attachment.subnet.selfLink,
        ipAddress: consumer.ip,
        subnetworkCidrRange: attachment.subnet.cidr,
      })),
      fingerprint: 'p4H8xzOgu1Q=',
    },
  });
}

/** Production only: the appliance and its routes, IDS, NGFW association, peering zone, Service Directory. */
function addProductionFabric(ctx: OrgContext, fabric: HostFabric, hybrid: HybridLinks): void {
  const { b } = ctx;
  const host = fabric.host;
  const project = host.project;
  const region = host.regions[0];
  if (region === undefined) throw new Error('the host has no region');
  const zone = region.zones[0] ?? `${region.name}-a`;

  // A network virtual appliance (inspection firewall) with two static routes, one over the HA VPN.
  const dmz = addSubnet(b, host, { region, name: `dmz-${region.name}`, prefix: 28 });
  const account = addServiceAccount(b, project, 'nva', 'Network appliances');
  const appliance = addInstance(b, project, {
    zone,
    name: 'nva-inspect-1',
    machineType: 'n2-standard-4',
    nic: { network: host.selfLink, subnetwork: dmz.selfLink, ip: dmz.hosts.next() },
    serviceAccount: account.email,
    tags: ['nva'],
    labels: standardLabels(project, { app: 'inspection' }),
    canIpForward: true,
    after: dmz.createdAt,
  });
  addCompute(b, project, {
    kind: 'Route',
    collection: 'routes',
    scope: 'global',
    name: 'extranet-2-via-nva',
    after: appliance.instance.asset.createdAt,
    data: {
      description: 'Second partner extranet through the inspection appliance',
      network: host.selfLink,
      destRange: '172.25.0.0/16',
      priority: 800,
      tags: ['egress-inspected'],
      nextHopInstance: appliance.instance.selfLink,
    },
  });
  const tunnel = hybrid.tunnels[0];
  if (tunnel !== undefined) {
    addCompute(b, project, {
      kind: 'Route',
      collection: 'routes',
      scope: 'global',
      name: 'onprem-backup-via-vpn',
      after: hybrid.createdAt,
      data: {
        description: 'Static backup route to the data centre if BGP fails',
        network: host.selfLink,
        destRange: '172.16.0.0/16',
        priority: 2000,
        nextHopVpnTunnel: tunnel,
      },
    });
  }

  // Cloud IDS on the production network (its collector forwarding rule lives in a Google tenant project).
  const ids = `projects/${project.id}/locations/${zone}/endpoints/${host.name}-ids`;
  const tenant = `${b.rng.fork(`ids:${host.full}`).hex(14)}-tp`;
  addProjectAsset(b, project, {
    assetType: 'ids.googleapis.com/Endpoint',
    name: fullName('ids.googleapis.com', ids),
    location: zone,
    after: host.psa.createdAt,
    data: {
      name: ids,
      network: host.selfLink,
      endpointForwardingRule: `https://www.googleapis.com/compute/v1/projects/${tenant}/regions/${region.name}/forwardingRules/ids-fr-${host.name}-ids`,
      endpointIp: host.psa.hosts.next(),
      description: 'Threat detection for the production Shared VPC',
      severity: 'MEDIUM',
      state: 'READY',
      trafficLogs: true,
    },
  });

  // Cloud NGFW Enterprise: the association of the organisation's firewall endpoint with this network.
  const endpoint = `${ctx.org.ref}/locations/${zone}/firewallEndpoints/ngfw-${zone}`;
  const association = `projects/${project.id}/locations/${zone}/firewallEndpointAssociations/${host.name}-${zone}`;
  addProjectAsset(b, project, {
    assetType: 'networksecurity.googleapis.com/FirewallEndpointAssociation',
    name: fullName(NETWORK_SECURITY, association),
    location: zone,
    after: host.createdAt,
    data: {
      name: association,
      state: 'ACTIVE',
      reconciling: false,
      disabled: false,
      network: host.path,
      firewallEndpoint: endpoint,
      labels: { team: 'network' },
    },
  });

  // A DNS peering zone that resolves the partner exchange's names in the partner VPC.
  addManagedZone(b, project, 'partner-peering', 'partners.example.org.', {
    description: 'Resolves the partner exchange names through its own VPC',
    visibility: 'private',
    privateVisibilityConfig: {
      kind: 'dns#managedZonePrivateVisibilityConfig',
      networks: [{ kind: 'dns#managedZonePrivateVisibilityConfigNetwork', networkUrl: host.selfLink }],
    },
    peeringConfig: {
      kind: 'dns#managedZonePeeringConfig',
      targetNetwork: {
        kind: 'dns#managedZonePeeringConfigTargetNetwork',
        networkUrl: ctx.partner.networkSelfLink,
      },
    },
  });

  // Service Directory: the internal services of the production network and the DNS zone that serves them.
  const namespace = `projects/${project.id}/locations/${region.name}/namespaces/internal`;
  const namespaceAsset = addProjectAsset(b, project, {
    assetType: 'servicedirectory.googleapis.com/Namespace',
    name: fullName('servicedirectory.googleapis.com', namespace),
    location: region.name,
    after: host.createdAt,
    data: { name: namespace, labels: { team: 'network' }, uid: uuidFrom(b, namespace) },
  });
  addManagedZone(b, project, 'sd-internal', 'svc.internal.example.org.', {
    description: 'Names of the Service Directory namespace "internal"',
    visibility: 'private',
    privateVisibilityConfig: {
      kind: 'dns#managedZonePrivateVisibilityConfig',
      networks: [{ kind: 'dns#managedZonePrivateVisibilityConfigNetwork', networkUrl: host.selfLink }],
    },
    serviceDirectoryConfig: {
      kind: 'dns#managedZoneServiceDirectoryConfig',
      namespace: {
        kind: 'dns#managedZoneServiceDirectoryConfigNamespace',
        namespaceUrl: `https://servicedirectory.googleapis.com/v1/${namespace}`,
      },
    },
  });
  b.defer(() => {
    for (const web of ctx.inventory.web.filter((w) => w.project.env === host.env).slice(0, 1)) {
      const internal = web.internalRule;
      if (internal === undefined) continue;
      // Policy-based route: the storefront subnet's internet egress goes through the internal load balancer.
      const pbr = `projects/${project.number}/locations/global/policyBasedRoutes/pbr-${web.project.team}-egress`;
      const webSubnet = host.subnets.find((s) => s.name === `${web.project.id}-${web.region.name}`);
      if (webSubnet !== undefined) {
        addProjectAsset(b, project, {
          assetType: 'networkconnectivity.googleapis.com/PolicyBasedRoute',
          name: fullName('networkconnectivity.googleapis.com', pbr),
          location: 'global',
          after: Math.max(host.createdAt, web.project.createdAt),
          data: {
            name: pbr,
            description: `Sends the ${web.project.team} storefront subnet's egress through the inspection tier`,
            network: host.path,
            filter: {
              ipProtocol: 'ALL',
              srcRange: webSubnet.cidr,
              destRange: '0.0.0.0/0',
              protocolVersion: 'IPV4',
            },
            priority: 100,
            virtualMachine: { tags: ['egress-inspected'] },
            nextHopIlbIp: internal.ip,
            selfLink: `https://networkconnectivity.googleapis.com/v1/${pbr}`,
            kind: 'networkconnectivity#policyBasedRoute',
          },
        });
      }
      const service = `${namespace}/services/inventory-${web.project.team}`;
      const asset = addProjectAsset(b, project, {
        assetType: 'servicedirectory.googleapis.com/Service',
        name: fullName('servicedirectory.googleapis.com', service),
        location: region.name,
        after: Math.max(namespaceAsset.createdAt, web.project.createdAt),
        data: { name: service, annotations: { protocol: 'grpc' }, uid: uuidFrom(b, service) },
      });
      // The endpoint's network is left out: the API writes projects/<number>/locations/global/networks/<n>,
      // which the catalog's computeRelative normaliser does not map to the network's asset name yet.
      const endpointName = `${service}/endpoints/${web.project.id}-ilb`;
      addProjectAsset(b, project, {
        assetType: 'servicedirectory.googleapis.com/Endpoint',
        name: fullName('servicedirectory.googleapis.com', endpointName),
        location: region.name,
        after: asset.createdAt,
        data: {
          name: endpointName,
          address: internal.ip,
          port: 8443,
          annotations: { zone: web.region.zones[0] ?? web.region.name },
          uid: uuidFrom(b, endpointName),
        },
      });
    }
  });

  // The organisation's public domain is registered with Cloud Domains in the network project.
  const registration = `projects/${project.id}/locations/global/registrations/example.org`;
  addProjectAsset(b, project, {
    assetType: 'domains.googleapis.com/Registration',
    name: fullName('domains.googleapis.com', registration),
    location: 'global',
    after: host.createdAt,
    data: {
      name: registration,
      domainName: 'example.org',
      state: 'ACTIVE',
      expireTime: '2027-03-14T08:00:00Z',
      managementSettings: {
        renewalMethod: 'AUTOMATIC_RENEWAL',
        preferredRenewalMethod: 'AUTOMATIC_RENEWAL',
        transferLockState: 'LOCKED',
        effectiveTransferLockState: 'LOCKED',
      },
      dnsSettings: {
        customDns: {
          nameServers: [
            'ns-cloud-a1.googledomains.com',
            'ns-cloud-a2.googledomains.com',
            'ns-cloud-a3.googledomains.com',
            'ns-cloud-a4.googledomains.com',
          ],
        },
      },
      contactSettings: { privacy: 'REDACTED_CONTACT_DATA' },
      supportedPrivacy: ['REDACTED_CONTACT_DATA', 'PUBLIC_CONTACT_DATA'],
    },
  });
}

/**
 * The organisation's hierarchical firewall policy (attached to the organisation and the Workloads folder) with
 * a Cloud NGFW Enterprise inspection rule, its security profile group and profile, and the zonal firewall
 * endpoint the production network is associated with.
 */
function addOrganisationNetworkSecurity(ctx: OrgContext, host: HostNetwork): void {
  const { b, org } = ctx;
  const PROFILE_GROUP = profileGroupOf(ctx);
  const region = host.regions[0];
  if (region === undefined) throw new Error('the host has no region');
  const zone = region.zones[0] ?? `${region.name}-a`;
  const orgAsset = (assetType: string, name: string, location: string, data: JsonObject): number =>
    b.add({
      assetType,
      name,
      parent: org.full,
      ancestors: org.ancestors,
      location,
      data,
      after: org.createdAt + 900 * DAY_MS,
    }).createdAt;
  const profile = `${org.ref}/locations/global/securityProfiles/threat-default`;
  orgAsset('networksecurity.googleapis.com/SecurityProfile', fullName(NETWORK_SECURITY, profile), 'global', {
    name: profile,
    description: 'Block high and critical threats, alert on medium',
    etag: 'd1e2f3a4',
    type: 'THREAT_PREVENTION',
    threatPreventionProfile: {
      severityOverrides: [
        { severity: 'CRITICAL', action: 'DENY' },
        { severity: 'HIGH', action: 'DENY' },
        { severity: 'MEDIUM', action: 'ALERT' },
      ],
    },
  });
  orgAsset(
    'networksecurity.googleapis.com/SecurityProfileGroup',
    fullName(NETWORK_SECURITY, PROFILE_GROUP),
    'global',
    {
      name: PROFILE_GROUP,
      description: 'Threat prevention for inbound web traffic',
      etag: 'c2c0a1b2',
      dataPathId: '1001',
      threatPreventionProfile: profile,
    },
  );
  const endpoint = `${org.ref}/locations/${zone}/firewallEndpoints/ngfw-${zone}`;
  orgAsset('networksecurity.googleapis.com/FirewallEndpoint', fullName(NETWORK_SECURITY, endpoint), zone, {
    name: endpoint,
    description: `Cloud NGFW Enterprise endpoint for ${zone}`,
    state: 'ACTIVE',
    reconciling: false,
    billingProjectId: host.project.id,
    associatedNetworks: [host.path],
    labels: { team: 'security' },
  });
  const id = `7${b.rng.fork('org-firewall-policy').digits(10)}`;
  orgAsset(
    'compute.googleapis.com/FirewallPolicy',
    `//compute.googleapis.com/locations/global/firewallPolicies/${id}`,
    'global',
    {
      kind: 'compute#firewallPolicy',
      id,
      name: id,
      shortName: 'org-baseline',
      description:
        'Organisation baseline: Cloud NGFW inspection of inbound web traffic, no SSH or RDP from the internet',
      parent: org.ref,
      ruleTupleCount: 14,
      associations: [
        {
          name: 'org-baseline-org',
          attachmentTarget: org.ref,
          firewallPolicyId: id,
          shortName: 'org-baseline',
        },
        {
          name: 'org-baseline-workloads',
          attachmentTarget: ctx.folders.workloads.ref,
          firewallPolicyId: id,
          shortName: 'org-baseline',
        },
      ],
      rules: [
        {
          kind: 'compute#firewallPolicyRule',
          priority: 1000,
          direction: 'INGRESS',
          action: 'apply_security_profile_group',
          description: 'Inspect inbound web traffic to the production network',
          match: { srcIpRanges: ['0.0.0.0/0'], layer4Configs: [{ ipProtocol: 'tcp', ports: ['443'] }] },
          securityProfileGroup: `//${NETWORK_SECURITY}/${PROFILE_GROUP}`,
          tlsInspect: false,
          targetResources: [host.selfLink],
          enableLogging: true,
          ruleTupleCount: 4,
        },
        {
          kind: 'compute#firewallPolicyRule',
          priority: 2000,
          direction: 'INGRESS',
          action: 'deny',
          description: 'No SSH or RDP from the internet',
          match: {
            srcIpRanges: ['0.0.0.0/0'],
            layer4Configs: [{ ipProtocol: 'tcp', ports: ['22', '3389'] }],
          },
          enableLogging: true,
          ruleTupleCount: 4,
        },
        {
          kind: 'compute#firewallPolicyRule',
          priority: 2147483647,
          direction: 'INGRESS',
          action: 'goto_next',
          match: { srcIpRanges: ['0.0.0.0/0'], layer4Configs: [{ ipProtocol: 'all' }] },
          ruleTupleCount: 2,
        },
      ],
      selfLink: `https://www.googleapis.com/compute/v1/locations/global/firewallPolicies/${id}`,
      fingerprint: 'Xr1Fq2m9pLc=',
    },
  );
}

/** A stable UUID for the resource `name` (its `uid` field). */
export function uuidFrom(b: OrgBuilder, name: string): string {
  return uuid(b.rng.fork(`uid:${name}`));
}
