// SPDX-License-Identifier: Apache-2.0
/**
 * Plans the 35-day history of a generated organisation and replays it into per-tick mutation lists.
 *
 * The template output is the organisation as it is today, except for what the four scripted events change.
 * The planner works out the state at the first tick by taking back what happened in the window:
 *   - scripted events at fixed ticks: a key rotation, a project deletion, a MIG scale-out, a new VPC peering;
 *   - pod restarts: a pod of today replaced earlier incarnations (each restart removes one, adds the next);
 *   - growth: assets of today that were created inside the window (builds, tables, export buckets, records);
 *   - transients: short-lived assets created and deleted inside the window (test VMs, scratch tables);
 *   - retirements: assets that existed at the first tick and were deleted during the window;
 *   - changes: one field change on an asset that otherwise stays (see mutators.ts).
 * The replay then applies the planned operations from the first tick forward, checking that no add
 * duplicates an asset and no remove or change misses one, and records each mutation as it happened.
 */
import type { Asset } from '@gcportrait/model';
import type { BuildResult } from '../builder/builder.js';
import { retime, touch } from '../builder/stamp.js';
import type { GenAsset, SpecialEventId } from '../builder/types.js';
import type { JsonObject } from '../core/json.js';
import { Rng } from '../core/rng.js';
import { DAY_MS, HOUR_MS, MINUTE_MS, rfc3339Micros, weekday } from '../core/time.js';
import type { HistoryProfile } from '../topology/profiles.js';
import { mutatorFor } from './mutators.js';
import { sortByName } from './replay.js';
import type { Mutation } from './types.js';

/** Ticks are 0 (today minus 34 days) to 34 (today). */
export const LAST_TICK = 34;

/** When the scripted events happen. */
export const SPECIAL_EVENT_TICKS: Readonly<Record<SpecialEventId, number>> = {
  'key-rotation': 6,
  'project-deletion': 13,
  'mig-scale-out': 20,
  'peering-added': 27,
};

type PlannedOp =
  | { readonly op: 'add'; readonly asset: GenAsset }
  | { readonly op: 'remove'; readonly name: string }
  | {
      readonly op: 'change';
      readonly name: string;
      readonly at: number;
      readonly fields: readonly string[];
      readonly forward: (data: JsonObject, at: number) => JsonObject;
    };

export interface ReplayedHistory {
  readonly base: readonly Asset[];
  /** Index 0 is the first tick (no mutations). */
  readonly mutations: readonly (readonly Mutation[])[];
}

export function toAsset(asset: GenAsset): Asset {
  return {
    name: asset.name,
    assetType: asset.assetType,
    ...(asset.parent === undefined ? {} : { parent: asset.parent }),
    ancestors: [...asset.ancestors],
    ...(asset.location === undefined ? {} : { location: asset.location }),
    updateTime: rfc3339Micros(asset.updatedAt, asset.name),
    data: asset.data,
  };
}

/** How many events of one kind happen on a day: the rate, damped at weekends, with the fraction drawn. */
function countFor(rate: number, day: number, rng: Rng, weekendFactor: number): number {
  const day0 = weekday(day);
  const scaled = rate * (day0 === 0 || day0 === 6 ? weekendFactor : 1);
  const whole = Math.floor(scaled);
  return whole + (rng.chance(scaled - whole) ? 1 : 0);
}

