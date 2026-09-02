/*
 * Spartan-derived portions of this file remain licensed under MIT.
 * Copyright (c) 2024 ROBIN GOETZ. See THIRD_PARTY_NOTICES.
 * Agentic Software Factory modifications: project-specific button styles and sizes.
 * Copyright 2026 Agentic Software Factory contributors; modifications are RPL-1.5.
 */

import { Directive, input, signal } from '@angular/core';
import { BrnButton } from '@spartan-ng/brain/button';
import { classes } from '@spartan-ng/helm/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ClassValue } from 'clsx';
import { injectBrnButtonConfig } from './hlm-button.token';

export const buttonVariants = cva(
  "focus-visible:border-ring focus-visible:ring-ring/50 data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-brand-md border-2 border-transparent bg-clip-padding text-sm font-semibold focus-visible:ring-3 active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[calc(var(--spacing)*4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0",
  {
    variants: {
      variant: {
        // Primary: amber fill plus a 2px near-black outline.
        default:
          'border-brand-gray-900 bg-brand-mint-500 text-brand-ink hover:bg-brand-mint-600',
        // Secondary: unfilled, with a 2px outline that darkens on hover.
        outline:
          'border-brand-gray-900/40 bg-transparent text-brand-gray-900 hover:border-brand-gray-900/70 hover:bg-brand-gray-900/5 aria-expanded:border-brand-gray-900/70 aria-expanded:bg-brand-gray-900/5',
        // Soft neutral — tertiary, low-emphasis fill.
        secondary:
          'bg-brand-gray-100 text-brand-gray-900 hover:bg-brand-gray-200 aria-expanded:bg-brand-gray-200',
        ghost:
          'text-brand-gray-700 hover:bg-brand-gray-100 hover:text-brand-gray-900 aria-expanded:bg-brand-gray-100 aria-expanded:text-brand-gray-900',
        destructive: 'bg-brand-danger/10 text-brand-danger hover:bg-brand-danger/20',
        link: 'border-0 text-brand-info underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        xs: "h-7 gap-1 px-2.5 text-xs in-data-[slot=button-group]:rounded-brand-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_ng-icon:not([class*='text-'])]:text-[calc(var(--spacing)*3)]",
        sm: 'h-9 gap-1.5 px-3 in-data-[slot=button-group]:rounded-brand-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        lg: 'h-11 gap-2 px-5 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5',
        icon: 'size-10',
        'icon-xs':
          "size-7 in-data-[slot=button-group]:rounded-brand-md [&_ng-icon:not([class*='text-'])]:text-[calc(var(--spacing)*3)]",
        'icon-sm': 'size-9 in-data-[slot=button-group]:rounded-brand-md',
        'icon-lg': 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;

@Directive({
  selector: 'button[hlmBtn], a[hlmBtn]',
  exportAs: 'hlmBtn',
  hostDirectives: [{ directive: BrnButton, inputs: ['disabled'] }],
  host: { 'data-slot': 'button' },
})
export class HlmButton {
  private readonly _config = injectBrnButtonConfig();

  private readonly _additionalClasses = signal<ClassValue>('');

  public readonly variant = input<ButtonVariants['variant']>(this._config.variant);

  public readonly size = input<ButtonVariants['size']>(this._config.size);

  constructor() {
    classes(() => [
      buttonVariants({ variant: this.variant(), size: this.size() }),
      this._additionalClasses(),
    ]);
  }

  setClass(classes: string): void {
    this._additionalClasses.set(classes);
  }
}
