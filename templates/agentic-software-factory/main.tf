# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

terraform {
  required_version = ">= 1.9"

  required_providers {
    coder = {
      source  = "coder/coder"
      version = "2.18.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "2.38.0"
    }
  }
}

provider "coder" {
  url = var.coder_agent_url
}
provider "kubernetes" {}

variable "envbuilder_image" {
  type        = string
  description = "Pinned multi-architecture Coder envbuilder image."
  default     = "ghcr.io/coder/envbuilder@sha256:b34ade2fb90a8536df76e7a15c6dd8c6352d0ae835a187b13467fa0c8a71e280"

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.envbuilder_image))
    error_message = "envbuilder_image must use a sha256 digest."
  }
}

variable "clone_image" {
  type        = string
  description = "Pinned multi-architecture image used only for the exact-SHA clone."
  default     = "docker.io/alpine/git@sha256:c0280cf9572316299b08544065d3bf35db65043d5e3963982ec50647d2746e26"

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.clone_image))
    error_message = "clone_image must use a sha256 digest."
  }
}

variable "coder_image" {
  type        = string
  description = "Pinned multi-architecture Coder image used by token-only restricted-workspace agent sidecars."
  default     = "ghcr.io/coder/coder@sha256:92be096e4ad26bd6490a40d0c19d69a729290f439db6ebc1f7a03b292b4fadb9"

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.coder_image))
    error_message = "coder_image must use a sha256 digest."
  }
}

variable "coder_agent_url" {
  type        = string
  description = "In-cluster URL used only by workspace agents."
  default     = "http://coder.coder.svc.cluster.local"
}

variable "coder_public_url" {
  type        = string
  description = "Public HTTPS URL exposed to workspace applications and users."
  default     = "https://coder.example.invalid"
}

variable "coder_wildcard_access_url" {
  type        = string
  description = "Public wildcard origin pattern used for Coder workspace applications."
  default     = "https://*.apps.coder.example.invalid"

  validation {
    condition     = can(regex("^https?://\\*\\.[^/?#]+$", var.coder_wildcard_access_url))
    error_message = "coder_wildcard_access_url must be an HTTP(S) wildcard origin."
  }
}

variable "repository_origin" {
  type        = string
  description = "Only repository URLs below this HTTPS origin receive the clone credential."
  default     = "https://forgejo.invalid"

  validation {
    condition     = can(regex("^https://[^/?#]+(?::[0-9]+)?$", var.repository_origin))
    error_message = "repository_origin must be an HTTPS origin without credentials, path, query, or fragment."
  }
}

variable "storage_class" {
  type        = string
  description = "StorageClass for workspace home volumes. Empty uses the cluster default."
  default     = ""
}

variable "source_volume_size" {
  type        = string
  description = "Ephemeral source volume limit for each workspace."
  default     = "8Gi"
}

variable "clone_git_secret" {
  type        = string
  description = "Workspace-namespace Secret containing a read-only, clone-only Forgejo token under the token key."
  default     = "factory-forgejo-clone"
}

variable "git_ca_secret" {
  type        = string
  description = "Workspace-namespace Secret containing the Forgejo CA under the ca.crt key."
  default     = "factory-ca"
}

variable "envbuilder_cache_repo" {
  type        = string
  description = "Optional OCI repository for cross-workspace Envbuilder layer caching."
  default     = ""
}

variable "envbuilder_cache_pull_secret" {
  type        = string
  description = "Optional pull-only registry Secret containing Envbuilder-ready base64 under config-base64."
  default     = ""
}

variable "envbuilder_cache_push_secret" {
  type        = string
  description = "Optional push-capable registry Secret containing Envbuilder-ready base64 under config-base64."
  default     = ""
}

variable "staging_populates_cache" {
  type        = bool
  description = "Allow only the configured non-login staging owner to publish shared cache layers."
  default     = false
}

variable "verification_owner" {
  type        = string
  description = "Coder username allowed to own verification workspaces."
  default     = "factory-verification"

  validation {
    condition     = trimspace(var.verification_owner) != ""
    error_message = "verification_owner must not be empty."
  }
}

variable "staging_owner" {
  type        = string
  description = "Coder username allowed to own staging workspaces."
  default     = "factory-stage"

  validation {
    condition     = trimspace(var.staging_owner) != ""
    error_message = "staging_owner must not be empty."
  }
}

