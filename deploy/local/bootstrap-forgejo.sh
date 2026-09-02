#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

mode=all
case "${1:-}" in
  '') ;;
  --configure-only) mode=configure ;;
  --publish-only) mode=publish ;;
  *) printf 'Usage: %s [--configure-only|--publish-only]\n' "$0" >&2; exit 2 ;;
esac

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
source=${FACTORY_SYSTEM_SOURCE:?FACTORY_SYSTEM_SOURCE is required}
system_owner=${FACTORY_SYSTEM_OWNER:-factory}
system_repository=${FACTORY_SYSTEM_REPOSITORY:-$(basename "$source")}
previous_system_commit=${FACTORY_PREVIOUS_SYSTEM_COMMIT:-}
namespace=factory-platform
deployment=forgejo
api=http://forgejo-factory.localhost/api/v1
runtime_secret=factory-runtime
auth_file=$(mktemp "${TMPDIR:-/tmp}/factory-forgejo-auth.XXXXXX")
payload=$(mktemp "${TMPDIR:-/tmp}/factory-forgejo-payload.XXXXXX")
chmod 600 "$auth_file" "$payload"
trap 'rm -f "$auth_file" "$payload"' EXIT HUP INT TERM

runtime_value() {
  key=$1
  encoded=$(kubectl get secret "$runtime_secret" -n "$namespace" -o json 2>/dev/null |
    jq -r --arg key "$key" '.data[$key] // ""' 2>/dev/null || true)
  [ -z "$encoded" ] || printf '%s' "$encoded" | base64 -d
}

store_runtime_value() {
  key=$1
  value=$2
  encoded=$(printf '%s' "$value" | base64 | tr -d '\r\n')
  jq -n --arg key "$key" --arg value "$encoded" '{data:{($key):$value}}' >"$payload"
  kubectl patch secret "$runtime_secret" -n "$namespace" --type merge --patch-file "$payload" >/dev/null
}

user_exists() {
  username=$1
  kubectl exec -n "$namespace" deployment/"$deployment" -- forgejo admin user list |
    grep -Eq "^[[:space:]]*[0-9]+[[:space:]]+$username[[:space:]]"
}

ensure_user() {
  username=$1
  shift
  user_exists "$username" && return
  kubectl exec -n "$namespace" deployment/"$deployment" -- forgejo admin user create \
    --username "$username" --random-password --random-password-length 32 --email "$username@example.test" \
    "$@" --must-change-password=false >/dev/null
}

token_valid() {
  token=$1
  username=$2
  [ -n "$token" ] || return 1
  curl --fail --silent --show-error -H "Authorization: token $token" "$api/user" 2>/dev/null |
    jq -e --arg username "$username" '.login == $username' >/dev/null
}

ensure_token() {
  key=$1
  username=$2
  scopes=$3
  token=$(runtime_value "$key")
  if ! token_valid "$token" "$username"; then
    token_name="factory-provision-$(date +%s)-$$-$username"
    token=$(kubectl exec -n "$namespace" deployment/"$deployment" -- forgejo admin user generate-access-token \
      --username "$username" --token-name "$token_name" --scopes "$scopes" --raw | tr -d '\r\n')
    store_runtime_value "$key" "$token"
  fi
  printf '%s' "$token"
}

api_status() {
  curl --config "$auth_file" --silent --show-error -o /dev/null -w '%{http_code}' "$@"
}

ensure_org() {
  status=$(api_status "$api/orgs/factory")
  case "$status" in
    200) return ;;
    404) ;;
    *) printf 'Forgejo organization probe returned HTTP %s.\n' "$status" >&2; exit 1 ;;
  esac
  status=$(api_status -H 'Content-Type: application/json' \
    -d '{"username":"factory","full_name":"Agentic Software Factory","visibility":"private"}' "$api/orgs")
  [ "$status" = 201 ] || { printf 'Forgejo organization create returned HTTP %s.\n' "$status" >&2; exit 1; }
}

