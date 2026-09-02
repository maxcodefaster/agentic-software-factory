#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
rollout=$root/deploy/local/rollout-factory.sh
test_root=$(mktemp -d "${TMPDIR:-/tmp}/factory-rollout.XXXXXX")
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
mkdir "$test_root/bin"

fail() {
  printf 'Factory rollout contract failed: %s\n' "$1" >&2
  exit 1
}

cat >"$test_root/bin/kubectl" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$KUBECTL_LOG"

case "$*" in
  apply\ --server-side\ --force-conflicts\ -f\ *factory.application/rollout=factory*)
    cp "$5" "$KUBECTL_PAYLOAD"
    printf 'FACTORY_APPLY_PAYLOAD %s\n' "$5" >>"$KUBECTL_LOG"
    ;;
  apply\ --server-side\ --force-conflicts\ -f\ *)
    if [ "$5" != "$PLATFORM_MANIFEST" ]; then
      cp "$5" "$KUBECTL_PAYLOAD"
      printf 'FACTORY_APPLY_PAYLOAD %s\n' "$5" >>"$KUBECTL_LOG"
      if [ "$TEST_SCENARIO" = apply-failure ]; then
        exit 1
      fi
      if [ "$TEST_SCENARIO" = signal ]; then
        kill -TERM "$PPID"
        sleep 1
      fi
    fi
    ;;
  'wait --for=condition=Available deployment/forgejo -n factory-platform --timeout=10s')
    case "$TEST_SCENARIO" in
      healthy|apply-failure|signal|oidc-transient|oidc-permanent) ;;
      *) exit 1 ;;
    esac
    ;;
  'get deployment forgejo -n factory-platform')
    exit 0
    ;;
  get\ deployment\ forgejo\ -n\ factory-platform\ -o\ go-template=*)
    if [ "$TEST_SCENARIO" = deadlock ]; then
      printf '/usr/local/bin/docker-entrypoint.sh forgejo migrate\n/opt/factory/bootstrap-oidc.sh'
    else
      printf '/usr/local/bin/docker-entrypoint.sh forgejo migrate\nunknown-command'
    fi
    ;;
  create\ --dry-run=client*)
    printf '%s\n' \
      '{"apiVersion":"apps/v1","kind":"Deployment","metadata":{"name":"forgejo","labels":{"factory.application/rollout":"forgejo"}},"spec":{"template":{"spec":{"initContainers":[{"name":"configure-oidc","args":["/usr/local/bin/docker-entrypoint.sh forgejo migrate\n"]}]}}}}' \
      '{"apiVersion":"v1","kind":"Service","metadata":{"name":"agentic-software-factory","labels":{"factory.application/rollout":"factory"}}}' \
      '{"apiVersion":"apps/v1","kind":"Deployment","metadata":{"name":"agentic-software-factory","labels":{"factory.application/rollout":"factory"}},"spec":{"template":{"spec":{"initContainers":[{"name":"migrate","image":"committed:migrate","env":[{"name":"HOME","value":"/tmp"},{"name":"XDG_CACHE_HOME","value":"/tmp/.cache"}],"volumeMounts":[{"name":"temporary-files","mountPath":"/tmp"}]}],"containers":[{"name":"bff","image":"committed:bff","env":[{"name":"HOME","value":"/tmp"},{"name":"XDG_CACHE_HOME","value":"/tmp/.cache"}],"volumeMounts":[{"name":"temporary-files","mountPath":"/tmp"}]}],"volumes":[{"name":"temporary-files","emptyDir":{"medium":"Memory","sizeLimit":"256Mi"}}]}}}}'
    ;;
  'get deployment agentic-software-factory -n factory-platform')
    exit 0
    ;;
  'get pod -l app=agentic-software-factory -n factory-platform -o name')
    exit 0
    ;;
  exec\ -n\ factory-platform\ deployment/forgejo\ --\ /bin/sh\ -c*)
    count=$(($(cat "$DISCOVERY_COUNT") + 1))
    printf '%s\n' "$count" >"$DISCOVERY_COUNT"
    if [ "$TEST_SCENARIO" = oidc-transient ]; then
      if [ "$count" -eq 1 ]; then
        exit 1
      fi
      if [ "$count" -eq 2 ]; then
        printf '%s\n' '{"issuer":"https://wrong.example"}'
        exit 0
      fi
    fi
    printf '%s\n' '{"issuer":"http://factory.localhost"}'
    ;;
  exec\ -n\ factory-platform\ deployment/forgejo\ --\ env\ FACTORY_OIDC_ISSUER=*)
    count=$(($(cat "$BOOTSTRAP_COUNT") + 1))
    printf '%s\n' "$count" >"$BOOTSTRAP_COUNT"
    if [ "$TEST_SCENARIO" = oidc-permanent ]; then
      exit 1
    fi
    if [ "$TEST_SCENARIO" = oidc-transient ] && [ "$count" -le 2 ]; then
      exit 1
    fi
    ;;
  exec\ -n\ factory-platform\ deployment/forgejo\ --\ forgejo*)
    printf '1\tFactory\tOAuth2\ttrue\n'
    ;;
  get\ secret\ factory-runtime*)
    printf 'dG9rZW4='
    ;;
