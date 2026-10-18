// SPDX-License-Identifier: Apache-2.0
/**
 * A plain virtual-machine workload in a Shared VPC service project: standalone VMs on a host subnet with
 * CMEK boot disks; the organisation's first one also gets a bastion with an external address. Test VMs come
 * and go during the history window. With the `compute` cases, in production, the last VM is stopped, the disks
 * follow a daily snapshot schedule (with a manual snapshot and the scheduled ones), the project reserves
 * capacity under a commitment, and the first production VM project runs Google Cloud VMware Engine.
 */
import { addInstance, makeInstance } from './compute.js';
import { hostFor, type OrgContext } from './context.js';
import { has } from './features.js';
import { addProject, addServiceAccount, standardLabels, type ContainerCtx, type ProjectCtx } from './kit.js';
import {
  addReservation,
  addSnapshotSchedule,
  addSnapshots,
  addVmwareEngine,
  type SnapshotSource,
} from './machines.js';
import { addSubnet } from './network.js';
import { MACHINE_TYPES, type Env, type Region } from './vocabulary.js';
import { title } from './web.js';

export interface VmProfile {
  readonly instances: number;
}

export function addVmProject(
  ctx: OrgContext,
  folder: ContainerCtx,
  team: string,
  env: Env,
  region: Region,
): ProjectCtx {
  const { b, profile } = ctx;
  const host = hostFor(ctx, env);
  const project = addProject(b, folder, {
    role: 'vm',
    displayName: `${title(team)} batch VMs (${env})`,
    env,
    region,
    team,
  });
  // Schedules, snapshots and reservations in production only (they would dominate the larger sizes).
  const extras = has(profile, 'compute') && env === 'prod';
  const subnet = addSubnet(b, host, { region, name: `${project.id}-${region.name}`, prefix: 24 });
  const account = addServiceAccount(b, project, 'batch-vm', 'Batch VMs');
  const kmsKeyVersion = ctx.keys.keyVersion(region.name, 'compute');
  const labels = standardLabels(project, { app: 'batch' });
  const zones = region.zones;
  const schedule = extras ? addSnapshotSchedule(b, project, region) : undefined;
  const instances: string[] = [];
  const sources: SnapshotSource[] = [];
  const count = profile.vm.instances;
  for (let i = 1; i <= count; i++) {
    const zone = zones[i % zones.length] ?? `${region.name}-a`;
    const name = `batch-${String(i).padStart(2, '0')}`;
    const stopped = i % 7 === 0 || (extras && count > 1 && i === count);
    const vm = addInstance(b, project, {
      zone,
      name,
      machineType: MACHINE_TYPES.vm,
      nic: { network: host.selfLink, subnetwork: subnet.selfLink, ip: subnet.hosts.next() },
      serviceAccount: account.email,
      tags: ['batch'],
      labels,
      diskSizeGb: 50,
      ...(kmsKeyVersion === undefined ? {} : { kmsKeyVersion }),
      ...(stopped ? { status: 'TERMINATED' as const } : {}),
      ...(schedule === undefined ? {} : { resourcePolicies: [schedule] }),
    });
    instances.push(vm.instance.path);
    sources.push({ zone, disk: name, sizeGb: 50, createdAt: vm.disk.asset.createdAt });
  }
  if (ctx.once('bastion')) {
    addInstance(b, project, {
      zone: zones[0] ?? `${region.name}-a`,
      name: 'bastion',
      machineType: 'e2-micro',
      nic: {
        network: host.selfLink,
        subnetwork: subnet.selfLink,
        ip: subnet.hosts.next(),
        natIp: b.addresses.external.next(),
      },
      serviceAccount: account.email,
      tags: ['bastion'],
      labels: { ...labels, app: 'bastion' },
      metadata: [{ key: 'enable-oslogin', value: 'TRUE' }],
      ...(extras ? { hostname: 'bastion.corp.example.com' } : {}),
    });
  }
  if (schedule !== undefined) {
    addSnapshots(b, project, region, sources.slice(0, 1), schedule, kmsKeyVersion);
    addReservation(b, project, region, zones[0] ?? `${region.name}-a`, MACHINE_TYPES.vm, Math.max(2, count));
    if (ctx.once('vmware-engine')) addVmwareEngine(ctx, project, region, host);
  }
  b.ephemerals.push({
    kind: 'test-vm',
    weight: 2,
    notBefore: subnet.createdAt,
    make: (createdAt, serial) =>
      makeInstance(
        b,
        project,
        {
          zone: zones[0] ?? `${region.name}-a`,
          name: `test-vm-${String(serial)}`,
          machineType: MACHINE_TYPES.api,
          nic: { network: host.selfLink, subnetwork: subnet.selfLink, ip: subnet.hosts.next() },
          serviceAccount: account.email,
          labels: { ...labels, purpose: 'testing' },
        },
        createdAt,
      ),
  });
  ctx.inventory.vms.push({ project, instances });
  return project;
}
