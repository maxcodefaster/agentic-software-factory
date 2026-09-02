# Security Policy

## Supported Versions

Security fixes are provided for the latest published release only. The `main`
branch is under active development and may contain fixes not yet released.

| Version | Supported |
| --- | --- |
| Latest published minor | Yes |
| Older minors | No |
| Unreleased snapshots | No |

Agentic Software Factory is a reference implementation, not a production-ready
control plane. Operators must supply and test high availability, backups,
disaster recovery, upgrades, monitoring, and hardened secret management.

## Reporting A Vulnerability

Do not open a public issue. Use GitHub's **Security > Report a vulnerability**
private reporting flow for this repository. Include:

- affected version or commit;
- reproduction steps or a proof of concept;
- expected impact and known prerequisites;
- suggested mitigation, if available;
- whether the report or exploit is already public.

If private reporting is unavailable, open a minimal public issue requesting a
private contact channel. Do not include exploit details, credentials, personal
data, or vulnerable deployment URLs.

Maintainers aim to acknowledge a complete report within 3 business days, provide
an initial assessment within 7 business days, and publish a remediation plan for
validated issues within 14 business days. These are targets, not service-level
agreements. Please allow a coordinated fix and release before disclosure.

## Scope

In scope are vulnerabilities introduced by this repository's BFF, web client,
Coder workspace template, release workflow, and deployment examples.
Vulnerabilities in Coder, Forgejo, PostgreSQL, GitHub Actions, base images, or
another dependency should also be reported to that upstream project; report
here when Agentic Software Factory's use of the dependency creates additional
exposure.

Reports that require intentionally disclosed development credentials or
unrestricted administrator access are normally out of scope
unless they demonstrate a boundary bypass in a correctly configured deployment.
Do not test against infrastructure you do not own or have permission to assess.

## Coder application URLs

Factory team checks protect Factory routes and managed Forgejo access. They do
not protect direct Coder application URLs. With Coder 2.37,
`sharing_level=authenticated` allows every authenticated user in that Coder
deployment to open a staging or verification app if they know its URL. Hiding a
URL in Factory does not reduce that access.

Use `FACTORY_CODER_RESTRICTED_APP_SHARING=owner` when human previews are not
needed. Factory then returns no staging or verification preview links. The
automation owner and privileged Coder roles with workspace application-connect
permission retain direct access. If a production deployment uses
`authenticated`, startup requires
`FACTORY_CODER_AUTHENTICATED_APP_SCOPE_ACKNOWLEDGEMENT=deployment-wide`.
Deployments that need direct app isolation between teams must separate Coder by
security boundary or put an independently enforced auth proxy in front of app
URLs. Cross-team access under an acknowledged deployment-wide policy is not a
boundary bypass. Access by an unauthenticated user, owner-level access without
Coder RBAC permission, or a Factory or Forgejo team authorization bypass remains
in scope.