esac
EOF

cat >"$test_root/bin/curl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$CURL_LOG"
case "${*}" in
  *'/api/v2/organizations') printf '%s\n' '[{"id":"00000000-0000-0000-0000-000000000001","name":"default","is_default":true}]' ;;
  *'/api/v2/users?q=factory-verification&limit=100') printf '%s\n' '{"count":1,"users":[{"id":"00000000-0000-0000-0000-000000000002","username":"factory-verification","login_type":"password","status":"active","is_service_account":false,"organization_ids":["00000000-0000-0000-0000-000000000001"]}]}' ;;
  *'/api/v2/users/00000000-0000-0000-0000-000000000002/roles') printf '%s\n' '{"roles":[],"organization_roles":{"00000000-0000-0000-0000-000000000001":[]}}' ;;
  *'/api/v2/users?q=factory-stage&limit=100') printf '%s\n' '{"count":1,"users":[{"id":"00000000-0000-0000-0000-000000000003","username":"factory-stage","login_type":"password","status":"active","is_service_account":false,"organization_ids":["00000000-0000-0000-0000-000000000001"]}]}' ;;
  *'/api/v2/users/00000000-0000-0000-0000-000000000003/roles') printf '%s\n' '{"roles":[],"organization_roles":{"00000000-0000-0000-0000-000000000001":[]}}' ;;
  *) printf '%s\n' '{"login":"factory-review"}' ;;
esac
EOF

cat >"$test_root/bin/sleep" <<'EOF'
#!/bin/sh
printf '%s\n' "$1" >>"$SLEEP_LOG"
EOF
chmod +x "$test_root/bin/kubectl" "$test_root/bin/curl" "$test_root/bin/sleep"

assert_before() {
  log=$1
  first=$2
  second=$3
  first_line=$(grep -nF "$first" "$log" | sed -n '1s/:.*//p')
  second_line=$(grep -nF "$second" "$log" | sed -n '1s/:.*//p')
  [ -n "$first_line" ] && [ -n "$second_line" ] && [ "$first_line" -lt "$second_line" ] ||
    fail "expected '$first' before '$second'"
}

