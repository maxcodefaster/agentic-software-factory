# Example System

This is the repository's working System example. It uses TanStack Start, React,
Better Auth, Drizzle, and PostgreSQL. The signed-in home page provides a styled
work-items CRUD flow. Health endpoints are available at `/api/health/live` and
`/api/health/ready`.

## Develop

Open `example/` in its Dev Container. The developer container installs locked
dependencies, starts PostgreSQL under process-compose, applies migrations, and
runs Vite on <http://127.0.0.1:4173>.

For a local Bun environment with PostgreSQL already available:

```bash
bun run setup
bun run db:migrate
bun run dev
```

The verification Dev Container uses a read-only checkout, fixture data, closed account
registration, and an authenticated application URL. It does not expose an
editor, terminal, command app, or writable source mount.

## Check

```bash
bun install --frozen-lockfile
bun run check
```

`bun run check` runs Biome, TypeScript, focused tests, and the production build.
The `.factory/system.yaml` file declares the developer and verification containers,
process-compose supervisor, application URL, and readiness check.

## License

Licensed under the [Reciprocal Public License 1.5](LICENSE). See [NOTICE](NOTICE)
for attribution and source terms.
