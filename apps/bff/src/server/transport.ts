/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { MAX_MCP_BODY_BYTES } from './boundary';

function protocolError(status: number, code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', error: { code, message }, id: null }, { status });
}

export async function dispatchMcp(
  request: Request,
  authInfo: AuthInfo,
  createServer: () => Server,
): Promise<Response> {
  if (request.method !== 'POST') return protocolError(405, -32000, 'Method Not Allowed');

  let body: unknown;
  try {
    const bytes = await request.clone().arrayBuffer();
    if (bytes.byteLength > MAX_MCP_BODY_BYTES) return protocolError(413, -32000, 'Payload Too Large');
    const text = new TextDecoder().decode(bytes);
    body = text ? JSON.parse(text) : undefined;
  } catch {
    return protocolError(400, -32700, 'Parse error');
  }

  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request, { authInfo, parsedBody: body });
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
