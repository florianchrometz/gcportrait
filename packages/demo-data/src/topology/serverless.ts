// SPDX-License-Identifier: Apache-2.0
/**
 * A serverless workload in a Shared VPC service project: Cloud Run services that reach a Cloud SQL instance
 * on its private services access address through the host's Serverless VPC Access connector (or, for a
 * second service, Direct VPC egress), secrets, Pub/Sub topics, and Cloud Run functions triggered through
 * Eventarc (each function brings its trigger, the trigger's push subscription and the Cloud Run service the
 * function runs on).
 */
import { uuid } from '../core/ids.js';
import type { JsonObject } from '../core/json.js';
import { hostFor, type OrgContext } from './context.js';
import { addApiGateway } from './edge.js';
import { fabricFor } from './fabric.js';
import { has } from './features.js';
import {
  addProject,
  addProjectAsset,
  addServiceAccount,
  fullName,
  standardLabels,
  type ContainerCtx,
  type ProjectCtx,
} from './kit.js';
import { addSubnet, connectorFor, type HostNetwork } from './network.js';
import { addSecret } from './secrets.js';
import { addServerlessExtras } from './serverless-extras.js';
import { addBucket } from './storage.js';
import { addFirestore, addSqlBackups } from './stores.js';
import { FUNCTIONS, RUN_SERVICES, TOPICS, nth, type Env, type Region } from './vocabulary.js';
import { runServiceData, title } from './web.js';

export interface ServerlessProfile {
  readonly runServices: number;
  readonly functions: number;
  readonly topics: number;
  readonly sqlInstances: number;
  readonly secrets: boolean;
  /** The second Cloud Run service uses Direct VPC egress on its own host subnet. */
  readonly directVpcEgress: boolean;
  /** A pull subscription per topic that archives to a bucket, with a dead-letter topic. */
  readonly archiveSubscriptions: boolean;
}

