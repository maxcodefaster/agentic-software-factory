/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import type { Database } from '@agentic-software-factory/db';
import { createFactoryAuth, ENTRA_SCOPES, entraRedirectUri, groupsForEntraRoles } from './better-auth';
import type { FactoryAuthConfig } from './config';

function config(): FactoryAuthConfig {
  return {
    mode: 'local',
    issuer: 'https://factory.example',
    secret: `test-${crypto.randomUUID()}-${crypto.randomUUID()}`,
    trustedOrigins: [],
    requiredGroup: 'tenant-factory',
    personaGroups: { admin: 'factory-admin', business: 'factory-business', developer: 'factory-developer' },
  };
}

afterEach(() => mock.restore());

describe('Better Auth security policy', () => {
  test('rate limits email credential attempts and uses the configured session lifetime', async () => {
    const auth = createFactoryAuth({} as Database, config());
    const request = () => auth.handler(new Request('https://factory.example/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://factory.example', 'x-factory-client-ip': '192.0.2.25' },
      body: '{}',
    }));

    for (let attempt = 0; attempt < 5; attempt += 1) expect((await request()).status).toBe(400);
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('x-retry-after'))).toBeGreaterThan(0);
    const options = (await auth.$context).options;
    expect(options.session?.expiresIn).toBe(24 * 60 * 60);
    expect(Object.keys(options.rateLimit?.customRules ?? {})).toEqual([
      '/sign-in/email',
      '/sign-up/email',
      '/request-password-reset',
      '/reset-password*',
      '/change-password',
      '/verify-password',
    ]);
  });

  test('maps only supported Entra App Roles and expands admin access', () => {
    const entra = {
      ...config(),
      mode: 'entra' as const,
      entra: {
        issuer: `https://login.microsoftonline.com/${crypto.randomUUID()}/v2.0`,
        tenantId: crypto.randomUUID(), clientId: 'client', clientSecret: 'secret',
        teamRoles: { 'Factory.Team.payments': 'team-payments', 'Factory.Team.core': 'team-core' },
      },
    };
    expect(groupsForEntraRoles(['Factory.Member', 'untrusted', 'Factory.Team.payments'], entra))
      .toEqual(['tenant-factory', 'team-payments']);
    expect(groupsForEntraRoles(['Factory.Business'], entra))
      .toEqual(['tenant-factory', 'factory-business']);
    expect(groupsForEntraRoles(['Factory.Developer'], entra))
      .toEqual(['tenant-factory', 'factory-developer']);
    expect(groupsForEntraRoles(['Factory.Admin'], entra)).toEqual([
      'tenant-factory', 'factory-business', 'factory-developer', 'factory-admin', 'team-payments', 'team-core',
    ]);
    expect(groupsForEntraRoles(['Factory.Team.unknown'], entra)).toEqual([]);
  });

  test('uses fixed Entra scopes and the canonical callback path', async () => {
    const tenantId = crypto.randomUUID();
    const entraIssuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
    spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      issuer: entraIssuer,
      authorization_endpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
      token_endpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      jwks_uri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    }));
    const auth = createFactoryAuth({} as Database, {
      ...config(), mode: 'entra',
      entra: { issuer: entraIssuer, tenantId, clientId: 'client', clientSecret: 'secret', teamRoles: {} },
    });
    expect(ENTRA_SCOPES).toEqual(['openid', 'profile', 'email']);
    expect(entraRedirectUri('https://factory.example')).toBe('https://factory.example/callback/upstream-oidc');
    const callback = await auth.handler(new Request('https://factory.example/callback/upstream-oidc'));
    expect(new URL(callback.headers.get('location')!).searchParams.get('error')).toBe('state_not_found');
  });
});
