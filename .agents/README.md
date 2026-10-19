<!-- SPDX-License-Identifier: Apache-2.0 -->

# .agents

Reusable, tool-agnostic skills for anyone (human or AI assistant) working on gcportrait. Each skill is a
directory with a `SKILL.md` (frontmatter `name` + `description`, then the instructions) and optional
`references/` files. They are written so that an assistant can load one and immediately follow it, and so that
a reviewer can use the same file as a checklist to fact-check a change.

The skills are the procedural handbooks of their domains: they say how the work is done. The rules they apply
are in the rules files, [AGENTS.md](../AGENTS.md) at the root and the `AGENTS.md` of each top-level folder
with rules of its own; a skill points there for a rule and never restates how or when a rule came about.

| Skill | Purpose |
|---|---|
| `skills/gcp-diagram-style/` | Colours, zone tints, typography, icons, edge styles, legend, light/dark, WCAG checks, export rules, accessibility, and a fact-check list for renders. |
| `skills/gcp-diagram-layout/` | Nesting order, containment rules, packing, gutters, orthogonal routing invariants, progressive disclosure, performance budgets, and what a correct diagram looks like. |
| `skills/gcp-asset-catalog/` | How the asset catalog is structured, how to add a type or relation rule, normalisers, tiers, fixtures, coverage and drift tooling. Includes the official asset-type list snapshot and the relation seed. |
| `skills/cai-ingestion/` | Cloud Asset Inventory facts: list/export APIs, limits, asset shape, permissions, quota project, timeline readTime, gotchas, demo-data realism. |
| `skills/contributor-workflow/` | Fork → run → test → self-host → PR path, provenance rules, definition of done with what each test layer covers, review checklist, releases and versioning. |
| `skills/issue-worker/` | Milestone-based release priority, issue accuracy re-evaluation, checkout/worktree isolation, scope verification gates, committing and pushing onto a feature branch, with PR creation, review and merging left to the maintainer. |

How to load a skill:
- Codex CLI, Gemini CLI, Cursor and GitHub Copilot find the skills here by themselves. Claude Code loads
  skills from `.claude/skills/` only: `pnpm agents:setup` links each skill there (git-ignored), with the other
  local pointer files ([AGENTS.md](../AGENTS.md), "Assistants").
- Any assistant: name the SKILL.md path in the prompt ("load .agents/skills/gcp-diagram-style/SKILL.md"), or
  include its content in context. The repository commits no configuration of a particular tool
  ([AGENTS.md](../AGENTS.md), "How this file works"); `AGENTS.md` tells every tool which skill to load for
  which work.
- Humans: read it; the checklists are meant for review too.

## What each assistant reads, and what the setup writes

What each tool reads by itself, as its documentation says, and the local, git-ignored pointer files
`pnpm agents:setup` writes for it: at the root, and for each top-level folder with an `AGENTS.md` (FOLDER;
NAME is the folder without a leading dot). `scripts/agents-setup.mjs` names the documentation each row
follows.

| Tool | Reads by itself | What the setup writes at the root | What it writes per folder file |
|---|---|---|---|
| Claude Code | `AGENTS.md` while no `CLAUDE.md` is present, and a folder's when it reads a file there; skills only from `.claude/skills/` | `CLAUDE.md` with an `@AGENTS.md` import, and a link `.claude/skills/NAME` to each skill | `FOLDER/CLAUDE.md` with an `@AGENTS.md` import, which loads once a file of the folder is read or changed |
| Gemini CLI | `GEMINI.md`, and a folder's when a tool touches a file there; the skills under `.agents/skills/` | `GEMINI.md` with an `@./AGENTS.md` import | `FOLDER/GEMINI.md` with an `@./AGENTS.md` import |
| Codex CLI | the `AGENTS.md` of each folder from the root down to the one it starts in, 32 KiB together by default; the skills under `.agents/skills/` | nothing | nothing |
| Cursor | `AGENTS.md` at the root and in folders, `.cursor/rules/*.mdc` and the skills under `.agents/skills/` | `.cursor/rules/agents.mdc`, applied in every chat | nothing |
| GitHub Copilot | `AGENTS.md` (the nearest one first), `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` and the skills under `.agents/skills/` | `.github/copilot-instructions.md` | `.github/instructions/NAME.instructions.md` with `applyTo: "FOLDER/**"`, as VS Code reads a folder's `AGENTS.md` only with an experimental setting |

Each root pointer says in one paragraph "Read AGENTS.md, the AGENTS.md of every folder you change and the
skills under .agents/skills/ first; this file only points there." A pointer beside a folder file names
`../AGENTS.md` and that folder's own file instead, with the tool's import line where it has one.

- Each pointer file is one paragraph that points to the rules files and the skills, with the tool's import
  line where it has one. `pnpm agents:setup` never overwrites a file that exists (`--force` does, but never a
  folder, and it never writes through a link), changes nothing that is in place, links a skill added since
  and removes the link to one that is gone, writes the pointers of a folder file added since and removes those
  it wrote for one that is gone, while they hold exactly what it writes; `--tool claude` (gemini, codex,
  cursor, copilot) limits it to one tool.
- Codex started at the root reads the root's `AGENTS.md` alone, and a folder file when the root sends it
  there. Started in a folder, it reads the root's and that folder's within one limit of 32 KiB, which cuts the
  folder file after what the root leaves of it; raise `project_doc_max_bytes` in `~/.codex/config.toml` to
  start it there.

On a case-insensitive file system (macOS, Windows), git does not notice a case-only rename. Use `git mv -f`
so the filename is `AGENTS.md` in git as on disk; `scripts/rules-files.test.ts` rejects another spelling or
a rules file deeper than one folder below root.

Keep skills factual and short. When a rule changes, change the `AGENTS.md` that holds it and the skill in the
same PR as the code.
