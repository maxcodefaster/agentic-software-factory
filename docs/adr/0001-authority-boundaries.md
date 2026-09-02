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
deployments.
