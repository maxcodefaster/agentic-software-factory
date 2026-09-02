/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, inject, OnInit, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButton } from '@spartan-ng/helm/button';
import { AuthFlowService } from '../../core/auth/auth-flow.service';
import { AuthShell } from './auth-shell';

@Component({
  selector: 'factory-consent',
  imports: [AuthShell, HlmButton, TranslocoPipe],
  template: `
    <factory-auth-shell>
      <h2 class="text-3xl font-semibold">{{ 'auth.consentTitle' | transloco }}</h2>
      <p class="mt-(--spacing-brand-xs) text-sm text-brand-gray-600">{{ 'auth.consentText' | transloco }}</p>
       @if (loading()) {
         <p role="status" class="my-(--spacing-brand-l) text-sm text-brand-gray-600">{{ 'common.loading' | transloco }}</p>
       } @else if (context(); as consent) {
         <dl class="my-(--spacing-brand-l) grid gap-(--spacing-brand-m) rounded-brand-md border border-brand-gray-200 bg-brand-surface-muted p-(--spacing-brand-m)">
           <div><dt class="text-xs font-semibold text-brand-gray-600">{{ 'auth.clientId' | transloco }}</dt><dd data-testid="client-id" class="mt-(--spacing-brand-xxs) break-all text-sm">{{ consent.clientName }}</dd></div>
           <div><dt class="text-xs font-semibold text-brand-gray-600">{{ 'auth.scope' | transloco }}</dt><dd data-testid="scope" class="mt-(--spacing-brand-xxs) break-words text-sm">{{ consent.scope }}</dd></div>
         </dl>
         <div class="grid gap-(--spacing-brand-s) sm:grid-cols-2">
           <button type="button" hlmBtn [disabled]="submitting()" (click)="submit(true)">{{ 'auth.allow' | transloco }}</button>
           <button type="button" hlmBtn variant="outline" [disabled]="submitting()" (click)="submit(false)">{{ 'auth.deny' | transloco }}</button>
         </div>
       }
      @if (error()) { <p role="alert" class="mt-(--spacing-brand-m) text-sm text-brand-danger">{{ 'auth.consentFailed' | transloco }}</p> }
    </factory-auth-shell>
  `,
})
export class Consent implements OnInit {
  private readonly authFlow = inject(AuthFlowService);
  protected readonly context = signal<import('@agentic-software-factory/api-contracts/auth').ConsentContext | null>(null);
  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly error = signal(false);

  ngOnInit(): void {
    void this.authFlow.consentContext().then((context) => this.context.set(context)).catch(() => this.error.set(true)).finally(() => this.loading.set(false));
  }

  protected async submit(accept: boolean): Promise<void> {
    if (!this.context()) return;
    this.submitting.set(true);
    this.error.set(false);
    try {
      this.authFlow.follow(await this.authFlow.submitConsent(accept, window.location.search));
    } catch {
      this.error.set(true);
      this.submitting.set(false);
    }
  }
}
