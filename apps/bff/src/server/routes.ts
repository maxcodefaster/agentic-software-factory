/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Elysia } from 'elysia';
import { applicationRoutes } from './application-routes';
import { createHttpBoundary, parseBoundedJson } from './boundary';
import { diagnosticsApiRoutes, diagnosticsAuthRoutes } from './diagnostics-auth-routes';
import { implementationRoutes } from './implementation-routes';
import {
  createInterviewOperationReconciler,
  type InterviewOperationReconciler,
} from './interview-operations';
import { mcpStaticRoutes } from './mcp-static-routes';
import { errorResponse, mapError } from './route-support';
import { requirementRoutes } from './requirement-routes';
import type { ServerServices } from './types';

export { createInterviewOperationReconciler } from './interview-operations';
export type { InterviewOperationReconciler } from './interview-operations';

export function createServer(
  services: ServerServices,
  interviewOperations: InterviewOperationReconciler = createInterviewOperationReconciler(services),
) {
  const startedAt = services.startedAt ?? Date.now();
  const boundary = createHttpBoundary(services);
  const recordError = (request: Request, error: import('../errors').ApplicationError) => boundary.recordError(request, error);

  return new Elysia({ name: 'agentic-software-factory-server', normalize: false })
    .onRequest((context) => boundary.onRequest(context))
    .onParse(({ request }) => request.headers.get('content-type')?.toLowerCase().startsWith('application/json')
      ? parseBoundedJson(request)
      : null)
    .onError(({ error, code, request, set }) => {
      const response = code === 'VALIDATION'
        ? errorResponse(400, 'invalid request')
        : code === 'PARSE' && !(typeof error === 'object' && error && 'status' in error)
          ? errorResponse(400, 'invalid request')
          : mapError(error, 500, (mapped) => boundary.recordError(request, mapped));
      boundary.onAfterResponse({ request, responseValue: response, set });
      return response;
    })
    .onAfterResponse((context) => boundary.onAfterResponse(context))
    .options('/*', () => new Response(null, { status: 204 }))
    .use(diagnosticsAuthRoutes(services, startedAt))
    .use(diagnosticsApiRoutes(services))
    .use(applicationRoutes(services))
    .use(requirementRoutes(services, interviewOperations, recordError))
    .use(implementationRoutes(services, recordError))
    .use(mcpStaticRoutes(services));
}