run_scenario() {
  scenario=$1
  log=$test_root/$scenario.log
  payload=$test_root/$scenario-payload.json
  discovery_count=$test_root/$scenario-discovery-count
  bootstrap_count=$test_root/$scenario-bootstrap-count
  sleep_log=$test_root/$scenario-sleep.log
  curl_log=$test_root/$scenario-curl.log
  : >"$log"
  printf '0\n' >"$discovery_count"
  printf '0\n' >"$bootstrap_count"
  : >"$sleep_log"
  : >"$curl_log"
  TEST_SCENARIO=$scenario KUBECTL_LOG=$log KUBECTL_PAYLOAD=$payload \
    DISCOVERY_COUNT=$discovery_count BOOTSTRAP_COUNT=$bootstrap_count SLEEP_LOG=$sleep_log CURL_LOG=$curl_log \
    PLATFORM_MANIFEST=$root/deploy/local/platform.yaml PATH="$test_root/bin:$PATH" \
    FACTORY_SECRETS_CHECKSUM=contract-checksum "$rollout" dev.local/agentic-software-factory-bff:contract IfNotPresent >/dev/null
  printf '%s\n' "$log"
}

healthy_log=$(run_scenario healthy)
grep -Fq 'http://factory.localhost/healthz' "$test_root/healthy-curl.log" ||
  fail 'Factory rollout must wait for public health'
if grep -Fq 'patch deployment/forgejo' "$healthy_log"; then
  fail 'healthy Forgejo must not be patched'
fi
grep -Fq 'apply --server-side --force-conflicts -f ' "$healthy_log" ||
  fail 'the complete projected Factory payload must reclaim its managed fields'
healthy_source=$(sed -n 's/^FACTORY_APPLY_PAYLOAD //p' "$healthy_log")
[ -n "$healthy_source" ] || fail 'Factory apply must use a projected payload'
[ ! -e "$healthy_source" ] || fail 'temporary Factory apply payload must be removed on exit'
assert_before "$healthy_log" \
  'scale deployment agentic-software-factory -n factory-platform --replicas=0' \
  'apply --server-side --force-conflicts -f '
assert_before "$healthy_log" \
  'wait --for=condition=Available deployment/forgejo' \
  'scale deployment agentic-software-factory -n factory-platform --replicas=0'
healthy_payload=$test_root/healthy-payload.json
jq -e '
  [.items[]
    | select(.apiVersion == "apps/v1" and .kind == "Deployment" and .metadata.name == "agentic-software-factory")
    | .spec.template.spec.initContainers[]
    | select(.name == "migrate")]
  | length == 1 and all(.[]; .image == "dev.local/agentic-software-factory-bff:contract" and .imagePullPolicy == "IfNotPresent")
' "$healthy_payload" >/dev/null || fail 'Factory apply payload must set the migrate image'
jq -e '
  [.items[]
    | select(.apiVersion == "apps/v1" and .kind == "Deployment" and .metadata.name == "agentic-software-factory")
    | .spec.template.spec.containers[]
    | select(.name == "bff")]
  | length == 1 and all(.[]; .image == "dev.local/agentic-software-factory-bff:contract" and .imagePullPolicy == "IfNotPresent")
' "$healthy_payload" >/dev/null || fail 'Factory apply payload must set the bff image'
jq -e '
  .items[]
  | select(.apiVersion == "apps/v1" and .kind == "Deployment" and .metadata.name == "agentic-software-factory")
  | any((.spec.template.spec.containers[] | select(.name == "bff") | .volumeMounts[]); .name == "temporary-files" and .mountPath == "/tmp")
    and any((.spec.template.spec.initContainers[] | select(.name == "migrate") | .volumeMounts[]); .name == "temporary-files" and .mountPath == "/tmp")
    and any(.spec.template.spec.volumes[]; .name == "temporary-files" and .emptyDir.medium == "Memory" and .emptyDir.sizeLimit == "256Mi")
' "$healthy_payload" >/dev/null || fail 'Factory BFF and migration must share a bounded memory-backed temporary directory'
jq -e '
  .items[]
  | select(.apiVersion == "apps/v1" and .kind == "Deployment" and .metadata.name == "agentic-software-factory")
  | ((.spec.template.spec.containers[] | select(.name == "bff") | .env | map({key: .name, value: .value}) | from_entries) as $main
    | (.spec.template.spec.initContainers[] | select(.name == "migrate") | .env | map({key: .name, value: .value}) | from_entries) as $init
    | $main.HOME == "/tmp" and $main.XDG_CACHE_HOME == "/tmp/.cache"
      and $init.HOME == "/tmp" and $init.XDG_CACHE_HOME == "/tmp/.cache")
