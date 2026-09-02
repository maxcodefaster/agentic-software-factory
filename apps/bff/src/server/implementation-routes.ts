/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { MonitoringResponse } from '@agentic-software-factory/api-contracts/monitoring';
import { implementationRunsResponseSchema } from '@agentic-software-factory/api-contracts/implementation';
import {
  emptyBody,
  numberParams,
  reviewImplementationBody,
  runParams,
  startImplementationBody,
} from './schemas';
import {
  applicationForTeam,
  createAuthenticatedApi,
  errorResponse,
  implementationStartError,
  issueNumber,
  mapError,
  repositoryScope,
  requestScope,
  requireCapability,
  requireImplementationRunAccess,
} from './route-support';
import type { ServerServices } from './types';
import { validateResponse } from './response-contracts';

export function implementationRoutes(
  services: ServerServices,
  recordError: (request: Request, error: import('../errors').ApplicationError) => void,
) {
  return createAuthenticatedApi('implementation-routes', services)
    .get('/api/v1/requirements/:number/implementation-runs', async ({ params, request, identity }) => {
      if (!services.implementation) return errorResponse(503, 'implementation orchestration is not configured');
      const scope = await repositoryScope(request, identity!, services);
      await services.forgejo.getIssue(issueNumber(params.number), scope);
      try {
        return validateResponse(implementationRunsResponseSchema, {
          runs: await services.implementation.list(issueNumber(params.number), identity!, request.signal, scope.repository!.systemId),
        });
      }
      catch (error) { return mapError(error, 502, (mapped) => recordError(request, mapped)); }
    }, { params: numberParams })
    .post('/api/v1/requirements/:number/implementation-runs', async ({ params, body, request, identity }) => {
      const denied = requireCapability(identity!, services, 'implementationStart', 'developer persona required');
      if (denied) return denied;
      if (!services.implementation) return errorResponse(503, 'implementation orchestration is not configured');
      if (!identity!.emailVerified) return errorResponse(422, 'Verify your email address before starting implementation');
      const scope = await repositoryScope(request, identity!, services, body.applicationId);
      await services.forgejo.getIssue(issueNumber(params.number), scope);
      const application = await applicationForTeam(body.applicationId, scope.team!, services);
      if (!application) return errorResponse(404, 'Application not found');
      try { return Response.json(await services.implementation.start(issueNumber(params.number), body.applicationId, identity!, request.signal), { status: 202 }); }
      catch (error) { return implementationStartError(error); }
    }, { params: numberParams, body: startImplementationBody })
    .post('/api/v1/implementation-runs/:id/verification', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'implementationPrepare', 'business access required');
      if (denied) return denied;
      if (!services.implementation) return errorResponse(503, 'implementation orchestration is not configured');
      await requireImplementationRunAccess(params.id, request, identity!, services);
      try { return await services.implementation.prepareVerification(params.id, identity!, request.signal); }
      catch (error) { return mapError(error, 502, (mapped) => recordError(request, mapped)); }
    }, { params: runParams, body: emptyBody })
    .post('/api/v1/implementation-runs/:id/review', async ({ params, body, request, identity }) => {
      const denied = requireCapability(identity!, services, 'implementationReview', 'business access required');
      if (denied) return denied;
      if (!services.implementation) return errorResponse(503, 'implementation orchestration is not configured');
      await requireImplementationRunAccess(params.id, request, identity!, services);
      try { return await services.implementation.review(params.id, identity!, body.decision, body.body, request.signal); }
      catch (error) { return mapError(error, 502, (mapped) => recordError(request, mapped)); }
    }, { params: runParams, body: reviewImplementationBody })
    .post('/api/v1/implementation-runs/:id/complete', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'implementationComplete', 'business access required');
      if (denied) return denied;
      if (!services.implementation) return errorResponse(503, 'implementation orchestration is not configured');
      await requireImplementationRunAccess(params.id, request, identity!, services);
      try { return Response.json(await services.implementation.complete(params.id, identity!, request.signal), { status: 202 }); }
      catch (error) { return mapError(error, 502, (mapped) => recordError(request, mapped)); }
    }, { params: runParams, body: emptyBody })
    .post('/api/v1/implementation-runs/:id/workspace/stop', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'implementationStart', 'developer persona required');
      if (denied) return denied;
      if (!services.implementation) return errorResponse(503, 'implementation orchestration is not configured');
      await requireImplementationRunAccess(params.id, request, identity!, services);
      try { return await services.implementation.stopWorkspace(params.id, identity!, request.signal); }
      catch (error) { return mapError(error, 502, (mapped) => recordError(request, mapped)); }
    }, { params: runParams, body: emptyBody })
    .post('/api/v1/implementation-runs/:id/workspace/resume', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'implementationStart', 'developer persona required');
      if (denied) return denied;
      if (!services.implementation) return errorResponse(503, 'implementation orchestration is not configured');
      await requireImplementationRunAccess(params.id, request, identity!, services);
      try { return await services.implementation.resumeWorkspace(params.id, identity!, request.signal); }
      catch (error) { return mapError(error, 502, (mapped) => recordError(request, mapped)); }
    }, { params: runParams, body: emptyBody })
    .post('/api/v1/implementation-runs/:id/verification/retry', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'implementationPrepare', 'business access required');
      if (denied) return denied;
      if (!services.implementation) return errorResponse(503, 'implementation orchestration is not configured');
      await requireImplementationRunAccess(params.id, request, identity!, services);
      await services.implementation.retryVerification(params.id);
      return new Response(null, { status: 202 });
    }, { params: runParams, body: emptyBody })
    .post('/api/v1/implementation-runs/:id/complete/retry', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'implementationComplete', 'business access required');
      if (denied) return denied;
      if (!services.implementation) return errorResponse(503, 'implementation orchestration is not configured');
      await requireImplementationRunAccess(params.id, request, identity!, services);
      await services.implementation.retryCompletion(params.id);
      return new Response(null, { status: 202 });
    }, { params: runParams, body: emptyBody })
    .get('/api/v1/governance', async ({ request, identity }): Promise<MonitoringResponse | Response> => {
      const scope = requestScope(request, identity!, services);
      const workspaces = await services.coder.summary(scope).catch(() => ({ count: 0, workspaces: [], available: false }));
      const projectedWorkspaces = workspaces.workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        owner: workspace.owner ?? '',
        template: workspace.template,
        status: workspace.status,
        transition: workspace.transition ?? '',
        healthy: workspace.healthy,
        outdated: workspace.outdated ?? false,
        lastUsedAt: workspace.lastUsedAt,
        kind: workspace.parameters.workspace_kind === 'verification' ? 'verification' as const : 'developer' as const,
      }));
      return {
        generatedAt: new Date().toISOString(),
        workspaces: { available: workspaces.available, count: projectedWorkspaces.length, workspaces: projectedWorkspaces },
        capabilities: { board: 'forgejo-issues', identity: 'oidc', workspaces: 'coder-community' },
      };
    });
}
