#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Removes a gcportrait instance that infra/deploy.sh created (docs/self-host.md, "Uninstall").
# Run with --help for usage and the limits of --disable-apis (usage below).
# Resource ownership and removal rules: infra/AGENTS.md, Self-hosting.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/common.sh
. "$SCRIPT_DIR/common.sh"

usage() {
  printf 'gcportrait infra/uninstall.sh\n\n'
  cat <<'USAGE'
Usage: infra/uninstall.sh --project PROJECT_ID [options]

Removes what infra/deploy.sh created for one instance, and nothing else (with the domain mappings of
--domain that route to its service). The remote repository ghcr, through which deploy.sh pulls released
images, goes too when deploy.sh created it and no other Cloud Run service or job of the project deploys
from it.

  --project ID       The project the instance runs in (required).
  --region REGION    Its region (default: europe-west3).
  --service NAME     Its Cloud Run service name (default: gcportrait).
  --disable-apis     Also disable the Google APIs deploy.sh enabled (recorded on the service and the build
                     repository). Kept all the same: an API another Cloud Run service, job or worker pool of
                     the project still needs (run, iam, artifactregistry, cloudbuild and storage while any
                     other one exists; iap while a service has IAP on; every API of an instance while another
                     gcportrait instance exists), every API when those cannot be listed, and an API other
                     enabled APIs depend on. Workloads outside Cloud Run (GKE, Compute Engine, App Engine,
                     first-generation Cloud Functions, IAP on a load balancer) are not looked at, and Google's
                     check for recent use is skipped, so pass this only when no such workload uses them.
  --yes              Do not ask for confirmation (needed when there is no terminal).
  --dry-run          Print what would be deleted, delete nothing.
  -h, --help         This help.
USAGE
  usage_statement
}

PROJECT=""
REGION="$DEFAULT_REGION"
SERVICE="$DEFAULT_SERVICE"
DISABLE_APIS=0
YES=0
DRY_RUN=0

need_value() { [ "$#" -ge 2 ] && [ -n "$2" ] || die "$1 needs a value (see --help)"; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project) need_value "$@"; PROJECT="$2"; shift 2 ;;
    --region) need_value "$@"; REGION="$2"; shift 2 ;;
    --service) need_value "$@"; SERVICE="$2"; shift 2 ;;
    --disable-apis) DISABLE_APIS=1; shift ;;
    --yes) YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

[ -n "$PROJECT" ] || { usage >&2; die "--project is required"; }
valid_project_id "$PROJECT" || die "--project must be a project id"
valid_region "$REGION" || die "--region must be a Cloud Run region such as europe-west3"
valid_service "$SERVICE" || die "--service must be 1 to 22 lowercase letters, digits and dashes"
derive_names
# Reports a failure of the script itself; the ERR trap also runs inside $(...) and pipelines (set -E), where a
# failing query is expected and handled.
on_error() {
  [ "$BASH_SUBSHELL" = 0 ] || return 0
  printf '\n%serror:%s uninstall.sh stopped during "%s". It is safe to run it again.\n' "$RED" "$RESET" "$CURRENT_STEP" >&2
}
trap on_error ERR

# --- 1. What is there ----------------------------------------------------------------------------------------

banner "infra/uninstall.sh"
step "Looking for what deploy.sh created in $PROJECT"
require_gcloud
PROJECT_NUMBER="$(project_number)"
[ -n "$PROJECT_NUMBER" ] || die "project $PROJECT not found, or $GCLOUD_ACCOUNT cannot see it (or gcloud's sign-in has expired: gcloud auth login)"

DELETE_SERVICE=0
DOMAIN_MAPPINGS=""
DELETE_REPO=0
DELETE_BUCKET=0
DELETE_BACKEND_SA=0
DELETE_BUILD_SA=0
DELETE_REMOTE_REPO=0
RECORDED_APIS=""

