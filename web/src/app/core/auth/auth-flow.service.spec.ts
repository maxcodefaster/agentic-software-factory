/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthFlowService, safeReturnTo } from './auth-flow.service';

describe('AuthFlowService', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [HttpClientTestingModule] }));

  it.each([
    ['https://evil.example/steal', '/safe'],
    ['//evil.example/steal', '/safe'],
    ['javascript:alert(1)', '/safe'],
    [null, '/'],
    ['/board/42?view=activity#history', '/board/42?view=activity#history'],
  ])('validates return_to %s', (value, expected) => {
    expect(safeReturnTo(value, value === null ? '//evil.example' : '/safe')).toBe(expected);
  });

  it('preserves a raw OAuth query byte-for-byte for the provider hook', () => {
    const service = TestBed.inject(AuthFlowService);
    const search = '?client_id=a%2Fb&redirect_uri=https%3A%2F%2Fclient.test%2Fcb&scope=openid+profile&scope=email%20address';
    expect(service.oauthQuery(search)).toBe(search.slice(1));
    expect(service.returnTo({ localEmailPassword: true, organizationSignIn: false, postLoginRedirect: '/' }, search)).toBe('/');
  });

  it('sends the signed OAuth query separately from the application callback', async () => {
    const service = TestBed.inject(AuthFlowService);
    const result = service.signInWithEmail('user@example.test', 'secret', '/', 'client_id=coder&sig=signed');
    const request = TestBed.inject(HttpTestingController).expectOne('/sign-in/email');
    expect(request.request.body).toEqual({
      email: 'user@example.test', password: 'secret', callbackURL: '/', oauth_query: 'client_id=coder&sig=signed',
    });
    request.flush({ url: 'http://coder.localhost/callback' });
    await expect(result).resolves.toBe('http://coder.localhost/callback');
  });

  it('submits the Better Auth email payload and parses its redirect', async () => {
    const service = TestBed.inject(AuthFlowService);
    const result = service.signInWithEmail('user@example.test', 'secret', '/board/42');
    const request = TestBed.inject(HttpTestingController).expectOne('/sign-in/email');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'user@example.test', password: 'secret', callbackURL: '/board/42' });
    request.flush({ url: '/board/42', redirect: true });
    await expect(result).resolves.toBe('/board/42');
  });

  it('submits consent with the untouched OAuth query bytes', async () => {
    const service = TestBed.inject(AuthFlowService);
    const search = '?client_id=a%2Fb&scope=openid+profile&scope=email%20address';
    const result = service.submitConsent(true, search);
    const request = TestBed.inject(HttpTestingController).expectOne('/oauth2/consent');
    expect(request.request.body).toEqual({ accept: true, oauth_query: search.slice(1) });
    request.flush({ url: 'https://client.example/callback' });
    await expect(result).resolves.toBe('https://client.example/callback');
  });
});
