// SPDX-License-Identifier: Apache-2.0
/**
 * Serverless beyond Cloud Run services and Pub/Sub-triggered functions (feature `serverless`): the bucket
 * Cloud Run functions keeps its sources in (hidden), a Cloud Run job with its latest execution and the
 * executions that come and go every day, a Cloud Tasks queue that calls a service, the revisions behind the
 * first project's services (hidden), and in the first serverless project of each environment a workflow
 * started by an Eventarc trigger and a function triggered by new objects in the archive bucket.
 */
import { uuid } from '../core/ids.js';
import type { JsonObject } from '../core/json.js';
import { HOUR_MS } from '../core/time.js';
import type { OrgContext } from './context.js';
import { addProjectAsset, fullName, projectInput, standardLabels, type ProjectCtx } from './kit.js';
import type { HostNetwork } from './network.js';
import { addBucket } from './storage.js';
import type { Region } from './vocabulary.js';
import { runServiceData } from './web.js';

export interface ServerlessExtrasInput {
  readonly project: ProjectCtx;
  readonly region: Region;
  readonly host: HostNetwork;
  readonly runAccount: string;
  readonly fnAccount: string;
  /** `projects/<host>/locations/<region>/connectors/<name>`. */
  readonly connector: string;
  readonly sqlConnections: readonly string[];
  readonly services: readonly { readonly full: string; readonly data: JsonObject }[];
  readonly topics: readonly string[];
  readonly functions: number;
  /** The archive bucket, when the project has one. */
  readonly archive: string | undefined;
}

const ALPHA = 'abcdefghijklmnopqrstuvwxyz';

export function addServerlessExtras(ctx: OrgContext, input: ServerlessExtrasInput): void {
  const { b } = ctx;
  const { project, region } = input;
  const labels = standardLabels(project);
  if (input.functions > 0) {
    addBucket(b, project, {
      name: `gcf-v2-sources-${project.number}-${region.name}`,
      region,
      labels: { 'goog-managed-by': 'cloudfunctions' },
    });
  }
  if (ctx.once(`run-job:${project.env}`)) {
    addRunJob(ctx, input);
    addTasksQueue(ctx, input);
  }
  if (ctx.once('run-revisions')) {
    for (const service of input.services) {
      const revision = service.data['latestReadyRevision'];
      if (typeof revision !== 'string') continue;
      const short = revision.slice(revision.lastIndexOf('/') + 1);
      const serviceName = service.full.slice(service.full.lastIndexOf('/') + 1);
      addProjectAsset(b, project, {
        assetType: 'run.googleapis.com/Revision',
        name: fullName(
          'run.googleapis.com',
          `projects/${project.id}/locations/${region.name}/revisions/${short}`,
        ),
        location: region.name,
        data: {
          name: revision,
          uid: uuid(b.rng.fork(`revision:${revision}`)),
          generation: '1',
          labels,
          launchStage: 'GA',
          service: `projects/${project.id}/locations/${region.name}/services/${serviceName}`,
          serviceAccount: input.runAccount,
          scaling: { maxInstanceCount: 20 },
          executionEnvironment: 'EXECUTION_ENVIRONMENT_GEN2',
          conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }],
        },
      });
    }
  }
  const topic = input.topics[0];
  if (input.archive !== undefined && topic !== undefined && project.env === 'prod' && ctx.once('workflow')) {
    addWorkflow(ctx, input, topic);
    addStorageFunction(ctx, input, input.archive);
  }
}

