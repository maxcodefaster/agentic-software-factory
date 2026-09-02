#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
cat >"$tmp/kubectl" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >>"$CALLS"
case "$1" in
  kustomize) printf '%s\n' 'image: ghcr.io/replace-owner/replace-repository/control-plane@sha256:0000000000000000000000000000000000000000000000000000000000000000' ;;
  diff) exit 1 ;;
esac
SH
chmod +x "$tmp/kubectl"

cat >"$tmp/kubectl-release" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >>"$CALLS"
case "$1" in
  kustomize) printf '%s\n' 'image: ghcr.io/acme/factory/control-plane@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' ;;
  diff) exit 1 ;;
esac
SH
chmod +x "$tmp/kubectl-release"

cat >"$tmp/validate" <<'SH'
#!/bin/sh
printf 'validate %s\n' "$*" >>"$CALLS"
SH
chmod +x "$tmp/validate"

CALLS="$tmp/plan" KUBECTL="$tmp/kubectl-release" FACTORY_VALIDATE="$tmp/validate" OVERLAY="$root/deploy/production" sh "$root/deploy/production/upgrade.sh" plan
grep -q "^validate $root/deploy/production$" "$tmp/plan"
grep -q '^kustomize ' "$tmp/plan"
grep -q '^diff -k ' "$tmp/plan"

CALLS="$tmp/apply" KUBECTL="$tmp/kubectl-release" FACTORY_VALIDATE="$tmp/validate" OVERLAY="$root/deploy/production" sh "$root/deploy/production/upgrade.sh" apply
grep -n 'delete job/agentic-software-factory-migrate' "$tmp/apply" | grep -q '^3:'
grep -n 'apply -k ' "$tmp/apply" | grep -q '^4:'
grep -n 'wait --for=condition=complete job/agentic-software-factory-migrate' "$tmp/apply" | grep -q '^5:'
grep -n 'rollout resume deployment/agentic-software-factory' "$tmp/apply" | grep -q '^6:'
grep -n 'rollout status deployment/agentic-software-factory' "$tmp/apply" | grep -q '^7:'
grep -n 'services/agentic-software-factory:8080/proxy/readyz' "$tmp/apply" | grep -q '^8:'

CALLS="$tmp/rollback" KUBECTL="$tmp/kubectl-release" FACTORY_VALIDATE="$tmp/validate" OVERLAY="$root/deploy/production" sh "$root/deploy/production/upgrade.sh" rollback
grep -q '^rollout undo deployment/agentic-software-factory' "$tmp/rollback"
grep -q '^rollout resume deployment/agentic-software-factory' "$tmp/rollback"
grep -q '^rollout status deployment/agentic-software-factory' "$tmp/rollback"
if CALLS="$tmp/placeholder" KUBECTL="$tmp/kubectl" FACTORY_VALIDATE="$tmp/validate" OVERLAY="$root/deploy/production" sh "$root/deploy/production/upgrade.sh" plan >/dev/null 2>&1; then
  exit 1
fi
cat >"$tmp/validate-failure" <<'SH'
#!/bin/sh
exit 1
SH
chmod +x "$tmp/validate-failure"
if CALLS="$tmp/invalid-overlay" KUBECTL="$tmp/kubectl-release" FACTORY_VALIDATE="$tmp/validate-failure" OVERLAY="$root/deploy/production" sh "$root/deploy/production/upgrade.sh" plan >/dev/null 2>&1; then
  exit 1
fi
test ! -s "$tmp/invalid-overlay"
printf '%s\n' 'Upgrade and rollback contract passed.'