variable "default_repository_url" {
  type        = string
  description = "Repository used to validate the template during publication."
  default     = "https://forgejo.invalid/factory/template-verification.git"
}

variable "default_repository_ref" {
  type        = string
  description = "Exact commit used to validate the template during publication."
  default     = "0000000000000000000000000000000000000000"
}

data "coder_parameter" "repository_url" {
  type         = "string"
  name         = "repository_url"
  display_name = "Repository URL"
  description  = "Git repository containing the Dev Container configuration."
  mutable      = false
  order        = 1
  default      = var.default_repository_url

  validation {
    regex = "^https://[^/?#]+(?::[0-9]+)?/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\\.git$"
    error = "repository_url must be an HTTPS repository URL without credentials, query, or fragment."
  }
}

data "coder_parameter" "repository_ref" {
  type         = "string"
  name         = "repository_ref"
  display_name = "Repository commit"
  description  = "Exact lowercase 40-character commit SHA checked out on every start."
  mutable      = true
  order        = 2
  default      = var.default_repository_ref

  validation {
    regex = "^[0-9a-f]{40}$"
    error = "repository_ref must be an exact lowercase 40-character commit SHA."
  }
}

data "coder_parameter" "workspace_kind" {
  type         = "string"
  name         = "workspace_kind"
  display_name = "Workspace kind"
  description  = "Developer, staging, or verification repository policy."
  default      = "developer"
  mutable      = false
  order        = 3

  option {
    name  = "Developer"
    value = "developer"
  }
  option {
    name  = "Staging"
    value = "staging"
  }
  option {
    name  = "Verification"
    value = "verification"
  }
}

data "coder_parameter" "workspace_namespace" {
  type         = "string"
  name         = "workspace_namespace"
  display_name = "Workspace namespace"
  description  = "Existing Kubernetes namespace for this workspace."
  default      = "factory-workspaces"
  mutable      = false
  order        = 4

  validation {
    regex = "^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$"
    error = "workspace_namespace must be a DNS-safe Kubernetes namespace."
  }
}

data "coder_parameter" "repository_apps" {
  type         = "string"
  name         = "repository_apps"
  display_name = "Repository applications"
  description  = "Canonical Coder application metadata validated at the requested commit."
  default      = "[]"
  mutable      = true
  order        = 5
}

data "coder_parameter" "devcontainer_path" {
  type         = "string"
  name         = "devcontainer_path"
  display_name = "Dev Container path"
  description  = "Repository-relative Dev Container file validated by Agentic Software Factory at the requested commit."
  default      = ".devcontainer/devcontainer.json"
  mutable      = true
  order        = 6

  validation {
    regex = "^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$"
    error = "devcontainer_path must be a clean repository-relative path."
  }
}

data "coder_parameter" "supervisor_shutdown" {
  type         = "string"
  name         = "supervisor_shutdown"
  display_name = "Supervisor shutdown command"
  description  = "Validated repository command used during graceful workspace shutdown."
  default      = "true"
  mutable      = true
  order        = 7
}

data "coder_parameter" "supervisor_commands" {
  type         = "string"
  name         = "supervisor_commands"
  display_name = "Supervisor commands"
  description  = "Canonical lifecycle commands validated from .factory/system.yaml."
  default      = "{}"
  mutable      = true
  order        = 8
}

data "coder_parameter" "startup_timeout_seconds" {
  type         = "number"
  name         = "startup_timeout_seconds"
  display_name = "Startup timeout"
  description  = "Validated maximum seconds for repository applications to become ready."
  default      = 120
  mutable      = true
  order        = 9

  validation {
    min = 10
    max = 600
  }
}

data "coder_parameter" "contract_version" {
  type         = "number"
  name         = "contract_version"
  display_name = "Repository contract version"
  description  = "Agentic Software Factory repository contract version validated at the requested commit."
  default      = 1
  mutable      = true
  order        = 10
}

data "coder_parameter" "tenant_id" {
  type         = "string"
  name         = "tenant_id"
  display_name = "Agentic Software Factory tenant"
  description  = "Immutable tenant identity used for workspace ownership labels."
  default      = "factory"
  mutable      = false
  order        = 11

  validation {
    regex = "^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$"
    error = "tenant_id must be a DNS-safe tenant identifier."
  }
}

data "coder_provisioner" "me" {}
data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}
data "coder_external_auth" "forgejo" {
  id       = "forgejo"
  optional = true
}

