/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output } from '@angular/core';

/**
 * `<factory-overlay>` — the one modal/sheet shell. Owns the backdrop, focus trap
 * (+ auto-capture), `role`/`aria-modal`, and Escape / backdrop-click dismissal,
 * so board dialogs and focused card surfaces
 * alert, card-detail sheet) stop re-implementing that plumbing.
 *
 *   <factory-overlay variant="sheet" panelClass="… max-w-3xl p-0 …"
 *     ariaLabel="Ticket" (dismiss)="close()"> … </factory-overlay>
 */
@Component({
  selector: 'factory-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkTrapFocus],
  template: `
    <div [class]="backdropClass()" (click)="dismiss.emit()">
      <div
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        [attr.role]="role()"
        aria-modal="true"
        [attr.aria-label]="ariaLabel() || null"
        [class]="panelClasses()"
        (click)="$event.stopPropagation()"
        (keydown.escape)="dismiss.emit()"
      >
        <ng-content />
      </div>
    </div>
  `,
})
export class Overlay {
  private readonly host = inject(ElementRef<HTMLElement>);
  private previousFocus: HTMLElement | null = null;
  private previousOverflow = '';
  /** 'center' = classic centered dialog; 'sheet' = bottom sheet (slides up);
   *  'drawer' = right-edge panel, full height (slides in from the right);
   *  'focus' = near-fullscreen centered stage (rises + scales in) with a deeper
   *  blur, so the page behind reads as soft-focus context rather than vanishing. */
  readonly variant = input<'center' | 'sheet' | 'drawer' | 'focus'>('center');
  readonly role = input<'dialog' | 'alertdialog'>('dialog');
  readonly ariaLabel = input('');
  /** Size/shape classes for the panel (e.g. `max-w-3xl p-0 rounded-t-…`). */
  readonly panelClass = input('');

  readonly dismiss = output<void>();

  ngOnInit(): void {
    if (typeof document === 'undefined') return;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  ngOnDestroy(): void {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = this.previousOverflow;
    const target = this.previousFocus;
    if (target?.isConnected && !this.host.nativeElement.contains(target)) queueMicrotask(() => target.focus());
  }

  protected readonly backdropClass = computed(() => {
    const base = 'fixed inset-0 z-50 flex bg-(--factory-scrim) ';
    switch (this.variant()) {
      case 'sheet':
        return `${base}backdrop-blur-sm items-end justify-center`;
      case 'drawer':
        return `${base}backdrop-blur-sm items-stretch justify-end`;
      case 'focus':
        // A deeper blur + centered, with breathing room around the panel so the
        // page behind stays a (soft-focus) reminder of where you came from.
        return `${base}backdrop-blur-md items-center justify-center p-0 sm:p-(--spacing-brand-l)`;
      default:
        return `${base}backdrop-blur-sm items-center justify-center p-(--spacing-brand-l)`;
    }
  });
  protected readonly panelClasses = computed(() => {
    let entrance: string;
    switch (this.variant()) {
      case 'sheet':
        entrance = 'factory-sheet-in';
        break;
      case 'drawer':
        entrance = 'factory-drawer-in';
        break;
      case 'focus':
        entrance = 'factory-focus-in';
        break;
      default:
        entrance = 'factory-animate-in';
    }
    return `factory-overlay-panel factory-overlay-${this.variant()} ${entrance} ${this.panelClass()}`;
  });
}
