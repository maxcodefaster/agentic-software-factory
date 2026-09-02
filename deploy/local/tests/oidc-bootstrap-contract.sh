#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
manifest=$root/deploy/local/platform.yaml
rollout=$root/deploy/local/rollout-factory.sh
forgejo_bootstrap=$root/deploy/local/bootstrap-forgejo.sh
rendered=$(mktemp "${TMPDIR:-/tmp}/factory-platform.XXXXXX")
fake_dir=$(mktemp -d "${TMPDIR:-/tmp}/factory-forgejo.XXXXXX")
bootstrap=$fake_dir/bootstrap-oidc.sh
arguments=$fake_dir/arguments
trap 'rm -f "$rendered"; rm -rf "$fake_dir"' EXIT HUP INT TERM

fail() {
  printf 'OIDC bootstrap contract failed: %s\n' "$1" >&2
  exit 1
}

render() {
  selector=${1:-}
  bun -e '
    const source = await Bun.file(process.argv[1]).text();
    const selector = process.argv[2];
    const documents = source.split(/^---[ \t]*$/m).map((part) => part.trim()).filter(Boolean).map((part) => Bun.YAML.parse(part));
    const items = documents.flatMap((document) => document?.kind === "List" ? document.items ?? [] : [document]).filter(Boolean);
    const selected = selector ? items.filter((item) => Object.entries(Object.fromEntries(selector.split(",").map((entry) => entry.split("=", 2)))).every(([key, value]) => item.metadata?.labels?.[key] === value)) : items;
    process.stdout.write(JSON.stringify(selected));
  ' "$manifest" "$selector"
}

render | jq '{items: .}' >"$rendered"

if jq -e '.items[] | select(.kind == "Secret" and .metadata.name == "coder-forgejo-external-auth")' "$rendered" >/dev/null; then
  fail 'platform manifest must not own the conditional Coder Forgejo placeholder Secret'
fi

jq -r '.items[] | select(.kind == "ConfigMap" and .metadata.name == "forgejo-oidc-bootstrap") | .data["bootstrap-oidc.sh"]' "$rendered" >"$bootstrap"
cat >"$fake_dir/forgejo" <<EOF
#!/bin/sh
printf '%s\n' "\$@" >"$arguments"
EOF
chmod +x "$bootstrap" "$fake_dir/forgejo"
PATH="$fake_dir:$PATH" \
  FACTORY_OIDC_ISSUER=https://factory.example \
  FORGEJO_OWNER=factory \
  FORGEJO_HUMAN_TEAM=factory-users \
  FACTORY_TENANT_GROUP=tenant-factory \
  FACTORY_TEAM_BOARDS='[{"slug":"payments","displayName":"Payments","group":"team-payments"},{"slug":"operations","displayName":"Operations","group":"team-operations"}]' \
  FORGEJO_OIDC_CLIENT_ID=client \
  FORGEJO_OIDC_CLIENT_SECRET=secret \
  sh "$bootstrap"
grep -Fq '{"tenant-factory":{"factory":["factory-users"]},"team-payments":{"factory":["factory-users-payments"]},"team-operations":{"factory":["factory-users-operations"]}}' "$arguments" ||
  fail 'OIDC bootstrap must map every Factory group to its isolated Forgejo team'

jq -e '
  .items[] |
  select(.apiVersion == "apps/v1" and .kind == "Deployment" and .metadata.name == "forgejo") |
  .spec.template.spec.initContainers as $init |
  ($init | length) == 1 and
  ($init[] |
    .name == "configure-oidc" and
    .command == ["/bin/sh", "-ec"] and
    .args == ["/usr/local/bin/docker-entrypoint.sh forgejo migrate\n"] and
    .env == [
      {"name":"FORGEJO__database__DB_TYPE","value":"sqlite3"},
      {"name":"FORGEJO__database__PATH","value":"/var/lib/gitea/data/gitea.db"},
      {"name":"FORGEJO__security__INSTALL_LOCK","value":"true"}
    ] and
    .volumeMounts == [{"mountPath":"/var/lib/gitea","name":"data"}]
  )
' "$rendered" >/dev/null ||
  fail 'Forgejo init must contain only the migration command and its dependencies'

jq -e '
  .items[] |
  select(.apiVersion == "apps/v1" and .kind == "Deployment" and .metadata.name == "forgejo") |
  any(.spec.template.spec.containers[] | select(.name == "forgejo").volumeMounts[];
      .name == "oidc-bootstrap" and .mountPath == "/opt/factory" and .readOnly == true) and
  any(.spec.template.spec.volumes[];
      .name == "oidc-bootstrap" and .configMap.name == "forgejo-oidc-bootstrap")
