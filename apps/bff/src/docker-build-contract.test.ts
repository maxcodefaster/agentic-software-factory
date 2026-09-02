// Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
//
// All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

import { expect, test } from "bun:test";

const dockerfile = await Bun.file(new URL("../Dockerfile", import.meta.url)).text();
const runtime = dockerfile.slice(dockerfile.lastIndexOf("FROM oven/bun:"));

test("the BFF image shares one cached Bun dependency install", () => {
  expect(dockerfile.match(/bun install --frozen-lockfile/g)).toHaveLength(1);
  expect(dockerfile).toContain("--mount=type=cache,target=/root/.bun/install/cache");
  expect(dockerfile).toContain("--mount=type=cache,target=/src/web/.angular/cache");
  expect(dockerfile).not.toContain("npm install --global bun");
  expect(dockerfile).toContain("COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun");
});

test("the Bun runtime contains only bundled BFF and web artifacts", () => {
  expect(runtime).toContain("COPY --from=bff-build /src/apps/bff/dist ./dist");
  expect(runtime).toContain("COPY --from=web-build /src/web/dist/portal/browser ./web");
  expect(runtime).not.toContain("dist/public/auth");
  expect(runtime).not.toContain("./web/auth");
  expect(runtime).not.toContain("node_modules");
});

test("the BFF build has no server auth presentation pipeline", () => {
  expect(dockerfile).not.toContain("apps/bff/public");
  expect(dockerfile).not.toContain("apps/bff/scripts");
  expect(dockerfile).not.toContain("build-auth-assets");
});

test("the Docker build context uses a source allowlist", async () => {
  const ignore = await Bun.file(new URL("../Dockerfile.dockerignore", import.meta.url)).text();
  expect(ignore).toMatch(/^\*\*$/m);
  for (const path of ["apps/bff/src/**", "apps/bff/drizzle/**", "packages/api-contracts/**", "packages/design-system/**", "web/src/**", "web/public/**"]) {
    expect(ignore).toContain(`!${path}`);
  }
  expect(ignore).not.toContain("!node_modules");
  expect(ignore).not.toContain("!.git");
  expect(ignore).not.toContain("!apps/bff/public");
  expect(ignore).not.toContain("!apps/bff/scripts");
});
