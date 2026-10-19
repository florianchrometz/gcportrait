// SPDX-License-Identifier: Apache-2.0
/**
 * @gcportrait/catalog — the asset catalog as data, and the one rule engine that reads it (packages/AGENTS.md, Catalog and
 * graph semantics; skill gcp-asset-catalog). The graph builder (`@gcportrait/graph`) evaluates relations,
 * labels, addresses and visibility through these functions, so rule semantics live in this package only. This
 * file is the package's only public surface; everything here runs in the browser, in workers and in Node.
 */
export { catalog } from './catalog.js';

export {
  evaluateAliases,
  evaluateContains,
  evaluateNestsIn,
  evaluateRelations,
  extractDomains,
  extractIps,
  hiddenWhenMatches,
  isHiddenByDefault,
  matchesTypePattern,
  nestsByParent,
  renderConsoleUrl,
  renderLabel,
  renderSubtitle,
  serviceOf,
  templateScope,
  toDomain,
  toIp,
  type ContainedChildren,
  type RuleContext,
} from './engine/rules.js';

export {
  CONSOLE_ORIGIN,
  consoleLinkFor,
  consoleUrlFor,
  projectConsoleUrl,
  typesWithoutConsole,
  type ConsoleLink,
} from './engine/console.js';

export {
  NORMALISERS,
  kubernetesPlural,
  normalise,
  type Normaliser,
  type NormaliserContext,
} from './engine/normalisers.js';

// The project index itself is built by `buildProjectIndex` of @gcportrait/model (one rule for ingest, the
// rule engine and the graph builder); these answer which project an asset is in.
export { EMPTY_PROJECT_INDEX, assetProject, resolveProject, type ProjectRef } from './engine/project.js';

export { evaluateJsonPath, parseJsonPath, type JsonPath, type PathStep } from './engine/jsonpath.js';
export { evaluatePredicate, parsePredicate, type Predicate } from './engine/predicate.js';
export {
  parseTemplate,
  renderDisplay,
  renderTemplate,
  type Rendered,
  type Template,
  type TemplateScope,
} from './engine/template.js';
export { CatalogSyntaxError } from './engine/syntax.js';

// The coverage data `pnpm catalog:build` writes into dist/coverage.json for the website (`catalogCoverage`), and
// its shape, which the site's coverage page and landing page read as a type only (tooling/build.ts).
export {
  catalogCoverage,
  type CatalogCoverage,
  type CatalogCoverageGroup,
  type CatalogCoverageUnmapped,
} from './compiler/coverage-file.js';
