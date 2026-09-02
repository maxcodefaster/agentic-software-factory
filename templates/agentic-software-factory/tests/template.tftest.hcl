# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

mock_provider "coder" {
  mock_data "coder_parameter" { defaults = { value = "" } }
  mock_data "coder_provisioner" { defaults = { arch = "arm64" } }
  mock_data "coder_workspace" {
    defaults = {
      id          = "workspace-id"
      name        = "workspace"
      start_count = 1
      access_url  = "https://coder.example.test"
    }
  }
  mock_data "coder_workspace_owner" {
    defaults = {
      id   = "owner-id"
      name = "owner"
    }
  }
}

mock_provider "kubernetes" {}

run "developer_workspace" {
  command = plan

  override_data {
    target = data.coder_parameter.repository_url
    values = { value = "https://forgejo.invalid/factory/app.git" }
  }
  override_data {
    target = data.coder_parameter.repository_ref
    values = { value = "0123456789abcdef0123456789abcdef01234567" }
  }
  override_data {
    target = data.coder_parameter.workspace_kind
    values = { value = "developer" }
  }
  override_data {
    target = data.coder_parameter.workspace_namespace
    values = { value = "tenant-workspaces" }
  }
  override_data {
    target = data.coder_parameter.repository_apps
    values = { value = "[{\"slug\":\"app\",\"displayName\":\"App\",\"url\":\"http://127.0.0.1:3000\",\"share\":\"authenticated\",\"subdomain\":true},{\"slug\":\"api\",\"displayName\":\"API\",\"url\":\"http://localhost:8080\",\"share\":\"authenticated\",\"subdomain\":true}]" }
  }
  override_data {
    target = data.coder_parameter.supervisor_commands
    values = { value = "{\"status\":\"./dev status\",\"attach\":\"./dev watch\",\"logs\":\"./dev logs\",\"restart\":\"./dev restart\",\"shutdown\":\"./dev stop\"}" }
  }
  override_data {
    target = data.coder_workspace.me
    values = { id = "workspace-id", name = "main-4d6ace5a8c68b6b6db78", start_count = 1, access_url = "https://coder.example.test" }
  }

  assert {
    condition     = length(kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].init_container) == 1 && length(kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container) == 1
    error_message = "A workspace must contain one exact-SHA init container and one envbuilder runtime."
  }
  assert {
    condition     = strcontains(kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].init_container[0].command[2], "fetch -q --no-tags --depth=1 origin \"$FACTORY_REPOSITORY_REF\"") && strcontains(kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].init_container[0].command[2], "FACTORY_REPOSITORY_ORIGIN")
    error_message = "The init container must verify the exact commit and repository origin."
  }
  assert {
    condition     = kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].image == "ghcr.io/coder/envbuilder@sha256:b34ade2fb90a8536df76e7a15c6dd8c6352d0ae835a187b13467fa0c8a71e280"
    error_message = "The runtime must use the pinned envbuilder image."
  }
  assert {
    condition     = kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].resources[0].limits["ephemeral-storage"] == var.source_volume_size
    error_message = "The runtime ephemeral-storage limit must match the source volume so normal dependency installs are not evicted at the init-container limit."
  }
  assert {
    condition     = one([for item in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].env : item.value if item.name == "ENVBUILDER_IGNORE_PATHS"]) == "/factory-secrets,/product_uuid,/product_name,/workspace-state" && !contains([for volume in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].volume : volume.name], "runtime")
    error_message = "Envbuilder must preserve image-owned /var/run and ignore only Factory's dedicated secret directory."
  }
  assert {
    condition     = !one(coder_agent.main.display_apps).web_terminal && coder_agent.main.api_key_scope == "all" && length(module.code-server) == 1 && output.developer_ide_workspace_trust_disabled
    error_message = "Developer workspaces must expose the browser IDE while Coder's separate Web Terminal stays disabled."
  }
  assert {
    condition     = data.coder_external_auth.forgejo.optional && contains(keys(coder_agent.main.env), "FACTORY_GIT_TOKEN")
    error_message = "Developer workspaces must require the user's Forgejo connection and provide only that user token to Git."
  }
  assert {
    condition     = coder_agent.main.env["GIT_CONFIG_KEY_0"] == "safe.directory" && coder_agent.main.env["GIT_CONFIG_VALUE_0"] == "/workspaces/project"
    error_message = "Every developer process must trust only the exact workspace repository path."
  }
  assert {
    condition     = startswith(coder_agent.main.shutdown_script, "cd /workspaces/project && ")
    error_message = "Repository shutdown commands must run from the workspace root."
  }
  assert {
    condition     = local.developer_ide_tasks.tasks[0].label == "Dev: Process View" && local.developer_ide_tasks.tasks[0].command == "./dev watch" && !can(local.developer_ide_tasks.tasks[0].runOptions)
    error_message = "The interactive supervisor must remain the default process view without starting independently."
  }
  assert {
    condition     = one([for task in local.developer_ide_tasks.tasks : task.command == "./dev logs" if task.label == "Dev: Live Logs"])
    error_message = "The generated tasks must retain a clearly named live-log follower."
  }
  assert {
    condition     = one([for task in local.developer_ide_tasks.tasks : task.command == "/workspace-state/ide/browser-apps" if task.label == "Dev: Browser Apps"])
    error_message = "The generated tasks must expose the public Coder URLs through the browser-app helper."
  }
  assert {
    condition     = one([for task in local.developer_ide_tasks.tasks : jsonencode(task.dependsOn) == jsonencode(["Dev: Browser Apps", "Dev: Process View"]) && task.runOptions.runOn == "folderOpen" if task.label == "Dev: Processes"])
    error_message = "Folder open must print browser URLs before starting the interactive process view."
  }
  assert {
    condition     = strcontains(coder_agent.main.startup_script, base64encode(jsonencode(local.developer_ide_tasks))) && strcontains(coder_agent.main.startup_script, "ln -s /workspace-state/ide/tasks.json") && strcontains(coder_agent.main.startup_script, "Live logs: Tasks > Run Task > Dev: Live Logs")
    error_message = "Workspace startup must install the tasks and discoverability helper."
  }
  assert {
    condition = (!local.developer_ide_settings["editor.minimap.enabled"]
      && local.developer_ide_settings["chat.disableAIFeatures"]
      && local.developer_ide_settings["chat.mcp.access"] == "none"
      && local.developer_ide_settings["workbench.startupEditor"] == "none"
      && local.developer_ide_settings["workbench.secondarySideBar.defaultVisibility"] == "hidden"
      && local.developer_ide_settings["workbench.secondarySideBar.enableDefaultVisibilityInOldWorkspace"]
    && local.developer_ide_settings["task.allowAutomaticTasks"] == "on")
    error_message = "The browser IDE must apply the minimal Factory defaults."
  }
  assert {
    condition     = !contains([for item in one(kubernetes_deployment_v1.workspace).spec[0].template[0].spec[0].container[0].env : item.name], "ENVBUILDER_PUSH_IMAGE")
    error_message = "Developer workspaces must never publish shared Envbuilder cache layers."
  }
  assert {
    condition     = !contains([for volume in one(kubernetes_deployment_v1.workspace).spec[0].template[0].spec[0].volume : volume.name], "envbuilder-registry-auth")
    error_message = "Registry credentials must not remain mounted in the repository runtime."
  }
  assert {
    condition     = coder_app.url["app"].share == "owner" && coder_app.url["app"].url == "http://127.0.0.1:3000"
    error_message = "Developer repository apps must be owner-only."
  }
  assert {
    condition     = alltrue([for app in coder_app.url : app.subdomain])
    error_message = "Every browser application must use Coder wildcard subdomain routing."
  }
}

