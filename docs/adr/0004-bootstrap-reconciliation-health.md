# ADR 0004: Bootstrap, reconciliation, and observational health

Status: Accepted

## Context

Provisioning and external API calls can stop halfway through. Retrying every
write blindly can duplicate Chats, overwrite Git state, or hide a broken
dependency. Health probes must not cause those writes.

## Decision

Bootstrap is resumable and idempotent. It records resource ownership, completed
work, generated credentials, and source attestations. It may adopt only owned
resources and publish to an empty remote or the exact attested commit. It never
force-pushes divergent source.

Onboarding, staging, interview, verification, and completion operations keep explicit
state, bounded retries, persistent leases, and idempotency markers. Reconcilers
resume unambiguous work. An ambiguous external write stops for inspection rather
than creating a replacement. Staging projects live state from Coder.

PostgreSQL is the durable coordination boundary. It stores Factory-owned
workflow phases, attempts, errors, lease owners, lease expiry, lease generation,
and idempotency keys. Database constraints and advisory locks prevent conflicting
claims across BFF processes. Lease heartbeats abort work that loses ownership.
This is not a generic queue. Each workflow has its own table, states, claim
rules, and repair behavior.

One worker host supervises the periodic reconcilers in each BFF process. A named
worker cannot overlap its previous run. A failed run is logged without stopping
later runs or unrelated workers. Shutdown clears timers, aborts active runs, and
waits for them to settle before closing PostgreSQL.

Health is observational. `/healthz` reports process liveness. `/readyz` checks
the database, Forgejo, external automation identities, and a PostgreSQL summary
of onboarding, registry projections, and staging observations. It never fans out
to Coder workspaces or repairs state. Database and Forgejo failures make the BFF
unready. Individual System transitions, repair states, failed staging, registry
load errors, and stale projections are degradation while any registered System
remains usable. If registered Systems exist and none are usable, the BFF is
unready. `/statusz` reports aggregate System status and counts, onboarding,
registry, staging, and optional capabilities. It does not report System IDs. A
missing Coder model makes the AI interview unavailable but does
not make the core service unready. Stock Coder administration owns model
credentials and default-model selection.

## Consequences

An interrupted installation and an unchanged rerun converge without destructive
cleanup. Operators repair failed reconciliation explicitly, while probes remain
safe to call at any frequency.
