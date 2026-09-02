/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, computed, effect, input, output, signal } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { TranslocoPipe } from '@jsverse/transloco';

import type { ApplicationSummary } from '@agentic-software-factory/api-contracts/applications';
import type { ApplicationRef } from '@agentic-software-factory/api-contracts/kanban';
import { Icon } from '../../shared/icon/icon';

@Component({
  selector: 'factory-card-applications',
  imports: [HlmButton, Icon, TranslocoPipe],
  template: `
    <div class="flex flex-col gap-(--spacing-brand-s)">
      <span class="factory-section-label">{{ 'factory.applications' | transloco }}</span>
      <div class="flex flex-col gap-(--spacing-brand-xxs)">
        @for (application of applications(); track application.id) {
          <button type="button" class="factory-selectable flex items-center gap-(--spacing-brand-xs) px-(--spacing-brand-s) py-(--spacing-brand-xs) text-left" role="checkbox" [attr.aria-checked]="isSelected(application.id)" [class.is-selected]="isSelected(application.id)" [disabled]="!editable()" (click)="toggle(application.id)">
            <span class="grid size-5 place-items-center border border-brand-gray-300" [class.bg-brand-mint-500]="isSelected(application.id)">@if (isSelected(application.id)) {<factory-icon name="check" size="xs" />}</span>
            <span class="min-w-0 flex-1"><strong class="block text-sm">{{ application.name }}</strong><span class="text-meta text-brand-gray-600">{{ application.status }}</span></span>
            <span class="h-2 w-2 rounded-full" [class.bg-brand-success]="application.healthy" [class.bg-brand-warning]="!application.healthy"></span>
          </button>
        } @empty {<p class="text-meta text-brand-gray-600">{{ 'card.noApplications' | transloco }}</p>}
      </div>
      @if (editable() && dirty()) {<div class="flex justify-end"><button hlmBtn size="sm" (click)="save()">{{ 'card.saveApplications' | transloco }}</button></div>}
    </div>
  `,
})
export class CardApplications {
  readonly applications = input<ApplicationSummary[]>([]);
  readonly value = input<ApplicationRef[]>([]);
  readonly editable = input(false);
  readonly changed = output<ApplicationRef[]>();
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly dirty = computed(() => {
    const current = new Set(this.value().map((application) => application.id));
    const selected = this.selected();
    return current.size !== selected.size || [...selected].some((id) => !current.has(id));
  });

  constructor() {
    effect(() => this.selected.set(new Set(this.value().map((application) => application.id))));
  }
  protected isSelected(id: string): boolean { return this.selected().has(id); }
  protected toggle(id: string): void { const next = new Set(this.selected()); if (next.has(id)) next.delete(id); else next.add(id); this.selected.set(next); }
  protected save(): void { this.changed.emit(this.applications().filter((application) => this.selected().has(application.id)).map(({ id, name }) => ({ id, name }))); }
}
