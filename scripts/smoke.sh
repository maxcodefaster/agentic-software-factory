#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

factory_url="${FACTORY_URL:-http://factory.localhost}"
auth_mode="${SMOKE_AUTH_MODE:-local}"
system_id="${FACTORY_SYSTEM_ID:-factory/example}"
application=$(printf '%s' "$system_id" | jq -sRr @uri)
cookie_jar=$(mktemp)
number=
cleanup() {
  [ -z "$number" ] || factory_curl -fsS -X DELETE "$factory_url/api/v1/requirements/$number?$scope" >/dev/null 2>&1 || true
  rm -f "$cookie_jar"
}
trap cleanup EXIT HUP INT TERM

case "$auth_mode" in
  local)
    email="${SMOKE_AUTH_EMAIL:-${AUTH_E2E_BUSINESS_EMAIL:-business@example.test}}"
    password="${SMOKE_AUTH_PASSWORD:-${AUTH_E2E_BUSINESS_PASSWORD:?AUTH_E2E_BUSINESS_PASSWORD or SMOKE_AUTH_PASSWORD is required for local authentication}}"
    unauthenticated_status=$(curl -sS -o /dev/null -w '%{http_code}' "$factory_url/api/v1/session")
    [ "$unauthenticated_status" = 401 ] || {
      printf 'Expected authentication to be enforced, got HTTP %s. Use SMOKE_AUTH_MODE=disabled only for an AUTH_DISABLED stack.\n' "$unauthenticated_status" >&2
      exit 1
    }
    curl -fsS -c "$cookie_jar" \
      -H "Origin: ${SMOKE_AUTH_ORIGIN:-http://factory.localhost}" \
      -H 'Content-Type: application/json' \
      -d "$(jq -cn --arg email "$email" --arg password "$password" '{email:$email,password:$password}')" \
      "$factory_url/sign-in/email" >/dev/null
    ;;
  disabled)
    ;;
  *)
    printf 'SMOKE_AUTH_MODE must be local or disabled\n' >&2
    exit 2
    ;;
esac

factory_curl() {
  if [ "$auth_mode" = local ]; then
    curl -b "$cookie_jar" "$@"
  else
    curl "$@"
  fi
}

curl -fsS "$factory_url/healthz" >/dev/null
curl -fsS "$factory_url/readyz" | jq -e '.status == "ready"' >/dev/null
curl -fsS "$factory_url/statusz" | jq -e '.status == "ok" and (.capabilities.aiInterview == "available" or .capabilities.aiInterview == "unavailable")' >/dev/null
session=$(factory_curl -fsS "$factory_url/api/v1/session")
if [ "$auth_mode" = local ]; then
  printf '%s' "$session" | jq -e '.admin == false' >/dev/null
fi

scope="team=factory&application=$application"
created="$(factory_curl -fsS -X POST "$factory_url/api/v1/requirements?$scope" \
  -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg application "$system_id" '{title:"First Agentic Software Factory slice",body:"A trusted team needs to move from an accepted requirement to a live Coder workspace preview.",team:"factory",applicationIds:[$application]}')")"
number="$(printf '%s' "$created" | jq -r .number)"

factory_curl -fsS -X PATCH "$factory_url/api/v1/requirements/$number/status?$scope" \
  -H 'Content-Type: application/json' \
  -d '{"status":"requirements"}' >/dev/null

board="$(factory_curl -fsS "$factory_url/api/v1/board?$scope")"
printf '%s' "$board" | jq -e --arg repository "$system_id" --argjson number "$number" '.repository == $repository and (.columns.requirements[] | select(.number == $number))' >/dev/null

spec='{"goal":"Static bypass must fail.","users":["Product teams"],"userStories":["As a product team, I use AI clarification."],"acceptanceCriteria":["Direct proposal injection is rejected"],"nonFunctionalRequirements":[],"moscow":{"must":["AI interview"],"should":[],"could":[]},"openQuestions":[],"nonGoals":[]}'
proposal_status="$(factory_curl -sS -o /dev/null -w '%{http_code}' -X PUT "$factory_url/api/v1/requirements/$number/proposal?$scope" -H 'Content-Type: application/json' -d "$spec")"
acceptance_status="$(factory_curl -sS -o /dev/null -w '%{http_code}' -X POST "$factory_url/api/v1/requirements/$number/accept?$scope" -H 'Content-Type: application/json' -d "$spec")"
[ "$proposal_status" = 409 ] && [ "$acceptance_status" = 409 ]

printf 'Factory smoke passed: system repository + mandatory AI policy for requirement #%s\n' "$number"
