/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { Database } from '../db';
import { createFactoryAuth } from './better-auth';
import { bootstrapLocalUser } from './bootstrap-user';
import { bootstrapConfidentialClients } from './clients';
import type { FactoryAuthConfig } from './config';
import { createSessionHelpers } from './session';

export async function createAuthCore(db: Database, config: FactoryAuthConfig) {
  const auth = createFactoryAuth(db, config);
  await bootstrapConfidentialClients(db, config);
  if (config.bootstrapUser) await bootstrapLocalUser(db, config.bootstrapUser);
  return {
    auth,
    handler: (request: Request) => downstreamPolicy(request, config) ?? auth.handler(request),
    sessions: createSessionHelpers(auth),
  };
}

function downstreamPolicy(request: Request, config: FactoryAuthConfig): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== '/oauth2/authorize') return null;
  const clientId = url.searchParams.get('client_id');
  if (clientId === config.forgejo?.clientId) {
    if (config.forgejo.policy !== 'forgejo-15') return oauthError('unauthorized_client');
    if (!url.searchParams.get('state')) return oauthError('invalid_request');
    const challenge = url.searchParams.get('code_challenge');
    if (challenge && url.searchParams.get('code_challenge_method') !== 'S256') return oauthError('invalid_request');
    return null;
  }
  if (clientId === config.coder?.clientId) {
    if (!url.searchParams.get('code_challenge') || url.searchParams.get('code_challenge_method') !== 'S256') return oauthError('invalid_request');
  }
  return null;
}

function oauthError(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

export * from './better-auth';
export * from './bootstrap-user';
export * from './config';
export * from './security';
export * from './session';
export * from './service';