export function planHistory(
  build: BuildResult,
  profile: HistoryProfile,
  windowStart: number,
  seed: number,
): ReplayedHistory {
  const rng = new Rng(seed).fork('history');
  const tickStart = (tick: number): number => windowStart + tick * DAY_MS;
  /** An instant during the day before `tick`, in (UTC) working hours. */
  const moment = (tick: number, r: Rng): number =>
    tickStart(tick - 1) + 6 * HOUR_MS + r.int(0, 15 * 60) * MINUTE_MS + r.int(0, 59_999);

  const base = new Map<string, GenAsset>();
  for (const asset of build.assets) base.set(asset.name, asset);
  const usedNames = new Set(base.keys());
  const ops: PlannedOp[][] = Array.from({ length: LAST_TICK + 1 }, () => []);
  const touched = new Set<string>();

  const at = (tick: number): PlannedOp[] => {
    const list = ops[tick];
    if (list === undefined) throw new RangeError(`tick ${String(tick)} is outside the window`);
    return list;
  };

  // Scripted events.
  for (const special of build.specials) {
    const tick = SPECIAL_EVENT_TICKS[special.id];
    const when = moment(tick, rng.fork(special.id));
    const plan = special.plan(when, rng.fork(`${special.id}/plan`));
    for (const name of plan.removes) {
      at(tick).push({ op: 'remove', name });
      touched.add(name);
    }
    for (const change of plan.changes) {
      at(tick).push({
        op: 'change',
        name: change.name,
        at: when,
        fields: change.fields,
        forward: change.forward,
      });
      touched.add(change.name);
    }
    for (const asset of plan.adds) {
      at(tick).push({ op: 'add', asset });
      usedNames.add(asset.name);
    }
  }

  const eligible = (asset: GenAsset): boolean =>
    !touched.has(asset.name) && build.traits.get(asset.name)?.pinned !== true;
  const restartable = build.assets.filter(
    (a) => eligible(a) && build.traits.get(a.name)?.predecessor !== undefined,
  );
  const growable = rng
    .fork('growth')
    .shuffle(build.assets.filter((a) => eligible(a) && build.traits.get(a.name)?.addable === true));
  const changeable = rng
    .fork('changes')
    .shuffle(
      build.assets.filter(
        (a) =>
          eligible(a) &&
          build.traits.get(a.name)?.addable !== true &&
          build.traits.get(a.name)?.predecessor === undefined &&
          mutatorFor(a) !== undefined,
      ),
    );
  const factories = build.ephemerals;
  const totalWeight = factories.reduce((sum, f) => sum + f.weight, 0);
  const pickFactory = (r: Rng): (typeof factories)[number] | undefined => {
    let x = r.next() * totalWeight;
    for (const factory of factories) {
      x -= factory.weight;
      if (x < 0) return factory;
    }
    return factories[factories.length - 1];
  };
  let serial = 0;
  /** Assets of a randomly chosen factory, created at `createdAt` (or, when `createdAt` is a function, at the
   * instant it picks given the factory's earliest possible creation). */
  const makeEphemeral = (
    createdAt: number | ((notBefore: number) => number),
    r: Rng,
  ): readonly GenAsset[] => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const factory = pickFactory(r);
      if (factory === undefined) return [];
      serial += 1;
      const when = typeof createdAt === 'number' ? createdAt : createdAt(factory.notBefore);
      const assets = factory.make(when, serial, r);
      if (assets.every((a) => !usedNames.has(a.name))) {
        for (const a of assets) usedNames.add(a.name);
        return assets;
      }
    }
    return [];
  };

  const restarts = new Map<string, number[]>();
  for (let tick = 1; tick <= LAST_TICK; tick++) {
    const day = tickStart(tick - 1);
    const r = rng.fork(`day:${String(tick)}`);
    // Pod restarts (any day, including weekends).
    const restartCount = Math.min(restartable.length, countFor(profile.restartsPerDay, day, r, 0.6));
    for (const pod of r.shuffle(restartable).slice(0, restartCount)) {
      const list = restarts.get(pod.name) ?? [];
      list.push(tick);
      restarts.set(pod.name, list);
    }
    // Growth: assets of today created on this day.
    for (let i = countFor(profile.growthPerDay, day, r, 0.3); i > 0; i--) {
      const asset = growable.pop();
      if (asset === undefined) break;
      base.delete(asset.name);
      touched.add(asset.name);
      at(tick).push({ op: 'add', asset: retime(asset, moment(tick, r)) });
    }
    // Transients: created now, deleted one to six days later (or at the end of the window).
    if (tick < LAST_TICK) {
      for (let i = countFor(profile.transientsPerDay, day, r, 0.3); i > 0; i--) {
        const removal = Math.min(LAST_TICK, tick + r.int(1, 6));
        for (const asset of makeEphemeral(moment(tick, r), r)) {
          at(tick).push({ op: 'add', asset });
          at(removal).push({ op: 'remove', name: asset.name });
        }
      }
    }
    // Retirements: assets that existed at the start and are deleted on this day.
    for (let i = countFor(profile.retirementsPerDay, day, r, 0.3); i > 0; i--) {
      // Created at some point between the container's creation and three days before the window.
      const createdAt = (notBefore: number): number =>
        notBefore +
        HOUR_MS +
        Math.floor(r.next() * Math.max(0, windowStart - 3 * DAY_MS - notBefore - HOUR_MS));
      for (const asset of makeEphemeral(createdAt, r)) {
        base.set(asset.name, asset);
        at(tick).push({ op: 'remove', name: asset.name });
      }
    }
    // Field changes.
    for (let i = countFor(profile.changesPerDay, day, r, 0.25); i > 0; i--) {
      const asset = changeable.pop();
      if (asset === undefined) break;
      const mutator = mutatorFor(asset);
      if (mutator === undefined) continue;
      touched.add(asset.name);
      at(tick).push({
        op: 'change',
        name: asset.name,
        at: moment(tick, r),
        fields: mutator.fields,
        forward: mutator.forward,
      });
    }
  }

  // Pod restarts: today's pod replaced a chain of earlier incarnations.
  for (const pod of restartable) {
    const ticks = restarts.get(pod.name);
    if (ticks === undefined) continue;
    const factory = build.traits.get(pod.name)?.predecessor;
    if (factory === undefined) continue;
    const r = rng.fork(`restart:${pod.name}`);
    const incarnation = (createdAt: number): GenAsset => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = factory(createdAt, r);
        if (!usedNames.has(candidate.name)) {
          usedNames.add(candidate.name);
          return candidate;
        }
      }
      throw new Error(`could not name a predecessor of ${pod.name}`);
    };
    let previous = incarnation(pod.createdAt);
    base.delete(pod.name);
    base.set(previous.name, previous);
    ticks.forEach((tick, index) => {
      const when = moment(tick, r);
      const next = index === ticks.length - 1 ? retime(pod, when) : incarnation(when);
      at(tick).push({ op: 'remove', name: previous.name });
      at(tick).push({ op: 'add', asset: next });
      previous = next;
    });
  }

  return replay(base, ops);
}

