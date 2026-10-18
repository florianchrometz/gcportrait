// SPDX-License-Identifier: Apache-2.0
/**
 * The platform management project `demo-mgmt-1` (feature `management`): what a platform team runs for every
 * workload, in one project of the Operations folder.
 *
 * - Delivery: a Cloud Build private worker pool peered with the production Shared VPC (and a self-hosted
 *   runner VM on it), a GitHub Enterprise host connection with its repositories and secrets, a trigger per
 *   repository, the builds (which run here instead of in `demo-ops-1`), the `images` repository they push to
 *   (created by `registries.ts`), a Cloud Deploy pipeline with GKE and Cloud Run targets, and an Infra Manager
 *   deployment.
 * - Observability: the central log bucket with its linked BigQuery dataset, the organisation's audit sink,
 *   a sink per Shared VPC host into the central bucket, the project's own `_Default` and `_Required` sinks and
 *   buckets (hidden), alert policies with Pub/Sub and e-mail channels, an uptime check per production
 *   storefront, and an asset feed.
 * - Backup and DR: a backup vault, plans for VMs and Cloud SQL, and the associations and data sources of the
 *   production VMs and the first Cloud SQL instance.
 * - App Hub: the storefront application with its services, workload and service project attachments.
 * - Billing: the organisation's billing account.
 */
import type { OrgBuilder } from '../builder/builder.js';
import type { JsonObject } from '../core/json.js';
import { addInstance } from './compute.js';
import { prodHost, type OrgContext } from './context.js';
import { uuidFrom } from './fabric.js';
import {
  addProject,
  addProjectAsset,
  addServiceAccount,
  fullName,
  organizationNumber,
  standardLabels,
  type ContainerCtx,
  type ProjectCtx,
} from './kit.js';
import { addSubnet } from './network.js';
import { APPS, addBuilds } from './operations.js';
import { addSecretWithVersion } from './secrets.js';
import { addBucket } from './storage.js';
import type { Region } from './vocabulary.js';

export interface Management {
  readonly project: ProjectCtx;
  readonly region: Region;
  /** The bucket the storefronts' static buckets write their access logs to. */
  readonly accessLogs: string;
}

const BILLING_ACCOUNT = 'billingAccounts/01A2B3-C4D5E6-F7A8B9';

export function createManagementProject(b: OrgBuilder, folder: ContainerCtx, region: Region): Management {
  const project = addProject(b, folder, {
    role: 'mgmt',
    displayName: 'Platform management',
    env: 'prod',
    region,
    team: 'platform',
  });
  return { project, region, accessLogs: `${project.id}-access-logs` };
}

