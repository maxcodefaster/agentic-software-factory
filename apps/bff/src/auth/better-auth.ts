/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth, jwt } from 'better-auth/plugins';

import type { Database } from '../db';
import { authSchema } from '../db/schema';
import type { FactoryAuthConfig } from './config';
import { OIDC_SCOPES } from './config';

export const ENTRA_SCOPES = ['openid', 'profile', 'email'] as const;

export function entraRedirectUri(issuer: string): string {
  return `${issuer}/callback/upstream-oidc`;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function groupsForEntraRoles(roles: unknown, config: FactoryAuthConfig): string[] {
  const values = new Set(strings(roles));
  const groups = new Set<string>();
  const member = values.has('Factory.Member');
  const business = values.has('Factory.Business');
  const developer = values.has('Factory.Developer');
  const admin = values.has('Factory.Admin');
  const teamGroups = Object.entries(config.entra?.teamRoles ?? {})
    .filter(([role]) => values.has(role))
    .map(([, group]) => group);
  if (member || business || developer || admin || teamGroups.length > 0) groups.add(config.requiredGroup);
  if (business || admin) groups.add(config.personaGroups.business);
  if (developer || admin) groups.add(config.personaGroups.developer);
  if (admin) groups.add(config.personaGroups.admin);
  for (const group of admin ? Object.values(config.entra?.teamRoles ?? {}) : teamGroups) groups.add(group);
  return [...groups];
}

function username(user: Record<string, unknown>): string {
  const preferred = user.preferredUsername;
  if (typeof preferred === 'string' && preferred) return preferred;
  const email = typeof user.email === 'string' ? user.email : '';
  return email.split('@')[0] || String(user.id);
}

export function createFactoryAuth(db: Database, config: FactoryAuthConfig) {
  const entra = config.entra;
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    secret: config.secret,
    baseURL: config.issuer,
    basePath: '/',
    trustedOrigins: [new URL(config.issuer).origin, ...config.trustedOrigins],
    emailAndPassword: { enabled: config.mode === 'local', disableSignUp: true },
    rateLimit: {
      enabled: true,
      storage: 'memory',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 3 },
        '/request-password-reset': { window: 60, max: 3 },
        '/reset-password*': { window: 60, max: 3 },
        '/change-password': { window: 60, max: 5 },
        '/verify-password': { window: 60, max: 5 },
      },
    },
    account: { encryptOAuthTokens: true },
    user: {
      additionalFields: {
        preferredUsername: {
          type: 'string',
          required: false,
          defaultValue: '',
        },
        groups: {
          type: 'string[]',
          required: false,
          defaultValue: [],
        },
      },
    },
    session: {
      expiresIn: config.mode === 'local' ? 24 * 60 * 60 : 8 * 60 * 60,
      updateAge: 60 * 60,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const user = await db.query.user.findFirst({
              columns: { groups: true, deprovisionedAt: true },
              where: (table, { eq }) => eq(table.id, session.userId),
            });
            return !user?.deprovisionedAt && user?.groups.includes(config.requiredGroup) ? undefined : false;
          },
        },
      },
    },
    advanced: {
      cookiePrefix: 'factory',
      useSecureCookies: config.issuer.startsWith('https://'),
      ipAddress: {
        // The boundary remains the authoritative socket-aware limiter; this is a second process-local check.
        ipAddressHeaders: ['x-factory-client-ip'],
      },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.issuer.startsWith('https://'),
        path: '/',
      },
      database: { joins: true },
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    plugins: [
      jwt({
        jwks: {
          keyPairConfig: { alg: 'RS256', modulusLength: 3072 },
          rotationInterval: 60 * 60 * 24 * 30,
          gracePeriod: 60 * 60 * 24 * 30,
        },
        jwt: { issuer: config.issuer, audience: config.issuer },
        disableSettingJwtHeader: true,
      }),
      oauthProvider({
        loginPage: '/login',
        consentPage: '/consent',
        scopes: [...OIDC_SCOPES],
        grantTypes: ['authorization_code', 'refresh_token'],
        scopeExpirations: { 'mcp:call': '15m' },
        customAccessTokenClaims: ({ scopes }) => scopes.includes('mcp:call')
          ? { agentic_software_factory_audience: `${config.issuer}/mcp` }
          : {},
        allowDynamicClientRegistration: false,
        allowPublicClientPrelogin: true,
        clientRegistrationRequirePKCE: true,
        storeClientSecret: 'hashed',
        cachedTrustedClients: new Set(
          [config.coder?.clientId, config.forgejo?.clientId].filter(
            (clientId): clientId is string => clientId !== undefined,
          ),
        ),
        customIdTokenClaims: ({ user, scopes }) => ({
          ...(scopes.includes('profile') ? { preferred_username: username(user) } : {}),
          ...(scopes.includes('groups') ? { groups: strings(user.groups) } : {}),
        }),
        customUserInfoClaims: ({ user, scopes }) => ({
          ...(scopes.includes('profile') ? { preferred_username: username(user) } : {}),
          ...(scopes.includes('groups') ? { groups: strings(user.groups) } : {}),
        }),
      }),
      ...(entra
        ? [
            genericOAuth({
              config: [
                {
                  providerId: 'upstream-oidc',
                  name: 'Organization SSO',
                  discoveryUrl: `${entra.issuer}/.well-known/openid-configuration`,
                  accountIssuer: entra.issuer,
                  accountSubject: ({ profile }) => {
                    if (typeof profile.sub !== 'string' || !profile.sub) throw new Error('upstream OIDC sub is required');
                    return profile.sub;
                  },
                  requireIdTokenVerification: true,
                  clientId: entra.clientId,
                  clientSecret: entra.clientSecret,
                  redirectURI: entraRedirectUri(config.issuer),
                  scopes: [...ENTRA_SCOPES],
                  pkce: true,
                  requireEmailVerification: true,
                  overrideUserInfo: true,
                  mapProfileToUser: (profile) => {
                    if (typeof profile.sub !== 'string' || !profile.sub) throw new Error('upstream OIDC sub is required');
                    return {
                      emailVerified: true,
                      preferredUsername:
                        typeof profile.preferred_username === 'string'
                          ? profile.preferred_username
                          : (profile.email?.split('@')[0] ?? profile.sub),
                      groups: groupsForEntraRoles(profile.roles, config),
                    };
                  },
                },
              ],
            }),
          ]
        : []),
    ],
  });
}

export type FactoryAuth = ReturnType<typeof createFactoryAuth>;
