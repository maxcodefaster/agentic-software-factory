/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import type { AuthUiConfig } from '@agentic-software-factory/api-contracts/auth';
import { AuthFlowService } from '../../core/auth/auth-flow.service';
import { AuthShell } from './auth-shell';

@Component({
  selector: 'factory-login',
  imports: [AuthShell, HlmButton, HlmInput, ReactiveFormsModule, TranslocoPipe],
  template: `
    <factory-auth-shell>
      <h2 class="text-3xl font-semibold">{{ 'auth.loginTitle' | transloco }}</h2>
      <p class="mt-(--spacing-brand-xs) text-sm text-brand-gray-600">{{ 'auth.loginText' | transloco }}</p>

      @if (loading()) {
        <p role="status" class="mt-(--spacing-brand-l) text-sm text-brand-gray-600">{{ 'common.loading' | transloco }}</p>
      } @else if (config(); as authConfig) {
        @if (authConfig.organizationSignIn) {
          <button type="button" hlmBtn variant="outline" class="mt-(--spacing-brand-l) w-full" [disabled]="submitting()" (click)="submitOrganization()">
            {{ 'auth.organizationSignIn' | transloco }}
          </button>
        }
        @if (authConfig.localEmailPassword) {
          @if (authConfig.organizationSignIn) {
            <div class="my-(--spacing-brand-l) flex items-center gap-(--spacing-brand-s) text-xs text-brand-gray-500" aria-hidden="true"><span class="h-px flex-1 bg-brand-gray-200"></span>{{ 'auth.or' | transloco }}<span class="h-px flex-1 bg-brand-gray-200"></span></div>
          }
          <form class="mt-(--spacing-brand-l) grid gap-(--spacing-brand-m)" [formGroup]="form" (ngSubmit)="submitEmail()" novalidate>
            <label class="grid gap-(--spacing-brand-xxs) text-sm font-semibold" for="auth-email">{{ 'auth.email' | transloco }}</label>
             <input id="auth-email" hlmInput type="email" autocomplete="username" formControlName="email" [attr.aria-invalid]="form.controls.email.touched && form.controls.email.invalid" [attr.aria-describedby]="form.controls.email.touched && form.controls.email.invalid ? 'auth-email-error' : null" />
             @if (form.controls.email.touched && form.controls.email.invalid) { <p id="auth-email-error" class="text-xs text-brand-danger">{{ 'auth.emailInvalid' | transloco }}</p> }
            <label class="grid gap-(--spacing-brand-xxs) text-sm font-semibold" for="auth-password">{{ 'auth.password' | transloco }}</label>
             <input id="auth-password" hlmInput type="password" autocomplete="current-password" formControlName="password" [attr.aria-invalid]="form.controls.password.touched && form.controls.password.invalid" [attr.aria-describedby]="form.controls.password.touched && form.controls.password.invalid ? 'auth-password-error' : null" />
             @if (form.controls.password.touched && form.controls.password.invalid) { <p id="auth-password-error" class="text-xs text-brand-danger">{{ 'auth.passwordRequired' | transloco }}</p> }
            <button type="submit" hlmBtn class="w-full" [disabled]="submitting()">{{ (submitting() ? 'auth.signingIn' : 'common.signIn') | transloco }}</button>
          </form>
        }
        @if (!authConfig.organizationSignIn && !authConfig.localEmailPassword) {
          <p class="mt-(--spacing-brand-l) text-sm text-brand-gray-600">{{ 'auth.noMethods' | transloco }}</p>
        }
      }
      @if (error()) { <p role="alert" class="mt-(--spacing-brand-m) text-sm text-brand-danger">{{ error()! | transloco }}</p> }
      <p class="mt-(--spacing-brand-l) border-t border-brand-gray-200 pt-(--spacing-brand-m) text-xs text-brand-gray-600">{{ 'auth.managedAccess' | transloco }}</p>
    </factory-auth-shell>
  `,
})
export class Login implements OnInit {
  private readonly authFlow = inject(AuthFlowService);
  protected readonly config = signal<AuthUiConfig | null>(null);
  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  ngOnInit(): void {
    void this.loadConfig();
  }

  protected async submitEmail(): Promise<void> {
    if (this.form.invalid || !this.config()) {
      this.form.markAllAsTouched();
      return;
    }
    await this.submit(() => this.authFlow.signInWithEmail(
      this.form.controls.email.value,
      this.form.controls.password.value,
      this.authFlow.returnTo(this.config()!),
      this.authFlow.oauthQuery(),
    ));
  }

  protected async submitOrganization(): Promise<void> {
    if (!this.config()) return;
    await this.submit(() => this.authFlow.signInWithOrganization(this.authFlow.returnTo(this.config()!), this.authFlow.oauthQuery()));
  }

  private async loadConfig(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.config.set(await this.authFlow.config());
    } catch {
      this.error.set('auth.configFailed');
    } finally {
      this.loading.set(false);
    }
  }

  private async submit(action: () => Promise<string>): Promise<void> {
    this.submitting.set(true);
    this.error.set(null);
    try {
      this.authFlow.follow(await action());
    } catch {
      this.error.set('auth.loginFailed');
      this.submitting.set(false);
    }
  }
}
