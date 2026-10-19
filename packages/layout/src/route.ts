// SPDX-License-Identifier: Apache-2.0
/**
 * Stage 5: orthogonal routing over the gutter network (skill gcp-diagram-layout §5).
 *
 * Holders. Lanes are held per holder: an edge of its own, or a bundle (ports.ts: edges of one kind
 * meeting a hub at the same end from the same side share a port). Bundle members share lanes and merge
 * towards the hub.
 *
 * Search. Shortest path (A*) over the routing graph from source port stub to target port stub. Cost =
 * length + `Routing.bendCost` per bend + `Routing.laneCost` for every other holder's lane already in each
 * gutter segment (pressure spread over gutter length, network.ts). Bundle members pay no pressure for bundle
 * lanes and only `BUNDLE_LENGTH` of length where their bundle runs. Search states are a node plus arrival
 * axis. Stretches along a zone's border inside its padding band (`hugSpans` in gutters.ts) cost
 * `Routing.hugFactor` × length up to `Routing.hugCap` above length over the whole side (`hugFactors`), and
 * canvas margin stretches cost `Routing.marginFactor` × length. The consistent heuristic (Manhattan
 * distance + minimum bends) is weighted by `SINGLE_PASS_WEIGHT` once work reaches `Routing.singlePassWork`
 * (single-pass mode). Ties prefer nearer states to the goal, then lower state id.
 *
 * Re-route. After a widening re-pack (`previous`), edges keep port sides, bundle and routing order, laid
 * onto widened gutters. Only edges whose gutters no longer line up are searched again, at `STRAY` times
 * length outside their old corridor.
 *
 * Capacity. Segments with no lane for another holder are closed; lanes must fit gutters. Routes that do not
 * fit are re-searched avoiding failing segments (`RETRIES`), otherwise squeezed for the next widening round.
 *
 * Scope. A route uses only gutters of containers it crosses, between endpoints up to their lowest common
 * ancestor, never entering unrelated zones. Falls back to all gutters, then coarse-grid fallback.
 *
 * Order. Shortest Manhattan distance first, then id order for deterministic results.
 *
 * Lanes. A route is a sequence of runs along gutter lines, taking the lowest free lane that maintains
 * `Routing.lanePitch` clearance from other holders (occupancy.ts) and fits the gutter. Lane k sits
 * `laneSlot(k)` pitches (`Routing.lanePitch`) from the line centre, alternating sides.
 */
import type { Routing } from './constants.js';
import type { DrawnEdge } from './edges.js';
import { directRoute, gridRoute } from './fallback.js';
import { EPSILON, normalOf, simplifyPolyline, type ObstacleIndex } from './geometry.js';
import type { Container, GutterLine, GutterPiece, Gutters } from './gutters.js';
import { StateHeap } from './heap.js';
import { HUG_MARGIN, HUG_RING, PieceIds, buildNetwork, type Network } from './network.js';
import { Occupancy } from './occupancy.js';
import { assignPorts, type EdgePorts, type Port } from './ports.js';
import { isPortPiece, portLines } from './portlines.js';
import { ROUTE_STEP } from './steps.js';
import type { EdgePath, GutterReservations, GutterWidening, LayoutProgress, Point, Rect } from './types.js';

/** The share of a segment's length a bundle's member pays where its bundle already runs (it joins the trunk). */
export const BUNDLE_LENGTH = 0.9;

/** How often the capacity-aware pass searches again for an edge whose lanes do not fit its gutters. */
export const RETRIES = 2;

/** How many lane candidates the search for a route's lanes may try before it settles for the greedy choice. */
export const LANE_SEARCH = 200;

/**
 * In the re-route, what a segment's length costs an edge outside the gutters its first route used (its
 * corridor, which the widening sized for it): so the re-route keeps to them unless they are full.
 */
export const STRAY = 1.5;

/**
 * In single-pass mode (the first pass's search work reached `Routing.singlePassWork`), the search's estimate
 * for the rest of that pass is weighted by this much (weighted A*: a route costs at most this factor more than
 * the cheapest), so a very large layout stays within its budget; three-pass mode searches exactly.
 */
export const SINGLE_PASS_WEIGHT = 1.5;

/** A run before its lane is chosen: a line and the node positions along it. */
export interface Span {
  readonly line: number;
  readonly from: number;
  readonly to: number;
}

