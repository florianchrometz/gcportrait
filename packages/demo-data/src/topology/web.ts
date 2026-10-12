// SPDX-License-Identifier: MIT
/**
 * A web workload in a Shared VPC service project: a managed instance group behind a global external
 * Application Load Balancer (address → forwarding rule → target HTTPS proxy with a managed certificate →
 * URL map → backend services with Cloud Armor → instance group and a serverless NEG for a Cloud Run API),
 * optionally a backend bucket for static files and an HTTP-to-HTTPS redirect, and an internal passthrough
 * load balancer in front of a second group. The first web project's group is the one the history scales out.
 */
import { uuid } from '../core/ids.js';
import type { JsonObject } from '../core/json.js';
import { HOUR_MS } from '../core/time.js';
import { addInstanceTemplate, addManagedInstanceGroup, makeInstance } from './compute.js';
import { hostFor, type OrgContext } from './context.js';
import { addApigee, addCertificateMap, addEdgePolicy, addInternalVip, addPscProducer } from './edge.js';
import { fabricFor } from './fabric.js';
import { has } from './features.js';
import {
  addCompute,
  addProject,
  addProjectAsset,
  addServiceAccount,
  fullName,
  standardLabels,
  type ContainerCtx,
  type ProjectCtx,
} from './kit.js';
import { addCustomImages } from './machines.js';
import { addSubnet } from './network.js';
import { addBucket } from './storage.js';
import { addRedis, addValkey } from './stores.js';
import { DEBIAN_LICENSE, MACHINE_TYPES, type Env, type Region } from './vocabulary.js';

export interface WebProfile {
  /** Instances in the web group (the scaling group starts with this many). */
  readonly instances: number;
  /** How many instances the scale-out event adds to the first web project's group. */
  readonly scaleOutBy: number;
  readonly autoscaler: boolean;
  readonly staticSite: boolean;
  readonly httpRedirect: boolean;
  readonly sslPolicy: boolean;
  /** Instances behind the internal load balancer; 0 leaves the internal load balancer out. */
  readonly internalInstances: number;
}

export function webDomain(team: string, env: Env): string {
  return env === 'prod' ? `${team}.example.org` : `${team}-${env}.example.org`;
}

