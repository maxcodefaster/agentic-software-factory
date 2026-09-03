/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { resolve, sep } from 'node:path';
import { Elysia } from 'elysia';
import {
  applicationErrorCodeForStatus,
  errorResponseSchema,
  type ErrorResponse,
} from '@agentic-software-factory/api-contracts/errors';

import type { SystemRegistration } from '../applications/catalog';
import { capabilitiesFor, type FactoryCapabilities, type PersonaGroups } from '../auth/authorization';
import { ApplicationError, type SanitizedErrorCause } from '../errors';
import { UpstreamHttpError, UpstreamTimeoutError } from '../integrations/fetch';
import type { Identity, RequestScope, ServerServices } from './types';
import { validateResponse } from './response-contracts';

export function errorResponse(status: number, message: string, details?: Omit<ErrorResponse, 'error' | 'code'>): Response {
  return Response.json(validateResponse(errorResponseSchema, {
    error: message,
    code: applicationErrorCodeForStatus(status),
    ...details,
  }), { status });
}

export function actor(identity: Identity): string {
  return identity.subject;
}

export function issueNumber(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw Object.assign(new Error('invalid issue number'), { status: 400 });
  return number;
}

export function isAdmin(identity: Identity, services: ServerServices): boolean {
  return identity.groups?.includes(services.tenant.adminGroup) ?? false;
}

export function personaGroups(services: ServerServices): PersonaGroups {
  return {
    admin: services.tenant.adminGroup,
    business: services.tenant.businessGroup,
    developer: services.tenant.developerGroup,
  };
}

export function visibleTeams(identity: Identity, services: ServerServices): Array<{ slug: string; displayName: string; group: string | null }> {
  if (isAdmin(identity, services)) return services.tenant.teams;
  return services.tenant.teams.filter((team) => team.group === null || identity.groups?.includes(team.group));
}

export function requestScope(request: Request, identity: Identity, services: ServerServices, requireTeam = false): RequestScope {
  const available = visibleTeams(identity, services);
  const requestedValue = new URL(request.url).searchParams.get('team');
  const requested = requestedValue?.trim() || null;
  if (requestedValue !== null && !requested) throw Object.assign(new Error('team is required'), { status: 400 });
  if (requested && !available.some((team) => team.slug === requested)) {
    throw Object.assign(new Error('team board not found'), { status: 404 });
  }
  if (requireTeam && !requested && available.length > 1) {
    throw Object.assign(new Error('team is required'), { status: 400 });
  }
  const team = requested ?? (requireTeam && available.length === 1 ? available[0]!.slug : undefined);
  if (requireTeam && !team) throw Object.assign(new Error('team board not found'), { status: 404 });
  return { identity, signal: request.signal, ...(team ? { team } : {}), teams: available.map((item) => item.slug) };
}

export async function listRegistrations(services: ServerServices): Promise<SystemRegistration[]> {
  return services.applications.listRegistrations?.() ?? services.applications.list().then((applications) => applications.map((application) => ({
    team: application.team,
    repositoryOwner: application.repositoryOwner,
    repositoryName: application.repositoryName,
    id: application.id,
  })));
}

export async function getRegistration(id: string, services: ServerServices): Promise<SystemRegistration | null> {
  return services.applications.getRegistration?.(id) ?? services.applications.get(id);
}

export function systemId(registration: SystemRegistration & { id?: string }): string {
  return registration.id ?? `${registration.repositoryOwner}/${registration.repositoryName}`;
}

export async function applicationForTeam(id: string, team: string, services: ServerServices) {
  const registration = await getRegistration(id, services);
  if (registration?.team !== team) return null;
  const application = await services.applications.get(id);
  return application ? { ...application, ...registration } : null;
}

export async function applicationIdsBelongToTeam(ids: readonly string[], team: string, services: ServerServices): Promise<boolean> {
  const registrations = await Promise.all(ids.map((id) => getRegistration(id, services)));
  return registrations.every((registration) => registration?.team === team);
}

export function persistedApplicationId(
  value: string,
  applications: ReadonlyArray<{ id: string }>,
): string | null {
  if (applications.some((application) => application.id === value)) return value;
  return applications.length === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? applications[0]!.id
    : null;
}

