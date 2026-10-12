<!-- SPDX-License-Identifier: MIT -->

# 0011. Desktop only

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** [ADR 0035](0035-decisions-inherited-from-the-implementation-plan.md) §1

## Context

Architecture diagrams of real organisations are dense: nested zones, hundreds of cards and many arrows. They
are read and exported on large screens. Supporting phones and tablets would cost design, layout and test
effort in every part of the app.

## Decision

gcportrait targets desktop browsers only, with a minimum viewport of 1280×800. There is no mobile or tablet
work.

## Consequences

- No responsive breakpoints for phones or tablets (agents.md hard rule 7); reviewers reject them.
- The e2e suite runs at a desktop viewport (1440×900 today).
- Mobile layouts are listed as a non-goal for version 1 (ADR 0035 §1).
