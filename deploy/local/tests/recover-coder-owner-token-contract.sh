#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/factory-coder-owner.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir "$tmp/bin"

cat >"$tmp/bin/kubectl" <<'SH'
#!/bin/sh
set -eu
case "$*" in
  'config current-context') printf orbstack ;;
  *'jsonpath={.data.owner-email}'*) printf 'b3duZXJAZXhhbXBsZS50ZXN0' ;;
  *'jsonpath={.data.owner-username}'*) printf 'ZmFjdG9yeS1hZG1pbg==' ;;
  *'jsonpath={.data.owner-password}'*) printf 'Y29udHJhY3QtcGFzc3dvcmQ=' ;;
  'exec -n coder deployment/coder -- env '*'/opt/coder tokens create '*) printf 'runtime-token\n' ;;
  'patch secret factory-runtime -n factory-platform --type merge --patch-file '*)
    printf '%s\n' "$*" >>"$KUBECTL_LOG"
    for argument in "$@"; do patch_file=$argument; done
    cp "$patch_file" "$PATCH_COPY"
    ;;
  *) printf 'unexpected kubectl call: %s\n' "$*" >&2; exit 1 ;;
esac
SH
cat >"$tmp/bin/docker" <<'SH'
#!/bin/sh
exit 0
SH
cat >"$tmp/bin/curl" <<'SH'
#!/bin/sh
set -eu
output=
data=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output=$2; shift 2 ;;
    --write-out) shift 2 ;;
    --data-binary) data=${2#@}; shift 2 ;;
    -H) shift 2 ;;
    --fail|--silent|--show-error) shift ;;
    http*) url=$1; shift ;;
    *) printf 'unexpected curl argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done
printf '%s\n' "$url" >>"$CURL_LOG"
case "$url" in
  */healthz) exit 0 ;;
  */api/v2/users/first)
    if [ -z "$data" ]; then
      [ -n "$output" ] && : >"$output"
      [ "$SCENARIO" = clean ] && printf 404 || printf 200
    else
      jq -e '. == {email:"owner@example.test",username:"factory-admin",name:"factory-admin",password:"contract-password",trial:false}' "$data" >/dev/null
      cp "$data" "$FIRST_USER_COPY"
      printf '{}\n' >"$output"
      printf '%s' "${CREATE_STATUS:-201}"
    fi
    ;;
  */api/v2/users/login)
    jq -e '. == {email:"owner@example.test",password:"contract-password"}' "$data" >/dev/null
    printf '%s\n' '{"session_token":"session-token"}'
    ;;
  *) exit 1 ;;
esac
SH
chmod +x "$tmp/bin/kubectl" "$tmp/bin/docker" "$tmp/bin/curl"

run_case() {
  scenario=$1
  output=$tmp/$scenario-output
  : >"$tmp/$scenario-curl"
  : >"$tmp/$scenario-kubectl"
  SCENARIO=$scenario CURL_LOG="$tmp/$scenario-curl" KUBECTL_LOG="$tmp/$scenario-kubectl" \
    PATCH_COPY="$tmp/$scenario-patch" FIRST_USER_COPY="$tmp/$scenario-first-user" \
    PATH="$tmp/bin:$PATH" "$root/deploy/local/recover-coder-owner-token.sh" >"$output" 2>&1
  grep -Fq '/healthz' "$tmp/$scenario-curl"
  grep -Fq '/api/v2/users/first' "$tmp/$scenario-curl"
  grep -Fq '/api/v2/users/login' "$tmp/$scenario-curl"
  jq -e '.data["coder-token"] == "cnVudGltZS10b2tlbg=="' "$tmp/$scenario-patch" >/dev/null
  if grep -Eq 'contract-password|session-token|runtime-token' "$output" "$tmp/$scenario-curl" "$tmp/$scenario-kubectl"; then
    printf 'Coder recovery logged a secret.\n' >&2
    exit 1
  fi
}

run_case clean
test -s "$tmp/clean-first-user"
test "$(grep -Fc '/api/v2/users/first' "$tmp/clean-curl")" -eq 2
run_case existing
test ! -e "$tmp/existing-first-user"
test "$(grep -Fc '/api/v2/users/first' "$tmp/existing-curl")" -eq 1
if SCENARIO=clean CREATE_STATUS=200 CURL_LOG="$tmp/rejected-curl" KUBECTL_LOG="$tmp/rejected-kubectl" \
  PATCH_COPY="$tmp/rejected-patch" FIRST_USER_COPY="$tmp/rejected-first-user" PATH="$tmp/bin:$PATH" \
  "$root/deploy/local/recover-coder-owner-token.sh" >"$tmp/rejected-output" 2>&1; then
  exit 1
fi
grep -Fq 'returned HTTP 200; expected 201' "$tmp/rejected-output"
test ! -e "$tmp/rejected-patch"
if grep -Eq 'contract-password|session-token|runtime-token' "$tmp/rejected-output" "$tmp/rejected-curl"; then
  printf 'Coder first-user failure logged a secret.\n' >&2
  exit 1
fi
printf '%s\n' 'Coder owner bootstrap and token recovery contract passed.'
