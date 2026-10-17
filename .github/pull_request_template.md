<!-- SPDX-License-Identifier: MIT -->
<!--
  Thanks for contributing to gcportrait. Fill in every section and write "n/a" where one does not apply.
  The sections follow the PR checklist in .agents/skills/contributor-workflow/SKILL.md §5.
  Never name a real organisation, folder or project, and never paste tokens, in this description.
-->

## What and why

<!-- What changed and why. Link the issue ("Closes #123") or the docs/backlog.md item it works on. One topic
     per pull request; scope creep goes into a new issue. -->

## How it was verified

<!-- The commands you ran and their real results (counts, not just "green"). A failing or skipped step is
     reported as failing or skipped. -->

- Demo fixture(s) and lens(es): <!-- e.g. M / networking, S / everything -->
- Tested against a real scope: <!-- yes or no; never its name -->
- Commands and results:

```text
pnpm check   →
pnpm e2e     →
```

## Screenshots (light and dark)

<!-- Required for any visual change: the same view in both themes, from demo mode (`pnpm render`, or the
     running app). Call out every golden or baseline you regenerated, and why, with before and after images:
     the renderer's SVG baselines
     (`pnpm --filter @gcportrait/frontend test src/diagram/baselines.test.tsx -u`), the render golden PNG
     (`pnpm --filter @gcportrait/render-cli test:golden:update`), the layout's golden JSON
     (`pnpm --filter @gcportrait/layout test:golden:update`). Otherwise "n/a". -->

| Light | Dark |
| --- | --- |
| | |

## Catalog changes

<!-- If packages/catalog changed: add the `catalog` label and list every asset type you added or changed,
     with its role and the targets of its relations. Otherwise "n/a". -->

| Asset type | Role | Relations (kind → target type) |
| --- | --- | --- |
| | | |

## Risk and rollback

<!-- For backend or infra changes: what could break for a self-hosted instance and how to roll back (for
     example, redeploy the previous release with `infra/deploy.sh --image vX.Y.Z`). Otherwise "n/a". -->

## Checklist

- [ ] **Provenance:** Original work; nothing copied from other projects.
- [ ] `pnpm check` passes locally (format, lint, typecheck, unit, catalog, provenance, licences).
- [ ] New text files start with the `SPDX-License-Identifier: MIT` line in their comment form
      (AGENTS.md, Licence and dependencies); a new dependency passes `pnpm run licenses`.
- [ ] `pnpm e2e` passes locally, or the description says that I rely on CI for it.
- [ ] Anything visible was checked in light and dark themes; contrast tests pass.
- [ ] A changeset is included (`pnpm changeset`), or this change does not affect users.
- [ ] Package READMEs, docs, skills and the AGENTS.md that holds a changed rule are updated where behaviour
      or a rule changed.
- [ ] No real organisation data, tokens or secrets in code, fixtures, screenshots or logs.
