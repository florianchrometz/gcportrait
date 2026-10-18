---
name: contributor-workflow
description: The way work gets done on gcportrait — provenance rules, local loop, tests and visual baselines, self-hosting for real-scope testing, PR and review checklists, releases and versioning. Load at the start of any task and before opening or reviewing a PR.
---
<!-- SPDX-License-Identifier: MIT -->

# Contributor workflow

The rules this handbook applies are in [AGENTS.md](../../../AGENTS.md) ("How to work a task", "Licence and
dependencies", "Quality gates, testing and CI", "Releases", "Documentation" and "Names that never appear")
and [.github/AGENTS.md](../../../.github/AGENTS.md) ("CI", "A change of only docs and media" and "Releases"),
[e2e/AGENTS.md](../../../e2e/AGENTS.md) ("What the suite runs against", "Widths, gestures and axe" and
"CI legs") and [docs/AGENTS.md](../../../docs/AGENTS.md) ("User guides" and "Media"); this file is the
procedure and the checklists.

## 1. Before you start

- Read `AGENTS.md`, the `AGENTS.md` of every top-level folder you change, and the issue or the
  [docs/backlog.md](../../../docs/backlog.md) item you work on. Load the skills its area needs (AGENTS.md,
  "Skills"). A tool that does not read the AGENTS.md files or `.agents/skills/` by itself gets local,
  git-ignored pointer files from `pnpm agents:setup` (AGENTS.md, "Assistants"); a rule never goes into one of
  them.
- Check provenance and licensing against AGENTS.md, "Licence and dependencies" and "Names that never
  appear". For a new text source, add the header line for its type:
  `// SPDX-License-Identifier: MIT` (TypeScript and JavaScript),
  `# SPDX-License-Identifier: MIT` (YAML, shell and the `#`-comment dotfiles),
  `/* SPDX-License-Identifier: MIT */` (CSS),
  `<!-- SPDX-License-Identifier: MIT -->` (Markdown, HTML, Astro).
  [The SPDX header](../../../docs/contributing.md#the-spdx-header) explains placement, exemptions and
  registering an unknown type; `node scripts/check-provenance.mjs --list-exempt` prints the check's rules
  and exemptions. Run `pnpm provenance` to check the tree.
- Branch or worktree per topic: `<topic>-<slug>` or `<issue>-<slug>` (for example `412-gutter-lanes`).
- Read [Contributions and licensing](../../../docs/contributing.md#contributions-and-licensing) before
  submitting; confirm the provenance statement in the PR template.
- For a new dependency, inspect `node scripts/check-licenses.mjs --list-rules`, then run `pnpm run
  licenses`. After changing dependencies, regenerate `THIRD_PARTY.md` with `pnpm run licenses --write`.

## 2. Local loop

```sh
corepack enable          # once: pnpm at the version pinned in package.json (Node >= 22.22.2 required)
pnpm install
pnpm dev:demo            # SPA in demo mode on :5174, no backend, no GCP
pnpm dev                 # SPA on :5173 + backend on :8080 (backend/.env optional; OAUTH_CLIENT_ID for sign-in)
pnpm check               # format:check + lint + typecheck + test + catalog:check + provenance + licenses
pnpm --filter @gcportrait/<pkg> test   # one package (also lint, typecheck); or `pnpm test --project <name>`
pnpm build && pnpm size  # production build, then the size gate (frontend/AGENTS.md, Bundle budgets)
pnpm e2e                 # Playwright: functional + axe in both themes, on demo mode, and the phone and tablet check
                         # (once per machine: pnpm --filter @gcportrait/e2e install-browsers)
pnpm --filter @gcportrait/frontend mobile   # the phone and tablet check alone (frontend/AGENTS.md, Phones, tablets and desktops)
pnpm render --fixture M --lens networking --png out.png --theme dark   # a demo view drawn as the app's renderer draws it
pnpm format              # fix formatting (Markdown is hand-wrapped at 110 columns, not formatted)
pnpm run licenses --write   # after a dependency change: regenerate THIRD_PARTY.md (`run` is required)
```

Tests first for `packages/*` (vitest; property tests with fast-check where a package has them, under the fixed
seed on CI). Fixtures first for
catalog work. Golden layout JSON and visual baselines for renderer work.

Visual baselines live in `e2e/baselines/`: the renderer's SVG baselines (`diagram/`, written by the
frontend's Vitest suite; SVG text, so they match on every platform) and the render golden PNG (`render/`,
written by `pnpm render`'s resvg with the bundled Roboto faces, compared tolerance-free). Update them only
when the change is visual and intended, then explain the diff in the PR with before/after PNGs from
`pnpm render`:

```sh
pnpm --filter @gcportrait/frontend test src/diagram/baselines.test.tsx -u   # SVG baselines (file before -u)
pnpm --filter @gcportrait/render-cli test:golden:update                       # the render golden PNG
pnpm --filter @gcportrait/layout test:golden:update                           # the layout's golden JSON
```

A layout change usually moves all three. The render golden is drawn by resvg's WebAssembly build, which
computes the same bytes on every platform; should a platform ever rasterise an anti-aliased edge differently,
the remedy is one golden per platform, not a tolerance (`packages/render-cli/README.md`, "Platforms").

## 3. Testing against a real scope (optional, recommended for backend/ingest/timeline work)

`docs/self-host.md` is the guide, `docs/self-host-options.md` every option and `docs/configuration.md` the
reference. Without a real scope, backend work is verified with `pnpm --filter @gcportrait/backend test`
(Fastify inject, no network).

1. Create or pick a GCP project you own; enable billing.
2. `infra/deploy.sh --project YOUR_PROJECT --region europe-west3 --build` — enables APIs, creates the backend
   service account (no roles), builds your checkout with Cloud Build (or, without `--build`, deploys a
   released image from ghcr.io, `--image vX.Y.Z` to pin one), deploys Cloud Run, prints the URL and the SA
   email. `--dry-run` prints the changes first. `--iap` makes the instance private, with user mode inside
   (docs/self-host-options.md). `scripts/infra.test.ts` runs both scripts offline against stand-ins for
   `gcloud` and `curl`.
3. Create an OAuth client (Web application) in that project; set its origin to the Cloud Run URL; run
   deploy.sh again with the same flags plus `--oauth-client-id ...` (it is declarative: each run sets the
   service to its flags). The script prints the exact console steps.
4. Grant yourself `roles/cloudasset.viewer` on a test scope (your own project is enough).
5. Open the URL, run the preflight, pull, render, scrub the timeline, export a PNG.
6. `infra/uninstall.sh --project YOUR_PROJECT` when done. Never commit anything from the real scope.

## 4. Definition of done (per task)

- The acceptance criteria of the issue or backlog item, and the rules in the skills, met and demonstrated
  (commands + output in the PR).
- `pnpm check` and `pnpm e2e` green locally; CI green. Follow .github/AGENTS.md, "CI", "A change of only docs
  and media" and "The e2e, layout-budget and website gates". For a failure, find the job's or step's command
  and artifacts in [Continuous integration](../../../docs/contributing.md#continuous-integration), then
  reproduce with `TZ=UTC LC_ALL=C.UTF-8 CI=true`.
- Both themes verified for visual work; contrast tests green.
- Docs updated: package README, user docs under `docs/` or `website/` if behaviour changed, `AGENTS.md` and
  the skill if a rule changed.
- Changeset added (`pnpm changeset`, or `pnpm changeset add --minor <pkg> -m "..."`) with a user-facing
  summary, unless the change does not affect users.
- No TODOs without an issue link; no commented-out code; no `any`.

What each layer tests (the tests a change adds belong in the layer it touches):

| Layer | Tool | What it must cover |
|---|---|---|
| catalog (`packages/catalog`) | vitest | schema validity, every rule resolved against its fixture, `hiddenWhen` proofs, official-list coverage, icon keys |
| ingest | vitest | NDJSON edge cases (huge lines, several files, both spellings), project number → id resolution, recorded CAI responses; the XL budget |
| graph | vitest + fast-check | containment order, Shared VPC derivation, every lens with every focus view and the standard filters, drill-in, the diff; properties (no cycles, idempotence); the M budget |
| layout | vitest + fast-check | the invariants (layout skill §5), determinism, golden JSON per fixture × lens, the budgets (layout skill §7) |
| theme | vitest | contrast for every palette pair in both themes (`frontend/src/diagram/theme/theme.test.ts`) |
| frontend | vitest + Testing Library | the store, the URL-hash codec, the export serialiser, components, the renderer's SVG baselines, every control at every width (`shell/parity.test.tsx`) |
| backend | vitest + Fastify `inject`, stand-ins for Google's APIs | the gate, the host allowlist, streaming and its caps, retries, the preflight matrix, the render API |
| e2e | Playwright | the demo flows (load, search, drill-in, filters, timeline, export PNG, SVG and draw.io, theme), axe in both themes (style skill §13), the live paths against stand-ins, the phone and tablet layouts (`mobile.spec.ts`: overflow, 44-pixel targets, the canvas's room, axe), the canvas's gestures by finger (`touch.spec.ts`), the flows by finger on a phone and a tablet (`handheld.spec.ts`, tagged `@phone` and `@tablet`) |
| render | vitest | the render golden PNG (`pnpm render`, tolerance-free) |
| repository | vitest (`tooling`) and node scripts | provenance (SPDX headers, banned files, the names that never appear, work-item ids, text encoding), licences, the bundle budgets, the user guides against the tree, the infra scripts against stand-ins of `gcloud` and `curl` |

## 5. PR checklist (template)

Pull requests are highly welcome, preferably small ones about one feature or one function rather than full
rewrites: one change per pull request, with its changeset. A rewrite of a whole part is proposed in an issue
first, then made in small steps (AGENTS.md, "How to work a task").

- What changed and why (link the issue or the `docs/backlog.md` item).
- How it was verified: demo fixture(s) used, real scope (yes/no, never its name), commands and results.
- Screenshots (light + dark) for visual changes; baseline updates called out.
- Provenance statement: "Original work; nothing copied from other projects."
- Catalog label if `packages/catalog` changed; list the types, roles and relation targets.
- Risk and rollback note for backend/infra changes.

## 6. Review checklist

1. Does it do exactly the task, no more? Scope creep goes to a new issue.
2. Provenance and licence: does any part read like a translation of someone else's code? Ask for a rewrite.
   New files carry the `MIT` header, a new dependency passes `pnpm run licenses`, and the footer's "Source
   (MIT)" link is still on every route.
3. Data over code: any new hard-coded map that belongs in the catalog?
4. Tests: do new rules have fixtures? Do layout changes keep invariants and update goldens deliberately?
5. Both themes, contrast, accessibility (axe) for UI changes.
6. Security: tokens, host allowlist, logs, CSP untouched or improved.
7. Non-affiliation (AGENTS.md, "Non-affiliation, brand and legal"): the footers and long-form texts carry the
   statement, no drawing, export or page metadata does; nothing calls the project official or Google's, and no
   text names Google with its company suffix; Google's icons are unmodified.
8. Docs and changeset present.

## 7. Releases

For the maintainer, follow [docs/contributing.md §9](../../../docs/contributing.md#9-releases): one-time
registry setup, a pre-release trial, then version, commit and tag; the already-versioned first release has
its own steps there. The release rules are AGENTS.md, "Releases"; workflow execution follows
.github/AGENTS.md, "Releases". Self-hosters install or pin a release through
[docs/self-host.md](../../../docs/self-host.md).

For catalog version fields, follow packages/AGENTS.md, "Catalog and graph semantics". For a snapshot format
change, follow [the model's migration policy](../../../packages/model/README.md#migration-policy).
