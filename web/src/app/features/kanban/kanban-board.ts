/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import {
  CdkDrag,
  type CdkDragDrop,
  CdkDropList,
  CdkDropListGroup,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import { Component, effect, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButton } from '@spartan-ng/helm/button';

import type { ApplicationSummary } from '@agentic-software-factory/api-contracts/applications';
import type { KanbanColumnId, RequirementSpec } from '@agentic-software-factory/api-contracts/kanban';
import type { CreateCardInput, KanbanCard } from '../../core/api/kanban.types';
import { AuthService } from '../../core/auth/auth.service';
import { SystemContextService } from '../../core/system/system-context.service';
import { TeamContextService } from '../../core/team/team-context.service';
import { Avatar } from '../../shared/avatar/avatar';
import { ErrorState, LoadingState } from '../../shared/feedback/feedback';
import { Icon } from '../../shared/icon/icon';
import { BoardStore } from './board.store';
import { CardCreate } from './card-create';
import { type CardAdvance, CardDetail, type CardPatch } from './card-detail';

@Component({
  selector: 'factory-kanban-board',
  imports: [
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    HlmButton,
    Icon,
    CardCreate,
    CardDetail,
    LoadingState,
    ErrorState,
    Avatar,
    TranslocoPipe,
  ],
  templateUrl: './kanban-board.html',
  styleUrls: ['./kanban-board.css'],
})
export class KanbanBoard {
  private readonly store = inject(BoardStore);
  private readonly router = inject(Router);
  protected readonly team = inject(TeamContextService);
  protected readonly systems = inject(SystemContextService);
  protected readonly auth = inject(AuthService);
  readonly requirementId = input<string>();

  protected readonly columns = this.store.columns;
  protected readonly activeSystem = this.systems.activeSystem;
  protected readonly forgejoConnectUrl = this.store.forgejoConnectUrl;
  protected readonly workspaceBusy = this.store.workspaceBusy;
  protected readonly workspaceError = this.store.workspaceError;
  protected readonly selectedCard = this.store.selectedCard;
  protected readonly loading = this.store.loading;
  protected readonly error = this.store.error;
  protected readonly loadingMore = this.store.loadingMore;
  protected readonly partialError = this.store.partialError;
  protected readonly notice = this.store.notice;
  protected readonly savingDetail = this.store.savingDetail;
  protected readonly detailError = this.store.detailError;
  protected readonly creatingIn = this.store.creatingIn;
  protected readonly creating = this.store.creating;
  protected readonly createError = this.store.createError;
  private justDragged = false;

  protected readonly columnIcon: Record<KanbanColumnId, string> = {
    ideation: 'sparkles',
    requirements: 'book-open',
    implementation: 'zap',
    done: 'circle-check',
  };

  constructor() {
    effect(() => {
      this.store.selectRequirement(this.requirementId());
    });
    effect(() => {
      const event = this.store.event();
      if (event?.type === 'deleted') void this.navigateWithContext(['/']);
    });
  }

  protected retry(): void { this.store.retry(); }
  protected colLabelKey(id: KanbanColumnId): string {
    return `board.col${id.charAt(0).toUpperCase()}${id.slice(1)}`;
  }

  protected colHintKey(id: KanbanColumnId): string {
    return `factory.${id === 'ideation' ? 'idea' : id}Hint`;
  }

  protected runtimeApp(system: ApplicationSummary, slug: string) {
    return system.apps.find((app) => app.slug === slug) ?? null;
  }

  protected appHealthIcon(health: ApplicationSummary['apps'][number]['health']): string {
    if (health === 'healthy') return 'rocket';
    if (health === 'initializing') return 'loader';
    if (health === 'disabled') return 'lock';
    return 'circle-alert';
  }

  protected openSystemIde(system: ApplicationSummary): void {
    const url = this.store.openWorkspace(system);
    if (url) window.open(url, '_blank', 'noopener');
  }

  protected retryStaging(system: ApplicationSummary): void {
    this.store.retryStaging(system);
  }

  protected cardStatus(card: KanbanCard): { label: string; tone: string; icon: string; pulse: boolean } | null {
    if (card.column === 'done') return { label: 'factory.status.done', tone: 'success', icon: 'circle-check', pulse: false };
    if (card.column === 'implementation') {
      if (card.deliveryPhase) {
        const delivery = {
          unplanned: { label: 'factory.status.unplanned', tone: 'brand', icon: 'zap', pulse: false },
          provisioning: { label: 'factory.status.provisioning', tone: 'info', icon: 'loader', pulse: true },
          'agent-running': { label: 'factory.status.agent-running', tone: 'info', icon: 'loader', pulse: true },
          'agent-failed': { label: 'factory.status.agent-failed', tone: 'danger', icon: 'circle-alert', pulse: false },
          implementing: { label: 'factory.status.implementing', tone: 'info', icon: 'loader', pulse: true },
          'checks-failing': { label: 'factory.status.checks-failing', tone: 'danger', icon: 'circle-alert', pulse: false },
          'awaiting-review': { label: 'factory.status.awaiting-review', tone: 'info', icon: 'list-checks', pulse: false },
          'changes-requested': { label: 'factory.status.changes-requested', tone: 'warning', icon: 'pencil', pulse: false },
          'ready-to-merge': { label: 'factory.status.ready-to-merge', tone: 'success', icon: 'lock', pulse: false },
          merging: { label: 'factory.status.merging', tone: 'info', icon: 'loader', pulse: true },
          done: { label: 'factory.status.done', tone: 'success', icon: 'circle-check', pulse: false },
        } as const;
        return delivery[card.deliveryPhase];
      }
      return { label: 'factory.status.unplanned', tone: 'brand', icon: 'zap', pulse: false };
    }
    if (card.meta['specificationState'] === 'proposed') return { label: 'factory.status.confirmReady', tone: 'success', icon: 'list-checks', pulse: false };
    if (card.column === 'requirements') {
      const interview = card.meta['interview'] as { pending?: unknown; pendingOperation?: unknown; done?: boolean } | undefined;
      if (!interview?.done && (interview?.pending || interview?.pendingOperation)) return { label: 'factory.status.clarifying', tone: 'info', icon: 'loader', pulse: true };
      return { label: 'factory.status.clarify', tone: 'brand', icon: 'sparkles', pulse: false };
    }
    return null;
  }

  protected onDrop(event: CdkDragDrop<KanbanCard[]>): void {
    if (!this.auth.canMoveRequirements()) return;
    const snapshot = this.columns();
    const columns = snapshot.map((column) => ({ ...column, cards: [...column.cards] }));
    const target = columns.find((column) => column.id === event.container.id);
    const source = columns.find((column) => column.id === event.previousContainer.id);
    if (!target || !source || target.id === 'done' || source.id === 'done') return;
    if (source.id === target.id) return;
    if (target.id === 'implementation' && source.id !== 'implementation') {
      this.store.implementationMoveBlocked();
      return;
    }
    transferArrayItem(source.cards, target.cards, event.previousIndex, event.currentIndex);
    const card = target.cards[event.currentIndex];
    if (!card) return;
    const order: KanbanColumnId[] = ['ideation', 'requirements', 'implementation', 'done'];
    if (order.indexOf(target.id) < order.indexOf(source.id)) return;
    this.store.moveCard(card, target.id, columns);
  }

  protected moveCard(card: KanbanCard, column: KanbanColumnId): void {
    if (!this.auth.canMoveRequirements()) return;
    if (card.column === 'done' || column === 'done' || column === card.column) return;
    if (column === 'implementation') {
      this.store.implementationMoveBlocked();
      return;
    }
    const order: KanbanColumnId[] = ['ideation', 'requirements', 'implementation', 'done'];
    if (order.indexOf(column) < order.indexOf(card.column)) return;
    this.store.moveCard(card, column);
  }

  protected openAdd(): void {
    this.store.openCreate();
  }

  protected closeCreate(): void {
    this.store.closeCreate();
  }

  protected onCreate(input: CreateCardInput): void {
    this.store.createCard(input);
  }

  protected openCard(card: KanbanCard): void {
    if (!this.justDragged) {
      this.store.selectCard(card);
      void this.navigateWithContext(['/board', String(card.number)]);
    }
  }

  protected closeDetail(): void {
    this.store.closeDetail();
    void this.navigateWithContext(['/']);
  }

  protected onDetailSave(patch: CardPatch): void {
    this.store.saveDetail(patch);
  }

  protected onSpecificationSave(specification: RequirementSpec): void {
    this.store.saveProposal(specification);
  }

  protected refreshRequirements(): void {
    this.store.refresh();
  }

  protected refreshApplications(): void {
    this.systems.refresh();
  }

  protected onDetailAdvance(advance: CardAdvance): void {
    this.store.advance(advance);
  }

  protected onDetailRemove(): void {
    this.store.deleteCard();
  }

  private navigateWithContext(commands: string[]): Promise<boolean> {
    return this.router.navigate(commands, {
      queryParams: { team: this.team.activeTeam(), application: this.activeSystem()?.id ?? null },
    });
  }

  protected onCardPointerDown(): void { this.justDragged = false; }
  protected onDragStarted(): void { this.justDragged = true; }
  protected clearNotice(): void { this.store.clearNotice(); }
}
