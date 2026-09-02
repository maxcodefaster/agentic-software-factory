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
- Encrypted persistent volumes and CSI volume snapshots
- Stakater Reloader or an equivalent secret restart controller

Do not remove unsupported CRDs or network policies just to make validation pass.
Label only the Forgejo, Coder, PostgreSQL, and telemetry namespaces with
`agentic-software-factory.io/dependency=true`, then narrow selectors in the
overlay. Keep egress restricted to the required ports and namespaces.

## Create the overlay

- Replace every `example.invalid` and `replace-me` value.
- Pin `ghcr.io/maxcodefaster/agentic-software-factory/control-plane` by digest.
- Set the ingress class, DNS names, TLS issuer, namespace selectors, and trust roots.
- Set the External Secrets store and remote secret keys.
- Keep `factory-migration` separate from `factory-runtime`.
- Give migration `DATABASE_URL` DDL rights and runtime `DATABASE_URL` DML-only rights.
- Add a shared per-client ingress or gateway rate limit for multiple BFF replicas.
- Replace the Reloader annotation only after proving secret rotation restarts pods.
- Keep `AUTH_MODE=entra` for Entra sign-in.

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

## Supply secrets

The `factory-runtime` secret must provide:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`, at least 32 characters
- `ENTRA_CLIENT_ID` and `ENTRA_CLIENT_SECRET`
- `CODER_OIDC_CLIENT_ID` and `CODER_OIDC_CLIENT_SECRET`
- `FORGEJO_OIDC_CLIENT_ID` and `FORGEJO_OIDC_CLIENT_SECRET`
- `CODER_TOKEN`
- `FORGEJO_TOKEN`, `FORGEJO_IMPLEMENTATION_TOKEN`, and `FORGEJO_REVIEW_TOKEN`
- `FACTORY_CODER_VERIFICATION_OWNER_ID` and `FACTORY_CODER_STAGING_OWNER_ID`

The `factory-migration` secret needs only its DDL-capable `DATABASE_URL`.
Supply downstream redirect URI settings in the overlay. Use distinct Coder and
Forgejo client IDs and secrets. Do not supply `LOCAL_AUTH_*` when
`AUTH_MODE=entra`. Never commit rendered secrets.

## Validate, apply, and upgrade

```bash
export OVERLAY=/path/to/production-overlay
deploy/production/validate.sh "$OVERLAY"
FACTORY_VALIDATE_CLUSTER=true deploy/production/validate.sh "$OVERLAY"
OVERLAY="$OVERLAY" deploy/production/upgrade.sh plan
MIGRATIONS_BACKWARD_COMPATIBLE=true \
  OVERLAY="$OVERLAY" deploy/production/upgrade.sh apply
```

The cluster validation checks CRDs, the ingress class, and a server-side dry
run. Add your policy engine before apply. `upgrade.sh apply` recreates and waits
for the migration Job, resumes the paused Deployment, waits for rollout, and
checks `/readyz`.

Set `MIGRATIONS_BACKWARD_COMPATIBLE=true` only after confirming both the new and
previous application versions can use the migrated schema. The application
rollback does not restore PostgreSQL:

```bash
MIGRATIONS_BACKWARD_COMPATIBLE=true \
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
