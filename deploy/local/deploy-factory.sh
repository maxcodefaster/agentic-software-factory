#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

dry_run=false
full_stack=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --full-stack) full_stack=true ;;
    *) printf 'usage: deploy-factory.sh [--dry-run] [--full-stack]\n' >&2; exit 2 ;;
  esac
  shift
done

[ "$(kubectl config current-context)" = orbstack ] || {
  printf 'Refusing local Factory deploy outside the orbstack Kubernetes context.\n' >&2
  exit 1
}

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
context=$(mktemp -d "${TMPDIR:-/tmp}/factory-dev-image.XXXXXX")
trap 'rm -rf "$context"' EXIT HUP INT TERM
digest=$("$root/scripts/prepare-dev-image-context.sh" "$root" "$context")
image=$($root/deploy/local/resolve-dev-image.sh "${FACTORY_DEV_IMAGE:-dev.local/agentic-software-factory-bff}" "$digest")
checksum=$($root/deploy/local/secret-checksum.sh factory)

image_matches_source() {
  [ "$(docker image inspect "$image" --format '{{index .Config.Labels "factory.application/dev-image"}}' 2>/dev/null || true)" = true ] &&
    [ "$(docker image inspect "$image" --format '{{index .Config.Labels "factory.application/source-digest"}}' 2>/dev/null || true)" = "$digest" ]
}

if [ "$dry_run" = true ]; then
  if image_matches_source; then
    printf '# reuse local image %s\n' "$image"
  else
    printf '+ docker build --label factory.application/dev-image=true --label factory.application/source-digest=%s -t %s -f %s/apps/bff/Dockerfile %s\n' "$digest" "$image" "$context" "$context"
  fi
  rollout_args=--factory-only
  [ "$full_stack" = false ] || rollout_args=
  FACTORY_SECRETS_CHECKSUM=$checksum "$root/deploy/local/rollout-factory.sh" --dry-run $rollout_args "$image" IfNotPresent
  exit
fi

image_matches_source ||
  docker build --label factory.application/dev-image=true --label "factory.application/source-digest=$digest" -t "$image" -f "$context/apps/bff/Dockerfile" "$context"
rollout_args=--factory-only
[ "$full_stack" = false ] || rollout_args=
FACTORY_SECRETS_CHECKSUM=$checksum "$root/deploy/local/rollout-factory.sh" $rollout_args "$image" IfNotPresent
