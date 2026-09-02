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

import type { ImplementationRun } from '@agentic-software-factory/api-contracts/implementation';
import { ApplicationsClient } from '../../core/api/applications.client';
import { ImplementationClient } from '../../core/api/implementation.client';
import type { FactoryRequestContext } from '../../core/context/factory-context.store';

type DeveloperCommand =
  | { type: 'start'; applicationId: string }
  | { type: 'review'; run: ImplementationRun; decision: 'approve' | 'request-changes'; note: string }
  | { type: 'complete'; run: ImplementationRun }
  | { type: 'prepare-verification'; run: ImplementationRun }
  | { type: 'retry-verification'; run: ImplementationRun }
  | { type: 'retry-completion'; run: ImplementationRun }
  | { type: 'stop-workspace'; run: ImplementationRun }
  | { type: 'resume-workspace'; run: ImplementationRun };

export interface DeveloperModeStoreEvent {
  sequence: number;
  type: 'changed' | 'reviewed';
  runId?: string;
}

@Injectable()
export class DeveloperModeStore {
  private readonly api = inject(ImplementationClient);
  private readonly applicationsApi = inject(ApplicationsClient);
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reads = new Subject<{ request: FactoryRequestContext; number: number }>();
  private readonly cancelReads = new Subject<void>();
  private readonly cancelCommands = new Subject<void>();
  private readonly commands = new Subject<DeveloperCommand>();
  private readonly authorizationChecks = new Subject<void>();
  private pollSubscription?: { unsubscribe(): void };
  private context: { request: FactoryRequestContext; number: number } | null = null;
  private canImplement = false;
  private canReview = false;
  private pollFailures = 0;
  private eventSequence = 0;

