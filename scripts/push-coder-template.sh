#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

: "${CODER_URL:?CODER_URL is required}"
: "${CODER_TOKEN:?CODER_TOKEN is required}"

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FACTORY_ROOT=$root
export FACTORY_ROOT
. "$root/deploy/local/coder-template-defaults.sh"
: "${FACTORY_REPOSITORY_ORIGIN:?FACTORY_REPOSITORY_ORIGIN is required}"
: "${FACTORY_DEFAULT_REPOSITORY_URL:?FACTORY_DEFAULT_REPOSITORY_URL is required}"
: "${FACTORY_DEFAULT_REPOSITORY_REF:?FACTORY_DEFAULT_REPOSITORY_REF is required}"
repository_origin=$FACTORY_REPOSITORY_ORIGIN
default_repository_url=$FACTORY_DEFAULT_REPOSITORY_URL
archive=$(mktemp)
cleanup() {
  rm -f "$archive"
}
trap cleanup EXIT HUP INT TERM
COPYFILE_DISABLE=1 tar -cf "$archive" \
  -C "$root/templates/agentic-software-factory" main.tf README.md workspace-clone.sh

set -- templates push agentic-software-factory --directory - --yes \
    --message "${FACTORY_TEMPLATE_MESSAGE:-Factory template reconciliation}" \
    --variable envbuilder_image="${FACTORY_ENVBUILDER_IMAGE:-ghcr.io/coder/envbuilder@sha256:$CODER_ENVBUILDER_DIGEST}" \
    --variable clone_image="${FACTORY_CLONE_IMAGE:-docker.io/alpine/git@sha256:c0280cf9572316299b08544065d3bf35db65043d5e3963982ec50647d2746e26}" \
    --variable coder_image="${FACTORY_CODER_IMAGE:-ghcr.io/coder/coder@sha256:$CODER_SERVER_DIGEST}" \
    --variable coder_agent_url="${FACTORY_CODER_AGENT_URL:-http://coder.coder.svc.cluster.local}" \
    --variable coder_public_url="${FACTORY_CODER_PUBLIC_URL:-http://coder.localhost}" \
    --variable coder_wildcard_access_url="${FACTORY_CODER_WILDCARD_ACCESS_URL:-http://*.apps.coder.localhost}" \
    --variable repository_origin="$repository_origin" \
    --variable storage_class="${FACTORY_WORKSPACE_STORAGE_CLASS:-}" \
    --variable source_volume_size="${FACTORY_SOURCE_VOLUME_SIZE:-8Gi}" \
    --variable clone_git_secret="${FACTORY_CLONE_GIT_SECRET:-factory-forgejo-clone}" \
    --variable git_ca_secret="${FACTORY_GIT_CA_SECRET:-factory-ca}" \
    --variable envbuilder_cache_repo="${FACTORY_ENVBUILDER_CACHE_REPO:-}" \
    --variable envbuilder_cache_pull_secret="${FACTORY_ENVBUILDER_CACHE_PULL_SECRET:-}" \
    --variable envbuilder_cache_push_secret="${FACTORY_ENVBUILDER_CACHE_PUSH_SECRET:-}" \
    --variable staging_populates_cache="${FACTORY_STAGING_POPULATES_CACHE:-false}" \
    --variable verification_owner="${FACTORY_CODER_VERIFICATION_OWNER:-factory-verification}" \
    --variable staging_owner="${FACTORY_CODER_STAGING_OWNER:-factory-stage}" \
    --variable default_repository_url="$default_repository_url" \
    --variable default_repository_ref="$FACTORY_DEFAULT_REPOSITORY_REF"

if [ "${FACTORY_TEMPLATE_PUSH_DRY_RUN:-false}" = true ]; then
  printf 'template=agentic-software-factory\nenvbuilder_image=%s\nclone_image=%s\ncoder_image=%s\nrepository_origin=%s\nstorage_class=%s\nclone_git_secret=%s\ngit_ca_secret=%s\nverification_owner=%s\nstaging_owner=%s\n' \
    "${FACTORY_ENVBUILDER_IMAGE:-ghcr.io/coder/envbuilder@sha256:$CODER_ENVBUILDER_DIGEST}" \
    "${FACTORY_CLONE_IMAGE:-docker.io/alpine/git@sha256:c0280cf9572316299b08544065d3bf35db65043d5e3963982ec50647d2746e26}" \
    "${FACTORY_CODER_IMAGE:-ghcr.io/coder/coder@sha256:$CODER_SERVER_DIGEST}" \
    "$FACTORY_REPOSITORY_ORIGIN" \
    "${FACTORY_WORKSPACE_STORAGE_CLASS:-}" \
    "${FACTORY_CLONE_GIT_SECRET:-factory-forgejo-clone}" \
    "${FACTORY_GIT_CA_SECRET:-factory-ca}" \
    "${FACTORY_CODER_VERIFICATION_OWNER:-factory-verification}" \
    "${FACTORY_CODER_STAGING_OWNER:-factory-stage}"
  exit
fi

source_namespace=${FACTORY_RUNTIME_NAMESPACE:-factory-platform}
target_namespace=${FACTORY_WORKSPACE_NAMESPACE:-factory-workspaces}
kubectl get secret "${FACTORY_RUNTIME_SECRET:-factory-runtime}" -n "$source_namespace" -o json |
  jq -e --arg namespace "$target_namespace" \
    --arg clone "${FACTORY_CLONE_GIT_SECRET:-factory-forgejo-clone}" '
      .data["forgejo-clone-token"] as $clone_token |
      if ($clone_token | type) != "string" then error("Forgejo clone token is missing") else
        {apiVersion:"v1",kind:"Secret",metadata:{name:$clone,namespace:$namespace},type:"Opaque",data:{token:$clone_token}}
      end' |
  kubectl apply -f - >/dev/null
if [ "$CODER_URL" = http://127.0.0.1:8080 ]; then
  kubectl exec -i -n coder deployment/coder -- env CODER_URL="$CODER_URL" CODER_SESSION_TOKEN="$CODER_TOKEN" \
    /opt/coder "$@" < "$archive"
  exit
fi
if command -v coder >/dev/null 2>&1; then
  CODER_SESSION_TOKEN="$CODER_TOKEN" coder "$@" < "$archive"
  exit
fi

CODER_SESSION_TOKEN="$CODER_TOKEN" docker run --rm -i --entrypoint /opt/coder \
  -e CODER_URL="$CODER_URL" -e CODER_SESSION_TOKEN \
  "ghcr.io/coder/coder:$CODER_SERVER_VERSION" "$@" < "$archive"
