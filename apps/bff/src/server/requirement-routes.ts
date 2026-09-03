/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import {
  answerInterviewBodySchema,
  boardCardSchema,
  boardResponseSchema,
  cardEventsResponseSchema,
  createRequirementBodySchema,
  interviewResponseSchema,
  interviewStateResponseSchema,
  requirementAcceptanceSchema,
  requirementProposalSchema,
  requirementSpecBodySchema,
  sharpenInterviewBodySchema,
  transitionRequirementBodySchema,
  updateRequirementBodySchema,
} from '@agentic-software-factory/api-contracts/kanban';
import {
  boardQuerySchema,
  emptyBodySchema,
  issueNumberParamSchema,
  requestContextQuerySchema,
} from '@agentic-software-factory/api-contracts/common';
import { apiErrorResponses } from '@agentic-software-factory/api-contracts/errors';
import { t } from 'elysia';
import type { ZodType } from 'zod';
import {
  actor,
  applicationIdsBelongToTeam,
  createAuthenticatedApi,
  errorResponse,
  forgejoDestination,
  issueNumber,
  mapError,
  persistedApplicationId,
  repositoryScope,
  requestScope,
  requireCapability,
} from './route-support';
import { answerInterview, sharpenInterview, startInterview, type InterviewOperationReconciler } from './interview-operations';
import type { ServerServices } from './types';
import { validateResponse } from './response-contracts';

async function validatedJsonResult<T>(schema: ZodType<T>, result: unknown, status = 200): Promise<Response> {
  if (result instanceof Response) {
    if (!result.ok) return result;
    return Response.json(validateResponse(schema, await result.json()), { status: result.status });
  }
  return Response.json(validateResponse(schema, result), { status });
}

