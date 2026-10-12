// SPDX-License-Identifier: MIT
/**
 * Load balancing and edge (feature `edge`, Secure Web Proxy with `large`): Certificate Manager behind a
 * storefront's HTTPS proxy, Cloud Armor edge policies for backend buckets and a hierarchical policy on the
 * Workloads folder, reserved VIPs of internal load balancers, a Private Service Connect service attachment that
 * publishes an internal load balancer to the partner VPC (with the partner's consumer endpoint), API Gateway in
 * front of a Cloud Run API, and Secure Web Proxy in the host networks.
 */
import { hostAt } from '../core/ip.js';
import type { JsonObject } from '../core/json.js';
import { DAY_MS } from '../core/time.js';
import type { OrgContext } from './context.js';
import { fabricFor, uuidFrom } from './fabric.js';
import {
  addCompute,
  addProjectAsset,
  computeSelfLink,
  fullName,
  type ComputeRef,
  type ProjectCtx,
} from './kit.js';
import { addSubnet, type HostNetwork, type SubnetRef } from './network.js';
import type { Region } from './vocabulary.js';

const CERTIFICATE_MANAGER = 'certificatemanager.googleapis.com';

/**
 * A certificate map with an entry per host name, a Google-managed certificate authorised by DNS, and the DNS
 * authorisation. Returns the map's full name for the proxy's `certificateMap`.
 */
export function addCertificateMap(ctx: OrgContext, project: ProjectCtx, domain: string): string {
  const { b } = ctx;
  const base = `projects/${project.id}/locations/global`;
  const slug = domain.replaceAll('.', '-');
  const authorization = `${base}/dnsAuthorizations/${slug}`;
  const certificate = `${base}/certificates/${slug}`;
  const map = `${base}/certificateMaps/storefront`;
  const asset = (kind: string, path: string, data: JsonObject): number =>
    addProjectAsset(b, project, {
      assetType: `${CERTIFICATE_MANAGER}/${kind}`,
      name: fullName(CERTIFICATE_MANAGER, path),
      location: 'global',
      data: { name: path, ...data },
    }).createdAt;
  asset('DnsAuthorization', authorization, {
    description: `Proves control of ${domain}`,
    domain,
    type: 'FIXED_RECORD',
    dnsResourceRecord: {
      name: `_acme-challenge.${domain}.`,
      type: 'CNAME',
      data: `${uuidFrom(b, authorization)}.6.authorize.certificatemanager.goog.`,
    },
  });
  asset('Certificate', certificate, {
    description: 'Storefront certificate served through the certificate map',
    scope: 'DEFAULT',
    sanDnsnames: [domain, `*.${domain}`],
    managed: {
      domains: [domain, `*.${domain}`],
      dnsAuthorizations: [authorization],
      state: 'ACTIVE',
      authorizationAttemptInfo: [
        { domain, state: 'AUTHORIZED' },
        { domain: `*.${domain}`, state: 'AUTHORIZED' },
      ],
    },
    expireTime: '2027-01-12T08:00:00Z',
  });
  asset('CertificateMap', map, { description: 'Certificates of the storefront load balancer' });
  for (const [entry, hostname] of [
    ['apex', domain],
    ['www', `www.${domain}`],
  ] as const) {
    asset('CertificateMapEntry', `${map}/certificateMapEntries/${entry}`, {
      hostname,
      state: 'ACTIVE',
      certificates: [certificate],
    });
  }
  return fullName(CERTIFICATE_MANAGER, map);
}

/** A Cloud Armor edge security policy (cache-level filtering for backend buckets). */
export function addEdgePolicy(ctx: OrgContext, project: ProjectCtx): ComputeRef {
  return addCompute(ctx.b, project, {
    kind: 'SecurityPolicy',
    collection: 'securityPolicies',
    scope: 'global',
    name: 'web-edge',
    data: {
      description: 'Edge filtering in front of the cached static content',
      type: 'CLOUD_ARMOR_EDGE',
      rules: [
        {
          kind: 'compute#securityPolicyRule',
          description: 'Default rule, higher priority overrides it',
          priority: 2147483647,
          action: 'allow',
          match: { versionedExpr: 'SRC_IPS_V1', config: { srcIpRanges: ['*'] } },
          preview: false,
        },
      ],
      fingerprint: 'cB3x0Fq8sYk=',
    },
  });
}