/** One stretch of a route along one gutter line: the line, the lane and the node positions it runs between. */
export interface Run {
  readonly line: number;
  readonly lane: number;
  readonly from: number;
  readonly to: number;
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

export interface RoutedEdge {
  readonly edge: DrawnEdge;
  readonly ports: EdgePorts;
  /** The runs of a gutter route; null when the fallback routed the edge. */
  readonly runs: readonly Run[] | null;
  /** The fallback's points (port to port); null for a gutter route. */
  readonly points: readonly Point[] | null;
  readonly failed: boolean;
  /** Some run found no lane clear of every other holder's segments and runs alongside one. */
  readonly overlap: boolean;
}

export interface Pass {
  readonly network: Network;
  readonly gutters: Gutters;
  readonly routed: readonly RoutedEdge[];
  /** Lanes in use per line (the highest lane used + 1). */
  readonly lanes: Int32Array;
  /** Per segment, the holder of each lane (-1 free); undefined for a segment no route uses. */
  readonly laneLists: readonly (readonly number[] | undefined)[];
  readonly maxLanes: number;
  /** Bundles formed (ports.ts) and the edges in them. */
  readonly bundles: number;
  readonly bundled: number;
  /** Lane holders: the edges routed on their own plus the bundles (whose members share their lanes). */
  readonly holders: number;
  /**
   * The pass's search work: the A* states it settled (taken from the queue for the first time), over every
   * edge. A deterministic measure of the routing's cost: the first pass's search is most of a layout's time.
   */
  readonly work: number;
  /**
   * The first pass's search reached `Routing.singlePassWork` before its last edge: the rest of it was searched
   * weighted and this pass is final (single-pass mode).
   */
  readonly single: boolean;
  /**
   * Per edge, the gutter pieces its route runs along with the lane it takes in each (null for the fallback):
   * the next pass's corridors. Computed when the next pass asks (the last pass never does).
   */
  readonly corridorOf: (index: number) => readonly (readonly [number, number])[] | null;
  /** The numbers of the gutter pieces' stable keys, shared with the next pass. */
  readonly pieceIds: PieceIds;
  /** The order the edges were routed in (indexes). */
  readonly order: readonly number[];
  /** The ports of every edge (by index). */
  readonly ports: readonly EdgePorts[];
}

export interface PassInput {
  readonly edges: readonly DrawnEdge[];
  readonly gutters: Gutters;
  readonly routing: Routing;
  readonly bounds: Rect;
  /** The obstacles (solid rects and headers) for the fallback, built on first use. */
  readonly obstacles: () => ObstacleIndex;
  /** False routes every edge by the fallback (tests of the fallback). */
  readonly useNetwork: boolean;
  /**
   * The pass before the re-pack, for the re-route: every edge keeps its ports' sides and bundle
   * (`assignPorts`) and its routing order, and its route is laid onto the widened gutters (the same gutter
   * pieces, turns and lanes: what the widening made room for). Only an edge whose gutters no longer line up (a
   * line it ran straight along has come apart, or two lines it turned between no longer meet) is searched
   * again, keeping to its old corridor where it can. The re-route keeps lanes inside the gutters' widths where
   * possible (`capacity`).
   */
  readonly previous?: Pass;
}

/**
 * Routes every edge over the gutters of one placement, in steps: yields a `route` progress (numbered `pass`)
 * every `ROUTE_STEP` edges, so a host can pause between them (steps.ts).
 */
export function* routePassSteps(input: PassInput, pass: number): Generator<LayoutProgress, Pass, undefined> {
  const { edges, gutters, routing } = input;
  const { previous } = input;
  const capacity = previous !== undefined;
  const ports = assignPorts(edges, gutters, routing, previous?.ports);
  const bundleIds = new Set<number>();
  let bundled = 0;
  for (const entry of ports) {
    if (entry.bundle === null) continue;
    bundled += 1;
    bundleIds.add(entry.bundle.index);
  }
  const holders = edges.length - bundled + bundleIds.size;
  // Single-pass mode is decided by the first pass's own search work (skill §5): it searches exactly, counting
  // the states it settles, and once that reaches `singlePassWork` it searches the rest of its edges weighted
  // and is final. A later pass never switches.
  let work = 0;
  let single = false;
  let weight = 1;
  const attachments = ports.flatMap(({ source, target }) => [
    { line: source.line, t: source.t },
    { line: target.line, t: target.t },
  ]);
  // Port lines (portlines.ts): a straight way out for ports that nothing stands beside.
  const exits = portLines(edges, ports, gutters, routing, gutters.lines.length);
  // Piece numbers are shared with the pass before, so the corridors it recorded can be looked up.
  const pieceIds = previous?.pieceIds ?? new PieceIds();
  const { network, attached } = buildNetwork(
    exits.lines.length === 0 ? gutters.lines : [...gutters.lines, ...exits.lines],
    attachments,
    routing.laneCost,
    pieceIds,
  );
  const { lines } = network;
  const pitch = routing.lanePitch;

  const laneLists: (number[] | undefined)[] = new Array<number[] | undefined>(network.segmentCount);
  // Distinct holders per segment, and the widest slot each segment's gutter fits (|laneSlot| at most).
  const held = new Int32Array(network.segmentCount);
  const maxSlot = new Int32Array(network.segmentCount);
  for (let s = 0; s < network.segmentCount; s += 1) {
    const room = (network.strip[s] as number) / 2 - routing.gutterBase;
    maxSlot[s] = Math.max(0, Math.floor(room / pitch + EPSILON));
  }
  const lanes = new Int32Array(lines.length);
  const occupancy = new Occupancy(pitch, routing.portSpacing / 2);
  // The segments each bundle holds a lane on (to mark them before routing its next member).
  const bundleSegments = new Map<number, number[]>();
  const ownMark = new Int32Array(network.segmentCount);
  let ownStamp = 0;
  // Segments the current edge's retry must avoid (its earlier attempt's lanes did not fit them).
  const avoidMark = new Int32Array(network.segmentCount);
  let avoidStamp = 0;
  // The current edge's corridor (the segments of the gutter pieces its previous route used).
  const corridorMark = new Int32Array(network.segmentCount);
  let corridorStamp = 0;
  const { pieceStart, pieceKeys } = network;
  let segmentsByPiece: Map<number, number[]> | undefined;
  const markCorridor = (keys: readonly (readonly [number, number])[]): void => {
    if (segmentsByPiece === undefined) {
      segmentsByPiece = new Map();
      for (let s = 0; s < network.segmentCount; s += 1) {
        for (let i = pieceStart[s] as number; i < (pieceStart[s + 1] as number); i += 1) {
          const key = pieceKeys[i] as number;
          const list = segmentsByPiece.get(key);
          if (list === undefined) segmentsByPiece.set(key, [s]);
          else list.push(s);
        }
      }
    }
    corridorStamp += 1;
    for (const [key] of keys) for (const s of segmentsByPiece.get(key) ?? []) corridorMark[s] = corridorStamp;
  };

  // Search state: node × 2 + axis (0 moving along a horizontal line, 1 along a vertical one).
  const states = network.nodeCount * 2;
  const g = new Float64Array(states);
  const seen = new Int32Array(states);
  const closed = new Int32Array(states);
  const parent = new Int32Array(states);
  const heap = new StateHeap();
  let stamp = 0;

  // Which segments an edge may use: those of the gutter pieces of the containers it has to cross (the scope),
  // marked with the scope's number in `containerMark`.
  const containerMark = new Int32Array(gutters.containers.length);
  let scope = 0;
  const markScope = (edge: DrawnEdge): void => {
    scope += 1;
    /** The containers around a node, innermost first, up to the canvas. */
    const chain = (index: number): number[] => {
      const result: number[] = [];
      for (let c = gutters.parentOf[index] as number; c >= 0; c = (gutters.containers[c] as Container).parent)
        result.push(c);
      return result;
    };
    const a = chain(edge.from.index);
    const b = chain(edge.to.index);
    const fromZone = gutters.containerOf[edge.from.index] as number;
    const toZone = gutters.containerOf[edge.to.index] as number;
    if (fromZone >= 0 && b.includes(fromZone)) {
      for (const c of b) {
        containerMark[c] = scope;
        if (c === fromZone) break;
      }
      return;
    }
    if (toZone >= 0 && a.includes(toZone)) {
      for (const c of a) {
        containerMark[c] = scope;
        if (c === toZone) break;
      }
      return;
    }
    const inB = new Set(b);
    let common = 0;
    for (const c of a) {
      containerMark[c] = scope;
      if (inB.has(c)) {
        common = c;
        break;
      }
    }
    for (const c of b) {
      containerMark[c] = scope;
      if (c === common) break;
    }
  };

  const { x: nodeX, y: nodeY, line: nodeLine, pos: nodePos, start: lineStart, nodes: lineNodes } = network;
  const { segment: lineSegment, length: segmentLength, pressure: segmentPressure, crossings } = network;
  const { ownerStart, owners, exclusive } = network;
  const bend = routing.bendCost;
  // What each segment costs per px: 1, or along a border `hugFactor` with the surcharge capped per ring side
  // (`hugCap`), or in the canvas margin `marginFactor`.
  const lengthFactor = hugFactors(network, routing);
  let minFactor = 1;
  for (const factor of lengthFactor) minFactor = Math.min(minFactor, factor);
  // The holder and the edge whose route is being searched (a port line admits only its own edge, or its
  // bundle's members at a shared port).
  let searching = -1;
  let searchingEdge = -1;

  /**
   * A* from (source, sourceAxis) to (target, targetAxis); the states of the cheapest path, or null. Written as
   * one loop over typed arrays: on a large layout it runs millions of steps. `restricted` keeps the route in
   * its scope; `full` closes the segments whose gutters hold no lane for another holder; `bundled` lets the
   * route run cheaply where its bundle already runs (the segments marked with `ownStamp`).
   */
  const search = (
    source: number,
    sourceAxis: number,
    target: number,
    targetAxis: number,
    restricted: boolean,
    full: boolean,
    bundled: boolean,
    sticky: boolean,
    sourcePortAxis = -1,
  ): number[] | null => {
    stamp += 1;
    heap.clear();
    const tx = nodeX[target] as number;
    const ty = nodeY[target] as number;
    const start = source * 2 + sourceAxis;
    const goal = target * 2 + targetAxis;
    const scale = Math.min(bundled ? BUNDLE_LENGTH : 1, minFactor);
    // Distance plus the bends still needed at least: one to change to the target's axis, two to come back to
    // it when the route moves along it but is not yet aligned with the target.
    const estimateOf = (state: number): number => {
      const node = state >> 1;
      const axis = state & 1;
      const dx = Math.abs((nodeX[node] as number) - tx);
      const dy = Math.abs((nodeY[node] as number) - ty);
      const bends = axis !== targetAxis ? 1 : (axis === 0 ? dy : dx) > EPSILON ? 2 : 0;
      return ((dx + dy) * scale + bends * bend) * weight;
    };
    // With a port line (portlines.ts) the route may leave straight along it, without the stub's turn onto
    // the gutter line, which then costs a bend.
    const seed = (state: number, cost: number): void => {
      g[state] = cost;
      seen[state] = stamp;
      parent[state] = -1;
      const h = estimateOf(state);
      heap.push(cost + h, h, state);
    };
    if (sourcePortAxis >= 0 && sourcePortAxis !== sourceAxis) {
      seed(source * 2 + sourcePortAxis, 0);
      seed(start, bend);
    } else seed(start, 0);
    while (heap.size > 0) {
      const state = heap.pop();
      if (closed[state] === stamp) continue;
      closed[state] = stamp;
      work += 1;
      if (state === goal) {
        const path: number[] = [];
        for (let s = goal; s >= 0; s = parent[s] as number) path.push(s);
        return path.reverse();
      }
      const base = g[state] as number;
      const node = state >> 1;
      // Move along either line through the node (the other one with a bend), each way, to the next node where a
      // route can turn (a crossing) or end (this edge's own target), adding up the segments on the way: the other
      // edges' attach points only split the line. Out of scope, or full, a segment ends the walk.
      for (let axis = 0; axis <= 1; axis += 1) {
        const line = nodeLine[node * 2 + axis] as number;
        if (line < 0) continue;
        const turn = axis === (state & 1) ? 0 : bend;
        const position = nodePos[node * 2 + axis] as number;
        const first = lineStart[line] as number;
        const count = (lineStart[line + 1] as number) - first;
        const segment0 = lineSegment[line] as number;
        for (let step = -1; step <= 1; step += 2) {
          let at = position;
          let cost = base + turn;
          for (;;) {
            const nextAt = at + step;
            if (nextAt < 0 || nextAt >= count) break;
            const s = segment0 + (step < 0 ? nextAt : at);
            if (restricted) {
              let ok = false;
              const end = ownerStart[s + 1] as number;
              for (let i = ownerStart[s] as number; i < end; i += 1) {
                if (containerMark[owners[i] as number] === scope) {
                  ok = true;
                  break;
                }
              }
              if (!ok) break;
            }
            const only = exclusive[s] as number;
            if (only >= 0 && only !== searching && only !== searchingEdge) break;
            const own = bundled && ownMark[s] === ownStamp;
            const others = (held[s] as number) - (own ? 1 : 0);
            if (full && ((!own && others >= 2 * (maxSlot[s] as number) + 1) || avoidMark[s] === avoidStamp))
              break;
            const factor =
              (own ? BUNDLE_LENGTH : sticky && corridorMark[s] !== corridorStamp ? STRAY : 1) *
              (lengthFactor[s] as number);
            cost += (segmentLength[s] as number) * factor + (segmentPressure[s] as number) * others;
            at = nextAt;
            const reached = lineNodes[first + at] as number;
            if (reached >= crossings && reached !== target) continue;
            const next = reached * 2 + axis;
            if (closed[next] !== stamp && (seen[next] !== stamp || cost < (g[next] as number))) {
              seen[next] = stamp;
              g[next] = cost;
              parent[next] = state;
              // The heuristic (estimateOf), inline.
              const dx = Math.abs((nodeX[reached] as number) - tx);
              const dy = Math.abs((nodeY[reached] as number) - ty);
              const bends = axis !== targetAxis ? 1 : (axis === 0 ? dy : dx) > EPSILON ? 2 : 0;
              const h = ((dx + dy) * scale + bends * bend) * weight;
              heap.push(cost + h, h, next);
            }
            break;
          }
        }
      }
      // At the target, arriving along the other line: the last bend, onto the target's own line.
      if (node === target) {
        const cost = base + bend;
        // (The goal is never closed here: taking it from the queue ends the search.)
        if (seen[goal] !== stamp || cost < (g[goal] as number)) {
          seen[goal] = stamp;
          g[goal] = cost;
          parent[goal] = state;
          heap.push(cost, 0, goal);
        }
      }
    }
    return null;
  };

  /** Where lane `lane` of a line runs: its fixed coordinate. */
  const laneAt = (line: number, lane: number): number =>
    (lines[line] as GutterLine).c + laneSlot(lane) * pitch;

  /** The segments a run holds its lane on (`coveredSegments`). */
  const covered = (line: number, from: number, to: number): number[] =>
    coveredSegments(network, line, from, to);

  /** What `hold` changed, so that a route whose lanes do not fit can be taken back (see `undo`). */
  interface Change {
    readonly s: number;
    readonly lane: number;
    readonly before: number;
    readonly added: boolean;
    readonly line: number;
    readonly lanesBefore: number;
  }
  const journal: Change[] = [];

  /** Takes lane `lane` in the segments for `holder` (no-op where it holds it already). */
  const hold = (segments: readonly number[], lane: number, holder: number, line: number): void => {
    for (const s of segments) {
      let list = laneLists[s];
      if (list === undefined) {
        list = [];
        laneLists[s] = list;
      }
      const added = !list.includes(holder);
      if (added) {
        held[s] = (held[s] as number) + 1;
        if (holder >= edges.length) {
          const own = bundleSegments.get(holder);
          if (own === undefined) bundleSegments.set(holder, [s]);
          else own.push(s);
        }
      }
      while (list.length <= lane) list.push(-1);
      journal.push({
        s,
        lane,
        before: list[lane] as number,
        added,
        line,
        lanesBefore: lanes[line] as number,
      });
      list[lane] = holder;
    }
    lanes[line] = Math.max(lanes[line] as number, lane + 1);
  };

  /** Takes back every `hold` since the journal had `mark` entries. */
  const undo = (mark: number, holder: number): void => {
    while (journal.length > mark) {
      const change = journal.pop() as Change;
      const list = laneLists[change.s] as number[];
      list[change.lane] = change.before;
      lanes[change.line] = change.lanesBefore;
      if (change.added) {
        held[change.s] = (held[change.s] as number) - 1;
        if (holder >= edges.length) bundleSegments.get(holder)?.pop();
      }
    }
  };

  /** The orthogonal points of a gutter route with lanes `pitch` apart: port, stub, elbows, stub, port. */
  const routePoints = (runs: readonly Run[], edgePorts: EdgePorts): Point[] =>
    corePoints(runs, edgePorts, lines, (line, lane) => laneAt(line, lane));

  /**
   * Chooses the runs' lanes. A run's lane must be free (or its holder's own) in every segment the run covers,
   * keep the drawing clear of every other holder's segments (the run from its start elbow to its end, the
   * previous run's reach on to this run's lane, the stub at either end of the route) and, in the capacity-aware
   * pass, fit every segment's gutter. Whether a lane is clear depends on the neighbouring runs' lanes (the
   * elbows), so the lanes are found by a depth-first search over the runs, lowest lanes first (a bundle's own
   * lanes before them), within `LANE_SEARCH` candidates. If it finds none, each run takes in turn the first
   * lane that is clear (not fitting: `overflow`), or failing that the first free one (`overlap`).
   */
  const chooseLanes = (
    spans: readonly Span[],
    edgePorts: EdgePorts,
    holder: number,
    previousLanes: ReadonlyMap<number, number> | null,
    exact: readonly number[] | null,
  ): { runs: Run[]; overflow: boolean; overlap: boolean; misfit: number[] } => {
    const count = spans.length;
    const last = count - 1;
    const { source, target } = edgePorts;
    // A run along a port line (portlines.ts) takes lane 0, the port's own coordinate, and starts (ends) at
    // the port itself: the stub is part of it. Each run's clearance is checked over the stretch its points
    // draw (runEnds).
    const {
      portRun,
      startsAtPort,
      endsAtPort,
      start: firstStart,
      end: runEnd,
    } = runEnds(network, spans, edgePorts, searchingEdge);
    const runSegments: number[][] = [];
    const runPreferred: number[][] = [];
    const runHighest: number[] = [];
    const runRoom: number[] = [];
    for (const span of spans) {
      const segments = covered(span.line, span.from, span.to);
      let room = Infinity;
      for (const s of segments) room = Math.min(room, maxSlot[s] as number);
      runSegments.push(segments);
      runRoom.push(Number.isFinite(room) ? room : 0);
    }
    /**
     * Each run's lanes in order of preference: a route laid onto the widened gutters takes its old lane first;
     * then the lanes the holder already has here (a bundle's trunk); then the lane the edge took in these
     * gutters in the previous pass (which the widening made room for); then every lane from 0. Computed only
     * when the old lanes do not all do (below).
     */
    const prepare = (): void => {
      spans.forEach((_, i) => {
        const segments = runSegments[i] as number[];
        const preferred: number[] = [];
        const old = exact?.[i];
        if (old !== undefined) preferred.push(old);
        let highest = 0;
        const own: number[] = [];
        for (const s of segments) {
          const list = laneLists[s];
          if (list === undefined) continue;
          highest = Math.max(highest, list.length);
          if (holder >= edges.length)
            for (let lane = 0; lane < list.length; lane += 1)
              if (list[lane] === holder && !own.includes(lane)) own.push(lane);
        }
        own.sort((a, b) => a - b);
        for (const lane of own) if (!preferred.includes(lane)) preferred.push(lane);
        if (previousLanes !== null) {
          for (const s of segments) {
            for (let k = pieceStart[s] as number; k < (pieceStart[s + 1] as number); k += 1) {
              const lane = previousLanes.get(pieceKeys[k] as number);
              if (lane !== undefined && !preferred.includes(lane)) preferred.push(lane);
            }
          }
        }
        runPreferred.push(preferred);
        runHighest.push(highest);
      });
    };
    const free = (i: number, lane: number): boolean => {
      for (const s of runSegments[i] as number[]) {
        const owner = laneLists[s]?.[lane];
        if (owner !== undefined && owner !== -1 && owner !== holder) return false;
      }
      return true;
    };
    const fits = (i: number, lane: number): boolean => Math.abs(laneSlot(lane)) <= (runRoom[i] as number);
    /** Whether run i on `lane` keeps clear, after the previous run on a lane at `previousAt`. */
    const clear = (i: number, lane: number, previousAt: number): boolean => {
      const span = spans[i] as Span;
      const entry = lines[span.line] as GutterLine;
      const horizontal = entry.horizontal;
      const at = laneAt(span.line, lane);
      const start = i === 0 ? firstStart : previousAt;
      const end = runEnd[i] as number;
      // A run along a port line is its port's stub drawn straight on: it keeps the stubs' clearance.
      const stub = (i === 0 && startsAtPort) || (i === last && endsAtPort);
      if (occupancy.blocked(horizontal, at, start, end, holder, stub)) return false;
      // The previous run reaches on to this lane (its elbow).
      if (i > 0 && occupancy.blocked(!horizontal, previousAt, entry.c, at, holder)) return false;
      // The stub from the port to the run's lane, across the run's line where the run starts (ends).
      if (
        i === 0 &&
        !startsAtPort &&
        occupancy.blocked(!horizontal, start, horizontal ? source.y : source.x, at, holder, true)
      )
        return false;
      if (
        i === last &&
        !endsAtPort &&
        occupancy.blocked(!horizontal, end, horizontal ? target.y : target.x, at, holder, true)
      )
        return false;
      return true;
    };
    /** Calls `visit` with run i's free lanes in order of preference up to `limit`, until it returns true. */
    const candidates = (i: number, limit: number, visit: (lane: number) => boolean): boolean => {
      if (portRun[i] === true) return free(i, 0) && visit(0);
      const preferred = runPreferred[i] as number[];
      for (const lane of preferred) if (lane <= limit && free(i, lane) && visit(lane)) return true;
      for (let lane = 0; lane <= limit; lane += 1)
        if (!preferred.includes(lane) && free(i, lane) && visit(lane)) return true;
      return false;
    };
    const chosen: number[] = new Array<number>(count).fill(-1);
    let budget = LANE_SEARCH;
    const search = (i: number, previousAt: number): boolean => {
      if (i > last) return true;
      const line = (spans[i] as Span).line;
      // In the capacity-aware pass only the lanes that fit are worth trying.
      const limit = capacity ? 2 * (runRoom[i] as number) : (runHighest[i] as number) + 40;
      return candidates(i, limit, (lane) => {
        if (budget <= 0) return true;
        budget -= 1;
        if (capacity && !fits(i, lane)) return false;
        if (!clear(i, lane, previousAt)) return false;
        chosen[i] = lane;
        return search(i + 1, laneAt(line, lane));
      });
    };
    let overflow = false;
    let overlap = false;
    // A laid route whose old lanes are all still free, fitting and clear takes them: what the search below
    // would find first (its first candidate at every run), without preparing every run's preferences.
    let laidAsBefore = exact !== null;
    if (exact !== null) {
      let previousAt = 0;
      for (let i = 0; i <= last && laidAsBefore; i += 1) {
        const lane = exact[i] ?? -1;
        const ok =
          lane >= 0 &&
          (portRun[i] !== true || lane === 0) &&
          free(i, lane) &&
          (!capacity || fits(i, lane)) &&
          clear(i, lane, previousAt);
        if (ok) {
          chosen[i] = lane;
          previousAt = laneAt((spans[i] as Span).line, lane);
        } else laidAsBefore = false;
      }
    }
    if (!laidAsBefore) prepare();
    if (!laidAsBefore && (!search(0, 0) || budget <= 0)) {
      let previousAt = 0;
      spans.forEach((span, i) => {
        // The highest lane any covered segment uses is free in all of them, so a free lane exists.
        let clearLane = -1;
        let freeLane = -1;
        candidates(i, (runHighest[i] as number) + 40, (lane) => {
          if (freeLane < 0) freeLane = lane;
          if (!clear(i, lane, previousAt)) return false;
          clearLane = lane;
          return true;
        });
        const lane = clearLane >= 0 ? clearLane : freeLane;
        if (clearLane < 0) overlap = true;

        if (capacity && !fits(i, lane)) overflow = true;
        chosen[i] = lane;
        previousAt = laneAt(span.line, lane);
      });
    }
    const runs: Run[] = [];
    const misfit: number[] = [];
    spans.forEach((span, i) => {
      const lane = chosen[i] as number;
      const segments = runSegments[i] as number[];
      if (capacity) {
        const slot = Math.abs(laneSlot(lane));
        for (const s of segments) if (slot > (maxSlot[s] as number)) misfit.push(s);
      }
      runs.push({ ...span, lane });
      hold(segments, lane, holder, span.line);
    });
    return { runs, overflow, overlap, misfit };
  };

  /**
   * Records a route's drawn segments for the later routes' clearance checks; with `stubs`, its first and last
   * segments are its ports' stubs.
   */
  const occupy = (points: readonly Point[], holder: number, stubs: boolean): void => {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1] as Point;
      const b = points[i] as Point;
      const stub = stubs && (i === 1 || i === points.length - 1);
      if (Math.abs(a.y - b.y) <= EPSILON && Math.abs(a.x - b.x) > EPSILON)
        occupancy.add(true, a.y, a.x, b.x, holder, stub);
      else if (Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) > EPSILON)
        occupancy.add(false, a.x, a.y, b.y, holder, stub);
    }
  };

  /**
   * A path's runs: consecutive states on one axis run along one line; an axis change turns at the earlier node
   * (or, at the target, in place).
   */
  const spansOf = (path: readonly number[]): { line: number; from: number; to: number }[] => {
    const spans: { line: number; from: number; to: number }[] = [];
    let previousState = path[0] as number;
    let line = network.line[previousState] as number;
    let begin = network.pos[previousState] as number;
    let end = begin;
    for (let i = 1; i < path.length; i += 1) {
      const state = path[i] as number;
      if ((state & 1) !== (previousState & 1)) {
        spans.push({ line, from: begin, to: end });
        const turnAt = ((previousState >> 1) << 1) | (state & 1);
        line = network.line[turnAt] as number;
        begin = network.pos[turnAt] as number;
      }
      end = network.pos[state] as number;
      previousState = state;
    }
    spans.push({ line, from: begin, to: end });
    return spans;
  };

  // Laying a previous route onto these gutters: which line each gutter piece is now part of.
  let lineOfPiece: Map<number, number> | undefined;
  /** The node where lines a and b (one horizontal, one vertical) cross; -1 if they do not. */
  const crossingOf = (a: number, b: number): number => {
    const first = lineStart[a] as number;
    const count = (lineStart[a + 1] as number) - first;
    const at = (lines[b] as GutterLine).c;
    const horizontal = (lines[a] as GutterLine).horizontal;
    const coordinate = horizontal ? nodeX : nodeY;
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((coordinate[lineNodes[first + mid] as number] as number) < at - EPSILON) lo = mid + 1;
      else hi = mid;
    }
    const axis = horizontal ? 1 : 0;
    for (let i = lo; i < count; i += 1) {
      const node = lineNodes[first + i] as number;
      if ((coordinate[node] as number) > at + EPSILON) break;
      if (nodeLine[node * 2 + axis] === b) return node;
    }
    return -1;
  };
  /**
   * An edge's route of the previous pass laid onto these gutters: each run on the line its gutter pieces are
   * now part of, turning where those lines cross, from the edge's attach point to its target's; with the old
   * lanes. Null when the gutters no longer line up (or the edge took the fallback).
   */
  const layRoute = (index: number, before: Pass): { spans: Span[]; lanes: number[] } | null => {
    const old = before.routed[index];
    if (old?.runs === undefined || old.runs === null) return null;
    if (lineOfPiece === undefined) {
      lineOfPiece = new Map();
      lines.forEach((entry, l) => {
        for (const piece of entry.pieces) (lineOfPiece as Map<number, number>).set(pieceIds.idOf(piece), l);
      });
    }
    const was = before.network;
    const runLines: number[] = [];
    for (const run of old.runs) {
      let mapped = -1;
      for (const s of coveredSegments(was, run.line, run.from, run.to)) {
        for (let i = was.pieceStart[s] as number; i < (was.pieceStart[s + 1] as number); i += 1) {
          const l = lineOfPiece.get(was.pieceKeys[i] as number);
          if (l === undefined || (mapped >= 0 && l !== mapped)) return null;
          mapped = l;
        }
      }
      if (mapped < 0) return null;
      runLines.push(mapped);
    }
    const axisOf = (l: number): number => ((lines[l] as GutterLine).horizontal ? 0 : 1);
    const source = attached[index * 2] as number;
    const target = attached[index * 2 + 1] as number;
    const firstLine = runLines[0] as number;
    const lastLine = runLines[runLines.length - 1] as number;
    if (nodeLine[source * 2 + axisOf(firstLine)] !== firstLine) return null;
    if (nodeLine[target * 2 + axisOf(lastLine)] !== lastLine) return null;
    const spans: Span[] = [];
    let from = nodePos[source * 2 + axisOf(firstLine)] as number;
    for (let i = 0; i + 1 < runLines.length; i += 1) {
      const line = runLines[i] as number;
      const next = runLines[i + 1] as number;
      if (axisOf(line) === axisOf(next)) return null;
      const turn = crossingOf(line, next);
      if (turn < 0) return null;
      spans.push({ line, from, to: nodePos[turn * 2 + axisOf(line)] as number });
      from = nodePos[turn * 2 + axisOf(next)] as number;
    }
    spans.push({ line: lastLine, from, to: nodePos[target * 2 + axisOf(lastLine)] as number });
    return { spans, lanes: old.runs.map((run) => run.lane) };
  };

  let order = previous?.order;
  if (order === undefined) {
    const distance = ports.map(
      ({ source, target }) => Math.abs(source.x - target.x) + Math.abs(source.y - target.y),
    );
    order = edges
      .map((_, index) => index)
      .sort((a, b) => (distance[a] as number) - (distance[b] as number) || a - b);
  }

  const routed: RoutedEdge[] = new Array<RoutedEdge>(edges.length);
  let count = 0;
  for (const index of order) {
    if (count > 0 && count % ROUTE_STEP === 0) {
      yield { stage: 'route', pass, routed: count, edges: edges.length };
    }
    count += 1;
    const edge = edges[index] as DrawnEdge;
    const edgePorts = ports[index] as EdgePorts;
    const { holder } = edgePorts;
    const bundled = holder >= edges.length;
    ownStamp += 1;
    if (bundled) for (const s of bundleSegments.get(holder) ?? []) ownMark[s] = ownStamp;
    const source = attached[index * 2] as number;
    const target = attached[index * 2 + 1] as number;
    const sourceAxis = lines[edgePorts.source.line]?.horizontal === true ? 0 : 1;
    // A port line (portlines.ts) is a way out at either end: the route may start along the source's and must
    // end along the target's port line or turn onto it at the target (the stub).
    const sourceExit = exits.lineOf[index * 2] as number;
    const targetExit = exits.lineOf[index * 2 + 1] as number;
    const sourcePortAxis = sourceExit < 0 ? -1 : (lines[sourceExit] as GutterLine).horizontal ? 0 : 1;
    const targetAxis =
      targetExit >= 0
        ? (lines[targetExit] as GutterLine).horizontal
          ? 0
          : 1
        : lines[edgePorts.target.line]?.horizontal === true
          ? 0
          : 1;
    searching = holder;
    searchingEdge = index;
    if (previous === undefined && !single && work >= routing.singlePassWork) {
      single = true;
      weight = SINGLE_PASS_WEIGHT;
    }
    const routable = input.useNetwork && source >= 0 && target >= 0;
    if (routable) markScope(edge);
    avoidStamp += 1;
    const corridor = previous?.corridorOf(index) ?? null;
    const sticky = corridor !== null;
    if (sticky) markCorridor(corridor);
    const previousLanes = corridor === null ? null : new Map(corridor);
    const laid = routable && previous !== undefined ? layRoute(index, previous) : null;
    const laidLanes = laid === null ? null : laid.lanes;
    let path: number[] | null = null;
    if (routable && laid === null) {
      if (capacity)
        path = search(source, sourceAxis, target, targetAxis, true, true, bundled, sticky, sourcePortAxis);
      path ??= search(source, sourceAxis, target, targetAxis, true, false, bundled, sticky, sourcePortAxis);
      path ??= search(source, sourceAxis, target, targetAxis, false, false, bundled, false, sourcePortAxis);
    }
    if (path === null && laid === null) {
      const points = gridRoute(
        input.obstacles(),
        edgePorts.source,
        edgePorts.target,
        input.bounds,
        routing.fallbackGrid,
        routing.bendCost,
      );
      const drawn = points ?? directRoute(edgePorts.source, edgePorts.target);
      occupy(drawn, holder, false);
      routed[index] = {
        edge,
        ports: edgePorts,
        runs: null,
        points: drawn,
        failed: points === null,
        overlap: false,
      };
      continue;
    }
    const mark = journal.length;
    const first = laid === null ? spansOf(path as number[]) : laid.spans;
    let lanesOf = chooseLanes(first, edgePorts, holder, previousLanes, laidLanes);
    // In the capacity-aware pass, a route whose lanes do not fit its gutters is taken back and searched again
    // avoiding the segments that did not fit, at most `RETRIES` times; if no attempt fits, the first stands.
    if (capacity && lanesOf.overflow) {
      let misfit = lanesOf.misfit;
      let fixed = false;
      for (let attempt = 0; attempt < RETRIES && !fixed; attempt += 1) {
        for (const s of misfit) avoidMark[s] = avoidStamp;
        undo(mark, holder);
        const retry = search(
          source,
          sourceAxis,
          target,
          targetAxis,
          true,
          true,
          bundled,
          sticky,
          sourcePortAxis,
        );
        if (retry === null) break;
        const next = chooseLanes(spansOf(retry), edgePorts, holder, previousLanes, null);
        if (!next.overflow) {
          lanesOf = next;
          fixed = true;
        } else misfit = next.misfit;
      }
      if (!fixed) {
        undo(mark, holder);
        lanesOf = chooseLanes(first, edgePorts, holder, previousLanes, laidLanes);
      }
    }
    journal.length = 0;
    const { runs, overlap } = lanesOf;
    // Simplified, so that a run along a port line and its port's stub are one segment, recorded as the stub.
    occupy(simplifyPolyline(routePoints(runs, edgePorts)), holder, true);
    routed[index] = { edge, ports: edgePorts, runs, points: null, failed: false, overlap };
  }

  /** The gutter pieces (by number) an edge's route runs along, each with the first lane it takes there. */
  const corridorOf = (index: number): [number, number][] | null => {
    const runs = routed[index]?.runs;
    if (runs === undefined || runs === null) return null;
    const keys = new Map<number, number>();
    for (const run of runs) {
      for (const s of covered(run.line, run.from, run.to)) {
        for (let i = pieceStart[s] as number; i < (pieceStart[s + 1] as number); i += 1) {
          const key = pieceKeys[i] as number;
          if (!keys.has(key)) keys.set(key, run.lane);
        }
      }
    }
    return [...keys];
  };
  return {
    network,
    gutters,
    routed,
    lanes,
    laneLists,
    maxLanes: Math.max(0, ...lanes),
    bundles: bundleIds.size,
    bundled,
    holders,
    work,
    single,
    corridorOf,
    pieceIds,
    order,
    ports,
  };
}

