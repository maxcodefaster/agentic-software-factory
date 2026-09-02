#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

cli='bunx --bun @devcontainers/cli@0.88.0'
container_id=
workspace_folder=
result=$(mktemp)
runtime_config_directory=$(mktemp -d)
runtime_config="$runtime_config_directory/devcontainer.json"
init_source="$runtime_config_directory/init-source"
trusted_source="$runtime_config_directory/trusted-source"
secret_marker="example-verification-secret-$(date +%s)-$$"
secret_file=untracked-verification-secret.txt
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ -n "$container_id" ]; then
    if [ "$status" -ne 0 ]; then
      docker exec --user vscode "$container_id" sh -lc \
        'cat "$PROCESS_COMPOSE_LOG_DIRECTORY/process-compose.log" 2>/dev/null || true; cat "$PROCESS_COMPOSE_LOG_DIRECTORY/services.log" 2>/dev/null || true' >&2 || true
    fi
    docker exec --user vscode --workdir "$workspace_folder" \
      "$container_id" process-compose --address 127.0.0.1 --port 8080 --ordered-shutdown down \
      >/dev/null 2>&1 || true
    docker rm --force "$container_id" >/dev/null 2>&1 || true
  fi
  rm -f "$result"
  rm -rf "$runtime_config_directory"
  exit "$status"
}
trap cleanup EXIT INT TERM

mkdir -p "$init_source"
git ls-files -co --exclude-standard | while IFS= read -r path; do
  [ ! -f "$path" ] || {
    mkdir -p "$init_source/$(dirname "$path")"
    cp "$path" "$init_source/$path"
  }
done
git -C "$init_source" init -q
git -C "$init_source" config user.name contract
git -C "$init_source" config user.email contract@example.invalid
git -C "$init_source" add --all
git -C "$init_source" commit -q -m 'Trusted verification source'
source_sha=$(git -C "$init_source" rev-parse HEAD)
printf 'VITE_VERIFICATION_SECRET=%s\nPORT=1\n' "$secret_marker" >"$init_source/.env"
printf '%s\n' "$secret_marker" >"$init_source/$secret_file"
test -f "$init_source/.env"
test -f "$init_source/$secret_file"
git clone -q --local --no-hardlinks "$init_source" "$trusted_source"
test "$(git -C "$trusted_source" rev-parse HEAD)" = "$source_sha"
test ! -e "$trusted_source/.env"
test ! -e "$trusted_source/$secret_file"

bun -e '
  const config = await Bun.file(".devcontainer/verification/devcontainer.json").json();
  config.build = {
    dockerfile: `${process.argv[2]}/.devcontainer/Dockerfile`,
    context: process.argv[2],
    args: { DEVCONTAINER_STAGE: "verification" },
  };
  await Bun.write(process.argv[1], `${JSON.stringify(config)}\n`);
  ' "$runtime_config" "$trusted_source"

if ! $cli up --config "$runtime_config" --workspace-folder "$trusted_source" --remove-existing-container >"$result"; then
  container_id=$(docker ps -aq --filter "label=devcontainer.local_folder=$trusted_source" | sed -n '1p')
  exit 1
fi
runtime=$(bun -e '
  const lines = (await Bun.file(process.argv[1]).text()).trim().split("\n");
  const result = JSON.parse(lines.at(-1) || "{}");
  if (!result.containerId) throw new Error("Dev Container did not return a container ID");
  process.stdout.write(`${result.containerId} ${result.remoteWorkspaceFolder}`);
' "$result")
set -- $runtime
container_id=$1
workspace_folder=$2

docker exec --user vscode --workdir "$workspace_folder" \
  --env EXPECTED_SOURCE_SHA="$source_sha" --env SECRET_MARKER="$secret_marker" \
  --env SECRET_FILE="$secret_file" "$container_id" sh -lc '
  set -eu
  test "$(git rev-parse HEAD)" = "$EXPECTED_SOURCE_SHA"
  test -z "$(git status --porcelain)"
  test "$PWD" = /workspaces/project
  test ! -e .env
  test ! -e "$SECRET_FILE"
  test -x /opt/factory-verification/node_modules/.bin/vite
  test -f /opt/factory-verification/project/.devcontainer/process-compose.yaml
  if touch /opt/factory-verification/project/verification-write-probe 2>/dev/null; then exit 1; fi
  ! command -v code-server >/dev/null 2>&1
  attempts=0
  until curl --fail --silent http://127.0.0.1:4173/api/health/ready >/dev/null; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 120 ] || exit 1
    sleep 1
  done
  curl --fail --silent http://127.0.0.1:4173/api/config | grep -q 'verificationMode.*true'
  curl --fail --silent http://127.0.0.1:4173/api/work-items | grep -q 'Review the release candidate'
  output=$(curl --fail --silent http://127.0.0.1:4173/; \
    curl --fail --silent http://127.0.0.1:4173/api/config; \
    curl --fail --silent http://127.0.0.1:4173/api/work-items)
  ! printf "%s" "$output" | grep -F "$SECRET_MARKER" >/dev/null
  set +e
  grep -r -F "$SECRET_MARKER" "$PROCESS_COMPOSE_LOG_DIRECTORY" /workspaces/project /opt/factory-verification \
    >/dev/null 2>&1
  marker_status=$?
  set -e
  test "$marker_status" -eq 1
  test "$(curl --silent --output /dev/null --write-out "%{http_code}" \
    --header "content-type: application/json" --data "{\"title\":\"No write\"}" \
    http://127.0.0.1:4173/api/work-items)" = 405
  if touch .verification-write-probe 2>/dev/null; then
    rm -f .verification-write-probe
    exit 1
  fi
'

image=$(docker inspect --format '{{.Image}}' "$container_id")
docker run --rm --entrypoint sh \
  --env SECRET_MARKER="$secret_marker" --env SECRET_FILE="$secret_file" "$image" -c '
  set -eu
  test ! -e /workspaces/.env
  test ! -e "/workspaces/$SECRET_FILE"
  test ! -e "/workspaces/project/$SECRET_FILE"
  set +e
  grep -r -F "$SECRET_MARKER" /workspaces /home/vscode /opt/factory-verification >/dev/null 2>&1
  marker_status=$?
  set -e
  test "$marker_status" -eq 1
'
test -z "$(git -C "$trusted_source" status --porcelain)"

printf '%s\n' 'Starter verification Dev Container lifecycle checks passed.'
