/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { createDatabase } from '../db';
import { closeDatabase, migrateDatabase } from '../db/migrate';

const databaseUrl = process.env.TEST_DATABASE_URL;
const database = databaseUrl ? createDatabase(databaseUrl) : null;
let child: ReturnType<typeof Bun.spawn> | null = null;
const port = 18_000 + Math.floor(Math.random() * 1_000);

beforeAll(async () => {
  if (!database || !databaseUrl) return;
  await migrateDatabase(database.db, resolve(import.meta.dir, '../../drizzle'));
  child = Bun.spawn(['bun', 'src/main.ts'], {
    cwd: resolve(import.meta.dir, '../..'),
    stdout: 'pipe', stderr: 'pipe',
    env: {
      ...globalThis.process.env,
      DATABASE_URL: databaseUrl,
      HOST: '127.0.0.1', PORT: String(port),
      AUTH_MODE: 'local',
      AUTH_ISSUER: `http://127.0.0.1:${port}`,
      LOCAL_AUTH_EMAIL: 'admin@factory.test',
      LOCAL_AUTH_PASSWORD: 'local-password',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      FORGEJO_URL: 'https://127.0.0.1:1', FORGEJO_PUBLIC_URL: 'https://forgejo.invalid',
      FORGEJO_TOKEN: 'unreachable', FORGEJO_IMPLEMENTATION_TOKEN: 'unreachable', FORGEJO_REVIEW_TOKEN: 'unreachable', FORGEJO_OWNER: 'factory',
      FACTORY_TENANT_ID: 'factory', FACTORY_WORKSPACE_NAMESPACE: 'factory-workspaces',
      CODER_URL: 'https://127.0.0.1:1', CODER_PUBLIC_URL: 'https://coder.invalid', CODER_WILDCARD_ACCESS_URL: '*.apps.coder.invalid', CODER_TOKEN: 'unreachable',
      CODER_OIDC_CLIENT_ID: 'agentic-software-factory-coder', CODER_OIDC_CLIENT_SECRET: 'coder-client-secret', CODER_OIDC_REDIRECT_URIS: `http://127.0.0.1:${port}/coder/callback`,
      FACTORY_CODER_VERIFICATION_OWNER_ID: 'c4d818e5-08fb-418a-96f5-1c31629c9690',
      FACTORY_CODER_STAGING_OWNER_ID: '0137501a-b341-407c-b435-f7db8dbbef61',
      CODER_MCP_URL: `http://127.0.0.1:${port}/mcp`,
    },
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await fetch(`http://127.0.0.1:${port}/healthz`).then((response) => response.ok).catch(() => false)) return;
    await Bun.sleep(50);
  }
  throw new Error('BFF did not start with unavailable external services');
});

afterAll(async () => {
  child?.kill();
  if (child) await child.exited;
  if (database) await closeDatabase(database.sql);
});

test.skipIf(!databaseUrl)('serves diagnostics while Forgejo and Coder are unavailable', async () => {
  expect(await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).toMatchObject({ status: 'ok' });
  const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
  expect(ready.status).toBe(503);
  expect(await ready.json()).toMatchObject({ status: 'not-ready', dependencies: { database: 'ready', forgejo: 'not-ready', systems: 'not-ready' } });
});

test.skipIf(!databaseUrl)('rejects API mutation while external actors are unavailable', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/requirements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Blocked mutation', body: 'Must not reach Forgejo.' }),
  });

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'external services are not ready' });
  expect((await fetch(`http://127.0.0.1:${port}/auth/logout`, { method: 'POST', redirect: 'manual' })).status).toBe(303);
});
