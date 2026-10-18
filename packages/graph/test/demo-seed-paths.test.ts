// SPDX-License-Identifier: Apache-2.0
/**
 * Verifies that the demo data generator covers every data path read by catalog rules (relations, nestsIn,
 * contains, IPs, domains, aliases, and display templates) for all asset types emitted in the XL organisation.
 *
 * Optional GCP features intentionally omitted from the synthetic topology are recorded in the allowlist below.
 */
import { catalog, evaluateJsonPath, parseTemplate } from '@gcportrait/catalog';
import { generateOrganization } from '@gcportrait/demo-data';
import type { Asset } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

/**
 * Catalog data paths for generated asset types that are optional in GCP and intentionally not instantiated
 * in the synthetic demo organisation.
 */
const OPTIONAL_CATALOG_PATHS: Readonly<Record<string, readonly string[]>> = {
  "aiplatform.googleapis.com/Dataset": [
    "$.data.metadata.inputConfig.gcsSource.uri[*]",
  ],
  "aiplatform.googleapis.com/DeploymentResourcePool": [
    "$.data.dedicatedResources.machineSpec.reservationAffinity.values[*]",
  ],
  "aiplatform.googleapis.com/Endpoint": [
    "$.data.predictRequestResponseLoggingConfig.bigqueryDestination.outputUri",
  ],
  "aiplatform.googleapis.com/IndexEndpoint": [
    "$.data.deployedIndexes[*].privateEndpoints.pscAutomatedEndpoints[*].matchAddress",
    "$.data.deployedIndexes[*].pscAutomationConfigs[*].forwardingRule",
    "$.data.deployedIndexes[*].pscAutomationConfigs[*].ipAddress",
    "$.data.deployedIndexes[*].pscAutomationConfigs[*].network",
    "$.data.privateServiceConnectConfig.projectAllowlist[*]",
    "$.data.publicEndpointDomainName",
  ],
  "aiplatform.googleapis.com/ReasoningEngine": [
    "$.data.spec.containerSpec.imageUri",
    "$.data.spec.sourceCodeSpec.developerConnectSource.config.gitRepositoryLink",
  ],
  "alloydb.googleapis.com/Cluster": [
    "$.data.network",
  ],
  "alloydb.googleapis.com/Instance": [
    "$.data.outboundPublicIpAddresses[*]",
    "$.data.pscInstanceConfig.pscAutoConnections[*].consumerNetwork",
    "$.data.pscInstanceConfig.pscAutoConnections[*].ipAddress",
    "$.data.pscInstanceConfig.pscInterfaceConfigs[*].networkAttachmentResource",
    "$.data.publicIpAddress",
  ],
  "analyticshub.googleapis.com/Listing": [
    "$.data.bigqueryDataset.selectedResources[*].table",
    "$.data.pubsubTopic.topic",
  ],
  "apigee.googleapis.com/Organization": [
    "$.data.controlPlaneEncryptionKeyName",
  ],
  "apps.k8s.io/DaemonSet": [
    "$.data.spec.template.spec.containers[*].image",
    "$.data.spec.template.spec.containers[0].image",
  ],
  "artifactregistry.googleapis.com/Repository": [
    "$.data.remoteRepositoryConfig.*.customRepository.uri",
    "$.data.remoteRepositoryConfig.commonRepository.uri",
    "$.data.remoteRepositoryConfig.upstreamCredentials.usernamePasswordCredentials.passwordSecretVersion",
    "$.data.virtualRepositoryConfig.upstreamPolicies[*].repository",
  ],
  "backupdr.googleapis.com/DataSource": [
    "$.data[?(@.type == 'alloydb.googleapis.com/Cluster')].gcpResourcename",
    "$.data[?(@.type == 'file.googleapis.com/Instance')].gcpResourcename",
  ],
  "batch.googleapis.com/Job": [
    "$.data.allocationPolicy.instances[*].instanceTemplate",
  ],
  "bigquery.googleapis.com/Table": [
    "$.data.biglakeConfiguration.storageUri",
    "$.data.cloneDefinition.baseTableReference",
  ],
  "bigquerydatatransfer.googleapis.com/TransferConfig": [
    "$.data.encryptionConfiguration.kmsKeyName",
    "$.data.notificationPubsubTopic",
  ],
  "binaryauthorization.googleapis.com/Policy": [
    "$.data.clusterAdmissionRules.*.requireAttestationsBy[*]",
    "$.data.istioServiceIdentityAdmissionRules.*.requireAttestationsBy[*]",
    "$.data.kubernetesNamespaceAdmissionRules.*.requireAttestationsBy[*]",
    "$.data.kubernetesServiceAccountAdmissionRules.*.requireAttestationsBy[*]",
  ],
  "certificatemanager.googleapis.com/Certificate": [
    "$.data.managed.issuanceConfig",
  ],
  "cloudbilling.googleapis.com/BillingAccount": [
    "$.data.masterBillingAccount",
  ],
  "cloudbuild.googleapis.com/Build": [
    "$.data.source.connectedRepository.repository",
    "$.data.source.developerConnectConfig.gitRepositoryLink",
  ],
  "cloudbuild.googleapis.com/BuildTrigger": [
    "$.data.bitbucketServerTriggerConfig.bitbucketServerConfigResource",
    "$.data.developerConnectEventConfig.gitRepositoryLink",
    "$.data.github.enterpriseConfigResourceName",
    "$.data.pubsubConfig.topic",
    "$.data.sourceToBuild.repository",
    "$.data.sourceToBuild.uri",
    "$.data.webhookConfig.secret",
  ],
  "cloudbuild.googleapis.com/Connection": [
    "$.data.*.serviceDirectoryConfig.service",
    "$.data.*['authorizerCredential', 'readAuthorizerCredential']['oauthTokenSecretVersion', 'userTokenSecretVersion']",
  ],
  "cloudbuild.googleapis.com/WorkerPool": [
    "$.data.privatePoolV1Config.privateServiceConnect.networkAttachment",
  ],
  "clouddeploy.googleapis.com/DeliveryPipeline": [
    "$.data.serialPipeline.stages[2].targetId",
  ],
  "clouddeploy.googleapis.com/Release": [
    "$.data.skaffoldConfigUri",
  ],
  "clouddeploy.googleapis.com/Rollout": [
    "$.data.deployingBuild",
  ],
  "clouddeploy.googleapis.com/Target": [
    "$.data.anthosCluster.membership",
    "$.data.associatedEntities.*.anthosClusters[*].membership",
    "$.data.associatedEntities.*.gkeClusters[*].cluster",
    "$.data.customTarget.customTargetType",
    "$.data.executionConfigs[*].privatePool.workerPool",
    "$.data.executionConfigs[*]['defaultPool', 'privatePool'].artifactStorage",
    "$.data.executionConfigs[*]['defaultPool', 'privatePool'].serviceAccount",
    "$.data.multiTarget.targetIds[*]",
  ],
  "cloudfunctions.googleapis.com/Function": [
    "$.data.buildConfig.workerPool",
    "$.data.kmsKeyName",
  ],
  "cloudkms.googleapis.com/CryptoKey": [
    "$.data.cryptoKeyBackend",
  ],
  "cloudkms.googleapis.com/CryptoKeyVersion": [
    "$.data.externalProtectionLevelOptions.externalKeyUri",
    "$.data.importJob",
  ],
  "cloudtasks.googleapis.com/Queue": [
    "$.data.httpTarget.oauthToken.serviceAccountEmail",
  ],
  "composer.googleapis.com/Environment": [
    "$.data.config.airflowByoidUri",
    "$.data.config.nodeConfig.composerInternalIpv4CidrBlock",
    "$.data.config.nodeConfig.composerNetworkAttachment",
    "$.data.config.privateEnvironmentConfig.cloudComposerNetworkIpv4CidrBlock",
    "$.data.config.privateEnvironmentConfig.cloudSqlIpv4CidrBlock",
    "$.data.config.privateEnvironmentConfig.webServerIpv4CidrBlock",
  ],
  "compute.googleapis.com/Address": [
    "$.data.ipCollection",
    "$.data.network",
  ],
  "compute.googleapis.com/BackendService": [
    "$.data.edgeSecurityPolicy",
    "$.data.securitySettings.clientTlsPolicy",
    "$.data.serviceBindings[*]",
    "$.data.serviceLbPolicy",
  ],
  "compute.googleapis.com/Disk": [
    "$.data.asyncSecondaryDisks.*.asyncReplicationDisk.disk",
    "$.data.storagePool",
  ],
  "compute.googleapis.com/ExternalVpnGateway": [
    "$.data.interfaces[*].ipv6Address",
  ],
  "compute.googleapis.com/Firewall": [
    "$.data.sourceServiceAccounts[*]",
  ],
  "compute.googleapis.com/FirewallPolicy": [
    "$.data.rules[*].match.destIpRanges[*]",
    "$.data.rules[*].match.srcSecureTags[*].name",
    "$.data.rules[*].match['srcAddressGroups','destAddressGroups'][*]",
    "$.data.rules[*].match['srcFqdns','destFqdns'][*]",
    "$.data.rules[*].targetSecureTags[*].name",
  ],
  "compute.googleapis.com/GlobalAddress": [
    "$.data.ipCollection",
  ],
  "compute.googleapis.com/GlobalForwardingRule": [
    "$.data.backendService",
    "$.data.subnetwork",
  ],
  "compute.googleapis.com/Instance": [
    "$.data.instanceEncryptionKey.kmsKeyName",
    "$.data.networkInterfaces[*].aliasIpRanges[*].ipCidrRange",
    "$.data.networkInterfaces[*].ipv6AccessConfigs[*].externalIpv6",
    "$.data.networkInterfaces[*].ipv6Address",
    "$.data.networkInterfaces[*].networkAttachment",
    "$.data.resourcePolicies[*]",
    "$.data.scheduling.nodeAffinities[?(@.key=='compute.googleapis.com/node-group-name' && @.operator=='IN')].values[*]",
    "$.data.sourceMachineImage",
  ],
  "compute.googleapis.com/InstanceGroupManager": [
    "$.data.resourcePolicies.workloadPolicy",
    "$.data.targetPools[*]",
  ],
  "compute.googleapis.com/InstanceTemplate": [
    "$.data.sourceInstance",
  ],
  "compute.googleapis.com/InterconnectAttachment": [
    "$.data.cloudRouterIpv6Address",
    "$.data.customerRouterIpv6Address",
    "$.data.ipsecInternalAddresses[*]",
    "$.data.l2Forwarding.applianceMappings.*.applianceIpAddress",
    "$.data.l2Forwarding.applianceMappings.*.innerVlanToApplianceMappings[*].innerApplianceIpAddress",
    "$.data.l2Forwarding.defaultApplianceIpAddress",
    "$.data.l2Forwarding.network",
    "$.data.l2Forwarding.tunnelEndpointIpAddress",
  ],
  "compute.googleapis.com/Network": [
    "$.data.internalIpv6Range",
  ],
  "compute.googleapis.com/NetworkEndpointGroup": [
    "$.data.appEngine.service",
    "$.data.cloudFunction.function",
    "$.data.pscData.consumerPscAddress",
    "$.data.pscTargetService",
  ],
  "compute.googleapis.com/RegionBackendService": [
    "$.data.securityPolicy",
    "$.data.serviceLbPolicy",
  ],
  "compute.googleapis.com/Reservation": [
    "$.data.resourcePolicies.*",
    "$.data.specificReservation.sourceInstanceTemplate",
  ],
  "compute.googleapis.com/Route": [
    "$.data.nextHopHub",
    "$.data.nextHopInterconnectAttachment",
  ],
  "compute.googleapis.com/Router": [
    "$.data.bgpPeers[*].routerApplianceInstance",
    "$.data.interfaces[*].privateIpAddress",
    "$.data.interfaces[*].subnetwork",
    "$.data.nats[*].drainNatIps[*]",
    "$.data.nats[*].subnetworks[*].name",
  ],
  "compute.googleapis.com/Subnetwork": [
    "$.data.externalIpv6Prefix",
    "$.data.internalIpv6Prefix",
    "$.data.ipCollection",
    "$.data.reservedInternalRange",
    "$.data.secondaryIpRanges[*].reservedInternalRange",
  ],
  "compute.googleapis.com/TargetHttpsProxy": [
    "$.data.serverTlsPolicy",
  ],
  "compute.googleapis.com/UrlMap": [
    "$.data.defaultCustomErrorResponsePolicy.errorService",
    "$.data.defaultRouteAction.requestMirrorPolicy.backendService",
    "$.data.defaultRouteAction.weightedBackendServices[*].backendService",
    "$.data.pathMatchers[*].defaultCustomErrorResponsePolicy.errorService",
    "$.data.pathMatchers[*].defaultRouteAction.requestMirrorPolicy.backendService",
    "$.data.pathMatchers[*].defaultRouteAction.weightedBackendServices[*].backendService",
    "$.data.pathMatchers[*].pathRules[*].routeAction.requestMirrorPolicy.backendService",
    "$.data.pathMatchers[*].pathRules[*].routeAction.weightedBackendServices[*].backendService",
    "$.data.pathMatchers[*].routeRules[*].routeAction.requestMirrorPolicy.backendService",
    "$.data.pathMatchers[*].routeRules[*].routeAction.weightedBackendServices[*].backendService",
    "$.data.pathMatchers[*].routeRules[*].service",
    "$.data.pathMatchers[*]['pathRules','routeRules'][*].customErrorResponsePolicy.errorService",
  ],
  "compute.googleapis.com/VpnGateway": [
    "$.data.vpnInterfaces[*].interconnectAttachment",
    "$.data.vpnInterfaces[*].ipv6Address",
  ],
  "config.googleapis.com/Deployment": [
    "$.data.terraformBlueprint.gcsSource",
  ],
  "container.googleapis.com/Cluster": [
    "$.data.autoscaling.autoprovisioningNodePoolDefaults.serviceAccount",
  ],
  "dataflow.googleapis.com/Job": [
    "$.data.environment.sdkPipelineOptions.options.subnetwork",
    "$.data.environment.sdkPipelineOptions.options.tempLocation",
    "$.data.jobMetadata.pubsubDetails[*].topic",
  ],
  "dataform.googleapis.com/Repository": [
    "$.data.gitRemoteSettings.sshAuthenticationConfig.userPrivateKeySecretVersion",
    "$.data.npmrcEnvironmentVariablesSecretVersion",
  ],
  "dataplex.googleapis.com/Asset": [
    "$.data.resourceSpec.readAccessMode",
    "$.data[?(@.type == 'STORAGE_BUCKET')].name",
  ],
  "dataproc.googleapis.com/Cluster": [
    "$.data.config.autoscalingConfig.policyUri",
    "$.data.config.encryptionConfig.kmsKey",
    "$.data.config.gceClusterConfig.networkUri",
    "$.data.virtualClusterConfig.auxiliaryServicesConfig.metastoreConfig.dataprocMetastoreService",
    "$.data.virtualClusterConfig.auxiliaryServicesConfig.sparkHistoryServerConfig.dataprocCluster",
    "$.data.virtualClusterConfig.kubernetesClusterConfig.gkeClusterConfig.gkeClusterTarget",
    "$.data.virtualClusterConfig.stagingBucket",
  ],
  "datastream.googleapis.com/ConnectionProfile": [
    "$.data.gcsProfile.bucket",
    "$.data.mongodbProfile.hostAddresses[*].hostname",
    "$.data.salesforceProfile.domain",
  ],
  "datastream.googleapis.com/PrivateConnection": [
    "$.data.pscInterfaceConfig.networkAttachment",
  ],
  "datastream.googleapis.com/Stream": [
    "$.data.customerManagedEncryptionKey",
    "$.data.destinationConfig.bigqueryDestinationConfig.blmtConfig.bucket",
  ],
  "dialogflow.googleapis.com/Agent": [
    "$.data.advancedSettings.audioExportGcsDestination.uri",
    "$.data.clientCertificateSettings['privateKey','passphrase']",
  ],
  "discoveryengine.googleapis.com/Collection": [
    "$.data.dataConnector.dataSource",
  ],
  "discoveryengine.googleapis.com/DataStore": [
    "$.data.cmekConfig.kmsKey",
    "$.data.federatedSearchConfig.alloyDbConfig.alloydbConnectionConfig.instance",
  ],
  "discoveryengine.googleapis.com/Engine": [
    "$.data.cmekConfig.kmsKey",
  ],
  "dlp.googleapis.com/DiscoveryConfig": [
    "$.data.actions[*].exportData.profileTable",
    "$.data.actions[*].pubSubNotification.topic",
    "$.data.orgConfig.projectId",
    "$.data.targets[*].cloudStorageTarget.filter.cloudStorageResourceReference.bucketName",
  ],
  "dlp.googleapis.com/JobTrigger": [
    "$.data.inspectJob.actions[*].deidentify.cloudStorageOutput",
    "$.data.inspectJob.actions[*].pubSub.topic",
    "$.data.inspectJob.actions[*].saveFindings.outputConfig.table",
    "$.data.inspectJob.storageConfig.bigQueryOptions.tableReference",
    "$.data.inspectJob.storageConfig.cloudStorageOptions.fileSet.regexFileSet.bucketName",
  ],
  "dns.googleapis.com/ManagedZone": [
    "$.data.forwardingConfig.targetNameServers[*].domainName",
    "$.data.forwardingConfig.targetNameServers[*].ipv6Address",
  ],
  "dns.googleapis.com/Policy": [
    "$.data.alternativeNameServerConfig.targetNameServers[*].ipv6Address",
  ],
  "dns.googleapis.com/ResourceRecordSet": [
    "$.data.routingPolicy.healthCheck",
    "$.data.routingPolicy.primaryBackup.backupGeoTargets.items[*].rrdatas[*]",
    "$.data.routingPolicy.primaryBackup.primaryTargets.externalEndpoints[*]",
    "$.data.routingPolicy.primaryBackup.primaryTargets.internalLoadBalancers[*].ipAddress",
    "$.data.routingPolicy['geo','wrr'].items[*].healthCheckedTargets.externalEndpoints[*]",
    "$.data.routingPolicy['geo','wrr'].items[*].rrdatas[*]",
  ],
  "dns.googleapis.com/ResponsePolicy": [
    "$.data.gkeClusters[*].gkeClusterName",
  ],
  "documentai.googleapis.com/Processor": [
    "$.data.kmsKeyName",
  ],
  "documentai.googleapis.com/ProcessorVersion": [
    "$.data.kmsKeyName",
  ],
  "eventarc.googleapis.com/Trigger": [
    "$.data.channel",
    "$.data.destination.cloudFunction",
    "$.data.destination.gke",
    "$.data.destination.gke.service",
    "$.data.destination.httpEndpoint.uri",
    "$.data.destination.networkConfig.networkAttachment",
  ],
  "file.googleapis.com/Instance": [
    "$.data[?(@.role == 'ACTIVE')].replicas[*].peerInstance",
  ],
  "firestore.googleapis.com/Database": [
    "$.data.cmekConfig.kmsKeyName",
  ],
  "gkehub.googleapis.com/Membership": [
    "$.data.endpoint.multiCloudCluster.resourceLink",
    "$.data.endpoint.onPremCluster.resourceLink",
  ],
  "iam.googleapis.com/WorkloadIdentityPool": [
    "$.data.mode",
  ],
  "identity.accesscontextmanager.googleapis.com/AccessLevel": [
    "$.data.basic.conditions[*].requiredAccessLevels[*]",
    "$.data.basic.conditions[*].vpcNetworkSources[*].vpcSubnetwork.network",
    "$.data.basic.conditions[*].vpcNetworkSources[*].vpcSubnetwork.vpcIpSubnetworks[*]",
  ],
  "identity.accesscontextmanager.googleapis.com/AccessPolicy": [
    "$.data.scopes[*]",
    "$.data.scopes[0]",
  ],
  "k8s.io/Pod": [
    "$.data.status.podIPs[*].ip",
  ],
  "k8s.io/Service": [
    "$.data.spec.clusterIPs[*]",
    "$.data.spec.externalName",
    "$.data.status.loadBalancer.ingress[*].ip",
  ],
  "managedkafka.googleapis.com/Cluster": [
    "$.data.tlsConfig.trustConfig.casConfigs[*].caPool",
  ],
  "memorystore.googleapis.com/Instance": [
    "$.data.crossInstanceReplicationConfig.secondaryInstances[*].instance",
    "$.data.discoveryEndpoints[*].address",
    "$.data.pscAutoConnections[*].forwardingRule",
    "$.data.pscAutoConnections[*].ipAddress",
    "$.data.pscAutoConnections[*].network",
  ],
  "metastore.googleapis.com/Service": [
    "$.data.artifactGcsUri",
    "$.data.hiveMetastoreConfig.kerberosConfig.keytab.cloudSecret",
    "$.data.networkConfig.consumers[*].endpointUri",
    "$.data.networkConfig.consumers[*].subnetwork",
  ],
  "monitoring.googleapis.com/NotificationChannel": [
    "$.data.labels.url",
  ],
  "monitoring.googleapis.com/UptimeCheckConfig": [
    "$.data.syntheticMonitor.cloudFunctionV2.name",
  ],
  "networkconnectivity.googleapis.com/HubRoute": [
    "$.data.nextHopInterconnectAttachment.uri",
    "$.data.nextHopRouterApplianceInstance.uri",
    "$.data.nextHopSpoke.uri",
  ],
  "networkconnectivity.googleapis.com/Spoke": [
    "$.data.gateway.cloudRouters[*]",
    "$.data.gateway.ipRangeReservations[*].ipRange",
    "$.data.linkedProducerVpcNetwork.network",
    "$.data.linkedProducerVpcNetwork.producerNetwork",
    "$.data.linkedRouterApplianceInstances.instances[*].ipAddress",
    "$.data.linkedRouterApplianceInstances.instances[*].virtualMachine",
  ],
  "networking.k8s.io/Ingress": [
    "$.data.spec.defaultBackend.service.name",
    "$.data.spec.tls[*].hosts[*]",
  ],
  "networksecurity.googleapis.com/FirewallEndpointAssociation": [
    "$.data.tlsInspectionPolicy",
  ],
  "networksecurity.googleapis.com/GatewaySecurityPolicy": [
    "$.data.tlsInspectionPolicy",
  ],
  "networksecurity.googleapis.com/SecurityProfile": [
    "$.data.customInterceptProfile.interceptEndpointGroup",
    "$.data.customMirroringProfile.mirroringEndpointGroup",
  ],
  "networkservices.googleapis.com/Gateway": [
    "$.data.serverTlsPolicy",
  ],
  "notebooks.googleapis.com/Instance": [
    "$.data.gceSetup.containerImage.repository",
    "$.data.gceSetup.dataDisks[*].kmsKey",
    "$.data.gceSetup.networkInterfaces[*].accessConfigs[*].externalIp",
  ],
  "privateca.googleapis.com/CertificateAuthority": [
    "$.data.gcsBucket",
  ],
  "pubsub.googleapis.com/Subscription": [
    "$.data.analyticsHubSubscriptionInfo.listing",
    "$.data.cloudStorageConfig.serviceAccountEmail",
  ],
  "pubsub.googleapis.com/Topic": [
    "$.data.ingestionDataSourceSettings.*.gcpServiceAccount",
    "$.data.ingestionDataSourceSettings.cloudStorage.bucket",
  ],
  "redis.googleapis.com/Instance": [
    "$.data.readEndpoint",
  ],
  "run.googleapis.com/Job": [
    "$.data.spec.template.metadata.annotations['run.googleapis.com/cloudsql-instances']",
    "$.data.spec.template.metadata.annotations['run.googleapis.com/encryption-key']",
    "$.data.spec.template.metadata.annotations['run.googleapis.com/vpc-access-connector']",
    "$.data.spec.template.spec.template.spec.containers[*].image",
    "$.data.spec.template.spec.template.spec.serviceAccountName",
    "$.data.template.template.containers[*].env[*].valueSource.secretKeyRef.secret",
    "$.data.template.template.encryptionKey",
    "$.data.template.template.volumes[*].gcs.bucket",
    "$.data.template.template.volumes[*].secret.secret",
    "$.data.template.template.vpcAccess.networkInterfaces[*].network",
    "$.data.template.template.vpcAccess.networkInterfaces[*].subnetwork",
  ],
  "run.googleapis.com/Service": [
    "$.data.spec.template.metadata.annotations['run.googleapis.com/cloudsql-instances']",
    "$.data.spec.template.metadata.annotations['run.googleapis.com/encryption-key']",
    "$.data.spec.template.metadata.annotations['run.googleapis.com/vpc-access-connector']",
    "$.data.spec.template.spec.containers[*].image",
    "$.data.spec.template.spec.serviceAccountName",
    "$.data.spec.template.spec.volumes[*].csi.volumeAttributes.bucketName",
    "$.data.status.address.url",
    "$.data.status.url",
  ],
  "secretmanager.googleapis.com/Secret": [
    "$.data.customerManagedEncryption.kmsKeyName",
    "$.data.replication.automatic.customerManagedEncryption.kmsKeyName",
  ],
  "secretmanager.googleapis.com/SecretVersion": [
    "$.data.customerManagedEncryption.kmsKeyVersionName",
    "$.data.replicationStatus.automatic.customerManagedEncryption.kmsKeyVersionName",
  ],
  "securitycenter.googleapis.com/BigQueryExport": [
    "$.data.cryptoKeyName",
  ],
  "securitycenter.googleapis.com/NotificationConfig": [
    "$.data.cryptoKeyName",
  ],
  "servicedirectory.googleapis.com/Endpoint": [
    "$.data.network",
  ],
  "spanner.googleapis.com/Database": [
    "$.data.encryptionConfig.kmsKeyNames[*]",
  ],
  "sqladmin.googleapis.com/Instance": [
    "$.data.settings.ipConfiguration.pscConfig.networkAttachmentUri",
  ],
  "tpu.googleapis.com/Node": [
    "$.data.bootDiskConfig.customerEncryptionKey.kmsKeyName",
    "$.data.cidrBlock",
    "$.data.dataDisks[*].sourceDisk",
    "$.data.network",
    "$.data.networkConfigs[*].network",
    "$.data.networkConfigs[*].subnetwork",
    "$.data.networkEndpoints[*].accessConfig.externalIp",
  ],
  "vmwareengine.googleapis.com/PrivateCloud": [
    "$.data.encryptionConfig.cryptoKeyName",
  ],
  "vpcaccess.googleapis.com/Connector": [
    "$.data.subnet",
  ],
};

