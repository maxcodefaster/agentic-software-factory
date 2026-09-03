/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, computed, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HlmButton } from '@spartan-ng/helm/button';

import type { ApplicationSummary } from '@agentic-software-factory/api-contracts/applications';
import type { ApplicationRef, KanbanColumnId, RequirementSpec } from '@agentic-software-factory/api-contracts/kanban';
import type { KanbanCard } from '../../core/api/kanban.types';
import type { FactoryRequestContext } from '../../core/context/factory-context.store';
import { Icon } from '../../shared/icon/icon';
import { Overlay } from '../../shared/overlay/overlay';
import { CardApplications } from './card-applications';
import { CardInterview } from './card-interview';
import { CardSpec } from './card-spec';
import { CardSpecEditor } from './card-spec-editor';
import { DeveloperMode } from './developer-mode';
import { JourneySteps } from './journey-steps';
import { TicketDossier } from './ticket-dossier';

export interface CardPatch {
  title: string;
  description: string;
  assignee: string | null;
  applications?: ApplicationRef[];
}

export interface CardAdvance {
  patch: CardPatch;
  toColumn: KanbanColumnId;
  specification?: RequirementSpec;
}

@Component({
  selector: 'factory-card-detail',
  imports: [Overlay, HlmButton, Icon, CardApplications, CardInterview, CardSpec, CardSpecEditor, DeveloperMode, JourneySteps, TicketDossier, TranslocoPipe],
  templateUrl: './card-detail.html',
  styles: `
    .ticket-initial-focus:focus,
    .ticket-initial-focus:focus-visible { outline: none; }
  `,
})
export class CardDetail {
  private readonly transloco = inject(TranslocoService);
  readonly card = input.required<KanbanCard>();
  protected readonly context = computed<FactoryRequestContext>(() => ({ team: this.card().teamSlug, application: this.card().systemId || null }));
  readonly applications = input<ApplicationSummary[]>([]);
  readonly canManageRequirements = input(false);
  readonly canMoveRequirements = input(false);
  readonly canInterview = input(false);
  readonly canImplement = input(false);
  readonly canReview = input(false);
  readonly saving = input(false);
  readonly error = input<string | null>(null);
  readonly save = output<CardPatch>();
  readonly saveSpecification = output<RequirementSpec>();
  readonly requirementsChanged = output<void>();
  readonly deliveryChanged = output<void>();
  readonly advance = output<CardAdvance>();
  readonly moveBackward = output<KanbanColumnId>();
  readonly remove = output<void>();
  readonly dismiss = output<void>();

  protected readonly title = linkedSignal<string, string>({ source: () => this.card().id, computation: () => untracked(() => this.card().title) });
  protected readonly description = linkedSignal<string, string>({ source: () => this.card().id, computation: () => untracked(() => this.card().description) });
  protected readonly assignee = linkedSignal<string, string>({ source: () => this.card().id, computation: () => untracked(() => this.card().assignee ?? '') });
  protected readonly selectedApplications = linkedSignal<string, ApplicationRef[]>({ source: () => this.card().id, computation: () => untracked(() => this.card().applications) });
  protected readonly liveSpec = linkedSignal<string, RequirementSpec | null>({ source: () => this.card().id, computation: () => untracked(() => this.card().meta['requirementSpec'] as RequirementSpec | undefined ?? null) });
  protected readonly spec = computed(() => this.liveSpec());
  protected readonly specificationState = computed(() => this.card().meta['specificationState'] as string ?? 'draft');
  protected readonly specDirty = computed(() => JSON.stringify(this.liveSpec()) !== JSON.stringify(this.card().meta['requirementSpec'] ?? null));
  protected readonly confirmingDelete = signal(false);
  protected readonly confirmingClose = signal(false);
  protected readonly editingSpecification = signal(false);

  protected readonly isIdea = computed(() => this.card().column === 'ideation');
  protected readonly isRequirements = computed(() => this.card().column === 'requirements');
  protected readonly isImplementation = computed(() => this.card().column === 'implementation');
  protected readonly isDone = computed(() => this.card().column === 'done');
  protected readonly needsDeliveryReconciliation = computed(() => this.isDone() && this.card().deliveryPhase === 'merging');
  protected readonly titleEditable = computed(() => this.canManageRequirements() && (this.isIdea() || this.isRequirements()));
  protected readonly dirty = computed(() => {
    const card = this.card();
    return this.title().trim() !== card.title || this.description().trim() !== card.description || (this.assignee().trim() || null) !== card.assignee || JSON.stringify(this.selectedApplications()) !== JSON.stringify(card.applications);
  });

  protected readonly nextUnlocked = computed(() => {
    if (this.isIdea()) return this.title().trim().length > 0;
    if (this.isRequirements()) return Boolean(this.spec()?.goal.trim()) && Boolean(this.spec()?.acceptanceCriteria.length) && this.selectedApplications().length > 0 && !this.specDirty();
    return true;
  });

  protected readonly nextHint = computed(() => {
    if (this.isIdea() && !this.title().trim()) return this.transloco.translate('card.hintNeedTitle');
    if (this.isRequirements() && !this.spec()) return this.transloco.translate('card.hintNeedInterview');
    if (this.isRequirements() && this.specDirty()) return this.transloco.translate('factory.saveBeforeConfirm');
    if (this.isRequirements() && !this.spec()?.goal.trim()) return this.transloco.translate('card.hintNeedGoal');
    if (this.isRequirements() && !this.spec()?.acceptanceCriteria.length) return this.transloco.translate('card.hintNeedCriterion');
    if (this.isRequirements() && this.selectedApplications().length === 0) return this.transloco.translate('card.hintNeedApplication');
    return null;
  });

  protected saveInPlace(): void { if (this.canManageRequirements() && this.title().trim()) this.save.emit(this.patch()); }
  protected onSpecFinalized(spec: RequirementSpec): void { this.liveSpec.set(spec); }
  protected onSpecChanged(spec: RequirementSpec): void { this.liveSpec.set(spec); }
  protected saveDraft(): void { if (this.canManageRequirements() && this.spec()) { this.saveSpecification.emit(this.spec()!); this.editingSpecification.set(false); } }
  protected cancelSpecificationEdit(): void {
    this.liveSpec.set(this.card().meta['requirementSpec'] as RequirementSpec | undefined ?? null);
    this.editingSpecification.set(false);
  }
  protected onInterviewReopened(): void { this.liveSpec.set(null); }
  protected assign(username: string | null): void { this.assignee.set(username ?? ''); this.saveInPlace(); }

  protected advanceStage(): void {
    if (!this.canManageRequirements() || !this.nextUnlocked() || this.specDirty() || this.saving()) return;
    if (this.isIdea()) this.advance.emit({ patch: this.patch(), toColumn: 'requirements' });
    else if (this.isRequirements() && this.spec()) this.advance.emit({ patch: this.patch(), toColumn: 'implementation', specification: this.spec()! });
  }

  protected close(): void {
    if (this.saving()) return;
    if (this.dirty() || this.specDirty()) { this.confirmingClose.set(true); return; }
    this.dismiss.emit();
  }
  protected discardAndClose(): void { this.confirmingClose.set(false); this.dismiss.emit(); }

  private patch(): CardPatch {
    return { title: this.title().trim(), description: this.description().trim(), assignee: this.assignee().trim() || null, applications: this.selectedApplications() };
  }
}
