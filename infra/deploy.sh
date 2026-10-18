#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Deploys gcportrait to Cloud Run in a Google Cloud project you own.
# Run with --help for usage and prerequisites (usage below); docs/self-host.md is the guide and
# docs/configuration.md the flag reference. Rules: infra/AGENTS.md, Self-hosting; AGENTS.md, Modes and hosting.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=infra/common.sh
. "$SCRIPT_DIR/common.sh"
# A clone of the repository around the script, which --build needs; a release's scripts from infra/install.sh are not
# one.
HAVE_CHECKOUT=0
[ ! -f "$REPO_ROOT/infra/Dockerfile" ] || [ ! -f "$REPO_ROOT/pnpm-lock.yaml" ] || HAVE_CHECKOUT=1

usage() {
  printf 'gcportrait infra/deploy.sh\n\n'
  cat <<'USAGE'
Usage: infra/deploy.sh --project PROJECT_ID [options]

Deploys gcportrait to Cloud Run in PROJECT_ID; the project id is all it needs, every option has a default.
Re-run it with the same flags to update; every run sets the service to what its flags say. It ends with the
next steps: open the address, create the OAuth client, redeploy with its id. docs/self-host.md is the guide,
docs/configuration.md the reference.
It uses and changes only what it created itself (labelled managed-by=gcportrait-deploy, or for service
accounts, described as created by it): a service, account, repository or bucket of the same name without that
mark stops it before anything is created. --service picks other names for all of them.

Where and what:
  --project ID            Google Cloud project to deploy into (required; billing must be enabled).
  --region REGION         Cloud Run region (default: europe-west3).
  --service NAME          Cloud Run service name (default: gcportrait; at most 22 characters). The service
                          account, build repository and bucket names derive from it.
  --image TAG|IMAGE       Deploy the released image ghcr.io/florianchrometz/gcportrait at TAG (a release such
                          as v1.0.0 or 1.0.0, 1.0 for the newest patch of 1.0, or dev; default: latest, the
                          newest release). ghcr.io images are pulled through an Artifact Registry remote
                          repository, ghcr, in the region (created once, shared by the instances there), so
                          ghcr.io/OWNER/NAME:TAG (or @sha256:...) works too. Any other full image reference
                          (REGISTRY/PATH:TAG or @sha256:...) is deployed as it is.
  --build                 Build the image from this checkout with Cloud Build instead, in the project (needs a
                          clone of the repository, not the release's scripts infra/install.sh downloads).
  --build-machine TYPE    Cloud Build machine type for --build (default: e2-highcpu-8).

Demo, domain and legal pages:
  --demo-only             A sign-in-free demo (DEMO_ONLY=true): the demo organisations only, no sign-in and no
                          route that calls Google. The service name defaults to gcportrait-demo; smaller limits
                          (256 MiB, 60 s requests, at most 2 instances unless --max-instances says otherwise).
                          Excludes --oauth-client-id, --sa-mode and --iap.
  --domain HOST           Serve the instance at HOST (such as demo.example.com) too: a Cloud Run domain mapping
                          with a Google-managed certificate, and the DNS records to create are printed. Only in
                          the regions that offer domain mappings (europe-west1 and others; not europe-west3).
                          You must have verified HOST or its parent domain in Google Search Console. Kept on a
                          redeploy without it; uninstall.sh removes it. Needs curl.
  --impressum-url URL     Link your own Impressum, an https:// URL (LEGAL_IMPRESSUM_URL): /api/config reports
                          it for the app's footer. Not together with an impressum.md in --legal-dir.
  --privacy-url URL       Link your own privacy notice, an https:// URL (LEGAL_PRIVACY_URL), likewise. Not
                          together with a privacy.md in --legal-dir.
  --legal-dir PATH        Or serve texts: PATH/impressum.md and/or PATH/privacy.md (Markdown) at /impressum
                          and /privacy, linked from the footer (LEGAL_BUNDLE). At most 11 KiB each.

Sign-in and access:
  --oauth-client-id ID    OAuth web client id for "Sign in with Google" (OAUTH_CLIENT_ID). Without it the
                          instance runs, demo mode works, and sign-in shows as not configured.
  --hosted-by TEXT        Who runs the instance, shown before sign-in as "Hosted by TEXT." (HOSTED_BY;
                          plain text, at most 80 characters, not naming Google).
  --iap                   Put Identity-Aware Proxy in front: only the principals below can open the instance.
                          Without it the service is public (people still sign in with Google to read data).
  --iap-members LIST      Comma-separated principals for --iap, such as user:ana@example.com,
                          group:team@example.com or domain:example.com (default: your gcloud account).
                          Repeatable. Added, never removed: see docs/self-host-options.md for removing one.
  --sa-mode               Enable service-account mode (SA_MODE_ENABLED=true): signed-in users may read a
                          scope through the backend's own account once a customer granted it access.
  --sa-strict-exposure    With --sa-mode: also refuse a scope the account can read the details of itself
                          (SA_MODE_STRICT_EXPOSURE=true; backend/README.md, "Service-account mode").

Render API (POST /api/render: SVG and PNG drawn on the server; docs/api.md):
  --no-render-api         Leave the render API out (RENDER_API=false); it is on otherwise, except with
                          --demo-only, which never has it.
  --render-env NAME=VALUE A limit of the render API: RENDER_MAX_ASSETS, RENDER_MAX_PIXELS, RENDER_TIMEOUT_MS
                          (at most 840000, under the 900 s request timeout) or RENDER_MAX_BODY_BYTES, checked
                          as the backend checks it. Repeatable.

Operations:
  --memory SIZE           Memory of each instance, 512Mi to 4Gi with its one CPU (default: 2Gi; 256Mi with
                          --demo-only). A render needs about 300 MiB, the render worker's heap (up to 1 GiB) and
                          10 bytes per PNG pixel: RENDER_MAX_PIXELS=134217728 wants 4Gi.
  --log-level LEVEL       fatal, error, warn, info (default), debug, trace or silent (LOG_LEVEL).
  --source-url URL        Where the source of the version you run is published (SOURCE_URL): the target of
                          the footer's "Source (Apache-2.0)" link, a courtesy to the people who use the instance.
  --max-instances N       Upper bound of Cloud Run instances (default: 10).
  --dry-run               Print every change instead of making it (read-only queries still run).
  --verbose               Also print what the check of the running instance saw (the revision, the answers of
                          /api/healthz and /api/config).
  -h, --help              This help.
USAGE
  usage_statement
}

# --- Arguments ---------------------------------------------------------------------------------------------

ORIGINAL_ARGS=("$@")
PROJECT=""
REGION="$DEFAULT_REGION"
SERVICE="$DEFAULT_SERVICE"
SERVICE_SET=0
DEMO_ONLY=0
DOMAIN=""
LEGAL_DIR=""
IMPRESSUM_URL=""
PRIVACY_URL=""
IMAGE_ARG=""
BUILD=0
BUILD_MACHINE="e2-highcpu-8"
OAUTH_CLIENT_ID=""
HOSTED_BY=""
IAP=0
IAP_MEMBERS=""
SA_MODE=0
SA_STRICT=0
LOG_LEVEL="info"
SOURCE_URL=""
MAX_INSTANCES=10
MAX_INSTANCES_SET=0
MEMORY_ARG=""
RENDER_API=1
RENDER_ENV=()
DRY_RUN=0
VERBOSE=0

need_value() { [ "$#" -ge 2 ] && [ -n "$2" ] || die "$1 needs a value (see --help)"; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project) need_value "$@"; PROJECT="$2"; shift 2 ;;
    --region) need_value "$@"; REGION="$2"; shift 2 ;;
    --service) need_value "$@"; SERVICE="$2"; SERVICE_SET=1; shift 2 ;;
    --image) need_value "$@"; IMAGE_ARG="$2"; shift 2 ;;
    --build) BUILD=1; shift ;;
    --build-machine) need_value "$@"; BUILD_MACHINE="$2"; shift 2 ;;
    --oauth-client-id) need_value "$@"; OAUTH_CLIENT_ID="$2"; shift 2 ;;
    --hosted-by) need_value "$@"; HOSTED_BY="$2"; shift 2 ;;
    --iap) IAP=1; shift ;;
    --iap-members) need_value "$@"; IAP_MEMBERS="${IAP_MEMBERS:+$IAP_MEMBERS,}$2"; shift 2 ;;
    --sa-mode) SA_MODE=1; shift ;;
    --sa-strict-exposure) SA_STRICT=1; shift ;;
    --log-level) need_value "$@"; LOG_LEVEL="$2"; shift 2 ;;
    --source-url) need_value "$@"; SOURCE_URL="$2"; shift 2 ;;
    --max-instances) need_value "$@"; MAX_INSTANCES="$2"; MAX_INSTANCES_SET=1; shift 2 ;;
    --demo-only) DEMO_ONLY=1; shift ;;
    --domain) need_value "$@"; DOMAIN="$2"; shift 2 ;;
    --legal-dir) need_value "$@"; LEGAL_DIR="$2"; shift 2 ;;
    --impressum-url) need_value "$@"; IMPRESSUM_URL="$2"; shift 2 ;;
    --privacy-url) need_value "$@"; PRIVACY_URL="$2"; shift 2 ;;
    --memory) need_value "$@"; MEMORY_ARG="$2"; shift 2 ;;
    --no-render-api) RENDER_API=0; shift ;;
    --render-env) need_value "$@"; RENDER_ENV+=("$2"); shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --verbose) VERBOSE=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

