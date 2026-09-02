# Agentic Software Factory Kubernetes Dev Container

This template follows Coder's Kubernetes envbuilder pattern. An init container
checks out and verifies an exact commit, then envbuilder builds the selected
repository-owned Dev Container. Developer workspaces use
`.devcontainer/devcontainer.json`. Staging uses the same developer runtime at
the requested commit, while verification uses `.devcontainer/verification/devcontainer.json`.

The clone token is mounted only in the clone init container. Verification source is
read-only. Staging source remains writable so the developer Dev Container can
run its normal lifecycle. Staging and verification keep the Coder token in a mountless
`no_user_data` agent sidecar, expose only authenticated URL apps, and must belong
to their configured locked automation owners. `staging_owner` defaults to
`factory-stage`; `verification_owner` remains
`factory-verification`.

Source is ephemeral and rebuilt on every start. One PVC retains repository-owned
runtime state under `/workspace-state`. Developer workspaces expose owner-only
repository apps and Coder's browser IDE. The IDE first prints the public Coder
application URLs, then opens the repository's interactive process supervisor
through `Dev: Processes`. `Dev: Live Logs` follows recent output from every
declared process. Factory derives fallback tasks from `.factory/system.yaml`.
During local import, it augments an existing `.vscode/tasks.json` in the managed
snapshot while preserving repository-specific log and restart tasks. The source
repository is not changed. Repositories without a task file receive the fully
generated task file at runtime and Git excludes that link.
The template disables workspace-trust
prompts for this exact-SHA, owner-only IDE so folder-open tasks run without a
prompt. It also removes the welcome page, walkthrough, breadcrumbs, minimap,
extension recommendations, and telemetry while retaining Explorer, Search,
Source Control, Run and Debug, Problems, and the integrated terminal. Browser
services remain the existing Coder applications derived from the System
contract and are directly available from Factory and the Coder workspace page.
VS Code's separate Copilot-style Chat, Agent, command-center, and MCP surfaces
are disabled to avoid presenting a second implementation agent. Ticket
implementation remains the Coder Agent started and tracked by Factory.
Coder's separate Web Terminal is disabled. Staging and verification have no command
apps, IDE, terminal, SSH, port forwarding, or external auth access.
Developer workspaces run the validated shutdown command once through the Coder
agent. Restricted workspaces run it once in the source-mounted runtime's
`preStop` hook. Both change to `/workspaces/project` before executing a relative
command; the mountless restricted agent does not attempt to access source.
