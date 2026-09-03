#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

source=${1:-}
destination=${2:-}
if [ -z "$source" ] || [ -z "$destination" ]; then
  printf 'Usage: %s <repository> <empty-destination>\n' "$0" >&2
  exit 2
fi
for command in git tar shasum sort; do
  command -v "$command" >/dev/null 2>&1 || { printf 'Missing prerequisite: %s\n' "$command" >&2; exit 1; }
done

source=$(CDPATH= cd -- "$source" && pwd -P)
git -C "$source" rev-parse --show-toplevel >/dev/null 2>&1 || {
  printf 'Development image source must be a Git worktree: %s\n' "$source" >&2
  exit 1
}
[ "$(git -C "$source" rev-parse --show-toplevel)" = "$source" ] || {
  printf 'Development image source must be the repository root: %s\n' "$source" >&2
  exit 1
}
if [ -e "$destination" ]; then
  [ -d "$destination" ] && [ -z "$(ls -A "$destination")" ] || {
    printf 'Destination must not exist or must be empty: %s\n' "$destination" >&2
    exit 1
  }
else
  mkdir -p "$destination"
fi

paths=$(mktemp "${TMPDIR:-/tmp}/factory-image-paths.XXXXXX")
trap 'rm -f "$paths"' EXIT HUP INT TERM
git -C "$source" ls-files -co --exclude-standard -- \
  .dockerignore package.json bun.lock LICENSE NOTICE THIRD_PARTY_NOTICES \
  apps/bff deploy/local/bootstrap-users.ts packages/api-contracts packages/db packages/design-system web |
  LC_ALL=C sort -u >"$paths"

suspicious=$(grep -Ei '(^|/)(\.env($|\.)|\.npmrc$|\.netrc$|\.pypirc$|\.git-credentials$|auth\.json$|credentials(\.json)?$|application_default_credentials\.json$|hosts\.yml$|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$|.*(secret|credential|private[-_.]?key).*|token(\.[^/]*)?)$|(^|/)(\.docker|\.kube)/config(\.json)?$|(^|/)\.aws/credentials$' "$paths" || true)
[ -z "$suspicious" ] || {
  printf 'Refusing development image context because it contains credential files:\n%s\n' "$suspicious" >&2
  exit 1
}

while IFS= read -r path; do
  case "$path" in
    */node_modules/*|node_modules/*|*/dist/*|dist/*|*/.output/*|.output/*|*/.terraform/*|.terraform/*|*/.angular/*|.angular/*|*/coverage/*|coverage/*) ;;
    *) [ ! -f "$source/$path" ] || printf '%s\n' "$path" ;;
  esac
done <"$paths" | tar -C "$source" -T - -cf - | tar -C "$destination" -xf -

{
  printf 'head\n'
  if git -C "$source" rev-parse --verify HEAD >/dev/null 2>&1; then
    git -C "$source" ls-tree -r HEAD -- \
      .dockerignore package.json bun.lock LICENSE NOTICE THIRD_PARTY_NOTICES \
      apps/bff deploy/local/bootstrap-users.ts packages/api-contracts packages/db packages/design-system web
  else
    printf 'unborn\n'
  fi
  printf 'index\n'
  git -C "$source" ls-files -s -- \
    .dockerignore package.json bun.lock LICENSE NOTICE THIRD_PARTY_NOTICES \
    apps/bff deploy/local/bootstrap-users.ts packages/api-contracts packages/db packages/design-system web
  printf 'worktree\n'
  while IFS= read -r path; do
    case "$path" in
      */node_modules/*|node_modules/*|*/dist/*|dist/*|*/.output/*|.output/*|*/.terraform/*|.terraform/*|*/.angular/*|.angular/*|*/coverage/*|coverage/*) ;;
      *)
        if [ -f "$source/$path" ]; then
          executable=false
          [ ! -x "$source/$path" ] || executable=true
          printf '%s\t%s\t%s\n' "$path" "$executable" "$(git -C "$source" hash-object --no-filters "$path")"
        else
          printf '%s\tdeleted\n' "$path"
        fi
        ;;
    esac
  done <"$paths"
} | shasum -a 256 | cut -c1-12
