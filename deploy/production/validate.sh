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
resources=$(mktemp)
trap 'rm -f "$render" "$resources"' EXIT HUP INT TERM
"$kubectl" kustomize "$target" >"$render"
bun -e '
  const source = await Bun.file(process.argv[1]).text();
  const documents = source
    .split(/^---[ \t]*$/m)
    .map((document) => document.trim())
    .filter(Boolean)
    .map((document) => Bun.YAML.parse(document))
    .filter((document) => document !== null);
  process.stdout.write(JSON.stringify(documents));
' "$render" >"$resources"

resource() {
  kind=$1
  name=$2
  jq -e --arg kind "$kind" --arg name "$name" \
    '[.[] | select(.kind == $kind and .metadata.name == $name)] | if length == 1 then .[0] else error("expected one \($kind)/\($name)") end' \
    "$resources"
}

deployment=$(mktemp)
job=$(mktemp)
ingress=$(mktemp)
bff_policy=$(mktemp)
migration_policy=$(mktemp)
config=$(mktemp)
runtime_secret=$(mktemp)
trap 'rm -f "$render" "$resources" "$deployment" "$job" "$ingress" "$bff_policy" "$migration_policy" "$config" "$runtime_secret"' EXIT HUP INT TERM
resource Deployment agentic-software-factory >"$deployment"
resource Job agentic-software-factory-migrate >"$job"
resource Ingress agentic-software-factory >"$ingress"
resource NetworkPolicy agentic-software-factory-bff >"$bff_policy"
resource NetworkPolicy agentic-software-factory-migrate >"$migration_policy"
jq -e '[.[] | select(.kind == "ConfigMap" and (.metadata.name | startswith("factory-config-")))] | if length == 1 then .[0] else error("expected one generated factory ConfigMap") end' "$resources" >"$config"
resource ExternalSecret factory-runtime >"$runtime_secret"

if grep -Eiq 'k8s\.orb\.local|/Users/' "$render"; then
  printf '%s\n' 'Local-only paths or hosts are forbidden.' >&2
  exit 1
fi
jq -e '.spec.template.spec.containers | any(.name == "bff" and (.image | test("@sha256:[0-9a-f]{64}$")))' "$deployment" >/dev/null
jq -e '.spec.template.spec.containers | any(.name == "migrate" and (.image | test("@sha256:[0-9a-f]{64}$")))' "$job" >/dev/null
if [ "$validate_base" = true ]; then
  jq -e '.spec.template.spec.containers | any(.name == "bff" and (.image | startswith("ghcr.io/replace-owner/replace-repository/control-plane@sha256:")))' "$deployment" >/dev/null
fi
grep -Fq 'USER 10001:10001' "$root/apps/bff/Dockerfile"

coder_host=$(jq -r '.data.CODER_PUBLIC_URL | sub("^https?://"; "") | split("/")[0]' "$config")
forgejo_host=$(jq -r '.data.FORGEJO_PUBLIC_URL | sub("^https?://"; "") | split("/")[0]' "$config")
jq -e '
  .spec.paused == true and
  .spec.template.spec.automountServiceAccountToken == false and
  .spec.template.spec.terminationGracePeriodSeconds == 60 and
  (.spec.template.spec.topologySpreadConstraints | any(.whenUnsatisfiable == "DoNotSchedule")) and
  (.spec.template.spec.containers | any(
    .name == "bff" and
    .securityContext.readOnlyRootFilesystem == true and
    .securityContext.runAsUser == 10001 and
    .securityContext.runAsGroup == 10001 and
    (.env | any(.name == "DATABASE_TLS_CA" and .valueFrom.secretKeyRef.name == "factory-runtime" and .valueFrom.secretKeyRef.key == "DATABASE_TLS_CA")) and
    (.env | any(.name == "CODER_OIDC_POST_LOGOUT_REDIRECT_URIS" and .valueFrom.configMapKeyRef.key == "CODER_OIDC_POST_LOGOUT_REDIRECT_URIS")) and
    (.env | any(.name == "FORGEJO_OIDC_POST_LOGOUT_REDIRECT_URIS" and .valueFrom.configMapKeyRef.key == "FORGEJO_OIDC_POST_LOGOUT_REDIRECT_URIS"))
  ))' "$deployment" >/dev/null
jq -e '
  .spec.template.spec.automountServiceAccountToken == false and
  .spec.template.spec.terminationGracePeriodSeconds == 60 and
  (.spec.template.spec.containers | any(
    .name == "migrate" and .command == ["bun", "dist/db/run-migrations.js"] and
    .securityContext.readOnlyRootFilesystem == true and
    .securityContext.runAsUser == 10001 and
    .securityContext.runAsGroup == 10001
  ))' "$job" >/dev/null
jq -e '[.[] | select(.kind == "ServiceAccount" and (.metadata.name == "agentic-software-factory" or .metadata.name == "agentic-software-factory-migrate") and .automountServiceAccountToken == false)] | length == 2' "$resources" >/dev/null

if jq -e '[.[] | .. | objects | select(has("envFrom") or has("dataFrom"))] | length > 0' "$resources" >/dev/null; then
  printf '%s\n' 'Bulk secret or environment import is forbidden.' >&2
  exit 1
