// SPDX-License-Identifier: MIT
/**
 * @gcportrait/model — the single definition of every shared type (AGENTS.md, Data and graph semantics). Types
 * are inferred from the zod schemas; this file is the package's only public surface. The values the app's UI
 * thread uses (the URL-hash codec, the vocabularies, the relation table) come from modules that import no
 * zod, so a bundler that keeps only what is imported leaves the schema library out of that thread (AGENTS.md,
 * Architecture and code).
 */
export {
  AssetTypePatternSchema,
  AssetTypeSchema,
  CountSchema,
  DateSchema,
  DomainSchema,
  IconKeySchema,
  IpSchema,
  LocationSchema,
  NonEmptyStringSchema,
  NumericIdSchema,
  ProjectRefSchema,
  ResourceNameSchema,
  ServiceNameSchema,
  TextSchema,
  TimestampSchema,
  UlidSchema,
} from './schemas/primitives.js';

export { AncestorSchema, AssetSchema, type Asset } from './schemas/asset.js';

export {
  SNAPSHOT_SCHEMA_VERSION,
  ScopeKindSchema,
  SnapshotFormatError,
  SnapshotReadTimeSourceSchema,
  SnapshotSchema,
  SnapshotScopeSchema,
  SnapshotSourceKindSchema,
  SnapshotSourceSchema,
  SnapshotStatsSchema,
  migrateSnapshot,
  type ScopeKind,
  type Snapshot,
  type SnapshotFormatProblem,
  type SnapshotReadTimeSource,
  type SnapshotScope,
  type SnapshotSource,
  type SnapshotSourceKind,
  type SnapshotStats,
} from './schemas/snapshot.js';

export { DetailLevelSchema, LensIdSchema, type DetailLevel, type LensId } from './schemas/lens.js';

export {
  EdgeStyleIdSchema,
  RelationKindInfoSchema,
  RelationKindSchema,
  type EdgeStyleId,
  type RelationKind,
  type RelationKindInfo,
} from './schemas/relation.js';

export {
  ContainmentSchema,
  DanglingTargetSchema,
  GraphIndexesSchema,
  GraphNodeSchema,
  GraphSchema,
  NodeIdSchema,
  NodeRoleSchema,
  RelationEdgeSchema,
  type Containment,
  type DanglingTarget,
  type Graph,
  type GraphIndexes,
  type GraphNode,
  type NodeRole,
  type RelationEdge,
} from './schemas/graph.js';

export { DiffSchema, TickSchema, type Diff, type Tick } from './schemas/timeline.js';

export {
  DemoSizeSchema,
  DepthSchema,
  FlipIdSchema,
  FocusKindSchema,
  FocusParamNameSchema,
  FocusSchema,
  SnapshotRefSchema,
  ViewFiltersSchema,
  ViewSpecSchema,
  type DemoSize,
  type Focus,
  type FocusKind,
  type LooseViewSpec,
  type SnapshotRef,
  type ViewFilters,
  type ViewSpec,
  type ViewSpecInput,
} from './schemas/view-spec.js';
export {
  RENDER_DEFAULT_SCALE,
  RENDER_DEFAULT_VIEWPORT,
  RENDER_MAX_HASH_LENGTH,
  RENDER_MAX_SCALE,
  RENDER_MAX_SIDE,
  RenderFormatSchema,
  RenderOptionsObjectSchema,
  RenderOptionsSchema,
  RenderThemeSchema,
  RenderViewSchema,
  RenderViewportSchema,
  checkRenderOptions,
  renderTooManyAssetsMessage,
  type RenderFormat,
  type RenderOptions,
  type RenderOptionsInput,
  type RenderTheme,
  type RenderView,
  type RenderViewport,
} from './schemas/render.js';

export {
  ChipCountKindSchema,
  ChipCountsSchema,
  FocusErrorCodeSchema,
  FocusErrorSchema,
  RootErrorCodeSchema,
  RootErrorSchema,
  SceneCardSchema,
  SceneEdgeSchema,
  SceneMetadataSchema,
  SceneNodeSchema,
  SceneSchema,
  SceneZoneSchema,
  ZoneKindSchema,
  type ChipCountKind,
  type ChipCounts,
  type FocusError,
  type FocusErrorCode,
  type RootError,
  type RootErrorCode,
  type Scene,
  type SceneCard,
  type SceneEdge,
  type SceneMetadata,
  type SceneNode,
  type SceneZone,
  type ZoneKind,
} from './schemas/scene.js';