# Adds the APIs recorded in LABELS (`gcportrait-api-NAME=enabled`, on the service or the build repository) to
# RECORDED_APIS, each once.
collect_recorded_apis() {
  local pair name
  for pair in $(printf '%s\n' "$1" | tr ';' ' ' | tr ',' ' '); do
    case "$pair" in
      "${API_LABEL_PREFIX}"*=enabled)
        name="${pair#"$API_LABEL_PREFIX"}"
        name="${name%=enabled}.googleapis.com"
        case " $RECORDED_APIS " in *" $name "*) ;; *) RECORDED_APIS="$RECORDED_APIS $name" ;; esac
        ;;
    esac
  done
}

LABELS="$(service_labels || true)"
if [ -z "$LABELS" ] && ! gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" >/dev/null 2>&1; then
  say "no Cloud Run service $SERVICE in $REGION"
elif has_managed_label "$LABELS"; then
  DELETE_SERVICE=1
  say "Cloud Run service: $SERVICE ($REGION)"
  collect_recorded_apis "$LABELS"
else
  say "keeping Cloud Run service $SERVICE: it has no $MANAGED_LABEL label, so deploy.sh did not create it"
fi

# The domain mappings that route to the service (deploy.sh --domain), only in the regions that have them. A
# mapping is a Cloud Run resource of its own: deleting the service would leave it pointing at nothing.
if [ "$DELETE_SERVICE" = 1 ] && domain_mapping_region "$REGION"; then
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl is not installed, so the domain mappings in $REGION cannot be listed; one that routes to $SERVICE stays (gcloud beta run domain-mappings list --project=$PROJECT --region=$REGION)"
  else
    google_api_request GET "$(domain_mappings_url)"
    if [ "$API_STATUS" = 200 ]; then
      DOMAIN_MAPPINGS="$(json_flatten <<<"$API_BODY" | awk -F '\t' -v service="$SERVICE" '
        $1 ~ /^items\.[0-9]+\.metadata\.name$/ { split($1, p, "."); name[p[2]] = $2 }
        $1 ~ /^items\.[0-9]+\.spec\.routeName$/ { split($1, p, "."); route[p[2]] = $2 }
        END { for (i in name) if (route[i] == service) print name[i] }' | sort)"
      for mapping in $DOMAIN_MAPPINGS; do say "domain mapping: $mapping (routes to $SERVICE)"; done
    else
      warn "could not list the domain mappings in $REGION (HTTP $API_STATUS); one that routes to $SERVICE stays (gcloud beta run domain-mappings list --project=$PROJECT --region=$REGION)"
    fi
  fi
fi

REPO_LABELS="$(gcloud artifacts repositories describe "$BUILD_REPO" --project="$PROJECT" --location="$REGION" \
  --format='value(labels)' 2>/dev/null || true)"
if gcloud artifacts repositories describe "$BUILD_REPO" --project="$PROJECT" --location="$REGION" >/dev/null 2>&1; then
  if has_managed_label "$REPO_LABELS"; then
    DELETE_REPO=1
    say "Artifact Registry repository: $BUILD_REPO ($REGION), with its images"
    collect_recorded_apis "$REPO_LABELS"
  else
    say "keeping repository $BUILD_REPO: it has no $MANAGED_LABEL label"
  fi
fi

