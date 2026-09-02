/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { Elysia } from 'elysia';
import { createMcpServer } from './mcp';
import { dispatchMcp } from './transport';
import {
  errorResponse,
  isBlockedStaticPath,
  isPublicStaticPath,
  isReservedRoutePath,
  staticResponse,
} from './route-support';
import type { Identity, ServerServices } from './types';

function authInfo(identity: Identity, signal: AbortSignal): AuthInfo {
  return {
    token: 'agentic-software-factory',
    clientId: identity.issuer,
    scopes: [],
    extra: { identity, signal },
  };
}

async function mcpIdentity(request: Request, services: ServerServices): Promise<Identity | null> {
  const factoryUserId = await services.auth.authenticateMcp(request);
  return factoryUserId ? await services.identityByUserId?.(factoryUserId) ?? null : null;
}

export function mcpStaticRoutes(services: ServerServices) {
  const applicationResponse = async (request: Request): Promise<Response> => {
    let path: string;
    try { path = decodeURIComponent(new URL(request.url).pathname); }
    catch { return errorResponse(404, 'not found'); }
    if (isPublicStaticPath(path)) return staticResponse(request, services.webRoot);
    if (isReservedRoutePath(path) || isBlockedStaticPath(path)) return errorResponse(404, 'not found');
    const identity = await services.auth.authenticate(request);
    if (!identity) {
      const url = new URL(request.url);
      const login = new URL('/login', services.authPublicOrigin);
      login.searchParams.set('return_to', `${url.pathname}${url.search}`);
      return Response.redirect(login, 302);
    }
    if (!identity.groups?.includes(services.tenant.group)) return errorResponse(403, 'tenant access denied');
    return staticResponse(request, services.webRoot, true);
  };

  return new Elysia({ name: 'mcp-static-routes', normalize: false })
    .all('/mcp', async ({ request }) => {
      const identity = await mcpIdentity(request, services);
      if (!identity) return errorResponse(401, 'invalid MCP credentials');
      if (!identity.groups?.includes(services.tenant.group)) return errorResponse(403, 'tenant access denied');
      return dispatchMcp(request, authInfo(identity, request.signal), () => createMcpServer(services));
    })
    .get('/', ({ request }) => applicationResponse(request))
    .head('/', ({ request }) => applicationResponse(request))
    .get('/*', ({ request }) => applicationResponse(request))
    .head('/*', ({ request }) => applicationResponse(request));
}
