#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/factory-secret-rollout.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir "$tmp/bin"

cat >"$tmp/bin/kubectl" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$COMMAND_LOG"
case "$*" in
  'get deployment coder -n coder') ;;
  'get deployment coder -n coder -o jsonpath={.spec.template.metadata.annotations.factory\.application/secrets-checksum}')
    printf '%s' "${CURRENT_CHECKSUM:-}"
    ;;
  'get secret coder-forgejo-external-auth -n coder -o go-template={{index .metadata.annotations "factory.application/pending-coder-reconcile"}}')
    printf '%s' "${PENDING_RECONCILE:-}"
    ;;
  'rollout status deployment/coder -n coder --timeout=300s')
    [ "${ROLLOUT_FAIL:-false}" != true ]
    ;;
  get\ secret\ coder-oidc*) printf '%s\n' '{"data":{"client-secret":"YQ=="}}' ;;
  get\ secret\ coder-db-url*) printf '%s\n' '{"data":{"url":"Yg=="}}' ;;
  get\ secret\ coder-forgejo-external-auth*) printf '%s\n' '{"data":{"client-id":"Yw=="}}' ;;
esac
EOF
chmod +x "$tmp/bin/kubectl"

checksum=$(COMMAND_LOG="$tmp/checksum.log" PATH="$tmp/bin:$PATH" "$root/deploy/local/secret-checksum.sh" coder)
: >"$tmp/match.log"
COMMAND_LOG="$tmp/match.log" CURRENT_CHECKSUM="$checksum" PATH="$tmp/bin:$PATH" \
  "$root/deploy/local/reconcile-secret-rollout.sh" coder >/dev/null
if grep -Fq 'patch deployment' "$tmp/match.log"; then
  printf 'matching Secret checksum patched the deployment\n' >&2
  exit 1
fi
if grep -Fq 'rollout restart' "$tmp/match.log"; then
  printf 'matching Secret checksum without pending work restarted the deployment\n' >&2
  exit 1
fi
grep -Fq 'rollout status deployment/coder -n coder --timeout=300s' "$tmp/match.log"
grep -Fq 'annotate secret coder-forgejo-external-auth -n coder factory.application/pending-coder-reconcile-' "$tmp/match.log"

: >"$tmp/change.log"
COMMAND_LOG="$tmp/change.log" CURRENT_CHECKSUM=stale PENDING_RECONCILE=true PATH="$tmp/bin:$PATH" \
  "$root/deploy/local/reconcile-secret-rollout.sh" coder >/dev/null
grep -Fq 'patch deployment coder -n coder --type merge' "$tmp/change.log"
grep -Fq 'rollout status deployment/coder -n coder --timeout=300s' "$tmp/change.log"
grep -Fq 'annotate secret coder-forgejo-external-auth -n coder factory.application/pending-coder-reconcile-' "$tmp/change.log"

: >"$tmp/failed.log"
if COMMAND_LOG="$tmp/failed.log" CURRENT_CHECKSUM=stale PENDING_RECONCILE=true ROLLOUT_FAIL=true PATH="$tmp/bin:$PATH" \
  "$root/deploy/local/reconcile-secret-rollout.sh" coder >/dev/null 2>&1; then
  printf 'failed Secret rollout reported success\n' >&2
  exit 1
fi
if grep -Fq 'pending-coder-reconcile-' "$tmp/failed.log"; then
  printf 'failed Secret rollout consumed its pending annotation\n' >&2
  exit 1
fi

: >"$tmp/retry.log"
COMMAND_LOG="$tmp/retry.log" CURRENT_CHECKSUM="$checksum" PENDING_RECONCILE=true PATH="$tmp/bin:$PATH" \
  "$root/deploy/local/reconcile-secret-rollout.sh" coder >/dev/null
grep -Fq 'rollout restart deployment/coder -n coder' "$tmp/retry.log"
grep -Fq 'rollout status deployment/coder -n coder --timeout=300s' "$tmp/retry.log"
grep -Fq 'pending-coder-reconcile-' "$tmp/retry.log"

grep -Fq 'pending_coder_reconcile' "$root/deploy/local/bootstrap-forgejo.sh"

printf 'Secret rollout contract passed.\n'
