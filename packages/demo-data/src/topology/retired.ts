// SPDX-License-Identifier: Apache-2.0
/**
 * A standalone reporting project that is shut down during the history window: the "project deletion" event
 * removes every asset in it and moves the project to `DELETE_REQUESTED`, the state Resource Manager keeps a
 * deleted project in for 30 days.
 */
import type { OrgBuilder } from '../builder/builder.js';
import { HostPool, hostAt } from '../core/ip.js';
import { setPath } from '../core/json.js';
import { addInstance } from './compute.js';
import {
  addCompute,
  addProject,
  addServiceAccount,
  computeSelfLink,
  standardLabels,
  type ContainerCtx,
} from './kit.js';
import { addBucket } from './storage.js';
import { MACHINE_TYPES, type Region } from './vocabulary.js';

export function addRetiredProject(
  b: OrgBuilder,
  folder: ContainerCtx,
  region: Region,
  instances: number,
): void {
  const project = addProject(b, folder, {
    role: 'reports',
    displayName: 'Reporting (decommissioned)',
    env: 'prod',
    region,
    team: 'analytics',
    traits: { pinned: true },
  });
  const pinned = { pinned: true } as const;
  const children: string[] = [];
  const networkName = 'vpc-reports';
  const networkSelfLink = computeSelfLink(project.id, `global/networks/${networkName}`);
  const subnetName = `reports-${region.name}`;
  const subnetSelfLink = computeSelfLink(project.id, `regions/${region.name}/subnetworks/${subnetName}`);
  const cidr = b.addresses.standalone.allocate(22);
  const network = addCompute(b, project, {
    kind: 'Network',
    collection: 'networks',
    scope: 'global',
    name: networkName,
    data: {
      autoCreateSubnetworks: false,
      routingConfig: { routingMode: 'REGIONAL', bgpBestPathSelectionMode: 'LEGACY' },
      mtu: 1460,
      subnetworks: [subnetSelfLink],
      peerings: [],
    },
    traits: pinned,
  });
  children.push(network.asset.name);
  const subnet = addCompute(b, project, {
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
    traits: pinned,
  });
  children.push(subnet.asset.name);
  const account = addServiceAccount(b, project, 'report-runner', 'Nightly report runner');
  children.push(account.asset.name);
  const hosts = new HostPool(cidr, 2);
  for (let i = 1; i <= instances; i++) {
    const vm = addInstance(b, project, {
      zone: region.zones[0] ?? `${region.name}-a`,
      name: `report-vm-${String(i)}`,
      machineType: MACHINE_TYPES.api,
      nic: { network: networkSelfLink, subnetwork: subnetSelfLink, ip: hosts.next() },
      serviceAccount: account.email,
      labels: standardLabels(project),
      after: subnet.asset.createdAt,
      traits: pinned,
    });
    children.push(vm.instance.asset.name, vm.disk.asset.name);
  }
  const bucket = addBucket(b, project, {
    name: `${project.id}-reports`,
    region,
    labels: standardLabels(project),
    traits: pinned,
  });
  children.push(bucket.name);

  b.specials.push({
    id: 'project-deletion',
    plan: () => ({
      adds: [],
      removes: children,
      changes: [
        {
          name: project.full,
          fields: ['lifecycleState'],
          forward: (data) => setPath(data, ['lifecycleState'], 'DELETE_REQUESTED'),
        },
      ],
    }),
  });
}