function formatDataPath(dataPath: ReadonlyArray<string | number>): string {
  let result = '$.data';
  for (const step of dataPath) {
    if (typeof step === 'number') {
      result += `[${String(step)}]`;
    } else if (/^[A-Za-z0-9_$-]+$/.test(step)) {
      result += `.${step}`;
    } else {
      result += `['${step}']`;
    }
  }
  return result;
}

function pathsForType(type: (typeof catalog.types)[string]): string[] {
  const paths = new Set<string>();

  const addIfData = (p: string | undefined): void => {
    if (p === undefined) return;
    if (p.startsWith('$.data.') || p.startsWith('$["data"]') || p.startsWith('$.data[') || p === '$.data') {
      paths.add(p);
    }
  };

  for (const rel of type.relations) {
    addIfData(rel.to);
  }
  for (const nest of type.nestsIn ?? []) {
    addIfData(nest.to);
  }
  for (const cont of type.contains) {
    if (typeof cont === 'string') {
      addIfData(cont);
    }
  }
  for (const ip of type.ips) {
    addIfData(ip);
  }
  for (const dom of type.domains) {
    addIfData(dom);
  }
  for (const alias of type.aliases ?? []) {
    addIfData(alias);
  }

  const checkTemplate = (tmplStr?: string): void => {
    if (tmplStr === undefined) return;
    try {
      const tmpl = parseTemplate(tmplStr);
      for (const part of tmpl.parts) {
        if (part.kind === 'expression') {
          if (part.variable === 'data' && part.dataPath.length > 0) {
            paths.add(formatDataPath(part.dataPath));
          }
          for (const f of part.filters) {
            if (f.name === 'first') {
              for (const alt of f.alternatives) {
                if (alt.variable === 'data' && alt.dataPath.length > 0) {
                  paths.add(formatDataPath(alt.dataPath));
                }
              }
            }
          }
        }
      }
    } catch {
      // ignore template parse errors
    }
  };

  checkTemplate(type.label);
  checkTemplate(type.subtitle);
  checkTemplate(type.console);

  return [...paths].sort();
}

describe('demo-data catalog path coverage', () => {
  it('covers catalog data paths for every generated asset type', () => {
    const org = generateOrganization({ size: 'XL' });
    const assetsByType = new Map<string, Asset[]>();
    for (const a of org.assets) {
      let list = assetsByType.get(a.assetType);
      if (list === undefined) {
        list = [];
        assetsByType.set(a.assetType, list);
      }
      list.push(a);
    }

    const missing: string[] = [];
    let checkedCount = 0;

    for (const [assetType, assets] of assetsByType.entries()) {
      const catType = catalog.types[assetType];
      if (catType === undefined) continue;

      const optionalForType = new Set(OPTIONAL_CATALOG_PATHS[assetType] ?? []);
      const paths = pathsForType(catType);

      for (const p of paths) {
        if (optionalForType.has(p)) continue;
        checkedCount += 1;
        const found = assets.some((a) => {
          const vals = evaluateJsonPath(p, a);
          return vals.some((v) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0));
        });
        if (!found) {
          missing.push(`${assetType} ${p}`);
        }
      }
    }

    expect(missing).toEqual([]);
    expect(checkedCount).toBeGreaterThan(800);
  });
});
