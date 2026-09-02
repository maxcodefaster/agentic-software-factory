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

write_overlay replace /spec/rules/0/host
cat >>"$tmp/overlay/kustomization.yaml" <<'EOF'
        value: factory.production.test
EOF
sh "$root/deploy/production/validate.sh" "$tmp/overlay" >/dev/null

for path in \
  /spec/ingressClassName \
  /metadata/annotations/nginx.ingress.kubernetes.io~1limit-rps \
  /metadata/annotations/nginx.ingress.kubernetes.io~1limit-burst-multiplier
do
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
write_overlay replace /spec/rules/0/host
cat >>"$tmp/overlay/kustomization.yaml" <<'EOF'
        value: factory.production.test
EOF
: >"$tmp/cluster-calls"
CALLS="$tmp/cluster-calls" REAL_KUBECTL="$real_kubectl" KUBECTL="$tmp/kubectl" \
  FACTORY_VALIDATE_CLUSTER=true sh "$root/deploy/production/validate.sh" "$tmp/overlay" >/dev/null
grep -Fq 'apply --server-side --dry-run=server -f ' "$tmp/cluster-calls"
grep -Fq 'get ingressclass nginx -o json' "$tmp/cluster-calls"

printf '%s\n' 'Production overlay validation contract passed.'
