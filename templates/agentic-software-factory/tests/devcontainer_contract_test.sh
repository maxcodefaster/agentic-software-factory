#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

grep -F 'ghcr.io/coder/envbuilder@sha256:' "$root/main.tf" >/dev/null
grep -F 'ENVBUILDER_INIT_SCRIPT' "$root/main.tf" >/dev/null
grep -F 'ENVBUILDER_WORKSPACE_FOLDER' "$root/main.tf" >/dev/null
grep -F 'ENVBUILDER_EXIT_ON_BUILD_FAILURE' "$root/main.tf" >/dev/null
grep -F 'CODER_AGENT_BLOCK_FILE_TRANSFER' "$root/main.tf" >/dev/null
grep -F 'resource "coder_app" "url"' "$root/main.tf" >/dev/null
grep -F 'resource "coder_app" "command"' "$root/main.tf" >/dev/null
grep -F 'module "code-server"' "$root/main.tf" >/dev/null
grep -E 'automount_service_account_token[[:space:]]*=[[:space:]]*false' "$root/main.tf" >/dev/null
grep -F 'seccomp_profile' "$root/main.tf" >/dev/null
grep -F 'type = "RuntimeDefault"' "$root/main.tf" >/dev/null
grep -E 'privileged[[:space:]]*=[[:space:]]*false' "$root/main.tf" >/dev/null
grep -E 'allow_privilege_escalation[[:space:]]*=[[:space:]]*false' "$root/main.tf" >/dev/null

if grep -E 'pid=host|network=host|userns=host|hostPID|hostNetwork|docker\.sock|podman|coder_devcontainer|Unconfined|privileged[[:space:]]*=[[:space:]]*true' "$root/main.tf"; then
  exit 1
fi

printf '%s\n' 'Envbuilder template contract passed.'