ensure_repo() {
  name=$1
  description=$2
  status=$(api_status "$api/repos/factory/$name")
  case "$status" in
    200)
      repository=$(curl --config "$auth_file" --fail --silent --show-error "$api/repos/factory/$name")
      if ! printf '%s' "$repository" | jq -e '.private == true and .default_branch == "main"' >/dev/null; then
        jq -n --arg description "$description" '{description:$description,private:true,default_branch:"main"}' >"$payload"
        status=$(api_status -X PATCH -H 'Content-Type: application/json' --data-binary @"$payload" "$api/repos/factory/$name")
        [ "$status" = 200 ] || { printf 'Forgejo repository repair for %s returned HTTP %s.\n' "$name" "$status" >&2; exit 1; }
      fi
      return
      ;;
    404) ;;
    *) printf 'Forgejo repository probe for %s returned HTTP %s.\n' "$name" "$status" >&2; exit 1 ;;
  esac
  jq -n --arg name "$name" --arg description "$description" \
    '{name:$name,description:$description,private:true,auto_init:false,default_branch:"main"}' >"$payload"
  status=$(api_status -H 'Content-Type: application/json' --data-binary @"$payload" "$api/orgs/factory/repos")
  [ "$status" = 201 ] || { printf 'Forgejo repository create for %s returned HTTP %s.\n' "$name" "$status" >&2; exit 1; }
}

ensure_team() {
  name=$1
  teams=$(curl --config "$auth_file" --fail --silent --show-error "$api/orgs/factory/teams")
  team=$(printf '%s' "$teams" | jq -c --arg name "$name" 'first(.[] | select(.name == $name)) // empty')
  if [ -n "$team" ]; then
    team_id=$(printf '%s' "$team" | jq -r .id)
    if ! printf '%s' "$team" | jq -e '.permission == "read" and .includes_all_repositories == false and (["repo.code","repo.issues","repo.pulls"] - .units | length == 0)' >/dev/null; then
      jq -n --arg name "$name" '{name:$name,permission:"read",includes_all_repositories:false,units:["repo.code","repo.issues","repo.pulls"]}' >"$payload"
      status=$(api_status -X PATCH -H 'Content-Type: application/json' --data-binary @"$payload" "$api/teams/$team_id")
      [ "$status" = 200 ] || { printf 'Forgejo team repair for %s returned HTTP %s.\n' "$name" "$status" >&2; exit 1; }
    fi
    return
  fi
  jq -n --arg name "$name" '{name:$name,permission:"read",includes_all_repositories:false,units:["repo.code","repo.issues","repo.pulls"]}' >"$payload"
  status=$(api_status -H 'Content-Type: application/json' --data-binary @"$payload" "$api/orgs/factory/teams")
  [ "$status" = 201 ] || { printf 'Forgejo team create for %s returned HTTP %s.\n' "$name" "$status" >&2; exit 1; }
}

