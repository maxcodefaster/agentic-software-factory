/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HlmButton } from '@spartan-ng/helm/button';

import type { ApplicationSummary } from '@agentic-software-factory/api-contracts/applications';
import type { ImplementationRun } from '@agentic-software-factory/api-contracts/implementation';
import type { ApplicationRef } from '@agentic-software-factory/api-contracts/kanban';
import type { KanbanCard } from '../../core/api/kanban.types';
import { Icon } from '../../shared/icon/icon';
import { DeveloperModeStore } from './developer-mode.store';

interface ImplementationLane {
  applicationId: string;
  applicationName: string;
  runs: ImplementationRun[];
}

@Component({
  selector: 'factory-developer-mode',
  imports: [HlmButton, Icon, TranslocoPipe],
  template: `
    <section class="flex flex-col gap-(--spacing-brand-m)" [attr.aria-label]="'factory.implementation' | transloco">
      @if (loading()) {
        <p class="flex items-center gap-(--spacing-brand-xs) text-sm text-brand-gray-600">
          <factory-icon name="loader" class="animate-spin" /> {{ 'factory.deliveryLoading' | transloco }}
        </p>
      } @else {
        @if (starting()) {
          <p role="status" class="flex items-center gap-(--spacing-brand-xs) rounded-brand-md border border-brand-gray-200 bg-brand-gray-50 p-(--spacing-brand-s) text-sm text-brand-gray-700">
            <factory-icon name="loader" class="animate-spin" /> {{ 'factory.implementationStarting' | transloco }}
          </p>
        }
        <div class="flex flex-col gap-(--spacing-brand-m)">
          @for (lane of lanes(); track lane.applicationId) {
            <article
              class="flex min-w-0 flex-col gap-(--spacing-brand-s) rounded-brand-lg border border-brand-gray-200 bg-brand-surface p-(--spacing-brand-s)"
              data-implementation-lane
              [attr.aria-labelledby]="laneHeadingId(lane)"
            >
              <header class="flex flex-wrap items-start justify-between gap-(--spacing-brand-xs)">
                <h3 [id]="laneHeadingId(lane)" class="text-title">{{ lane.applicationName }}</h3>
                @if (lane.runs[0]; as current) {
                  <span
                    class="factory-badge"
                    [class.factory-badge-danger]="current.phase === 'agent-failed' || current.phase === 'checks-failing'"
                    [class.factory-badge-info]="current.phase !== 'agent-failed' && current.phase !== 'checks-failing'"
                  >
                    <factory-icon [name]="current.phase === 'agent-failed' ? 'circle-alert' : 'activity'" size="xs" />
                    {{ ('factory.phase.' + current.phase) | transloco }}
                  </span>
                }
              </header>

              @for (current of lane.runs; track current.id; let first = $first) {
                <section
                  class="flex min-w-0 flex-col gap-(--spacing-brand-s)"
                  [attr.data-run-id]="current.id"
                  [attr.aria-labelledby]="runHeadingId(current)"
                >
                  <h4 [id]="runHeadingId(current)" class="sr-only">{{ current.applicationName }} · {{ ('factory.phase.' + current.phase) | transloco }}</h4>
                  <p class="break-all font-mono text-micro text-brand-gray-600">{{ current.branch }} · {{ current.headSha.slice(0, 10) }}</p>

                  @if (current.phase === 'agent-failed' && current.agentError) {
                    <p role="alert" class="rounded-brand-md border border-brand-danger/25 bg-brand-danger/5 p-(--spacing-brand-s) text-sm text-brand-danger">{{ current.agentError }}</p>
                  }

                  @if (current.phase === 'provisioning') {
                    <p role="status" class="flex items-center gap-(--spacing-brand-xs) rounded-brand-md border border-brand-gray-200 bg-brand-gray-50 p-(--spacing-brand-s) text-sm text-brand-gray-700">
                      <factory-icon name="loader" class="animate-spin" /> {{ 'factory.provisioningDetail' | transloco }}
                    </p>
                  }

                  @if (first && current.phase !== 'done') {
                    @if (primaryAction(current); as action) {
                      <div>
                        @if (current.canContinueBranch) {<p class="mb-(--spacing-brand-xs) text-sm text-brand-gray-600">{{ statusHint(current) | transloco }}</p>}
                        <div>
                          <button
                            hlmBtn
                            type="button"
                            data-primary-action
                            [disabled]="busy()"
                            [attr.aria-label]="actionLabel(action.label, current)"
                            (click)="performPrimary(current)"
                          ><factory-icon [name]="action.icon" /> {{ action.label | transloco }}</button>
                        </div>
                      </div>
                    }
                   }

                  @if (canUseDevelopmentTools(current) && (current.agentUrl || current.ideUrl)) {
                    <nav class="flex flex-wrap gap-(--spacing-brand-xs)" [attr.aria-label]="developmentToolsLabel(current)">
                      @if (current.agentUrl) {
                        <a hlmBtn variant="outline" size="sm" data-development-tool [href]="current.agentUrl" target="_blank" rel="noopener" [attr.aria-label]="linkLabel('factory.openAgent', current)">
                          <factory-icon name="sparkles" /> {{ 'factory.openAgent' | transloco }}
                        </a>
                      }
                      @if (current.ideUrl) {
                        <a hlmBtn variant="outline" size="sm" data-development-tool [href]="current.ideUrl" target="_blank" rel="noopener" [attr.aria-label]="linkLabel('factory.continueIde', current)">
                          <factory-icon name="code" /> {{ 'factory.continueIde' | transloco }}
                        </a>
                      }
                      @if (current.workspaceStatus === 'stopped') {
                        <button hlmBtn variant="outline" size="sm" type="button" [disabled]="busy()" (click)="resumeWorkspace(current)"><factory-icon name="play" /> {{ 'factory.resumeWorkspace' | transloco }}</button>
                      } @else if (current.workspaceId && current.agentStatus !== 'running') {
                        <button hlmBtn variant="ghost" size="sm" type="button" [disabled]="busy()" (click)="stopWorkspace(current)"><factory-icon name="square" /> {{ 'factory.stopWorkspace' | transloco }}</button>
                      }
                    </nav>
                  }

                  <nav class="flex flex-wrap gap-x-(--spacing-brand-s) gap-y-(--spacing-brand-xs) text-sm" [attr.aria-label]="gitLinksLabel(current)">
                    <a [href]="current.pullUrl" target="_blank" rel="noopener" [attr.aria-label]="linkLabel('factory.openPr', current)">{{ 'factory.openPr' | transloco }} #{{ current.pullNumber }}</a>
                    <a [href]="current.repositoryUrl" target="_blank" rel="noopener" [attr.aria-label]="linkLabel('factory.openRepository', current)">{{ 'factory.openRepository' | transloco }}</a>
                    @if (canUseDevelopmentTools(current) && current.workspaceUrl) {<a [href]="current.workspaceUrl" target="_blank" rel="noopener" [attr.aria-label]="linkLabel('factory.openWorkspace', current)">{{ 'factory.openWorkspace' | transloco }}</a>}
                  </nav>

                  <div class="grid gap-(--spacing-brand-s) md:grid-cols-2">
                    <section [attr.aria-labelledby]="checksHeadingId(current)">
                      <h5 [id]="checksHeadingId(current)" class="factory-section-label">{{ 'factory.checksDetails' | transloco }}</h5>
                      <div class="mt-(--spacing-brand-xs) flex flex-col gap-(--spacing-brand-xxs)">
                        @for (check of current.checks; track check.context) {
                          <p class="flex items-center gap-(--spacing-brand-xxs) text-meta text-brand-gray-600">
                            <span
                              class="size-2 shrink-0 rounded-full"
                              [class.bg-brand-success]="check.state === 'success'"
                              [class.bg-brand-warning]="check.state === 'pending' || check.state === 'warning'"
                              [class.bg-brand-danger]="check.state === 'failure' || check.state === 'error'"
                            ></span>
                            @if (check.targetUrl) {
                              <a [href]="check.targetUrl" target="_blank" rel="noopener" [attr.aria-label]="checkLinkLabel(check, current)">{{ ('factory.check.' + check.context) | transloco }}</a>
                            } @else {
                              <span>{{ ('factory.check.' + check.context) | transloco }}</span>
                            }
                            <span>· {{ ('factory.check.' + check.state) | transloco }}</span>
                          </p>
                          <p class="pl-(--spacing-brand-s) text-meta text-brand-gray-600">{{ check.description }}</p>
                        } @empty {
                          <p class="text-meta text-brand-gray-500">{{ 'factory.phase.' + current.phase | transloco }}</p>
                        }
                        @if (primaryBlocker(current); as blocker) {<p class="text-meta text-brand-warning-strong">{{ blocker }}</p>}
                      </div>
                    </section>

                    @if (latestReview(current)) {<section [attr.aria-labelledby]="reviewHeadingId(current)">
                      <h5 [id]="reviewHeadingId(current)" class="factory-section-label">{{ 'factory.review' | transloco }}</h5>
                      <div class="mt-(--spacing-brand-xs)">
                        @if (latestReview(current); as review) {
                          <p class="text-sm font-medium text-brand-gray-900">{{ ('factory.reviewState.' + review.state) | transloco }} · {{ review.reviewer }}</p>
                          @if (review.body && !compact()) {<details class="mt-(--spacing-brand-xxs)"><summary class="cursor-pointer text-meta text-brand-gray-500">{{ 'factory.reviewNote' | transloco }}</summary><p class="mt-(--spacing-brand-xxs) max-w-full break-words text-meta text-brand-gray-600">{{ review.body }}</p></details>}
                        }
                      </div>
                    </section>}
                  </div>

                  @if (canUseDevelopmentTools(current) && current.phase !== 'done' && current.developmentApps.length) {
                    <section [attr.aria-labelledby]="developmentHeadingId(current)">
                      <h5 [id]="developmentHeadingId(current)" class="factory-section-label">{{ 'factory.liveDevelopmentPreviews' | transloco }}</h5>
                      <div class="mt-(--spacing-brand-xs) flex flex-wrap gap-(--spacing-brand-xs)">
                        @for (app of current.developmentApps; track app.slug) {
                          <a hlmBtn variant="outline" size="sm" [href]="app.url" target="_blank" rel="noopener" [attr.aria-label]="previewStatusLabel(app.displayName, app.health)">
                            <factory-icon [name]="previewIcon(app.health)" [class.animate-spin]="app.health === 'initializing'" />
                            {{ 'factory.openDevelopmentPreview' | transloco: { name: app.displayName } }} · {{ ('factory.appHealth.' + app.health) | transloco }}
                          </a>
                        }
                      </div>
                    </section>
                  }

                   @if (verificationPreparing(current)) {
                    <p role="status" class="flex items-center gap-(--spacing-brand-xs) rounded-brand-md border border-brand-gray-200 bg-brand-gray-50 p-(--spacing-brand-s) text-sm text-brand-gray-700">
                      <factory-icon name="loader" class="animate-spin" /> {{ 'factory.verificationPreparing' | transloco }}
                    </p>
                   }

                   @if (current.phase !== 'done' && current.verificationApps.length) {
                    <section [attr.aria-labelledby]="verificationHeadingId(current)">
                      <h5 [id]="verificationHeadingId(current)" class="factory-section-label">{{ 'factory.verificationApps' | transloco }}</h5>
                      <div class="mt-(--spacing-brand-xs) flex flex-wrap gap-(--spacing-brand-xs)">
                        @for (app of current.verificationApps; track app.slug) {
                          <a hlmBtn variant="outline" size="sm" [href]="app.url" target="_blank" rel="noopener" [attr.aria-label]="previewStatusLabel(app.displayName, app.health)">
                            <factory-icon [name]="previewIcon(app.health, true)" [class.animate-spin]="app.health === 'initializing'" />
                            {{ 'factory.openVerificationApp' | transloco: { name: app.displayName } }} · {{ ('factory.appHealth.' + app.health) | transloco }}
                          </a>
                        }
                      </div>
                    </section>
                  }

                  @if (first && current.phase !== 'done' && showReview(current) && reviewReady(current)) {
                    <section [attr.aria-labelledby]="decisionHeadingId(current)">
                      <h5 [id]="decisionHeadingId(current)" class="factory-section-label">{{ 'factory.decisionNote' | transloco }}</h5>
                      @if (canReview()) {
                        <textarea
                          [id]="reviewNoteId(current)"
                          name="reviewNote"
                          autocomplete="off"
                          rows="3"
                          class="factory-input mt-(--spacing-brand-xs) resize-none"
                          [attr.aria-label]="'factory.decisionNote' | transloco"
                          [placeholder]="'factory.decisionNote' | transloco"
                          [value]="reviewNote(current)"
                          (input)="setReviewNote(current, $any($event.target).value)"
                        ></textarea>
                        <div class="mt-(--spacing-brand-xs) flex flex-wrap gap-(--spacing-brand-xs)">
                          <button hlmBtn type="button" variant="outline" size="sm" [disabled]="busy() || !reviewReady(current)" [attr.aria-label]="actionLabel('factory.requestChanges', current)" (click)="review(current, 'request-changes')">
                            <factory-icon name="pencil" /> {{ 'factory.requestChanges' | transloco }}
                          </button>
                          <button hlmBtn type="button" size="sm" [disabled]="busy() || !reviewReady(current)" [attr.aria-label]="actionLabel('factory.approve', current)" (click)="review(current, 'approve')">
                            <factory-icon name="circle-check" /> {{ 'factory.approve' | transloco }}
                          </button>
                        </div>
                      } @else {
                        <p class="mt-(--spacing-brand-xs) text-meta text-brand-gray-600">{{ 'authorization.reviewerRequired' | transloco }}</p>
                      }
                    </section>
                  }
                </section>
              } @empty {
                <section class="flex flex-col gap-(--spacing-brand-s)">
                  <div>
                    <h4 class="text-title">{{ 'factory.startAgentTitle' | transloco }}</h4>
                    <p class="mt-(--spacing-brand-xxs) text-sm text-brand-gray-600">{{ 'factory.startAgentHint' | transloco }}</p>
                  </div>
                  @if (canImplement()) {
                    <button hlmBtn type="button" data-primary-action [disabled]="busy()" [attr.aria-label]="startLabel(lane)" (click)="start(lane.applicationId)">
                      <factory-icon name="sparkles" /> {{ 'factory.startAgentImplementation' | transloco }}
                    </button>
                  } @else {
                    <p class="text-meta text-brand-gray-600">{{ 'authorization.developerRequired' | transloco }}</p>
                  }
                </section>
              }
            </article>
          } @empty {
            <p class="factory-card text-sm text-brand-gray-600">{{ 'factory.noLinkedApplication' | transloco }}</p>
          }
        </div>
      }

      @if (error(); as message) { <p role="alert" class="text-sm text-brand-danger">{{ message }}</p> }
      @if (forgejoConnectUrl(); as url) {
        <p role="alert" class="text-sm text-brand-gray-700">{{ 'applications.authorizeForgejo' | transloco }} <a class="font-semibold underline" [href]="url" target="_blank" rel="noopener noreferrer">{{ 'applications.authorizeForgejoAction' | transloco }}</a></p>
      }
    </section>
  `,
  providers: [DeveloperModeStore],
})
export class DeveloperMode {
  private readonly store = inject(DeveloperModeStore);
  private readonly transloco = inject(TranslocoService);
  readonly applications = input<ApplicationSummary[]>([]);
  readonly selected = input<ApplicationRef[]>([]);
  readonly requirement = input.required<KanbanCard>();
  readonly canImplement = input(false);
  readonly canReview = input(false);
  readonly compact = input(false);
  readonly changed = output<void>();
  protected readonly runs = this.store.runs;
  protected readonly loading = this.store.loading;
  protected readonly busy = this.store.busy;
  protected readonly starting = this.store.starting;
  protected readonly error = this.store.error;
  protected readonly forgejoConnectUrl = this.store.forgejoConnectUrl;
  private readonly reviewNotes = signal<Record<string, string>>({});
  protected readonly lanes = computed<ImplementationLane[]>(() => {
    const lanes = new Map<string, ImplementationLane>();
    for (const application of this.linkedApplications()) {
      lanes.set(application.id, { applicationId: application.id, applicationName: application.name, runs: [] });
    }
    for (const run of this.runs()) {
      const lane = lanes.get(run.applicationId) ?? { applicationId: run.applicationId, applicationName: run.applicationName, runs: [] };
      lane.runs.push(run);
      lanes.set(run.applicationId, lane);
    }
    for (const lane of lanes.values()) lane.runs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return [...lanes.values()];
  });
  constructor() {
    effect(() => {
      const requirement = this.requirement();
      const canImplement = this.canImplement();
      const canReview = this.canReview();
      untracked(() => this.store.connect(
        { team: requirement.teamSlug, application: requirement.systemId || null },
        requirement.number,
        canImplement,
        canReview,
      ));
    });
    effect(() => {
      const event = this.store.event();
      if (!event) return;
      if (event.type === 'reviewed' && event.runId) {
        this.reviewNotes.update((notes) => ({ ...notes, [event.runId!]: '' }));
      }
      if (event.type === 'changed') this.changed.emit();
    });
  }

