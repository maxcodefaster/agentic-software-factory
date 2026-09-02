/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

import { Icon } from '../icon/icon';

/**
 * `<factory-loading>` — the standard "… wird geladen" row (spinner + label) inside
 * a card. Pass a `text` (already translated by the caller) for a specific
 * message, else it falls back to the generic "Loading …". Replaces the
 * per-feature copies (Board, Systeme, Team).
 */
@Component({
  selector: 'factory-loading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslocoPipe],
  template: `
    <div class="factory-card flex items-center gap-(--spacing-brand-xs) text-brand-gray-500">
      <factory-icon name="loader" size="lg" class="animate-spin" />
      <span>{{ text() || ("common.loading" | transloco) }}</span>
    </div>
  `,
})
export class LoadingState {
  readonly text = input('');
}

/**
 * `<factory-error>` — the standard danger box. `role="alert"` so it's announced.
 * Replaces the per-feature copies (Board, Systeme, Scoreboard, Katalog, …).
 */
@Component({
  selector: 'factory-error',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div
      role="alert"
      class="flex items-center gap-(--spacing-brand-xs) rounded-brand-lg border border-brand-danger/30 bg-brand-danger/5 p-(--spacing-brand-l) text-brand-danger"
    >
      <factory-icon name="triangle-alert" size="lg" />
      <span>{{ message() }}</span>
    </div>
  `,
})
export class ErrorState {
  readonly message = input.required<string>();
}
