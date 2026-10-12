<!-- SPDX-License-Identifier: MIT -->

# 0019. Accept OFL-1.1 for the two self-hosted Roboto font packages

- **Status:** accepted (applied on 2026-10-08; confirmed on 2026-10-10 with the licence decision of ADR 0017, and
  on 2026-10-12 with its amendment, the MIT License);
  amended 2026-10-11 for a third font package, the amendment withdrawn 2026-10-12 (see "Amended 2026-10-11,
  withdrawn 2026-10-12")
- **Date:** 2026-10-08 (accepted 2026-10-10; amended 2026-10-11; the amendment withdrawn 2026-10-12)
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** [ADR 0012](0012-light-and-dark-themes.md), [ADR 0017](0017-licence-chosen-by-maintainer.md), [ADR 0035](0035-decisions-inherited-from-the-implementation-plan.md) §4
  (principle 7), [THIRD_PARTY.md](../../THIRD_PARTY.md)

## Context

The style skill (§3) requires Roboto and Roboto Mono, self-hosted, never fetched from a CDN at runtime (the
backend's CSP and the offline demo rule a CDN out). The app therefore bundles them from the
`@fontsource/roboto` and `@fontsource/roboto-mono` npm packages. Both are licensed under the SIL Open Font
License 1.1, which is not on the dependency allowlist (ADR 0017; ADR 0035 §4, principle 7). Unlike other
dependencies, the font files are copied into `frontend/dist` and so redistributed with the production image;
OFL-1.1 requires its copyright notice and licence to accompany every copy. OFL-1.1 does not extend to
software that merely uses the fonts, so it places no condition on gcportrait's own licence.

## Decision

- Accept OFL-1.1 for exactly these two packages, through a per-package exception
  (`PACKAGE_LICENSE_EXCEPTIONS` in `scripts/check-licenses.mjs`), documented in `THIRD_PARTY.md`. Any other
  OFL package still fails the check.
- The frontend build writes each package's own `LICENSE`, unmodified, to `frontend/dist/licenses/` (already in
  place in `frontend/vite.config.ts`).

## Consequences

- `pnpm run licenses`, and with it `pnpm check`, passes with the exception in place.
- Confirmed by the licence decision (ADR 0017, 2026-10-10) and again by its amendment of 2026-10-12, which made
  gcportrait's own work `MIT`: OFL-1.1 covers the font files only and imposes nothing on the software that uses
  them, so it does not constrain gcportrait's licence. The fonts keep their own licence and are not covered by the
  MIT License; `THIRD_PARTY.md` lists them.
- This is the one departure from "licence texts stay in `node_modules`" (ADR 0017); bundling another font
  means extending both lists and this ADR.

## Amended 2026-10-11, withdrawn 2026-10-12

On 2026-10-11 the exception was extended to a third OFL-1.1 font package: the typeface of a design the maintainer
was comparing with the default one, for the website and the app's chrome. On 2026-10-12 the maintainer kept the
default design ([ADR 0035](0035-decisions-inherited-from-the-implementation-plan.md), Consequences); the other
designs were deleted with their font package, and the amendment was withdrawn with them. The exception covers the
two Roboto packages only, as decided above, and nothing in the app, the website or the image changed for it.

## Alternatives considered

- **Load the fonts from a CDN at runtime.** Rejected by the style skill §3 (CSP, offline demo).
- **Rely on system fonts only.** Rejected: the layout engine computes text widths from a Roboto metrics table
  (layout skill §3), so labels on machines without Roboto would not match the computed layout.