export {
  CatalogEntrySchema,
  CatalogProductSchema,
  CatalogRelationKindSchema,
  CatalogSchema,
  CatalogTypeEntrySchema,
  CatalogTypeSchema,
  CatalogZoneKindSchema,
  ContainsRuleSchema,
  DEFAULT_LABEL_TEMPLATE,
  JsonPathSchema,
  KubernetesKindSchema,
  LensSchema,
  NestsInRuleSchema,
  NormaliserNameSchema,
  PredicateSchema,
  RelationRuleSchema,
  SIBLING_PATTERN_PLACEHOLDERS,
  SiblingPatternSchema,
  TEMPLATE_FILTERS,
  TEMPLATE_VARIABLES,
  TemplateSchema,
  type Catalog,
  type CatalogEntry,
  type CatalogProduct,
  type CatalogRelationKind,
  type CatalogType,
  type CatalogTypeEntry,
  type CatalogZoneKind,
  type ContainsRule,
  type Lens,
  type NestsInRule,
  type NormaliserName,
  type RelationRule,
} from './schemas/catalog.js';

export { decodeViewSpec, encodeViewSpec } from './codec/view-hash.js';

// Zod-free values: what the app's UI thread may import without bundling the schema library.
export {
  DEFAULT_VIEW_SPEC,
  VIEW_SPEC_MAX_DEPTH,
  VIEW_SPEC_MAX_FLIPS,
  normalizeViewSpec,
} from './codec/normalize.js';
export {
  DEMO_REF_PREFIX,
  DEMO_SIZES,
  DETAIL_LEVEL_IDS,
  FOCUS_KIND_IDS,
  LARGE_SNAPSHOT_ASSETS,
  LENS_IDS,
  RELATION_KIND_IDS,
  isDemoSize,
  isDetailLevel,
  isFocusKind,
  isLensId,
  isRelationKind,
  isSnapshotRef,
} from './schemas/vocabulary.js';
export { RELATION_KINDS } from './schemas/relation-kinds.js';
export { isRegion, isZone, regionOfZone, zoneRegion } from './schemas/locations.js';
export { LOCATION_PATTERN } from './schemas/patterns.js';
export {
  COMMAND_VARIABLES,
  VARIABLE_NAME_PATTERN,
  commandVariable,
  isCommandVariableValue,
  splitVariableTokens,
  variableTokens,
  type CommandTextPart,
  type CommandVariableName,
} from './schemas/command-variables.js';
// The registry's row schema (zod) and its type; the registry above is the zod-free data.
export { CommandVariableSchema, type CommandVariable } from './schemas/command-variable.js';

export {
  AliasKeySchema,
  EvaluatedNestingSchema,
  EvaluatedRelationSchema,
  ProjectIndexSchema,
  RelationTargetSchema,
  aliasKey,
  buildProjectIndex,
  projectIndexBuilder,
  projectPairOf,
  type EvaluatedNesting,
  type EvaluatedRelation,
  type ProjectIndex,
  type ProjectIndexBuilder,
  type ProjectPair,
  type RelationTarget,
} from './schemas/rules.js';

export {
  ContainmentCycleSchema,
  GraphBuildCountsSchema,
  GraphBuildSchema,
  GraphReportSchema,
  SharedVpcAttachmentSchema,
  SharedVpcPairSchema,
  type ContainmentCycle,
  type GraphBuild,
  type GraphBuildCounts,
  type GraphReport,
  type SharedVpcAttachment,
  type SharedVpcPair,
} from './schemas/graph-build.js';

export {
  ConcreteDetailLevelSchema,
  SceneBuildSchema,
  SceneCountsSchema,
  SceneDetailSchema,
  SceneEnvSchema,
  SceneFocusSchema,
  SceneLegendSchema,
  SceneOverlaySchema,
  ScenePointerSchema,
  SceneReportSchema,
  SceneRootSchema,
  type ConcreteDetailLevel,
  type SceneBuild,
  type SceneCounts,
  type SceneDetail,
  type SceneEnv,
  type SceneFocus,
  type SceneLegend,
  type SceneOverlay,
  type ScenePointer,
  type SceneReport,
  type SceneRoot,
} from './schemas/scene-build.js';

export { ZONE_KIND_RANK } from './schemas/zone-order.js';
