#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# handoff.sh: produces the clean gcportrait tree for the new public repository (ADRs 0001, 0007 and 0017;
# docs/handoff.md is the guide).
#
#   scripts/handoff.sh --message "gcportrait: initial commit" [--dest DIR] [--repository OWNER/NAME]
#
# It copies the files git lists for this checkout (tracked, plus untracked ones git does not ignore) without
# legacy/, so .git/, node_modules/, build output and every local or scratch file that .gitignore or
# .git/info/exclude ignores stay behind. It checks the copy: no legacy/, the same number of files as listed, the
# previous implementation's and its upstream's names nowhere but in docs/adr/, the provenance check, then
# `pnpm install --frozen-lockfile` and `pnpm check`. Only when all of that passes does it make the copy a new git
# repository with one commit on `main`, and print what the maintainer does next. It changes nothing in this
# repository. On a failure the copy is left in place for a look and has no commit.

set -Eeuo pipefail
unset CDPATH

usage() {
  cat <<'USAGE'
Usage: scripts/handoff.sh --message MESSAGE [options]

Copies this repository into a new directory without legacy/, .git/ and anything git ignores (node_modules/,
build output, local and scratch files), checks the copy (provenance, the previous implementation's names,
pnpm install --frozen-lockfile, pnpm check), and makes it a new git repository with a single commit on main.
Then prints what to do next. It changes nothing in this repository.

  -m, --message MESSAGE    The message of the new repository's one commit (required).
  --dest DIR               Where the new tree goes; it must not exist, or be empty (default: gcportrait next to
                           this repository, ../gcportrait from its root).
  --repository OWNER/NAME  The GitHub repository the tree will be pushed to, for the next steps (default: the
                           one DEFAULT_SOURCE_URL in backend/src/config.ts names).
  --allow-dirty            Copy uncommitted changes and untracked files as they are (default: refuse while
                           git status lists anything outside legacy/).
  -h, --help               This help.

Needs bash 3.2 or newer, git 2.28 or newer, tar, Node 22 and pnpm (corepack enable), and git's user.name and
user.email for the commit. Exit status 0 when the tree is ready, 1 when a check failed (the copy is left in
place, without a commit), 2 when nothing was copied (a usage error or a refusal).
USAGE
}

say() { printf 'handoff: %s\n' "$*"; }
refuse() {
  printf 'handoff: %s\n' "$*" >&2
  exit 2
}
fail() {
  printf 'handoff: FAILED: %s\n' "$*" >&2
  if [ -n "${DEST:-}" ] && [ -d "$DEST" ]; then
    printf 'handoff: the copy stays at %s for a look; remove it (rm -rf "%s") before you run this again.\n' \
      "$DEST" "$DEST" >&2
  fi
  exit 1
}
# Prints the non-empty lines of its arguments (lists of paths, one per line) to standard error.
list_paths() { printf '%s\n' "$@" | sed '/^$/d' >&2; }

# The names of the previous implementation and of the upstream tool it wrapped (ADR 0001), assembled here so that
# this file does not contain them: scripts/check-provenance.mjs forbids them outside the ADRs.
OLD_NAMES="$(printf '%s|%s|%s' 'gcp''viz' 'kno''yog' 'for''seti')"
# Where the new tree may still name them: the decision records.
NAMES_ALLOWED='^docs/adr/'

MESSAGE=""
DEST_ARG=""
REPOSITORY=""
ALLOW_DIRTY=0

need_value() { [ "$#" -ge 2 ] && [ -n "$2" ] || refuse "$1 needs a value (see --help)"; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    -m | --message) need_value "$@"; MESSAGE="$2"; shift 2 ;;
    --dest) need_value "$@"; DEST_ARG="$2"; shift 2 ;;
    --repository) need_value "$@"; REPOSITORY="$2"; shift 2 ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) refuse "unknown argument: $1 (see --help)" ;;
  esac
done

[ -n "$MESSAGE" ] || { usage >&2; refuse "--message is required"; }
if [ -n "$REPOSITORY" ] && ! [[ "$REPOSITORY" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]]; then
  refuse "--repository must be OWNER/NAME, such as florianchrometz/gcportrait"
