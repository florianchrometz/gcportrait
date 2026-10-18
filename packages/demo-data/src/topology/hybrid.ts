// SPDX-License-Identifier: Apache-2.0
/**
 * Hybrid connectivity of the production host: an HA VPN gateway with two tunnels to an external (on-premises)
 * gateway, and a Dedicated Interconnect with one VLAN attachment. Both terminate BGP sessions on the region's
 * Cloud Router, whose interfaces and peers this template fills in.
 */
import type { OrgBuilder } from '../builder/builder.js';
import { hostAt } from '../core/ip.js';
import { addCompute, computeSelfLink } from './kit.js';
import { addRouter, routerFor, type HostNetwork, type RouterCtx } from './network.js';

const ON_PREM_ASN = 65010;
const INTERCONNECT_ASN = 65020;

/** What the hybrid template built, for the cases that route over it (static routes, NCC spokes). */
export interface HybridLinks {
  readonly router: RouterCtx;
  /** Self-link of the HA VPN gateway. */
  readonly gateway: string;
  /** Self-links of the HA VPN tunnels. */
  readonly tunnels: readonly string[];
  /** Self-link of the Interconnect. */
  readonly interconnect: string;
  /** Self-link of the VLAN attachment. */
  readonly attachment: string;
  readonly createdAt: number;
}

export function addHybridConnectivity(
  b: OrgBuilder,
  host: HostNetwork,
  separateRouter: boolean,
): HybridLinks {
  const region = host.regions[0];
  if (region === undefined) throw new Error('the host has no region');
  const project = host.project;
  const router = separateRouter
    ? addRouter(b, host, region, `cr-${host.env}-${region.name}-hybrid`)
    : routerFor(b, host, region);

  const gateway = addCompute(b, project, {
    kind: 'VpnGateway',
    collection: 'vpnGateways',
    scope: { region: region.name },
    name: `vpn-ha-${region.name}`,
    after: host.createdAt,
    data: {
      network: host.selfLink,
      vpnInterfaces: [
        { id: 0, ipAddress: b.addresses.external.next() },
        { id: 1, ipAddress: b.addresses.external.next() },
      ],
      stackType: 'IPV4_ONLY',
      gatewayIpVersion: 'IPV4',
    },
  });
  const peerIps = [b.addresses.external.next(), b.addresses.external.next()];
  const external = addCompute(b, project, {
    kind: 'ExternalVpnGateway',
    collection: 'externalVpnGateways',
    scope: 'global',
    name: 'onprem-dc1',
    after: host.createdAt,
    data: {
      description: 'Edge routers of the primary data centre',
      redundancyType: 'TWO_IPS_REDUNDANCY',
      interfaces: peerIps.map((ipAddress, id) => ({ id, ipAddress })),
      labelFingerprint: '42WmSpB8rSM=',
    },
  });
  const tunnels: string[] = [];
  let latest = Math.max(gateway.asset.createdAt, external.asset.createdAt);
  peerIps.forEach((peerIp, index) => {
    const tunnelName = `tunnel-onprem-dc1-${String(index)}`;
    const tunnel = addCompute(b, project, {
      kind: 'VpnTunnel',
      collection: 'vpnTunnels',
      scope: { region: region.name },
      name: tunnelName,
      after: Math.max(gateway.asset.createdAt, external.asset.createdAt),
      data: {
        description: `HA VPN tunnel ${String(index)} to the primary data centre`,
        vpnGateway: gateway.selfLink,
        vpnGatewayInterface: index,
        peerExternalGateway: external.selfLink,
        peerExternalGatewayInterface: index,
        peerIp,
        router: router.selfLink,
        ikeVersion: 2,
        status: 'ESTABLISHED',
        detailedStatus: 'Tunnel is up and running.',
        localTrafficSelector: ['0.0.0.0/0'],
        remoteTrafficSelector: ['0.0.0.0/0'],
        labelFingerprint: '42WmSpB8rSM=',
      },
    });
    tunnels.push(tunnel.selfLink);
    latest = Math.max(latest, tunnel.asset.createdAt);
    const session = b.addresses.bgp.allocate(30);
    router.interfaces.push({
      name: `if-${tunnelName}`,
      linkedVpnTunnel: tunnel.selfLink,
      ipRange: `${hostAt(session, 1)}/30`,
    });
    router.bgpPeers.push({
      name: `peer-${tunnelName}`,
      interfaceName: `if-${tunnelName}`,
      ipAddress: hostAt(session, 1),
      peerIpAddress: hostAt(session, 2),
      peerAsn: ON_PREM_ASN,
      advertisedRoutePriority: 100,
      enable: 'TRUE',
      managementType: 'MANAGED_BY_USER',
    });
  });

  const interconnect = addCompute(b, project, {
    kind: 'Interconnect',
    collection: 'interconnects',
    scope: 'global',
    name: 'ic-dc1-1',
    after: host.createdAt,
    data: {
      description: 'Dedicated Interconnect to the primary data centre',
      location: computeSelfLink(project.id, 'global/interconnectLocations/fra-zone1-2'),
      linkType: 'LINK_TYPE_ETHERNET_10G_LR',
      interconnectType: 'DEDICATED',
      requestedLinkCount: 1,
      provisionedLinkCount: 1,
      adminEnabled: true,
      operationalStatus: 'OS_ACTIVE',
      state: 'ACTIVE',
      customerName: 'Example Org',
      nocContactEmail: 'network-oncall@example.com',
    },
  });
  const vlan = b.addresses.bgp.allocate(29);
  const attachment = addCompute(b, project, {
    kind: 'InterconnectAttachment',
    collection: 'interconnectAttachments',
    scope: { region: region.name },
    name: `ica-dc1-${region.name}-1`,
    after: interconnect.asset.createdAt,
    data: {
      description: 'VLAN attachment on ic-dc1-1',
      type: 'DEDICATED',
      interconnect: interconnect.selfLink,
      router: router.selfLink,
      vlanTag8021q: 1001,
      bandwidth: 'BPS_10G',
      cloudRouterIpAddress: `${hostAt(vlan, 1)}/29`,
      customerRouterIpAddress: `${hostAt(vlan, 2)}/29`,
      edgeAvailabilityDomain: 'AVAILABILITY_DOMAIN_1',
      adminEnabled: true,
      state: 'ACTIVE',
      operationalStatus: 'OS_ACTIVE',
      mtu: 1440,
      stackType: 'IPV4_ONLY',
      encryption: 'NONE',
    },
  });
  router.interfaces.push({
    name: 'if-ica-dc1-1',
    linkedInterconnectAttachment: attachment.selfLink,
    ipRange: `${hostAt(vlan, 1)}/29`,
  });
  router.bgpPeers.push({
    name: 'peer-ica-dc1-1',
    interfaceName: 'if-ica-dc1-1',
    ipAddress: hostAt(vlan, 1),
    peerIpAddress: hostAt(vlan, 2),
    peerAsn: INTERCONNECT_ASN,
    advertisedRoutePriority: 100,
    enable: 'TRUE',
    managementType: 'MANAGED_BY_USER',
  });
  return {
    router,
    gateway: gateway.selfLink,
    tunnels,
    interconnect: interconnect.selfLink,
    attachment: attachment.selfLink,
    createdAt: Math.max(latest, attachment.asset.createdAt),
  };
}
