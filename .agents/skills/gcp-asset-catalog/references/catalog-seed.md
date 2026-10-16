<!-- SPDX-License-Identifier: MIT -->

# Catalog seed — relation hints per product

Input for catalog authors. Every line below is a *hint* derived from the public API shapes; the
author must confirm each JSONPath against the type's API reference (linked from the official supported-types
page) and encode it in a fixture before it goes into YAML. Field names marked `(verify)` are the least
certain.

Notation: `Type [role]` then `kind → TargetType via $.path (normaliser)`. `ips:` and `domains:` list
extraction paths. `H` = hidden by default. Containment is written as `contains ← ChildType (how)`. Unless
stated, the parent is the project from `resource.parent`.

Normalisers: `csl` = computeSelfLink, `rel` = computeRelative/name, `sa` = serviceAccountEmail, `gcs` =
gcsUri, `bq` = bigqueryUri, `ps` = pubsubUri, `kms` = kmsKey, `proj` = projectNumberOrId, `img` =
artifactImage, `sql` = cloudSqlConnectionName, `sink` = logSinkDestination.

---

## Hierarchy — cloudresourcemanager.googleapis.com

- `Organization [container]` — canvas root; label `data.displayName`.
- `Folder [container]` — parent from `data.parent` (`folders/..`/`organizations/..`); label
  `data.displayName`.
- `Project [container]` — parent from `data.parent`; label `data.displayName`, subtitle `data.projectId`;
  `hiddenWhen data.state != ACTIVE` (show as ghost chip). The snapshot's project index is built from
  `data.projectId` ↔ `data.projectNumber`/`name`.
- `TagKey`, `TagValue` [H]; `TagBinding [H]` — badge on `data.parent` (resource name) with `data.tagValue`.
- `Lien [H]` — badge on `data.parent` (project).

## Networking fabric — compute.googleapis.com

- `Network [container]` — contains ← Subnetwork (via Subnetwork.network); `peers → Network via
  $.data.peerings[*].network (csl)`; subtitle `auto|custom` from `data.autoCreateSubnetworks`, routing mode.
- `Subnetwork [container]` — `contains ← (any) via attaches`; parent zone = `$.data.network (csl)`; ips
  `$.data.ipCidrRange`, `$.data.secondaryIpRanges[*].ipCidrRange`, `$.data.gatewayAddress`; subtitle cidr +
  region; badge `purpose` (PRIVATE_SERVICE_CONNECT, REGIONAL_MANAGED_PROXY, PRIVATE_NAT).
- `Route [core]` — `attaches → Network via $.data.network (csl)`; `uses → Instance|VpnTunnel|ForwardingRule|
  Network|Hub via $.data.nextHopInstance|nextHopVpnTunnel|nextHopIlb|nextHopPeering(name)|nextHopHub
  (csl/rel)`; ips `$.data.destRange`; `hiddenWhen data.nextHopNetwork exists && data.name startsWith
  'default-route-'` (auto routes).
- `Router [core]` — `attaches → Network via $.data.network (csl)`;
  `uses → Address via $.data.nats[*].natIps[*] (csl)`;
  `connects → VpnTunnel|InterconnectAttachment via $.data.interfaces[*].linkedVpnTunnel|
  linkedInterconnectAttachment (csl)`; subtitle `bgp.asn`; badge "NAT" when `data.nats` non-empty.
- `Address [core]`, `GlobalAddress [core]` — ips `$.data.address`; `attaches → Network|Subnetwork via
  $.data.network|subnetwork (csl)`; `uses ← users via $.data.users[*] (csl)` (reverse: the user → address);
  subtitle `addressType purpose`.
- `Firewall [core]` — `attaches → Network via $.data.network (csl)`; `runsAs → ServiceAccount via
  $.data.targetServiceAccounts[*] (sa)` (meaning: applies to); ips `$.data.sourceRanges[*]`,
  `$.data.destinationRanges[*]`; subtitle direction + priority; `hiddenWhen data.disabled == true`.
- `FirewallPolicy [core]` — `secures → Organization|Folder|Network via $.data.associations[*].attachmentTarget
  (rel/csl)`; subtitle rule count `data.ruleTupleCount`.
- `NetworkAttachment [core]` — `attaches → Network|Subnetwork via $.data.network|subnetworks[*] (csl)`;
  `uses ← producers via $.data.connectionEndpoints[*].projectIdOrNum (proj)` (verify).
- `ServiceAttachment [core]` (PSC producer) — `routes → ForwardingRule via $.data.targetService (csl)`;
  `attaches → Subnetwork via $.data.natSubnets[*] (csl)`; `routes ← consumer ForwardingRule via
  $.data.connectedEndpoints[*].endpoint (csl)`; badge `connectionPreference`.
- `PacketMirroring [core]` — `attaches → Network via $.data.network.url (csl)`; `routes → ForwardingRule via
  $.data.collectorIlb.url (csl)`; `uses → Instance|Subnetwork via $.data.mirroredResources.instances[*].url|
  subnetworks[*].url (csl)`.
- `PublicAdvertisedPrefix [leaf]`, `PublicDelegatedPrefix [core]` — ips `$.data.ipCidrRange`; PDP
  `uses → PAP via $.data.parentPrefix (csl)`.
- `NetworkEdgeSecurityService [core]` — `uses → SecurityPolicy via $.data.securityPolicy (csl)`.
- `CrossSiteNetwork [container]`, `WireGroup [core]` —
  `uses → Interconnect via $.data.endpoints[*].interconnects[*].interconnect (csl)` (verify).

### networkmanagement.googleapis.com
- `ConnectivityTest [H]`, `VpcFlowLogsConfig [H]` —
  `uses → Network|Subnetwork|InterconnectAttachment|VpnTunnel via
  $.data.network|subnet|interconnectAttachment|vpnTunnel (rel)` (verify).

### networksecurity.googleapis.com (NGFW Enterprise, Secure Web Proxy, TLS, DNS Armor)
- `FirewallEndpoint [core]` (org-level, zonal) — label `data.name`; subtitle zone.
- `FirewallEndpointAssociation [core]` — `attaches → Network via $.data.network (rel)`;
  `uses → FirewallEndpoint via $.data.firewallEndpoint (rel)`;
  `uses → TlsInspectionPolicy via $.data.tlsInspectionPolicy (rel)`.
- `SecurityProfileGroup [core]` — `uses → SecurityProfile via $.data.threatPreventionProfile|
  antiMalwareProfile|urlFilteringProfile (rel)`.
- `SecurityProfile [leaf]`, `AddressGroup [leaf]` (ips `$.data.items[*]`), `TlsInspectionPolicy [core]`
  (`uses → privateca CaPool via $.data.caPool (rel)`), `GatewaySecurityPolicy [container]` (contains ←
  GatewaySecurityPolicyRule by name), `GatewaySecurityPolicyRule [H]`, `UrlList [leaf]`,
  `ServerTlsPolicy|ClientTlsPolicy [leaf]`, `AuthorizationPolicy [leaf]`,
  `AuthzPolicy [core]` (`secures → ForwardingRule via $.data.target.resources[*] (csl)`; `uses →
  networkservices AuthzExtension via $.data.customProvider.authzExtension.resources[*] (rel)`),
  `DnsThreatDetector [leaf]`, Intercept*/Mirroring* (8) [H] (`attaches → Network via $.data.network (rel)` on
  *EndpointGroupAssociation).

## Hybrid connectivity

### compute.googleapis.com
- `Interconnect [core]` — subtitle `linkType location`; `connects ← InterconnectAttachment`.
- `InterconnectAttachment [core]` — `connects → Interconnect via $.data.interconnect (csl)`; `connects →
  Router via $.data.router (csl)`; ips `$.data.cloudRouterIpAddress`, `$.data.customerRouterIpAddress`;
  subtitle `type vlanTag8021q`.
- `VpnGateway [core]` (HA) — `attaches → Network via $.data.network (csl)`; ips
  `$.data.vpnInterfaces[*].ipAddress`.
- `ExternalVpnGateway [core]` — ips `$.data.interfaces[*].ipAddress`; subtitle `redundancyType`.
- `TargetVpnGateway [core]` (classic) — `attaches → Network via $.data.network (csl)`;
  `connects → VpnTunnel via $.data.tunnels[*] (csl)`;
  `routes ← ForwardingRule via $.data.forwardingRules[*] (csl)`.
- `VpnTunnel [core]` — `connects → VpnGateway|TargetVpnGateway via $.data.vpnGateway|targetVpnGateway (csl)`;
  `connects → ExternalVpnGateway|VpnGateway via $.data.peerExternalGateway|peerGcpGateway (csl)`; `uses →
  Router via $.data.router (csl)`; ips `$.data.peerIp`; subtitle `status`.

### networkconnectivity.googleapis.com
- `Hub [container]` — contains ← Spoke (via Spoke.hub), Group, RouteTable (by name); subtitle `state`.
- `Spoke [core]` — `connects → Hub via $.data.hub (rel)`; `connects → VpnTunnel via
  $.data.linkedVpnTunnels.uris[*] (csl)`; `connects → InterconnectAttachment via
  $.data.linkedInterconnectAttachments.uris[*] (csl)`; `connects → Instance via
  $.data.linkedRouterApplianceInstances.instances[*].virtualMachine (csl)`; `attaches → Network via
  $.data.linkedVpcNetwork.uri|linkedProducerVpcNetwork.network (csl)`.
- `InternalRange [core]` — `attaches → Network via $.data.network (csl)`; ips `$.data.ipCidrRange`.
- `PolicyBasedRoute [core]` — `attaches → Network via $.data.network (csl)`; ips `$.data.nextHopIlbIp`;
  `uses → Instance via $.data.virtualMachine.tags` (tags only, no edge).
- `RegionalEndpoint [core]` — `attaches → Network|Subnetwork via $.data.network|subnetwork (rel)`; ips
  `$.data.address`; domains `$.data.targetGoogleApi`.
- `Group [H]`, `RouteTable [H]`, `HubRoute [H]`.

