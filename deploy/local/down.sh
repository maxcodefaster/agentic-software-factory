#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -u

dry_run=false
if [ "${1:-}" = --dry-run ]; then
  dry_run=true
  shift
fi
[ "$#" -eq 0 ] || { printf 'usage: down.sh [--dry-run]\n' >&2; exit 2; }

if [ "$(kubectl config current-context 2>/dev/null)" != orbstack ]; then
  printf 'Refusing local stack shutdown outside the orbstack Kubernetes context.\n' >&2
  exit 1
fi

failures=0
workspaces=$(mktemp "${TMPDIR:-/tmp}/factory-down-workspaces.XXXXXX")
active_workspaces=$workspaces.active
trap 'rm -f "$workspaces" "$active_workspaces"' EXIT HUP INT TERM
token=$(kubectl get secret factory-runtime -n factory-platform -o jsonpath='{.data.coder-token}' 2>/dev/null | base64 -d) || token=
if [ -z "$token" ] || ! kubectl exec -n coder deployment/coder -- \
  env CODER_URL=http://127.0.0.1:8080 CODER_SESSION_TOKEN="$token" \
  /opt/coder list --all --output json >"$workspaces"; then
  printf 'workspaces: failed to list active Coder workspaces\n' >&2
  failures=$((failures + 1))
else
  if ! jq -r '.[]
    | select(.latest_build.transition == "start")
    | select(.latest_build.status != "stopped" and .latest_build.status != "failed" and .latest_build.status != "canceled" and .latest_build.status != "deleted")
    | .owner_name + "/" + .name' "$workspaces" >"$active_workspaces"; then
    printf 'workspaces: Coder returned an invalid workspace list\n' >&2
    failures=$((failures + 1))
  else
    while IFS= read -r workspace; do
      [ -n "$workspace" ] || continue
      if [ "$dry_run" = true ]; then
        printf '+ coder stop %s --yes\n' "$workspace"
      elif ! kubectl exec -n coder deployment/coder -- \
        env CODER_URL=http://127.0.0.1:8080 CODER_SESSION_TOKEN="$token" \
        /opt/coder stop "$workspace" --yes; then
        printf 'workspaces: failed to stop %s\n' "$workspace" >&2
        failures=$((failures + 1))
      fi
    done <"$active_workspaces"
  fi
fi

scale() {
  namespace=$1
  deployment=$2
  if [ "$dry_run" = true ]; then
    printf '+ kubectl scale deployment/%s -n %s --replicas=0\n' "$deployment" "$namespace"
  elif ! kubectl scale "deployment/$deployment" -n "$namespace" --replicas=0; then
    printf '%s: failed to scale to zero\n' "$deployment" >&2
    failures=$((failures + 1))
  fi
}

scale factory-platform agentic-software-factory
scale factory-platform forgejo
scale coder coder

if [ "$failures" -ne 0 ]; then
  printf 'down completed with %s failure(s); every service scale was attempted.\n' "$failures" >&2
  exit 1
fi
printf 'Local stack stopped without deleting resources.\n'
