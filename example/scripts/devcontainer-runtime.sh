#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

cli='bunx --bun @devcontainers/cli@0.88.0'
container_id=
workspace_folder=
result=$(mktemp)
runtime_config=
runtime_config_directory=
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ -n "$container_id" ]; then
    if [ "$status" -ne 0 ]; then
      docker exec --user vscode --workdir "$workspace_folder" \
        "$container_id" sh -lc 'cat .process-compose/process-compose.log 2>/dev/null || true' >&2 || true
    fi
    docker exec --user vscode --workdir "$workspace_folder" \
      "$container_id" process-compose --address 127.0.0.1 --port 8080 down \
      >/dev/null 2>&1 || true
    docker rm --force "$container_id" >/dev/null 2>&1 || true
  fi
  rm -f "$result"
  if [ -n "$runtime_config_directory" ]; then
    rm -rf "$runtime_config_directory"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

set --
if ! docker run --help 2>/dev/null | grep -q -- '--cgroups'; then
  runtime_config_directory=$(mktemp -d)
  runtime_config="$runtime_config_directory/devcontainer.json"
  bun -e '
    const config = await Bun.file(".devcontainer/devcontainer.json").json();
    config.build = {
      dockerfile: `${process.cwd()}/.devcontainer/Dockerfile`,
      context: process.cwd(),
    };
    await Bun.write(process.argv[1], `${JSON.stringify(config)}\n`);
  ' "$runtime_config"
  set -- --config "$runtime_config"
fi

if ! $cli up "$@" --workspace-folder . --remove-existing-container >"$result"; then
  container_id=$(docker ps -aq \
    --filter "label=devcontainer.local_folder=$(pwd)" | sed -n '1p')
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

docker exec --user vscode --workdir "$workspace_folder" "$container_id" sh -lc '
  set -eu
  test "$(bun --version)" = 1.3.14
  test -x /usr/local/bin/process-compose
  attempts=0
  until health=$(curl --fail --silent http://127.0.0.1:4173/api/health/ready) &&
    case "$health" in *database*ok*) true ;; *) false ;; esac
  do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 120 ] || exit 1
    sleep 1
  done
  migration_count=$(psql "$DATABASE_URL" -Atc "select count(*) from drizzle.__drizzle_migrations")
  [ "$migration_count" -ge 1 ]
  bun -e '\''
    await fetch("http://127.0.0.1:4173/src/styles.css");
    const timeout = setTimeout(() => {
      console.error("Timed out waiting for a Vite HMR update");
      process.exit(1);
    }, 15_000);
    const path = "src/styles.css";
    const original = await Bun.file(path).text();
    const socket = new WebSocket("ws://127.0.0.1:4173/", "vite-hmr");
    socket.addEventListener("open", () => Bun.write(path, `${original}\n/* hmr-test */\n`));
    socket.addEventListener("message", async (event) => {
      if (!String(event.data).includes("update")) return;
      clearTimeout(timeout);
      await Bun.write(path, original);
      socket.close();
      process.exit(0);
    });
  '\''
'

printf '%s\n' 'Dev Container runtime and HMR checks passed.'
