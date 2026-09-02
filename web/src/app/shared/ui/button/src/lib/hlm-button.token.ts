/*
 * Spartan-derived portions of this file remain licensed under MIT.
 * Copyright (c) 2024 ROBIN GOETZ. See THIRD_PARTY_NOTICES.
 * Agentic Software Factory modifications: local formatting and Angular integration.
 * Copyright 2026 Agentic Software Factory contributors; modifications are RPL-1.5.
 */

import { InjectionToken, inject, type ValueProvider } from '@angular/core';
import type { ButtonVariants } from './hlm-button';

export interface BrnButtonConfig {
  variant: ButtonVariants['variant'];
  size: ButtonVariants['size'];
}

const defaultConfig: BrnButtonConfig = {
  variant: 'default',
  size: 'default',
};

const BrnButtonConfigToken = new InjectionToken<BrnButtonConfig>('BrnButtonConfig');

export function provideBrnButtonConfig(config: Partial<BrnButtonConfig>): ValueProvider {
  return { provide: BrnButtonConfigToken, useValue: { ...defaultConfig, ...config } };
}

export function injectBrnButtonConfig(): BrnButtonConfig {
  return inject(BrnButtonConfigToken, { optional: true }) ?? defaultConfig;
}
