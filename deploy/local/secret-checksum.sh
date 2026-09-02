#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

component=${1:?usage: secret-checksum.sh COMPONENT}
[ "$#" -eq 1 ] || { printf 'usage: secret-checksum.sh COMPONENT\n' >&2; exit 2; }

case "$component" in
  factory)
    set -- \
      'factory-platform/factory-auth:better-auth-secret,bootstrap-user-email,bootstrap-user-name,bootstrap-user-password,e2e-business-password,e2e-developer-password,coder-client-id,coder-client-secret,forgejo-client-id,forgejo-client-secret' \
      'factory-platform/factory-runtime:forgejo-token,forgejo-implementation-token,forgejo-review-token,coder-verification-owner-id,coder-staging-owner-id,coder-token' \
      'factory-platform/factory-postgres-app:uri'
    ;;
  forgejo)
    set -- 'factory-platform/factory-auth:forgejo-client-id,forgejo-client-secret'
    ;;
  coder)
    set -- \
      'coder/coder-oidc:client-id,client-secret' \
      'coder/coder-db-url:url' \
      'coder/coder-forgejo-external-auth:client-id,client-secret'
    ;;
  *) printf 'unsupported Secret consumer: %s\n' "$component" >&2; exit 2 ;;
esac

for ref do
  resource=${ref%%:*}
  keys=${ref#*:}
  namespace=${resource%/*}
  name=${resource#*/}
  printf '%s\n' "$resource"
  kubectl get secret "$name" -n "$namespace" -o json |
    jq -cS --arg keys "$keys" '.data as $data | $keys | split(",") | map({key:., value:$data[.]}) | from_entries'
done | shasum -a 256 | cut -d ' ' -f 1
