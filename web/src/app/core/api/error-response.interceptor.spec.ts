/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { errorResponseInterceptor } from './error-response.interceptor';

describe('errorResponseInterceptor', () => {
  beforeEach(() => TestBed.configureTestingModule({
    providers: [provideHttpClient(withInterceptors([errorResponseInterceptor])), provideHttpClientTesting()],
  }));

  it('preserves valid API errors', () => {
    let error: unknown;
    TestBed.inject(HttpClient).get('/api/v1/board').subscribe({ error: (failure) => { error = failure; } });
    TestBed.inject(HttpTestingController).expectOne('/api/v1/board').flush(
      { error: 'application not found', code: 'not_found' },
      { status: 404, statusText: 'Not Found' },
    );

    expect(error).toMatchObject({ status: 404, error: { error: 'application not found', code: 'not_found' } });
  });

  it('preserves HTTP status while normalizing malformed API errors', () => {
    let error: unknown;
    TestBed.inject(HttpClient).get('/api/v1/board').subscribe({ error: (failure) => { error = failure; } });
    TestBed.inject(HttpTestingController).expectOne('/api/v1/board').flush(
      { message: 'application not found' },
      { status: 404, statusText: 'Not Found' },
    );

    expect(error).toMatchObject({
      status: 404,
      error: { error: 'malformed API error response', code: 'internal_error' },
    });
  });
});
