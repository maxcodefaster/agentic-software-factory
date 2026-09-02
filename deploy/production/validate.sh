#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
target=${1:-$root/deploy/production}
[ "$#" -le 1 ] || { printf 'usage: %s [KUSTOMIZE_PATH]\n' "$0" >&2; exit 2; }
validate_base=false
[ "$#" -ne 0 ] || validate_base=true
kubectl=${KUBECTL:-kubectl}
render=$(mktemp)
trap 'rm -f "$render"' EXIT HUP INT TERM
"$kubectl" kustomize "$target" >"$render"

! grep -Eiq 'k8s\.orb\.local|/Users/' "$render"
grep -Eq 'image: .+@sha256:[0-9a-f]{64}$' "$render"
if [ "$validate_base" = true ]; then
  grep -Fq 'image: ghcr.io/replace-owner/replace-repository/control-plane@sha256:' "$render"
fi
grep -q 'readOnlyRootFilesystem: true' "$render"
test "$(grep -c 'runAsUser: 10001' "$render")" -eq 4
test "$(grep -c 'runAsGroup: 10001' "$render")" -eq 4
grep -Fq 'USER 10001:10001' "$root/apps/bff/Dockerfile"
grep -q 'automountServiceAccountToken: false' "$render"
grep -q 'kind: ExternalSecret' "$render"
grep -q 'reloader.stakater.com/auto: "true"' "$render"
grep -q 'kind: NetworkPolicy' "$render"
grep -q 'agentic-software-factory.io/dependency: "true"' "$render"
grep -q 'port: 4318' "$render"
grep -q 'kind: PodDisruptionBudget' "$render"
grep -q 'paused: true' "$render"
grep -q 'kind: PrometheusRule' "$render"
grep -q 'location = /metrics { return 404; }' "$render"
grep -q 'ingressClassName: nginx' "$render"
grep -q 'nginx.ingress.kubernetes.io/limit-rps: "20"' "$render"
grep -q 'nginx.ingress.kubernetes.io/limit-burst-multiplier: "3"' "$render"
grep -Eq 'AUTH_MODE: "?entra"?$' "$render"
! grep -Eq 'LOCAL_AUTH_(EMAIL|PASSWORD):' "$render"
test "$(grep -c '^kind: ServiceAccount$' "$render")" -eq 2
if [ "${FACTORY_VALIDATE_CLUSTER:-false}" = true ]; then
  for resource in externalsecrets.external-secrets.io servicemonitors.monitoring.coreos.com prometheusrules.monitoring.coreos.com volumesnapshots.snapshot.storage.k8s.io; do
    "$kubectl" get crd "$resource" >/dev/null
  done
  "$kubectl" get ingressclass nginx -o json | jq -e '.spec.controller == "k8s.io/ingress-nginx"' >/dev/null
  "$kubectl" apply --server-side --dry-run=server -f "$render" >/dev/null
  "$kubectl" version >/dev/null
fi
printf '%s\n' 'Portable production deployment contract passed.'