' "$rendered" >/dev/null || fail 'OIDC bootstrap ConfigMap must remain mounted in Forgejo'
jq -e '
  .items[] |
  select(.apiVersion == "apps/v1" and .kind == "Deployment" and .metadata.name == "forgejo") |
  any(.spec.template.spec.containers[] | select(.name == "forgejo").env[];
      .name == "FORGEJO__service__ENABLE_INTERNAL_SIGNIN" and .value == "false")
' "$rendered" >/dev/null ||
  fail 'Forgejo internal sign-in must remain disabled'
jq -e '
  .items[] |
  select(.apiVersion == "apps/v1" and .kind == "Deployment" and .metadata.name == "forgejo") |
  any(.spec.template.spec.containers[] | select(.name == "forgejo").env[];
      .name == "FORGEJO__service__ENABLE_BASIC_AUTHENTICATION" and .value == "false")
' "$rendered" >/dev/null ||
  fail 'Forgejo basic authentication must remain disabled'

selected=$(render factory.application/rollout=factory | jq -r '.[] | if .kind == "Deployment" then "deployment.apps/" + .metadata.name elif .kind == "Certificate" then "certificate.cert-manager.io/" + .metadata.name else (.kind | ascii_downcase) + "/" + .metadata.name end')
printf '%s\n' "$selected" | grep -Fq 'deployment.apps/agentic-software-factory' ||
  fail 'selective apply must include Factory'
printf '%s\n' "$selected" | grep -Fq 'certificate.cert-manager.io/factory-tls' ||
  fail 'selective apply must include the Factory certificate'
if printf '%s\n' "$selected" | grep -Fq 'forgejo'; then
  fail 'selective apply must exclude Forgejo resources'
fi
forgejo_selected=$(render factory.application/rollout=forgejo | jq -r '.[] | if .kind == "Deployment" then "deployment.apps/" + .metadata.name else (.kind | ascii_downcase) + "/" + .metadata.name end')
[ "$forgejo_selected" = "configmap/forgejo-oidc-bootstrap
deployment.apps/forgejo" ] ||
  fail 'pre-shutdown Forgejo apply must contain only its bootstrap ConfigMap and Deployment'

cat >"$fake_dir/kubectl" <<'EOF'
#!/bin/sh
case "$*" in
  create\ --dry-run=client*)
    bun -e '
      const source = await Bun.file(process.argv[1]).text();
      for (const part of source.split(/^---[ \t]*$/m).map((value) => value.trim()).filter(Boolean)) console.log(JSON.stringify(Bun.YAML.parse(part)));
    ' "$PLATFORM_MANIFEST"
    ;;
esac
EOF
chmod +x "$fake_dir/kubectl"

grep -Fq 'ensure_forgejo_available' "$rollout" || fail 'rollout must recover Forgejo before stopping Factory'
grep -Fq -- '--type strategic' "$rollout" || fail 'known-cycle recovery must use a named strategic merge patch'
grep -Fq 'migration-only body committed in platform.yaml' "$rollout" || fail 'recovery patch must derive from the committed manifest'
grep -Fq '.metadata.labels["factory.application/rollout"] == "factory"' "$rollout" ||
  fail 'rollout must project only Factory resources'
grep -Fq 'factory.application/rollout=forgejo' "$rollout" || fail 'rollout must converge Forgejo before Factory shutdown'
if grep -Eq 'kubectl apply -f "?\$manifest"?([[:space:]]|$)' "$rollout"; then
  fail 'rollout must not reapply the entire platform manifest'
fi
if grep -Eq 'jsonpath=.*\[[0-9]+\]' "$rollout"; then
  fail 'rollout must not address Kubernetes arrays by numeric index'
fi

grep -Fq 'elif [ "$pending_coder_reconcile" = true ] ||' "$forgejo_bootstrap" ||
  fail 'a pending Coder reconcile must force another Forgejo OAuth rotation'