/** The organisation's hierarchical Cloud Armor policy, associated with the Workloads folder. */
export function addOrganisationArmor(ctx: OrgContext): void {
  const { b, org } = ctx;
  const id = `8${b.rng.fork('org-security-policy').digits(10)}`;
  b.add({
    assetType: 'compute.googleapis.com/SecurityPolicy',
    name: `//compute.googleapis.com/locations/global/securityPolicies/${id}`,
    parent: org.full,
    ancestors: org.ancestors,
    location: 'global',
    after: org.createdAt + 1000 * DAY_MS,
    data: {
      kind: 'compute#securityPolicy',
      id,
      name: id,
      shortName: 'workloads-baseline',
      description: 'Baseline WAF rules for every backend service under Workloads',
      type: 'CLOUD_ARMOR',
      parent: ctx.org.ref,
      associations: [
        {
          name: 'workloads-baseline-workloads',
          attachmentId: ctx.folders.workloads.ref,
          displayName: 'Workloads',
          securityPolicyId: id,
          shortName: 'workloads-baseline',
        },
      ],
      rules: [
        {
          kind: 'compute#securityPolicyRule',
          description: 'Block cross-site scripting',
          priority: 1000,
          action: 'deny(403)',
          match: { expr: { expression: "evaluatePreconfiguredWaf('xss-v33-stable')" } },
          preview: false,
        },
        {
          kind: 'compute#securityPolicyRule',
          description: 'Continue with the project policies',
          priority: 2147483647,
          action: 'goto_next',
          match: { versionedExpr: 'SRC_IPS_V1', config: { srcIpRanges: ['*'] } },
          preview: false,
        },
      ],
      selfLink: `https://www.googleapis.com/compute/v1/locations/global/securityPolicies/${id}`,
      fingerprint: 'Hk2s9Wq1vRo=',
    },
  });
}

/** The reserved internal address of an internal load balancer (its forwarding rule is the only user). */
export function addInternalVip(
  ctx: OrgContext,
  project: ProjectCtx,
  region: Region,
  subnet: SubnetRef,
  name: string,
  ip: string,
  rule: string,
): void {
  addCompute(ctx.b, project, {
    kind: 'Address',
    collection: 'addresses',
    scope: { region: region.name },
    name,
    after: subnet.createdAt,
    data: {
      description: 'Reserved VIP of the internal load balancer',
      address: ip,
      status: 'IN_USE',
      addressType: 'INTERNAL',
      purpose: 'GCE_ENDPOINT',
      subnetwork: subnet.selfLink,
      users: [computeSelfLink(project.id, `regions/${region.name}/forwardingRules/${rule}`)],
      labelFingerprint: '42WmSpB8rSM=',
    },
  });
}

/**
 * Publishes an internal load balancer through a Private Service Connect service attachment (NAT subnet in the
 * production host) and connects the partner exchange to it with a consumer endpoint in the partner VPC.
 */
export function addPscProducer(
  ctx: OrgContext,
  project: ProjectCtx,
  region: Region,
  host: HostNetwork,
  rule: ComputeRef,
): void {
  const { b, partner } = ctx;
  const nat = fabricFor(ctx, host)?.pscNat;
  if (nat === undefined) return;
  const name = `inventory-${project.team}`;
  const attachmentLink = computeSelfLink(project.id, `regions/${region.name}/serviceAttachments/${name}`);
  const endpointName = `psc-${name}`;
  const endpointLink = computeSelfLink(
    partner.project.id,
    `regions/${partner.region.name}/forwardingRules/${endpointName}`,
  );
  const connectionId = b.rng.fork(`psc:${attachmentLink}`).digits(17);
  const attachment = addCompute(b, project, {
    kind: 'ServiceAttachment',
    collection: 'serviceAttachments',
    scope: { region: region.name },
    name,
    after: Math.max(rule.asset.createdAt, nat.createdAt),
    data: {
      description: 'Publishes the inventory API to the partner exchange',
      targetService: rule.selfLink,
      producerForwardingRule: rule.selfLink,
      natSubnets: [nat.selfLink],
      connectionPreference: 'ACCEPT_MANUAL',
      consumerAcceptLists: [{ projectIdOrNum: partner.project.id, connectionLimit: 10 }],
      connectedEndpoints: [
        {
          endpoint: endpointLink,
          pscConnectionId: connectionId,
          status: 'ACCEPTED',
          consumerNetwork: partner.networkSelfLink,
          natIps: [nat.hosts.next()],
          propagatedConnectionCount: 0,
        },
      ],
      domainNames: [`inventory-${project.team}.partners.example.org.`],
      enableProxyProtocol: false,
      reconcileConnections: false,
      fingerprint: 'Cq3m8v9KyHE=',
    },
  });
  addCompute(b, partner.project, {
    kind: 'ForwardingRule',
    collection: 'forwardingRules',
    scope: { region: partner.region.name },
    name: endpointName,
    after: Math.max(attachment.asset.createdAt, partner.createdAt),
    data: {
      description: `Private Service Connect endpoint for the ${project.team} inventory API`,
      IPAddress: partner.hosts.next(),
      target: attachmentLink,
      network: partner.networkSelfLink,
      subnetwork: partner.subnetSelfLink,
      loadBalancingScheme: '',
      pscConnectionId: connectionId,
      pscConnectionStatus: 'ACCEPTED',
      labelFingerprint: '42WmSpB8rSM=',
      fingerprint: 'Ow1m4cLx8kE=',
    },
  });
}

