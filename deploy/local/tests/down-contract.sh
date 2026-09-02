#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/factory-down.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir "$tmp/bin"

cat >"$tmp/bin/kubectl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$COMMAND_LOG"
case "$*" in
  'config current-context') printf 'orbstack\n' ;;
  get\ secret\ factory-runtime*) printf 'dG9rZW4=' ;;
  *'/opt/coder list --all --output json')
    printf '%s\n' '[{"owner_name":"alice","name":"starting","latest_build":{"transition":"start","status":"starting"}},{"owner_name":"bob","name":"pending","latest_build":{"transition":"start","status":"pending"}},{"owner_name":"carol","name":"stopped","latest_build":{"transition":"stop","status":"stopped"}}]'
    ;;
  *'/opt/coder stop alice/starting --yes') exit 1 ;;
  'scale deployment/agentic-software-factory -n factory-platform --replicas=0') exit 1 ;;
esac
EOF
chmod +x "$tmp/bin/kubectl"

log=$tmp/commands
output=$tmp/output
: >"$log"
if COMMAND_LOG=$log PATH="$tmp/bin:$PATH" "$root/deploy/local/down.sh" >"$output" 2>&1; then
  printf 'down contract failed: aggregate failure must return nonzero\n' >&2
  exit 1
fi
grep -Fq '/opt/coder stop alice/starting --yes' "$log"
grep -Fq '/opt/coder stop bob/pending --yes' "$log"
if grep -Fq '/opt/coder stop carol/stopped --yes' "$log"; then
  printf 'down contract failed: stopped workspace must not be stopped again\n' >&2
  exit 1
fi
grep -Fq 'scale deployment/agentic-software-factory -n factory-platform --replicas=0' "$log"
grep -Fq 'scale deployment/forgejo -n factory-platform --replicas=0' "$log"
grep -Fq 'scale deployment/coder -n coder --replicas=0' "$log"
grep -Fq 'every service scale was attempted' "$output"

dry_log=$tmp/dry-commands
: >"$dry_log"
COMMAND_LOG=$dry_log PATH="$tmp/bin:$PATH" "$root/deploy/local/down.sh" --dry-run >"$tmp/dry-output"
if grep -Fq 'scale deployment/' "$dry_log"; then
  printf 'down contract failed: dry-run must not scale deployments\n' >&2
  exit 1
fi
grep -Fq '+ coder stop alice/starting --yes' "$tmp/dry-output"
grep -Fq '+ kubectl scale deployment/agentic-software-factory' "$tmp/dry-output"

printf 'Down lifecycle contract passed.\n'
