<!-- SPDX-License-Identifier: MIT -->

# 0023. Sibling and Kubernetes reference normalisers, display templates and the hiddenWhen proof

- **Status:** accepted (2026-10-10, as written)
- **Date:** 2026-10-09
- **Deciders:** Florian Chrometz (maintainer); accepted on the maintainer's behalf by the build orchestrator
  on 2026-10-10 under the standing instruction to make routine design calls. The maintainer may
  reopen it.
- **Related:** skill `gcp-asset-catalog` §2 and §5; ADR [0015](0015-maintainability-catalog-as-data.md); [catalog follow-ups](../catalog-followups.md) §1.3 and §1.4

## Context

Many references are not resource names. Cloud Deploy stages, Discovery Engine engines, serverless network
endpoint groups, Eventarc destinations, Cloud Run domain mappings, Dataproc jobs, Serverless VPC Access
connectors and private services access connections name their targets by a bare id, or by an object of id,
region and project, that only makes a name together with the referencing asset's own project and location.
Kubernetes objects name each other by bare name in their namespace (`spec.nodeName`, `volumeName`, Ingress
backends) or by `{ group, kind, name, namespace }` without an `apiVersion` (`claimRef`, Gateway API refs,
`roleRef`), which `k8sOwner` cannot read. Subtitles kept unit words when their count was missing, union-shaped
resources could not name the variant they hold, and `hiddenWhen` predicates were never proven.

## Decision

- **`siblingName`** fills the rule's required `pattern`, a relative name of literal segments and placeholders
  (`{parent}/targets/{id}`, `projects/{project}/locations/{region}/services/{.service}`), and puts it in the
  rule's `service` (default: the asset's). A placeholder takes its value from the reference first (an object's
  `name`, `project`/`projectId`, `location`/`region`/`zone` keys, any key as `{.key}`; a path value's own
  `projects/`, `locations/`, `regions/` and `zones/` segments, its last segment as `{id}` and what is above its
  last collection as `{parent}`), then from the asset (its name's project segment, else its project; its
  location; its own parent path). `{projectId}` and `{projectNumber}` translate through the project index;
  `{region}` turns a zone into its region. A missing placeholder value yields no name (the value dangles).
- **`k8sRef`** turns a bare name of the rule's `k8sKind` (`Node`, `gateway.networking.k8s.io/Gateway`), or an
  object `{ name, kind?, group? | apiGroup? | apiVersion?, namespace? }`, into the object's name in the asset's
  cluster: the object's kind, else the rule's; its group, else its `apiVersion`'s, else the rule's when the
  kinds agree, else the core group; its namespace, else the asset's; none for cluster-scoped kinds. Built-in
  API groups are one path segment and other groups sit behind `apis/` (`…/apis/gateway.networking.k8s.io/
  httproutes/r`), as the asset-name format page lists them; `k8sOwner` follows the same rule.
- **Templates.** Labels and subtitles drop every ` · ` segment whose expressions are all missing, with its
  literal text (no `suffix()` filter: every existing template benefits without edits). `first(variable, …)`
  stands in the first present variable when the value is missing; filters after it apply to the chosen value.
  Console links still drop entirely when a variable is missing.
- **`catalog:check` proves `hiddenWhen`:** every predicate needs a fixture it matches and one it does not
  (`hidden-unproven`), so an always-true predicate is no way to hide a container; the type takes role `hidden`.

## Consequences

- These rules replaced the workarounds the follow-ups list (subtitles standing in for edges, `leaf` roles of objects
  that are referenced) with rules; Kubernetes nodes, services, persistent volume claims, Ingresses, Gateways,
  HTTP routes and Cloud Run domain mappings are `core` now.
- The normaliser table grows to fifteen; the skill's §5 and the catalog README document the resolution rules.
- A sibling target in another project form (an id where the target's name has the number) resolves through the
  graph's canonical matching (ADR [0024](0024-graph-builder-project-matching-and-shared-vpc.md)), so patterns never choose a
  project spelling.

## Alternatives considered

- **One normaliser per service (`serverlessNeg`, `deployTarget`, …).** Lost: a dozen near-identical functions;
  the pattern keeps the knowledge in YAML.
- **A `suffix('…')` filter for unit words.** Lost: every affected template would need editing, and a missing
  count still left its separator behind.
- **Letting each template variable be proven on a different fixture.** Lost: the check would no longer show
  that a template renders whole on any asset; `first()` covers the union shapes it was meant for.