[ -n "$PROJECT" ] || { usage >&2; die "--project is required"; }
# A demo-only instance: no sign-in, no scope read, public; its own default name and smaller limits.
if [ "$DEMO_ONLY" = 1 ]; then
  [ -z "$OAUTH_CLIENT_ID" ] || die "--demo-only offers no sign-in: leave out --oauth-client-id"
  [ "$SA_MODE" = 0 ] && [ "$SA_STRICT" = 0 ] || die "--demo-only reads no scope: leave out --sa-mode and --sa-strict-exposure"
  [ "$IAP" = 0 ] && [ -z "$IAP_MEMBERS" ] || die "--demo-only is a public demo without sign-in: leave out --iap"
  [ "$RENDER_API" = 1 ] && [ "${#RENDER_ENV[@]}" = 0 ] ||
    die "--demo-only has no render API: leave out --no-render-api and --render-env"
  [ "$SERVICE_SET" = 1 ] || SERVICE="$DEFAULT_DEMO_SERVICE"
  [ "$MAX_INSTANCES_SET" = 1 ] || MAX_INSTANCES=2
fi
valid_project_id "$PROJECT" || die "--project must be a project id (6 to 30 lowercase letters, digits, dashes)"
valid_region "$REGION" || die "--region must be a Cloud Run region such as europe-west3"
valid_service "$SERVICE" || die "--service must be 1 to 22 lowercase letters, digits and dashes, starting with a letter"
[ "$BUILD" = 0 ] || [ -z "$IMAGE_ARG" ] || die "--image and --build exclude each other"
if [ "$BUILD" = 1 ] && [ "$HAVE_CHECKOUT" = 0 ]; then
  die "--build needs a clone of the repository around this script ($REPO_ROOT has no infra/Dockerfile and pnpm-lock.yaml): git clone ${SOURCE_REPOSITORY}.git, then run its infra/deploy.sh (docs/contributing.md)."
fi
[[ "$BUILD_MACHINE" =~ ^[a-z0-9-]+$ ]] || die "--build-machine must be a machine type such as e2-highcpu-8"
[[ "$MAX_INSTANCES" =~ ^[1-9][0-9]{0,2}$ ]] || die "--max-instances must be a number from 1 to 999"
case "$LOG_LEVEL" in
  fatal | error | warn | info | debug | trace | silent) ;;
  *) die "--log-level must be one of fatal, error, warn, info, debug, trace, silent" ;;
esac
# The same rules the backend applies at start-up (backend/src/config.ts), checked here so a typo fails before
# anything is deployed instead of as a crash-looping revision.
if [ -n "$OAUTH_CLIENT_ID" ] && ! [[ "$OAUTH_CLIENT_ID" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  die "--oauth-client-id must look like 12345678901-abc.apps.googleusercontent.com"
fi
if [ -n "$HOSTED_BY" ]; then
  HOSTED_BY="$(trim "$HOSTED_BY")"
  HOSTED_BY_PROBLEM="$(hosted_by_problem "$HOSTED_BY")"
  [ -z "$HOSTED_BY_PROBLEM" ] || die "--hosted-by $HOSTED_BY_PROBLEM"
fi
if [ -n "$SOURCE_URL" ] && ! [[ "$SOURCE_URL" =~ ^https?://[^[:space:]]+$ ]]; then
  die "--source-url must be an http:// or https:// URL"
fi
if [ -n "$IAP_MEMBERS" ] && [ "$IAP" = 0 ]; then die "--iap-members needs --iap"; fi
if [ -n "$DOMAIN" ]; then
  DOMAIN="$(LC_ALL=C tr '[:upper:]' '[:lower:]' <<<"${DOMAIN%.}")"
  valid_hostname "$DOMAIN" || die "--domain must be a host name such as demo.example.com"
  [ "$IAP" = 0 ] || die "--domain and --iap are not supported together"
  domain_mapping_region "$REGION" ||
    die "--domain: Cloud Run offers domain mappings in $(printf '%s' "$DOMAIN_MAPPING_REGIONS" | sed 's/ /, /g') only, not in $REGION. Deploy with --region europe-west1 (or another of them), or put a load balancer in front yourself (docs/self-host-options.md, \"Custom domain\")."
fi
# The legal texts travel as one environment variable (LEGAL_BUNDLE), checked here as the backend checks them.
LEGAL_BUNDLE=""
if [ -n "$LEGAL_DIR" ]; then
  [ -d "$LEGAL_DIR" ] || die "--legal-dir: $LEGAL_DIR is not a directory"
  LEGAL_BUNDLE="$(legal_bundle "$LEGAL_DIR")" || exit 1
fi
# Or links to the operator's own pages (LEGAL_IMPRESSUM_URL, LEGAL_PRIVACY_URL), checked as the backend checks them;
# a page is linked or served, never both (the backend refuses that at start-up).
for page in $LEGAL_PAGES; do
  case "$page" in
    impressum) legal_flag=--impressum-url legal_url="$IMPRESSUM_URL" ;;
    *) legal_flag=--privacy-url legal_url="$PRIVACY_URL" ;;
  esac
  [ -n "$legal_url" ] || continue
  legal_url="$(trim "$legal_url")"
  LEGAL_URL_PROBLEM="$(legal_url_problem "$legal_url")"
  [ -z "$LEGAL_URL_PROBLEM" ] || die "$legal_flag $LEGAL_URL_PROBLEM"
  if [ -n "$LEGAL_DIR" ] && [ -f "$LEGAL_DIR/$page.md" ]; then
    die "$legal_flag and --legal-dir's $page.md are the same page: link it or serve the text, not both"
  fi
  case "$page" in impressum) IMPRESSUM_URL="$legal_url" ;; *) PRIVACY_URL="$legal_url" ;; esac
done
if [ "$SA_STRICT" = 1 ] && [ "$SA_MODE" = 0 ]; then die "--sa-strict-exposure needs --sa-mode"; fi
# Memory: 2 GiB for a full instance (the render API's defaults fit it), 256 MiB for a demo-only one.
if [ "$DEMO_ONLY" = 1 ]; then MEMORY=256Mi REQUEST_TIMEOUT=60; else MEMORY=2Gi REQUEST_TIMEOUT=900; fi
if [ -n "$MEMORY_ARG" ]; then
  [[ "$MEMORY_ARG" =~ ^([1-9][0-9]{0,3})(Mi|Gi)$ ]] || die "--memory must be a size such as 512Mi or 2Gi"
  MEMORY_MIB="${BASH_REMATCH[1]}"
  [ "${BASH_REMATCH[2]}" = Mi ] || MEMORY_MIB=$((MEMORY_MIB * 1024))
  MEMORY_FLOOR=512
  [ "$DEMO_ONLY" = 0 ] || MEMORY_FLOOR=256
  [ "$MEMORY_MIB" -ge "$MEMORY_FLOOR" ] && [ "$MEMORY_MIB" -le 4096 ] ||
    die "--memory must be from ${MEMORY_FLOOR}Mi to 4Gi (Cloud Run's limit with one CPU)"
  MEMORY="$MEMORY_ARG"
fi
# The render API's limits, checked as the backend checks them (backend/src/config.ts), so a typo fails here.
RENDER_ENV_YAML=""
for setting in ${RENDER_ENV[@]+"${RENDER_ENV[@]}"}; do
  [ "$RENDER_API" = 1 ] || die "--render-env sets a limit of the render API, which --no-render-api leaves out"
  name="${setting%%=*}"
  value="${setting#*=}"
  [ "$name" != "$setting" ] || die "--render-env takes NAME=VALUE, such as RENDER_MAX_ASSETS=20000"
  case "$name" in
    RENDER_MAX_ASSETS) low=1 high=1000000 ;;
    RENDER_MAX_PIXELS) low=1000000 high=134217728 ;;
    # Below Cloud Run's 900 s request timeout, so a render's own timeout answers first.
    RENDER_TIMEOUT_MS) low=10000 high=840000 ;;
    RENDER_MAX_BODY_BYTES) low=1048576 high=1073741824 ;;
    *) die "--render-env: $name is not a limit of the render API (RENDER_MAX_ASSETS, RENDER_MAX_PIXELS, RENDER_TIMEOUT_MS, RENDER_MAX_BODY_BYTES)" ;;
  esac
  [[ "$value" =~ ^[1-9][0-9]{0,9}$ ]] && [ "$value" -ge "$low" ] && [ "$value" -le "$high" ] ||
    die "--render-env: $name must be a whole number from $low to $high"
  case "$RENDER_ENV_YAML" in *"$name:"*) die "--render-env: $name is given twice" ;; esac
  RENDER_ENV_YAML="${RENDER_ENV_YAML}${name}: '${value}'"$'\n'
done

# The image. A ghcr.io image (a release by default) is pulled through the remote repository (common.sh): GHCR_REF is
# its ghcr.io reference, GHCR_PATH its OWNER/NAME and GHCR_REFERENCE its tag or digest.
IMAGE=""
GHCR_REF=""
if [ "$BUILD" = 1 ]; then
  :
elif [ -z "$IMAGE_ARG" ]; then
  GHCR_REF="${PUBLISHED_IMAGE}:latest"
elif [[ "$IMAGE_ARG" == ghcr.io/* ]]; then
  GHCR_REF="$IMAGE_ARG"
elif [[ "$IMAGE_ARG" == */* ]]; then
  IMAGE="$IMAGE_ARG"
