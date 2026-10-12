// SPDX-License-Identifier: MIT
/** The generator's internal asset representation and the hooks templates register for the history. */
import type { JsonObject } from '../core/json.js';
import type { Rng } from '../core/rng.js';

/**
 * One generated asset. It carries the same fields as the normalised `Asset` of `@gcportrait/model` plus its
 * creation and update instants (milliseconds, UTC), from which the envelope `updateTime` and the timestamps
 * inside `data` are written. Generated assets are never mutated; changes produce new objects.
 */
export interface GenAsset {
  readonly name: string;
  readonly assetType: string;
  readonly parent: string | undefined;
  readonly ancestors: readonly string[];
  readonly location: string | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly data: JsonObject;
}

/** How the history may treat an asset of the current (final) organisation. */
export interface Traits {
  /**
   * Nothing references it, so it may have been created inside the 35-day window (a build, a table). A template
   * that names such an asset calls `OrgBuilder.referenced`, which clears the trait.
   */
  readonly addable?: boolean;
  /** Builds an earlier incarnation of the asset; the history uses it to restart pods. */
  readonly predecessor?: (createdAt: number, rng: Rng) => GenAsset;
  /** A special event owns the asset; daily changes leave it alone. */
  readonly pinned?: boolean;
}

/** A field change applied at a given instant: `forward` returns the new `data`. */
export interface ChangeSpec {
  readonly name: string;
  /** Dotted paths inside `data` that the change touches. */
  readonly fields: readonly string[];
  readonly forward: (data: JsonObject, at: number) => JsonObject;
}

export interface SpecialEventPlan {
  /** New assets, created at the event instant. */
  readonly adds: readonly GenAsset[];
  /** Names of assets of the template output that disappear at the event. */
  readonly removes: readonly string[];
  readonly changes: readonly ChangeSpec[];
}

export type SpecialEventId = 'key-rotation' | 'project-deletion' | 'mig-scale-out' | 'peering-added';

/** One of the scripted history events; its tick is fixed by the history planner. */
export interface SpecialEvent {
  readonly id: SpecialEventId;
  readonly plan: (at: number, rng: Rng) => SpecialEventPlan;
}

/**
 * Makes short-lived assets that exist only inside the window (a test VM created on Monday and deleted on
 * Thursday) or only at its start (an old bucket deleted during the window). `serial` keeps names unique.
 */
export interface EphemeralFactory {
  readonly kind: string;
  readonly weight: number;
  /** When the assets' container was created; nothing it makes is older. */
  readonly notBefore: number;
  readonly make: (createdAt: number, serial: number, rng: Rng) => readonly GenAsset[];
}