run "ticket_workspace" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = { id = "workspace-id", name = "ticket-fixed", start_count = 1, access_url = "https://coder.example.test" }
  }
  override_data {
    target = data.coder_parameter.repository_url
    values = { value = "https://forgejo.invalid/factory/app.git" }
  }
  override_data {
    target = data.coder_parameter.repository_ref
    values = { value = "0123456789abcdef0123456789abcdef01234567" }
  }
  override_data {
    target = data.coder_parameter.workspace_kind
    values = { value = "developer" }
  }
  override_data {
    target = data.coder_parameter.workspace_namespace
    values = { value = "tenant-workspaces" }
  }
  override_data {
    target = data.coder_parameter.repository_apps
    values = { value = "[{\"slug\":\"app\",\"displayName\":\"App\",\"url\":\"http://127.0.0.1:3000\",\"share\":\"authenticated\",\"subdomain\":true}]" }
  }

  assert {
    condition     = coder_app.url["app"].share == "owner"
    error_message = "Developer applications must remain owner-only regardless of workspace name."
  }
}

run "staging_workspace" {
  command = plan

  override_data {
    target = data.coder_workspace_owner.me
    values = { id = "staging-owner-id", name = "factory-stage" }
  }
  override_data {
    target = data.coder_parameter.repository_url
    values = { value = "https://forgejo.invalid/factory/app.git" }
  }
  override_data {
    target = data.coder_parameter.repository_ref
    values = { value = "0123456789abcdef0123456789abcdef01234567" }
  }
  override_data {
    target = data.coder_parameter.workspace_kind
    values = { value = "staging" }
  }
  override_data {
    target = data.coder_parameter.workspace_namespace
    values = { value = "tenant-workspaces" }
  }
  override_data {
    target = data.coder_parameter.repository_apps
    values = { value = "[{\"slug\":\"app\",\"displayName\":\"App\",\"url\":\"http://127.0.0.1:3000\",\"share\":\"owner\",\"subdomain\":true}]" }
  }
  override_data {
    target = data.coder_parameter.devcontainer_path
    values = { value = ".devcontainer/devcontainer.json" }
  }
  override_data {
    target = data.coder_parameter.supervisor_shutdown
    values = { value = "./dev stop" }
  }

  assert {
    condition     = length(kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container) == 2 && !one([for mount in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].volume_mount : mount.read_only if mount.name == "source"]) && one([for item in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].env : item.value if item.name == "ENVBUILDER_DEVCONTAINER_DIR"]) == ".devcontainer" && one([for item in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].env : item.value if item.name == "ENVBUILDER_INIT_SCRIPT"]) == "sleep infinity" && one([for item in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].init_container[0].env : item.value if item.name == "FACTORY_REPOSITORY_REF"]) == "0123456789abcdef0123456789abcdef01234567"
    error_message = "Staging must run the writable developer Dev Container lifecycle with a sidecar agent."
  }
  assert {
    condition     = length([for item in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].env : item if item.name == "CODER_AGENT_TOKEN"]) == 0 && one([for container in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container : container if container.name == "agent"]).name == "agent" && length(one([for container in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container : container.volume_mount if container.name == "agent"])) == 0
    error_message = "Staging application containers must have no Coder token; only the mountless sidecar may receive it."
  }
  assert {
    condition     = !one(coder_agent.main.display_apps).web_terminal && !one(coder_agent.main.display_apps).ssh_helper && !one(coder_agent.main.display_apps).port_forwarding_helper && coder_agent.main.api_key_scope == "no_user_data" && length(module.code-server) == 0
    error_message = "Staging must expose no terminal, SSH, port forwarding, external auth, or IDE."
  }
  assert {
    condition     = data.coder_external_auth.forgejo.optional && !contains(keys(coder_agent.main.env), "FACTORY_GIT_TOKEN")
    error_message = "Staging must not receive a human Forgejo token."
  }
  assert {
    condition     = coder_app.url["app"].share == "authenticated"
    error_message = "Staging must force URL apps to authenticated."
  }
  assert {
    condition     = coder_agent.main.env["CODER_AGENT_DEVCONTAINERS_ENABLE"] == "false" && one([for container in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container : one([for item in container.env : item.value if item.name == "CODER_AGENT_DEVCONTAINERS_ENABLE"]) if container.name == "agent"]) == "false"
    error_message = "Every staging agent must disable Dev Container discovery."
  }
  assert {
    condition     = coder_agent.main.shutdown_script == "true"
    error_message = "The mountless restricted agent must not execute the repository shutdown command."
  }
  assert {
    condition     = one(one([for container in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container : container.lifecycle if container.name == "workspace"])).pre_stop[0].exec[0].command == tolist(["sh", "-c", "cd /workspaces/project && ./dev stop"])
    error_message = "Restricted shutdown must run from the project directory once in the source-mounted runtime."
  }
}

