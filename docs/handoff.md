<!-- SPDX-License-Identifier: MIT -->

# The hand-off: a clean public repository

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.

This repository is gcportrait's build site: next to gcportrait it holds the previous implementation under
`legacy/` and the whole history of both. The public home of gcportrait starts as a new repository with neither
([ADR 0001](adr/0001-no-go-and-no-reuse-of-previous-code.md), [ADR 0007](adr/0007-legacy-tree-quarantine.md),
[ADR 0017](adr/0017-licence-chosen-by-maintainer.md)). `scripts/handoff.sh` produces that repository: a copy of
this tree without `legacy/`, checked, with a single commit. This guide is for the maintainer, who runs it once,
and then creates the GitHub repository, pushes and tags 1.0.0. The tree is versioned before the hand-off: every
`@gcportrait/*` package is at 1.0.0 and `CHANGELOG.md` has its 1.0.0 section, so the one commit is the
release. The licence needs nothing at hand-off: the project is under the MIT License (`MIT`, ADR 0017), and the
new tree carries the headers, `LICENSE` and `brand/LICENSE.md` as they are.

`scripts/handoff.test.ts` (part of `pnpm test`) runs the script on a small fixture repository with a stand-in for
`pnpm`, covering each refusal and failure below. A rehearsal on a scratch copy of this repository is recorded in
[history/2026-10-11-handoff-rehearsal.md](history/2026-10-11-handoff-rehearsal.md).

## Before you run it

- **Commit everything that goes public** on `main`. The script refuses while `git status` lists a change or an
  untracked file outside `legacy/`, so the new repository holds exactly the files of a commit of this one.
  (`--allow-dirty` copies the working tree as it is, for a rehearsal.)
- **Fill in the author page.** `docs/author.md` still holds placeholders (the job title, the profile links, the
  bio paragraph); a deploying website build refuses the file until none is left. A portrait is optional and
  needs its licence stated before it is committed.
- **Publish the legal pages on your own website.** The website and the demo link the Impressum and the privacy
  notice there ([ADR 0032](adr/0032-hosted-surfaces-and-domains.md)); [legal/](legal/README.md) is the fact sheet
  the privacy notice is checked against.
- **Check the identity of the commit.** The new repository's one commit carries git's `user.name` and
  `user.email` (`git config --global user.name`, `git config --global user.email`) and is signed if your git
  configuration signs commits. The script stops before the checks when either is missing.
- **Check the repository you will push to.** The next steps assume the one that `DEFAULT_SOURCE_URL` names in
  `backend/src/config.ts` and `frontend/src/source.ts`, `https://github.com/florianchrometz/gcportrait` today.
  For another one, pass `--repository OWNER/NAME` (step 4 below then says what to change).
- **Tools:** bash 3.2 or newer, git 2.28 or newer, `tar`, Node 22 (22.22.2 or newer) and pnpm through
  Corepack (`corepack enable`), as for any checkout ([contributing.md](contributing.md), section 1), and the
  network for `pnpm install` unless pnpm's store already holds every package.
- **A free destination.** By default the new tree goes to `gcportrait` next to this repository (`../gcportrait`
  from its root); it must not exist, or be an empty directory. A clone of the new repository is not empty (it
  holds `.git/`): the empty clone at `../gcportrait` on the maintainer's machine must be removed first, or
  `--dest` must name another directory ([backlog.md](backlog.md), "The hand-off machine").

## Running it

From the root of this repository:

```sh
scripts/handoff.sh --message "gcportrait: a portrait of your Google Cloud environment"
```

It takes a few minutes, nearly all of them `pnpm install` and `pnpm check` in the new tree, and prints each
step, the checks' own output and, at the end, what to do next ([After the script](#after-the-script)). It
changes nothing in this repository.