  readonly runs = signal<ImplementationRun[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly starting = signal(false);
  readonly error = signal<string | null>(null);
  readonly forgejoConnectUrl = signal<string | null>(null);
  readonly event = signal<DeveloperModeStoreEvent | null>(null);

  constructor() {
    this.reads.pipe(
      switchMap((context) => this.api.list(context.request, context.number).pipe(
        takeUntil(this.cancelReads),
        tap(({ runs }) => this.acceptRead(context, runs)),
        catchError((failure) => {
          if (this.matches(context)) this.failRead(failure);
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
        finalize(() => {
          this.busy.set(false);
          this.starting.set(false);
        }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    this.authorizationChecks.pipe(
      switchMap(() => this.applicationsApi.developmentTools().pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((tools) => this.forgejoConnectUrl.set(tools && !tools.forgejoConnected ? tools.connectUrl : null));

    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  connect(request: FactoryRequestContext, number: number, canImplement: boolean, canReview: boolean): void {
    this.canImplement = canImplement;
    this.canReview = canReview;
    const next = { request, number };
    if (this.matches(next)) return;
    this.context = next;
    this.cancelReads.next();
    this.cancelCommands.next();
    this.stopPolling();
    this.pollFailures = 0;
    this.runs.set([]);
    this.loading.set(true);
    this.busy.set(false);
    this.starting.set(false);
    this.error.set(null);
    this.forgejoConnectUrl.set(null);
    this.reads.next(next);
  }

  refresh(): void { if (this.context) this.reads.next(this.context); }

  start(applicationId: string): void {
    if (!this.canImplement) return;
    this.starting.set(true);
    this.dispatch({ type: 'start', applicationId });
  }

  review(run: ImplementationRun, decision: 'approve' | 'request-changes', note: string): void {
    if (!this.canReview || run.isContributor) return;
    this.dispatch({ type: 'review', run, decision, note });
  }

  complete(run: ImplementationRun): void {
    if (!this.canReview || run.isContributor) return;
    this.dispatch({ type: 'complete', run });
  }

  prepareVerification(run: ImplementationRun): void {
    if (!this.canImplement && !this.canReview) return;
    this.dispatch({ type: 'prepare-verification', run });
  }

  retryVerification(run: ImplementationRun): void { this.dispatch({ type: 'retry-verification', run }); }
  retryCompletion(run: ImplementationRun): void { this.dispatch({ type: 'retry-completion', run }); }
  stopWorkspace(run: ImplementationRun): void { if (this.canImplement && run.isContributor) this.dispatch({ type: 'stop-workspace', run }); }
  resumeWorkspace(run: ImplementationRun): void { if (this.canImplement && run.isContributor) this.dispatch({ type: 'resume-workspace', run }); }

  private dispatch(command: DeveloperCommand): void {
    if (!this.context || this.busy()) {
      if (command.type === 'start') this.starting.set(false);
      return;
    }
    this.cancelReads.next();
    this.stopPolling();
    this.busy.set(true);
    this.error.set(null);
    this.commands.next(command);
  }

  private execute(command: DeveloperCommand): Observable<unknown> {
    const context = this.context!;
    let request: Observable<unknown>;
    switch (command.type) {
      case 'start': request = this.api.start(context.request, context.number, command.applicationId); break;
      case 'review': request = this.api.review(context.request, command.run.id, command.decision, command.note); break;
      case 'complete': request = this.api.complete(context.request, command.run.id); break;
      case 'prepare-verification': request = this.api.prepareVerification(context.request, command.run.id); break;
      case 'retry-verification': request = this.api.retryVerification(context.request, command.run.id); break;
      case 'retry-completion': request = this.api.retryCompletion(context.request, command.run.id); break;
      case 'stop-workspace': request = this.api.stopWorkspace(context.request, command.run.id); break;
      case 'resume-workspace': request = this.api.resumeWorkspace(context.request, command.run.id); break;
    }
    return request.pipe(tap((result) => {
      if (!this.matches(context)) return;
      if (command.type === 'retry-verification' || command.type === 'retry-completion') {
        this.refresh();
        return;
      }
      const run = result as ImplementationRun;
      this.setRun(run);
      if (command.type === 'review') this.emit({ type: 'reviewed', runId: run.id });
      if (command.type === 'complete') this.emit({ type: 'changed' });
    }));
  }

  private acceptRead(context: { request: FactoryRequestContext; number: number }, runs: ImplementationRun[]): void {
    if (!this.matches(context)) return;
    const previousRuns = this.runs();
    const completed = runs.some((run) => run.phase === 'done' && previousRuns.some((previous) => previous.id === run.id && previous.phase !== 'done'));
    this.pollFailures = 0;
    this.runs.set(runs);
    this.loading.set(false);
    this.error.set(null);
    this.checkForgejoAuthorization();
    this.schedulePoll();
    if (completed) this.emit({ type: 'changed' });
  }

  private failRead(failure: unknown): void {
    this.loading.set(false);
    this.setError(failure);
    if (this.hasActiveRuns()) {
      this.pollFailures++;
      this.schedulePoll();
    }
  }

  private failCommand(failure: unknown, command: DeveloperCommand): void {
    const translationKey = command.type === 'review' && (failure as { status?: number }).status === 403
      ? 'factory.contributorCannotApprove'
      : undefined;
    this.setError(failure, translationKey);
    this.checkForgejoAuthorization();
    this.schedulePoll();
  }

  private setRun(run: ImplementationRun): void {
    this.runs.update((runs) => runs.some((candidate) => candidate.id === run.id)
      ? runs.map((candidate) => candidate.id === run.id ? run : candidate)
      : [run, ...runs]);
    this.checkForgejoAuthorization();
    this.schedulePoll();
  }

  private schedulePoll(): void {
    this.stopPolling();
    if (!this.context || !this.hasActiveRuns()) return;
    const context = this.context;
    const delay = Math.min(5_000 * 2 ** this.pollFailures, 60_000);
    this.pollSubscription = this.whenVisible(delay).subscribe(() => {
      if (this.matches(context) && !this.busy()) this.reads.next(context);
    });
  }

  private hasActiveRuns(): boolean {
    return this.runs().some((run) => ['provisioning', 'agent-running', 'implementing', 'merging'].includes(run.phase));
  }

  private checkForgejoAuthorization(): void {
    const needed = this.canImplement && this.runs().some((run) => run.agentError?.includes('Connect Forgejo in Coder'));
    if (needed) this.authorizationChecks.next();
    else this.forgejoConnectUrl.set(null);
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

  private matches(context: { request: FactoryRequestContext; number: number }): boolean {
    return this.context?.number === context.number
      && this.context.request.team === context.request.team
      && this.context.request.application === context.request.application;
  }

  private emit(event: Omit<DeveloperModeStoreEvent, 'sequence'>): void {
    this.event.set({ ...event, sequence: ++this.eventSequence });
  }

  private setError(error: unknown, translationKey?: string): void {
    const failure = error as { error?: { error?: string } };
    const message = String((translationKey ? this.transloco.translate(translationKey) : failure.error?.error)
      || this.transloco.translate('factory.errImplementation') || 'Implementation action failed.');
    this.error.set(message);
  }
}