export function addServerlessProject(
  ctx: OrgContext,
  folder: ContainerCtx,
  team: string,
  env: Env,
  region: Region,
): ProjectCtx {
  const { b, profile } = ctx;
  const sp = profile.serverless;
  const host = hostFor(ctx, env);
  const project = addProject(b, folder, {
    role: 'svc',
    displayName: `${title(team)} services (${env})`,
    env,
    region,
    team,
  });
  const rng = b.rng.fork(`svc:${project.id}`);
  const labels = standardLabels(project);
  const runAccount = addServiceAccount(b, project, 'run-services', 'Cloud Run services');
  const fnAccount = addServiceAccount(b, project, 'fn-runtime', 'Cloud Run functions and their triggers');
  const connector = connectorFor(host, region, project.id);
  const sqlKey = ctx.keys.key(region.name, 'sql');
  const pubsubKey = ctx.keys.key(region.name, 'pubsub');

  // Cloud SQL on the private services access range of the host network.
  const dataCases = has(profile, 'data');
  const fabric = fabricFor(ctx, host);
  const replicated = dataCases && env === 'prod' && sp.sqlInstances > 0 && ctx.once('sql-replica');
  const pscEnabled = dataCases && fabric !== undefined && sp.sqlInstances > 0 && ctx.once('sql-psc');
  const sqlConnections: string[] = [];
  const sqlNames: string[] = [];
  for (let i = 0; i < sp.sqlInstances; i++) {
    const app = nth(RUN_SERVICES, i).replace(/-api$/, '');
    const instance = `${app}-db`;
    const ip = host.psa.hosts.next();
    sqlNames.push(instance);
    sqlConnections.push(`${project.id}:${region.name}:${instance}`);
    const psc =
      i === 0 && pscEnabled
        ? {
            pscConfig: {
              pscEnabled: true,
              allowedConsumerProjects: [host.project.id],
              pscAutoConnections: [
                {
                  consumerProject: host.project.id,
                  consumerNetwork: host.path,
                  ipAddress: fabric.endpoints.hosts.next(),
                  status: 'ACTIVE',
                },
              ],
            },
          }
        : {};
    addProjectAsset(b, project, {
      assetType: 'sqladmin.googleapis.com/Instance',
      name: fullName('cloudsql.googleapis.com', `projects/${project.id}/instances/${instance}`),
      location: region.name,
      after: Math.max(project.createdAt, host.psa.createdAt),
      data: {
        kind: 'sql#instance',
        name: instance,
        project: project.id,
        connectionName: `${project.id}:${region.name}:${instance}`,
        databaseVersion: 'POSTGRES_16',
        databaseInstalledVersion: 'POSTGRES_16_4',
        region: region.name,
        gceZone: region.zones[0] ?? `${region.name}-a`,
        secondaryGceZone: region.zones[1] ?? `${region.name}-b`,
        state: 'RUNNABLE',
        instanceType: 'CLOUD_SQL_INSTANCE',
        backendType: 'SECOND_GEN',
        selfLink: `https://sqladmin.googleapis.com/sql/v1beta4/projects/${project.id}/instances/${instance}`,
        serviceAccountEmailAddress: `p${project.number}-${rng.chars('abcdefghijklmnopqrstuvwxyz0123456789', 6)}@gcp-sa-cloud-sql.iam.gserviceaccount.com`,
        ipAddresses: [{ type: 'PRIVATE', ipAddress: ip }],
        settings: {
          kind: 'sql#settings',
          tier: env === 'prod' ? 'db-custom-2-7680' : 'db-custom-1-3840',
          availabilityType: env === 'prod' ? 'REGIONAL' : 'ZONAL',
          dataDiskSizeGb: '100',
          dataDiskType: 'PD_SSD',
          activationPolicy: 'ALWAYS',
          pricingPlan: 'PER_USE',
          settingsVersion: String(rng.int(3, 30)),
          userLabels: labels,
          ipConfiguration: {
            ipv4Enabled: false,
            privateNetwork: `projects/${host.project.id}/global/networks/${host.name}`,
            allocatedIpRange: host.psa.rangeName,
            sslMode: 'ENCRYPTED_ONLY',
            requireSsl: true,
            ...psc,
          },
          backupConfiguration: {
            enabled: true,
            pointInTimeRecoveryEnabled: true,
            startTime: '02:00',
            transactionLogRetentionDays: 7,
          },
        },
        ...(sqlKey === undefined
          ? {}
          : { diskEncryptionConfiguration: { kind: 'sql#diskEncryptionConfiguration', kmsKeyName: sqlKey } }),
        ...(i === 0 && replicated ? { replicaNames: [`${instance}-replica`] } : {}),
      },
    });
    host.privateRecords.push({
      name: `${instance}.${team}.db.${host.privateZone}`,
      type: 'A',
      rrdatas: [ip],
    });
  }

  // Cloud Run services.
  const runExtras = has(profile, 'serverless') && sp.archiveSubscriptions && ctx.once('run-extras');
  const services: { readonly full: string; readonly data: JsonObject }[] = [];
  let directSubnet: { path: string; network: string } | undefined;
  for (let i = 0; i < sp.runServices; i++) {
    const name = nth(RUN_SERVICES, i);
    const hash = rng.chars('abcdefghijklmnopqrstuvwxyz', 10);
    const secretPath =
      sp.secrets && i < sqlConnections.length
        ? addSecret(ctx, project, `${name}-db-password`, region)
        : undefined;
    let vpcAccess: JsonObject = { connector: connector.path, egress: 'PRIVATE_RANGES_ONLY' };
    if (i === 1 && sp.directVpcEgress) {
      if (directSubnet === undefined) {
        const subnet = addSubnet(b, host, { region, name: `${project.id}-run-${region.name}`, prefix: 26 });
        directSubnet = { path: subnet.path, network: host.path };
      }
      vpcAccess = {
        networkInterfaces: [
          { network: directSubnet.network, subnetwork: directSubnet.path, tags: ['run-egress'] },
        ],
        egress: 'PRIVATE_RANGES_ONLY',
      };
    }
    const connection = sqlConnections[i];
    // The first service of the first serverless project also mounts the archive bucket and its secret as
    // files, and is CMEK-encrypted (Cloud Run v2 volumes and encryptionKey).
    const extras = i === 0 && runExtras;
    const runKey = extras ? ctx.keys.key(region.name, 'storage') : undefined;
    const extraVolumes: JsonObject[] = extras
      ? [
          { name: 'archive', gcs: { bucket: `${project.id}-event-archive`, readOnly: true } },
          ...(secretPath === undefined
            ? []
            : [
                {
                  name: 'db-secret',
                  secret: { secret: secretPath, items: [{ version: 'latest', path: 'password' }] },
                },
              ]),
        ]
      : [];
    const extraMounts: JsonObject[] = (
      extras ? ['archive', ...(secretPath === undefined ? [] : ['db-secret'])] : []
    ).map((volume) => ({ name: volume, mountPath: `/mnt/${volume}` }));
    const serviceFull = fullName(
      'run.googleapis.com',
      `projects/${project.id}/locations/${region.name}/services/${name}`,
    );
    const serviceData = runServiceData(project, region, name, hash, {
      uid: uuid(rng),
      serviceAccount: runAccount.email,
      ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY',
      image: `${region.name}-docker.pkg.dev/${project.id}/apps/${name}:1.${String(rng.int(0, 9))}.${String(rng.int(0, 20))}`,
      generation: rng.int(3, 60),
      vpcAccess,
      labels,
      ...(secretPath === undefined
        ? {}
        : {
            env: [
              {
                name: 'DB_PASSWORD',
                valueSource: { secretKeyRef: { secret: secretPath, version: 'latest' } },
              },
            ],
          }),
      ...(connection === undefined && extraVolumes.length === 0
        ? {}
        : {
            volumes: [
              ...(connection === undefined
                ? []
                : [{ name: 'cloudsql', cloudSqlInstance: { instances: [connection] } }]),
              ...extraVolumes,
            ],
            volumeMounts: [
              ...(connection === undefined ? [] : [{ name: 'cloudsql', mountPath: '/cloudsql' }]),
              ...extraMounts,
            ],
          }),
      ...(runKey === undefined ? {} : { encryptionKey: runKey }),
    });
    addProjectAsset(b, project, {
      assetType: 'run.googleapis.com/Service',
      name: serviceFull,
      location: region.name,
      data: serviceData,
    });
    services.push({ full: serviceFull, data: serviceData });
  }

  // Topics. In production the first one validates its messages against an Avro schema.
  const schema =
    has(profile, 'data') && env === 'prod' && sp.topics > 0
      ? addProjectAsset(b, project, {
          assetType: 'pubsub.googleapis.com/Schema',
          name: fullName('pubsub.googleapis.com', `projects/${project.id}/schemas/order-event`),
          location: 'global',
          data: {
            name: `projects/${project.id}/schemas/order-event`,
            type: 'AVRO',
            definition:
              '{"type":"record","name":"OrderEvent","fields":[{"name":"orderId","type":"string"},{"name":"amount","type":"double"}]}',
            revisionId: b.rng.fork(`schema:${project.id}`).hex(8),
          },
        })
      : undefined;
  const topics: string[] = [];
  for (let t = 0; t < sp.topics; t++) {
    const topic = nth(TOPICS, t);
    const path = `projects/${project.id}/topics/${topic}`;
    topics.push(path);
    addProjectAsset(b, project, {
      assetType: 'pubsub.googleapis.com/Topic',
      name: fullName('pubsub.googleapis.com', path),
      location: 'global',
      data: {
        name: path,
        labels,
        messageStoragePolicy: { allowedPersistenceRegions: [region.name] },
        messageRetentionDuration: '604800s',
        ...(pubsubKey === undefined ? {} : { kmsKeyName: pubsubKey }),
        ...(t === 0 && schema !== undefined
          ? { schemaSettings: { schema: `projects/${project.id}/schemas/order-event`, encoding: 'JSON' } }
          : {}),
      },
      ...(t === 0 && schema !== undefined ? { after: schema.createdAt } : {}),
    });
  }
  if (sp.archiveSubscriptions) {
    const bucket = addBucket(b, project, {
      name: `${project.id}-event-archive`,
      region,
      labels,
      storageClass: 'NEARLINE',
    });
    const deadLetter = `projects/${project.id}/topics/dead-letter`;
    addProjectAsset(b, project, {
      assetType: 'pubsub.googleapis.com/Topic',
      name: fullName('pubsub.googleapis.com', deadLetter),
      location: 'global',
      data: { name: deadLetter, labels, messageStoragePolicy: { allowedPersistenceRegions: [region.name] } },
    });
    for (const topic of topics) {
      const short = topic.slice(topic.lastIndexOf('/') + 1);
      const path = `projects/${project.id}/subscriptions/${short}-archive`;
      addProjectAsset(b, project, {
        assetType: 'pubsub.googleapis.com/Subscription',
        name: fullName('pubsub.googleapis.com', path),
        location: 'global',
        after: bucket.createdAt,
        data: {
          name: path,
          topic,
          cloudStorageConfig: {
            bucket: `${project.id}-event-archive`,
            filenamePrefix: `${short}/`,
            maxDuration: '300s',
            state: 'ACTIVE',
          },
          deadLetterPolicy: { deadLetterTopic: deadLetter, maxDeliveryAttempts: 10 },
          ackDeadlineSeconds: 60,
          messageRetentionDuration: '604800s',
          expirationPolicy: {},
          state: 'ACTIVE',
          labels,
        },
      });
    }
  }

  // Cloud Run functions, each with its Eventarc trigger, push subscription and underlying service.
  for (let f = 0; f < sp.functions; f++) {
    const name = nth(FUNCTIONS, f);
    const topic = topics.length === 0 ? undefined : topics[f % topics.length];
    if (topic === undefined) break;
    const hash = rng.chars('abcdefghijklmnopqrstuvwxyz', 10);
    const triggerId = `${name}-${rng.digits(6)}`;
    const triggerPath = `projects/${project.id}/locations/${region.name}/triggers/${triggerId}`;
    const subscription = `projects/${project.id}/subscriptions/eventarc-${region.name}-${triggerId}-sub-${rng.digits(3)}`;
    const servicePath = `projects/${project.id}/locations/${region.name}/services/${name}`;
    const fnUri = `https://${name}-${hash}-${region.runCode}.a.run.app`;
    addProjectAsset(b, project, {
      assetType: 'run.googleapis.com/Service',
      name: fullName('run.googleapis.com', servicePath),
      location: region.name,
      data: runServiceData(project, region, name, hash, {
        uid: uuid(rng),
        serviceAccount: fnAccount.email,
        ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY',
        image: `${region.name}-docker.pkg.dev/${project.id}/gcf-artifacts/${project.id.replaceAll('-', '--')}__${region.name.replaceAll('-', '--')}__${name.replaceAll('-', '--')}:version_${String(rng.int(1, 9))}`,
        generation: rng.int(1, 9),
        vpcAccess: { connector: connector.path, egress: 'PRIVATE_RANGES_ONLY' },
        labels: { ...labels, 'goog-managed-by': 'cloudfunctions' },
      }),
    });
    addProjectAsset(b, project, {
      assetType: 'eventarc.googleapis.com/Trigger',
      name: fullName('eventarc.googleapis.com', triggerPath),
      location: region.name,
      data: {
        name: triggerPath,
        uid: uuid(rng),
        eventFilters: [{ attribute: 'type', value: 'google.cloud.pubsub.topic.v1.messagePublished' }],
        serviceAccount: fnAccount.email,
        destination: { cloudRun: { service: name, region: region.name, path: '/' } },
        transport: { pubsub: { topic, subscription } },
        labels: { 'goog-managed-by': 'cloudfunctions' },
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
          pushEndpoint: `${fnUri}?__GCP_CloudEventsMode=CUSTOM_PUBSUB_${topic.replaceAll('/', '%2F')}`,
          oidcToken: { serviceAccountEmail: fnAccount.email, audience: fnUri },
        },
        ackDeadlineSeconds: 10,
        messageRetentionDuration: '86400s',
        expirationPolicy: {},
        retryPolicy: { minimumBackoff: '10s', maximumBackoff: '600s' },
        state: 'ACTIVE',
        labels: { 'goog-eventarc': '' },
      },
    });
    const fnPath = `projects/${project.id}/locations/${region.name}/functions/${name}`;
    addProjectAsset(b, project, {
      assetType: 'cloudfunctions.googleapis.com/Function',
      name: fullName('cloudfunctions.googleapis.com', fnPath),
      location: region.name,
      data: {
        name: fnPath,
        description: `Handles messages on ${topic.slice(topic.lastIndexOf('/') + 1)}`,
        environment: 'GEN_2',
        state: 'ACTIVE',
        labels,
        url: `https://${region.name}-${project.id}.cloudfunctions.net/${name}`,
        buildConfig: {
          runtime: 'nodejs22',
          entryPoint: name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
          source: {
            storageSource: {
              bucket: `gcf-v2-sources-${project.number}-${region.name}`,
              object: `${name}/function-source.zip`,
              generation: rng.digits(16),
            },
          },
          dockerRepository: `projects/${project.id}/locations/${region.name}/repositories/gcf-artifacts`,
          serviceAccount: `projects/${project.id}/serviceAccounts/${fnAccount.email}`,
        },
        serviceConfig: {
          service: servicePath,
          uri: fnUri,
          serviceAccountEmail: fnAccount.email,
          vpcConnector: connector.path,
          vpcConnectorEgressSettings: 'PRIVATE_RANGES_ONLY',
          ingressSettings: 'ALLOW_INTERNAL_ONLY',
          availableMemory: '256M',
          availableCpu: '0.1666',
          timeoutSeconds: 60,
          maxInstanceCount: 100,
          maxInstanceRequestConcurrency: 1,
          revision: `${name}-0000${String(rng.int(1, 9))}-${rng.chars('abcdefghijklmnopqrstuvwxyz', 3)}`,
          allTrafficOnLatestRevision: true,
        },
        eventTrigger: {
          trigger: triggerPath,
          triggerRegion: region.name,
          eventType: 'google.cloud.pubsub.topic.v1.messagePublished',
          pubsubTopic: topic,
          serviceAccountEmail: fnAccount.email,
          retryPolicy: 'RETRY_POLICY_DO_NOT_RETRY',
        },
      },
    });
  }

  // Short-lived debugging subscriptions come and go during the window.
  const firstTopic = topics[0];
  if (firstTopic !== undefined) {
    b.ephemerals.push({
      kind: 'debug-subscription',
      weight: 1,
      notBefore: project.createdAt,
      make: (createdAt, serial) => {
        const path = `projects/${project.id}/subscriptions/debug-${String(serial)}`;
        return [
          b.make(
            {
              assetType: 'pubsub.googleapis.com/Subscription',
              name: fullName('pubsub.googleapis.com', path),
              parent: project.full,
              ancestors: project.ancestors,
              location: 'global',
              data: {
                name: path,
                topic: firstTopic,
                ackDeadlineSeconds: 10,
                messageRetentionDuration: '3600s',
                expirationPolicy: { ttl: '86400s' },
                state: 'ACTIVE',
                labels: { purpose: 'debugging' },
              },
              after: createdAt,
            },
            createdAt,
          ),
        ];
      },
    });
  }
  if (has(profile, 'serverless')) {
    addServerlessExtras(ctx, {
      project,
      region,
      host,
      runAccount: runAccount.email,
      fnAccount: fnAccount.email,
      connector: connector.path,
      sqlConnections,
      services,
      topics,
      functions: sp.functions,
      archive: sp.archiveSubscriptions ? `${project.id}-event-archive` : undefined,
    });
  }
  if (dataCases) {
    if (replicated) addSqlReplica(ctx, project, region, host, sqlNames[0] ?? 'orders-db', sqlKey);
    if (sqlNames[0] !== undefined && ctx.once(`sql-backups:${env}`))
      addSqlBackups(ctx, project, region, sqlNames[0], sqlKey, project.createdAt);
    if (ctx.once(`firestore:${env}`)) addFirestore(ctx, project, region);
  }
  const firstService = services[0];
  if (has(profile, 'edge') && env === 'prod' && firstService !== undefined && ctx.once('api-gateway'))
    addApiGateway(ctx, project, region, runAccount.email, firstService.full);
  ctx.inventory.serverless.push({
    project,
    region,
    sql: sqlConnections,
    services: services.map((service) => service.full),
    topics,
  });
  ctx.perimeterCandidates.serverless.push(project);
  return project;
}

