#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

apply=false
case "${1:-}" in
  '') ;;
  --apply) apply=true ;;
  -h|--help) printf 'Usage: %s [--apply]\n' "$0"; exit 0 ;;
  *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac

ingress_version=${FACTORY_INGRESS_NGINX_VERSION:-4.13.2}
cert_manager_version=${FACTORY_CERT_MANAGER_VERSION:-v1.21.1}
cnpg_version=${FACTORY_CNPG_VERSION:-0.27.1}

if [ "$apply" = false ]; then
  printf 'Local prerequisite plan:\n'
  printf '  ingress-nginx chart %s\n' "$ingress_version"
  printf '  cert-manager chart %s\n' "$cert_manager_version"
  printf '  CloudNativePG chart %s\n' "$cnpg_version"
  printf '  ClusterIssuer aaf-local-ca\n'
  printf 'Run %s --apply to install or reconcile them.\n' "$0"
  exit 0
fi

for command in kubectl helm openssl jq; do
  command -v "$command" >/dev/null 2>&1 || { printf 'Missing prerequisite: %s\n' "$command" >&2; exit 1; }
done
[ "$(kubectl config current-context)" = orbstack ] || {
  printf 'Current Kubernetes context must be orbstack.\n' >&2
  exit 1
}

release_matches() {
  namespace=$1
  release=$2
  chart=$3
  [ "$(helm list -n "$namespace" -f "^$release$" -o json 2>/dev/null | jq -r '.[0].chart // ""')" = "$chart" ]
}

if release_matches ingress-nginx ingress-nginx "ingress-nginx-$ingress_version" &&
  [ "$(kubectl get service ingress-nginx-controller -n ingress-nginx -o jsonpath='{.spec.type}' 2>/dev/null)" = LoadBalancer ]; then
  printf 'ingress-nginx %s already matches.\n' "$ingress_version"
else
  helm upgrade --install ingress-nginx ingress-nginx \
    --repo https://kubernetes.github.io/ingress-nginx \
    --version "$ingress_version" \
    --namespace ingress-nginx --create-namespace \
    --set controller.service.type=LoadBalancer \
    --wait --timeout 10m
fi

if release_matches cert-manager cert-manager "cert-manager-$cert_manager_version" &&
  kubectl get crd/certificates.cert-manager.io >/dev/null 2>&1; then
  printf 'cert-manager %s already matches.\n' "$cert_manager_version"
else
  helm upgrade --install cert-manager oci://quay.io/jetstack/charts/cert-manager \
    --version "$cert_manager_version" \
    --namespace cert-manager --create-namespace \
    --set crds.enabled=true \
    --wait --timeout 10m
fi

if release_matches cnpg-system cnpg "cloudnative-pg-$cnpg_version" &&
  kubectl get crd/clusters.postgresql.cnpg.io >/dev/null 2>&1; then
  printf 'CloudNativePG %s already matches.\n' "$cnpg_version"
else
  helm upgrade --install cnpg oci://ghcr.io/cloudnative-pg/charts/cloudnative-pg \
    --version "$cnpg_version" \
    --namespace cnpg-system --create-namespace \
    --wait --timeout 10m
fi

dns_config='rewrite name exact factory.localhost ingress-nginx-controller.ingress-nginx.svc.cluster.local
rewrite name exact coder.localhost ingress-nginx-controller.ingress-nginx.svc.cluster.local
rewrite name exact forgejo-factory.localhost ingress-nginx-controller.ingress-nginx.svc.cluster.local'
current_dns_config=$(kubectl get configmap coredns-custom -n kube-system -o jsonpath='{.data.factory-localhost\.override}' 2>/dev/null || true)
if [ "$(printf '%s' "$current_dns_config" | sed '/^[[:space:]]*$/d;s/^[[:space:]]*//')" != "$dns_config" ]; then
  kubectl apply -f - <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns-custom
  namespace: kube-system
data:
  factory-localhost.override: |
    rewrite name exact factory.localhost ingress-nginx-controller.ingress-nginx.svc.cluster.local
    rewrite name exact coder.localhost ingress-nginx-controller.ingress-nginx.svc.cluster.local
    rewrite name exact forgejo-factory.localhost ingress-nginx-controller.ingress-nginx.svc.cluster.local
EOF
  kubectl rollout restart deployment/coredns -n kube-system >/dev/null
  kubectl rollout status deployment/coredns -n kube-system --timeout=180s >/dev/null
else
  printf '%s\n' 'CoreDNS localhost rewrites already match.'
fi
current_dns_config=$(kubectl get configmap coredns-custom -n kube-system -o jsonpath='{.data.factory-localhost\.override}' 2>/dev/null || true)

work=$(mktemp -d "${TMPDIR:-/tmp}/factory-local-ca.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
if ! kubectl get secret aaf-local-ca -n cert-manager -o json 2>/dev/null |
  jq -e '.type == "kubernetes.io/tls" and (.data["tls.crt"] | type == "string") and (.data["tls.key"] | type == "string")' >/dev/null 2>&1; then
  kubectl delete secret aaf-local-ca -n cert-manager --ignore-not-found >/dev/null
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
    -subj '/CN=Agentic Software Factory Local CA' \
    -keyout "$work/tls.key" -out "$work/tls.crt" >/dev/null 2>&1
  kubectl create secret tls aaf-local-ca -n cert-manager \
    --cert="$work/tls.crt" --key="$work/tls.key"
fi
kubectl apply -f - <<'EOF'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: aaf-local-ca
spec:
  ca:
    secretName: aaf-local-ca
EOF

kubectl wait --for=condition=Available deployment/ingress-nginx-controller -n ingress-nginx --timeout=300s
kubectl wait --for=condition=Available deployment/cert-manager -n cert-manager --timeout=300s
kubectl wait --for=condition=Available deployment/cnpg-cloudnative-pg -n cnpg-system --timeout=300s
kubectl wait --for=condition=Ready clusterissuer/aaf-local-ca --timeout=180s
kubectl get endpoints ingress-nginx-controller -n ingress-nginx -o json |
  jq -e '[.subsets[]?.addresses[]?] | length > 0' >/dev/null
for host in factory.localhost coder.localhost forgejo-factory.localhost; do
  printf '%s\n' "$current_dns_config" | grep -F "rewrite name exact $host ingress-nginx-controller.ingress-nginx.svc.cluster.local" >/dev/null
done
printf 'Local Kubernetes prerequisites are ready.\n'
