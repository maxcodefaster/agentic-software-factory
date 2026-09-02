/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { capabilitiesFor } from '../auth/authorization';
import { coderAppUrl, workspaceForApplication } from '../applications/catalog';
import { applicationsResponseSchema } from '@agentic-software-factory/api-contracts/applications';
import {
  applicationParams,
  applicationWorkspaceParams,
  emptyBody,
  reassignApplicationBody,
  registerApplicationBody,
} from './schemas';
import {
  applicationForTeam,
  createAuthenticatedApi,
  errorResponse,
  forgejoDestination,
  isAdmin,
  isCommandAppUrl,
  listRegistrations,
  onboardedApplication,
  personaGroups,
  requestScope,
  requireCapability,
  systemId,
  visibleTeams,
} from './route-support';
import type { ServerServices } from './types';
import { validateResponse } from './response-contracts';

export function applicationRoutes(services: ServerServices) {
  return createAuthenticatedApi('application-routes', services)
    .get('/api/v1/applications', async ({ request, identity }) => {
      const scope = requestScope(request, identity!, services, true);
      const applications = (await services.applications.list()).filter((application) => application.team === scope.team);
      const canDevelop = capabilitiesFor(identity!, personaGroups(services)).developerWorkspaceCreate;
      const personal = canDevelop
        ? await services.coder.developerSummary(scope).catch(() => ({ count: 0, workspaces: [], available: false }))
        : { count: 0, workspaces: [], available: true };
      return validateResponse(applicationsResponseSchema, {
        applications: await Promise.all(applications.map(async (application) => {
          const staging = await services.staging?.snapshot(application.id) ?? null;
          const workspace = staging?.repositoryRef === application.defaultSha
            && staging.workspace?.parameters.repository_ref === application.defaultSha
            ? staging.workspace
            : null;
          const displayedWorkspace = workspace ?? (staging?.workspace?.healthy ? staging.workspace : null);
          const personalWorkspace = workspaceForApplication(application, personal.workspaces);
          return {
            id: application.id,
            team: application.team,
            name: application.name,
            description: application.description,
            status: displayedWorkspace?.healthy ? displayedWorkspace.status : staging?.reconciling ? 'starting' : displayedWorkspace?.status ?? 'unavailable',
            stagingPhase: staging?.phase ?? 'pending',
            stagingAttempts: staging?.attempts ?? 0,
            stagingUpdating: Boolean(displayedWorkspace && !workspace),
            healthy: displayedWorkspace?.healthy ?? false,
            workspaceId: personalWorkspace?.id ?? null,
            workspaceUrl: coderAppUrl(services.coderPublicUrl, personalWorkspace?.url),
            chatUrl: coderAppUrl(services.coderPublicUrl, personalWorkspace?.chatUrl),
            terminalUrl: coderAppUrl(services.coderPublicUrl, personalWorkspace?.terminalUrl),
            servicesUrl: coderAppUrl(services.coderPublicUrl, personalWorkspace?.apps.find((app) => isCommandAppUrl(app.url))?.url),
            newAgentUrl: null,
            ideUrl: coderAppUrl(services.coderPublicUrl, personalWorkspace?.ideUrl),
            apps: (displayedWorkspace?.apps ?? []).map((app) => ({ ...app, url: coderAppUrl(services.coderPublicUrl, app.url)! })),
            declaredApps: application.declaredApps,
            repositoryUrl: forgejoDestination(services, `/${application.repositoryOwner}/${application.repositoryName}`),
            releasesUrl: forgejoDestination(services, `/${application.repositoryOwner}/${application.repositoryName}/releases`),
          };
        })),
      });
    })
    .get('/api/v1/applications/onboarding/repositories', async ({ request, identity }) => {
      const denied = requireCapability(identity!, services, 'applicationsManage', 'developer persona required');
      if (denied) return denied;
      if (!services.applicationOnboarding) return errorResponse(503, 'application onboarding is not configured');
      return { repositories: await services.applicationOnboarding.availableRepositories(isAdmin(identity!, services) ? undefined : visibleTeams(identity!, services).map((team) => team.slug), request.signal) };
    })
    .get('/api/v1/applications/onboarding/attempts', async ({ identity }) => {
      const denied = requireCapability(identity!, services, 'applicationsManage', 'developer persona required');
      if (denied) return denied;
      if (!services.applicationOnboarding) return errorResponse(503, 'application onboarding is not configured');
      const visible = new Set(visibleTeams(identity!, services).map((team) => team.slug));
      const attempts = await services.applicationOnboarding.attempts();
      const registrations = await listRegistrations(services);
      const visibleSystemIds = new Set([
        ...attempts.filter((attempt) => visible.has(attempt.team)).map((attempt) => attempt.systemId),
        ...registrations.filter((registration) => visible.has(registration.team)).map(systemId),
      ]);
      return {
        attempts: attempts.filter((attempt) => visible.has(attempt.team)),
        loadErrors: services.applicationOnboarding.loadErrors().filter((error) => visibleSystemIds.has(error.systemId)),
      };
    })
    .post('/api/v1/applications/onboarding/register', async ({ body, request, identity }) => {
      const denied = requireCapability(identity!, services, 'applicationsManage', 'developer persona required');
      if (denied) return denied;
      if (!services.applicationOnboarding) return errorResponse(503, 'application onboarding is not configured');
      const visible = new Set(visibleTeams(identity!, services).map((team) => team.slug));
      if (!visible.has(body.team)) return errorResponse(404, 'team not found');
      const sourceTeam = await services.applicationOnboarding.teamFor(body.repository);
      if (sourceTeam && !visible.has(sourceTeam)) return errorResponse(404, 'repository not found');
      if (!sourceTeam && !isAdmin(identity!, services)
        && !await services.applicationOnboarding.canRegister(body.repository, [...visible], request.signal)) return errorResponse(404, 'repository not found');
      const application = await services.applicationOnboarding.register(body.repository, body.team, request.signal);
      return Response.json(onboardedApplication(application), { status: 202 });
    }, { body: registerApplicationBody })
    .patch('/api/v1/applications/:id/registration', async ({ params, body, request, identity }) => {
      const denied = requireCapability(identity!, services, 'applicationsManage', 'developer persona required');
      if (denied) return denied;
      if (!services.applicationOnboarding) return errorResponse(503, 'application onboarding is not configured');
      const visible = new Set(visibleTeams(identity!, services).map((team) => team.slug));
      if (!visible.has(body.team)) return errorResponse(404, 'team not found');
      if (!visible.has(await services.applicationOnboarding.teamFor(params.id) ?? '')) return errorResponse(404, 'application not found');
      return onboardedApplication(await services.applicationOnboarding.reassign(params.id, body.team, request.signal));
    }, { params: applicationParams, body: reassignApplicationBody })
    .delete('/api/v1/applications/:id/registration', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'applicationsManage', 'developer persona required');
      if (denied) return denied;
      if (!services.applicationOnboarding) return errorResponse(503, 'application onboarding is not configured');
      const visible = new Set(visibleTeams(identity!, services).map((team) => team.slug));
      if (!visible.has(await services.applicationOnboarding.teamFor(params.id) ?? '')) return errorResponse(404, 'application not found');
      await services.applicationOnboarding.unregister(params.id, request.signal);
      return new Response(null, { status: 204 });
    }, { params: applicationParams })
    .post('/api/v1/applications/:id/remediation', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'applicationsManage', 'developer persona required');
      if (denied) return denied;
      if (!services.applicationOnboarding) return errorResponse(503, 'application onboarding is not configured');
      const visible = new Set(visibleTeams(identity!, services).map((team) => team.slug));
      if (!visible.has(await services.applicationOnboarding.teamFor(params.id) ?? '')) return errorResponse(404, 'application not found');
      return Response.json(await services.applicationOnboarding.createRemediation(params.id, request.signal), { status: 201 });
    }, { params: applicationParams, body: emptyBody })
    .post('/api/v1/applications/:id/staging/retry', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'applicationsManage', 'developer persona required');
      if (denied) return denied;
      if (!services.staging) return errorResponse(503, 'staging reconciliation is not configured');
      const scope = requestScope(request, identity!, services, true);
      if (!await applicationForTeam(params.id, scope.team!, services)) return errorResponse(404, 'application not found');
      await services.staging.retry(params.id, request.signal);
      return new Response(null, { status: 202 });
    }, { params: applicationParams, body: emptyBody })
    .get('/api/v1/applications/:id/workspaces/:workspaceId', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'developerWorkspaceCreate', 'developer persona required');
      if (denied) return denied;
      const scope = requestScope(request, identity!, services, true);
      const application = await applicationForTeam(params.id, scope.team!, services);
      if (!application) return errorResponse(404, 'application not found');
      const workspace = await services.coder.developerWorkspaceById(application, params.workspaceId, scope);
      return developerWorkspaceResponse(workspace, services.coderPublicUrl);
    }, { params: applicationWorkspaceParams })
    .post('/api/v1/applications/:id/workspace', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'developerWorkspaceCreate', 'developer persona required');
      if (denied) return denied;
      const scope = requestScope(request, identity!, services, true);
      const application = await applicationForTeam(params.id, scope.team!, services);
      if (!application) return errorResponse(404, 'application not found');
      const create = () => services.coder.ensureDeveloperWorkspace(application, scope);
      const workspace = services.measureWorkspaceStartup
        ? await services.measureWorkspaceStartup({ systemId: application.id, kind: 'developer', sha: application.defaultSha, contractVersion: 1, cacheKey: `v1:${application.defaultSha}` }, create)
        : await create();
      return Response.json(developerWorkspaceResponse(workspace, services.coderPublicUrl), { status: workspace.healthy && workspace.ideUrl ? 201 : 202 });
    }, { params: applicationParams, body: emptyBody });
}

function developerWorkspaceResponse(workspace: import('./types').Workspace, coderPublicUrl: string) {
  return {
    workspaceId: workspace.id,
    workspaceUrl: coderAppUrl(coderPublicUrl, workspace.url),
    ideUrl: coderAppUrl(coderPublicUrl, workspace.ideUrl),
    terminalUrl: coderAppUrl(coderPublicUrl, workspace.terminalUrl),
    servicesUrl: coderAppUrl(coderPublicUrl, workspace.apps.find((app) => isCommandAppUrl(app.url))?.url),
    apps: workspace.apps.map((app) => ({ ...app, url: coderAppUrl(coderPublicUrl, app.url)! })),
  };
}