### servicenetworking.googleapis.com
- `Connection [core]` (private services access) — `attaches → Network via $.data.network (rel:
  projects/N/global/networks/X)`; `uses → GlobalAddress via $.data.reservedPeeringRanges[*] (name within the
  same project)`; label "Private services access"; subtitle `data.service`.

### vpcaccess.googleapis.com
- `Connector [core]` — `attaches → Subnetwork via $.data.subnet.name (rel, project from subnet.projectId)`
  else `attaches → Network via $.data.network (name in same project)`; ips `$.data.ipCidrRange`;
  `uses ← connected projects via $.data.connectedProjects[*] (proj)`; subtitle
  `machineType minInstances-maxInstances`.

## Load balancing and edge — compute.googleapis.com

- `ForwardingRule [core]`, `GlobalForwardingRule [core]` — ips `$.data.IPAddress`; `routes → Target*Proxy|
  TargetPool|TargetInstance|TargetVpnGateway|ServiceAttachment via $.data.target (csl)`; `routes →
  BackendService|RegionBackendService via $.data.backendService (csl)`; `attaches → Network|Subnetwork via
  $.data.network|subnetwork (csl)`; subtitle `loadBalancingScheme IPProtocol:portRange|ports`; domains none;
  badge "PSC" when target is a ServiceAttachment or `data.pscConnectionId` exists.
- `TargetHttpProxy|TargetHttpsProxy|TargetGrpcProxy [core]` — `routes → UrlMap via $.data.urlMap (csl)`;
  `uses → SslCertificate via $.data.sslCertificates[*] (csl)`; `uses → certificatemanager CertificateMap via
  $.data.certificateMap (rel)`; `uses → SslPolicy via $.data.sslPolicy (csl)`; `uses → ServerTlsPolicy via
  $.data.serverTlsPolicy (rel)`.
- `TargetSslProxy|TargetTcpProxy [core]` — `routes → BackendService via $.data.service (csl)`; certificates as
  above.
- `TargetPool [core]` — `routes → Instance via $.data.instances[*] (csl)`; `uses → HttpHealthCheck via
  $.data.healthChecks[*] (csl)`; `uses → TargetPool via $.data.backupPool (csl)`.
- `TargetInstance [core]` — `routes → Instance via $.data.instance (csl)`.
- `UrlMap [core]` — `routes → BackendService|BackendBucket via $.data.defaultService,
  $.data.pathMatchers[*].defaultService, $.data.pathMatchers[*].pathRules[*].service,
  $.data.pathMatchers[*].routeRules[*].service,
  $.data.pathMatchers[*].routeRules[*].routeAction.weightedBackendServices[*].backendService,
  $.data.defaultRouteAction.weightedBackendServices[*].backendService
  (csl)`; domains `$.data.hostRules[*].hosts[*]`.
- `BackendService [core]`, `RegionBackendService [core]` — `routes → InstanceGroup|NetworkEndpointGroup via
  $.data.backends[*].group (csl)`; `uses → HealthCheck via $.data.healthChecks[*] (csl)`; `uses →
  SecurityPolicy via $.data.securityPolicy|edgeSecurityPolicy (csl)`; `attaches → Network via $.data.network
  (csl)` (ILB); `uses → networkservices ServiceLbPolicy via $.data.serviceLbPolicy (rel)`; `uses →
  ServiceBinding via $.data.serviceBindings[*] (rel)`; subtitle `protocol
  loadBalancingScheme`; badge "IAP" when `data.iap.enabled`.
- `BackendBucket [core]` — `uses → storage Bucket via $.data.bucketName (gcs)`; `uses → SecurityPolicy via
  $.data.edgeSecurityPolicy (csl)`; badge "CDN" when `data.enableCdn`.
- `NetworkEndpointGroup [core]` — subtitle `networkEndpointType`; `attaches → Network|Subnetwork via
  $.data.network|subnetwork (csl)`; `routes → run Service via $.data.cloudRun.service (name in NEG's project +
  region)`; `routes → cloudfunctions Function via $.data.cloudFunction.function`; `routes → appengine Service
  via $.data.appEngine.service`; PSC: `routes → (dangling) via $.data.pscTargetService` (string, shown in
  drawer). Zonal GCE NEG endpoints are not in the resource data; membership stays unknown (drawer note).
- `HealthCheck|HttpHealthCheck|HttpsHealthCheck [leaf]` — subtitle `type:port`.
- `SslCertificate [core]` — domains `$.data.managed.domains[*]`, `$.data.subjectAlternativeNames[*]`; subtitle
  `type`, expiry `data.expireTime`.
- `SslPolicy [leaf]` — subtitle `profile minTlsVersion`.
- `SecurityPolicy [core]` (Cloud Armor) — subtitle `type`, rule count; `secures ← BackendService` (via their
  `securityPolicy`).

### certificatemanager.googleapis.com
- `Certificate [core]` — domains `$.data.managed.domains[*]`, `$.data.sanDnsnames[*]`; subtitle `scope state`.
- `CertificateMap [container]` — contains ← CertificateMapEntry (by name); `uses ← Target*Proxy via
  $.data.gclbTargets[*].targetHttpsProxy|targetSslProxy (csl)`.
- `CertificateMapEntry [core]` — `uses → Certificate via $.data.certificates[*] (rel)`; domains
  `$.data.hostname`.
- `DnsAuthorization [leaf]` — domains `$.data.domain`.
- `CertificateIssuanceConfig [core]` — `uses → privateca CaPool via
  $.data.certificateAuthorityConfig.certificateAuthorityServiceConfig.caPool (rel)`.
- `TrustConfig [leaf]`.

### networkservices.googleapis.com
- `Gateway [core]` — subtitle `type` (OPEN_MESH | SECURE_WEB_GATEWAY); `attaches → Network|Subnetwork via
  $.data.network|subnetwork (rel)`; ips `$.data.addresses[*]`; `uses → GatewaySecurityPolicy via
  $.data.gatewaySecurityPolicy (rel)`; `uses → certificatemanager Certificate via $.data.certificateUrls[*]
  (rel)`.
- `Mesh [container]` — contains ← HttpRoute|GrpcRoute|TcpRoute|TlsRoute (via their `meshes[*]`).
- `HttpRoute|GrpcRoute|TcpRoute|TlsRoute [core]` — `attaches → Mesh|Gateway via $.data.meshes[*]|gateways[*]
  (rel)`; `routes → BackendService via $.data.rules[*].action.destinations[*].serviceName (rel)`; domains
  `$.data.hostnames[*]`.
- `ServiceBinding [core]` — `uses → servicedirectory Service via $.data.service (rel)`.
- `EndpointPolicy [leaf]`, `ServiceLbPolicy [leaf]`, `WasmPlugin [leaf]`, `WasmPluginVersion [H]`.
- `EdgeCacheService [core]` — domains `$.data.routing.hostRules[*].hosts[*]`; `routes → EdgeCacheOrigin via
  $.data.routing.pathMatchers[*].routeRules[*].origin (rel)`; `uses → EdgeCacheKeyset via
  $.data.edgeSecurityPolicy|...` (verify).
- `EdgeCacheOrigin [core]` — `uses → storage Bucket via $.data.originAddress (gcs when gs://)`, domains otherwise.
- `EdgeCacheKeyset [leaf]`.
- `LbTrafficExtension|LbRouteExtension [core]` —
  `secures → ForwardingRule via $.data.forwardingRules[*] (csl)`;
  `routes → BackendService via $.data.extensionChains[*].extensions[*].service (csl)`.
- `AuthzExtension [core]` — `routes → BackendService via $.data.service (csl)`.

### apigateway.googleapis.com
- `Api [container]` — contains ← ApiConfig (by name); `uses → servicemanagement ManagedService via
  $.data.managedService (name)`.
- `ApiConfig [core]` — `runsAs → ServiceAccount via $.data.gatewayServiceAccount (sa)`.
- `Gateway [core]` — `routes → ApiConfig via $.data.apiConfig (rel)`; domains `$.data.defaultHostname`.

### domains.googleapis.com
- `Registration [leaf]` — domains `$.data.domainName`; subtitle `state expireTime`.

## DNS — dns.googleapis.com
- `ManagedZone [core]` — domains `$.data.dnsName`; subtitle `visibility`; `attaches → Network via
  $.data.privateVisibilityConfig.networks[*].networkUrl (csl)`; `peers → Network via
  $.data.peeringConfig.targetNetwork.networkUrl
  (csl)`; ips `$.data.forwardingConfig.targetNameServers[*].ipv4Address`; `uses → container Cluster via
  $.data.privateVisibilityConfig.gkeClusters[*].gkeClusterName (rel)`; contains ← ResourceRecordSet (by name)
  as a hidden count.
- `ResourceRecordSet [H]` — parent zone from name; domains `$.data.name`; ips `$.data.rrdatas[*]` (A/AAAA);
  the graph builder matches rrdata IPs to Address/ForwardingRule IPs to add `uses` when revealed.
- `Policy [core]` — `attaches → Network via $.data.networks[*].networkUrl (csl)`; badge inbound forwarding /
  logging; ips `$.data.alternativeNameServerConfig.targetNameServers[*].ipv4Address`.
- `ResponsePolicy [core]` — `attaches → Network via $.data.networks[*].networkUrl (csl)`; `uses → container
  Cluster via $.data.gkeClusters[*].gkeClusterName (rel)`; contains ← ResponsePolicyRule [H].

## Compute — compute.googleapis.com
- `Instance [core]` — as mapped in `products/compute.googleapis.com.compute.yaml` (NICs `attaches` subnet, the
  network as a weak `attaches`, disks `uses`, `runsAs`, `memberOf` via `created-by`); add `uses → Image`
  indirectly via disks; `uses → NodeGroup` from `$.data.scheduling.nodeAffinities[*]` (badge only);
  `uses → Reservation` from `$.data.reservationAffinity` (badge); `encryptedBy` via disks; subtitle
  `machineType lastSegment`; badge "public IP" when any `accessConfigs[*].natIP`;
  `hiddenWhen data.status == 'TERMINATED'` is NOT applied (stopped VMs matter) — show status in subtitle
  instead.