configure_forgejo() {
  kubectl wait --for=condition=Available deployment/"$deployment" -n "$namespace" --timeout=180s >/dev/null
  ensure_user factory-admin --admin
  ensure_user factory-implementation
  ensure_user factory-review
  ensure_user factory-clone

  admin_token=$(ensure_token forgejo-token factory-admin all)
  ensure_token forgejo-implementation-token factory-implementation all >/dev/null
  ensure_token forgejo-review-token factory-review write:repository,read:user >/dev/null
  ensure_token forgejo-clone-token factory-clone read:repository >/dev/null
  printf 'header = "Authorization: token %s"\n' "$admin_token" >"$auth_file"

  ensure_org
  [ "$system_owner" = factory ] || { printf 'Local Forgejo owner must be factory, got %s.\n' "$system_owner" >&2; exit 1; }
  ensure_repo "$system_repository" ''
  ensure_team factory-users
  status=$(api_status -X PUT -H 'Content-Type: application/json' -d '{"permission":"read"}' \
    "$api/repos/factory/$system_repository/collaborators/factory-clone")
  [ "$status" = 204 ] || { printf 'Forgejo collaborator update returned HTTP %s.\n' "$status" >&2; exit 1; }

  oauth=$(curl --config "$auth_file" --fail --silent --show-error "$api/user/applications/oauth2" |
    jq -c 'first(.[] | select(.name == "Coder Forgejo")) // empty')
  oauth_changed=false
  stored_client_id=$(kubectl get secret coder-forgejo-external-auth -n coder -o json 2>/dev/null | jq -r '.data["client-id"] // ""' | base64 -d 2>/dev/null || true)
  stored_client_secret=$(kubectl get secret coder-forgejo-external-auth -n coder -o json 2>/dev/null | jq -r '.data["client-secret"] // ""' | base64 -d 2>/dev/null || true)
  pending_coder_reconcile=$(kubectl get secret coder-forgejo-external-auth -n coder \
    -o go-template='{{index .metadata.annotations "factory.application/pending-coder-reconcile"}}' 2>/dev/null || true)
  if [ -z "$oauth" ]; then
    oauth=$(curl --config "$auth_file" --fail --silent --show-error -H 'Content-Type: application/json' \
      -d '{"name":"Coder Forgejo","confidential_client":true,"redirect_uris":["http://coder.localhost/external-auth/forgejo/callback"]}' \
      "$api/user/applications/oauth2")
    oauth_changed=true
  elif [ "$pending_coder_reconcile" = true ] ||
    ! printf '%s' "$oauth" | jq -e '.confidential_client == true and .redirect_uris == ["http://coder.localhost/external-auth/forgejo/callback"]' >/dev/null ||
    [ "$stored_client_id" != "$(printf '%s' "$oauth" | jq -r .client_id)" ] || [ -z "$stored_client_secret" ] || [ "$stored_client_secret" = bootstrap-pending ]; then
    # PATCH rotates the client secret. Mark it first so a crash forces another
    # rotation instead of leaving Coder with the previous secret.
    kubectl annotate secret coder-forgejo-external-auth -n coder factory.application/pending-coder-reconcile=true --overwrite >/dev/null
    pending_coder_reconcile=true
    oauth=$(curl --config "$auth_file" --fail --silent --show-error -X PATCH -H 'Content-Type: application/json' \
      -d '{"name":"Coder Forgejo","confidential_client":true,"redirect_uris":["http://coder.localhost/external-auth/forgejo/callback"]}' \
      "$api/user/applications/oauth2/$(printf '%s' "$oauth" | jq -r .id)")
    oauth_changed=true
  fi
  if [ "$oauth_changed" = true ]; then
    coder_client_id=$(printf '%s' "$oauth" | jq -er .client_id)
    coder_client_secret=$(printf '%s' "$oauth" | jq -er .client_secret)
    jq -n --arg client_id "$coder_client_id" --arg client_secret "$coder_client_secret" '
      {apiVersion:"v1",kind:"Secret",metadata:{name:"coder-forgejo-external-auth",namespace:"coder",annotations:{"factory.application/pending-coder-reconcile":"true"}},type:"Opaque",stringData:{"client-id":$client_id,"client-secret":$client_secret}}' >"$payload"
    kubectl apply -f "$payload" >/dev/null
    pending_coder_reconcile=true
  fi
  if [ "$pending_coder_reconcile" = true ] && kubectl get deployment coder -n coder >/dev/null 2>&1; then
    "$root/deploy/local/reconcile-secret-rollout.sh" coder >/dev/null
  fi

  [ "$oauth_changed" = true ] || printf '%s\n' 'Coder Forgejo OAuth client already matches; no restart needed.'
  printf 'Forgejo users and runtime access are reconciled.\n'
}

validate_sources() {
  missing=false
  for artifact in .factory/system.yaml; do
    if [ ! -f "$source/$artifact" ]; then
      printf 'FACTORY_SYSTEM_SOURCE is missing %s: %s\n' "$artifact" "$source" >&2
      missing=true
    fi
  done
  [ "$missing" = false ] || exit 1
}

case "$mode" in
  all|publish) validate_sources ;;
esac

