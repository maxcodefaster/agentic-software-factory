#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

for command in kubectl docker jq curl; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Missing prerequisite: %s\n' "$command" >&2
    exit 1
  }
done
[ "$(kubectl config current-context)" = orbstack ] || {
  printf '%s\n' 'Refusing recovery outside the orbstack Kubernetes context.' >&2
  exit 1
}

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/factory-coder-recovery.XXXXXX")
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
credentials=$work_dir/login.json
first_user=$work_dir/first-user.json
response=$work_dir/response.json
patch=$work_dir/patch.json
chmod 700 "$work_dir"
: >"$credentials"
: >"$first_user"
: >"$response"
: >"$patch"
chmod 600 "$credentials" "$first_user" "$response" "$patch"

email=$(kubectl get secret coder-bootstrap -n coder -o jsonpath='{.data.owner-email}' | base64 -d)
username=$(kubectl get secret coder-bootstrap -n coder -o jsonpath='{.data.owner-username}' | base64 -d)
password=$(kubectl get secret coder-bootstrap -n coder -o jsonpath='{.data.owner-password}' | base64 -d)
for delay in 1 2 4 8 16; do
  curl --fail --silent --show-error http://coder.localhost/healthz >/dev/null 2>&1 && break
  sleep "$delay"
done
curl --fail --silent --show-error http://coder.localhost/healthz >/dev/null
status=$(curl --silent --show-error --output "$response" --write-out '%{http_code}' \
  http://coder.localhost/api/v2/users/first)
case "$status" in
  200) ;;
  404)
    jq -n --arg email "$email" --arg username "$username" --arg password "$password" \
      '{email:$email,username:$username,name:$username,password:$password,trial:false}' >"$first_user"
    status=$(curl --silent --show-error --output "$response" --write-out '%{http_code}' \
      -H 'Content-Type: application/json' --data-binary @"$first_user" \
      http://coder.localhost/api/v2/users/first)
    [ "$status" = 201 ] || {
      printf 'Coder first-user creation returned HTTP %s; expected 201.\n' "$status" >&2
      exit 1
    }
    ;;
  *)
    printf 'Coder first-user lookup returned HTTP %s; expected 200 or 404.\n' "$status" >&2
    exit 1
    ;;
esac
jq -n --arg email "$email" --arg password "$password" '{email:$email,password:$password}' >"$credentials"
session=$(curl --fail --silent --show-error -H 'Content-Type: application/json' \
  --data-binary @"$credentials" http://coder.localhost/api/v2/users/login | jq -er .session_token)
token=$(kubectl exec -n coder deployment/coder -- env \
  CODER_URL=http://127.0.0.1:8080 CODER_SESSION_TOKEN="$session" \
  /opt/coder tokens create --name "factory-runtime-$(date +%s)-$$" --lifetime 168h | tr -d '\r\n')
[ -n "$token" ] || { printf '%s\n' 'Coder owner token recovery returned an empty token.' >&2; exit 1; }
jq -n --arg token "$token" '{data:{"coder-token":($token | @base64)}}' >"$patch"
kubectl patch secret factory-runtime -n factory-platform --type merge --patch-file "$patch" >/dev/null
unset email username password session token

printf 'Coder owner token renewed in secret factory-platform/factory-runtime.\n'