| Flag | What it does |
|---|---|
| `--message MESSAGE` (`-m`) | The message of the new repository's one commit. Required. |
| `--dest DIR` | Where the new tree goes, instead of `gcportrait` next to this repository. The directory it goes into must exist; `DIR` itself must not exist (or must be empty) and must lie outside this repository. |
| `--repository OWNER/NAME` | The GitHub repository the tree will be pushed to, used in the next steps. Default: the one `DEFAULT_SOURCE_URL` names. |
| `--allow-dirty` | Copy uncommitted changes and untracked files (those git does not ignore) as they are, and leave out files deleted in the working tree. For rehearsals; the real hand-off copies a commit. |
| `--help` (`-h`) | The usage text. |

## What it does

1. **Lists the files** git knows for this checkout: the tracked ones, plus (with `--allow-dirty`) the untracked
   ones git does not ignore. It drops everything under `legacy/`.
2. **Copies** them into the destination, file modes included (an executable script stays executable).
3. **Checks the copy:** no `legacy/`, exactly as many files as listed, and the names of the previous
   implementation and of the upstream tool it wrapped nowhere but in `docs/adr/` (the decision records), in
   file contents and in file and directory names. This is
   stricter than the provenance check, which also allows them in `packages/icons/README.md`; the checker itself
   assembles them at run time, so it does not name them either.
4. **Makes the copy a git repository** on the branch `main` and stages exactly the copied files, but does not
   commit yet.
5. **Runs the provenance check** (`node scripts/check-provenance.mjs`) in the new tree: SPDX headers, forbidden
   names, banned files, no symbolic links.
6. **Runs `pnpm install --frozen-lockfile` and `pnpm check`** in the new tree: formatting, lint, types, every
   unit test, the asset catalog, provenance again and the dependency licences, on the files the new repository
   will hold, without this repository's `node_modules/` or build output.
7. **Checks that the checks left the tree as it was:** no copied file changed, no new file that git does not
   ignore (`node_modules/`, the compiled catalog and the other build output are ignored).
8. **Commits** with your message, then confirms: one commit, a clean `git status`.
9. **Prints what to do next**, filled in with the repository, its owner and the destination.

What is left out, and why:

