# ADR 0005: Modular monolith and client state

Status: Accepted

## Context

Factory needs clear code and state boundaries, but its workflows share identity,
transactions, and supported Coder and Forgejo clients. Splitting them into
separately deployed services would add network failure modes without removing
those dependencies. The browser also needs shareable team and System selection
without turning every feature state into application-wide state.

## Decision

Factory is a modular monolith. The BFF is one deployable process containing the
HTTP API, Better Auth, OAuth-protected MCP endpoint, static file boundary, and
periodic reconcilers. Modules call typed in-process services and share one
PostgreSQL database. Coder and Forgejo remain separate stock products reached
through supported APIs.

The Angular application renders login and OAuth consent routes. The BFF owns the
authentication and consent APIs and serves the built static application. Only
allowlisted auth routes and static assets are public. Authenticated application
routes require a session. Missing API or asset paths return 404 rather than the
application shell.

In Angular, the `team` and `application` query parameters own shareable request
context. Local storage is only a fallback team for URLs that omit it. The root
context store resolves valid values and supplies API request context. The board
store is route-scoped. Interview and developer stores are feature-scoped and
discard their polling, command, and error state with the feature.

The local lifecycle has distinct commands. `up` reconciles the whole stack,
`deploy` rolls out only BFF and web changes, `prune` removes eligible old local
resources, `down` stops without deletion, and `reset --data` is the guarded
destructive path.

## Non-goals

- Factory modules are not independently deployed microservices.
- The frontend does not use NgRx or one global feature-state store.
- PostgreSQL workflow tables are not a generic queue or message bus.
- Local scripts and Kubernetes examples do not claim production readiness.

## Consequences

Module boundaries remain visible in code and ownership without distributed
transactions between Factory services. Scaling BFF replicas depends on the
existing PostgreSQL leases, constraints, and advisory locks. Process-local rate
limits still need a shared ingress or gateway limit before multi-replica use.
