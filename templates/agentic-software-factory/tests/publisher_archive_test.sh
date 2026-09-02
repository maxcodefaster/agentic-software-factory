#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

cat > "$tmp/coder" <<'SH'
#!/bin/sh
set -eu
printf '%s\n' "$*" > "$CAPTURE_ARGS"
tar -tf - > "$CAPTURE_FILES"
SH
chmod +x "$tmp/coder"

cat > "$tmp/kubectl" <<'SH'
#!/bin/sh
set -eu
case "$1" in
  get)
    case "$*" in
      *coder-tls*) printf 'dGVzdC1jYQ==' ;;
      *) printf '{"data":{"forgejo-clone-token":"Y2xvbmU="}}\n' ;;
    esac
    ;;
  apply) jq -c . >> "$CAPTURE_SECRETS" ;;
  *) exit 1 ;;
esac
SH
chmod +x "$tmp/kubectl"

PATH="$tmp:$PATH" \
CODER_URL=https://coder.example.test \
CODER_TOKEN=test-token \
FACTORY_REPOSITORY_ORIGIN=https://forgejo.example.test \
FACTORY_DEFAULT_REPOSITORY_URL=https://forgejo.example.test/factory/system.git \
FACTORY_DEFAULT_REPOSITORY_REF=1111111111111111111111111111111111111111 \
CAPTURE_ARGS="$tmp/args" \
CAPTURE_FILES="$tmp/files" \
CAPTURE_SECRETS="$tmp/secrets" \
"$root/scripts/push-coder-template.sh"

test "$(cat "$tmp/files")" = "main.tf
README.md
workspace-clone.sh"
grep -F -- '--variable envbuilder_image=ghcr.io/coder/envbuilder@sha256:b34ade2fb90a8536df76e7a15c6dd8c6352d0ae835a187b13467fa0c8a71e280' "$tmp/args" >/dev/null
grep -F -- '--variable clone_image=docker.io/alpine/git@sha256:c0280cf9572316299b08544065d3bf35db65043d5e3963982ec50647d2746e26' "$tmp/args" >/dev/null
grep -F -- '--variable coder_image=ghcr.io/coder/coder@sha256:92be096e4ad26bd6490a40d0c19d69a729290f439db6ebc1f7a03b292b4fadb9' "$tmp/args" >/dev/null
grep -F -- '--variable repository_origin=https://forgejo.example.test' "$tmp/args" >/dev/null
grep -F -- '--variable storage_class=' "$tmp/args" >/dev/null
grep -F -- '--variable source_volume_size=8Gi' "$tmp/args" >/dev/null
grep -F -- '--variable clone_git_secret=factory-forgejo-clone' "$tmp/args" >/dev/null
grep -F -- '--variable git_ca_secret=factory-ca' "$tmp/args" >/dev/null
grep -F -- '--variable envbuilder_cache_repo=' "$tmp/args" >/dev/null
grep -F -- '--variable verification_owner=factory-verification' "$tmp/args" >/dev/null
grep -F -- '--variable staging_owner=factory-stage' "$tmp/args" >/dev/null
grep -F -- '--variable restricted_app_sharing=authenticated' "$tmp/args" >/dev/null
grep -F -- '--variable default_repository_url=https://forgejo.example.test/factory/system.git' "$tmp/args" >/dev/null
grep -F -- '--variable default_repository_ref=1111111111111111111111111111111111111111' "$tmp/args" >/dev/null
jq -s -e 'any(.[]; .metadata.name == "factory-forgejo-clone" and .data.token == "Y2xvbmU=")' "$tmp/secrets" >/dev/null
! grep -F 'Y2xvbmU=' "$tmp/args" >/dev/null