/**
 * What each segment of the network costs per px of its length (skill §5): 1 through a gap or free
 * space; along a ring side (`HUG_RING`) `hugFactor`, except that the surcharge over the whole side is at most
 * `hugCap` (a side longer than `hugCap / (hugFactor − 1)` pays proportionally less per px), so going round to
 * avoid a long border never pays more than about `hugCap`; in the canvas margin (`HUG_MARGIN`) `marginFactor`.
 */
export function hugFactors(network: Network, routing: Routing): Float64Array {
  const factors = new Float64Array(network.segmentCount).fill(1);
  const { hug, hugSide } = network;
  const surcharge = routing.hugFactor - 1;
  for (let s = 0; s < network.segmentCount; s += 1) {
    if (hug[s] === HUG_RING) {
      const side = hugSide[s] as number;
      factors[s] = 1 + (side > 0 ? Math.min(surcharge, routing.hugCap / side) : surcharge);
    } else if (hug[s] === HUG_MARGIN) factors[s] = routing.marginFactor;
  }
  return factors;
}

function coveredSegments(network: Network, line: number, from: number, to: number): number[] {
  const segment0 = network.segment[line] as number;
  const count = (network.start[line + 1] as number) - (network.start[line] as number);
  const result: number[] = [];
  if (from === to) {
    if (from > 0) result.push(segment0 + from - 1);
    if (from < count - 1) result.push(segment0 + from);
    return result;
  }
  for (let i = Math.min(from, to); i < Math.max(from, to); i += 1) result.push(segment0 + i);
  return result;
}

