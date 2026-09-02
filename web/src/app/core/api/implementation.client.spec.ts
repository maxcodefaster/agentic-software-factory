/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ImplementationClient } from './implementation.client';

describe('ImplementationClient', () => {
  beforeEach(() => TestBed.configureTestingModule({
    imports: [HttpClientTestingModule],
  }));

  it('scopes list, start, review, verification, and complete to the active team', () => {
    const client = TestBed.inject(ImplementationClient);
    const http = TestBed.inject(HttpTestingController);
    const context = { team: 'operations', application: null };

    client.list(context, 42).subscribe();
    expect(http.expectOne('/api/v1/requirements/42/implementation-runs?team=operations').request.method).toBe('GET');

    client.start(context, 42, 'operations/orders').subscribe();
    const start = http.expectOne('/api/v1/requirements/42/implementation-runs?team=operations&application=operations%2Forders');
    expect(start.request.method).toBe('POST');
    expect(start.request.body).toEqual({ applicationId: 'operations/orders' });

    client.review(context, 'run/id', 'approve', 'Ship it').subscribe();
    const review = http.expectOne('/api/v1/implementation-runs/run%2Fid/review?team=operations');
    expect(review.request.method).toBe('POST');
    expect(review.request.body).toEqual({ decision: 'approve', body: 'Ship it' });

    client.prepareVerification(context, 'run/id').subscribe();
    expect(http.expectOne('/api/v1/implementation-runs/run%2Fid/verification?team=operations').request.method).toBe('POST');

    client.complete(context, 'run/id').subscribe();
    expect(http.expectOne('/api/v1/implementation-runs/run%2Fid/complete?team=operations').request.method).toBe('POST');

    client.stopWorkspace(context, 'run/id').subscribe();
    expect(http.expectOne('/api/v1/implementation-runs/run%2Fid/workspace/stop?team=operations').request.method).toBe('POST');

    client.resumeWorkspace(context, 'run/id').subscribe();
    expect(http.expectOne('/api/v1/implementation-runs/run%2Fid/workspace/resume?team=operations').request.method).toBe('POST');

    http.verify();
  });

  it('rejects a malformed implementation response', () => {
    const client = TestBed.inject(ImplementationClient);
    let error: unknown;

    client.start({ team: 'operations', application: null }, 42, 'operations/orders').subscribe({ error: (failure) => { error = failure; } });
    TestBed.inject(HttpTestingController)
      .expectOne('/api/v1/requirements/42/implementation-runs?team=operations&application=operations%2Forders')
      .flush({ id: 'run-1' });

    expect(error).toBeTruthy();
  });
});