export async function repositoryScope(
  request: Request,
  identity: Identity,
  services: ServerServices,
  applicationId?: string,
  teamOverride?: string,
): Promise<RequestScope> {
  const base = requestScope(request, identity, services, teamOverride === undefined);
  const scope = teamOverride ? { ...base, team: teamOverride } : base;
  if (teamOverride && !base.teams?.includes(teamOverride)) throw Object.assign(new Error('team board not found'), { status: 404 });
  const requested = applicationId ?? new URL(request.url).searchParams.get('application')?.trim() ?? '';
  const registrations = (await listRegistrations(services)).filter((registration) => registration.team === scope.team);
  const registration = requested
    ? registrations.find((candidate) => systemId(candidate) === requested)
    : registrations.length === 1 ? registrations[0] : null;
  if (!registration) throw Object.assign(new Error(requested ? 'application not found' : 'application is required'), { status: requested ? 404 : 400 });
  return {
    ...scope,
    repository: { owner: registration.repositoryOwner, name: registration.repositoryName, systemId: systemId(registration) },
  };
}

export function requireCapability(
  identity: Identity,
  services: ServerServices,
  capability: keyof FactoryCapabilities,
  message: string,
): Response | undefined {
  return capabilitiesFor(identity, personaGroups(services))[capability] ? undefined : errorResponse(403, message);
}

export function createAuthenticatedApi(name: string, services: ServerServices) {
  return new Elysia({ name, normalize: false })
    .derive(async ({ request }) => ({ identity: await services.auth.authenticate(request) }))
    .onBeforeHandle(async ({ request, identity }) => {
      if (!identity) return errorResponse(401, 'missing or invalid session');
      if (!identity.groups?.includes(services.tenant.group)) return errorResponse(403, 'tenant access denied');
      if (services.systemsReady && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        try { await services.systemsReady(); }
        catch { return errorResponse(503, 'external services are not ready'); }
      }
      return undefined;
    });
}

export function onboardedApplication(application: import('../applications/catalog').ApplicationDefinition) {
  return {
    id: application.id,
    team: application.team,
    name: application.name,
    description: application.description,
    repositoryUrl: application.repositoryUrl,
  };
}

export function forgejoDestination(services: ServerServices, destination: string): string {
  if (!services.forgejoPublicUrl) return destination;
  const target = new URL(destination, services.forgejoPublicUrl);
  const login = new URL('/user/oauth2/Factory', services.forgejoPublicUrl);
  login.searchParams.set('redirect_to', `${target.pathname}${target.search}`);
  return login.toString();
}

function safeLogLabel(value: string, fallback: string): string {
  return /^[A-Za-z0-9 ._-]{1,64}$/.test(value) ? value : fallback;
}

export function classifyError(error: unknown, fallbackStatus = 500): ApplicationError {
  if (error instanceof ApplicationError) return error;
  if (error instanceof UpstreamHttpError) {
    const cause: SanitizedErrorCause = {
      type: 'upstream_http', service: safeLogLabel(error.service, 'upstream'), status: error.status,
      ...(error.requestId ? { requestId: error.requestId } : {}),
    };
    return new ApplicationError('dependency_failure', 502, 'upstream request failed', cause, { cause: error });
  }
  if (error instanceof UpstreamTimeoutError) {
    return new ApplicationError('dependency_failure', 502, 'upstream request failed', {
      type: 'upstream_timeout', service: safeLogLabel(error.service, 'upstream'), timeoutMs: error.timeoutMs,
    }, { cause: error });
  }
  const safeStatus = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number'
    && error.status >= 400 && error.status < 500
    ? error.status
    : null;
  const status = safeStatus ?? fallbackStatus;
  const message = safeStatus && error instanceof Error
    ? error.message
    : fallbackStatus === 502 ? 'upstream request failed' : 'internal server error';
  const code = fallbackStatus === 502 && !safeStatus ? 'dependency_failure' : applicationErrorCodeForStatus(status);
  const cause = !safeStatus ? { type: 'error' as const, name: error instanceof Error ? safeLogLabel(error.name, 'Error') : 'UnknownError' } : undefined;
  return new ApplicationError(code, status, message, cause, { cause: error });
}

export function mapError(error: unknown, fallbackStatus = 500, record?: (error: ApplicationError) => void): Response {
  const mapped = classifyError(error, fallbackStatus);
  record?.(mapped);
  const issues = mapped.status >= 400 && mapped.status < 500
    && typeof error === 'object' && error && 'issues' in error && Array.isArray(error.issues)
    ? { issues: error.issues }
    : undefined;
  return errorResponse(mapped.status, mapped.message, issues);
}