/** How the runs of a route meet its ports (`runEnds`). */
export interface RunEnds {
  /** Per run: it runs along a port line of the route's own, on lane 0, the port's own coordinate. */
  readonly portRun: readonly boolean[];
  /** The first run is its source port's stub drawn straight on: a port run in the stub's direction. */
  readonly startsAtPort: boolean;
  /** The last run is its target port's stub drawn straight on. */
  readonly endsAtPort: boolean;
  /** Where the first run starts, as a coordinate along its own line. */
  readonly start: number;
  /** Where each run ends, as a coordinate along its own line. */
  readonly end: readonly number[];
}

/**
 * How the runs of a route meet its ports, for the lane search: `edge` is the route's edge and `ports.holder`
 * the holder of its lanes.
 *
 * - A run along a port line of the route's own (portlines.ts) is a port run. The line says so, not the
 *   segments the run covers: each of its pieces names the holder it belongs to (the edge, or at a hub's
 *   shared port the bundle), so a run that covers no segment (one of no length along a line of a single
 *   node) is a port run too and is held on the port's coordinate. A first (last) port run whose line runs in
 *   its port's stub's direction starts (ends) at the port itself: the stub is part of it.
 * - The first run starts and the last one ends where the route's points put them (`corePoints`): at the
 *   port's coordinate along the run's own line, its x along a horizontal line and its y along a vertical
 *   one. On the port's gutter line that is where the stub meets it (`Port.t`), along a port line the port
 *   itself; never `t` on a line across the gutter line, where `t` is a coordinate on the other axis. Every
 *   other run ends at its last node.
 */