| Left out | Why |
|---|---|
| `legacy/` | The previous implementation, quarantined since 2026-10-08 (ADR 0007); the public repository starts without it (ADR 0001). |
| `.git/` | This repository's history, which includes the previous implementation; the new repository has its own, one commit long. |
| Everything `.gitignore` ignores | `node_modules/`, build output (`dist/`, `website/dist/`, `coverage/`, `.astro/`, `.vite/`, the compiled catalog in `packages/catalog/src/generated/`), scratch output (`out/`, `*.local.png`, `*.local.svg`, the Playwright results), logs, local environment files (`.env`, `.env.*` except `.env.example`) and the per-user assistant settings in `.claude/`. |
| Everything `.git/info/exclude` ignores | Files excluded in this clone only, such as `.gcportrait-oauth-client.local.txt` (a local note about the maintainer's OAuth client). A plain copy of the directory would have taken it along; the script copies git's list, never the directory. |

Everything else is copied: the code, the docs with the spikes and the backlog, the ADRs, `.changeset/` (its
README and configuration; the 1.0.0 release consumed the changesets), the generated media in `docs/media/`,
`.github/`, `.agents/`.

## When it fails

| Exit status | Meaning |
|---|---|
| 0 | The new repository is ready, with one commit. |
| 1 | A check failed (the message says which, and lists the files at fault). The copy stays in the destination, without a commit, for a look; remove it before you run the script again. |
| 2 | Nothing was copied: a usage error, uncommitted changes, an existing or overlapping destination, or a missing tool. |

Fix a failure in this repository, commit, remove the destination and run the script again. It is cheap to
repeat.

## After the script

The script prints these steps, filled in for the repository and the destination. Shown here for
`florianchrometz/gcportrait` and the default destination.

1. **Create the GitHub repository** `florianchrometz/gcportrait`: <https://github.com/new>, owner
   `florianchrometz`, name `gcportrait`, Public, and nothing added (no README, `.gitignore` or licence: the tree
   has its own).
2. **Push the one commit:**

   ```sh
   cd ../gcportrait
   git remote add origin https://github.com/florianchrometz/gcportrait.git
   git push -u origin main
   ```

   The push to `main` runs two workflows for the first time: `CI` (`pr.yml`) and `Website` (`pages.yml`), which
   builds and checks the site and deploys nothing until step 3 switches it on. The asset-type and icon drift
   checks run on their weekly schedules.
3. **Set the repository's variables and secrets** (Settings > Secrets and variables > Actions). The workflows
   read these, and nothing else besides GitHub's own `GITHUB_TOKEN`:

   | Name | Kind | For |
   |---|---|---|
   | `PAGES_DEPLOY` | variable | `true` switches on the website's deployment to GitHub Pages from `main` and from each `v*` tag. Set it last, after the Pages source ("GitHub Actions"), the `github-pages` environment allowing `main` and `v*`, the verified domain, the DNS records and the custom domain `gcportrait.app` with HTTPS enforced: [website.md, "Deploying to GitHub Pages" and "DNS records"](website.md#deploying-to-github-pages), which has the exact records. |

   The release workflow needs no variable, no secret and no Workload Identity Federation: it publishes the image
   to GitHub Container Registry with its own `GITHUB_TOKEN`. Under Settings > Advanced Security, switch on
   Dependabot alerts and Dependabot security updates ([security.md](security.md), finding O7).
4. **`DEFAULT_SOURCE_URL`**, the target of the app's "Source (MIT)" link when an instance sets neither
   `SOURCE_URL` nor `VITE_SOURCE_URL`. It already names
   `https://github.com/florianchrometz/gcportrait` in `backend/src/config.ts` and `frontend/src/source.ts`, so
   for that repository there is nothing to change. For another one (`--repository`), the script says to change
   both constants and the tests that pin them (`backend/src/config.test.ts`, `frontend/src/App.test.tsx`) in the
   new repository, run `pnpm check` and commit; the README, the docs, `infra/common.sh` (`PUBLISHED_IMAGE`) and
   `website/src/site.ts` name the repository too.
5. **Tag v1.0.0** (the release workflow is described in [contributing.md, "9.
   Releases"](contributing.md#9-releases)):
   - Actions > Release > Run workflow, on `main`: publishes the image as `dev` and creates the package
     `ghcr.io/florianchrometz/gcportrait`, private. Make it public (the package's Package settings > Change
     visibility); a tag release fails at its pull check while it is not.
   - The tag. The tree is already at 1.0.0 (every `@gcportrait/*` package shares one version, and the one major
     changeset was consumed before the hand-off), so nothing is versioned here:

     ```sh
     cd ../gcportrait
     git tag v1.0.0
     git push origin v1.0.0
     ```

     The tag runs `release.yml`: it checks and builds the tag, publishes the image as `1.0.0`, `1.0` and
     `latest`, creates the GitHub release with notes from the `CHANGELOG.md` files and, while `PAGES_DEPLOY` is
     `true`, deploys the website.

The maintainer's demo is a static build inside the website (`gcportrait.app/demo/`, ADR 0034); a self-hosted demo-only instance comes from the released image: [self-host-options.md, "Demo-only
instance"](self-host-options.md#demo-only-instance) and ["Custom domain"](self-host-options.md#custom-domain), and
[ADR 0032](adr/0032-hosted-surfaces-and-domains.md).

## What the new tree says about `legacy/`

The hand-off removes the directory, not the text about it, and that text is written to be true in both
repositories: `agents.md` (hard rule 11), [contributing.md](contributing.md), the contributor-workflow skill
and ADR 0007 say that `legacy/` exists only in the build repository and that nothing may touch, import or copy
it. The rules keep working without it: ESLint and the provenance check reject an import of a `legacy/` path
whether the directory exists or not, and CI's self-test of the provenance check plants such an import itself.
The root README, [self-host.md](self-host.md) and [self-host-options.md](self-host-options.md) name the
public repository's clone address, its releases and the "Open in Cloud Shell" and "Run on Google Cloud" buttons as
they work once the repository is public and 1.0.0 is released.