export function addManagement(ctx: OrgContext, management: Management, builds: number): void {
  const { b } = ctx;
  const { project, region } = management;
  const host = prodHost(ctx);
  const labels = standardLabels(project);
  const storageKey = ctx.keys.key(region.name, 'storage');
  const location = `projects/${project.id}/locations/${region.name}`;
  const asset = (assetType: string, path: string, where: string, data: JsonObject, after?: number): number =>
    addProjectAsset(b, project, {
      assetType,
      name: fullName(assetType.slice(0, assetType.indexOf('/')), path),
      location: where,
      data,
      ...(after === undefined ? {} : { after }),
    }).createdAt;

  const runner = addServiceAccount(b, project, 'build-runner', 'Cloud Build');
  const deployer = addServiceAccount(b, project, 'deploy-runner', 'Cloud Deploy');
  const infra = addServiceAccount(b, project, 'infra-manager', 'Infra Manager');
  for (const [name, extra] of [
    [management.accessLogs, { purpose: 'access-logs' }],
    [`${project.id}_cloudbuild`, {}],
    [`${project.id}-deploy-artifacts`, { purpose: 'deploy' }],
    [`${project.id}-infra-manager`, { purpose: 'terraform' }],
    [`${project.id}-audit-archive`, { purpose: 'audit' }],
  ] as const) {
    addBucket(b, project, {
      name,
      region,
      labels: { ...labels, ...extra },
      ...(storageKey === undefined || name.endsWith('_cloudbuild') ? {} : { kmsKey: storageKey }),
      ...(name.endsWith('-audit-archive') ? { storageClass: 'ARCHIVE' } : {}),
    });
  }

  // Delivery: the private pool on the production network, a runner VM next to it, the host connection.
  const subnet = addSubnet(b, host, { region, name: `${project.id}-${region.name}`, prefix: 27 });
  addInstance(b, project, {
    zone: region.zones[0] ?? `${region.name}-a`,
    name: 'ci-runner-1',
    machineType: 'e2-standard-4',
    nic: { network: host.selfLink, subnetwork: subnet.selfLink, ip: subnet.hosts.next() },
    serviceAccount: runner.email,
    tags: ['ci-runner'],
    labels: { ...labels, app: 'ci-runner' },
    after: subnet.createdAt,
  });
  const pool = `projects/${project.number}/locations/${region.name}/workerPools/private-build`;
  asset(
    'cloudbuild.googleapis.com/WorkerPool',
    pool,
    region.name,
    {
      name: pool,
      displayName: 'private-build',
      uid: uuidFrom(b, pool),
      state: 'RUNNING',
      privatePoolV1Config: {
        workerConfig: { machineType: 'e2-standard-4', diskSizeGb: '100' },
        networkConfig: {
          peeredNetwork: `projects/${host.project.number}/global/networks/${host.name}`,
          egressOption: 'NO_PUBLIC_EGRESS',
          peeredNetworkIpRange: b.addresses.privateServices.allocate(29),
        },
      },
      etag: 'W/"a1b2c3"',
    },
    host.psa.createdAt,
  );
  const privateKey = addSecretWithVersion(ctx, project, 'ghe-app-private-key', region);
  const webhook = addSecretWithVersion(ctx, project, 'ghe-app-webhook', region);
  const connection = `${location}/connections/ghe-shop`;
  const connectionCreated = asset('cloudbuild.googleapis.com/Connection', connection, region.name, {
    name: connection,
    githubEnterpriseConfig: {
      hostUri: 'https://github.example.com',
      appId: '4021',
      appSlug: 'gcb-shop',
      privateKeySecretVersion: privateKey,
      webhookSecretSecretVersion: webhook,
      appInstallationId: '77',
      serverVersion: '3.14.0',
    },
    installationState: { stage: 'COMPLETE' },
    disabled: false,
    reconciling: false,
    etag: 'W/"b7e1"',
  });
  const repositories = APPS.slice(0, 3);
  const triggerIds: string[] = [];
  for (const app of repositories) {
    const repository = `${connection}/repositories/${app}`;
    asset(
      'cloudbuild.googleapis.com/Repository',
      repository,
      region.name,
      {
        name: repository,
        remoteUri: `https://github.example.com/shop/${app}.git`,
        webhookId: String(1000 + app.length * 37),
      },
      connectionCreated,
    );
    const id = uuidFrom(b, `trigger:${app}`);
    triggerIds.push(id);
    asset(
      'cloudbuild.googleapis.com/BuildTrigger',
      `projects/${project.number}/locations/${region.name}/triggers/${id}`,
      region.name,
      {
        resourceName: `${location}/triggers/${id}`,
        id,
        name: `${app}-main`,
        description: `Builds ${app} on every push to main`,
        serviceAccount: `projects/${project.id}/serviceAccounts/${runner.email}`,
        repositoryEventConfig: {
          repository,
          repositoryType: 'GITHUB_ENTERPRISE',
          push: { branch: '^main$' },
        },
        build: {
          steps: [
            {
              name: 'gcr.io/cloud-builders/docker',
              args: [
                'build',
                '-t',
                `${region.name}-docker.pkg.dev/${project.id}/images/${app}:$SHORT_SHA`,
                '.',
              ],
            },
          ],
          images: [`${region.name}-docker.pkg.dev/${project.id}/images/${app}:$SHORT_SHA`],
          options: { pool: { name: pool }, logging: 'CLOUD_LOGGING_ONLY' },
          timeout: '1200s',
        },
        includeBuildLogs: 'INCLUDE_BUILD_LOGS_WITH_STATUS',
      },
      connectionCreated,
    );
  }
  addBuilds(b, project, region, builds, {
    imageProject: project.id,
    serviceAccount: `projects/${project.id}/serviceAccounts/${runner.email}`,
    pool,
    triggers: triggerIds,
  });
  asset('config.googleapis.com/Deployment', `${location}/deployments/landing-zone`, region.name, {
    name: `${location}/deployments/landing-zone`,
    labels: { stack: 'landing-zone' },
    state: 'ACTIVE',
    latestRevision: `${location}/deployments/landing-zone/revisions/r-41`,
    lockState: 'UNLOCKED',
    tfVersion: '1.5.7',
    terraformBlueprint: {
      gitSource: {
        repo: 'https://git.example.com/platform/landing-zone.git',
        directory: 'envs/prod',
        ref: 'main',
      },
      inputValues: { region: { inputValue: region.name } },
    },
    artifactsGcsBucket: `gs://${project.id}-infra-manager/landing-zone`,
    serviceAccount: `projects/${project.id}/serviceAccounts/${infra.email}`,
    workerPool: pool,
  });

  // Observability: the central log bucket and its analytics link, the organisation's audit sink.
  const bucketPath = `projects/${project.number}/locations/${region.name}/buckets/central`;
  const centralCreated = asset('logging.googleapis.com/LogBucket', bucketPath, region.name, {
    name: `${location}/buckets/central`,
    description: 'Audit and platform logs of every project, 400 days',
    retentionDays: 400,
    lifecycleState: 'ACTIVE',
    analyticsEnabled: true,
    locked: false,
    ...(storageKey === undefined ? {} : { cmekSettings: { kmsKeyName: storageKey } }),
  });
  const analytics = `projects/${project.id}/datasets/central_analytics`;
  addProjectAsset(b, project, {
    assetType: 'bigquery.googleapis.com/Dataset',
    name: fullName('bigquery.googleapis.com', analytics),
    location: region.name,
    after: centralCreated,
    data: {
      kind: 'bigquery#dataset',
      id: `${project.id}:central_analytics`,
      datasetReference: { projectId: project.id, datasetId: 'central_analytics' },
      location: region.name,
      type: 'DEFAULT',
      labels: { 'logging-link': 'central' },
    },
  });
  asset(
    'logging.googleapis.com/Link',
    `${bucketPath}/links/central_analytics`,
    region.name,
    {
      name: `${location}/buckets/central/links/central_analytics`,
      description: 'Log Analytics in BigQuery',
      lifecycleState: 'ACTIVE',
      bigqueryDataset: { datasetId: `bigquery.googleapis.com/${analytics}` },
    },
    centralCreated,
  );
  const archive = `${project.id}-audit-archive`;
  b.add({
    assetType: 'logging.googleapis.com/LogSink',
    name: `//logging.googleapis.com/${ctx.org.ref}/sinks/org-audit-archive`,
    parent: ctx.org.full,
    ancestors: ctx.org.ancestors,
    location: 'global',
    after: project.createdAt,
    data: {
      name: 'org-audit-archive',
      resourceName: `${ctx.org.ref}/sinks/org-audit-archive`,
      destination: `storage.googleapis.com/${archive}`,
      filter: 'logName:"cloudaudit.googleapis.com"',
      includeChildren: true,
      writerIdentity: `serviceAccount:service-org-${organizationNumber(ctx.org)}@gcp-sa-logging.iam.gserviceaccount.com`,
    },
  });
  // The project's own default sinks and buckets (every project has them; they start hidden).
  for (const name of ['_Required', '_Default'] as const) {
    asset(
      'logging.googleapis.com/LogBucket',
      `projects/${project.number}/locations/global/buckets/${name}`,
      'global',
      {
        name: `projects/${project.id}/locations/global/buckets/${name}`,
        retentionDays: name === '_Required' ? 400 : 30,
        lifecycleState: 'ACTIVE',
        locked: name === '_Required',
      },
    );
    asset('logging.googleapis.com/LogSink', `projects/${project.number}/sinks/${name}`, 'global', {
      name,
      resourceName: `projects/${project.id}/sinks/${name}`,
      destination: `logging.googleapis.com/projects/${project.number}/locations/global/buckets/${name}`,
      filter:
        name === '_Required'
          ? 'LOG_ID("cloudaudit.googleapis.com/activity")'
          : 'NOT LOG_ID("cloudaudit.googleapis.com/activity")',
      writerIdentity: `serviceAccount:service-${project.number}@gcp-sa-logging.iam.gserviceaccount.com`,
    });
  }

  // Monitoring: an alerting topic, the channels, two alert policies; and the asset feed.
  const topic = (name: string): string => {
    const path = `projects/${project.id}/topics/${name}`;
    asset('pubsub.googleapis.com/Topic', path, 'global', { name: path, labels });
    return path;
  };
  const alerts = topic('alerts');
  const channels = [
    ['4000000000000000001', { type: 'pubsub', displayName: 'Incident pipeline', labels: { topic: alerts } }],
    [
      '4000000000000000002',
      {
        type: 'email',
        displayName: 'Platform on-call',
        labels: { email_address: 'platform-oncall@example.com' },
      },
    ],
  ] as const;
  for (const [id, data] of channels) {
    asset(
      'monitoring.googleapis.com/NotificationChannel',
      `projects/${project.number}/notificationChannels/${id}`,
      'global',
      {
        name: `projects/${project.id}/notificationChannels/${id}`,
        ...data,
        enabled: true,
        verificationStatus: data.type === 'email' ? 'VERIFIED' : 'VERIFICATION_STATUS_UNSPECIFIED',
      },
    );
  }
  const policies: readonly [string, string, string][] = [
    ['3000000000000000001', 'Storefront 5xx ratio', 'CRITICAL'],
    ['3000000000000000002', 'Cloud SQL disk utilisation', 'WARNING'],
  ];
  for (const [id, displayName, severity] of policies) {
    asset(
      'monitoring.googleapis.com/AlertPolicy',
      `projects/${project.number}/alertPolicies/${id}`,
      'global',
      {
        name: `projects/${project.id}/alertPolicies/${id}`,
        displayName,
        severity,
        combiner: 'OR',
        enabled: true,
        conditions: [
          {
            name: `projects/${project.id}/alertPolicies/${id}/conditions/${id.slice(-4)}`,
            displayName,
            conditionThreshold: {
              filter:
                severity === 'CRITICAL'
                  ? 'resource.type = "https_lb_rule" AND metric.type = "loadbalancing.googleapis.com/https/request_count"'
                  : 'resource.type = "cloudsql_database" AND metric.type = "cloudsql.googleapis.com/database/disk/utilization"',
              comparison: 'COMPARISON_GT',
              thresholdValue: severity === 'CRITICAL' ? 0.05 : 0.85,
              duration: '300s',
            },
          },
        ],
        notificationChannels: channels.map(
          ([channel]) => `projects/${project.number}/notificationChannels/${channel}`,
        ),
      },
    );
  }
  const assetChanges = topic('asset-changes');
  asset('cloudasset.googleapis.com/Feed', `projects/${project.number}/feeds/network-changes`, 'global', {
    name: `projects/${project.number}/feeds/network-changes`,
    assetTypes: [
      'compute.googleapis.com/Firewall',
      'compute.googleapis.com/Route',
      'compute.googleapis.com/Network',
    ],
    contentType: 'RESOURCE',
    feedOutputConfig: { pubsubDestination: { topic: assetChanges } },
  });

  // Backup and DR: the vault and the plans (associations follow when the workloads exist).
  const vault = `${location}/backupVaults/vault-${region.name}`;
  const vaultCreated = asset('backupdr.googleapis.com/BackupVault', vault, region.name, {
    name: vault,
    description: 'Immutable backups of the production workloads',
    state: 'ACTIVE',
    backupMinimumEnforcedRetentionDuration: '1209600s',
    backupCount: '42',
    totalStoredBytes: '1099511627776',
    uid: uuidFrom(b, vault),
    accessRestriction: 'WITHIN_ORGANIZATION',
    ...(storageKey === undefined ? {} : { encryptionConfig: { kmsKeyName: storageKey } }),
  });
  const plans = {
    vm: `${location}/backupPlans/daily-vm`,
    sql: `${location}/backupPlans/daily-sql`,
  } as const;
  for (const [kind, plan] of Object.entries(plans)) {
    asset(
      'backupdr.googleapis.com/BackupPlan',
      plan,
      region.name,
      {
        name: plan,
        description: `Daily backups of ${kind === 'vm' ? 'VMs' : 'Cloud SQL instances'}, kept 30 days`,
        state: 'ACTIVE',
        resourceType: kind === 'vm' ? 'compute.googleapis.com/Instance' : 'sqladmin.googleapis.com/Instance',
        backupVault: vault,
        backupRules: [
          {
            ruleId: 'daily',
            backupRetentionDays: 30,
            standardSchedule: {
              recurrenceType: 'DAILY',
              timeZone: 'UTC',
              backupWindow: { startHourOfDay: 2, endHourOfDay: 6 },
            },
          },
        ],
      },
      vaultCreated,
    );
  }

  // The organisation's billing account.
  b.add({
    assetType: 'cloudbilling.googleapis.com/BillingAccount',
    name: `//cloudbilling.googleapis.com/${BILLING_ACCOUNT}`,
    parent: ctx.org.full,
    ancestors: ctx.org.ancestors,
    location: 'global',
    after: ctx.org.createdAt,
    data: {
      name: BILLING_ACCOUNT,
      displayName: 'Example Org billing',
      open: true,
      currencyCode: 'EUR',
      parent: ctx.org.ref,
    },
  });

  b.defer(() => {
    addDeliveryPipeline(ctx, management, deployer.email, pool);
    addSinksAndChecks(ctx, management);
    addBackupAssociations(ctx, management, vault, plans);
    addApplication(ctx, management);
  });
}

