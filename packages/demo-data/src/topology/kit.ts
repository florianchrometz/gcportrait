// SPDX-License-Identifier: Apache-2.0
/**
 * Shared building blocks for the topology templates: the resource hierarchy contexts, and helpers that turn a
 * resource description into an asset with the naming conventions of its API (full resource names, Compute
 * self-links, service-account emails).
 */
import type { AddInput, OrgBuilder } from '../builder/builder.js';
import type { GenAsset, Traits } from '../builder/types.js';
import { computeId } from '../core/ids.js';
import type { JsonObject } from '../core/json.js';
import { discoveryFor } from '../data/discovery.js';
import type { Env, Region } from './vocabulary.js';

export const ORGANIZATION_DOMAIN = 'example.com';
export const RM = 'cloudresourcemanager.googleapis.com';
export const COMPUTE_API = 'https://www.googleapis.com/compute/v1';

/** An organisation or folder that projects and folders can live in. */
export interface ContainerCtx {
  /** `organizations/N` or `folders/N`. */
  readonly ref: string;
  /** The full resource name. */
  readonly full: string;
  /** The `ancestors` list of the container itself (its own entry first). */
  readonly ancestors: readonly string[];
  readonly createdAt: number;
}

export interface ProjectCtx {
  readonly id: string;
  readonly number: string;
  /** `projects/<number>`. */
  readonly ref: string;
  readonly full: string;
  /** The `ancestors` list of every asset in the project. */
  readonly ancestors: readonly string[];
  readonly createdAt: number;
  readonly env: Env;
  readonly region: Region;
  /** The business unit, or the platform function (`network`, `security`, …). */
  readonly team: string;
  readonly asset: GenAsset;
}

export function fullName(service: string, path: string): string {
  return `//${service}/${path}`;
}

/** The number of the organisation `org` is (`organizations/<number>`): one per demo size. */
export function organizationNumber(org: ContainerCtx): string {
  return org.ref.slice('organizations/'.length);
}

/** The organisation numbered `number` (`DEMO_ORGANIZATION_IDS` of its size). */
export function addOrganization(b: OrgBuilder, number: string, createdAt: number): ContainerCtx {
  const ref = `organizations/${number}`;
  const full = fullName(RM, ref);
  b.add({
    assetType: `${RM}/Organization`,
    name: full,
    ancestors: [ref],
    location: 'global',
    // Resource Manager v1 shape, as Cloud Asset Inventory serves organisations.
    data: {
      name: ref,
      displayName: ORGANIZATION_DOMAIN,
      owner: { directoryCustomerId: 'C00example' },
      lifecycleState: 'ACTIVE',
    },
    after: 0,
    createdAt,
    traits: { pinned: true },
  });
  return { ref, full, ancestors: [ref], createdAt };
}

export function addFolder(b: OrgBuilder, parent: ContainerCtx, displayName: string): ContainerCtx {
  const number = String(20_000_000_000 + b.serial('folder'));
  const ref = `folders/${number}`;
  const full = fullName(RM, ref);
  const asset = b.add({
    assetType: `${RM}/Folder`,
    name: full,
    parent: parent.full,
    ancestors: [ref, ...parent.ancestors],
    location: 'global',
    // Resource Manager v2 shape, as Cloud Asset Inventory serves folders.
    data: { name: ref, parent: parent.ref, displayName, lifecycleState: 'ACTIVE' },
    after: parent.createdAt,
  });
  return { ref, full, ancestors: [ref, ...parent.ancestors], createdAt: asset.createdAt };
}

export interface ProjectSpec {
  /** The role word in the project id: `demo-<role>-<n>`. */
  readonly role: string;
  readonly displayName: string;
  readonly env: Env;
  readonly region: Region;
  readonly team: string;
  readonly traits?: Traits;
}

export function addProject(b: OrgBuilder, parent: ContainerCtx, spec: ProjectSpec): ProjectCtx {
  const number = String(10_000_000_000 + b.serial('project'));
  const id = `demo-${spec.role}-${String(b.serial(`role:${spec.role}`))}`;
  const ref = `projects/${number}`;
  const full = fullName(RM, ref);
  const ancestors = [ref, ...parent.ancestors];
  const asset = b.add({
    assetType: `${RM}/Project`,
    name: full,
    parent: parent.full,
    ancestors,
    location: 'global',
    // Resource Manager v1 shape, as Cloud Asset Inventory serves projects: `name` is the display name.
    data: {
      projectNumber: number,
      projectId: id,
      lifecycleState: 'ACTIVE',
      name: spec.displayName,
      parent: {
        type: parent.ref.startsWith('folders/') ? 'folder' : 'organization',
        id: parent.ref.split('/')[1] ?? '',
      },
      labels: {
        env: spec.env,
        team: spec.team,
        'cost-center': `cc-${String(1000 + (Number(number) % 977))}`,
      },
    },
    after: parent.createdAt,
    ...(spec.traits === undefined ? {} : { traits: spec.traits }),
  });
  const project: ProjectCtx = {
    id,
    number,
    ref,
    full,
    ancestors,
    createdAt: asset.createdAt,
    env: spec.env,
    region: spec.region,
    team: spec.team,
    asset,
  };
  b.projects.set(id, project);
  return project;
}

/** Where a Compute Engine resource lives. */
export type ComputeScope = { readonly zone: string } | { readonly region: string } | 'global';

