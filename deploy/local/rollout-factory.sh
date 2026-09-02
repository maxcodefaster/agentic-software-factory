#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

dry_run=false
factory_only=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true; shift ;;
    --factory-only) factory_only=true; shift ;;
    *) break ;;
  esac
done

image=${1:?usage: rollout-factory.sh [--dry-run] [--factory-only] IMAGE [IfNotPresent|Always]}
pull_policy=${2:-IfNotPresent}
case "$pull_policy" in
  IfNotPresent|Always) ;;
  *) printf 'unsupported image pull policy: %s\n' "$pull_policy" >&2; exit 2 ;;
esac

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
manifest=$root/deploy/local/platform.yaml
namespace=factory-platform
deployment=agentic-software-factory
forgejo_deployment=forgejo
bootstrap_issuer=http://agentic-software-factory-bootstrap.factory-platform.svc.cluster.local:8080
public_issuer=http://factory.localhost
discovery_url=$bootstrap_issuer/.well-known/openid-configuration
migration_guard=false
factory_manifest=

run() {
  if [ "$dry_run" = true ]; then
    printf '+'
    for argument do
      printf ' %s' "$argument"
    done
    printf '\n'
  else
    "$@"
  fi
}

apply_forgejo_manifest() {
  run kubectl apply --server-side -f "$manifest" -l factory.application/rollout=forgejo
  run kubectl rollout status deployment/"$forgejo_deployment" -n "$namespace" --timeout=300s
  run kubectl wait --for=condition=Available deployment/"$forgejo_deployment" -n "$namespace" --timeout=180s
}

ensure_forgejo_available() {
  if [ "$dry_run" = true ]; then
    run kubectl wait --for=condition=Available deployment/"$forgejo_deployment" -n "$namespace" --timeout=10s
    run kubectl patch deployment/"$forgejo_deployment" -n "$namespace" --type strategic -p '<migration-only patch derived from platform.yaml>'
    run kubectl rollout status deployment/"$forgejo_deployment" -n "$namespace" --timeout=300s
    apply_forgejo_manifest
    return
  fi

  if ! kubectl get deployment "$forgejo_deployment" -n "$namespace" >/dev/null 2>&1; then
    printf 'Forgejo is not installed. Apply deploy/local/platform.yaml before running a Factory rollout.\n' >&2
    exit 1
  fi
  if kubectl wait --for=condition=Available deployment/"$forgejo_deployment" -n "$namespace" --timeout=10s >/dev/null 2>&1; then
    apply_forgejo_manifest
    return
  fi

  init_args=$(
    kubectl get deployment "$forgejo_deployment" -n "$namespace" \
      -o go-template='{{range .spec.template.spec.initContainers}}{{if eq .name "configure-oidc"}}{{range .args}}{{printf "%s" .}}{{end}}{{end}}{{end}}'
  )
  known_cycle=$(printf '%s\n%s' \
    '/usr/local/bin/docker-entrypoint.sh forgejo migrate' \
    '/opt/factory/bootstrap-oidc.sh')
  if [ "$init_args" != "$known_cycle" ]; then
    printf 'Forgejo is unavailable, and its init spec does not match the known OIDC bootstrap cycle. Factory was not stopped.\n' >&2
    exit 1
  fi

  migration_command=$(
    kubectl create --dry-run=client --validate=false -f "$manifest" -o json |
      jq -ser '.[] | select(.apiVersion == "apps/v1" and .kind == "Deployment" and .metadata.name == "forgejo") | .spec.template.spec.initContainers[] | select(.name == "configure-oidc") | .args[]'
  )
  recovery_patch=$(
    jq -cn --arg command "$migration_command" \
      '{spec:{template:{spec:{initContainers:[{name:"configure-oidc",args:[$command]}]}}}}'
  )

  # This named strategic patch changes only the old init script body to the
  # migration-only body committed in platform.yaml. Auth settings stay intact.
  kubectl patch deployment/"$forgejo_deployment" -n "$namespace" --type strategic \
    -p "$recovery_patch" >/dev/null
  kubectl rollout status deployment/"$forgejo_deployment" -n "$namespace" --timeout=300s
  kubectl wait --for=condition=Available deployment/"$forgejo_deployment" -n "$namespace" --timeout=180s >/dev/null
  apply_forgejo_manifest
}