/** A Cloud Deploy pipeline from a Cloud Run staging target to the first production GKE cluster. */
function addDeliveryPipeline(ctx: OrgContext, management: Management, deployer: string, pool: string): void {
  const { b } = ctx;
  const { project, region } = management;
  const location = `projects/${project.id}/locations/${region.name}`;
  const cluster = ctx.inventory.clusters.find((c) => c.project.env === 'prod');
  const staging =
    ctx.inventory.serverless.find((s) => s.project.env !== 'prod') ?? ctx.inventory.serverless[0];
  if (cluster === undefined || staging === undefined) return;
  const execution = (usages: readonly string[]): JsonObject => ({
    usages: [...usages],
    workerPool: pool,
    serviceAccount: deployer,
    artifactStorage: `gs://${project.id}-deploy-artifacts`,
    executionTimeout: '3600s',
  });
  const pipeline = `${location}/deliveryPipelines/storefront`;
  const pipelineCreated = addProjectAsset(b, project, {
    assetType: 'clouddeploy.googleapis.com/DeliveryPipeline',
    name: fullName('clouddeploy.googleapis.com', pipeline),
    location: region.name,
    after: Math.max(cluster.project.createdAt, staging.project.createdAt),
    data: {
      name: pipeline,
      uid: uuidFrom(b, pipeline).replaceAll('-', ''),
      description: 'Storefront from staging (Cloud Run) to production (GKE)',
      serialPipeline: {
        stages: [
          { targetId: 'staging', profiles: ['staging'] },
          {
            targetId: 'prod',
            profiles: ['prod'],
            strategy: { canary: { canaryDeployment: { percentages: [25, 50], verify: true } } },
          },
        ],
      },
      condition: { pipelineReadyCondition: { status: true }, targetsPresentCondition: { status: true } },
      etag: 'b2c4e6',
      suspended: false,
    },
  }).createdAt;
  const target = (id: string, data: JsonObject): void => {
    const path = `${location}/targets/${id}`;
    addProjectAsset(b, project, {
      assetType: 'clouddeploy.googleapis.com/Target',
      name: fullName('clouddeploy.googleapis.com', path),
      location: region.name,
      after: pipelineCreated,
      data: { name: path, targetId: id, uid: uuidFrom(b, path).replaceAll('-', ''), ...data },
    });
  };
  target('staging', {
    run: { location: `projects/${staging.project.id}/locations/${staging.region.name}` },
    executionConfigs: [execution(['RENDER', 'DEPLOY'])],
  });
  target('prod', {
    description: 'Production cluster, approval required',
    requireApproval: true,
    gke: { cluster: cluster.path, internalIp: true },
    executionConfigs: [execution(['RENDER', 'DEPLOY', 'VERIFY'])],
  });
  const release = `${pipeline}/releases/storefront-2-14-0`;
  addProjectAsset(b, project, {
    assetType: 'clouddeploy.googleapis.com/Release',
    name: fullName('clouddeploy.googleapis.com', release),
    location: region.name,
    after: pipelineCreated,
    data: {
      name: release,
      uid: uuidFrom(b, release).replaceAll('-', ''),
      description: 'Storefront 2.14.0',
      buildArtifacts: [
        { image: 'storefront', tag: `${region.name}-docker.pkg.dev/${project.id}/images/storefront:2.14.0` },
      ],
      targetSnapshots: [{ name: `${location}/targets/prod` }],
      renderState: 'SUCCEEDED',
    },
  });
  addProjectAsset(b, project, {
    assetType: 'clouddeploy.googleapis.com/Rollout',
    name: fullName('clouddeploy.googleapis.com', `${release}/rollouts/storefront-2-14-0-to-prod-0001`),
    location: region.name,
    after: pipelineCreated,
    data: {
      name: `${release}/rollouts/storefront-2-14-0-to-prod-0001`,
      uid: uuidFrom(b, `${release}/rollout`).replaceAll('-', ''),
      targetId: 'prod',
      approvalState: 'APPROVED',
      state: 'SUCCEEDED',
    },
  });
}