/** API Gateway in front of a Cloud Run API: the API, its current config and a regional gateway. */
export function addApiGateway(
  ctx: OrgContext,
  project: ProjectCtx,
  region: Region,
  serviceAccount: string,
  backend: string,
): void {
  const { b } = ctx;
  const api = `projects/${project.id}/locations/global/apis/orders`;
  const config = `${api}/configs/orders-v4`;
  const hash = b.rng.fork(`apigw:${project.id}`).chars('abcdefghijklmnopqrstuvwxyz0123456789', 8);
  const add = (kind: string, path: string, location: string, data: JsonObject): number =>
    addProjectAsset(b, project, {
      assetType: `apigateway.googleapis.com/${kind}`,
      name: fullName('apigateway.googleapis.com', path),
      location,
      data: { name: path, ...data },
    }).createdAt;
  add('Api', api, 'global', {
    displayName: 'Orders API',
    state: 'ACTIVE',
    managedService: `orders-${hash}.apigateway.${project.id}.cloud.goog`,
    labels: { team: project.team },
  });
  add('ApiConfig', config, 'global', {
    displayName: 'orders-v4',
    state: 'ACTIVE',
    gatewayServiceAccount: serviceAccount,
    serviceConfigId: `orders-v4-${hash}`,
    labels: { backend: backend.slice(backend.lastIndexOf('/') + 1) },
  });
  add('Gateway', `projects/${project.id}/locations/${region.name}/gateways/orders-gw`, region.name, {
    displayName: 'orders-gw',
    state: 'ACTIVE',
    apiConfig: config,
    defaultHostname: `orders-gw-${hash}.${region.runCode}.gateway.example.com`,
  });
}

/**
 * Secure Web Proxy in a host network: the proxy-only subnet, the gateway with its regional certificate, its
 * policy with two rules and the URL list of the partner hosts the workloads may reach.
 */
