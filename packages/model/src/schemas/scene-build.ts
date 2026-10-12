// SPDX-License-Identifier: MIT
/**
 * What the scene builder (`@gcportrait/graph`; docs/packages.md, docs/lenses-and-filters.md) reads next to the
 * Graph and the ViewSpec, and what it reports next to the Scene it builds. The Scene itself stays the layout's
 * input (`scene.ts`); the report carries what the UI needs around it: the drill-in root and focus actually used
 * (or why a requested one was refused: never a throw), the detail level `auto` chose and the rect counts behind
 * the choice, the legend rows (skill gcp-diagram-style §7), overlay zones, where the selection and highlight
 * are shown, unknown flips, warnings and counters. Plain records only, so it crosses worker boundaries and JSON
 * unchanged.
 */
import { z } from 'zod';
import { NodeIdSchema } from './graph.js';
import { DetailLevelSchema } from './lens.js';
import { CountSchema, NonEmptyStringSchema, TextSchema, TimestampSchema } from './primitives.js';
import { RelationKindSchema } from './relation.js';
import {
  FocusErrorSchema,
  RootErrorSchema,
  SceneSchema,
  ZoneKindSchema,
  type Scene,
  type SceneNode,
} from './scene.js';
import { FlipIdSchema, FocusKindSchema } from './view-spec.js';

/** What the caller knows that the Graph and the ViewSpec do not. */
export const SceneEnvSchema = z.strictObject({
  /** The read time of the data on screen (RFC 3339), copied into the scene's metadata. */
  readTime: TimestampSchema,
  /**
   * The rect budget of detail level `auto`: the caller computes it from the viewport (skill gcp-diagram-layout
   * §6, `viewport px² / 14000` clamped to 24–250). Absent: the budget of the smallest supported viewport.
   */
  viewportBudget: z.int().min(1).exactOptional(),
  /** The canvas title when no organisation node and no drill-in root names it, e.g. the snapshot scope's name. */
  rootLabel: NonEmptyStringSchema.exactOptional(),
  /** The user's setting for virtual region zones, used when the view's `filters.showRegions` is absent. */
  showRegions: z.boolean().exactOptional(),
});
export type SceneEnv = z.infer<typeof SceneEnvSchema>;

/** The drill-in root (the ViewSpec's `root`): the one used, or why the requested one was refused. */
export const SceneRootSchema = z
  .strictObject({
    /** The `root` of the ViewSpec, when it had one. */
    requested: TextSchema.exactOptional(),
    /** The container the view is rooted at; absent: the organisation (the canvas). */
    used: NodeIdSchema.exactOptional(),
    /** Why `requested` was refused; the view then falls back to the organisation. */
    error: RootErrorSchema.exactOptional(),
  })
  .superRefine((root, ctx) => {
    if (root.error !== undefined && (root.requested === undefined || root.used !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'a refused root names the request and uses the organisation',
      });
    }
  });
export type SceneRoot = z.infer<typeof SceneRootSchema>;

/** The focus view (docs/lenses-and-filters.md) as applied, or the error that kept it from being applied. */
export const SceneFocusSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('applied'),
    kind: FocusKindSchema,
    /** The node the parameters named: the project, Shared VPC host, perimeter or application. */
    anchor: NodeIdSchema.exactOptional(),
    /** The projects the focus selected, sorted. */
    projects: z.array(NodeIdSchema),
  }),
  z.strictObject({ status: z.literal('error'), kind: FocusKindSchema, error: FocusErrorSchema }),
]);
export type SceneFocus = z.infer<typeof SceneFocusSchema>;

/** A detail level other than `auto`. */
export const ConcreteDetailLevelSchema = DetailLevelSchema.exclude(['auto']);
export type ConcreteDetailLevel = z.infer<typeof ConcreteDetailLevelSchema>;