run "staging_requires_configured_owner" {
  command = plan

  override_data {
    target = data.coder_workspace_owner.me
    values = { id = "developer-owner-id", name = "developer" }
  }
  override_data {
    target = data.coder_parameter.repository_url
    values = { value = "https://forgejo.invalid/factory/app.git" }
  }
  override_data {
    target = data.coder_parameter.repository_ref
    values = { value = "0123456789abcdef0123456789abcdef01234567" }
  }
  override_data {
    target = data.coder_parameter.workspace_kind
    values = { value = "staging" }
  }
  override_data {
    target = data.coder_parameter.workspace_namespace
    values = { value = "tenant-workspaces" }
  }
  override_data {
    target = data.coder_parameter.repository_apps
    values = { value = "[{\"slug\":\"app\",\"url\":\"http://127.0.0.1:3000\"}]" }
  }

  expect_failures = [coder_agent.main]
}

run "staging_supports_non_web_system" {
  command = plan

  override_data {
    target = data.coder_workspace_owner.me
    values = { id = "staging-owner-id", name = "factory-stage" }
  }
  override_data {
    target = data.coder_parameter.repository_url
    values = { value = "https://forgejo.invalid/factory/app.git" }
  }
  override_data {
    target = data.coder_parameter.repository_ref
    values = { value = "0123456789abcdef0123456789abcdef01234567" }
  }
  override_data {
    target = data.coder_parameter.workspace_kind
    values = { value = "staging" }
  }
  override_data {
    target = data.coder_parameter.workspace_namespace
    values = { value = "tenant-workspaces" }
  }
  override_data {
    target = data.coder_parameter.repository_apps
    values = { value = "[]" }
  }

  assert {
    condition     = length(coder_app.url) == 0 && length(kubernetes_deployment_v1.workspace) == 1
    error_message = "A non-web System must run without synthetic Coder applications."
  }
}