elif [[ "$IMAGE_ARG" =~ ^v([0-9]+\.[0-9]+(\.[0-9]+(-[0-9A-Za-z.-]+)?)?)$ ]]; then
  # A release tag: release.yml publishes v1.2.3 as 1.2.3 (and 1.2), the way docker/metadata-action writes
  # semantic versions, so the git tag and the image tag both work here.
  GHCR_REF="${PUBLISHED_IMAGE}:${BASH_REMATCH[1]}"
elif [[ "$IMAGE_ARG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
  GHCR_REF="${PUBLISHED_IMAGE}:${IMAGE_ARG}"
else
  die "--image must be a tag such as v1.0.0 or a full image reference"
fi
GHCR_PATH=""
GHCR_REFERENCE=""
if [ -n "$GHCR_REF" ]; then
  # ghcr.io/OWNER/NAME[:TAG|@sha256:DIGEST]; package paths on ghcr.io are lowercase. No tag means latest.
  [[ "$GHCR_REF" =~ ^ghcr\.io/([a-z0-9]([a-z0-9._-]*[a-z0-9])?(/[a-z0-9]([a-z0-9._-]*[a-z0-9])?)+)(:([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})|@(sha256:[a-f0-9]{64}))?$ ]] ||
    die "--image: $GHCR_REF is not a ghcr.io image reference such as ghcr.io/OWNER/NAME:TAG (lowercase)"
  GHCR_PATH="${BASH_REMATCH[1]}"
  if [ -n "${BASH_REMATCH[7]}" ]; then
    GHCR_REFERENCE="${BASH_REMATCH[7]}"
  else
    GHCR_REFERENCE="${BASH_REMATCH[6]:-latest}"
  fi
fi

derive_names
if [ -n "$GHCR_PATH" ]; then
  if [[ "$GHCR_REFERENCE" == sha256:* ]]; then
    IMAGE="${REMOTE_PREFIX}/${GHCR_PATH}@${GHCR_REFERENCE}"
  else
    IMAGE="${REMOTE_PREFIX}/${GHCR_PATH}:${GHCR_REFERENCE}"
  fi
fi
TMP_DIR="$(mktemp -d)"
# The APIs this run enabled, and whether they are recorded yet (on the build repository or the service).
ENABLED_NOW=""
APIS_RECORDED=0
# The ERR trap also runs inside $(...) and pipelines (set -E), where a failing query is expected and handled;
# only a failure of the script itself is reported.
on_error() {
  [ "$BASH_SUBSHELL" = 0 ] || return 0
  printf '\n%serror:%s deploy.sh stopped during "%s" after %s. It is safe to run the same command again.\n' \
    "$RED" "$RESET" "$CURRENT_STEP" "$(elapsed)" >&2
}
# On any unsuccessful end (a failed command or die): name the APIs this run enabled if nothing records them yet.
on_exit() {
  local status=$?
  rm -rf "$TMP_DIR"
  if [ "$status" != 0 ] && [ -n "$ENABLED_NOW" ] && [ "$APIS_RECORDED" = 0 ] && [ "${DRY_RUN:-0}" = 0 ]; then
    printf 'This run enabled%s; nothing records that yet, so uninstall.sh --disable-apis will not know. If you\n' \
      "$ENABLED_NOW" >&2
    printf 'give up instead of running deploy.sh again, and nothing else uses them: gcloud services disable%s --project=%s\n' \
      "$ENABLED_NOW" "$PROJECT" >&2
  fi
}
trap on_exit EXIT
trap on_error ERR

# --- 1. Preconditions --------------------------------------------------------------------------------------

banner "infra/deploy.sh"
step "Checking the project and your gcloud session"
require_gcloud
say "gcloud account: $GCLOUD_ACCOUNT"
PROJECT_NUMBER="$(project_number)" || true
[ -n "$PROJECT_NUMBER" ] || die "project $PROJECT not found, or $GCLOUD_ACCOUNT cannot see it (or gcloud's sign-in has expired: gcloud auth login)"
say "project: $PROJECT (number $PROJECT_NUMBER), region: $REGION, service: $SERVICE"
BILLING="$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null || true)"
case "$BILLING" in
  True) say "billing: enabled" ;;
  False) die "billing is not enabled for $PROJECT; link a billing account first (Cloud Run and Cloud Build need it)" ;;
  *) say "billing: could not check (no permission on the billing account); continuing" ;;
esac
# Where to build instead when there is no release to deploy: this checkout, or a clone of the repository.
if [ "$HAVE_CHECKOUT" = 1 ]; then
  BUILD_ADVICE="build from this checkout instead: the same command with --build"
else
  BUILD_ADVICE="build from a clone of the repository instead: git clone ${SOURCE_REPOSITORY}.git, then its infra/deploy.sh with the same flags and --build (docs/contributing.md)"
fi
HAVE_CURL=0
command -v curl >/dev/null 2>&1 && HAVE_CURL=1
[ "$BUILD" = 0 ] || [ "$HAVE_CURL" = 1 ] || die "--build needs curl (to create the build bucket with its label)"
# A ghcr.io image is looked up on ghcr.io itself before anything is changed, so that a release that does not exist
# (or a package that is not public, which the remote repository could not pull) stops the run here.
GHCR_DIGEST=""
if [ -n "$GHCR_PATH" ]; then
  if [ "$HAVE_CURL" = 0 ]; then
    say "image: ghcr.io/$GHCR_PATH ($GHCR_REFERENCE), not checked (curl is not installed)"
  else
    ghcr_manifest "$GHCR_PATH" "$GHCR_REFERENCE"
    case "$GHCR_STATUS" in
      found) say "image: ghcr.io/$GHCR_PATH ($GHCR_REFERENCE), digest ${GHCR_DIGEST:-?}" ;;
      no-repository)
        if [ "ghcr.io/$GHCR_PATH" = "$PUBLISHED_IMAGE" ]; then
          die "ghcr.io/$GHCR_PATH has no public release yet (GitHub Container Registry refuses anonymous access to it), so there is nothing to pull yet; $BUILD_ADVICE."
        fi
        die "ghcr.io/$GHCR_PATH does not exist or is not public, so Artifact Registry could not pull it. Check the name, make the package public, or deploy with --build."
        ;;
      no-image) die "ghcr.io/$GHCR_PATH has no image $GHCR_REFERENCE. Pick a released tag (--image vX.Y.Z), or $BUILD_ADVICE." ;;
      *) warn "could not ask ghcr.io whether ghcr.io/$GHCR_PATH has $GHCR_REFERENCE; going on (Cloud Run reports a missing image when it deploys)" ;;
    esac
  fi
fi
IAP_MEMBER_LIST=()
if [ "$IAP" = 1 ]; then
  [ "$HAVE_CURL" = 1 ] || die "--iap needs curl (to create the IAP service agent)"
  if [ -z "$IAP_MEMBERS" ]; then
    # gcloud lists a service account as its bare email.
    case "$GCLOUD_ACCOUNT" in
      *.iam.gserviceaccount.com) IAP_MEMBERS="serviceAccount:${GCLOUD_ACCOUNT}" ;;
      *) IAP_MEMBERS="user:${GCLOUD_ACCOUNT}" ;;
    esac
  fi
  IFS=',' read -r -a IAP_MEMBER_LIST <<<"$IAP_MEMBERS"
  for member in "${IAP_MEMBER_LIST[@]}"; do
    [[ "$member" =~ ^(user|group|serviceAccount|domain):[^[:space:]]+$ ]] ||
      die "--iap-members: '$member' is not user:EMAIL, group:EMAIL, serviceAccount:EMAIL or domain:DOMAIN"
  done
fi
# --domain: Google maps a domain only for an account that verified it (or a parent) in Search Console. Checked here so
# that the domain step can say what to do instead of asking Google for a mapping it would refuse. When the list
# cannot be read, the domain step asks Google anyway.
DOMAIN_VERIFIED=1
if [ -n "$DOMAIN" ]; then
  [ "$HAVE_CURL" = 1 ] || die "--domain needs curl (for Cloud Run's domain mappings, which gcloud has in beta only)"
  if VERIFIED_DOMAINS="$(gcloud domains list-user-verified --format='value(id)' 2>/dev/null)"; then
    DOMAIN_VERIFIED=0
    while read -r verified; do
      [ -n "$verified" ] || continue
      case "$DOMAIN" in "$verified" | *."$verified") DOMAIN_VERIFIED=1 ;; esac
    done <<<"$VERIFIED_DOMAINS"
  fi
  if [ "$DOMAIN_VERIFIED" = 1 ]; then
    say "domain: $DOMAIN"
  else
    say "domain: $DOMAIN, not verified by $GCLOUD_ACCOUNT yet (the domain step says how)"
  fi
fi
[ "$DEMO_ONLY" = 0 ] || say "demo-only: no sign-in, no route that calls Google"
if [ "$DEMO_ONLY" = 0 ]; then
  if [ "$RENDER_API" = 1 ]; then say "render API: on (POST /api/render; --no-render-api leaves it out), memory $MEMORY"; else say "render API: off"; fi
fi
[ "$DRY_RUN" = 0 ] || say "dry run: changes are printed, not made"

# --- 2. APIs -----------------------------------------------------------------------------------------------

