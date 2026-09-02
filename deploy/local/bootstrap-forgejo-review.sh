#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

namespace=${FACTORY_PLATFORM_NAMESPACE:-factory-platform}
deployment=${FORGEJO_DEPLOYMENT:-forgejo}
username=${FORGEJO_REVIEW_USER:-factory-review}
secret=${FACTORY_RUNTIME_SECRET:-factory-runtime}
password=$(openssl rand -base64 24 | tr -d '\n')

kubectl wait --for=condition=Available deployment/"$deployment" -n "$namespace" --timeout=180s >/dev/null
if ! kubectl exec -n "$namespace" deployment/"$deployment" -- forgejo admin user list |
  grep -Eq "^[[:space:]]*[0-9]+[[:space:]]+$username[[:space:]]"; then
  kubectl exec -n "$namespace" deployment/"$deployment" -- forgejo admin user create \
    --username "$username" \
    --password "$password" \
    --email "$username@example.test" \
    --must-change-password=false >/dev/null
else
  kubectl exec -n "$namespace" deployment/"$deployment" -- forgejo admin user change-password \
    --username "$username" \
    --password "$password" >/dev/null
fi
kubectl exec -n "$namespace" deployment/"$deployment" -- forgejo admin user must-change-password --unset "$username" >/dev/null

# Forgejo places review POST routes under write:repository. The account's read
# collaborator permission prevents repository content writes and Git pushes.
token=$(kubectl exec -n "$namespace" deployment/"$deployment" -- forgejo admin user generate-access-token \
  --username "$username" \
  --token-name "agentic-software-factory-review-$(date +%s)" \
  --scopes write:repository,read:user \
  --raw | tr -d '\r\n')
encoded=$(printf '%s' "$token" | base64 | tr -d '\r\n')
kubectl patch secret "$secret" -n "$namespace" --type merge \
  -p "{\"data\":{\"forgejo-review-token\":\"$encoded\"}}" >/dev/null