# The remote repository of released images (deploy.sh without --build; common.sh). Every instance of the region
# that deploys a release pulls through it, so it goes only with the last one: when it carries deploy.sh's label and
# no other Cloud Run service or job of the project, in any region, has an image from it. When the services or jobs
# cannot be listed, it stays.
# remote_repo_users: the services and jobs, other than this instance's own service, whose image comes from the
# remote repository, as "service NAME (REGION), job NAME (REGION)"; fails when either list cannot be read.
remote_repo_users() {
  local services jobs kind name region images users=""
  services="$(gcloud run services list --project="$PROJECT" \
    --format='value[separator="|"](metadata.name,region,spec.template.spec.containers[].image.list())' 2>/dev/null)" || return 1
  jobs="$(gcloud run jobs list --project="$PROJECT" \
    --format='value[separator="|"](metadata.name,region,spec.template.spec.template.spec.containers[].image.list())' 2>/dev/null)" || return 1
  for kind in service job; do
    while IFS='|' read -r name region images; do
      [ -n "$name" ] || continue
      if [ "$kind" = service ] && [ "$name" = "$SERVICE" ] && [ "$region" = "$REGION" ] && [ "$DELETE_SERVICE" = 1 ]; then
        continue
      fi
      case ",$images" in *",${REMOTE_PREFIX}/"*) users="${users:+$users, }$kind $name ($region)" ;; esac
    done <<<"$([ "$kind" = service ] && printf '%s' "$services" || printf '%s' "$jobs")"
  done
  printf '%s' "$users"
}
if REMOTE_INFO="$(remote_repo_info)"; then
  IFS='|' read -r _ _ REMOTE_LABELS _ <<<"$REMOTE_INFO" || true
  if ! has_managed_label "${REMOTE_LABELS:-}"; then
    say "keeping remote repository $REMOTE_REPO ($REGION): it has no $MANAGED_LABEL label"
  elif ! REMOTE_USERS="$(remote_repo_users)"; then
    say "keeping remote repository $REMOTE_REPO ($REGION): the project's Cloud Run services and jobs could not be listed, so another one may deploy from it"
  elif [ -n "$REMOTE_USERS" ]; then
    say "keeping remote repository $REMOTE_REPO ($REGION): $REMOTE_USERS still deploys from it"
  else
    DELETE_REMOTE_REPO=1
    say "Artifact Registry remote repository: $REMOTE_REPO ($REGION), with the ghcr.io images it holds"
  fi
fi

# Bucket names are global, so the bucket must also belong to this project.
if BUCKET_INFO="$(bucket_owner_and_labels "$BUILD_BUCKET")"; then
  read -r BUCKET_PROJECT_NUMBER BUCKET_LABELS <<<"$BUCKET_INFO" || true
  if [ "${BUCKET_PROJECT_NUMBER:-}" != "$PROJECT_NUMBER" ]; then
    say "keeping bucket gs://$BUILD_BUCKET: it belongs to another project"
  elif has_managed_label "${BUCKET_LABELS:-}"; then
    DELETE_BUCKET=1
    say "Cloud Storage bucket: gs://$BUILD_BUCKET, with its objects (uploaded sources and build logs)"
  else
    say "keeping bucket gs://$BUILD_BUCKET: it has no $MANAGED_LABEL label"
  fi
fi

for which in BACKEND BUILD; do
  if [ "$which" = BACKEND ]; then
    email="$BACKEND_SA_EMAIL" description="$BACKEND_SA_DESCRIPTION"
  else
    email="$BUILD_SA_EMAIL" description="$BUILD_SA_DESCRIPTION"
  fi
  service_account_exists "$email" || continue
  # Exactly deploy.sh's description for this service (common.sh), never one of a service whose name only starts
  # the same way.
  if service_account_is_ours "$email" "$description"; then
    if [ "$which" = BACKEND ]; then DELETE_BACKEND_SA=1; else DELETE_BUILD_SA=1; fi
    say "service account: $email"
  else
    say "keeping service account $email: deploy.sh did not create it"
  fi
done

