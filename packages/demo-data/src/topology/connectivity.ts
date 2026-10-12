// SPDX-License-Identifier: MIT
/**
 * Hybrid connectivity beyond the HA VPN and the Dedicated Interconnect of `hybrid.ts`:
 *
 * - feature `ncc`: a Network Connectivity Center hub in the production host with its default group and route
 *   table, a VPC spoke per Shared VPC host network (each in its host project), a VPN spoke for the HA VPN
 *   tunnels, an Interconnect spoke for the VLAN attachment, and a few of the routes the hub learned (hidden);
 * - feature `large`: a Classic VPN to a branch office (target VPN gateway, its three forwarding rules, a tunnel
 *   and the static route over it), a Partner Interconnect VLAN attachment, and HA VPN between the production
 *   and the second host network (each side's gateway, two tunnels per side, BGP on both Cloud Routers).
 */
import { hostAt } from '../core/ip.js';
import type { JsonObject } from '../core/json.js';
import { prodHost, type OrgContext } from './context.js';
import { uuidFrom } from './fabric.js';
import type { HybridLinks } from './hybrid.js';
import { addCompute, addProjectAsset, computeSelfLink, fullName } from './kit.js';
import { addRouter, routerFor, type HostNetwork } from './network.js';

const NCC = 'networkconnectivity.googleapis.com';

export function addNetworkConnectivityCenter(ctx: OrgContext, hybrid: HybridLinks): void {
  const { b } = ctx;
  const host = prodHost(ctx);
  const project = host.project;
  const region = host.regions[0];
  if (region === undefined) throw new Error('the host has no region');
  const hubPath = `projects/${project.number}/locations/global/hubs/hub-${host.env}`;
  const groupPath = `${hubPath}/groups/default`;
  const tablePath = `${hubPath}/routeTables/default`;
  const hosts = [...ctx.hosts.values()];
  const hub = addProjectAsset(b, project, {
    assetType: `${NCC}/Hub`,
    name: fullName(NCC, hubPath),
    location: 'global',
    after: Math.max(hybrid.createdAt, ...hosts.map((h) => h.createdAt)),
    data: {
      name: hubPath,
      description: 'Connects the Shared VPC networks and the data-centre links',
      labels: { env: host.env },
      uniqueId: uuidFrom(b, hubPath),
      state: 'ACTIVE',
      routingVpcs: hosts.map((h) => ({ uri: h.selfLink })),
      routeTables: [tablePath],
      spokeSummary: {
        spokeTypeCounts: [
          { spokeType: 'VPC_NETWORK', count: String(hosts.length) },
          { spokeType: 'VPN_TUNNEL', count: '1' },
          { spokeType: 'INTERCONNECT_ATTACHMENT', count: '1' },
        ],
        spokeStateCounts: [{ state: 'ACTIVE', count: String(hosts.length + 2) }],
      },
      policyMode: 'PRESET',
      presetTopology: 'MESH',
      exportPsc: false,
    },
  });
  for (const [kind, path, description] of [
    ['Group', groupPath, "The hub's default spoke group"],
    ['RouteTable', tablePath, "The hub's default route table"],
  ] as const) {
    addProjectAsset(b, project, {
      assetType: `${NCC}/${kind}`,
      name: fullName(NCC, path),
      location: 'global',
      after: hub.createdAt,
      data: {
        name: path,
        description,
        uid: uuidFrom(b, path),
        state: 'ACTIVE',
        ...(kind === 'Group'
          ? { autoAccept: { autoAcceptProjects: hosts.map((h) => h.project.id) }, routeTable: tablePath }
          : {}),
      },
    });
  }
  const spoke = (
    owner: HostNetwork,
    location: string,
    name: string,
    description: string,
    links: JsonObject,
  ): string => {
    const path = `projects/${owner.project.number}/locations/${location}/spokes/${name}`;
    addProjectAsset(b, owner.project, {
      assetType: `${NCC}/Spoke`,
      name: fullName(NCC, path),
      location,
      after: hub.createdAt,
      data: {
        name: path,
        description,
        uniqueId: uuidFrom(b, path),
        state: 'ACTIVE',
        hub: hubPath,
        group: groupPath,
        ...links,
      },
    });
    return path;
  };
  const vpcSpokes = hosts.map((h) =>
    spoke(h, 'global', `vpc-${h.env}`, `The ${h.env} Shared VPC`, {
      spokeType: 'VPC_NETWORK',
      linkedVpcNetwork: { uri: h.selfLink, excludeExportRanges: [] },
    }),
  );
  const vpnSpoke = spoke(host, region.name, 'vpn-dc1', 'HA VPN to the primary data centre', {
    spokeType: 'VPN_TUNNEL',
    linkedVpnTunnels: { uris: [...hybrid.tunnels], siteToSiteDataTransfer: true, vpcNetwork: host.selfLink },
  });
  spoke(host, region.name, 'ic-dc1', 'Dedicated Interconnect to the primary data centre', {
    spokeType: 'INTERCONNECT_ATTACHMENT',
    linkedInterconnectAttachments: {
      uris: [hybrid.attachment],
      siteToSiteDataTransfer: true,
      vpcNetwork: host.selfLink,
    },
  });
  // A few of the routes the hub learned: start hidden, counted on the hub.
  const learned: readonly [string, string, string, JsonObject][] = [
    [
      'VPC_PRIMARY_SUBNET',
      host.subnets[0]?.cidr ?? '10.0.0.0/22',
      vpcSpokes[0] ?? vpnSpoke,
      {
        nextHopVpcNetwork: { uri: host.selfLink },
      },
    ],
    [
      'DYNAMIC_ROUTE',
      '172.16.0.0/16',
      vpnSpoke,
      {
        nextHopVpnTunnel: {
          uri: hybrid.tunnels[0] ?? '',
          vpcNetwork: host.selfLink,
          siteToSiteDataTransfer: true,
        },
      },
    ],
  ];
  learned.forEach(([type, range, spokePath, nextHop], index) => {
    const path = `${tablePath}/routes/r-${String(index + 1).padStart(2, '0')}`;
    addProjectAsset(b, project, {
      assetType: `${NCC}/HubRoute`,
      name: fullName(NCC, path),
      location: 'global',
      after: hub.createdAt,
      data: {
        name: path,
        ipCidrRange: range,
        type,
        uid: uuidFrom(b, path),
        state: 'ACTIVE',
        spoke: spokePath,
        location: `projects/${project.number}/locations/${region.name}`,
        priority: '100',
        ...nextHop,
      },
    });
  });
}

