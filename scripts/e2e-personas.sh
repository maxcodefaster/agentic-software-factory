#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

factory_url="${FACTORY_URL:-http://factory.localhost}"
origin="${FACTORY_ORIGIN:-$factory_url}"
work=$(mktemp -d)
number=
system_id=${FACTORY_SYSTEM_ID:-factory/example}
system_owner=${system_id%%/*}
system_repository=${system_id#*/}
application=$(printf '%s' "$system_id" | jq -sRr @uri)

cleanup() {
  if [ -n "$number" ]; then
    if [ -n "${FORGEJO_TOKEN:-}" ]; then
      curl -ksS -H "Authorization: token $FORGEJO_TOKEN" -X PATCH \
        -H 'Content-Type: application/json' -d '{"state":"closed"}' \
        "${FORGEJO_URL:-http://forgejo-factory.localhost}/api/v1/repos/$system_owner/$system_repository/issues/$number" >/dev/null || true
    else
      curl -ksS -b "$work/business.cookies" -X DELETE "$factory_url/api/v1/requirements/$number" >/dev/null || true
    fi
  fi
  rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM

login() {
  role=$1
  email=$2
  password=$3
  curl -ksS --fail-with-body -c "$work/$role.cookies" \
    -H "Origin: $origin" \
    -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg email "$email" --arg password "$password" '{email:$email,password:$password}')" \
    "$factory_url/sign-in/email" >/dev/null
}

status() {
  role=$1
  method=$2
  path=$3
  body=${4:-}
  if [ -n "$body" ]; then
    curl -ksS -o /dev/null -w '%{http_code}' -b "$work/$role.cookies" -X "$method" \
      -H 'Content-Type: application/json' -d "$body" "$factory_url$path"
  else
    curl -ksS -o /dev/null -w '%{http_code}' -b "$work/$role.cookies" -X "$method" "$factory_url$path"
  fi
}

expect_status() {
  expected=$1
  actual=$2
  label=$3
  if [ "$actual" != "$expected" ]; then
    printf '%s: expected HTTP %s, received %s\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
}

: "${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}"
: "${BUSINESS_PASSWORD:?BUSINESS_PASSWORD is required}"
: "${DEVELOPER_PASSWORD:?DEVELOPER_PASSWORD is required}"

login admin developer@example.test "$ADMIN_PASSWORD"
login business business@example.test "$BUSINESS_PASSWORD"
login developer implementer@example.test "$DEVELOPER_PASSWORD"

curl -ksS -b "$work/admin.cookies" "$factory_url/api/v1/session" | jq -e '.admin and (.personas | sort == ["business","developer"]) and .capabilities.applicationsManage' >/dev/null
curl -ksS -b "$work/business.cookies" "$factory_url/api/v1/session" | jq -e '(.personas == ["business"]) and .capabilities.requirementsCreate and .capabilities.implementationReview and .capabilities.implementationComplete and (.capabilities.implementationStart | not) and (.capabilities.developerWorkspaceCreate | not)' >/dev/null
curl -ksS -b "$work/developer.cookies" "$factory_url/api/v1/session" | jq -e '(.personas == ["developer"]) and .capabilities.requirementsEdit and .capabilities.implementationReview and .capabilities.implementationComplete and .capabilities.implementationStart and .capabilities.developerWorkspaceCreate and .capabilities.applicationsManage' >/dev/null

developer_created=$(curl -ksS --fail-with-body -b "$work/developer.cookies" -X POST \
  -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg application "$system_id" '{title:"Developer-created ticket",body:"Developers can record work without bypassing review.",team:"factory",applicationIds:[$application]}')" \
  "$factory_url/api/v1/requirements?team=factory&application=$application")
developer_number=$(printf '%s' "$developer_created" | jq -er '.number')
curl -ksS -b "$work/business.cookies" -X DELETE "$factory_url/api/v1/requirements/$developer_number?team=factory&application=$application" >/dev/null
expect_status 403 "$(status business GET /api/v1/applications/onboarding/repositories)" 'business application administration'

created=$(curl -ksS --fail-with-body -b "$work/business.cookies" -X POST \
  -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg application "$system_id" '{title:"v0.1.0 persona release gate",body:"A business user needs governed, independently reviewed delivery evidence.",team:"factory",applicationIds:[$application]}')" \
  "$factory_url/api/v1/requirements?team=factory&application=$application")
number=$(printf '%s' "$created" | jq -er '.number')

curl -ksS --fail-with-body -b "$work/business.cookies" -X PATCH \
  -H 'Content-Type: application/json' -d '{"status":"requirements"}' \
  "$factory_url/api/v1/requirements/$number/status?team=factory&application=$application" >/dev/null

spec='{"goal":"Prove business and developer delivery governance.","users":["Business users","Developers"],"userStories":["As a business user, I can accept and independently review delivery.","As a developer, I can implement through Coder."],"acceptanceCriteria":["Business users own product decisions","Developers receive technical workspace access","Contributors cannot approve or merge their own implementation","Accepted evidence is committed to Forgejo"],"nonFunctionalRequirements":["Authorization is enforced server-side","All API errors are bounded"],"moscow":{"must":["Contributor independence","Durable acceptance evidence"],"should":["Accessible UI"],"could":[]},"openQuestions":[],"nonGoals":["Production credentials"]}'
expect_status 409 "$(status business PUT "/api/v1/requirements/$number/proposal?team=factory&application=$application" "$spec")" 'proposal without AI interview'
expect_status 409 "$(status business POST "/api/v1/requirements/$number/accept?team=factory&application=$application" "$spec")" 'acceptance without AI interview'

curl -ksS --fail-with-body -b "$work/developer.cookies" "$factory_url/api/v1/board?team=factory&application=$application" | jq -e --argjson number "$number" '.columns.requirements[] | select(.number == $number)' >/dev/null
curl -ksS --fail-with-body -b "$work/business.cookies" "$factory_url/api/v1/board?team=factory&application=$application" | jq -e --argjson number "$number" '.columns.requirements[] | select(.number == $number)' >/dev/null
expect_status 403 "$(status business POST "/api/v1/requirements/$number/implementation-runs?team=factory&application=$application" '{"applicationId":"not-authorized"}')" 'business implementation start'

# The implementation-to-preview journey needs a real registered application and
# Coder workspace, so it remains in the deployed visual journey gate. Keep the
# API gate explicit about the controls that must never bypass persona policy.
expect_status 404 "$(status business POST "/api/v1/implementation-runs/not-authorized/verification" '{}')" 'business verification lookup'
expect_status 404 "$(status business POST "/api/v1/implementation-runs/not-authorized/review" '{"decision":"approve","body":""}')" 'business implementation review lookup'
expect_status 404 "$(status business POST "/api/v1/implementation-runs/not-authorized/complete" '{}')" 'business implementation completion lookup'

printf 'Persona E2E passed for requirement #%s.\n' "$number"