publish_branch() {
  local_source=$1
  repository=$2
  label=$3
  local_commit=$(git -C "$local_source" rev-parse HEAD)
  remote_commit=$(GIT_CONFIG_COUNT=2 \
    GIT_CONFIG_KEY_0=http.sslVerify GIT_CONFIG_VALUE_0=false \
    GIT_CONFIG_KEY_1=http.extraHeader GIT_CONFIG_VALUE_1="Authorization: token $admin_token" \
    git ls-remote "$repository" refs/heads/main | cut -f1)
  if [ "$remote_commit" = "$local_commit" ]; then
    printf '%s source already matches its attested commit.\n' "$label"
    return
  fi
  if [ -n "$remote_commit" ]; then
    GIT_CONFIG_COUNT=2 \
      GIT_CONFIG_KEY_0=http.sslVerify GIT_CONFIG_VALUE_0=false \
      GIT_CONFIG_KEY_1=http.extraHeader GIT_CONFIG_VALUE_1="Authorization: token $admin_token" \
      git -C "$local_source" fetch -q "$repository" "refs/heads/main:refs/factory/remote-main"
    if [ "$(git -C "$local_source" rev-parse "$local_commit^{tree}")" = "$(git -C "$local_source" rev-parse "$remote_commit^{tree}")" ]; then
      printf '%s source already matches its desired tree at %s.\n' "$label" "$remote_commit"
      return
    fi
    if ! git -C "$local_source" merge-base "$local_commit" "$remote_commit" >/dev/null 2>&1; then
      if [ "$(git -C "$local_source" config --bool factory.prepared-source 2>/dev/null || true)" != true ]; then
        printf 'Refusing to replace unrelated %s history. Reset or unregister the local System first.\n' "$label" >&2
        exit 1
      fi
      tree=$(git -C "$local_source" rev-parse "$local_commit^{tree}")
      local_commit=$(printf 'Update managed System snapshot\n' | GIT_AUTHOR_NAME='Agentic Software Factory' GIT_AUTHOR_EMAIL='factory@example.invalid' \
        GIT_COMMITTER_NAME='Agentic Software Factory' GIT_COMMITTER_EMAIL='factory@example.invalid' \
        GIT_AUTHOR_DATE='2000-01-01T00:00:00Z' GIT_COMMITTER_DATE='2000-01-01T00:00:00Z' \
        git -C "$local_source" commit-tree "$tree" -p "$remote_commit")
      git -C "$local_source" update-ref refs/heads/main "$local_commit"
    fi
    if ! git -C "$local_source" merge-base --is-ancestor "$remote_commit" "$local_commit"; then
      tree=$(git -C "$local_source" rev-parse "$local_commit^{tree}")
      local_commit=$(printf 'Update managed System snapshot\n' | GIT_AUTHOR_NAME='Agentic Software Factory' GIT_AUTHOR_EMAIL='factory@example.invalid' \
        GIT_COMMITTER_NAME='Agentic Software Factory' GIT_COMMITTER_EMAIL='factory@example.invalid' \
        GIT_AUTHOR_DATE='2000-01-01T00:00:00Z' GIT_COMMITTER_DATE='2000-01-01T00:00:00Z' \
        git -C "$local_source" commit-tree "$tree" -p "$remote_commit")
      git -C "$local_source" update-ref refs/heads/main "$local_commit"
    fi
  fi
  GIT_CONFIG_COUNT=2 \
    GIT_CONFIG_KEY_0=http.sslVerify GIT_CONFIG_VALUE_0=false \
    GIT_CONFIG_KEY_1=http.extraHeader GIT_CONFIG_VALUE_1="Authorization: token $admin_token" \
    git -C "$local_source" push -q "$repository" HEAD:main
}

publish_sources() {
  admin_token=$(runtime_value forgejo-token)
  token_valid "$admin_token" factory-admin || {
    printf 'Forgejo admin token is missing or invalid. Run the configure phase first.\n' >&2
    exit 1
  }
  publish_branch "$source" "http://forgejo-factory.localhost/$system_owner/$system_repository.git" 'System repository'
  printf 'Attested source branches are published.\n'
}

case "$mode" in
  configure) configure_forgejo ;;
  publish) publish_sources ;;
  all) configure_forgejo; publish_sources ;;
esac
