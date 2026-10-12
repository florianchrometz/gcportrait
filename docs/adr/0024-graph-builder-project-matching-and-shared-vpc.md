<!-- SPDX-License-Identifier: MIT -->

# 0024. Graph builder: canonical project matching, Shared VPC evidence, reciprocal links, hiddenWhen under includeTypes

- **Status:** accepted (2026-10-10, as written)
- **Date:** 2026-10-09
- **Deciders:** Florian Chrometz (maintainer); accepted on the maintainer's behalf by the build orchestrator
  on 2026-10-10 under the standing instruction to make routine design calls. The maintainer may
  reopen it.
- **Related:** skill `gcp-asset-catalog` §5, `packages/graph/README.md`; [catalog follow-ups](../catalog-followups.md) §1.1, §1.4 and §1.5

## Context

Cloud Asset Inventory names some services' assets with the project id and others with the project number,
and references use whichever form the user or the API wrote, so exact name matching left references dangling
on real data (the largest source, by the catalog verifier's count). The Shared VPC derivation turned every
cross-project `attaches` edge into a `shares` pair, including producer networks peered into a project that is
no Shared VPC host. Reciprocal `connects` edges (a tunnel and its router naming each other) were drawn twice
or had to be dropped from one side. And `hiddenWhen` had no effect on a hidden type revealed through a view's
`includeTypes`.

## Decision

- **Canonical project matching.** Asset names are never rewritten. A reference that matches no node is tried
  once more with its first `projects/<ref>` segment swapped through the snapshot's project index (number → id
  or id → number); a match records the form it found (`RelationEdge.matchedProject: 'id' | 'number'`, counted
  in `GraphReport.counts.projectSwaps`). Exact matches win; a reference that matches neither way stays dangling
  with the value as read. Relations, `contains` names and `nestsIn` targets resolve the same way.
- **Shared VPC evidence.** A cross-project `attaches` edge is a Shared VPC attachment when it goes into a
  subnetwork of another project in the snapshot, or into a network of a project whose Compute settings
  (`compute.googleapis.com/Project`) say `xpnProjectStatus: HOST`; the builder marks such project nodes
  (`GraphNode.sharedVpcHost`). Other cross-project attachments (a producer network peered into a project that
  is not a host, a connector in another project) are drawn but are no Shared VPC. The scene's "shared with N"
  badge uses the same rule. Which types are subnets and networks is the catalog's `zoneKind`.
- **Reciprocal links.** Reciprocal `connects` edges fold into one, like `peers` (from the smaller id;
  `counts.connectsMerged`), so either side's rule may draw the link.
- **hiddenWhen under includeTypes.** A view's `includeTypes` reveals a hidden type's nodes but not those its
  `hiddenWhen` matches (destroyed secret versions, system-managed keys, finished jobs), which only a lens with
  `showHidden` draws; for a type visible by role, `includeTypes` still reveals its `hiddenWhen` matches, as
  before. The node carries `hiddenWhenMatched` so the views can tell.
- **Not implemented:** IP-match edges (a DNS record set's address matched to a forwarding rule). The addresses
  are indexed (`byIp`); the edge waits for a lens that needs it.

## Consequences

- The builder needs the project index (it had it) and one more structural type, the Compute project settings;
  `packages/graph/src/structure.ts` lists it with the others.
- A real export whose references spell projects the other way resolves without catalog changes; the demo
  writes the resolving form, so its dangling count did not move (49 on M), while the two private services
  access ranges of M now resolve through the swap.
- The graph model gains optional fields only (`matchedProject`, `sharedVpcHost`, `hiddenWhenMatched`, three
  counters); older graphs still parse.

## Alternatives considered

- **Index every node under both spellings.** Lost: it doubles the index for the minority of references that
  need it, and a second spelling of a name would look like a node id.
- **Rewrite references in the normalisers to the form the target type uses.** Lost: the normaliser would need
  to know every type's naming convention; the graph already knows which names exist.
- **A skip list of producer types for Shared VPC.** Lost: it grows with every managed service; the host flag
  and the subnet rule decide from data the snapshot already has.
