# SPDX-License-Identifier: Apache-2.0
# shellcheck shell=bash
# shellcheck disable=SC2034 # the variables set here are read by the scripts that source this file
#
# Sourced by infra/deploy.sh and infra/uninstall.sh. It holds the names of everything deploy.sh creates and
# the markers that say deploy.sh created it, in one place, so that uninstall.sh removes exactly that and nothing
# it finds without the marker. Plain bash 3.2 (the macOS default), no other tool than the Google Cloud CLI.

# Defaults shared by both scripts.
DEFAULT_REGION="europe-west3"
DEFAULT_SERVICE="gcportrait"
# The service name of deploy.sh --demo-only when --service is not given.
DEFAULT_DEMO_SERVICE="gcportrait-demo"

# The regions that offer Cloud Run domain mappings (deploy.sh --domain), as Google lists them on "Mapping custom
# domains" (the feature is in Preview there). europe-west3, the default region, is not among them: an instance
# with --domain runs in one of these, or a region without them puts a load balancer in front instead.
DOMAIN_MAPPING_REGIONS="asia-east1 asia-northeast1 asia-southeast1 europe-north1 europe-west1 europe-west4 us-central1 us-east1 us-east4 us-west1"

# The legal pages deploy.sh --legal-dir ships (LEGAL_BUNDLE; backend/src/legal.ts), and the largest text it accepts:
# both texts, base64-encoded, must fit into one environment variable on Cloud Run (32 KiB).
LEGAL_PAGES="impressum privacy"
MAX_LEGAL_TEXT_BYTES=11264
# The longest address deploy.sh --impressum-url and --privacy-url accept (LEGAL_IMPRESSUM_URL, LEGAL_PRIVACY_URL;
# backend/src/config.ts).
MAX_LEGAL_URL_LENGTH=2048

# The non-affiliation statement's long form, at the end of every --help (NON_AFFILIATION_LONG in
# frontend/src/branding.ts holds the same words; scripts/non-affiliation-copies.test.ts keeps them equal). The
# run banner names the script only: the statement goes in footers and long-form texts.
NON_AFFILIATION_LONG="gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are trademarks of Google and are used under Google's icon usage terms."

# The marker on every resource deploy.sh creates. Labels where the resource has them (the Cloud Run service,
# the Artifact Registry repository, the build bucket), the description where it has none (service accounts).
MANAGED_LABEL="managed-by=gcportrait-deploy"
SA_MARKER="Created by gcportrait infra/deploy.sh"

# deploy.sh records each Google API it had to enable as a label, `gcportrait-api-<name>=enabled` (labels keep
# only lowercase letters, digits, dashes and underscores), on the Cloud Run service and, with --build, on the
# build repository (created minutes before the service, so a run that stops in between has recorded them
# already). uninstall.sh --disable-apis turns off those and only those.
API_LABEL_PREFIX="gcportrait-api-"

# The published image: .github/workflows/release.yml pushes it to GitHub Container Registry on every v* tag
# (linux/amd64 and linux/arm64; tags X.Y.Z, X.Y and latest) and, run by hand, as `dev` (AGENTS.md, Releases).
# `deploy.sh --image TAG` deploys PUBLISHED_IMAGE:TAG; without --image and --build it deploys :latest.
PUBLISHED_IMAGE="ghcr.io/florianchrometz/gcportrait"
# The source repository: the clone that --build needs, which deploy.sh's advice names. A fork changes it with
# PUBLISHED_IMAGE.
SOURCE_REPOSITORY="https://github.com/florianchrometz/gcportrait"

# deploy.sh pulls ghcr.io images through an Artifact Registry remote repository of this name in the instance's
# region, created once per project and region and shared by every instance there (labelled like everything else
# deploy.sh creates; uninstall.sh deletes it with the last instance that deploys from it). Cloud Run then deploys
# REGION-docker.pkg.dev/PROJECT/REMOTE_REPO/OWNER/NAME:TAG. Cloud Run could run a public ghcr.io image directly,
# but Google recommends a remote repository for availability: Artifact Registry keeps a copy of every image it
# fetched (Cloud Run's "Deploying container images").
REMOTE_REPO="ghcr"
REMOTE_UPSTREAM="https://ghcr.io"