locals {
  name                = "coder-${lower(data.coder_workspace.me.id)}"
  project_dir         = "/workspaces/project"
  verification        = data.coder_parameter.workspace_kind.value == "verification"
  staging             = data.coder_parameter.workspace_kind.value == "staging"
  restricted          = local.verification || local.staging
  devcontainer_parts  = split("/", data.coder_parameter.devcontainer_path.value)
  devcontainer_path   = local.devcontainer_parts[length(local.devcontainer_parts) - 1]
  devcontainer_dir    = join("/", slice(local.devcontainer_parts, 0, length(local.devcontainer_parts) - 1))
  repository_apps     = try(jsondecode(data.coder_parameter.repository_apps.value), [])
  repository_app_map  = { for app in local.repository_apps : app.slug => app }
  supervisor_commands = data.coder_parameter.supervisor_commands.value == "" ? {} : try(jsondecode(data.coder_parameter.supervisor_commands.value), {})
  running_apps        = { for slug, app in local.repository_app_map : slug => app if data.coder_workspace.me.start_count == 1 }
  url_apps            = { for slug, app in local.running_apps : slug => app if try(app.url, null) != null }
  command_apps        = { for slug, app in local.running_apps : slug => app if try(app.command, null) != null }
  app_base_env = {
    for slug, app in local.url_apps : "FACTORY_${upper(replace(slug, "-", "_"))}_BASE" => "/"
  }
  coder_app_origins = {
    for slug, app in local.url_apps : slug => replace(
      var.coder_wildcard_access_url,
      "*",
      "${slug}--${data.coder_workspace.me.name}--${data.coder_workspace_owner.me.name}"
    )
  }
  coder_app_links     = [for slug, app in local.url_apps : "${try(app.displayName, slug)}: ${local.coder_app_origins[slug]}"]
  coder_app_link_args = join(" ", [for link in local.coder_app_links : jsonencode(link)])
  developer_ide_settings = {
    "breadcrumbs.enabled"                                              = false
    "chat.disableAIFeatures"                                           = true
    "chat.mcp.access"                                                  = "none"
    "editor.minimap.enabled"                                           = false
    "extensions.ignoreRecommendations"                                 = true
    "git.openRepositoryInParentFolders"                                = "never"
    "security.workspace.trust.enabled"                                 = false
    "task.allowAutomaticTasks"                                         = "on"
    "telemetry.telemetryLevel"                                         = "off"
    "terminal.integrated.cwd"                                          = local.project_dir
    "workbench.secondarySideBar.defaultVisibility"                     = "hidden"
    "workbench.secondarySideBar.enableDefaultVisibilityInOldWorkspace" = true
    "workbench.startupEditor"                                          = "none"
    "workbench.tips.enabled"                                           = false
    "workbench.welcomePage.walkthroughs.openOnInstall"                 = false
  }
  developer_process_command = try(local.supervisor_commands.attach, local.supervisor_commands.logs, local.supervisor_commands.status, "true")
  developer_ide_tasks = {
    version = "2.0.0"
    tasks = concat([
      {
        label          = "Dev: Process View"
        type           = "shell"
        command        = local.developer_process_command
        options        = { cwd = "$${workspaceFolder}" }
        isBackground   = can(local.supervisor_commands.status) || can(local.supervisor_commands.attach) || can(local.supervisor_commands.logs)
        problemMatcher = []
        presentation   = { reveal = "always", panel = "dedicated", focus = false, showReuseMessage = false, clear = true, close = false }
      }
      ], can(local.supervisor_commands.status) ? [{
        label   = "Dev: Status", type = "shell", command = local.supervisor_commands.status,
        options = { cwd = "$${workspaceFolder}" }, problemMatcher = []
        }] : [], can(local.supervisor_commands.logs) ? [{
        label        = "Dev: Live Logs", type = "shell", command = local.supervisor_commands.logs,
        options      = { cwd = "$${workspaceFolder}" }, isBackground = true, problemMatcher = [],
        presentation = { reveal = "always", panel = "dedicated", focus = false }
        }] : [], can(local.supervisor_commands.restart) ? [{
        label   = "Dev: Restart", type = "shell", command = local.supervisor_commands.restart,
        options = { cwd = "$${workspaceFolder}" }, problemMatcher = []
        }] : [], can(local.supervisor_commands.shutdown) ? [{
        label   = "Dev: Stop", type = "shell", command = local.supervisor_commands.shutdown,
        options = { cwd = "$${workspaceFolder}" }, problemMatcher = []
        }] : [], length(local.coder_app_origins) > 0 ? [{
        label        = "Dev: Browser Apps", type = "shell", command = "/workspace-state/ide/browser-apps",
        options      = { cwd = "$${workspaceFolder}" }, problemMatcher = [],
        presentation = { reveal = "always", panel = "dedicated", focus = false, showReuseMessage = false, clear = true, close = false }
        }] : [], [{
        label      = "Dev: Processes", dependsOrder = "sequence",
        dependsOn  = length(local.coder_app_origins) > 0 ? ["Dev: Browser Apps", "Dev: Process View"] : ["Dev: Process View"],
        runOptions = { runOn = "folderOpen" }, problemMatcher = []
    }])
  }
  repository_url     = data.coder_parameter.repository_url.value
  developer_ide_args = "--disable-workspace-trust --disable-update-check"
  toolchain_key      = substr(sha256(var.envbuilder_image), 0, 16)
  cache_key          = "v${data.coder_parameter.contract_version.value}-${data.coder_provisioner.me.arch}-${local.toolchain_key}-${data.coder_parameter.repository_ref.value}"
  registry_cache     = var.envbuilder_cache_repo != ""
  cache_populator    = local.staging && var.staging_populates_cache
  cache_auth_secret  = local.cache_populator ? var.envbuilder_cache_push_secret : var.envbuilder_cache_pull_secret
  labels = {
    "app.kubernetes.io/name"       = "agentic-software-factory-workspace"
    "app.kubernetes.io/managed-by" = "coder"
    "coder.com/workspace-id"       = data.coder_workspace.me.id
    "coder.com/user-id"            = data.coder_workspace_owner.me.id
    "factory.application/tenant"   = data.coder_parameter.tenant_id.value
  }
}

