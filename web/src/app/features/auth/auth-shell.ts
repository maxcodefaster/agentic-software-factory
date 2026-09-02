/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'factory-auth-shell',
  imports: [TranslocoPipe],
  template: `
    <div class="grid min-h-screen place-items-center p-(--spacing-brand-m) sm:p-(--spacing-brand-xl)">
      <div class="grid min-h-[min(42rem,calc(100dvh-3rem))] w-full max-w-6xl overflow-hidden rounded-2xl border border-brand-gray-200 bg-brand-surface shadow-xl md:grid-cols-[minmax(0,1.25fr)_minmax(20rem,25rem)]">
        <section class="flex min-w-0 flex-col justify-between bg-[linear-gradient(145deg,color-mix(in_srgb,var(--color-brand-mint-500)_10%,transparent),transparent_58%)] p-(--spacing-brand-l) sm:p-(--spacing-brand-xl)" aria-labelledby="auth-product-heading">
          <div class="flex items-center gap-(--spacing-brand-s) text-sm font-bold">
            <span aria-hidden="true" class="grid size-10 place-items-center rounded-brand-input bg-brand-mint-500 text-xs tracking-wider text-brand-ink shadow-md">ASF</span>
            <span>{{ 'auth.productName' | transloco }}</span>
          </div>
          <div class="my-(--spacing-brand-xl)">
            <p class="factory-section-label">{{ 'auth.eyebrow' | transloco }}</p>
            <h1 id="auth-product-heading" class="mt-(--spacing-brand-s) max-w-xl text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">{{ 'auth.productHeading' | transloco }}</h1>
            <p class="mt-(--spacing-brand-m) max-w-lg text-brand-gray-600">{{ 'auth.productText' | transloco }}</p>
          </div>
          <ol class="hidden flex-wrap gap-(--spacing-brand-xs) md:flex" [attr.aria-label]="'auth.stagesLabel' | transloco">
            <li class="rounded-full border border-brand-gray-200 bg-brand-surface/60 px-(--spacing-brand-s) py-(--spacing-brand-xxs) text-xs font-semibold">{{ 'auth.stageClarify' | transloco }}</li>
            <li class="rounded-full border border-brand-gray-200 bg-brand-surface/60 px-(--spacing-brand-s) py-(--spacing-brand-xxs) text-xs font-semibold">{{ 'auth.stageBuild' | transloco }}</li>
            <li class="rounded-full border border-brand-gray-200 bg-brand-surface/60 px-(--spacing-brand-s) py-(--spacing-brand-xxs) text-xs font-semibold">{{ 'auth.stageReview' | transloco }}</li>
            <li class="rounded-full border border-brand-gray-200 bg-brand-surface/60 px-(--spacing-brand-s) py-(--spacing-brand-xxs) text-xs font-semibold">{{ 'auth.stageMerge' | transloco }}</li>
          </ol>
        </section>
        <section class="flex items-center border-t border-brand-gray-200 p-(--spacing-brand-l) sm:p-(--spacing-brand-xl) md:border-t-0 md:border-l" [attr.aria-label]="'auth.accountAccess' | transloco">
          <div class="mx-auto w-full max-w-sm"><ng-content /></div>
        </section>
      </div>
    </div>
  `,
})
export class AuthShell {}
