#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

test "$(kubectl config current-context)" = orbstack
name="factory-envbuilder-contract-$$"
cleanup() { kubectl delete pod "$name" --ignore-not-found --wait >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM

kubectl run "$name" --restart=Never \
  --image=ghcr.io/coder/envbuilder@sha256:b34ade2fb90a8536df76e7a15c6dd8c6352d0ae835a187b13467fa0c8a71e280 \
  --overrides='{"spec":{"automountServiceAccountToken":false,"securityContext":{"seccompProfile":{"type":"RuntimeDefault"}},"containers":[{"name":"'$name'","image":"ghcr.io/coder/envbuilder@sha256:b34ade2fb90a8536df76e7a15c6dd8c6352d0ae835a187b13467fa0c8a71e280","env":[{"name":"ENVBUILDER_FALLBACK_IMAGE","value":"docker.io/library/alpine:3.22"},{"name":"ENVBUILDER_INIT_SCRIPT","value":"test \"$(id -u)\" = 0"}],"securityContext":{"allowPrivilegeEscalation":false,"privileged":false}}]}}' >/dev/null
kubectl wait --for=jsonpath='{.status.phase}'=Succeeded "pod/$name" --timeout=180s >/dev/null || {
  kubectl logs "$name" >&2 || true
  exit 1
}

printf '%s\n' 'OrbStack envbuilder pod contract passed.'
