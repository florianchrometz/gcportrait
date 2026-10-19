#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Install a gcportrait release without a checkout; served unchanged at https://gcportrait.app/install.sh.
# Run with --help for standalone or piped usage, prerequisites and exit behavior (usage below).
# Rules: infra/AGENTS.md, Self-hosting. Requires bash 3.2 or newer.
#
# Everything below is defined first and run by the last line, so bash has read the whole file before it runs any of
# it: a download cut short runs nothing.

set -euo pipefail

REPOSITORY="florianchrometz/gcportrait"
GITHUB_URL="https://github.com/${REPOSITORY}"
LATEST_API_URL="https://api.github.com/repos/${REPOSITORY}/releases/latest"
# A release tag, as .github/workflows/release.yml publishes them: v, then a semantic version.
TAG_PATTERN='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
SHA256_PATTERN='^[0-9a-f]{64}$'
# The long form of the non-affiliation statement, which closes --help as it closes deploy.sh's (infra/common.sh;
# scripts/non-affiliation-copies.test.ts keeps the copies equal). This file stands alone: it runs before common.sh
# is downloaded.
NON_AFFILIATION_LONG="gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are trademarks of Google and are used under Google's icon usage terms."

if [ -t 1 ]; then
  BOLD=$'\033[1m' RED=$'\033[31m' RESET=$'\033[0m'
else
  BOLD="" RED="" RESET=""
fi

usage() {
  printf 'gcportrait install.sh\n\n'
  cat <<'USAGE'
Usage: curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project PROJECT_ID [options]
       bash install.sh --project PROJECT_ID [options]

Deploys gcportrait to Cloud Run in PROJECT_ID from a release, without a clone of the repository: it downloads
the release's deploy scripts (gcportrait-deploy-TAG.tar.gz) and checksums.txt, checks the archive's SHA-256
before anything is unpacked or run, keeps the scripts in a directory of their own and runs their
infra/deploy.sh --image TAG with the other arguments. The project id is all it needs; every infra/deploy.sh
flag passes through unchanged (docs/configuration.md lists them), such as --dry-run to see every change first,
--region, or --oauth-client-id for the redeploy once the OAuth client exists.

Installer options:
  --version TAG           The release to deploy, such as v1.2.3 (default: the newest release).
  --dir PATH              Where to keep the scripts: a new or empty directory (default: gcportrait-TAG in the
                          current directory, or gcportrait-TAG-2 and so on when that one holds other files).
  -h, --help              This help.

Needs curl, tar, sha256sum or shasum, and the Google Cloud CLI (gcloud), signed in. --build is not offered
here: it builds the image from a clone of the source (docs/contributing.md). The exit status is deploy.sh's,
and 1 when the installer refuses: a missing tool, a bad option, a download or a checksum that fails.
USAGE
  printf '\n%s\n' "$NON_AFFILIATION_LONG" | fold -s -w 110 | sed 's/ *$//'
}

step() { printf '\n%s==> %s%s\n' "$BOLD" "$1" "$RESET"; }
say() { printf '    %s\n' "$*"; }
refuse() {
  printf '%serror:%s %s\n' "$RED" "$RESET" "$*" >&2
  exit 1
}
need_value() { [[ $# -ge 2 && -n "${2:-}" && "${2:-}" != --* ]] || refuse "$1 needs a value (see --help)"; }

# The download directory: removed when the installer exits, and just before deploy.sh takes over.
WORK=""
cleanup() { [ -z "$WORK" ] || rm -rf "$WORK"; }

# fetch URL FILE: downloads URL to FILE over https only (redirects included), failing on an HTTP error. Standard input
# is closed, so nothing can read the rest of this script when it comes through a pipe.
fetch() {
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --retry 2 --max-time 300 \
    --output "$2" "$1" </dev/null
}

# holds_release DIR STAGE: whether DIR holds every file of STAGE with the same bytes (an earlier run of the same
# release). Other files in DIR, such as a .DS_Store that Finder left, do not count.
holds_release() {
  local file
  [ -d "$1" ] || return 1
  while IFS= read -r file; do
    cmp -s "$2/$file" "$1/$file" || return 1
  done < <(cd "$2" && find . -type f)
}

# sha256 FILE: the file's SHA-256 in lowercase hex, with whichever tool there is (checked up front).
SHA256_TOOL=""
sha256() {
  if [ "$SHA256_TOOL" = sha256sum ]; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{ print tolower($1) }'
}

# latest_release: sets LATEST_TAG to the tag of the newest release (GitHub's "latest": never a pre-release), from the
# GitHub API without a token, or, when the API refuses (it allows 60 requests an hour per address), from where
# github.com redirects /releases/latest. Refuses when there is none.
LATEST_TAG=""
latest_release() {
  local answer tag="" location=""
  if answer="$(curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --max-time 30 \
    --header 'Accept: application/vnd.github+json' "$LATEST_API_URL" </dev/null 2>/dev/null)"; then
    tag="$(printf '%s\n' "$answer" | tr ',{}' '\n' |
      sed -n 's/^[[:space:]]*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | sed -n '1p')"
    [ -z "$tag" ] || say "$tag (the GitHub API)"
  fi
  if [ -z "$tag" ]; then
    say "the GitHub API did not answer; asking github.com instead"
    location="$(curl --silent --show-error --proto '=https' --tlsv1.2 --max-time 30 --output /dev/null \
      --write-out '%{redirect_url}' "$GITHUB_URL/releases/latest" </dev/null 2>/dev/null)" || location=""
    case "$location" in
      */releases/tag/*) tag="${location##*/releases/tag/}" ;;
      */releases | */releases/) refuse "gcportrait has no release yet, so there is nothing to install. Until the first one, build from a clone of the source: git clone $GITHUB_URL.git, then infra/deploy.sh --project YOUR_PROJECT --build (docs/contributing.md)." ;;
      *) refuse "could not find the newest release: neither the GitHub API nor github.com answered. Check the connection, or name a release with --version vX.Y.Z ($GITHUB_URL/releases)." ;;
    esac
    say "$tag (github.com)"
  fi
  [[ "$tag" =~ $TAG_PATTERN ]] || refuse "the newest release is called '$tag', which is not a release tag such as v1.2.3"
  LATEST_TAG="$tag"
}

