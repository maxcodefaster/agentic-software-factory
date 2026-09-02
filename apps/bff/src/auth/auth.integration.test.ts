/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { resolve } from 'node:path';

import { createAuthCore } from '.';
import { bootstrapLocalUser } from './bootstrap-user';
import { FactoryAuthService } from './service';
import { UserDeprovisionStore } from './deprovision';
import type { FactoryAuthConfig } from './config';
import { pkceChallenge, sha256Base64Url } from './security';
import { createDatabase } from '../db';
import { closeDatabase, migrateDatabase } from '../db/migrate';
import {
  account,
  coderUserBinding,
  delivery,
  deliveryContributor,
  oauthAccessToken,
  oauthConsent,
  oauthRefreshToken,
  session,
  systemRegistration,
  user,
  verification,
} from '../db/schema';

const issuer = 'http://127.0.0.1:48080';
const containerName = `factory-auth-test-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const bootstrapPassword = `test-${crypto.randomUUID()}`;
const clients = [
  {
    clientId: 'coder-test',
    clientSecret: `coder-${crypto.randomUUID()}`,
    redirectUris: ['http://127.0.0.1:48081/oidc/callback'],
    policy: 'coder' as const,
  },
  {
    clientId: 'forgejo-test',
    clientSecret: `forgejo-${crypto.randomUUID()}`,
    redirectUris: ['http://127.0.0.1:48082/user/oauth2/factory/callback'],
    policy: 'forgejo-15' as const,
  },
];

let database: ReturnType<typeof createDatabase>;
let core: Awaited<ReturnType<typeof createAuthCore>>;
let service: FactoryAuthService;
let config: FactoryAuthConfig;
let startedContainer = false;
let requestSequence = 0;

function docker(...args: string[]): string {
  const result = Bun.spawnSync(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || `docker ${args[0]} failed`);
  return result.stdout.toString().trim();
}

async function waitForPostgres(databaseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const candidate = createDatabase(databaseUrl);
    try {
      await candidate.db.execute('select 1');
      await closeDatabase(candidate.sql);
      return;
    } catch {
      await closeDatabase(candidate.sql).catch(() => undefined);
      await Bun.sleep(250);
    }
  }
  throw new Error('PostgreSQL test container did not become ready');
}

function sessionCookie(response: Response): string {
  const value = response.headers.get('set-cookie')?.match(/factory\.session_token=([^;]+)/)?.[1];
  if (!value) throw new Error('Better Auth did not set a session cookie');
  return `factory.session_token=${value}`;
}

function request(path: string, init: RequestInit = {}): Request {
  const request = new Request(`${issuer}${path}`, init);
  requestSequence += 1;
  request.headers.set('x-factory-client-ip', `198.18.${Math.floor(requestSequence / 256) % 256}.${requestSequence % 256}`);
  return request;
}

async function oidcTokens(client: typeof clients[number], scope: string): Promise<{ accessToken: string; refreshToken?: string }> {
  const verifier = `v${'a'.repeat(63)}`;
  const challenge = await pkceChallenge(verifier);
  const redirectUri = client.redirectUris[0]!;
  const authorize = new URL('/oauth2/authorize', issuer);
  authorize.search = new URLSearchParams({
    response_type: 'code', client_id: client.clientId, redirect_uri: redirectUri,
    scope, state: crypto.randomUUID(), nonce: crypto.randomUUID(),
    ...(client.policy === 'coder' ? { code_challenge: challenge, code_challenge_method: 'S256' } : {}),
  }).toString();
  const initial = await core.handler(new Request(authorize));
  const login = new URL(initial.headers.get('location')!, issuer);
  const returnTo = `/oauth2/authorize${login.search}`;
  const signedIn = await core.handler(request('/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: issuer },
    body: JSON.stringify({ email: 'local-user@factory.test', password: bootstrapPassword, callbackURL: returnTo }),
  }));
  const cookie = sessionCookie(signedIn);
  const continuation = (await signedIn.json() as { url?: string }).url ?? returnTo;
  const authorized = await core.handler(new Request(new URL(continuation, issuer), { headers: { cookie } }));
  const code = new URL(authorized.headers.get('location')!).searchParams.get('code')!;
  const token = await core.handler(request('/oauth2/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: redirectUri,
      ...(client.policy === 'coder' ? { code_verifier: verifier } : {}),
    }),
  }));
  expect(token.status).toBe(200);
  const tokens = await token.json() as { access_token: string; refresh_token?: string };
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await core.handler(request('/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: issuer, 'x-real-ip': '127.0.0.1' },
    body: JSON.stringify({ email, password }),
  }));
  expect(response.status).toBe(200);
  return sessionCookie(response);
}

beforeAll(async () => {
  let databaseUrl = process.env.AUTH_INTEGRATION_POSTGRES_URL;
  if (!databaseUrl) {
    docker(
      'run', '--detach', '--rm', '--name', containerName,
      '--env', 'POSTGRES_PASSWORD=postgres', '--env', 'POSTGRES_DB=factory_auth_test',
      '--publish', '127.0.0.1::5432', 'postgres:16-alpine',
    );
    startedContainer = true;
    const port = docker('port', containerName, '5432/tcp').split(':').at(-1);
    databaseUrl = `postgres://postgres:postgres@127.0.0.1:${port}/factory_auth_test`;
    await waitForPostgres(databaseUrl);
  }

  database = createDatabase(databaseUrl);
  await migrateDatabase(database.db, resolve(import.meta.dir, '../../drizzle'));
  config = {
    mode: 'local',
    issuer,
    secret: `integration-${crypto.randomUUID()}-${crypto.randomUUID()}`,
    trustedOrigins: [],
    requiredGroup: 'tenant-factory',
    personaGroups: { admin: 'tenant-factory-admin', business: 'tenant-factory-business', developer: 'tenant-factory-developer' },
    coder: clients[0],
    forgejo: clients[1],
    bootstrapUser: {
      email: 'bootstrap-user@factory.test',
      password: bootstrapPassword,
      name: 'Bootstrap User',
      groups: ['tenant-factory'],
    },
  };
  core = await createAuthCore(database.db, config);
  await createAuthCore(database.db, config);
  service = new FactoryAuthService(core, config, database.db);

  await bootstrapLocalUser(database.db, {
    email: 'local-user@factory.test',
    password: bootstrapPassword,
    name: 'Local User',
    groups: ['tenant-factory'],
  });
  await bootstrapLocalUser(database.db, {
    email: 'outsider@factory.test',
    password: bootstrapPassword,
    name: 'Outsider',
    groups: [],
  });
}, 120_000);