# run: the service. iam: the backend's service account. cloudasset and cloudresourcemanager: the backend's own
# calls are charged to this project in service-account mode, and Resource Manager calls made with a person's
# token, which carry no quota project, are charged to the project of the OAuth client, which lives here (skill
# cai-ingestion §9). artifactregistry: the image. cloudbuild: --build only. iap: --iap only. A demo-only
# instance calls no Google API, so it needs neither Cloud Asset Inventory nor Resource Manager.
step "Enabling the Google APIs the instance needs"
if [ "$DEMO_ONLY" = 1 ]; then
  APIS="run.googleapis.com iam.googleapis.com artifactregistry.googleapis.com"
else
  APIS="run.googleapis.com iam.googleapis.com cloudasset.googleapis.com cloudresourcemanager.googleapis.com artifactregistry.googleapis.com"
fi
[ "$BUILD" = 0 ] || APIS="$APIS cloudbuild.googleapis.com storage.googleapis.com"
[ "$IAP" = 0 ] || APIS="$APIS iap.googleapis.com"
ENABLED="$(gcloud services list --enabled --project="$PROJECT" --format='value(config.name)' 2>/dev/null)" ||
  die "could not list the enabled APIs of $PROJECT (do you have roles/serviceusage.serviceUsageAdmin or Owner?)"
MISSING=""
for api in $APIS; do
  if grep -qx "$api" <<<"$ENABLED"; then say "already enabled: $api"; else MISSING="$MISSING $api"; fi
done
API_LABELS=""
if [ -n "$MISSING" ]; then
  # shellcheck disable=SC2086 # word splitting of the API list is intended
  run gcloud services enable $MISSING --project="$PROJECT"
  ENABLED_NOW="$MISSING"
  for api in $MISSING; do API_LABELS="${API_LABELS},${API_LABEL_PREFIX}${api%%.*}=enabled"; done
else
  APIS_RECORDED=1
fi

# --- 3. What exists already ---------------------------------------------------------------------------------

# deploy.sh uses and changes only what it created itself, recognised by its marks (common.sh): the label on the
# service, the build repository and the bucket, the exact description on the two accounts. A resource of one of
# its names without the mark belongs to someone else, so the run stops here, before it creates, grants, uploads
# or deploys anything, and names each one with the way to hand it over (only if it is meant for this instance:
# uninstall.sh deletes what carries the mark). --service picks other names for all of them.
step "Checking that what exists already was made by deploy.sh"
NOT_OURS=()
# not_ours WHAT HANDOVER: records a resource deploy.sh will not touch, and how to hand it over.
not_ours() { NOT_OURS+=("$1. To hand it over: $2"); }

SERVICE_EXISTS=0
if SERVICE_LABELS="$(service_labels)"; then
  SERVICE_EXISTS=1
  if has_managed_label "$SERVICE_LABELS"; then
    say "Cloud Run service $SERVICE ($REGION) exists, made by deploy.sh: it is updated"
  else
    not_ours "the Cloud Run service $SERVICE in $REGION has no $MANAGED_LABEL label" \
      "gcloud run services update $SERVICE --project=$PROJECT --region=$REGION --update-labels=$MANAGED_LABEL"
  fi
fi
# account_check EMAIL DESCRIPTION ROLE: sets ACCOUNT_EXISTS; an account without deploy.sh's mark is recorded.
account_check() {
  ACCOUNT_EXISTS=0
  service_account_exists "$1" || return 0
  ACCOUNT_EXISTS=1
  if service_account_is_ours "$1" "$2"; then
    say "service account $1 exists, made by deploy.sh"
  else
    not_ours "the service account $1 was not created by deploy.sh (its description is not deploy.sh's mark), so deploy.sh does not use it as $3" \
      "gcloud iam service-accounts update $1 --project=$PROJECT --description=\"$2\""
  fi
}
account_check "$BACKEND_SA_EMAIL" "$BACKEND_SA_DESCRIPTION" "the service's identity"
BACKEND_SA_EXISTS="$ACCOUNT_EXISTS"
BUILD_SA_EXISTS=0
REPO_EXISTS=0
BUCKET_EXISTS=0
if [ "$BUILD" = 1 ]; then
  account_check "$BUILD_SA_EMAIL" "$BUILD_SA_DESCRIPTION" "the build account"
  BUILD_SA_EXISTS="$ACCOUNT_EXISTS"
  if REPO_LABELS="$(gcloud artifacts repositories describe "$BUILD_REPO" --project="$PROJECT" --location="$REGION" \
    --format='value(labels)' 2>/dev/null)"; then
    REPO_EXISTS=1
    if has_managed_label "$REPO_LABELS"; then
      say "repository $BUILD_REPO ($REGION) exists, made by deploy.sh"
    else
      not_ours "the Artifact Registry repository $BUILD_REPO in $REGION has no $MANAGED_LABEL label, so deploy.sh neither pushes to it nor sets its clean-up policy (which keeps the 5 newest images)" \
        "gcloud artifacts repositories update $BUILD_REPO --project=$PROJECT --location=$REGION --update-labels=$MANAGED_LABEL"
    fi
  fi
  # Bucket names are global: a bucket of this name may belong to someone else entirely.
  if BUCKET_INFO="$(bucket_owner_and_labels "$BUILD_BUCKET")"; then
    BUCKET_EXISTS=1
    read -r BUCKET_PROJECT_NUMBER BUCKET_LABELS <<<"$BUCKET_INFO" || true
    if [ "${BUCKET_PROJECT_NUMBER:-}" != "$PROJECT_NUMBER" ]; then
      NOT_OURS+=("the bucket gs://$BUILD_BUCKET exists but belongs to another project (bucket names are global)")
    elif has_managed_label "${BUCKET_LABELS:-}"; then
      say "bucket gs://$BUILD_BUCKET exists, made by deploy.sh"
    else
      not_ours "the bucket gs://$BUILD_BUCKET exists in $PROJECT without the $MANAGED_LABEL label, so deploy.sh did not create it and uploads nothing into it" \
        "gcloud storage buckets update gs://$BUILD_BUCKET --update-labels=$MANAGED_LABEL"
    fi
  fi
fi
# The remote repository of a ghcr.io image (common.sh): deploy.sh's own (its label), or a remote repository of
# ghcr.io that someone else created under the same name, which deploy.sh pulls through and never changes or deletes.
# Anything else of that name cannot serve ghcr.io images.
REMOTE_REPO_STATE=""
if [ -n "$GHCR_PATH" ]; then
  if REMOTE_INFO="$(remote_repo_info)"; then
    IFS='|' read -r REMOTE_MODE REMOTE_FORMAT REMOTE_LABELS REMOTE_URI <<<"$REMOTE_INFO" || true
    if [ "${REMOTE_MODE:-}" = REMOTE_REPOSITORY ] && [ "${REMOTE_FORMAT:-}" = DOCKER ] && [ "${REMOTE_URI%/}" = "$REMOTE_UPSTREAM" ]; then
      if has_managed_label "${REMOTE_LABELS:-}"; then
        REMOTE_REPO_STATE="ours"
        say "remote repository $REMOTE_REPO ($REGION) of $REMOTE_UPSTREAM exists, made by deploy.sh"
      else
        REMOTE_REPO_STATE="theirs"
        say "remote repository $REMOTE_REPO ($REGION) of $REMOTE_UPSTREAM exists, not made by deploy.sh: it pulls through it and changes nothing there"
      fi
    else
      NOT_OURS+=("the Artifact Registry repository $REMOTE_REPO in $REGION is not a remote repository of $REMOTE_UPSTREAM (${REMOTE_MODE:-?} ${REMOTE_FORMAT:-?} ${REMOTE_URI:-}), so deploy.sh cannot pull ghcr.io images through it. Deploy in another --region, or with --build")
    fi
  else
    REMOTE_REPO_STATE="absent"
  fi
fi
# A domain mapping of --domain: one to this service is the instance's own (uninstall.sh deletes it with the service);
# one to another service is not, and stays as it is.
DOMAIN_MAPPED=0
if [ -n "$DOMAIN" ]; then
  google_api_request GET "$(domain_mappings_url)/$DOMAIN"
  case "$API_STATUS" in
    200)
      MAPPED_TO="$(json_value "$API_BODY" spec.routeName)"
      if [ "$MAPPED_TO" = "$SERVICE" ]; then
        DOMAIN_MAPPED=1
        say "domain mapping $DOMAIN ($REGION) exists, to $SERVICE"
      else
        NOT_OURS+=("the domain $DOMAIN is mapped to the Cloud Run service ${MAPPED_TO:-?} in $REGION, so deploy.sh does not map it to $SERVICE. To free it: gcloud beta run domain-mappings delete --domain=$DOMAIN --project=$PROJECT --region=$REGION")
      fi
      ;;
    404) ;;
    *) die "could not look up the domain mapping of $DOMAIN in $REGION (HTTP $API_STATUS): $(json_value "$API_BODY" error.message)" ;;
  esac
fi
if [ "${#NOT_OURS[@]}" -gt 0 ]; then
  for problem in "${NOT_OURS[@]}"; do printf '    - %s\n' "$problem" >&2; done
  die "deploy.sh did not create the resources above, so it neither uses nor changes them. Deploy with another --service name (every derived name changes with it, but not the remote repository $REMOTE_REPO or a domain: their lines say what to do), or, only where one is meant for this instance, hand it over as shown: deploy.sh then manages it, and uninstall.sh deletes it with the instance."
fi
[ "$SERVICE_EXISTS" = 1 ] || [ "$BACKEND_SA_EXISTS" = 1 ] || say "nothing of the instance exists yet"

