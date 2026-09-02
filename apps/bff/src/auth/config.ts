/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { z } from 'zod';
import { isIP } from 'node:net';
import type { PersonaGroups } from './authorization';

export const OIDC_SCOPES = ['openid', 'profile', 'email', 'groups', 'offline_access', 'mcp:call'] as const;

export interface FactoryIdentity {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string | null;
  preferredUsername: string;
  groups: string[];
}

export interface FactoryAuthConfig {
  mode: 'local' | 'entra';
  issuer: string;
  secret: string;
  trustedOrigins: string[];
  coderPublicUrl?: string;
  forgejoPublicUrl?: string;
  coderInternalUrl?: string;
  forgejoInternalUrl?: string;
  requiredGroup: string;
  personaGroups: PersonaGroups;
  coder?: ConfidentialClientConfig;
  forgejo?: ConfidentialClientConfig;
  entra?: EntraConfig;
  bootstrapUser?: BootstrapUserConfig;
}

export interface BootstrapUserConfig {
  email: string;
  password: string;
  name: string;
  groups: string[];
}

export interface ConfidentialClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  postLogoutRedirectUris?: string[];
  policy: 'coder' | 'forgejo-15';
}

export interface EntraConfig {
  issuer: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  teamRoles: Record<string, string>;
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function url(value: string, name: string): string {
  const parsed = new URL(value);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain credentials, a query, or a fragment`);
  }
  if (name === 'AUTH_ISSUER' && parsed.pathname !== '/') {
    throw new Error('AUTH_ISSUER must not contain a path');
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))) {
    throw new Error(`${name} must use HTTPS (HTTP is allowed only for loopback hosts)`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function internalUrl(value: string, name: string): string {
  const parsed = new URL(value);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials, query, or fragment`);
  }
  return parsed.toString().replace(/\/$/, '');
}

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  const version = isIP(normalized);
  if (version === 4) return normalized.startsWith('127.');
  return version === 6 && new URL(`http://[${normalized}]`).hostname === '[::1]';
}

function clientFromEnv(
  env: Record<string, string | undefined>,
  prefix: 'CODER' | 'FORGEJO',
): ConfidentialClientConfig | undefined {
  const clientId = env[`${prefix}_OIDC_CLIENT_ID`]?.trim();
  const clientSecret = env[`${prefix}_OIDC_CLIENT_SECRET`]?.trim();
  const redirectUris = list(env[`${prefix}_OIDC_REDIRECT_URIS`]);
  if (!clientId && !clientSecret && redirectUris.length === 0) return undefined;
  if (!clientId || !clientSecret || redirectUris.length === 0) {
    throw new Error(
      `${prefix}_OIDC_CLIENT_ID, ${prefix}_OIDC_CLIENT_SECRET, and ${prefix}_OIDC_REDIRECT_URIS must be configured together`,
    );
  }
  if (clientSecret.length < 16) throw new Error(`${prefix}_OIDC_CLIENT_SECRET must be at least 16 characters`);
  if (new Set(redirectUris).size !== redirectUris.length) throw new Error(`${prefix}_OIDC_REDIRECT_URIS must not contain duplicates`);
  const postLogoutRedirectUris = list(env[`${prefix}_OIDC_POST_LOGOUT_REDIRECT_URIS`]);
  if (new Set(postLogoutRedirectUris).size !== postLogoutRedirectUris.length) {
    throw new Error(`${prefix}_OIDC_POST_LOGOUT_REDIRECT_URIS must not contain duplicates`);
  }
  if (prefix === 'FORGEJO' && env.FORGEJO_OIDC_COMPATIBILITY_MAJOR?.trim() !== '15') {
    throw new Error('FORGEJO_OIDC_COMPATIBILITY_MAJOR must be 15 for the stock Forgejo no-PKCE policy');
  }
  return {
    clientId,
    clientSecret,
    redirectUris: redirectUris.map((value) => url(value, `${prefix}_OIDC_REDIRECT_URIS`)),
    postLogoutRedirectUris: postLogoutRedirectUris.map((value) => url(value, `${prefix}_OIDC_POST_LOGOUT_REDIRECT_URIS`)),
    policy: prefix === 'CODER' ? 'coder' : 'forgejo-15',
  };
}