wait_for_oidc_discovery() {
  if [ "$dry_run" = true ]; then
    printf '# wait for valid discovery JSON with issuer %s (6 attempts; 1,2,4,8,16 second backoff)\n' "$public_issuer"
    run kubectl exec -n "$namespace" deployment/"$forgejo_deployment" -- \
      /bin/sh -c 'wget -qT 10 -O- "$1"' sh "$discovery_url"
    printf '# validate the response with jq before OIDC bootstrap\n'
    return
  fi

  attempt=1
  delay=1
  while [ "$attempt" -le 6 ]; do
    discovery=$(
      kubectl exec -n "$namespace" deployment/"$forgejo_deployment" -- \
        /bin/sh -c 'wget -qT 10 -O- "$1"' sh "$discovery_url" 2>/dev/null
    ) || discovery=
    if [ -n "$discovery" ] && printf '%s\n' "$discovery" |
      jq -e --arg issuer "$public_issuer" 'type == "object" and .issuer == $issuer' >/dev/null 2>&1; then
      return 0
    fi
    if [ "$attempt" -eq 6 ]; then
      return 1
    fi
    printf 'Waiting for Factory OIDC discovery inside Forgejo (attempt %s of 6).\n' "$attempt" >&2
    sleep "$delay"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
}

bootstrap_forgejo_oidc() {
  if [ "$dry_run" = true ]; then
    printf '# bootstrap Forgejo OIDC (6 attempts; 1,2,4,8,16 second backoff)\n'
    run kubectl exec -n "$namespace" deployment/"$forgejo_deployment" -- env \
      FACTORY_OIDC_ISSUER="$bootstrap_issuer" timeout 30 /opt/factory/bootstrap-oidc.sh
    return
  fi

  attempt=1
  delay=1
  while ! kubectl exec -n "$namespace" deployment/"$forgejo_deployment" -- env \
    FACTORY_OIDC_ISSUER="$bootstrap_issuer" timeout 30 /opt/factory/bootstrap-oidc.sh; do
    if [ "$attempt" -eq 6 ]; then
      return 1
    fi
    printf 'Forgejo OIDC bootstrap failed; retrying (attempt %s of 6).\n' "$attempt" >&2
    sleep "$delay"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
}

report_oidc_failure() {
  printf 'OIDC bootstrap failed after the Factory rollout. The BFF remains running.\n' >&2
  printf 'Retry command: kubectl exec -n %s deployment/%s -- env FACTORY_OIDC_ISSUER=%s /opt/factory/bootstrap-oidc.sh\n' \
    "$namespace" "$forgejo_deployment" "$bootstrap_issuer" >&2
}

verify_forgejo_auth_source() {
  if [ "$dry_run" = true ]; then
    run kubectl exec -n "$namespace" deployment/"$forgejo_deployment" -- \
      forgejo --config /var/lib/gitea/custom/conf/app.ini admin auth list
    return
  fi

  if ! kubectl exec -n "$namespace" deployment/"$forgejo_deployment" -- \
    forgejo --config /var/lib/gitea/custom/conf/app.ini admin auth list |
    awk -F '\t' '$2 == "Factory" && $3 == "OAuth2" && tolower($4) == "true" { found = 1 } END { exit !found }'; then
    printf 'Forgejo auth source verification failed: enabled Factory OAuth2 source not found.\n' >&2
    return 1
  fi
}

wait_for_public_health() {
  if [ "$dry_run" = true ]; then
    run curl -fsS "$public_issuer/healthz"
    return
  fi

  attempt=1
  while ! curl -fsS "$public_issuer/healthz" >/dev/null 2>&1; do
    [ "$attempt" -lt 30 ] || {
      printf 'Factory public health endpoint did not become available after rollout.\n' >&2
      return 1
    }
    sleep 1
    attempt=$((attempt + 1))
  done
}

review_token_needs_repair() {
  encoded=$(
    kubectl get secret factory-runtime -n "$namespace" \
      -o go-template='{{index .data "forgejo-review-token"}}' 2>/dev/null || true
  )
  [ -n "$encoded" ] || return 0
  token=$(printf '%s' "$encoded" | base64 -d)
  ! curl -fsS -H "Authorization: token $token" \
    http://forgejo-factory.localhost/api/v1/user 2>/dev/null |
    jq -e --arg username "${FORGEJO_REVIEW_USER:-factory-review}" '.login == $username' >/dev/null
}

