<!-- SPDX-License-Identifier: MIT -->

# AGENTS.md: documentation

These rules add to the root AGENTS.md, which applies here too.

## User guides

A new guide is registered in `scripts/user-docs.mjs`, [docs/README.md](README.md) and the website's docs menu
(`website/src/data/docs.ts`). The shared writing, variable and placement rules follow
[AGENTS.md](../AGENTS.md), "Documentation" and "Non-affiliation, brand and legal".

[docs/legal/README.md](legal/README.md) holds the legal fact sheets' scope; the shared legal-page policy is
in [AGENTS.md](../AGENTS.md), "Modes and hosting".

## Media

The generated `docs/media/` and guide lens tables follow [AGENTS.md](../AGENTS.md), "Quality gates, testing
and CI". [docs/website.md](website.md) describes the media and sample exports; their commands are below.

## Commands

| Goal | Command |
|---|---|
| Check the user guides under docs/ against the tree (commands, flags, settings; no records of runs) and every Markdown file's width (110 columns, with the exemptions of AGENTS.md, Documentation) / regenerate their lens tables after a lens change (also part of `pnpm test`) | `node scripts/user-docs.mjs` / `node scripts/user-docs.mjs --write` |
| Regenerate the screenshots, animated demos and link-preview images from demo mode (`docs/media/`, both themes; needs Playwright's Chromium) / check them for staleness | `pnpm media` (`--only ID`, `--theme dark`) / `pnpm media --check` |
| Regenerate the website's sample exports (SVG, PNG and draw.io drawn by `pnpm render`, `docs/media/exports/`) / check them | `node scripts/exports.mjs` / `node scripts/exports.mjs --check` (`--render` also draws them again and compares) |