export function runEnds(network: Network, spans: readonly Span[], ports: EdgePorts, edge: number): RunEnds {
  const { lines } = network;
  const { source, target, holder } = ports;
  const last = spans.length - 1;
  const horizontal = (span: Span): boolean => (lines[span.line] as GutterLine).horizontal;
  /** A port's coordinate along a line of the run's orientation. */
  const portAlong = (port: Port, span: Span): number => (horizontal(span) ? port.x : port.y);
  /** Whether the run's line runs in the direction of the port's stub (across the port's side). */
  const inStub = (port: Port, span: Span): boolean =>
    horizontal(span) === (port.side !== 'bottom' && port.side !== 'top');
  const portRun = spans.map((span) => {
    const own = (lines[span.line] as GutterLine).pieces[0]?.holder;
    return own !== undefined && (own === holder || own === edge);
  });
  const first = spans[0] as Span;
  const final = spans[last] as Span;
  const end = spans.map((span, i) => {
    if (i === last) return portAlong(target, span);
    const node = network.nodes[(network.start[span.line] as number) + span.to] as number;
    return horizontal(span) ? (network.x[node] as number) : (network.y[node] as number);
  });
  return {
    portRun,
    startsAtPort: portRun[0] === true && inStub(source, first),
    endsAtPort: portRun[last] === true && inStub(target, final),
    start: portAlong(source, first),
    end,
  };
}

