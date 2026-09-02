/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import {
  EMPTY,
  Subject,
  catchError,
  defer,
  exhaustMap,
  filter,
  finalize,
  fromEvent,
  map,
  of,
  switchMap,
  take,
  takeUntil,
  tap,
  timer,
  type Observable,
} from 'rxjs';

import type { InterviewAnswer, InterviewResponse, InterviewState, RequirementSpec } from '../../core/api/kanban.types';
import { KanbanInterviewClient } from '../../core/api/kanban-interview.client';
import type { FactoryRequestContext } from '../../core/context/factory-context.store';

type InterviewCommand =
  | { type: 'start' }
  | { type: 'retake' }
  | { type: 'sharpen'; note: string }
  | { type: 'answer'; answer: InterviewAnswer }
  | { type: 'retry' };

export interface InterviewStoreEvent {
  sequence: number;
  type: 'changed' | 'finalized' | 'reopened';
  action?: InterviewCommand['type'];
  spec?: RequirementSpec;
}

@Injectable()
export class CardInterviewStore {
  private readonly api = inject(KanbanInterviewClient);
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reads = new Subject<{ context: FactoryRequestContext; id: string }>();
  private readonly cancelReads = new Subject<void>();
  private readonly cancelCommands = new Subject<void>();
  private readonly commands = new Subject<InterviewCommand>();
  private pollSubscription?: { unsubscribe(): void };
  private cardId: string | null = null;
  private context: FactoryRequestContext | null = null;
  private canMutate = false;
  private pollFailures = 0;
  private eventSequence = 0;

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly state = signal<InterviewState | null>(null);
  readonly spec = signal<RequirementSpec | null>(null);
  readonly agentAvailable = signal(false);
  readonly agentReason = signal<string | null>(null);
  readonly chatUrl = signal<string | null>(null);
  readonly event = signal<InterviewStoreEvent | null>(null);

