<!-- SPDX-License-Identifier: Apache-2.0 -->

# Changesets

This folder holds pending release notes, managed by [Changesets](https://changesets.dev).

- Every pull request that changes behaviour adds one: run `pnpm changeset`, pick the affected packages and the
  semver bump, and write a one-line, user-facing summary. Commit the generated `.changeset/*.md` file with the
  change.
- At release time the maintainer runs `pnpm release:version` (`changeset version`), which consumes the pending
  files, bumps versions and writes the `CHANGELOG.md` files; then tags `vX.Y.Z` on `main`.
- All `@gcportrait/*` packages are private (never published to npm) and form one `fixed` group, so the whole
  product carries a single version number. `privatePackages.version` is on so that private packages are
  versioned at all; `tag` is off because release tags are created by the maintainer.

Changeset entries and generated `CHANGELOG.md` files are exempt from the SPDX header rule
(`node scripts/check-provenance.mjs --list-exempt`).