fi
jq -e '.spec.data | length == 17 and all(.[]; .secretKey == .remoteRef.property)' "$runtime_secret" >/dev/null
resource ExternalSecret factory-migration | jq -e '.spec.data | map(.secretKey) | sort == ["DATABASE_TLS_CA", "DATABASE_URL"]' >/dev/null

jq -e --arg coderHost "$coder_host" --arg forgejoHost "$forgejo_host" '
  .spec.ingressClassName == "nginx" and
  .metadata.annotations["nginx.ingress.kubernetes.io/limit-rps"] == "20" and
  .metadata.annotations["nginx.ingress.kubernetes.io/limit-burst-multiplier"] == "3" and
  (.metadata.annotations["nginx.ingress.kubernetes.io/server-snippet"] | contains("location = /metrics { return 404; }")) and
  ([.spec.rules[] | select(
    ((.host == $coderHost) or (.host == $forgejoHost)) and
    (.http.paths | length == 1) and .http.paths[0].path == "/__factory/logout" and
    .http.paths[0].pathType == "Exact" and
    .http.paths[0].backend.service.name == "agentic-software-factory" and
    .http.paths[0].backend.service.port.name == "http"
  )] | length == 2)' "$ingress" >/dev/null

jq -e '
  def target($port):
    any(.spec.egress[];
      (.ports | any(.port == $port and .protocol == "TCP")) and
      (.to | any(
        ((.namespaceSelector.matchLabels // {}) | length == 1) and
        ((.namespaceSelector.matchLabels // {}) | to_entries | all(.value != true and .value != "true")) and
        ((.podSelector.matchLabels // {}) | length > 0)
      ))
    );
  .spec.podSelector.matchLabels["app.kubernetes.io/name"] == "agentic-software-factory" and
  target(53) and target(5432) and target(443) and target(3128) and target(4318) and
  ([.spec.egress[] | select(.ports | any(.port == 443))] | length == 2)' "$bff_policy" >/dev/null
jq -e '
  def target($port):
    any(.spec.egress[];
      (.ports | any(.port == $port)) and
      (.to | any(
        ((.namespaceSelector.matchLabels // {}) | length == 1) and
        ((.namespaceSelector.matchLabels // {}) | to_entries | all(.value != true and .value != "true")) and
        ((.podSelector.matchLabels // {}) | length > 0)
      ))
    );
  .spec.podSelector.matchLabels["app.kubernetes.io/name"] == "agentic-software-factory-migrate" and
  target(53) and target(5432)' "$migration_policy" >/dev/null

jq -e '
  .data.AUTH_MODE == "entra" and .data.FACTORY_ENVIRONMENT == "production" and
  (.data.HTTPS_PROXY | test("^http://.+:3128$")) and (.data.TRUSTED_PROXY_CIDRS | length > 0) and
  .data.CODER_OIDC_POST_LOGOUT_REDIRECT_URIS == .data.CODER_PUBLIC_URL and
  .data.FORGEJO_OIDC_POST_LOGOUT_REDIRECT_URIS == .data.FORGEJO_PUBLIC_URL and
  (.data | has("LOCAL_AUTH_EMAIL") or has("LOCAL_AUTH_PASSWORD") | not)' "$config" >/dev/null
sharing=$(jq -r '.data.FACTORY_CODER_RESTRICTED_APP_SHARING' "$config")
acknowledgement=$(jq -r '.data.FACTORY_CODER_AUTHENTICATED_APP_SCOPE_ACKNOWLEDGEMENT' "$config")
case "$sharing" in
  owner) ;;
  authenticated)
    if [ "$acknowledgement" != deployment-wide ] && ! { [ "$validate_base" = true ] && [ "$acknowledgement" = replace-me ]; }; then
      printf '%s\n' 'Authenticated Coder apps require FACTORY_CODER_AUTHENTICATED_APP_SCOPE_ACKNOWLEDGEMENT=deployment-wide.' >&2
      exit 1
    fi
    ;;
  *)
    printf '%s\n' 'FACTORY_CODER_RESTRICTED_APP_SHARING must be owner or authenticated.' >&2
    exit 1
    ;;
esac

resource PodDisruptionBudget agentic-software-factory >/dev/null
resource PrometheusRule agentic-software-factory >/dev/null
if [ "$validate_base" = false ] && grep -Eq 'example\.invalid|replace-me|00000000-0000-0000-0000-000000000000|sha256:0{64}' "$render"; then
  printf '%s\n' 'Deployable overlays must replace every production placeholder.' >&2
  exit 1
fi
if [ "${FACTORY_VALIDATE_CLUSTER:-false}" = true ]; then
  for crd in externalsecrets.external-secrets.io servicemonitors.monitoring.coreos.com prometheusrules.monitoring.coreos.com volumesnapshots.snapshot.storage.k8s.io; do
    "$kubectl" get crd "$crd" >/dev/null
  done
  "$kubectl" get ingressclass nginx -o json | jq -e '.spec.controller == "k8s.io/ingress-nginx"' >/dev/null
  "$kubectl" apply --server-side --dry-run=server -f "$render" >/dev/null
  "$kubectl" version >/dev/null
fi
printf '%s\n' 'Portable production deployment contract passed.'
