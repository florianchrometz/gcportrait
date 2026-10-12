<!-- SPDX-License-Identifier: MIT -->

# 0012. Light and dark themes, WCAG 2.2 AA, Google colour semantics

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** skill `gcp-diagram-style` (§2 palettes, §10 contrast, §13 accessibility), [ADR 0019](0019-font-licence-exception.md)

## Context

Users work in both light and dark environments, and exported diagrams end up in both kinds of documents. The
diagrams follow Google Cloud architecture-diagram conventions, where a zone's tint says what kind of container
it is. Some of those conventional colours do not reach WCAG contrast thresholds as they are.

## Decision

The app and the diagrams come in light and dark themes (following the system setting, with a manual override).
Readability and contrast meet WCAG 2.2 AA. Where Google's architecture-diagram conventions and WCAG conflict,
the colour *semantics* of the conventions win (what a tint means) and the *values* are adjusted until contrast
passes.

## Consequences

- `.agents/skills/gcp-diagram-style/SKILL.md` holds both palettes, the app chrome tokens, the contrast pairs
  and thresholds, and the one documented exception (the subnet and VPC zone strokes are decorative; the title
  text and card strokes inside them must pass instead).
- The app chrome tokens are in `frontend/src/styles/tokens.css` in both themes. The theme preference
  (`system`, `light` or `dark`) is stored in IndexedDB and applied before first paint.
- The e2e suite runs axe in both themes. Automated contrast tests cover every diagram palette pair
  (`frontend/src/diagram/theme/theme.test.ts`, since the renderer was built on 2026-10-09).
- A visual change is done only when it looks right and passes the checks in both themes (agents.md hard
  rule 8).
- Colour never carries meaning alone: edge kinds differ by dash or arrowhead, zone kinds by title position or
  badge.