# --- 4. The backend's service account ----------------------------------------------------------------------

step "Creating the backend's service account (no roles)"
if [ "$BACKEND_SA_EXISTS" = 1 ]; then
  say "exists: $BACKEND_SA_EMAIL"
else
  run gcloud iam service-accounts create "$BACKEND_SA_ID" --project="$PROJECT" \
    --display-name="gcportrait backend ($SERVICE)" --description="$BACKEND_SA_DESCRIPTION"
fi
# deploy.sh grants this account nothing. Report what it holds on the project, if anything, because a role that
# includes resourcemanager.projects.get makes the service-account gate refuse this project as a scope
# (backend/AGENTS.md, The service-account gate).
HELD_ROLES="$(gcloud projects get-iam-policy "$PROJECT" --flatten='bindings[].members' \
  --filter="bindings.members:serviceAccount:${BACKEND_SA_EMAIL}" --format='value(bindings.role)' 2>/dev/null || true)"
if [ -n "$HELD_ROLES" ]; then
  say "roles it holds on $PROJECT, granted outside deploy.sh: $(printf '%s' "$HELD_ROLES" | tr '\n' ' ')"
else
  say "it holds no roles on $PROJECT"
fi

# --- 5. The image ------------------------------------------------------------------------------------------

if [ "$BUILD" = 1 ]; then
  step "Preparing Cloud Build (repository, bucket, build account)"
  AR_HOST="${REGION}-docker.pkg.dev"
  # The repository also records the APIs this run enabled: it exists minutes before the service does. Step 3
  # made sure that an existing one is deploy.sh's.
  if [ "$REPO_EXISTS" = 0 ]; then
    run gcloud artifacts repositories create "$BUILD_REPO" --project="$PROJECT" --location="$REGION" \
      --repository-format=docker --labels="${MANAGED_LABEL}${API_LABELS}" \
      --description="gcportrait images built by infra/deploy.sh --build for the Cloud Run service $SERVICE"
    APIS_RECORDED=1
  else
    say "repository exists: $AR_HOST/$PROJECT/$BUILD_REPO"
    if [ -n "$API_LABELS" ]; then
      run gcloud artifacts repositories update "$BUILD_REPO" --project="$PROJECT" --location="$REGION" \
        --update-labels="${API_LABELS#,}" --format=none
      APIS_RECORDED=1
    fi
  fi
  # Keep the five newest images; older builds are deleted by Artifact Registry itself.
  cat >"$TMP_DIR/cleanup-policy.json" <<'POLICY'
[
  { "name": "keep-newest-5", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 5 } },
  { "name": "delete-older", "action": { "type": "Delete" }, "condition": { "tagState": "any" } }
]
POLICY
  run gcloud artifacts repositories set-cleanup-policies "$BUILD_REPO" --project="$PROJECT" --location="$REGION" \
    --policy="$TMP_DIR/cleanup-policy.json" --no-dry-run --quiet --format=none

  # The bucket: step 3 made sure that an existing one is this project's and deploy.sh's; the source upload never
  # goes anywhere else.
  if [ "$BUCKET_EXISTS" = 1 ]; then
    say "bucket exists: gs://$BUILD_BUCKET"
  else
    # Regional, private, owned by the project: the uploaded source and the build logs, deleted after 14 days.
    # Created through the Cloud Storage JSON API because `gcloud storage buckets create` cannot set a label:
    # one request creates the bucket with its label, so no bucket of deploy.sh's can exist without the mark
    # uninstall.sh looks for.
    BUCKET_JSON="$(printf '{"name":"%s","location":"%s","labels":{"%s":"%s"},%s}' "$BUILD_BUCKET" "$REGION" \
      "${MANAGED_LABEL%%=*}" "${MANAGED_LABEL#*=}" \
      '"iamConfiguration":{"uniformBucketLevelAccess":{"enabled":true},"publicAccessPrevention":"enforced"},"softDeletePolicy":{"retentionDurationSeconds":"0"},"lifecycle":{"rule":[{"action":{"type":"Delete"},"condition":{"age":14}}]}')"
    show_cmd POST "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}" "$BUCKET_JSON"
    if [ "$DRY_RUN" = 0 ]; then
      # A name taken by a bucket this account cannot read (another project's) ends here with Google's 409.
      BUCKET_ANSWER="$(google_api POST "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}" "$BUCKET_JSON" 2>&1)" ||
        die "could not create gs://$BUILD_BUCKET (a 409 means another project owns that name: deploy with another --service name). Google said: $BUCKET_ANSWER"
      say "created gs://$BUILD_BUCKET"
    fi
  fi

  # A build account of its own, allowed to use that bucket and to push to that repository, and nothing else.
  # (The project's Compute Engine default account would need the Compute Engine API, which in projects without
  # the secure-by-default organisation policies also creates a default network and grants that account Editor
  # on the project.)
  if [ "$BUILD_SA_EXISTS" = 1 ]; then
    say "build account exists: $BUILD_SA_EMAIL"
  else
    run gcloud iam service-accounts create "$BUILD_SA_ID" --project="$PROJECT" \
      --display-name="gcportrait build ($SERVICE)" --description="$BUILD_SA_DESCRIPTION"
  fi
  # Storage Admin on this one bucket, the role Google documents for a build account that keeps its logs in a
  # bucket of the user's: Cloud Build reads the bucket itself (storage.buckets.get) before it accepts the build,
  # which Storage Object Admin does not allow ("service account ... does not have access to the bucket"). The
  # bucket holds nothing but this instance's uploaded sources and build logs.
  NEW_ACCOUNT='does not exist'
  retry_when "$NEW_ACCOUNT" 6 15 gcloud storage buckets add-iam-policy-binding "gs://$BUILD_BUCKET" \
    --member="serviceAccount:$BUILD_SA_EMAIL" --role=roles/storage.admin --format=none
  retry_when "$NEW_ACCOUNT" 6 15 gcloud artifacts repositories add-iam-policy-binding "$BUILD_REPO" \
    --project="$PROJECT" --location="$REGION" --member="serviceAccount:$BUILD_SA_EMAIL" \
    --role=roles/artifactregistry.writer --format=none

  step "Building the image with Cloud Build (about a minute, plus the upload)"
  APP_VERSION="$(git -C "$REPO_ROOT" describe --tags --always --dirty 2>/dev/null || true)"
  [[ "$APP_VERSION" =~ ^[A-Za-z0-9._+-]{1,64}$ ]] || APP_VERSION="local-build"
  IMAGE_TAG="$(date -u +%Y%m%d-%H%M%S)-$(printf '%s' "$APP_VERSION" | tr -c 'A-Za-z0-9_.-' '-' | cut -c1-80)"
  IMAGE="${AR_HOST}/${PROJECT}/${BUILD_REPO}/gcportrait:${IMAGE_TAG}"
  say "version: $APP_VERSION"
  # What is uploaded: the checkout minus .gitignore'd files and minus what no build needs: docs, git metadata,
  # and anything local that may hold a credential (the same patterns as .dockerignore; scripts/infra.test.ts
  # keeps the two lists together). The list is written for this run only, so that gcloud never drops a
  # .gcloudignore into the checkout.
  {
    printf '%s\n' '.git/' '.github/' '.claude/' 'docs/' 'node_modules/' \
      '.env' '.env.*' '*.local.*' '*.pem' '*.key' '*-key.json' 'application_default_credentials.json' '*.log' \
      '/e2e/*' '!/e2e/package.json'
    [ ! -f "$REPO_ROOT/.gitignore" ] || cat "$REPO_ROOT/.gitignore"
  } >"$TMP_DIR/gcloudignore"
  # Cloud Build can refuse a build for a minute or two after the build account or its bucket grant is new
  # (PERMISSION_DENIED, or FAILED_PRECONDITION "does not have access to the bucket"). Those refusals come
  # before a build exists and are repeated; a build that started and failed is not.
  BUILD_REFUSED='\(gcloud\.builds\.submit\) (PERMISSION_DENIED|FAILED_PRECONDITION: invalid bucket)'
  retry_when "$BUILD_REFUSED" 5 30 gcloud builds submit "$REPO_ROOT" --project="$PROJECT" --region="$REGION" \
    --config="$REPO_ROOT/infra/cloudbuild.yaml" --ignore-file="$TMP_DIR/gcloudignore" \
    --substitutions="_IMAGE=${IMAGE},_APP_VERSION=${APP_VERSION}" \
    --service-account="projects/${PROJECT}/serviceAccounts/${BUILD_SA_EMAIL}" \
    --gcs-source-staging-dir="gs://${BUILD_BUCKET}/source" --gcs-log-dir="gs://${BUILD_BUCKET}/logs" \
    --machine-type="$BUILD_MACHINE" ||
    die "the build failed; its log is above and in gs://${BUILD_BUCKET}/logs/"
elif [ -n "$GHCR_PATH" ]; then
  step "Preparing the pull from GitHub Container Registry (Artifact Registry remote repository)"
  # Once per project and region, shared by every instance there. A cache: Artifact Registry fetches an image from
  # ghcr.io the first time it is asked for it and keeps it; what a tag points to is looked up again once the cached
  # answer is an hour old, so a tag that just moved (latest) may still give the image before for up to an hour.
  # Public images need no credentials. No label records APIs here: the repository outlives any one instance.
  if [ "$REMOTE_REPO_STATE" = absent ]; then
    run gcloud artifacts repositories create "$REMOTE_REPO" --project="$PROJECT" --location="$REGION" \
      --repository-format=docker --mode=remote-repository --remote-docker-repo="$REMOTE_UPSTREAM" \
      --remote-repo-config-desc="GitHub Container Registry" --labels="$MANAGED_LABEL" \
      --description="Public GitHub Container Registry images, pulled through for infra/deploy.sh (gcportrait)"
  else
    say "remote repository exists: $REMOTE_PREFIX"
  fi
  say "image: $IMAGE"
  say "(ghcr.io/$GHCR_PATH, pulled through $REMOTE_REPO)"
