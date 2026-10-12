#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# spike-quota-project.sh: re-runs the call matrix of the quota-project spike against Cloud Asset Inventory and
# Resource Manager with access tokens you supply, and prints one summary line per call.
# The matrix and what was observed: docs/spikes/quota-project.md. The decisions taken from it:
# docs/adr/0028-quota-project-and-sa-gate.md.
#
# Tokens are read from standard input only (never from arguments, the environment or a file) and are
# handed to curl on its standard input (-H @-), so they appear in no process list, file or log. Response
# bodies are summarised (HTTP status, error status, ErrorInfo reason, counts); asset payloads are never
# printed. Before printing, every id passed with --other-project, --old-project, --disabled-quota-project,
# --bad-quota-project, --denied-scope or a --quota-project other than --project is replaced by its label,
# the scanned project's number by PROJECT_NUMBER, e-mail addresses by <email>, and any other run of six or
# more digits by <nLEN> (its length only), so the output can be pasted into an issue. The --project id
# itself is printed.
#
# Usage:
#   gcloud auth print-access-token | scripts/spike-quota-project.sh --project PROJECT_ID
#
#   { gcloud auth print-access-token
#     gcloud auth print-access-token --impersonate-service-account=BACKEND_SA_EMAIL
#   } | scripts/spike-quota-project.sh --project PROJECT_ID --sa
#
# Options:
#   --project ID                 project to scan, and the quota project of the rows that send one (required)
#   --quota-project ID           quota project for those rows instead of --project (printed as QUOTA_PROJECT)
#   --bad-quota-project ID       an id that cannot be a quota project (default: <project>-s1-missing;
#                                printed as BAD_QP when given)
#   --disabled-quota-project ID  a project where the caller may use services but the Cloud Asset API is
#                                disabled (row c2, printed as DISABLED_QP; skipped without it)
#   --denied-scope SCOPE         a scope the caller cannot read (default: organizations/1; printed as
#                                DENIED_SCOPE when given)
#   --other-project ID           an existing project the caller has no role on, ideally one whose `get` is
#                                public (rows c3, d3, g5, s4, gate3; skipped without it)
#   --old-project ID             a project older than 35 days the caller can get and list, on which the
#                                service account has no role (rows e5, e6, s7-s9, gate4; skipped without it)
#   --read-time RFC3339          an extra readTime to probe on --project, e.g. just before or after the
#                                project was created (row e7; skipped without it)
#   --sa                         read a second token, the backend service account's, from line 2 of
#                                standard input and run the s and gate rows
#   --only LIST                  comma-separated row ids or id prefixes to run, e.g. "a,b,e" (default: all)
#   --json                       one JSON object per row instead of the table
#   -h, --help                   this text
#
# Requires bash 3.2 or newer, curl 7.55 or newer and jq 1.6 or newer. Exit status 0 when every row ran,
# whatever the APIs answered; 2 on a usage error.

set +x
set -euo pipefail

CAI='https://cloudasset.googleapis.com/v1'
CRM='https://cloudresourcemanager.googleapis.com/v3'
TOKENINFO='https://oauth2.googleapis.com/tokeninfo'
DEFAULT_DENIED_SCOPE='organizations/1'

usage() {
  awk 'NR >= 4 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$0"
}

die() {
  printf 'spike-quota-project: %s\n' "$1" >&2
  exit 2
}

PROJECT=''
QUOTA=''
BAD_QUOTA=''
DISABLED_QUOTA=''
DENIED_SCOPE=''
OTHER_PROJECT=''
OLD_PROJECT=''
READ_TIME=''
WITH_SA=0
ONLY=''
JSON=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT=${2:-}; shift 2 ;;
    --quota-project) QUOTA=${2:-}; shift 2 ;;
    --bad-quota-project) BAD_QUOTA=${2:-}; shift 2 ;;
    --disabled-quota-project) DISABLED_QUOTA=${2:-}; shift 2 ;;
    --denied-scope) DENIED_SCOPE=${2:-}; shift 2 ;;
    --other-project) OTHER_PROJECT=${2:-}; shift 2 ;;
    --old-project) OLD_PROJECT=${2:-}; shift 2 ;;
    --read-time) READ_TIME=${2:-}; shift 2 ;;
    --sa) WITH_SA=1; shift ;;
    --only) ONLY=${2:-}; shift 2 ;;
    --json) JSON=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