/**
 * The orthogonal points of a gutter route, port to port: the source port, the stub's end on the first run's
 * lane, one elbow per change of run, the stub's start on the last run's lane, the target port. `laneAt` gives
 * a lane's fixed coordinate.
 */
function corePoints(
  runs: readonly Run[],
  ports: EdgePorts,
  lines: readonly GutterLine[],
  laneAt: (line: number, lane: number) => number,
): Point[] {
  const { source, target } = ports;
  const lane = (run: Run): number => laneAt(run.line, run.lane);
  const horizontal = (run: Run): boolean => (lines[run.line] as GutterLine).horizontal;
  // A gutter route has at least one run: the stub turns onto the first, the last turns into the stub.
  const head = runs[0] as Run;
  const tail = runs[runs.length - 1] as Run;
  const core: Point[] = [{ x: source.x, y: source.y }];
  core.push(horizontal(head) ? { x: source.x, y: lane(head) } : { x: lane(head), y: source.y });
  for (let i = 0; i + 1 < runs.length; i += 1) {
    const run = runs[i] as Run;
    const next = runs[i + 1] as Run;
    core.push(horizontal(run) ? { x: lane(next), y: lane(run) } : { x: lane(run), y: lane(next) });
  }
  core.push(horizontal(tail) ? { x: target.x, y: lane(tail) } : { x: lane(tail), y: target.y });
  core.push({ x: target.x, y: target.y });
  return core;
}

