# Production deployment

This directory is a portable Kustomize base, not a ready-to-run environment.
Create an overlay. Do not apply the base directly.

## Cluster checklist

- Kubernetes 1.30 or newer
- A default-deny-capable CNI
- ingress-nginx with snippet annotations allowed
- External Secrets Operator with `external-secrets.io/v1`
- Prometheus Operator with `monitoring.coreos.com/v1`
- cert-manager or another TLS issuer
- PostgreSQL 16 or newer with point-in-time recovery
- Coder and Forgejo
- An HTTP CONNECT egress proxy or gateway with destination allowlisting
- Encrypted persistent volumes and CSI volume snapshots
- Stakater Reloader or an equivalent secret restart controller

Do not remove unsupported CRDs or network policies just to make validation pass.
Replace every `replace-me-*` NetworkPolicy label with labels that identify one
dependency namespace and its pods. The validator rejects the old broad
`agentic-software-factory.io/dependency=true` selector. It also rejects any
remaining placeholder in a deployable overlay.

## Create the overlay

- Replace every `example.invalid` and `replace-me` value.
- Pin `ghcr.io/maxcodefaster/agentic-software-factory/control-plane` by digest.
- Set the ingress class, DNS names, TLS issuer, namespace selectors, and trust roots.
- Replace all three ingress hosts. The Coder and Forgejo hosts expose only the
  exact `/__factory/logout` path through their added rules.
- Set `CODER_OIDC_POST_LOGOUT_REDIRECT_URIS` to the exact public Coder URL and
  `FORGEJO_OIDC_POST_LOGOUT_REDIRECT_URIS` to the exact public Forgejo URL.
- Set the External Secrets store and remote secret keys.
- Keep `factory-migration` separate from `factory-runtime`.
- Give migration `DATABASE_URL` DDL rights and runtime `DATABASE_URL` DML-only rights.
- Add a shared per-client ingress or gateway rate limit for multiple BFF replicas.
- Replace the Reloader annotation only after proving secret rotation restarts pods.
- Keep `AUTH_MODE=entra` for Entra sign-in.
- Set `TRUSTED_PROXY_CIDRS` to the ingress controller pod or load balancer
  source CIDRs. Production startup rejects an empty value.
- Choose `FACTORY_CODER_RESTRICTED_APP_SHARING`. Use `owner` if operators and
  automation do not need human staging or verification previews. Use
  `authenticated` only after setting
  `FACTORY_CODER_AUTHENTICATED_APP_SCOPE_ACKNOWLEDGEMENT=deployment-wide`.
  The validator and BFF startup reject any other acknowledgement.

Coder 2.37 treats `authenticated` app sharing as deployment-wide. Factory team
membership and Coder organization membership do not narrow it. Community Coder
cannot implement the required team-only app URL rule. Multiple organizations
require Premium, groups sit behind Template RBAC, and a workspace `use` ACL also
grants SSH plus workspace start and stop. For direct preview isolation, run one
Coder deployment or organization per security boundary, subject to licensing,
or enforce access with an external auth proxy. Do not rely on hidden links.

Pass the same `FACTORY_CODER_RESTRICTED_APP_SHARING` value when running
`scripts/push-coder-template.sh`. A mismatch makes restricted workspace builds
fail their template precondition. With `owner`, Factory omits preview links even
though it still checks app health. Local development defaults to
`authenticated` and remains tenant-wide.

Changing the setting does not rewrite Coder's records for already running
apps. Re-push the template, then rebuild or delete every existing staging and
verification workspace before treating `owner` as effective. Confirm the Coder
API reports `sharing_level=owner` for every restricted URL app. Coder site owners
and any role with workspace application-connect permission still have access.

