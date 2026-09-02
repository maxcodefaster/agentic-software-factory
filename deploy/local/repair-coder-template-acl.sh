#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

[ "${1:-}" = --apply ] || { printf 'usage: %s --apply\n' "$0" >&2; exit 2; }
[ "$(kubectl config current-context)" = orbstack ] || { printf 'Refusing Coder template access check outside OrbStack.\n' >&2; exit 1; }
for namespace in coder factory-platform; do
  kubectl get namespace "$namespace" -o json | jq -e '.metadata.labels["factory.application/local-stack"] == "true"' >/dev/null
done

coder_token=$(kubectl get secret factory-runtime -n factory-platform -o jsonpath='{.data.coder-token}' | base64 -d)
coder_pod=$(kubectl get pods -n coder -l app.kubernetes.io/name=coder -o jsonpath='{.items[0].metadata.name}')
token_name="factory-template-check-$(date +%s)-$$"

temporary=$(kubectl exec -n coder "$coder_pod" -- env \
  CODER_URL=http://coder.coder.svc.cluster.local CODER_SESSION_TOKEN="$coder_token" \
  /opt/coder tokens create --user factory-stage --name "$token_name" --lifetime 1m | tr -d '\r\n')
[ -n "$temporary" ] || { printf 'Coder delegated token creation returned an empty token.\n' >&2; exit 1; }

cleanup() {
  token_id=$(kubectl exec -n coder "$coder_pod" -- env \
    CODER_URL=http://coder.coder.svc.cluster.local CODER_SESSION_TOKEN="$coder_token" \
    /opt/coder tokens list --all --output json 2>/dev/null |
    jq -r --arg name "$token_name" 'first(.[] | select(.name == $name)) | .id // empty')
  [ -z "$token_id" ] || kubectl exec -n coder "$coder_pod" -- env \
    CODER_URL=http://coder.coder.svc.cluster.local CODER_SESSION_TOKEN="$coder_token" \
    /opt/coder tokens remove "$token_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

organization_id=$(kubectl exec -n coder "$coder_pod" -- env TOKEN="$temporary" sh -c \
  'curl -fsS -H "Coder-Session-Token: $TOKEN" http://coder.coder.svc.cluster.local/api/v2/organizations' |
  jq -er 'first(.[] | select(.is_default)) | .id')
kubectl exec -n coder "$coder_pod" -- env TOKEN="$temporary" ORGANIZATION_ID="$organization_id" sh -c \
  'curl -fsS -H "Coder-Session-Token: $TOKEN" "http://coder.coder.svc.cluster.local/api/v2/organizations/$ORGANIZATION_ID/templates/agentic-software-factory"' |
  jq -e '.name == "agentic-software-factory" and (.deprecated | not) and (.deleted | not)' >/dev/null

printf 'Coder agentic-software-factory template is readable by the staging automation user.\n'
