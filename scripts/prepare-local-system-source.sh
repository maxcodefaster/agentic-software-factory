#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

source=${1:-}
destination=${2:-}
if [ -z "$source" ] || [ -z "$destination" ]; then
  printf 'Usage: %s <system-worktree> <empty-destination>\n' "$0" >&2
  exit 2
fi
for command in bun git sort tar; do
  command -v "$command" >/dev/null 2>&1 || { printf 'Missing prerequisite: %s\n' "$command" >&2; exit 1; }
done

source=$(CDPATH= cd -- "$source" && pwd)
git -C "$source" rev-parse --git-dir >/dev/null 2>&1 || {
  printf 'System source must be a Git worktree: %s\n' "$source" >&2
  exit 1
}
prefix=$(git -C "$source" rev-parse --show-prefix)
repository_root=$(git -C "$source" rev-parse --show-toplevel)
if [ -e "$destination" ]; then
  [ -d "$destination" ] || {
    printf 'Destination must not exist or must be empty: %s\n' "$destination" >&2
    exit 1
  }
  set -- "$destination"/.[!.]* "$destination"/..?* "$destination"/*
  [ "$1" = "$destination/.[!.]*" ] && [ "$2" = "$destination/..?*" ] && [ "$3" = "$destination/*" ] || {
    printf 'Destination must not exist or must be empty: %s\n' "$destination" >&2
    exit 1
  }
fi

dirty=$(git -C "$repository_root" status --porcelain -- "$source")
if [ -n "$dirty" ] && [ "${FACTORY_ALLOW_DIRTY_SOURCE:-false}" != true ]; then
  printf 'System source has uncommitted changes: %s\n' "$source" >&2
  printf '%s\n' "$dirty" >&2
  printf '%s\n' 'Commit them or explicitly set FACTORY_ALLOW_DIRTY_SOURCE=true to deploy every tracked and non-ignored file.' >&2
  exit 1
fi
publishable_paths=$(git -C "$source" ls-files -co --exclude-standard -- . | LC_ALL=C sort -u)
suspicious=$(printf '%s\n' "$publishable_paths" |
  while IFS= read -r path; do
    [ -n "$path" ] && [ -f "$source/$path" ] && printf '%s\n' "$path"
  done |
  grep -Eiv '(^|/)\.env\.example$' |
  grep -Eiv '(^|/)templates/([^/]*[-_.])?secrets?\.ya?ml$' |
  grep -Ei '(^|/)(\.env($|\.)|\.npmrc$|\.netrc$|\.pypirc$|\.git-credentials$|auth\.json$|credentials(\.json)?$|application_default_credentials\.json$|hosts\.yml$|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$|.*(secret|credential|token|private[-_.]?key).*)|(^|/)(\.docker|\.kube)/config(\.json)?$|(^|/)\.aws/credentials$' || true)
[ -z "$suspicious" ] || {
  printf 'Refusing System snapshot because secret-like files are not ignored:\n%s\n' "$suspicious" >&2
  printf '%s\n' 'Remove the credential file or replace it with a safe example file.' >&2
  exit 1
}
if [ -z "$prefix" ]; then
  git clone -q --no-hardlinks --no-local "$source" "$destination"
else
  mkdir -p "$destination"
  git -C "$source" ls-files -co --exclude-standard | tar -C "$source" -T - -cf - | tar -C "$destination" -xf -
  git -C "$destination" init -q
  git -C "$destination" config user.name 'Agentic Software Factory'
  git -C "$destination" config user.email 'factory@example.invalid'
  git -C "$destination" add --all
  GIT_AUTHOR_DATE='2000-01-01T00:00:00Z' GIT_COMMITTER_DATE='2000-01-01T00:00:00Z' git -C "$destination" commit -q -m 'Prepare embedded System example'
fi
destination=$(CDPATH= cd -- "$destination" && pwd)
source_mode=committed
if [ -n "$dirty" ]; then
  source_mode=dirty
  {
    git -C "$source" ls-tree -r --name-only HEAD -- .
    git -C "$source" ls-files -- .
  } | LC_ALL=C sort -u | while IFS= read -r path; do
    [ -e "$source/$path" ] || rm -f "$destination/$path"
  done
  git -C "$source" ls-files -co --exclude-standard | while IFS= read -r path; do
    [ ! -f "$source/$path" ] || printf '%s\n' "$path"
  done | tar -C "$source" -T - -cf - | tar -C "$destination" -xf -
fi

rm -rf "$destination/.coder" \
  "$destination/node_modules" "$destination/artifacts" "$destination/tmp" \
  "$destination/.devcontainer/logs" "$destination/.coder/.terraform"
rm -f "$destination/.factory/application.yaml" "$destination/.factory/dev.env" \
  "$destination/.factory/start-preview.sh"
if [ -f "$destination/.vscode/tasks.json" ]; then
  bun "$root/scripts/merge-vscode-tasks.ts" "$destination/.vscode/tasks.json"
fi
git -C "$source" ls-tree -r --name-only HEAD -- . | while IFS= read -r path; do
  case "$path" in
    .env.example|*/.env.example) ;;
    .env|.env.*|*/.env|*/.env.*|node_modules/*|*/node_modules/*|artifacts/*|*/artifacts/*|tmp/*|*/tmp/*)
      rm -f "$destination/$path"
      ;;
  esac
done

git -C "$destination" branch -M main
git -C "$destination" config user.name 'Agentic Software Factory'
git -C "$destination" config user.email 'factory@example.invalid'
git -C "$destination" config factory.prepared-source true
git -C "$destination" config factory.source-mode "$source_mode"
git -C "$destination" config factory.source-path "$source"
git -C "$destination" config factory.repository-name "${FACTORY_SYSTEM_REPOSITORY:-$(basename "$source")}"
git -C "$destination" add --all
if ! git -C "$destination" diff --cached --quiet; then
  GIT_AUTHOR_DATE='2000-01-01T00:00:00Z' GIT_COMMITTER_DATE='2000-01-01T00:00:00Z' \
    git -C "$destination" commit -q -m 'Prepare System source'
fi
printf 'Prepared %s System source %s at %s.\n' "$source_mode" "$destination" "$(git -C "$destination" rev-parse HEAD)"
