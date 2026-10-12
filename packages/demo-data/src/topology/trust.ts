// SPDX-License-Identifier: MIT
/**
 * Security and identity beyond keys and the perimeter (feature `security`), in the security project and at
 * the organisation: two asymmetric signing keys (for the root CA and the build attestor), Certificate
 * Authority Service (a root pool with a self-signed CA on the HSM key and an internal pool with a subordinate
 * CA), the Binary Authorization attestor the GKE projects' policies require, Security Command Center
 * notifications and a BigQuery export (with their topic and dataset), the topic secrets publish their events
 * to, and workload identity federation for GitHub Actions.
 */
import type { JsonObject } from '../core/json.js';
import type { OrgContext } from './context.js';
import { addProjectAsset, fullName, organizationNumber, standardLabels } from './kit.js';

export function addSecurityExtras(ctx: OrgContext): void {
  const { b } = ctx;
  const project = ctx.keys.project;
  if (project === undefined) return;
  const region = project.region;
  const labels = standardLabels(project);
  const ring = `projects/${project.id}/locations/${region.name}/keyRings/kr-${region.name}`;
  const asset = (
    assetType: string,
    name: string,
    location: string,
    data: JsonObject,
    parent?: string,
  ): number =>
    addProjectAsset(b, project, {
      assetType,
      name,
      location,
      data,
      ...(parent === undefined ? {} : { parent }),
    }).createdAt;

  // Asymmetric signing keys in the region's key ring (HSM for the CA).
  const signingKey = (name: string, algorithm: string, protectionLevel: string): string => {
    const key = `${ring}/cryptoKeys/${name}`;
    const version = `${key}/cryptoKeyVersions/1`;
    const versionData = { name: version, state: 'ENABLED', protectionLevel, algorithm };
    asset(
      'cloudkms.googleapis.com/CryptoKey',
      fullName('cloudkms.googleapis.com', key),
      region.name,
      {
        name: key,
        primary: versionData,
        purpose: 'ASYMMETRIC_SIGN',
        versionTemplate: { protectionLevel, algorithm },
        destroyScheduledDuration: '2592000s',
        labels: { 'managed-by': 'terraform' },
      },
      fullName('cloudkms.googleapis.com', ring),
    );
    asset(
      'cloudkms.googleapis.com/CryptoKeyVersion',
      fullName('cloudkms.googleapis.com', version),
      region.name,
      versionData,
      fullName('cloudkms.googleapis.com', key),
    );
    return version;
  };
  const caKey = signingKey('ca-root', 'EC_SIGN_P384_SHA384', 'HSM');
  const attestorKey = signingKey('attestor', 'EC_SIGN_P256_SHA256', 'SOFTWARE');

  // Certificate Authority Service: a root pool with the self-signed root, an internal pool with a subordinate.
  const pools = `projects/${project.id}/locations/${region.name}/caPools`;
  const storageKey = ctx.keys.key(region.name, 'storage');
  const pool = (name: string, data: JsonObject): string => {
    const path = `${pools}/${name}`;
    asset('privateca.googleapis.com/CaPool', fullName('privateca.googleapis.com', path), region.name, {
      name: path,
      tier: 'ENTERPRISE',
      labels,
      ...data,
    });
    return path;
  };
  const rootPool = pool('root-pool', {});
  const internalPool = pool('internal-pool', {
    issuancePolicy: { maximumLifetime: '7776000s', allowedIssuanceModes: { allowCsrBasedIssuance: true } },
    ...(storageKey === undefined ? {} : { encryptionSpec: { cloudKmsKey: storageKey } }),
  });
  const rootCa = `${rootPool}/certificateAuthorities/example-root-ca`;
  asset(
    'privateca.googleapis.com/CertificateAuthority',
    fullName('privateca.googleapis.com', rootCa),
    region.name,
    {
      name: rootCa,
      type: 'SELF_SIGNED',
      tier: 'ENTERPRISE',
      state: 'ENABLED',
      lifetime: '315360000s',
      keySpec: { cloudKmsKeyVersion: caKey },
      config: {
        subjectConfig: { subject: { organization: 'Example Org', commonName: 'Example Org Root CA' } },
        x509Config: { caOptions: { isCa: true } },
      },
    },
  );
  const issuingCa = `${internalPool}/certificateAuthorities/example-issuing-ca`;
  asset(
    'privateca.googleapis.com/CertificateAuthority',
    fullName('privateca.googleapis.com', issuingCa),
    region.name,
    {
      name: issuingCa,
      type: 'SUBORDINATE',
      tier: 'ENTERPRISE',
      state: 'ENABLED',
      lifetime: '94608000s',
      keySpec: { algorithm: 'EC_P256_SHA256' },
      subordinateConfig: { certificateAuthority: rootCa },
      config: {
        subjectConfig: { subject: { organization: 'Example Org', commonName: 'Example Org Issuing CA' } },
        x509Config: { caOptions: { isCa: true, maxIssuerPathLength: 0 } },
      },
    },
  );

  // The Binary Authorization attestor (CAI names Binary Authorization assets with the project number).
  asset(
    'binaryauthorization.googleapis.com/Attestor',
    fullName('binaryauthorization.googleapis.com', `projects/${project.number}/attestors/build-verified`),
    'global',
    {
      name: `projects/${project.number}/attestors/build-verified`,
      description: 'Images built by the delivery pipeline from a protected branch',
      userOwnedGrafeasNote: {
        noteReference: `projects/${project.id}/notes/build-verified`,
        publicKeys: [
          {
            id: `//cloudkms.googleapis.com/v1/${attestorKey}`,
            pkixPublicKey: {
              publicKeyPem:
                '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEexampleonlyexampleonly==\n-----END PUBLIC KEY-----\n',
              signatureAlgorithm: 'ECDSA_P256_SHA256',
            },
          },
        ],
        delegationServiceAccountEmail: `service-${project.number}@gcp-sa-binaryauthorization.iam.gserviceaccount.com`,
      },
    },
  );

  // Security Command Center: high-severity findings to a topic, every finding to a dataset.
  const findingsTopic = `projects/${project.id}/topics/scc-findings`;
  for (const topic of [findingsTopic, `projects/${project.id}/topics/secret-events`]) {
    asset('pubsub.googleapis.com/Topic', fullName('pubsub.googleapis.com', topic), 'global', {
      name: topic,
      labels,
    });
  }
  const findingsDataset = `projects/${project.id}/datasets/scc_findings`;
  asset(
    'bigquery.googleapis.com/Dataset',
    fullName('bigquery.googleapis.com', findingsDataset),
    region.name,
    {
      kind: 'bigquery#dataset',
      id: `${project.id}:scc_findings`,
      datasetReference: { projectId: project.id, datasetId: 'scc_findings' },
      location: region.name,
      type: 'DEFAULT',
      labels,
    },
  );
  const orgAsset = (assetType: string, path: string, data: JsonObject): void => {
    b.add({
      assetType,
      name: fullName('securitycenter.googleapis.com', path),
      parent: ctx.org.full,
      ancestors: ctx.org.ancestors,
      location: 'global',
      data: { name: path, ...data },
      after: project.createdAt,
    });
  };
  const sccAgent = `service-org-${organizationNumber(ctx.org)}@gcp-sa-scc-notification.iam.gserviceaccount.com`;
  orgAsset(
    'securitycenter.googleapis.com/NotificationConfig',
    `${ctx.org.ref}/locations/global/notificationConfigs/high-severity`,
    {
      description: 'High and critical findings to the incident pipeline',
      pubsubTopic: findingsTopic,
      serviceAccount: sccAgent,
      streamingConfig: { filter: 'state = "ACTIVE" AND (severity = "HIGH" OR severity = "CRITICAL")' },
    },
  );
  orgAsset(
    'securitycenter.googleapis.com/BigQueryExport',
    `${ctx.org.ref}/locations/global/bigQueryExports/all-findings`,
    {
      description: 'Every active finding, for reporting',
      filter: 'state = "ACTIVE"',
      dataset: findingsDataset,
      principal: sccAgent,
      mostRecentEditor: 'secops@example.com',
    },
  );

  // Workload identity federation for the GitHub Actions of the organisation's repositories.
  const poolPath = `projects/${project.number}/locations/global/workloadIdentityPools/github`;
  asset('iam.googleapis.com/WorkloadIdentityPool', fullName('iam.googleapis.com', poolPath), 'global', {
    name: poolPath,
    displayName: 'GitHub Actions',
    description: 'Deployments from the organisation repositories',
    state: 'ACTIVE',
    disabled: false,
  });
  asset(
    'iam.googleapis.com/WorkloadIdentityPoolProvider',
    fullName('iam.googleapis.com', `${poolPath}/providers/github-oidc`),
    'global',
    {
      name: `${poolPath}/providers/github-oidc`,
      displayName: 'GitHub OIDC',
      state: 'ACTIVE',
      disabled: false,
      attributeMapping: {
        'google.subject': 'assertion.sub',
        'attribute.repository': 'assertion.repository',
        'attribute.repository_owner': 'assertion.repository_owner',
      },
      attributeCondition: "assertion.repository_owner == 'example-org'",
      oidc: { issuerUri: 'https://token.actions.githubusercontent.com' },
    },
  );
}
