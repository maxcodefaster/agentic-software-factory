/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { z } from 'zod';

import { loadAuthConfig, type FactoryAuthConfig } from './auth/config';
import { validateTrustedProxyCidrs } from './server/boundary';

const emptyUrl = z.string().trim().transform((value) => value.replace(/\/+$/, ''));
const requiredUrl = emptyUrl.pipe(z.url());

const environmentSchema = z.object({
  DATABASE_URL: z.string().trim().min(1),
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  FORGEJO_URL: requiredUrl,
  FORGEJO_PUBLIC_URL: requiredUrl,
  FORGEJO_TOKEN: z.string().trim().min(1),
  FORGEJO_IMPLEMENTATION_TOKEN: z.string().trim().min(1),
  FORGEJO_REVIEW_TOKEN: z.string().trim().min(1),
  FORGEJO_IMPLEMENTATION_USER: z.string().trim().min(1).default('factory-implementation'),
  FORGEJO_REVIEW_USER: z.string().trim().min(1).default('factory-review'),
  FORGEJO_CLONE_USER: z.string().trim().min(1).default('factory-clone'),
  FORGEJO_HUMAN_TEAM: z.string().trim().min(1).default('factory-users'),
  FORGEJO_OWNER: z.string().trim().min(1),
  FORGEJO_AUTHORIZED_OWNERS: z.string().trim().default(''),
  FORGEJO_BRANCH: z.string().trim().min(1).default('main'),
  FACTORY_CODER_ORGANIZATION: z.string().trim().min(1).default('default'),
  FACTORY_CODER_TEMPLATE: z.string().trim().min(1).default('agentic-software-factory'),
  FACTORY_TENANT_ID: z.string().trim().regex(/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/),
  FACTORY_TEAM_BOARDS: z.string().trim().default(''),
  FACTORY_WORKSPACE_NAMESPACE: z.string().trim().regex(/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/),
  CODER_URL: requiredUrl,
  CODER_PUBLIC_URL: requiredUrl,
  CODER_WILDCARD_ACCESS_URL: z.string().trim().regex(/^\*\.[a-z0-9.-]+$/i),
  CODER_TOKEN: z.string().trim().min(1),
  FACTORY_CODER_VERIFICATION_OWNER_ID: z.uuid(),
  FACTORY_CODER_VERIFICATION_OWNER: z.string().trim().regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/).default('factory-verification'),
  FACTORY_CODER_STAGING_OWNER_ID: z.uuid(),
  FACTORY_CODER_STAGING_OWNER: z.string().trim().regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/).default('factory-stage'),
  CODER_MCP_URL: requiredUrl,
  ALLOWED_ORIGINS: z.string().default(''),
  TRUSTED_PROXY_CIDRS: z.string().default(''),
  WEB_ROOT: z.string().trim().default(''),
  OTEL_EXPORTER_OTLP_ENDPOINT: emptyUrl.pipe(z.url()).optional(),
  OTEL_SERVICE_NAME: z.string().trim().min(1).max(128).default('agentic-software-factory-bff'),
});

export interface RuntimeConfig {
  databaseUrl: string;
  host: string;
  port: number;
  forgejo: { baseUrl: string; publicUrl: string; token: string; implementationToken: string; reviewToken: string; implementationUser: string; reviewUser: string; cloneUser: string; humanTeam: string; owner: string; authorizedOwners: string[]; branch: string };
  coder: { baseUrl: string; publicUrl: string; wildcardAccessUrl: string; token: string; mcpUrl: string; verificationOwnerId: string; verificationOwner: string; stagingOwnerId: string; stagingOwner: string };
  allowedOrigins: string[];
  trustedProxyCidrs: string[];
  webRoot?: string;
  otel?: { endpoint: string; serviceName: string };
  auth: FactoryAuthConfig;
  application: { team: string; coderOrganization: string; coderTemplate: string };
  tenant: { id: string; group: string; adminGroup: string; businessGroup: string; developerGroup: string; teams: Array<{ slug: string; displayName: string; group: string | null }>; workspaceNamespace: string };
}