/** The detail level (skill gcp-diagram-layout §6) asked for, the one used, and the rect count of the view at every level. */
export const SceneDetailSchema = z.strictObject({
  requested: DetailLevelSchema,
  used: ConcreteDetailLevelSchema,
  /** The rect budget `auto` compared against. */
  budget: z.int().min(1),
  /**
   * The deepest level `auto` opens the view's lens at (its `defaultDetail`, `all` for a lens that opens at
   * `auto`): `auto` never opens deeper; an explicit level may.
   */
  ceiling: ConcreteDetailLevelSchema,
  /** Zones and cards at each level without flips (a chip counts once): "N of M shown". */
  rectCounts: z.strictObject({
    folders: CountSchema,
    projects: CountSchema,
    networks: CountSchema,
    all: CountSchema,
  }),
});
export type SceneDetail = z.infer<typeof SceneDetailSchema>;

/** The legend's rows (skill gcp-diagram-style §7): only what is on screen. */
export const SceneLegendSchema = z.strictObject({
  /** Zone kinds in the scene, in `ZoneKindSchema` order. */
  zoneKinds: z.array(ZoneKindSchema),
  /** Edge kinds in the scene, in `RelationKindSchema` order. */
  edgeKinds: z.array(RelationKindSchema),
  /** Some zone is drawn as a chip. */
  collapsed: z.boolean(),
  /** Some node is an external stub (a focus project's edges leaving it). */
  external: z.boolean(),
  /** Some zone is an overlay (a perimeter around its projects). */
  overlay: z.boolean(),
});
export type SceneLegend = z.infer<typeof SceneLegendSchema>;

/** A zone the renderer draws as an overlay rather than a tinted container: a perimeter around its projects. */
export const SceneOverlaySchema = z.strictObject({
  zone: NonEmptyStringSchema,
  kind: z.literal('secures'),
});
export type SceneOverlay = z.infer<typeof SceneOverlaySchema>;

/** The view's selection or highlight, passed through, and where the scene shows it. */
export const ScenePointerSchema = z.strictObject({
  /** The ViewSpec's value: a node id, or (highlight) search text. */
  value: TextSchema,
  /** The graph node the value names, when it names one. */
  node: NodeIdSchema.exactOptional(),
  /** The scene node that shows it: the node itself, or the chip it is collapsed into. */
  shownAs: NonEmptyStringSchema.exactOptional(),
});
export type ScenePointer = z.infer<typeof ScenePointerSchema>;

export const SceneCountsSchema = z.strictObject({
  /** Graph nodes below the root (or the organisation). */
  universe: CountSchema,
  /** Of those, the nodes the focus selected (all of them without a focus). */
  focus: CountSchema,
  /** Nodes the view shows, inside chips included; external stubs excluded. */
  visible: CountSchema,
  /** External stubs: targets of a focus project's edges leaving it. */
  stubs: CountSchema,
  /** Hidden-by-default nodes the lens would show, held back and counted in their zone's "N hidden" badge. */
  held: CountSchema,
  /** Zones and cards in the scene; a chip is a zone. */
  zones: CountSchema,
  cards: CountSchema,
  /** Collapsed zones. */
  chips: CountSchema,
  /** Synthetic `group` zones bundling a large flat set. */
  bundles: CountSchema,
  /** Scene edges, and the relations they stand for (an edge's `count`, else 1). */
  edges: CountSchema,
  relations: CountSchema,
  /** Dangling references of the visible nodes (counted, never drawn). */
  dangling: CountSchema,
});
export type SceneCounts = z.infer<typeof SceneCountsSchema>;

export const SceneReportSchema = z.strictObject({
  root: SceneRootSchema,
  /** Present when the ViewSpec has a focus. */
  focus: SceneFocusSchema.exactOptional(),
  detail: SceneDetailSchema,
  legend: SceneLegendSchema,
  overlays: z.array(SceneOverlaySchema),
  /**
   * Scene nodes that are external stubs of a project focus (the targets of its edges leaving it) and the
   * project zones that group them, sorted; the renderer marks them as outside the view.
   */
  external: z.array(NonEmptyStringSchema),
  selection: ScenePointerSchema.exactOptional(),
  highlight: ScenePointerSchema.exactOptional(),
  /** Flips that match no zone of this scene (stale ids, or zones the view does not show). */
  unknownFlips: z.array(FlipIdSchema),
  /** Human-readable notes: a refused root or focus, a focus that selected nothing, unknown flips. */
  warnings: z.array(NonEmptyStringSchema),
  counts: SceneCountsSchema,
});
export type SceneReport = z.infer<typeof SceneReportSchema>;

type Issue = { path: PropertyKey[]; message: string };