else
  step "Using a built image"
  # Artifact Registry images are checked here, so that a wrong tag fails before anything is deployed.
  if [[ "$IMAGE" == *-docker.pkg.dev/* ]] &&
    ! gcloud artifacts docker images describe "$IMAGE" --format='value(image_summary.digest)' >/dev/null 2>&1; then
    die "image $IMAGE not found or not readable. Pick a released tag with --image vX.Y.Z, or build from this checkout with --build."
  fi
  say "image: $IMAGE"
fi

# --- 6. Cloud Run ------------------------------------------------------------------------------------------

step "Deploying the Cloud Run service"
# The environment, as a file so that no value needs escaping (HOSTED_BY may hold commas). Nothing here is a
# secret (docs/configuration.md). APP_VERSION and STATIC_DIR come with the image.
yaml_quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }
{
  printf 'TRUST_PROXY_HOPS: %s\n' "$(yaml_quote 1)"
  printf 'LOG_LEVEL: %s\n' "$(yaml_quote "$LOG_LEVEL")"
  printf 'SA_MODE_ENABLED: %s\n' "$(yaml_quote "$([ "$SA_MODE" = 1 ] && echo true || echo false)")"
  [ "$SA_STRICT" = 0 ] || printf 'SA_MODE_STRICT_EXPOSURE: %s\n' "$(yaml_quote true)"
  # A demo-only instance has no account for anyone to grant (its own identity holds no role and publishes none).
  [ "$DEMO_ONLY" = 1 ] || printf 'BACKEND_SA_EMAIL: %s\n' "$(yaml_quote "$BACKEND_SA_EMAIL")"
  [ "$DEMO_ONLY" = 0 ] || printf 'DEMO_ONLY: %s\n' "$(yaml_quote true)"
  [ -z "$OAUTH_CLIENT_ID" ] || printf 'OAUTH_CLIENT_ID: %s\n' "$(yaml_quote "$OAUTH_CLIENT_ID")"
  [ -z "$HOSTED_BY" ] || printf 'HOSTED_BY: %s\n' "$(yaml_quote "$HOSTED_BY")"
  [ -z "$SOURCE_URL" ] || printf 'SOURCE_URL: %s\n' "$(yaml_quote "$SOURCE_URL")"
  [ -z "$LEGAL_BUNDLE" ] || printf 'LEGAL_BUNDLE: %s\n' "$(yaml_quote "$LEGAL_BUNDLE")"
  [ -z "$IMPRESSUM_URL" ] || printf 'LEGAL_IMPRESSUM_URL: %s\n' "$(yaml_quote "$IMPRESSUM_URL")"
  [ -z "$PRIVACY_URL" ] || printf 'LEGAL_PRIVACY_URL: %s\n' "$(yaml_quote "$PRIVACY_URL")"
  [ "$RENDER_API" = 1 ] || printf 'RENDER_API: %s\n' "$(yaml_quote false)"
  printf '%s' "$RENDER_ENV_YAML"
} >"$TMP_DIR/env.yaml"
# The legal texts are long; the listing names them instead of showing their base64.
sed -e 's/^LEGAL_BUNDLE: .*/LEGAL_BUNDLE: (the texts of --legal-dir, base64)/' -e 's/^/      /' "$TMP_DIR/env.yaml"

if [ "$IAP" = 1 ]; then
  ACCESS_FLAGS=(--no-allow-unauthenticated --iap)
else
  ACCESS_FLAGS=(--allow-unauthenticated)
  # Switching IAP off again only where an earlier run switched it on.
  IAP_NOW="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(metadata.annotations."run.googleapis.com/iap-enabled")' 2>/dev/null || true)"
  [ "$IAP_NOW" != "true" ] || ACCESS_FLAGS+=(--no-iap)
fi
# min 0 instances (no cost while idle), 2 GiB (--memory; the render API's worker and its PNG take most of it),
# 80 concurrent requests per instance, startup CPU boost; GET /healthz is the startup and liveness probe (the
# HEALTHCHECK of infra/Dockerfile is for Docker only). Probes reach the container directly; from outside, Cloud
# Run's front end keeps paths ending in "z" for itself and answers /healthz with its own 404, so the check below
# uses /api/healthz. The request timeout covers a long live pull or export read, which stream for as long as
# Google answers, and a render (RENDER_TIMEOUT_MS is kept below it). Repeated only while the backend account is
# too new for Cloud Run to see; a revision that does not start fails at once. A demo-only instance serves files and
# two small JSON answers, nothing that streams or renders: 256 MiB and 60 s are plenty (MEMORY above).
DEPLOY_REFUSED='does not exist|iam\.serviceaccounts\.actAs'
retry_when "$DEPLOY_REFUSED" 4 20 gcloud run deploy "$SERVICE" --project="$PROJECT" --region="$REGION" --image="$IMAGE" \
  --service-account="$BACKEND_SA_EMAIL" --env-vars-file="$TMP_DIR/env.yaml" \
  --port=8080 --cpu=1 --memory="$MEMORY" --concurrency=80 --min-instances=0 --max-instances="$MAX_INSTANCES" \
  --timeout="$REQUEST_TIMEOUT" --cpu-boost --ingress=all \
  --startup-probe="$STARTUP_PROBE" --liveness-probe="$LIVENESS_PROBE" \
  --update-labels="${MANAGED_LABEL}${API_LABELS}" \
  "${ACCESS_FLAGS[@]}" --quiet
APIS_RECORDED=1

# --- 7. Identity-Aware Proxy -------------------------------------------------------------------------------

if [ "$IAP" = 1 ]; then
  step "Granting access through Identity-Aware Proxy"
  IAP_AGENT="service-${PROJECT_NUMBER}@gcp-sa-iap.iam.gserviceaccount.com"
  # IAP calls the service as its service agent, which exists once the project asked for it (no GA gcloud command
  # does that yet, hence the REST call; repeating it is harmless). Printed like every change, --dry-run included.
  IAP_IDENTITY_URL="https://serviceusage.googleapis.com/v1beta1/projects/${PROJECT}/services/iap.googleapis.com:generateServiceIdentity"
  show_cmd POST "$IAP_IDENTITY_URL" '{}'
  if [ "$DRY_RUN" = 0 ]; then google_api POST "$IAP_IDENTITY_URL" '{}' >/dev/null; fi
  retry_when 'does not exist' 6 15 gcloud run services add-iam-policy-binding "$SERVICE" --project="$PROJECT" \
    --region="$REGION" --member="serviceAccount:${IAP_AGENT}" --role=roles/run.invoker --quiet --format=none
  for member in "${IAP_MEMBER_LIST[@]}"; do
    retry_when 'does not exist' 6 15 gcloud iap web add-iam-policy-binding --project="$PROJECT" \
      --resource-type=cloud-run --service="$SERVICE" --region="$REGION" --member="$member" \
      --role=roles/iap.httpsResourceAccessor --format=none
  done
fi

# --- 8. Check and report -----------------------------------------------------------------------------------

URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
OTHER_URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.url)' 2>/dev/null || true)"
[ "$OTHER_URL" != "$URL" ] || OTHER_URL=""

if [ "$DRY_RUN" = 0 ]; then
  step "Checking the running instance"
  # GET /healthz: Cloud Run routes traffic to a revision only after its startup probe on /healthz passed, so a
  # ready latest revision is that check. From outside, /healthz is not reachable (see the deploy step). The plain
  # output is one line; --verbose adds what each check saw.
  REVISIONS="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(status.latestCreatedRevisionName,status.latestReadyRevisionName)' 2>/dev/null || true)"
  read -r CREATED_REVISION READY_REVISION <<<"$REVISIONS" || true
  REVISION_READY=0
  if [ -n "$CREATED_REVISION" ] && [ "$CREATED_REVISION" = "${READY_REVISION:-}" ]; then
    REVISION_READY=1
    detail "revision $READY_REVISION is ready: its startup probe GET /healthz passed"
  else
    warn "the newest revision ${CREATED_REVISION:-?} is not ready; check the service's logs in the console"
  fi
  if [ "$IAP" = 1 ]; then
    [ "$REVISION_READY" = 0 ] ||
      say "the new revision is ready; Identity-Aware Proxy guards the address, so it is not checked from here"
  elif [ "$HAVE_CURL" = 0 ]; then
    say "curl is not installed, so the address is not checked from here; open $URL/api/config in a browser"
  else
    # GET /api/healthz from outside, waited for while the new address comes up (7 tries, 5 s apart; until then
    # Google's front end answers with an HTML page), then the configuration and the app.
    HEALTHY=0
    HEALTH_BODY=""
    RUNNING_VERSION=""
    NL=$'\n'
    for attempt in 1 2 3 4 5 6 7; do
      # The body, a line break, then "STATUS CONTENT-TYPE" (curl prints "000 " when nothing answered).
      answer="$(curl --silent --max-time 10 --write-out '\n%{http_code} %{content_type}' "$URL/api/healthz" 2>/dev/null || true)"
      HEALTH_BODY="${answer%"$NL"*}"
      case "${answer##*"$NL"}" in
        "200 application/json"*) HEALTHY=1; break ;;
      esac
      [ "$attempt" = 7 ] || sleep 5
    done
    if [ "$HEALTHY" = 1 ]; then
      detail "GET /api/healthz: $HEALTH_BODY"
      RUNNING_VERSION="$(json_value "$HEALTH_BODY" version)"
    fi
    if [ "$HEALTHY" = 0 ] || ! curl --silent --show-error --fail --max-time 10 "$URL/api/config" >"$TMP_DIR/config.json"; then
      warn "$URL/api/healthz did not answer yet; check the service's logs in the console"
    else
      detail "GET /api/config: $(cat "$TMP_DIR/config.json")"
      # grep without -q reads all of its input, so pipefail never sees curl stopped early by SIGPIPE.
      if curl --silent --fail --max-time 10 "$URL/" | grep '<div id="root">' >/dev/null; then
        detail "GET /:           the app"
        say "the instance answers${RUNNING_VERSION:+ (version $RUNNING_VERSION)} and serves the app"
      else
        warn "$URL/ did not serve the app"
      fi
    fi
    INVOKERS="$(gcloud run services get-iam-policy "$SERVICE" --project="$PROJECT" --region="$REGION" \
      --flatten='bindings[].members' --filter='bindings.role:roles/run.invoker' --format='value(bindings.members)' 2>/dev/null || true)"
    if ! grep -qx allUsers <<<"$INVOKERS"; then
      warn "the service is not public (allUsers is not an invoker). An organisation policy that restricts IAM members to your domain (iam.allowedPolicyMemberDomains) prevents it; use --iap instead, or ask your administrator for an exception."
    fi
  fi
  # Google's own default account, not gcportrait's: worth knowing about, since deploy.sh enabled the APIs.
  COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  if gcloud projects get-iam-policy "$PROJECT" --flatten='bindings[].members' \
    --filter="bindings.members:serviceAccount:${COMPUTE_SA} AND bindings.role:roles/editor" \
    --format='value(bindings.role)' 2>/dev/null | grep editor >/dev/null; then
    warn "Google's Compute Engine default account $COMPUTE_SA holds Editor on $PROJECT (gcportrait does not use it; docs/self-host-options.md, \"What Google adds by itself\")."
  fi
