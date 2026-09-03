/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Injectable, inject } from '@angular/core';
import { filter, map, switchMap, take, timer, timeout, type Observable } from 'rxjs';

import {
  applicationsResponseSchema,
  developerWorkspaceSchema,
  developmentToolsSchema,
  onboardedApplicationSchema,
  onboardingAttemptsResponseSchema,
  onboardingRepositoriesResponseSchema,
  remediationResponseSchema,
  type ApplicationsResponse,
  type OnboardedApplication,
  type OnboardingRepositoriesResponse,
  type OnboardingAttemptsResponse,
  type DeveloperWorkspace,
  type DevelopmentTools,
  type RegisterApplicationRequest,
  type RemediationResponse,
} from '@agentic-software-factory/api-contracts/applications';
import type { FactoryRequestContext } from '../context/factory-context.store';
import { AgenticSoftwareFactoryAPIService } from '../../generated/api/factory-api';

@Injectable({ providedIn: 'root' })
export class ApplicationsClient {
  private readonly api = inject(AgenticSoftwareFactoryAPIService);

  list(context: FactoryRequestContext): Observable<ApplicationsResponse> {
    return this.api.getApiV1Applications<unknown>({ team: context.team }).pipe(
      map((response) => applicationsResponseSchema.parse(response)),
    );
  }

  listOnboardingRepositories(): Observable<OnboardingRepositoriesResponse> {
    return this.api.getApiV1ApplicationsOnboardingRepositories<unknown>().pipe(
      map((response) => onboardingRepositoriesResponseSchema.parse(response)),
    );
  }

  listOnboardingAttempts(): Observable<OnboardingAttemptsResponse> {
    return this.api.getApiV1ApplicationsOnboardingAttempts<unknown>().pipe(
      map((response) => onboardingAttemptsResponseSchema.parse(response)),
    );
  }

  register(input: RegisterApplicationRequest): Observable<OnboardedApplication> {
    return this.api.postApiV1ApplicationsOnboardingRegister<unknown>(input).pipe(
      map((response) => onboardedApplicationSchema.parse(response)),
    );
  }

  developmentTools(): Observable<DevelopmentTools> {
    return this.api.getApiV1DevelopmentTools<unknown>().pipe(
      map((response) => developmentToolsSchema.parse(response)),
    );
  }

  createRemediation(systemId: string): Observable<RemediationResponse> {
    return this.api.postApiV1ApplicationsByIdRemediation<unknown>(encodeURIComponent(systemId), {}).pipe(
      map((response) => remediationResponseSchema.parse(response)),
    );
  }

  retryStaging(systemId: string, team: string): Observable<void> {
    return this.api.postApiV1ApplicationsByIdStagingRetry<void>(encodeURIComponent(systemId), {}, { team });
  }

  createWorkspace(context: FactoryRequestContext, id: string): Observable<DeveloperWorkspace> {
    const requestContext = { ...context };
    const encodedId = encodeURIComponent(id);
    return this.api.postApiV1ApplicationsByIdWorkspace<unknown>(encodedId, {}, { team: requestContext.team }).pipe(
      map((response) => developerWorkspaceSchema.parse(response)),
      switchMap((workspace) => workspace.ideUrl
        ? [workspace]
        : timer(0, 2_000).pipe(
          switchMap(() => this.api.getApiV1ApplicationsByIdWorkspacesByWorkspaceId<unknown>(
            encodedId,
            encodeURIComponent(workspace.workspaceId),
            { team: requestContext.team },
          )),
          map((response) => developerWorkspaceSchema.parse(response)),
          filter((current) => Boolean(current.ideUrl)),
          take(1),
          timeout(11 * 60 * 1_000),
        )),
    );
  }

}
