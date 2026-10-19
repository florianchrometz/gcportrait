<!-- SPDX-License-Identifier: Apache-2.0 -->

# gcportrait documentation

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.

## User guides

For people who use gcportrait or run an instance of it. They say what to do; `node scripts/user-docs.mjs` (run
by `pnpm test`) fails when the ten guides from modes.md to api.md name a command, flag or setting the tree
does not have; when a guide, getting-started.md, cloudshell-tutorial.md, website.md or a README for running
gcportrait logs what was verified when and where (a dated note, a machine, a timed run, a recorded run in
code); and when self-host.md asks for more than the project id, the OAuth client id and the email address to
grant. The project's website (`gcportrait.app`) builds its /docs/ pages from the same files, and its "About
the author" section from [author.md](author.md).

| Guide | What it covers |
|---|---|
| [getting-started.md](getting-started.md) | Try the demo and take a first tour. |
| [modes.md](modes.md) | Compare the ways to load an inventory and where its data goes. |
| [permissions.md](permissions.md) | Grant access, sign in and diagnose permission checks. |
| [lenses-and-filters.md](lenses-and-filters.md) | Choose and compose views of an inventory. |
| [timeline.md](timeline.md) | Explore a scope’s history and compare snapshots. |
| [export.md](export.md) | Save diagrams as SVG, PNG or draw.io files. |
| [faq.md](faq.md) | Answers to common questions about diagrams, data and hosting. |
| [self-host.md](self-host.md) | Deploy, use, update and uninstall your own Cloud Run instance. |
| [self-host-options.md](self-host-options.md) | Optional deployment choices and troubleshooting. |
| [configuration.md](configuration.md) | The reference for settings, defaults and installer flags. |
| [api.md](api.md) | The HTTP API, with request examples, errors and limits. |
| [cloudshell-tutorial.md](cloudshell-tutorial.md) | The guided self-hosting tutorial in Cloud Shell. |

## For contributors

| Path | What it is for |
|---|---|
| [AGENTS.md](../AGENTS.md) | The shared rules for people and AI assistants, with links to folder rules. |
| [docs/AGENTS.md](AGENTS.md) | This folder’s guide-registration and documentation rules. |
| [contributing.md](contributing.md) | Set up a clone, check changes and contribute a pull request. |
| [website.md](website.md) | Build, check and deploy the website and its generated [media/](media/manifest.json). |
| [legal/](legal/README.md) | The hosted site’s data-processing fact sheets, not legal advice. |
| [packages.md](packages.md) | Workspace responsibilities, public entry points and data flow. |
| [threat-model.md](threat-model.md) | Assets, trust boundaries and controls under [AGENTS.md](../AGENTS.md). |
| [security.md](security.md) | The security-control checklist, evidence and open findings. |
| [backlog.md](backlog.md) | Open work and maintainer decisions; start a task here or from an issue. |
| [catalog-followups.md](catalog-followups.md) | Catalog work and unresolved source-data questions; read before changing rule semantics. |

## Documentation elsewhere in the repository

- [AGENTS.md](../AGENTS.md): the rules of the project, the repository map, the commands and how to work a
  task, for humans and AI assistants alike; a top-level folder with rules of its own holds them in an
  `AGENTS.md` of its own, which the root names.
- [.agents/skills/](../.agents/README.md): style, layout, asset catalog, ingestion, contributor-workflow and
  issue-worker skills, the handbooks that apply AGENTS.md's rules, usable as checklists by reviewers too.
- [brand/](../brand/README.md): `icon.svg`, the one source of gcportrait's mark (the favicons and the
  website's logo).
- Each workspace package's `README.md` (`frontend/`, `backend/`, `e2e/`, `packages/*/`): its scripts,
  structure and conventions.
- [CHANGELOG.md](../CHANGELOG.md): gcportrait's release notes, newest first, one section per release; a
  version without a section takes its notes from the commits since the previous release tag.
- [LICENSE](../LICENSE): gcportrait's own work is licensed under the Apache License 2.0, with its attribution
  in [NOTICE](../NOTICE), except the gcportrait name and icon ([brand/LICENSE.md](../brand/LICENSE.md)); the
  root README's "Licence" section says what that means.
- [THIRD_PARTY.md](../THIRD_PARTY.md): every category of third-party material, why the dependency licences
  are compatible with the project licence, and the dependency licence table.
