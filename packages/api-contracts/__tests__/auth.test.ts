/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { expect, test } from 'bun:test';
import { authRedirectResponseSchema, authUiConfigSchema, consentContextSchema, consentRedirectResponseSchema } from '../src/auth';

test('auth UI config exposes only presentation capabilities', () => {
  expect(authUiConfigSchema.parse({ localEmailPassword: true, organizationSignIn: false, postLoginRedirect: '/' })).toEqual({
    localEmailPassword: true,
    organizationSignIn: false,
    postLoginRedirect: '/',
  });
  expect(authUiConfigSchema.safeParse({ localEmailPassword: true, organizationSignIn: true, postLoginRedirect: '/', clientSecret: 'nope' }).success).toBe(false);
  expect(authUiConfigSchema.safeParse({ localEmailPassword: true, organizationSignIn: true, postLoginRedirect: 'https://evil.example' }).success).toBe(false);
});

test('consent context contains only verified display metadata', () => {
  expect(consentContextSchema.parse({ clientId: 'coder', clientName: 'Coder', scope: 'openid profile' })).toEqual({
    clientId: 'coder', clientName: 'Coder', scope: 'openid profile',
  });
});

test('auth redirect responses match Better Auth browser flows', () => {
  expect(authRedirectResponseSchema.parse({ redirect: true, url: '/board' }).url).toBe('/board');
  expect(consentRedirectResponseSchema.parse({ redirect: true, url: 'https://client.example/callback' }).url).toBe('https://client.example/callback');
});
