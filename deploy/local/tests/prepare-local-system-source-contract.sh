#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/factory-source-contract.XXXXXX")
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
source=$test_root/customer
destination=$test_root/prepared
mkdir -p "$source/apps/portal/src" "$source/apps/api/src" "$source/.factory"
printf 'head main\n' >"$source/apps/portal/src/main.tsx"
printf 'head health\n' >"$source/apps/api/src/index.ts"
printf 'tracked env\n' >"$source/.factory/dev.env"
printf '//registry.example.invalid/:_authToken=placeholder\n' >"$source/.npmrc"
printf 'version: 1\n' >"$source/.factory/system.yaml"
printf 'node_modules/\nartifacts/\ntmp/\n.env\n.devcontainer/logs/\n' >"$source/.gitignore"
printf '.env\n.env.*\n**/.env\n**/.env.*\n' >"$source/.dockerignore"
git -C "$source" init -q
git -C "$source" config user.name contract
git -C "$source" config user.email contract@example.invalid
git -C "$source" add --all
git -C "$source" commit -q -m head

if FACTORY_ALLOW_DIRTY_SOURCE=true "$root/scripts/prepare-local-system-source.sh" "$source" "$destination" >"$test_root/committed-auth-rejected" 2>&1; then
  exit 1
fi
grep -Fq '.npmrc' "$test_root/committed-auth-rejected"
test ! -e "$destination"
git -C "$source" rm -q .npmrc
git -C "$source" commit -q -m 'remove committed auth file'

printf 'local main edit\n' >"$source/apps/portal/src/main.tsx"
printf 'local health edit\n' >"$source/apps/api/src/index.ts"
mkdir -p "$source/.devcontainer/verification" "$source/.devcontainer/logs" \
  "$source/node_modules" "$source/apps/api/node_modules" "$source/artifacts" "$source/tmp"
printf '{}\n' >"$source/.devcontainer/devcontainer.json"
printf '{}\n' >"$source/.devcontainer/verification/devcontainer.json"
mkdir -p "$source/.vscode"
printf '{"version":"2.0.0","tasks":[{"label":"Dev: Processes","type":"shell","command":"process-compose attach","runOptions":{"runOn":"folderOpen"}},{"label":"Dev: Live Logs","type":"shell","command":"process-compose process logs --namespace dev --tail 200 --follow"},{"label":"Dev: Restart API","type":"shell","command":"process-compose process restart api"}]}\n' >"$source/.vscode/tasks.json"
printf 'services: {}\n' >"$source/process-compose.yaml"
printf 'runtime log\n' >"$source/.devcontainer/logs/services.log"
printf 'secret\n' >"$source/.env"
printf 'secret\n' >"$source/local-secret.txt"
printf 'dependency\n' >"$source/node_modules/package"
printf 'nested dependency\n' >"$source/apps/api/node_modules/package"
printf 'artifact\n' >"$source/artifacts/result"
printf 'temporary\n' >"$source/tmp/result"

if "$root/scripts/prepare-local-system-source.sh" "$source" "$destination" >"$test_root/rejected" 2>&1; then
  exit 1
fi
grep -Fq 'System source has uncommitted changes' "$test_root/rejected"
rm -rf "$destination"
if FACTORY_ALLOW_DIRTY_SOURCE=true "$root/scripts/prepare-local-system-source.sh" "$source" "$destination" >"$test_root/secret-rejected" 2>&1; then
  exit 1
fi
grep -Fq 'secret-like files are not ignored' "$test_root/secret-rejected"
printf 'local-secret.txt\n' >>"$source/.gitignore"
printf '//registry.example.invalid/:_authToken=worktree-secret\n' >"$source/.npmrc"
if FACTORY_ALLOW_DIRTY_SOURCE=true "$root/scripts/prepare-local-system-source.sh" "$source" "$destination" >"$test_root/tracked-auth-rejected" 2>&1; then
  exit 1