run "verification_workspace" {
  command = plan

  override_data {
    target = data.coder_workspace_owner.me
    values = { id = "verification-owner-id", name = "factory-verification" }
  }
  override_data {
    target = data.coder_parameter.repository_url
    values = { value = "https://forgejo.invalid/factory/app.git" }
  }
  override_data {
    target = data.coder_parameter.repository_ref
    values = { value = "0123456789abcdef0123456789abcdef01234567" }
  }
  override_data {
    target = data.coder_parameter.workspace_kind
    values = { value = "verification" }
  }
  override_data {
    target = data.coder_parameter.workspace_namespace
    values = { value = "tenant-workspaces" }
  }
  override_data {
    target = data.coder_parameter.repository_apps
    values = { value = "[{\"slug\":\"app\",\"displayName\":\"App\",\"url\":\"http://127.0.0.1:3000\",\"share\":\"authenticated\"}]" }
  }
  override_data {
    target = data.coder_parameter.devcontainer_path
    values = { value = ".devcontainer/verification/devcontainer.json" }
  }
  assert {
    condition     = length(kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container) == 2 && one([for mount in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].volume_mount : mount.read_only if mount.name == "source"]) && one([for item in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].env : item.value if item.name == "ENVBUILDER_DEVCONTAINER_DIR"]) == ".devcontainer/verification"
    error_message = "Verification workspaces must use the verification config with read-only source."
  }
  assert {
    condition     = length([for item in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].env : item if item.name == "CODER_AGENT_TOKEN"]) == 0 && one([for container in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container : container if container.name == "agent"]).name == "agent" && length(one([for container in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container : container.volume_mount if container.name == "agent"])) == 0
    error_message = "Verification source must run without a Coder token; only the mountless sidecar may receive it."
  }
  assert {
    condition     = !one(coder_agent.main.display_apps).web_terminal && coder_agent.main.api_key_scope == "no_user_data" && length(module.code-server) == 0
    error_message = "Verification workspaces must expose no terminal, external auth, or IDE."
  }
  assert {
    condition     = data.coder_external_auth.forgejo.optional && !contains(keys(coder_agent.main.env), "FACTORY_GIT_TOKEN")
    error_message = "Verification must not receive a human Forgejo token."
  }
  assert {
    condition     = coder_app.url["app"].share == "authenticated"
    error_message = "Verification workspaces must expose only authenticated URL apps."
  }
}

run "pod_security" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = { id = "workspace-id", name = "main-4d6ace5a8c68b6b6db78", start_count = 1, access_url = "https://coder.example.test" }
  }
  override_data {
    target = data.coder_parameter.repository_url
    values = { value = "https://forgejo.invalid/factory/app.git" }
  }
  override_data {
    target = data.coder_parameter.repository_ref
    values = { value = "0123456789abcdef0123456789abcdef01234567" }
  }
  override_data {
    target = data.coder_parameter.workspace_kind
    values = { value = "developer" }
  }
  override_data {
    target = data.coder_parameter.workspace_namespace
    values = { value = "tenant-workspaces" }
  }
  override_data {
    target = data.coder_parameter.repository_apps
    values = { value = "[]" }
  }
  assert {
    condition     = !kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].automount_service_account_token && kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].security_context[0].seccomp_profile[0].type == "RuntimeDefault" && !kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].security_context[0].privileged && !kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].security_context[0].allow_privilege_escalation && toset(kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].security_context[0].capabilities[0].drop) == toset(["ALL"]) && toset(kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].security_context[0].capabilities[0].add) == toset(["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"])
    error_message = "The envbuilder pod must retain the reviewed unprivileged Kubernetes security context."
  }
  assert {
    condition     = alltrue([for volume in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].volume : length(volume.host_path) == 0])
    error_message = "The workspace must not mount a host path or container socket."
  }
  assert {
    condition     = length(kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].volume_mount) == 3 && alltrue([for mount in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].volume_mount : mount.name != "clone-credential"])
    error_message = "The runtime may receive CA trust but never the clone credential."
  }

  assert {
    condition     = one([for mount in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].volume_mount : mount if mount.name == "git-ca"]).read_only && one([for env in kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container[0].env : env if env.name == "GIT_SSL_CAINFO"]).value == "/factory-secrets/ca/ca.crt"
    error_message = "Developer Git must trust Forgejo through the read-only CA mount."
  }
}
