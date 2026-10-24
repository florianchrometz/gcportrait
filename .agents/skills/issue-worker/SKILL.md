---
name: issue-worker
description: Orchestrated procedure for working GitHub issues with subagents on a feature branch — coordinator triage by release milestone and linked branches, conflict-free partitioning across the main checkout and .worktrees/ subagent lanes, scanning and re-evaluating issue accuracy, commenting findings, details and plan, tagging and linking each issue to a branch before starting work, scope verification gates, and integrating and pushing commits onto the feature branch while leaving pull requests to the maintainer.
---
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Issue worker

The rules this handbook applies are in [AGENTS.md](../../../AGENTS.md) ("How to work a task", "Licence and
dependencies", "Quality gates, testing and CI", "Documentation" and "Names that never appear") and the
[contributor-workflow skill](../contributor-workflow/SKILL.md); this file is the step-by-step procedure for
orchestrating and working one or more GitHub issues on a feature branch using subagents.

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

## 2. Coordinator orchestration and subagent delegation

When working one or more issues, the top-level assistant acts as the **coordinator** and delegates each
self-contained issue to a dedicated **worker subagent**:

1. **Triage, check linked branches and clarify upfront**:
   - Fetch open issues (`gh issue list --state open --json number,title,milestone,labels,body`) and sort them
     by milestone version.
   - Check linked branches for each candidate issue (`gh issue develop --list <N>`). If an issue is already
     linked to an active branch from another run or contributor, inspect that branch first so work is never
     duplicated.
   - Read each target issue (`gh issue view <N> --comments`). If an issue has product, UX or scope ambiguity
     that requires maintainer input, ask the maintainer before spawning worker subagents.
2. **Partition issues into conflict-free lanes**:
   - Inspect the files and packages each issue will touch so no two concurrent subagents edit overlapping
     files.
   - **Main-checkout lane (serial, at most one subagent at a time)**: issues that change the frontend app
     bundle (`frontend/src/`, `packages/*/src/` imported by the app, or `scripts/media*.mjs`), because
     `pnpm media` records the built frontend bundle hash in `docs/media/manifest.json`.
   - **Isolated worktree lanes (parallel, `.worktrees/wt-<N>`)**: issues that touch disjoint non-bundle paths
     (`backend/`, `infra/`, `website/`, `e2e/`, `.github/`, `scripts/` outside media, `docs/`, catalog
     tooling, or `AGENTS.md`). Create a dedicated worktree per parallel subagent from the feature branch
     (`git worktree add -b work/issue-<N> .worktrees/wt-<N> <feature-branch>`).
   - Keep every checkout and worktree free of untracked scratch files: `scripts/lib/repo-files.mjs` scans all
     non-ignored files in the working tree during `pnpm provenance` and repository tests.
3. **Spawn one worker subagent per issue**:
   - Pass each subagent its assigned issue number `<N>`, assigned working directory (main checkout or
     `.worktrees/wt-<N>`), target branch, touched folders, required verification gates, and any maintainer
     clarifications.
   - Wait for active subagents to complete without polling loops.
4. **Integrate, clean up worktrees and push**:
   - As each worktree subagent finishes, fast-forward or cherry-pick its verified commit onto the milestone
     feature branch (for example `work/v1.0.1`), remove the temporary worktree and branch
     (`git worktree remove .worktrees/wt-<N> && git branch -d work/issue-<N>`), and run `pnpm check` if
     multiple parallel commits touched shared docs or tests.
   - Push the updated milestone feature branch to `origin` (`git push -u origin <feature-branch>`).

## 3. Worker subagent step 1: scan, plan, tag and link the issue before touching code

Each worker subagent (or single-issue worker) must complete these four steps in order before editing any file:

1. **Scan the codebase and verify the issue**:
   - Read [AGENTS.md](../../../AGENTS.md), the `AGENTS.md` of every top-level folder the issue touches, the
     [contributor-workflow skill](../contributor-workflow/SKILL.md), and the domain skill for that area.
   - Read the full issue (`gh issue view <N> --comments`) and inspect every file and symbol it names in the
     assigned checkout or worktree.
   - Verify whether the issue description still matches the codebase:
     - **Already resolved**: if the behaviour is already fixed on the branch, make no redundant edits and
       report the commit or file that resolved it on the issue.
     - **Partially resolved or shifted**: adapt the plan to what genuinely remains.
     - **Multi-part issue**: complete one coherent, self-contained slice, commit with `Part of #<N>; <what
       remains>.`, and note what remains on the issue.
2. **Plan and comment on the issue**:
   - Prior to editing any files, post a structured comment on the GitHub issue
     (`gh issue comment <N> --body-file -`) outlining:
     - **Findings**: what inspecting the current tree showed (exact files, symbols and current behaviour, and
       whether any part of the issue has already shifted or been resolved).
     - **Details**: root cause or design context, affected packages/surfaces, and the repository rules or
       constraints that apply.
     - **Plan**: the step-by-step plan to solve and verify the issue (files to change, tests to write or
       update first, and verification gates to run).
3. **Tag the issue**:
   - Ensure the issue has accurate `area: *` and kind labels and the target release milestone; add any missing
     metadata via `gh issue edit <N> --add-label "<label>" --milestone "<milestone>"`.
4. **Link the issue to the branch**:
   - Check `gh issue develop --list <N>`. When creating the target branch on `origin` (for example the first
     issue on `work/<milestone>` or a dedicated issue branch), create and link the remote branch in one step
     with `gh issue develop <N> --name <branch> --base main` (GitHub's `createLinkedBranch` GraphQL mutation
     creates and links a new remote branch, whereas attaching an already-existing shared remote branch to
     additional issues is only available in the GitHub web UI's Development sidebar).

## 4. Worker subagent step 2: test-first changes and verification gate

1. **Tests first**: add or update the failing unit, property or integration test before changing
   application or package code ([AGENTS.md](../../../AGENTS.md), "Quality gates, testing and CI").
2. **File and code hygiene**:
   - Start every new text source file with its `Apache-2.0` SPDX comment header
     ([AGENTS.md](../../../AGENTS.md), "Licence and dependencies").
   - Follow strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`,
     no `any`).
   - Hand-wrap Markdown at 110 columns ([AGENTS.md](../../../AGENTS.md), "Documentation") and keep every
     `AGENTS.md` within 20 000 characters ([AGENTS.md](../../../AGENTS.md), "How this file works").
   - Use synthetic domains (`example.com`, `example.org`) and project numbers (`< 100000000000`) only
     ([AGENTS.md](../../../AGENTS.md), "Data and graph semantics").
3. **Prepare the final release version before verification**: When the target branch is a release
   milestone branch (`work/vX.Y.Z`), set the workspace version with `pnpm release:version X.Y.Z` and
   update `CHANGELOG.md` with its `## X.Y.Z` summary. After final versioning, run `pnpm catalog:build`,
   then `CI=true pnpm media`. The catalog's package version changes the app bundle fingerprint even
   when no visual source changed. Verify `pnpm media --check` and `node scripts/exports.mjs --check`;
   include the generated media with the version bump in the verified tree.
4. **Run the verification gate for the final tree before committing**: Run these checks after all
   source changes, release versioning and media generation:
   - **Every change**: `pnpm check` (format, lint, typecheck, unit tests, catalog check, provenance,
     licences).
   - **Docs or skills changed**: `node scripts/user-docs.mjs`.
   - **Website or app routes changed**: `pnpm website:build && pnpm website:check`,
     `pnpm --filter @gcportrait/website run mobile --only layout`,
     `pnpm --filter @gcportrait/website run demo`, and
     `pnpm --filter @gcportrait/website run fillable --profile chromium`.
   - **App bundle or media scripts changed**: `CI=true pnpm media`, `pnpm build && pnpm size`,
     `CI=true pnpm e2e --retries=0`, and `node scripts/media.mjs --check && node scripts/exports.mjs --check`.

## 5. Worker subagent step 3: commit, push and report back

- Stage only the files belonging to the issue (`git status` must be clean after committing).
- Format the commit message so its subject can go straight into release notes ([contributor-workflow
  skill](../contributor-workflow/SKILL.md) §4):
  - Subject: `Area: imperative summary (#<N>)`
  - Body: what changed, why, and the verification commands run.
  - Trailer: `Closes #<N>.` (or `Part of #<N>; <what remains>.`).
- When the target branch is a release milestone branch (`work/vX.Y.Z`), ensure `package.json` across the
  workspace already matches `X.Y.Z` and `CHANGELOG.md` includes the `## X.Y.Z` summary verified in
  step 2, so tagging `vX.Y.Z` after merge passes the
  `release-image.mjs` and `release-notes.mjs` version guards ([contributor-workflow
  skill](../contributor-workflow/SKILL.md) §7).
- Push the feature branch to `origin` (`git push -u origin <branch>`) once integrated onto the target feature
  branch so the commits are visible online, while leaving opening, reviewing and merging the pull request to
  the maintainer.
- Return a concise summary to the coordinator: issue number, outcome, commit SHA, files changed, and
  verification results.