command -v curl >/dev/null 2>&1 || die 'curl is required'
command -v jq >/dev/null 2>&1 || die 'jq is required'

# Identifiers end up in URLs and headers: accept only the characters Google allows in them.
PROJECT_RE='^[a-z0-9][a-z0-9.:-]{4,62}$'
SCOPE_RE='^(organizations|folders|projects)/[a-z0-9][a-z0-9.:-]{0,62}$'
TOKEN_RE='^[A-Za-z0-9._~+/=-]+$'
TIME_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$'
valid_project() { [[ $1 =~ $PROJECT_RE ]]; }
valid_scope() { [[ $1 =~ $SCOPE_RE ]]; }

[ -n "$PROJECT" ] || die '--project is required (see --help)'
valid_project "$PROJECT" || die "--project is not a project id: $PROJECT"

# Labels: what the rows print in place of the ids you supplied. Ids derived from --project, and the default
# denied scope, are printed as they are. A *_MASK value is what the output masks ('' = nothing to mask).
QUOTA_LABEL=$PROJECT QUOTA_MASK=''
if [ -n "$QUOTA" ] && [ "$QUOTA" != "$PROJECT" ]; then QUOTA_LABEL='QUOTA_PROJECT' QUOTA_MASK=$QUOTA; fi
[ -n "$QUOTA" ] || QUOTA=$PROJECT
MISSING_PROJECT="$PROJECT-s1-missing"
BAD_LABEL=$MISSING_PROJECT BAD_MASK=''
if [ -n "$BAD_QUOTA" ] && [ "$BAD_QUOTA" != "$MISSING_PROJECT" ]; then BAD_LABEL='BAD_QP' BAD_MASK=$BAD_QUOTA; fi
[ -n "$BAD_QUOTA" ] || BAD_QUOTA=$MISSING_PROJECT
DENIED_LABEL=$DEFAULT_DENIED_SCOPE DENIED_MASK=''
if [ -n "$DENIED_SCOPE" ] && [ "$DENIED_SCOPE" != "$DEFAULT_DENIED_SCOPE" ]; then
  DENIED_LABEL='DENIED_SCOPE' DENIED_MASK=$DENIED_SCOPE
fi
[ -n "$DENIED_SCOPE" ] || DENIED_SCOPE=$DEFAULT_DENIED_SCOPE

for value in "$QUOTA" "$BAD_QUOTA" "$MISSING_PROJECT"; do
  valid_project "$value" || die "not a project id: $value"
done
[ -z "$DISABLED_QUOTA" ] || valid_project "$DISABLED_QUOTA" || die "not a project id: $DISABLED_QUOTA"
[ -z "$OTHER_PROJECT" ] || valid_project "$OTHER_PROJECT" || die "not a project id: $OTHER_PROJECT"
[ -z "$OLD_PROJECT" ] || valid_project "$OLD_PROJECT" || die "not a project id: $OLD_PROJECT"
[ -z "$READ_TIME" ] || [[ $READ_TIME =~ $TIME_RE ]] || die "--read-time is not an RFC 3339 UTC time: $READ_TIME"
valid_scope "$DENIED_SCOPE" || die "--denied-scope is not a scope: $DENIED_SCOPE"

