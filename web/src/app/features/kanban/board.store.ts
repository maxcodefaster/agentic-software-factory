/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { computed, DestroyRef, effect, Injectable, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import {
  EMPTY,
  Subject,
  catchError,
  defer,
  expand,
  exhaustMap,
  finalize,
  map,
  mergeMap,
  switchMap,
  takeUntil,
  tap,
  throwError,
  timer,
  type Observable,
} from 'rxjs';

import type { ApplicationSummary, DeveloperWorkspace } from '@agentic-software-factory/api-contracts/applications';
import type { KanbanColumnId, RequirementSpec } from '@agentic-software-factory/api-contracts/kanban';
import { ApplicationsClient } from '../../core/api/applications.client';
import { KanbanClient } from '../../core/api/kanban.client';
import type { CreateCardInput, KanbanBoardPage, KanbanCard, KanbanColumn } from '../../core/api/kanban.types';
import { AuthService } from '../../core/auth/auth.service';
import type { FactoryRequestContext } from '../../core/context/factory-context.store';
import { SystemContextService } from '../../core/system/system-context.service';
import { TeamContextService } from '../../core/team/team-context.service';
import type { CardAdvance, CardPatch } from './card-detail';

type CardCommand =
  | { type: 'move'; context: FactoryRequestContext; card: KanbanCard; column: KanbanColumnId; snapshot: KanbanColumn[] }
  | { type: 'create'; context: FactoryRequestContext; input: CreateCardInput }
  | { type: 'update'; context: FactoryRequestContext; card: KanbanCard; patch: CardPatch }
  | { type: 'proposal'; context: FactoryRequestContext; card: KanbanCard; specification: RequirementSpec }
  | { type: 'advance'; context: FactoryRequestContext; card: KanbanCard; advance: CardAdvance }
  | { type: 'delete'; context: FactoryRequestContext; card: KanbanCard };

interface CommandFailure {
  stage: 'update' | 'accept' | 'move';
  failure: unknown;
}

const MAX_BOARD_REQUESTS = 100;

export interface BoardStoreEvent {
  sequence: number;
  type: 'deleted';
}

@Injectable()
export class BoardStore {
  private readonly api = inject(KanbanClient);
  private readonly applicationsApi = inject(ApplicationsClient);
  private readonly auth = inject(AuthService);
  private readonly transloco = inject(TranslocoService);
  private readonly team = inject(TeamContextService);
  private readonly systems = inject(SystemContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reads = new Subject<{ context: FactoryRequestContext; initial: boolean; cursor?: string; append: boolean }>();
  private readonly cancelReads = new Subject<void>();
  private readonly cancelCardCommands = new Subject<void>();
  private readonly cancelWorkspaceCommands = new Subject<void>();
  private readonly cardCommands = new Subject<CardCommand>();
  private readonly workspaceCommands = new Subject<ApplicationSummary>();
  private readonly stagingCommands = new Subject<ApplicationSummary>();
  private readonly notices = new Subject<string | null>();
  private readonly developerWorkspaces = signal<Record<string, DeveloperWorkspace>>({});
  private readonly busyWorkspaces = signal<Set<string>>(new Set());
  private readonly workspaceErrors = signal<Record<string, string>>({});
  private readonly forgejoConnectUrls = signal<Record<string, string>>({});
  private readonly busyStaging = signal<Set<string>>(new Set());
  private context: FactoryRequestContext | null = null;
  private contextKey: string | null = null;
  private boardLoaded = false;
  private cardCommandBusy = false;
  private eventSequence = 0;
  private requirementId: string | undefined;
  private nextCursor: string | null = null;

  readonly columns = signal<KanbanColumn[]>([]);
  readonly selectedCard = signal<KanbanCard | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly loadingMore = signal(false);
  readonly partialError = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly savingDetail = signal(false);
  readonly detailError = signal<string | null>(null);
  readonly creatingIn = signal<KanbanColumnId | null>(null);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly event = signal<BoardStoreEvent | null>(null);
  readonly developerWorkspace = computed(() => {
    const id = this.systems.activeSystem()?.id;
    return id ? this.developerWorkspaces()[id] ?? null : null;
  });
  readonly workspaceBusy = computed(() => {
    const id = this.systems.activeSystem()?.id;
    return id ? this.busyWorkspaces().has(id) : false;
  });
  readonly workspaceError = computed(() => {
    const id = this.systems.activeSystem()?.id;
    return id ? this.workspaceErrors()[id] ?? null : null;
  });
  readonly forgejoConnectUrl = computed(() => {
    const id = this.systems.activeSystem()?.id;
    return id ? this.forgejoConnectUrls()[id] ?? null : null;
  });

  constructor() {
    this.reads.pipe(
      switchMap(({ context, initial, cursor, append }) => defer(() => {
        let pages = 0;
        let lastCursor: string | null = cursor ?? null;
        return this.api.getBoard(context, cursor).pipe(
          expand((page) => {
            pages += 1;
            lastCursor = page.nextCursor;
            return page.nextCursor && pages < MAX_BOARD_REQUESTS ? this.api.getBoard(context, page.nextCursor) : EMPTY;
          }),
          map((page, index) => ({ page, append: append || index > 0 })),
          takeUntil(this.cancelReads),
          tap(({ page, append: appendPage }) => this.acceptRead(context, page, appendPage)),
          tap({
            complete: () => {
              if (!this.matches(context)) return;
              this.loadingMore.set(false);
              if (lastCursor && pages >= MAX_BOARD_REQUESTS) this.partialError.set(this.transloco.translate('board.partialLimit'));
              else this.partialError.set(null);
            },
          }),
          catchError(() => {
            if (this.matches(context)) {
              if (this.boardLoaded) this.partialError.set(this.transloco.translate('board.partialError'));
              else this.error.set(this.transloco.translate('board.errLoad'));
              this.loading.set(false);
              this.loadingMore.set(false);
            }
            return EMPTY;
          }),
          finalize(() => {
            if (initial && this.matches(context) && !this.boardLoaded) this.loading.set(false);
          }),
        );
      })),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    this.cardCommands.pipe(
      exhaustMap((command) => defer(() => this.executeCardCommand(command)).pipe(
        takeUntil(this.cancelCardCommands),
        catchError((failure) => {
          this.failCardCommand(command, failure);
          return EMPTY;
        }),
        finalize(() => {
          this.cardCommandBusy = false;
          this.savingDetail.set(false);
          this.creating.set(false);
        }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    this.workspaceCommands.pipe(
      mergeMap((system) => this.applicationsApi.createWorkspace(this.contextFor(system.team, system.id), system.id).pipe(
        takeUntil(this.cancelWorkspaceCommands),
        tap((workspace) => {
          this.developerWorkspaces.update((workspaces) => ({ ...workspaces, [system.id]: workspace }));
          this.removeBusy(this.busyWorkspaces, system.id);
          if (!workspace.ideUrl) this.setWorkspaceError(system.id, this.transloco.translate('applications.developerWorkspaceError'));
          else this.showNotice(this.transloco.translate('applications.developerWorkspaceReady'));
        }),
        catchError(() => {
          this.setWorkspaceError(system.id, this.transloco.translate('applications.developerWorkspaceError'));
          return this.applicationsApi.developmentTools().pipe(
            tap((tools) => {
              if (!tools.forgejoConnected && tools.connectUrl) {
                this.forgejoConnectUrls.update((urls) => ({ ...urls, [system.id]: tools.connectUrl! }));
              }
            }),
            catchError(() => EMPTY),
          );
        }),
        finalize(() => this.removeBusy(this.busyWorkspaces, system.id)),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    this.stagingCommands.pipe(
      mergeMap((system) => this.applicationsApi.retryStaging(system.id, system.team).pipe(
        tap(() => this.systems.refresh()),
        catchError(() => {
          this.setWorkspaceError(system.id, this.transloco.translate('applications.workspaceError'));
          return EMPTY;
        }),
        finalize(() => this.removeBusy(this.busyStaging, system.id)),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    this.notices.pipe(
      switchMap((message) => message ? timer(5_000).pipe(tap(() => this.notice.set(null))) : EMPTY),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    effect(() => {
      const team = this.team.activeTeam();
      const loadingSystems = this.systems.loading();
      const application = this.systems.activeSystem()?.id ?? null;
      const key = `${team ?? ''}\u0000${application ?? ''}`;
      if (!loadingSystems && key !== this.contextKey) untracked(() => this.connect(team ? { team, application } : null, key));
    });
  }

  selectRequirement(requirementId: string | undefined): void {
    this.requirementId = requirementId;
    if (!this.boardLoaded) return;
    this.resolveRoutedCard(requirementId);
  }

  selectCard(card: KanbanCard): void {
    this.clearNotice();
    this.detailError.set(null);
    this.selectedCard.set(card);
  }

  closeDetail(): void {
    this.selectedCard.set(null);
    this.savingDetail.set(false);
    this.detailError.set(null);
  }

  retry(): void {
    if (!this.context) return;
    if (this.boardLoaded && this.nextCursor) this.requestRead(this.context, false, this.nextCursor, true);
    else this.requestRead(this.context, !this.boardLoaded);
  }

  refresh(): void {
    if (this.context) this.requestRead(this.context, false);
    this.systems.refresh();
  }

  openCreate(): void {
    if (!this.auth.canCreateRequirements()) return;
    this.creatingIn.set('ideation');
    this.createError.set(null);
  }

  closeCreate(): void {
    if (this.creating()) return;
    this.creatingIn.set(null);
    this.createError.set(null);
  }

  createCard(input: CreateCardInput): void {
    const context = this.context;
    if (!context?.application || !this.auth.canCreateRequirements() || this.cardCommandBusy) return;
    this.creating.set(true);
    this.createError.set(null);
    this.dispatch({ type: 'create', context, input: { ...input, teamSlug: context.team, applicationIds: [context.application] } });
  }

  moveCard(card: KanbanCard, column: KanbanColumnId, optimisticColumns?: KanbanColumn[]): void {
    if (!this.auth.canMoveRequirements() || this.cardCommandBusy) return;
    const context = this.cardContext(card);
    const snapshot = this.columns();
    if (optimisticColumns) this.columns.set(optimisticColumns);
    this.dispatch({ type: 'move', context, card, column, snapshot });
  }

  saveDetail(patch: CardPatch): void {
    const card = this.selectedCard();
    if (!card || !this.auth.canManageRequirements() || this.cardCommandBusy) return;
    this.savingDetail.set(true);
    this.detailError.set(null);
    this.dispatch({ type: 'update', context: this.cardContext(card), card, patch });
  }

  saveProposal(specification: RequirementSpec): void {
    const card = this.selectedCard();
    if (!card || !this.auth.capabilities().requirementsPropose || this.cardCommandBusy) return;
    this.savingDetail.set(true);
    this.detailError.set(null);
    this.dispatch({ type: 'proposal', context: this.cardContext(card), card, specification });
  }

  advance(advance: CardAdvance): void {
    const card = this.selectedCard();
    if (!card || !this.auth.canMoveRequirements() || this.cardCommandBusy) return;
    this.savingDetail.set(true);
    this.detailError.set(null);
    this.dispatch({ type: 'advance', context: this.cardContext(card), card, advance });
  }

  deleteCard(): void {
    const card = this.selectedCard();
    if (!card || !this.auth.capabilities().requirementsClose || this.cardCommandBusy) return;
    this.savingDetail.set(true);
    this.detailError.set(null);
    this.dispatch({ type: 'delete', context: this.cardContext(card), card });
  }

  implementationMoveBlocked(): void {
    this.showNotice(this.transloco.translate('board.confirmBeforeImplementation'));
  }

  openWorkspace(system: ApplicationSummary): string | null {
    if (!this.auth.canCreateDeveloperWorkspace() || this.busyWorkspaces().has(system.id)) return null;
    const existingUrl = this.developerWorkspaces()[system.id]?.ideUrl;
    if (existingUrl) return existingUrl;
    this.busyWorkspaces.update((ids) => new Set(ids).add(system.id));
    this.clearWorkspaceError(system.id);
    this.forgejoConnectUrls.update((urls) => {
      const next = { ...urls };
      delete next[system.id];
      return next;
    });
    this.workspaceCommands.next(system);
    return null;
  }

  retryStaging(system: ApplicationSummary): void {
    if (!this.auth.canManageApplications() || this.busyStaging().has(system.id)) return;
    this.busyStaging.update((ids) => new Set(ids).add(system.id));
    this.clearWorkspaceError(system.id);
    this.stagingCommands.next(system);
  }

  clearNotice(): void {
    this.notice.set(null);
    this.notices.next(null);
  }

  private connect(context: FactoryRequestContext | null, key: string): void {
    this.context = context;
    this.contextKey = key;
    this.cancelReads.next();
    this.cancelCardCommands.next();
    this.cancelWorkspaceCommands.next();
    this.cardCommandBusy = false;
    this.boardLoaded = false;
    this.columns.set([]);
    this.selectedCard.set(null);
    this.loading.set(Boolean(context));
    this.error.set(null);
    this.loadingMore.set(false);
    this.partialError.set(null);
    this.nextCursor = null;
    this.savingDetail.set(false);
    this.detailError.set(null);
    this.creating.set(false);
    this.createError.set(null);
    if (context) this.requestRead(context, true);
  }

  private requestRead(context: FactoryRequestContext, initial: boolean, cursor?: string, append = false): void {
    if (initial || !this.boardLoaded) this.loading.set(true);
    else this.loadingMore.set(true);
    this.partialError.set(null);
    this.reads.next({ context, initial, cursor, append });
  }

  private acceptRead(context: FactoryRequestContext, page: KanbanBoardPage, append: boolean): void {
    if (!this.matches(context)) return;
    this.columns.set(append ? mergeColumns(this.columns(), page.columns) : page.columns);
    this.nextCursor = page.nextCursor;
    this.boardLoaded = true;
    this.error.set(null);
    this.loading.set(false);
    this.loadingMore.set(page.truncated);
    this.resolveRoutedCard(this.requirementId);
  }

  private dispatch(command: CardCommand): void {
    this.cancelReads.next();
    this.cardCommandBusy = true;
    this.cardCommands.next(command);
  }

  private executeCardCommand(command: CardCommand): Observable<unknown> {
    switch (command.type) {
      case 'move':
        return this.api.moveCard(command.context, command.card, command.column).pipe(tap(() => this.refreshBoard()));
      case 'create':
        return this.api.createCard(command.context, command.input).pipe(tap((created) => {
          this.creatingIn.set(null);
          this.showNotice(this.transloco.translate('factory.requirementCreated', { number: created.number }));
          this.refreshBoard();
        }));
      case 'update':
        return this.api.updateCard(command.context, command.card, command.patch).pipe(tap((updated) => {
          this.selectedCard.set(updated);
          this.refreshBoard();
        }));
      case 'proposal':
        return this.api.saveProposal(command.context, command.card, command.specification).pipe(tap(() => this.refreshBoard()));
      case 'advance':
        return this.advanceCard(command);
      case 'delete':
        return this.api.deleteCard(command.context, command.card).pipe(tap(() => {
          this.selectedCard.set(null);
          this.emit({ type: 'deleted' });
          this.refreshBoard();
        }));
    }
  }

  private advanceCard(command: Extract<CardCommand, { type: 'advance' }>): Observable<unknown> {
    return this.api.updateCard(command.context, command.card, command.advance.patch).pipe(
      catchError((failure) => this.commandFailure('update', failure)),
      switchMap((updated) => {
        if (command.advance.toColumn === 'implementation' && command.advance.specification) {
          return this.api.accept(command.context, updated, command.advance.specification).pipe(
            catchError((failure) => this.commandFailure('accept', failure)),
          );
        }
        this.selectedCard.set(updated);
        return this.api.moveCard(command.context, updated, command.advance.toColumn).pipe(
          catchError((failure) => this.commandFailure('move', failure)),
        );
      }),
      tap(() => {
        this.refreshBoard();
      }),
    );
  }

  private commandFailure(stage: CommandFailure['stage'], failure: unknown): Observable<never> {
    return throwError(() => ({ stage, failure } satisfies CommandFailure));
  }

  private failCardCommand(command: CardCommand, rawFailure: unknown): void {
    const wrapped = rawFailure as Partial<CommandFailure>;
    const failure = wrapped.failure ?? rawFailure;
    if (command.type === 'move') {
      this.columns.set(command.snapshot);
      this.showNotice(this.errorMessage(failure, 'board.errMove'));
      return;
    }
    if (command.type === 'create') {
      this.createError.set(this.transloco.translate('board.errCreate'));
      return;
    }
    if (command.type === 'delete') {
      this.detailError.set(this.transloco.translate('board.errDelete'));
      return;
    }
    if (command.type === 'proposal') {
      this.detailError.set(this.errorMessage(failure, undefined, 'Draft specification could not be saved.'));
      return;
    }
    if (command.type === 'advance' && wrapped.stage === 'accept') {
      this.detailError.set(this.errorMessage(failure, undefined, 'Specification could not be confirmed.'));
      return;
    }
    if (command.type === 'advance' && wrapped.stage === 'move') {
      this.detailError.set(this.errorMessage(failure, 'board.errMove'));
      return;
    }
    this.detailError.set(this.transloco.translate('board.errSave'));
  }

  private resolveRoutedCard(requirementId: string | undefined): void {
    if (!requirementId) {
      this.selectedCard.set(null);
      this.error.set(null);
      return;
    }
    const card = this.columns().flatMap((column) => column.cards)
      .find((candidate) => candidate.id === requirementId || String(candidate.number) === requirementId);
    this.selectedCard.set(card ?? null);
    this.error.set(card ? null : this.transloco.translate('board.ticketNotFound', { number: requirementId }));
  }

  private showNotice(message: string): void {
    this.notice.set(message);
    this.notices.next(message);
  }

  private refreshBoard(): void {
    if (this.context) this.requestRead(this.context, false);
  }

  private setWorkspaceError(id: string, message: string): void {
    this.workspaceErrors.update((errors) => ({ ...errors, [id]: message }));
  }

  private clearWorkspaceError(id: string): void {
    this.workspaceErrors.update((errors) => {
      const next = { ...errors };
      delete next[id];
      return next;
    });
  }

  private removeBusy(target: { update(update: (value: Set<string>) => Set<string>): void }, id: string): void {
    target.update((ids) => {
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
  }

  private matches(context: FactoryRequestContext): boolean {
    return this.context?.team === context.team && this.context.application === context.application;
  }

  private contextFor(team: string, application: string | null): FactoryRequestContext {
    return { team, application };
  }

  private cardContext(card: KanbanCard): FactoryRequestContext {
    return this.contextFor(card.teamSlug, card.systemId || null);
  }

  private emit(event: Omit<BoardStoreEvent, 'sequence'>): void {
    this.event.set({ ...event, sequence: ++this.eventSequence });
  }

  private errorMessage(failure: unknown, fallbackKey?: string, fallback = ''): string {
    const message = (failure as { error?: { error?: unknown } })?.error?.error;
    return typeof message === 'string' && message.trim()
      ? message
      : fallbackKey ? this.transloco.translate(fallbackKey) : fallback;
  }
}

function mergeColumns(current: KanbanColumn[], incoming: KanbanColumn[]): KanbanColumn[] {
  return current.map((column) => {
    const next = incoming.find((candidate) => candidate.id === column.id)?.cards ?? [];
    const cards = new Map(column.cards.map((card) => [card.id, card]));
    for (const card of next) cards.set(card.id, card);
    return { ...column, cards: [...cards.values()] };
  });
}