The runtime NetworkPolicy allows no public port 443 destination. Set
`HTTPS_PROXY` to a controlled proxy selected by the `replace-me-egress` and
`replace-me-egress-proxy` labels. Configure that proxy to allow CONNECT only to
`login.microsoftonline.com:443` and `graph.microsoft.com:443`, resolve names at
the proxy, reject direct IP destinations, and log denied requests. Keep Coder,
Forgejo, PostgreSQL, DNS, and OTLP on their separate pod selectors. If the
cluster uses a service mesh egress gateway instead, patch the proxy URL, port,
and selector together. The rendered base is portable, but it is intentionally
not deployable until the overlay supplies these details.

Set `CODER_URL` and `FORGEJO_URL` to cluster-local HTTPS services selected by
their NetworkPolicy labels. Keep their public URL settings on the public hosts.
If either product is external to the cluster, route it through a dedicated
gateway and replace that product's namespace and pod selector with the gateway
selector. A public DNS result cannot satisfy a pod selector.

The BFF's in-memory limits are a second line of defense. Account for controller
replicas if ingress-nginx keeps counters per process.

## Register Microsoft Entra

1. Create a single-tenant web app registration in the target tenant.
2. Add the exact redirect URI `https://factory.<domain>/callback/upstream-oidc`.
3. Create a client secret or connect an equivalent secret delivery mechanism.
4. Keep the requested scopes at `openid`, `profile`, and `email`.
5. Set `ENTRA_TENANT_ID` to the tenant GUID in the overlay.
6. Factory derives the issuer as `https://login.microsoftonline.com/<tenant-guid>/v2.0`.

### App Roles

Create these App Role values and assign users or groups:

- `Factory.Member` grants sign-in and read access.
- `Factory.Business` grants requirement and review actions.
- `Factory.Developer` grants implementation actions and business actions.
- `Factory.Admin` grants all personas and every configured team.
- `Factory.Team.<slug>` grants access to the matching `FACTORY_TEAM_BOARDS` team.

Factory derives tenant and persona group names from `FACTORY_TENANT_ID`. It
ignores unknown role values. Entra group claims and email addresses do not grant
access.

Entra App Roles are mapped when the user signs in. This release has no SCIM
endpoint and does not receive Entra role-removal or account-disable events.
Removing an App Role in Entra alone is therefore not an emergency revocation.

## Supply secrets

The `factory-runtime` secret must provide:

- `DATABASE_URL` with `sslmode=verify-full`
- `DATABASE_TLS_CA` containing the PostgreSQL server CA PEM
- `BETTER_AUTH_SECRET`, at least 32 characters
- `ENTRA_CLIENT_ID` and `ENTRA_CLIENT_SECRET`
- `CODER_OIDC_CLIENT_ID` and `CODER_OIDC_CLIENT_SECRET`
- `FORGEJO_OIDC_CLIENT_ID` and `FORGEJO_OIDC_CLIENT_SECRET`
- `CODER_OIDC_REDIRECT_URIS` and `FORGEJO_OIDC_REDIRECT_URIS`
- `CODER_TOKEN`
- `FORGEJO_TOKEN`, `FORGEJO_IMPLEMENTATION_TOKEN`, and `FORGEJO_REVIEW_TOKEN`
- `FACTORY_CODER_VERIFICATION_OWNER_ID` and `FACTORY_CODER_STAGING_OWNER_ID`

The `factory-migration` secret needs only its DDL-capable `DATABASE_URL` and
`DATABASE_TLS_CA`. Both database URLs must use a DNS name covered by the server
certificate. Production startup and the migration command reject missing CA
data or any sslmode other than `verify-full`. Local mode sets
`FACTORY_ENVIRONMENT=local` and may use its isolated PostgreSQL service without
TLS.
Supply downstream redirect URI settings in the overlay. Use distinct Coder and
Forgejo client IDs and secrets. Do not supply `LOCAL_AUTH_*` when
`AUTH_MODE=entra`. Never commit rendered secrets.

ExternalSecret entries and container environment variables are allowlisted one
key at a time. Do not add `dataFrom`, `extract`, or `envFrom`. Runtime database
credentials remain DML-only. The migration secret is the only place for DDL
credentials.

## Automation access and rotation