export interface ComputeSpec {
  /** The asset kind: `Instance`, `GlobalAddress`, `RegionBackendService`, … */
  readonly kind: string;
  /** The URL collection: `instances`, `addresses`, `backendServices`, … */
  readonly collection: string;
  readonly scope: ComputeScope;
  readonly name: string;
  readonly data: JsonObject;
  readonly after?: number;
  readonly createdAt?: number;
  readonly traits?: Traits;
}

export interface ComputeRef {
  readonly name: string;
  /** `projects/<id>/zones/<zone>/instances/<name>`. */
  readonly path: string;
  readonly selfLink: string;
  readonly asset: GenAsset;
}

export function scopePath(scope: ComputeScope): string {
  if (scope === 'global') return 'global';
  return 'zone' in scope ? `zones/${scope.zone}` : `regions/${scope.region}`;
}

export function computeSelfLink(projectId: string, path: string): string {
  return `${COMPUTE_API}/projects/${projectId}/${path}`;
}

/** The input for a Compute Engine asset, with `kind`, `id`, `name`, `selfLink` and the zone or region URL. */
export function computeInput(
  b: OrgBuilder,
  project: ProjectCtx,
  spec: ComputeSpec,
): { input: AddInput; ref: Omit<ComputeRef, 'asset'> } {
  const path = `projects/${project.id}/${scopePath(spec.scope)}/${spec.collection}/${spec.name}`;
  const selfLink = `${COMPUTE_API}/${path}`;
  const full = fullName('compute.googleapis.com', path);
  const discoveryName = discoveryFor(`compute.googleapis.com/${spec.kind}`).discoveryName;
  const scope = spec.scope;
  const location = scope === 'global' ? 'global' : 'zone' in scope ? scope.zone : scope.region;
  const scopeField: JsonObject =
    scope === 'global'
      ? {}
      : 'zone' in scope
        ? { zone: computeSelfLink(project.id, `zones/${scope.zone}`) }
        : { region: computeSelfLink(project.id, `regions/${scope.region}`) };
  const input: AddInput = {
    assetType: `compute.googleapis.com/${spec.kind}`,
    name: full,
    parent: project.full,
    ancestors: project.ancestors,
    location,
    data: {
      kind: `compute#${discoveryName.charAt(0).toLowerCase()}${discoveryName.slice(1)}`,
      id: computeId(b.rng.fork(`id:${full}`)),
      name: spec.name,
      selfLink,
      ...scopeField,
      ...spec.data,
    },
    after: spec.after ?? project.createdAt,
    ...(spec.createdAt === undefined ? {} : { createdAt: spec.createdAt }),
    ...(spec.traits === undefined ? {} : { traits: spec.traits }),
  };
  return { input, ref: { name: spec.name, path, selfLink } };
}

export function addCompute(b: OrgBuilder, project: ProjectCtx, spec: ComputeSpec): ComputeRef {
  const { input, ref } = computeInput(b, project, spec);
  return { ...ref, asset: b.add(input) };
}

/** Builds a Compute asset created at `at` without adding it (ephemeral and special-event assets). */
export function makeCompute(b: OrgBuilder, project: ProjectCtx, spec: ComputeSpec, at: number): ComputeRef {
  const { input, ref } = computeInput(b, project, spec);
  return { ...ref, asset: b.make(input, at) };
}

/** A non-Compute asset that belongs to a project. */
export interface ProjectAssetSpec {
  readonly assetType: string;
  readonly name: string;
  readonly data: JsonObject;
  readonly location?: string;
  /** Defaults to the project. */
  readonly parent?: string;
  readonly after?: number;
  readonly traits?: Traits;
}

export function projectInput(project: ProjectCtx, spec: ProjectAssetSpec): AddInput {
  return {
    assetType: spec.assetType,
    name: spec.name,
    parent: spec.parent ?? project.full,
    ancestors: project.ancestors,
    data: spec.data,
    after: spec.after ?? project.createdAt,
    ...(spec.location === undefined ? {} : { location: spec.location }),
    ...(spec.traits === undefined ? {} : { traits: spec.traits }),
  };
}

export function addProjectAsset(b: OrgBuilder, project: ProjectCtx, spec: ProjectAssetSpec): GenAsset {
  return b.add(projectInput(project, spec));
}

export interface ServiceAccountRef {
  readonly email: string;
  readonly asset: GenAsset;
}

export function addServiceAccount(
  b: OrgBuilder,
  project: ProjectCtx,
  accountId: string,
  displayName: string,
): ServiceAccountRef {
  const email = `${accountId}@${project.id}.iam.gserviceaccount.com`;
  const uniqueId = `1${b.rng.fork(`sa:${email}`).chars('0123456789', 20)}`;
  const asset = addProjectAsset(b, project, {
    assetType: 'iam.googleapis.com/ServiceAccount',
    name: fullName('iam.googleapis.com', `projects/${project.id}/serviceAccounts/${uniqueId}`),
    location: 'global',
    data: {
      name: `projects/${project.id}/serviceAccounts/${email}`,
      projectId: project.id,
      uniqueId,
      email,
      displayName,
      oauth2ClientId: uniqueId,
      etag: 'MDEwMjE5MjA=',
    },
  });
  return { email, asset };
}

/** The Compute Engine default service account of a project. */
export function defaultComputeServiceAccount(project: ProjectCtx): string {
  return `${project.number}-compute@developer.gserviceaccount.com`;
}

/** Resource labels most templates put on what they create. */
export function standardLabels(project: ProjectCtx, extra: JsonObject = {}): JsonObject {
  return { env: project.env, team: project.team, 'managed-by': 'terraform', ...extra };
}
