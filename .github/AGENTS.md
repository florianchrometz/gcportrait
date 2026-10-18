<!-- SPDX-License-Identifier: MIT -->

# .github/AGENTS.md: workflows

These rules add to the root AGENTS.md, which applies here too.

## CI

- **CI** (`.github/workflows/pr.yml`) runs its jobs side by side on each pull request and push to `main`:
  lint, typecheck, the unit tests in three legs plus a coverage leg (the packages' thresholds),
  `layout-budget` (reports only), build with the size budgets, e2e in five Chromium legs (three of the
  desktop specs, two of the phone and tablet check and the `chromium-phone` and `chromium-tablet`
  projects), the website and `repo-checks`. The e2e leg contract follows [e2e/AGENTS.md](../e2e/AGENTS.md),
  "CI legs".
- **Checks that take seconds are steps of `repo-checks`**, not jobs, because each job spends its set-up
  again: catalog-check, provenance (with a self-test that plants a banned file and requires the guard to
  fail), licences, the dependency audit and workflows-and-shell. Each step runs after a failed one
  (`success() || failure()`), so every check reports by name; the job skips only for a cancelled run.
- Its **`required` job is the one check branch protection targets**, green only when every other job but
  `layout-budget` succeeded or was skipped where `changes` planned it (below), so the ruleset never changes
  when a job does.
- **Every action is pinned by commit.**

## A change of only docs and media

A change of only docs and media runs only the jobs that read them. A first job, `changes`, compares a push
with the commit before it and a pull request with the branch it merges into, and sorts every changed file as
docs (`docs/**/*.md`, `.changeset/*.md`, the root's Markdown files, each top-level folder's and package's
`README.md` and `CHANGELOG.md`, and each folder's `AGENTS.md`), media (`docs/media/**`) or code (everything
else, the skills included). With no code among them, the unit tests of every project but the layout and the
frontend, the website and provenance run, licences too for docs (`THIRD_PARTY.md`) and Prettier for media (its
manifests are JSON); typecheck, the layout, frontend and coverage unit legs, `layout-budget`, build, e2e,
ESLint and the catalog-check, audit and workflows-and-shell steps are skipped, because none of them reads
those files, so each could only repeat the result of the tree the change starts from. A comparison that
cannot be made runs every job.

## The e2e, layout-budget and website gates

The e2e legs, `layout-budget` and the website run only when a changed file is one they read, because the
e2e legs are the longest jobs and `layout-budget` only reports. `changes` decides one output for each: `e2e`
is false when every code file lies under `scripts/`, `website/`, `infra/`, `docs/`, `.agents/`, `.changeset/`
or `.github/`, or is a root lint, format, editor, Docker or git setting; `layout` is true only for a code file
of the layout or a package it is tested with or the catalog's build reads (model, catalog, demo-data, graph,
ingest, icons), `frontend/package.json` (its fonts) or a root file; `website` is false only when every changed
file is a code file modified in place under `backend/`, `e2e/`, `.agents/` or `.github/` (or
`.changeset/config.json`), since the site's checks resolve links to repository paths. A change to the setup
or Playwright action or to `pr.yml` runs all three. `required` counts a skipped e2e leg or website as passed
only when its output is false; a comparison that cannot be made sets every output true.

## Drift checks

- **`catalog-drift.yml` and `icon-drift.yml` keep no logic of their own beyond a few shell lines**: the check
  script writes its report as JSON (`drift`, `digest`, `summary`) and Markdown, and `scripts/drift-issue.mjs`
  opens or updates the issue through `gh`, because a script has unit tests and inline workflow code has none.
- **They carry no guard for a branch without the scripts**: their schedule runs on `main`, where both exist.

## Dependabot

The dependency audit and the handling of Dependabot's pull requests follow
[AGENTS.md](../AGENTS.md), "Security and privacy" and "Quality gates, testing and CI".

## Releases

- **`release.yml`** enforces the tag's gates and publishes the image and release assets specified by
  [AGENTS.md](../AGENTS.md), "Releases", with the workflow's own `GITHUB_TOKEN`: no secret, no Workload
  Identity Federation, no registry on Google Cloud. The same root contract governs a run by hand.
- **The website** deploys only while the repository variable `PAGES_DEPLOY` is `true`; a tag's website job
  refuses stale `docs/media/` ([docs/website.md](../docs/website.md)).

The contributor-workflow skill (§7) and [docs/contributing.md](../docs/contributing.md) (section 9) hold the
release procedure.