# The APIs other Cloud Run workloads of the project still need (one in another region counts too). Any service,
# job or worker pool: Cloud Run itself, IAM (its identity), Artifact Registry (its image), and Cloud Build and
# Cloud Storage (redeploying from source); IAP for a service with IAP on. Another gcportrait instance (deploy.sh's
# label): every API deploy.sh enables for one. When any of the three lists cannot be read (an older gcloud
# without `run worker-pools`, say), every recorded API is kept. Workloads outside Cloud Run are not looked at
# (--help says so).
NEEDED_APIS=""
NEEDED_BY=""
# need_api API WHO: WHO (`KIND:NAME/REGION`, KIND one of service, job, worker-pool) still needs API; the first
# one found is the one named.
need_api() {
  case " $NEEDED_APIS " in *" $1 "*) ;; *) NEEDED_APIS="$NEEDED_APIS $1" NEEDED_BY="$NEEDED_BY $1=$2" ;; esac
}
ANY_SERVICE_APIS="run.googleapis.com iam.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com storage.googleapis.com"
INSTANCE_APIS="$ANY_SERVICE_APIS cloudasset.googleapis.com cloudresourcemanager.googleapis.com"
WORKLOADS_LISTED=1
if [ "$DISABLE_APIS" = 1 ] && [ -n "$RECORDED_APIS" ]; then
  if OTHER_SERVICES="$(gcloud run services list --project="$PROJECT" \
    --format='value[separator="|"](metadata.name,region,metadata.annotations."run.googleapis.com/iap-enabled",metadata.labels)' \
    2>/dev/null)"; then
    while IFS='|' read -r other_name other_region other_iap other_labels; do
      [ -n "$other_name" ] || continue
      # This instance's own service does not count once it is deleted; kept (not deploy.sh's), it does.
      if [ "$other_name" = "$SERVICE" ] && [ "$other_region" = "$REGION" ] && [ "$DELETE_SERVICE" = 1 ]; then continue; fi
      if has_managed_label "$other_labels"; then other_apis="$INSTANCE_APIS"; else other_apis="$ANY_SERVICE_APIS"; fi
      [ "$other_iap" != "true" ] || other_apis="$other_apis iap.googleapis.com"
      for api in $other_apis; do need_api "$api" "service:$other_name/$other_region"; done
    done <<<"$OTHER_SERVICES"
  else
    WORKLOADS_LISTED=0
  fi
  # deploy.sh creates neither jobs nor worker pools, so each one is another workload.
  for kind in jobs worker-pools; do
    [ "$WORKLOADS_LISTED" = 1 ] || break
    if OTHER_WORKLOADS="$(gcloud run "$kind" list --project="$PROJECT" \
      --format='value[separator="|"](metadata.name,region)' 2>/dev/null)"; then
      while IFS='|' read -r other_name other_region; do
        [ -n "$other_name" ] || continue
        for api in $ANY_SERVICE_APIS; do need_api "$api" "${kind%s}:$other_name/$other_region"; done
      done <<<"$OTHER_WORKLOADS"
    else
      WORKLOADS_LISTED=0
    fi
  done
fi
# api_needed_by API: the other workload that needs API (`the Cloud Run KIND NAME/REGION`), or nothing.
api_needed_by() {
  local pair who kind
  for pair in $NEEDED_BY; do
    if [ "${pair%%=*}" = "$1" ]; then
      who="${pair#*=}" kind="${who%%:*}"
      printf 'the Cloud Run %s %s' "${kind//-/ }" "${who#*:}"
      return 0
    fi
  done
}

DISABLE_LIST=""
if [ -n "$RECORDED_APIS" ]; then
  if [ "$DISABLE_APIS" = 0 ]; then
    say "APIs deploy.sh enabled, kept (pass --disable-apis to disable them):$RECORDED_APIS"
  elif [ "$WORKLOADS_LISTED" = 0 ]; then
    warn "could not list the project's Cloud Run services, jobs and worker pools, so every API deploy.sh enabled is kept:$RECORDED_APIS"
  else
    for api in $RECORDED_APIS; do
      needed_by="$(api_needed_by "$api")"
      if [ -n "$needed_by" ]; then
        say "keeping $api: $needed_by still needs it"
      else
        DISABLE_LIST="$DISABLE_LIST $api"
      fi
    done
    [ -z "$DISABLE_LIST" ] || say "APIs deploy.sh enabled, to disable:$DISABLE_LIST"
  fi
fi

TOTAL=$((DELETE_SERVICE + DELETE_REPO + DELETE_REMOTE_REPO + DELETE_BUCKET + DELETE_BACKEND_SA + DELETE_BUILD_SA))
if [ "$TOTAL" = 0 ] && [ -z "$DISABLE_LIST" ]; then
  printf '\nNothing of %s to remove in %s.\n' "$SERVICE" "$PROJECT"
  exit 0
