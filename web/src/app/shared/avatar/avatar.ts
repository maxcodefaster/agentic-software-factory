/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<AvatarSize, string> = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-[10px]',
  lg: 'h-9 w-9 text-xs',
  xl: 'h-12 w-12 text-base',
};

/**
 * `<factory-avatar [name] [size]>` — the initials chip used for users/assignees.
 * One implementation replacing the four hand-rolled copies (shell, board card,
 * team member, settings profile). Decorative: the name is surfaced via
 * `title`, so screen readers get the adjacent text label, not "AB".
 */
@Component({
  selector: 'factory-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="grid shrink-0 place-items-center rounded-full bg-brand-gray-900 font-bold text-brand-surface"
      [class]="sizeClass()"
      [title]="name() ?? ''"
      aria-hidden="true"
      >{{ initials() }}</span
    >
  `,
})
export class Avatar {
  readonly name = input<string | null>(null);
  readonly size = input<AvatarSize>('md');
  /** Explicit initials override (e.g. the auth service's precomputed value). */
  readonly initialsOverride = input<string | null>(null, { alias: 'initials' });

  protected readonly sizeClass = computed(() => SIZE_CLASS[this.size()]);
  protected readonly initials = computed(() => {
    const override = this.initialsOverride()?.trim();
    if (override) return override;
    const n = this.name()?.trim();
    if (!n) return '';
    return n
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  });
}
