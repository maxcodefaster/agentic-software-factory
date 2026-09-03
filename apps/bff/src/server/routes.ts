/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Elysia } from 'elysia';
import { createHttpBoundary, parseBoundedJson } from './boundary';
import { diagnosticsAuthRoutes } from './diagnostics-auth-routes';
import { factoryApiRoutes } from './factory-api-routes';
import {
  createInterviewOperationReconciler,
  type InterviewOperationReconciler,
} from './interview-operations';
import { mcpStaticRoutes } from './mcp-static-routes';
import { errorResponse, mapError } from './route-support';
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
        ? error.type === 'response'
          ? mapError(new Error('response validation failed'), 500, (mapped) => boundary.recordError(request, mapped))
          : errorResponse(400, 'invalid request')
        : code === 'PARSE' && !(typeof error === 'object' && error && 'status' in error)
          ? errorResponse(400, 'invalid request')
          : mapError(error, 500, (mapped) => boundary.recordError(request, mapped));
      boundary.onAfterResponse({ request, responseValue: response, set });
      return response;
    })
    .onAfterResponse((context) => boundary.onAfterResponse(context))
    .options('/*', () => new Response(null, { status: 204 }))
    .use(diagnosticsAuthRoutes(services, startedAt))
    .use(factoryApiRoutes(services, interviewOperations, recordError))
    .use(mcpStaticRoutes(services));
}
