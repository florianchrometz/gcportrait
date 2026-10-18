// SPDX-License-Identifier: Apache-2.0
/**
 * A machine-learning workload in a Shared VPC service project (archetype `ml`, run by the first business
 * unit from M up): a Vertex AI Workbench instance (and the Compute Engine VM it is), a Cloud TPU node, a GPU
 * reservation, Vertex AI datasets (images in a bucket, a table of the warehouse), a model served from an
 * Artifact Registry image, a peered endpoint and a Private Service Connect endpoint, a deployment resource
 * pool, a vector index with its peered index endpoint, an agent (Agent Engine) on a PSC interface into the
 * host's network attachment, Colab Enterprise runtime templates and runtimes, Vertex AI Search (collection ›
 * data store, search and chat engines › assistant), a Dialogflow CX agent and a Document AI invoice
 * processor with its version.
 */
import type { JsonObject } from '../core/json.js';
import {
  addCompute,
  addProject,
  addProjectAsset,
  addServiceAccount,
  computeSelfLink,
  fullName,
  standardLabels,
  type ContainerCtx,
  type ProjectCtx,
} from './kit.js';
import { addInstance } from './compute.js';
import { hostFor, type OrgContext } from './context.js';
import { fabricFor, uuidFrom } from './fabric.js';
import { addSubnet } from './network.js';
import { addBucket } from './storage.js';
import type { Env, Region } from './vocabulary.js';
import { title } from './web.js';

const AI = 'aiplatform.googleapis.com';

