/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { filter, map, switchMap, take, timer, timeout, type Observable } from 'rxjs';

import {
  applicationsResponseSchema,
  developerWorkspaceSchema,
  developmentToolsSchema,
  type ApplicationsResponse,
  type OnboardedApplication,
  type OnboardingRepositoriesResponse,
  type OnboardingAttemptsResponse,
  type DeveloperWorkspace,
  type DevelopmentTools,
} from '@agentic-software-factory/api-contracts/applications';
import type { FactoryRequestContext } from '../context/factory-context.store';

@Injectable({ providedIn: 'root' })
export class ApplicationsClient {
  private readonly http = inject(HttpClient);

  list(context: FactoryRequestContext): Observable<ApplicationsResponse> {
    return this.http.get<unknown>(`/api/v1/applications?team=${encodeURIComponent(context.team)}`).pipe(
      map((response) => applicationsResponseSchema.parse(response)),
    );
  }

  listOnboardingRepositories(): Observable<OnboardingRepositoriesResponse> {
    return this.http.get<OnboardingRepositoriesResponse>('/api/v1/applications/onboarding/repositories');
  }

  listOnboardingAttempts(): Observable<OnboardingAttemptsResponse> {
    return this.http.get<OnboardingAttemptsResponse>('/api/v1/applications/onboarding/attempts');
  }

  register(input: { repository: string; team: string }): Observable<OnboardedApplication> {
    return this.http.post<OnboardedApplication>('/api/v1/applications/onboarding/register', input);
  }

  developmentTools(): Observable<DevelopmentTools> {
    return this.http.get<unknown>('/api/v1/development-tools').pipe(
      map((response) => developmentToolsSchema.parse(response)),
    );
  }

  createRemediation(systemId: string): Observable<{ pullNumber: number; pullUrl: string; branch: string }> {
    return this.http.post<{ pullNumber: number; pullUrl: string; branch: string }>(`/api/v1/applications/${encodeURIComponent(systemId)}/remediation`, {});
  }

  retryStaging(systemId: string, team: string): Observable<void> {
    return this.http.post<void>(`/api/v1/applications/${encodeURIComponent(systemId)}/staging/retry?team=${encodeURIComponent(team)}`, {});
  }

  createWorkspace(context: FactoryRequestContext, id: string): Observable<DeveloperWorkspace> {
    const requestContext = { ...context };
    return this.http.post<unknown>(`/api/v1/applications/${encodeURIComponent(id)}/workspace?team=${encodeURIComponent(requestContext.team)}`, {}).pipe(
      map((response) => developerWorkspaceSchema.parse(response)),
      switchMap((workspace) => workspace.ideUrl
        ? [workspace]
        : timer(0, 2_000).pipe(
          switchMap(() => this.http.get<unknown>(`/api/v1/applications/${encodeURIComponent(id)}/workspaces/${encodeURIComponent(workspace.workspaceId)}?team=${encodeURIComponent(requestContext.team)}`)),
          map((response) => developerWorkspaceSchema.parse(response)),
          filter((current) => Boolean(current.ideUrl)),
          take(1),
          timeout(11 * 60 * 1_000),
        )),
    );
  }

}
