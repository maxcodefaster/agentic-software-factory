#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
image="factory-bff-runtime-smoke:$$"
cleanup() { docker image rm -f "$image" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM

platform="${FACTORY_DOCKER_SMOKE_PLATFORM:-linux/$(docker version --format '{{.Server.Arch}}')}"
docker build --platform "$platform" \
  --file "$root/apps/bff/Dockerfile" --tag "$image" "$root"
test "$(docker run --rm --platform "$platform" --entrypoint bun "$image" --version)" = "1.3.14"
test "$(docker run --rm --platform "$platform" --entrypoint git "$image" --version)" = "git version 2.49.1"
docker image inspect "$image" | jq -e \
  '.[0].Config.Entrypoint == null and .[0].Config.Cmd == ["bun", "dist/main.js"]' >/dev/null
printf '%s\n' 'BFF runtime container smoke passed.'