fi

# --- 9. Custom domain (--domain) ---------------------------------------------------------------------------

# mapping_records JSON: the DNS records a domain mapping asks for, one `TYPE|NAME|DATA` line each (NAME as Google gives
# it: relative to the domain whose DNS holds it, empty for that domain itself; `|` because an empty field between
# tabs would vanish in `read`).
mapping_records() {
  json_flatten <<<"$1" | awk -F '\t' '
    $1 ~ /^status\.resourceRecords\.[0-9]+\.(type|name|rrdata)$/ { split($1, p, "."); seen[p[3]] = 1; v[p[3], p[4]] = $2 }
    END { for (r = 0; r in seen; r++) printf "%s|%s|%s\n", v[r, "type"], v[r, "name"], v[r, "rrdata"] }'
}

# mapping_condition JSON TYPE: `STATUS<TAB>MESSAGE` of the mapping's condition TYPE (Ready, CertificateProvisioned,
# DomainRoutable), or nothing.
mapping_condition() {
  json_flatten <<<"$1" | awk -F '\t' -v want="$2" '
    $1 ~ /^status\.conditions\.[0-9]+\.(type|status|message)$/ { split($1, p, "."); v[p[3], p[4]] = $2 }
    END { for (k in v) { split(k, q, SUBSEP); if (q[2] == "type" && v[k] == want) { printf "%s\t%s\n", v[q[1], "status"], v[q[1], "message"]; exit } } }'
}

# dns_answers NAME TYPE: what Google Public DNS answers right now for NAME and TYPE, over HTTPS (so no dig is needed
# and no local cache is asked), one record's data per line, in lowercase, without a final dot.
dns_answers() {
  local answer
  answer="$(curl --silent --max-time 10 "https://dns.google/resolve?name=$1&type=$2" 2>/dev/null)" || return 0
  json_flatten <<<"$answer" | awk -F '\t' '$1 ~ /^Answer\.[0-9]+\.data$/ { print tolower($2) }' | sed 's/\.$//'
}

DOMAIN_STATE=""
if [ -n "$DOMAIN" ]; then
  step "Mapping $DOMAIN to the service"
  VERIFY_DOMAIN="$(domain_to_verify "$DOMAIN")"
  if [ "$DOMAIN_MAPPED" = 0 ] && [ "$DOMAIN_VERIFIED" = 0 ]; then
    DOMAIN_STATE="unverified"
  elif [ "$DOMAIN_MAPPED" = 0 ]; then
    # A Google-managed certificate (AUTOMATIC); no labels: the mapping belongs to the instance by the service it
    # routes to, which is how deploy.sh (step 3) and uninstall.sh recognise it.
    MAPPING_JSON="$(printf '{"apiVersion":"domains.cloudrun.com/v1","kind":"DomainMapping","metadata":{"name":"%s","namespace":"%s"},"spec":{"routeName":"%s","certificateMode":"AUTOMATIC"}}' \
      "$DOMAIN" "$PROJECT" "$SERVICE")"
    show_cmd POST "$(domain_mappings_url)" "$MAPPING_JSON"
    if [ "$DRY_RUN" = 1 ]; then
      DOMAIN_STATE="dry-run"
    else
      google_api_request POST "$(domain_mappings_url)" "$MAPPING_JSON"
      case "$API_STATUS" in
        200 | 201 | 202)
          DOMAIN_MAPPED=1
          say "created the domain mapping $DOMAIN -> $SERVICE"
          ;;
        *)
          REFUSAL="$(json_value "$API_BODY" error.message)"
          if [ "$API_STATUS" = 403 ] && grep -Eiq 'verif|authori[sz]' <<<"$REFUSAL"; then
            DOMAIN_STATE="unverified"
          else
            die "Google refused the domain mapping of $DOMAIN (HTTP $API_STATUS): ${REFUSAL:-$API_BODY}"
          fi
          ;;
      esac
    fi
  fi

  if [ "$DOMAIN_STATE" = "unverified" ]; then
    warn "Google maps $DOMAIN only for an account that verified $VERIFY_DOMAIN (or $DOMAIN) in Google Search Console, and $GCLOUD_ACCOUNT has not."
    say "1. gcloud domains verify $VERIFY_DOMAIN    (opens Search Console; choose the Domain property)"
    say "2. Create the TXT record Search Console shows, at your DNS provider:"
    say "     $VERIFY_DOMAIN.  TXT  \"google-site-verification=TOKEN-FROM-SEARCH-CONSOLE\""
    say "3. Once Search Console says the domain is verified, run this script again with the same flags."
  elif [ "$DOMAIN_MAPPED" = 1 ]; then
    # Google fills in the records a moment after the mapping is created.
    RECORDS=""
    for attempt in 1 2 3 4 5 6; do
      google_api_request GET "$(domain_mappings_url)/$DOMAIN"
      [ "$API_STATUS" != 200 ] || RECORDS="$(mapping_records "$API_BODY")"
      if [ -n "$RECORDS" ] || [ "$attempt" = 6 ] || [ "$DRY_RUN" = 1 ]; then break; fi
      sleep 5
    done
    if [ -z "$RECORDS" ]; then
      DOMAIN_STATE="records"
      warn "Google has not named the DNS records for $DOMAIN yet; run this script again in a minute to see them."
    else
      ZONE="$DOMAIN"
      say "Create these DNS records at the DNS provider of the zone that holds $DOMAIN (zone-file form, then the"
      say "name relative to the zone, as most providers ask for it):"
      DNS_MISSING=0
      while IFS='|' read -r record_type record_name record_data; do
        [ -n "$record_type" ] || continue
        if [ -n "$record_name" ] && [ "${DOMAIN#"$record_name".}" != "$DOMAIN" ]; then ZONE="${DOMAIN#"$record_name".}"; fi
        say "  $DOMAIN.  3600  IN  $record_type  $record_data"
        say "      (name: ${record_name:-@} in the zone $ZONE, type $record_type, value $record_data)"
        wanted="$(LC_ALL=C tr '[:upper:]' '[:lower:]' <<<"${record_data%.}")"
        grep -Fxq "$wanted" <<<"$(dns_answers "$DOMAIN" "$record_type")" || DNS_MISSING=1
      done <<<"$RECORDS"
      READY="$(mapping_condition "$API_BODY" Ready)"
      if [ "${READY%%$'\t'*}" = "True" ]; then
        DOMAIN_STATE="ready"
      elif [ "$DNS_MISSING" = 1 ]; then
        DOMAIN_STATE="dns"
        say "Public DNS does not show these records yet. Google provisions the certificate once they are there, usually"
        say "within 15 minutes (up to 24 hours); nothing more to run. Check: curl -sI https://$DOMAIN/api/healthz"
      elif [ "$DRY_RUN" = 1 ]; then
        DOMAIN_STATE="certificate"
      else
        # The records are visible: wait a while for the certificate, never longer than five minutes.
        DOMAIN_STATE="certificate"
        for attempt in 1 2 3 4 5 6 7 8 9 10; do
          say "certificate: ${READY#*$'\t'} (check $attempt of 10)"
          sleep 30
          google_api_request GET "$(domain_mappings_url)/$DOMAIN"
          READY="$(mapping_condition "$API_BODY" Ready)"
          if [ "${READY%%$'\t'*}" = "True" ]; then
            DOMAIN_STATE="ready"
            break
          fi
        done
      fi
      case "$DOMAIN_STATE" in
        ready) say "https://$DOMAIN is ready: the certificate is provisioned." ;;
        certificate)
          say "The DNS records are in place; Google is still provisioning the certificate (usually 15 minutes, up to"
          say "24 hours). Nothing more to run. Check: curl -sI https://$DOMAIN/api/healthz"
          ;;
      esac
    fi
  fi