' "$healthy_payload" >/dev/null || fail 'Factory BFF and migration must use the writable temporary directory as home and cache'
jq -e '.items[] | select(.kind == "Deployment" and .metadata.name == "agentic-software-factory") | .spec.template.metadata.annotations["factory.application/secrets-checksum"] == "contract-checksum"' \
  "$healthy_payload" >/dev/null || fail 'Factory deployment must carry its Secret checksum'
assert_before "$healthy_log" \
  'rollout status deployment/agentic-software-factory' \
  'exec -n factory-platform deployment/forgejo -- /bin/sh -c'
assert_before "$healthy_log" \
  'exec -n factory-platform deployment/forgejo -- /bin/sh -c' \
  'exec -n factory-platform deployment/forgejo -- env FACTORY_OIDC_ISSUER='
assert_before "$healthy_log" \
  'exec -n factory-platform deployment/forgejo -- env FACTORY_OIDC_ISSUER=' \
  'exec -n factory-platform deployment/forgejo -- forgejo --config'

transient_log=$(run_scenario oidc-transient)
[ "$(cat "$test_root/oidc-transient-discovery-count")" -eq 3 ] ||
  fail 'discovery must retry after two transient failures'
[ "$(cat "$test_root/oidc-transient-bootstrap-count")" -eq 3 ] ||
  fail 'OIDC bootstrap must retry after two transient failures'
