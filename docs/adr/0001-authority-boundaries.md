# ADR 0001: Authority boundaries

Status: Accepted

## Context

Factory coordinates work already held by Coder and Forgejo. Copying their state
would create competing records and recovery paths.

## Decision

Factory owns its web interface, authorization, workflow coordination, human
gates, and handoffs. Stock Forgejo owns issues, requirement evidence, Git, pull
requests, checks, reviews, tags, and releases. Stock Coder owns Chats, agents,
workspaces, IDEs, terminals, application URLs, and application health.

An accepted requirement is a versioned YAML artifact in Forgejo. The issue body
and labels point to it. Before implementation, Factory reads the artifact at the
recorded commit and checks its path, SHA-256 digest, requirement identity, and
issue URL. A label or body marker alone does not authorize implementation.

Factory uses supported OIDC and HTTP APIs. It does not fork or patch Coder or
Forgejo, write their databases, mirror Forgejo issues as a board store, or treat
a workspace as System identity. One deployment is one tenant and repository
trust domain. Agents cannot accept requirements, approve their own delivery, or
move work to Done.

Factory teams are authorization boundaries for Factory workflows and the
Forgejo repository grants that Factory manages. They are not Coder application
URL boundaries. In pinned Coder 2.37, an app with `sharing_level=authenticated`
is available to any authenticated user in the Coder deployment. The
`organization` sharing level checks organization membership, but multiple
organizations require a Premium license. Workspace group ACLs also depend on
Template RBAC, and their `use` role includes SSH plus workspace start and stop.
They cannot provide community-only, app-only team access for restricted
workspaces.

Production therefore chooses one of two Coder app policies.
`FACTORY_CODER_RESTRICTED_APP_SHARING=owner` keeps staging and verification apps
out of ordinary authenticated-user sharing and Factory omits their preview
links. The workspace owner and Coder principals with `application_connect`
permission can still open them.
`authenticated` enables business previews across the whole Coder deployment
and requires the literal acknowledgement
`FACTORY_CODER_AUTHENTICATED_APP_SCOPE_ACKNOWLEDGEMENT=deployment-wide`.
Security boundaries that require direct app isolation need one Coder deployment
or organization per boundary, subject to Coder licensing, or an external auth
proxy that enforces that boundary. Factory route checks do not protect a direct
Coder URL.

The decision is based on Coder `v2.37.0`, commit
`8a148a9a57eef8dc19db13d1423adcdaadd319d4`. The app authorization code says the
`authenticated` behavior shares with any authenticated user and uses
`AnyOrganization()`, while `organization` performs a separate membership check.
The group routes require Template RBAC, whose middleware returns "Premium
feature" when the entitlement is disabled. Coder's own license test says
multiple organizations are Premium-only. The `use` workspace ACL action list
contains application connect, read, SSH, start, and stop.

- [App sharing authorization](https://github.com/coder/coder/blob/8a148a9a57eef8dc19db13d1423adcdaadd319d4/coderd/workspaceapps/db.go#L327-L385)
- [Group route entitlement](https://github.com/coder/coder/blob/8a148a9a57eef8dc19db13d1423adcdaadd319d4/enterprise/coderd/coderd.go#L514-L521)
- [Template RBAC Premium check](https://github.com/coder/coder/blob/8a148a9a57eef8dc19db13d1423adcdaadd319d4/enterprise/coderd/templates.go#L347-L365)
- [Workspace `use` actions](https://github.com/coder/coder/blob/8a148a9a57eef8dc19db13d1423adcdaadd319d4/coderd/database/db2sdk/db2sdk.go#L983-L1003)
- [Multiple-organization license test](https://github.com/coder/coder/blob/8a148a9a57eef8dc19db13d1423adcdaadd319d4/enterprise/coderd/license/license_test.go#L1685-L1708)

Factory asks Coder for four policy-bound workspace purposes. A personal System
workspace supports ticketless development, a ticket workspace supports mutable
implementation, a verification environment runs the exact pull-request SHA
without developer tools, and staging continuously projects the default branch.
These are ordinary Coder workspaces created through supported APIs, not a
Factory replacement for Coder scheduling or prebuilds. Staging self-heals;
personal and ticket workspaces may remain stopped until a user resumes them;
verification environments restart only when review needs them.

The local deployment currently submits Forgejo review decisions through a
restricted machine account so the Factory can retain its in-product review
controls. This account is a transport identity, not proof of reviewer
independence. Factory records the authenticated human identity, rejects
contributors, verifies the exact SHA and current default branch, and requires
the controlled merge path. Replace the machine submission only when Forgejo can
receive the authenticated user's delegated credential without losing those
controls.

Forgejo remains the release authority. A separate delivery system owns
production credentials, rollout, rollback, backup, and disaster recovery.

## Consequences

An unavailable dependency blocks the work it owns rather than moving that
authority into Factory. PostgreSQL can retain Factory coordination state while
Forgejo or Coder is unavailable, but that state does not replace either
product's records. Repository groups that cannot trust each other need separate
Factory and Forgejo boundaries. They also need separate Coder deployments or
organizations, or an external auth proxy, if they expose restricted application
previews.