/** A sink per Shared VPC host into the central bucket, and an uptime check per production storefront. */
function addSinksAndChecks(ctx: OrgContext, management: Management): void {
  const { b } = ctx;
  const { project, region } = management;
  const central = `logging.googleapis.com/projects/${project.number}/locations/${region.name}/buckets/central`;
  for (const host of ctx.hosts.values()) {
    const owner = host.project;
    addProjectAsset(b, owner, {
      assetType: 'logging.googleapis.com/LogSink',
      name: fullName('logging.googleapis.com', `projects/${owner.number}/sinks/to-central`),
      location: 'global',
      after: Math.max(owner.createdAt, project.createdAt),
      data: {
        name: 'to-central',
        resourceName: `projects/${owner.id}/sinks/to-central`,
        destination: central,
        filter: 'resource.type=("gce_subnetwork" OR "gce_firewall_rule" OR "gce_router" OR "vpn_gateway")',
        writerIdentity: `serviceAccount:service-${owner.number}@gcp-sa-logging.iam.gserviceaccount.com`,
      },
    });
  }
  for (const web of ctx.inventory.web.filter((w) => w.project.env === 'prod')) {
    const id = `${web.project.team}-storefront-${b.rng.fork(`uptime:${web.project.id}`).hex(6)}`;
    addProjectAsset(b, project, {
      assetType: 'monitoring.googleapis.com/UptimeCheckConfig',
      name: fullName('monitoring.googleapis.com', `projects/${project.number}/uptimeCheckConfigs/${id}`),
      location: 'global',
      after: Math.max(web.project.createdAt, project.createdAt),
      data: {
        name: `projects/${project.id}/uptimeCheckConfigs/${id}`,
        displayName: `Storefront ${web.project.team}`,
        monitoredResource: { type: 'uptime_url', labels: { project_id: project.id, host: web.domain } },
        httpCheck: { path: '/', port: 443, useSsl: true, validateSsl: true, requestMethod: 'GET' },
        period: '60s',
        timeout: '10s',
        checkerType: 'STATIC_IP_CHECKERS',
        selectedRegions: ['EUROPE', 'USA_IOWA', 'ASIA_PACIFIC'],
      },
    });
  }
}

