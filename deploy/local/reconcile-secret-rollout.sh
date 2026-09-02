#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

component=${1:?usage: reconcile-secret-rollout.sh COMPONENT}
[ "$#" -eq 1 ] || { printf 'usage: reconcile-secret-rollout.sh COMPONENT\n' >&2; exit 2; }
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)

case "$component" in
  factory) namespace=factory-platform; deployment=agentic-software-factory; pending_secret=; pending_annotation= ;;
  forgejo) namespace=factory-platform; deployment=forgejo; pending_secret=; pending_annotation= ;;
  coder) namespace=coder; deployment=coder; pending_secret=coder-forgejo-external-auth; pending_annotation=factory.application/pending-coder-reconcile ;;
  *) printf 'unsupported Secret consumer: %s\n' "$component" >&2; exit 2 ;;
esac

kubectl get deployment "$deployment" -n "$namespace" >/dev/null 2>&1 || exit 0
checksum=$("$root/deploy/local/secret-checksum.sh" "$component")
current=$(kubectl get deployment "$deployment" -n "$namespace" \
  -o jsonpath='{.spec.template.metadata.annotations.factory\.application/secrets-checksum}')
pending=false
if [ -n "$pending_secret" ]; then
  pending=$(kubectl get secret "$pending_secret" -n "$namespace" \
    -o go-template="{{index .metadata.annotations \"$pending_annotation\"}}" 2>/dev/null || true)
fi
if [ "$current" != "$checksum" ]; then
  patch=$(jq -cn --arg checksum "$checksum" \
    '{spec:{template:{metadata:{annotations:{"factory.application/secrets-checksum":$checksum}}}}}')
  kubectl patch deployment "$deployment" -n "$namespace" --type merge -p "$patch" >/dev/null
elif [ "$pending" = true ]; then
  kubectl rollout restart deployment/"$deployment" -n "$namespace" >/dev/null
else
  printf '%s Secret checksum already matches; checking rollout health.\n' "$component"
fi
kubectl rollout status deployment/"$deployment" -n "$namespace" --timeout=300s
if [ -n "$pending_secret" ]; then
  kubectl annotate secret "$pending_secret" -n "$namespace" "$pending_annotation"- >/dev/null
fi