/** Classic VPN, Partner Interconnect and HA VPN between two host networks (three environments only). */
export function addLargeHybrid(ctx: OrgContext, hybrid: HybridLinks): void {
  const { b } = ctx;
  const host = prodHost(ctx);
  const project = host.project;
  const region = host.regions[1] ?? host.regions[0];
  if (region === undefined) throw new Error('the host has no region');

  // Classic VPN (static routing) to a branch office: an external address, the target gateway, the three
  // forwarding rules that carry ESP and IKE, the tunnel and the route over it.
  const gatewayName = `vpn-classic-${region.name}`;
  const gatewayLink = computeSelfLink(project.id, `regions/${region.name}/targetVpnGateways/${gatewayName}`);
  const ip = b.addresses.external.next();
  const rules = [
    ['esp', 'ESP', undefined],
    ['udp500', 'UDP', '500-500'],
    ['udp4500', 'UDP', '4500-4500'],
  ] as const;
  const ruleLinks = rules.map(([suffix]) =>
    computeSelfLink(project.id, `regions/${region.name}/forwardingRules/vpn-classic-${suffix}`),
  );
  const tunnelName = 'tunnel-branch-1';
  const tunnelLink = computeSelfLink(project.id, `regions/${region.name}/vpnTunnels/${tunnelName}`);
  const address = addCompute(b, project, {
    kind: 'Address',
    collection: 'addresses',
    scope: { region: region.name },
    name: 'vpn-classic-ip',
    after: host.createdAt,
    data: {
      description: 'Public address of the Classic VPN gateway',
      address: ip,
      status: 'IN_USE',
      addressType: 'EXTERNAL',
      networkTier: 'PREMIUM',
      users: ruleLinks,
      labelFingerprint: '42WmSpB8rSM=',
    },
  });
  const gateway = addCompute(b, project, {
    kind: 'TargetVpnGateway',
    collection: 'targetVpnGateways',
    scope: { region: region.name },
    name: gatewayName,
    after: address.asset.createdAt,
    data: {
      description: 'Classic VPN to the branch office (static routing)',
      network: host.selfLink,
      status: 'READY',
      tunnels: [tunnelLink],
      forwardingRules: ruleLinks,
      labelFingerprint: '42WmSpB8rSM=',
    },
  });
  for (const [suffix, protocol, ports] of rules) {
    addCompute(b, project, {
      kind: 'ForwardingRule',
      collection: 'forwardingRules',
      scope: { region: region.name },
      name: `vpn-classic-${suffix}`,
      after: gateway.asset.createdAt,
      data: {
        IPAddress: ip,
        IPProtocol: protocol,
        ...(ports === undefined ? {} : { portRange: ports }),
        target: gatewayLink,
        loadBalancingScheme: 'EXTERNAL',
        networkTier: 'PREMIUM',
        labelFingerprint: '42WmSpB8rSM=',
        fingerprint: 'Vt7wXr0nC2s=',
      },
    });
  }
  const tunnel = addCompute(b, project, {
    kind: 'VpnTunnel',
    collection: 'vpnTunnels',
    scope: { region: region.name },
    name: tunnelName,
    after: gateway.asset.createdAt,
    data: {
      description: 'Classic VPN tunnel to the branch office',
      targetVpnGateway: gatewayLink,
      peerIp: b.addresses.external.next(),
      ikeVersion: 2,
      status: 'ESTABLISHED',
      detailedStatus: 'Tunnel is up and running.',
      localTrafficSelector: ['10.0.0.0/10'],
      remoteTrafficSelector: ['172.30.0.0/16'],
      labelFingerprint: '42WmSpB8rSM=',
    },
  });
  addCompute(b, project, {
    kind: 'Route',
    collection: 'routes',
    scope: 'global',
    name: 'branch-office-via-classic-vpn',
    after: tunnel.asset.createdAt,
    data: {
      description: 'The branch office behind the Classic VPN',
      network: host.selfLink,
      destRange: '172.30.0.0/16',
      priority: 1000,
      nextHopVpnTunnel: tunnel.selfLink,
    },
  });

  // Partner Interconnect: a VLAN attachment through a service provider, BGP on the region's Cloud Router.
  const router = routerFor(b, host, region);
  const vlan = b.addresses.bgp.allocate(29);
  const partner = addCompute(b, project, {
    kind: 'InterconnectAttachment',
    collection: 'interconnectAttachments',
    scope: { region: region.name },
    name: `ica-partner-${region.name}`,
    after: router.createdAt,
    data: {
      description: 'Partner Interconnect to the second data centre',
      type: 'PARTNER',
      router: router.selfLink,
      edgeAvailabilityDomain: 'AVAILABILITY_DOMAIN_1',
      pairingKey: `${b.rng.fork('pairing-key').hex(8)}-0000-4000-8000-${b.rng.fork('pairing-key/2').hex(12)}/${region.name}/1`,
      partnerMetadata: {
        partnerName: 'Example Carrier',
        interconnectName: 'Example Carrier Fabric',
        portalUrl: 'https://portal.example.net',
      },
      partnerAsn: '64700',
      bandwidth: 'BPS_1G',
      cloudRouterIpAddress: `${hostAt(vlan, 1)}/29`,
      customerRouterIpAddress: `${hostAt(vlan, 2)}/29`,
      adminEnabled: true,
      state: 'ACTIVE',
      operationalStatus: 'OS_ACTIVE',
      mtu: 1440,
      stackType: 'IPV4_ONLY',
      encryption: 'NONE',
    },
  });
  router.interfaces.push({
    name: 'if-ica-partner-1',
    linkedInterconnectAttachment: partner.selfLink,
    ipRange: `${hostAt(vlan, 1)}/29`,
  });
  router.bgpPeers.push({
    name: 'peer-ica-partner-1',
    interfaceName: 'if-ica-partner-1',
    ipAddress: hostAt(vlan, 1),
    peerIpAddress: hostAt(vlan, 2),
    peerAsn: 64700,
    advertisedRoutePriority: 100,
    enable: 'TRUE',
    managementType: 'MANAGED_BY_USER',
  });

  // HA VPN between the production and the second host network (no peering between Shared VPCs).
  const other = [...ctx.hosts.values()].find((h) => h !== host);
  if (other === undefined) return;
  const otherRegion = other.regions[0];
  if (otherRegion === undefined) throw new Error('the host has no region');
  const otherRouter = addRouter(b, other, otherRegion, `cr-${other.env}-${otherRegion.name}-vpn`);
  const otherGateway = addCompute(b, other.project, {
    kind: 'VpnGateway',
    collection: 'vpnGateways',
    scope: { region: otherRegion.name },
    name: `vpn-ha-${otherRegion.name}`,
    after: other.createdAt,
    data: {
      network: other.selfLink,
      vpnInterfaces: [
        { id: 0, ipAddress: b.addresses.external.next() },
        { id: 1, ipAddress: b.addresses.external.next() },
      ],
      stackType: 'IPV4_ONLY',
      gatewayIpVersion: 'IPV4',
    },
  });
  const sides = [
    { net: host, gateway: hybrid.gateway, peer: otherGateway.selfLink, router: hybrid.router },
    { net: other, gateway: otherGateway.selfLink, peer: hybrid.gateway, router: otherRouter },
  ];
  const sessions = [b.addresses.bgp.allocate(30), b.addresses.bgp.allocate(30)];
  sides.forEach((side, s) => {
    const target = sides[1 - s];
    if (target === undefined) return;
    for (let i = 0; i < 2; i++) {
      const name = `tunnel-to-${target.net.env}-${String(i)}`;
      const sideRegion = /\/regions\/([^/]+)\//.exec(side.gateway)?.[1] ?? region.name;
      const link = addCompute(b, side.net.project, {
        kind: 'VpnTunnel',
        collection: 'vpnTunnels',
        scope: { region: sideRegion },
        name,
        after: Math.max(otherGateway.asset.createdAt, hybrid.createdAt),
        data: {
          description: `HA VPN tunnel ${String(i)} to the ${target.net.env} Shared VPC`,
          vpnGateway: side.gateway,
          vpnGatewayInterface: i,
          peerGcpGateway: side.peer,
          router: side.router.selfLink,
          ikeVersion: 2,
          status: 'ESTABLISHED',
          detailedStatus: 'Tunnel is up and running.',
          localTrafficSelector: ['0.0.0.0/0'],
          remoteTrafficSelector: ['0.0.0.0/0'],
          labelFingerprint: '42WmSpB8rSM=',
        },
      }).selfLink;
      const session = sessions[i] ?? '169.254.255.0/30';
      side.router.interfaces.push({
        name: `if-${name}`,
        linkedVpnTunnel: link,
        ipRange: `${hostAt(session, 1 + s)}/30`,
      });
      side.router.bgpPeers.push({
        name: `peer-${name}`,
        interfaceName: `if-${name}`,
        ipAddress: hostAt(session, 1 + s),
        peerIpAddress: hostAt(session, 2 - s),
        peerAsn: target.router.asn,
        advertisedRoutePriority: 100,
        enable: 'TRUE',
        managementType: 'MANAGED_BY_USER',
      });
    }
  });
}