/** Backup plan associations (in each resource's project) and the data sources in the vault. */
function addBackupAssociations(
  ctx: OrgContext,
  management: Management,
  vault: string,
  plans: { readonly vm: string; readonly sql: string },
): void {
  const { b } = ctx;
  const { project, region } = management;
  const targets: { owner: ProjectCtx; resourceType: string; resource: string; short: string }[] = [];
  for (const vms of ctx.inventory.vms.filter(
    (v) => v.project.env === 'prod' && v.project.region === region,
  )) {
    const instance = vms.instances[0];
    if (instance !== undefined)
      targets.push({
        owner: vms.project,
        resourceType: 'compute.googleapis.com/Instance',
        resource: instance,
        short: instance.slice(instance.lastIndexOf('/') + 1),
      });
  }
  const sql = ctx.inventory.serverless.find((s) => s.project.env === 'prod' && s.region === region);
  const connection = sql?.sql[0];
  if (sql !== undefined && connection !== undefined) {
    const instance = connection.slice(connection.lastIndexOf(':') + 1);
    targets.push({
      owner: sql.project,
      resourceType: 'sqladmin.googleapis.com/Instance',
      resource: `projects/${sql.project.id}/instances/${instance}`,
      short: instance,
    });
  }
  for (const target of targets) {
    const dataSource = `${vault}/dataSources/ds-${target.owner.id}-${target.short}`;
    const sourceCreated = addProjectAsset(b, project, {
      assetType: 'backupdr.googleapis.com/DataSource',
      name: fullName('backupdr.googleapis.com', dataSource),
      location: region.name,
      after: target.owner.createdAt,
      data: {
        name: dataSource,
        state: 'ACTIVE',
        backupCount: '30',
        configState: 'ACTIVE',
        dataSourceGcpResource: {
          gcpResourcename: target.resource,
          type: target.resourceType,
          location: region.name,
        },
      },
    }).createdAt;
    const association = `projects/${target.owner.id}/locations/${region.name}/backupPlanAssociations/bpa-${target.short}`;
    addProjectAsset(b, target.owner, {
      assetType: 'backupdr.googleapis.com/BackupPlanAssociation',
      name: fullName('backupdr.googleapis.com', association),
      location: region.name,
      after: sourceCreated,
      data: {
        name: association,
        resourceType: target.resourceType,
        resource: target.resource,
        backupPlan: target.resourceType === 'compute.googleapis.com/Instance' ? plans.vm : plans.sql,
        dataSource,
        state: 'ACTIVE',
        rulesConfigInfo: [{ ruleId: 'daily', lastBackupState: 'SUCCEEDED' }],
      },
    });
  }
}