# Tokens: line 1 is the caller's, line 2 (with --sa) the service account's.
read_token() {
  local prompt=$1 value=''
  if [ -t 0 ]; then
    printf '%s (input hidden): ' "$prompt" >&2
    IFS= read -rs value || true
    printf '\n' >&2
  else
    IFS= read -r value || true
  fi
  value=${value%$'\r'}
  if ! [[ $value =~ $TOKEN_RE ]] || [ ${#value} -lt 20 ] || [ ${#value} -gt 8192 ]; then
    die "$prompt: expected an OAuth access token on standard input"
  fi
  printf '%s' "$value"
}

CALLER=$(read_token 'caller access token')
SA_TOKEN=''
if [ "$WITH_SA" = 1 ]; then
  SA_TOKEN=$(read_token 'service-account access token')
fi

selected() {
  [ -z "$ONLY" ] && return 0
  local item
  local IFS=','
  for item in $ONLY; do
    case "$1" in "$item"*) return 0 ;; esac
  done
  return 1
}

# RFC 3339 timestamp, offset seconds from now (GNU date first, then BSD date).
iso_at() {
  local t=$(($(date -u +%s) + $1))
  date -u -d "@$t" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$t" +%Y-%m-%dT%H:%M:%SZ
}

RESP_STATUS=''
RESP_BODY=''

# request TOKEN METHOD URL QUOTA_PROJECT BODY OVERRIDE: sets RESP_STATUS and RESP_BODY.
request() {
  local token=$1 method=$2 url=$3 quota=$4 body=$5 override=$6 out
  local args=(-sS --max-time 60 -X "$method" -w $'\n%{http_code}')
  if [ -n "$body" ]; then
    args+=(-H 'Content-Type: application/json' --data-raw "$body")
  fi
  if out=$(
    {
      printf 'Authorization: Bearer %s\n' "$token"
      if [ -n "$quota" ]; then printf 'x-goog-user-project: %s\n' "$quota"; fi
      if [ -n "$override" ]; then printf 'X-HTTP-Method-Override: GET\n'; fi
    } | curl "${args[@]}" -H @- "$url" 2>/dev/null
  ); then
    RESP_STATUS=${out##*$'\n'}
    RESP_BODY=${out%$'\n'*}
  else
    RESP_STATUS='000'
    RESP_BODY='{"error":{"code":0,"status":"TRANSPORT","message":"curl failed (network, DNS or timeout)"}}'
  fi
}

# tokeninfo takes the token in a form body; it goes to curl on standard input.
request_tokeninfo() {
  local token=$1 out
  if out=$(printf 'access_token=%s' "$token" | curl -sS --max-time 30 -w $'\n%{http_code}' --data-binary @- "$TOKENINFO" 2>/dev/null); then
    RESP_STATUS=${out##*$'\n'}
    RESP_BODY=${out%$'\n'*}
  else
    RESP_STATUS='000'
    RESP_BODY='{"error":"transport","error_description":"curl failed"}'
  fi
}

list_body() { # contentType RESOURCE plus extra JSON members
  local extra=${1:-}
  if [ -n "$extra" ]; then printf '{"contentType":"RESOURCE",%s}' "$extra"; else printf '{"contentType":"RESOURCE","pageSize":5}'; fi
}

# The scanned project's number, so that a consumer named by number can be recognised (rows q, s6). Looked up
# with the caller's token, from Resource Manager or else from the ancestors of one listed asset; never
# printed. Empty when neither call works; the number is then masked like any other.
PROJECT_NUMBER=''
request "$CALLER" GET "$CRM/projects/$PROJECT" '' '' ''
if [ "$RESP_STATUS" = 200 ]; then
  PROJECT_NUMBER=$(printf '%s' "$RESP_BODY" | jq -r '.name // "" | ltrimstr("projects/")' 2>/dev/null || true)
else
  request "$CALLER" POST "$CAI/projects/$PROJECT/assets" '' "$(list_body '"pageSize":1')" override
  if [ "$RESP_STATUS" = 200 ]; then
    PROJECT_NUMBER=$(printf '%s' "$RESP_BODY" |
      jq -r '[(.assets // [])[].ancestors[]? | select(startswith("projects/"))] | first // "" | ltrimstr("projects/")' \
        2>/dev/null || true)
  fi
fi
[[ $PROJECT_NUMBER =~ ^[0-9]+$ ]] || PROJECT_NUMBER=''

# One summary object per response; never the payload itself.
SUMMARY_JQ='
def literal($from; $to): if $from == "" then . else split($from) | join($to) end;
def mask: if type == "string"
  then literal($other; "OTHER_PROJECT") | literal($old; "OLD_PROJECT") | literal($disabled; "DISABLED_QP")
    | literal($bad; "BAD_QP") | literal($denied; "DENIED_SCOPE") | literal($quota; "QUOTA_PROJECT")
    | literal($pnum; "PROJECT_NUMBER")
    | gsub("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"; "<email>")
    | gsub("(?<d>[0-9]{6,})"; "<n\(.d | length)>")
  else . end;
def info: [(.error.details // [])[] | select(((.["@type"]) // "") | endswith("google.rpc.ErrorInfo"))] | first // {};
def consumer_in($m): ([$m | capture("consumer project: ?(?<c>[0-9a-z.:-]+[0-9a-z])") | .c] | first) // "";
if (.error | type) == "object" then
  (info) as $i
  | { kind: "error", code: .error.code, status: .error.status, reason: ($i.reason // ""),
      domain: ($i.domain // ""),
      consumer: (($i.metadata.consumer // consumer_in(.error.message // "")) | mask),
      permission: ($i.metadata.permission // ""), message: (.error.message // "" | mask) }
elif (.error | type) == "string" then
  { kind: "error", status: .error, message: (.error_description // "" | mask) }
elif has("scope") and has("expires_in") then
  { kind: "tokeninfo", scopes: (.scope | split(" ") | sort), expiresIn: (.expires_in | tonumber? // .expires_in),
    email: has("email") }
elif has("assets") or has("readTime") then
  { kind: "assets", assets: ((.assets // []) | length), types: ([(.assets // [])[].assetType] | unique | length),
    nextPage: has("nextPageToken"), readTime: has("readTime") }
elif has("projects") or has("folders") or has("organizations") then
  { kind: "search", projects: ((.projects // []) | length), folders: ((.folders // []) | length),
    organizations: ((.organizations // []) | length), nextPage: has("nextPageToken") }
elif has("name") and has("state") then
  { kind: "resource", name: (.name | sub("/.*$"; "/…")), state: .state, hasParent: has("parent") }
elif . == {} then
  { kind: "empty" }
else
  { kind: "other", keys: keys }
end'

MASK_ARGS=(--arg other "$OTHER_PROJECT" --arg old "$OLD_PROJECT" --arg disabled "$DISABLED_QUOTA"
  --arg bad "$BAD_MASK" --arg denied "$DENIED_MASK" --arg quota "$QUOTA_MASK" --arg pnum "$PROJECT_NUMBER")

summarise() {
  local id=$1 description=$2 summary=''
  if [ -z "$RESP_BODY" ]; then
    summary='{"kind":"no-body"}'
  elif ! summary=$(printf '%s' "$RESP_BODY" | jq -c "${MASK_ARGS[@]}" "$SUMMARY_JQ" 2>/dev/null) ||
    [ -z "$summary" ]; then
    summary=$(jq -cn --arg n "${#RESP_BODY}" '{kind: "non-json", bytes: ($n | tonumber)}')
  fi
  if [ "$JSON" = 1 ]; then
    jq -cn --arg id "$id" --arg d "$description" --arg s "$RESP_STATUS" --argjson r "$summary" \
      '{row: $id, call: $d, http: ($s | tonumber)} + $r'
    return
  fi
  local line
  line=$(printf '%s' "$summary" | jq -r '
    if .kind == "error" then
      [(.status // "") , (.reason // ""), ((if (.permission // "") != "" then "permission=" + .permission + " " else "" end)
        + (if (.consumer // "") != "" then "consumer=" + .consumer + " " else "" end)
        + ((.message // "") | .[0:150]))]
    elif .kind == "assets" then ["OK", "", "assets=\(.assets) types=\(.types) nextPage=\(.nextPage) readTime=\(.readTime)"]
    elif .kind == "search" then ["OK", "", "projects=\(.projects) folders=\(.folders) organizations=\(.organizations) nextPage=\(.nextPage)"]
    elif .kind == "resource" then ["OK", "", "name=\(.name) state=\(.state) parent=\(.hasParent)"]
    elif .kind == "tokeninfo" then ["OK", "", "scopes=\(.scopes | join(",")) expiresIn=\(.expiresIn)"]
    elif .kind == "empty" then ["OK", "", "empty body {}"]
    elif .kind == "non-json" then ["NON_JSON", "", "\(.bytes) bytes (an HTML error page)"]
    elif .kind == "no-body" then ["NO_BODY", "", ""]
    else ["?", "", (. | tostring)] end
    | map(if . == "" then "-" else . end) | @tsv')
  local api reason detail
  IFS=$'\t' read -r api reason detail <<<"$line" || true
  printf '%-6s %-3s %-18s %-26s %-44s %s\n' "$id" "$RESP_STATUS" "$api" "$reason" "$description" "$detail"
}

# row ID DESCRIPTION TOKEN METHOD URL QUOTA_PROJECT BODY OVERRIDE
row() {
  local id=$1 description=$2
  shift 2
  selected "$id" || return 0
  request "$@"
  summarise "$id" "$description"
}

list_row() { # ID DESCRIPTION TOKEN SCOPE QUOTA_PROJECT [EXTRA_JSON]
  row "$1" "$2" "$3" POST "$CAI/$4/assets" "$5" "$(list_body "${6:-}")" override
}

refused() { # ID CALL DETAIL
  if [ "$JSON" = 1 ]; then
    jq -cn --arg id "$1" --arg c "$2" --arg d "$3" '{row: $id, call: $c, http: null, kind: "refused", detail: $d}'
  else
    printf '%-6s %-3s %-18s %-26s %-44s %s\n' "$1" '-' 'REFUSED' '-' "$2" "$3"
  fi
}

# The service-account gate (docs/adr/0028-quota-project-and-sa-gate.md §4), as the backend must run it.
# Step 2 passes only on Resource Manager's IAM denial of exactly resourcemanager.<kind>.get, the kind taken
# from SCOPE: one ErrorInfo, reason IAM_PERMISSION_DENIED, domain cloudresourcemanager.googleapis.com. Any
# other answer, a 403 for another reason (SERVICE_DISABLED, USER_PROJECT_DENIED, a VPC Service Controls or
# rate-limit refusal, ...) included, fails closed.
exposure_denied() { # SCOPE; reads RESP_STATUS and RESP_BODY
  local kind=${1%%/*}
  [ "$RESP_STATUS" = 403 ] || return 1
  printf '%s' "$RESP_BODY" | jq -e --arg perm "resourcemanager.$kind.get" '
    [(.error.details // [])[] | select((.["@type"] // "") == "type.googleapis.com/google.rpc.ErrorInfo")] as $infos
    | .error.code == 403 and .error.status == "PERMISSION_DENIED" and ($infos | length) == 1
      and $infos[0].reason == "IAM_PERMISSION_DENIED"
      and $infos[0].domain == "cloudresourcemanager.googleapis.com"
      and ($infos[0].metadata.permission // "") == $perm' >/dev/null 2>&1
}

gate() { # ID SCOPE LABEL
  local id=$1 scope=$2 label=$3
  selected "$id" || return 0
  request "$CALLER" GET "$CRM/$scope" '' '' ''
  summarise "$id.1" "gate: caller get $label (must be 200)"
  if [ "$RESP_STATUS" != 200 ]; then
    refused "$id.2" 'gate closed: SA not called' "step 1: the caller cannot get $label"
    return 0
  fi
  request "$SA_TOKEN" GET "$CRM/$scope" '' '' ''
  summarise "$id.2" "gate: SA get $label (must be the IAM denial)"
  if ! exposure_denied "$scope"; then
    if [ "$RESP_STATUS" = 200 ]; then
      refused "$id.3" 'gate closed: SA list not called' \
        "step 2: the SA itself can get $label (a public get, or a role beyond cloudasset.viewer)"
    else
      refused "$id.3" 'gate closed: SA list not called' \
        "step 2: HTTP $RESP_STATUS is not the IAM denial of resourcemanager.${scope%%/*}.get; fail closed"
    fi
    return 0
  fi
  request "$SA_TOKEN" POST "$CAI/$scope/assets" '' "$(list_body)" override
  summarise "$id.3" "gate open: SA list $label"
}

if [ "$JSON" = 0 ]; then
  printf '%-6s %-3s %-18s %-26s %-44s %s\n' row http status reason call detail
fi

P="projects/$PROJECT"
NO_MATCH='"pageSize":5,"assetTypes":["nonexistent.googleapis.com/Nothing"]'

# t: what the tokens are (scopes, lifetime); no identity is printed.
if selected t1; then request_tokeninfo "$CALLER"; summarise t1 'tokeninfo (caller token)'; fi
if [ "$WITH_SA" = 1 ] && selected t2; then request_tokeninfo "$SA_TOKEN"; summarise t2 'tokeninfo (service-account token)'; fi

# a, b, c: the quota project.
list_row a "list $P, no quota header" "$CALLER" "$P" ''
row o1 "POST $P/assets without the method override" "$CALLER" POST "$CAI/$P/assets" "$QUOTA" "$(list_body)" ''
list_row b "list $P, quota $QUOTA_LABEL" "$CALLER" "$P" "$QUOTA"
list_row c1 "list $P, quota $BAD_LABEL" "$CALLER" "$P" "$BAD_QUOTA"
if [ -n "$DISABLED_QUOTA" ]; then
  list_row c2 "list $P, quota DISABLED_QP (API off)" "$CALLER" "$P" "$DISABLED_QUOTA"
fi
if [ -n "$OTHER_PROJECT" ]; then
  list_row c3 "list $P, quota OTHER_PROJECT (no services.use)" "$CALLER" "$P" "$OTHER_PROJECT"
fi
list_row c4 "list $DENIED_LABEL, quota $BAD_LABEL (both bad)" "$CALLER" "$DENIED_SCOPE" "$BAD_QUOTA"

# q: which project is the consumer. The "no such asset type" error names the consumer project's number.
list_row q1 'assetTypes no match, no quota header' "$CALLER" "$P" '' "$NO_MATCH"
list_row q2 "assetTypes no match, quota $QUOTA_LABEL" "$CALLER" "$P" "$QUOTA" "$NO_MATCH"

# d: scopes the caller cannot read.
list_row d1 "list $DENIED_LABEL, quota $QUOTA_LABEL" "$CALLER" "$DENIED_SCOPE" "$QUOTA"
list_row d2 "list projects/$MISSING_PROJECT, quota $QUOTA_LABEL" "$CALLER" "projects/$MISSING_PROJECT" "$QUOTA"
if [ -n "$OTHER_PROJECT" ]; then
  list_row d3 'list projects/OTHER_PROJECT, quota set' "$CALLER" "projects/$OTHER_PROJECT" "$QUOTA"
fi

# e: readTime and the 35-day window.
list_row e1 'readTime now - 1 day' "$CALLER" "$P" "$QUOTA" "\"pageSize\":5,\"readTime\":\"$(iso_at -86400)\""
list_row e2 'readTime now - 35 days + 10 min' "$CALLER" "$P" "$QUOTA" "\"pageSize\":5,\"readTime\":\"$(iso_at $((-35 * 86400 + 600)))\""
list_row e3 'readTime now - 36 days' "$CALLER" "$P" "$QUOTA" "\"pageSize\":5,\"readTime\":\"$(iso_at $((-36 * 86400)))\""
list_row e4 'readTime now + 1 hour' "$CALLER" "$P" "$QUOTA" "\"pageSize\":5,\"readTime\":\"$(iso_at 3600)\""
if [ -n "$OLD_PROJECT" ]; then
  list_row e5 'OLD_PROJECT, readTime now - 35 days + 10 min' "$CALLER" "projects/$OLD_PROJECT" "$QUOTA" "\"pageSize\":5,\"readTime\":\"$(iso_at $((-35 * 86400 + 600)))\""
  list_row e6 'OLD_PROJECT, readTime now - 34 days' "$CALLER" "projects/$OLD_PROJECT" "$QUOTA" "\"pageSize\":5,\"readTime\":\"$(iso_at $((-34 * 86400)))\""
fi
if [ -n "$READ_TIME" ]; then
  list_row e7 "readTime $READ_TIME" "$CALLER" "$P" "$QUOTA" "\"pageSize\":5,\"readTime\":\"$READ_TIME\""
fi

# f: assetTypes patterns.
list_row f1 'assetTypes matching no supported type' "$CALLER" "$P" "$QUOTA" "$NO_MATCH"
list_row f2 'assetTypes supported, maybe no assets' "$CALLER" "$P" "$QUOTA" '"pageSize":5,"assetTypes":["compute.googleapis.com/Instance"]'
list_row f3 'assetTypes invalid RE2' "$CALLER" "$P" "$QUOTA" '"pageSize":5,"assetTypes":["compute.googleapis.com/("]'

# p: page size and page tokens.
list_row p1 'pageSize 500' "$CALLER" "$P" "$QUOTA" '"pageSize":500'
list_row p2 'pageSize 1000' "$CALLER" "$P" "$QUOTA" '"pageSize":1000'
list_row p3 'pageSize 1001' "$CALLER" "$P" "$QUOTA" '"pageSize":1001'
if selected p4; then
  request "$CALLER" POST "$CAI/$P/assets" "$QUOTA" "$(list_body '"pageSize":1')" override
  next=$(printf '%s' "$RESP_BODY" | jq -r '.nextPageToken // empty' 2>/dev/null || true)
  if [ -n "$next" ]; then
    request "$CALLER" POST "$CAI/$P/assets" "$QUOTA" \
      "$(list_body "$(jq -rn --arg t "$next" '{pageSize: 1, pageToken: $t} | tostring | .[1:-1]')")" override
    summarise p4 'second page via pageToken in the body'
  else
    summarise p4 'no second page (first page was the last)'
  fi
fi

# g: Resource Manager get (the preflight and the service-account gate).
row g1 "get $P, no quota header" "$CALLER" GET "$CRM/$P" '' '' ''
row g2 "get $P, quota $QUOTA_LABEL" "$CALLER" GET "$CRM/$P" "$QUOTA" '' ''
row g3 "get $DENIED_LABEL" "$CALLER" GET "$CRM/$DENIED_SCOPE" '' '' ''
row g4 "get projects/$MISSING_PROJECT" "$CALLER" GET "$CRM/projects/$MISSING_PROJECT" '' '' ''
if [ -n "$OTHER_PROJECT" ]; then
  row g5 'get projects/OTHER_PROJECT' "$CALLER" GET "$CRM/projects/$OTHER_PROJECT" '' '' ''
fi

# h: Resource Manager search (the scope picker).
row h1 'projects:search' "$CALLER" GET "$CRM/projects:search?pageSize=500" '' '' ''
row h2 "projects:search query id:$PROJECT" "$CALLER" GET "$CRM/projects:search?query=id%3A$PROJECT" '' '' ''
row h3 'folders:search' "$CALLER" GET "$CRM/folders:search?pageSize=500" '' '' ''
row h4 'organizations:search' "$CALLER" GET "$CRM/organizations:search" '' '' ''

# s and gate: the backend's service account.
if [ "$WITH_SA" = 1 ]; then
  list_row s1 "SA list $P, no quota header" "$SA_TOKEN" "$P" ''
  list_row s2 "SA list $P, quota $PROJECT" "$SA_TOKEN" "$P" "$PROJECT"
  row s3 "SA get $P" "$SA_TOKEN" GET "$CRM/$P" '' '' ''
  if [ -n "$OTHER_PROJECT" ]; then
    row s4 'SA get projects/OTHER_PROJECT' "$SA_TOKEN" GET "$CRM/projects/$OTHER_PROJECT" '' '' ''
  fi
  list_row s5 "SA list $DENIED_LABEL" "$SA_TOKEN" "$DENIED_SCOPE" ''
  list_row s6 'SA assetTypes no match, no quota header' "$SA_TOKEN" "$P" '' "$NO_MATCH"
  if [ -n "$OLD_PROJECT" ]; then
    row s7 'SA get projects/OLD_PROJECT (no role there)' "$SA_TOKEN" GET "$CRM/projects/$OLD_PROJECT" '' '' ''
    list_row s8 'SA list projects/OLD_PROJECT (no role there)' "$SA_TOKEN" "projects/$OLD_PROJECT" ''
    list_row s9 "SA list $P, quota OLD_PROJECT (no role there)" "$SA_TOKEN" "$P" "$OLD_PROJECT"
  fi
  list_row s10 "SA list $P, quota $BAD_LABEL" "$SA_TOKEN" "$P" "$BAD_QUOTA"
  if selected s11; then # the folder variant of s3; the folder is the first one the caller can see
    request "$CALLER" GET "$CRM/folders:search?pageSize=1" '' '' ''
    folder=$(printf '%s' "$RESP_BODY" | jq -r '.folders[0].name // empty' 2>/dev/null || true)
    if [[ $folder =~ ^folders/[0-9]+$ ]]; then
      row s11 "SA get the caller's first folder" "$SA_TOKEN" GET "$CRM/$folder" '' '' ''
    else
      refused s11 "SA get the caller's first folder" 'skipped: the caller sees no folder'
    fi
  fi

  gate gate1 "$P" "$P"
  gate gate2 "$DENIED_SCOPE" "$DENIED_LABEL"
  if [ -n "$OTHER_PROJECT" ]; then
    gate gate3 "projects/$OTHER_PROJECT" 'projects/OTHER_PROJECT'
  fi
  if [ -n "$OLD_PROJECT" ]; then
    gate gate4 "projects/$OLD_PROJECT" 'projects/OLD_PROJECT'
  fi
fi
