<!-- SPDX-License-Identifier: MIT -->

# 0006. Clean-room layout engine: nested-zone grid packing and gutter routing

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** skill `gcp-diagram-layout`; ADRs [0025](0025-layout-packing-rules.md), [0026](0026-stacks-and-near-ties-in-packing.md), [0027](0027-gutter-routing-rules-beyond-skill-5.md)

## Context

knoyog proved out a look the maintainer wants to keep: zones nested by containment and packed into tidy grids,
fixed-size resource cards, and orthogonal arrows routed through the gaps between boxes, never across a card,
with spacing that grows with the number of arrows sharing a gap. Arrows regularly cross zone boundaries
(for example a load balancer in one project pointing at a backend in another), and the result must be fast
and deterministic.

## Decision

`packages/layout` is a clean-room, pure TypeScript implementation of nested-zone grid packing plus orthogonal
gutter routing, as a standalone package. It is not built on ELK, Graphviz or Cytoscape. It shares no code with
the previous implementation (ADR 0001); `.agents/skills/gcp-diagram-layout/SKILL.md` is its specification.

## Consequences

- The engine is pure, synchronous and deterministic: no DOM measurement (text widths come from a generated
  font metrics table) and no randomness; it runs in a web worker.
- Invariants (no card overlap, children inside their parent's padding, no edge through a card or a zone
  header, byte-identical output across runs) are asserted in development and in tests, with golden layouts per
  demo fixture and lens and fast-check property tests.
- Performance budgets per fixture size (S < 10 ms, M < 60 ms, L < 400 ms, XL < 2 s) are enforced in CI
  (gcp-diagram-layout skill §7).
- Layout quality was the project's main risk when this was decided; an early visual review on the M fixture,
  after the routing stage, was planned for it.
- Delivered on 2026-10-09 and 2026-10-10 (`packages/layout` and its README).

## Alternatives considered

- **ELK, Graphviz or Cytoscape.js.** Rejected: none of them produces this result for edges that cross zone
  boundaries, and routing through a text format such as DOT and parsing it back is lossy (ADR 0035 §3).
