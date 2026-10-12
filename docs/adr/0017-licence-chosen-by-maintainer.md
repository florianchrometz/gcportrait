<!-- SPDX-License-Identifier: MIT -->

# 0017. The licence is the maintainer's choice and is not inherited

- **Status:** accepted; decision taken and applied 2026-10-10 (`AGPL-3.0-only`, see "Decision taken"); amended
  2026-10-12: the MIT License, with the gcportrait name and icon reserved and no contributor licence agreement (see
  "Amended 2026-10-12: the MIT License")
- **Date:** 2026-10-08 (decision taken 2026-10-10; amended 2026-10-12)
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** [ADR 0001](0001-no-go-and-no-reuse-of-previous-code.md), [ADR 0019](0019-font-licence-exception.md), [THIRD_PARTY.md](../../THIRD_PARTY.md), [brand/LICENSE.md](../../brand/LICENSE.md)

## Context

The previous implementation shipped gcpviz's Apache-2.0 code with its NOTICE and Google copyright headers.
The maintainer wants to pick gcportrait's licence without any attribution or notice carried over, and may
decide late. Until then, every file still needs a machine-readable licence marker so the final choice can be
applied mechanically.

## Decision

- Until the maintainer chooses, `LICENSE` is a placeholder and every text source file carries the header
  `SPDX-License-Identifier: LicenseRef-gcportrait-TBD` (in the comment form of its file type).
  `scripts/set-license.mjs <SPDX-ID>` rewrites every header, every `package.json` `license` field and
  `LICENSE` in one commit, at the latest at the hand-off.
- Third-party material is limited to unmodified npm dependencies (their licence texts stay in
  `node_modules`) and Google's official product icons, vendored unmodified under Google's icon usage terms (a
  trademark permission, not a code licence) and documented in `packages/icons/README.md`.

## Consequences

- `pnpm provenance` fails on a missing or wrong header; `node scripts/check-provenance.mjs --list-exempt`
  prints the header form per file type and the exempt files. A new text file type needs a header form or a
  header-free entry in `scripts/lib/repo-files.mjs` first.
- `pnpm run licenses` (`scripts/check-licenses.mjs`) fails when any installed package, direct or transitive,
  has a licence outside the allowlist (MIT, MIT-0, ISC, 0BSD, BSD-2-Clause, BSD-3-Clause, Apache-2.0,
  CC0-1.0, Unlicense, BlueOak-1.0.0, Python-2.0, and MPL-2.0 because its copyleft is file-scoped), or when the
  generated dependency table in `THIRD_PARTY.md` is stale.
- `THIRD_PARTY.md` lists every category of third-party material. Verbatim licence texts under
  `scripts/licenses/` (AGPL-3.0-only, Apache-2.0, MIT) were added as a third category so that
  `set-license.mjs` needs no network; they are texts, not code.
- The maintainer had indicated a leaning during planning; it took effect when `set-license.mjs` ran (below).
- Self-hosted Roboto fonts are licensed under OFL-1.1, which the allowlist does not contain and
  whose licence must travel with the bundled files; [ADR 0019](0019-font-licence-exception.md), accepted with
  the decision below, handles that.

## Decision taken (2026-10-10)

- **Identifier:** gcportrait's own code is licensed under the GNU Affero General Public License, version 3
  only: SPDX `AGPL-3.0-only`. **Copyright holder:** Florian Chrometz; **year:** 2026. The maintainer decided
  on 2026-10-10, and the licence was applied the same day with
  `node scripts/set-license.mjs AGPL-3.0-only` (after a `--dry-run`): 954 SPDX headers and 12 `package.json`
  `license` fields rewritten, `LICENSE` written byte-identical to `scripts/licenses/AGPL-3.0-only.txt`.
  `pnpm provenance` now verifies every header against `AGPL-3.0-only` (it reads the root `package.json`).