fi
for tool in git tar node pnpm; do
  command -v "$tool" >/dev/null 2>&1 || refuse "$tool is not on PATH (see --help)"
done

# --- the source: the checkout this script belongs to -----------------------------------------------------------

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
top="$(git -C "$SRC" rev-parse --show-toplevel 2>/dev/null)" || refuse "$SRC is not a git checkout"
top="$(cd "$top" && pwd -P)"
[ "$top" = "$SRC" ] || refuse "$SRC is not the root of its git checkout ($top is)"

dirty="$(git -C "$SRC" status --porcelain --untracked-files=normal -- . ':(exclude)legacy')"
if [ -n "$dirty" ] && [ "$ALLOW_DIRTY" -eq 0 ]; then
  printf '%s\n' "$dirty" | head -n 20 >&2
  refuse "the checkout has uncommitted changes or untracked files (above, at most 20); commit them first, or pass --allow-dirty to copy them as they are"
fi

# DEFAULT_SOURCE_URL: the target of the app's "Source (MIT)" link when SOURCE_URL and VITE_SOURCE_URL are unset.
source_url_in() {
  { sed -n "s/^export const DEFAULT_SOURCE_URL = '\([^']*\)';.*/\1/p" "$1" 2>/dev/null || true; } | head -n 1
}
BACKEND_SOURCE_URL="$(source_url_in "$SRC/backend/src/config.ts")"
FRONTEND_SOURCE_URL="$(source_url_in "$SRC/frontend/src/source.ts")"
GITHUB_URL_PATTERN='^https://github\.com/([A-Za-z0-9-]+/[A-Za-z0-9._-]+)$'
if [ -z "$REPOSITORY" ]; then
  if [[ "${BACKEND_SOURCE_URL%/}" =~ $GITHUB_URL_PATTERN ]]; then
    REPOSITORY="${BASH_REMATCH[1]%.git}"
  else
    refuse "DEFAULT_SOURCE_URL in backend/src/config.ts names no GitHub repository ('$BACKEND_SOURCE_URL'); pass --repository OWNER/NAME"
  fi
fi
REPOSITORY_URL="https://github.com/$REPOSITORY"
OWNER="${REPOSITORY%%/*}"
OWNER_LOWER="$(printf '%s' "$OWNER" | tr '[:upper:]' '[:lower:]')"

# --- the destination ---------------------------------------------------------------------------------------------

[ -n "$DEST_ARG" ] || DEST_ARG="$(dirname "$SRC")/gcportrait"
dest_parent="$(dirname "$DEST_ARG")"
[ -d "$dest_parent" ] || refuse "the directory --dest goes into, $dest_parent, does not exist"
dest_path="$(cd "$dest_parent" && pwd -P)/$(basename "$DEST_ARG")"
case "$dest_path/" in
  "$SRC/"*) refuse "--dest must lie outside this repository" ;;
esac
case "$SRC/" in
  "$dest_path/"*) refuse "--dest must not contain this repository" ;;
esac
if [ -e "$dest_path" ] || [ -L "$dest_path" ]; then
  if ! [ -d "$dest_path" ] || [ -L "$dest_path" ] || [ -n "$(ls -A "$dest_path")" ]; then
    refuse "$dest_path already exists; remove it or choose another --dest"
  fi
fi
DEST="$dest_path"

say "from $SRC"
say "to   $DEST"
[ -z "$dirty" ] || say "copying uncommitted changes and untracked files as they are (--allow-dirty)"

# --- the file list: git's, without legacy/ ----------------------------------------------------------------------

