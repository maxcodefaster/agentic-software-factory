#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/workspace" "$tmp/state"
chmod 0777 "$tmp/workspace" "$tmp/state"

cp -R "$root/example/." "$tmp/workspace/"
docker run --rm \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  --cap-add CHOWN \
  --cap-add DAC_OVERRIDE \
  --cap-add FOWNER \
  --cap-add SETGID \
  --cap-add SETUID \
  -e ENVBUILDER_WORKSPACE_FOLDER=/workspaces/project \
  -e ENVBUILDER_DEVCONTAINER_DIR=.devcontainer \
  -e ENVBUILDER_DEVCONTAINER_JSON_PATH=devcontainer.json \
  -e ENVBUILDER_EXIT_ON_BUILD_FAILURE=true \
  -e ENVBUILDER_INIT_SCRIPT='test "$(id -u)" = 1000 && test "$(bun --version)" = 1.3.14 && test -x /usr/local/bin/process-compose' \
  -e FACTORY_STATE_DIR=/workspace-state \
  -v "$tmp/workspace:/workspaces/project" \
  -v "$tmp/state:/workspace-state" \
  ghcr.io/coder/envbuilder@sha256:b34ade2fb90a8536df76e7a15c6dd8c6352d0ae835a187b13467fa0c8a71e280

rm -rf "$tmp/state"/*
rm -rf "$tmp/workspace/node_modules" "$tmp/workspace/.env"
docker run --rm \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  --cap-add CHOWN \
  --cap-add DAC_OVERRIDE \
  --cap-add FOWNER \
  --cap-add SETGID \
  --cap-add SETUID \
  -e ENVBUILDER_WORKSPACE_FOLDER=/workspaces/project \
  -e ENVBUILDER_DEVCONTAINER_DIR=.devcontainer/verification \
  -e ENVBUILDER_DEVCONTAINER_JSON_PATH=devcontainer.json \
  -e ENVBUILDER_EXIT_ON_BUILD_FAILURE=true \
  -e ENVBUILDER_INIT_SCRIPT='test "$(id -u)" = 1000 && ! touch /workspaces/project/verification-write 2>/dev/null && attempts=0; until curl -fsS http://127.0.0.1:4173/api/health/ready >/dev/null; do attempts=$((attempts + 1)); test "$attempts" -lt 120; sleep 1; done; process-compose --address 127.0.0.1 --port 8080 --ordered-shutdown down' \
  -e FACTORY_STATE_DIR=/workspace-state \
  -v "$tmp/workspace:/workspaces/project:ro" \
  -v "$tmp/state:/workspace-state" \
  ghcr.io/coder/envbuilder@sha256:b34ade2fb90a8536df76e7a15c6dd8c6352d0ae835a187b13467fa0c8a71e280

printf '%s\n' 'Envbuilder runtime contract passed.'
