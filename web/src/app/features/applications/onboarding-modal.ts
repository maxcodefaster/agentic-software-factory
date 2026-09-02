/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HlmButton } from '@spartan-ng/helm/button';

import type { DevelopmentTools, OnboardingAttempt, OnboardingRepository } from '@agentic-software-factory/api-contracts/applications';
import { ApplicationsClient } from '../../core/api/applications.client';
import { Icon } from '../../shared/icon/icon';
import { Overlay } from '../../shared/overlay/overlay';

@Component({
  selector: 'factory-onboarding-modal',
  imports: [HlmButton, Icon, Overlay, TranslocoPipe],
  templateUrl: './onboarding-modal.html',
})
export class OnboardingModal {
  private readonly api = inject(ApplicationsClient);
  private readonly transloco = inject(TranslocoService);
  readonly team = input.required<string>();
  readonly dismiss = output<void>();
  readonly changed = output<void>();
  protected readonly repositories = signal<OnboardingRepository[]>([]);
  protected readonly attempts = signal<OnboardingAttempt[]>([]);
  protected readonly loadErrors = signal<Array<{ systemId: string; error: string }>>([]);
  protected readonly developmentTools = signal<DevelopmentTools | null>(null);
  protected readonly loading = signal(true);
  protected readonly busyId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly remediationUrl = signal<string | null>(null);

  constructor() {
    this.load();
  }

  protected register(repository: OnboardingRepository): void {
    this.busyId.set(repository.name);
    this.error.set(null);
    this.api.register({ repository: repository.fullName, team: this.team() }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.changed.emit();
      },
      error: (response: { error?: { error?: string } }) => {
        this.busyId.set(null);
        this.error.set(response.error?.error ?? this.transloco.translate('applications.onboarding.createError'));
      },
    });
  }

  protected retry(attempt: OnboardingAttempt): void {
    this.busyId.set(attempt.systemId);
    this.error.set(null);
    this.api.register({ repository: attempt.systemId, team: attempt.team }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.changed.emit();
      },
      error: (response: { error?: { error?: string; issues?: Array<{ path: string; message: string }> } }) => {
        this.busyId.set(null);
        this.error.set(response.error?.issues?.map((issue) => `${issue.path}: ${issue.message}`).join('\n')
          || response.error?.error || this.transloco.translate('applications.onboarding.createError'));
        this.load();
      },
    });
  }

  protected remediate(attempt: OnboardingAttempt): void {
    this.busyId.set(attempt.systemId);
    this.error.set(null);
    this.api.createRemediation(attempt.systemId).subscribe({
      next: ({ pullUrl }) => { this.busyId.set(null); this.remediationUrl.set(pullUrl); },
      error: (response: { error?: { error?: string } }) => {
        this.busyId.set(null);
        this.error.set(response.error?.error ?? this.transloco.translate('applications.onboarding.remediationError'));
      },
    });
  }

  private load(): void {
    this.loading.set(true);
    let pending = 3;
    const complete = () => { if (--pending === 0) this.loading.set(false); };
    this.api.listOnboardingRepositories().subscribe({
      next: ({ repositories }) => { this.repositories.set(repositories); complete(); },
      error: () => { this.error.set(this.transloco.translate('applications.onboarding.repositoriesError')); complete(); },
    });
    this.api.listOnboardingAttempts().subscribe({
      next: ({ attempts, loadErrors }) => {
        this.attempts.set(attempts.filter((attempt) => attempt.phase !== 'ready'));
        this.loadErrors.set(loadErrors);
        complete();
      },
      error: complete,
    });
    this.api.developmentTools().subscribe({
      next: (tools) => { this.developmentTools.set(tools); complete(); },
      error: complete,
    });
  }

  protected close(): void {
    if (!this.busyId()) this.dismiss.emit();
  }
}
