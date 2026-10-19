#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# The Cloud Run Button's postcreate hook (app.json at the repository root; docs/self-host-options.md, "Run on
# Google Cloud"). The button builds infra/Dockerfile in Cloud Shell, deploys the service with the two
# variables it asks for and the options of app.json, and runs this once, right after it created the service.
# This adds what the button cannot set, the settings infra/deploy.sh gives every instance: TRUST_PROXY_HOPS=1
# (Cloud Run's front end is one proxy hop), a 900 s request timeout for long pulls, startup CPU boost and the
# /healthz probes. It also sets app.json's limit of 10 instances: the button writes its max-instances option
# under a misspelt annotation key (`autoscaling.knative.dev` + `maxScale`, no slash;
# cmd/cloudshell_open/deploy.go), which Cloud Run does not apply. It removes OAUTH_CLIENT_ID when it was left
# at `none` (the button wants a value for every variable it asks for, and an empty one is not accepted), then
# prints the next steps. One `gcloud run services update`, so one more revision.
#
# The button passes GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_REGION, K_SERVICE and SERVICE_URL, and the variables it asked
# for (OAUTH_CLIENT_ID, SA_MODE_ENABLED). Run by hand, set them yourself:
#
#   GOOGLE_CLOUD_PROJECT=P GOOGLE_CLOUD_REGION=R K_SERVICE=gcportrait SERVICE_URL=https://... \
#     OAUTH_CLIENT_ID=none infra/cloud-run-button.sh

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=infra/common.sh
. "$SCRIPT_DIR/common.sh"

banner "infra/cloud-run-button.sh"
for name in GOOGLE_CLOUD_PROJECT GOOGLE_CLOUD_REGION K_SERVICE SERVICE_URL; do
  [ -n "${!name:-}" ] || die "$name is not set: the Cloud Run Button sets it for its hooks (see the top of this file)"
done
PROJECT="$GOOGLE_CLOUD_PROJECT"
REGION="$GOOGLE_CLOUD_REGION"
SERVICE="$K_SERVICE"
valid_project_id "$PROJECT" || die "GOOGLE_CLOUD_PROJECT must be a project id"
valid_region "$REGION" || die "GOOGLE_CLOUD_REGION must be a Cloud Run region such as europe-west3"
CLIENT_ID="$(trim "${OAUTH_CLIENT_ID:-}")"

step "Completing the settings of $SERVICE"
FLAGS=(--update-env-vars=TRUST_PROXY_HOPS=1 --timeout=900 --cpu-boost --max-instances=10
  --startup-probe="$STARTUP_PROBE" --liveness-probe="$LIVENESS_PROBE")
if [ -z "$CLIENT_ID" ] || [ "$CLIENT_ID" = none ]; then
  FLAGS+=(--remove-env-vars=OAUTH_CLIENT_ID)
  CLIENT_ID=""
fi
run gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" "${FLAGS[@]}" --quiet

PROJECT_NUMBER="$(project_number)"
URL="$SERVICE_URL"
[ -z "$PROJECT_NUMBER" ] || URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"

printf '\n%sgcportrait is running%s at %s\n' "$BOLD" "$RESET" "$URL"
[ "$URL" = "$SERVICE_URL" ] || say "(also at $SERVICE_URL)"
say "Demo mode works at once (\"Try the demo\"). Sign-in needs an OAuth client of yours:"
say "1. Open https://console.cloud.google.com/auth/clients?project=${PROJECT}"
say "   (Google Auth Platform > Clients; the first time, \"Get started\" sets up the consent screen)."
say "2. Create client > Web application. Authorised JavaScript origins: $URL"
[ "$URL" = "$SERVICE_URL" ] || say "   and, only if people use it, $SERVICE_URL"
say "   No redirect URI. Scopes on the consent screen: cloud-platform.read-only, cloudasset, userinfo.email."
if [ -n "$CLIENT_ID" ]; then
  say "   (The service already has the client id $CLIENT_ID: make sure that client lists the origin above.)"
fi
say "3. Give the service the client id:"
say "   gcloud run services update $SERVICE --project=$PROJECT --region=$REGION --update-env-vars=OAUTH_CLIENT_ID=CLIENT_ID"
say "   (A later click of the button asks for OAUTH_CLIENT_ID again until the service has one: answer with the client"
say "   id, not none. This hook does not run again, so a none would stay and sign-in would fail.)"
if [ "${SA_MODE_ENABLED:-false}" = true ]; then
  warn "service-account mode is on, and this service runs as the project's Compute Engine default account, which other workloads of the project may share and which may hold Editor on it. Prefer infra/deploy.sh --sa-mode, which gives the instance an account of its own (docs/self-host-options.md, \"Service-account mode\")."
fi
printf '\n%sLater%s (docs/self-host-options.md, "Run on Google Cloud")\n' "$BOLD" "$RESET"
say "The button deployed $SERVICE as the project's Compute Engine default account, with its image in the"
say "Artifact Registry repository cloud-run-source-deploy. infra/deploy.sh and infra/uninstall.sh leave services they"
say "did not create alone; to manage this one with them (an account of its own, service-account mode, IAP, updates"
say "to new releases), run infra/deploy.sh --project $PROJECT --region $REGION: it names the one command that hands"
say "the service over. To remove it instead: gcloud run services delete $SERVICE --project=$PROJECT --region=$REGION"
