#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

root=${FACTORY_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}
root=$(CDPATH= cd -- "$root" && pwd)
: "${FACTORY_REPOSITORY_ORIGIN:?FACTORY_REPOSITORY_ORIGIN is required}"
: "${FACTORY_DEFAULT_REPOSITORY_URL:?FACTORY_DEFAULT_REPOSITORY_URL is required}"
: "${FACTORY_DEFAULT_REPOSITORY_REF:?FACTORY_DEFAULT_REPOSITORY_REF is required}"
FACTORY_ROOT=$root
export FACTORY_ROOT
. "$root/deploy/local/coder-template-defaults.sh"

{
  for file in main.tf README.md workspace-clone.sh; do
    printf 'file=%s\n' "$file"
    shasum -a 256 "$root/templates/agentic-software-factory/$file" | cut -d ' ' -f 1
  done
  printf '%s\n' \
    "$FACTORY_REPOSITORY_ORIGIN" "$FACTORY_DEFAULT_REPOSITORY_URL" "$FACTORY_DEFAULT_REPOSITORY_REF" \
    "$FACTORY_ENVBUILDER_IMAGE" "$FACTORY_CLONE_IMAGE" "$FACTORY_CODER_IMAGE" \
    "$FACTORY_CODER_AGENT_URL" "$FACTORY_CODER_PUBLIC_URL" "$FACTORY_CODER_WILDCARD_ACCESS_URL" \
    "$FACTORY_WORKSPACE_STORAGE_CLASS" "$FACTORY_SOURCE_VOLUME_SIZE" "$FACTORY_CLONE_GIT_SECRET" \
    "$FACTORY_GIT_CA_SECRET" "$FACTORY_ENVBUILDER_CACHE_REPO" "$FACTORY_ENVBUILDER_CACHE_PULL_SECRET" \
    "$FACTORY_ENVBUILDER_CACHE_PUSH_SECRET" "$FACTORY_STAGING_POPULATES_CACHE" \
    "$FACTORY_CODER_VERIFICATION_OWNER" "$FACTORY_CODER_STAGING_OWNER"
} | shasum -a 256 | cut -c1-16