annotation_line=$(grep -nF 'kubectl annotate secret coder-forgejo-external-auth -n coder factory.application/pending-coder-reconcile=true' "$forgejo_bootstrap" | sed -n '1s/:.*//p')
rotation_line=$(grep -nF 'oauth=$(curl --config "$auth_file" --fail --silent --show-error -X PATCH' "$forgejo_bootstrap" | sed -n '1s/:.*//p')
secret_line=$(grep -nF 'kubectl apply -f "$payload"' "$forgejo_bootstrap" | sed -n '$s/:.*//p')
reconcile_line=$(grep -nF '"$root/deploy/local/reconcile-secret-rollout.sh" coder' "$forgejo_bootstrap" | sed -n '1s/:.*//p')
[ -n "$annotation_line" ] && [ -n "$rotation_line" ] && [ "$annotation_line" -lt "$rotation_line" ] ||
  fail 'Forgejo OAuth rotation must persist the pending marker before PATCH'
[ -n "$secret_line" ] && [ -n "$reconcile_line" ] && [ "$rotation_line" -lt "$secret_line" ] && [ "$secret_line" -lt "$reconcile_line" ] ||
  fail 'the rotated Secret must be stored before Coder reconciliation'
grep -Fq 'annotations:{"factory.application/pending-coder-reconcile":"true"}' "$forgejo_bootstrap" ||
  fail 'the stored OAuth Secret must retain the pending marker until rollout succeeds'

available_line=$(grep -n 'rollout status deployment/"\$deployment"' "$rollout" | sed -n '1s/:.*//p')
forgejo_check_line=$(grep -n '^ensure_forgejo_available$' "$rollout" | sed -n '1s/:.*//p')
factory_stop_line=$(grep -n '^  run kubectl scale deployment "\$deployment"' "$rollout" | sed -n '1s/:.*//p')
healthy_return_line=$(grep -n 'kubectl wait --for=condition=Available deployment/"\$forgejo_deployment".*timeout=10s.*then' "$rollout" | sed -n '1s/:.*//p')
recovery_patch_line=$(grep -n 'kubectl patch deployment/"\$forgejo_deployment"' "$rollout" | sed -n '$s/:.*//p')
discovery_line=$(grep -n '! wait_for_oidc_discovery' "$rollout" | sed -n '1s/:.*//p')
bootstrap_line=$(grep -n '! bootstrap_forgejo_oidc' "$rollout" | sed -n '1s/:.*//p')
verify_line=$(grep -n '! verify_forgejo_auth_source' "$rollout" | sed -n '1s/:.*//p')
token_line=$(grep -n 'bootstrap-forgejo-review.sh' "$rollout" | sed -n '$s/:.*//p')
[ -n "$forgejo_check_line" ] && [ -n "$factory_stop_line" ] && [ "$forgejo_check_line" -lt "$factory_stop_line" ] ||
  fail 'Forgejo availability must be resolved before Factory is stopped'
[ -n "$healthy_return_line" ] && [ -n "$recovery_patch_line" ] && [ "$healthy_return_line" -lt "$recovery_patch_line" ] ||
  fail 'healthy Forgejo must return before the recovery patch'
[ -n "$available_line" ] && [ -n "$discovery_line" ] && [ "$available_line" -lt "$discovery_line" ] ||
  fail 'OIDC discovery must run after the new Factory rollout is available'
[ -n "$bootstrap_line" ] && [ "$discovery_line" -le "$bootstrap_line" ] ||
  fail 'OIDC bootstrap must follow discovery readiness'
[ -n "$verify_line" ] && [ "$bootstrap_line" -lt "$verify_line" ] ||
  fail 'rollout must verify the Forgejo auth source after bootstrap'
[ -n "$token_line" ] && [ "$verify_line" -lt "$token_line" ] ||
  fail 'review token repair must follow OIDC verification'

dry_run=$(PLATFORM_MANIFEST="$manifest" PATH="$fake_dir:$PATH" $rollout --dry-run dev.local/agentic-software-factory-bff:contract IfNotPresent)
printf '%s\n' "$dry_run" | grep -Fq 'FACTORY_OIDC_ISSUER=http://agentic-software-factory-bootstrap.factory-platform.svc.cluster.local:8080' ||
  fail 'rollout must use the internal bootstrap issuer override'
printf '%s\n' "$dry_run" | grep -Fq 'issuer http://factory.localhost' ||
  fail 'dry-run must expose the expected discovery issuer'
printf '%s\n' "$dry_run" | grep -Fq '/bin/sh -c wget -qT 10 -O-' ||
  fail 'dry-run must expose the in-container discovery request'
printf '%s\n' "$dry_run" | grep -Fq 'kubectl apply --server-side --force-conflicts' ||
  fail 'dry-run must expose the selective server-side apply'

printf 'OIDC bootstrap deployment contract passed.\n'
