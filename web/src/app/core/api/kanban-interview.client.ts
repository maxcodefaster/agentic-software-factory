/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import {
  cardEventsResponseSchema,
  interviewResponseSchema,
  interviewStateResponseSchema,
} from '@agentic-software-factory/api-contracts/kanban';

import type { FactoryRequestContext } from '../context/factory-context.store';
import type { CardEvent, InterviewAnswer, InterviewResponse, InterviewState } from './kanban.types';

/**
 * Kanban requirements-interview client — the structured Q&A that turns a
 * rough idea into a reviewable specification using Coder-backed interview APIs.
 */
@Injectable({ providedIn: 'root' })
export class KanbanInterviewClient {
  private readonly http = inject(HttpClient);

  private url(context: FactoryRequestContext, cardId: string, suffix = '', resource = 'interview'): string {
    const [systemId, number] = splitCardId(cardId);
    const application = context.application ?? systemId;
    const query = `team=${encodeURIComponent(context.team)}${application ? `&application=${encodeURIComponent(application)}` : ''}`;
    return `/api/v1/requirements/${encodeURIComponent(number)}/${resource}${suffix}?${query}`;
  }

  /** Current interview state + finalized spec (if any). */
  get(context: FactoryRequestContext, cardId: string): Observable<InterviewResponse> {
    return this.http.get<unknown>(this.url(context, cardId)).pipe(
      map((response) => interviewResponseSchema.parse(response)),
    );
  }

  /** Start the interview — returns the first question. */
  start(context: FactoryRequestContext, cardId: string): Observable<{ state: InterviewState }> {
    return this.stateCommand(this.url(context, cardId, '/start'), {});
  }

  /** Reset + restart the interview from scratch (full retake). */
  retake(context: FactoryRequestContext, cardId: string): Observable<{ state: InterviewState }> {
    return this.stateCommand(this.url(context, cardId, '/retake'), {});
  }

  /** Sharpen a cleared requirement with a reviewer note — the AI asks one more
   *  targeted question or re-derives a sharper spec (keeps the prior context). */
  sharpen(context: FactoryRequestContext, cardId: string, note: string): Observable<{ state: InterviewState }> {
    return this.stateCommand(this.url(context, cardId, '/sharpen'), { note });
  }

  /** Answer the pending question and advance. */
  answer(context: FactoryRequestContext, cardId: string, answer: InterviewAnswer): Observable<{ state: InterviewState }> {
    return this.stateCommand(this.url(context, cardId), answer);
  }

  retry(context: FactoryRequestContext, cardId: string): Observable<{ state: InterviewState }> {
    return this.stateCommand(this.url(context, cardId, '/retry'), {});
  }

  getEvents(context: FactoryRequestContext, cardId: string): Observable<{ events: CardEvent[] }> {
    return this.http.get<unknown>(this.url(context, cardId, '', 'events')).pipe(
      map((response) => cardEventsResponseSchema.parse(response)),
    );
  }

  private stateCommand(url: string, body: unknown): Observable<{ state: InterviewState }> {
    return this.http.post<unknown>(url, body).pipe(
      map((response) => interviewStateResponseSchema.parse(response)),
    );
  }

}

function splitCardId(value: string): [string, string] {
  const separator = value.lastIndexOf('#');
  return separator < 0 ? ['', value] : [value.slice(0, separator), value.slice(separator + 1)];
}
