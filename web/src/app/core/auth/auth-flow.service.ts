/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  authRedirectResponseSchema,
  authUiConfigSchema,
  consentContextSchema,
  consentRedirectResponseSchema,
  type ConsentContext,
  type AuthUiConfig,
} from '@agentic-software-factory/api-contracts/auth';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthFlowService {
  private readonly http = inject(HttpClient);

  async config(): Promise<AuthUiConfig> {
    return authUiConfigSchema.parse(await firstValueFrom(this.http.get<unknown>('/auth/config')));
  }

  returnTo(config: AuthUiConfig, search = window.location.search): string {
    const params = new URLSearchParams(search);
    return safeReturnTo(params.get('return_to'), config.postLoginRedirect);
  }

  oauthQuery(search = window.location.search): string | undefined {
    const params = new URLSearchParams(search);
    return params.has('client_id') && params.has('redirect_uri')
      ? (search.startsWith('?') ? search.slice(1) : search)
      : undefined;
  }

  async signInWithEmail(email: string, password: string, callbackURL: string, oauthQuery?: string): Promise<string> {
    const response = await firstValueFrom(this.http.post<unknown>('/sign-in/email', {
      email, password, callbackURL, ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
    }));
    const url = authRedirectResponseSchema.parse(response).url;
    if (!url) throw new Error('The sign-in response did not include a redirect URL.');
    return url;
  }

  async signInWithOrganization(callbackURL: string, oauthQuery?: string): Promise<string> {
    const response = await firstValueFrom(this.http.post<unknown>('/sign-in/social', {
      provider: 'upstream-oidc',
      callbackURL,
      ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
    }));
    const url = authRedirectResponseSchema.parse(response).url;
    if (!url) throw new Error('The sign-in response did not include a redirect URL.');
    return url;
  }

  async submitConsent(accept: boolean, search = window.location.search): Promise<string> {
    const response = await firstValueFrom(this.http.post<unknown>('/oauth2/consent', {
      accept,
      oauth_query: search.startsWith('?') ? search.slice(1) : search,
    }));
    return consentRedirectResponseSchema.parse(response).url;
  }

  async consentContext(search = window.location.search): Promise<ConsentContext> {
    return consentContextSchema.parse(await firstValueFrom(this.http.get<unknown>(`/auth/consent-context${search}`)));
  }

  follow(url: string): void {
    window.location.assign(url);
  }
}

export function safeReturnTo(value: string | null, fallback = '/'): string {
  const safeFallback = localPath(fallback) ?? '/';
  return localPath(value) ?? safeFallback;
}

function localPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const parsed = new URL(value, 'https://factory.invalid');
    return parsed.origin === 'https://factory.invalid'
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : null;
  } catch {
    return null;
  }
}