LIST="$(mktemp "${TMPDIR:-/tmp}/gcportrait-handoff.XXXXXX")"
trap 'rm -f "$LIST"' EXIT
listed=0
legacy_left=0
deleted_left=0
while IFS= read -r -d '' path; do
  case "$path" in
    legacy | legacy/*) legacy_left=$((legacy_left + 1)); continue ;;
  esac
  if [ -L "$SRC/$path" ] || [ -f "$SRC/$path" ]; then
    printf '%s\0' "$path" >>"$LIST"
    listed=$((listed + 1))
  elif [ -d "$SRC/$path" ]; then
    refuse "$path is a directory in git's file list (a submodule?); the hand-off copies files only"
  else
    deleted_left=$((deleted_left + 1)) # deleted in the working tree, still in the index (--allow-dirty)
  fi
done < <(git -C "$SRC" ls-files -z --cached --others --exclude-standard)
[ "$listed" -gt 0 ] || refuse "git lists no files to copy"

# --- copy ---------------------------------------------------------------------------------------------------------

mkdir -p "$DEST"
# COPYFILE_DISABLE keeps macOS's tar from carrying extended attributes along as ._ files.
COPYFILE_DISABLE=1 tar -C "$SRC" --null -T "$LIST" -cf - | tar -C "$DEST" -xpf - || fail "copying the files failed"

say "copied $listed files; left out legacy/ ($legacy_left files), .git/ and everything git ignores"
[ "$deleted_left" -eq 0 ] || say "left out $deleted_left files that are deleted in the working tree"

# --- check the copy ---------------------------------------------------------------------------------------------

[ ! -e "$DEST/legacy" ] || fail "the copy contains legacy/"
copied="$(cd "$DEST" && find . \( -type f -o -type l \) | wc -l | tr -d ' ')"
[ "$copied" = "$listed" ] || fail "the copy holds $copied files, git listed $listed"

mentions="$(cd "$DEST" && { grep -rIilE -- "$OLD_NAMES" . 2>/dev/null || true; } | sed 's|^\./||' |
  { grep -vE "$NAMES_ALLOWED" || true; } | sort)"
named="$(cd "$DEST" && find . -mindepth 1 | sed 's|^\./||' | { grep -iE -- "$OLD_NAMES" || true; } |
  { grep -vE "$NAMES_ALLOWED" || true; } | sort)"
if [ -n "$mentions$named" ]; then
  list_paths "$mentions" "$named"
  fail "the files above name the previous implementation or its upstream outside docs/adr/"
fi
say "the previous implementation's names appear only in docs/adr/"

# --- a new repository; staged now, committed only after the checks -------------------------------------------------

git -C "$DEST" init --quiet --initial-branch=main || fail "git init failed (git 2.28 or newer is needed)"
author_name="${GIT_AUTHOR_NAME:-$(git -C "$DEST" config user.name || true)}"
author_email="${GIT_AUTHOR_EMAIL:-$(git -C "$DEST" config user.email || true)}"
if [ -z "$author_name" ] || [ -z "$author_email" ]; then
  fail "git has no user.name or user.email for the commit (git config --global user.name ..., user.email ...)"
fi
git --literal-pathspecs -C "$DEST" add --force --pathspec-from-file="$LIST" --pathspec-file-nul ||
  fail "staging the files failed"
staged="$(git -C "$DEST" ls-files -z | tr -cd '\000' | wc -c | tr -d ' ')"
[ "$staged" = "$listed" ] || fail "git staged $staged files, $listed were copied"

say "provenance check in the new tree"
(cd "$DEST" && node scripts/check-provenance.mjs) || fail "the provenance check failed in the new tree"

say "pnpm install --frozen-lockfile in the new tree"
(cd "$DEST" && pnpm install --frozen-lockfile) || fail "pnpm install --frozen-lockfile failed in the new tree"
say "pnpm check in the new tree"
(cd "$DEST" && pnpm check) || fail "pnpm check failed in the new tree"

changed="$(git -C "$DEST" diff --name-only)"
added="$(git -C "$DEST" ls-files --others --exclude-standard)"
if [ -n "$changed$added" ]; then
  list_paths "$changed" "$added"
  fail "the checks changed or added the files above, which git does not ignore"
fi

git -C "$DEST" commit --quiet -m "$MESSAGE" || fail "git commit failed"
commits="$(git -C "$DEST" rev-list --count HEAD)"
[ "$commits" = 1 ] || fail "the new repository has $commits commits"
[ -z "$(git -C "$DEST" status --porcelain)" ] || fail "the new repository is not clean after its commit"
commit="$(git -C "$DEST" rev-parse --short HEAD)"
subject="$(git -C "$DEST" log -1 --format=%s)"
author="$(git -C "$DEST" log -1 --format='%an <%ae>')"

# --- what the maintainer does next ----------------------------------------------------------------------------------

workflow_names() { # prefix (vars or secrets): the names the workflows read, comma-separated on one line
  { grep -ohE "$1\.[A-Z0-9_]+" "$DEST"/.github/workflows/*.yml 2>/dev/null || true; } | sed "s/^$1\.//" |
    { grep -vx 'GITHUB_TOKEN' || true; } | sort -u | paste -sd ',' - | sed 's/,/, /g'
}
VARIABLES="$(workflow_names vars)"
SECRETS="$(workflow_names secrets)"

if [ "$BACKEND_SOURCE_URL" = "$REPOSITORY_URL" ] && [ "$FRONTEND_SOURCE_URL" = "$REPOSITORY_URL" ]; then
  source_step="DEFAULT_SOURCE_URL already names $REPOSITORY_URL in backend/src/config.ts and
   frontend/src/source.ts, so the app's \"Source (MIT)\" link leads to the new repository: nothing to change."
else
  source_step="Set DEFAULT_SOURCE_URL to $REPOSITORY_URL. It is '$BACKEND_SOURCE_URL' in backend/src/config.ts
   and '$FRONTEND_SOURCE_URL' in frontend/src/source.ts; change both, and the tests that pin it
   (backend/src/config.test.ts, frontend/src/App.test.tsx), in $DEST, then run pnpm check and commit.
   grep -rn 'github.com/' --exclude-dir=node_modules . lists the other places that name the repository
   (README, docs, infra/common.sh's PUBLISHED_IMAGE, website/src/site.ts)."
fi

cat <<EOF

handoff: done in $((SECONDS / 60)) min $((SECONDS % 60)) s. The new repository, $listed files in one commit on main:
  $DEST
  $commit "$subject", by $author
  Left out: legacy/ ($legacy_left files), .git/ and everything git ignores. Checked: the provenance check, the
  previous implementation's names (only in docs/adr/), pnpm install --frozen-lockfile and pnpm check, all
  green. node_modules/ and the build output the checks wrote are ignored, not committed.

What you do next (docs/handoff.md, "After the script"):

1. Create the GitHub repository $REPOSITORY: https://github.com/new, owner $OWNER, name ${REPOSITORY#*/},
   Public, and nothing added (no README, .gitignore or licence: the tree has its own).

