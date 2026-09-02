/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';

import type { CardEvent } from '@agentic-software-factory/api-contracts/kanban';
import { KanbanInterviewClient } from '../../core/api/kanban-interview.client';
import type { FactoryRequestContext } from '../../core/context/factory-context.store';
import { Icon } from '../../shared/icon/icon';

const presentation: Record<string, { icon: string; label: string }> = {
  created: { icon: 'plus', label: 'factory.activity.created' },
  'interview-started': { icon: 'sparkles', label: 'factory.activity.interview-started' },
  'interview-answered': { icon: 'check', label: 'factory.activity.interview-answered' },
  'interview-finalized': { icon: 'circle-check', label: 'factory.activity.interview-finalized' },
  'spec-proposed': { icon: 'list-checks', label: 'factory.activity.spec-proposed' },
  'spec-accepted': { icon: 'lock', label: 'factory.activity.spec-accepted' },
};

@Component({
  selector: 'factory-card-activity',
  imports: [HlmButton, Icon, TranslocoPipe],
  template: `
    <div class="flex flex-col gap-(--spacing-brand-xs)">
      @if (loading()) {<p class="flex items-center gap-(--spacing-brand-xxs) text-xs text-brand-gray-600"><factory-icon name="loader" size="sm" class="animate-spin" /> {{ 'factory.activityLoading' | transloco }}</p>}
      @else if (error()) {<div class="flex flex-col items-start gap-(--spacing-brand-xs)"><p role="alert" class="text-xs text-brand-danger">{{ 'factory.activityError' | transloco }}</p><button hlmBtn variant="ghost" size="sm" type="button" (click)="load()">{{ 'factory.retry' | transloco }}</button></div>}
      @else if (events().length === 0) {<p class="text-xs text-brand-gray-600">{{ 'factory.noActivity' | transloco }}</p>}
      @else {<ul class="flex flex-col gap-(--spacing-brand-xs)">@for (event of visibleEvents(); track event.id) {<li class="flex items-start gap-(--spacing-brand-xs)"><factory-icon [name]="meta(event).icon" size="xs" class="mt-0.5 shrink-0 text-brand-gray-500" /><div class="flex min-w-0 flex-1 flex-col leading-tight"><span class="text-xs text-brand-gray-800">{{ meta(event).label | transloco }}</span><span class="text-micro text-brand-gray-600">{{ when(event.createdAt) }}@if (event.actor) { · {{ actor(event.actor) }}}</span></div></li>}</ul>@if (events().length > 5) {<button hlmBtn variant="ghost" size="sm" class="self-start" (click)="expanded.set(!expanded())">{{ (expanded() ? 'factory.showLess' : 'factory.showAll') | transloco: { count: events().length } }}</button>}}
    </div>
  `,
})
export class CardActivity {
  private readonly api = inject(KanbanInterviewClient);
  private readonly transloco = inject(TranslocoService);
  readonly cardId = input.required<string>();
  readonly context = input<FactoryRequestContext>({ team: 'factory', application: null });
  protected readonly loading = signal(true);
  protected readonly events = signal<CardEvent[]>([]);
  protected readonly expanded = signal(false);
  protected readonly error = signal(false);
  protected readonly visibleEvents = computed(() => this.expanded() ? this.events() : this.events().slice(0, 5));
  private request = 0;

  constructor() {
    effect(() => {
      this.cardId();
      this.load();
    });
  }

  protected load(): void {
    const request = ++this.request;
    this.loading.set(true);
    this.error.set(false);
    this.events.set([]);
    this.expanded.set(false);
    this.api.getEvents(this.context(), this.cardId()).subscribe({
      next: ({ events }) => {
        if (request !== this.request) return;
        this.events.set(events);
        this.loading.set(false);
      },
      error: () => {
        if (request !== this.request) return;
        this.loading.set(false);
        this.error.set(true);
      },
    });
  }

  protected meta(event: CardEvent): { icon: string; label: string } { return presentation[event.type] ?? { icon: 'activity', label: event.type }; }
  protected when(value: string): string { return new Date(value).toLocaleString(this.transloco.getActiveLang(), { dateStyle: 'short', timeStyle: 'short' }); }
  protected actor(value: string): string {
    const actor = value.includes('#') ? value.slice(value.lastIndexOf('#') + 1) : value;
    if (actor.startsWith('bootstrap:')) return 'Factory';
    return actor.length > 28 ? `${actor.slice(0, 25)}…` : actor;
  }
}
