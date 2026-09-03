/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';

import type { ApplicationSummary } from '@agentic-software-factory/api-contracts/applications';
import type { KanbanColumnId } from '@agentic-software-factory/api-contracts/kanban';
import type { CreateCardInput } from '../../core/api/kanban.types';
import type { FactoryRequestContext } from '../../core/context/factory-context.store';
import { Icon } from '../../shared/icon/icon';
import { Overlay } from '../../shared/overlay/overlay';
import { AssigneePicker } from './assignee-picker';

@Component({
  selector: 'factory-card-create',
  imports: [AssigneePicker, Overlay, HlmButton, HlmInput, Icon, TranslocoPipe],
  templateUrl: './card-create.html',
})
export class CardCreate {
  private readonly transloco = inject(TranslocoService);
  readonly column = input.required<KanbanColumnId>();
  readonly context = input<FactoryRequestContext>({ team: 'factory', application: null });
  readonly applications = input<ApplicationSummary[]>([]);
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly create = output<CreateCardInput>();
  readonly dismiss = output<void>();

  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly assignee = signal<string | null>(null);
  protected readonly localError = signal<string | null>(null);
  protected readonly selectedCount = computed(() => this.selected().size);

  constructor() {
    effect(() => {
      if (this.applications().length === 1) this.selected.set(new Set([this.applications()[0]!.id]));
    });
  }

  protected isSelected(id: string): boolean { return this.selected().has(id); }

  protected toggle(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selected.set(next);
  }

  protected submit(): void {
    const title = this.title().trim();
    if (!title) {
      this.localError.set(this.transloco.translate('card.errNeedTitle'));
      return;
    }
    this.create.emit({
      title,
      description: this.description().trim() || title,
      column: this.column(),
      teamSlug: '',
      applicationIds: [...this.selected()],
      assignee: this.assignee(),
    });
  }
}
