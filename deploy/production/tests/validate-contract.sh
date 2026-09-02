#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/factory-production-validation.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
cp -R "$root/deploy/production" "$tmp/base"
rm -rf "$tmp/base/tests"
mkdir "$tmp/overlay"

write_overlay() {
  operation=$1
  path=$2
  cat >"$tmp/overlay/kustomization.yaml" <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../base
patches:
  - target:
      group: networking.k8s.io
      version: v1
      kind: Ingress
      name: agentic-software-factory
    patch: |-
      - op: $operation
        path: $path
EOF
}

expect_invalid() {
  name=$1
  shift
  cp -R "$tmp/base" "$tmp/$name"
  "$@" "$tmp/$name"
  if sh "$root/deploy/production/validate.sh" "$tmp/$name" >/dev/null 2>&1; then
    printf 'validation accepted invalid contract case: %s\n' "$name" >&2
    exit 1
  fi
}

for file in "$tmp/base"/*.yaml; do
  sed -i.bak \
    -e 's/factory\.example\.invalid/factory.production.test/g' \
    -e 's/coder\.example\.invalid/coder.production.test/g' \
    -e 's/forgejo\.example\.invalid/forgejo.production.test/g' \
    -e 's/replace-owner/production-owner/g' \
    -e 's/replace-repository/production-repository/g' \
    -e 's/replace-me-postgresql/postgresql/g' \
    -e 's/replace-me-forgejo/forgejo/g' \
    -e 's/replace-me-coder/coder/g' \
    -e 's/replace-me-egress-proxy/egress-proxy/g' \
    -e 's/replace-me-egress/factory-egress/g' \
    -e 's/replace-me-workspaces/factory-workspaces/g' \
    -e 's/FACTORY_CODER_AUTHENTICATED_APP_SCOPE_ACKNOWLEDGEMENT=replace-me/FACTORY_CODER_AUTHENTICATED_APP_SCOPE_ACKNOWLEDGEMENT=deployment-wide/g' \
    -e 's/replace-me/factory/g' \
    -e 's/00000000-0000-0000-0000-000000000000/1c71f7e5-ef9e-40bd-93c9-9edaa53c5520/g' \
    -e 's/sha256:0000000000000000000000000000000000000000000000000000000000000000/sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/g' \
    "$file"
  rm "$file.bak"
done
sh "$root/deploy/production/validate.sh" "$tmp/base" >/dev/null

break_coder_logout_host() {
  dir=$1
  yq -i '(select(.kind == "Ingress").spec.rules[] | select(.host == "coder.production.test").host) = "misplaced.production.test"' "$dir/ingress.yaml"
}
break_forgejo_logout_host() {
  dir=$1
  yq -i '(select(.kind == "Ingress").spec.rules[] | select(.host == "forgejo.production.test").host) = "misplaced.production.test"' "$dir/ingress.yaml"
}
remove_database_tls_ca() {
  dir=$1
  yq -i 'select(.kind == "Deployment").spec.template.spec.containers[] |= (select(.name == "bff") | .env = [.env[] | select(.name != "DATABASE_TLS_CA")])' "$dir/deployment.yaml"
}
remove_migration_dns() {
  dir=$1
  yq -i 'select(.kind == "NetworkPolicy" and .metadata.name == "agentic-software-factory-migrate").spec.egress |= map(select(.ports[0].port != 53))' "$dir/network-policy.yaml"
}
remove_migration_database() {
  dir=$1
  yq -i 'select(.kind == "NetworkPolicy" and .metadata.name == "agentic-software-factory-migrate").spec.egress |= map(select(.ports[0].port != 5432))' "$dir/network-policy.yaml"
}
remove_bff_proxy_pod_selector() {
  dir=$1
  yq -i '(select(.kind == "NetworkPolicy" and .metadata.name == "agentic-software-factory-bff").spec.egress[] | select(.ports[0].port == 3128).to[].podSelector) = {}' "$dir/network-policy.yaml"
}
broaden_bff_dependency_selector() {
  dir=$1
  yq -i '(select(.kind == "NetworkPolicy" and .metadata.name == "agentic-software-factory-bff").spec.egress[] | select(.ports[0].port == 5432).to[].namespaceSelector.matchLabels."agentic-software-factory.io/dependency") = true' "$dir/network-policy.yaml"
}

expect_invalid coder-logout-host break_coder_logout_host
expect_invalid forgejo-logout-host break_forgejo_logout_host
expect_invalid database-tls-ca remove_database_tls_ca
expect_invalid migration-dns remove_migration_dns
expect_invalid migration-database remove_migration_database
expect_invalid bff-proxy-pod-selector remove_bff_proxy_pod_selector
expect_invalid bff-dependency-selector broaden_bff_dependency_selector

sed -i.bak 's/FACTORY_CODER_AUTHENTICATED_APP_SCOPE_ACKNOWLEDGEMENT=deployment-wide/FACTORY_CODER_AUTHENTICATED_APP_SCOPE_ACKNOWLEDGEMENT=wrong/' "$tmp/base/kustomization.yaml"
if sh "$root/deploy/production/validate.sh" "$tmp/base" >/dev/null 2>&1; then
  printf '%s\n' 'validation accepted authenticated Coder apps without the deployment-wide acknowledgement' >&2
  exit 1
fi
sed -i.bak 's/FACTORY_CODER_RESTRICTED_APP_SHARING=authenticated/FACTORY_CODER_RESTRICTED_APP_SHARING=owner/' "$tmp/base/kustomization.yaml"
rm "$tmp/base/kustomization.yaml.bak"
sh "$root/deploy/production/validate.sh" "$tmp/base" >/dev/null

if sh "$root/deploy/production/validate.sh" "$root/deploy/production" >/dev/null 2>&1; then
  printf '%s\n' 'validation accepted the placeholder base as a deployable overlay' >&2
  exit 1
fi

for path in \
  /spec/ingressClassName \
  /metadata/annotations/nginx.ingress.kubernetes.io~1limit-rps \
  /metadata/annotations/nginx.ingress.kubernetes.io~1limit-burst-multiplier
do
  rm -rf "$tmp/overlay"
  mkdir "$tmp/overlay"
  write_overlay remove "$path"
  if sh "$root/deploy/production/validate.sh" "$tmp/overlay" >/dev/null 2>&1; then
    printf 'validation accepted an overlay without %s\n' "$path" >&2
    exit 1
  fi
done

real_kubectl=$(command -v kubectl)
cat >"$tmp/kubectl" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$CALLS"
case "$1" in
  kustomize|create) exec "$REAL_KUBECTL" "$@" ;;
  get)
    if [ "$2" = ingressclass ]; then
      printf '%s\n' '{"spec":{"controller":"k8s.io/ingress-nginx"}}'
    fi
    ;;
esac
EOF
chmod +x "$tmp/kubectl"
: >"$tmp/cluster-calls"
CALLS="$tmp/cluster-calls" REAL_KUBECTL="$real_kubectl" KUBECTL="$tmp/kubectl" \
  FACTORY_VALIDATE_CLUSTER=true sh "$root/deploy/production/validate.sh" "$tmp/base" >/dev/null
grep -Fq 'apply --server-side --dry-run=server -f ' "$tmp/cluster-calls"
grep -Fq 'get ingressclass nginx -o json' "$tmp/cluster-calls"

printf '%s\n' 'Production overlay validation contract passed.'
