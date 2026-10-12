// SPDX-License-Identifier: MIT
/**
 * A small synthetic organisation and catalog that exercise every containment decision of skill
 * gcp-diagram-layout §2: a Shared VPC host and a service project, a local VPC, instances with one subnet,
 * only a network, two subnets and a subnet in the host, a disk, a service account, a Serverless VPC Access
 * connector, a Cloud Run service, a type the catalog does not map, and test containers whose rules can be
 * made to disagree. Not part of the public API.
 */
import { GraphBuildSchema, type Asset, type Catalog, type GraphBuild } from '@gcportrait/model';
import { buildGraphWithReport, type BuildOptions } from '../build.js';
import {
  catalogWith,
  computeName,
  folder,
  network,
  organization,
  project,
  resource,
  selfLink,
  subnetwork,
} from './fixtures.js';

export const HOST_NUMBER = '10000000001';
export const HOST_ID = 'demo-net-1';
export const WEB_NUMBER = '10000000002';
export const WEB_ID = 'demo-web-1';

export const SHARED_VPC = computeName(HOST_ID, 'global/networks/vpc-shared');
export const HOST_SUBNET = computeName(HOST_ID, 'regions/europe-west3/subnetworks/web');
export const LOCAL_VPC = computeName(WEB_ID, 'global/networks/vpc-local');
export const LOCAL_SUBNET = computeName(WEB_ID, 'regions/europe-west3/subnetworks/local');
export const LOCAL_SUBNET_B = computeName(WEB_ID, 'regions/europe-west3/subnetworks/local-b');

export const ON_HOST = computeName(WEB_ID, 'zones/europe-west3-a/instances/on-host');
export const ON_SUBNET = computeName(WEB_ID, 'zones/europe-west3-a/instances/on-subnet');
export const ON_NETWORK = computeName(WEB_ID, 'zones/europe-west3-b/instances/on-network');
export const TWO_NICS = computeName(WEB_ID, 'zones/europe-west3-a/instances/two-nics');
export const DISK = computeName(WEB_ID, 'zones/europe-west3-a/disks/on-subnet');
export const SERVICE_ACCOUNT = `//iam.googleapis.com/projects/${WEB_ID}/serviceAccounts/104000000000000000001`;
export const SA_EMAIL = `web-frontend@${WEB_ID}.iam.gserviceaccount.com`;
export const CONNECTOR = `//vpcaccess.googleapis.com/projects/${HOST_ID}/locations/europe-west3/connectors/conn`;
export const RUN_SERVICE = `//run.googleapis.com/projects/${WEB_ID}/locations/europe-west3/services/api`;
export const GADGET = `//gadgets.googleapis.com/projects/${WEB_ID}/locations/global/gadgets/g1`;
export const PROJECT_HOST = `//cloudresourcemanager.googleapis.com/projects/${HOST_NUMBER}`;
export const PROJECT_WEB = `//cloudresourcemanager.googleapis.com/projects/${WEB_NUMBER}`;

function nic(
  projectId: string,
  subnet: string | undefined,
  net: string,
  ip: string,
): Record<string, unknown> {
  return {
    network: selfLink(projectId, `global/networks/${net}`),
    ...(subnet === undefined ? {} : { subnetwork: selfLink(projectId, subnet) }),
    networkIP: ip,
  };
}

function instance(name: string, zone: string, nics: readonly Record<string, unknown>[], extra = {}): Asset {
  return resource(
    computeName(WEB_ID, `zones/${zone}/instances/${name}`),
    'compute.googleapis.com/Instance',
    WEB_NUMBER,
    { name, status: 'RUNNING', networkInterfaces: nics, ...extra },
    { location: zone, folders: ['20000000003', '20000000002'] },
  );
}