# The startup and liveness probes on GET /healthz, set by deploy.sh. Probes reach the container directly; from
# outside, Cloud Run's front end answers /healthz itself.
STARTUP_PROBE="httpGet.path=/healthz,initialDelaySeconds=0,periodSeconds=2,timeoutSeconds=2,failureThreshold=15"
LIVENESS_PROBE="httpGet.path=/healthz,periodSeconds=30,timeoutSeconds=5,failureThreshold=3"

# Sets the names of everything deploy.sh creates for one instance, from PROJECT, REGION and SERVICE.
#   BACKEND_SA_ID / _EMAIL  the Cloud Run service's identity (service-account mode); no roles from deploy.sh
#   BUILD_SA_ID / _EMAIL    the identity of --build's Cloud Build runs
#   BACKEND_SA_DESCRIPTION, BUILD_SA_DESCRIPTION  the marks deploy.sh writes on the two accounts, exactly
#   BUILD_REPO              Artifact Registry repository (docker, regional) for --build's images
#   BUILD_BUCKET            regional bucket for --build's uploaded source and build logs
#   REMOTE_PREFIX           where the remote repository serves ghcr.io/OWNER/NAME: REMOTE_PREFIX/OWNER/NAME
derive_names() {
  BACKEND_SA_ID="${SERVICE}-backend"
  BACKEND_SA_EMAIL="${BACKEND_SA_ID}@${PROJECT}.iam.gserviceaccount.com"
  BACKEND_SA_DESCRIPTION="${SA_MARKER} for the Cloud Run service ${SERVICE}."
  BUILD_SA_ID="${SERVICE}-build"
  BUILD_SA_EMAIL="${BUILD_SA_ID}@${PROJECT}.iam.gserviceaccount.com"
  BUILD_SA_DESCRIPTION="${SA_MARKER} for the Cloud Run service ${SERVICE}: runs its Cloud Build builds."
  BUILD_REPO="${SERVICE}-builds"
  BUILD_BUCKET="${PROJECT}-${SERVICE}-builds"
  REMOTE_PREFIX="${REGION}-docker.pkg.dev/${PROJECT}/${REMOTE_REPO}"
}

# --- Output ------------------------------------------------------------------------------------------------

if [ -t 1 ]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  RED=$'\033[31m'
  YELLOW=$'\033[33m'
  RESET=$'\033[0m'
else
  BOLD="" DIM="" RED="" YELLOW="" RESET=""
fi

CURRENT_STEP=""

# banner SCRIPT: the first line of every run, the script's name.
banner() { printf '%sgcportrait %s%s\n' "$BOLD" "$1" "$RESET"; }

# usage_statement: the close of every --help, a blank line and the long form, wrapped at 110 columns.
usage_statement() { printf '\n%s\n' "$NON_AFFILIATION_LONG" | fold -s -w 110 | sed 's/ *$//'; }

# step "Title": a numbered heading with the time since the script started.
step() {
  CURRENT_STEP="$1"
  printf '\n%s==> %s%s %s(%s)%s\n' "$BOLD" "$1" "$RESET" "$DIM" "$(elapsed)" "$RESET"
}

say() { printf '    %s\n' "$*"; }
# detail TEXT: a line for whoever wants to see what was checked (--verbose), not a next step.
detail() { [ "${VERBOSE:-0}" = 0 ] || say "$@"; }
warn() { printf '    %swarning:%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() {
  printf '%serror:%s %s\n' "$RED" "$RESET" "$*" >&2
  exit 1
}

# Minutes and seconds since the script started (bash's SECONDS).
elapsed() { printf '%dm%02ds' $((SECONDS / 60)) $((SECONDS % 60)); }

