/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { describe, expect, test } from 'bun:test';

import { loadRuntimeConfig } from './env';

const required = {
  DATABASE_URL: 'postgres://factory:secret@db/factory',
  AUTH_MODE: 'local',
  AUTH_ISSUER: 'https://factory.example',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  LOCAL_AUTH_EMAIL: 'admin@factory.test',
  LOCAL_AUTH_PASSWORD: 'local-password',
  FORGEJO_URL: 'https://forgejo.example/',
  FORGEJO_PUBLIC_URL: 'https://forgejo.example/',
  FORGEJO_TOKEN: 'token',
  FORGEJO_IMPLEMENTATION_TOKEN: 'implementation-token',
  FORGEJO_REVIEW_TOKEN: 'review-token',
  FORGEJO_OWNER: 'factory',
  FACTORY_TENANT_ID: 'factory',
  FACTORY_WORKSPACE_NAMESPACE: 'factory-workspaces',
  CODER_URL: 'https://coder.example',
  CODER_PUBLIC_URL: 'https://coder.example',
  CODER_WILDCARD_ACCESS_URL: '*.apps.coder.example',
  CODER_TOKEN: 'coder-token',
  CODER_OIDC_CLIENT_ID: 'agentic-software-factory-coder',
  CODER_OIDC_CLIENT_SECRET: 'coder-client-secret',
  CODER_OIDC_REDIRECT_URIS: 'https://coder.example/api/v2/users/oidc/callback',
  CODER_OIDC_POST_LOGOUT_REDIRECT_URIS: 'https://coder.example',
  FORGEJO_OIDC_CLIENT_ID: 'agentic-software-factory-forgejo',
  FORGEJO_OIDC_CLIENT_SECRET: 'forgejo-client-secret',
  FORGEJO_OIDC_REDIRECT_URIS: 'https://forgejo.example/user/oauth2/Factory/callback',
  FORGEJO_OIDC_POST_LOGOUT_REDIRECT_URIS: 'https://forgejo.example',
  FORGEJO_OIDC_COMPATIBILITY_MAJOR: '15',
  FACTORY_CODER_VERIFICATION_OWNER_ID: 'c4d818e5-08fb-418a-96f5-1c31629c9690',
  FACTORY_CODER_STAGING_OWNER_ID: '0137501a-b341-407c-b435-f7db8dbbef61',
  CODER_MCP_URL: 'https://factory.example/mcp',
};

