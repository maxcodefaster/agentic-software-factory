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

Reports that require `AUTH_DISABLED=true`, intentionally disclosed development
credentials, or unrestricted administrator access are normally out of scope
unless they demonstrate a boundary bypass in a correctly configured deployment.
Do not test against infrastructure you do not own or have permission to assess.