/** Extra lane space for one container: its ring sides and single gaps (the router widens gap by gap). */
export interface Widening {
  ringSides: { top: number; right: number; bottom: number; left: number };
  cardColumns: number[];
  zoneColumns: number[][];
  rows: number[];
  /** `stacks[r][c][k]`: below zone k of the stack in cell c of zone row r. */
  stacks: number[][][];
}

/**
 * Where lane k of a gutter line sits, in pitches from its centre-line: lane 0 on it, then alternately one
 * side and the other (+1, −1, +2, −2, …). A lane keeps its place along the whole line whatever the other
 * stretches of the line carry, so each gutter needs room only for the lanes that run through it: n lanes need
 * n × lanePitch + gutterBase px (one pitch more when n is even), the outermost staying gutterBase px clear of
 * the boxes on either side.
 */
export function laneSlot(lane: number): number {
  if (lane === 0) return 0;
  const rank = Math.ceil(lane / 2);
  return lane % 2 === 1 ? rank : -rank;
}

/**
 * The gutter pieces of a line that carry lanes, each with the farthest slot from the centre-line any of its
 * lanes takes (0 when only the centre lane runs there).
 */
function loadedPieces(pass: Pass, line: number): Map<GutterPiece, number> {
  const { network } = pass;
  const loaded = new Map<GutterPiece, number>();
  const entry = network.lines[line] as GutterLine;
  const first = network.start[line] as number;
  const count = (network.start[line + 1] as number) - first;
  const segment0 = network.segment[line] as number;
  const coordinate = entry.horizontal ? network.x : network.y;
  for (let i = 0; i + 1 < count; i += 1) {
    const holders = pass.laneLists[segment0 + i];
    if (holders === undefined) continue;
    let reach = -1;
    holders.forEach((holder, lane) => {
      if (holder >= 0) reach = Math.max(reach, Math.abs(laneSlot(lane)));
    });
    if (reach < 0) continue;
    const at =
      ((coordinate[network.nodes[first + i] as number] as number) +
        (coordinate[network.nodes[first + i + 1] as number] as number)) /
      2;
    for (const piece of entry.pieces) {
      // A port line carries its port's lane 0 only and is never widened.
      if (isPortPiece(piece) || at < piece.a - EPSILON || at > piece.b + EPSILON) continue;
      loaded.set(piece, Math.max(loaded.get(piece) ?? 0, reach));
    }
  }
  return loaded;
}

/** The width a gutter needs for lanes reaching `reach` pitches from its centre-line. */
function neededWidth(reach: number, routing: Routing): number {
  return 2 * (reach * routing.lanePitch + routing.gutterBase);
}

/**
 * Lane space the widening pass adds per container: every gutter piece narrower than its lanes need
 * (`laneSlot`) widens its own gap, or its side of its container's ring, by the difference, rounded up to an
 * even number so centre-lines stay on whole pixels.
 */
export function wideningOf(pass: Pass, routing: Routing): Map<number, Widening> {
  const widening = new Map<number, Widening>();
  const raise = (list: number[], index: number, value: number): void => {
    while (list.length <= index) list.push(0);
    list[index] = Math.max(list[index] as number, value);
  };
  pass.network.lines.forEach((_, index) => {
    if ((pass.lanes[index] as number) === 0) return;
    for (const [piece, reach] of loadedPieces(pass, index)) {
      const deficit = neededWidth(reach, routing) - piece.strip;
      if (deficit <= EPSILON) continue;
      const extra = 2 * Math.ceil(deficit / 2 - EPSILON);
      let entry = widening.get(piece.owner);
      if (entry === undefined) {
        entry = emptyWidening();
        widening.set(piece.owner, entry);
      }
      const { gap } = piece;
      if (gap.kind === 'ring') entry.ringSides[gap.side] = Math.max(entry.ringSides[gap.side], extra);
      else if (gap.kind === 'row') raise(entry.rows, gap.index, extra);
      else if (gap.kind === 'card-column') raise(entry.cardColumns, gap.index, extra);
      else if (gap.kind === 'port') continue;
      else if (gap.kind === 'stack') {
        while (entry.stacks.length <= gap.row) entry.stacks.push([]);
        const row = entry.stacks[gap.row] as number[][];
        while (row.length <= gap.cell) row.push([]);
        raise(row[gap.cell] as number[], gap.index, extra);
      } else {
        while (entry.zoneColumns.length <= gap.row) entry.zoneColumns.push([]);
        raise(entry.zoneColumns[gap.row] as number[], gap.index, extra);
      }
    }
  });
  return widening;
}

function emptyWidening(): Widening {
  return {
    ringSides: { top: 0, right: 0, bottom: 0, left: 0 },
    cardColumns: [],
    zoneColumns: [],
    rows: [],
    stacks: [],
  };
}

/** Adds `extra` to `total`, container by container and gap by gap. */
export function accumulate(total: Map<number, Widening>, extra: ReadonlyMap<number, Widening>): void {
  const add = (into: number[], from: readonly number[]): void => {
    from.forEach((value, i) => {
      while (into.length <= i) into.push(0);
      into[i] = (into[i] as number) + value;
    });
  };
  for (const [container, widening] of extra) {
    let entry = total.get(container);
    if (entry === undefined) {
      entry = emptyWidening();
      total.set(container, entry);
    }
    for (const side of SIDES) entry.ringSides[side] += widening.ringSides[side];
    add(entry.cardColumns, widening.cardColumns);
    add(entry.rows, widening.rows);
    widening.zoneColumns.forEach((row, r) => {
      while (entry.zoneColumns.length <= r) entry.zoneColumns.push([]);
      add(entry.zoneColumns[r] as number[], row);
    });
    widening.stacks.forEach((row, r) => {
      while (entry.stacks.length <= r) entry.stacks.push([]);
      const into = entry.stacks[r] as number[][];
      row.forEach((cell, c) => {
        while (into.length <= c) into.push([]);
        add(into[c] as number[], cell);
      });
    });
  }
}

