# ADR 0003: System contract and wildcard applications

Status: Accepted

## Context

Each repository needs its own tools and processes, but platform-specific
workspace configuration would split ownership between the repository and
Factory. Browser path applications also weaken isolation and routing.

## Decision

A System is a Forgejo repository. At one exact commit,
`.factory/system.yaml` declares version 1, development and verification Dev Containers,
the supervisor command contract, startup timeout, applications and health
checks, and optional release metadata. Factory validates every referenced file
and rejects unsupported runtime privileges or container fields. The `example/`
System is the maintained reference.

One generic Kubernetes Coder template runs the repository contract. Development
source is replaceable. Verification source is read-only and pinned to the pull-request
commit. Workspaces have no container daemon, host socket, host namespace,
privileged mode, or service-account token.

All browser IDEs and applications use stock Coder wildcard-subdomain routing.
Factory accepts URLs only when Coder marks the app as a subdomain app and returns
its subdomain name. Development apps are owner-only. Verification apps require an
authenticated Coder user. Path-app sharing and Factory-built proxy URLs are not
allowed.

## Consequences

Repositories own their development runtime without owning cluster policy.
Wildcard DNS, ingress, cookies, WebSockets, IDE traffic, HMR, and application
traffic must work in local and hosted deployments.