- `Disk [core]`, `RegionDisk [core]` — `uses → Image|Snapshot|Disk via $.data.sourceImage|sourceSnapshot|
  sourceDisk (csl)`; `encryptedBy → CryptoKey via $.data.diskEncryptionKey.kmsKeyName (kms)`; `uses →
  ResourcePolicy via $.data.resourcePolicies[*] (csl)`; `uses → StoragePool via $.data.storagePool (csl)`;
  users via `$.data.users[*]` (reverse of Instance.disks; do not double-draw); subtitle `sizeGb type`.
- `Image [core]` — `uses → Disk|Snapshot|Image via $.data.sourceDisk|sourceSnapshot|sourceImage (csl)`;
  `encryptedBy → CryptoKey via $.data.imageEncryptionKey.kmsKeyName (kms)`; subtitle `family`.
- `Snapshot [core]` — `uses → Disk via $.data.sourceDisk (csl)`; `encryptedBy` via `snapshotEncryptionKey`.
- `MachineImage [core]` — `uses → Instance via $.data.sourceInstance (csl)`.
- `InstantSnapshot [core]` — `uses → Disk via $.data.sourceDisk (csl)`.
- `InstanceTemplate [core]` —
  `attaches → Network|Subnetwork via $.data.properties.networkInterfaces[*].network| subnetwork (csl, weak
  network)`; `uses → Image via $.data.properties.disks[*].initializeParams.sourceImage (csl)`;
  `runsAs → ServiceAccount via $.data.properties.serviceAccounts[*].email (sa)`; subtitle machine type.
- `InstanceGroup [container]` — contains ← Instance (via Instance `created-by` → IGM → `instanceGroup`, or by
  IGM `baseInstanceName` prefix + zone as a weak fallback, flagged "inferred"); `attaches → Network|Subnetwork
  via $.data.network|subnetwork (csl)`; subtitle `size`.
- `InstanceGroupManager [core]` — `memberOf ← Instance` (via `created-by`); `uses → InstanceGroup via
  $.data.instanceGroup (csl)`; `uses → InstanceTemplate via $.data.instanceTemplate,
  $.data.versions[*].instanceTemplate (csl)`; `routes ← TargetPool via $.data.targetPools[*] (csl)`; `uses →
  HealthCheck via $.data.autoHealingPolicies[*].healthCheck (csl)`; subtitle `targetSize`.
- `Autoscaler [core]` — `uses → InstanceGroupManager via $.data.target (csl)`; subtitle min–max.
- `NodeGroup [container]` — `uses → NodeTemplate via $.data.nodeTemplate (csl)`; subtitle `size`.
- `NodeTemplate [leaf]`, `Reservation [leaf]` (subtitle machine type × count), `Commitment [leaf]`,
  `ResourcePolicy [leaf]`, `StoragePool [container]` (contains ← Disk via Disk.storagePool), `License [H]`,
  `InstanceSettings [H]`, `Project [H]` (Shared VPC host flag `data.xpnProjectStatus == 'HOST'` → badge on the
  Resource Manager project; `data.commonInstanceMetadata.items[?(@.key=='enable-oslogin')]` → badge).

### tpu.googleapis.com
- `Node [core]` — `attaches → Network|Subnetwork via $.data.networkConfig.network|subnetwork (rel) or
  $.data.network (name)`; ips `$.data.networkEndpoints[*].ipAddress`, `$.data.cidrBlock`; `runsAs →
  ServiceAccount via $.data.serviceAccount.email (sa)`; subtitle `acceleratorType`.
- `QueuedResource [H]` — `uses → Node via $.data.tpu.nodeSpec[*].nodeId` (same project/zone).

### hypercomputecluster.googleapis.com
- `Cluster [core]` — `attaches → Network via $.data.networks[*].network (rel)` (verify); `uses → Reservation`
  (verify).

### workstations.googleapis.com
- `WorkstationCluster [container]` — `attaches → Network|Subnetwork via $.data.network|subnetwork (rel)`;
  `uses → ServiceAttachment via $.data.privateClusterConfig.serviceAttachmentUri (csl)`; ips
  `$.data.controlPlaneIp`; domains `$.data.domainConfig.domain`.
- `WorkstationConfig [container]` — parent cluster by name; `runsAs → ServiceAccount via
  $.data.host.gceInstance.serviceAccount (sa)`; `uses → img via $.data.container.image (img)`; `encryptedBy →
  CryptoKey via $.data.encryptionKey.kmsKey (kms)`.
- `Workstation [leaf]` — parent config by name; domains `$.data.host`.

### notebooks.googleapis.com
- `Instance [core]` — `attaches → Network|Subnetwork via $.data.network|subnet or
  $.data.gceSetup.networkInterfaces[*].network|subnet (csl)`; `runsAs → ServiceAccount via
  $.data.serviceAccount or $.data.gceSetup.serviceAccounts[*].email
  (sa)`; domains `$.data.proxyUri`; `encryptedBy` via `kmsKey`.

### batch.googleapis.com
- `Job [H]` — `attaches → Network|Subnetwork via $.data.allocationPolicy.network.networkInterfaces[*].network|
  subnetwork (rel)`; `runsAs → ServiceAccount via $.data.allocationPolicy.serviceAccount.email (sa)`;
  `hiddenWhen data.status.state in [SUCCEEDED, FAILED]`.

### vmwareengine.googleapis.com
- `PrivateCloud [container]` — contains ← Cluster, ExternalAddress (by name);
  `attaches → VmwareEngineNetwork via $.data.networkConfig.vmwareEngineNetwork (rel)`; ips
  `$.data.networkConfig.managementCidr`, `$.data.vcenter.internalIp`, `$.data.nsx.internalIp`,
  `$.data.hcx.internalIp`; domains `$.data.vcenter.fqdn`, `$.data.nsx.fqdn`, `$.data.hcx.fqdn`; subtitle
  `type`.
- `Cluster [core]` — parent private cloud by name; subtitle node count.
- `VmwareEngineNetwork [container]` — `peers → Network via $.data.vpcNetworks[*].network (rel)`; subtitle
  `type`.
- `NetworkPeering [core]` — `peers → VmwareEngineNetwork via $.data.vmwareEngineNetwork (rel)` and `peers →
  Network via $.data.peerNetwork (rel)`; subtitle `peerNetworkType`.
- `NetworkPolicy [core]` — `attaches → VmwareEngineNetwork via $.data.vmwareEngineNetwork (rel)`; ips
  `$.data.edgeServicesCidr`; badges internet access / external IP.
- `PrivateConnection [core]` — `connects → VmwareEngineNetwork via $.data.vmwareEngineNetwork (rel)`;
  `attaches → Network via $.data.vpcNetwork (rel)`; subtitle `type`.
- `ExternalAddress [core]` — ips `$.data.internalIp`, `$.data.externalIp`. `ExternalAccessRule [H]`.

### vmmigration.googleapis.com (all H)
- `Source [container]` → `DatacenterConnector`, `MigratingVm` (`uses → Project via
  $.data.computeEngineTargetDefaults.targetProject (rel: TargetProject)`, `attaches → Network|Subnetwork via
  $.data.computeEngineTargetDefaults.networkInterfaces[*].network|subnetwork (rel)`), `TargetProject` (`uses →
  Project via $.data.project (proj)`), `Group`, `CloneJob`, `CutoverJob`, `ImageImport`, `UtilizationReport`.

## Containers and serverless

### container.googleapis.com
- `Cluster [container]` — contains ← NodePool (by name), k8s Namespace (by name path), k8s Node; `attaches →
  Network|Subnetwork via $.data.network|subnetwork (name or csl; verify both forms)`; ips `$.data.endpoint`,
  `$.data.privateClusterConfig.privateEndpoint|publicEndpoint`, `$.data.clusterIpv4Cidr`,
  `$.data.servicesIpv4Cidr`, `$.data.masterAuthorizedNetworksConfig.cidrBlocks[*].cidrBlock`; `runsAs →
  ServiceAccount via $.data.nodeConfig.serviceAccount (sa)`; `memberOf → gkehub Membership via
  $.data.fleet.membership (rel)`; `encryptedBy → CryptoKey via $.data.databaseEncryption.keyName (kms)`;
  subtitle `currentMasterVersion`, badges Autopilot / private / release channel.
- `NodePool [core]` — parent cluster by name; `runsAs → ServiceAccount via $.data.config.serviceAccount (sa)`;
  `attaches → Subnetwork secondary range via $.data.networkConfig.podRange` (badge); subtitle machine type ×
  autoscaling range.

### Kubernetes object types (names embed `.../clusters/C/k8s/namespaces/N/...`)
- `k8s.io/Namespace [container]` — parent cluster from name.
- `k8s.io/Node [core]` — parent cluster; `uses → compute Instance via $.data.spec.providerID
  (gce://project/zone/instance → csl)`; ips `$.data.status.addresses[*].address`.
- `k8s.io/Pod [core]` (H in overview, shown in kubernetes lens) — parent namespace; `uses → Node via
  $.data.spec.nodeName`; `memberOf → owner via $.data.metadata.ownerReferences[*] (k8sOwner)`; ips
  `$.data.status.podIP`; `runsAs → ServiceAccount` only when workload identity annotation present (verify).
- `k8s.io/Service [core]` — parent namespace; subtitle `spec.type`; ips `$.data.spec.clusterIP`,
  `$.data.status.loadBalancer.ingress[*].ip` (matched to ForwardingRule IPs → `routes ←`); `routes → Pods` by
  selector is not resolvable without pod labels index → graph builder resolves via `spec.selector` against pod
  labels when pods are loaded.
- `apps.k8s.io/Deployment|ReplicaSet|StatefulSet|DaemonSet [core]`, `extensions.k8s.io/DaemonSet [H]`,
  `batch.k8s.io/Job|CronJob [core]` — parent namespace; `memberOf → owner via ownerReferences (k8sOwner)`;
  `uses → img via $.data.spec.template.spec.containers[*].image (img)`; `runsAs` via
  `spec.template.spec.serviceAccountName` (k8s SA, badge).
