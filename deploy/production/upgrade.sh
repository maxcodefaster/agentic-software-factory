#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu
: "${OVERLAY:?OVERLAY is required}"
namespace=${NAMESPACE:-agentic-software-factory}
mode=${1:-plan}
kubectl=${KUBECTL:-kubectl}
validate=${FACTORY_VALIDATE:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/validate.sh}

validate_overlay() {
  KUBECTL="$kubectl" "$validate" "$OVERLAY"
  rendered=$(mktemp "${TMPDIR:-/tmp}/factory-production-render.XXXXXX")
  trap 'rm -f "$rendered"' EXIT HUP INT TERM
  "$kubectl" kustomize "$OVERLAY" >"$rendered"
  if grep -Fq 'ghcr.io/replace-owner/replace-repository/control-plane' "$rendered" || grep -Eq 'example\.invalid|replace-me' "$rendered"; then
    printf '%s\n' 'Production overlay still contains base placeholders.' >&2
    exit 1
  fi
}

case "$mode" in
  plan)
    validate_overlay
    "$kubectl" diff -k "$OVERLAY" || test "$?" -eq 1
    ;;
  apply)
    validate_overlay
    "$kubectl" delete job/agentic-software-factory-migrate -n "$namespace" --ignore-not-found
    "$kubectl" apply -k "$OVERLAY" --prune -l app.kubernetes.io/part-of=agentic-software-factory
    "$kubectl" wait --for=condition=complete job/agentic-software-factory-migrate -n "$namespace" --timeout=5m
    "$kubectl" rollout resume deployment/agentic-software-factory -n "$namespace"
    "$kubectl" rollout status deployment/agentic-software-factory -n "$namespace" --timeout=10m
    "$kubectl" get --raw "/api/v1/namespaces/$namespace/services/agentic-software-factory:8080/proxy/readyz" >/dev/null
    ;;
  rollback)
    validate_overlay
    "$kubectl" rollout undo deployment/agentic-software-factory -n "$namespace"
    "$kubectl" rollout resume deployment/agentic-software-factory -n "$namespace"
    "$kubectl" rollout status deployment/agentic-software-factory -n "$namespace" --timeout=10m
    ;;
  *)
    printf 'usage: %s plan|apply|rollback\n' "$0" >&2
    exit 2
    ;;
esac