export function addMlProject(
  ctx: OrgContext,
  folder: ContainerCtx,
  team: string,
  env: Env,
  region: Region,
): ProjectCtx {
  const { b } = ctx;
  const host = hostFor(ctx, env);
  const fabric = fabricFor(ctx, host);
  const project = addProject(b, folder, {
    role: 'ml',
    displayName: `${title(team)} machine learning (${env})`,
    env,
    region,
    team,
  });
  const rng = b.rng.fork(`ml:${project.id}`);
  const labels = standardLabels(project);
  const zone = region.zones[0] ?? `${region.name}-a`;
  const subnet = addSubnet(b, host, { region, name: `${project.id}-${region.name}`, prefix: 24 });
  const account = addServiceAccount(b, project, 'vertex-runner', 'Vertex AI pipelines, endpoints and agents');
  const storageKey = ctx.keys.key(region.name, 'storage');
  const computeKey = ctx.keys.key(region.name, 'compute');
  const encryption: JsonObject =
    storageKey === undefined ? {} : { encryptionSpec: { kmsKeyName: storageKey } };
  const bucket = `${project.id}-ml-artifacts`;
  addBucket(b, project, {
    name: bucket,
    region,
    labels,
    ...(storageKey === undefined ? {} : { kmsKey: storageKey }),
  });
  const hostNetworkByNumber = `projects/${host.project.number}/global/networks/${host.name}`;
  const base = `projects/${project.number}/locations/${region.name}`;
  const id = (label: string): string => b.rng.fork(`ml-id:${project.id}/${label}`).digits(19);
  const vertex = (kind: string, path: string, data: JsonObject, after?: number): number =>
    addProjectAsset(b, project, {
      assetType: `${AI}/${kind}`,
      name: fullName(AI, path),
      location: region.name,
      data: { name: path, labels, ...data },
      ...(after === undefined ? {} : { after }),
    }).createdAt;

  // Vertex AI Workbench: the instance and the Compute Engine VM it runs on.
  const workbench = `${team}-workbench`;
  const vmKey = ctx.keys.keyVersion(region.name, 'compute');
  addInstance(b, project, {
    zone,
    name: workbench,
    machineType: 'n2-standard-8',
    nic: { network: host.selfLink, subnetwork: subnet.selfLink, ip: subnet.hosts.next() },
    serviceAccount: account.email,
    tags: ['deeplearning-vm', 'notebook-instance'],
    labels: { ...labels, 'goog-workbench-instance': workbench },
    diskSizeGb: 150,
    after: subnet.createdAt,
    ...(vmKey === undefined ? {} : { kmsKeyVersion: vmKey }),
  });
  addProjectAsset(b, project, {
    assetType: 'notebooks.googleapis.com/Instance',
    name: fullName(
      'notebooks.googleapis.com',
      `projects/${project.id}/locations/${zone}/instances/${workbench}`,
    ),
    location: zone,
    after: subnet.createdAt,
    data: {
      name: `projects/${project.id}/locations/${zone}/instances/${workbench}`,
      gceSetup: {
        machineType: `https://www.googleapis.com/compute/v1/projects/${project.id}/zones/${zone}/machineTypes/n2-standard-8`,
        networkInterfaces: [{ network: host.path, subnet: subnet.path, nicType: 'GVNIC' }],
        serviceAccounts: [{ email: account.email }],
        bootDisk: {
          diskType: 'PD_BALANCED',
          diskSizeGb: '150',
          diskEncryption: computeKey === undefined ? 'GMEK' : 'CMEK',
          ...(computeKey === undefined ? {} : { kmsKey: computeKey }),
        },
        disablePublicIp: true,
        vmImage: { project: 'cloud-notebooks-managed', family: 'workbench-instances' },
      },
      proxyUri: `${rng.hex(16)}-dot-${region.name}.notebooks.googleusercontent.com`,
      state: 'ACTIVE',
      creator: 'analyst@example.com',
      healthState: 'HEALTHY',
      labels,
    },
  });

  // A Cloud TPU node on the Shared VPC (serving), and a GPU reservation the endpoints consume.
  addProjectAsset(b, project, {
    assetType: 'tpu.googleapis.com/Node',
    name: fullName(
      'tpu.googleapis.com',
      `projects/${project.number}/locations/${zone}/nodes/${team}-serve-v5e`,
    ),
    location: zone,
    after: subnet.createdAt,
    data: {
      name: `projects/${project.id}/locations/${zone}/nodes/${team}-serve-v5e`,
      description: 'Batch inference for the recommendation model',
      acceleratorType: 'v5litepod-8',
      runtimeVersion: 'v2-alpha-tpuv5-lite',
      state: 'READY',
      health: 'HEALTHY',
      networkConfig: { network: host.path, subnetwork: subnet.path, enableExternalIps: false },
      serviceAccount: { email: account.email, scope: ['https://www.googleapis.com/auth/cloud-platform'] },
      networkEndpoints: [{ ipAddress: subnet.hosts.next(), port: 8470 }],
      schedulingConfig: { reserved: false },
      labels,
    },
  });
  const reservation = addCompute(b, project, {
    kind: 'Reservation',
    collection: 'reservations',
    scope: { zone },
    name: 'gpu-l4',
    data: {
      description: 'L4 GPUs for the online endpoints',
      specificReservation: {
        count: '2',
        inUseCount: '1',
        instanceProperties: {
          machineType: 'g2-standard-8',
          guestAccelerators: [{ acceleratorType: 'nvidia-l4', acceleratorCount: 1 }],
        },
      },
      specificReservationRequired: true,
      status: 'READY',
      shareSettings: { shareType: 'LOCAL' },
    },
  });
  const reservationPath = `projects/${project.id}/zones/${zone}/reservations/${reservation.name}`;

  // Datasets, a model and the endpoints that serve it.
  const source = ctx.inventory.data.find((d) => d.project.env === env);
  vertex('Dataset', `${base}/datasets/${id('images')}`, {
    displayName: 'Product photos',
    metadataSchemaUri: 'gs://google-cloud-aiplatform/schema/dataset/metadata/image_1.0.0.yaml',
    metadata: {
      dataItemSchemaUri: 'gs://google-cloud-aiplatform/schema/dataset/dataitem/image_1.0.0.yaml',
      gcsBucket: bucket,
    },
    dataItemCount: '12480',
    ...encryption,
  });
  if (source !== undefined) {
    vertex(
      'Dataset',
      `${base}/datasets/${id('orders')}`,
      {
        displayName: 'Orders (warehouse)',
        metadataSchemaUri: 'gs://google-cloud-aiplatform/schema/dataset/metadata/tabular_1.0.0.yaml',
        metadata: {
          inputConfig: {
            bigquerySource: { uri: `bq://${source.project.id}.${source.dataset}.${source.table}` },
          },
        },
        ...encryption,
      },
      Math.max(project.createdAt, b.referenced(source.tableName)),
    );
  }
  const model = `${base}/models/${id('model')}`;
  const modelCreated = vertex('Model', model, {
    displayName: 'churn-classifier',
    versionId: '3',
    versionAliases: ['default', 'champion'],
    containerSpec: {
      imageUri: `${region.name}-docker.pkg.dev/${project.id}/models/churn-serving:3.0.1`,
      ports: [{ containerPort: 8080 }],
    },
    artifactUri: `gs://${bucket}/models/churn/3`,
    ...encryption,
  });
  const pool = `${base}/deploymentResourcePools/shared-cpu`;
  vertex('DeploymentResourcePool', pool, {
    dedicatedResources: {
      machineSpec: { machineType: 'n2-standard-8' },
      minReplicaCount: 1,
      maxReplicaCount: 4,
    },
    serviceAccount: account.email,
    ...encryption,
  });
  vertex(
    'Endpoint',
    `${base}/endpoints/${id('endpoint-peered')}`,
    {
      displayName: 'churn',
      description: 'Online churn scores on the Shared VPC (peered)',
      network: hostNetworkByNumber,
      deployedModels: [
        {
          id: id('deployed-churn'),
          model,
          displayName: 'churn-classifier-v3',
          serviceAccount: account.email,
          dedicatedResources: {
            machineSpec: {
              machineType: 'g2-standard-8',
              acceleratorType: 'NVIDIA_L4',
              acceleratorCount: 1,
              reservationAffinity: {
                reservationAffinityType: 'SPECIFIC_RESERVATION',
                key: 'compute.googleapis.com/reservation-name',
                values: [reservationPath],
              },
            },
            minReplicaCount: 1,
            maxReplicaCount: 2,
          },
          privateEndpoints: {
            predictHttpUri: `https://${region.name}-aiplatform.googleapis.com/v1/${base}/endpoints/${id('endpoint-peered')}:predict`,
          },
        },
      ],
      ...encryption,
    },
    modelCreated,
  );
  if (fabric !== undefined) {
    const pscIp = fabric.endpoints.hosts.next();
    const rule = addCompute(b, project, {
      kind: 'ForwardingRule',
      collection: 'forwardingRules',
      scope: { region: region.name },
      name: `sca-auto-fr-${rng.hex(8)}`,
      after: fabric.endpoints.createdAt,
      data: {
        description: 'Private Service Connect endpoint of the recommendations endpoint',
        IPAddress: pscIp,
        target: computeSelfLink(
          `${rng.hex(14)}-tp`,
          `regions/${region.name}/serviceAttachments/sa-${rng.hex(10)}`,
        ),
        network: host.selfLink,
        subnetwork: fabric.endpoints.selfLink,
        loadBalancingScheme: '',
        pscConnectionStatus: 'ACCEPTED',
        labelFingerprint: '42WmSpB8rSM=',
        fingerprint: 'Hq0vL3dNs8c=',
      },
    });
    const pscEndpoint = id('endpoint-psc');
    vertex(
      'Endpoint',
      `${base}/endpoints/${pscEndpoint}`,
      {
        displayName: 'recommendations',
        description: 'Recommendations for the storefronts, over Private Service Connect',
        privateServiceConnectConfig: {
          enablePrivateServiceConnect: true,
          projectAllowlist: [
            project.id,
            ...ctx.inventory.web
              .filter((w) => w.project.env === env)
              .slice(0, 2)
              .map((w) => w.project.id),
          ],
          pscAutomationConfigs: [
            {
              projectId: project.id,
              network: hostNetworkByNumber,
              ipAddress: pscIp,
              forwardingRule: rule.selfLink,
              state: 'PSC_AUTOMATION_STATE_SUCCESSFUL',
            },
          ],
        },
        dedicatedEndpointEnabled: true,
        dedicatedEndpointDns: `${pscEndpoint}.${region.name}-${project.number}.prediction.vertexai.goog`,
        deployedModels: [
          { id: id('deployed-reco'), model, displayName: 'recommendations-v3', sharedResources: pool },
        ],
        ...encryption,
      },
      modelCreated,
    );
  }
  const index = `${base}/indexes/${id('index')}`;
  vertex('Index', index, {
    displayName: 'product-embeddings',
    indexUpdateMethod: 'STREAM_UPDATE',
    metadataSchemaUri:
      'gs://google-cloud-aiplatform/schema/matchingengine/metadata/nearest_neighbor_search_1.0.0.yaml',
    metadata: {
      config: {
        dimensions: 768,
        approximateNeighborsCount: 150,
        distanceMeasureType: 'DOT_PRODUCT_DISTANCE',
      },
    },
    ...encryption,
  });
  vertex('IndexEndpoint', `${base}/indexEndpoints/${id('index-endpoint')}`, {
    displayName: 'product-search',
    network: hostNetworkByNumber,
    deployedIndexes: [
      {
        id: 'product_embeddings_v1',
        index,
        displayName: 'product-embeddings-v1',
        privateEndpoints: { matchGrpcAddress: host.psa.hosts.next() },
      },
    ],
    ...encryption,
  });

  // An agent on Agent Engine with a PSC interface into the host's network attachment.
  const attachment = fabric?.attachment;
  if (attachment !== undefined) attachment.consumers.push({ project, ip: attachment.subnet.hosts.next() });
  vertex('ReasoningEngine', `${base}/reasoningEngines/${id('agent')}`, {
    displayName: 'support-agent',
    description: 'Answers order questions with the order and shipping APIs',
    spec: {
      agentFramework: 'google-adk',
      serviceAccount: account.email,
      packageSpec: {
        pickleObjectGcsUri: `gs://${bucket}/agents/support/agent.pkl`,
        requirementsGcsUri: `gs://${bucket}/agents/support/requirements.txt`,
        pythonVersion: '3.12',
      },
      ...(attachment === undefined
        ? {}
        : { deploymentSpec: { pscInterfaceConfig: { networkAttachment: attachment.path } } }),
    },
    ...encryption,
  });

  // Colab Enterprise: a private runtime template, a running runtime and a stopped one (hidden).
  const template = `${base}/notebookRuntimeTemplates/private-e2`;
  const network = { network: host.path, subnetwork: subnet.path, enableInternetAccess: false };
  vertex('NotebookRuntimeTemplate', template, {
    displayName: 'Private e2',
    machineSpec: { machineType: 'e2-standard-4' },
    networkSpec: network,
    notebookRuntimeType: 'USER_DEFINED',
    ...encryption,
  });
  for (const [owner, state] of [
    ['analyst', 'RUNNING'],
    ['intern', 'STOPPED'],
  ] as const) {
    vertex('NotebookRuntime', `${base}/notebookRuntimes/${id(`runtime-${owner}`)}`, {
      displayName: `${owner}-runtime`,
      runtimeUser: `${owner}@example.com`,
      notebookRuntimeTemplateRef: { notebookRuntimeTemplate: template },
      proxyUri: `${rng.hex(16)}-dot-${region.name}.colab.googleusercontent.com`,
      runtimeState: state,
      healthState: state === 'RUNNING' ? 'HEALTHY' : 'HEALTH_STATE_UNSPECIFIED',
      machineSpec: { machineType: 'e2-standard-4' },
      networkSpec: network,
      notebookRuntimeType: 'USER_DEFINED',
      ...encryption,
    });
  }

  // Vertex AI Search with a chat engine on a Dialogflow CX agent, and Document AI.
  const agent = `projects/${project.id}/locations/global/agents/${uuidFrom(b, `${project.id}/support-agent`)}`;
  addProjectAsset(b, project, {
    assetType: 'dialogflow.googleapis.com/Agent',
    name: fullName('dialogflow.googleapis.com', agent),
    location: 'global',
    data: {
      name: agent,
      displayName: 'Customer support',
      defaultLanguageCode: 'en',
      supportedLanguageCodes: ['de', 'fr'],
      timeZone: 'Europe/Berlin',
      enableStackdriverLogging: true,
    },
  });
  const collection = `projects/${project.number}/locations/eu/collections/default_collection`;
  const discovery = (kind: string, path: string, data: JsonObject): void => {
    addProjectAsset(b, project, {
      assetType: `discoveryengine.googleapis.com/${kind}`,
      name: fullName('discoveryengine.googleapis.com', path),
      location: 'eu',
      data: { name: path, ...data },
    });
  };
  discovery('Collection', collection, { displayName: 'Default Collection' });
  discovery('DataStore', `${collection}/dataStores/product-docs`, {
    displayName: 'Product documentation',
    industryVertical: 'GENERIC',
    contentConfig: 'CONTENT_REQUIRED',
    solutionTypes: ['SOLUTION_TYPE_SEARCH'],
    defaultSchemaId: 'default_schema',
  });
  const engines = `${collection}/engines`;
  discovery('Engine', `${engines}/product-search`, {
    displayName: 'Product search',
    solutionType: 'SOLUTION_TYPE_SEARCH',
    dataStoreIds: ['product-docs'],
    searchEngineConfig: { searchTier: 'SEARCH_TIER_ENTERPRISE', searchAddOns: ['SEARCH_ADD_ON_LLM'] },
    industryVertical: 'GENERIC',
  });
  discovery('Engine', `${engines}/support-chat`, {
    displayName: 'Support chat',
    solutionType: 'SOLUTION_TYPE_CHAT',
    dataStoreIds: ['product-docs'],
    chatEngineMetadata: { dialogflowAgent: agent },
    industryVertical: 'GENERIC',
  });
  discovery('Assistant', `${engines}/product-search/assistants/default_assistant`, {
    displayName: 'Default assistant',
    generationConfig: { defaultModelId: 'gemini-2.5-flash' },
  });
  const processor = `projects/${project.number}/locations/eu/processors/${rng.hex(16)}`;
  addProjectAsset(b, project, {
    assetType: 'documentai.googleapis.com/Processor',
    name: fullName('documentai.googleapis.com', processor),
    location: 'eu',
    data: {
      name: processor,
      type: 'INVOICE_PROCESSOR',
      displayName: 'Supplier invoices',
      state: 'ENABLED',
      defaultProcessorVersion: `${processor}/processorVersions/pretrained-invoice-v2.0-2023-12-06`,
      processEndpoint: `https://eu-documentai.googleapis.com/v1/${processor}:process`,
    },
  });
  addProjectAsset(b, project, {
    assetType: 'documentai.googleapis.com/ProcessorVersion',
    name: fullName(
      'documentai.googleapis.com',
      `${processor}/processorVersions/pretrained-invoice-v2.0-2023-12-06`,
    ),
    location: 'eu',
    data: {
      name: `${processor}/processorVersions/pretrained-invoice-v2.0-2023-12-06`,
      displayName: 'Google pretrained invoice parser',
      state: 'DEPLOYED',
      googleManaged: true,
    },
  });
  return project;
}