fi

# --- 2. Confirmation -----------------------------------------------------------------------------------------

if [ "$DRY_RUN" = 1 ]; then
  say "dry run: the commands below are printed, not run"
elif [ "$YES" = 0 ]; then
  [ -t 0 ] || die "no terminal to confirm on; pass --yes to delete the resources listed above"
  printf '\nThis deletes the resources listed above for good. Type the service name (%s) to go on: ' "$SERVICE"
  read -r answer
  [ "$answer" = "$SERVICE" ] || die "not confirmed; nothing was deleted"
fi

# --- 3. Removal ----------------------------------------------------------------------------------------------

if [ -n "$DOMAIN_MAPPINGS" ]; then
  step "Deleting the domain mappings to the service"
  for mapping in $DOMAIN_MAPPINGS; do
    show_cmd DELETE "$(domain_mappings_url)/$mapping"
    [ "$DRY_RUN" = 0 ] || continue
    google_api_request DELETE "$(domain_mappings_url)/$mapping"
    case "$API_STATUS" in
      200 | 202 | 404) say "deleted: $mapping (its DNS records at your DNS provider are yours to remove)" ;;
      *) die "could not delete the domain mapping $mapping (HTTP $API_STATUS): $(json_value "$API_BODY" error.message)" ;;
    esac
  done
fi
if [ "$DELETE_SERVICE" = 1 ]; then
  step "Deleting the Cloud Run service"
  run gcloud run services delete "$SERVICE" --project="$PROJECT" --region="$REGION" --quiet
fi
if [ "$DELETE_REPO" = 1 ]; then
  step "Deleting the build repository and its images"
  run gcloud artifacts repositories delete "$BUILD_REPO" --project="$PROJECT" --location="$REGION" --quiet
fi
if [ "$DELETE_REMOTE_REPO" = 1 ]; then
  step "Deleting the remote repository of ghcr.io images"
  run gcloud artifacts repositories delete "$REMOTE_REPO" --project="$PROJECT" --location="$REGION" --quiet
fi
if [ "$DELETE_BUCKET" = 1 ]; then
  step "Deleting the build bucket and its objects"
  run gcloud storage rm --recursive "gs://$BUILD_BUCKET"
fi
if [ "$DELETE_BUILD_SA" = 1 ]; then
  step "Deleting the build service account"
  run gcloud iam service-accounts delete "$BUILD_SA_EMAIL" --project="$PROJECT" --quiet
fi
if [ "$DELETE_BACKEND_SA" = 1 ]; then
  step "Deleting the backend's service account"
  run gcloud iam service-accounts delete "$BACKEND_SA_EMAIL" --project="$PROJECT" --quiet
  say "Grants made to it elsewhere (roles/cloudasset.viewer on a team's scope) now show as deleted:serviceAccount"
  say "members there; their owners can remove them."
fi

if [ -n "$DISABLE_LIST" ]; then
  step "Disabling the APIs deploy.sh enabled"
  for api in $DISABLE_LIST; do
    # Through the Service Usage API itself: gcloud's own command either refuses an API used in the last 30 days
    # or, with --force, also disables every API that depends on it. This call disables only this one, and is
    # refused while another enabled API depends on it.
    printf '    %s+%s POST serviceusage.googleapis.com/v1/projects/%s/services/%s:disable\n' "$DIM" "$RESET" "$PROJECT" "$api" >&2
    [ "$DRY_RUN" = 0 ] || continue
    if answer="$(google_api POST "https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services/${api}:disable" \
      '{"disableDependentServices": false, "checkIfServiceHasUsage": "SKIP"}' 2>&1)"; then
      say "disabled: $api"
    else
      warn "kept $api: Google refused to disable it; other enabled APIs may depend on it. Google said: $answer"
    fi
  done
fi

printf '\n%sDone%s in %s.\n' "$BOLD" "$RESET" "$(elapsed)"