[ "$(cat "$test_root/oidc-transient-sleep.log")" = "1
2
1
2" ] || fail 'transient retries must use bounded increasing backoff'
assert_before "$transient_log" \
  'exec -n factory-platform deployment/forgejo -- /bin/sh -c' \
  'exec -n factory-platform deployment/forgejo -- env FACTORY_OIDC_ISSUER='

permanent_log=$test_root/oidc-permanent.log
permanent_payload=$test_root/oidc-permanent-payload.json
permanent_discovery_count=$test_root/oidc-permanent-discovery-count
permanent_bootstrap_count=$test_root/oidc-permanent-bootstrap-count
permanent_sleep_log=$test_root/oidc-permanent-sleep.log
permanent_output=$test_root/oidc-permanent-output.log
: >"$permanent_log"
printf '0\n' >"$permanent_discovery_count"
printf '0\n' >"$permanent_bootstrap_count"
: >"$permanent_sleep_log"
if TEST_SCENARIO=oidc-permanent KUBECTL_LOG=$permanent_log KUBECTL_PAYLOAD=$permanent_payload FACTORY_SECRETS_CHECKSUM=contract-checksum \
  DISCOVERY_COUNT=$permanent_discovery_count BOOTSTRAP_COUNT=$permanent_bootstrap_count \
  SLEEP_LOG=$permanent_sleep_log PLATFORM_MANIFEST=$root/deploy/local/platform.yaml \
  PATH="$test_root/bin:$PATH" \
  "$rollout" dev.local/agentic-software-factory-bff:contract IfNotPresent >"$permanent_output" 2>&1; then
  fail 'permanent OIDC bootstrap failure must stop the rollout'
fi
[ "$(cat "$permanent_discovery_count")" -eq 1 ] ||
  fail 'permanent bootstrap scenario must pass discovery first'
[ "$(cat "$permanent_bootstrap_count")" -eq 6 ] ||
  fail 'permanent OIDC bootstrap failure must stop after six attempts'
[ "$(cat "$permanent_sleep_log")" = "1
2
4
8
16" ] || fail 'permanent OIDC retries must stop after bounded backoff'
[ "$(grep -Fc 'scale deployment agentic-software-factory -n factory-platform --replicas=0' "$permanent_log")" -eq 1 ] ||
  fail 'post-rollout OIDC failure must not scale the healthy BFF down'
grep -Fq 'OIDC bootstrap failed after the Factory rollout. The BFF remains running.' "$permanent_output" ||
  fail 'permanent OIDC failure must report that the BFF remains running'
grep -Fq 'Retry command: kubectl exec -n factory-platform deployment/forgejo -- env FACTORY_OIDC_ISSUER=http://agentic-software-factory-bootstrap.factory-platform.svc.cluster.local:8080 /opt/factory/bootstrap-oidc.sh' "$permanent_output" ||
  fail 'permanent OIDC failure must print the exact retry command without secrets'

deadlock_log=$(run_scenario deadlock)
grep -Fq 'patch deployment/forgejo -n factory-platform --type strategic' "$deadlock_log" ||
  fail 'known deadlock must use the named strategic recovery patch'
assert_before "$deadlock_log" \
  'patch deployment/forgejo -n factory-platform --type strategic' \
  'apply --server-side --force-conflicts -f '
assert_before "$deadlock_log" \
  'scale deployment agentic-software-factory -n factory-platform --replicas=0' \
  'apply --server-side --force-conflicts -f '

unknown_log=$test_root/unknown.log
: >"$unknown_log"
if TEST_SCENARIO=unknown KUBECTL_LOG=$unknown_log PATH="$test_root/bin:$PATH" FACTORY_SECRETS_CHECKSUM=contract-checksum \
  "$rollout" dev.local/agentic-software-factory-bff:contract IfNotPresent >/dev/null 2>&1; then
  fail 'unknown Forgejo failure must stop the rollout'
fi
if grep -Fq 'scale deployment agentic-software-factory' "$unknown_log"; then
  fail 'unknown Forgejo failure must leave Factory running'
fi

for scenario in apply-failure signal; do
  log=$test_root/$scenario.log
  payload=$test_root/$scenario-payload.json
  : >"$log"
  if TEST_SCENARIO=$scenario KUBECTL_LOG=$log KUBECTL_PAYLOAD=$payload FACTORY_SECRETS_CHECKSUM=contract-checksum \
    PLATFORM_MANIFEST=$root/deploy/local/platform.yaml PATH="$test_root/bin:$PATH" \
    "$rollout" dev.local/agentic-software-factory-bff:contract IfNotPresent >/dev/null 2>&1; then
    fail "$scenario must stop the rollout"
  fi
  source_path=$(sed -n 's/^FACTORY_APPLY_PAYLOAD //p' "$log")
  [ -n "$source_path" ] || fail "$scenario must reach the projected Factory apply"
  [ ! -e "$source_path" ] || fail "$scenario must remove the temporary apply payload"
  grep -Fq 'scale deployment agentic-software-factory -n factory-platform --replicas=0' "$log" ||
    fail "$scenario must leave Factory at zero replicas"
  if grep -Fq 'set image deployment/agentic-software-factory' "$log"; then fail "$scenario must not use a second image manager"; fi
done

factory_only_log=$test_root/factory-only.log
factory_only_payload=$test_root/factory-only-payload.json
: >"$factory_only_log"
TEST_SCENARIO=healthy KUBECTL_LOG=$factory_only_log KUBECTL_PAYLOAD=$factory_only_payload \
  PLATFORM_MANIFEST=$root/deploy/local/platform.yaml PATH="$test_root/bin:$PATH" \
  FACTORY_SECRETS_CHECKSUM=contract-checksum "$rollout" --factory-only dev.local/agentic-software-factory-bff:contract IfNotPresent >/dev/null
grep -Fq 'scale deployment agentic-software-factory -n factory-platform --replicas=0' "$factory_only_log" ||
  fail 'Factory-only rollout must replace the BFF deployment'
if grep -Eq 'deployment/forgejo|bootstrap-coder-verification|bootstrap-forgejo-review' "$factory_only_log"; then
  fail 'Factory-only rollout must not reconcile Forgejo, Coder users, or review tokens'
fi

printf 'Factory rollout control contract passed.\n'