afterAll(async () => {
  if (database) await closeDatabase(database.sql);
  if (startedContainer) docker('rm', '--force', containerName);
}, 30_000);

describe.skipIf(process.env.AUTH_INTEGRATION_SKIP === 'true')('Better Auth PostgreSQL integration', () => {
  test('publishes issuer-root discovery with the implemented provider routes', async () => {
    const response = await core.handler(request('/.well-known/openid-configuration'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      token_endpoint: `${issuer}/oauth2/token`,
      userinfo_endpoint: `${issuer}/oauth2/userinfo`,
      jwks_uri: `${issuer}/jwks`,
      code_challenge_methods_supported: ['S256'],
    });
  });

  test('blocks public sign-up and signs in a provisioned PostgreSQL-backed user', async () => {
    const signup = await core.handler(request('/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: issuer },
      body: JSON.stringify({ email: 'attacker@factory.test', password: bootstrapPassword, name: 'Attacker' }),
    }));
    expect(signup.status).toBe(400);
    const cookie = await signIn('local-user@factory.test', bootstrapPassword);
    const session = await core.handler(request('/get-session', { headers: { cookie } }));
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ user: { email: 'local-user@factory.test', name: 'Local User' } });

    const rejected = await core.handler(request('/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.test', cookie },
      body: JSON.stringify({ email: 'local-user@factory.test', password: bootstrapPassword }),
    }));
    expect(rejected.status).toBe(403);
  });

  test('refuses to create a session for a user outside the required tenant group', async () => {
    const response = await core.handler(request('/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: issuer },
      body: JSON.stringify({ email: 'outsider@factory.test', password: bootstrapPassword }),
    }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.getSetCookie().some((cookie) => cookie.includes('session_token'))).toBe(false);
  });

  test('idempotently bootstraps the optional local credential user', async () => {
    const cookie = await signIn('bootstrap-user@factory.test', bootstrapPassword);
    const session = await core.handler(request('/get-session', { headers: { cookie } }));
    expect(await session.json()).toMatchObject({
      user: {
        email: 'bootstrap-user@factory.test',
        emailVerified: true,
        name: 'Bootstrap User',
        preferredUsername: 'bootstrap-user',
      },
    });
    const rows = await database.db.query.user.findMany({
      columns: { id: true },
      where: (table, { eq }) => eq(table.email, 'bootstrap-user@factory.test'),
    });
    expect(rows).toHaveLength(1);
  });

  for (const client of clients) {
    test(`completes the supported authorization code flow for ${client.clientId}`, async () => {
      const verifier = `v${'a'.repeat(63)}`;
      const challenge = await pkceChallenge(verifier);
      const state = `state-${client.clientId}`;
      const redirectUri = client.redirectUris[0]!;
      const authorize = new URL('/oauth2/authorize', issuer);
      const authorizeParameters: Record<string, string> = {
        response_type: 'code',
        client_id: client.clientId,
        redirect_uri: redirectUri,
        scope: 'openid profile email groups',
        state,
        nonce: `nonce-${client.clientId}`,
      };
      if (client.clientId.includes('coder')) Object.assign(authorizeParameters, { code_challenge: challenge, code_challenge_method: 'S256' });
      authorize.search = new URLSearchParams(authorizeParameters).toString();

      const initial = await core.handler(new Request(authorize));
      expect(initial.status).toBe(302);
      const login = new URL(initial.headers.get('location')!, issuer);
      expect(login.pathname).toBe('/login');

      const returnTo = `/oauth2/authorize${login.search}`;
      const signedIn = await core.handler(request('/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: issuer },
        body: JSON.stringify({
          email: 'local-user@factory.test',
          password: bootstrapPassword,
          callbackURL: returnTo,
        }),
      }));
      expect(signedIn.status).toBe(200);
      const cookie = sessionCookie(signedIn);
      const continuation = (await signedIn.json() as { url?: string }).url ?? returnTo;
      const authorized = await core.handler(new Request(new URL(continuation, issuer), { headers: { cookie } }));
      expect(authorized.status).toBe(302);
      const callback = new URL(authorized.headers.get('location')!);
      expect(callback.origin + callback.pathname).toBe(redirectUri);
      expect(callback.searchParams.get('state')).toBe(state);
      expect(callback.searchParams.get('iss')).toBe(issuer);
      const code = callback.searchParams.get('code');
      expect(code).toBeTruthy();

      const token = await core.handler(request('/oauth2/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code!,
          redirect_uri: redirectUri,
          ...(client.clientId.includes('coder') ? { code_verifier: verifier } : {}),
        }),
      }));
      expect(token.status).toBe(200);
      const tokens = await token.json() as { access_token: string; id_token: string; refresh_token: string };
      expect(tokens.access_token).toBeTruthy();
      expect(tokens.id_token).toBeTruthy();
      expect(tokens.refresh_token).toBeUndefined();

      const userInfo = await core.handler(request('/oauth2/userinfo', {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      }));
      expect(userInfo.status).toBe(200);
      expect(await userInfo.json()).toMatchObject({
        email: 'local-user@factory.test',
        name: 'Local User',
        preferred_username: 'local-user',
        groups: ['tenant-factory'],
      });
      expect(await service.authenticate(request('/api/v1/session', {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      }))).toBeNull();

      const row = await database.db.query.oauthClient.findFirst({
        columns: { clientSecret: true, requirePKCE: true },
        where: (table, { eq }) => eq(table.clientId, client.clientId),
      });
      expect(row?.clientSecret).toBe(await sha256Base64Url(client.clientSecret));
      expect(row?.requirePKCE).toBe(client.clientId.includes('coder'));
    }, 30_000);
  }

  test('resolves consent display context from the signed authorization query', async () => {
    const cookie = await signIn('local-user@factory.test', bootstrapPassword);
    const authorize = new URL('/oauth2/authorize', issuer);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: clients[0]!.clientId,
      redirect_uri: clients[0]!.redirectUris[0]!,
      scope: 'openid profile email groups',
      state: 'consent-context',
      nonce: 'consent-context',
      code_challenge: 'consent-context-challenge',
      code_challenge_method: 'S256',
      prompt: 'consent',
    }).toString();

    const response = await core.handler(new Request(authorize, { headers: { cookie } }));
    expect(response.status).toBe(302);
    const consent = new URL(response.headers.get('location')!, issuer);
    expect(consent.pathname).toBe('/consent');
    expect(await service.consentContext(new Request(consent, { headers: { cookie } }))).toEqual({
      clientId: clients[0]!.clientId,
      clientName: 'Coder',
      scope: 'openid profile email groups',
    });
  });

  test('enforces the client-specific PKCE, state, and nonce policy before authorization', async () => {
    const authorize = (clientId: string, values: Record<string, string> = {}) => core.handler(request(`/oauth2/authorize?${new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: clients.find((client) => client.clientId === clientId)!.redirectUris[0]!,
      scope: 'openid', ...values,
    })}`));

    expect((await authorize('coder-test')).status).toBe(400);
    expect((await authorize('coder-test', { code_challenge: 'challenge', code_challenge_method: 'plain' })).status).toBe(400);
    expect((await authorize('forgejo-test', { nonce: 'nonce' })).status).toBe(400);
    expect((await authorize('forgejo-test', { state: 'state' })).status).toBe(302);
    expect((await authorize('forgejo-test', { state: 'state', nonce: 'nonce' })).status).toBe(302);
    expect((await authorize('forgejo-test', { state: 'state', code_challenge: 'challenge', code_challenge_method: 'S256' })).status).toBe(302);
    expect((await authorize('forgejo-test', { state: 'state', code_challenge: 'challenge', code_challenge_method: 'plain' })).status).toBe(400);
  });

  test('authenticates MCP only with a short-lived Coder token carrying the MCP scope', async () => {
    const coderTokens = await oidcTokens(clients[0]!, 'openid profile email groups offline_access mcp:call');
    const localUser = await database.db.query.user.findFirst({
      columns: { id: true }, where: (table, { eq }) => eq(table.email, 'local-user@factory.test'),
    });
    expect(coderTokens.refreshToken).toBeTruthy();
    expect(await service.authenticateMcp(request('/mcp', { headers: { authorization: `Bearer ${coderTokens.accessToken}` } }))).toBe(localUser!.id);
    const wrongAudience = new FactoryAuthService(core, { ...config, issuer: 'http://127.0.0.1:48090' });
    expect(await wrongAudience.authenticateMcp(request('/mcp', { headers: { authorization: `Bearer ${coderTokens.accessToken}` } }))).toBeNull();

    const forgejoTokens = await oidcTokens(clients[1]!, 'openid profile email groups');
    const unscopedCoderTokens = await oidcTokens(clients[0]!, 'openid profile email groups');
    expect(await service.authenticateMcp(request('/mcp', { headers: { authorization: `Bearer ${forgejoTokens.accessToken}` } }))).toBeNull();
    expect(await service.authenticateMcp(request('/mcp', { headers: { authorization: `Bearer ${unscopedCoderTokens.accessToken}` } }))).toBeNull();
    expect(await service.authenticateMcp(request('/mcp', { headers: { authorization: `Bearer ${coderTokens.accessToken}.tampered` } }))).toBeNull();

    await database.db.update(oauthAccessToken)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(oauthAccessToken.token, await sha256Base64Url(coderTokens.accessToken)));
    expect(await service.authenticateMcp(request('/mcp', { headers: { authorization: `Bearer ${coderTokens.accessToken}` } }))).toBeNull();

    const refreshed = await core.handler(request('/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${clients[0]!.clientId}:${clients[0]!.clientSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: coderTokens.refreshToken! }),
    }));
    expect(refreshed.status).toBe(200);
    const refreshedAccessToken = (await refreshed.json() as { access_token: string }).access_token;
    expect(await service.authenticateMcp(request('/mcp', { headers: { authorization: `Bearer ${refreshedAccessToken}` } }))).toBe(localUser!.id);
  }, 30_000);

  test('deprovision revokes cached sessions, OAuth grants, MCP access, codes, and the Coder binding', async () => {
    const cookie = await signIn('local-user@factory.test', bootstrapPassword);
    const tokens = await oidcTokens(clients[0]!, 'openid profile email groups offline_access mcp:call');
    const target = await database.db.query.user.findFirst({
      columns: { id: true }, where: (table, { eq }) => eq(table.email, 'local-user@factory.test'),
    });
    expect(target).toBeTruthy();
    await database.db.insert(coderUserBinding).values({ factoryUserId: target!.id, coderUserId: 'coder-user-1' }).onConflictDoNothing();
    await database.db.insert(systemRegistration).values({
      tenantId: 'factory', systemId: 'factory/deprovision-test', teamId: 'factory', forgejoOwner: 'factory', forgejoRepository: 'deprovision-test',
    }).onConflictDoNothing();
    await database.db.insert(delivery).values([
      { id: 'delivery-deprovision-active', requirementNumber: 41, tenantId: 'factory', systemId: 'factory/deprovision-test', acceptedDigest: 'digest-active', createdByUserId: target!.id },
      { id: 'delivery-deprovision-late', requirementNumber: 42, tenantId: 'factory', systemId: 'factory/deprovision-test', acceptedDigest: 'digest-late', createdByUserId: target!.id },
    ]).onConflictDoNothing();
    await database.db.insert(deliveryContributor).values({ deliveryId: 'delivery-deprovision-active', factoryUserId: target!.id }).onConflictDoNothing();

    const pendingAuthorize = new URL('/oauth2/authorize', issuer);
    pendingAuthorize.search = new URLSearchParams({
      response_type: 'code', client_id: clients[0]!.clientId, redirect_uri: clients[0]!.redirectUris[0]!,
      scope: 'openid profile', state: 'pending-state', nonce: 'pending-nonce',
      code_challenge: await pkceChallenge(`v${'b'.repeat(63)}`), code_challenge_method: 'S256',
    }).toString();
    const pending = await core.handler(new Request(pendingAuthorize, { headers: { cookie } }));
    expect(pending.status).toBe(302);
    const code = new URL(pending.headers.get('location')!).searchParams.get('code');
    expect(code).toBeTruthy();

    expect(await service.authenticate(new Request(`${issuer}/api/v1/session`, { headers: { cookie } }))).not.toBeNull();
    expect(await service.authenticateMcp(request('/mcp', { headers: { authorization: `Bearer ${tokens.accessToken}` } }))).toBe(target!.id);

    expect(await new UserDeprovisionStore(database.db).deprovision(target!.id, 'tenant-factory')).toMatchObject({
      id: target!.id, coderUserId: 'coder-user-1', coderDeprovisioned: false,
    });
    expect(await new UserDeprovisionStore(database.db).deprovision(target!.id, 'tenant-factory')).toMatchObject({
      id: target!.id, coderUserId: 'coder-user-1', coderDeprovisioned: false,
    });

    expect(await service.authenticate(new Request(`${issuer}/api/v1/session`, { headers: { cookie } }))).toBeNull();
    expect(await service.authenticateMcp(request('/mcp', { headers: { authorization: `Bearer ${tokens.accessToken}` } }))).toBeNull();
    const refresh = await core.handler(request('/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${clients[0]!.clientId}:${clients[0]!.clientSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken! }),
    }));
    expect(refresh.status).toBe(400);

    const [persisted] = await database.db.select().from(user).where(eq(user.id, target!.id));
    expect(persisted).toMatchObject({ id: target!.id, groups: [], deprovisionedCoderUserId: 'coder-user-1' });
    expect(persisted!.deprovisionedAt).toBeInstanceOf(Date);
    expect(await database.db.select().from(session).where(eq(session.userId, target!.id))).toHaveLength(0);
    expect(await database.db.select().from(oauthAccessToken).where(eq(oauthAccessToken.userId, target!.id))).toHaveLength(0);
    expect(await database.db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.userId, target!.id))).toHaveLength(0);
    expect(await database.db.select().from(oauthConsent).where(eq(oauthConsent.userId, target!.id))).toHaveLength(0);
    expect(await database.db.select().from(coderUserBinding).where(eq(coderUserBinding.factoryUserId, target!.id))).toHaveLength(0);
    expect(await database.db.select({ password: account.password, accessToken: account.accessToken, refreshToken: account.refreshToken })
      .from(account).where(eq(account.userId, target!.id))).toEqual([{ password: null, accessToken: null, refreshToken: null }]);
    expect((await database.db.select().from(verification)).some((row) => row.value.includes(target!.id))).toBe(false);
    expect(await database.db.select().from(delivery).where(eq(delivery.createdByUserId, target!.id))).toHaveLength(2);
    expect(await database.db.select().from(deliveryContributor).where(eq(deliveryContributor.factoryUserId, target!.id))).toHaveLength(1);
    expect(await new UserDeprovisionStore(database.db).pendingForgejoRevocations(target!.id)).toEqual([
      expect.objectContaining({
        deliveryId: 'delivery-deprovision-active', username: 'local-user', owner: 'factory', repository: 'deprovision-test',
        branch: 'factory/requirement-41-ision-active',
      }),
    ]);
    await expect(Promise.resolve(database.db.insert(session).values({
      id: 'late-session', token: 'late-session-token', userId: target!.id, expiresAt: new Date(Date.now() + 60_000),
    }))).rejects.toThrow('Failed query');
    await expect(Promise.resolve(database.db.insert(coderUserBinding).values({
      factoryUserId: target!.id, coderUserId: 'late-coder-user',
    }))).rejects.toThrow('Failed query');
    await expect(Promise.resolve(database.db.insert(deliveryContributor).values({
      deliveryId: 'delivery-deprovision-late', factoryUserId: target!.id,
    }))).rejects.toThrow('Failed query');
    await expect(Promise.resolve(database.db.update(user).set({ groups: ['tenant-factory'] }).where(eq(user.id, target!.id))))
      .rejects.toThrow('Failed query');
    await bootstrapLocalUser(database.db, {
      email: 'local-user@factory.test', password: bootstrapPassword, name: 'Local User', groups: ['tenant-factory'],
    });
    expect((await database.db.select({ groups: user.groups }).from(user).where(eq(user.id, target!.id)))[0]?.groups).toEqual([]);
  }, 30_000);

});
