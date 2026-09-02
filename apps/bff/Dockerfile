# syntax=docker/dockerfile:1
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS bun

FROM alpine/git:v2.49.1@sha256:c0280cf9572316299b08544065d3bf35db65043d5e3963982ec50647d2746e26 AS git

FROM bun AS runtime
USER root
COPY --from=git /usr/bin/git /usr/bin/git
COPY --from=git /usr/libexec/git-core /usr/libexec/git-core
COPY --from=git /usr/share/git-core /usr/share/git-core
COPY --from=git /usr/lib/libbrotlicommon.so.1* /usr/lib/
COPY --from=git /usr/lib/libbrotlidec.so.1* /usr/lib/
COPY --from=git /usr/lib/libcares.so.2* /usr/lib/
COPY --from=git /usr/lib/libcrypto.so.3 /usr/lib/
COPY --from=git /usr/lib/libcurl.so.4* /usr/lib/
COPY --from=git /usr/lib/libidn2.so.0* /usr/lib/
COPY --from=git /usr/lib/libnghttp2.so.14* /usr/lib/
COPY --from=git /usr/lib/libpcre2-8.so.0* /usr/lib/
COPY --from=git /usr/lib/libpsl.so.5* /usr/lib/
COPY --from=git /usr/lib/libssl.so.3 /usr/lib/
COPY --from=git /usr/lib/libunistring.so.5* /usr/lib/
COPY --from=git /usr/lib/libz.so.1* /usr/lib/
COPY --from=git /usr/lib/libzstd.so.1* /usr/lib/
RUN test "$(bun --version)" = "1.3.14" \
 && test "$(git --version)" = "git version 2.49.1" \
 && test "$(git --exec-path)" = "/usr/libexec/git-core"

FROM node:24.15.0-alpine@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f AS dependencies
WORKDIR /src
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
COPY apps/bff/package.json ./apps/bff/package.json
COPY packages/api-contracts/package.json ./packages/api-contracts/package.json
COPY packages/design-system/package.json ./packages/design-system/package.json
COPY web/package.json ./web/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM dependencies AS bff-build
COPY apps/bff/src ./apps/bff/src
COPY apps/bff/tsconfig.json apps/bff/drizzle.config.ts ./apps/bff/
COPY deploy/local/bootstrap-users.ts ./deploy/local/bootstrap-users.ts
COPY packages/api-contracts ./packages/api-contracts
RUN bun run --filter=@agentic-software-factory/bff build

FROM dependencies AS web-build
ENV PATH="/src/web/node_modules/.bin:${PATH}"
COPY web ./web
COPY --from=dependencies /src/web/node_modules ./web/node_modules
COPY packages/api-contracts ./packages/api-contracts
COPY packages/design-system ./packages/design-system
RUN --mount=type=cache,target=/src/web/.angular/cache \
    cd web && bun run build

FROM runtime
WORKDIR /app
USER root
RUN addgroup -g 10001 factory \
 && adduser -D -u 10001 -G factory factory
ENV NODE_ENV=production
ENV WEB_ROOT=/app/web
ENTRYPOINT []
COPY --from=bff-build /src/apps/bff/dist ./dist
COPY apps/bff/drizzle ./drizzle
COPY apps/bff/package.json ./
COPY LICENSE NOTICE THIRD_PARTY_NOTICES ./
COPY --from=web-build /src/web/dist/portal/browser ./web
USER 10001:10001
EXPOSE 8080
# Run schema changes explicitly before starting: bun dist/db/run-migrations.js
CMD ["bun", "dist/main.js"]
