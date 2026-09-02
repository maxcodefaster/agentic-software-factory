#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

project=${FACTORY_PROJECT_DIR:-/source}
token_file=${FACTORY_GIT_TOKEN_FILE:-/factory-secrets/clone/token}
ca_file=${FACTORY_GIT_CA_FILE:-/factory-secrets/ca/ca.crt}
repository_origin=${FACTORY_REPOSITORY_ORIGIN:?FACTORY_REPOSITORY_ORIGIN is required}
askpass=$(mktemp)
cleanup() {
  rm -f "$askpass"
  unset GIT_ASKPASS GIT_SSL_CAINFO GIT_TERMINAL_PROMPT GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0
}
trap cleanup EXIT HUP INT TERM

test -r "$token_file"
test -r "$ca_file"
case "$FACTORY_REPOSITORY_REF" in *[!0-9a-f]*|'') exit 1;; esac
test "${#FACTORY_REPOSITORY_REF}" -eq 40
case "$FACTORY_REPOSITORY_URL" in
  https://*'@'*|https://*'?'*|https://*'#'*|https:///*|https://) exit 1 ;;
  https://*) ;;
  *) exit 1 ;;
esac
case "$FACTORY_REPOSITORY_URL" in "$repository_origin"/*) ;; *) exit 1 ;; esac

cat >"$askpass" <<'EOF'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' x-access-token ;;
  *Password*) exec cat "$FACTORY_GIT_TOKEN_FILE" ;;
  *) exit 1 ;;
esac
EOF
chmod 700 "$askpass"
export FACTORY_GIT_TOKEN_FILE="$token_file"
export GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0 GIT_SSL_CAINFO="$ca_file"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0="$project"

rm -rf "$project"/.[!.]* "$project"/..?* "$project"/*
git init -q "$project"
git -C "$project" remote add origin "$FACTORY_REPOSITORY_URL"
git -C "$project" fetch -q --no-tags --depth=1 origin "$FACTORY_REPOSITORY_REF"
test "$(git -C "$project" rev-parse FETCH_HEAD)" = "$FACTORY_REPOSITORY_REF"
git -C "$project" checkout -q --force --detach FETCH_HEAD
git -C "$project" reset -q --hard "$FACTORY_REPOSITORY_REF"
git -C "$project" clean -q -ffdx
test "$(git -C "$project" rev-parse HEAD)" = "$FACTORY_REPOSITORY_REF"
test -z "$(git -C "$project" status --porcelain)"
test -f "$FACTORY_DEVCONTAINER_PATH"
test -z "$(git -C "$project" config --local --get-regexp '^(credential\.|http\..*extraheader)' 2>/dev/null || true)"
test ! -e "$project/.git/factory-credential-cache"
