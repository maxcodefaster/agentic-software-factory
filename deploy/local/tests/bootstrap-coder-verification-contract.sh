#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/factory-coder-verification-contract.XXXXXX")
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
mkdir "$test_root/bin"

cat >"$test_root/bin/curl" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$CURL_LOG"
case "$*" in
  *'/healthz') printf '%s\n' 'OK' ;;
  *'/api/v2/organizations') printf '%s\n' '[{"id":"00000000-0000-0000-0000-000000000001","name":"default","is_default":true}]' ;;
  *'/api/v2/users?q=factory-verification&limit=100') printf '%s\n' '{"count":0,"users":[]}' ;;
  *'/api/v2/users?q=factory-stage&limit=100') printf '%s\n' '{"count":0,"users":[]}' ;;
  *'/api/v2/users/00000000-0000-0000-0000-000000000002/roles')
    printf '%s\n' "${CODER_ROLES:-{\"roles\":[],\"organization_roles\":{\"00000000-0000-0000-0000-000000000001\":[]}}}"
    ;;
  *'/api/v2/users')
    for argument in "$@"; do case "$argument" in @*) request=${argument#@} ;; esac; done
    if grep -Fq 'factory-stage' "$request"; then
      printf '%s\n' '{"id":"00000000-0000-0000-0000-000000000002","username":"factory-stage","login_type":"password","status":"active","is_service_account":false,"organization_ids":["00000000-0000-0000-0000-000000000001"]}'
    else
      printf '%s\n' '{"id":"00000000-0000-0000-0000-000000000002","username":"factory-verification","login_type":"password","status":"active","is_service_account":false,"organization_ids":["00000000-0000-0000-0000-000000000001"]}'
    fi
    ;;
  *) exit 1 ;;
esac
EOF
cat >"$test_root/bin/kubectl" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >"$KUBECTL_LOG"
EOF
chmod +x "$test_root/bin/curl" "$test_root/bin/kubectl"

CURL_LOG=$test_root/curl.log KUBECTL_LOG=$test_root/kubectl.log PATH="$test_root/bin:$PATH" \
  CODER_URL=https://coder.example CODER_TOKEN=machine-token \
  "$root/deploy/local/bootstrap-coder-verification.sh"

grep -Fq 'Coder-Session-Token: machine-token' "$test_root/curl.log"
grep -Fq 'https://coder.example/healthz' "$test_root/curl.log"
grep -Fq 'api/v2/users' "$test_root/curl.log"
grep -Fq 'patch secret factory-runtime -n factory-platform --type merge' "$test_root/kubectl.log"
grep -Fq 'coder-verification-owner-id' "$test_root/kubectl.log"

: >"$test_root/kubectl.log"
CURL_LOG=$test_root/curl.log KUBECTL_LOG=$test_root/kubectl.log PATH="$test_root/bin:$PATH" CODER_URL=https://coder.example CODER_TOKEN=token FACTORY_CODER_AUTOMATION_KIND=staging \
  "$root/deploy/local/bootstrap-coder-verification.sh"
grep -Fq 'factory-stage' "$test_root/curl.log"
grep -Fq 'coder-staging-owner-id' "$test_root/kubectl.log"

if CURL_LOG=$test_root/unsafe-curl.log KUBECTL_LOG=$test_root/unsafe-kubectl.log PATH="$test_root/bin:$PATH" \
  CODER_URL=https://coder.example CODER_TOKEN=machine-token \
  CODER_ROLES='{"roles":[],"organization_roles":{"00000000-0000-0000-0000-000000000001":["organization-admin"]}}' \
  "$root/deploy/local/bootstrap-coder-verification.sh" >/dev/null 2>&1; then
  printf 'Coder verification bootstrap accepted an Agents role.\n' >&2
  exit 1
fi
test ! -e "$test_root/unsafe-kubectl.log"

cat >"$test_root/bin/curl" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$CURL_LOG"
case "$*" in
  *'/healthz') printf '%s\n' 'OK' ;;
  *'/api/v2/organizations') printf '%s\n' '[{"id":"00000000-0000-0000-0000-000000000001","name":"default","is_default":true}]' ;;
  *'/api/v2/users?q=factory-verification&limit=100') printf '%s\n' '{"count":1,"users":[{"id":"00000000-0000-0000-0000-000000000002","username":"factory-verification","login_type":"password","status":"dormant","is_service_account":false,"organization_ids":["00000000-0000-0000-0000-000000000001"]}]}' ;;
  *'-X PUT https://coder.example/api/v2/users/00000000-0000-0000-0000-000000000002/status/activate') printf '%s\n' '{"id":"00000000-0000-0000-0000-000000000002","username":"factory-verification","login_type":"password","status":"active","is_service_account":false,"organization_ids":["00000000-0000-0000-0000-000000000001"]}' ;;
  *'/api/v2/users/00000000-0000-0000-0000-000000000002/roles') printf '%s\n' '{"roles":[],"organization_roles":{"00000000-0000-0000-0000-000000000001":[]}}' ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$test_root/bin/curl"
: >"$test_root/dormant-curl.log"
CURL_LOG=$test_root/dormant-curl.log KUBECTL_LOG=$test_root/dormant-kubectl.log PATH="$test_root/bin:$PATH" \
  CODER_URL=https://coder.example CODER_TOKEN=machine-token \
  "$root/deploy/local/bootstrap-coder-verification.sh"
grep -Fq '/status/activate' "$test_root/dormant-curl.log"

printf 'Coder verification bootstrap contract passed.\n'
