<!-- SPDX-License-Identifier: MIT -->

# .agents

Reusable, tool-agnostic skills for anyone (human or AI assistant) working on gcportrait. Each skill is a
directory with a `SKILL.md` (frontmatter `name` + `description`, then the instructions) and optional
`references/` files. They are written so that an assistant can load one and immediately follow it, and so that
a reviewer can use the same file as a checklist to fact-check a change.

The skills are the procedural handbooks of their domains: they say how the work is done. The rules they apply
are in [AGENTS.md](../AGENTS.md), the one rules file of the project; a skill points there for a rule and never
restates how or when a rule came about.

| Skill | Purpose |
|---|---|
| `skills/gcp-diagram-style/` | Colours, zone tints, typography, icons, edge styles, legend, light/dark, WCAG checks, export rules, accessibility, and a fact-check list for renders. |
| `skills/gcp-diagram-layout/` | Nesting order, containment rules, packing, gutters, orthogonal routing invariants, progressive disclosure, performance budgets, and what a correct diagram looks like. |
| `skills/gcp-asset-catalog/` | How the asset catalog is structured, how to add a type or relation rule, normalisers, tiers, fixtures, coverage and drift tooling. Includes the official asset-type list snapshot and the relation seed. |
| `skills/cai-ingestion/` | Cloud Asset Inventory facts: list/export APIs, limits, asset shape, permissions, quota project, timeline readTime, gotchas, demo-data realism. |
| `skills/contributor-workflow/` | Fork → run → test → self-host → PR path, provenance rules, definition of done with what each test layer covers, review checklist, releases and versioning. |

How to load a skill:
- Codex CLI, Gemini CLI, Cursor and GitHub Copilot find the skills here by themselves. Claude Code loads
  skills from `.claude/skills/` only: `pnpm agents:setup` links each skill there (git-ignored), with the other
  local pointer files ([AGENTS.md](../AGENTS.md), "Assistants").
- Any assistant: name the SKILL.md path in the prompt ("load .agents/skills/gcp-diagram-style/SKILL.md"), or
  include its content in context. The repository commits no configuration of a particular tool
  ([AGENTS.md](../AGENTS.md), "How this file works"); `AGENTS.md` tells every tool which skill to load for
  which work.
- Humans: read it; the checklists are meant for review too.

Keep skills factual and short. When a rule changes, change `AGENTS.md` and the skill in the same PR as the
code.