function addRunJob(ctx: OrgContext, input: ServerlessExtrasInput): void {
  const { b } = ctx;
  const { project, region } = input;
  const rng = b.rng.fork(`run-job:${project.id}`);
  const labels = standardLabels(project);
  const job = 'invoice-export';
  const path = `projects/${project.id}/locations/${region.name}/jobs/${job}`;
  const byNumber = `projects/${project.number}/locations/${region.name}/jobs/${job}`;
  const connection = input.sqlConnections[0];
  const execution = (at: number, suffix: string): { name: string; data: JsonObject } => ({
    name: fullName(
      'run.googleapis.com',
      `projects/${project.id}/locations/${region.name}/executions/${job}-${suffix}`,
    ),
    data: {
      name: `${byNumber}/executions/${job}-${suffix}`,
      uid: uuid(b.rng.fork(`execution:${project.id}/${suffix}`)),
      generation: '1',
      job: path,
      launchStage: 'GA',
      taskCount: 1,
      parallelism: 1,
      succeededCount: 1,
      failedCount: 0,
      completionTime: new Date(at + 12 * 60_000).toISOString(),
      conditions: [{ type: 'Completed', state: 'CONDITION_SUCCEEDED' }],
    },
  });
  const latest = rng.chars('bcdfghjklmnpqrstvwxz2456789', 5);
  const created = addProjectAsset(b, project, {
    assetType: 'run.googleapis.com/Job',
    name: fullName('run.googleapis.com', path),
    location: region.name,
    data: {
      name: byNumber,
      uid: uuid(rng),
      generation: '3',
      labels,
      creator: 'deployer@example.com',
      lastModifier: 'deployer@example.com',
      launchStage: 'GA',
      template: {
        taskCount: 1,
        parallelism: 1,
        template: {
          containers: [
            {
              image: `${region.name}-docker.pkg.dev/${project.id}/apps/${job}:1.2.${String(rng.int(0, 9))}`,
              resources: { limits: { cpu: '1', memory: '512Mi' } },
            },
          ],
          serviceAccount: input.runAccount,
          vpcAccess: { connector: input.connector, egress: 'PRIVATE_RANGES_ONLY' },
          volumes:
            connection === undefined
              ? []
              : [{ name: 'cloudsql', cloudSqlInstance: { instances: [connection] } }],
          maxRetries: 3,
          timeout: '600s',
          executionEnvironment: 'EXECUTION_ENVIRONMENT_GEN2',
        },
      },
      observedGeneration: '3',
      terminalCondition: { type: 'Ready', state: 'CONDITION_SUCCEEDED' },
      executionCount: rng.int(30, 300),
      latestCreatedExecution: {
        name: `${byNumber}/executions/${job}-${latest}`,
        completionStatus: 'EXECUTION_SUCCEEDED',
      },
      etag: `"${rng.hex(12)}"`,
    },
  });
  const last = execution(b.windowStart - 6 * HOUR_MS, latest);
  addProjectAsset(b, project, {
    assetType: 'run.googleapis.com/Execution',
    name: last.name,
    location: region.name,
    after: created.createdAt,
    data: last.data,
  });
  b.ephemerals.push({
    kind: 'run-execution',
    weight: 1,
    notBefore: created.createdAt,
    make: (createdAt, _serial, r) => {
      const next = execution(createdAt, r.chars('bcdfghjklmnpqrstvwxz2456789', 5));
      return [
        b.make(
          {
            ...projectInput(project, {
              assetType: 'run.googleapis.com/Execution',
              name: next.name,
              location: region.name,
              data: next.data,
            }),
            after: createdAt,
          },
          createdAt,
        ),
      ];
    },
  });
}

