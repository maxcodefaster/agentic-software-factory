# Contributing

Agentic Software Factory is maintained in public. Keep technical proposals,
reviews, decisions, and release records in this repository unless security,
privacy, or conduct requires confidentiality.

## Before you start

Search existing issues. Use a feature issue for material product, architecture,
compatibility, licensing, security-boundary, or governance changes so the scope
can be agreed before implementation. Use the support form for setup questions.
Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md).

Support is best effort. The project provides no guaranteed response time, uptime
commitment, production support, or private consulting channel. Production
capacity, upgrades, backups, incidents, and dependency support remain the
operator's responsibility.

By contributing, you agree that your contribution is licensed under RPL-1.5 and
that you have the right to submit it. Sign off every commit under the Developer
Certificate of Origin 1.1 at <https://developercertificate.org/>:

```text
Signed-off-by: Your Name <you@example.com>
```

Use `git commit -s`. Do not submit material with a license incompatible with
RPL-1.5. Identify copied or generated content and its source in the pull request.

## Development

Local development requires macOS, OrbStack with Kubernetes enabled, Git, Docker,
`kubectl`, Helm, Bun, and `mise`. Keep the Kubernetes context set to `orbstack`.

```bash
mise install
mise run up
mise run deploy
mise run status
mise run check
mise run e2e
mise run down
```

`mise run check` installs locked dependencies and runs package, example,
Terraform, license, and contract checks. The BFF authentication integration test
also needs Docker or `AUTH_INTEGRATION_POSTGRES_URL` set to a disposable database.

Use `mise run deploy` after BFF or web edits. Run `mise run prune --dry-run`
before local cleanup. `mise run reset --data` is destructive and requires
OrbStack, create-time namespace ownership markers, and explicit confirmation.
`down` never deletes stack data.

The manual CI E2E job uses the protected `factory-e2e` environment and accepts
only the repository default branch. Its `factory-e2e` runner group must contain
ephemeral, single-job runners. Never place long-lived credentials or unrelated
workloads on that runner group.

Keep changes narrow. Add tests for observable behavior and update documentation
when a contract changes. Do not commit secrets, disposable build output,
`.env.local`, or Terraform state. The checked-in OpenAPI document and Angular
client are reviewed source artifacts; update them with `bun run api:generate`.

Factory JSON APIs follow one contract path. Zod schemas in
`packages/api-contracts` define the wire format, Elysia validates them directly,
and OpenAPI plus the Angular `HttpClient` client are generated from the routes.
Application code must not call `/api/v1` with raw `HttpClient` or `fetch`.
Components and stores use the handwritten Angular API facades, which add runtime
response parsing and feature mapping around the generated transport.

`packages/db` owns Drizzle schema, connections, and migrations. Database types
must not cross the HTTP boundary. Domain queries remain in their owning BFF
module, which maps database rows to application results before a route projects
them into a wire contract.

## Pull requests

A reviewable pull request:

- explains the problem, solution, risks, and verification
- links the issue when one exists
- updates the unreleased section in `CHANGELOG.md` for user-visible changes
- keeps first-party package versions aligned for a release
- documents incompatible changes and a migration or rollback path
- passes the reusable `check` workflow
- acknowledges RPL-1.5 source and notice duties

Routine changes use pull-request review. A maintainer with write access makes the
merge decision. Material changes require at least one approving, non-author
maintainer. Record durable architecture choices in `docs/adr/`.

## Project roles and decisions

- Contributors submit issues, reviews, documentation, and DCO-signed changes.
- Reviewers are trusted recurring contributors. They cannot merge unless they are also maintainers.
- Maintainers handle triage, architecture, releases, security response, conduct, and access review.

Maintainers appoint or remove maintainers by consensus based on sustained work
and sound judgment. Review repository access at least annually. Departing
maintainers must transfer private operational and security context, then revoke
their access.

Maintainers seek consensus. If that fails, a majority of active, non-conflicted
maintainers decides after recording concerns and alternatives. A tie keeps the
status quo. Anyone materially affected may request reconsideration with new
evidence.

Participants must disclose interests that could affect a decision. A conflicted
maintainer may provide facts but cannot be the deciding reviewer. Security and
conduct matters may remain private while active; publish the outcome and policy
effect when safe.

No maintainer may bypass release checks, rewrite a published release tag,
privately relicense another contributor's work, or promise project support
without documented authority.

## Conduct

Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).