export function loadAuthConfig(
  env: Record<string, string | undefined> = process.env,
): FactoryAuthConfig {
  const mode = required(env, 'AUTH_MODE');
  if (mode !== 'local' && mode !== 'entra') throw new Error('AUTH_MODE must be local or entra');
  const issuer = url(required(env, 'AUTH_ISSUER'), 'AUTH_ISSUER');
  if ((env.BETTER_AUTH_SECRET?.trim().length ?? 0) < 32) {
    throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
  }
  const localEmail = env.LOCAL_AUTH_EMAIL?.trim().toLowerCase();
  const localPassword = env.LOCAL_AUTH_PASSWORD;
  const entraTenantId = env.ENTRA_TENANT_ID?.trim();
  const entraClientId = env.ENTRA_CLIENT_ID?.trim();
  const entraClientSecret = env.ENTRA_CLIENT_SECRET?.trim();
  const localConfigured = Boolean(localEmail || localPassword);
  const entraConfigured = Boolean(entraTenantId || entraClientId || entraClientSecret);
  if (mode === 'local' && entraConfigured) throw new Error('ENTRA_* must not be configured when AUTH_MODE=local');
  if (mode === 'entra' && localConfigured) throw new Error('LOCAL_AUTH_* must not be configured when AUTH_MODE=entra');
  if (mode === 'local' && (!localEmail || !localPassword)) {
    throw new Error('LOCAL_AUTH_EMAIL and LOCAL_AUTH_PASSWORD are required when AUTH_MODE=local');
  }
  if (mode === 'entra' && (!entraTenantId || !entraClientId || !entraClientSecret)) {
    throw new Error('ENTRA_TENANT_ID, ENTRA_CLIENT_ID, and ENTRA_CLIENT_SECRET are required when AUTH_MODE=entra');
  }
  if (localEmail && !z.email().safeParse(localEmail).success) throw new Error('LOCAL_AUTH_EMAIL must be a valid email address');
  if (localPassword && (localPassword.length < 8 || localPassword.length > 128)) {
    throw new Error('LOCAL_AUTH_PASSWORD must be between 8 and 128 characters');
  }
  if (entraTenantId && !z.uuid().safeParse(entraTenantId).success) throw new Error('ENTRA_TENANT_ID must be a tenant GUID');

  const coderClientId = env.CODER_OIDC_CLIENT_ID?.trim();
  const forgejoClientId = env.FORGEJO_OIDC_CLIENT_ID?.trim();
  if (coderClientId && forgejoClientId && coderClientId === forgejoClientId) {
    throw new Error('CODER_OIDC_CLIENT_ID and FORGEJO_OIDC_CLIENT_ID must differ');
  }

  const factoryTenantId = required(env, 'FACTORY_TENANT_ID');
  const tenantGroup = `tenant-${factoryTenantId}`;
  const personaGroups: PersonaGroups = {
    admin: `${tenantGroup}-admin`,
    business: `${tenantGroup}-business`,
    developer: `${tenantGroup}-developer`,
  };
  const teamRoles = teamBoardRoles(env.FACTORY_TEAM_BOARDS);
  return {
    mode,
    issuer,
    secret: required(env, 'BETTER_AUTH_SECRET'),
    trustedOrigins: list(env.AUTH_TRUSTED_ORIGINS).map((value) => {
      const parsed = new URL(url(value, 'AUTH_TRUSTED_ORIGINS'));
      if (parsed.pathname !== '/') throw new Error('AUTH_TRUSTED_ORIGINS entries must be origins');
      return parsed.origin;
    }),
    ...(env.CODER_PUBLIC_URL?.trim() ? { coderPublicUrl: url(env.CODER_PUBLIC_URL.trim(), 'CODER_PUBLIC_URL') } : {}),
    ...(env.FORGEJO_PUBLIC_URL?.trim() ? { forgejoPublicUrl: url(env.FORGEJO_PUBLIC_URL.trim(), 'FORGEJO_PUBLIC_URL') } : {}),
    ...(env.CODER_URL?.trim() ? { coderInternalUrl: internalUrl(env.CODER_URL.trim(), 'CODER_URL') } : {}),
    ...(env.FORGEJO_URL?.trim() ? { forgejoInternalUrl: internalUrl(env.FORGEJO_URL.trim(), 'FORGEJO_URL') } : {}),
    coder: clientFromEnv(env, 'CODER'),
    forgejo: clientFromEnv(env, 'FORGEJO'),
    entra: mode === 'entra'
      ? {
          issuer: `https://login.microsoftonline.com/${entraTenantId!}/v2.0`,
          tenantId: entraTenantId!,
          clientId: entraClientId!,
          clientSecret: entraClientSecret!,
          teamRoles,
        }
      : undefined,
    bootstrapUser: mode === 'local'
      ? {
          email: localEmail!,
          password: localPassword!,
          name: 'Factory Admin',
          groups: [tenantGroup, personaGroups.admin, personaGroups.business, personaGroups.developer, ...Object.values(teamRoles)],
        }
      : undefined,
    requiredGroup: tenantGroup,
    personaGroups,
  };
}

function teamBoardRoles(source: string | undefined): Record<string, string> {
  if (!source?.trim()) return {};
  try {
    const value = JSON.parse(source) as unknown;
    if (!Array.isArray(value)) return {};
    return Object.fromEntries(value.flatMap((team) => {
      if (typeof team !== 'object' || team === null) return [];
      const { slug, group } = team as { slug?: unknown; group?: unknown };
      return typeof slug === 'string' && slug && typeof group === 'string' && group.trim()
        ? [[`Factory.Team.${slug}`, group.trim()]]
        : [];
    }));
  } catch {
    return {};
  }
}
