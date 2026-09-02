/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

import type { KanbanCard } from '@agentic-software-factory/api-contracts/kanban';
import type { FactoryRequestContext } from '../../core/context/factory-context.store';
import { Icon } from '../../shared/icon/icon';
import { AssigneePicker } from './assignee-picker';
import { CardActivity } from './card-activity';

@Component({
  selector: 'factory-ticket-dossier',
  imports: [AssigneePicker, CardActivity, Icon, TranslocoPipe],
  styleUrl: './ticket-dossier.css',
  template: `
    <aside class="ticket-dossier" [attr.aria-label]="'factory.ticketDossier' | transloco">
      <div class="flex items-center justify-end gap-(--spacing-brand-xs)">
        <a [href]="card().url" target="_blank" rel="noopener" class="inline-flex items-center gap-(--spacing-brand-xxs) text-meta text-brand-gray-600">
          Git <factory-icon name="external-link" size="xs" />
        </a>
      </div>

      <section class="ticket-dossier-section">
        <span class="factory-section-label">{{ 'factory.responsible' | transloco }}</span>
        @if (editable()) {
          <div class="mt-(--spacing-brand-xs)"><factory-assignee-picker [context]="context()" [value]="assignee()" (selected)="assigneeChanged.emit($event)" /></div>
        } @else {
          <div class="mt-(--spacing-brand-xs) flex items-center gap-(--spacing-brand-xs)">
            <span class="text-sm text-brand-gray-600">{{ assignee() || ('factory.unassigned' | transloco) }}</span>
          </div>
        }
      </section>

      <details open class="ticket-dossier-section">
        <summary class="cursor-pointer text-sm font-medium text-brand-gray-700">{{ 'factory.detailsAndHistory' | transloco }}</summary>
        <div class="mt-(--spacing-brand-s) flex flex-col gap-(--spacing-brand-s)">
          <div><span class="factory-section-label">{{ 'factory.originalIdea' | transloco }}</span><p class="mt-(--spacing-brand-xs) whitespace-pre-wrap text-sm leading-relaxed text-brand-gray-600">{{ card().description }}</p></div>
          @if (acceptedRevision(); as revision) {<div><span class="factory-section-label">{{ 'factory.acceptedRevision' | transloco }}</span><p class="mt-(--spacing-brand-xs) break-all font-mono text-micro text-brand-gray-600">{{ revision }}</p></div>}
          <div><span class="factory-section-label">{{ 'factory.history' | transloco }}</span><div class="mt-(--spacing-brand-xs)"><factory-card-activity [context]="context()" [cardId]="card().id" /></div></div>
        </div>
      </details>
    </aside>
  `,
})
export class TicketDossier {
  readonly card = input.required<KanbanCard>();
  readonly context = input.required<FactoryRequestContext>();
  readonly assignee = input<string | null>(null);
  readonly editable = input(false);
  readonly assigneeChanged = output<string | null>();
  protected readonly acceptedRevision = computed(() => {
    const acceptance = this.card().meta['acceptance'] as { digest?: string; revision?: string } | undefined;
    return acceptance?.digest || acceptance?.revision || null;
  });

}
