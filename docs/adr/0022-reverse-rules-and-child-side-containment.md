<!-- SPDX-License-Identifier: MIT -->

# 0022. Reverse relation rules and child-side containment in the catalog schema

- **Status:** accepted (2026-10-10, as written)
- **Date:** 2026-10-09
- **Deciders:** Florian Chrometz (maintainer); accepted on the maintainer's behalf by the build orchestrator
  on 2026-10-10 under the standing instruction to make routine design calls. The maintainer may
  reopen it.
- **Related:** skill `gcp-asset-catalog` §2 and §4, skill `gcp-diagram-layout` §2; ADRs [0015](0015-maintainability-catalog-as-data.md), [0020](0020-graph-depends-on-catalog.md); [catalog follow-ups](../catalog-followups.md) §1.2

## Context

A catalog relation rule reads a reference from the asset that holds it and draws the edge from that asset.
Some links are only written on the side the edge is not drawn from: a Cloud SQL replica names its
primary (`masterInstanceName`) while `replicates` is drawn primary → replica (catalog skill §4); a Cloud Armor policy lists
no targets while its backends name it; an address lists its `users`; a Private Service Connect service
attachment lists its consumer endpoints. Containment had the same gap: only a container's own data (`contains`
JSONPaths) or `byParent` could claim children, so an instance could not nest in its managed instance group, a
disk in its storage pool, a NetApp volume in its pool, an Oracle VM cluster in its Exadata infrastructure, an
Eventarc enrollment in its message bus or a fleet membership in its fleet, although each child names its
container. The first catalog groups worked around both with notes, subtitles and `uses` edges in the wrong direction.

## Decision

- **`reverse: true`** on a relation rule draws the edge from the referenced node to the asset that holds the
  reference (`{ kind: replicates, to: $.data.masterInstanceName, normalize: cloudSqlConnectionName, reverse:
  true }`). The engine marks the evaluated relation (`EvaluatedRelation.reverse`); the graph builder turns it
  around after resolving it. A dangling reverse reference stays with the asset that holds it. `weak` combines
  with `reverse`: the edge is a fallback that the target's own rule usually draws.
- **Copies of one edge merge.** Whoever draws an edge, one (from, kind, to) is one edge in the graph: a reverse
  rule and the target's own forward rule for the same link merge, strong when any copy is strong.
- **`nestsIn`** on a type entry (one rule or a list) names the container the asset nests in:
  `{ to, normalize, service?, pattern?, k8sKind?, kind? }`. The graph builder tries it in tier 1 of
  containment, after the containers' own declarations and before the attachment heuristics; the target must be
  a node whose role is `container`, in the same project, and not close a cycle (layout skill §2, rules 2 and 5,
  still apply). `kind` is the relation drawn instead whenever the asset does not nest in that target (another
  project's shared pool, a target that is not a container, a missing target, which then dangles); without
  `kind`, a reference it cannot nest in draws nothing. The `kind` edge is never drawn to the container the
  asset does nest in: the nesting shows it, so a rule that used to draw that link as an edge moves into
  `nestsIn` instead of staying beside it.
- The schema additions are additive (`RelationRuleSchema.reverse`, `NestsInRuleSchema`,
  `CatalogTypeEntrySchema.nestsIn`, `EvaluatedRelationSchema.reverse`, `EvaluatedNestingSchema` in
  `@gcportrait/model`), and the compiler proves `nestsIn` rules against fixtures like relation rules.

## Consequences

- Applied on 2026-10-09: Cloud SQL replication, address users, PSC consumer endpoints and Cloud Armor (`secures`
  from the policy, replacing the backends' `uses` edges) as reverse rules; the fleet membership's
  `endpoint.*.resourceLink` restored as a weak reverse rule; instance groups, node groups, Compute and NetApp
  storage pools, Exadata infrastructure, message buses and fleets became containers that their children's
  `nestsIn` rules fill.
- Role counts moved (69 containers, 258 core, 71 leaf, 234 hidden on 2026-10-09) and the graph's pinned
  composition rows changed where a lens now draws a new kind or a new zone; each change carries its reason.
- A reverse rule is still read from one asset at a time, so the graph builder stays one pass over the assets
  with one merge step; nothing in the engine needs the other asset's data.

## Alternatives considered

- **A builder-side list of "back-references".** Lost: a second map in code (agents.md rule 4).
- **`contains` rules that search other assets' data.** Lost: a container would have to scan every asset of the
  snapshot per rule; the child already holds the reference, so the rule belongs on the child.
- **Drawing `nestsIn` references as edges too.** Lost: an arrow from a card to the zone that encloses it says
  nothing the nesting does not; `kind` keeps the link where nesting is refused.
