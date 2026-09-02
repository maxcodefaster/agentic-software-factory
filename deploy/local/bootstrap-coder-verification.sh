#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

coder_url=${CODER_URL:-http://coder.localhost}
coder_token=${CODER_TOKEN:?CODER_TOKEN is required}
coder_ca=${CODER_CA_FILE:-}
kind=${FACTORY_CODER_AUTOMATION_KIND:-verification}
case "$kind" in verification|staging) ;; *) printf 'unsupported automation kind: %s\n' "$kind" >&2; exit 2 ;; esac
default_username=factory-verification
secret_key=coder-verification-owner-id
display_name='Agentic Software Factory Verification Automation'
if [ "$kind" = staging ]; then
  default_username=factory-stage
  secret_key=coder-staging-owner-id
  display_name='Agentic Software Factory Staging Automation'
fi
username=${FACTORY_CODER_AUTOMATION_OWNER:-$default_username}
organization=${FACTORY_CODER_ORGANIZATION:-default}
namespace=${FACTORY_PLATFORM_NAMESPACE:-factory-platform}
secret=${FACTORY_RUNTIME_SECRET:-factory-runtime}
request=$(mktemp "${TMPDIR:-/tmp}/factory-coder-verification.XXXXXX")
trap 'rm -f "$request"' EXIT HUP INT TERM

curl_coder() {
  if [ -n "$coder_ca" ]; then
    curl --fail --silent --show-error --cacert "$coder_ca" -H "Coder-Session-Token: $coder_token" "$@"
  else
    curl --fail --silent --show-error -H "Coder-Session-Token: $coder_token" "$@"
  fi
}

for delay in 1 2 4 8 16; do
  curl_coder "$coder_url/healthz" >/dev/null 2>&1 && break
  sleep "$delay"
done
curl_coder "$coder_url/healthz" >/dev/null

organization_id=$(curl_coder "$coder_url/api/v2/organizations" |
  jq -er --arg organization "$organization" 'first(.[] | select(.id == $organization or .name == $organization or ($organization == "default" and .is_default))) | .id')

users=$(curl_coder "$coder_url/api/v2/users?q=$username&limit=100")
user=$(printf '%s' "$users" | jq -cer --arg username "$username" 'first(.users[] | select(.username == $username)) // ""')
if [ -z "$user" ]; then
  password=$(openssl rand -base64 32 | tr -d '\r\n')
  jq -n --arg username "$username" --arg organization_id "$organization_id" --arg display_name "$display_name" --arg password "$password" '{
    email: ($username + "@invalid.local"), username: $username, name: $display_name,
    login_type: "password", password: $password, user_status: "active", organization_ids: [$organization_id], roles: []
  }' >"$request"
  user=$(curl_coder -H 'Content-Type: application/json' --data-binary @"$request" "$coder_url/api/v2/users")
elif [ "$(printf '%s' "$user" | jq -r '.status')" = dormant ]; then
  user_id=$(printf '%s' "$user" | jq -er '.id')
  user=$(curl_coder -X PUT "$coder_url/api/v2/users/$user_id/status/activate")
fi

user_id=$(printf '%s' "$user" | jq -er --arg username "$username" --arg organization_id "$organization_id" '
  select(.username == $username and .login_type == "password" and .status == "active"
    and (.is_service_account != true) and (.organization_ids | index($organization_id))) | .id')
roles=$(curl_coder "$coder_url/api/v2/users/$user_id/roles")
printf '%s' "$roles" | jq -e --arg organization_id "$organization_id" '
  (.roles | length == 0)
  and ([.organization_roles[][]?] | all(contains("agent") | not))
  and ([.organization_roles[][]?] | index("organization-admin") | not)' >/dev/null

encoded=$(printf '%s' "$user_id" | base64 | tr -d '\r\n')
kubectl patch secret "$secret" -n "$namespace" --type merge \
  -p "{\"data\":{\"$secret_key\":\"$encoded\"}}" >/dev/null
