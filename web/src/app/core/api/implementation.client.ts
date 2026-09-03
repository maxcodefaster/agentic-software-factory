/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import {
  implementationRunSchema,
  implementationRunsResponseSchema,
  type ImplementationRun,
  type ImplementationRunsResponse,
} from '@agentic-software-factory/api-contracts/implementation';
import type { FactoryRequestContext } from '../context/factory-context.store';
import { AgenticSoftwareFactoryAPIService } from '../../generated/api/factory-api';

@Injectable({ providedIn: 'root' })
export class ImplementationClient {
  private readonly api = inject(AgenticSoftwareFactoryAPIService);

  list(context: FactoryRequestContext, requirementNumber: number): Observable<ImplementationRunsResponse> {
    return this.api.getApiV1RequirementsByNumberImplementationRuns<unknown>(
      encodeURIComponent(String(requirementNumber)),
      this.params(context),
    ).pipe(
      map((response) => implementationRunsResponseSchema.parse(response)),
    );
  }

  start(context: FactoryRequestContext, requirementNumber: number, applicationId: string): Observable<ImplementationRun> {
    return this.api.postApiV1RequirementsByNumberImplementationRuns<unknown>(
      encodeURIComponent(String(requirementNumber)),
      { applicationId },
      this.params({ ...context, application: applicationId }),
    ).pipe(
      map((response) => implementationRunSchema.parse(response)),
    );
  }

  review(context: FactoryRequestContext, id: string, decision: 'approve' | 'request-changes', body: string): Observable<ImplementationRun> {
    return this.api.postApiV1ImplementationRunsByIdReview<unknown>(encodeURIComponent(id), { decision, body }, this.params(context, false)).pipe(
      map((response) => implementationRunSchema.parse(response)),
    );
  }

  prepareVerification(context: FactoryRequestContext, id: string): Observable<ImplementationRun> {
    return this.api.postApiV1ImplementationRunsByIdVerification<unknown>(encodeURIComponent(id), {}, this.params(context, false)).pipe(
      map((response) => implementationRunSchema.parse(response)),
    );
  }

  complete(context: FactoryRequestContext, id: string): Observable<ImplementationRun> {
    return this.api.postApiV1ImplementationRunsByIdComplete<unknown>(encodeURIComponent(id), {}, this.params(context, false)).pipe(
      map((response) => implementationRunSchema.parse(response)),
    );
  }

  retryVerification(context: FactoryRequestContext, id: string): Observable<void> {
    return this.api.postApiV1ImplementationRunsByIdVerificationRetry<void>(encodeURIComponent(id), {}, this.params(context, false));
  }

  retryCompletion(context: FactoryRequestContext, id: string): Observable<void> {
    return this.api.postApiV1ImplementationRunsByIdCompleteRetry<void>(encodeURIComponent(id), {}, this.params(context, false));
  }

  stopWorkspace(context: FactoryRequestContext, id: string): Observable<ImplementationRun> {
    return this.api.postApiV1ImplementationRunsByIdWorkspaceStop<unknown>(encodeURIComponent(id), {}, this.params(context, false)).pipe(
      map((response) => implementationRunSchema.parse(response)),
    );
  }

  resumeWorkspace(context: FactoryRequestContext, id: string): Observable<ImplementationRun> {
    return this.api.postApiV1ImplementationRunsByIdWorkspaceResume<unknown>(encodeURIComponent(id), {}, this.params(context, false)).pipe(
      map((response) => implementationRunSchema.parse(response)),
    );
  }

  private params(context: FactoryRequestContext, includeApplication = true): { team: string; application?: string } {
    return {
      team: context.team,
      ...(includeApplication && context.application ? { application: context.application } : {}),
    };
  }
}