  protected linkedApplications(): ApplicationSummary[] {
    const ids = new Set(this.selected().map((item) => item.id));
    return this.applications().filter((application) => ids.has(application.id));
  }

  protected latestReview(run: ImplementationRun) { return run.reviews.at(-1) ?? null; }
  protected canUseDevelopmentTools(run: ImplementationRun): boolean { return this.canImplement() && run.isContributor; }
  protected verificationPreparing(run: ImplementationRun): boolean {
    return run.phase === 'implementing' && run.checks.some((check) => check.context === 'factory/verification' && check.state === 'pending');
  }
  protected primaryBlocker(run: ImplementationRun): string | null { return run.blockers[0] ?? null; }
  protected statusHint(run: ImplementationRun): string { if (this.canImplement() && run.canContinueBranch) return 'factory.continueBranchHint'; return run.phase === 'awaiting-review' && this.reviewReady(run) ? 'factory.hint.review-ready' : `factory.hint.${run.phase}`; }
  protected primaryAction(run: ImplementationRun): { label: string; icon: string } | null {
    if (run.blockers.some((blocker) => blocker.startsWith('Completion requires manual retry')) && this.canReview() && !run.isContributor) return { label: 'factory.retryMerge', icon: 'refresh-cw' };
    if (run.blockers.some((blocker) => blocker.startsWith('Verification environment requires manual retry')) && (this.canImplement() || this.canReview())) return { label: 'factory.retryVerification', icon: 'refresh-cw' };
    if (this.canImplement() && run.canContinueBranch) return { label: 'factory.continueBranch', icon: 'users' };
    if (run.phase === 'awaiting-review' && !this.reviewReady(run) && (this.canImplement() || this.canReview())) return { label: 'factory.prepareVerification', icon: 'rocket' };
    if (run.phase === 'agent-failed' && this.canImplement()) return { label: 'factory.retryAgent', icon: 'refresh-cw' };
    if ((run.phase === 'ready-to-merge' || run.phase === 'merging') && this.canReview() && !run.isContributor) return { label: run.phase === 'merging' ? 'factory.retryMerge' : 'factory.merge', icon: 'lock' };
    return null;
  }
  protected performPrimary(run: ImplementationRun): void {
    if (run.blockers.some((blocker) => blocker.startsWith('Completion requires manual retry'))) this.retryCompletion(run);
    else if (run.blockers.some((blocker) => blocker.startsWith('Verification environment requires manual retry'))) this.retryVerification(run);
    else if (run.canContinueBranch || run.phase === 'agent-failed') this.start(run.applicationId);
    else if (run.phase === 'awaiting-review' && !this.reviewReady(run)) this.prepareVerification(run);
    else if (run.phase === 'ready-to-merge' || run.phase === 'merging') this.complete(run);
  }

