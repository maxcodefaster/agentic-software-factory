/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { CdkListbox, CdkOption, type ListboxValueChangeEvent } from '@angular/cdk/listbox';
import { Component, computed, ElementRef, inject, input, output, signal, viewChild, viewChildren } from '@angular/core';

import { Icon } from '../icon/icon';

export interface ContextListboxOption {
  value: string;
  label: string;
  description?: string;
}

@Component({
  selector: 'factory-context-listbox',
  imports: [CdkListbox, CdkOption, Icon],
  templateUrl: './context-listbox.html',
})
export class ContextListbox {
  private static nextId = 0;

  readonly ariaLabel = input.required<string>();
  readonly triggerText = input.required<string>();
  readonly triggerIcon = input<string | null>(null);
  readonly options = input.required<readonly ContextListboxOption[]>();
  readonly value = input<string | null>(null);
  readonly emptyText = input('');
  readonly actionLabel = input<string | null>(null);
  readonly align = input<'start' | 'end'>('start');
  readonly valueChange = output<string>();
  readonly action = output<void>();

  protected readonly open = signal(false);
  protected readonly listboxId = `context-listbox-${ContextListbox.nextId++}`;
  protected readonly selectedValues = computed(() => {
    const value = this.value();
    return value === null ? [] : [value];
  });

  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly listbox = viewChild(CdkListbox<string>);
  private readonly cdkOptions = viewChildren(CdkOption<string>);

  protected toggle(): void {
    if (this.open()) this.close();
    else this.openMenu('selected');
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' || event.key === 'End') this.openMenu('last');
    else if (event.key === 'Home') this.openMenu('first');
    else this.openMenu('selected');
  }

  protected select(event: ListboxValueChangeEvent<string>): void {
    const value = event.value[0];
    if (value === undefined) return;
    this.valueChange.emit(value);
    this.close(true);
  }

  protected closeAfterOptionClick(): void {
    queueMicrotask(() => this.close(true));
  }

  protected runAction(): void {
    this.close(true);
    this.action.emit();
  }

  protected onTab(): void {
    queueMicrotask(() => {
      if (!this.host.nativeElement.contains(document.activeElement)) this.close();
    });
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.nativeElement.contains(next)) return;
    if (next instanceof Node) {
      this.close();
      return;
    }
    queueMicrotask(() => {
      if (!this.host.nativeElement.contains(document.activeElement)) this.close();
    });
  }

  protected onEscape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.close(true);
  }

  protected close(restoreFocus = false): void {
    if (!this.open()) return;
    this.open.set(false);
    if (restoreFocus) queueMicrotask(() => this.trigger()?.nativeElement.focus());
  }

  private openMenu(focus: 'selected' | 'first' | 'last'): void {
    this.open.set(true);
    queueMicrotask(() => {
      if (focus === 'first') this.cdkOptions()[0]?.focus();
      else if (focus === 'last') this.cdkOptions().at(-1)?.focus();
      else this.listbox()?.focus();
    });
  }
}