2. Push the one commit:
     cd $DEST
     git remote add origin $REPOSITORY_URL.git
     git push -u origin main

3. Set the repository's variables and secrets (Settings > Secrets and variables > Actions). The workflows read
   the variables ${VARIABLES:-(none)}
   and the secrets ${SECRETS:-(none)} (and GitHub's own GITHUB_TOKEN).
   - GitHub Pages (docs/website.md, "Deploying to GitHub Pages" and "DNS records"): the legal pages the footer
     links online, Settings > Pages > Source "GitHub Actions", the github-pages environment allowing main and
     v*, the verified domain, the DNS records, the custom domain gcportrait.app with HTTPS enforced, and last
     the variable PAGES_DEPLOY = true.
   - No cloud account: the site and the demo at gcportrait.app/demo/ are one GitHub Pages site (docs/website.md,
     "The demo"), and the release workflow pushes to ghcr.io with its own GITHUB_TOKEN.
   - Settings > Advanced Security: Dependabot alerts and Dependabot security updates on (docs/security.md, O7).

4. $source_step

5. Tag v1.0.0 (docs/contributing.md, "9. Releases"). The tree is already version 1.0.0, with its
   changelog, so there is nothing to version:
   - Actions > Release > Run workflow on main publishes the image as dev and creates the package
     ghcr.io/$OWNER_LOWER/gcportrait, private; make it public (its Package settings > Change visibility).
   - Then the tag:
       cd $DEST
       git tag v1.0.0
       git push origin v1.0.0
     The tag publishes the image (1.0.0, 1.0, latest), the GitHub release and, once PAGES_DEPLOY is true,
     the website.
EOF