export function requirementRoutes(
  services: ServerServices,
  interviewOperations: InterviewOperationReconciler,
  recordError: (request: Request, error: import('../errors').ApplicationError) => void,
) {
  return createAuthenticatedApi('requirement-routes', services)
    .get('/api/v1/board', async ({ query, request, identity }) => {
      const scope = await repositoryScope(request, identity!, services, typeof query['application'] === 'string' ? query['application'] : undefined);
      const cursor = typeof query['cursor'] === 'string' ? query['cursor'] : undefined;
      const board = await services.forgejo.board(scope, cursor);
      const implementationNumbers = [...(board.columns.implementation ?? []), ...(board.columns.done ?? [])]
        .map((card) => card.number);
      const deliveries = services.implementation
        ? await services.implementation.summaries(implementationNumbers, identity!, request.signal, scope.repository!.systemId).catch(() => new Map())
        : new Map();
      const definitions = (await services.applications.list()).filter((item) => item.team === scope.team);
      const names = new Map(definitions.map((item) => [item.id, item.name]));
      const application = typeof query['application'] === 'string' ? query['application'] : '';
      if (application && !names.has(application)) return errorResponse(404, 'application not found');
      return Response.json(validateResponse(boardResponseSchema, {
        ...board,
        columns: Object.fromEntries(
          Object.entries(board.columns).map(([status, cards]) => [
            status,
            cards
              .map((card) => ({
                ...card,
                systemId: scope.repository!.systemId,
                deliveryPhase: deliveries.get(card.number)?.phase ?? null,
                deliveryLabel: deliveries.get(card.number)?.nextAction ?? null,
                deliveryBlockers: deliveries.get(card.number)?.blockers ?? [],
                ...('url' in card && typeof card.url === 'string'
                  ? { url: forgejoDestination(services, card.url) }
                  : {}),
                applications: (card.applications ?? []).flatMap((item) => {
                  const id = persistedApplicationId(item.id, definitions);
                  return id ? [{ id, name: names.get(id)! }] : [];
                }),
              }))
              .filter((card) => !application || card.applications?.some((item) => item.id === application)),
          ]),
        ),
      }));
    }, { query: boardQuerySchema, response: { 200: boardResponseSchema, ...apiErrorResponses } })
    .post('/api/v1/requirements', async ({ body, request, identity }) => {
      const denied = requireCapability(identity!, services, 'requirementsCreate', 'business persona required');
      if (denied) return denied;
      const baseScope = requestScope(request, identity!, services);
      const requested = new URL(request.url).searchParams.get('team')?.trim() || undefined;
      if (!body.team && !requested && (baseScope.teams?.length ?? 0) > 1) return errorResponse(400, 'team is required');
      const team = body.team ?? requested ?? baseScope.teams?.[0];
      if (!team || !baseScope.teams?.includes(team)) return errorResponse(404, 'team board not found');
      if (requested && requested !== team) return errorResponse(400, 'team must match the selected board');
      if (body.applicationIds && body.applicationIds.length !== 1) return errorResponse(400, 'exactly one System is required');
      const selectedApplication = body.applicationIds?.[0];
      const scope = await repositoryScope(request, identity!, services, selectedApplication, team);
      if (body.applicationIds?.length && !await applicationIdsBelongToTeam(body.applicationIds, team, services)) {
        return errorResponse(404, 'application not found');
      }
      let card = await services.forgejo.createRequirement({ title: body.title, body: body.body.trim() || body.title.trim(), team }, scope);
      if (body.applicationIds?.length || body.assignee !== undefined) {
        card = await services.forgejo.updateRequirement(
          card.number,
          { ...(body.applicationIds ? { applicationIds: body.applicationIds } : {}), ...(body.assignee !== undefined ? { assignee: body.assignee } : {}), expectedUpdatedAt: card.updatedAt },
          scope,
        );
      }
      return Response.json(validateResponse(boardCardSchema, card), { status: 201 });
    }, {
      query: requestContextQuerySchema,
      body: createRequirementBodySchema,
      response: { 201: boardCardSchema, ...apiErrorResponses },
    })
    .patch('/api/v1/requirements/:number', async ({ params, body, request, identity }) => {
      const denied = requireCapability(identity!, services, 'requirementsEdit', 'business persona required');
      if (denied) return denied;
      if (body.applicationIds && body.applicationIds.length !== 1) return errorResponse(400, 'exactly one System is required');
      const requestedApplication = new URL(request.url).searchParams.get('application')?.trim() || undefined;
      if (body.applicationIds?.[0] && requestedApplication && body.applicationIds[0] !== requestedApplication) {
        return errorResponse(409, 'a requirement cannot move to another System');
      }
      const scope = await repositoryScope(request, identity!, services, requestedApplication ?? body.applicationIds?.[0]);
      if (body.applicationIds && !await applicationIdsBelongToTeam(body.applicationIds, scope.team!, services)) {
        return errorResponse(404, 'application not found');
      }
      if (body.title !== undefined || body.body !== undefined) {
        const current = await services.forgejo.getIssue(issueNumber(params.number), scope);
        if (current.status === 'implementation' || current.status === 'done') {
          return errorResponse(409, 'accepted requirements cannot be edited');
        }
      }
      return Response.json(validateResponse(
        boardCardSchema,
        await services.forgejo.updateRequirement(issueNumber(params.number), body, scope),
      ));
    }, {
      params: issueNumberParamSchema,
      query: requestContextQuerySchema,
      body: updateRequirementBodySchema,
      response: { 200: boardCardSchema, ...apiErrorResponses },
    })
    .delete('/api/v1/requirements/:number', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'requirementsClose', 'business persona required');
      if (denied) return denied;
      const number = issueNumber(params.number);
      const scope = await repositoryScope(request, identity!, services);
      const current = await services.forgejo.getIssue(number, scope);
      if (current.status === 'implementation' || current.status === 'done') {
        return errorResponse(409, 'requirements cannot be deleted after implementation starts');
      }
      await services.forgejo.closeRequirement(number, scope);
      return new Response(null, { status: 204 });
    }, {
      params: issueNumberParamSchema,
      query: requestContextQuerySchema,
      response: { 204: t.Void(), ...apiErrorResponses },
    })
    .patch('/api/v1/requirements/:number/status', async ({ params, body, request, identity }) => {
      const denied = requireCapability(identity!, services, 'requirementsMove', 'business persona required');
      if (denied) return denied;
      if (body.status === 'done') return errorResponse(403, 'done is controlled by completion policy');
      if (body.status === 'implementation') return errorResponse(409, 'confirm the specification to start implementation');
      const number = issueNumber(params.number);
      const scope = await repositoryScope(request, identity!, services);
      const card = await services.forgejo.getIssue(number, scope);
      const order = ['ideation', 'requirements', 'implementation', 'done'];
      const current = card.status;
      if (!current) return errorResponse(404, 'requirement not found');
      if (order.indexOf(body.status) < order.indexOf(current)) return errorResponse(409, 'requirements cannot move backward');
      return Response.json(validateResponse(
        boardCardSchema,
        await services.forgejo.transition(number, body.status, body.expectedUpdatedAt, scope),
      ));
    }, {
      params: issueNumberParamSchema,
      query: requestContextQuerySchema,
      body: transitionRequirementBodySchema,
      response: { 200: boardCardSchema, ...apiErrorResponses },
    })
    .get('/api/v1/requirements/:number/proposal', async ({ params, request, identity }) =>
      Response.json(validateResponse(
        requirementProposalSchema,
        await services.forgejo.getProposal(
          issueNumber(params.number),
          await repositoryScope(request, identity!, services),
        ),
      )), {
        params: issueNumberParamSchema,
        query: requestContextQuerySchema,
        response: { 200: requirementProposalSchema, ...apiErrorResponses },
      })
    .put('/api/v1/requirements/:number/proposal', async ({ params, body, request, identity }) => {
      const denied = requireCapability(identity!, services, 'requirementsPropose', 'business persona required');
      if (denied) return denied;
      try {
        return Response.json(validateResponse(
          requirementProposalSchema,
          await services.forgejo.propose(
            issueNumber(params.number),
            actor(identity!),
            body,
            undefined,
            await repositoryScope(request, identity!, services),
          ),
        ));
      }
      catch (error) { return mapError(error, 500, (mapped) => recordError(request, mapped)); }
    }, {
      params: issueNumberParamSchema,
      query: requestContextQuerySchema,
      body: requirementSpecBodySchema,
      response: { 200: requirementProposalSchema, ...apiErrorResponses },
    })
    .post('/api/v1/requirements/:number/accept', async ({ params, body, request, identity }) => {
      const denied = requireCapability(identity!, services, 'requirementsAccept', 'business persona required');
      if (denied) return denied;
      try {
        return Response.json(validateResponse(
          requirementAcceptanceSchema,
          await services.forgejo.accept(
            issueNumber(params.number),
            actor(identity!),
            body,
            await repositoryScope(request, identity!, services),
          ),
        ));
      }
      catch (error) { return mapError(error, 500, (mapped) => recordError(request, mapped)); }
    }, {
      params: issueNumberParamSchema,
      query: requestContextQuerySchema,
      body: requirementSpecBodySchema,
      response: { 200: requirementAcceptanceSchema, ...apiErrorResponses },
    })
    .get('/api/v1/requirements/:number/interview', async ({ params, request, identity }) => {
      const number = issueNumber(params.number);
      const scope = await repositoryScope(request, identity!, services);
      const interview = await services.forgejo.getInterview(number, scope);
      if (interview.state.pendingOperation && !interview.state.pendingOperation.failure) {
        interviewOperations.schedule(number, interview.state, scope.repository);
      }
      const agent = await services.coder.chatCapability(scope);
      if (interview.state.chatId) agent.chatUrl = services.coder.chatUrl(interview.state.chatId);
      return Response.json(validateResponse(interviewResponseSchema, { ...interview, agent }));
    }, {
      params: issueNumberParamSchema,
      query: requestContextQuerySchema,
      response: { 200: interviewResponseSchema, ...apiErrorResponses },
    })
    .post('/api/v1/requirements/:number/interview/start', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'requirementsInterview', 'business persona required');
      if (denied) return denied;
      const result = await startInterview(issueNumber(params.number), false, request, identity!, services);
      return validatedJsonResult(interviewStateResponseSchema, result);
    }, {
      params: issueNumberParamSchema,
      query: requestContextQuerySchema,
      body: emptyBodySchema,
      response: { 200: interviewStateResponseSchema, ...apiErrorResponses },
    })
    .post('/api/v1/requirements/:number/interview/retake', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'requirementsInterview', 'business persona required');
      if (denied) return denied;
      const result = await startInterview(issueNumber(params.number), true, request, identity!, services);
      return validatedJsonResult(interviewStateResponseSchema, result);
    }, {
      params: issueNumberParamSchema,
      query: requestContextQuerySchema,
      body: emptyBodySchema,
      response: { 200: interviewStateResponseSchema, ...apiErrorResponses },
    })
    .post('/api/v1/requirements/:number/interview', async ({ params, body, request, identity }) => {
      const denied = requireCapability(identity!, services, 'requirementsInterview', 'business persona required');
      if (denied) return denied;
      const result = await answerInterview(issueNumber(params.number), body, request, identity!, services, interviewOperations);
      return validatedJsonResult(interviewStateResponseSchema, result, 202);
    }, {
      params: issueNumberParamSchema,
      query: requestContextQuerySchema,
      body: answerInterviewBodySchema,
      response: { 202: interviewStateResponseSchema, ...apiErrorResponses },
    })
    .post('/api/v1/requirements/:number/interview/retry', async ({ params, request, identity }) => {
      const denied = requireCapability(identity!, services, 'requirementsInterview', 'business persona required');
      if (denied) return denied;
      const number = issueNumber(params.number);
      const scope = await repositoryScope(request, identity!, services);
      let state = (await services.forgejo.getInterview(number, scope)).state;
      if (!state.pendingOperation) return errorResponse(409, 'no pending interview operation');
      if (!state.pendingOperation.failure) return errorResponse(409, 'interview operation is still processing');
      if (state.pendingOperation.failure.retryable === false) return errorResponse(409, state.pendingOperation.failure.message);
      state = await services.forgejo.setInterviewOperationFailure(number, state.pendingOperation.operationId, null, scope);
      interviewOperations.schedule(number, state, scope.repository);
      return Response.json(validateResponse(interviewStateResponseSchema, { state }), { status: 202 });
    }, {
      params: issueNumberParamSchema,
      query: requestContextQuerySchema,
      body: emptyBodySchema,
      response: { 202: interviewStateResponseSchema, ...apiErrorResponses },
    })
    .post('/api/v1/requirements/:number/interview/sharpen', async ({ params, body, request, identity }) => {
      const denied = requireCapability(identity!, services, 'requirementsInterview', 'business persona required');
      if (denied) return denied;
      const result = await sharpenInterview(issueNumber(params.number), body.note, request, identity!, services);
      return validatedJsonResult(interviewStateResponseSchema, result);
    }, {
      params: issueNumberParamSchema,
      query: requestContextQuerySchema,
      body: sharpenInterviewBodySchema,
      response: { 200: interviewStateResponseSchema, ...apiErrorResponses },
    })
    .get('/api/v1/requirements/:number/events', async ({ params, request, identity }) => Response.json(validateResponse(
      cardEventsResponseSchema,
      { events: await services.forgejo.events(issueNumber(params.number), await repositoryScope(request, identity!, services)) },
    )), {
      params: issueNumberParamSchema,
      query: requestContextQuerySchema,
      response: { 200: cardEventsResponseSchema, ...apiErrorResponses },
    });
}