/** A cross-zone read replica of the project's first Cloud SQL instance. */
function addSqlReplica(
  ctx: OrgContext,
  project: ProjectCtx,
  region: Region,
  host: HostNetwork,
  primary: string,
  kmsKey: string | undefined,
): void {
  const name = `${primary}-replica`;
  addProjectAsset(ctx.b, project, {
    assetType: 'sqladmin.googleapis.com/Instance',
    name: fullName('cloudsql.googleapis.com', `projects/${project.id}/instances/${name}`),
    location: region.name,
    after: Math.max(project.createdAt, host.psa.createdAt),
    data: {
      kind: 'sql#instance',
      name,
      project: project.id,
      connectionName: `${project.id}:${region.name}:${name}`,
      databaseVersion: 'POSTGRES_16',
      databaseInstalledVersion: 'POSTGRES_16_4',
      region: region.name,
      gceZone: region.zones[1] ?? `${region.name}-b`,
      state: 'RUNNABLE',
      instanceType: 'READ_REPLICA_INSTANCE',
      masterInstanceName: `${project.id}:${primary}`,
      backendType: 'SECOND_GEN',
      selfLink: `https://sqladmin.googleapis.com/sql/v1beta4/projects/${project.id}/instances/${name}`,
      ipAddresses: [{ type: 'PRIVATE', ipAddress: host.psa.hosts.next() }],
      settings: {
        kind: 'sql#settings',
        tier: 'db-custom-2-7680',
        availabilityType: 'ZONAL',
        dataDiskSizeGb: '100',
        dataDiskType: 'PD_SSD',
        activationPolicy: 'ALWAYS',
        pricingPlan: 'PER_USE',
        settingsVersion: '4',
        userLabels: standardLabels(project, { role: 'read-replica' }),
        ipConfiguration: {
          ipv4Enabled: false,
          privateNetwork: host.path,
          allocatedIpRange: host.psa.rangeName,
          sslMode: 'ENCRYPTED_ONLY',
          requireSsl: true,
        },
      },
      replicaConfiguration: { kind: 'sql#replicaConfiguration', failoverTarget: false },
      ...(kmsKey === undefined
        ? {}
        : { diskEncryptionConfiguration: { kind: 'sql#diskEncryptionConfiguration', kmsKeyName: kmsKey } }),
    },
  });
}