- `networking.k8s.io/Ingress [core]`, `extensions.k8s.io/Ingress [H]` — domains `$.data.spec.rules[*].host`;
  `routes → k8s Service via $.data.spec.rules[*].http.paths[*].backend.service.name` (same namespace);
  `routes ← compute ForwardingRule|UrlMap via annotations ingress.kubernetes.io/forwarding-rule|url-map
  (name, same project)`.
- `gateway.networking.k8s.io/Gateway|HTTPRoute [core]`, `GatewayClass|ReferenceGrant [H]` — HTTPRoute
  `attaches → Gateway via $.data.spec.parentRefs[*].name`;
  `routes → Service via $.data.spec.rules[*].backendRefs[*].name`; domains `$.data.spec.hostnames[*]`.
- `networking.k8s.io/NetworkPolicy [leaf]`, `storage.k8s.io/StorageClass [leaf]`,
  `autoscaling.k8s.io/HorizontalPodAutoscaler [H]`, `policy.k8s.io/PodDisruptionBudget [H]`,
  `rbac.authorization.k8s.io/* [H]`, `admissionregistration.k8s.io/* [H]`.

### gkehub.googleapis.com
- `Fleet [container]` — project-level; contains ← Membership, Scope, Feature (by project).
- `Membership [core]` — `memberOf ← container Cluster` (via Cluster.fleet.membership) and `uses → container
  Cluster via $.data.endpoint.gkeCluster.resourceLink (csl)`; `uses → gkemulticloud|gkeonprem clusters via
  $.data.endpoint.multiCloudCluster.resourceLink|onPremCluster.resourceLink (rel)`.
- `Feature [leaf]`, `Scope [container]`, `Namespace [H]`, `MembershipBinding [H]`, `RBACRoleBinding [H]`,
  `MembershipFeature [H]`.

### gkemulticloud / gkeonprem / anthos.googleapis.com
- `AwsCluster|AzureCluster|AttachedCluster [core]`, `AwsNodePool|AzureNodePool [leaf]`, `AzureClient [H]`;
  `VmwareCluster|BareMetalCluster [core]`, `*AdminCluster [core]`, `*NodePool [leaf]`;
  `ConnectedCluster [core]` — all: `memberOf → gkehub Membership via $.data.fleet.membership (rel)`; subtitle
  platform/version.

### gkebackup.googleapis.com
- `BackupPlan [core]` — `uses → container Cluster via $.data.cluster (rel)`; `encryptedBy → CryptoKey via
  $.data.backupConfig.encryptionKey.gcpKmsEncryptionKey (kms)`. `Backup [H]` (parent plan),
  `RestorePlan [core]` (`uses → BackupPlan via $.data.backupPlan`, `uses → Cluster via $.data.cluster`),
  `Restore [H]`, `VolumeBackup|VolumeRestore [H]`.

### run.googleapis.com
- `Service [core]` — see skill §2 example; also `routes ← compute NetworkEndpointGroup (serverless)`; domains
  `$.data.urls[*]`, `$.data.uri`; `uses → storage Bucket via $.data.template.volumes[*].gcs.bucket (gcs)`;
  `attaches → Network|Subnetwork via $.data.template.vpcAccess.networkInterfaces[*].network|subnetwork
  (name in same project / rel)`; `uses → secretmanager Secret via
  $.data.template.containers[*].env[*].valueSource.secretKeyRef.secret
  (name)`; contains ← Revision (H, by name). v1 (Knative) shape:
  `$.data.spec.template.spec.serviceAccountName`, annotations `run.googleapis.com/vpc-access-connector`,
  `run.googleapis.com/cloudsql-instances` — support via alias paths.
- `Revision [H]`, `Execution [H]`.
- `Job [core]` — same template paths under `$.data.template.template.*`; contains ← Execution (H).
- `WorkerPool [core]` — same as Service template paths (verify).
- `DomainMapping [core]` — domains `$.data.name` last segment or `$.data.metadata.name`; `routes → Service via
  $.data.spec.routeName` (same project/region).

### cloudfunctions.googleapis.com
- `Function [core]` (v2) — `runsAs → ServiceAccount via $.data.serviceConfig.serviceAccountEmail (sa)`;
  `attaches → vpcaccess Connector via $.data.serviceConfig.vpcConnector (rel)`; `routes → run Service via
  $.data.serviceConfig.service (rel)`; `triggers ← pubsub Topic via $.data.eventTrigger.pubsubTopic (ps)`;
  `uses → eventarc Trigger via $.data.eventTrigger.trigger (rel)`; `uses → storage Bucket via
  $.data.buildConfig.source.storageSource.bucket (gcs)`; `uses → artifactregistry Repository via
  $.data.buildConfig.dockerRepository (rel)`; `uses → Secret via
  $.data.serviceConfig.secretEnvironmentVariables[*].secret|secretVolumes[*].secret (name, project field)`;
  domains `$.data.serviceConfig.uri`; `encryptedBy → CryptoKey via $.data.kmsKeyName (kms)`; subtitle
  `environment runtime`.
- `CloudFunction [core]` (v1) — `runsAs via $.data.serviceAccountEmail`; `attaches → Connector via
  $.data.vpcConnector (rel)`; `triggers ← Topic via $.data.eventTrigger.resource (ps)`; domains
  `$.data.httpsTrigger.url`; `uses → Bucket via $.data.sourceArchiveUrl (gcs)`; `attaches → Network via
  $.data.network (name)`.

### appengine.googleapis.com
- `Application [container]` — domains `$.data.defaultHostname`; contains ← Service (by name).
- `Service [container]` — contains ← Version (H by default, latest shown).
- `Version [core]` — `attaches → Network|Subnetwork via $.data.network.name|subnetworkName (name)` (flex);
  `attaches → Connector via $.data.vpcAccessConnector.name (rel)`; `runsAs → ServiceAccount via
  $.data.serviceAccount (sa)`; subtitle `runtime env`; `hiddenWhen data.servingStatus != 'SERVING'`.

### eventarc.googleapis.com
- `Trigger [core]` — `triggers → run Service via $.data.destination.cloudRun.service (name, region
  $.data.destination.cloudRun.region)`; `triggers → cloudfunctions Function via
  $.data.destination.cloudFunction (rel)`; `triggers → container Cluster via $.data.destination.gke.cluster
  (name)`; `triggers → workflows Workflow via $.data.destination.workflow
  (rel)`; domains `$.data.destination.httpEndpoint.uri`; `uses → pubsub Topic|Subscription via
  $.data.transport.pubsub.topic|subscription (ps)`; `runsAs → ServiceAccount via $.data.serviceAccount
  (sa)`; `uses → Channel via $.data.channel
  (rel)`; subtitle first `eventFilters[?(@.attribute=='type')].value`.
- `Channel [core]` — `uses → pubsub Topic via $.data.pubsubTopic (ps)`; `ChannelConnection [H]`.
- `MessageBus [container]`, `Pipeline [core]` (`triggers → MessageBus|Workflow via
  $.data.destinations[*].messageBus|workflow (rel)`, domains `$.data.destinations[*].httpEndpoint.uri`,
  `attaches → compute NetworkAttachment via $.data.destinations[*].networkConfig.networkAttachment (rel)`),
  `Enrollment [core]` (`uses → MessageBus via $.data.messageBus`,
  `triggers → Pipeline via $.data.destination`), `GoogleApiSource [core]`
  (`triggers → MessageBus via $.data.destination`), `GoogleChannelConfig [H]`.