| Credential or identity | Required permission | Prohibited permission | Rotation and check |
| --- | --- | --- | --- |
| `FORGEJO_TOKEN` integration user | Organization and repository administration for the configured owner, including teams, collaborators, branch protection, OAuth clients, issues, and pull requests | Site administration outside the dedicated Forgejo instance or access to other owners | Rotate every 90 days. Replace the secret, wait for the Deployment restart, then require `/readyz` to return 200. |
| `FORGEJO_IMPLEMENTATION_TOKEN` as `factory-implementation` | API token scope `all` on a non-admin account; repository collaborator `write`; push only to protected `factory/requirement-*` branches | Main-branch push, merge approval, organization or site administration | Rotate every 90 days. Startup must confirm the configured username before readiness. |
| `FORGEJO_REVIEW_TOKEN` as `factory-review` | `write:repository`, `read:user`; repository collaborator `read`; review and status writes | Repository push, merge, organization or site administration | Rotate every 90 days. Startup must confirm the configured username before readiness. |
| `factory-clone` | Repository collaborator `read`; token scope `read:repository` when a clone token is issued outside this Deployment | Issue, pull request, status, push, organization, or site writes | Rotate issued clone tokens every 90 days and remove unused tokens. Reconciliation keeps repository access at read. |
| `CODER_TOKEN` | Dedicated Coder owner or equivalent administrator that can manage users, organization membership, templates, workspaces, user tokens, and organization MCP configuration | Use by a human or reuse in another application | Rotate every 90 days. Replace the secret and require external-service initialization plus `/readyz` success. |
| Coder `factory-verification` owner | Active password identity, configured organization member, owns only verification workspaces | Site roles, `organization-admin`, any agent role, or Coder service-account status | Review monthly. Rotate its bootstrap password every 90 days if interactive login remains enabled. Startup rejects unsafe identity or roles. |
| Coder `factory-stage` owner | Active password identity, configured organization member, owns only staging workspaces | Site roles, `organization-admin`, any agent role, or Coder service-account status | Review monthly. Rotate its bootstrap password every 90 days if interactive login remains enabled. Startup rejects unsafe identity or roles. |
| Entra, Coder OIDC, and Forgejo OIDC client secrets | Confidential client secret for its one named client and exact redirect URIs | Shared client IDs or secrets, wildcard redirect URIs | Add an overlapping secret 14 days before expiry, update External Secrets, restart, verify sign-in and logout, then revoke the old value. Maximum lifetime is 180 days. |
| `BETTER_AUTH_SECRET` | Factory session and token signing only | Reuse by another service | Rotate during a planned global-session logout every 180 days, or immediately after suspected disclosure. Verify Coder and Forgejo OIDC login after restart. |
| PostgreSQL runtime and migration users | Runtime DML only; migration DDL and DML only for the Factory database | Runtime DDL, superuser, replication, role creation, or access to another database | Rotate every 90 days. Update each secret independently and verify migration dry run plus `/readyz`. |

Rotate any credential immediately after suspected disclosure or an operator
departure. Record the old credential revocation, new secret version, rollout,
and readiness result. `/healthz` and `/readyz` stay unauthenticated for probes.
`/statusz` requires a signed-in tenant administrator and must not be exposed as
a public monitoring endpoint. Its response contains aggregate capability state
and aggregate System status, counts, onboarding, registry, and staging fields.
It does not return System IDs. Prometheus uses `/metrics` through the monitoring
namespace and pod selector.

## Emergency user revocation

Use the Factory deprovision endpoint as soon as an Entra or local user must lose
access. Sign in as a different Factory administrator and send:

```bash
curl --fail-with-body --request POST \
  --cookie 'factory.session_token=<administrator-session-cookie>' \
  'https://factory.<domain>/api/v1/users/<factory-user-id>/deprovision'
```

