/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import {
  implementationRunSchema,
  implementationRunsResponseSchema,
  type ImplementationRun,
  type ImplementationRunsResponse,
} from '@agentic-software-factory/api-contracts/implementation';
import type { FactoryRequestContext } from '../context/factory-context.store';

@Injectable({ providedIn: 'root' })
export class ImplementationClient {
  private readonly http = inject(HttpClient);

  list(context: FactoryRequestContext, requirementNumber: number): Observable<ImplementationRunsResponse> {
    return this.http.get<unknown>(`/api/v1/requirements/${requirementNumber}/implementation-runs${this.contextQuery(context)}`).pipe(
      map((response) => implementationRunsResponseSchema.parse(response)),
    );
  }

  start(context: FactoryRequestContext, requirementNumber: number, applicationId: string): Observable<ImplementationRun> {
    return this.http.post<unknown>(`/api/v1/requirements/${requirementNumber}/implementation-runs${this.contextQuery({ ...context, application: applicationId })}`, { applicationId }).pipe(
      map((response) => implementationRunSchema.parse(response)),
    );
  }

  review(context: FactoryRequestContext, id: string, decision: 'approve' | 'request-changes', body: string): Observable<ImplementationRun> {
    return this.http.post<unknown>(`/api/v1/implementation-runs/${encodeURIComponent(id)}/review${this.contextQuery(context, false)}`, { decision, body }).pipe(
      map((response) => implementationRunSchema.parse(response)),
    );
  }

  prepareVerification(context: FactoryRequestContext, id: string): Observable<ImplementationRun> {
    return this.http.post<unknown>(`/api/v1/implementation-runs/${encodeURIComponent(id)}/verification${this.contextQuery(context, false)}`, {}).pipe(
      map((response) => implementationRunSchema.parse(response)),
    );
  }

  complete(context: FactoryRequestContext, id: string): Observable<ImplementationRun> {
    return this.http.post<unknown>(`/api/v1/implementation-runs/${encodeURIComponent(id)}/complete${this.contextQuery(context, false)}`, {}).pipe(
      map((response) => implementationRunSchema.parse(response)),
    );
  }

  retryVerification(context: FactoryRequestContext, id: string): Observable<void> {
    return this.http.post<void>(`/api/v1/implementation-runs/${encodeURIComponent(id)}/verification/retry${this.contextQuery(context, false)}`, {});
  }

  retryCompletion(context: FactoryRequestContext, id: string): Observable<void> {
    return this.http.post<void>(`/api/v1/implementation-runs/${encodeURIComponent(id)}/complete/retry${this.contextQuery(context, false)}`, {});
  }

  stopWorkspace(context: FactoryRequestContext, id: string): Observable<ImplementationRun> {
    return this.http.post<unknown>(`/api/v1/implementation-runs/${encodeURIComponent(id)}/workspace/stop${this.contextQuery(context, false)}`, {}).pipe(
      map((response) => implementationRunSchema.parse(response)),
    );
  }

  resumeWorkspace(context: FactoryRequestContext, id: string): Observable<ImplementationRun> {
    return this.http.post<unknown>(`/api/v1/implementation-runs/${encodeURIComponent(id)}/workspace/resume${this.contextQuery(context, false)}`, {}).pipe(
      map((response) => implementationRunSchema.parse(response)),
    );
  }

  private contextQuery(context: FactoryRequestContext, includeApplication = true): string {
    return `?team=${encodeURIComponent(context.team)}${includeApplication && context.application ? `&application=${encodeURIComponent(context.application)}` : ''}`;
  }
}
