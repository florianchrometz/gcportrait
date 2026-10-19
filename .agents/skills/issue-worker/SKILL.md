---
name: issue-worker
description: Procedure for working GitHub issues on a feature branch — prioritizing issues by release milestone, re-evaluating issue accuracy against the current tree, posting a comment with findings, details and plan to solve it on the issue before starting work, checkout and worktree isolation, scope-specific verification gates, committing and pushing onto a feature branch, while leaving opening, reviewing and merging pull requests to the maintainer.
---
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Issue worker

The rules this handbook applies are in [AGENTS.md](../../../AGENTS.md) ("How to work a task", "Licence and
dependencies", "Quality gates, testing and CI", "Documentation" and "Names that never appear") and the
[contributor-workflow skill](../contributor-workflow/SKILL.md); this file is the step-by-step procedure for
working one or more GitHub issues on a feature branch.

## 1. Milestone priority, branch pushing and pull request discipline

- **Prioritize by milestone version**: GitHub milestones define the target release version for each issue
  (for example `v1.0.1`, `v1.0.2`, `v1.1.0`). When listing and working issues in batch
  (`gh issue list --state open --json number,title,milestone,labels`), order issues by their milestone's
  semantic version so the next upcoming release always takes priority over later versions (and milestoned
  issues take priority over unmilestoned ones).
- **Create, commit to and push the feature branch**: Work happens on a feature branch named for the target
  milestone or issue (for example `work/v1.0.1` or `work/<N>`), never directly on `main`. Always push your
  verified commits on the feature branch to `origin` (`git push -u origin <branch>`) so changes are visible
  online immediately. Do not mix commits for a later milestone onto the current release's branch unless
  requested.
- **Opening, reviewing and merging pull requests is manual maintainer work**: Assistants and subagents must
  never open pull requests (`gh pr create`), approve or review them, auto-merge them (`gh pr merge`), or close
  issues directly. Because `.github/workflows/pr.yml` triggers only on pushes to `main` and on open pull
  requests, pushing commits to the feature branch without opening a pull request makes every commit visible
  online without triggering CI on intermediate pushes until the maintainer opens the pull request.

## 2. Re-evaluate the issue and comment findings, details and plan before touching code

1. Read [AGENTS.md](../../../AGENTS.md), the `AGENTS.md` of every top-level folder the issue touches, the
   [contributor-workflow skill](../contributor-workflow/SKILL.md), and the domain skill for that area.
2. Read the full issue (`gh issue view <N> --comments`) and inspect every file and symbol it names in the
   current checkout.
3. Verify whether the issue description still matches the codebase:
   - **Already resolved**: if the behaviour is already fixed on the branch, make no redundant edits and report
     the commit or file that resolved it on the issue.
   - **Partially resolved or shifted**: adapt the plan to what genuinely remains.
   - **Multi-part issue**: complete one coherent, self-contained slice, commit with `Part of #<N>; <what
     remains>.`, and note what remains on the issue.
4. **Comment on the issue before starting implementation**: prior to editing any files, post a structured
   comment on the GitHub issue (`gh issue comment <N> --body-file -`) outlining:
   - **Findings**: what inspecting the current tree showed (exact files, symbols and current behaviour, and
     whether any part of the issue has already shifted or been resolved).
   - **Details**: root cause or design context, affected packages/surfaces, and the repository rules or
     constraints that apply.
   - **Plan**: the step-by-step implementation and verification plan (files to change, tests to write or
     update first, and verification gates to run).

## 3. Checkout and worktree isolation

- **Main checkout** (`work/<branch>`): use the main checkout when a task changes the app bundle
  (`frontend/src/`, `packages/*/src/` imported by the app, or `scripts/media*.mjs`), because `pnpm media`
  records the built frontend bundle hash in `docs/media/manifest.json`.
- **Isolated worktree** (`.worktrees/wt-<N>`): use a clean git worktree when running parallel tasks
  that touch non-bundle paths (`backend/`, `infra/`, `website/`, `e2e/`, `.github/`, `scripts/` outside media,
  `docs/`, catalog tooling, or `AGENTS.md`).
- Keep every checkout and worktree free of untracked scratch files: `scripts/lib/repo-files.mjs` scans all
  non-ignored files in the working tree during `pnpm provenance` and repository tests.

## 4. Implementation and verification gate

1. **Tests first**: add or update the failing unit, property or integration test before changing
   implementation code ([AGENTS.md](../../../AGENTS.md), "Quality gates, testing and CI").
2. **File and code hygiene**:
   - Start every new text source file with its `Apache-2.0` SPDX comment header
     ([AGENTS.md](../../../AGENTS.md), "Licence and dependencies").
   - Follow strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`,
     no `any`).
   - Hand-wrap Markdown at 110 columns ([AGENTS.md](../../../AGENTS.md), "Documentation") and keep every
     `AGENTS.md` within 20 000 characters ([AGENTS.md](../../../AGENTS.md), "How this file works").
   - Use synthetic domains (`example.com`, `example.org`) and project numbers (`< 100000000000`) only
     ([AGENTS.md](../../../AGENTS.md), "Data and graph semantics").
3. **Run the verification gate for the touched scope before committing**:
   - **Every change**: `pnpm check` (format, lint, typecheck, unit tests, catalog check, provenance,
     licences).
   - **Docs or skills changed**: `node scripts/user-docs.mjs`.
   - **Website changed**: `pnpm website:build && pnpm website:check`.
   - **App bundle or media scripts changed**: `CI=true pnpm media`, `pnpm build && pnpm size`,
     `CI=true pnpm e2e --retries=0`, and `node scripts/media.mjs --check && node scripts/exports.mjs --check`.

## 5. Commit, push and reporting

- Stage only the files belonging to the issue (`git status` must be clean after committing).
- Format the commit message so its subject can go straight into release notes ([contributor-workflow
  skill](../contributor-workflow/SKILL.md) §4):
  - Subject: `Area: imperative summary (#<N>)`
  - Body: what changed, why, and the verification commands run.
  - Trailer: `Closes #<N>.` (or `Part of #<N>; <what remains>.`).
- Push the feature branch to `origin` (`git push -u origin <branch>`) so the commits are visible online, and
  leave opening, reviewing and merging the pull request to the maintainer.