function addTasksQueue(ctx: OrgContext, input: ServerlessExtrasInput): void {
  const { project, region } = input;
  const service = input.services[0];
  const uri = service?.data['uri'];
  if (typeof uri !== 'string') return;
  const host = uri.replace(/^https:\/\//, '');
  const path = `projects/${project.id}/locations/${region.name}/queues/notifications`;
  addProjectAsset(ctx.b, project, {
    assetType: 'cloudtasks.googleapis.com/Queue',
    name: fullName(
      'cloudtasks.googleapis.com',
      `projects/${project.number}/locations/${region.name}/queues/notifications`,
    ),
    location: region.name,
    data: {
      name: path,
      httpTarget: {
        uriOverride: { scheme: 'HTTPS', host, pathOverride: { path: '/tasks/notify' } },
        httpMethod: 'POST',
        oidcToken: { serviceAccountEmail: input.runAccount, audience: uri },
      },
      rateLimits: { maxDispatchesPerSecond: 50, maxBurstSize: 100, maxConcurrentDispatches: 200 },
      retryConfig: { maxAttempts: 10, minBackoff: '0.100s', maxBackoff: '3600s', maxDoublings: 16 },
      state: 'RUNNING',
    },
  });
}

/** A workflow, the Eventarc trigger that starts it on new orders, and the trigger's push subscription. */
function addWorkflow(ctx: OrgContext, input: ServerlessExtrasInput, topic: string): void {
  const { b } = ctx;
  const { project, region } = input;
  const rng = b.rng.fork(`workflow:${project.id}`);
  const labels = standardLabels(project);
  const key = project.env === 'prod' ? ctx.keys.key(region.name, 'storage') : undefined;
  const workflow = `projects/${project.id}/locations/${region.name}/workflows/order-fulfilment`;
  addProjectAsset(b, project, {
    assetType: 'workflows.googleapis.com/Workflow',
    name: fullName('workflows.googleapis.com', workflow),
    location: region.name,
    data: {
      name: workflow,
      description: 'Reserves stock, charges the card and books the shipment',
      state: 'ACTIVE',
      revisionId: `00000${String(rng.int(2, 9))}-${rng.hex(3)}`,
      serviceAccount: `projects/${project.id}/serviceAccounts/${input.fnAccount}`,
      callLogLevel: 'LOG_ERRORS_ONLY',
      executionHistoryLevel: 'EXECUTION_HISTORY_BASIC',
      labels,
      ...(key === undefined ? {} : { cryptoKeyName: key }),
    },
  });
  const triggerId = 'orders-to-workflow';
  const subscription = `projects/${project.id}/subscriptions/eventarc-${region.name}-${triggerId}-sub-${rng.digits(3)}`;
  addProjectAsset(b, project, {
    assetType: 'eventarc.googleapis.com/Trigger',
    name: fullName(
      'eventarc.googleapis.com',
      `projects/${project.id}/locations/${region.name}/triggers/${triggerId}`,
    ),
    location: region.name,
    data: {
      name: `projects/${project.id}/locations/${region.name}/triggers/${triggerId}`,
      uid: uuid(rng),
      eventFilters: [{ attribute: 'type', value: 'google.cloud.pubsub.topic.v1.messagePublished' }],
      serviceAccount: input.fnAccount,
      destination: { workflow },
      transport: { pubsub: { topic, subscription } },
      labels,
      eventDataContentType: 'application/json',
      etag: rng.hex(16),
    },
  });
  addProjectAsset(b, project, {
    assetType: 'pubsub.googleapis.com/Subscription',
    name: fullName('pubsub.googleapis.com', subscription),
    location: 'global',
    data: {
      name: subscription,
      topic,
      pushConfig: {
        pushEndpoint: `https://workflowexecutions.googleapis.com/v1/${workflow}/triggerPubsubExecution`,
        oidcToken: {
          serviceAccountEmail: input.fnAccount,
          audience: 'https://workflowexecutions.googleapis.com',
        },
      },
      ackDeadlineSeconds: 10,
      messageRetentionDuration: '86400s',
      expirationPolicy: {},
      state: 'ACTIVE',
      labels: { 'goog-eventarc': '' },
    },
  });
}

/** A Cloud Run function triggered by new objects in a bucket: its service, Eventarc trigger and transport. */
function addStorageFunction(ctx: OrgContext, input: ServerlessExtrasInput, bucket: string): void {
  const { b } = ctx;
  const { project, region } = input;
  const rng = b.rng.fork(`storage-function:${project.id}`);
  const name = 'archive-indexer';
  const hash = rng.chars(ALPHA, 10);
  const servicePath = `projects/${project.id}/locations/${region.name}/services/${name}`;
  const uri = `https://${name}-${hash}-${region.runCode}.a.run.app`;
  const triggerId = `${name}-${rng.digits(6)}`;
  const triggerPath = `projects/${project.id}/locations/${region.name}/triggers/${triggerId}`;
  const transportTopic = `projects/${project.id}/topics/eventarc-${region.name}-${triggerId}-${rng.digits(3)}`;
  const subscription = `projects/${project.id}/subscriptions/eventarc-${region.name}-${triggerId}-sub-${rng.digits(3)}`;
  const eventType = 'google.cloud.storage.object.v1.finalized';
  addProjectAsset(b, project, {
    assetType: 'run.googleapis.com/Service',
    name: fullName('run.googleapis.com', servicePath),
    location: region.name,
    data: runServiceData(project, region, name, hash, {
      uid: uuid(rng),
      serviceAccount: input.fnAccount,
      ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY',
      image: `${region.name}-docker.pkg.dev/${project.id}/gcf-artifacts/${project.id.replaceAll('-', '--')}__${region.name.replaceAll('-', '--')}__${name.replaceAll('-', '--')}:version_2`,
      generation: rng.int(1, 9),
      labels: { ...standardLabels(project), 'goog-managed-by': 'cloudfunctions' },
    }),
  });
  addProjectAsset(b, project, {
    assetType: 'pubsub.googleapis.com/Topic',
    name: fullName('pubsub.googleapis.com', transportTopic),
    location: 'global',
    data: { name: transportTopic, labels: { 'goog-eventarc': '' } },
  });
  addProjectAsset(b, project, {
    assetType: 'pubsub.googleapis.com/Subscription',
    name: fullName('pubsub.googleapis.com', subscription),
    location: 'global',
    data: {
      name: subscription,
      topic: transportTopic,
      pushConfig: {
        pushEndpoint: uri,
        oidcToken: { serviceAccountEmail: input.fnAccount, audience: uri },
      },
      ackDeadlineSeconds: 10,
      messageRetentionDuration: '86400s',
      expirationPolicy: {},
      state: 'ACTIVE',
      labels: { 'goog-eventarc': '' },
    },
  });
  addProjectAsset(b, project, {
    assetType: 'eventarc.googleapis.com/Trigger',
    name: fullName('eventarc.googleapis.com', triggerPath),
    location: region.name,
    data: {
      name: triggerPath,
      uid: uuid(rng),
      eventFilters: [
        { attribute: 'type', value: eventType },
        { attribute: 'bucket', value: bucket },
      ],
      serviceAccount: input.fnAccount,
      destination: { cloudRun: { service: name, region: region.name, path: '/' } },
      transport: { pubsub: { topic: transportTopic, subscription } },
      labels: { 'goog-managed-by': 'cloudfunctions' },
      eventDataContentType: 'application/json',
      etag: rng.hex(16),
    },
  });
  const fnPath = `projects/${project.id}/locations/${region.name}/functions/${name}`;
  addProjectAsset(b, project, {
    assetType: 'cloudfunctions.googleapis.com/Function',
    name: fullName('cloudfunctions.googleapis.com', fnPath),
    location: region.name,
    data: {
      name: fnPath,
      description: `Indexes new objects in ${bucket}`,
      environment: 'GEN_2',
      state: 'ACTIVE',
      labels: standardLabels(project),
      url: `https://${region.name}-${project.id}.cloudfunctions.net/${name}`,
      buildConfig: {
        runtime: 'python312',
        entryPoint: 'index_object',
        source: {
          storageSource: {
            bucket: `gcf-v2-sources-${project.number}-${region.name}`,
            object: `${name}/function-source.zip`,
            generation: rng.digits(16),
          },
        },
        dockerRepository: `projects/${project.id}/locations/${region.name}/repositories/gcf-artifacts`,
        serviceAccount: `projects/${project.id}/serviceAccounts/${input.fnAccount}`,
      },
      serviceConfig: {
        service: servicePath,
        uri,
        serviceAccountEmail: input.fnAccount,
        ingressSettings: 'ALLOW_INTERNAL_ONLY',
        availableMemory: '512M',
        timeoutSeconds: 120,
        maxInstanceCount: 20,
        allTrafficOnLatestRevision: true,
      },
      eventTrigger: {
        trigger: triggerPath,
        triggerRegion: region.name,
        eventType,
        eventFilters: [{ attribute: 'bucket', value: bucket }],
        serviceAccountEmail: input.fnAccount,
        retryPolicy: 'RETRY_POLICY_RETRY',
      },
    },
  });
}