- **Notice:** the root `NOTICE` file carries the AGPL "how to apply" notice (program name,
  "Copyright (C) 2026 Florian Chrometz", the notice paragraph in its version-3-only form, pointers to
  `THIRD_PARTY.md` and to the icons README for Google's trademark terms) and the non-affiliation long form (ADR 0018); the root
  `package.json` names the author.
- **Rationale:** a strong network copyleft keeps hosted modifications open (AGPL-3.0 §13), while the single
  copyright holder keeps future commercial use or dual licensing possible. That is why only dependencies whose
  licences do not force gcportrait to publish or relicense its own combined work may be used:
  `scripts/check-licenses.mjs` keeps the allowlist (permissive licences, file-scoped MPL-2.0, and the two
  OFL-1.1 font packages of ADR 0019) and adds an explicit deny list (GPL, LGPL, AGPL for dependencies, SSPL,
  CC-BY-SA, CC-BY-NC, EUPL, OSL, CPAL, EPL, CDDL, "SEE LICENSE IN", UNLICENSED, proprietary, unknown or
  absent), each with its reason; `THIRD_PARTY.md` records why every allowed licence is compatible with
  AGPL-3.0. Third-party material (npm dependencies, Google's icons, the licence texts in `scripts/licenses/`)
  keeps its own terms.
- **Network use (§13):** the running app offers its corresponding source: the shell footer shows
  "Source (AGPL-3.0)" on every route, linking to `sourceUrl` from `/api/config` (backend `SOURCE_URL`) or, in
  demo mode, to the build-time `VITE_SOURCE_URL`; both default to
  `https://github.com/florianchrometz/gcportrait` until the maintainer sets the real repository at hand-off.
  Self-hosters who run a modified version point `SOURCE_URL` at their modified source.
- **Contributions:** external contributions are accepted under `AGPL-3.0-only` (inbound = outbound), with
  the pull-request template's provenance statement. A contributor licence agreement, which the maintainer
  would need before offering the project under other terms as well, is a pending maintainer decision
  ([docs/backlog.md](../backlog.md)); none is in place.

## Amended 2026-10-12: the MIT License

The maintainer decided on 2026-10-12 to license gcportrait under the MIT License instead, aware of the trade-offs.
The decision above stays as the record of what was chosen first; where it and this section differ, this section
holds.

- **Identifier:** gcportrait's own work, its code, its texts and its images, is licensed under the MIT License: SPDX
  `MIT`, "Copyright (c) 2026 Florian Chrometz". Applied the same day with
  `node scripts/set-license.mjs MIT --holder "Florian Chrometz" --year 2026`: 1402 SPDX headers and 14
  `package.json` `license` fields rewritten, `LICENSE` written from `scripts/licenses/MIT.txt` with the copyright
  line, followed by a short note on what the licence does not cover. The `NOTICE` file, which carried the former
  licence's notice, was removed: an MIT project needs none for itself, and its pointers to the third-party material
  and its non-affiliation statement are in `THIRD_PARTY.md`. The former licence's text left `scripts/licenses/`.
- **Rationale:** the maintainer wants gcportrait to be a meaningful open-source contribution that anyone can use,
  study, change, embed and run, hosted or not, commercially or not, without conditions beyond keeping the copyright
  and permission notice. A network copyleft would have kept hosted modifications open, but it also keeps many people
  and organisations from adopting or building on a project at all; the maintainer accepts that modified versions may
  stay closed, and that others may offer gcportrait's code as part of their own services, in exchange for the widest
  possible use. The one thing the MIT License does not protect, the project's identity, is reserved separately
  (below).
- **The name and the icon are reserved:** "The gcportrait name and the gcportrait icon are not covered by the MIT
  License. They identify this project and may not be used to present other software or services as gcportrait or as
  endorsed by it; forks must use their own name and icon." The icon is `brand/icon.svg` and every rendering of it
  (the favicons, the website's logo and the app's mark, the wordmarks under `docs/media/brand/`, the mark on the
  link-preview images). [brand/LICENSE.md](../../brand/LICENSE.md) holds the text; `LICENSE`'s closing note,
  `THIRD_PARTY.md`, the README and the website's licence page repeat it.
- **Third-party material is unchanged:** it keeps its own terms as provided: the typefaces under the SIL Open Font
  License 1.1 ([ADR 0019](0019-font-licence-exception.md)), the Google Cloud product icons under Google's icon usage
  terms, the dependencies under their own licences (`THIRD_PARTY.md`).
- **Dependencies stay permissive:** an MIT project cannot carry copyleft code whose reach goes beyond the
  dependency's own files, so `scripts/check-licenses.mjs` keeps its allowlist and its deny list unchanged, the GPL
  and AGPL families included; only the reasons now name the MIT License (the combined work could no longer be
  offered under it).
- **No contributor licence agreement:** contributions are accepted under the MIT License, inbound = outbound, with
  the pull-request template's provenance statement ([docs/contributing.md](../contributing.md)). With a permissive
  licence nobody needs further rights, so the open question of a CLA is settled and left the backlog.
- **The source link stays, as a courtesy:** the MIT License asks nothing of whoever runs an instance, so the app's
  footer link to its source is no longer a licence obligation. It stays on every route as "Source (MIT)", linking to
  `SOURCE_URL` (or, in a demo build, `VITE_SOURCE_URL`), so the people who use an instance can see where its source
  is and under which licence.
- **The former licence cannot creep back:** `pnpm provenance` verifies every header against `MIT` (the root
  `package.json`) and, with its rule (h), refuses the former licence's name outside this record, `THIRD_PARTY.md`'s
  deny list, `scripts/check-licenses.mjs` and its test, the verbatim licence texts in `scripts/licenses/` and the
  released sections of a `CHANGELOG.md`.