/** The assets of the scenario, in no particular order. */
export function scenarioAssets(): Asset[] {
  const webFolders = ['20000000003', '20000000002'];
  return [
    organization(),
    folder('20000000001', 'Platform'),
    folder('20000000002', 'Workloads'),
    folder('20000000003', 'Retail', ['folders/20000000002']),
    project(HOST_NUMBER, HOST_ID, ['20000000001']),
    project(WEB_NUMBER, WEB_ID, webFolders),
    network(HOST_NUMBER, HOST_ID, 'vpc-shared', ['regions/europe-west3/subnetworks/web']),
    subnetwork(HOST_NUMBER, HOST_ID, 'europe-west3', 'web', 'vpc-shared', '10.0.0.0/24'),
    network(WEB_NUMBER, WEB_ID, 'vpc-local', [
      'regions/europe-west3/subnetworks/local',
      'regions/europe-west3/subnetworks/local-b',
    ]),
    subnetwork(WEB_NUMBER, WEB_ID, 'europe-west3', 'local', 'vpc-local', '10.1.0.0/24'),
    subnetwork(WEB_NUMBER, WEB_ID, 'europe-west3', 'local-b', 'vpc-local', '10.1.1.0/24'),
    instance('on-host', 'europe-west3-a', [
      { ...nic(HOST_ID, 'regions/europe-west3/subnetworks/web', 'vpc-shared', '10.0.0.2') },
    ]),
    instance(
      'on-subnet',
      'europe-west3-a',
      [nic(WEB_ID, 'regions/europe-west3/subnetworks/local', 'vpc-local', '10.1.0.2')],
      {
        disks: [{ source: selfLink(WEB_ID, 'zones/europe-west3-a/disks/on-subnet') }],
        serviceAccounts: [{ email: SA_EMAIL.toUpperCase() }],
      },
    ),
    instance('on-network', 'europe-west3-b', [nic(WEB_ID, undefined, 'vpc-local', '10.1.0.3')]),
    instance('two-nics', 'europe-west3-a', [
      nic(WEB_ID, 'regions/europe-west3/subnetworks/local', 'vpc-local', '10.1.0.4'),
      nic(WEB_ID, 'regions/europe-west3/subnetworks/local-b', 'vpc-local', '10.1.1.4'),
    ]),
    resource(
      DISK,
      'compute.googleapis.com/Disk',
      WEB_NUMBER,
      { name: 'on-subnet' },
      {
        location: 'europe-west3-a',
        folders: webFolders,
      },
    ),
    resource(
      SERVICE_ACCOUNT,
      'iam.googleapis.com/ServiceAccount',
      WEB_NUMBER,
      {
        email: SA_EMAIL,
        displayName: 'Web frontend',
      },
      { location: 'global', folders: webFolders },
    ),
    resource(
      CONNECTOR,
      'vpcaccess.googleapis.com/Connector',
      HOST_NUMBER,
      {
        name: `projects/${HOST_ID}/locations/europe-west3/connectors/conn`,
        network: 'vpc-shared',
      },
      { location: 'europe-west3', folders: ['20000000001'] },
    ),
    resource(
      RUN_SERVICE,
      'run.googleapis.com/Service',
      WEB_NUMBER,
      {
        name: `projects/${WEB_NUMBER}/locations/europe-west3/services/api`,
        template: {
          vpcAccess: { connector: `projects/${HOST_ID}/locations/europe-west3/connectors/conn` },
          serviceAccount: 'missing@demo-web-1.iam.gserviceaccount.com',
        },
        uri: 'https://api.example.org',
      },
      { location: 'europe-west3', folders: webFolders },
    ),
    resource(
      GADGET,
      'gadgets.googleapis.com/Gadget',
      WEB_NUMBER,
      { displayName: 'Shiny gadget' },
      {
        location: 'global',
        folders: webFolders,
      },
    ),
  ];
}

/** Product entries for the types the seed catalog does not map yet (and a test-only service). */
export const SCENARIO_ENTRIES = [
  {
    product: 'Compute Engine',
    service: 'compute.googleapis.com',
    icon: 'compute_engine',
    types: {
      'compute.googleapis.com/Instance': {
        role: 'core' as const,
        label: '{{data.name}}',
        ips: ['$.data.networkInterfaces[*].networkIP'],
        relations: [
          {
            kind: 'attaches' as const,
            to: '$.data.networkInterfaces[*].subnetwork',
            normalize: 'computeSelfLink' as const,
          },
          {
            kind: 'attaches' as const,
            to: '$.data.networkInterfaces[*].network',
            normalize: 'computeSelfLink' as const,
            weak: true,
          },
          { kind: 'uses' as const, to: '$.data.disks[*].source', normalize: 'computeSelfLink' as const },
          {
            kind: 'runsAs' as const,
            to: '$.data.serviceAccounts[*].email',
            normalize: 'serviceAccountEmail' as const,
          },
        ],
        hiddenWhen: "$.data.status in ['TERMINATED']",
      },
      'compute.googleapis.com/Disk': { role: 'leaf' as const },
    },
  },
  {
    product: 'Identity and Access Management',
    service: 'iam.googleapis.com',
    icon: 'identity_and_access_management',
    types: {
      'iam.googleapis.com/ServiceAccount': {
        role: 'leaf' as const,
        label: '{{data.email}}',
        aliases: ['$.data.email'],
      },
    },
  },
  {
    product: 'Serverless VPC Access',
    service: 'vpcaccess.googleapis.com',
    icon: 'serverless_vpc_access',
    types: { 'vpcaccess.googleapis.com/Connector': { role: 'core' as const } },
  },
  {
    product: 'Cloud Run',
    service: 'run.googleapis.com',
    icon: 'cloud_run',
    types: {
      'run.googleapis.com/Service': {
        role: 'core' as const,
        domains: ['$.data.uri'],
        relations: [
          {
            kind: 'attaches' as const,
            to: '$.data.template.vpcAccess.connector',
            normalize: 'name' as const,
            service: 'vpcaccess.googleapis.com',
          },
          {
            kind: 'runsAs' as const,
            to: '$.data.template.serviceAccount',
            normalize: 'serviceAccountEmail' as const,
          },
        ],
      },
    },
  },
];

/** The scenario catalog: the real one plus {@link SCENARIO_ENTRIES}. */
export function scenarioCatalog(): Catalog {
  return catalogWith(SCENARIO_ENTRIES);
}

/** Builds and validates with `GraphBuildSchema`, the model's oracle for graph + report. */
export function checkedBuild(
  assets: readonly Asset[],
  catalog: Catalog,
  options: BuildOptions = {},
): GraphBuild {
  return GraphBuildSchema.parse(buildGraphWithReport({ assets }, catalog, options));
}