The endpoint returns `202` after one database transaction has removed the
target's Factory groups, Better Auth sessions, pending verification records,
OAuth consent, authorization codes, access tokens, refresh tokens, user-owned
OAuth client authority, Coder binding, and active operation credentials. It
keeps the user row and delivery history. Repeating the request returns `202`.
Malformed IDs return `400`, missing authentication returns `401`, non-admin or
cross-tenant callers return `403`, unknown or foreign users return `404`, and an
administrator attempting to revoke their own account receives `409`.

The response reports `persisted: true`. From that point, old Factory cookies,
OAuth tokens, refresh grants, and MCP tokens cannot authorize the user. It also
reports Coder as `suspended`, `not-linked`, or `pending`, and Forgejo as
`requested`. Factory expires every Coder API key it created for the mapped user
and suspends the Coder account through Coder's supported API. It does not delete
or stop workspaces. If Coder is unavailable, a worker retries within 30 seconds
of each failed attempt.

Factory wakes Forgejo human-access reconciliation after the commit. The normal
30-second worker is the fallback, so team removal may take up to one worker
interval plus Forgejo API time. Existing Forgejo sessions may remain signed in,
but reconciled team removal removes repository authority. For an incident where
that delay is unacceptable, suspend the mapped user in Coder and remove the
Forgejo user from every Factory-managed human team with each product's admin
API while Factory reconciliation catches up.

The Better Auth `oauth_client_assertion` table stores short-lived replay
tombstones. Its schema has no user or client foreign key, so Factory cannot
attribute those rows to the target and does not delete them. They grant no
access, and Better Auth rejects them after its five-minute assertion lifetime.

For Entra users, also disable the account or remove its Factory App Roles in
Entra. That prevents a later organizational sign-in, but it does not replace the
Factory endpoint because this release has no automatic SCIM deprovisioning.

## Validate, apply, and upgrade

```bash
export OVERLAY=/path/to/production-overlay
deploy/production/validate.sh "$OVERLAY"
FACTORY_VALIDATE_CLUSTER=true deploy/production/validate.sh "$OVERLAY"
OVERLAY="$OVERLAY" deploy/production/upgrade.sh plan
OVERLAY="$OVERLAY" deploy/production/upgrade.sh apply
```

The cluster validation checks CRDs, the ingress class, and a server-side dry
run. Add your policy engine before apply. `upgrade.sh apply` recreates and waits
for the migration Job, resumes the paused Deployment, waits for rollout, and
checks `/readyz`.

This initial release accepts only its clean database baseline. The migration Job
rejects an older or mismatched history before applying SQL. Application rollback
does not restore PostgreSQL:

```bash
OVERLAY="$OVERLAY" deploy/production/upgrade.sh rollback
```

For destructive migrations, use a planned database restore instead. Version
0.1 supports its clean baseline only, not upgrades from another baseline.

## Back up and restore

Configure PostgreSQL point-in-time recovery first. Test both logical restore
and the provider recovery path before production use.

```bash
DATABASE_URL="$DDL_DATABASE_URL" BACKUP_FILE=/secure/factory.dump \
  deploy/production/backup-restore.sh backup
DATABASE_URL="$DDL_DATABASE_URL" BACKUP_FILE=/secure/factory.dump \
  deploy/production/backup-restore.sh verify
DATABASE_URL="$DDL_DATABASE_URL" RESTORE_DATABASE_URL="$EMPTY_TEST_DATABASE_URL" \
  BACKUP_FILE=/secure/factory.dump deploy/production/backup-restore.sh restore-test
```

Store the dump and generated checksum in encrypted, access-controlled storage.
Record recovery point and recovery time results.

Coder owns workspace pods and volumes. Use Coder to stop or delete workspaces.
For workspace volume recovery, stop the workspace without deleting it, create a
snapshot with `workspace-snapshot.sh`, wait until it is ready, then restore it:

```bash
NAMESPACE=<workspace-namespace> TENANT_ID=<tenant> SNAPSHOT_CLASS=<class> \
  deploy/production/workspace-snapshot.sh restore <snapshot> [size]
```

The restore command rejects running or deleted workspaces and incompatible
storage or snapshot drivers.
