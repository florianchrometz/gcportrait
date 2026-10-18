// SPDX-License-Identifier: Apache-2.0
/** What every topology template receives: the builder, the size profile and the organisation-wide state. */
import type { OrgBuilder } from '../builder/builder.js';
import type { JsonObject } from '../core/json.js';
import type { HostPool } from '../core/ip.js';
import type { HostFabric } from './fabric.js';
import type { ContainerCtx, ProjectCtx } from './kit.js';
import type { Management } from './management.js';
import type { HostNetwork } from './network.js';
import type { SizeProfile } from './profiles.js';
import type { KeyCatalog } from './security.js';
import type { Env, Region } from './vocabulary.js';

/** A DNS record that a workload asks for; the zone owner emits it at the end. */
export interface RecordSpec {
  /** Fully qualified, with the trailing dot. */
  readonly name: string;
  readonly type: 'A' | 'CNAME';
  readonly rrdatas: readonly string[];
  /** A Cloud DNS routing policy (weighted round robin over health-checked load balancers, …). */
  readonly routingPolicy?: JsonObject;
}

/** The standalone partner VPC: where Private Service Connect consumer endpoints of partners live. */
export interface PartnerNetwork {
  readonly project: ProjectCtx;
  readonly region: Region;
  readonly networkSelfLink: string;
  readonly subnetSelfLink: string;
  readonly hosts: HostPool;
  readonly createdAt: number;
}

/** What the workload templates created, for the platform templates that point at it afterwards. */
export interface Inventory {
  readonly web: {
    readonly project: ProjectCtx;
    readonly region: Region;
    readonly domain: string;
    /** The web tier's service account e-mail. */
    readonly serviceAccount: string;
    /** Self-link of the global HTTPS forwarding rule. */
    readonly httpsRule: string;
    /** Full name of the Cloud Run API behind the serverless NEG. */
    readonly runService: string;
    /** Self-link of the internal load balancer's forwarding rule, with its address. */
    readonly internalRule: { readonly selfLink: string; readonly ip: string } | undefined;
    /** Self-link of the instance group behind the internal load balancer. */
    readonly apiGroup: string | undefined;
  }[];
  readonly clusters: {
    readonly project: ProjectCtx;
    readonly region: Region;
    /** `projects/<id>/locations/<region>/clusters/<name>`. */
    readonly path: string;
    readonly name: string;
  }[];
  readonly serverless: {
    readonly project: ProjectCtx;
    readonly region: Region;
    /** Cloud SQL connection names (`project:region:instance`). */
    readonly sql: readonly string[];
    /** Full names of the Cloud Run services. */
    readonly services: readonly string[];
    /** `projects/<id>/topics/<t>`. */
    readonly topics: readonly string[];
  }[];
  readonly data: {
    readonly project: ProjectCtx;
    readonly region: Region;
    readonly lake: string;
    /** The first dataset and its first table (the warehouse table). */
    readonly dataset: string;
    readonly table: string;
    /** The warehouse table's full name: whatever reads it calls `b.referenced` with it. */
    readonly tableName: string;
  }[];
  readonly vms: {
    readonly project: ProjectCtx;
    /** `projects/<id>/zones/<zone>/instances/<name>` of the standalone VMs. */
    readonly instances: readonly string[];
  }[];
}

export interface OrgContext {
  readonly b: OrgBuilder;
  readonly profile: SizeProfile;
  readonly org: ContainerCtx;
  readonly hosts: ReadonlyMap<Env, HostNetwork>;
  readonly keys: KeyCatalog;
  readonly partner: PartnerNetwork;
  /** Records of the public `example.org.` zone. */
  readonly publicRecords: RecordSpec[];
  /** Projects that the VPC Service Controls perimeter may protect, in creation order. */
  readonly perimeterCandidates: { readonly serverless: ProjectCtx[]; readonly data: ProjectCtx[] };
  readonly inventory: Inventory;
  /** The fabric of each host (feature `fabric`), filled in before the workload projects are built. */
  readonly fabric: Map<Env, HostFabric>;
  /** The platform management project (feature `management`). */
  readonly management: Management | undefined;
  /** The folders the organisation's policies attach to. */
  readonly folders: { readonly workloads: ContainerCtx };
  /** True the first time it is called with `key`: one-off features (the MIG that scales out, …). */
  readonly once: (key: string) => boolean;
}

export function hostFor(ctx: OrgContext, env: Env): HostNetwork {
  const host = ctx.hosts.get(env);
  if (host === undefined) throw new Error(`no Shared VPC host for environment ${env}`);
  return host;
}

/** The production host (the first environment's). */
export function prodHost(ctx: OrgContext): HostNetwork {
  const host = ctx.hosts.values().next().value;
  if (host === undefined) throw new Error('the organisation has no Shared VPC host');
  return host;
}