export function loadRuntimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const value = environmentSchema.parse(env);
  const auth = loadAuthConfig(env);
  if (!auth.coder) throw new Error('CODER_OIDC_* is required for Coder MCP identity');
  const trustedProxyCidrs = list(value.TRUSTED_PROXY_CIDRS);
  validateTrustedProxyCidrs(trustedProxyCidrs);
  const configuredTeams = teamBoards(value.FACTORY_TEAM_BOARDS);
  if (configuredTeams.some((team) => team.slug === value.FACTORY_TENANT_ID)) {
    throw new Error('FACTORY_TEAM_BOARDS must not repeat FACTORY_TENANT_ID');
  }
  return {
    databaseUrl: value.DATABASE_URL,
    host: value.HOST,
    port: value.PORT,
    forgejo: {
      baseUrl: value.FORGEJO_URL,
      publicUrl: value.FORGEJO_PUBLIC_URL,
      token: value.FORGEJO_TOKEN,
      implementationToken: value.FORGEJO_IMPLEMENTATION_TOKEN,
      reviewToken: value.FORGEJO_REVIEW_TOKEN,
      implementationUser: value.FORGEJO_IMPLEMENTATION_USER,
      reviewUser: value.FORGEJO_REVIEW_USER,
      cloneUser: value.FORGEJO_CLONE_USER,
      humanTeam: value.FORGEJO_HUMAN_TEAM,
      owner: value.FORGEJO_OWNER,
      authorizedOwners: [...new Set([value.FORGEJO_OWNER, ...list(value.FORGEJO_AUTHORIZED_OWNERS)])],
      branch: value.FORGEJO_BRANCH,
    },
    coder: {
      baseUrl: value.CODER_URL,
      publicUrl: value.CODER_PUBLIC_URL,
      wildcardAccessUrl: value.CODER_WILDCARD_ACCESS_URL,
      token: value.CODER_TOKEN,
      verificationOwnerId: value.FACTORY_CODER_VERIFICATION_OWNER_ID,
      verificationOwner: value.FACTORY_CODER_VERIFICATION_OWNER,
      stagingOwnerId: value.FACTORY_CODER_STAGING_OWNER_ID,
      stagingOwner: value.FACTORY_CODER_STAGING_OWNER,
      mcpUrl: value.CODER_MCP_URL,
    },
    allowedOrigins: [...new Set([new URL(auth.issuer).origin, ...origins(value.ALLOWED_ORIGINS)])],
    trustedProxyCidrs,
    ...(value.WEB_ROOT ? { webRoot: value.WEB_ROOT } : {}),
    ...(value.OTEL_EXPORTER_OTLP_ENDPOINT ? { otel: { endpoint: value.OTEL_EXPORTER_OTLP_ENDPOINT, serviceName: value.OTEL_SERVICE_NAME } } : {}),
    auth,
    application: {
      team: value.FACTORY_TENANT_ID,
      coderOrganization: value.FACTORY_CODER_ORGANIZATION,
      coderTemplate: value.FACTORY_CODER_TEMPLATE,
    },
    tenant: {
      id: value.FACTORY_TENANT_ID,
      group: auth.requiredGroup,
      adminGroup: auth.personaGroups.admin,
      businessGroup: auth.personaGroups.business,
      developerGroup: auth.personaGroups.developer,
      teams: [{ slug: value.FACTORY_TENANT_ID, displayName: displayName(value.FACTORY_TENANT_ID), group: null }, ...configuredTeams],
      workspaceNamespace: value.FACTORY_WORKSPACE_NAMESPACE,
    },
  };
}

function teamBoards(value: string): Array<{ slug: string; displayName: string; group: string }> {
  if (!value) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('FACTORY_TEAM_BOARDS must be valid JSON'); }
  const result = z.array(z.object({
    slug: z.string().regex(/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/),
    displayName: z.string().trim().min(1).max(128),
    group: z.string().trim().min(1).max(256),
  }).strict()).parse(parsed);
  if (new Set(result.map((team) => team.slug)).size !== result.length) throw new Error('FACTORY_TEAM_BOARDS slugs must be unique');
  if (new Set(result.map((team) => team.group)).size !== result.length) throw new Error('FACTORY_TEAM_BOARDS groups must be unique');
  return result;
}

function displayName(slug: string): string {
  return slug.split('-').map((part) => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : '').join(' ');
}

function origins(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    const url = new URL(item);
    if (url.origin !== item || url.username || url.password) throw new Error(`ALLOWED_ORIGINS entry must be an exact origin: ${item}`);
    return url.origin;
  });
}

function list(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
