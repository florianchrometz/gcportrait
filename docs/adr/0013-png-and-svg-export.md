<!-- SPDX-License-Identifier: MIT -->

# 0013. PNG and SVG export of the current view

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** skill `gcp-diagram-style` §7 and §8, [ADR 0018](0018-non-affiliation-statement.md), [ADR 0033](0033-render-api.md), [docs/export.md](../export.md)

## Context

The main reason to draw an environment is to put the picture somewhere else: a design document, a review, a
ticket. A diagram that can only be looked at in the app is half a product.

## Decision

Exporting the current view as PNG and as SVG is a version 1 must-have.

## Consequences

- The legend and the title block (scope, lens, `readTime`) are part of the SVG, so an export carries them
  (style skill §7). Anything that must appear in an export is never an HTML overlay.
- SVG export resolves every CSS variable to an attribute and keeps the icons inline; PNG export rasterises at
  2× (3× on request) on the theme background. Whole diagram or current viewport, light or dark, and clipboard
  copy for PNG.
- The export title block was first meant to carry the short non-affiliation statement; since ADR 0018's
  placement amendment of 2026-10-11 no drawing carries it, neither in the title block nor in the SVG's
  `<desc>`, and the export tests assert that it is absent.
- A headless render command (`pnpm render`) produces the same output for tests, screenshots and agents'
  self-checks; the app's Export menu offers both formats.