main() {
  local version="" dir_arg="" image_given=0 project_given=0 arg
  local deploy_args=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version) need_value "$@"; version="$2"; shift 2 ;;
      --dir) need_value "$@"; dir_arg="$2"; shift 2 ;;
      -h | --help) usage; exit 0 ;;
      --build)
        refuse "--build builds the image from a clone of the source, which the installer does not download: git clone $GITHUB_URL.git, then infra/deploy.sh --project YOUR_PROJECT --build (docs/contributing.md). Without --build, the installer deploys the release's own image."
        ;;
      --image | --project)
        need_value "$@"
        if [ "$1" = --image ]; then image_given=1; else project_given=1; fi
        deploy_args+=("$1" "$2")
        shift 2
        ;;
      *) deploy_args+=("$1"); shift ;;
    esac
  done
  [ "$project_given" = 1 ] ||
    refuse "--project is required: the id of the Google Cloud project to deploy into, as in: curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project YOUR_PROJECT (see --help)"
  case "$version" in
    "" | latest) version="" ;;
    [0-9]*) version="v$version" ;;
  esac
  [ -z "$version" ] || [[ "$version" =~ $TAG_PATTERN ]] || refuse "--version must be a release tag such as v1.2.3"

  printf '%sgcportrait install.sh%s\n' "$BOLD" "$RESET"
  step "Checking the tools"
  command -v curl >/dev/null 2>&1 || refuse "curl is not installed: install it with your system's package manager"
  command -v tar >/dev/null 2>&1 || refuse "tar is not installed: install it with your system's package manager"
  if command -v sha256sum >/dev/null 2>&1; then
    SHA256_TOOL=sha256sum
  elif command -v shasum >/dev/null 2>&1; then
    SHA256_TOOL=shasum
  else
    refuse "neither sha256sum nor shasum is installed: install GNU coreutils (sha256sum) or Perl (shasum)"
  fi
  command -v gcloud >/dev/null 2>&1 ||
    refuse "the Google Cloud CLI (gcloud) is not installed: https://cloud.google.com/sdk/docs/install (Cloud Shell has it)"
  say "curl, tar, $SHA256_TOOL and gcloud: found"

  local tag
  if [ -n "$version" ]; then
    step "The release: $version (--version)"
    tag="$version"
  else
    step "Finding the newest release"
    latest_release
    tag="$LATEST_TAG"
  fi

  local archive="gcportrait-deploy-${tag}.tar.gz" base="$GITHUB_URL/releases/download/$tag" sums="" error name
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/gcportrait-install.XXXXXX")"
  trap cleanup EXIT
  step "Downloading the deploy scripts of $tag and the release's checksums"
  say "$base/$archive"
  error="$(fetch "$base/$archive" "$WORK/$archive" 2>&1)" ||
    refuse "could not download $base/$archive (${error:-no answer}). Is $tag a release of gcportrait? $GITHUB_URL/releases lists them."
  # checksums.txt, or SHA256SUMS where a release has none; any failure but GitHub's 404 refuses at once, naming it.
  for name in checksums.txt SHA256SUMS; do
    if error="$(fetch "$base/$name" "$WORK/$name" 2>&1)"; then
      sums="$name"
      say "$base/$name"
      break
    fi
    case "$error" in
      *" 404"*) ;;
      *) refuse "could not download $base/$name (${error:-no answer}), so nothing is unpacked or run. Check the connection and run the same line again." ;;
    esac
  done
  [ -n "$sums" ] ||
    refuse "release $tag has no checksums.txt (nor SHA256SUMS) to check $archive against, so nothing is unpacked or run."

  step "Checking the SHA-256 of $archive"
  local expected actual
  expected="$(awk -v name="$archive" '{ file = $2; sub(/^\*/, "", file) } file == name { print tolower($1) }' \
    "$WORK/$sums" | sed -n '1p')"
  [[ "$expected" =~ $SHA256_PATTERN ]] ||
    refuse "$sums of release $tag lists no SHA-256 for $archive, so nothing is unpacked or run."
  actual="$(sha256 "$WORK/$archive")"
  [ "$actual" = "$expected" ] ||
    refuse "the SHA-256 of the downloaded $archive is $actual, but $sums of release $tag says $expected: the file is not the release's, so nothing is unpacked or run."
  say "$actual: as $sums says"

  # Only the release's VERSION and infra/ are unpacked; any other member, or one that would land outside the
  # directory, refuses the archive.
  local listing member stage="$WORK/unpacked"
  listing="$(tar -tzf "$WORK/$archive")" || refuse "$archive is not a gzip-compressed tar archive"
  while IFS= read -r member; do
    case "$member" in
      /* | ../* | */../* | */.. | ..) refuse "$archive holds $member, a path outside its directory; nothing is unpacked or run." ;;
      VERSION | ./VERSION | infra/ | infra/* | ./infra/ | ./infra/* | ./) ;;
      *) refuse "$archive holds $member, which is not one of the deploy scripts; nothing is unpacked or run." ;;
    esac
  done <<<"$listing"
  mkdir "$stage"
  tar -xzf "$WORK/$archive" -C "$stage" </dev/null
  [ -f "$stage/infra/deploy.sh" ] && [ -f "$stage/infra/common.sh" ] ||
    refuse "$archive holds no infra/deploy.sh and infra/common.sh"
  local bundled
  bundled="$(tr -d '[:space:]' <"$stage/VERSION" 2>/dev/null || true)"
  [ "$bundled" = "$tag" ] || refuse "$archive says it is release '${bundled:-?}', not $tag"

  # A new directory, an empty one, or one that holds these files already (an earlier run of the same release).
  local dir="" reuse=0 n=1
  if [ -n "$dir_arg" ]; then
    dir="$dir_arg"
    if [ -e "$dir" ] && [ ! -d "$dir" ]; then refuse "--dir $dir exists and is not a directory"; fi
    if [ -d "$dir" ] && [ -n "$(ls -A "$dir")" ]; then
      if holds_release "$dir" "$stage"; then
        reuse=1
      else
        refuse "--dir $dir holds other files; name a new or empty directory"
      fi
    fi
  else
    dir="gcportrait-$tag"
    while [ -e "$dir" ]; do
      if holds_release "$dir" "$stage"; then
        reuse=1
        break
      fi
      n=$((n + 1))
      dir="gcportrait-$tag-$n"
    done
  fi
  step "Keeping the scripts in $dir"
  if [ "$reuse" = 1 ]; then
    say "it holds these files already (the same release); using them as they are"
  else
    mkdir -p "$dir"
    cp -Rp "$stage/." "$dir/"
    say "VERSION ($tag) and infra/: $(find "$dir/infra" -type f -exec basename {} \; | LC_ALL=C sort | tr '\n' ' ')"
  fi

  local image_args=()
  if [ "$image_given" = 1 ]; then
    say "--image is given, so it deploys that image, not release $tag's own"
  else
    image_args=(--image "$tag")
  fi
  for arg in ${deploy_args[@]+"${deploy_args[@]}"}; do
    [ "$arg" != --dry-run ] || say "--dry-run: deploy.sh changes nothing in Google Cloud; the scripts stay here for the real run"
  done
  step "Running deploy.sh of $tag"
  printf '    + %q' "$dir/infra/deploy.sh"
  for arg in ${image_args[@]+"${image_args[@]}"} ${deploy_args[@]+"${deploy_args[@]}"}; do printf ' %q' "$arg"; done
  printf '\n'
  cleanup
  trap - EXIT
  exec bash "$dir/infra/deploy.sh" ${image_args[@]+"${image_args[@]}"} ${deploy_args[@]+"${deploy_args[@]}"}
}

main "$@"
