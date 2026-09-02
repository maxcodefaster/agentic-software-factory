/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

import type { KanbanColumnId } from '../../core/api/kanban.types';
import { Icon } from '../../shared/icon/icon';

/**
 * Journey stepper — the four-stage path a ticket travels, so anyone opening a
 * card instantly sees the goal and where they are:
 *
 *   Backlog → Anforderungen → Umsetzung → Erledigt
 *
 * Purely presentational; the active stage is driven by the card's column.
 */
interface Stage {
  id: KanbanColumnId;
  label: string;
  icon: string;
  blurb: string;
}

const STAGES: readonly Stage[] = [
  {
    id: 'ideation',
    label: 'factory.stageLabel.ideation',
    icon: 'sparkles',
    blurb: 'card.blurbIdeation',
  },
  {
    id: 'requirements',
    label: 'factory.stageLabel.requirements',
    icon: 'book-open',
    blurb: 'card.blurbRequirements',
  },
  {
    id: 'implementation',
    label: 'factory.stageLabel.implementation',
    icon: 'zap',
    blurb: 'card.blurbImplementation',
  },
  {
    id: 'done',
    label: 'factory.stageLabel.done',
    icon: 'circle-check',
    blurb: 'card.blurbDone',
  },
];

@Component({
  selector: 'factory-journey-steps',
  imports: [Icon, TranslocoPipe],
  templateUrl: './journey-steps.html',
})
export class JourneySteps {
  readonly current = input.required<KanbanColumnId>();
  readonly compact = input(false);
  /** Whether the *next* stage is reachable (its gate is satisfied). Drives the
   *  lock affordance on the upcoming segment, so the path itself shows what's
   *  blocking forward motion. */
  readonly nextUnlocked = input(true);
  /** Why the next stage is locked — a short hint shown under the path. */
  readonly nextHint = input<string | null>(null);

  protected readonly stages = STAGES;
  protected readonly currentIndex = computed(() =>
    Math.max(
      0,
      STAGES.findIndex((s) => s.id === this.current()),
    ),
  );
  /** The index of the immediately-upcoming stage (the one a forward move targets). */
  protected readonly nextIndex = computed(() => this.currentIndex() + 1);
  protected readonly activeBlurb = computed(() => STAGES[this.currentIndex()]?.blurb ?? '');

  protected stateOf(i: number): 'done' | 'active' | 'upcoming' {
    const c = this.currentIndex();
    return i < c ? 'done' : i === c ? 'active' : 'upcoming';
  }

  /** The upcoming step is "locked" only when it's the immediate next one and its
   *  gate is unmet — later steps are simply not-yet-reachable, not locked. */
  protected isLocked(i: number): boolean {
    return i === this.nextIndex() && !this.nextUnlocked();
  }

  /** The marker disc styling per state — done (success check), active (the
   *  brand "you are here" bullseye), the ready-next (a quiet mint hint ring),
   *  locked-next (gray with a lock), or a far upcoming stop. */
  protected markerClass(i: number): string {
    const st = this.stateOf(i);
    if (st === 'done') return 'bg-brand-success text-white shadow-brand-xs';
    if (st === 'active')
      return 'bg-brand-mint-500 text-brand-ink ring-4 ring-brand-mint-500/25 shadow-brand-xs';
    if (this.isLocked(i)) return 'border border-brand-gray-300 text-brand-gray-600';
    return i === this.nextIndex()
      ? 'border border-brand-mint-500/60 text-brand-gray-600'
      : 'border border-brand-gray-300 text-brand-gray-600';
  }

  protected labelClass(i: number): string {
    const st = this.stateOf(i);
    if (st === 'active') return 'font-semibold text-brand-gray-900';
    if (st === 'done') return 'text-brand-gray-700';
    return 'text-brand-gray-600';
  }

  /** A traveled connector is inked; the road ahead is faint. */
  protected connectorClass(i: number): string {
    return i < this.currentIndex() ? 'bg-brand-gray-900' : 'bg-brand-gray-200';
  }
}