interface SceneFacts {
  readonly ids: Set<string>;
  readonly zoneIds: Set<string>;
  readonly zoneKinds: Set<string>;
  readonly zones: number;
  readonly cards: number;
  readonly chips: number;
  readonly bundles: number;
}

function sceneFacts(scene: Scene): SceneFacts {
  const facts = {
    ids: new Set<string>(),
    zoneIds: new Set<string>(),
    zoneKinds: new Set<string>(),
    zones: 0,
    cards: 0,
    chips: 0,
    bundles: 0,
  };
  const visit = (nodes: readonly SceneNode[]): void => {
    for (const node of nodes) {
      facts.ids.add(node.id);
      if (node.type === 'card') {
        facts.cards += 1;
        continue;
      }
      facts.zones += 1;
      facts.zoneIds.add(node.id);
      facts.zoneKinds.add(node.kind);
      if (node.collapsed !== undefined) facts.chips += 1;
      if (node.kind === 'group') facts.bundles += 1;
      visit(node.children);
    }
  };
  visit(scene.children);
  return facts;
}

function sameList(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

/** Every place where a report disagrees with the scene it describes. */
function sceneBuildIssues(scene: Scene, report: SceneReport): Issue[] {
  const issues: Issue[] = [];
  const facts = sceneFacts(scene);
  const at = (path: PropertyKey[], message: string): void => {
    issues.push({ path: ['report', ...path], message });
  };

  const zoneKinds = ZoneKindSchema.options.filter((kind) => facts.zoneKinds.has(kind));
  if (!sameList(report.legend.zoneKinds, zoneKinds)) {
    at(['legend', 'zoneKinds'], `must list the zone kinds in the scene: ${zoneKinds.join(', ')}`);
  }
  const edgeKindsPresent = new Set<string>(scene.edges.map((edge) => edge.kind));
  const edgeKinds = RelationKindSchema.options.filter((kind) => edgeKindsPresent.has(kind));
  if (!sameList(report.legend.edgeKinds, edgeKinds)) {
    at(['legend', 'edgeKinds'], `must list the edge kinds in the scene: ${edgeKinds.join(', ')}`);
  }
  if (report.legend.collapsed !== facts.chips > 0) {
    at(['legend', 'collapsed'], 'must say whether the scene has a chip');
  }
  if (report.legend.external !== report.external.length > 0) {
    at(['legend', 'external'], 'must say whether the scene has external stubs');
  }
  report.external.forEach((id, index) => {
    if (!facts.ids.has(id)) at(['external', index], 'must name a node of the scene');
  });
  if (report.legend.overlay !== report.overlays.length > 0) {
    at(['legend', 'overlay'], 'must say whether the scene has an overlay');
  }
  report.overlays.forEach((overlay, index) => {
    if (!facts.zoneIds.has(overlay.zone)) at(['overlays', index, 'zone'], 'must name a zone of the scene');
  });
  for (const key of ['selection', 'highlight'] as const) {
    const shownAs = report[key]?.shownAs;
    if (shownAs !== undefined && !facts.ids.has(shownAs)) {
      at([key, 'shownAs'], 'must name a node of the scene');
    }
  }

  const counted: [keyof SceneCounts, number][] = [
    ['zones', facts.zones],
    ['cards', facts.cards],
    ['chips', facts.chips],
    ['bundles', facts.bundles],
    ['edges', scene.edges.length],
    ['relations', scene.edges.reduce((sum, edge) => sum + (edge.count ?? 1), 0)],
  ];
  for (const [key, value] of counted) {
    if (report.counts[key] !== value) at(['counts', key], `must be ${String(value)}`);
  }
  if (report.counts.focus > report.counts.universe) {
    at(['counts', 'focus'], 'cannot exceed the universe');
  }
  return issues;
}

/** A scene with its report; the two must agree (legend, overlays, pointers, counts). */
export const SceneBuildSchema = z
  .strictObject({ scene: SceneSchema, report: SceneReportSchema })
  .superRefine((build, ctx) => {
    for (const issue of sceneBuildIssues(build.scene, build.report))
      ctx.addIssue({ code: 'custom', ...issue });
  });
export type SceneBuild = z.infer<typeof SceneBuildSchema>;