# script_command NAME: how to call the script NAME of this folder (SCRIPT_DIR) in a command to copy, shell-quoted:
# relative to the current directory when the folder is inside it (infra/deploy.sh from a checkout's root,
# gcportrait-v1.2.3/infra/deploy.sh where infra/install.sh kept a release's scripts), else its absolute path.
script_command() {
  local here path
  here="$(pwd)"
  case "$SCRIPT_DIR" in
    "$here") path="./$1" ;;
    "${here%/}"/*) path="${SCRIPT_DIR#"${here%/}"/}/$1" ;;
    *) path="$SCRIPT_DIR/$1" ;;
  esac
  printf '%q' "$path"
}

# show_cmd CMD ARGS...: prints a command the way `set -x` would, to stderr.
show_cmd() {
  {
    printf '    %s+%s' "$DIM" "$RESET"
    printf ' %q' "$@"
    printf '\n'
  } >&2
}

# run CMD ARGS...: prints the command, then runs it unless DRY_RUN is 1. Every change to the project goes
# through run or retry_when, so --dry-run prints the complete list of changes. Read-only queries are called
# directly.
run() {
  show_cmd "$@"
  if [ "${DRY_RUN:-0}" = 1 ]; then return 0; fi
  "$@"
}

# retry_when PATTERN N SECONDS CMD ARGS...: like run, but when the command fails and its output matches the
# extended regular expression PATTERN, it runs again, up to N times in all, SECONDS apart. Any other failure
# ends it at once. For the refusals Google gives for a minute or two after a service account or a grant was
# created, while IAM catches up (a documented eventual consistency); a real failure, such as a build that
# broke or a revision that does not start, is never repeated. The command's output is shown as it runs.
retry_when() {
  local pattern="$1" attempts="$2" pause="$3" n=1 status output
  shift 3
  show_cmd "$@"
  if [ "${DRY_RUN:-0}" = 1 ]; then return 0; fi
  output="$(mktemp)"
  while true; do
    status=0
    "$@" 2>&1 | tee "$output" || status=$?
    if [ "$status" = 0 ]; then
      rm -f "$output"
      return 0
    fi
    if [ "$n" -ge "$attempts" ] || ! grep -Eq -- "$pattern" "$output"; then
      rm -f "$output"
      return "$status"
    fi
    n=$((n + 1))
    say "Google refused this while a new account or grant propagates; trying again in ${pause}s (attempt $n of $attempts)"
    sleep "$pause"
  done
}

# --- Checks ------------------------------------------------------------------------------------------------

require_gcloud() {
  command -v gcloud >/dev/null 2>&1 || die "the Google Cloud CLI (gcloud) is not installed: https://cloud.google.com/sdk/docs/install"
  local account
  account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true)"
  account="${account%%$'\n'*}"
  [ -n "$account" ] || die "gcloud has no active account: run 'gcloud auth login' first"
  GCLOUD_ACCOUNT="$account"
}

valid_project_id() { [[ "$1" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; }

# trim TEXT: TEXT without leading and trailing ASCII white space (spaces, tabs, line breaks), all of which the
# backend's trim removes as well (LC_ALL=C keeps other characters, which the backend may refuse, in place).
trim() {
  local LC_ALL=C value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  printf '%s' "${value%"${value##*[![:space:]]}"}"
}

# utf16_length TEXT: the length JavaScript gives TEXT (UTF-16 code units), which is what the backend's limits
# count: one per character, two for a character outside the Basic Multilingual Plane. Counted on the UTF-8
# bytes (LC_ALL=C), so the result does not depend on the locale: every byte that does not continue a character
# starts one, and a four-byte lead (F0 to F7) starts a character that needs two units.
utf16_length() {
  local LC_ALL=C value="$1" leads astral
  leads="${value//[$'\x80'-$'\xbf']/}"
  astral="${value//[^$'\xf0'-$'\xf7']/}"
  printf '%d' $((${#leads} + ${#astral}))
}

# has_control_or_format_char TEXT: whether TEXT holds a character of the Unicode categories Cc (controls) or Cf
# (invisible format characters such as U+202E RIGHT-TO-LEFT OVERRIDE), the characters the backend refuses in
# HOSTED_BY (backend/src/config.ts, /[\p{Cc}\p{Cf}]/u). Matched on the UTF-8 bytes of every Cc and Cf range of
# Unicode 17, the version Node 22 knows, under LC_ALL=C, so the answer does not depend on the locale.
has_control_or_format_char() {
  local LC_ALL=C value="$1"
  case "$value" in
    *[$'\x01'-$'\x1f'$'\x7f']* | *$'\xc2'[$'\x80'-$'\x9f'$'\xad']*) return 0 ;; # Cc; U+00AD
    *$'\xd8'[$'\x80'-$'\x85'$'\x9c']* | *$'\xdb\x9d'* | *$'\xdc\x8f'*) return 0 ;; # U+0600-0605, 061C, 06DD, 070F
    *$'\xe0\xa2'[$'\x90'$'\x91']* | *$'\xe0\xa3\xa2'* | *$'\xe1\xa0\x8e'*) return 0 ;; # U+0890-0891, 08E2, 180E
    *$'\xe2\x80'[$'\x8b'-$'\x8f'$'\xaa'-$'\xae']*) return 0 ;; # U+200B-200F, 202A-202E
    *$'\xe2\x81'[$'\xa0'-$'\xa4'$'\xa6'-$'\xaf']*) return 0 ;; # U+2060-2064, 2066-206F
    *$'\xef\xbb\xbf'* | *$'\xef\xbf'[$'\xb9'-$'\xbb']*) return 0 ;; # U+FEFF, FFF9-FFFB
    *$'\xf0\x91\x82\xbd'* | *$'\xf0\x91\x83\x8d'* | *$'\xf0\x93\x90'[$'\xb0'-$'\xbf']*) return 0 ;; # U+110BD, 110CD, 13430-1343F
    *$'\xf0\x9b\xb2'[$'\xa0'-$'\xa3']* | *$'\xf0\x9d\x85'[$'\xb3'-$'\xba']*) return 0 ;; # U+1BCA0-1BCA3, 1D173-1D17A
    *$'\xf3\xa0\x80'[$'\x81'$'\xa0'-$'\xbf']* | *$'\xf3\xa0\x81'[$'\x80'-$'\xbf']*) return 0 ;; # U+E0001, E0020-E007F
  esac
  return 1
}

# hosted_by_problem TEXT: empty when the backend accepts TEXT (already trimmed) as HOSTED_BY, else why not.
# The backend's rules (backend/src/config.ts): at most 80 characters, plain text on one line without < or >,
# not naming Google (AGENTS.md, Non-affiliation, brand and legal). Checked here so that a bad value fails
# before anything is deployed, instead of as a new revision that does not start.
hosted_by_problem() {
  local value="$1"
  if [ -z "$value" ]; then
    printf 'must not be blank'
  elif [ "$(utf16_length "$value")" -gt 80 ]; then
    printf 'must be at most 80 characters'
  elif has_control_or_format_char "$value" || [[ "$value" == *[\<\>]* ]]; then
    printf 'must be plain text on one line, without < or >'
  elif [[ "$(LC_ALL=C tr '[:upper:]' '[:lower:]' <<<"$value")" == *google* ]]; then
    printf 'must not name Google: gcportrait is not affiliated with Google'
  fi
}
# legal_url_problem URL: empty when the backend accepts URL (already trimmed) as LEGAL_IMPRESSUM_URL or
# LEGAL_PRIVACY_URL, else why not. The backend's rules (backend/src/config.ts): an https URL (it becomes a link in the
# app), without a user name or password, at most 2048 characters. Checked a little more strictly here (a host of
# letters, digits, dots and dashes with an optional port; no white space), so a value deploy.sh passes always starts.
legal_url_problem() {
  local value="$1" authority
  if [ "${#value}" -gt "$MAX_LEGAL_URL_LENGTH" ]; then
    printf 'must be at most %s characters' "$MAX_LEGAL_URL_LENGTH"
    return
  fi
  if [[ "$value" != https://* ]] || [[ "$value" =~ [[:space:][:cntrl:]] ]]; then
    printf 'must be an https:// URL, such as https://example.com/legal/impressum'
    return
  fi
  authority="${value#https://}"
  authority="${authority%%[/?#]*}"
  if [[ "$authority" == *@* ]]; then
    printf 'must not hold a user name or password'
  elif ! [[ "$authority" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$ ]]; then
    printf 'must be an https:// URL, such as https://example.com/legal/impressum'
  fi
}
valid_region() { [[ "$1" =~ ^[a-z]+-[a-z]+[0-9]+$ ]]; }
# A lowercase DNS host name with at least two labels (demo.example.com), at most 253 characters.
valid_hostname() {
  [ "${#1}" -le 253 ] && [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$ ]]
}
domain_mapping_region() { case " $DOMAIN_MAPPING_REGIONS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
# The domain to verify in Search Console for HOST: its parent (demo.example.com -> example.com), which covers every
# name under it, or HOST itself when it has only two labels.
domain_to_verify() {
  local rest="${1#*.}"
  if [[ "$rest" == *.* ]]; then printf '%s' "$rest"; else printf '%s' "$1"; fi
}
# Cloud Run allows 49 characters; 22 keep the derived service-account ids within IAM's 30.
valid_service() { [[ "$1" =~ ^[a-z]([a-z0-9-]{0,20}[a-z0-9])?$ ]]; }

# The project number (for the IAP service agent and the deterministic run.app address).
project_number() {
  gcloud projects describe "$PROJECT" --format='value(projectNumber)' 2>/dev/null || true
}

# The Cloud Run service's labels as `key=value` lines, or nothing when the service does not exist.
service_labels() {
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(metadata.labels)' 2>/dev/null
}

# The service-account description, or nothing when the account does not exist.
service_account_description() {
  gcloud iam service-accounts describe "$1" --project="$PROJECT" --format='value(description)' 2>/dev/null
}

service_account_exists() {
  gcloud iam service-accounts describe "$1" --project="$PROJECT" --format='value(email)' >/dev/null 2>&1
}

# service_account_is_ours EMAIL DESCRIPTION: whether the account's description is exactly DESCRIPTION, the mark
# deploy.sh wrote when it created the account (BACKEND_SA_DESCRIPTION or BUILD_SA_DESCRIPTION). Exact, so that the
# account of service "web" is never taken for that of "web-2".
service_account_is_ours() { [ "$(service_account_description "$1")" = "$2" ]; }

# bucket_owner_and_labels NAME: prints the number of the project that owns gs://NAME, a tab, and its labels as
# `key=value;...`; fails when the bucket does not exist or cannot be read. --raw gives the Cloud Storage API's
# own fields, which include the owner (projectNumber).
bucket_owner_and_labels() {
  gcloud storage buckets describe "gs://$1" --raw --format='value(projectNumber,labels)' 2>/dev/null
}

# has_managed_label LABELS: whether LABELS (`key=value` pairs separated by `;` or `,`, as gcloud prints them)
# hold deploy.sh's marker. grep reads all of its input (no -q), so pipefail never sees an early exit's SIGPIPE.
has_managed_label() { tr ';' '\n' <<<"$1" | tr ',' '\n' | grep -x "$MANAGED_LABEL" >/dev/null; }

# Calls a Google REST API that gcloud has no GA command for. The access token goes to curl through stdin
# (printf is a shell builtin), never through a command line, a file or the output.
#   google_api METHOD URL [JSON_BODY]
google_api() {
  local method="$1" url="$2" body="${3:-}" token
  token="$(gcloud auth print-access-token 2>/dev/null)" || die "gcloud could not mint an access token"
  if [ -n "$body" ]; then
    printf 'Authorization: Bearer %s\nx-goog-user-project: %s\nContent-Type: application/json\n' "$token" "$PROJECT" |
      curl --silent --show-error --fail-with-body --header @- --request "$method" --data "$body" "$url"
  else
    printf 'Authorization: Bearer %s\nx-goog-user-project: %s\n' "$token" "$PROJECT" |
      curl --silent --show-error --fail-with-body --header @- --request "$method" "$url"
  fi
}

# google_api_request METHOD URL [JSON_BODY]: like google_api, but an HTTP error is an answer, not a failure: it sets
# API_STATUS (the HTTP status; 000 when nothing answered) and API_BODY. Called directly, never in $(...), so that
# both variables reach the caller.
google_api_request() {
  local method="$1" url="$2" body="${3:-}" token answer data=()
  token="$(gcloud auth print-access-token 2>/dev/null)" || die "gcloud could not mint an access token"
  [ -z "$body" ] || data=(--header 'Content-Type: application/json' --data "$body")
  answer="$(printf 'Authorization: Bearer %s\nx-goog-user-project: %s\n' "$token" "$PROJECT" |
    curl --silent --show-error --max-time 30 --header @- --request "$method" ${data[@]+"${data[@]}"} \
      --write-out '\n%{http_code}' "$url" 2>&1)" || true
  API_STATUS="${answer##*$'\n'}"
  API_BODY="${answer%$'\n'*}"
  [[ "$API_STATUS" =~ ^[0-9]{3}$ ]] || API_STATUS="000"
}

# json_flatten: reads JSON on standard input and prints one line per scalar, `PATH<TAB>VALUE`, PATH the keys and
# array indexes joined by dots (`status.resourceRecords.0.rrdata`), VALUE as written (strings without their quotes,
# escapes kept as written). Enough for the few answers the scripts read without jq, which is not everywhere.
json_flatten() {
  awk '
    { text = text $0 "\n" }
    function path(   p, d) { p = ""; for (d = 1; d <= depth; d++) p = p (d > 1 ? "." : "") key[d]; return p }
    function emit(value) { printf "%s\t%s\n", path(), value }
    END {
      n = length(text); i = 1; depth = 0; expectKey = 0
      while (i <= n) {
        c = substr(text, i, 1)
        if (c == "{") { depth++; kind[depth] = "o"; key[depth] = ""; expectKey = 1; i++; continue }
        if (c == "[") { depth++; kind[depth] = "a"; key[depth] = 0; i++; continue }
        if (c == "}" || c == "]") { depth--; i++; continue }
        if (c == ",") { if (kind[depth] == "a") key[depth]++; else expectKey = 1; i++; continue }
        if (c == ":" || c == " " || c == "\t" || c == "\n" || c == "\r") { i++; continue }
        if (c == "\"") {
          value = ""; i++
          while (i <= n) {
            c = substr(text, i, 1)
            if (c == "\\") { value = value substr(text, i, 2); i += 2; continue }
            if (c == "\"") break
            value = value c; i++
          }
          i++
          if (kind[depth] == "o" && expectKey) { key[depth] = value; expectKey = 0 } else emit(value)
          continue
        }
        value = ""
        while (i <= n) {
          c = substr(text, i, 1)
          if (c == "," || c == "}" || c == "]" || c == " " || c == "\n" || c == "\t" || c == "\r") break
          value = value c; i++
        }
        emit(value)
      }
    }'
}

# json_value JSON PATH: the value at PATH (json_flatten's form), or nothing. awk reads all of its input (no early
# exit), so pipefail never sees json_flatten stopped by SIGPIPE.
json_value() {
  json_flatten <<<"$1" | awk -F '\t' -v want="$2" '$1 == want && !found { print substr($0, length($1) + 2); found = 1 }'
}

# legal_bundle DIR: LEGAL_BUNDLE for DIR/impressum.md and DIR/privacy.md (backend/src/legal.ts): a JSON object of the
# texts' base64, `{"impressum":"...","privacy":"..."}`. Each text is checked as the backend checks it (UTF-8, no
# control characters, not blank), and must stay under MAX_LEGAL_TEXT_BYTES; at least one must exist.
legal_bundle() {
  local dir="$1" page file size json="" controls
  controls="$(printf '[\001-\010\013\014\016-\037\177]')"
  for page in $LEGAL_PAGES; do
    file="$dir/$page.md"
    [ -e "$file" ] || continue
    [ -f "$file" ] || die "--legal-dir: $page.md is not a file"
    size="$(wc -c <"$file" | tr -d ' ')"
    [ "$size" -le "$MAX_LEGAL_TEXT_BYTES" ] ||
      die "--legal-dir: $page.md is larger than $((MAX_LEGAL_TEXT_BYTES / 1024)) KiB (both texts travel in one environment variable of at most 32 KiB)"
    [ "$(LC_ALL=C tr -d ' \t\r\n' <"$file" | wc -c | tr -d ' ')" -gt 0 ] || die "--legal-dir: $page.md is empty"
    iconv -f UTF-8 -t UTF-8 "$file" >/dev/null 2>&1 || die "--legal-dir: $page.md is not valid UTF-8"
    if [ "$(LC_ALL=C tr -d '\000' <"$file" | wc -c | tr -d ' ')" != "$size" ] ||
      LC_ALL=C grep -q "$controls" "$file"; then
      die "--legal-dir: $page.md contains control characters"
    fi
    json="${json:+$json,}\"$page\":\"$(base64 <"$file" | tr -d '\n')\""
  done
  [ -n "$json" ] || die "--legal-dir: $dir holds neither impressum.md nor privacy.md"
  printf '{%s}' "$json"
}

# The Cloud Run Admin API's domain mappings in REGION (v1, the Knative-style API that `gcloud beta run
# domain-mappings` uses; called directly so that no beta component is needed).
domain_mappings_url() {
  printf 'https://%s-run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/%s/domainmappings' "$REGION" "$PROJECT"
}

# --- GitHub Container Registry -----------------------------------------------------------------------------

# ghcr_manifest REPOSITORY REFERENCE: asks GitHub Container Registry, anonymously as Artifact Registry's remote
# repository does, whether ghcr.io/REPOSITORY has an image at REFERENCE (a tag, or a digest sha256:...). Sets
# GHCR_STATUS to one of
#   found          GHCR_DIGEST holds the image's digest (of its multi-platform index, for a release);
#   no-repository  ghcr.io refuses anonymous access: the package does not exist, or it is not public;
#   no-image       the package is public but has no image at REFERENCE;
#   unknown        ghcr.io did not answer as expected (offline, rate-limited): nothing is concluded.
# The anonymous pull token goes to curl on standard input, like every other token here. Called directly, never in
# $(...), so that both variables reach the caller.
ghcr_manifest() {
  local repository="$1" reference="$2" answer status token
  GHCR_STATUS="unknown" GHCR_DIGEST=""
  answer="$(curl --silent --max-time 15 --write-out '\n%{http_code}' \
    "https://ghcr.io/token?scope=repository:${repository}:pull&service=ghcr.io" 2>/dev/null)" || return 0
  status="${answer##*$'\n'}"
  case "$status" in
    200) token="$(json_value "${answer%$'\n'*}" token)" ;;
    401 | 403 | 404) GHCR_STATUS="no-repository" && return 0 ;;
    *) return 0 ;;
  esac
  [ -n "$token" ] || return 0
  # HEAD: the headers, then "STATUS" on a line of its own. Every manifest type a release may be published as.
  answer="$(printf 'Authorization: Bearer %s\n' "$token" |
    curl --silent --max-time 15 --head --header @- \
      --header 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
      --write-out '\n%{http_code}' "https://ghcr.io/v2/${repository}/manifests/${reference}" 2>/dev/null)" || return 0
  case "${answer##*$'\n'}" in
    200)
      GHCR_STATUS="found"
      GHCR_DIGEST="$(tr -d '\r' <<<"$answer" | awk 'tolower($1) == "docker-content-digest:" { digest = $2 } END { print digest }')"
      ;;
    404) GHCR_STATUS="no-image" ;;
    401 | 403) GHCR_STATUS="no-repository" ;;
  esac
}

# remote_repo_info: the remote repository's `MODE|FORMAT|LABELS|UPSTREAM` in REGION, or nothing, with a
# failure, when it does not exist. UPSTREAM is the custom upstream's address, from whichever field holds it:
# Artifact Registry describes a repository created with --remote-docker-repo=URL with
# remoteRepositoryConfig.commonRepository.uri, older ones with
# remoteRepositoryConfig.dockerRepository.customRepository.uri.
remote_repo_info() {
  local info mode format labels common custom
  info="$(gcloud artifacts repositories describe "$REMOTE_REPO" --project="$PROJECT" --location="$REGION" \
    --format='value[separator="|"](mode,format,labels,remoteRepositoryConfig.commonRepository.uri,remoteRepositoryConfig.dockerRepository.customRepository.uri)' 2>/dev/null)" ||
    return 1
  IFS='|' read -r mode format labels common custom <<<"$info" || true
  printf '%s|%s|%s|%s\n' "$mode" "$format" "$labels" "${common:-$custom}"
}