function replay(base: Map<string, GenAsset>, ops: readonly (readonly PlannedOp[])[]): ReplayedHistory {
  const working = new Map(base);
  const mutations: Mutation[][] = [[]];
  for (let tick = 1; tick < ops.length; tick++) {
    const list: Mutation[] = [];
    // Removals first, then changes, then additions: a restart never collides with itself.
    const planned = ops[tick] ?? [];
    const ordered = [
      ...planned.filter((op) => op.op === 'remove'),
      ...planned.filter((op) => op.op === 'change'),
      ...planned.filter((op) => op.op === 'add'),
    ];
    for (const op of ordered) {
      if (op.op === 'add') {
        if (working.has(op.asset.name)) throw new Error(`tick ${String(tick)} adds ${op.asset.name} twice`);
        working.set(op.asset.name, op.asset);
        list.push({ kind: 'add', asset: toAsset(op.asset) });
      } else if (op.op === 'remove') {
        const current = working.get(op.name);
        if (current === undefined) throw new Error(`tick ${String(tick)} removes missing ${op.name}`);
        working.delete(op.name);
        list.push({ kind: 'remove', name: op.name, assetType: current.assetType });
      } else {
        const current = working.get(op.name);
        if (current === undefined) throw new Error(`tick ${String(tick)} changes missing ${op.name}`);
        const next = touch(current, op.forward(current.data, op.at), op.at);
        working.set(op.name, next);
        list.push({ kind: 'change', asset: toAsset(next), fields: op.fields });
      }
    }
    mutations.push(list);
  }
  return { base: sortByName([...base.values()].map(toAsset)), mutations };
}