export function addWebProject(
  ctx: OrgContext,
  folder: ContainerCtx,
  team: string,
  env: Env,
  region: Region,
): ProjectCtx {
  const { b, profile } = ctx;
  const web = profile.web;
  const host = hostFor(ctx, env);
  const project = addProject(b, folder, {
    role: 'web',
    displayName: `${title(team)} web (${env})`,
    env,
    region,
    team,
  });
  const rng = b.rng.fork(`web:${project.id}`);
  const labels = standardLabels(project, { app: 'storefront' });
  const zone = region.zones[0] ?? `${region.name}-a`;
  const subnet = addSubnet(b, host, { region, name: `${project.id}-${region.name}`, prefix: 22 });
  const account = addServiceAccount(b, project, 'web-frontend', 'Web tier VMs');
  // The host admits the internal gRPC port to this project's VMs by service account (Shared VPC practice).
  addCompute(b, host.project, {
    kind: 'Firewall',
    collection: 'firewalls',
    scope: 'global',
    name: `allow-grpc-to-${project.id}`,
    after: Math.max(host.createdAt, account.asset.createdAt),
    data: {
      description: `Internal gRPC to the ${team} web tier`,
      network: host.selfLink,
      priority: 1000,
      direction: 'INGRESS',
      disabled: false,
      sourceRanges: ['10.0.0.0/8'],
      targetServiceAccounts: [account.email],
      allowed: [{ IPProtocol: 'tcp', ports: ['8443'] }],
      logConfig: { enable: false },
    },
  });
  const kmsKey = ctx.keys.key(region.name, 'compute');
  const kmsKeyVersion = ctx.keys.keyVersion(region.name, 'compute');
  const scales = ctx.once('mig-scale-out');
  const edge = has(profile, 'edge');
  // The first storefront of each environment bakes its own image family.
  const image =
    has(profile, 'compute') && ctx.once(`custom-image:${env}`)
      ? addCustomImages(b, project, region, 'storefront', kmsKeyVersion)
      : undefined;

  const healthCheck = addCompute(b, project, {
    kind: 'HealthCheck',
    collection: 'healthChecks',
    scope: 'global',
    name: 'web-hc',
    data: {
      checkIntervalSec: 10,
      timeoutSec: 5,
      unhealthyThreshold: 3,
      healthyThreshold: 2,
      type: 'HTTP',
      httpHealthCheck: { port: 8080, requestPath: '/healthz', proxyHeader: 'NONE' },
      logConfig: { enable: false },
    },
  });
  const template = addInstanceTemplate(b, project, {
    name: `web-tmpl-v${String(rng.int(2, 9))}`,
    machineType: MACHINE_TYPES.web,
    network: host.selfLink,
    subnetwork: subnet.selfLink,
    serviceAccount: account.email,
    tags: ['lb-backend', 'web'],
    labels,
    startupScript: '#! /bin/bash\nsystemctl enable --now storefront.service',
    ...(kmsKey === undefined ? {} : { kmsKey }),
    ...(image === undefined ? {} : { image: image.relative }),
  });
  // A canary template that one storefront rolls out to a fifth of its group (not the group that scales out).
  const canary =
    has(profile, 'compute') && !scales && ctx.once('mig-canary')
      ? addInstanceTemplate(b, project, {
          name: 'web-tmpl-canary',
          machineType: MACHINE_TYPES.web,
          network: host.selfLink,
          subnetwork: subnet.selfLink,
          serviceAccount: account.email,
          tags: ['lb-backend', 'web'],
          labels: { ...labels, track: 'canary' },
          startupScript: '#! /bin/bash\nsystemctl enable --now storefront.service',
          ...(kmsKey === undefined ? {} : { kmsKey }),
          ...(image === undefined ? {} : { image: image.relative }),
        })
      : undefined;
  const namedPorts: JsonObject[] = [{ name: 'http', port: 8080 }];
  const mig = addManagedInstanceGroup(b, project, {
    name: 'web-mig',
    zone,
    baseInstanceName: 'web',
    template,
    size: web.instances,
    machineType: MACHINE_TYPES.web,
    nic: { network: host.selfLink, subnetwork: subnet.selfLink },
    nextIp: () => subnet.hosts.next(),
    serviceAccount: account.email,
    tags: ['lb-backend', 'web'],
    labels,
    namedPorts,
    healthCheck: healthCheck.selfLink,
    ...(kmsKeyVersion === undefined ? {} : { kmsKeyVersion }),
    ...(web.autoscaler ? { autoscaler: { min: web.instances, max: web.instances * 4 } } : {}),
    ...(image === undefined ? {} : { image: image.selfLink, imageLicense: DEBIAN_LICENSE }),
    ...(canary === undefined ? {} : { canary: { template: canary, percent: 20 } }),
    rng: rng.fork('mig'),
    pinned: scales,
  });
  if (scales) {
    b.specials.push({
      id: 'mig-scale-out',
      plan: (at) => {
        const target = web.instances + web.scaleOutBy;
        const resize =
          (path: readonly string[]) =>
          (data: JsonObject): JsonObject =>
            setNumber(data, path, target);
        return {
          adds: mig.makeInstances(web.scaleOutBy, at),
          removes: [],
          changes: [
            {
              name: mig.manager.asset.name,
              fields: ['targetSize', 'versions'],
              forward: (data) => ({
                ...resize(['targetSize'])(data),
                versions: [{ instanceTemplate: template.selfLink, targetSize: { calculated: target } }],
              }),
            },
            { name: mig.group.asset.name, fields: ['size'], forward: resize(['size']) },
            ...(mig.autoscaler === undefined
              ? []
              : [
                  {
                    name: mig.autoscaler.asset.name,
                    fields: ['recommendedSize'],
                    forward: resize(['recommendedSize']),
                  },
                ]),
          ],
        };
      },
    });
  }

  // A small Cloud Run API behind a serverless NEG.
  const runName = 'storefront-api';
  const runPath = `projects/${project.id}/locations/${region.name}/services/${runName}`;
  const runHash = rng.chars('abcdefghijklmnopqrstuvwxyz', 10);
  addProjectAsset(b, project, {
    assetType: 'run.googleapis.com/Service',
    name: fullName('run.googleapis.com', runPath),
    location: region.name,
    data: runServiceData(project, region, runName, runHash, {
      uid: uuid(rng),
      serviceAccount: account.email,
      ingress: 'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER',
      image: `${region.name}-docker.pkg.dev/${project.id}/apps/${runName}:2.3.1`,
      generation: rng.int(4, 40),
    }),
  });
  const neg = addCompute(b, project, {
    kind: 'NetworkEndpointGroup',
    collection: 'networkEndpointGroups',
    scope: { region: region.name },
    name: 'web-run-neg',
    data: { networkEndpointType: 'SERVERLESS', cloudRun: { service: runName }, size: 0 },
  });
  const armor = addCompute(b, project, {
    kind: 'SecurityPolicy',
    collection: 'securityPolicies',
    scope: 'global',
    name: 'web-armor',
    data: {
      description: 'Edge protection for the storefront',
      type: 'CLOUD_ARMOR',
      rules: [
        {
          kind: 'compute#securityPolicyRule',
          description: 'Block SQL injection',
          priority: 1000,
          action: 'deny(403)',
          match: { expr: { expression: "evaluatePreconfiguredWaf('sqli-v33-stable')" } },
          preview: false,
        },
        {
          kind: 'compute#securityPolicyRule',
          description: 'Default rule, higher priority overrides it',
          priority: 2147483647,
          action: 'allow',
          match: { versionedExpr: 'SRC_IPS_V1', config: { srcIpRanges: ['*'] } },
          preview: false,
        },
      ],
      adaptiveProtectionConfig: { layer7DdosDefenseConfig: { enable: true } },
      fingerprint: 'xR2fJ9NbI0s=',
    },
  });
  const backendService = (name: string, data: JsonObject): ReturnType<typeof addCompute> =>
    addCompute(b, project, {
      kind: 'BackendService',
      collection: 'backendServices',
      scope: 'global',
      name,
      data: {
        loadBalancingScheme: 'EXTERNAL_MANAGED',
        securityPolicy: armor.selfLink,
        sessionAffinity: 'NONE',
        localityLbPolicy: 'ROUND_ROBIN',
        connectionDraining: { drainingTimeoutSec: 300 },
        logConfig: { enable: true, sampleRate: 1 },
        enableCDN: false,
        iap: { enabled: false },
        fingerprint: 'n1D7AmPf3oI=',
        ...data,
      },
    });
  const vmBackend = backendService('web-bes', {
    backends: [
      { group: mig.group.selfLink, balancingMode: 'UTILIZATION', maxUtilization: 0.8, capacityScaler: 1 },
    ],
    healthChecks: [healthCheck.selfLink],
    protocol: 'HTTP',
    port: 8080,
    portName: 'http',
    timeoutSec: 30,
    // Cloud CDN caches the storefront pages (feature `edge`).
    ...(edge
      ? {
          enableCDN: true,
          cdnPolicy: {
            cacheMode: 'CACHE_ALL_STATIC',
            defaultTtl: 3600,
            maxTtl: 86400,
            clientTtl: 3600,
            negativeCaching: true,
            serveWhileStale: 86400,
            signedUrlCacheMaxAgeSec: '0',
          },
        }
      : {}),
  });
  // The first storefront's API sits behind Identity-Aware Proxy (feature `edge`).
  const iap = edge && ctx.once('iap-backend');
  const apiBackend = backendService('web-api-bes', {
    backends: [{ group: neg.selfLink, balancingMode: 'UTILIZATION', capacityScaler: 1 }],
    protocol: 'HTTPS',
    timeoutSec: 30,
    ...(iap
      ? {
          iap: {
            enabled: true,
            oauth2ClientId: `${b.rng.fork(`iap:${project.id}`).digits(12)}-${b.rng.fork(`iap2:${project.id}`).chars('abcdefghijklmnopqrstuvwxyz0123456789', 32)}.apps.googleusercontent.com`,
          },
        }
      : {}),
  });
  const pathRules: JsonObject[] = [{ paths: ['/api', '/api/*'], service: apiBackend.selfLink }];
  if (web.staticSite) {
    const bucket = addBucket(b, project, {
      name: `${project.id}-static`,
      region,
      labels,
      website: true,
      ...(ctx.management === undefined ? {} : { logBucket: ctx.management.accessLogs }),
    });
    const edgePolicy = edge && env === 'prod' ? addEdgePolicy(ctx, project) : undefined;
    const backendBucket = addCompute(b, project, {
      kind: 'BackendBucket',
      collection: 'backendBuckets',
      scope: 'global',
      name: 'web-static',
      after: bucket.createdAt,
      data: {
        description: 'Static assets',
        bucketName: bucket.data['name'] ?? '',
        enableCdn: true,
        cdnPolicy: { cacheMode: 'CACHE_ALL_STATIC', defaultTtl: 3600, maxTtl: 86400, clientTtl: 3600 },
        edgeSecurityPolicy: (edgePolicy ?? armor).selfLink,
      },
    });
    pathRules.push({ paths: ['/static/*'], service: backendBucket.selfLink });
  }
  const domain = webDomain(team, env);
  const urlMap = addCompute(b, project, {
    kind: 'UrlMap',
    collection: 'urlMaps',
    scope: 'global',
    name: 'web-urlmap',
    data: {
      defaultService: vmBackend.selfLink,
      hostRules: [{ hosts: [domain, `www.${domain}`], pathMatcher: 'storefront' }],
      pathMatchers: [{ name: 'storefront', defaultService: vmBackend.selfLink, pathRules }],
      fingerprint: 'Ss4nB0HJE3A=',
    },
  });
  const certificate = addCompute(b, project, {
    kind: 'SslCertificate',
    collection: 'sslCertificates',
    scope: 'global',
    name: `cert-${domain.replaceAll('.', '-')}`,
    data: {
      type: 'MANAGED',
      managed: {
        domains: [domain, `www.${domain}`],
        status: 'ACTIVE',
        domainStatus: { [domain]: 'ACTIVE', [`www.${domain}`]: 'ACTIVE' },
      },
      subjectAlternativeNames: [domain, `www.${domain}`],
      expireTime: '2027-01-05T10:00:00.000-08:00',
    },
  });
  const sslPolicy = web.sslPolicy
    ? addCompute(b, project, {
        kind: 'SslPolicy',
        collection: 'sslPolicies',
        scope: 'global',
        name: 'tls12-modern',
        data: { profile: 'MODERN', minTlsVersion: 'TLS_1_2', fingerprint: 'Sn1qRnXyJmc=' },
      })
    : undefined;
  // The first storefront moved to Certificate Manager; the classic certificate is still attached (ignored).
  const certificateMap =
    edge && ctx.once('certificate-map') ? addCertificateMap(ctx, project, domain) : undefined;
  const httpsProxy = addCompute(b, project, {
    kind: 'TargetHttpsProxy',
    collection: 'targetHttpsProxies',
    scope: 'global',
    name: 'web-https-proxy',
    after: Math.max(urlMap.asset.createdAt, certificate.asset.createdAt),
    data: {
      urlMap: urlMap.selfLink,
      sslCertificates: [certificate.selfLink],
      ...(certificateMap === undefined ? {} : { certificateMap }),
      quicOverride: 'NONE',
      tlsEarlyData: 'DISABLED',
      fingerprint: 'tVJ2lXzOs8g=',
      ...(sslPolicy === undefined ? {} : { sslPolicy: sslPolicy.selfLink }),
    },
  });
  const ip = b.addresses.external.next();
  const addressName = 'web-ip';
  const httpsRule = forwardingRule(
    ctx,
    project,
    'web-https-fr',
    ip,
    '443-443',
    httpsProxy.selfLink,
    httpsProxy.asset.createdAt,
  );
  const users = [httpsRule];
  if (web.httpRedirect) {
    const redirect = addCompute(b, project, {
      kind: 'UrlMap',
      collection: 'urlMaps',
      scope: 'global',
      name: 'web-http-redirect',
      data: {
        defaultUrlRedirect: {
          httpsRedirect: true,
          redirectResponseCode: 'MOVED_PERMANENTLY_DEFAULT',
          stripQuery: false,
        },
        fingerprint: 'J2s1D2QZ5mU=',
      },
    });
    const httpProxy = addCompute(b, project, {
      kind: 'TargetHttpProxy',
      collection: 'targetHttpProxies',
      scope: 'global',
      name: 'web-http-proxy',
      after: redirect.asset.createdAt,
      data: { urlMap: redirect.selfLink, fingerprint: 'Fq1w5Hj3Oos=' },
    });
    users.push(
      forwardingRule(ctx, project, 'web-http-fr', ip, '80-80', httpProxy.selfLink, httpProxy.asset.createdAt),
    );
  }
  addCompute(b, project, {
    kind: 'GlobalAddress',
    collection: 'addresses',
    scope: 'global',
    name: addressName,
    data: {
      description: `Anycast address of ${domain}`,
      address: ip,
      status: 'IN_USE',
      addressType: 'EXTERNAL',
      ipVersion: 'IPV4',
      networkTier: 'PREMIUM',
      users,
      labelFingerprint: '42WmSpB8rSM=',
    },
  });
  ctx.publicRecords.push({ name: `${domain}.`, type: 'A', rrdatas: [ip] });
  ctx.publicRecords.push({ name: `www.${domain}.`, type: 'CNAME', rrdatas: [`${domain}.`] });
  // Developers start throw-away VMs on the web subnet now and then.
  b.ephemerals.push({
    kind: 'test-vm',
    weight: 2,
    notBefore: subnet.createdAt,
    make: (createdAt, serial) =>
      makeInstance(
        b,
        project,
        {
          zone,
          name: `test-vm-${String(serial)}`,
          machineType: MACHINE_TYPES.api,
          nic: { network: host.selfLink, subnetwork: subnet.selfLink, ip: subnet.hosts.next() },
          serviceAccount: account.email,
          labels: { ...labels, purpose: 'testing' },
        },
        createdAt,
      ),
  });

  let internal: { readonly selfLink: string; readonly ip: string } | undefined;
  let apiGroup: string | undefined;
  if (web.internalInstances > 0) {
    const apiMig = addManagedInstanceGroup(b, project, {
      name: 'api-mig',
      zone,
      baseInstanceName: 'api',
      template,
      size: web.internalInstances,
      machineType: MACHINE_TYPES.web,
      nic: { network: host.selfLink, subnetwork: subnet.selfLink },
      nextIp: () => subnet.hosts.next(),
      serviceAccount: account.email,
      tags: ['lb-backend', 'api'],
      labels: { ...labels, app: 'inventory-api' },
      namedPorts: [{ name: 'grpc', port: 8443 }],
      healthCheck: healthCheck.selfLink,
      ...(kmsKeyVersion === undefined ? {} : { kmsKeyVersion }),
      rng: rng.fork('api-mig'),
    });
    const internalBackend = addCompute(b, project, {
      kind: 'RegionBackendService',
      collection: 'backendServices',
      scope: { region: region.name },
      name: 'api-ilb-bes',
      after: apiMig.group.asset.createdAt,
      data: {
        backends: [{ group: apiMig.group.selfLink, balancingMode: 'CONNECTION' }],
        healthChecks: [healthCheck.selfLink],
        protocol: 'TCP',
        loadBalancingScheme: 'INTERNAL',
        network: host.selfLink,
        sessionAffinity: 'NONE',
        connectionDraining: { drainingTimeoutSec: 0 },
        fingerprint: 'KZf3bHVAcBQ=',
      },
    });
    const internalIp = subnet.hosts.next();
    if (edge && env === 'prod')
      addInternalVip(ctx, project, region, subnet, 'api-ilb-ip', internalIp, 'api-ilb-fr');
    const internalRule = addCompute(b, project, {
      kind: 'ForwardingRule',
      collection: 'forwardingRules',
      scope: { region: region.name },
      name: 'api-ilb-fr',
      after: internalBackend.asset.createdAt,
      data: {
        IPAddress: internalIp,
        IPProtocol: 'TCP',
        ports: ['8443'],
        backendService: internalBackend.selfLink,
        network: host.selfLink,
        subnetwork: subnet.selfLink,
        loadBalancingScheme: 'INTERNAL',
        networkTier: 'PREMIUM',
        allowGlobalAccess: false,
        labelFingerprint: '42WmSpB8rSM=',
        fingerprint: 'c0x6IbYP7ho=',
      },
    });
    internal = { selfLink: internalRule.selfLink, ip: internalIp };
    apiGroup = apiMig.group.selfLink;
    // The first internal API publishes itself to the partner exchange through Private Service Connect.
    if (edge && env === 'prod' && ctx.once('psc-producer'))
      addPscProducer(ctx, project, region, host, internalRule);
    const record = `inventory-api.${team}.${host.privateZone}`;
    host.privateRecords.push(
      has(profile, 'fabric') && ctx.once(`wrr-record:${env}`)
        ? {
            name: record,
            type: 'A',
            rrdatas: [],
            // Weighted round robin over the health-checked internal load balancer (Cloud DNS routing policy).
            routingPolicy: {
              kind: 'dns#rRSetRoutingPolicy',
              wrr: {
                kind: 'dns#rRSetRoutingPolicyWrrPolicy',
                items: [
                  {
                    kind: 'dns#rRSetRoutingPolicyWrrPolicyWrrPolicyItem',
                    weight: 1,
                    healthCheckedTargets: {
                      internalLoadBalancers: [
                        {
                          kind: 'dns#rRSetRoutingPolicyLoadBalancerTarget',
                          loadBalancerType: 'regionalL4ilb',
                          ipAddress: internalIp,
                          port: '8443',
                          ipProtocol: 'tcp',
                          networkUrl: host.selfLink,
                          project: project.id,
                          region: region.name,
                        },
                      ],
                    },
                  },
                ],
              },
            },
          }
        : { name: record, type: 'A', rrdatas: [internalIp] },
    );
    if (ctx.once(`ilb-route:${env}`)) {
      // The host sends a partner extranet range through the internal load balancer (an inspection tier).
      addCompute(b, host.project, {
        kind: 'Route',
        collection: 'routes',
        scope: 'global',
        name: `extranet-via-ilb-${env}`,
        after: Math.max(host.createdAt, internalRule.asset.createdAt) + HOUR_MS,
        data: {
          description: 'Partner extranet through the inspection tier',
          network: host.selfLink,
          destRange: '172.24.0.0/16',
          priority: 900,
          nextHopIlb: internalRule.selfLink,
        },
      });
    }
  }
  // The first production storefront publishes its partner APIs through Apigee X.
  if (edge && env === 'prod' && ctx.once('apigee')) addApigee(ctx, project, region, host);
  if (has(profile, 'data')) {
    if (ctx.once(`redis:${env}`)) addRedis(ctx, project, region, host);
    const fabric = fabricFor(ctx, host);
    if (fabric !== undefined && ctx.once('valkey')) addValkey(ctx, project, region, fabric);
  }
  ctx.inventory.web.push({
    project,
    region,
    domain,
    serviceAccount: account.email,
    httpsRule,
    runService: fullName('run.googleapis.com', runPath),
    internalRule: internal,
    apiGroup,
  });
  return project;
}

