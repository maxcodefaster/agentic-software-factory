/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { KanbanInterviewClient } from './kanban-interview.client';

describe('KanbanInterviewClient', () => {
  beforeEach(() => TestBed.configureTestingModule({
    imports: [HttpClientTestingModule],
  }));

  it('scopes every interview request and places actions before the query string', () => {
    const client = TestBed.inject(KanbanInterviewClient);
    const http = TestBed.inject(HttpTestingController);
    const scoped = '?team=operations&application=operations%2Forders';
    const context = { team: 'operations', application: 'operations/orders' };
    const answer = { questionId: 'question-1', value: 'answer' } as never;

    client.get(context, 'operations/orders#42').subscribe({ error: () => undefined });
    expect(http.expectOne(`/api/v1/requirements/42/interview${scoped}`).request.method).toBe('GET');

    client.start(context, 'operations/orders#42').subscribe();
    expect(http.expectOne(`/api/v1/requirements/42/interview/start${scoped}`).request.method).toBe('POST');

    client.retake(context, 'operations/orders#42').subscribe();
    expect(http.expectOne(`/api/v1/requirements/42/interview/retake${scoped}`).request.method).toBe('POST');

    client.answer(context, 'operations/orders#42', answer).subscribe();
    const answered = http.expectOne(`/api/v1/requirements/42/interview${scoped}`);
    expect(answered.request.method).toBe('POST');
    expect(answered.request.body).toBe(answer);

    client.retry(context, 'operations/orders#42').subscribe();
    expect(http.expectOne(`/api/v1/requirements/42/interview/retry${scoped}`).request.method).toBe('POST');

    client.sharpen(context, 'operations/orders#42', 'Make it measurable').subscribe();
    const sharpened = http.expectOne(`/api/v1/requirements/42/interview/sharpen${scoped}`);
    expect(sharpened.request.method).toBe('POST');
    expect(sharpened.request.body).toEqual({ note: 'Make it measurable' });

    client.getEvents(context, 'operations/orders#42').subscribe();
    expect(http.expectOne(`/api/v1/requirements/42/events${scoped}`).request.method).toBe('GET');

    http.verify();
  });

  it('does not retarget an interview request when its context changes after dispatch', () => {
    const client = TestBed.inject(KanbanInterviewClient);
    const http = TestBed.inject(HttpTestingController);
    const context: { team: string; application: string | null } = { team: 'operations', application: 'operations/orders' };

    client.get(context, 'operations/orders#42').subscribe({ error: () => undefined });
    context.team = 'factory';
    context.application = 'factory/billing';

    http.expectNone('/api/v1/requirements/42/interview?team=factory&application=factory%2Fbilling');
    http.expectOne('/api/v1/requirements/42/interview?team=operations&application=operations%2Forders').flush({});
  });

  it('rejects malformed interview read and command responses', () => {
    const client = TestBed.inject(KanbanInterviewClient);
    const http = TestBed.inject(HttpTestingController);
    const context = { team: 'operations', application: 'operations/orders' };
    const errors: unknown[] = [];

    client.get(context, 'operations/orders#42').subscribe({ error: (error) => errors.push(error) });
    http.expectOne('/api/v1/requirements/42/interview?team=operations&application=operations%2Forders').flush({ state: {} });

    client.start(context, 'operations/orders#42').subscribe({ error: (error) => errors.push(error) });
    http.expectOne('/api/v1/requirements/42/interview/start?team=operations&application=operations%2Forders').flush({ state: {} });

    expect(errors).toHaveLength(2);
  });
});