fi
grep -Fq '.npmrc' "$test_root/tracked-auth-rejected"
test ! -e "$destination"
git -C "$source" add .npmrc
if FACTORY_ALLOW_DIRTY_SOURCE=true "$root/scripts/prepare-local-system-source.sh" "$source" "$destination" >"$test_root/staged-auth-rejected" 2>&1; then
  exit 1
fi
grep -Fq '.npmrc' "$test_root/staged-auth-rejected"
test ! -e "$destination"
rm -f "$source/.npmrc"
git -C "$source" add -u .npmrc
mkdir -p "$source/deploy/helm/templates"
printf 'apiVersion: v1\nkind: Secret\nstringData:\n  TOKEN: {{ .Values.token | quote }}\n' >"$source/deploy/helm/templates/secret.yaml"
mkdir -p "$source/.docker" "$source/.aws"
printf 'auth token\n' >"$source/.netrc"
printf '{}\n' >"$source/.docker/config.json"
printf 'access key\n' >"$source/.aws/credentials"
if FACTORY_ALLOW_DIRTY_SOURCE=true "$root/scripts/prepare-local-system-source.sh" "$source" "$destination" >"$test_root/auth-rejected" 2>&1; then
  exit 1
fi
grep -Fq '.netrc' "$test_root/auth-rejected"
grep -Fq '.docker/config.json' "$test_root/auth-rejected"
grep -Fq '.aws/credentials' "$test_root/auth-rejected"
rm -f "$source/.netrc" "$source/.docker/config.json" "$source/.aws/credentials"
rm -rf "$source/.docker" "$source/.aws"
FACTORY_ALLOW_DIRTY_SOURCE=true "$root/scripts/prepare-local-system-source.sh" "$source" "$destination" >/dev/null
test "$(git -C "$destination" config --local --get factory.prepared-source)" = true
test -z "$(git -C "$destination" status --porcelain)"
test "$(git -C "$destination" config --local --get factory.source-mode)" = dirty
test "$(git -C "$destination" config --local --get factory.repository-name)" = customer
grep -Fq 'local main edit' "$destination/apps/portal/src/main.tsx"
grep -Fq 'local health edit' "$destination/apps/api/src/index.ts"
test -f "$destination/.devcontainer/devcontainer.json"
test -f "$destination/.devcontainer/verification/devcontainer.json"
test -f "$destination/.vscode/tasks.json"
bun -e 'const tasks=(await Bun.file(process.argv[1]).json()).tasks; const byLabel=(label)=>tasks.find((task)=>task.label===label); if(byLabel("Dev: Process View")?.command!=="process-compose attach") process.exit(1); if(byLabel("Dev: Process View")?.runOptions) process.exit(1); if(byLabel("Dev: Live Logs")?.command!=="process-compose process logs --namespace dev --tail 200 --follow") process.exit(1); if(byLabel("Dev: Restart API")?.command!=="process-compose process restart api") process.exit(1); if(byLabel("Dev: Browser Apps")?.command!=="/workspace-state/ide/browser-apps") process.exit(1); if(JSON.stringify(byLabel("Dev: Processes")?.dependsOn)!==JSON.stringify(["Dev: Browser Apps","Dev: Process View"])) process.exit(1); if(byLabel("Dev: Processes")?.runOptions?.runOn!=="folderOpen") process.exit(1)' "$destination/.vscode/tasks.json"
test -f "$destination/process-compose.yaml"
test -f "$destination/deploy/helm/templates/secret.yaml"
grep -Fq 'version: 1' "$destination/.factory/system.yaml"
grep -Fq '**/.env' "$destination/.dockerignore"
test ! -e "$destination/.factory/dev.env"
test ! -e "$destination/.npmrc"
test ! -e "$destination/.env"
test ! -e "$destination/local-secret.txt"
test ! -e "$destination/node_modules"
test ! -e "$destination/apps/api/node_modules"
test ! -e "$destination/artifacts"
test ! -e "$destination/tmp"
test ! -e "$destination/.devcontainer/logs"
test "$(git -C "$destination" rev-list --count HEAD)" -eq 3
printf 'Prepared Customer source contract passed.\n'
