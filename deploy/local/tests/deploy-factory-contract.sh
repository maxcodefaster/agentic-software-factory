#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/factory-deploy-contract.XXXXXX")
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
mkdir "$test_root/bin"

cat >"$test_root/bin/kubectl" <<'EOF'
#!/bin/sh
case "$*" in
  'config current-context') printf 'orbstack\n' ;;
  create\ --dry-run=client*)
    printf '%s\n' '{"apiVersion":"apps/v1","kind":"Deployment","metadata":{"name":"agentic-software-factory","labels":{"factory.application/rollout":"factory"}},"spec":{"template":{"spec":{"initContainers":[{"name":"migrate","image":"old"}],"containers":[{"name":"bff","image":"old"}]}}}}'
    ;;
esac
EOF
cat >"$test_root/bin/docker" <<'EOF'
#!/bin/sh
exit 1
EOF
chmod +x "$test_root/bin/kubectl" "$test_root/bin/docker"

run_mode() {
  log=$1
  shift
  PATH="$test_root/bin:$PATH" TMPDIR="$test_root" "$root/deploy/local/deploy-factory.sh" --dry-run "$@" >"$log"
}

factory_log=$test_root/factory-only.log
full_log=$test_root/full-stack.log
run_mode "$factory_log"
run_mode "$full_log" --full-stack

if grep -Fq 'deployment/forgejo' "$factory_log"; then
  printf 'Factory deploy must skip full-stack reconciliations by default.\n' >&2
  exit 1
fi
grep -Fq 'deployment/forgejo' "$full_log" || { printf 'Full-stack deploy must preserve OIDC and supporting reconciliations.\n' >&2; exit 1; }
grep -Fq 'docker build' "$factory_log" || { printf 'Factory deploy must own image builds.\n' >&2; exit 1; }

printf 'Factory deploy mode contract passed.\n'
