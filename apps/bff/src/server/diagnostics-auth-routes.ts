/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { sessionUserSchema } from '@agentic-software-factory/api-contracts/session';
import { consentContextSchema } from '@agentic-software-factory/api-contracts/auth';
import { capabilitiesFor, personasFor } from '../auth/authorization';
import {
  createAuthenticatedApi,
  errorResponse,
  isAdmin,
  metricLabel,
  personaGroups,
  requestScope,
  requireCapability,
  staticResponse,
  visibleTeams,
} from './route-support';
import type { ServerServices } from './types';
import { Elysia } from 'elysia';

const USER_DIRECTORY_LIMIT = 100;

function authHandler(services: ServerServices, request: Request): Promise<Response> | Response {
  return services.auth.handler?.(request) ?? errorResponse(404, 'not found');
}

async function authShell(services: ServerServices, request: Request): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = '/';
  const response = await staticResponse(new Request(url, request), services.webRoot, true);
  response.headers.set('cache-control', 'no-store');
  return response;
}

async function tenantAuthHandler(services: ServerServices, request: Request): Promise<Response> {
  const identity = await services.auth.authenticate(request);
  if (!identity) return authHandler(services, request);
  if (!identity.groups?.includes(services.tenant.group)) return errorResponse(403, 'tenant access denied');
  return authHandler(services, request);
}

export function diagnosticsApiRoutes(services: ServerServices) {
  return createAuthenticatedApi('diagnostics-api-routes', services)
    .get('/api/v1/users', async ({ request, identity }) => {
      const denied = requireCapability(identity!, services, 'requirementsEdit', 'business persona required');
      if (denied) return denied;
      const scope = requestScope(request, identity!, services, true);
      const teams = services.tenant.teams.filter((team) => scope.team ? team.slug === scope.team : scope.teams?.includes(team.slug));
      const groups = teams.some((team) => team.group === null)
        ? undefined
        : teams.flatMap((team) => team.group ? [team.group] : []);
      const directory = await services.listUsers({ groups, limit: USER_DIRECTORY_LIMIT });
      return { users: directory.users.map(({ email: _email, ...user }) => user) };
    })
    .get('/api/v1/session', ({ identity }) => {
      const name = identity!.name || identity!.username || identity!.email || '';
      const groups = personaGroups(services);
      return sessionUserSchema.parse({
        id: identity!.subject,
        email: identity!.email ?? '',
        displayName: name,
        initials: name ? [...name][0]!.toUpperCase() : 'U',
        teams: visibleTeams(identity!, services).map((team) => team.slug),
        ownerTeams: isAdmin(identity!, services) ? visibleTeams(identity!, services).map((team) => team.slug) : [],
        admin: isAdmin(identity!, services),
        personas: personasFor(identity!, groups),
        capabilities: capabilitiesFor(identity!, groups),
      });
    })
    .get('/api/v1/development-tools', async ({ request, identity }) => {
      const denied = requireCapability(identity!, services, 'developerWorkspaceCreate', 'developer persona required');
      if (denied) return denied;
      const claimsReady = Boolean(identity!.emailVerified && identity!.email && identity!.username);
      if (!claimsReady) return {
        claimsReady: false, coderIdentity: false, forgejoConnected: false, forgejoUsername: null,
        connectUrl: null, ready: false,
      };
      const tools = await services.coder.developmentTools(requestScope(request, identity!, services));
      return { claimsReady: true, ...tools, ready: tools.coderIdentity && tools.forgejoConnected };
    });
}