export function addSecureWebProxy(ctx: OrgContext, host: HostNetwork): void {
  const { b } = ctx;
  const region = host.regions[0];
  const fabric = fabricFor(ctx, host);
  if (region === undefined || fabric === undefined) return;
  const project = host.project;
  addSubnet(b, host, {
    region,
    name: `proxy-only-${region.name}`,
    prefix: 26,
    purpose: 'REGIONAL_MANAGED_PROXY',
  });
  const base = `projects/${project.id}/locations/${region.name}`;
  const policy = `${base}/gatewaySecurityPolicies/egress-${host.env}`;
  const urlList = `${base}/urlLists/partner-hosts`;
  const certificate = `${base}/certificates/swp-${host.env}`;
  const add = (assetType: string, path: string, data: JsonObject): number =>
    addProjectAsset(b, project, {
      assetType,
      name: fullName(assetType.split('/')[0] ?? '', path),
      location: region.name,
      after: host.createdAt,
      data: { name: path, ...data },
    }).createdAt;
  add(`${CERTIFICATE_MANAGER}/Certificate`, certificate, {
    description: `Server certificate of the ${host.env} Secure Web Proxy`,
    scope: 'DEFAULT',
    sanDnsnames: [`swp.${host.env}.example.com`],
    expireTime: '2027-03-02T08:00:00Z',
  });
  add('networksecurity.googleapis.com/UrlList', urlList, {
    description: 'Partner hosts the workloads may call',
    values: ['api.partners.example.net', '*.logistics.example.net'],
  });
  add('networksecurity.googleapis.com/GatewaySecurityPolicy', policy, {
    description: `Egress policy of the ${host.env} workloads`,
  });
  const rules: readonly [string, number, string, string][] = [
    ['allow-partners', 1000, 'ALLOW', `inUrlList(host(), '${urlList}')`],
    ['deny-all', 65000, 'DENY', 'true'],
  ];
  for (const [rule, priority, basicProfile, sessionMatcher] of rules) {
    add('networksecurity.googleapis.com/GatewaySecurityPolicyRule', `${policy}/rules/${rule}`, {
      enabled: true,
      priority,
      basicProfile,
      sessionMatcher,
      description: rule === 'deny-all' ? 'Everything else' : 'Partner APIs',
    });
  }
  add('networkservices.googleapis.com/Gateway', `${base}/gateways/swp-${host.env}`, {
    type: 'SECURE_WEB_GATEWAY',
    addresses: [fabric.endpoints.hosts.next()],
    ports: [443],
    scope: `swp-${host.env}`,
    network: host.path,
    subnetwork: fabric.endpoints.path,
    gatewaySecurityPolicy: policy,
    certificateUrls: [certificate],
    routingMode: 'EXPLICIT_ROUTING_MODE',
  });
}

/**
 * Apigee X in a project: the organisation (named after the project) peered with the host network, a
 * production environment and a runtime instance on the private services access range, CMEK-encrypted.
 */
export function addApigee(ctx: OrgContext, project: ProjectCtx, region: Region, host: HostNetwork): void {
  const { b } = ctx;
  const org = `//apigee.googleapis.com/organizations/${project.id}`;
  const key = ctx.keys.key(region.name, 'storage');
  const add = (assetType: string, name: string, location: string, data: JsonObject, after?: number): number =>
    addProjectAsset(b, project, {
      assetType,
      name,
      location,
      data,
      ...(after === undefined ? {} : { after }),
    }).createdAt;
  const created = add(
    'apigee.googleapis.com/Organization',
    org,
    'global',
    {
      name: project.id,
      displayName: 'Storefront partner APIs',
      projectId: project.id,
      runtimeType: 'CLOUD',
      subscriptionType: 'PAID',
      billingType: 'PAYG',
      analyticsRegion: region.name,
      apiConsumerDataLocation: region.name,
      authorizedNetwork: host.path,
      state: 'ACTIVE',
      ...(key === undefined
        ? {}
        : { runtimeDatabaseEncryptionKeyName: key, apiConsumerDataEncryptionKeyName: key }),
    },
    host.psa.createdAt,
  );
  add(
    'apigee.googleapis.com/Environment',
    `${org}/environments/prod`,
    'global',
    {
      name: 'prod',
      displayName: 'Production',
      description: 'Partner-facing APIs',
      state: 'ACTIVE',
      type: 'COMPREHENSIVE',
      deploymentType: 'PROXY',
      apiProxyType: 'PROGRAMMABLE',
      nodeConfig: { minNodeCount: '2', maxNodeCount: '10', currentAggregateNodeCount: '2' },
    },
    created,
  );
  const range = b.addresses.privateServices.allocate(22);
  const tenant = `${b.rng.fork(`apigee:${project.id}`).hex(14)}-tp`;
  add(
    'apigee.googleapis.com/Instance',
    `${org}/instances/${region.runCode}`,
    region.name,
    {
      name: region.runCode,
      location: region.name,
      displayName: region.name,
      description: `Runtime in ${region.name}`,
      host: hostAt(range, 2),
      port: '443',
      ipRange: range,
      peeringCidrRange: 'SLASH_22',
      state: 'ACTIVE',
      runtimeVersion: '1-14-0-apigee-4',
      consumerAcceptList: [project.id],
      serviceAttachment: `projects/${tenant}/regions/${region.name}/serviceAttachments/apigee-${region.name}-${b.rng.fork(`apigee-sa:${project.id}`).hex(4)}`,
      ...(key === undefined ? {} : { diskEncryptionKeyName: key }),
    },
    created,
  );
}
