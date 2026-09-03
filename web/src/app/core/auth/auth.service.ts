/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { HttpErrorResponse } from '@angular/common/http';
import { computed, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { sessionResponseSchema, type FactoryCapabilities, type SessionUser } from '@agentic-software-factory/api-contracts/session';
import { AgenticSoftwareFactoryAPIService } from '../../generated/api/factory-api';

export type AuthState = 'loading' | 'authenticated' | 'anonymous' | 'unavailable';

const NO_CAPABILITIES: FactoryCapabilities = {
  boardRead: false, requirementsCreate: false, requirementsEdit: false, requirementsClose: false,
  requirementsMove: false, requirementsInterview: false, requirementsPropose: false, requirementsAccept: false,
  applicationsRead: false, developerWorkspaceCreate: false, implementationRead: false, implementationStart: false,
  implementationPrepare: false, implementationReview: false, implementationComplete: false,
  monitoringRead: false, applicationsManage: false,
};

/**
 * Owns the user-facing view of authentication state.
 *
 * The Factory BFF owns OIDC. This service caches only the browser-safe session.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(AgenticSoftwareFactoryAPIService);

  private readonly _user = signal<SessionUser | null>(null);
  private readonly _state = signal<AuthState>('loading');
  private readonly _requestedUrl = signal<string | null>(null);

  readonly user = this._user.asReadonly();
  readonly state = this._state.asReadonly();
  readonly requestedUrl = this._requestedUrl.asReadonly();
  readonly loading = computed(() => this._state() === 'loading');
  readonly isAuthenticated = computed(() => this._state() === 'authenticated');
  /** Team boards available to this authenticated user. */
  readonly teams = computed<readonly string[]>(() => this._user()?.teams ?? []);
  /** Team boards visible to an administrator. */
  readonly ownerTeams = computed<readonly string[]>(() => this._user()?.ownerTeams ?? []);
  /** True iff the user owns the given team. */
  isOwnerOf(slug: string): boolean {
    return this.ownerTeams().includes(slug);
  }
  readonly canManageTeams = computed(() => this.ownerTeams().length > 0);
  readonly isAdmin = computed(() => this._user()?.admin ?? false);
  readonly capabilities = computed(() => this._user()?.capabilities ?? NO_CAPABILITIES);
  readonly canManageRequirements = computed(() => this.capabilities().requirementsEdit);
  readonly canCreateRequirements = computed(() => this.capabilities().requirementsCreate);
  readonly canMoveRequirements = computed(() => this.capabilities().requirementsMove);
  readonly canInterviewRequirements = computed(() => this.capabilities().requirementsInterview);
  readonly canCreateDeveloperWorkspace = computed(() => this.capabilities().developerWorkspaceCreate);
  readonly canImplement = computed(() => this.capabilities().implementationStart);
  readonly canReviewImplementation = computed(() => this.capabilities().implementationReview);
  readonly canManageApplications = computed(() => this.capabilities().applicationsManage);

  /** Called once at app start (from a route resolver / APP_INITIALIZER replacement). */
  async hydrate(): Promise<void> {
    this._state.set('loading');
    try {
      const session = await firstValueFrom(this.api.getApiV1Session<unknown>());
      const user = sessionResponseSchema.parse(session);
      this._user.set(user);
      this._state.set(user ? 'authenticated' : 'anonymous');
    } catch (error) {
      this._user.set(null);
      this._state.set(error instanceof HttpErrorResponse && error.status === 401 ? 'anonymous' : 'unavailable');
    }
  }

  preserveRequestedUrl(url: string): void {
    if (url.startsWith('/') && !url.startsWith('//')) this._requestedUrl.set(url);
  }

  async signOut(): Promise<void> {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/auth/logout';
    document.body.append(form);
    form.submit();
  }
}