resource "coder_agent" "main" {
  arch                    = data.coder_provisioner.me.arch
  os                      = "linux"
  api_key_scope           = local.restricted ? "no_user_data" : "all"
  startup_script_behavior = "blocking"
  startup_script          = local.restricted ? "true" : <<-EOT
    set -eu
    test "$(git -c safe.directory=${local.project_dir} -C ${local.project_dir} rev-parse HEAD)" = "${data.coder_parameter.repository_ref.value}"
    mkdir -p /workspace-state/envbuilder /workspace-state/package-cache /workspace-state/cache
    mkdir -p /workspace-state/ide "${local.project_dir}/.vscode"
    cat >/workspace-state/ide/browser-apps <<'APPS'
    #!/bin/sh
    printf '%s\n' 'Browser apps:' ${local.coder_app_link_args}
    printf '\n%s\n' 'Live logs: Tasks > Run Task > Dev: Live Logs'
    APPS
    chmod 755 /workspace-state/ide/browser-apps
    printf '%s' '${base64encode(jsonencode(local.developer_ide_tasks))}' | base64 -d > /workspace-state/ide/tasks.json.tmp
    mv /workspace-state/ide/tasks.json.tmp /workspace-state/ide/tasks.json
    if [ ! -e "${local.project_dir}/.vscode/tasks.json" ]; then
      ln -s /workspace-state/ide/tasks.json "${local.project_dir}/.vscode/tasks.json"
      grep -qxF '/.vscode/tasks.json' "${local.project_dir}/.git/info/exclude" 2>/dev/null || printf '%s\n' '/.vscode/tasks.json' >> "${local.project_dir}/.git/info/exclude"
    fi
    for cache in /workspace-state/envbuilder/*; do
      test "$cache" = "/workspace-state/envbuilder/${local.cache_key}" || rm -rf -- "$cache"
    done
    helper="$HOME/.factory-git-credential"
    umask 077
    cat >"$helper" <<'HELPER'
    #!/bin/sh
    test "$1" = get || exit 0
    protocol=
    host=
    while IFS='=' read -r key value; do
      case "$key" in
        protocol) protocol=$value ;;
        host) host=$value ;;
      esac
    done
    test "$protocol://$host" = "${var.repository_origin}" || exit 0
    printf 'username=oauth2\npassword=%s\n' "$FACTORY_GIT_TOKEN"
    HELPER
    chmod 700 "$helper"
    git config --global --unset-all credential.helper 2>/dev/null || true
    git config --global "credential.${var.repository_origin}.helper" "$helper"
  EOT
  shutdown_script         = local.restricted ? "true" : "cd ${local.project_dir} && ${data.coder_parameter.supervisor_shutdown.value}"

  env = merge({
    CODER_AGENT_DEVCONTAINERS_ENABLE = "false"
    CODER_URL                        = var.coder_public_url
    GIT_CONFIG_COUNT                 = "1"
    GIT_CONFIG_KEY_0                 = "safe.directory"
    GIT_CONFIG_VALUE_0               = local.project_dir
    FACTORY_REPOSITORY_REF           = data.coder_parameter.repository_ref.value
    FACTORY_WORKSPACE_KIND           = data.coder_parameter.workspace_kind.value
    FACTORY_WORKSPACE_NAMESPACE      = data.coder_parameter.workspace_namespace.value
    }, local.restricted ? {} : {
    FACTORY_GIT_TOKEN = data.coder_external_auth.forgejo.access_token
  })

  display_apps {
    vscode                 = false
    vscode_insiders        = false
    web_terminal           = false
    ssh_helper             = false
    port_forwarding_helper = false
  }

  lifecycle {
    precondition {
      condition     = contains(["developer", "staging", "verification"], data.coder_parameter.workspace_kind.value)
      error_message = "workspace_kind must be developer, staging, or verification."
    }
    precondition {
      condition     = !local.verification || data.coder_workspace_owner.me.name == var.verification_owner
      error_message = "Verification workspaces must belong to the configured verification owner."
    }
    precondition {
      condition     = !local.staging || data.coder_workspace_owner.me.name == var.staging_owner
      error_message = "Staging workspaces must belong to the configured staging owner."
    }
    precondition {
      condition     = startswith(local.repository_url, "${var.repository_origin}/")
      error_message = "repository_url must use the configured repository_origin."
    }
    precondition {
      condition     = !local.registry_cache || local.cache_auth_secret != ""
      error_message = "Registry caching requires the pull secret, or the push secret for a staging cache populator."
    }
    precondition {
      condition     = can(tolist([for app in jsondecode(data.coder_parameter.repository_apps.value) : app.slug])) && length(local.repository_apps) == length(local.repository_app_map)
      error_message = "repository_apps must be a JSON array with unique application slugs."
    }
    precondition {
      condition     = data.coder_parameter.supervisor_commands.value == "" || can(keys(jsondecode(data.coder_parameter.supervisor_commands.value)))
      error_message = "supervisor_commands must be a JSON object."
    }
    precondition {
      condition = local.verification ? alltrue([
        for app in local.repository_apps : try(app.url, null) != null && try(app.command, null) == null && try(app.share, "") == "authenticated"
        ]) : local.staging ? alltrue([
        for app in local.repository_apps : (try(app.url, null) != null) != (try(app.command, null) != null)
      ]) : length([for app in local.repository_apps : app if try(app.command, null) != null]) <= 1
      error_message = "Verification workspaces permit authenticated URL apps only; staging apps must define exactly one URL or command; developer workspaces permit at most one command app."
    }
  }
}

resource "coder_app" "url" {
  for_each = local.url_apps

  agent_id     = coder_agent.main.id
  slug         = each.key
  display_name = try(each.value.displayName, each.key)
  url          = each.value.url
  icon         = try(each.value.icon, null)
  open_in      = try(each.value.openIn, null)
  group        = try(each.value.group, null)
  order        = try(each.value.order, null)
  subdomain    = true
  share        = local.restricted ? "authenticated" : "owner"

  dynamic "healthcheck" {
    for_each = try(each.value.healthCheck, null) == null ? [] : [each.value.healthCheck]
    content {
      url       = healthcheck.value.url
      interval  = healthcheck.value.interval
      threshold = healthcheck.value.threshold
    }
  }
}

resource "coder_app" "command" {
  for_each = local.restricted ? {} : local.command_apps

  agent_id     = coder_agent.main.id
  slug         = each.key
  display_name = try(each.value.displayName, each.key)
  command      = each.value.command
  icon         = try(each.value.icon, null)
  group        = try(each.value.group, null)
  order        = try(each.value.order, null)
  share        = "owner"
}

module "code-server" {
  count  = !local.restricted && data.coder_workspace.me.start_count == 1 ? 1 : 0
  source = "registry.coder.com/coder/code-server/coder"

  version         = "1.5.2"
  agent_id        = coder_agent.main.id
  folder          = local.project_dir
  install_version = "4.106.3"
  additional_args = local.developer_ide_args
  settings        = local.developer_ide_settings
  display_name    = "Browser IDE"
  slug            = "code-server"
  subdomain       = true
  share           = "owner"
  open_in         = "tab"
  order           = 1
}

output "developer_ide_workspace_trust_disabled" {
  value = !local.restricted && strcontains(local.developer_ide_args, "--disable-workspace-trust")
}

resource "kubernetes_persistent_volume_claim_v1" "state" {
  metadata {
    name      = "${local.name}-state"
    namespace = data.coder_parameter.workspace_namespace.value
    labels    = local.labels
  }
  wait_until_bound = false
  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = var.storage_class == "" ? null : var.storage_class
    resources {
      requests = { storage = "10Gi" }
    }
  }
}

resource "kubernetes_deployment_v1" "workspace" {
  count            = data.coder_workspace.me.start_count
  wait_for_rollout = false

  metadata {
    name      = local.name
    namespace = data.coder_parameter.workspace_namespace.value
    labels    = local.labels
  }

  spec {
    replicas = 1
    selector { match_labels = local.labels }
    strategy { type = "Recreate" }

    template {
      metadata { labels = local.labels }
      spec {
        automount_service_account_token  = false
        enable_service_links             = false
        termination_grace_period_seconds = 90
        security_context {
          fs_group = 1000
          seccomp_profile { type = "RuntimeDefault" }
        }

        init_container {
          name              = "clone-source"
          image             = var.clone_image
          image_pull_policy = "IfNotPresent"
          command           = ["sh", "-c", file("${path.module}/workspace-clone.sh")]
          dynamic "env" {
            for_each = {
              FACTORY_PROJECT_DIR       = local.project_dir
              FACTORY_REPOSITORY_REF    = data.coder_parameter.repository_ref.value
              FACTORY_REPOSITORY_URL    = data.coder_parameter.repository_url.value
              FACTORY_REPOSITORY_ORIGIN = var.repository_origin
              FACTORY_WORKSPACE_KIND    = data.coder_parameter.workspace_kind.value
              FACTORY_DEVCONTAINER_PATH = "${local.project_dir}/${local.devcontainer_dir}/${local.devcontainer_path}"
            }
            content {
              name  = env.key
              value = env.value
            }
          }
          security_context {
            run_as_non_root            = true
            allow_privilege_escalation = false
            run_as_user                = 1000
            run_as_group               = 1000
            capabilities { drop = ["ALL"] }
          }
          resources {
            requests = { cpu = "50m", memory = "64Mi", ephemeral-storage = "64Mi" }
            limits   = { cpu = "500m", memory = "512Mi", ephemeral-storage = "1Gi" }
          }
          volume_mount {
            name       = "source"
            mount_path = local.project_dir
          }
          volume_mount {
            name       = "clone-credential"
            mount_path = "/factory-secrets/clone"
            read_only  = true
          }
          volume_mount {
            name       = "git-ca"
            mount_path = "/factory-secrets/ca"
            read_only  = true
          }
        }

        container {
          name              = "workspace"
          image             = var.envbuilder_image
          image_pull_policy = "IfNotPresent"
          dynamic "env" {
            for_each = merge(local.restricted ? {} : {
              CODER_AGENT_TOKEN                = coder_agent.main.token
              CODER_AGENT_URL                  = var.coder_agent_url
              CODER_AGENT_SUBSYSTEM            = "envbuilder"
              CODER_AGENT_DEVCONTAINERS_ENABLE = "false"
              GIT_SSL_CAINFO                   = "/factory-secrets/ca/ca.crt"
              }, {
              CODER_URL                         = var.coder_public_url
              GIT_CONFIG_COUNT                  = "1"
              GIT_CONFIG_KEY_0                  = "safe.directory"
              GIT_CONFIG_VALUE_0                = local.project_dir
              ENVBUILDER_INIT_SCRIPT            = local.restricted ? "sleep infinity" : coder_agent.main.init_script
              ENVBUILDER_WORKSPACE_FOLDER       = local.project_dir
              ENVBUILDER_DEVCONTAINER_DIR       = local.devcontainer_dir
              ENVBUILDER_DEVCONTAINER_JSON_PATH = local.devcontainer_path
              ENVBUILDER_EXIT_ON_BUILD_FAILURE  = "true"
              ENVBUILDER_IGNORE_PATHS           = "/factory-secrets,/product_uuid,/product_name,/workspace-state"
              ENVBUILDER_LAYER_CACHE_DIR        = "/workspace-state/envbuilder/${local.cache_key}"
              BUN_INSTALL_CACHE_DIR             = "/workspace-state/package-cache/bun"
              npm_config_cache                  = "/workspace-state/package-cache/npm"
              XDG_CACHE_HOME                    = "/workspace-state/cache"
              FACTORY_REPOSITORY_REF            = data.coder_parameter.repository_ref.value
              FACTORY_WORKSPACE_KIND            = data.coder_parameter.workspace_kind.value
              FACTORY_STATE_DIR                 = "/workspace-state"
              }, local.app_base_env, local.registry_cache ? {
              ENVBUILDER_CACHE_REPO = "${var.envbuilder_cache_repo}/${local.cache_key}"
              } : {}, local.registry_cache && local.cache_populator ? {
              ENVBUILDER_PUSH_IMAGE = "1"
            } : {})
            content {
              name  = env.key
              value = env.value
            }
          }
          dynamic "env" {
            for_each = local.registry_cache ? [1] : []
            content {
              name = "ENVBUILDER_DOCKER_CONFIG_BASE64"
              value_from {
                secret_key_ref {
                  name = local.cache_auth_secret
                  key  = "config-base64"
                }
              }
            }
          }
          resources {
            requests = { cpu = "250m", memory = "512Mi", ephemeral-storage = "1Gi" }
            limits   = { cpu = "4", memory = "8Gi", ephemeral-storage = var.source_volume_size }
          }
          security_context {
            run_as_user                = 0
            run_as_non_root            = false
            privileged                 = false
            allow_privilege_escalation = false
            seccomp_profile { type = "RuntimeDefault" }
            capabilities {
              drop = ["ALL"]
              add  = ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"]
            }
          }
          dynamic "lifecycle" {
            for_each = local.restricted ? [1] : []
            content {
              pre_stop {
                exec { command = ["sh", "-c", "cd ${local.project_dir} && ${data.coder_parameter.supervisor_shutdown.value}"] }
              }
            }
          }
          volume_mount {
            name       = "state"
            mount_path = "/workspace-state"
          }
          volume_mount {
            name       = "source"
            mount_path = local.project_dir
            read_only  = local.verification
          }
          dynamic "volume_mount" {
            for_each = local.verification ? [] : [1]
            content {
              name       = "git-ca"
              mount_path = "/factory-secrets/ca"
              read_only  = true
            }
          }
        }

        dynamic "container" {
          for_each = local.restricted ? [1] : []
          content {
            name              = "agent"
            image             = var.coder_image
            image_pull_policy = "IfNotPresent"
            command           = ["/opt/coder", "agent"]
            dynamic "env" {
              for_each = {
                CODER_AGENT_TOKEN                         = coder_agent.main.token
                CODER_AGENT_URL                           = var.coder_agent_url
                CODER_AGENT_BLOCK_FILE_TRANSFER           = "true"
                CODER_AGENT_BLOCK_LOCAL_PORT_FORWARDING   = "true"
                CODER_AGENT_BLOCK_REVERSE_PORT_FORWARDING = "true"
                CODER_AGENT_DEVCONTAINERS_ENABLE          = "false"
              }
              content {
                name  = env.key
                value = env.value
              }
            }
            resources {
              requests = { cpu = "50m", memory = "64Mi" }
              limits   = { cpu = "500m", memory = "512Mi" }
            }
            security_context {
              run_as_non_root            = true
              run_as_user                = 1000
              run_as_group               = 1000
              privileged                 = false
              allow_privilege_escalation = false
              seccomp_profile { type = "RuntimeDefault" }
              capabilities { drop = ["ALL"] }
            }
          }
        }

        volume {
          name = "state"
          persistent_volume_claim { claim_name = kubernetes_persistent_volume_claim_v1.state.metadata[0].name }
        }
        volume {
          name = "source"
          empty_dir { size_limit = var.source_volume_size }
        }
        volume {
          name = "clone-credential"
          secret {
            secret_name  = var.clone_git_secret
            default_mode = "0440"
            items {
              key  = "token"
              path = "token"
            }
          }
        }
        volume {
          name = "git-ca"
          secret {
            secret_name  = var.git_ca_secret
            default_mode = "0444"
            items {
              key  = "ca.crt"
              path = "ca.crt"
            }
          }
        }
      }
    }
  }
}