  private retryVerification(run: ImplementationRun): void {
    this.store.retryVerification(run);
  }

  private retryCompletion(run: ImplementationRun): void {
    this.store.retryCompletion(run);
  }
  protected reviewReady(run: ImplementationRun): boolean { return run.verificationApps.length > 0 && run.verificationApps.every((app) => app.health === 'healthy'); }
  protected showReview(run: ImplementationRun): boolean { return !run.isContributor && !['provisioning', 'agent-running', 'agent-failed'].includes(run.phase) && (run.agentStatus === 'completed' || run.headSha !== run.agentStartedHeadSha); }
  protected reviewNote(run: ImplementationRun): string { return this.reviewNotes()[run.id] ?? ''; }
  protected setReviewNote(run: ImplementationRun, note: string): void { this.reviewNotes.update((notes) => ({ ...notes, [run.id]: note })); }
  protected laneHeadingId(lane: ImplementationLane): string { return `implementation-lane-${lane.applicationId}`; }
  protected runHeadingId(run: ImplementationRun): string { return `implementation-run-${run.id}`; }
  protected checksHeadingId(run: ImplementationRun): string { return `implementation-checks-${run.id}`; }
  protected reviewHeadingId(run: ImplementationRun): string { return `implementation-review-${run.id}`; }
  protected developmentHeadingId(run: ImplementationRun): string { return `implementation-development-${run.id}`; }
  protected verificationHeadingId(run: ImplementationRun): string { return `implementation-verification-${run.id}`; }
  protected decisionHeadingId(run: ImplementationRun): string { return `implementation-decision-${run.id}`; }
  protected reviewNoteId(run: ImplementationRun): string { return `implementation-review-note-${run.id}`; }
  protected actionLabel(key: string, run: ImplementationRun): string { return `${this.transloco.translate(key)}: ${run.applicationName}`; }
  protected linkLabel(key: string, run: ImplementationRun): string { return `${this.transloco.translate(key)}: ${run.applicationName}`; }
  protected startLabel(lane: ImplementationLane): string { return `${this.transloco.translate('factory.startAgentImplementation')}: ${lane.applicationName}`; }
  protected gitLinksLabel(run: ImplementationRun): string { return `${this.transloco.translate('factory.sourceControl')}: ${run.applicationName}`; }
  protected developmentToolsLabel(run: ImplementationRun): string { return `${this.transloco.translate('factory.developmentTools')}: ${run.applicationName}`; }
  protected checkLinkLabel(check: ImplementationRun['checks'][number], run: ImplementationRun): string { return `${this.transloco.translate(`factory.check.${check.context}`)}: ${check.description}, ${run.applicationName}`; }
  protected previewStatusLabel(name: string, health: ImplementationRun['developmentApps'][number]['health']): string { return `${name}: ${this.transloco.translate(`factory.appHealth.${health}`)}`; }
  protected previewIcon(health: ImplementationRun['developmentApps'][number]['health'], verification = false): string { return health === 'initializing' ? 'loader' : health === 'healthy' ? verification ? 'shield' : 'rocket' : 'circle-alert'; }

  protected start(applicationId: string): void {
    this.store.start(applicationId);
  }

  protected review(run: ImplementationRun, decision: 'approve' | 'request-changes'): void {
    this.store.review(run, decision, this.reviewNote(run).trim());
  }

  protected complete(run: ImplementationRun): void {
    this.store.complete(run);
  }

  protected prepareVerification(run: ImplementationRun): void {
    this.store.prepareVerification(run);
  }
  protected stopWorkspace(run: ImplementationRun): void { this.store.stopWorkspace(run); }
  protected resumeWorkspace(run: ImplementationRun): void { this.store.resumeWorkspace(run); }
}
