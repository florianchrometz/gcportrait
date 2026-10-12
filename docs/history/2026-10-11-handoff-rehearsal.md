<!-- SPDX-License-Identifier: MIT -->

# The hand-off script's rehearsal (2026-10-11)

The record of `scripts/handoff.sh` run on a scratch copy of this repository, as docs/handoff.md carried it under
"Verified on 2026-10-11" until 2026-10-12, when it moved here: the hand-off guide says what to do, and dated runs
belong in history/. Kept as written and not updated; only the links were adjusted to this folder.

On a scratch copy of this repository, never on the repository itself, macOS 27.0, Node 22.23.2, pnpm 10.18.1,
git 2.54. The copy was a `git clone` of `main` at `03b006b` with the hand-off script committed on top (`925a6ff`),
plus files that must stay behind: an ignored `.claude/`, `backend/.env`, `coverage/` and `out/`, and a
stand-in `.gcportrait-oauth-client.local.txt` that only the clone's `.git/info/exclude` ignores. The commit
identity was a rehearsal one. `SCRATCH` stands for the scratch directory; `...` marks output left out (the
install's package list, the checks' own progress, and the lines that named the planning document of the build,
which the tree no longer holds), and `…` the licence identifier the checks printed before the licence decision of
2026-10-12 (ADR 0017).

```text
$ scripts/handoff.sh --message "gcportrait: a portrait of your Google Cloud environment"
handoff: from SCRATCH/build-site
handoff: to   SCRATCH/gcportrait
handoff: copied 2323 files; left out legacy/ (103 files), .git/ and everything git ignores
...
handoff: provenance check in the new tree
provenance: OK. 2323 files scanned, 1298 SPDX headers (…) verified; no legacy imports, forbidden names or banned files.
handoff: pnpm install --frozen-lockfile in the new tree
...
Done in 7.9s using pnpm v10.18.1
handoff: pnpm check in the new tree
...
All matched files use Prettier code style!
...
 Test Files  313 passed (313)
      Tests  7565 passed (7565)
...
catalog:check: OK.
provenance: OK. 2324 files scanned, 1299 SPDX headers (…) verified; no legacy imports, forbidden names or banned files.
...
licenses: OK. 558 installed packages are under allowed licences; the workspace packages (13) declare …; THIRD_PARTY.md is up to date.

handoff: done in 3 min 53 s. The new repository, 2323 files in one commit on main:
  SCRATCH/gcportrait
  c85d513 "gcportrait: a portrait of your Google Cloud environment", by gcportrait rehearsal <rehearsal@example.com>
...
```

The second provenance pass, inside `pnpm check`, counts one file more: the compiled catalog module that
`pnpm install` writes (`packages/catalog/src/generated/compiled-catalog.ts`, ignored, not committed). The next
steps it printed are the ones in [After the script](../handoff.md#after-the-script). Then, in the new tree:

```text
$ git rev-list --count HEAD
1
$ git status --porcelain
$ git ls-files | wc -l
    2323
$ git -C ../build-site ls-files | grep -vc "^legacy/"
2323
$ ls -d legacy .gcportrait-oauth-client.local.txt backend/.env out .claude coverage
ls: .claude: No such file or directory
ls: .gcportrait-oauth-client.local.txt: No such file or directory
ls: backend/.env: No such file or directory
ls: coverage: No such file or directory
ls: legacy: No such file or directory
ls: out: No such file or directory
$ names="$(printf '%s%s|%s%s|%s%s' gcp viz kno yog for seti)"
$ git ls-files -z | xargs -0 grep -IilE "$names"
...
docs/adr/0001-no-go-and-no-reuse-of-previous-code.md
docs/adr/0006-clean-room-layout-engine.md
docs/adr/0007-legacy-tree-quarantine.md
docs/adr/0017-licence-chosen-by-maintainer.md
$ git ls-files | grep -iE "$names" | grep -vc "^docs/adr/"
0
```

Steps 2 and 5 of [After the script](../handoff.md#after-the-script) were rehearsed in the same tree on 2026-10-11, with a
bare repository in the scratch directory standing in for GitHub (`git init --bare origin.git`, and its
`file://` address as `origin`), in the order of that day: the major changeset and `pnpm release:version` ran
after the hand-off commit, as a second commit before the tag. The push, the release commit and the tag went
through; after `pnpm release:version` every `@gcportrait/*` package was at 1.0.0 (the root `package.json` is not
a workspace package of the release, so changesets leaves it alone: it was set to 1.0.0 by hand and stays
there until someone bumps it), `.changeset/` held only `README.md` and `config.json`, the
release commit passed `pnpm check` (the website's changelog test counts the pending changesets, so none is
fine), and `node scripts/release-notes.mjs --tag v1.0.0` printed the non-affiliation long form, then the major
change. Without a major changeset, `pnpm exec changeset version` puts the packages at 0.1.0. Since then the
tree is versioned before the hand-off, so the one commit is already 1.0.0 and step 5 only tags it. What the
rehearsal cannot show: GitHub itself (creating the repository, the settings, the Pages deployment) and the
release workflow's run on a real tag.

A first run of the same kind, before a formatting fix in this change, failed as designed: `pnpm check` stopped
at `format:check` on one file, the script printed `handoff: FAILED: pnpm check failed in the new tree`, exited
with status 1 and left the copy without a commit. `scripts/handoff.test.ts` (part of `pnpm test`) runs the
script on a small fixture repository with a stand-in for `pnpm`, covering each refusal and failure above.