export function implementationStartError(error: unknown): Response {
  if (!(error instanceof Error)) return errorResponse(502, 'Implementation could not be started');
  const known: Record<string, [number, string]> = {
    'Coder delegation requires a verified email address': [422, 'Verify your email address before starting implementation'],
    'Coder delegation requires email and username claims': [422, 'Email and username are required before starting implementation'],
    'accepted specification is required': [409, 'Accept the requirement specification before starting implementation'],
    'application not found': [404, 'Application not found'],
    'the implementation branch can no longer be continued': [409, 'This implementation branch can no longer be continued'],
    'wait for the active implementation agent before continuing the branch': [409, 'Wait for the active implementation agent before continuing the branch'],
    'Connect Forgejo in Coder before creating a Developer workspace': [409, 'Connect Forgejo in Coder before starting implementation'],
  };
  const mapped = known[error.message];
  return mapped ? errorResponse(mapped[0], mapped[1]) : errorResponse(502, 'Implementation could not be started');
}

export function operationalLog(services: ServerServices, entry: Omit<import('./boundary').OperationalLog, 'timestamp' | 'level'>): void {
  const event = { timestamp: new Date().toISOString(), level: 'warn' as const, ...entry };
  if (services.log) services.log(event);
  else console.error(JSON.stringify(event));
}

export function metricLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

export function isCommandAppUrl(value: string): boolean {
  try {
    return new URL(value).pathname.endsWith('/terminal') && new URL(value).searchParams.has('app');
  } catch {
    return false;
  }
}

export async function requireImplementationRunAccess(id: string, request: Request, identity: Identity, services: ServerServices): Promise<void> {
  if (!services.implementation) throw Object.assign(new Error('implementation orchestration is not configured'), { status: 503 });
  const run = await services.implementation.requirementScope(id);
  const application = await getRegistration(run.systemId, services);
  const teams = visibleTeams(identity, services);
  if (!application || !teams.some((team) => team.slug === application.team)) {
    throw Object.assign(new Error('implementation run not found'), { status: 404 });
  }
  const query = new URL(request.url).searchParams;
  const selectedTeam = query.get('team')?.trim();
  const selectedSystem = query.get('application')?.trim();
  if ((selectedTeam && selectedTeam !== application.team) || (selectedSystem && selectedSystem !== run.systemId)) {
    throw Object.assign(new Error('implementation run not found'), { status: 404 });
  }
  await services.forgejo.getIssue(run.requirementNumber, {
    identity,
    signal: request.signal,
    team: application.team,
    teams: teams.map((team) => team.slug),
    repository: { owner: application.repositoryOwner, name: application.repositoryName, systemId: run.systemId },
  });
}

export function isPublicStaticPath(pathname: string): boolean {
  return /^\/[A-Za-z0-9][A-Za-z0-9_-]*[.-][A-Za-z0-9_-]{8,}\.(?:css|js)$/.test(pathname)
    || /^\/(?:bootstrap\.js|branding\.css|favicon\.(?:ico|svg))$/.test(pathname)
    || /^\/i18n\/[A-Za-z0-9_-]+\.json$/.test(pathname);
}

export function isBlockedStaticPath(pathname: string): boolean {
  return pathname.split('/').some((segment) => segment.startsWith('.'))
    || /\/[^/]+\.[^/]+$/.test(pathname);
}

export function isReservedRoutePath(pathname: string): boolean {
  return ['/api', '/auth', '/oauth2', '/mcp', '/.well-known', '/jwks', '/get-session', '/sign-in', '/sign-up', '/sign-out', '/callback', '/consent'].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function staticResponse(request: Request, webRoot: string | undefined, applicationShell = false): Promise<Response> {
  if (!webRoot) return errorResponse(404, 'not found');
  const root = resolve(webRoot);
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(request.url).pathname); }
  catch { return errorResponse(404, 'not found'); }
  if (isReservedRoutePath(pathname)) return errorResponse(404, 'not found');
  const publicStatic = isPublicStaticPath(pathname);
  if (!publicStatic && (isBlockedStaticPath(pathname) || !applicationShell)) return errorResponse(404, 'not found');
  const candidate = applicationShell ? resolve(root, 'index.html') : resolve(root, `.${pathname}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return errorResponse(404, 'not found');
  const file = Bun.file(candidate);
  const exists = await file.exists();
  const selected = exists ? file : Bun.file(resolve(root, 'index.html'));
  if (!await selected.exists()) return errorResponse(404, 'not found');
  const selectedPath = selected.name ?? '';
  const isIndex = selectedPath === resolve(root, 'index.html');
  const immutable = !isIndex && /(?:^|[.-])[A-Za-z0-9_-]{8,}(?=[.-])/.test(selectedPath.slice(root.length));
  return new Response(request.method === 'HEAD' ? null : selected, {
    headers: {
      'content-type': selected.type || 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'referrer-policy': isIndex ? 'same-origin' : 'no-referrer',
    },
  });
}
