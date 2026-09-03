# Coding rules

- Define each `/api/v1` request and response once as a Zod schema in `packages/api-contracts` and pass that schema directly to Elysia.
- Run `bun run api:generate` after changing an application route. Do not edit `apps/bff/openapi/factory-api.openapi.json` or `web/src/app/generated/api` by hand.
- Call Factory application APIs through the generated Angular service. Components and stores use the handwritten feature facades, not raw `HttpClient` or `fetch`.
- Keep Angular view models in `web`. Keep Drizzle rows and provider response models out of API contracts.
- Keep database connections, schema definitions, and migrations in `packages/db`. Keep domain queries in the owning BFF module.
- Better Auth, OIDC, MCP, metrics, health checks, and static assets are separate protocols. Do not force them into the Factory `/api/v1` contract.