describe('runtime environment', () => {
  test('parses defaults and optional integrations', () => {
    expect(loadRuntimeConfig(required)).toMatchObject({
      host: '0.0.0.0',
      port: 8080,
      forgejo: { baseUrl: 'https://forgejo.example', publicUrl: 'https://forgejo.example', reviewToken: 'review-token', implementationUser: 'factory-implementation', reviewUser: 'factory-review', cloneUser: 'factory-clone', humanTeam: 'factory-users', authorizedOwners: ['factory'], branch: 'main' },
      coder: { baseUrl: 'https://coder.example', token: 'coder-token', verificationOwnerId: required.FACTORY_CODER_VERIFICATION_OWNER_ID, verificationOwner: 'factory-verification', stagingOwnerId: required.FACTORY_CODER_STAGING_OWNER_ID, stagingOwner: 'factory-stage', restrictedAppSharing: 'authenticated' },
      allowedOrigins: ['https://factory.example'],
      trustedProxyCidrs: [],
      auth: { mode: 'local', issuer: 'https://factory.example', requiredGroup: 'tenant-factory' },
      application: { team: 'factory', coderOrganization: 'default', coderTemplate: 'agentic-software-factory' },
      tenant: {
        id: 'factory', group: 'tenant-factory', adminGroup: 'tenant-factory-admin',
        businessGroup: 'tenant-factory-business', developerGroup: 'tenant-factory-developer',
        teams: [{ slug: 'factory', displayName: 'Factory', group: null }],
        workspaceNamespace: 'factory-workspaces',
      },
    });
  });

  test('fails before startup when authoritative Forgejo settings are absent', () => {
    expect(() => loadRuntimeConfig({ ...required, FORGEJO_TOKEN: '' })).toThrow();
    expect(() => loadRuntimeConfig({ ...required, FORGEJO_REVIEW_TOKEN: '' })).toThrow();
  });

  test('requires the mandatory Coder and MCP interview configuration', () => {
    expect(() => loadRuntimeConfig({ ...required, CODER_URL: '' })).toThrow();
    expect(() => loadRuntimeConfig({ ...required, CODER_TOKEN: '' })).toThrow();
    expect(() => loadRuntimeConfig({ ...required, FACTORY_CODER_VERIFICATION_OWNER_ID: '' })).toThrow();
    expect(() => loadRuntimeConfig({ ...required, FACTORY_CODER_VERIFICATION_OWNER_ID: 'factory-verification' })).toThrow();
    expect(() => loadRuntimeConfig({ ...required, CODER_MCP_URL: '' })).toThrow();
    expect(() => loadRuntimeConfig({ ...required, CODER_OIDC_CLIENT_ID: '', CODER_OIDC_CLIENT_SECRET: '', CODER_OIDC_REDIRECT_URIS: '' })).toThrow('CODER_OIDC');
    expect(loadRuntimeConfig({
      ...required,
      CODER_MCP_URL: 'https://factory.example/mcp/',
    }).coder).toMatchObject({ mcpUrl: 'https://factory.example/mcp' });
  });

  test('accepts only exact CORS origins', () => {
    expect(loadRuntimeConfig({
      ...required,
      ALLOWED_ORIGINS: 'https://portal.example, https://admin.example:8443',
    }).allowedOrigins).toEqual([
      'https://factory.example',
      'https://portal.example',
      'https://admin.example:8443',
    ]);
    expect(() => loadRuntimeConfig({ ...required, ALLOWED_ORIGINS: 'https://portal.example/path' }))
      .toThrow('exact origin');
    expect(() => loadRuntimeConfig({ ...required, ALLOWED_ORIGINS: 'not-a-url' })).toThrow();
  });

  test('validates trusted proxy CIDRs', () => {
    expect(loadRuntimeConfig({
      ...required,
      TRUSTED_PROXY_CIDRS: '10.0.0.0/8, 2001:db8::/32',
    }).trustedProxyCidrs).toEqual(['10.0.0.0/8', '2001:db8::/32']);
    expect(() => loadRuntimeConfig({ ...required, TRUSTED_PROXY_CIDRS: '10.0.0.0/99' }))
      .toThrow('invalid trusted proxy CIDR');
  });

  test('requires verified PostgreSQL TLS, trusted proxies, and controlled egress in production', () => {
    const production = {
      ...required,
      FACTORY_ENVIRONMENT: 'production',
      DATABASE_URL: 'postgres://factory:secret@db/factory?sslmode=verify-full',
      DATABASE_TLS_CA: '-----BEGIN CERTIFICATE-----\nproduction-ca\n-----END CERTIFICATE-----',
      TRUSTED_PROXY_CIDRS: '10.20.0.0/16',
      HTTPS_PROXY: 'http://egress-proxy.factory-egress.svc.cluster.local:3128',
      FACTORY_CODER_AUTHENTICATED_APP_SCOPE_ACKNOWLEDGEMENT: 'deployment-wide',
    };
    expect(loadRuntimeConfig(production)).toMatchObject({
      databaseUrl: production.DATABASE_URL,
      databaseTlsCa: production.DATABASE_TLS_CA,
      trustedProxyCidrs: ['10.20.0.0/16'],
    });
    expect(() => loadRuntimeConfig({ ...production, DATABASE_URL: required.DATABASE_URL })).toThrow('sslmode=verify-full');
    expect(() => loadRuntimeConfig({ ...production, DATABASE_TLS_CA: '' })).toThrow('DATABASE_TLS_CA');
    expect(() => loadRuntimeConfig({ ...production, TRUSTED_PROXY_CIDRS: '' })).toThrow('TRUSTED_PROXY_CIDRS');
    expect(() => loadRuntimeConfig({ ...production, HTTPS_PROXY: undefined })).toThrow('HTTPS_PROXY');
    expect(() => loadRuntimeConfig({ ...production, CODER_OIDC_POST_LOGOUT_REDIRECT_URIS: '' })).toThrow('CODER_OIDC_POST_LOGOUT_REDIRECT_URIS');
    expect(() => loadRuntimeConfig({ ...production, FORGEJO_OIDC_POST_LOGOUT_REDIRECT_URIS: '' })).toThrow('FORGEJO_OIDC_POST_LOGOUT_REDIRECT_URIS');
    expect(() => loadRuntimeConfig({ ...production, FORGEJO_OIDC_POST_LOGOUT_REDIRECT_URIS: 'https://other.example' })).toThrow('production public URL');
    expect(() => loadRuntimeConfig({ ...production, FACTORY_CODER_AUTHENTICATED_APP_SCOPE_ACKNOWLEDGEMENT: '' })).toThrow('deployment-wide');
    expect(loadRuntimeConfig({
      ...production,
      FACTORY_CODER_RESTRICTED_APP_SHARING: 'owner',
      FACTORY_CODER_AUTHENTICATED_APP_SCOPE_ACKNOWLEDGEMENT: '',
    }).coder.restrictedAppSharing).toBe('owner');
  });

  test('keeps insecure PostgreSQL available only in explicit local mode', () => {
    expect(loadRuntimeConfig({ ...required, FACTORY_ENVIRONMENT: 'local' }).databaseTlsCa).toBeUndefined();
  });

  test('loads the one local bootstrap admin from local auth credentials', () => {
    expect(loadRuntimeConfig({ ...required, LOCAL_AUTH_EMAIL: ' Admin@Factory.Test ' }).auth.bootstrapUser).toEqual({
      email: 'admin@factory.test',
      password: 'local-password',
      name: 'Factory Admin',
      groups: ['tenant-factory', 'tenant-factory-admin', 'tenant-factory-business', 'tenant-factory-developer'],
    });
    expect(() => loadRuntimeConfig({ ...required, LOCAL_AUTH_PASSWORD: '' })).toThrow('LOCAL_AUTH_EMAIL and LOCAL_AUTH_PASSWORD');
  });

  test('derives tenant and persona groups from FACTORY_TENANT_ID', () => {
    const config = loadRuntimeConfig({ ...required, FACTORY_TENANT_ID: 'acme' });
    expect(config.tenant).toMatchObject({
      group: 'tenant-acme', adminGroup: 'tenant-acme-admin',
      businessGroup: 'tenant-acme-business', developerGroup: 'tenant-acme-developer',
    });
    expect(config.auth.personaGroups).toEqual({
      admin: 'tenant-acme-admin', business: 'tenant-acme-business', developer: 'tenant-acme-developer',
    });
  });

  test('loads team boards from identity groups without changing the tenant boundary', () => {
    const config = loadRuntimeConfig({
      ...required,
      FACTORY_TEAM_BOARDS: JSON.stringify([
        { slug: 'payments', displayName: 'Payments', group: 'team-payments' },
        { slug: 'operations', displayName: 'Operations', group: 'team-operations' },
      ]),
    });
    expect(config.tenant.teams).toEqual([
      { slug: 'factory', displayName: 'Factory', group: null },
      { slug: 'payments', displayName: 'Payments', group: 'team-payments' },
      { slug: 'operations', displayName: 'Operations', group: 'team-operations' },
    ]);
    expect(config.tenant.group).toBe('tenant-factory');
  });

  test('rejects duplicate or malformed team-board configuration', () => {
    expect(() => loadRuntimeConfig({ ...required, FACTORY_TEAM_BOARDS: '[{"slug":"factory","displayName":"Other","group":"other"}]' }))
      .toThrow('must not repeat');
    expect(() => loadRuntimeConfig({ ...required, FACTORY_TEAM_BOARDS: '[{"slug":"Bad Team","displayName":"Bad","group":"bad"}]' }))
      .toThrow();
  });

  test('loads deterministic tenant-specific Entra configuration and team roles', () => {
    const tenantId = '1c71f7e5-ef9e-40bd-93c9-9edaa53c5520';
    const entra = {
      ...required,
      AUTH_MODE: 'entra',
      LOCAL_AUTH_EMAIL: undefined,
      LOCAL_AUTH_PASSWORD: undefined,
      ENTRA_TENANT_ID: tenantId,
      ENTRA_CLIENT_ID: 'factory-client',
      ENTRA_CLIENT_SECRET: 'entra-client-secret',
      FACTORY_TEAM_BOARDS: '[{"slug":"payments","displayName":"Payments","group":"team-payments"}]',
    };
    expect(loadRuntimeConfig(entra).auth.entra).toEqual({
      tenantId,
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      clientId: 'factory-client',
      clientSecret: 'entra-client-secret',
      teamRoles: { 'Factory.Team.payments': 'team-payments' },
    });
    expect(loadRuntimeConfig(entra).auth.bootstrapUser).toBeUndefined();
    expect(() => loadRuntimeConfig({ ...entra, ENTRA_TENANT_ID: 'common' })).toThrow('tenant GUID');
  });

  test('requires one complete auth mode and rejects mixed credentials', () => {
    expect(() => loadRuntimeConfig({ ...required, AUTH_MODE: '' })).toThrow('AUTH_MODE is required');
    expect(() => loadRuntimeConfig({ ...required, AUTH_MODE: 'disabled' })).toThrow('AUTH_MODE must be local or entra');
    expect(() => loadRuntimeConfig({ ...required, ENTRA_CLIENT_ID: 'mixed' })).toThrow('ENTRA_* must not be configured');
    expect(() => loadRuntimeConfig({
      ...required, AUTH_MODE: 'entra', LOCAL_AUTH_EMAIL: undefined, LOCAL_AUTH_PASSWORD: undefined,
    })).toThrow('ENTRA_TENANT_ID, ENTRA_CLIENT_ID, and ENTRA_CLIENT_SECRET');
    expect(() => loadRuntimeConfig({
      ...required, AUTH_MODE: 'entra', ENTRA_TENANT_ID: crypto.randomUUID(), ENTRA_CLIENT_ID: 'client', ENTRA_CLIENT_SECRET: 'secret',
    })).toThrow('LOCAL_AUTH_* must not be configured');
  });

  test('binds the Forgejo no-PKCE policy to stock major 15', () => {
    const downstream = {
      ...required,
      FORGEJO_OIDC_CLIENT_ID: 'forgejo', FORGEJO_OIDC_CLIENT_SECRET: 'forgejo-client-secret',
      FORGEJO_OIDC_REDIRECT_URIS: 'https://forgejo.example/callback', FORGEJO_OIDC_COMPATIBILITY_MAJOR: '15',
    };
    expect(loadRuntimeConfig(downstream).auth.forgejo?.policy).toBe('forgejo-15');
    expect(() => loadRuntimeConfig({ ...downstream, FORGEJO_OIDC_COMPATIBILITY_MAJOR: '16' })).toThrow('must be 15');
  });

  test('rejects issuer URLs the provider would rewrite or the root router cannot serve', () => {
    expect(() => loadRuntimeConfig({ ...required, AUTH_ISSUER: 'http://factory.example' }))
      .toThrow('must use HTTPS');
    expect(() => loadRuntimeConfig({ ...required, AUTH_ISSUER: 'https://factory.example/auth' }))
      .toThrow('must not contain a path');
    expect(loadRuntimeConfig({ ...required, AUTH_ISSUER: 'http://127.0.0.1:8080' }).auth.issuer)
      .toBe('http://127.0.0.1:8080');
  });

  test('keeps downstream client IDs distinct', () => {
    expect(() => loadRuntimeConfig({
      ...required,
      CODER_OIDC_CLIENT_ID: 'shared', CODER_OIDC_CLIENT_SECRET: 'coder-secret', CODER_OIDC_REDIRECT_URIS: 'https://coder.example/callback',
      FORGEJO_OIDC_CLIENT_ID: 'shared', FORGEJO_OIDC_CLIENT_SECRET: 'forgejo-secret', FORGEJO_OIDC_REDIRECT_URIS: 'https://forgejo.example/callback',
    })).toThrow('must differ');
  });

});
