// SPDX-License-Identifier: MIT
/**
 * The optional generator cases of the catalog groups, switched on per size in `profiles.ts`. S stays the small,
 * focused organisation and turns none of them on; M and L turn on everything a reader expects in a
 * real landing zone (every Tier-0 container type and the prominent Tier-1 types of each catalog group); the
 * `large` cases only make sense with three environments and many business units.
 */
import type { SizeProfile } from './profiles.js';

export type Feature =
  /** Artifact Registry repositories behind every image path the workloads name. */
  | 'registries'
  /**
   * The platform management project `demo-mgmt-1`: CI/CD (Cloud Build, Cloud Deploy, Infra Manager), central
   * logging and monitoring, Backup and DR, App Hub, the asset feed, Service Directory and billing.
   */
  | 'management'
  /**
   * Per Shared VPC host: subnet routes, network firewall policies, Cloud DNS server and response policies,
   * Private Service Connect for Google APIs, an internal range; in production also a hierarchical firewall
   * policy, Cloud NGFW Enterprise, Cloud IDS, a network appliance with static routes, a policy-based route,
   * a network attachment, a peering zone, Service Directory and the Cloud Domains registration.
   */
  | 'fabric'
  /** A Network Connectivity Center hub with VPC, HA VPN and Interconnect spokes. */
  | 'ncc'
  /**
   * Certificate Manager, Cloud Armor edge and hierarchical policies, IAP and Cloud CDN, load-balancer VIP
   * addresses, a Private Service Connect producer with a consumer endpoint, Apigee X and API Gateway.
   */
  | 'edge'
  /**
   * Custom images, snapshot schedules and snapshots, reservations and commitments, a canary instance
   * template, stopped VMs, VMware Engine.
   */
  | 'compute'
  /**
   * Kubernetes service accounts with Workload Identity, a stateful storage chain, CronJobs, an HPA, Backup for
   * GKE, Binary Authorization, Filestore, cluster-scope DNS zones and CMEK node boot disks.
   */
  | 'kubernetes'
  /**
   * Cloud Run jobs, executions and revisions, Workflows with Eventarc, a storage-event function, Cloud Tasks,
   * Firestore, Cloud Run CMEK and volumes, the functions' source buckets.
   */
  | 'serverless'
  /**
   * AlloyDB, Spanner, Bigtable, Memorystore, Cloud SQL replicas and backups, BigQuery routines, models,
   * snapshots, linked datasets and reservations, Dataproc with Metastore, Composer, Dataflow, Dataplex,
   * Dataform, Managed Kafka, Pub/Sub BigQuery and Cloud Storage subscriptions and Batch.
   */
  | 'data'
  /**
   * CA Service, Binary Authorization attestors, Security Command Center exports, workload identity
   * federation, Sensitive Data Protection, CMEK and notifications on secrets.
   */
  | 'security'
  /**
   * Only with three environments: Classic VPN, Partner Interconnect, HA VPN between two host networks, Secure
   * Web Proxy in every host, Datastream, Analytics Hub, BigQuery Data Transfer, an AlloyDB secondary cluster,
   * the production network inside the perimeter and a perimeter bridge.
   */
  | 'large';

export function has(profile: SizeProfile, feature: Feature): boolean {
  return profile.features.includes(feature);
}