### cloudtasks.googleapis.com — `Queue [leaf]`. workflows.googleapis.com — `Workflow [core]` (`runsAs →
ServiceAccount via $.data.serviceAccount (sa)`; `encryptedBy via $.data.cryptoKeyName`).

## Data stores

### storage.googleapis.com
- `Bucket [core]` — subtitle `location storageClass`; `encryptedBy → CryptoKey via
  $.data.encryption.defaultKmsKeyName (kms)`; `uses → Bucket via $.data.logging.logBucket (gcs)`; badges UBLA
  (`iamConfiguration.uniformBucketLevelAccess.enabled`), public access prevention, versioning, retention.

### bigquery.googleapis.com
- `Dataset [container]` — contains ← Table, Model, Routine (by name `datasets/D/...`); subtitle `location`;
  `encryptedBy → CryptoKey via $.data.defaultEncryptionConfiguration.kmsKeyName (kms)`.
- `Table [core]` (H above 50 per dataset → count badge) — subtitle `type`
  (TABLE|VIEW|EXTERNAL|MATERIALIZED_VIEW);
  `uses → storage Bucket via $.data.externalDataConfiguration.sourceUris[*] (gcs)`;
  `encryptedBy via $.data.encryptionConfiguration.kmsKeyName`; `RowAccessPolicy [H]`.
- `Model [leaf]`, `Routine [leaf]`.
- bigqueryreservation: `Reservation [core]`, `CapacityCommitment [leaf]`, `ReservationAssignment [core]`
  (`secures → Project|Folder|Organization via $.data.assignee (rel)`, `uses → Reservation` by name),
  `BiReservation [H]`, `ReservationGroup [H]`.
- analyticshub: `DataExchange [container]`, `Listing [core]`
  (`uses → Dataset via $.data.bigqueryDataset.dataset (bq)`).
- bigquerydatatransfer: `TransferConfig [core]` (`uses → Dataset via $.data.destinationDatasetId` in the same
  project; subtitle `dataSourceId`). bigquerymigration: `MigrationWorkflow [H]`.

### sqladmin.googleapis.com
- `Instance [core]` — `attaches → Network via $.data.settings.ipConfiguration.privateNetwork (csl or rel)`;
  ips `$.data.ipAddresses[*].ipAddress` (badge per `type`: PRIMARY public / PRIVATE);
  `encryptedBy → CryptoKey via $.data.diskEncryptionConfiguration.kmsKeyName (kms)`;
  `replicates ← Instance via $.data.masterInstanceName (project:instance → sql)`;
  `uses ← consumers via $.data.settings.ipConfiguration.pscConfig.allowedConsumerProjects[*] (proj)`; subtitle
  `databaseVersion tier availabilityType`; `hiddenWhen data.instanceType == 'ON_PREMISES_INSTANCE'` is NOT
  applied (show as external).
- `Backup [H]`, `BackupRun [H]`.

### spanner.googleapis.com
- `Instance [container]` — contains ← Database (by name); `uses → InstanceConfig via $.data.config (rel)`;
  subtitle `nodeCount|processingUnits`. `Database [core]` (`encryptedBy via
  $.data.encryptionConfig.kmsKeyName|kmsKeyNames[*]`), `Backup [H]`, `InstanceConfig [H]`, `InstancePartition
  [leaf]`.

### bigtableadmin.googleapis.com
- `Instance [container]` — contains ← Cluster, Table, AppProfile (by name). `Cluster [core]` (subtitle
  `location serveNodes`; `encryptedBy via $.data.encryptionConfig.kmsKeyName`), `Table [core]` (H above 30),
  `AppProfile [leaf]`, `Backup [H]`, `AuthorizedView|LogicalView|MaterializedView|SchemaBundle [H]`.

### alloydb.googleapis.com
- `Cluster [container]` — contains ← Instance (by name); `attaches → Network via $.data.network (rel:
  projects/N/global/networks/X) or $.data.networkConfig.network`; `encryptedBy via
  $.data.encryptionConfig.kmsKeyName`; `replicates → Cluster via $.data.secondaryConfig.primaryClusterName
  (reverse)`; subtitle `clusterType`.
- `Instance [core]` — subtitle `instanceType`; ips `$.data.ipAddress`, `$.data.publicIpAddress`. `Backup [H]`
  (`uses → Cluster via $.data.clusterName`).

### firestore.googleapis.com — `Database [core]` (subtitle `type locationId`; `encryptedBy via
$.data.cmekConfig.kmsKeyName`), `Backup [H]`.

### redis / memorystore / memcache
- `redis.googleapis.com/Instance [core]` — `attaches → Network via $.data.authorizedNetwork (rel)`; ips
  `$.data.host`, `$.data.reservedIpRange`; subtitle `tier memorySizeGb connectMode`; `encryptedBy via
  $.data.customerManagedKey`.
- `redis.googleapis.com/Cluster [core]` — `attaches → Network via $.data.pscConfigs[*].network (rel)`; ips
  `$.data.discoveryEndpoints[*].address`;
  `uses → compute ForwardingRule via $.data.pscConnections[*].forwardingRule (csl)`.
- `memorystore.googleapis.com/Instance [core]` — `attaches → Network via $.data.pscAutoConnections[*].network
  (rel)`; ips `$.data.endpoints[*].connections[*].pscAutoConnection.ipAddress` (verify).
- `memcache.googleapis.com/Instance [core]` — `attaches → Network via $.data.authorizedNetwork (rel)`; ips
  `$.data.memcacheNodes[*].host`.

### file.googleapis.com
- `Instance [core]` — `attaches → Network via $.data.networks[*].network (name, same project or shared)`; ips
  `$.data.networks[*].ipAddresses[*]`, `$.data.networks[*].reservedIpRange`; subtitle `tier`; `encryptedBy via
  $.data.kmsKeyName`. `Backup [H]` (`uses → Instance via $.data.sourceInstance`), `Snapshot [H]`.

### netapp.googleapis.com
- `StoragePool [container]` — `attaches → Network via $.data.network (rel)`; `uses → ActiveDirectory via
  $.data.activeDirectory`; `uses → KmsConfig via $.data.kmsConfig`; contains ← Volume (via
  Volume.storagePool).
- `Volume [core]` — `uses → StoragePool via $.data.storagePool (rel)`;
  `attaches → Network via $.data.network`; ips `$.data.psaRange`, `$.data.mountOptions[*].export` (host part);
  `replicates → Volume via Replication`.
- `Replication [core]` (`replicates → Volume via $.data.destinationVolume`), `ActiveDirectory [core]` (ips
  `$.data.dns`; domains `$.data.domain`), `KmsConfig [core]`
  (`encryptedBy → CryptoKey via $.data.cryptoKeyName`), `BackupVault [container]`, `BackupPolicy [leaf]`,
  `Backup [H]`, `Snapshot [H]`.

### lustre / parallelstore
- `lustre.googleapis.com/Instance [core]` — `attaches → Network via $.data.network (rel)`; ips
  `$.data.mountPoint`.
- `parallelstore.googleapis.com/Instance [core]` — `attaches → Network via $.data.network (rel)`; ips
  `$.data.accessPoints[*]`, `$.data.reservedIpRange`.

### oracledatabase.googleapis.com
- `CloudExadataInfrastructure [container]`, `CloudVmCluster [core]` (`uses → CloudExadataInfrastructure via
  $.data.exadataInfrastructure`; `attaches → Network via $.data.network (rel)`; ips `$.data.cidr`,
  `$.data.backupSubnetCidr`), `AutonomousDatabase [core]` (`attaches → Network via $.data.network`; ips
  `$.data.cidr`, `$.data.properties.privateEndpointIp`).

## Data processing and messaging

### pubsub.googleapis.com
- `Topic [core]` — `encryptedBy via $.data.kmsKeyName`; `uses → Schema via $.data.schemaSettings.schema (ps)`;
  badge message storage regions.
- `Subscription [core]` — `uses → Topic via $.data.topic (ps)`; `triggers → (push endpoint)` domains
  `$.data.pushConfig.pushEndpoint` (graph builder maps known Run/Functions URLs to `triggers → Service`);
  `runsAs → ServiceAccount via $.data.pushConfig.oidcToken.serviceAccountEmail (sa)`;
  `uses → bigquery Table via $.data.bigqueryConfig.table (bq)`;
  `uses → storage Bucket via $.data.cloudStorageConfig.bucket (gcs)`;
  `uses → Topic via $.data.deadLetterPolicy.deadLetterTopic (ps)`; subtitle `push|pull|bigquery|gcs`.
- `Schema [leaf]`, `Snapshot [H]` (`uses → Topic via $.data.topic`).

### managedkafka.googleapis.com
- `Cluster [core]` — `attaches → Subnetwork via $.data.gcpConfig.accessConfig.networkConfigs[*].subnet (rel)`;
  `encryptedBy via $.data.gcpConfig.kmsKey`. `ConnectCluster [core]`
  (`uses → Cluster via $.data.kafkaCluster`;
  `attaches → Subnetwork via $.data.gcpConfig.accessConfig.networkConfigs[*].primarySubnet`).

### dataflow.googleapis.com
- `Job [H]` (shown in data lens when active) — subtitle `type currentState`;
  `attaches → Network|Subnetwork via $.data.environment.sdkPipelineOptions.options.network|subnetwork
  (name/rel)` (verify); `runsAs via $.data.environment.serviceAccountEmail` (verify);
  `uses → Bucket via $.data.environment.tempStoragePrefix (gcs)`;
  `hiddenWhen data.currentState in [JOB_STATE_DONE, JOB_STATE_FAILED, JOB_STATE_CANCELLED]`.

### dataproc.googleapis.com
- `Cluster [core]` —
  `attaches → Network|Subnetwork via $.data.config.gceClusterConfig.networkUri|subnetworkUri (csl)`;
  `runsAs via $.data.config.gceClusterConfig.serviceAccount (sa)`;
  `uses → Bucket via $.data.config.configBucket|tempBucket (gcs)`;
  `encryptedBy via $.data.config.encryptionConfig.gcePdKmsKeyRef`;
  `uses → metastore Service via $.data.config.metastoreConfig.dataprocMetastoreService (rel)`;
  `uses → container Cluster via
  $.data.virtualClusterConfig.kubernetesClusterConfig.gkeClusterConfig.gkeClusterTarget (rel)`;
  `uses → AutoscalingPolicy via $.data.config.autoscalingConfig.policyUri (rel)`; subtitle worker counts.
- `Job [H]` (`uses → Cluster via $.data.placement.clusterName`), `Batch [H]`, `Session [H]` (both: `attaches →
  Subnetwork|Network via $.data.environmentConfig.executionConfig.subnetworkUri|networkUri`, `runsAs via
  ...serviceAccount`, `encryptedBy via ...kmsKey`), `WorkflowTemplate [leaf]`, `AutoscalingPolicy [leaf]`.

### metastore.googleapis.com
- `Service [core]` — `attaches → Network via $.data.network (rel)`; `attaches → Subnetwork via
  $.data.networkConfig.consumers[*].subnetwork (rel)`; domains `$.data.endpointUri`; `encryptedBy via
  $.data.encryptionConfig.kmsKey`. `Federation [core]` (`uses → Service|Dataset via
  $.data.backendMetastores.*.name`), `Backup [H]`, `MetadataImport [H]`.

### composer.googleapis.com
- `Environment [core]` —
  `attaches → Network|Subnetwork via $.data.config.nodeConfig.network|subnetwork (rel)`;
  `runsAs via $.data.config.nodeConfig.serviceAccount (sa)`;
  `uses → container Cluster via $.data.config.gkeCluster (rel)`;
  `uses → Bucket via $.data.config.dagGcsPrefix (gcs)`; domains `$.data.config.airflowUri`;
  `encryptedBy via $.data.config.encryptionConfig.kmsKeyName`; subtitle `softwareConfig.imageVersion`.

### datafusion.googleapis.com
- `Instance [core]` — `attaches → Network via $.data.networkConfig.network (name)`; `attaches → compute
  NetworkAttachment via $.data.networkConfig.privateServiceConnectConfig.networkAttachment (rel)`; ips
  `$.data.networkConfig.ipAllocation`; domains `$.data.serviceEndpoint`, `$.data.apiEndpoint`; `runsAs via
  $.data.dataprocServiceAccount (sa)`; `encryptedBy via $.data.cryptoKeyConfig.keyReference`; subtitle `type
  version`.
- `DnsPeering [core]` — parent instance by name; domains `$.data.domain`; `peers → Network via
  $.data.targetNetwork (name, project $.data.targetProject)`.

### dataform.googleapis.com
- `Repository [container]` — contains ← Workspace, ReleaseConfig, WorkflowConfig, CompilationResult (H),
  WorkflowInvocation (H) by name; domains `$.data.gitRemoteSettings.url` (external); `uses → SecretVersion via
  $.data.gitRemoteSettings.authenticationTokenSecretVersion|sshAuthenticationConfig.userPrivateKeySecretVersion
  (rel)`; `runsAs via $.data.serviceAccount (sa)`; `encryptedBy via $.data.kmsKeyName`.
- `WorkflowConfig [core]` (`uses → ReleaseConfig via $.data.releaseConfig`), `ReleaseConfig [leaf]`,
  `Workspace [leaf]`, `Folder|TeamFolder [H]`.

### dataplex.googleapis.com
- `Lake [container]` — contains ← Zone, Task (by name);
  `uses → metastore Service via $.data.metastore.service (rel)`.
- `Zone [container]` — contains ← Asset (by name); subtitle `type`.
- `Asset [core]` — `uses → storage Bucket|bigquery Dataset via $.data.resourceSpec.name (rel by
  resourceSpec.type)`.
- `Task [core]` — `runsAs via $.data.executionSpec.serviceAccount (sa)`; `attaches → Network|Subnetwork via
  $.data.spark.infrastructureSpec.vpcNetwork.network|subNetwork (name)`.
- `DataScan [core]` — `uses → Table|Asset via $.data.data.resource|entity (bq/rel)`.
- `EntryGroup|EntryType|AspectType|Glossary [leaf]`, `EncryptionConfig [H]`, `MetadataJob [H]`.

### datalineage.googleapis.com — `Process [H]`.

### datastream.googleapis.com
- `Stream [core]` — `uses → ConnectionProfile via $.data.sourceConfig.sourceConnectionProfile|
  destinationConfig.destinationConnectionProfile (rel)`; subtitle `state`.
- `ConnectionProfile [core]` — `uses → Bucket via $.data.gcsProfile.bucket (gcs)`; domains/ips
  `$.data.mysqlProfile.hostname|postgresqlProfile.hostname|oracleProfile.hostname|sqlServerProfile.hostname`;
  `uses → PrivateConnection via $.data.privateConnectivity.privateConnection (rel)`; subtitle profile type.
- `PrivateConnection [core]` — `attaches → Network via $.data.vpcPeeringConfig.vpc (rel)`; ips
  `$.data.vpcPeeringConfig.subnet`; `attaches → compute NetworkAttachment via
  $.data.pscInterfaceConfig.networkAttachment (rel)`.

### datamigration.googleapis.com
- `MigrationJob [core]` — `uses → ConnectionProfile via $.data.source|destination (rel)`;
  `attaches → Network via $.data.vpcPeeringConnectivity.vpc|reverseSshConnectivity.vpc (rel)`;
  `uses → compute Instance via $.data.reverseSshConnectivity.vm (name)`;
  `uses → ConversionWorkspace via $.data.conversionWorkspace.name`.
- `ConnectionProfile [core]` — `uses → sqladmin Instance via $.data.cloudsql.cloudSqlId (name)`;
  `uses → alloydb Cluster via $.data.alloydb.clusterId`; domains/ips
  `$.data.mysql.host|postgresql.host|oracle.host`;
  `uses → PrivateConnection via $.data.*.privateConnectivity.privateConnection (rel)`.
- `PrivateConnection [core]` — `attaches → Network via $.data.vpcPeeringConfig.vpcName (rel)`; ips
  `$.data.vpcPeeringConfig.subnet`. `ConversionWorkspace [leaf]`.

### healthcare.googleapis.com
- `Dataset [container]` — contains ← DicomStore, FhirStore, Hl7V2Store, ConsentStore (by name).
- `FhirStore|DicomStore|Hl7V2Store [core]` —
  `triggers → pubsub Topic via $.data.notificationConfig.pubsubTopic| notificationConfigs[*].pubsubTopic
  (ps)`; FhirStore `uses → bigquery Dataset via $.data.streamConfigs[*].bigqueryDestination.datasetUri (bq)`.
  `ConsentStore [leaf]`.

### looker.googleapis.com
- `Instance [core]` — `attaches → Network via $.data.consumerNetwork (rel)`; ips `$.data.reservedRange`,
  `$.data.ingressPrivateIp`, `$.data.egressPublicIp`; domains `$.data.lookerUri`; `encryptedBy via
  $.data.encryptionConfig.kmsKeyName`; `uses → ServiceAttachment via $.data.pscConfig.serviceAttachmentUri
  (csl)`. `Backup [H]`.

### storagetransfer / storageinsights / storagebatchoperations
- `TransferJob [core]` —
  `uses → Bucket via $.data.transferSpec.gcsDataSource.bucketName|gcsDataSink.bucketName (gcs)`; external
  sources (S3/Azure/HTTP) as subtitle; `hiddenWhen data.status != 'ENABLED'`.
- `ReportConfig [core]` — `uses → Bucket via
  $.data.objectMetadataReportOptions.storageDestinationOptions.bucket|storageFilters.bucket (gcs)`;
  `ReportDetail [H]`.
- `Job [H]` — `uses → Bucket via $.data.bucketList.buckets[*].bucket (gcs)`.

## AI

### aiplatform.googleapis.com (Vertex AI)
- `Endpoint [core]` — `uses → Model via $.data.deployedModels[*].model (rel)` (docs warn the field may be
  unpopulated); `attaches → Network via $.data.network (rel)`; `uses ← PSC consumers via
  $.data.privateServiceConnectConfig.projectAllowlist[*] (proj)`; `encryptedBy via
  $.data.encryptionSpec.kmsKeyName`; domains `$.data.dedicatedEndpointDns`.
- `Model [core]` — `uses → img via $.data.containerSpec.imageUri (img)`; `encryptedBy via encryptionSpec`;
  subtitle `versionId`.
- `IndexEndpoint [core]` — `uses → Index via $.data.deployedIndexes[*].index (rel)`; `attaches → Network via
  $.data.network`; `Index [leaf]`.
- `Featurestore [container]`, `FeatureOnlineStore [core]` (`uses ← PSC consumers via
  $.data.dedicatedServingEndpoint.privateServiceConnectConfig.projectAllowlist[*]`), `FeatureGroup [core]`
  (`uses → bigquery Table via $.data.bigQuery.bigQuerySource.inputUri (bq)`), `MetadataStore [leaf]`,
  `Tensorboard [leaf]`, `Dataset [leaf]`, `DeploymentResourcePool [leaf]`, `SpecialistPool [H]`,
  `CachedContent [H]`, `ReasoningEngine [core]`.
- Jobs [H] (`PipelineJob`, `CustomJob`, `HyperparameterTuningJob`, `NasJob`, `BatchPredictionJob`,
  `TrainingPipeline`, `TuningJob`, `DataLabelingJob`, `ModelDeploymentMonitoringJob`, `NotebookExecutionJob`)
  — `runsAs via $.data.serviceAccount|jobSpec.serviceAccount (sa)`;
  `attaches → Network via $.data.network|jobSpec.network (rel)`;
  `uses → img via $.data.jobSpec.workerPoolSpecs[*].containerSpec.imageUri`; `hiddenWhen state is terminal`.
- `NotebookRuntime [core]`, `NotebookRuntimeTemplate [core]` — `attaches → Network|Subnetwork via
  $.data.networkSpec.network|subnetwork (rel)`; `runsAs via $.data.serviceAccount`; `encryptedBy via
  $.data.encryptionSpec.kmsKeyName`.

### discoveryengine.googleapis.com
- `Collection [container]` → `DataStore [container]` (by name) → `Engine [core]` (`uses → DataStore via
  $.data.dataStoreIds[*]` within the collection) → `Assistant [leaf]` (parent engine); `Notebook [H]`.
### dialogflow.googleapis.com — `Agent [core]` (CX; domains none; subtitle `defaultLanguageCode`),
`LocationSettings [H]`, `ConversationProfile [leaf]`, `KnowledgeBase [leaf]`.
### documentai.googleapis.com — `Processor [core]` (contains ← ProcessorVersion [H]), `HumanReviewConfig [H]`,
`LabelerPool [H]`. speech.googleapis.com — `Recognizer [core]`,
`PhraseSet|CustomClass|Model|Endpoint|Config [H]`. retail.googleapis.com — `Catalog [leaf]`.
cloudaicompanion.googleapis.com — `CodeRepositoryIndex [leaf]`, `RepositoryGroup [H]`.
contactcenterinsights.googleapis.com — all [H]. agentidentity.googleapis.com — `AuthProvider [H]`.

## Security and identity

### iam.googleapis.com
- `ServiceAccount [core]` (identity lens; H in overview) — alias `$.data.email` (the `sa` normaliser index);
  subtitle `data.email`; badge disabled; `runsAs ←` from everything.
- `ServiceAccountKey [H]` — parent SA by name; `hiddenWhen data.keyType == 'SYSTEM_MANAGED'`; subtitle
  `validBeforeTime`.
- `Role [leaf]` (custom roles; parent org or project).
- `WorkloadIdentityPool [container]` → `WorkloadIdentityPoolProvider [core]` (subtitle
  `oidc.issuerUri|aws.accountId`), `WorkloadIdentityPoolNamespace [H]`,
  `WorkloadIdentityPoolManagedIdentity [H]`, `*ProviderKey [H]`.
- `WorkforcePool [container]` (org-level) → `WorkforcePoolProvider [core]`, `*ProviderKey [H]`.
- `OauthClient [leaf]`, `OauthClientCredential [H]`, `PolicyV2 [H]` (deny policies), `PolicyBinding [core]`
  (`uses → PrincipalAccessBoundaryPolicy via $.data.policy (rel)`;
  `secures → target via $.data.target.principalSet`), `PrincipalAccessBoundaryPolicy [leaf]`.

### cloudkms.googleapis.com
- `KeyRing [container]` — contains ← CryptoKey, ImportJob (by name); subtitle `location`.
- `CryptoKey [core]` — contains ← CryptoKeyVersion (H); subtitle `purpose protectionLevel`; `encryptedBy ←`
  from everything via `kms`.
- `CryptoKeyVersion [H]` —
  `uses → EkmConnection via $.data.externalProtectionLevelOptions.ekmConnectionKeyPath` (verify).
- `EkmConnection [core]`
  (`uses → servicedirectory Service via $.data.serviceResolvers[*].serviceDirectoryService (rel)`; domains
  `$.data.serviceResolvers[*].hostname`), `EkmConfig [H]`, `KeyHandle [core]`
  (`uses → CryptoKey via $.data.kmsKey`), `AutokeyConfig [H]` (`uses → Project via $.data.keyProject (rel)`),
  `ImportJob [H]`, `RetiredResource [H]`.

### secretmanager / parametermanager
- `Secret [core]` — subtitle replication; `triggers → pubsub Topic via $.data.topics[*].name (ps)`; contains ←
  SecretVersion (H; `hiddenWhen data.state != 'ENABLED'`). `Parameter [core]`
  (`encryptedBy via $.data.kmsKey`), `ParameterVersion [H]`.

### privateca.googleapis.com
- `CaPool [container]` — contains ← CertificateAuthority, Certificate (H above 20) by name; subtitle `tier`.
- `CertificateAuthority [core]` — subtitle `type state`; `uses → CertificateAuthority via
  $.data.subordinateConfig.certificateAuthority (rel)`; `encryptedBy → CryptoKeyVersion via
  $.data.keySpec.cloudKmsKeyVersion (kms versionLevel)`; `uses → Bucket via $.data.gcsBucket (gcs)`; contains
  ← CertificateRevocationList (H).
- `Certificate [H]` — `uses → CertificateAuthority via $.data.issuerCertificateAuthority (rel)`; `uses →
  CertificateTemplate via $.data.certificateTemplate
  (rel)`; domains `$.data.certificateDescription.subjectDescription.subjectAltName.dnsNames[*]`.
- `CertificateTemplate [leaf]`, `CertificateRevocationList [H]`.

### accesscontextmanager / identity.accesscontextmanager
- `AccessPolicy [container]` (org-level) — contains ← AccessLevel, ServicePerimeter (by name); `secures →
  Folder|Project via $.data.scopes[*] (rel)`.
- `AccessLevel [core]` — ips `$.data.basic.conditions[*].ipSubnetworks[*]`; subtitle condition count.
- `ServicePerimeter [core]` — `secures → Project via $.data.status.resources[*] (proj: projects/NUM)`; `uses →
  AccessLevel via $.data.status.accessLevels[*] (rel)`; subtitle `perimeterType` + restricted service count;
  dry-run (`spec`) shown as a badge; the perimeter lens draws it as a dashed overlay around member projects.
- `AuthorizedOrgsDesc [H]`.

### binaryauthorization.googleapis.com
- `Policy [core]` — `secures → container Cluster via keys of $.data.clusterAdmissionRules (location.cluster →
  name)`; `uses → Attestor via $.data.defaultAdmissionRule.requireAttestationsBy[*] (rel)`. `Attestor [core]`
  (`uses → CryptoKeyVersion via $.data.userOwnedGrafeasNote.publicKeys[*].id (kms versionLevel when prefixed
  //cloudkms.googleapis.com/v1/)`), `PlatformPolicy [leaf]`.

### securitycenter / securitycentermanagement / securityposture
- all securitycenter settings [H]; `BigQueryExport [core]`
  (`uses → bigquery Dataset via $.data.dataset (bq)`), `NotificationConfig [core]`
  (`triggers → pubsub Topic via $.data.pubsubTopic (ps)`), `MuteConfig [H]`, `ResourceValueConfig [H]`;
  securitycentermanagement all [H]; `Posture [leaf]`, `PostureDeployment [core]`
  (`secures → Organization|Folder|Project via $.data.targetResource (rel)`,
  `uses → Posture via $.data.postureId`).

### dlp.googleapis.com
- `JobTrigger [core]` —
  `uses → Bucket via $.data.inspectJob.storageConfig.cloudStorageOptions.fileSet.url (gcs)`;
  `uses → Table via $.data.inspectJob.storageConfig.bigQueryOptions.tableReference (bq)`;
  `uses → InspectTemplate via $.data.inspectJob.inspectTemplateName (rel)`;
  `uses → Table via $.data.inspectJob.actions[*].saveFindings.outputConfig.table (bq)`;
  `triggers → Topic via $.data.inspectJob.actions[*].pubSub.topic (ps)`. `DiscoveryConfig [core]`
  (`secures → Organization|Project via $.data.orgConfig.projectId|location` (verify)),
  `InspectTemplate|DeidentifyTemplate|StoredInfoType [leaf]`, `DlpJob [H]`.

### Others
- `recaptchaenterprise Key [core]` (domains `$.data.webSettings.allowedDomains[*]`), `FirewallPolicy [leaf]`.
- `beyondcorp AppConnector [core]` (`runsAs via $.data.principalInfo.serviceAccount.email`),
  `AppConnection [core]` (domains/ips `$.data.applicationEndpoint.host`;
  `uses → AppConnector via $.data.connectors[*]`; `uses → AppGateway via $.data.gateway.appGateway`),
  `AppGateway [core]` (domains `$.data.uri`), `ClientGateway [H]`, `ClientConnectorService [core]`
  (`attaches → Network via $.data.egress.peeredVpc.networkVpc (rel)`).
- `iap TunnelDestGroup [H]` (ips `$.data.cidrs[*]`; domains `$.data.fqdns[*]`).
- `identitytoolkit Config|Tenant|DefaultSupportedIdpConfig|InboundSamlConfig|OauthIdpConfig [H]`.
- `managedidentities Domain [core]` — `attaches → Network via $.data.authorizedNetworks[*] (rel)`; ips
  `$.data.reservedIpRange`; domains `$.data.fqdn`; `peers → Domain via $.data.trusts[*].targetDomainName`
  (domain).
- `privilegedaccessmanager Grant [H]`.
- `ids Endpoint [core]` — `attaches → Network via $.data.network (rel)`; `routes → compute ForwardingRule via
  $.data.endpointForwardingRule (csl)`; ips `$.data.endpointIp`; subtitle `severity`.
- `websecurityscanner ScanConfig [core]` — domains `$.data.startingUrls[*]`; subtitle target platform.
- `assuredworkloads Workload [core]` — `secures → Folder|Project via $.data.resources[*].resourceId (by
  resourceType)`; subtitle `complianceRegime`.
- `orgpolicy Policy [H]` (badge on parent), `CustomConstraint [leaf]`.
- `essentialcontacts Contact [H]`, `accessapproval AccessApprovalSettings [H]`.

## Developer tooling and delivery

### cloudbuild.googleapis.com
- `BuildTrigger [core]` — `runsAs via $.data.serviceAccount (sa)`; `uses → Repository via
  $.data.repositoryEventConfig.repository (rel)`; external repo as subtitle (`github.owner/name`,
  `triggerTemplate.repoName`); `uses → WorkerPool via $.data.build.options.pool.name (rel)` (verify).
- `Build [H]` — `runsAs via $.data.serviceAccount`;
  `uses → Bucket via $.data.source.storageSource.bucket (gcs)`;
  `uses → WorkerPool via $.data.options.pool.name`; `uses → img via $.data.images[*] (img)`; `hiddenWhen`
  always (count badge on project).
- `WorkerPool [core]` — `attaches → Network via $.data.privatePoolV1Config.networkConfig.peeredNetwork (rel)`;
  ips `...peeredNetworkIpRange`; `attaches → compute NetworkAttachment via
  $.data.privatePoolV1Config.privateServiceConnect.networkAttachment (rel)`.
- `Connection [core]` — subtitle provider (`githubConfig|githubEnterpriseConfig|gitlabConfig|bitbucket*`);
  `uses → SecretVersion via $.data.*.authorizerCredential.oauthTokenSecretVersion|
  readAuthorizerCredential.userTokenSecretVersion|webhookSecretSecretVersion (rel)`; contains ← Repository.
- `Repository [leaf]` — domains `$.data.remoteUri`. `BitbucketServerConfig|GithubEnterpriseConfig [core]`
  (`attaches → Network via $.data.peeredNetwork (rel)`; secrets as above). `GlobalTriggerSettings [H]`.

### artifactregistry.googleapis.com
- `Repository [container]` — subtitle `format mode`; `encryptedBy via $.data.kmsKeyName`;
  `uses → Repository via $.data.virtualRepositoryConfig.upstreamPolicies[*].repository (rel)`; remote upstream
  as subtitle; contains ← DockerImage|MavenArtifact|NpmPackage|PythonPackage (H, count badge), Rule (H).
- containerregistry.googleapis.com/`Image [H]` — count badge on project ("gcr.io images").

### clouddeploy.googleapis.com
- `DeliveryPipeline [container]` — `routes → Target via $.data.serialPipeline.stages[*].targetId (name in same
  project/location)`; contains ← Release (H), Automation (leaf) by name.
- `Target [core]` — `uses → container Cluster via $.data.gke.cluster (rel)`; `uses → gkehub Membership via
  $.data.anthosCluster.membership (rel)`; Cloud Run target: subtitle `run.location`; `uses → CustomTargetType
  via $.data.customTarget.customTargetType (rel)`; `runsAs via $.data.executionConfigs[*].serviceAccount
  (sa)`; `uses → cloudbuild WorkerPool via $.data.executionConfigs[*].workerPool (rel)`; `uses → Bucket via
  $.data.executionConfigs[*].artifactStorage (gcs)`; badge `requireApproval`.
- `Release [H]` (`uses → img via $.data.buildArtifacts[*].image (img)`), `Rollout [H]`, `JobRun [H]`,
  `Automation [leaf]` (`runsAs via $.data.serviceAccount`), `AutomationRun [H]`, `DeployPolicy [leaf]`,
  `CustomTargetType [leaf]`.

### developerconnect / securesourcemanager / config (Infra Manager)
- `developerconnect Connection [core]` — subtitle provider; `uses → SecretVersion via
  $.data.githubConfig.authorizerCredential.oauthTokenSecretVersion|gitlabConfig.*SecretVersion (rel)`;
  `encryptedBy via $.data.cryptoKeyConfig.keyReference`; contains ← GitRepositoryLink (leaf, domains
  `$.data.cloneUri`).
- `InsightsConfig [core]` — `uses → apphub Application via $.data.appHubApplication (rel)`; `uses →
  artifactregistry Repository via $.data.artifactConfigs[*].googleArtifactRegistry.artifactRegistryPackage
  (rel)`.
- `securesourcemanager Instance [core]` — `uses → privateca CaPool via $.data.privateConfig.caPool (rel)`;
  `uses → ServiceAttachment via $.data.privateConfig.httpServiceAttachment|sshServiceAttachment (csl)`;
  domains `$.data.hostConfig.html`; `encryptedBy via $.data.kmsKey`.
- `config Deployment [core]` — `runsAs via $.data.serviceAccount (sa)`; `uses → Bucket via
  $.data.terraformBlueprint.gcsSource|artifactsGcsBucket (gcs)`; external git as subtitle; `uses → cloudbuild
  WorkerPool via $.data.workerPool (rel)`. `Preview [H]` (`uses → Deployment via $.data.deployment`).

### designcenter / saasservicemgmt — all [H]; `designcenter Application [container]` → `Component [core]`
(`uses → config Deployment via $.data.deployment` (verify)); `saasservicemgmt Saas [container]` → `Tenant`,
`UnitKind` → `Unit`, `RolloutKind` → `Rollout`, `Release`.

## Operations and platform

### logging.googleapis.com
- `LogSink [core]` — `uses → Bucket|Dataset|Topic|LogBucket via $.data.destination (sink)`; `runsAs via
  $.data.writerIdentity (sa)`; badge `includeChildren`; subtitle filter (truncated); org/folder sinks live in
  their org/folder zone.
- `LogBucket [core]` — subtitle `retentionDays location`; `encryptedBy via $.data.cmekSettings.kmsKeyName`;
  contains ← LogView (H), Link (`uses → Dataset via $.data.bigqueryDataset.datasetId (bq)`).
- `LogMetric [leaf]`, `Settings [H]` (`encryptedBy via $.data.kmsKeyName`), `SavedQuery|RecentQuery [H]`.

### monitoring.googleapis.com
- `AlertPolicy [core]` — `triggers → NotificationChannel via $.data.notificationChannels[*] (rel)`; badge
  enabled; subtitle condition count.
- `NotificationChannel [core]` — subtitle `type`; `triggers → pubsub Topic via $.data.labels.topic (ps)` when
  `type == 'pubsub'`.
- `UptimeCheckConfig [core]` — domains `$.data.monitoredResource.labels.host`; `uses → compute Instance via
  $.data.monitoredResource.labels.instance_id` (gce_instance; verify id form); subtitle period.
- `Dashboard [leaf]`, `Snooze [H]`.

### osconfig.googleapis.com — `OSPolicyAssignment [core]` (`secures → Instance via
$.data.instanceFilter.inclusionLabels[*]` labels only → badge; `uses → Instance via
$.data.instanceFilter.inventories` no), `PatchDeployment [core]` (`uses → compute Instance via
$.data.instanceFilter.instances[*] (csl)`), `OSPolicyAssignmentReport|VulnerabilityReport [H]`.

### cloudasset / cloudbilling / cloudquotas / serviceusage / servicemanagement / servicedirectory
- `cloudasset Feed [core]` —
  `triggers → pubsub Topic via $.data.feedOutputConfig.pubsubDestination.topic (ps)`.
- `cloudbilling BillingAccount [core]` (org canvas, "Billing" group); `ProjectBillingInfo [H]` — `uses →
  BillingAccount via $.data.billingAccountName (rel)` drawn as a project badge; badge `billingEnabled ==
  false`.
- `cloudquotas QuotaPreference [H]`, `serviceusage Service [H]` (count badge "N APIs enabled" on project),
  `servicemanagement ManagedService [leaf]` (`uses → Project via $.data.producerProjectId (proj)`),
  `Service [H]`.
- `servicedirectory Namespace [container]` → `Service [container]` → `Endpoint [core]` (ips `$.data.address`;
  `attaches → Network via $.data.network (rel: projects/N/locations/global/networks/X)`).

### apphub.googleapis.com
- `Application [container]` (application lens) — contains ← Service, Workload (by name); subtitle
  `scope.type attributes.environment.type`.
- `Service [core]` — `uses → (any) via $.data.serviceReference.uri (full name)`; `Workload [core]` — `uses →
  (any) via $.data.workloadReference.uri`; `ServiceProjectAttachment [core]` — `shares → Project via
  $.data.serviceProject (proj)`.

### backupdr.googleapis.com
- `BackupVault [container]` → `DataSource [core]` (`uses → compute Instance|Disk|sqladmin Instance via
  $.data.dataSourceGcpResource.gcpResourcename (full name)`) → `Backup [H]`; `BackupPlan [core]` (`uses →
  BackupVault via $.data.backupVault (rel)`; subtitle `resourceType`); `BackupPlanAssociation
  [core]` (`secures → Instance|Disk via $.data.resource (full name)`; `uses → BackupPlan via
  $.data.backupPlan`); `ManagementServer [core]` (`attaches → Network via $.data.networks[*].network
  (rel)`; domains `$.data.managementUri.webUi`); `BackupPlanRevision|DataSourceReference [H]`.

### integrations / connectors / apigee / apihub
- `integrations Integration [container]` → `IntegrationVersion [H]`; `AuthConfig [leaf]`,
  `Certificate [leaf]`, `SfdcInstance|SfdcChannel [leaf]` (external), `Execution|Suspension [H]`.
- `connectors Connection [core]` — subtitle `connectorVersion` (connector type);
  `runsAs via $.data.serviceAccount (sa)`;
  `uses → servicedirectory Service via $.data.serviceDirectory (rel)`;
  `uses → EndpointAttachment via $.data.nodeConfig / $.data.connectorVersionInfraConfig` (verify);
  `EndpointAttachment [core]` (`uses → compute ServiceAttachment via $.data.serviceAttachment (csl)`; ips
  `$.data.endpointIp`), `ManagedZone [core]` (domains `$.data.dns`;
  `peers → Network via $.data.targetVpc (name, project $.data.targetProject)`), `EventSubscription [H]`,
  `RegionalSettings|Settings [H]`.
- `apigee Organization [container]` — `attaches → Network via $.data.authorizedNetwork (name/rel)`;
  `encryptedBy via $.data.runtimeDatabaseEncryptionKeyName`; `uses → Project via $.data.projectId (proj)`;
  subtitle `runtimeType`; contains ← Environment, Instance, ApiProxy (by name).
- `Instance [core]` — ips `$.data.host`, `$.data.ipRange`, `$.data.peeringCidrRange`;
  `uses → ServiceAttachment via $.data.serviceAttachment (csl)`;
  `uses ← consumers via $.data.consumerAcceptList[*] (proj)`.
- `Environment [container]`, `ApiProxy [core]` (contains ← ApiProxyRevision [H]), `SecurityAction|
  SecurityMonitoringCondition|SecurityProfileV2 [H]`. `apihub ApiHubInstance [core]` (`encryptedBy via
  $.data.config.cmekKeyName`).

### firebase / firebasedataconnect / firebaserules
- `FirebaseProject [core]` — `uses → Bucket via $.data.resources.storageBucket (gcs)`; domains
  `$.data.resources.hostingSite` (as `<site>.web.app`); `FirebaseAppInfo [leaf]` (subtitle `platform`).
- `firebasedataconnect Service [container]` → `Schema [core]` (`uses → sqladmin Instance via
  $.data.datasource.postgresql.cloudSql.instance (rel)`) → `Connector [leaf]`.
- `firebaserules Ruleset [H]`, `Release [core]` (`uses → Ruleset via $.data.rulesetName`;
  `secures → Bucket via $.data.name` when `firebase.storage/<bucket>`, `→ firestore Database` when
  `cloud.firestore`).

### Media, financial, misc
- `livestream Channel [core]` (`uses → Input via $.data.inputAttachments[*].inputId`; `uses → Bucket via
  $.data.output.uri (gcs)`), `Input [core]` (ips `$.data.uri` host), `Asset [H]`, `Pool [core]` (`peers →
  Network via $.data.networkConfig.peeredNetwork (rel)`).
- `transcoder Job [H]` (`uses → Bucket via $.data.inputUri|outputUri (gcs)`), `JobTemplate [leaf]`.
- `videostitcher CdnKey|LiveConfig|Slate|VodConfig [H]`.
- `financialservices Instance [container]` (`encryptedBy via $.data.kmsKey`) → `Dataset`
  (`uses → bigquery Table via $.data.tableSpecs.* (bq)`), `EngineConfig`, `Model`, `BacktestResult`,
  `PredictionResult` — all [H].
- `blockchainnodeengine BlockchainNode [core]` (domains
  `$.data.connectionInfo.endpointInfo.jsonRpcApiEndpoint`; badge PSC).
- `krmapihosting KrmApiHost [core]`
  (`attaches → Network via $.data.managementConfig.standardManagementConfig.network (rel)`; ips
  `...masterIpv4CidrBlock`).
- `workloadmanager Evaluation [H]`, `migrationcenter Asset|CostAssessmentJob [H]`,
  `cloudcontrolspartner * [H]`.

## Policy and runtime types (not RESOURCE content; listed for completeness)
- Access policy, IAM policy (`iap.googleapis.com/*`), Organization policy entries and OS inventory come from
  other content types; out of scope for v1 ingestion. `compute.googleapis.com/Instance` OS inventory is a
  later layer.
