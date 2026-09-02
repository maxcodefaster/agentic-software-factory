/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { FactoryAuth } from './better-auth';
import type { FactoryAuthConfig, FactoryIdentity } from './config';
import { assertRequestOrigin } from './security';

export interface FactorySession {
  user: FactoryIdentity;
  session: {
    id: string;
    expiresAt: Date;
  };
}

export function createSessionHelpers(auth: FactoryAuth) {
  return {
    async get(request: Request): Promise<FactorySession | null> {
      const result = await auth.api.getSession({ headers: request.headers });
      if (!result) return null;
      const raw = result.user as typeof result.user & {
        preferredUsername?: string;
        groups?: string[];
      };
      return {
        session: { id: result.session.id, expiresAt: result.session.expiresAt },
        user: {
          id: raw.id,
          email: raw.email,
          emailVerified: raw.emailVerified,
          name: raw.name,
          image: raw.image,
          preferredUsername: raw.preferredUsername || raw.email.split('@')[0] || raw.id,
          groups: raw.groups ?? [],
        },
      };
    },

    async require(request: Request): Promise<FactorySession> {
      const session = await this.get(request);
      if (session) return session;
      throw Object.assign(new Error('Authentication required'), { status: 401 });
    },
  };
}

export async function logout(
  auth: FactoryAuth,
  config: FactoryAuthConfig,
  request: Request,
  redirectTo = '/',
): Promise<Response> {
  assertRequestOrigin(request, config.trustedOrigins);
  const response = await auth.api.signOut({ headers: request.headers, asResponse: true });
  const headers = new Headers(response.headers);
  let location = '/';
  if (redirectTo.startsWith('/') && !redirectTo.startsWith('//')) location = redirectTo;
  else {
    const target = new URL(redirectTo);
    if ([config.issuer, config.coderPublicUrl, config.forgejoPublicUrl].some((origin) => origin && target.origin === new URL(origin).origin)) location = target.toString();
  }
  headers.set('location', location);
  return new Response(null, { status: 303, headers });
}
