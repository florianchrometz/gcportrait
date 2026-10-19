#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Write the release's deploy archive and checksums (AGENTS.md, Releases); FILES below lists archive contents.
# Run with --help for usage. Needs bash, tar, and sha256sum or shasum.
# Exit status 0 on success, 2 on refused input or prerequisites; other command failures propagate.

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/release-assets.sh --tag vX.Y.Z --out DIR

Writes gcportrait-deploy-vX.Y.Z.tar.gz (the deploy scripts infra/install.sh downloads) into DIR, then
checksums.txt with the SHA-256 of every file in DIR. Put the release's other assets into DIR first.

  --tag TAG    The release tag, such as v1.2.3 (written into the archive's VERSION).
  --out DIR    The directory of the release's assets; created when it does not exist.
  -h, --help   This help.
USAGE
}

refuse() {
  printf 'release-assets: %s\n' "$*" >&2
  exit 2
}

# The deploy scripts, by their path in the repository; the archive keeps the same paths.
FILES="infra/deploy.sh infra/common.sh infra/uninstall.sh infra/install.sh infra/README.md"

TAG=""
OUT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag) [ "$#" -ge 2 ] || refuse "--tag needs a value"; TAG="$2"; shift 2 ;;
    --out) [ "$#" -ge 2 ] || refuse "--out needs a value"; OUT="$2"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) refuse "unknown argument: $1 (see --help)" ;;
  esac
done
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || refuse "--tag must be a release tag such as v1.2.3"
[ -n "$OUT" ] || refuse "--out is required"

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1"; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1"; }
else
  refuse "neither sha256sum nor shasum is installed"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/gcportrait-release-assets.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

mkdir "$STAGE/infra"
for file in $FILES; do
  [ -f "$ROOT/$file" ] || refuse "$file is missing"
  cp "$ROOT/$file" "$STAGE/$file"
  case "$file" in *.sh) chmod 755 "$STAGE/$file" ;; *) chmod 644 "$STAGE/$file" ;; esac
done
printf '%s\n' "$TAG" >"$STAGE/VERSION"
chmod 644 "$STAGE/VERSION"

ARCHIVE="gcportrait-deploy-${TAG}.tar.gz"
# Owner and order fixed where the tar is GNU tar (the release runner's); COPYFILE_DISABLE keeps macOS's tar from
# adding ._ files for extended attributes.
TAR_FLAGS=()
if tar --version 2>/dev/null | grep 'GNU tar' >/dev/null; then
  TAR_FLAGS=(--sort=name --owner=0 --group=0 --numeric-owner)
fi
COPYFILE_DISABLE=1 tar ${TAR_FLAGS[@]+"${TAR_FLAGS[@]}"} -czf "$OUT/$ARCHIVE" -C "$STAGE" VERSION infra

# Every file of the directory but the list itself, in a fixed order.
(
  cd "$OUT"
  export LC_ALL=C
  for name in *; do
    [ -f "$name" ] && [ "$name" != checksums.txt ] || continue
    sha256 "$name"
  done
) >"$STAGE/checksums.txt"
mv "$STAGE/checksums.txt" "$OUT/checksums.txt"
printf 'release-assets: %s and checksums.txt (%s files) in %s\n' "$ARCHIVE" \
  "$(wc -l <"$OUT/checksums.txt" | tr -d ' ')" "$OUT"
