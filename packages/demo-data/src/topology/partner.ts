// SPDX-License-Identifier: MIT
/**
 * A standalone project with its own VPC (a partner exchange) that the history peers with the production
 * Shared VPC: the "peering added" event appends a peering entry to both networks.
 */
import type { OrgBuilder } from '../builder/builder.js';
import { hostAt } from '../core/ip.js';
import { HostPool } from '../core/ip.js';
import type { JsonObject } from '../core/json.js';
import { addInstance } from './compute.js';
import type { PartnerNetwork } from './context.js';
import {
  addCompute,
  addProject,
  computeSelfLink,
  defaultComputeServiceAccount,
  standardLabels,
  type ContainerCtx,
} from './kit.js';
import type { HostNetwork } from './network.js';
import { MACHINE_TYPES } from './vocabulary.js';

export interface PartnerOptions {
  readonly instances: number;
  readonly firewall: boolean;
}

function peering(name: string, network: string): JsonObject {
  return {
    name,
    network,
    state: 'ACTIVE',
    stateDetails: '[2081] ACTIVE',
    autoCreateRoutes: true,
    exchangeSubnetRoutes: true,
    exportCustomRoutes: true,
    importCustomRoutes: false,
    exportSubnetRoutesWithPublicIp: false,
    importSubnetRoutesWithPublicIp: false,
    stackType: 'IPV4_ONLY',
  };
}

export function addPartnerNetwork(
  b: OrgBuilder,
  folder: ContainerCtx,
  host: HostNetwork,
  options: PartnerOptions,
): PartnerNetwork {
  const region = host.regions[0];
  if (region === undefined) throw new Error('the host has no region');
  const project = addProject(b, folder, {
    role: 'partner',
    displayName: 'Partner exchange',
    env: 'prod',
    region,
    team: 'network',
  });
  const networkName = 'vpc-partner';
  const networkSelfLink = computeSelfLink(project.id, `global/networks/${networkName}`);
  const subnetName = `partner-${region.name}`;
  const cidr = b.addresses.standalone.allocate(20);
  const subnetSelfLink = computeSelfLink(project.id, `regions/${region.name}/subnetworks/${subnetName}`);
  const network = addCompute(b, project, {
    kind: 'Network',
    collection: 'networks',
    scope: 'global',
    name: networkName,
    data: {
      description: 'Exchange network shared with logistics partners',
      autoCreateSubnetworks: false,
      routingConfig: { routingMode: 'REGIONAL', bgpBestPathSelectionMode: 'LEGACY' },
      mtu: 1460,
      networkFirewallPolicyEnforcementOrder: 'AFTER_CLASSIC_FIREWALL',
      subnetworks: [subnetSelfLink],
      peerings: [],
    },
    traits: { pinned: true },
  });
  addCompute(b, project, {
    kind: 'Subnetwork',
    collection: 'subnetworks',
    scope: { region: region.name },
    name: subnetName,
    after: network.asset.createdAt,
    data: {
      network: networkSelfLink,
      ipCidrRange: cidr,
      gatewayAddress: hostAt(cidr, 1),
      secondaryIpRanges: [],
      privateIpGoogleAccess: false,
      purpose: 'PRIVATE',
      stackType: 'IPV4_ONLY',
    },
  });
  addCompute(b, project, {
    kind: 'Route',
    collection: 'routes',
    scope: 'global',
    name: `default-route-${b.rng.fork(`route:${networkSelfLink}`).hex(16)}`,
    after: network.asset.createdAt,
    data: {
      description: 'Default route to the Internet.',
      network: networkSelfLink,
      destRange: '0.0.0.0/0',
      priority: 1000,
      nextHopGateway: computeSelfLink(project.id, 'global/gateways/default-internet-gateway'),
    },
  });
  if (options.firewall) {
    addCompute(b, project, {
      kind: 'Firewall',
      collection: 'firewalls',
      scope: 'global',
      name: 'allow-https-from-shared-vpc',
      after: network.asset.createdAt,
      data: {
        network: networkSelfLink,
        priority: 1000,
        direction: 'INGRESS',
        disabled: false,
        sourceRanges: ['10.0.0.0/10'],
        allowed: [{ IPProtocol: 'tcp', ports: ['443'] }],
        logConfig: { enable: false },
      },
    });
  }
  const hosts = new HostPool(cidr, 2);
  for (let i = 1; i <= options.instances; i++) {
    addInstance(b, project, {
      zone: region.zones[0] ?? `${region.name}-a`,
      name: `partner-gw-${String(i)}`,
      machineType: MACHINE_TYPES.partner,
      // The first gateway terminates partner traffic on a public address.
      nic: {
        network: networkSelfLink,
        subnetwork: subnetSelfLink,
        ip: hosts.next(),
        ...(i === 1 ? { natIp: b.addresses.external.next() } : {}),
      },
      serviceAccount: defaultComputeServiceAccount(project),
      tags: ['partner-gw'],
      labels: standardLabels(project),
      after: network.asset.createdAt,
    });
  }

  b.specials.push({
    id: 'peering-added',
    plan: () => ({
      adds: [],
      removes: [],
      changes: [
        {
          name: host.full,
          fields: ['peerings'],
          forward: (data) => ({
            ...data,
            peerings: [...asArray(data['peerings']), peering('peer-partner', networkSelfLink)],
          }),
        },
        {
          name: network.asset.name,
          fields: ['peerings'],
          forward: (data) => ({
            ...data,
            peerings: [...asArray(data['peerings']), peering(`peer-shared-${host.env}`, host.selfLink)],
          }),
        },
      ],
    }),
  });
  return {
    project,
    region,
    networkSelfLink,
    subnetSelfLink,
    hosts,
    createdAt: network.asset.createdAt,
  };
}

function asArray(value: JsonObject[string] | undefined): JsonObject[string][] {
  return Array.isArray(value) ? value : [];
}