export function diagnosticsAuthRoutes(services: ServerServices, startedAt: number) {
  return new Elysia({ name: 'diagnostics-auth-routes', normalize: false })
    .get('/healthz', () => ({ status: 'ok', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }))
    .get('/metrics', async () => {
      if (!services.workspaceStartupSummary) return new Response('', { headers: { 'content-type': 'text/plain; version=0.0.4' } });
      const rows = await services.workspaceStartupSummary(new Date(Date.now() - 15 * 60_000));
      const lines = [
        '# HELP factory_workspace_startup_duration_milliseconds Workspace startup duration percentiles.',
        '# TYPE factory_workspace_startup_duration_milliseconds gauge',
        '# HELP factory_workspace_startup_attempts Workspace startup outcomes observed in the last 15 minutes.',
        '# TYPE factory_workspace_startup_attempts gauge',
      ];
      for (const row of rows) {
        const labels = `kind="${metricLabel(row.kind)}",cache_state="${metricLabel(row.cacheState)}",outcome="${metricLabel(row.outcome)}"`;
        lines.push(`factory_workspace_startup_attempts{${labels},window="15m"} ${row.count}`);
        if (row.p50Ms !== null) lines.push(`factory_workspace_startup_duration_milliseconds{${labels},quantile="0.50"} ${row.p50Ms}`);
        if (row.p95Ms !== null) lines.push(`factory_workspace_startup_duration_milliseconds{${labels},quantile="0.95"} ${row.p95Ms}`);
        if (row.p99Ms !== null) lines.push(`factory_workspace_startup_duration_milliseconds{${labels},quantile="0.99"} ${row.p99Ms}`);
      }
      return new Response(`${lines.join('\n')}\n`, { headers: { 'content-type': 'text/plain; version=0.0.4' } });
    })
    .get('/readyz', async ({ request }) => {
      const [database, forgejo, systemDependencies, systemStatus] = await Promise.allSettled([
        services.databaseReady?.() ?? services.auth.ready?.() ?? Promise.resolve(),
        services.forgejo.ready(request.signal),
        services.systemsReady?.() ?? Promise.resolve(),
        services.systemsStatus?.() ?? Promise.resolve(undefined),
      ]);
      const systemsReady = systemDependencies.status === 'fulfilled'
        && systemStatus.status === 'fulfilled'
        && systemStatus.value?.status !== 'not-ready';
      const dependencies = {
        database: database.status === 'fulfilled' ? 'ready' : 'not-ready',
        forgejo: forgejo.status === 'fulfilled' ? 'ready' : 'not-ready',
        ...(services.systemsReady || services.systemsStatus ? { systems: systemsReady ? 'ready' : 'not-ready' } : {}),
      } as const;
      const ready = database.status === 'fulfilled' && forgejo.status === 'fulfilled' && systemsReady;
      const systems = systemStatus.status === 'fulfilled' && systemStatus.value ? {
        status: systemStatus.value.status,
        counts: systemStatus.value.counts,
        onboarding: systemStatus.value.onboarding,
        registry: systemStatus.value.registry,
        staging: systemStatus.value.staging,
      } : undefined;
      return Response.json({ status: ready ? 'ready' : 'not-ready', dependencies, ...(systems ? { systems } : {}) }, { status: ready ? 200 : 503 });
    })
    .get('/statusz', async ({ request }) => {
      const identity = await services.auth.authenticate(request);
      if (!identity) return errorResponse(401, 'missing or invalid session');
      if (!identity.groups?.includes(services.tenant.group) || !isAdmin(identity, services)) {
        return errorResponse(403, 'admin access required');
      }
      const [interview, systems] = await Promise.allSettled([
        services.coder.interviewReadiness(request.signal),
        services.systemsStatus?.() ?? Promise.resolve(undefined),
      ]);
      return {
        status: 'ok',
        capabilities: {
          aiInterview: interview.status === 'fulfilled' && interview.value.available ? 'available' : 'unavailable',
          ...(interview.status === 'fulfilled' && interview.value.reason ? { aiInterviewReason: interview.value.reason } : {}),
        },
        ...(systems.status === 'fulfilled' && systems.value ? { systems: {
          status: systems.value.status,
          counts: systems.value.counts,
          onboarding: systems.value.onboarding,
          registry: systems.value.registry,
          staging: systems.value.staging,
        } } : services.systemsStatus ? { systems: { status: 'unavailable' } } : {}),
      };
    })
    .post('/api/v1/users/:id/deprovision', async ({ request, params }) => {
      const identity = await services.auth.authenticate(request);
      if (!identity) return errorResponse(401, 'missing or invalid session');
      if (!identity.groups?.includes(services.tenant.group)) return errorResponse(403, 'tenant access denied');
      if (!isAdmin(identity, services)) return errorResponse(403, 'admin access required');
      const id = params.id.trim();
      if (!/^[A-Za-z0-9:_-]{1,255}$/.test(id)) return errorResponse(400, 'invalid user id');
      if (id === identity.subject) return errorResponse(409, 'administrators cannot deprovision their own account');
      if (!services.deprovisionUser) return errorResponse(503, 'user deprovisioning is not configured');
      const result = await services.deprovisionUser(id);
      return result ? Response.json(result, { status: 202 }) : errorResponse(404, 'tenant user not found');
    })
    .get('/auth/config', () => services.auth.uiConfig)
    .get('/auth/consent-context', async ({ request }) => {
      const context = await services.auth.consentContext?.(request);
      return context ? consentContextSchema.parse(context) : errorResponse(400, 'invalid authorization request');
    })
    .post('/auth/logout', ({ request }) => services.auth.handle('logout', request))
    .get('/__factory/logout', ({ request }) => services.auth.logoutBridgeRequest?.(request) ?? errorResponse(404, 'not found'))
    .get('/login', ({ request }) => authShell(services, request))
    .head('/login', ({ request }) => authShell(services, request))
    .get('/consent', ({ request }) => authShell(services, request))
    .head('/consent', ({ request }) => authShell(services, request))
    .all('/sign-in/*', ({ request }) => authHandler(services, request))
    .all('/sign-up/*', ({ request }) => authHandler(services, request))
    .all('/callback/*', ({ request }) => authHandler(services, request))
    .all('/oauth2/authorize', ({ request }) => tenantAuthHandler(services, request))
    .all('/oauth2/token', ({ request }) => authHandler(services, request))
    .all('/oauth2/userinfo', ({ request }) => authHandler(services, request))
    .all('/oauth2/introspect', ({ request }) => authHandler(services, request))
    .all('/oauth2/revoke', ({ request }) => authHandler(services, request))
    .all('/oauth2/consent', ({ request }) => authHandler(services, request))
    .all('/oauth2/end-session', ({ request }) => authHandler(services, request))
    .all('/oauth2/*', ({ request }) => authHandler(services, request))
    .all('/get-session', ({ request }) => authHandler(services, request))
    .all('/sign-out', ({ request }) => authHandler(services, request))
    .all('/jwks', ({ request }) => authHandler(services, request))
    .get('/.well-known/openid-configuration', ({ request }) => authHandler(services, request))
    .get('/.well-known/oauth-authorization-server', ({ request }) => authHandler(services, request));
}
