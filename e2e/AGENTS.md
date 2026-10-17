<!-- SPDX-License-Identifier: MIT -->

# AGENTS.md: end-to-end tests

These rules add to the root AGENTS.md, which applies here too.

## What the suite runs against

The e2e suite runs against `pnpm dev:demo` locally and against a build of the same demo mode on CI.
The shared demo contract follows [AGENTS.md](../AGENTS.md), "Product rules"; [README.md](README.md)
describes the servers and the live-mode specs' stand-ins.

## Widths, gestures and axe

- The functional specs run at 1440 × 900, `e2e/tests/touch.spec.ts` uses the canvas by finger at a phone's
  size and `e2e/tests/handheld.spec.ts` the app's flows by finger at a phone's and a tablet's (the
  `chromium-phone` and `chromium-tablet` projects).
- The suite runs axe in both themes, at the desktop's size and at the phone's and the tablet's
  (`pnpm --filter @gcportrait/frontend mobile`). The shared accessibility contract follows
  [AGENTS.md](../AGENTS.md), "Style and accessibility".

The app's layout and export contracts follow [frontend/AGENTS.md](../frontend/AGENTS.md), "Phones, tablets
and desktops" and "Exports"; the gcp-diagram-style skill (§8, §13) holds the export limits and accessibility
checks.

## CI legs

Each e2e leg is a round-robin share of its projects' tests, every k-th of their listing, run by `--test-list`
(`pnpm --filter @gcportrait/e2e leg`), so that the slow files spread over the legs instead of landing in
one; it fails when its run misses a test of its share. The workflow's jobs follow
[.github/AGENTS.md](../.github/AGENTS.md), "CI".

## Commands

| Goal | Command |
|---|---|
| One of CI's e2e legs: every K-th test of the projects' listing from the I-th, run by `--test-list`, failing when the run misses one, with the share's count and summed test time (CI legs) / the share alone, as a test list | `CI=true pnpm --filter @gcportrait/e2e leg --projects "chromium-live chromium" --leg 2 --of 3` (`--projects '!chromium-live !chromium'` for every other project, `-- ARGS` for Playwright) / `... --list-only` |
| Check the draw.io export against the SVG export (maxGraph in Chromium, demos S, M and L in both themes; the limits in the gcp-diagram-style skill §8) | `pnpm e2e tests/drawio.spec.ts --project chromium` |