create_factory_manifest() {
  factory_manifest=$(mktemp "${TMPDIR:-/tmp}/factory-rollout.XXXXXX")
  secrets_checksum=${FACTORY_SECRETS_CHECKSUM:-$("$root/deploy/local/secret-checksum.sh" factory)}
  kubectl create --dry-run=client --validate=false -f "$manifest" -o json |
    jq -s --arg image "$image" --arg pull_policy "$pull_policy" --arg secrets_checksum "$secrets_checksum" '
      {
        apiVersion: "v1",
        kind: "List",
        items: [
          .[]
          | if .kind == "List" then .items[] else . end
          | select(.metadata.labels["factory.application/rollout"] == "factory")
          | if .apiVersion == "apps/v1" and .kind == "Deployment" and .metadata.name == "agentic-software-factory"
            then .spec.template.metadata.annotations["factory.application/secrets-checksum"] = $secrets_checksum
              | ((.spec.template.spec.initContainers[] | select(.name == "migrate")) |= (.image = $image | .imagePullPolicy = $pull_policy))
              | ((.spec.template.spec.containers[] | select(.name == "bff")) |= (.image = $image | .imagePullPolicy = $pull_policy))
            else .
            end
        ]
      }
    ' >"$factory_manifest"

  jq -e '
    (.items | length > 0)
    and ([.items[]
      | select(.apiVersion == "apps/v1" and .kind == "Deployment" and .metadata.name == "agentic-software-factory")
      | .spec.template.spec.initContainers[]
      | select(.name == "migrate")
      | .image == $image and .imagePullPolicy == $pull_policy] == [true])
    and ([.items[]
      | select(.apiVersion == "apps/v1" and .kind == "Deployment" and .metadata.name == "agentic-software-factory")
      | .spec.template.spec.containers[]
      | select(.name == "bff")
      | .image == $image and .imagePullPolicy == $pull_policy] == [true])
  ' --arg image "$image" --arg pull_policy "$pull_policy" "$factory_manifest" >/dev/null || {
    printf 'Failed to create a Factory apply payload with the requested images.\n' >&2
    exit 1
  }
}

on_exit() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ -n "$factory_manifest" ]; then
    rm -f "$factory_manifest"
  fi
  if [ "$status" -ne 0 ] && [ "$migration_guard" = true ]; then
    if [ "$dry_run" = false ]; then
      kubectl scale deployment "$deployment" -n "$namespace" --replicas=0 >/dev/null 2>&1 || true
    fi
    printf 'Rollout failed after the BFF was stopped. The BFF remains at zero replicas; no automatic database rollback was attempted.\n' >&2
    printf 'Inspect the migrate init-container logs and resolve the reported schema or data issue.\n' >&2
    printf 'Recovery command: %s %s %s\n' "$0" "$image" "$pull_policy" >&2
  fi
  exit "$status"
}

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$factory_only" = true ]; then
  if [ "$dry_run" = false ] && ! kubectl get deployment "$deployment" -n "$namespace" >/dev/null 2>&1; then
    printf 'Factory is not installed. Run mise run up before mise run deploy.\n' >&2
    exit 1
  fi
else
ensure_forgejo_available
fi

if [ "$factory_only" = true ]; then
  :
elif [ "$dry_run" = true ]; then
  run "$root/deploy/local/bootstrap-coder-verification.sh"
  run env FACTORY_CODER_AUTOMATION_KIND=staging "$root/deploy/local/bootstrap-coder-verification.sh"
else
  coder_token=$(kubectl get secret factory-runtime -n "$namespace" -o go-template='{{index .data "coder-token"}}' | base64 -d)
  CODER_TOKEN="$coder_token" "$root/deploy/local/bootstrap-coder-verification.sh"
  CODER_TOKEN="$coder_token" FACTORY_CODER_AUTOMATION_KIND=staging "$root/deploy/local/bootstrap-coder-verification.sh"
fi

if [ "$dry_run" = true ] || kubectl get deployment "$deployment" -n "$namespace" >/dev/null 2>&1; then
  run kubectl scale deployment "$deployment" -n "$namespace" --replicas=0
  if [ "$dry_run" = true ] || [ -n "$(kubectl get pod -l app=agentic-software-factory -n "$namespace" -o name)" ]; then
    run kubectl wait --for=delete pod -l app=agentic-software-factory -n "$namespace" --timeout=300s
  fi
fi
migration_guard=true

# The selector excludes Forgejo, and the committed BFF replica count is zero.
create_factory_manifest
run kubectl apply --server-side --force-conflicts -f "$factory_manifest"
run kubectl scale deployment "$deployment" -n "$namespace" --replicas=1
run kubectl rollout status deployment/"$deployment" -n "$namespace" --timeout=300s
wait_for_public_health
migration_guard=false

if [ "$factory_only" = false ]; then
  if ! wait_for_oidc_discovery ||
    ! bootstrap_forgejo_oidc ||
    ! verify_forgejo_auth_source; then
    report_oidc_failure
    exit 1
  fi
fi

if [ "$factory_only" = true ]; then
  :
elif [ "$dry_run" = true ]; then
  run "$root/deploy/local/bootstrap-forgejo-review.sh"
elif review_token_needs_repair; then
  "$root/deploy/local/bootstrap-forgejo-review.sh"
  "$root/deploy/local/reconcile-secret-rollout.sh" factory
else
  printf 'Existing Forgejo review token is valid; no repair needed.\n'
fi