/** The caller's reservations plus the widening, per container (zones by id, in container order). */
export function addWidening(
  base: GutterReservations,
  widening: ReadonlyMap<number, Widening>,
  gutters: Gutters,
): GutterReservations {
  const add = (a: readonly number[] | undefined, b: readonly number[] | undefined): number[] | undefined => {
    const length = Math.max(a?.length ?? 0, b?.length ?? 0);
    if (length === 0) return undefined;
    return Array.from({ length }, (_, i) => (a?.[i] ?? 0) + (b?.[i] ?? 0));
  };
  const sum = (a: GutterWidening | undefined, b: Widening | undefined): GutterWidening => {
    const ringSides: { top?: number; right?: number; bottom?: number; left?: number } = {};
    for (const side of SIDES) {
      const value = (a?.ringSides?.[side] ?? 0) + (b?.ringSides[side] ?? 0);
      if (value !== 0) ringSides[side] = value;
    }
    const cardColumns = add(a?.gaps?.cardColumns, b?.cardColumns);
    const rows = add(a?.gaps?.rows, b?.rows);
    const rowCount = Math.max(a?.gaps?.zoneColumns?.length ?? 0, b?.zoneColumns.length ?? 0);
    const zoneColumns =
      rowCount === 0
        ? undefined
        : Array.from({ length: rowCount }, (_, r) => add(a?.gaps?.zoneColumns?.[r], b?.zoneColumns[r]) ?? []);
    const stackRows = Math.max(a?.gaps?.stacks?.length ?? 0, b?.stacks.length ?? 0);
    const stacks =
      stackRows === 0
        ? undefined
        : Array.from({ length: stackRows }, (_, r) => {
            const cells = Math.max(a?.gaps?.stacks?.[r]?.length ?? 0, b?.stacks[r]?.length ?? 0);
            return Array.from(
              { length: cells },
              (_, c) => add(a?.gaps?.stacks?.[r]?.[c], b?.stacks[r]?.[c]) ?? [],
            );
          });
    const gaps = {
      ...(cardColumns === undefined ? {} : { cardColumns }),
      ...(zoneColumns === undefined ? {} : { zoneColumns }),
      ...(rows === undefined ? {} : { rows }),
      ...(stacks === undefined ? {} : { stacks }),
    };
    return {
      ...(a?.horizontal === undefined ? {} : { horizontal: a.horizontal }),
      ...(a?.vertical === undefined ? {} : { vertical: a.vertical }),
      ...(a?.ring === undefined ? {} : { ring: a.ring }),
      ...(Object.keys(ringSides).length === 0 ? {} : { ringSides }),
      ...(Object.keys(gaps).length === 0 ? {} : { gaps }),
    };
  };
  const baseZones = base.zones ?? {};
  const zones = Object.create(null) as Record<string, GutterWidening>;
  for (const container of gutters.containers) {
    if (container.node === null) continue;
    const id = container.node.id;
    const own = Object.hasOwn(baseZones, id) ? baseZones[id] : undefined;
    const entry = sum(own, widening.get(container.index));
    if (Object.keys(entry).length > 0) zones[id] = entry;
  }
  const canvas = sum(base.canvas, widening.get(0));
  return {
    ...(Object.keys(canvas).length > 0 ? { canvas } : {}),
    ...(Object.keys(zones).length > 0 ? { zones } : {}),
  };
}

/**
 * Where a line's lanes sit (`laneSlot` × pitch from the centre-line). The pitch is `lanePitch` unless a piece
 * that carries lanes is narrower than they need; then the line's lanes move closer together (at most half the
 * base from the boxes), and the line counts as squeezed.
 */
function laneOffsets(
  pass: Pass,
  routing: Routing,
): { offset: (line: number, lane: number) => number; squeezed: number } {
  const pitch = new Float64Array(pass.network.lines.length).fill(routing.lanePitch);
  let squeezed = 0;
  pass.network.lines.forEach((_, index) => {
    if ((pass.lanes[index] as number) === 0) return;
    let tight = false;
    for (const [piece, reach] of loadedPieces(pass, index)) {
      if (neededWidth(reach, routing) <= piece.strip + EPSILON || reach === 0) continue;
      tight = true;
      const fits = Math.max(0, piece.strip / 2 - routing.gutterBase / 2) / reach;
      pitch[index] = Math.min(pitch[index] as number, fits);
    }
    if (tight) squeezed += 1;
  });
  return {
    offset: (line, lane) => laneSlot(lane) * (pitch[line] as number),
    squeezed,
  };
}

/** The tip of an arrowhead at a port: `inset` inside the rect's border (at the port for an inward port). */
function tipOf(port: Port): Point {
  const normal = normalOf(port.side);
  return { x: port.x - normal.x * port.inset, y: port.y - normal.y * port.inset };
}

export interface Paths {
  readonly edges: Record<string, EdgePath>;
  readonly bends: number[];
  readonly fallbacks: number;
  readonly failed: number;
  readonly squeezed: number;
  /** Edges with a stretch that no lane could keep clear of another holder's segments. */
  readonly overlaps: number;
  readonly fallbackIds: string[];
}

/** The final geometry of a pass: every edge's points, in the edges' (id) order. */
export function pathsOf(pass: Pass, routing: Routing): Paths {
  const { offset, squeezed } = laneOffsets(pass, routing);
  const { lines } = pass.network;
  const edges = Object.create(null) as Record<string, EdgePath>;
  const bends: number[] = [];
  let fallbacks = 0;
  let failed = 0;
  let overlaps = 0;
  const fallbackIds: string[] = [];
  for (const entry of pass.routed) {
    const { edge, ports } = entry;
    const { source, target } = ports;
    let core: Point[];
    if (entry.runs === null) {
      core = [...(entry.points as Point[])];
      fallbacks += 1;
      fallbackIds.push(edge.id);
      if (entry.failed) failed += 1;
    } else {
      core = corePoints(
        entry.runs,
        ports,
        lines,
        (line, lane) => (lines[line] as GutterLine).c + offset(line, lane),
      );
    }
    const raw = [
      ...(edge.heads === 'both' ? [tipOf(source)] : []),
      ...core,
      ...(edge.heads === 'none' ? [] : [tipOf(target)]),
    ];
    let points = simplifyPolyline(raw);
    // Two ports at one point (touching rects, no heads) still give an edge of two points.
    if (points.length < 2) points = [raw[0] as Point, raw[raw.length - 1] as Point];
    const elbows = points.length - 2;
    bends[elbows] = (bends[elbows] ?? 0) + 1;
    edges[edge.id] = {
      from: edge.from.id,
      to: edge.to.id,
      kind: edge.kind,
      count: edge.count,
      merged: edge.merged,
      heads: edge.heads,
      source: { x: source.x, y: source.y, side: source.side },
      target: { x: target.x, y: target.y, side: target.side },
      points,
      elbowRadius: elbows > 0 ? routing.elbowRadius : 0,
      fallback: entry.runs === null,
      ...(ports.bundle === null
        ? {}
        : {
            bundle: {
              id: ports.bundle.id,
              end: ports.bundle.end === 1 ? ('target' as const) : ('source' as const),
              size: ports.bundle.size,
            },
          }),
    };
    if (entry.overlap) overlaps += 1;
  }
  return {
    edges,
    bends: Array.from({ length: bends.length }, (_, k) => bends[k] ?? 0),
    fallbacks,
    failed,
    squeezed,
    overlaps,
    fallbackIds,
  };
}
