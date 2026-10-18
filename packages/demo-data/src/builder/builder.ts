// SPDX-License-Identifier: Apache-2.0
/**
 * Collects the assets that the topology templates produce, assigns deterministic creation and update
 * instants, and keeps the side tables the history planner needs (traits, ephemeral factories, special
 * events). Templates call `add`; nothing else writes assets.
 */
import { hash32 } from '../core/hash.js';
import { CidrPool, HostPool } from '../core/ip.js';
import type { JsonObject } from '../core/json.js';
import { Rng } from '../core/rng.js';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../core/time.js';
import type { ProjectCtx } from '../topology/kit.js';
import { stampTimestamps } from './stamp.js';
import type { EphemeralFactory, GenAsset, SpecialEvent, Traits } from './types.js';

export interface AddInput {
  readonly assetType: string;
  readonly name: string;
  readonly parent?: string;
  readonly ancestors: readonly string[];
  readonly location?: string;
  readonly data: JsonObject;
  /** The asset was created after this instant (usually its parent's creation). */
  readonly after: number;
  /** An explicit creation instant (reserved earlier with `createdAt`). */
  readonly createdAt?: number;
  readonly traits?: Traits;
}

/**
 * The address plan. Every pool is a sub-range of 10.0.0.0/8, 172.16.0.0/12, 169.254.0.0/16 (BGP sessions,
 * which Cloud Router requires to be link-local) or 203.0.113.0/24 (every "public" address).
 */
export class AddressPlan {
  readonly subnets = new CidrPool('10.0.0.0/10', 'subnet');
  readonly pods = new CidrPool('10.128.0.0/10', 'GKE pod range');
  readonly services = new CidrPool('10.192.0.0/12', 'GKE service range');
  readonly privateServices = new CidrPool('10.240.0.0/13', 'private services access');
  readonly connectors = new CidrPool('10.248.0.0/16', 'serverless connector');
  readonly controlPlanes = new CidrPool('172.31.0.0/16', 'GKE control plane');
  readonly standalone = new CidrPool('172.20.0.0/14', 'standalone VPC');
  readonly bgp = new CidrPool('169.254.0.0/16', 'BGP link-local');
  readonly external = new HostPool('203.0.113.0/24', 10);
}

/** The on-premises side of the hybrid connectivity. */
export const ON_PREM_RANGE = '172.16.0.0/16';
export const ON_PREM_DNS = '172.16.0.53';

export interface BuildResult {
  readonly assets: readonly GenAsset[];
  readonly traits: ReadonlyMap<string, Traits>;
  readonly ephemerals: readonly EphemeralFactory[];
  readonly specials: readonly SpecialEvent[];
}

export class OrgBuilder {
  readonly seed: number;
  /** Midnight UTC of the first timeline tick; every template asset is older. */
  readonly windowStart: number;
  readonly rng: Rng;
  readonly addresses = new AddressPlan();
  readonly ephemerals: EphemeralFactory[] = [];
  readonly specials: SpecialEvent[] = [];
  /** Every project created so far, by project id (`addProject` registers them). */
  readonly projects = new Map<string, ProjectCtx>();

  readonly #assets: GenAsset[] = [];
  readonly #byName = new Map<string, GenAsset>();
  readonly #traits = new Map<string, Traits>();
  readonly #deferred: (() => void)[] = [];
  readonly #serials = new Map<string, number>();

  constructor(seed: number, windowStart: number) {
    this.seed = seed;
    this.windowStart = windowStart;
    this.rng = new Rng(seed);
  }

  /** 1, 2, 3, … per key: project ids (`demo-web-3`), folder and project numbers. */
  serial(key: string): number {
    const next = (this.#serials.get(key) ?? 0) + 1;
    this.#serials.set(key, next);
    return next;
  }

  /**
   * A deterministic creation instant after `after` and at least a day before the window. A child is created
   * within the first 70 % of the time left between its parent and the window, so long chains (organisation ›
   * folder › project › subnet › group › VM) never crowd into the last day.
   */
  createdAt(name: string, after: number): number {
    const lo = after + HOUR_MS;
    const hi = this.windowStart - DAY_MS;
    if (lo < hi)
      return lo + Math.floor((hash32(`created:${name}`, this.seed) / 4294967296) * 0.7 * (hi - lo));
    const fallback = after + MINUTE_MS;
    if (fallback >= this.windowStart - MINUTE_MS) {
      throw new RangeError(`${name} would be created inside the history window`);
    }
    return fallback;
  }

  /** A deterministic last-update instant between creation and the window, biased towards creation. */
  updatedAt(name: string, createdAt: number): number {
    const span = this.windowStart - HOUR_MS - createdAt;
    const u = hash32(`updated:${name}`, this.seed) / 4294967296;
    return createdAt + Math.floor(u * u * span);
  }

  add(input: AddInput): GenAsset {
    if (this.#byName.has(input.name)) throw new Error(`duplicate asset name ${input.name}`);
    const asset = this.make(input);
    this.#byName.set(input.name, asset);
    this.#assets.push(asset);
    if (input.traits !== undefined) this.#traits.set(input.name, input.traits);
    return asset;
  }

  /**
   * Builds an asset without adding it to the organisation: for ephemeral and special-event assets, which the
   * history adds itself.
   */
  make(input: AddInput, at?: number): GenAsset {
    const createdAt = at ?? input.createdAt ?? this.createdAt(input.name, input.after);
    const updatedAt = at ?? this.updatedAt(input.name, createdAt);
    return {
      name: input.name,
      assetType: input.assetType,
      parent: input.parent,
      ancestors: input.ancestors,
      location: input.location,
      createdAt,
      updatedAt,
      data: stampTimestamps(input.assetType, input.name, input.data, createdAt, updatedAt),
    };
  }

  /** The assets added so far, in the order they were added. */
  added(): readonly GenAsset[] {
    return this.#assets;
  }

  /** True when an asset of that name has been added. */
  hasAsset(name: string): boolean {
    return this.#byName.has(name);
  }

  /**
   * Records that another asset names `name` (a table that a subscription writes to, say). Whatever is named
   * elsewhere must exist at the first tick, or that reference would dangle until the history created it, so
   * this clears the asset's `addable` trait. Returns the asset's creation instant: what names it is created
   * later (pass it as `after`).
   */
  referenced(name: string): number {
    const asset = this.#byName.get(name);
    if (asset === undefined) throw new Error(`${name} is referenced before it is added`);
    const traits = this.#traits.get(name);
    if (traits?.addable === true) this.#traits.set(name, { ...traits, addable: false });
    return asset.createdAt;
  }

  /** Runs `emit` after every template has run (for assets that list what was created later). */
  defer(emit: () => void): void {
    this.#deferred.push(emit);
  }

  finish(): BuildResult {
    for (let i = 0; i < this.#deferred.length; i++) this.#deferred[i]?.();
    return {
      assets: this.#assets,
      traits: this.#traits,
      ephemerals: this.ephemerals,
      specials: this.specials,
    };
  }
}
