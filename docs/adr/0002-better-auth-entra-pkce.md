# ADR 0002: Better Auth, Entra, and PKCE

Status: Accepted

## Context

Coder and Forgejo need stable downstream identity while operators choose local
accounts or Microsoft Entra ID for sign-in. Entra authorization uses App Roles.
The downstream OAuth clients do not have the same PKCE behavior.

## Decision

Better Auth is the OIDC issuer trusted by Coder and Forgejo. Each product has a
separate confidential client, secret, redirect list, cookie, token, and session.
Coder authorization-code requests must use PKCE with S256. Factory rejects a
missing challenge and the plain method.

`AUTH_MODE` selects one of two authentication modes. Local mode requires
`LOCAL_AUTH_EMAIL` and `LOCAL_AUTH_PASSWORD` and provisions that user. Entra
mode requires `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, and `ENTRA_CLIENT_SECRET`.
The modes are mutually exclusive.

The same Coder OAuth client supplies user identity to Factory's MCP endpoint.
Factory introspects each bearer token and requires that client ID, the Factory
MCP audience, the `mcp:call` scope, a lifetime no longer than 15 minutes, and a
subject that maps to a current Factory user. MCP authorization then uses that
user and their groups. Coder does not call user-facing MCP tools as a shared
service account.

Stock Forgejo 15 omits PKCE and nonce. Its confidential client receives the only
no-PKCE exception, guarded by `FORGEJO_OIDC_COMPATIBILITY_MAJOR=15`, the exact
configured client ID and redirects, secret authentication, and state. If a
Forgejo release sends PKCE, Factory accepts only S256. Plain PKCE is rejected. A
Forgejo major-version change requires a policy review and tests before the pin
changes.
Coder's separate Forgejo external-auth client uses S256 PKCE and gives each
developer their own repository token.

Entra is an optional upstream provider. It uses a single-tenant web app
registration and the canonical callback
`https://factory.<domain>/callback/upstream-oidc`. It must use a tenant GUID and the exact
tenant-specific v2 issuer. Better Auth verifies the ID token, binds identity to
the issuer and `sub`, uses upstream PKCE, and requires `openid`, `profile`, and
`email`. Email is not trusted by default.

Factory accepts fixed App Role values. `Factory.Member` grants tenant access;
`Factory.Business` and `Factory.Developer` add their personas; `Factory.Admin`
adds both personas and all configured teams. `Factory.Team.<slug>` grants its
configured team. Unknown roles, Entra group claims, email, and tenant membership
do not grant access.

## Consequences

Operators can replace local sign-in with Entra App Roles without changing
downstream Coder or Forgejo trust. Role assignment and mapping become part of
access provisioning. A client that does not meet its exact policy cannot log in
or call MCP, even if its secret is valid.
