<!-- SPDX-License-Identifier: MIT -->

# 0016. `agents.md` is the only entry point for AI assistants

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** [agents.md](../../agents.md), [.agents/README.md](../../.agents/README.md)

## Context

Contributors use different AI assistants, and each assistant has its own conventional instruction file
(`CLAUDE.md`, `GEMINI.md` and others). Keeping several such files means keeping several copies of the same
rules in sync, and favouring some tools over others.

## Decision

The repository root has exactly one instruction file for assistants, `agents.md`, written for humans and any
assistant alike. There is no `CLAUDE.md` and no `GEMINI.md`. Reusable, task-specific instructions live as
plain Markdown skills under `.agents/skills/`.

## Consequences

- `agents.md` holds the hard rules, the layout, the commands and the task workflow; it stays short and points
  to the ADRs, the skills, `docs/backlog.md` and `docs/contributing.md`.
- Each skill is a directory with a `SKILL.md` (frontmatter `name` and `description`, then instructions) and
  optional `references/`; `.agents/README.md` explains how to load one with any tool.
- Per-user assistant settings (for example `.claude/`) are git-ignored and skipped by the provenance check.
- A rule changes in `agents.md` or the skill in the same pull request as the code it governs.

## Alternatives considered

- **Tool-specific files (`CLAUDE.md`, `GEMINI.md`, ...).** Rejected: duplicated rules that drift, and a bias
  towards particular tools. The previous implementation's `CLAUDE.md` lives under `legacy/` in the build
  repository only.