  constructor() {
    this.reads.pipe(
      switchMap(({ context, id }) => this.api.get(context, id).pipe(
        takeUntil(this.cancelReads),
        tap((response) => this.acceptRead(context, id, response)),
        catchError((failure) => {
          if (this.matches(context, id)) this.failRead(failure);
          return EMPTY;
        }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    this.commands.pipe(
      exhaustMap((command) => defer(() => this.execute(command)).pipe(
        takeUntil(this.cancelCommands),
        catchError((failure) => {
          this.failCommand(failure, command);
          return EMPTY;
        }),
        finalize(() => this.busy.set(false)),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  connect(context: FactoryRequestContext, cardId: string, canMutate: boolean): void {
    this.canMutate = canMutate;
    if (this.matches(context, cardId)) {
      this.startFreshInterview();
      return;
    }

    this.cardId = cardId;
    this.context = context;
    this.cancelReads.next();
    this.cancelCommands.next();
    this.stopPolling();
    this.pollFailures = 0;
    this.loading.set(true);
    this.busy.set(false);
    this.error.set(null);
    this.state.set(null);
    this.spec.set(null);
    this.agentAvailable.set(false);
    this.agentReason.set(null);
    this.chatUrl.set(null);
    this.reads.next({ context, id: cardId });
  }

  start(): void { this.dispatch({ type: 'start' }); }

  retake(): void {
    if (!this.canMutate || this.busy()) return;
    this.spec.set(null);
    this.emit({ type: 'reopened' });
    this.dispatch({ type: 'retake' });
  }

  sharpen(note: string): void { this.dispatch({ type: 'sharpen', note }); }
  answer(answer: InterviewAnswer): void { this.dispatch({ type: 'answer', answer }); }
  retry(): void { this.dispatch({ type: 'retry' }); }
  clearError(): void { this.error.set(null); }

  private dispatch(command: InterviewCommand): void {
    if (!this.cardId || !this.canMutate || this.busy()) return;
    this.cancelReads.next();
    this.stopPolling();
    this.busy.set(true);
    this.error.set(null);
    this.commands.next(command);
  }

  private execute(command: InterviewCommand): Observable<{ state: InterviewState }> {
    const id = this.cardId!;
    const context = this.context!;
    let request: Observable<{ state: InterviewState }>;
    switch (command.type) {
      case 'start': request = this.api.start(context, id); break;
      case 'retake': request = this.api.retake(context, id); break;
      case 'sharpen': request = this.api.sharpen(context, id, command.note); break;
      case 'answer': request = this.api.answer(context, id, command.answer); break;
      case 'retry': request = this.api.retry(context, id); break;
    }
    return request.pipe(tap(({ state }) => {
      if (!this.matches(context, id)) return;
      this.state.set(state);
      if (command.type !== 'start' && command.type !== 'retry') this.emit({ type: 'changed', action: command.type });
      if (state.pendingOperation) this.schedulePoll();
      if (state.done || state.chatId) this.reads.next({ context, id });
    }));
  }

  private acceptRead(context: FactoryRequestContext, id: string, response: InterviewResponse): void {
    if (!this.matches(context, id)) return;
    const previousOperation = this.state()?.pendingOperation;
    this.pollFailures = 0;
    this.state.set(response.state);
    this.spec.set(response.spec);
    this.agentAvailable.set(response.agent?.available ?? false);
    this.agentReason.set(response.agent?.reason ?? null);
    this.chatUrl.set(response.agent?.chatUrl ?? null);
    this.loading.set(false);
    const failure = response.state.pendingOperation?.failure;
    this.error.set(failure?.message ?? null);

    if (response.state.pendingOperation && !failure) this.schedulePoll();
    else this.stopPolling();

    if (previousOperation && !response.state.pendingOperation) this.emit({ type: 'changed' });
    if (response.spec) this.emit({ type: 'finalized', spec: response.spec });
    this.startFreshInterview();
  }

  private startFreshInterview(): void {
    const state = this.state();
    if (this.canMutate && state && !state.pending && !state.done && state.turns.length === 0 && !state.pendingOperation) this.start();
  }

  private failRead(failure: unknown): void {
    this.loading.set(false);
    this.error.set(this.errorMessage(failure, 'card.errInterviewLoad'));
    if (this.state()?.pendingOperation && !this.state()?.pendingOperation?.failure) {
      this.pollFailures++;
      this.schedulePoll();
    }
  }

  private failCommand(failure: unknown, command: InterviewCommand): void {
    const pendingState = command.type === 'answer'
      ? (failure as { error?: { state?: InterviewState } })?.error?.state
      : undefined;
    if (pendingState) {
      this.state.set(pendingState);
      this.schedulePoll();
    }
    const fallback = command.type === 'sharpen' ? 'card.errSharpen'
      : command.type === 'answer' || command.type === 'retry' ? 'card.errAnswer'
      : 'card.errAction';
    this.error.set(this.errorMessage(failure, fallback));
  }

  private schedulePoll(): void {
    this.stopPolling();
    const operation = this.state()?.pendingOperation;
    if (!operation || operation.failure || !this.cardId) return;
    const delay = Math.min(1_000 * 2 ** this.pollFailures, 30_000);
    const id = this.cardId;
    const context = this.context;
    this.pollSubscription = this.whenVisible(delay).subscribe(() => {
      if (context && this.matches(context, id) && !this.busy()) this.reads.next({ context, id });
    });
  }

  private whenVisible(delay: number): Observable<void> {
    const visible = () => this.document.visibilityState !== 'hidden';
    const waitUntilVisible = () => visible()
      ? of(undefined)
      : fromEvent(this.document, 'visibilitychange').pipe(filter(visible), take(1), map(() => undefined));
    return waitUntilVisible().pipe(
      switchMap(() => timer(delay)),
      switchMap(waitUntilVisible),
    );
  }

  private stopPolling(): void {
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = undefined;
  }

  private matches(context: FactoryRequestContext, id: string): boolean {
    return this.cardId === id && this.context?.team === context.team && this.context.application === context.application;
  }

  private emit(event: Omit<InterviewStoreEvent, 'sequence'>): void {
    this.event.set({ ...event, sequence: ++this.eventSequence });
  }

  private errorMessage(failure: unknown, fallbackKey: string): string {
    const value = failure as { error?: { error?: unknown } };
    return typeof value?.error?.error === 'string' && value.error.error.trim()
      ? value.error.error
      : this.transloco.translate(fallbackKey);
  }
}
