/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';

import type {
  InterviewAnswer,
  InterviewTurn,
  RequirementSpec,
} from '../../core/api/kanban.types';
import type { FactoryRequestContext } from '../../core/context/factory-context.store';
import { Icon } from '../../shared/icon/icon';
import { CardInterviewStore } from './card-interview.store';

/**
 * Card interview — the structured, opencode-style requirements Q&A for one
 * card (Anforderungen stage). One question at a time (single / multi-choice
 * with a free-text "eigene Antwort", or open text); when the model has
 * enough it proposes the specification that gates Developer mode.
 *
 * Coder owns the adaptive chat while Factory owns the normalized interview
 * state, specification review, and confirmation.
 */
@Component({
  selector: 'factory-card-interview',
  imports: [HlmButton, HlmInput, Icon, TranslocoPipe],
  templateUrl: './card-interview.html',
  providers: [CardInterviewStore],
})
export class CardInterview {
  private readonly store = inject(CardInterviewStore);
  private readonly transloco = inject(TranslocoService);

  readonly cardId = input.required<string>();
  readonly context = input<FactoryRequestContext>({ team: 'factory', application: null });
  readonly canMutate = input(false);
  /** Emitted whenever the spec is finalized, so the detail panel can react. */
  readonly finalized = output<RequirementSpec>();
  /** Emitted when a full RETAKE re-opens the interview, so the detail panel can
   *  drop the now-discarded spec (and re-lock the forward gate). NOT fired on a
   *  sharpen, which deliberately builds on the existing spec. */
  readonly reopened = output<void>();
  readonly changed = output<void>();

  protected readonly loading = this.store.loading;
  protected readonly busy = this.store.busy;
  protected readonly error = this.store.error;
  protected readonly state = this.store.state;
  protected readonly spec = this.store.spec;
  protected readonly agentAvailable = this.store.agentAvailable;
  protected readonly agentReason = this.store.agentReason;
  protected readonly chatUrl = this.store.chatUrl;

  // Working state for the pending question.
  protected readonly selected = signal<string[]>([]);
  protected readonly customText = signal('');

  /** Inline "Refine / Add" form on the cleared requirement. */
  protected readonly sharpenOpen = signal(false);
  protected readonly sharpenNote = signal('');

  protected readonly pending = computed(() => this.state()?.pending ?? null);
  protected readonly pendingOperation = computed(() => this.state()?.pendingOperation ?? null);
  protected readonly pendingFailure = computed(() => this.pendingOperation()?.failure ?? null);
  protected readonly done = computed(() => this.state()?.done ?? false);
  protected readonly answered = computed(() => this.state()?.turns ?? []);
  protected readonly retakes = computed(() => this.state()?.retakes ?? 0);
  /** 1-based number of the question on screen. */
  protected readonly stepNumber = computed(() => this.answered().length + 1);
  protected readonly pendingStatusKey = computed(() => {
    const operation = this.pendingOperation();
    if (operation?.failure) return operation.phase === 'proposal' ? 'card.proposalFailed' : 'card.answerFailed';
    return operation?.phase === 'proposal' ? 'card.proposalPending' : 'card.answerPending';
  });
  protected readonly isFresh = computed(() => {
    const s = this.state();
    return !!s && !s.pending && !s.done && s.turns.length === 0;
  });
  protected readonly canSubmit = computed(() => {
    const q = this.pending();
    if (!q || this.busy()) return false;
    if (q.type === 'text') return this.customText().trim().length > 0;
    return this.selected().length > 0 || this.customText().trim().length > 0;
  });

  constructor() {
    effect(() => {
      const context = this.context();
      const cardId = this.cardId();
      const canMutate = this.canMutate();
      untracked(() => {
        this.store.connect(context, cardId, canMutate);
        this.resetAnswer();
      });
    });
    effect(() => {
      const event = this.store.event();
      if (!event) return;
      if (event.type === 'finalized' && event.spec) this.finalized.emit(event.spec);
      if (event.type === 'reopened') this.reopened.emit();
      if (event.type === 'changed') {
        this.resetAnswer();
        if (event.action === 'sharpen') {
          this.sharpenOpen.set(false);
          this.sharpenNote.set('');
        }
        this.changed.emit();
      }
    });
  }

  protected start(): void {
    this.store.start();
  }

  protected retake(): void {
    if (!this.canMutate()) return;
    if (!window.confirm(this.transloco.translate('card.retakeConfirm'))) return;
    this.store.retake();
  }

  protected openSharpen(): void {
    this.sharpenNote.set('');
    this.store.clearError();
    this.sharpenOpen.set(true);
  }

  protected cancelSharpen(): void {
    this.sharpenOpen.set(false);
  }

  /** Sharpen the cleared requirement with a reviewer note: the AI re-opens the
   *  interview with one more question, or re-derives a sharper spec. */
  protected submitSharpen(): void {
    if (!this.canMutate()) return;
    const note = this.sharpenNote().trim();
    if (!note || this.busy()) return;
    this.store.sharpen(note);
  }

  protected submit(): void {
    if (!this.canMutate()) return;
    const q = this.pending();
    if (!q || !this.canSubmit()) return;
    const answer: InterviewAnswer = {
      questionId: q.id,
      expectedVersion: this.state()?.version ?? 0,
      selected: this.selected(),
      customText: this.customText().trim(),
    };
    this.store.answer(answer);
  }

  protected retryPending(): void {
    const operation = this.pendingOperation();
    if (!operation?.failure?.retryable || this.busy() || !this.canMutate()) return;
    this.store.retry();
  }

  /** single-select: replace the selection. */
  protected pick(value: string): void {
    this.selected.set([value]);
  }

  /** multi-select: toggle a value in/out. */
  protected toggle(value: string): void {
    this.selected.update((s) => (s.includes(value) ? s.filter((v) => v !== value) : [...s, value]));
  }

  protected isSelected(value: string): boolean {
    return this.selected().includes(value);
  }

  /**
   * Keyboard shortcuts for the pending question (opencode-style): digits
   * 1–9 pick/toggle the matching option, Enter submits. Ignored while the
   * caret is in a text field, so typing a "1" stays a "1".
   */
  protected onKey(event: KeyboardEvent): void {
    const q = this.pending();
    if (!q || this.busy()) return;
    const tag = (event.target as HTMLElement | null)?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';
    if (event.key === 'Enter') {
      if (!typing && this.canSubmit()) {
        event.preventDefault();
        this.submit();
      }
      return;
    }
    if (typing || q.type === 'text') return;
    const n = Number(event.key);
    if (Number.isInteger(n) && n >= 1 && n <= q.options.length) {
      event.preventDefault();
      const value = q.options[n - 1].value;
      if (q.type === 'multi') this.toggle(value);
      else this.pick(value);
    }
  }

  /** Human-readable summary of an answered turn, for the history list. */
  protected summary(turn: InterviewTurn): string {
    const labels = turn.answer.selected.map(
      (v) => turn.question.options.find((o) => o.value === v)?.label ?? v,
    );
    return [...labels, turn.answer.customText].filter(Boolean).join(', ') || '—';
  }

  private resetAnswer(): void {
    this.selected.set([]);
    this.customText.set('');
  }

}