fi

# --- 10. What next ------------------------------------------------------------------------------------------

# The flags of this run for the commands below, without --dry-run and, after a build, with the built image in place
# of --build (so a redeploy changes settings without building again; docs/self-host.md, "3. Redeploy with the
# client id").
REDEPLOY_ARGS=()
set -- ${ORIGINAL_ARGS[@]+"${ORIGINAL_ARGS[@]}"}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) shift ;;
    --build) [ "$BUILD" = 0 ] || REDEPLOY_ARGS+=(--image "$IMAGE"); shift ;;
    --build-machine) shift 2 ;;
    *) REDEPLOY_ARGS+=("$1"); shift ;;
  esac
done
# deploy_command [ARGS...]: this script with the flags of this run and ARGS, shell-quoted, ready to copy.
deploy_command() {
  script_command deploy.sh
  printf ' %q' ${REDEPLOY_ARGS[@]+"${REDEPLOY_ARGS[@]}"} "$@"
}
CONSOLE_CLIENTS="https://console.cloud.google.com/auth/clients?project=${PROJECT}"
# The origins the OAuth client must list: every address of the instance.
origins() {
  say "     $URL"
  [ -z "$OTHER_URL" ] || say "     $OTHER_URL   (only if people use this address)"
  [ -z "$DOMAIN" ] || say "     https://$DOMAIN"
}

# The next steps come first: open the address, create the OAuth client, redeploy with its id. Everything else
# follows them.
if [ "$DRY_RUN" = 1 ]; then
  printf '\n%sDry run finished%s in %s: nothing was changed. After the same command without --dry-run:\n' \
    "$BOLD" "$RESET" "$(elapsed)"
else
  printf '\n%sgcportrait is deployed%s in %s.\n' "$BOLD" "$RESET" "$(elapsed)"
fi
printf '\n%sNext steps%s\n' "$BOLD" "$RESET"
if [ "$DEMO_ONLY" = 1 ]; then
  say "1. Open $URL: the demo organisations work at once, with no sign-in."
  if [ -z "$LEGAL_BUNDLE$IMPRESSUM_URL$PRIVACY_URL" ]; then
    say "2. Add legal pages: a public demo usually needs an Impressum and a privacy notice. Link your own with"
    say "   --impressum-url and --privacy-url, or serve texts with --legal-dir (docs/self-host-options.md, \"Legal pages: link or serve\"),"
    say "   then redeploy: $(deploy_command --impressum-url URL --privacy-url URL)"
  fi
elif [ -n "$OAUTH_CLIENT_ID" ]; then
  if [ "$IAP" = 1 ]; then
    say "1. Open $URL as one of $IAP_MEMBERS (Identity-Aware Proxy signs you in first) and choose \"Sign in with Google\"."
  else
    say "1. Open $URL and choose \"Sign in with Google\" (\"Try the demo\" works too)."
  fi
  say "2. Make sure the OAuth client $OAUTH_CLIENT_ID lists these Authorised JavaScript origins"
  say "   ($CONSOLE_CLIENTS):"
  origins
else
  if [ "$IAP" = 1 ]; then
    say "1. Open $URL as one of $IAP_MEMBERS (Identity-Aware Proxy signs you in first): \"Try the demo\" works at once."
  else
    say "1. Open $URL: \"Try the demo\" works at once."
  fi
  say "2. Create the OAuth client for \"Sign in with Google\", the one step Google offers no command for:"
  say "   $CONSOLE_CLIENTS"
  say "   The first time, \"Get started\" sets up the consent screen; under Data Access add the scopes"
  say "   cloud-platform.read-only, cloudasset and userinfo.email. Then Create client > Web application, with no"
  say "   redirect URI and these Authorised JavaScript origins:"
  origins
  say "   Copy its client id."
  say "3. Redeploy with the client id in place of CLIENT_ID:"
  say "   $(deploy_command --oauth-client-id CLIENT_ID)"
fi

printf '\n%sThe instance%s\n' "$BOLD" "$RESET"
say "Address:          $URL"
[ -z "$OTHER_URL" ] || say "Also answers on:  $OTHER_URL"
say "Service account:  $BACKEND_SA_EMAIL (no roles granted by deploy.sh)"
say "Image:            $IMAGE"
[ -z "$GHCR_DIGEST" ] || say "                  (ghcr.io/$GHCR_PATH $GHCR_REFERENCE: $GHCR_DIGEST)"
if [ "$DEMO_ONLY" = 1 ]; then
  say "Mode:             demo-only: the demo organisations only, no sign-in, nothing read from Google Cloud"
  say "Access:           public"
else
  say "Sign-in:          ${OAUTH_CLIENT_ID:-not configured yet (step 2 above)}"
  say "Service-account mode: $([ "$SA_MODE" = 1 ] && echo on || echo off)"
  say "Access:           $([ "$IAP" = 1 ] && echo "Identity-Aware Proxy: $IAP_MEMBERS" || echo "public; reading Google Cloud data needs a Google sign-in")"
fi
if [ -n "$DOMAIN" ]; then
  case "$DOMAIN_STATE" in
    ready) DOMAIN_SUMMARY="ready" ;;
    certificate) DOMAIN_SUMMARY="mapped; DNS records in place, the certificate is being provisioned" ;;
    dns) DOMAIN_SUMMARY="mapped; waiting for the DNS records above" ;;
    records) DOMAIN_SUMMARY="mapped; Google has not named the DNS records yet" ;;
    unverified) DOMAIN_SUMMARY="not mapped: verify $(domain_to_verify "$DOMAIN") in Search Console first (above)" ;;
    *) DOMAIN_SUMMARY="would be mapped (dry run)" ;;
  esac
  say "Custom domain:    https://$DOMAIN ($DOMAIN_SUMMARY)"
fi
if [ -n "$LEGAL_BUNDLE" ]; then
  LEGAL_SHOWN=""
  for page in $LEGAL_PAGES; do [ ! -f "$LEGAL_DIR/$page.md" ] || LEGAL_SHOWN="$LEGAL_SHOWN /$page"; done
  say "Legal pages:     $LEGAL_SHOWN (from --legal-dir; the footer links them)"
fi
[ -z "$IMPRESSUM_URL" ] || say "Impressum:        $IMPRESSUM_URL (--impressum-url; in /api/config for the footer)"
[ -z "$PRIVACY_URL" ] || say "Privacy notice:   $PRIVACY_URL (--privacy-url; in /api/config for the footer)"

if [ "$DEMO_ONLY" = 1 ]; then
  printf '\n%sDemo-only%s (docs/self-host-options.md, "Demo-only instance")\n' "$BOLD" "$RESET"
  say "The Connect page offers the demo organisations and a link to the self-hosting guide; there is no sign-in,"
  say "and the routes that read Google Cloud are not there. Deploy without --demo-only for an instance that reads"
  say "your own organisation."
  # Without any legal page, step 2 of the next steps above says how to add them; it is not repeated here.
  if [ -n "$IMPRESSUM_URL$PRIVACY_URL" ]; then
    say "Legal pages linked on your own site:${IMPRESSUM_URL:+ Impressum $IMPRESSUM_URL}${PRIVACY_URL:+ privacy notice $PRIVACY_URL}"
    say "(/api/config reports them for the app's footer)."
  fi
else
  printf '\n%sService-account mode%s (optional; docs/self-host-options.md, "Service-account mode")\n' "$BOLD" "$RESET"
  if [ "$SA_MODE" = 1 ]; then
    say "It is on. A team grants the account read access to a scope it chooses, for example:"
  else
    say "Deploy with --sa-mode, then a team grants the account read access to a scope it chooses, for example:"
  fi
  say "  gcloud projects add-iam-policy-binding PROJECT_ID --member=serviceAccount:${BACKEND_SA_EMAIL} --role=roles/cloudasset.viewer"
  say "  gcloud resource-manager folders add-iam-policy-binding FOLDER_ID --member=serviceAccount:${BACKEND_SA_EMAIL} --role=roles/cloudasset.viewer"
  say "Grant roles/cloudasset.viewer only, and prefer folders or projects to a whole organisation."
fi

printf '\n%sLater%s\n' "$BOLD" "$RESET"
printf '    Redeploy with the same settings: %s\n' "$(deploy_command)"
if [ "$BUILD" = 1 ]; then
  say "(that reuses the image built now; with --build in place of --image it builds your checkout again)"
elif [ -n "$GHCR_PATH" ] && [ -z "$IMAGE_ARG" ]; then
  say "(that deploys whatever release is the newest then; --image vX.Y.Z pins one)"
fi
say "Remove everything this script created: $(script_command uninstall.sh) --project $PROJECT --region $REGION --service $SERVICE"
if [ "$BUILD" = 1 ]; then
  say "Running a modified version? If you publish its source, --source-url points the footer's source link there."
fi