function forwardingRule(
  ctx: OrgContext,
  project: ProjectCtx,
  name: string,
  ip: string,
  portRange: string,
  target: string,
  after: number,
): string {
  return addCompute(ctx.b, project, {
    kind: 'GlobalForwardingRule',
    collection: 'forwardingRules',
    scope: 'global',
    name,
    after,
    data: {
      IPAddress: ip,
      IPProtocol: 'TCP',
      portRange,
      target,
      loadBalancingScheme: 'EXTERNAL_MANAGED',
      networkTier: 'PREMIUM',
      labelFingerprint: '42WmSpB8rSM=',
      fingerprint: 'mB1u3BTkRmw=',
    },
  }).selfLink;
}

function setNumber(data: JsonObject, path: readonly string[], value: number): JsonObject {
  const [key, ...rest] = path;
  if (key === undefined) return data;
  if (rest.length === 0) return { ...data, [key]: value };
  const child = data[key];
  return {
    ...data,
    [key]: setNumber(
      typeof child === 'object' && child !== null && !Array.isArray(child) ? child : {},
      rest,
      value,
    ),
  };
}

export function title(word: string): string {
  return word
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export interface RunServiceOptions {
  readonly uid: string;
  readonly serviceAccount: string;
  readonly ingress: string;
  readonly image: string;
  readonly generation: number;
  readonly vpcAccess?: JsonObject;
  readonly env?: readonly JsonObject[];
  readonly volumes?: readonly JsonObject[];
  readonly volumeMounts?: readonly JsonObject[];
  readonly labels?: JsonObject;
  readonly encryptionKey?: string;
}

/** A Cloud Run (v2 API) service resource. */
export function runServiceData(
  project: ProjectCtx,
  region: Region,
  name: string,
  hash: string,
  options: RunServiceOptions,
): JsonObject {
  const location = `projects/${project.number}/locations/${region.name}`;
  const revision = `${location}/revisions/${name}-${String(options.generation).padStart(5, '0')}-${hash.slice(0, 3)}`;
  return {
    name: `${location}/services/${name}`,
    uid: options.uid,
    generation: String(options.generation),
    labels: options.labels ?? standardLabels(project),
    creator: 'deployer@example.com',
    lastModifier: 'deployer@example.com',
    ingress: options.ingress,
    launchStage: 'GA',
    template: {
      serviceAccount: options.serviceAccount,
      ...(options.vpcAccess === undefined ? {} : { vpcAccess: options.vpcAccess }),
      containers: [
        {
          image: options.image,
          ports: [{ name: 'http1', containerPort: 8080 }],
          resources: { limits: { cpu: '1', memory: '512Mi' }, cpuIdle: true, startupCpuBoost: true },
          env: [...(options.env ?? [])],
          volumeMounts: [...(options.volumeMounts ?? [])],
        },
      ],
      volumes: [...(options.volumes ?? [])],
      scaling: { maxInstanceCount: 20 },
      timeout: '300s',
      executionEnvironment: 'EXECUTION_ENVIRONMENT_GEN2',
      maxInstanceRequestConcurrency: 80,
      ...(options.encryptionKey === undefined ? {} : { encryptionKey: options.encryptionKey }),
    },
    traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }],
    observedGeneration: String(options.generation),
    terminalCondition: { type: 'Ready', state: 'CONDITION_SUCCEEDED' },
    latestReadyRevision: revision,
    latestCreatedRevision: revision,
    trafficStatuses: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }],
    uri: `https://${name}-${hash}-${region.runCode}.a.run.app`,
    urls: [
      `https://${name}-${project.number}.${region.name}.run.app`,
      `https://${name}-${hash}-${region.runCode}.a.run.app`,
    ],
    etag: `"${hash}"`,
  };
}
