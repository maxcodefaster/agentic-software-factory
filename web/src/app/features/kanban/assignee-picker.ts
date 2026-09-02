/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmInput } from '@spartan-ng/helm/input';

import { type AssignmentUser, UsersClient } from '../../core/api/users.client';
import type { FactoryRequestContext } from '../../core/context/factory-context.store';
import { Avatar } from '../../shared/avatar/avatar';

@Component({
  selector: 'factory-assignee-picker',
  imports: [Avatar, HlmInput, TranslocoPipe],
  template: `
    <div class="relative">
      <input hlmInput role="combobox" aria-autocomplete="list" [attr.aria-expanded]="open()" [attr.aria-controls]="listId()" [id]="inputId()" name="assignee" autocomplete="off" class="w-full" [placeholder]="'factory.searchPeople' | transloco" [value]="query()" (focus)="open.set(true)" (input)="query.set($any($event.target).value); open.set(true)" />
      @if (open()) {
        <button type="button" class="fixed inset-0 z-40 cursor-default" [attr.aria-label]="'common.close' | transloco" (click)="open.set(false)"></button>
        <div [id]="listId()" role="listbox" class="factory-context-menu right-0 z-50">
          <button type="button" role="option" [attr.aria-selected]="!value()" (click)="assign(null)">{{ 'factory.unassigned' | transloco }}</button>
          @for (user of matches(); track user.id) {
            <button type="button" role="option" [attr.aria-selected]="user.username === value()" (click)="assign(user)">
              <factory-avatar [initials]="user.initials" [name]="user.displayName" size="sm" />
              <span class="min-w-0 flex-1"><strong class="block truncate text-sm">{{ user.displayName }}</strong><span class="block truncate text-micro text-brand-gray-500">{{ user.username }}</span></span>
            </button>
          } @empty {<p class="p-(--spacing-brand-xs) text-meta text-brand-gray-500">{{ (loading() ? 'factory.peopleLoading' : 'factory.noPeople') | transloco }}</p>}
        </div>
      }
    </div>
  `,
})
export class AssigneePicker {
  private readonly usersApi = inject(UsersClient);
  readonly value = input<string | null>(null);
  readonly context = input<FactoryRequestContext>({ team: 'factory', application: null });
  readonly inputId = input('requirement-assignee');
  readonly selected = output<string | null>();
  protected readonly users = signal<AssignmentUser[]>([]);
  protected readonly loading = signal(true);
  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly listId = computed(() => `${this.inputId()}-options`);
  protected readonly matches = computed(() => {
    const query = this.query().trim().toLowerCase();
    return this.users().filter((user) => !query || `${user.displayName} ${user.username}`.toLowerCase().includes(query)).slice(0, 8);
  });
  private request = 0;

  constructor() {
    effect(() => this.query.set(this.value() ?? ''));
    effect(() => {
      const context = this.context();
      const request = ++this.request;
      this.loading.set(true);
      this.usersApi.list(context).subscribe({
        next: ({ users }) => {
          if (request !== this.request) return;
          this.users.set(users);
          this.loading.set(false);
        },
        error: () => {
          if (request === this.request) this.loading.set(false);
        },
      });
    });
  }

  protected assign(user: AssignmentUser | null): void {
    const username = user?.username ?? null;
    this.query.set(username ?? '');
    this.open.set(false);
    this.selected.emit(username);
  }
}
