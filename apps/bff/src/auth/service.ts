/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import type { Identity } from '../server/types';
import type { Database } from '@agentic-software-factory/db';
import type { createAuthCore } from './index';
import type { FactoryAuthConfig } from './config';
import { authUiConfigSchema, consentContextSchema, type AuthUiConfig, type ConsentContext } from '@agentic-software-factory/api-contracts/auth';
import { logout } from './session';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type AuthCore = Awaited<ReturnType<typeof createAuthCore>>;

const MCP_SCOPE = 'mcp:call';
const MCP_TOKEN_MAX_AGE_SECONDS = 15 * 60;

export class FactoryAuthService {
  readonly uiConfig: AuthUiConfig;

  constructor(
    private readonly core: AuthCore,
    private readonly config: FactoryAuthConfig,
    private readonly db?: Database,
    private readonly logoutTimeoutMs = 5_000,
  ) {
    this.uiConfig = authUiConfigSchema.parse({
      localEmailPassword: config.mode === 'local',
      organizationSignIn: config.mode === 'entra',
      postLoginRedirect: '/',
    });
  }

  async ready(): Promise<void> {
    if (this.db) await this.db.execute('select 1');
  }

  async consentContext(request: Request): Promise<ConsentContext | null> {
    const url = new URL(request.url);
    const clientId = url.searchParams.get('client_id');
    const oauthQuery = url.search.startsWith('?') ? url.search.slice(1) : url.search;
    if (!clientId || !oauthQuery) return null;
    const response = await Promise.resolve(this.core.handler(new Request(new URL('/oauth2/public-client-prelogin', this.config.issuer), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, oauth_query: oauthQuery }),
    }))).catch(() => null);
    if (!response?.ok) return null;
    const client = await response.json().catch(() => null) as { client_name?: unknown } | null;
    return consentContextSchema.parse({
      clientId,
      clientName: typeof client?.client_name === 'string' && client.client_name ? client.client_name : clientId,
      scope: url.searchParams.get('scope') ?? '',
    });
  }

  async authenticate(request: Request): Promise<Identity | null> {
    const session = await this.core.sessions.get(request);
    if (!session) return null;
    if (this.db) {
      const active = await this.db.query.user.findFirst({
        columns: { deprovisionedAt: true },
        where: (table, { eq }) => eq(table.id, session.user.id),
      });
      if (!active || active.deprovisionedAt) return null;
    }
    return identity(this.config.issuer, session.user);
  }

  async authenticateMcp(request: Request): Promise<string | null> {
    const client = this.config.coder;
    const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/);
    if (!client || !match) return null;
    const response = await Promise.resolve(this.core.handler(new Request(new URL('/oauth2/introspect', this.config.issuer), {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token: match[1]!, token_type_hint: 'access_token' }),
    }))).catch(() => null);
    if (!response?.ok) return null;
    const token = await response.json().catch(() => null) as Record<string, unknown> | null;
    const now = Math.floor(Date.now() / 1_000);
    const scopes = typeof token?.scope === 'string' ? token.scope.split(' ') : [];
    const subject = token?.active === true
      && token.client_id === client.clientId
      && token.agentic_software_factory_audience === `${this.config.issuer}/mcp`
      && typeof token.sub === 'string' && token.sub.length > 0
      && typeof token.iat === 'number' && token.iat <= now + 60
      && typeof token.exp === 'number' && token.exp > now
      && token.exp - token.iat > 0 && token.exp - token.iat <= MCP_TOKEN_MAX_AGE_SECONDS
      && scopes.includes(MCP_SCOPE)
      ? token.sub
      : null;
    if (!subject || !this.db) return subject;
    const active = await this.db.query.user.findFirst({
      columns: { deprovisionedAt: true },
      where: (table, { eq }) => eq(table.id, subject),
    });
    return active && !active.deprovisionedAt ? subject : null;
  }

  async handle(_action: 'logout', request: Request): Promise<Response> {
    let target = new URL('/login?return_to=%2F', this.config.issuer).toString();
    if (this.config.forgejoPublicUrl) target = this.logoutBridge(this.config.forgejoPublicUrl, 'forgejo', target);
    if (this.config.coderPublicUrl) target = this.logoutBridge(this.config.coderPublicUrl, 'coder', target);
    return logout(this.core.auth, this.config, request, target);
  }

  async handler(request: Request): Promise<Response> {
    return this.core.handler(request);
  }

  async logoutBridgeRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const payload = url.searchParams.get('payload') ?? '';
    const signature = url.searchParams.get('signature') ?? '';
    if (!payload || !signature || !this.verifyLogout(payload, signature)) return Response.json({ error: 'invalid logout ticket' }, { status: 400 });
    const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { audience: string; expiresAt: number; next: string };
    if (ticket.expiresAt < Date.now() || !['coder', 'forgejo'].includes(ticket.audience)) return Response.json({ error: 'expired logout ticket' }, { status: 400 });
    const headers = new Headers();
    if (ticket.audience === 'coder' && this.config.coderPublicUrl) {
      const secure = this.config.coderPublicUrl.startsWith('https://');
      headers.append('set-cookie', expireCookie('coder_session_token', secure));
      headers.append('set-cookie', expireCookie('__Host-coder_session_token', secure));
      const token = cookie(request, 'coder_session_token') || cookie(request, '__Host-coder_session_token');
      if (token) {
        const response = await fetch(new URL('/api/v2/users/logout', this.config.coderInternalUrl ?? this.config.coderPublicUrl), {
          method: 'POST',
          headers: { 'Coder-Session-Token': token },
          signal: logoutSignal(request.signal, this.logoutTimeoutMs),
        }).catch(() => null);
        if (!response || !downstreamSuccess(response)) return logoutFailure('Coder', headers);
        response.headers.getSetCookie().forEach((value) => headers.append('set-cookie', value));
      }
    }
    if (ticket.audience === 'forgejo' && this.config.forgejoPublicUrl) {
      const secure = this.config.forgejoPublicUrl.startsWith('https://');
      for (const name of ['session', 'i_like_gitea', 'persistent', 'gitea_incredible']) headers.append('set-cookie', expireCookie(name, secure));
      const response = await fetch(new URL('/user/logout', this.config.forgejoInternalUrl ?? this.config.forgejoPublicUrl), {
        method: 'POST',
        headers: { cookie: request.headers.get('cookie') ?? '' },
        redirect: 'manual',
        signal: logoutSignal(request.signal, this.logoutTimeoutMs),
      }).catch(() => null);
      if (!response || !(response.ok || response.status === 302 || response.status === 303)) return logoutFailure('Forgejo', headers);
      response.headers.getSetCookie().forEach((value) => headers.append('set-cookie', value));
    }
    headers.set('location', ticket.next);
    headers.set('referrer-policy', 'no-referrer');
    return new Response(null, { status: 303, headers });
  }

  private logoutBridge(origin: string, audience: string, next: string): string {
    const payload = Buffer.from(JSON.stringify({ audience, expiresAt: Date.now() + 60_000, next })).toString('base64url');
    const url = new URL('/__factory/logout', origin);
    url.searchParams.set('payload', payload);
    url.searchParams.set('signature', createHmac('sha256', this.config.secret).update(payload).digest('base64url'));
    return url.toString();
  }

  private verifyLogout(payload: string, signature: string): boolean {
    const expected = createHmac('sha256', this.config.secret).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

}

function cookie(request: Request, name: string): string {
  const item = (request.headers.get('cookie') ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item?.slice(name.length + 1) ?? '';
}

function downstreamSuccess(response: Response): boolean {
  return response.ok;
}

function logoutSignal(caller: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([caller, AbortSignal.timeout(timeoutMs)]);
}

function expireCookie(name: string, secure: boolean): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function logoutFailure(product: string, headers: Headers): Response {
  headers.set('referrer-policy', 'no-referrer');
  return Response.json({ error: `${product} logout failed` }, { status: 502, headers });
}

function identity(issuer: string, user: { id: string; email: string; emailVerified?: boolean; name: string; preferredUsername: string; groups?: string[] }): Identity {
  return { issuer, subject: user.id, email: user.email, emailVerified: user.emailVerified ?? true, name: user.name, username: user.preferredUsername, groups: user.groups ?? [] };
}