/** The App Hub storefront application in the management project, registering the first storefront. */
function addApplication(ctx: OrgContext, management: Management): void {
  const { b } = ctx;
  const { project } = management;
  const web = ctx.inventory.web.find((w) => w.project.env === 'prod');
  const services = ctx.inventory.serverless.find((s) => s.project.env === 'prod');
  if (web === undefined) return;
  const base = `projects/${project.id}/locations/global`;
  const application = `${base}/applications/storefront`;
  const attributes = { criticality: { type: 'MISSION_CRITICAL' }, environment: { type: 'PRODUCTION' } };
  const after = Math.max(project.createdAt, web.project.createdAt, services?.project.createdAt ?? 0);
  const add = (assetType: string, path: string, data: JsonObject): void => {
    addProjectAsset(b, project, {
      assetType,
      name: fullName('apphub.googleapis.com', path),
      location: 'global',
      after,
      data: { name: path, uid: uuidFrom(b, path), state: 'ACTIVE', ...data },
    });
  };
  add('apphub.googleapis.com/Application', application, {
    displayName: 'Storefront',
    description: 'The customer-facing shop',
    scope: { type: 'GLOBAL' },
    attributes: { ...attributes, owners: [{ displayName: 'Shop team', email: 'shop-team@example.com' }] },
  });
  for (const owner of [web.project, ...(services === undefined ? [] : [services.project])]) {
    add('apphub.googleapis.com/ServiceProjectAttachment', `${base}/serviceProjectAttachments/${owner.id}`, {
      serviceProject: `projects/${owner.number}`,
    });
  }
  const register = (
    kind: 'services' | 'workloads',
    id: string,
    displayName: string,
    uri: string,
    gcpProject: ProjectCtx,
    location: string,
  ): void => {
    const field = kind === 'services' ? 'serviceReference' : 'workloadReference';
    const properties = kind === 'services' ? 'serviceProperties' : 'workloadProperties';
    add(
      `apphub.googleapis.com/${kind === 'services' ? 'Service' : 'Workload'}`,
      `${application}/${kind}/${id}`,
      {
        displayName,
        [field]: { uri },
        [properties]: { gcpProject: `projects/${gcpProject.id}`, location },
        attributes,
      },
    );
  };
  register(
    'services',
    'storefront-lb',
    'Storefront load balancer',
    web.httpsRule.replace('https://www.googleapis.com/compute/v1/', '//compute.googleapis.com/'),
    web.project,
    'global',
  );
  register('services', 'storefront-api', 'Storefront API', web.runService, web.project, web.region.name);
  if (web.apiGroup !== undefined)
    register(
      'workloads',
      'inventory-api',
      'Inventory API VMs',
      web.apiGroup.replace('https://www.googleapis.com/compute/v1/', '//compute.googleapis.com/'),
      web.project,
      web.region.zones[0] ?? web.region.name,
    );
  const billing = services?.services[1];
  if (services !== undefined && billing !== undefined)
    register('services', 'billing-api', 'Billing API', billing, services.project, services.region.name);
}
